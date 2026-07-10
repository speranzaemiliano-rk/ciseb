const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const cors      = require('cors')({ origin: true });
const Afip      = require('@afipsdk/afip.js');

admin.initializeApp();

// Lee el certificado y clave privada desde Firebase Functions Config
// Configurar con:
//   firebase functions:config:set afip.cuit="20XXXXXXXXX" afip.cert="<contenido cert.crt>" afip.key="<contenido clave.key>" afip.env="production"
exports.afip = functions.https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }
        try {
            const config = functions.config().afip || {};
            const cuit = config.cuit;
            const cert = (config.cert || '').replace(/\\n/g, '\n');
            const key  = (config.key  || '').replace(/\\n/g, '\n');
            const env  = config.env || 'testing'; // 'testing' o 'production'

            if (!cuit || !cert || !key) {
                return res.status(500).json({
                    error: 'Faltan credenciales AFIP. Configurá firebase functions:config:set afip.cuit afip.cert afip.key'
                });
            }

            const afip = new Afip({ CUIT: cuit, cert, key, production: env === 'production' });

            const {
                tipoComp, ptoVta, concepto, fecha, moneda,
                cuitRecep, condIva, razon, dom,
                impNeto, impIVA, impTotal, alicId, descripcion
            } = req.body;

            // Obtener último comprobante para calcular número
            const ultimoCbte = await afip.ElectronicBilling.getLastVoucher(ptoVta, tipoComp);
            const nroCbte    = ultimoCbte + 1;

            // Armar alícuotas de IVA
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
                DocTipo:    80, // CUIT
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
                Iva: alicuotas.length ? { AlicIva: alicuotas } : null
            };

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
            return res.status(500).json({ error: e.message || String(e) });
        }
    });
});
