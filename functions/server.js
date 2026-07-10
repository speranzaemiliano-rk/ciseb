const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const Afip    = require('@afipsdk/afip.js');
const admin   = require('firebase-admin');

// Firebase Admin — se inicializa con service account (base64 del JSON) o con las
// variables individuales FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.
(function initFirebaseAdmin() {
    try {
        if (admin.apps.length) return;
        var sa64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
        if (sa64) {
            var sa = JSON.parse(Buffer.from(sa64, 'base64').toString('utf8'));
            admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://CISEB-TU-PROYECTO-default-rtdb.firebaseio.com' });
        } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: leerPem(process.env.FIREBASE_PRIVATE_KEY)
                }),
                databaseURL: 'https://CISEB-TU-PROYECTO-default-rtdb.firebaseio.com'
            });
        } else {
            console.warn('[Firebase Admin] No se configuró service account — los endpoints /usuarios/* no van a funcionar. Cargá FIREBASE_SERVICE_ACCOUNT_BASE64 en Railway.');
        }
    } catch (e) {
        console.error('[Firebase Admin] Error al inicializar:', e.message);
    }
})();

const app  = express();

// CORS: por defecto abierto (compat con lo de antes). Si se define ALLOWED_ORIGINS
// (lista separada por comas) en el entorno, se restringe a esos orígenes.
const _allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
app.use(cors({ origin: _allowedOrigins.length ? _allowedOrigins : true }));
app.use(express.json({ limit: '20mb' }));

// Autenticación por token compartido (X-App-Token / ?token=).
// Modo compatibilidad: mientras no se defina APP_API_TOKEN en el entorno, el
// backend sigue aceptando pedidos sin autenticar (como hasta ahora), pero avisa
// en el log en cada request para que no pase desapercibido antes de producción.
// El webhook de WhatsApp queda afuera porque lo llama Meta directamente (no
// puede mandar nuestro header) y ya se valida con WHATSAPP_VERIFY_TOKEN aparte.
const _RUTAS_SIN_TOKEN = ['/', '/whatsapp/webhook'];
app.use(function(req, res, next) {
    if (_RUTAS_SIN_TOKEN.indexOf(req.path) !== -1) return next();
    const esperado = process.env.APP_API_TOKEN;
    if (!esperado) {
        console.warn('[seguridad] APP_API_TOKEN no configurado — ' + req.method + ' ' + req.path + ' se aceptó SIN autenticar. Configurá APP_API_TOKEN antes de usar esto con datos reales.');
        return next();
    }
    const recibido = req.get('X-App-Token') || req.query.token;
    if (!recibido || !_tokenIgual(recibido, esperado)) {
        return res.status(401).json({ error: 'No autorizado. Falta o es inválido el header X-App-Token.' });
    }
    next();
});

function _tokenIgual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    var ba = Buffer.from(a);
    var bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

// Variables de entorno:
//   AFIP_CUIT       → tu CUIT sin guiones
//   AFIP_CERT       → contenido del archivo .crt (con \n reales)
//   AFIP_KEY        → contenido del archivo .key (con \n reales)
//   AFIP_ENV        → "production" o "testing" (default: testing)
//   APP_API_TOKEN   → token secreto que debe mandar el frontend (X-App-Token) en cada request
//   ALLOWED_ORIGINS → orígenes permitidos para CORS, separados por comas (opcional)
//   PORT            → puerto (Railway/Render lo inyectan automático)

// Lee un PEM de una env var. Acepta 3 formatos:
//  1) PEM con saltos de línea reales
//  2) PEM con \n literales (Railway/Firebase a veces los guarda así)
//  3) base64 del archivo completo (lo más robusto, sin problemas de saltos)
function leerPem(valor) {
    if (!valor) return '';
    var v = valor.trim();
    if (v.indexOf('-----BEGIN') !== -1) {
        return v.replace(/\\n/g, '\n');
    }
    try {
        return Buffer.from(v, 'base64').toString('utf8');
    } catch (_) {
        return v;
    }
}

// Crea la instancia de Afip con las credenciales de entorno. Lanza si faltan.
function crearAfip() {
    const cuit = process.env.AFIP_CUIT;
    const cert = leerPem(process.env.AFIP_CERT);
    const key  = leerPem(process.env.AFIP_KEY);
    const env  = process.env.AFIP_ENV || 'testing';
    const token = process.env.AFIP_ACCESS_TOKEN || '';
    if (!cuit || !cert || !key) {
        const err = new Error('Faltan credenciales. Configurá AFIP_CUIT, AFIP_CERT y AFIP_KEY.');
        err.faltanCreds = true;
        throw err;
    }
    const afipOpts = { CUIT: cuit, cert, key, production: env === 'production' };
    if (token) afipOpts.access_token = token;
    return new Afip(afipOpts);
}

function detalleError(e) {
    var detalle = '';
    var fuente = e.data || (e.response && e.response.data);
    if (fuente) {
        detalle = typeof fuente === 'string' ? fuente : JSON.stringify(fuente);
    }
    if (e.status) detalle = '[HTTP ' + e.status + '] ' + detalle;
    return detalle;
}

app.get('/', (req, res) => res.json({ status: 'ok', service: 'CISEB AFIP Backend' }));

// Importa todos los comprobantes emitidos.
// Si se pasan ptoVta y tipoComp como query params, filtra por ellos.
// Sin parámetros: trae TODOS los puntos de venta activos y todos los tipos habituales.
// GET /afip/importar
// GET /afip/importar?ptoVta=3&tipoComp=1
const TIPOS_COMP_HABITUALES = [1, 2, 3, 6, 7, 8, 11, 12, 13]; // FA, NDA, NCA, FB, NDB, NCB, FC, NDC, NCC

