"use strict";

// ==================================================
// PLATAFORMAFINAL - SERVIDOR HTTP
// ==================================================
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const supervisorRouter = require("../routers/supervisorRouter");
const horometroRoutes = require("../routers/horometroRoutes");
const eventosRoutes = require("../routers/eventosRoutes");
const reporteRoutes = require("../routers/reporteRoutes");

const supervisorService = require("../services/supervisorService");
const eventosService = require("../services/eventosService");
const horometroService = require("../services/horometroService");
const pool = require("../config/database");

const HOST = "127.0.0.1";
const PUERTO = 3000;
const DIRECTORIO_VIEWS = path.resolve(__dirname, "../views");
const RUTA_INTERFAZ = path.join(DIRECTORIO_VIEWS, "index.html");
let cerrando = false;

const archivosEstaticos = Object.freeze({
    // ==========================================
    // JAVASCRIPT DEL FRONTEND
    // ==========================================

    "/js/configuracion.js": [
        "js/configuracion.js",
        "application/javascript; charset=utf-8"
    ],

    "/js/componentes.js": [
        "js/componentes.js",
        "application/javascript; charset=utf-8"
    ],

    "/js/supervisor.js": [
        "js/supervisor.js",
        "application/javascript; charset=utf-8"
    ],

    // Animaciones y centro de notificaciones
    "/js/experiencia-fase7.js": [
        "js/experiencia-fase7.js",
        "application/javascript; charset=utf-8"
    ],

    // ==========================================
    // ESTILOS DEL FRONTEND
    // ==========================================

    "/css/estilos.css": [
        "css/estilos.css",
        "text/css; charset=utf-8"
    ],

    "/css/tema-unificado.css": [
        "css/tema-unificado.css",
        "text/css; charset=utf-8"
    ],

    "/css/experiencia-fase7.css": [
        "css/experiencia-fase7.css",
        "text/css; charset=utf-8"
    ]
});

function responderJson(res, codigo, datos) {
    if (res.writableEnded || res.destroyed || res.headersSent) return;
    res.writeHead(codigo, {
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
    });
    res.end(JSON.stringify(datos));
}

function enviarArchivo(res, ruta, tipoContenido) {
    fs.readFile(ruta, (error, contenido) => {
        if (res.writableEnded || res.destroyed) return;
        if (error) {
            responderJson(res, error.code === "ENOENT" ? 404 : 500, {
                error: "No se pudo cargar el archivo solicitado"
            });
            return;
        }
        res.writeHead(200, {
            "Content-Type": tipoContenido,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache"
        });
        res.end(contenido);
    });
}

const servidor = http.createServer(async (req, res) => {
    try {
        if (cerrando) {
            responderJson(res, 503, { error: "Plataforma en proceso de cierre" });
            return;
        }

        const ruta = new URL(req.url, `http://${HOST}:${PUERTO}`).pathname;

        if (req.method === "GET" && ruta === "/") {
            enviarArchivo(res, RUTA_INTERFAZ, "text/html; charset=utf-8");
            return;
        }

        if (req.method === "GET" && Object.prototype.hasOwnProperty.call(archivosEstaticos, ruta)) {
            const [archivo, tipo] = archivosEstaticos[ruta];
            enviarArchivo(res, path.join(DIRECTORIO_VIEWS, archivo), tipo);
            return;
        }

        // Los routers existentes administran sus rutas HTML y API.
        if (await eventosRoutes.manejar(req, res)) return;
        if (await reporteRoutes.manejar(req, res)) return;
        if (await horometroRoutes.manejar(req, res)) return;
        await supervisorRouter.manejarSolicitud(req, res);
    } catch (error) {
        console.error("[HTTP] Error:", error);
        if (!res.headersSent) {
            responderJson(res, 500, { error: "Error interno del servidor" });
        } else if (!res.writableEnded) {
            res.end();
        }
    }
});

servidor.on("error", error => {
    console.error("[ERROR] Servidor HTTP:", error.message);
    process.exitCode = 1;
});

