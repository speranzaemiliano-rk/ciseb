// Plantilla de configuración para una instancia NUEVA de CISEB.
//
// Copiá este archivo como `config.js` (mismo directorio) y completá los
// valores con los de tu propio proyecto de Firebase. `index.html` no se toca
// para nada — es el mismo código base para todas las instalaciones.
//
// Dónde sacar cada valor: Firebase Console → ⚙️ Configuración del proyecto →
// "Tus apps" → app web → "Configuración del SDK". Ver docs/INSTALL.md para
// la guía completa paso a paso (crear el proyecto, habilitar Auth/Realtime
// Database/Storage, desplegar las reglas, etc.).
window.CISEB_CONFIG = {
    firebase: {
        apiKey: "PEGAR-API-KEY",
        authDomain: "PEGAR-PROYECTO.firebaseapp.com",
        databaseURL: "https://PEGAR-PROYECTO-default-rtdb.firebaseio.com",
        projectId: "PEGAR-PROYECTO",
        storageBucket: "PEGAR-PROYECTO.firebasestorage.app",
        messagingSenderId: "PEGAR-SENDER-ID",
        appId: "PEGAR-APP-ID"
    },
    // Este email siempre tiene rol 'superadmin' (se autoasigna en cada login).
    adminEmail: "PEGAR-tu-email@dominio.com",
    // Si el centro usa Google Workspace, poné acá el dominio para restringir
    // "Continuar con Google" a esas cuentas (ej. "miclinica.com.ar").
    // Dejá "" si no usás Workspace o querés permitir cualquier cuenta de Google.
    dominioWorkspace: ""
};