async function importarComprobantes(afip, ptoVta, tipoComp) {
    const lista = [];
    const ultimo = await afip.ElectronicBilling.getLastVoucher(ptoVta, tipoComp);
    if (!ultimo) return lista;
    for (let nro = 1; nro <= ultimo; nro++) {
        try {
            const v = await afip.ElectronicBilling.getVoucherInfo(nro, ptoVta, tipoComp);
            if (v && v.CodAutorizacion) {
                lista.push({
                    tipoComp, ptoVta, nro,
                    fecha:     String(v.CbteFch || ''),
                    moneda:    v.MonId || 'PES',
                    cuitRecep: String(v.DocNro || ''),
                    condIva:   v.CondicionIVAReceptorId || 5,
                    razon: '', dom: '',
                    impNeto:  v.ImpNeto  || 0,
                    impIVA:   v.ImpIVA   || 0,
                    impTotal: v.ImpTotal || 0,
                    descripcion: '',
                    cae:    v.CodAutorizacion,
                    caeVto: v.FchVto || '',
                    emitidaEn: 0,
                    importada: true
                });
            }
        } catch (_) { /* comprobante sin info, saltar */ }
    }
    return lista;
}

app.get('/afip/importar', async (req, res) => {
    try {
        const afip = crearAfip();
        const ptoVtaParam  = parseInt(req.query.ptoVta)  || 0;
        const tipoCompParam = parseInt(req.query.tipoComp) || 0;

        // Si se especificó punto de venta y tipo, importar solo eso
        if (ptoVtaParam && tipoCompParam) {
            const lista = await importarComprobantes(afip, ptoVtaParam, tipoCompParam);
            return res.json(lista);
        }

        // Sin parámetros: traer todos los puntos de venta activos
        const puntosDeVenta = await afip.ElectronicBilling.getSalesPoints();
        const ptosActivos = (puntosDeVenta || [])
            .filter(p => p.Bloqueado === 'N')
            .map(p => p.Nro);

        if (!ptosActivos.length) return res.json([]);

        const tipos = tipoCompParam ? [tipoCompParam] : TIPOS_COMP_HABITUALES;
        const lista = [];
        for (const pto of ptosActivos) {
            for (const tipo of tipos) {
                try {
                    const parcial = await importarComprobantes(afip, pto, tipo);
                    lista.push(...parcial);
                } catch (_) { /* tipo sin comprobantes, ignorar */ }
            }
        }
        return res.json(lista);
    } catch (e) {
        return res.status(500).json({ error: e.message, detalle: detalleError(e) });
    }
});

// ──────────────────────────────────────────────────────────────────────
// COMPROBANTES RECIBIDOS — automatización "mis-comprobantes" de AFIP SDK
// ──────────────────────────────────────────────────────────────────────
// A diferencia de los emitidos (web service con certificado), los recibidos
// se obtienen automatizando el portal "Mis Comprobantes" de ARCA. Eso requiere:
//   AFIP_SDK_TOKEN   → access token de tu cuenta AFIP SDK (o reutiliza AFIP_ACCESS_TOKEN)
//   ARCA_USER        → usuario de clave fiscal (default: AFIP_CUIT)
//   ARCA_PASS        → contraseña de clave fiscal
// La automatización es asíncrona: se crea con POST y se consulta con GET hasta
// que deja de estar "in_process".
const AFIPSDK_BASE = 'https://app.afipsdk.com/api/v1';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fechaDMY(iso) {
    // 'YYYY-MM-DD' → 'DD/MM/YYYY'
    if (!iso) return '';
    const p = String(iso).split('-');
    return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : iso;
}

// Ejecuta la automatización "mis-comprobantes" para un tipo ('R' recibidos /
// 'E' emitidos) y un rango de fechas. Devuelve el array crudo de comprobantes.
// Lanza un Error con .httpStatus y .faltanCreds según corresponda.
async function misComprobantes(tipo, desde, hasta) {
    const token = process.env.AFIP_SDK_TOKEN || process.env.AFIP_ACCESS_TOKEN || '';
    const cuit  = process.env.AFIP_CUIT || '';
    const user  = process.env.ARCA_USER || cuit;
    const pass  = process.env.ARCA_PASS || '';
    if (!token || !cuit || !pass) {
        const err = new Error('Configurá en Railway: AFIP_SDK_TOKEN (o AFIP_ACCESS_TOKEN), ARCA_USER (o se usa AFIP_CUIT) y ARCA_PASS (contraseña de clave fiscal).');
        err.httpStatus = 400; err.faltanCreds = true;
        throw err;
    }

    // fechaEmision es obligatorio para el SDK — si no viene, usar el último mes
    if (!desde && !hasta) {
        const hoy = new Date();
        const hace30 = new Date(hoy); hace30.setDate(hoy.getDate() - 30);
        const pad = n => String(n).padStart(2,'0');
        desde = hace30.getFullYear() + '-' + pad(hace30.getMonth()+1) + '-' + pad(hace30.getDate());
        hasta = hoy.getFullYear() + '-' + pad(hoy.getMonth()+1) + '-' + pad(hoy.getDate());
    }
    const filters = { t: tipo, fechaEmision: (fechaDMY(desde) || '') + ' - ' + (fechaDMY(hasta) || '') };
    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // 1) Crear la automatización
    const crear = await fetch(AFIPSDK_BASE + '/automations', {
        method: 'POST',
        headers,
        body: JSON.stringify({ automation: 'mis-comprobantes', params: { cuit: user, username: user, password: pass, filters } })
    });
    const crearJson = await crear.json().catch(() => ({}));
    if (!crear.ok) {
        const err = new Error('AFIP SDK rechazó la solicitud: ' + JSON.stringify(crearJson));
        err.httpStatus = crear.status;
        throw err;
    }
    const id = crearJson.id || crearJson._id || (crearJson.data && crearJson.data.id);
    if (!id) { const err = new Error('AFIP SDK no devolvió un id de automatización: ' + JSON.stringify(crearJson)); err.httpStatus = 502; throw err; }

    // 2) Poll hasta que termine (máx ~3 min)
    let resultado = null;
    for (let intento = 0; intento < 36; intento++) {
        await sleep(5000);
        const r = await fetch(AFIPSDK_BASE + '/automations/' + id, { headers });
        const j = await r.json().catch(() => ({}));
        const status = (j.status || (j.data && j.data.status) || '').toLowerCase();
        if (status && status !== 'in_process' && status !== 'pending' && status !== 'processing') {
            resultado = j;
            break;
        }
    }
    if (!resultado) { const err = new Error('La automatización tardó demasiado. Probá de nuevo o reducí el rango de fechas.'); err.httpStatus = 504; throw err; }

    const status = (resultado.status || (resultado.data && resultado.data.status) || '').toLowerCase();
    if (status === 'error' || status === 'failed') {
        const err = new Error('La automatización falló (¿usuario/contraseña de ARCA correctos?): ' + JSON.stringify(resultado));
        err.httpStatus = 502;
        throw err;
    }

    // 3) Extraer el array de comprobantes (la forma exacta puede variar)
    let data = resultado.data;
    if (data && !Array.isArray(data) && Array.isArray(data.data)) data = data.data;
    if (!Array.isArray(data)) data = resultado.result || resultado.comprobantes || [];
    if (!Array.isArray(data)) data = [];
    return data;
}

