"use strict";
// Servicio CIP de solo lectura, derivado de la prueba validada con dos Micro850.
const net = require("node:net");
const PORT = 44818;
const TIMEOUT = 5000;

function paquete(comando, sesion, datos = Buffer.alloc(0)) {
  const p = Buffer.alloc(24 + datos.length);
  p.writeUInt16LE(comando, 0);
  p.writeUInt16LE(datos.length, 2);
  p.writeUInt32LE(sesion, 4);
  datos.copy(p, 24);
  return p;
}

function solicitudAtributo(atributo) {
  const cip = Buffer.from([0x0E, 0x03, 0x20, 0x01, 0x24, 0x01, 0x30, atributo]);
  const rr = Buffer.alloc(16 + cip.length);
  rr.writeUInt32LE(0, 0);
  rr.writeUInt16LE(0, 4);
  rr.writeUInt16LE(2, 6);
  rr.writeUInt16LE(0x0000, 8);
  rr.writeUInt16LE(0, 10);
  rr.writeUInt16LE(0x00B2, 12);
  rr.writeUInt16LE(cip.length, 14);
  cip.copy(rr, 16);
  return rr;
}

function extraerCIP(respuesta) {
  const rr = respuesta.subarray(24);
  if (rr.length < 8) throw new Error('SendRRData incompleto');
  const n = rr.readUInt16LE(6);
  let offset = 8;
  for (let i = 0; i < n; i++) {
    if (offset + 4 > rr.length) throw new Error('CPF incompleto');
    const tipo = rr.readUInt16LE(offset);
    const longitud = rr.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + longitud > rr.length) throw new Error('Longitud CPF invalida');
    if (tipo === 0x00B2) return rr.subarray(offset, offset + longitud);
    offset += longitud;
  }
  throw new Error('No se recibio elemento CIP');
}

function leerAtributo(ip, atributo, bytes, { signal, deadline } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let sesion = 0;
    let terminado = false;
    let temporizador = null;
    const cancelar = () => terminar(new Error('Consulta CIP cancelada'));
    function terminar(error, resultado) {
      if (terminado) return;
      terminado = true;
      if (temporizador !== null) clearTimeout(temporizador);
      signal?.removeEventListener('abort', cancelar);
      // Destroy releases pending TCP operations immediately on timeout/abort.
      socket.destroy();
      if (error) reject(error); else resolve(resultado);
    }
    if (signal?.aborted) { terminar(new Error('Consulta CIP cancelada')); return; }
    signal?.addEventListener('abort', cancelar, { once: true });
    const restante = deadline === undefined ? TIMEOUT : deadline - Date.now();
    if (restante <= 0) { terminar(new Error('Tiempo total CIP agotado')); return; }
    temporizador = setTimeout(() => terminar(new Error('Tiempo total CIP agotado')), restante);
    socket.setTimeout(Math.min(TIMEOUT, restante));
    socket.on('connect', () => {
      const registro = Buffer.alloc(4);
      registro.writeUInt16LE(1, 0);
      socket.write(paquete(0x0065, 0, registro));
    });
    socket.on('data', datos => {
      if (terminado) return;
      buffer = Buffer.concat([buffer, datos]);
      while (buffer.length >= 24 && !terminado) {
        const total = 24 + buffer.readUInt16LE(2);
        if (buffer.length < total) break;
        const respuesta = buffer.subarray(0, total);
        buffer = buffer.subarray(total);
        try {
          const comando = respuesta.readUInt16LE(0);
          const errorEIP = respuesta.readUInt32LE(8);
          if (errorEIP !== 0) throw new Error(`Error EtherNet/IP ${errorEIP}`);
          if (comando === 0x0065) {
            sesion = respuesta.readUInt32LE(4);
            if (!sesion) throw new Error('Sesion invalida');
            socket.write(paquete(0x006F, sesion, solicitudAtributo(atributo)));
          } else if (comando === 0x006F) {
            const cip = extraerCIP(respuesta);
            if (cip.length < 4) throw new Error('Respuesta CIP incompleta');
            if (cip[0] !== 0x8E) throw new Error(`Servicio CIP inesperado 0x${cip[0].toString(16)}`);
            if (cip[2] !== 0) throw new Error(`Estado general CIP 0x${cip[2].toString(16)}`);
            const inicio = 4 + cip[3] * 2;
            if (cip.length < inicio + bytes) throw new Error('Datos de atributo incompletos');
            const valor = bytes === 2 ? cip.readUInt16LE(inicio) : cip.readUInt8(inicio);
            terminar(null, valor);
          }
        } catch (error) { terminar(error); }
      }
    });
    socket.on('timeout', () => terminar(new Error('Tiempo de espera agotado')));
    socket.on('error', error => terminar(error));
    socket.on('close', () => {
      if (!terminado) terminar(new Error('Conexion cerrada inesperadamente'));
    });
    socket.connect(PORT, ip);
  });
}

function interpretarState(valor) {
  return ({0:'Nonexistent', 1:'Device Self Testing', 2:'Standby (PROGRAM observado)',
    3:'Operational (RUN observado)', 4:'Major Recoverable Fault',
    5:'Major Unrecoverable Fault', 255:'Default'})[valor] || 'No determinado';
}


function clasificar(status, state) {
  // CIP Identity status bits 8-11: minor recoverable, minor unrecoverable,
  // major recoverable, major unrecoverable.
  const fallas = [];
  if (status & 0x0100) fallas.push('Menor recuperable');
  if (status & 0x0200) fallas.push('Menor no recuperable');
  if (status & 0x0400) fallas.push('Mayor recuperable');
  if (status & 0x0800) fallas.push('Mayor no recuperable');
  if (state === 4 && !fallas.length) fallas.push('Estado CIP: falla mayor recuperable');
  if (state === 5 && !fallas.length) fallas.push('Estado CIP: falla mayor no recuperable');
  const estado = state === 2 ? 'PROGRAM' : state === 3 ? 'RUN' :
    (state === 4 || state === 5) ? 'FAULT' : 'DESCONOCIDO';
  return {status, state, estado, fallas, descripcion: interpretarState(state)};
}

async function consultarMicro850(ip, { signal, timeoutMs = 9000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const status = await leerAtributo(ip, 0x05, 2, { signal, deadline });
  const state = await leerAtributo(ip, 0x08, 1, { signal, deadline });
  return clasificar(status, state);
}
module.exports = { consultarMicro850 };
