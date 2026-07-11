# CLAUDE.md

Contexto técnico del proyecto para asistentes de IA (Claude Code). Para el
**marco de producto** (visión, posicionamiento, roadmap, estado actual vs.
objetivo) ver `docs/MARCO-PRODUCTO.md` — leerlo antes de planificar features
nuevas. Idioma de UI, comentarios y commits: **español (Argentina)**.

## Qué es

**CISEB · Centro Integral de Salud y Estética Bucal** — PWA de gestión para un
consultorio odontológico: pacientes, turnos, profesionales (con reparto de
honorarios), tratamientos, estudios/PDFs por paciente, y toda la gestión
administrativa/contable (caja, bancos, ingresos, egresos, proveedores,
presupuestos, **facturación electrónica ARCA**). Adaptado a partir de un sistema
administrativo del rubro inmobiliario, por eso convive funcionalidad
administrativa madura con módulos clínicos incipientes (ver el §6 del marco).

> ⚠️ **Encuadre importante:** este repo hoy es una base administrativa + clínica
> liviana. El núcleo clínico que define al producto (evolución estructurada →
> odontograma → cobro → liquidación, consentimientos, planes por etapas) **aún no
> está construido**. No confundir lo que la app hace con lo que el producto será:
> la verdad del estado está en la tabla del §6 de `docs/MARCO-PRODUCTO.md`.

## Arquitectura (3 piezas)

1. **Frontend** — `index.html` (~21.700 líneas). **JavaScript vanilla, SIN
   framework ni build.** HTML + CSS + JS embebidos en un solo archivo. Librerías
   por CDN (Firebase 10.12.2 compat, Chart.js, SheetJS/xlsx, SortableJS, pdf.js,
   EmailJS, Google Identity Services).
2. **Firebase** (proyecto `rkseguimientode-pagos`) — Auth (email/password +
   Google), **Realtime Database** y **Storage** (para estudios/PDFs de pacientes).
3. **Backend** — `functions/server.js`: Express sobre Node, desplegable en
   **Railway**. Concentra lo que no puede ir en el navegador: emisión ARCA
   (`@afipsdk/afip.js`), open banking (Belvo/Prometeo), bot de WhatsApp y bot de
   mail. La URL se guarda en `localStorage ciseb_afip_function_url`.
   `functions/index.js` es la variante Cloud Functions (solo ARCA); el backend
   **activo** es `server.js`.

## Convenciones de código (importante al editar)

- **NO hay paso de build.** Se edita `index.html` directo. Es grande: usar grep
  para ubicar funciones, no leerlo entero.
- Estilo: **ES5/ES6 mezclado**, mayormente `var`/`function`, comillas simples,
  comentarios en español.
- La UI se arma con **template strings** que escriben HTML (`innerHTML`); escapar
  datos con `escHtml()`. Fechas con `formatearFecha()`.
- Navegación por tabs: `mostrarTab('<Nombre>')`. El dispatcher tiene un objeto
  `map` de renderers, una lista de tabs válidos, títulos de página, y grupos como
  `SUB_CONSULTORIO`. Al agregar un tab hay que tocar todos esos lugares.
- Sidebar reordenable por arrastre (**solo superadmin**, sincronizado por
  Firebase): cada concepto es un `.nav-block`/`.sub-block` con `data-navkey`;
  los submenús están en `SUBMENU_IDS`. Al agregar ítems al menú, seguir ese
  patrón (envolver + `data-navkey` + `<span class="nav-drag-handle">⠿</span>`).
- Patrón de módulo (plantilla: **Pacientes**): `let REF_X=null; let x=[];` →
  se asigna en `actualizarRefsIngresos()` → se carga reactivo en
  `cargarDatosIngresos()` con `_cargarConListener` → se persiste con
  `REF_X.set(x)`. Modales `<div class="modal" id="modalX">` abren/cierran con
  `.classList.add/remove('active')`. Paneles `<div class="tab-panel" id="panelX">`.
  Botón eliminar vía `btnElim('tipo', idx)` (respeta permisos).

## Modelo de datos (Realtime Database)

Ruta base por proyecto activo: `getBasePath()` → `empresas/<empresaId>/proyectos/<proyectoId>`.

**Clínico/consultorio** (por proyecto): `/pacientes`, `/turnos`, `/listaEspera`,
`/profesionales`, `/servicios` (catálogo de "Tratamientos"), `/estudios/<pacienteId>/...`
(en Storage).
- **Paciente**: nombre, dni, fechaNacimiento, telefono, email, obraSocial,
  nroAfiliado, direccion, notas, `profesionalId`, `estudios[]`, `id`.
- **Profesional**: `id`, nombre, especialidad, matricula, contacto, `comisionGeneral`
  (% que deja al consultorio) y `tratamientos[]` (cada uno con `porcentaje` override
  opcional). ⚠️ hoy el reparto es hacia **un solo destino**, no el modelo de
  **beneficiarios múltiples** (socios + fondo común) que exige el marco.
- **Turno**: `id`, fecha, hora, `duracionMin`, `horaFin` (calculado), paciente
  (texto) + `pacienteId` (FK resuelta por nombre), profesional (texto) +
  `profesionalId` (FK), `prestacionId` (opcional, catálogo), motivo, estado
  (Pendiente/Confirmado/Atendido/Cancelado/Ausente), `creadoEn`/`actualizadoEn`.
  Detecta solapamiento de horario por profesional (`_turDetectarConflicto`),
  con aviso no bloqueante. Al cancelar, sugiere candidatos de `/listaEspera`.