function handlerMisComprobantes(tipo) {
    return async (req, res) => {
        try {
            const data = await misComprobantes(tipo, req.query.desde || '', req.query.hasta || '');
            return res.json(data);
        } catch (e) {
            return res.status(e.httpStatus || 500).json({ error: e.message, faltanCreds: !!e.faltanCreds });
        }
    };
}

// GET /afip/recibidos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  (comprobantes recibidos)
app.get('/afip/recibidos', handlerMisComprobantes('R'));
// GET /afip/emitidos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD   (emitidos, incluye los del portal)
app.get('/afip/emitidos', handlerMisComprobantes('E'));

// Diagnóstico: abrí esta URL en el navegador para ver qué puntos de venta
// tenés habilitados y si la conexión con ARCA funciona.
app.get('/diag', async (req, res) => {
    const env  = process.env.AFIP_ENV || 'testing';
    const cuit = process.env.AFIP_CUIT || '(no configurado)';
    const out  = {
        modo:            env === 'production' ? 'PRODUCCION' : 'TESTING/HOMOLOGACION',
        cuit,
        afipEnvVar:      env,
        certCargado:     !!(process.env.AFIP_CERT),
        keyCargada:      !!(process.env.AFIP_KEY),
        advertencia:     env !== 'production' ? 'ATENCION: estás en modo TESTING. Las facturas NO aparecen en AFIP real.' : null,
        recibidos: {
            sdkTokenCargado: !!(process.env.AFIP_SDK_TOKEN || process.env.AFIP_ACCESS_TOKEN),
            arcaUserCargado: !!(process.env.ARCA_USER || process.env.AFIP_CUIT),
            arcaPassCargada: !!(process.env.ARCA_PASS),
            listoParaUsar:   !!((process.env.AFIP_SDK_TOKEN || process.env.AFIP_ACCESS_TOKEN) && (process.env.ARCA_USER || process.env.AFIP_CUIT) && process.env.ARCA_PASS)
        }
    };
    try {
        const afip = crearAfip();
        try {
            out.serverStatus = await afip.ElectronicBilling.getServerStatus();
        } catch (e) { out.serverStatusError = e.message + ' ' + detalleError(e); }
        try {
            out.puntosDeVenta = await afip.ElectronicBilling.getSalesPoints();
        } catch (e) { out.puntosDeVentaError = e.message + ' ' + detalleError(e); }
    } catch (e) {
        out.errorCredenciales = e.message;
    }
    return res.json(out);
});

// Verifica el último comprobante emitido para un punto de venta y tipo
// GET /afip/ultimo?ptoVta=3&tipoComp=1
app.get('/afip/ultimo', async (req, res) => {
    try {
        const afip    = crearAfip();
        const ptoVta  = parseInt(req.query.ptoVta)  || 1;
        const tipoComp = parseInt(req.query.tipoComp) || 1;
        const ultimo  = await afip.ElectronicBilling.getLastVoucher(ptoVta, tipoComp);
        return res.json({ ptoVta, tipoComp, ultimoNro: ultimo });
    } catch (e) {
        return res.status(500).json({ error: e.message, detalle: detalleError(e) });
    }
});

