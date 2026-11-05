
const supervisorService = require("../services/supervisorService");

// ==================================================
// RESPUESTA HTTP
// ==================================================

function responder(res, codigo, datos) {
    res.writeHead(codigo, {
        "Content-Type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify(datos));
}

// ==================================================
// CONSULTAR ESTADO DEL SUPERVISOR
// ==================================================

function obtenerEstado(req, res) {
    const plc = supervisorService.obtenerEstado();

    const activo = supervisorService.estaSupervisando();

    return responder(res, 200, {
        modulo: "Supervisor",
        estado: activo ? "ACTIVO" : "DETENIDO",
        mensaje: "Estado de la supervisión consultado correctamente",
        totalPLC: plc.length,
        plc
    });
}

// ==================================================
// INICIAR SUPERVISIÓN
// ==================================================

async function iniciar(req, res) {
    try {
        await supervisorService.iniciarPlataforma();

        return responder(res, 200, {
            modulo: "Supervisor",
            estado: "ACTIVO",
            mensaje: "Solicitud de inicio procesada",
            plc: supervisorService.obtenerEstado()
        });
    } catch (error) {
        console.error("Error al iniciar la supervisión:", error);

        return responder(res, 500, {
            modulo: "Supervisor",
            estado: "ERROR",
            mensaje: error.message || "No se pudo iniciar la supervisión"
        });
    }
}

// ==================================================
// DETENER SUPERVISIÓN
// ==================================================

function detener(req, res) {
    try {
        supervisorService.detenerPlataforma();

        return responder(res, 200, {
            modulo: "Supervisor",
            estado: "DETENIDO",
            mensaje: "Solicitud de detención procesada",
            plc: supervisorService.obtenerEstado()
        });
    } catch (error) {
        console.error("Error al detener la supervisión:", error);

        return responder(res, 500, {
            modulo: "Supervisor",
            estado: "ERROR",
            mensaje: error.message || "No se pudo detener la supervisión"
        });
    }
}

module.exports = {
    obtenerEstado,
    iniciar,
    detener
};

