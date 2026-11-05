"use strict";
// Pruebas de etapa 1: sin PLC fisicos ni base de datos.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

function cargar(nombre, mocks = {}) {
    const archivo = path.resolve(__dirname, "../services/", nombre);
    const texto = fs.readFileSync(archivo, "utf8");
    const modulo = { exports: {} };
    const req = createRequire(archivo);
    new Function("require", "module", "exports", "__filename", "__dirname", texto)(
        nombre => Object.hasOwn(mocks, nombre) ? mocks[nombre] : req(nombre),
        modulo, modulo.exports, archivo, path.dirname(archivo)
    );
    return modulo.exports;
}
async function esperar(condicion, limite = 2000) {
    const fin = Date.now() + limite;
    while (Date.now() < fin) {
        if (condicion()) return true;
        await dormir(12);
    }
    return condicion();
}
const adaptador = {
    "Ethernet": [{ family:"IPv4", address:"192.168.10.125", netmask:"255.255.255.0", internal:false }]
};

function escenario({ inventario, verificar, consultar, monitorPersonalizado, mac = 110, gracia = 800 }) {
    const config = {
        intervalos: { lectura: 55, lecturaPorProtocolo:{ S7_SIEMENS:55 }, verificacionMAC:mac,
            verificacionMACRecuperacion:mac, graciaARPTipoSinRespuesta:gracia,
            vigilanciaRecuperacion:1000, vigilanciaInterfazRed:500, reconexion:80 },
        tiempos: { sinRespuesta:500, maximoInicio:1500 },
        limites: { vigenciaMAC:5000, maximoReintentoIndividual:400 },
        tiposSupervision: { PCCC:"PCCC", IDENTIDAD:"IDENTIDAD", S7_SIEMENS:"S7_SIEMENS", UMAS_M580:"UMAS_M580" }
    };
    const mocks = {
        "../models/plcModel":{ obtenerTodos: async () => inventario },
        "../config/supervisorConfig":config,
        "./identidadService":{ verificarMAC:verificar },
        "./siemensService":{ consultarSiemens:consultar },
        "./cipMicro850Service":{ consultarMicro850:async() => ({estado:"RUN",status:0,state:3,fallas:[]}) },
        "./m580Service":{ consultarM580:async() => ({estado:"RUN",codigoModo:3,estadoFalla:false}) },
        "./pcccService":{ crearServicioPCCC:()=>({ conectarPLC(){}, leerPLC(){}, cancelarPendiente(){}, cerrarCliente(){} }) },
        "./horometroService":{ iniciar(){}, detener(){} }
    };
    if (monitorPersonalizado) mocks["./estadoRedService"] = { crearMonitorRed:monitorPersonalizado };
    return cargar("supervisorService.js", mocks);
}
const plc = id => ({ id, modelo:"S7-1200", tipoSupervision:"S7_SIEMENS", ip:`192.168.10.${id}`, mac:"00-11-22-33-44-55" });
const OK = { estado:"RUN", codigoModo:"0x08" };
const confirmar = d => {
    d.identidadCoincide = true;
    d.estadoVerificacionMAC = "CONFIRMADA";
    d.macDetectada = d.mac;
    d.ultimaVerificacionMAC = Date.now();
};

test("Monitor de PC: distingue una interfaz ausente de un PLC individual apagado", () => {
    const eventos = [];
    let interfaces = adaptador;
    const { crearMonitorRed } = cargar("estadoRedService.js");
    const monitor = crearMonitorRed({
        obtenerIPs: () => ["192.168.10.10", "192.168.10.33"],
        obtenerInterfaces: () => interfaces,
        alCambiar: (...evento) => eventos.push(evento),
        confirmarCaida:2, confirmarRegreso:2
    });
    monitor.sondear();monitor.sondear();
    assert.equal(monitor.obtenerEstado().estado,"DISPONIBLE");
    // No hay dependencia de la respuesta de un PLC: la interfaz sigue disponible.
    assert.equal(monitor.sondear().estado,"DISPONIBLE");
    interfaces = {};
    assert.equal(monitor.sondear().estado,"DISPONIBLE", "Una muestra aislada no debe provocar caida global");
    assert.equal(monitor.sondear().estado,"SIN_INTERFAZ");
    interfaces = adaptador;
    assert.equal(monitor.sondear().estado,"SIN_INTERFAZ");
    assert.equal(monitor.sondear().estado,"DISPONIBLE");
    assert.deepEqual(eventos.map(x=>x[0]),["DISPONIBLE","SIN_INTERFAZ","DISPONIBLE"]);
});