app.post('/afip', async (req, res) => {
    try {
        const afip = crearAfip();

        const {
            tipoComp, ptoVta, concepto, fecha, moneda,
            cuitRecep, condIva, razon, dom,
            impNeto, impIVA, impTotal, alicId, descripcion,
            cbtesAsoc
        } = req.body;

        const ultimoCbte = await afip.ElectronicBilling.getLastVoucher(ptoVta, tipoComp);
        const nroCbte    = ultimoCbte + 1;

        const alicuotas = [];
        if (impIVA > 0) {
            alicuotas.push({
                Id:      parseInt(alicId),
                BaseImp: impNeto,
                Importe: impIVA
            });
        }

        const data = {
            CantReg:    1,
            PtoVta:     ptoVta,
            CbteTipo:   tipoComp,
            Concepto:   concepto,
            DocTipo:    80,
            DocNro:     parseInt(cuitRecep),
            CbteDesde:  nroCbte,
            CbteHasta:  nroCbte,
            CbteFch:    fecha,
            ImpTotal:   impTotal,
            ImpTotConc: 0,
            ImpNeto:    impNeto,
            ImpOpEx:    0,
            ImpIVA:     impIVA,
            ImpTrib:    0,
            MonId:      moneda,
            MonCotiz:   1,
            CondicionIVAReceptorId: parseInt(condIva) || 5, // obligatorio desde RG 5616 (1=RI,4=Exento,5=CF,6=Monotributo)
            // afip.js envuelve este array en {AlicIva:...} internamente; pasar el array pelado
            Iva: alicuotas.length ? alicuotas : null
        };

        // Notas de crédito y débito requieren CbtesAsoc (comprobante original)
        if (cbtesAsoc && cbtesAsoc.length) {
            data.CbtesAsoc = cbtesAsoc;
        }

        // Concepto 2 (Servicios) o 3 (Productos y Servicios) exige fechas de servicio.
        // Si el frontend no las manda, usamos la fecha del comprobante como período.
        if (parseInt(concepto) === 2 || parseInt(concepto) === 3) {
            data.FchServDesde = req.body.fchServDesde || fecha;
            data.FchServHasta = req.body.fchServHasta || fecha;
            data.FchVtoPago   = req.body.fchVtoPago   || fecha;
        }

        const result = await afip.ElectronicBilling.createVoucher(data);

        return res.json({
            cae:       result.CAE,
            caeFchVto: result.CAEFchVto,
            cbteDesde: nroCbte,
            ptoVta,
            tipoComp
        });

    } catch (e) {
        console.error('AFIP Error:', e);
        if (e.faltanCreds) {
            return res.status(500).json({ error: e.message });
        }
        return res.status(500).json({
            error: e.message || String(e),
            detalle: detalleError(e)
        });
    }
});

// ═══════════════════════════════════════════════════════════════════
//  BELVO — Open Banking (conexión automática a bancos, ej: Santander AR)
//  Variables de entorno:
//    BELVO_SECRET_ID        → Secret Key ID del dashboard de Belvo
//    BELVO_SECRET_PASSWORD  → Secret Key Password (se muestra una sola vez)
//    BELVO_ENV              → "sandbox" (default), "development" o "production"
// ═══════════════════════════════════════════════════════════════════
function belvoBase() {
    var env = (process.env.BELVO_ENV || 'sandbox').toLowerCase();
    if (env === 'production')  return 'https://api.belvo.com';
    if (env === 'development') return 'https://development.belvo.com';
    return 'https://sandbox.belvo.com';
}

function belvoCreds() {
    var id = process.env.BELVO_SECRET_ID;
    var pw = process.env.BELVO_SECRET_PASSWORD;
    if (!id || !pw) {
        var err = new Error('Faltan credenciales de Belvo. Configurá BELVO_SECRET_ID y BELVO_SECRET_PASSWORD en Railway.');
        err.faltanCreds = true;
        throw err;
    }
    return { id: id, pw: pw, auth: 'Basic ' + Buffer.from(id + ':' + pw).toString('base64') };
}

