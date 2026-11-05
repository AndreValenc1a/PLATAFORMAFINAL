"use strict";

// Reproduce la perdida temporal de MAC mientras hay lecturas en curso.
// Sin PLC, base de datos, red ni modificaciones industriales.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

function cargarSupervisor(mocks) {
    const ruta = path.resolve(__dirname, "../services/supervisorService.js");
    const codigo = fs.readFileSync(ruta, "utf8");
    const m = { exports: {} };
    const requerir = createRequire(ruta);
    new Function("require", "module", "exports", "__filename", "__dirname", codigo)(
        nombre => Object.hasOwn(mocks, nombre) ? mocks[nombre] : requerir(nombre),
        m, m.exports, ruta, path.dirname(ruta)
    );
    return m.exports;
}

async function esperarHasta(condicion, limiteMs = 900) {
    const fin = Date.now() + limiteMs;
    while (Date.now() < fin) {
        if (condicion()) return;
        await dormir(8);
    }
    assert.ok(condicion(), "No se recuperaron las lecturas al restaurarse la identidad MAC");
}

test("S7/CIP/UMAS reinician lecturas tras perder MAC durante una consulta", async () => {
    let redDisponible = true;
    const solicitudes = { S7_SIEMENS: 0, CIP_MICRO850: 0, UMAS_M580: 0 };
    const tipos = Object.keys(solicitudes);
    const inventario = tipos.map((tipo, indice) => ({
        id: indice + 1,
        modelo: tipo,
        tipoSupervision: tipo,
        ip: `192.0.2.${indice + 10}`,
        mac: "00-11-22-33-44-55"
    }));

    function simulador(tipo, resultado) {
        return (_ip, { signal }) => new Promise((resolve, reject) => {
            solicitudes[tipo]++;
            if (solicitudes[tipo] > 1) {
                setTimeout(() => resolve(resultado), 2);
                return;
            }
            // Primera lectura queda en curso hasta que la MAC se invalide.
            const cancelar = () => reject(new Error("Lectura simulada cancelada"));
            if (signal?.aborted) return cancelar();
            signal?.addEventListener("abort", cancelar, { once: true });
        });
    }

    const supervisor = cargarSupervisor({
        "../models/plcModel": { obtenerTodos: async () => inventario },
        "../config/supervisorConfig": {
            intervalos: {
                lectura: 15,
                lecturaPorProtocolo: {},
                verificacionMAC: 30,
                reconexion: 40
            },
            tiempos: { sinRespuesta: 200, maximoInicio: 500 },
            limites: { vigenciaMAC: 500 },
            tiposSupervision: {
                PCCC: "PCCC", IDENTIDAD: "IDENTIDAD",
                S7_SIEMENS: "S7_SIEMENS", UMAS_M580: "UMAS_M580"
            }
        },
        "./identidadService": {
            verificarMAC: async d => {
                d.identidadCoincide = redDisponible;
                d.macDetectada = redDisponible ? d.mac : "No encontrada";
                d.ultimaVerificacionMAC = Date.now();
                return redDisponible;
            }
        },
        "./pcccService": { crearServicioPCCC: () => ({
            cancelarPendiente() {}, cerrarCliente() {}, conectarPLC() {}, leerPLC() {}
        }) },
        "./siemensService": {
            consultarSiemens: simulador("S7_SIEMENS", { estado: "RUN", codigoModo: "0x08" })
        },
        "./cipMicro850Service": {
            consultarMicro850: simulador("CIP_MICRO850", {
                estado: "RUN", status: 0, state: 3, fallas: []
            })
        },
        "./m580Service": {
            consultarM580: simulador("UMAS_M580", {
                estado: "RUN", codigoModo: 3, estadoFalla: false
            })
        },
        "./horometroService": { iniciar() {}, detener() {} }
    });

    try {
        await supervisor.iniciarPlataforma();
        await esperarHasta(() => tipos.every(tipo => solicitudes[tipo] === 1));
        redDisponible = false;
        await esperarHasta(() => supervisor.obtenerEstado().every(d => !d.identidadCoincide));
        redDisponible = true;
        await esperarHasta(() => supervisor.obtenerEstado().every(d => d.identidadCoincide));
        await esperarHasta(() => supervisor.obtenerEstado().every(d =>
            d.comunicacion === "CONECTADO" && d.modoOperacion === "RUN"), 900);
        assert.ok(tipos.every(tipo => solicitudes[tipo] >= 2),
            `Faltan reintentos: ${JSON.stringify(solicitudes)}`);
    } finally {
        supervisor.detenerPlataforma();
    }
});