- **ListaEspera**: `id`, paciente + `pacienteId`, profesional preferido (opcional)
  + `profesionalId`, `prestacionId` opcional, motivo, disponibilidad (texto libre),
  prioridad (Normal/Urgente), notas, estado (Esperando/Contactado/Agendado/Descartado),
  `creadoEn`. El sistema solo **sugiere** candidatos ante una cancelación de turno;
  el humano decide y confirma.

**Administrativo/contable** (por proyecto, heredado y genérico): `/datos`,
`/indiceCAC`, `/documentos`, `/tipoCambio`, `/facturas`, `/caja`, `/ingresos`,
`/banco`, `/ingGeneral`, `/planTrabajo`, `/comprobantesEmitidos`, `/remuneraciones`.

**Globales** (compartidos): `empresas`, `global/proveedores`, `global/grupos`,
`roles`, `usuarios`, `solicitudesBorrado`, `global/config/*`.

> El marco pide separar lo clínico de lo administrativo (frontera del SGSI). Hoy
> **conviven en la misma base**: es deuda de diseño conocida, ver §5 del marco.

## Roles y permisos

Roles en `roles/<uid>`: `superadmin`, `admin`, `editor`, `lector`. Flags JS:
`esSuperAdmin`, `esAdmin`, `puedeEditar`. **Hoy se aplican SOLO en el cliente.**
El primer usuario / `ADMIN_EMAIL` se autoasigna `superadmin` (hay una regla de
bootstrap en `database.rules.json` que permite ese primer alta y luego se cierra).

⚠️ **Seguridad:** la seguridad real depende de las reglas de Firebase
(`database.rules.json`). El objetivo del producto es RBAC efectivo + SSO de
Workspace (ver marco §5), aún no implementado.

## Integraciones

ARCA/AFIP (`@afipsdk/afip.js`), Belvo/Prometeo (open banking), Google Gemini
(asistente interno con *context injection* de los datos de la app; ⚠️ sin el
scoping por permisos ni el logging de consultas que el SGIA exige para uso
clínico), EmailJS, Firebase Storage (estudios de pacientes), WhatsApp Business
Cloud API (backend listo, falta credenciales).

**Recordatorios de turno (Fase 2 — Agenda):** `functions/server.js` revisa cada
30 min (y a demanda vía `GET /turnos/recordatorios`) los turnos de **todas** las
empresas/proyectos que caen entre 20h y 28h desde ahora, y les manda un mail de
recordatorio al paciente (reusa las credenciales del Mail Bot, `MAIL_BOT_*`) con
un link de confirmación de un solo uso (`GET /turnos/confirmar`, protegido por el
`tokenConfirmacion` propio de cada turno — no por `X-App-Token`, ver
`_RUTAS_SIN_TOKEN`). Requiere Firebase Admin activo (`FIREBASE_SERVICE_ACCOUNT_BASE64`)
y que el paciente tenga `email` cargado. Diagnóstico: `GET /turnos/diag`.

## Config del entorno del centro (a completar en cada instalación)

- `firebaseConfig` en `index.html` (bloque cerca del `<head>`): apunta al proyecto
  Firebase del centro. Placeholder de arranque usa el string `PEGAR` para
  disparar el aviso "Falta configurar Firebase".
- `.firebaserc` / `functions/server.js`: `databaseURL` y projectId del centro.
- **Firebase Storage** debe habilitarse en la consola del proyecto + cargar reglas
  de Storage para que la subida de estudios funcione (el código tolera que no esté
  habilitado: avisa sin romper).
- Backend en Railway con sus env vars (`AFIP_*`, `BELVO_*`, `PROMETEO_*`,
  `WHATSAPP_*`, `GEMINI_API_KEY`, `MAIL_BOT_*`, `PORT`, `BACKEND_PUBLIC_URL`
  opcional — URL pública del backend, para armar el link de confirmación de
  turno en el mail de recordatorio; sin esto el mail sale sin ese link).

## PWA / Despliegue

- Frontend estático (GitHub Pages, scope `/ciseb/`). `manifest.json` + `sw.js`
  (caché `ciseb-vN`, network-first para `index.html`, no cachea Firebase/Railway).
  Íconos y logo (isotipo de 5 pétalos) en `icons/` y `assets/`.
- Backend: `cd functions && npm install && npm start`.

## Al trabajar acá

- Cambios de **frontend** → `index.html` (grep para ubicar).
- Cambios de **backend** → `functions/server.js`.
- **No commitear secretos.** Credenciales en env vars de Railway / config de
  Firebase, no en el repo. (La `apiKey` de Firebase web es pública por diseño y sí
  vive en el HTML; no es un secreto de servidor.)
- No hay tests automatizados ni linter. Verificación mínima de sintaxis del HTML:
  extraer los bloques `<script>` sin `src` y pasarlos por `new Function(...)`.
- **Antes de planificar features nuevas, leer `docs/MARCO-PRODUCTO.md`.** El
  próximo salto de valor es el núcleo clínico, no pulir lo administrativo.