// Llama a la API de Belvo con autenticación Basic (Node 22 trae fetch nativo).
async function belvoFetch(path, opts) {
    opts = opts || {};
    var c = belvoCreds();
    var resp = await fetch(belvoBase() + path, {
        method: opts.method || 'GET',
        headers: Object.assign({ 'Authorization': c.auth, 'Content-Type': 'application/json' }, opts.headers || {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var text = await resp.text();
    var json;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
    if (!resp.ok) {
        var err = new Error('Belvo respondió HTTP ' + resp.status);
        err.status = resp.status;
        err.data = json;
        throw err;
    }
    return json;
}

// Diagnóstico: confirma que las credenciales están cargadas.
app.get('/belvo/diag', (req, res) => {
    try {
        belvoCreds();
        res.json({ ok: true, env: (process.env.BELVO_ENV || 'sandbox'), base: belvoBase() });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Token de acceso para abrir el Widget de conexión (Belvo Connect).
// El endpoint /api/token/ recibe id+password en el cuerpo (no usa Basic).
app.post('/belvo/widget-token', async (req, res) => {
    try {
        var c = belvoCreds();
        var resp = await fetch(belvoBase() + '/api/token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: c.id,
                password: c.pw,
                scopes: 'read_institutions,write_links',
                fetch_resources: ['ACCOUNTS', 'TRANSACTIONS']
            })
        });
        var json = await resp.json().catch(function () { return null; });
        if (!resp.ok) return res.status(resp.status).json({ error: 'No se pudo generar el token de Belvo', detalle: json });
        res.json({ access: json.access, refresh: json.refresh });
    } catch (e) {
        if (e.faltanCreds) return res.status(500).json({ error: e.message });
        res.status(500).json({ error: e.message || String(e) });
    }
});

// Cuentas asociadas a un link (POST trae la info fresca del banco).
// GET /belvo/accounts?link=<id>
app.get('/belvo/accounts', async (req, res) => {
    try {
        var link = req.query.link;
        if (!link) return res.status(400).json({ error: 'Falta el parámetro link.' });
        var data = await belvoFetch('/api/accounts/', { method: 'POST', body: { link: link } });
        res.json(data);
    } catch (e) {
        if (e.faltanCreds) return res.status(500).json({ error: e.message });
        res.status(e.status || 500).json({ error: e.message, detalle: e.data });
    }
});

// Movimientos de un link. GET /belvo/transactions?link=<id>&date_from=&date_to=
app.get('/belvo/transactions', async (req, res) => {
    try {
        var link = req.query.link;
        if (!link) return res.status(400).json({ error: 'Falta el parámetro link.' });
        var body = { link: link };
        if (req.query.date_from) body.date_from = req.query.date_from;
        if (req.query.date_to)   body.date_to   = req.query.date_to;
        var data = await belvoFetch('/api/transactions/', { method: 'POST', body: body });
        res.json(data);
    } catch (e) {
        if (e.faltanCreds) return res.status(500).json({ error: e.message });
        res.status(e.status || 500).json({ error: e.message, detalle: e.data });
    }
});

// ═══════════════════════════════════════════════════════════════════
//  PROMETEO — Open Banking (plan B). Login directo con usuario/clave del
//  banco (no usa widget). Las credenciales del banco NO se guardan: viajan
//  una sola vez para abrir la sesión y se obtiene una "key" de sesión.
//  Variables de entorno:
//    PROMETEO_API_KEY  → API key del panel de Prometeo
//    PROMETEO_ENV      → "sandbox" (default) o "production"
// ═══════════════════════════════════════════════════════════════════
function prometeoBase() {
    var env = (process.env.PROMETEO_ENV || 'sandbox').toLowerCase();
    return env === 'production'
        ? 'https://banking.prometeoapi.net'
        : 'https://banking.sandbox.prometeoapi.net';
}

function prometeoApiKey() {
    var k = process.env.PROMETEO_API_KEY;
    if (!k) {
        var err = new Error('Falta la credencial de Prometeo. Configurá PROMETEO_API_KEY en Railway.');
        err.faltanCreds = true;
        throw err;
    }
    return k;
}

// Llama a la API de Prometeo. Para login usa form-urlencoded; el resto, query.
async function prometeoFetch(path, opts) {
    opts = opts || {};
    var resp = await fetch(prometeoBase() + path, {
        method: opts.method || 'GET',
        headers: Object.assign({ 'X-API-Key': prometeoApiKey() }, opts.headers || {}),
        body: opts.body || undefined
    });
    var text = await resp.text();
    var json;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
    if (!resp.ok) {
        var err = new Error('Prometeo respondió HTTP ' + resp.status);
        err.status = resp.status;
        err.data = json;
        throw err;
    }
    return json;
}

// Diagnóstico
app.get('/prometeo/diag', (req, res) => {
    try {
        prometeoApiKey();
        res.json({ ok: true, env: (process.env.PROMETEO_ENV || 'sandbox'), base: prometeoBase() });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Lista de bancos disponibles
app.get('/prometeo/providers', async (req, res) => {
    try {
        var data = await prometeoFetch('/provider/');
        res.json(data);
    } catch (e) {
        if (e.faltanCreds) return res.status(500).json({ error: e.message });
        res.status(e.status || 500).json({ error: e.message, detalle: e.data });
    }
});

// Login al banco. body JSON { provider, username, password }
// Devuelve { status, key }. status puede pedir interacción (OTP) en algunos bancos.
app.post('/prometeo/login', async (req, res) => {
    try {
        var b = req.body || {};
        if (!b.provider || !b.username || !b.password) {
            return res.status(400).json({ error: 'Faltan provider, username o password.' });
        }
        var params = new URLSearchParams();
        params.set('provider', b.provider);
        params.set('username', b.username);
        params.set('password', b.password);
        if (b.type) params.set('type', b.type);
        if (b.otp)  params.set('otp', b.otp);
        var data = await prometeoFetch('/login/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        res.json(data);
    } catch (e) {
        if (e.faltanCreds) return res.status(500).json({ error: e.message });
        res.status(e.status || 500).json({ error: e.message, detalle: e.data });
    }
});

// Cuentas de la sesión. GET /prometeo/accounts?key=<session>
app.get('/prometeo/accounts', async (req, res) => {
    try {
        var key = req.query.key;
        if (!key) return res.status(400).json({ error: 'Falta el parámetro key (sesión).' });
        var data = await prometeoFetch('/account/?key=' + encodeURIComponent(key));
        res.json(data);
    } catch (e) {
        if (e.faltanCreds) return res.status(500).json({ error: e.message });
        res.status(e.status || 500).json({ error: e.message, detalle: e.data });
    }
});

// Movimientos. GET /prometeo/movements?key=&account=&currency=&date_start=&date_end=
// Fechas en formato DD/MM/YYYY (lo que pide Prometeo).
app.get('/prometeo/movements', async (req, res) => {
    try {
        var key = req.query.key, account = req.query.account;
        if (!key || !account) return res.status(400).json({ error: 'Faltan key y/o account.' });
        var qs = '?key=' + encodeURIComponent(key) +
            '&currency=' + encodeURIComponent(req.query.currency || 'ARS') +
            '&date_start=' + encodeURIComponent(req.query.date_start || '') +
            '&date_end=' + encodeURIComponent(req.query.date_end || '');
        var data = await prometeoFetch('/account/' + encodeURIComponent(account) + '/movement/' + qs);
        res.json(data);
    } catch (e) {
        if (e.faltanCreds) return res.status(500).json({ error: e.message });
        res.status(e.status || 500).json({ error: e.message, detalle: e.data });
    }
});

// Cierra la sesión del banco. GET /prometeo/logout?key=<session>
app.get('/prometeo/logout', async (req, res) => {
    try {
        var key = req.query.key;
        if (!key) return res.status(400).json({ error: 'Falta el parámetro key.' });
        var data = await prometeoFetch('/logout/?key=' + encodeURIComponent(key));
        res.json(data);
    } catch (e) {
        if (e.faltanCreds) return res.status(500).json({ error: e.message });
        res.status(e.status || 500).json({ error: e.message, detalle: e.data });
    }
});

// ═══════════════════════════════════════════════════════════════════
//  WHATSAPP — Asistente CISEB por WhatsApp (WhatsApp Business Cloud API de Meta)
//  Variables de entorno:
//    WHATSAPP_TOKEN            → access token permanente de la app de Meta
//    WHATSAPP_PHONE_NUMBER_ID  → ID del número de teléfono (Meta for Developers)
//    WHATSAPP_VERIFY_TOKEN     → string que vos elegís, para el handshake del webhook
//    GEMINI_API_KEY            → API key de Gemini, para que el asistente responda solo
// ═══════════════════════════════════════════════════════════════════

// Envía un mensaje de texto por WhatsApp. Se usa tanto para responder mensajes
// entrantes como para avisos que dispare la app (ej. "avisame cuando venza una factura").
async function whatsappEnviarMensaje(to, texto) {
    const token   = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
        const err = new Error('Faltan credenciales de WhatsApp. Configurá WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID en Railway.');
        err.faltanCreds = true;
        throw err;
    }
    const resp = await fetch('https://graph.facebook.com/v20.0/' + phoneId + '/messages', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: String(to),
            type: 'text',
            text: { body: String(texto || '').slice(0, 4096) } // WhatsApp corta mensajes más largos
        })
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const err = new Error('WhatsApp API respondió HTTP ' + resp.status);
        err.data = json;
        throw err;
    }
    return json;
}

// Genera la respuesta del asistente con Gemini. Sin acceso a los datos de la app
// (facturas, proveedores, etc.) — eso queda para una vuelta siguiente si hace falta.
async function whatsappGenerarRespuesta(textoUsuario) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return '⚠️ El asistente todavía no está configurado del lado del servidor (falta GEMINI_API_KEY en Railway).';
    const systemPrompt = 'Sos el Asistente CISEB, el mismo asistente de la app "CISEB · Sistema de Gestión Odontológica", ahora respondiendo por WhatsApp. '
        + 'Respondé en español argentino, de forma clara y breve (es un chat de WhatsApp: evitá formato markdown pesado, tablas o listas largas). '
        + 'Si te preguntan algo puntual sobre los datos cargados en la app (facturas, proveedores, pacientes, turnos, saldos, etc.) explicá que '
        + 'por WhatsApp todavía no tenés acceso a esos datos en tiempo real, y sugerí consultarlo desde el Asistente CISEB dentro de la app. '
        + 'Para cualquier otra pregunta (general, cálculos, consejos, etc.) respondé con solvencia, como asistente de uso general.';
    try {
        const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: textoUsuario }] }],
                generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
            })
        });
        const data = await resp.json().catch(() => ({}));
        const texto = data.candidates && data.candidates[0] && data.candidates[0].content &&
            data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
        return (texto && texto.trim()) || 'No pude generar una respuesta, probá de nuevo en un momento.';
    } catch (e) {
        return '⚠️ Error al conectar con Gemini: ' + (e.message || e);
    }
}

