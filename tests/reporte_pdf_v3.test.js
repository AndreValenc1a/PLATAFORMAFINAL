'use strict';
// Solo usa datos simulados. No consulta PLC, MySQL ni el backend real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const PDFDocument = require('pdfkit');

const code = fs.readFileSync(path.resolve(__dirname, '../controllers/reporteController.js'), 'utf8');
const example = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_reporte_v3.json'), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reporte-v3-'));
const virtualControllers = path.join(tempRoot, 'controllers');
fs.mkdirSync(virtualControllers, { recursive: true });

function controller(data) {
  const mod = { exports: {} };
  const mockRequire = name => name === 'pdfkit' ? PDFDocument :
    name === '../services/reporteService' ? { obtenerResumen: async () => data } : require(name);
  vm.runInNewContext(`(function(require, module, __dirname) { ${code}\n})`, { Buffer, console })
    (mockRequire, mod, virtualControllers);
  return mod.exports;
}
function response() {
  return {
    headersSent: false, status: 0, headers: {}, body: null,
    writeHead(status, headers) { this.headersSent = true; this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

test('Genera PDF V3 A4 sin PLC ni base de datos', async () => {
  const res = response();
  await controller(example).descargar({}, res, new URL('http://localhost/api/reportes/pdf?semana=2026-10-26'));
  assert.equal(res.status, 200, String(res.body));
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.ok(Buffer.isBuffer(res.body));
  assert.equal(res.body.subarray(0, 4).toString('ascii'), '%PDF');
  assert.ok(res.body.length > 18000);
  assert.ok(fs.existsSync(path.join(tempRoot, 'reportes', 'reporte_plc_2026-10-26.pdf')));
});
test('Conserva la respuesta JSON original utilizada por la interfaz', async () => {
  const res = response();
  await controller(example).resumenJson({}, res, new URL('http://localhost/api/reportes/resumen?semana=2026-10-26'));
  assert.equal(res.status, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.equipos.length, 14);
  assert.equal(parsed.planes.length, 14);
  assert.equal(parsed.eventos.incidentes.length, 65);
});
test('La generación funciona sin eventos ni mantenimientos', async () => {
  const reduced = { semana: example.semana, dias: example.dias, equipos: [], planes: [], eventos: {} };
  const res = response();
  await controller(reduced).descargar({}, res, new URL('http://localhost/api/reportes/pdf?semana=2026-10-26'));
  assert.equal(res.status, 200, String(res.body));
  assert.ok(Buffer.isBuffer(res.body));
});
test('No escribe fuera del directorio de reportes cuando la semana es inválida', async () => {
  const invalid = {...example, semana: '../otro'};
  const res = response();
  await controller(invalid).descargar({}, res, new URL('http://localhost/api/reportes/pdf'));
  assert.equal(res.status, 500);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
});
