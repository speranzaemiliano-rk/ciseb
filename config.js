// Configuración de esta instancia de CISEB.
//
// Este es el ÚNICO archivo que hay que editar para levantar una instancia
// nueva a partir del mismo código base (index.html no cambia entre
// instalaciones). Los valores de `firebase` NO son secretos — es la config
// pública del SDK cliente de Firebase (la seguridad real vive en
// database.rules.json / storage.rules, no en ocultar esto).
//
// Ver config.example.js para la plantilla en blanco y docs/INSTALL.md para
// la guía completa de cómo levantar una instancia nueva.
window.CISEB_CONFIG = {
    firebase: {
        apiKey: "AIzaSyCKadOev2-P1VE-TtS0w99yEjfZlOFaX_Y",
        authDomain: "rkseguimientode-pagos.firebaseapp.com",
        databaseURL: "https://rkseguimientode-pagos-default-rtdb.firebaseio.com",
        projectId: "rkseguimientode-pagos",
        storageBucket: "rkseguimientode-pagos.firebasestorage.app",
        messagingSenderId: "757720795463",
        appId: "1:757720795463:web:5d5bb3c269aad01a48e462"
    },
    // Primer usuario que se loguea con este email se autoasigna 'superadmin'.
    adminEmail: "speranzaemiliano@gmail.com"
};