// Diagnóstico: confirma qué credenciales están cargadas.
app.get('/whatsapp/diag', (req, res) => {
    const tokenCargado       = !!process.env.WHATSAPP_TOKEN;
    const phoneIdCargado     = !!process.env.WHATSAPP_PHONE_NUMBER_ID;
    const verifyTokenCargado = !!process.env.WHATSAPP_VERIFY_TOKEN;
    const geminiKeyCargada   = !!process.env.GEMINI_API_KEY;
    res.json({
        ok: true,
        tokenCargado, phoneIdCargado, verifyTokenCargado, geminiKeyCargada,
        listoParaUsar: tokenCargado && phoneIdCargado && verifyTokenCargado
    });
});

// Handshake de verificación que pide Meta al registrar la URL del webhook.
app.get('/whatsapp/webhook', (req, res) => {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

// Recibe los mensajes entrantes de WhatsApp y responde con Gemini.
// Se responde 200 enseguida (Meta reintenta si no recibe respuesta rápido) y se
// procesa/envía la respuesta después, sin bloquear el webhook.
app.post('/whatsapp/webhook', (req, res) => {
    res.sendStatus(200);
    (async () => {
        try {
            const entry  = req.body && req.body.entry && req.body.entry[0];
            const change = entry && entry.changes && entry.changes[0];
            const value  = change && change.value;
            const msg    = value && value.messages && value.messages[0];
            if (!msg || msg.type !== 'text') return; // ignora confirmaciones de entrega, no-texto, etc.
            const texto = (msg.text && msg.text.body || '').trim();
            if (!texto) return;
            const respuesta = await whatsappGenerarRespuesta(texto);
            await whatsappEnviarMensaje(msg.from, respuesta);
        } catch (e) {
            console.error('[WhatsApp webhook] error:', e.message);
        }
    })();
});

// Envío manual/disparado por la app (ej. futuros avisos de vencimientos).
// POST /whatsapp/send  body: { "to": "5491122334455", "mensaje": "..." }
app.post('/whatsapp/send', async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.to || !b.mensaje) return res.status(400).json({ error: 'Faltan to y/o mensaje.' });
        const data = await whatsappEnviarMensaje(b.to, b.mensaje);
        res.json({ ok: true, data });
    } catch (e) {
        if (e.faltanCreds) return res.status(500).json({ error: e.message });
        res.status(500).json({ error: e.message, detalle: e.data });
    }
});

// ═══════════════════════════════════════════════════════════════════
//  MAIL BOT — Asistente CISEB por email (recibir por IMAP, responder por SMTP)
//  Le mandás un mail a la casilla del asistente y te responde solo con Gemini.
//  Variables de entorno:
//    MAIL_BOT_USER          → dirección Gmail dedicada del asistente (ej. asistente.ciseb@gmail.com)
//    MAIL_BOT_APP_PASSWORD  → "contraseña de aplicación" de Google (NO la contraseña normal)
//    MAIL_BOT_ALLOWED       → (opcional) mails autorizados a usarlo, separados por coma.
//                             Si se deja vacío, responde a cualquiera (no recomendado).
//    GEMINI_API_KEY         → API key de Gemini (la misma que WhatsApp)
//  Nota: en Gmail hay que activar la verificación en 2 pasos y generar una
//  "contraseña de aplicación" (https://myaccount.google.com/apppasswords). IMAP
//  viene habilitado por defecto en Gmail.
// ═══════════════════════════════════════════════════════════════════