test("Monitor: sin una interfaz local en la misma subred no bloquea redes enrutadas", () => {
    const { crearMonitorRed } = cargar("estadoRedService.js");
    const monitor = crearMonitorRed({
        obtenerIPs: () => ["10.44.1.5"], obtenerInterfaces:() => adaptador
    });
    monitor.sondear();monitor.sondear();monitor.sondear();
    assert.equal(monitor.obtenerEstado().estado,"INDETERMINADA");
});

test("ARP temporal ausente: conserva lectura sana y no reinicia la sesion industrial", async () => {
    let consultasMAC = 0, lecturas = 0;
    const supervisor = escenario({
        inventario:[plc(17)], mac:150, gracia:850,
        verificar:async d => {
            consultasMAC++;
            if (consultasMAC === 2) {
                d.identidadCoincide = false;
                d.estadoVerificacionMAC = "SIN_RESPUESTA";
                d.macDetectada = "No encontrada";
                d.ultimaVerificacionMAC = Date.now();
            } else confirmar(d);
        },
        consultar:async() => {lecturas++;return OK;}
    });
    try {
        await supervisor.iniciarPlataforma();
        assert.ok(await esperar(()=>supervisor.obtenerEstado()[0].comunicacion === "CONECTADO"));
        assert.ok(await esperar(()=>consultasMAC>=2));
        const durante = supervisor.obtenerEstado()[0];
        assert.equal(durante.estadoVerificacionMAC,"SIN_RESPUESTA");
        assert.equal(durante.identidadCoincide,true);
        assert.equal(durante.comunicacion,"CONECTADO");
        assert.ok(await esperar(()=>consultasMAC>=3));
        assert.equal(supervisor.obtenerEstado()[0].comunicacion,"CONECTADO");
        assert.equal(supervisor.obtenerEstado()[0].numeroConexionesValidas,1);
        assert.equal(supervisor.obtenerEstado()[0].numeroRecuperaciones,0);
        assert.ok(lecturas >= 2);
    } finally {supervisor.detenerPlataforma();}
});

test("MAC diferente: bloquea inmediatamente aunque el PLC tenga lecturas recientes", async () => {
    let macDistinta = false;
    const supervisor = escenario({
        inventario:[plc(17)],
        verificar:async d => {
            if (macDistinta) {
                d.identidadCoincide = false;
                d.estadoVerificacionMAC = "DIFERENTE";
                d.macDetectada = "AA-BB-CC-DD-EE-FF";
                d.ultimaVerificacionMAC = Date.now();
            } else confirmar(d);
        },
        consultar:async() => OK
    });
    try {
        await supervisor.iniciarPlataforma();
        assert.ok(await esperar(()=>supervisor.obtenerEstado()[0].comunicacion === "CONECTADO"));
        macDistinta = true;
        assert.ok(await esperar(()=>supervisor.obtenerEstado()[0].identidadCoincide === false));
        const bloqueado = supervisor.obtenerEstado()[0];
        assert.equal(bloqueado.estadoVerificacionMAC,"DIFERENTE");
        assert.notEqual(bloqueado.comunicacion,"CONECTADO");
        assert.match(bloqueado.error,/MAC diferente/);
        macDistinta = false;
        assert.ok(await esperar(()=>supervisor.obtenerEstado()[0].comunicacion === "CONECTADO"));
    } finally {supervisor.detenerPlataforma();}
});

test("Caida de un PLC no interrumpe otro; el apagado vuelve a conectarse solo", async () => {
    let primeroActivo=true, primeroConsultas=0, segundoConsultas=0;
    const supervisor = escenario({
        inventario:[plc(17),plc(18)],
        verificar:async d => { if (d.id===17 && !primeroActivo) {
                d.identidadCoincide = false;
                d.estadoVerificacionMAC = "SIN_RESPUESTA";
                d.macDetectada = "No encontrada";
                d.ultimaVerificacionMAC=Date.now();
            } else confirmar(d); },
        consultar:async ip => {
            if (ip.endsWith(".17")) {
                primeroConsultas++;
                if (!primeroActivo) throw new Error("PLC apagado");
            } else segundoConsultas++;
            return OK;
        }
    });
    try {
        await supervisor.iniciarPlataforma();
        assert.ok(await esperar(()=>supervisor.obtenerEstado().every(d=>d.comunicacion==="CONECTADO")));
        primeroActivo=false;
        assert.ok(await esperar(()=>supervisor.obtenerEstado()[0].comunicacion!=="CONECTADO"));
        const antes=segundoConsultas;
        await dormir(240);
        assert.equal(supervisor.obtenerEstado()[1].comunicacion,"CONECTADO");
        assert.ok(segundoConsultas>antes,"El segundo PLC debe seguir consultandose");
        primeroActivo=true;
        assert.ok(await esperar(()=>supervisor.obtenerEstado().every(d=>d.comunicacion==="CONECTADO"),1600));
        assert.ok(primeroConsultas>=2);
        assert.ok(supervisor.obtenerEstado()[0].numeroRecuperaciones >= 1);
        assert.equal(supervisor.obtenerEstado()[1].numeroRecuperaciones, 0,
            "El PLC sano no debe contar reconexiones inexistentes");
    } finally {supervisor.detenerPlataforma();}
});