servidor.listen(PUERTO, HOST, async () => {
    console.log("======================================");
    console.log(" BACKEND DE PLATAFORMAFINAL");
    console.log("======================================");
    console.log(`Servidor activo en http://${HOST}:${PUERTO}`);
    console.log("--------------------------------------");
    console.log(" MODULOS DISPONIBLES");
    console.log("--------------------------------------");
    console.log("Supervisión de PLC: /");
    console.log("Horómetro y mantenimiento: /horometro");
    console.log("Eventos y alarmas: /eventos");
    console.log("Reportes PDF: /reportes");
    console.log("--------------------------------------");
    try {
        await supervisorService.sincronizarInventario();
        supervisorService.iniciarSincronizacionInventario();
        eventosService.iniciar({
            estaSupervisando: supervisorService.estaSupervisando,
            leerEstados: supervisorService.obtenerEstado
        });
        console.log("[OK] Servicio de eventos iniciado.");
        console.log("[AUTO] Iniciando supervisión de los PLC...");
        await supervisorService.iniciarPlataforma();
        console.log("[OK] Supervisión automática activada.");
        console.log("Estado: ACTIVO");
    } catch (error) {
        console.error("[ERROR] Inicialización de eventos:", error.message);
        process.exitCode = 1;
        void cerrarServidor("ERROR DE INICIALIZACIÓN");
    }
});

// Mantener un cierre acotado evita que una conexión de red bloqueada
// impida devolver el prompt de PowerShell después de Ctrl+C.
const TIEMPO_LIMITE_CIERRE_MS = 8000;

async function cerrarServidor(senal) {
    if (cerrando) return;
    cerrando = true;
    console.log("\n======================================");
    console.log(" CERRANDO PLATAFORMAFINAL");
    console.log("======================================");
    console.log("Señal recibida:", senal);

    // El temporizador de seguridad se cancela al finalizar el cierre.
    // Si quedan sockets o consultas atascadas, evita un proceso colgado.
    const seguridad = setTimeout(() => {
        console.error(`[CIERRE] Se superaron ${TIEMPO_LIMITE_CIERRE_MS} ms. Finalizando proceso.`);
        process.exit(1);
    }, TIEMPO_LIMITE_CIERRE_MS);

    let huboErrores = false;
    try {
        // Impedir nuevas sincronizaciones y nuevas lecturas antes de
        // cerrar sockets, eventos, horómetros y conexiones MySQL.
        supervisorService.detenerSincronizacionInventario();
        try {
            eventosService.detener();
            console.log("[OK] Registro de eventos detenido.");
        } catch (error) {
            huboErrores = true;
            console.error("[ERROR] Eventos:", error.message);
        }
        try {
            supervisorService.detenerPlataforma();
            console.log("[OK] Supervisión y horómetro detenidos.");
        } catch (error) {
            huboErrores = true;
            console.error("[ERROR] Supervisor:", error.message);
            try { horometroService.detener(); }
            catch (otroError) { console.error("[ERROR] Horómetro:", otroError.message); }
        }
        try {
            // Node.js 26 permite cerrar conexiones HTTP inactivas.
            servidor.closeIdleConnections?.();
            await new Promise((resolve, reject) => {
                servidor.close(error => {
                    if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
                    else resolve();
                });
                servidor.closeAllConnections?.();
            });
            console.log("[OK] Servidor HTTP detenido.");
        } catch (error) {
            huboErrores = true;
            console.error("[ERROR] HTTP:", error.message);
        }
        try {
            // Evita que el pool mysql2 mantenga sockets abiertos.
            await pool.end();
            console.log("[OK] Pool MySQL cerrado.");
        } catch (error) {
            huboErrores = true;
            console.error("[ERROR] MySQL:", error.message);
        }
    } finally {
        clearTimeout(seguridad);
        console.log(huboErrores ? "Cierre con advertencias." : "Cierre ordenado completado.");
        // El supervisor usa clientes PCCC y procesos ping/arp que podrían
        // dejar manejadores activos aun tras cerrar sus conexiones.
        // Aquí ya se intentó el cierre ordenado de todos los servicios.
        process.exit(huboErrores ? 1 : 0);
    }
}

process.on("SIGINT", () => { void cerrarServidor("SIGINT"); });
process.on("SIGTERM", () => { void cerrarServidor("SIGTERM"); });