function mailBotConfigurado() {
    return !!(process.env.MAIL_BOT_USER && process.env.MAIL_BOT_APP_PASSWORD);
}

// Genera la respuesta del asistente para un mail entrante.
async function mailGenerarRespuesta(asunto, cuerpo) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return 'El asistente todavía no está configurado del lado del servidor (falta GEMINI_API_KEY en Railway).';
    const systemPrompt = 'Sos el Asistente CISEB, el mismo asistente de la app "CISEB · Sistema de Gestión Odontológica", respondiendo por email. '
        + 'Respondé en español argentino, claro y cordial, con el largo que amerite la consulta. Es un mail, podés usar párrafos pero evitá markdown pesado. '
        + 'Si te preguntan por datos puntuales cargados en la app (facturas, proveedores, pacientes, turnos, saldos, etc.) aclarás que por mail todavía no tenés acceso a esos datos en tiempo real, y sugerís consultarlo desde el Asistente CISEB dentro de la app. '
        + 'Para cualquier otra consulta (general, cálculos, redacción, consejos) respondé con solvencia. Cerrá el mail con una firma breve tipo "— Asistente CISEB".';
    const entrada = 'Asunto: ' + (asunto || '(sin asunto)') + '\n\nMensaje:\n' + (cuerpo || '');
    try {
        const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: entrada }] }],
                generationConfig: { maxOutputTokens: 1500, temperature: 0.7 }
            })
        });
        const data = await resp.json().catch(() => ({}));
        const texto = data.candidates && data.candidates[0] && data.candidates[0].content &&
            data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
        return (texto && texto.trim()) || 'No pude generar una respuesta, probá de nuevo en un momento.\n\n— Asistente CISEB';
    } catch (e) {
        return 'Tuve un problema al procesar tu consulta (' + (e.message || e) + '). Probá de nuevo más tarde.\n\n— Asistente CISEB';
    }
}

let _mailBotCorriendo = false;

// Revisa la casilla por mails sin leer y responde cada uno. Devuelve cuántos procesó.
async function mailBotRevisar() {
    if (!mailBotConfigurado()) { const e = new Error('Faltan MAIL_BOT_USER y MAIL_BOT_APP_PASSWORD en Railway.'); e.faltanCreds = true; throw e; }
    if (_mailBotCorriendo) return { yaCorriendo: true, procesados: 0 };
    _mailBotCorriendo = true;

    const { ImapFlow }   = require('imapflow');
    const { simpleParser } = require('mailparser');
    const nodemailer     = require('nodemailer');

    const user = process.env.MAIL_BOT_USER;
    const pass = process.env.MAIL_BOT_APP_PASSWORD;
    const permitidos = (process.env.MAIL_BOT_ALLOWED || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
    const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });

    let procesados = 0, respondidos = 0;
    try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
            // Solo los no leídos
            for await (const msg of client.fetch({ seen: false }, { source: true })) {
                procesados++;
                let parsed;
                try { parsed = await simpleParser(msg.source); } catch (_) { parsed = null; }
                await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true }); // marcar leído para no reprocesar

                if (!parsed) continue;
                const from = (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address || '').toLowerCase();
                if (!from || from === user.toLowerCase()) continue;               // evitar loops con uno mismo
                if (permitidos.length && permitidos.indexOf(from) === -1) continue; // no autorizado: ignorar

                const asunto = parsed.subject || '';
                const cuerpo = parsed.text || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, ' ') : '');
                const respuesta = await mailGenerarRespuesta(asunto, cuerpo);

                await transporter.sendMail({
                    from: '"Asistente CISEB" <' + user + '>',
                    to: from,
                    subject: /^re:/i.test(asunto) ? asunto : ('Re: ' + (asunto || 'tu consulta')),
                    text: respuesta,
                    inReplyTo: parsed.messageId || undefined,
                    references: parsed.messageId || undefined
                });
                respondidos++;
            }
        } finally {
            lock.release();
        }
        await client.logout();
    } catch (e) {
        try { await client.logout(); } catch (_) {}
        _mailBotCorriendo = false;
        throw e;
    }
    _mailBotCorriendo = false;
    return { procesados, respondidos };
}

// Diagnóstico
app.get('/mail/diag', (req, res) => {
    res.json({
        ok: true,
        userCargado: !!process.env.MAIL_BOT_USER,
        appPasswordCargada: !!process.env.MAIL_BOT_APP_PASSWORD,
        geminiKeyCargada: !!process.env.GEMINI_API_KEY,
        permitidos: (process.env.MAIL_BOT_ALLOWED || '').split(',').map(s => s.trim()).filter(Boolean),
        listoParaUsar: mailBotConfigurado() && !!process.env.GEMINI_API_KEY
    });
});

// Extrae el motivo real de un error de imapflow/nodemailer (la librería suele tirar
// mensajes genéricos como "Command failed" y guardar el detalle en otras propiedades).
function detalleErrorMail(e) {
    var partes = [];
    if (e.authenticationFailed) partes.push('Falló la autenticación con Gmail (usuario/contraseña de aplicación incorrectos, o falta habilitar IMAP).');
    if (e.responseText) partes.push('Respuesta del servidor: ' + e.responseText);
    if (e.response && typeof e.response === 'string') partes.push('Respuesta: ' + e.response);
    if (e.serverResponseCode) partes.push('Código: ' + e.serverResponseCode);
    if (e.code) partes.push('Code: ' + e.code);
    if (e.command) partes.push('Comando: ' + e.command);
    return partes.join(' | ');
}