test("PC desconectada: suspende todos; al regresar revalida cada PLC sin reiniciar", async () => {
    let monitor, verif=0, lecturas=0;
    const fabricaMonitor=({alCambiar}) => {
        let estado = "DISPONIBLE";
        monitor = {
            iniciar(){}, detener(){estado="INDETERMINADA";},
            obtenerEstado(){ return {estado}; },
            cambiar(nuevo){ const anterior=estado;estado=nuevo;alCambiar(nuevo,anterior); }
        };
        return monitor;
    };
    const supervisor = escenario({
        inventario:[plc(17),plc(18)],
        monitorPersonalizado:fabricaMonitor,
        verificar:async d => {verif++; confirmar(d);},
        consultar:async()=>{lecturas++;return OK;}
    });
    try {
        await supervisor.iniciarPlataforma();
        assert.ok(await esperar(()=>supervisor.obtenerEstado().every(d=>d.comunicacion==="CONECTADO")));
        const antes = lecturas;
        monitor.cambiar("SIN_INTERFAZ");
        assert.ok(supervisor.obtenerEstado().every(d=>d.comunicacion!=="CONECTADO"));
        assert.ok(supervisor.obtenerEstado().every(d=>d.estadoRedPC==="SIN_INTERFAZ"));
        await dormir(230);
        assert.equal(lecturas, antes,"No deben iniciarse lecturas sin interfaz");
        monitor.cambiar("DISPONIBLE");
        assert.ok(await esperar(()=>supervisor.obtenerEstado().every(d=>d.comunicacion==="CONECTADO")));
        assert.ok(verif>=4,"Cada PLC debe revalidar su MAC");
        assert.ok(supervisor.obtenerEstado().every(d=>d.numeroRecuperaciones===1),
            "Cada PLC recuperado debe contabilizar una reconexion, no un arranque inicial");
    } finally {supervisor.detenerPlataforma();}
});

test("PCCC: reconexion se cuenta despues de una lectura industrial valida", async () => {
    class ClientePCCC {
        initiateConnection(_opts, callback) { setTimeout(() => callback(null), 2); }
        setTranslationCB() {}
        addItems() {}
        findItem() { return { quality:"OK" }; }
        readAllItems(callback) {
            setTimeout(() => callback(null, { ESTADO_ERROR:false, PALABRA_MODO:6 }), 4);
        }
        dropConnection() {}
    }
    const config = {
        limites:{ conexionesPCCCConcurrentes:2, separacionConexionesPCCC:1 },
        tiempos:{ maximoInicio:1200 }, pccc:{ puerto:44818, direccionFalla:"S:1/13" }
    };
    const { crearServicioPCCC } = cargar("pcccService.js", {
        nodepccc:ClientePCCC, "../config/supervisorConfig":config
    });
    let sesionesValidas=0;
    const servicio = crearServicioPCCC({
        estaActivo:()=>true,
        reconectar:()=>assert.fail("Lectura de prueba valida no requiere reconectar"),
        programarLectura:()=>{},
        registrarConexionValida:()=>{ sesionesValidas++; }
    });
    const d={ id:29, ip:"192.0.2.29", identidadCoincide:true,conectando:false,conectado:false,
        ocupado:false, temporizadorReconexion:null, temporizadorInicio:null,
        intentosConexion:0,client:null,ultimaRespuesta:null,inicioFalla:null,inicioConexion:null };
    try {
        servicio.conectarPLC(d);
        assert.ok(await esperar(()=>d.conectado));
        assert.equal(sesionesValidas,0,"Abrir TCP no equivale a confirmar lectura industrial");
        servicio.leerPLC(d,d.client);
        assert.ok(await esperar(()=>sesionesValidas===1));
        servicio.leerPLC(d,d.client);
        await dormir(20);
        assert.equal(sesionesValidas,1,"Varias lecturas no deben contarse como reconexiones");
        servicio.cerrarCliente(d.client);
        d.client=null;d.conectado=false;d.conectando=false;d.ultimaRespuesta=null;
        servicio.conectarPLC(d);
        assert.ok(await esperar(()=>d.conectado));
        servicio.leerPLC(d,d.client);
        assert.ok(await esperar(()=>sesionesValidas===2));
    } finally {servicio.cerrarCliente(d.client);}
});
