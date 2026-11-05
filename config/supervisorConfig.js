
"use strict";

// ==================================================
// CONFIGURACION DEL SUPERVISOR INDUSTRIAL
// ==================================================

// Parametros de comunicacion y supervision
const supervisorConfig = {
// Tipos de supervision disponibles
tiposSupervision: {
    PCCC: "PCCC",
    IDENTIDAD: "IDENTIDAD",
    UMAS_M580: "UMAS_M580",
    S7_SIEMENS: "S7_SIEMENS"
},

    // Intervalos de supervision (milisegundos)
    intervalos: {
        lectura: 1000,
        // Ajustes conservadores; cambiar solo despues de medir en campo.
        lecturaPorProtocolo: {
            S7_SIEMENS: 750,
            UMAS_M580: 1000,
            CIP_MICRO850: 1000,
            PCCC: 1000,
            IDENTIDAD: 1000
        },
        verificacionMAC: 10000,
        // Solo cuando un PLC pierde comunicacion: 4 s entre verificaciones.
        verificacionMACRecuperacion: 4000,
        // Comprobacion interna de ciclos de lectura/reconexion detenidos.
        vigilanciaRecuperacion: 2500,
        vigilanciaInterfazRed: 1000,
        // No desconectar por una ausencia aislada de ARP si la lectura sigue sana.
        graciaARPTipoSinRespuesta: 12000,
        reconexion: 5000
    },

    // Evitar tormentas de procesos y conexiones al regresar la red.
    limites: {
        verificacionesMACConcurrentes: 8,
        conexionesPCCCConcurrentes: 4,
        separacionConexionesPCCC: 150,
        // Da margen a la cola cuando hay decenas de PLC.
        vigenciaMAC: 45000,
        // Primera reconexion individual rapida; limite para fallos repetidos.
        maximoReintentoIndividual: 4000
    },

    // Tiempos de espera (milisegundos)
    tiempos: {
        sinRespuesta: 3000,
        maximoInicio: 10000
    },

    // Configuracion EtherNet/IP - PCCC
    pccc: {
        puerto: 44818,
        direccionFalla: "S:1/13"
    }
};

module.exports = Object.freeze(supervisorConfig);