// Disparo manual (además del automático por intervalo).
app.get('/mail/revisar', async (req, res) => {
    try {
        const r = await mailBotRevisar();
        res.json({ ok: true, ...r });
    } catch (e) {
        res.status(e.faltanCreds ? 400 : 500).json({ error: e.message, detalle: detalleErrorMail(e), faltanCreds: !!e.faltanCreds });
    }
});

// Revisión automática cada 2 minutos (solo si está configurado).
if (mailBotConfigurado()) {
    setInterval(function () {
        mailBotRevisar().then(function (r) {
            if (r && r.respondidos) console.log('[MailBot] respondió ' + r.respondidos + ' mail(s).');
        }).catch(function (e) {
            console.error('[MailBot] error:', e.message);
        });
    }, 120000);
    console.log('[MailBot] activo: revisando la casilla cada 2 minutos.');
}

// ═══════════════════════════════════════════════════════════════════
//  USUARIOS — Gestión de usuarios de Firebase Auth desde la app
//  Requiere Firebase Admin SDK (FIREBASE_SERVICE_ACCOUNT_BASE64 en Railway).
// ═══════════════════════════════════════════════════════════════════
function requireAdmin(res) {
    if (!admin.apps.length) {
        res.status(500).json({ error: 'Firebase Admin no está inicializado. Configurá FIREBASE_SERVICE_ACCOUNT_BASE64 en Railway.' });
        return false;
    }
    return true;
}

// ═══════════════════════════════════════════════════════════════════
//  GEMINI PROXY — para que la API key no se exponga en el frontend
//  El frontend manda el body completo de Gemini y el modelo; el backend
//  agrega la key y reenvía. Así la key vive solo en el servidor.
// ═══════════════════════════════════════════════════════════════════
app.post('/gemini', async (req, res) => {
    var apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY no está configurada en el servidor.' });
    var model = req.body.model || 'gemini-2.5-flash';
    var geminiBody = req.body.body;
    if (!geminiBody) return res.status(400).json({ error: 'Falta body con el request de Gemini.' });
    try {
        var resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody)
        });
        var data = await resp.json().catch(function() { return {}; });
        if (!resp.ok) return res.status(resp.status).json(data);
        return res.json(data);
    } catch (e) {
        return res.status(502).json({ error: 'Error al conectar con Gemini: ' + e.message });
    }
});

app.get('/usuarios/listar', async (req, res) => {
    if (!requireAdmin(res)) return;
    try {
        var result = await admin.auth().listUsers(1000);
        var dbRoles = await admin.database().ref('roles').once('value');
        var rolesMap = dbRoles.val() || {};
        var users = result.users.map(function(u) {
            return {
                uid: u.uid,
                email: u.email || '',
                displayName: u.displayName || '',
                disabled: u.disabled,
                createdAt: u.metadata.creationTime,
                lastLogin: u.metadata.lastSignInTime,
                rol: rolesMap[u.uid] || 'sin rol'
            };
        });
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/usuarios/crear', async (req, res) => {
    if (!requireAdmin(res)) return;
    try {
        var b = req.body || {};
        if (!b.email || !b.password) return res.status(400).json({ error: 'Faltan email y/o password.' });
        if (b.password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
        var user = await admin.auth().createUser({
            email: b.email,
            password: b.password,
            displayName: b.displayName || '',
            disabled: false
        });
        if (b.rol) {
            await admin.database().ref('roles/' + user.uid).set(b.rol);
        }
        res.json({ ok: true, uid: user.uid, email: user.email });
    } catch (e) {
        res.status(e.code === 'auth/email-already-exists' ? 409 : 500).json({ error: e.message });
    }
});

app.post('/usuarios/eliminar', async (req, res) => {
    if (!requireAdmin(res)) return;
    try {
        var b = req.body || {};
        if (!b.uid) return res.status(400).json({ error: 'Falta uid.' });
        await admin.auth().deleteUser(b.uid);
        await admin.database().ref('roles/' + b.uid).remove();
        await admin.database().ref('usuarios/' + b.uid).remove();
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/usuarios/deshabilitar', async (req, res) => {
    if (!requireAdmin(res)) return;
    try {
        var b = req.body || {};
        if (!b.uid) return res.status(400).json({ error: 'Falta uid.' });
        var disabled = b.disabled !== false;
        await admin.auth().updateUser(b.uid, { disabled: disabled });
        res.json({ ok: true, disabled: disabled });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/usuarios/rol', async (req, res) => {
    if (!requireAdmin(res)) return;
    try {
        var b = req.body || {};
        if (!b.uid || !b.rol) return res.status(400).json({ error: 'Faltan uid y/o rol.' });
        var validos = ['superadmin', 'admin', 'editor', 'lector'];
        if (validos.indexOf(b.rol) === -1) return res.status(400).json({ error: 'Rol inválido. Opciones: ' + validos.join(', ') });
        await admin.database().ref('roles/' + b.uid).set(b.rol);
        res.json({ ok: true, uid: b.uid, rol: b.rol });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/usuarios/reset-password', async (req, res) => {
    if (!requireAdmin(res)) return;
    try {
        var b = req.body || {};
        if (!b.uid || !b.password) return res.status(400).json({ error: 'Faltan uid y/o password.' });
        if (b.password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
        await admin.auth().updateUser(b.uid, { password: b.password });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CISEB Backend (AFIP + Belvo + Prometeo + WhatsApp + MailBot) corriendo en puerto ${PORT}`));
