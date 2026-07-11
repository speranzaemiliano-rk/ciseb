# CISEB — Guía para levantar una instancia nueva

> Este documento es para cuando haya que instalar CISEB en un centro
> **distinto** al piloto (o para reinstalar el piloto desde cero). El código
> —`index.html`, `functions/server.js`, reglas, etc.— es el **mismo** para
> todas las instalaciones. Lo único que cambia por instalación es:
>
> - `config.js` (frontend): credenciales del proyecto de Firebase + email del
>   primer superadmin.
> - Variables de entorno del backend en Railway.
> - Las reglas de seguridad (`database.rules.json`, `storage.rules`),
>   deployadas al proyecto de Firebase de esa instalación.
>
> Nada de esto requiere tocar `index.html` ni `functions/server.js`.

## 1. Crear el proyecto de Firebase

1. [Firebase Console](https://console.firebase.google.com/) → **Crear proyecto**.
2. Habilitar **Authentication** → método **Email/contraseña** y **Google**.
3. Habilitar **Realtime Database** (no Firestore — este proyecto usa RTDB).
   Elegir la región más cercana al centro.
4. Habilitar **Storage** (para los estudios/PDFs de pacientes).
5. ⚙️ Configuración del proyecto → "Tus apps" → agregar una **app web** →
   copiar el bloque de configuración del SDK (`apiKey`, `authDomain`, etc.).

## 2. Configurar el frontend (`config.js`)

```bash
cp config.example.js config.js
```

Completar `config.js` con:
- Los valores de Firebase del paso 1.
- `adminEmail`: esta cuenta **siempre** tiene rol `superadmin` (se re-chequea
  en cada login, no solo el primero). Además, `database.rules.json` permite
  que cualquier usuario se auto-asigne un rol la primera vez, mientras el
  nodo `roles` esté completamente vacío — eso sí se cierra solo apenas existe
  un rol asignado (el de `adminEmail`, típicamente).
- `dominioWorkspace` (opcional): si el centro usa Google Workspace, el
  dominio (ej. `"miclinica.com.ar"`) para restringir el botón "Continuar con
  Google" a esas cuentas. Dejar `""` si no aplica.

No hace falta tocar nada más de `index.html`.

### Login con Google — paso manual adicional en Firebase Console

Además de habilitar **Google** como proveedor (paso 1.2), agregar el dominio
donde se sirve el frontend (ej. `tuusuario.github.io`, o el dominio propio si
usás uno) en **Authentication → Settings → Authorized domains** — sin esto
`signInWithPopup` falla con `auth/unauthorized-domain`.

## 3. Deployar las reglas de seguridad

Con el [Firebase CLI](https://firebase.google.com/docs/cli) autenticado y
apuntando al proyecto nuevo (`firebase use --add`):

```bash
firebase deploy --only database   # database.rules.json
```

`storage.rules` **no está conectado a `firebase.json` todavía** — es un
borrador (ver el propio archivo para el motivo). Antes de conectarlo y
correr `firebase deploy --only storage`, revisar que las reglas se ajusten
a lo que necesita esta instalación puntual.

## 4. Backend en Railway

1. Crear un proyecto nuevo en [Railway](https://railway.app/) apuntando a
   este repo (o un fork), con **root directory** `functions/`.
2. Cargar las variables de entorno (ver tabla abajo). Como mínimo para que
   arranque: `PORT` (Railway lo setea solo).
3. Para habilitar cada integración, cargar sus variables — todas son
   opcionales de a una; lo que falte queda deshabilitado con un aviso claro
   en los endpoints `/diag` correspondientes (`/diag`, `/belvo/diag`,
   `/prometeo/diag`, `/whatsapp/diag`, `/mail/diag`, `/turnos/diag`,
   `/estudios/diag`).
4. Una vez desplegado, copiar la URL pública de Railway (`https://algo.up.railway.app`)
   y cargarla en la app: ⚙️ Ajustes → URL del backend (se guarda en
   `localStorage`, no en `config.js` — es por dispositivo/usuario, no por
   instalación, para poder apuntar a un backend de prueba sin editar código).

### Variables de entorno del backend

| Variable | Para qué | Obligatoria |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | Admin SDK (Storage, RTDB privilegiado, gestión de usuarios). Generarla en Firebase Console → Cuentas de servicio → Generar nueva clave privada → `base64 -w0 archivo.json`. | Para signed URLs, recordatorios de turno, gestión de usuarios |
| `FIREBASE_DATABASE_URL` | URL de Realtime Database de **esta** instalación (`databaseURL` del paso 1). | Sí, si usás Admin SDK — si no se carga, cae a la del proyecto original (rompe una instalación nueva) |
| `FIREBASE_STORAGE_BUCKET` | Bucket de Storage de esta instalación (`storageBucket` del paso 1). | Sí, para el portal de signed URLs |
| `BACKEND_PUBLIC_URL` | URL pública de este mismo backend en Railway, para armar el link de confirmación de turno en el mail de recordatorio. | Para confirmación automática de turnos |
| `APP_API_TOKEN` | Secreto compartido entre la app y el backend (header `X-App-Token`). Sin esto, el backend acepta pedidos sin autenticar (avisa en el log). | Recomendada para producción |
| `AFIP_CUIT`, `AFIP_CERT`, `AFIP_KEY`, `AFIP_ENV` | Facturación electrónica ARCA/AFIP. | Si el centro factura |
| `BELVO_SECRET_ID`, `BELVO_SECRET_PASSWORD`, `BELVO_ENV` | Open banking (Belvo no cubre Argentina — dejar sin cargar si no aplica). | No |
| `PROMETEO_API_KEY`, `PROMETEO_ENV` | Open banking Argentina (Plan B a Belvo). | No |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` | Asistente por WhatsApp. | No |
| `GEMINI_API_KEY` | Asistente IA (chat interno + WhatsApp/mail). | Sí, si se usa el asistente |
| `MAIL_BOT_USER`, `MAIL_BOT_APP_PASSWORD`, `MAIL_BOT_ALLOWED` | Bot de mail + recordatorios de turno por mail (reutiliza esta misma casilla). | Para recordatorios 24h |

## 5. Primer login y datos base

1. Abrir la app (GitHub Pages / hosting elegido) y registrarse con el
   `adminEmail` configurado — se autoasigna `superadmin`.
2. Dar de alta la primera empresa/proyecto (⚙️ Ajustes o el flujo de
   onboarding inicial).
3. Cargar profesionales, prestaciones (catálogo clínico) y el texto de
   consentimiento informado (⚙️ Ajustes — el default es un **modelo**, no
   validado legalmente, reemplazar antes de usar en producción real).

## 6. Branding (opcional, manual)

El nombre "CISEB", el isotipo de 5 pétalos y la paleta de colores están
hardcodeados en `index.html`/`manifest.json`/`icons/` — son identidad visual
específica de esta marca, no se generan desde `config.js`. Para un centro
con marca propia: reemplazar `icons/icon-192.png` / `icon-512.png`, y un
buscar-y-reemplazar de "CISEB" por el nombre del centro en `index.html`,
`manifest.json` y `sw.js` (nombre del cache).

## Qué queda manual (no se puede scriptear desde acá)

Crear el proyecto de Firebase, el proyecto de Railway y configurar el
hosting del frontend requieren las cuentas propias de cada centro (Google
Cloud / Firebase / Railway / GitHub) — no hay forma de automatizar esto sin
esas credenciales. Esta guía es el checklist para hacerlo a mano; no hay
(todavía) un script de un solo comando que cree los recursos de nube.
