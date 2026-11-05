
 // ==================================================
// ROUTER PRINCIPAL DE LA API
// ==================================================

const supervisorController = require("../controllers/supervisorController");
const plcController = require("../controllers/plcController");

function manejarSolicitud(req, res) {
    const ruta = new URL(req.url, "http://localhost").pathname;

    // ==============================================
    // RUTAS DEL SUPERVISOR
    // ==============================================

    if (req.method === "GET" && ruta === "/api/supervisor") {
        return supervisorController.obtenerEstado(req, res);
    }

    if (req.method === "POST" && ruta === "/api/supervisor/iniciar") {
        return supervisorController.iniciar(req, res);
    }

    if (req.method === "POST" && ruta === "/api/supervisor/detener") {
        return supervisorController.detener(req, res);
    }

    // ==============================================
    // RUTAS DE LOS PLC
    // ==============================================

    if (req.method === "GET" && ruta === "/api/plc") {
        return plcController.obtenerTodos(req, res);
    }

    const coincidencia = ruta.match(/^\/api\/plc\/(\d+)$/);

    if (req.method === "GET" && coincidencia) {
        return plcController.obtenerPorId(
            req,
            res,
            coincidencia[1]
        );
    }

    // ==============================================
    // RUTA NO ENCONTRADA
    // ==============================================

    res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify({
        error: "Ruta no encontrada"
    }));
}

module.exports = {
    manejarSolicitud
};
