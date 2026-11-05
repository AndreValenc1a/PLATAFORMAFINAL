'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const PDFDocument = require('pdfkit');
const controllerSource = fs.readFileSync(path.resolve(__dirname, '../controllers/reporteController.js'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,'fixture_reporte_v3.json'), 'utf8'));
const fakeDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'pdf-v3-prev-')), 'controllers');
fs.mkdirSync(fakeDir, {recursive:true});
const mod = { exports:{} };
const mockedRequire = name => name === 'pdfkit' ? PDFDocument : name === '../services/reporteService'
  ? { obtenerResumen: async () => fixture } : require(name);
vm.runInNewContext(`(function(require, module, __dirname) { ${controllerSource}\n})`, {Buffer, console})
  (mockedRequire, mod, fakeDir);
const response = {
  headersSent: false, status:0, headers:{}, body:null,
  writeHead(status,headers) {this.headersSent = true; this.status=status; this.headers=headers;},
  end(body) {this.body=body;}
};
(async()=>{
  await mod.exports.descargar({}, response, new URL('http://localhost/api/reportes/pdf?semana=2026-10-26'));
  if (response.status!==200) throw Error(String(response.body));
  const dest=path.resolve(__dirname,'../VISTA_PREVIA_V3_DATOS_SIMULADOS.pdf');
  fs.writeFileSync(dest,response.body);
  console.log('VISTA PREVIA:',dest,'bytes=',response.body.length);
})().catch(e=>{console.error(e);process.exitCode=1});
