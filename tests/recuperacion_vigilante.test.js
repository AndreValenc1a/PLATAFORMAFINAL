"use strict";
// Pruebas aisladas: no se abre ningun socket industrial ni se consulta MySQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

function cargar(mocks, temporizador = setTimeout) {
    const ruta = path.resolve(__dirname, '../services/supervisorService.js');
    const codigo = fs.readFileSync(ruta,'utf8');
    const mod = {exports:{}};
    const requerir = createRequire(ruta);
    new Function('require','module','exports','__filename','__dirname',
        'setTimeout','clearTimeout','setInterval','clearInterval',codigo)(
        nombre => Object.hasOwn(mocks,nombre) ? mocks[nombre] : requerir(nombre),
        mod,mod.exports,ruta,path.dirname(ruta),
        temporizador,clearTimeout,setInterval,clearInterval);
    return mod.exports;
}
function mocksBase({ verificarMAC, consultarSiemens, macNormal=1700, macRecuperacion=280, vigilante=1000 }) {
    return {
        '../models/plcModel': {obtenerTodos: async()=>[{
            id:17, modelo:'S7-1200', tipoSupervision:'S7_SIEMENS',
            ip:'192.0.2.17',mac:'00-11-22-33-44-55'
        }]},
        '../config/supervisorConfig': {
            intervalos: {lectura: 300, lecturaPorProtocolo:{S7_SIEMENS:300},
                verificacionMAC: macNormal, verificacionMACRecuperacion:macRecuperacion,
                vigilanciaRecuperacion:vigilante, reconexion:200},
            tiempos:{sinRespuesta:500,maximoInicio:1200},
            limites:{vigenciaMAC:4000},
            tiposSupervision:{PCCC:'PCCC',IDENTIDAD:'IDENTIDAD',S7_SIEMENS:'S7_SIEMENS',UMAS_M580:'UMAS_M580'}
        },
        './identidadService':{verificarMAC},
        './pcccService':{crearServicioPCCC:()=>({cancelarPendiente(){},cerrarCliente(){},conectarPLC(){},leerPLC(){}})},
        './siemensService':{consultarSiemens},
        './m580Service':{consultarM580:async()=>({estado:'RUN',codigoModo:3,estadoFalla:false})},
        './cipMicro850Service':{consultarMicro850:async()=>({estado:'RUN',status:0,state:3,fallas:[]})},
        './horometroService':{iniciar(){},detener(){}}
    };
}
async function esperar(condicion, limite=2500) {
    const fin=Date.now()+limite;
    while(Date.now()<fin) {
        if(condicion()) return true;
        await dormir(15);
    }
    return condicion();
}

test('MAC desconectada se vuelve a verificar pronto y las fallas no posponen el temporizador',async()=>{
    let red=true, cantidadMAC=0;
    const s=cargar(mocksBase({
        verificarMAC:async d=>{
            cantidadMAC++;
            d.identidadCoincide=red;
            d.macDetectada=red?d.mac:'No encontrada';
            d.ultimaVerificacionMAC=Date.now();
        },
        consultarSiemens:async ()=>{
            if(!red) throw new Error('Sin respuesta de red');
            return {estado:'RUN',codigoModo:'0x08'};
        }
    }));
    try {
        await s.iniciarPlataforma();
        assert.ok(await esperar(()=>s.obtenerEstado()[0].comunicacion==='CONECTADO',800));
        red=false;
        // Primer fallo industrial activa la verificacion rapida (280ms)
        assert.ok(await esperar(()=>!s.obtenerEstado()[0].identidadCoincide,1500),
            'No se verifico la MAC rapidamente durante la perdida de red');
        red=true;
        assert.ok(await esperar(()=>s.obtenerEstado()[0].comunicacion==='CONECTADO',1600),
            'No recupero la lectura despues de restablecer la MAC');
        assert.ok(cantidadMAC>=3,`Solo hubo ${cantidadMAC} verificaciones MAC`);
    } finally {s.detenerPlataforma();}
});

test('Vigilante reanuda un temporizador de lectura perdido sin reiniciar backend',async()=>{
    let lecturas=0;
    let tragados=2;
    // Simula que las dos programaciones iniciales del ciclo nunca ejecutan callback.
    const timer=(callback, demora, ...rest)=>{
        if(demora===0 && tragados>0) {
            tragados--;
            return setTimeout(()=>{},0);
        }
        return setTimeout(callback,demora,...rest);
    };
    const s=cargar(mocksBase({
        macNormal:5000,macRecuperacion:1000,vigilante:1000,
        verificarMAC:async d=>{
            d.identidadCoincide=true;d.macDetectada=d.mac;d.ultimaVerificacionMAC=Date.now();
        },
        consultarSiemens:async()=>{lecturas++;return {estado:'RUN',codigoModo:'0x08'};}
    }),timer);
    try {
        await s.iniciarPlataforma();
        assert.equal(lecturas,0,'La prueba esperaba perder el arranque inicial');
        assert.ok(await esperar(()=>s.obtenerEstado()[0].comunicacion==='CONECTADO',5300),
            'El vigilante no recupero un ciclo de lectura sin temporizador util');
        assert.ok(s.obtenerEstado()[0].reactivacionesAutomaticas>=1,
            'No se registro la reactivacion del vigilante');
    } finally {s.detenerPlataforma();}
});

test('Vigilante rescata PCCC si conectando queda huerfano sin cliente ni cola',async()=>{
    let conexiones=0;
    const mocks=mocksBase({
        macNormal:5000,macRecuperacion:1000,vigilante:1000,
        verificarMAC:async d=>{
            d.identidadCoincide=true;d.macDetectada=d.mac;d.ultimaVerificacionMAC=Date.now();
        },
        consultarSiemens:async()=>({estado:'RUN',codigoModo:'0x08'})
    });
    mocks['../models/plcModel']={obtenerTodos:async()=>[{
        id:29,modelo:'ML1100',tipoSupervision:'PCCC',ip:'192.0.2.29',mac:'00-11-22-33-44-55'
    }]};
    mocks['./pcccService']={crearServicioPCCC:()=>({
        cancelarPendiente(){},cerrarCliente(){},leerPLC(){},
        conectarPLC(d){
            conexiones++;
            if(conexiones===1) { d.conectando=true;return; }
            d.conectando=false;
            d.conectado=true;
            d.ultimaRespuesta=Date.now();
            d.inicioConexion=Date.now();
        }
    })};
    const supervisor=cargar(mocks);
    try {
        await supervisor.iniciarPlataforma();
        assert.equal(supervisor.obtenerEstado()[0].comunicacion,'CONECTANDO');
        assert.ok(await esperar(()=>supervisor.obtenerEstado()[0].comunicacion==='CONECTADO',2600));
        assert.ok(conexiones>=2);
        assert.ok(supervisor.obtenerEstado()[0].reactivacionesAutomaticas>=1);
    } finally {supervisor.detenerPlataforma();}
});
