"use strict";

// Pruebas de concurrencia sin red ni PLC físicos.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { promisify } = require("node:util");

function cargarConMocks(nombre, mocks) {
    const archivo = path.join(__dirname, "../services", nombre);
    const codigo = fs.readFileSync(archivo, "utf8");
    const modulo = { exports: {} };
    const requerir = createRequire(archivo);
    const cargador = new Function("require", "module", "exports", "__filename", "__dirname", codigo);
    cargador(id => Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : requerir(id),
        modulo, modulo.exports, archivo, path.dirname(archivo));
    return modulo.exports;
}

const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

test("Identidad IP/MAC: máximo de 8 verificaciones simultáneas", async () => {
    let activos = 0, maximo = 0;
    const execSimulado = () => {};
    execSimulado[promisify.custom] = async (comando, args) => {
        activos++;
        maximo = Math.max(maximo, activos);
        await dormir(8);
        activos--;
        const ip = args.at(-1);
        return { stdout: comando === "arp" ? `${ip}  00-0f-73-00-a4-6a dinamico` : "ok" };
    };
    const servicio = cargarConMocks("identidadService.js", {
        "node:child_process": { execFile: execSimulado }
    });
    const dispositivos = Array.from({ length: 40 }, (_, i) => ({
        ip: `192.168.10.${i + 1}`, mac: "00-0F-73-00-A4-6A"
    }));
    const respuesta = await Promise.all(dispositivos.map(d => servicio.verificarMAC(d)));
    assert.ok(respuesta.every(Boolean));
    assert.ok(maximo <= 8, `Paralelismo excesivo: ${maximo}`);
    assert.ok(maximo > 1, "La cola no debería serializarlo todo");
});

test("Identidad: descarta comprobaciones ya canceladas antes de ejecutar ping/arp", async () => {
    let invocaciones = 0;
    let vigente = true;
    const execSimulado = () => {};
    execSimulado[promisify.custom] = async (comando, args) => {
        invocaciones++;
        await dormir(10);
        return { stdout: `${args.at(-1)}  00-0f-73-00-a4-6a dinamico` };
    };
    const servicio = cargarConMocks("identidadService.js", {
        "node:child_process": { execFile: execSimulado }
    });
    const dispositivos = Array.from({length: 25}, (_,i) => ({ip: `192.168.10.${i+1}`, mac: "00-0F-73-00-A4-6A"}));
    const tareas = dispositivos.map(d => servicio.verificarMAC(d, {estaVigente: () => vigente}));
    await dormir(2);
    vigente = false;
    await Promise.all(tareas);
    assert.ok(invocaciones < 25 * 2, "Se ejecutaron todas las tareas obsoletas");
});

test("PCCC: limita conexiones simultáneas y cancela elementos en cola", async () => {
    let activos = 0, maximo = 0, total = 0;
    class ClientePCCC {
        initiateConnection(opciones, callback) {
            activos++;
            total++;
            maximo = Math.max(maximo, activos);
            setTimeout(() => {
                activos--;
                callback(null);
            }, 24);
        }
        setTranslationCB() {}
        addItems() {}
        dropConnection() {}
    }
    const configuracion = require("../config/supervisorConfig");
    const ajustada = {
        ...configuracion,
        limites: { ...configuracion.limites, conexionesPCCCConcurrentes: 4, separacionConexionesPCCC: 1 }
    };
    const { crearServicioPCCC } = cargarConMocks("pcccService.js", {
        nodepccc: ClientePCCC, "../config/supervisorConfig": ajustada
    });
    const servicio = crearServicioPCCC({
        estaActivo: () => true,
        reconectar: () => assert.fail("No debería reconectar"),
        programarLectura: () => {}
    });
    const dispositivos = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, ip: `192.168.10.${i+1}`, identidadCoincide: true,
        conectando: false, conectado: false, temporizadorReconexion: null,
        intentosConexion: 0, client: null
    }));
    for (const d of dispositivos) servicio.conectarPLC(d);
    // Se cancelan 3 PLC aun en espera (sin alterar los demás).
    for (const d of dispositivos.slice(17)) {
        servicio.cancelarPendiente(d);
        d.conectando = false;
    }
    await dormir(240);
    assert.ok(maximo <= 4, `Hubo ${maximo} conexiones simultáneas`);
    assert.equal(total, 17);
    assert.ok(dispositivos.slice(0,17).every(d => d.conectado && d.intentosConexion === 1));
    assert.ok(dispositivos.slice(17).every(d => !d.conectado && d.intentosConexion === 0));
    for (const d of dispositivos) servicio.cerrarCliente(d.client);
});

test("PCCC: un intento de conexión colgado libera su cupo al vencer timeout", async () => {
    let iniciados = 0;
    class ClientePCCC {
        initiateConnection(opciones, callback) {
            iniciados++;
            if (iniciados > 1) setTimeout(() => callback(null), 5);
        }
        setTranslationCB() {}
        addItems() {}
        dropConnection() {}
    }
    const configuracion = require("../config/supervisorConfig");
    const ajustada = {
        ...configuracion,
        limites: { ...configuracion.limites, conexionesPCCCConcurrentes: 1, separacionConexionesPCCC: 1 },
        tiempos: { ...configuracion.tiempos, maximoInicio: 35 }
    };
    const { crearServicioPCCC } = cargarConMocks("pcccService.js", {
        nodepccc: ClientePCCC, "../config/supervisorConfig": ajustada
    });
    let servicio;
    servicio = crearServicioPCCC({
        estaActivo: () => true,
        reconectar: d => {
            const cliente = d.client;
            d.client = null;
            d.conectando = false;
            servicio.cerrarCliente(cliente);
        },
        programarLectura: () => {}
    });
    const dispositivos = Array.from({length:3},(_,i)=>({
        id:i+1, ip:`192.168.10.${i+1}`, identidadCoincide:true,
        conectando:false, conectado:false, temporizadorReconexion:null,
        intentosConexion:0, client:null
    }));
    dispositivos.forEach(d => servicio.conectarPLC(d));
    await dormir(110);
    assert.equal(iniciados, 3);
    assert.equal(dispositivos[0].conectado, false);
    assert.equal(dispositivos[1].conectado, true);
    assert.equal(dispositivos[2].conectado, true);
    dispositivos.forEach(d => servicio.cerrarCliente(d.client));
});
