'use strict';

// Reporte PDF V3: diseño orientado a lectura y paginación clara.
// Contrato de API y datos de reporteService sin cambios.
const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { obtenerResumen } = require('../services/reporteService');

const DIR = path.resolve(__dirname, '../reportes');
const TZ = 'America/Guayaquil';
const COLOR = Object.freeze({
  navy: '#203B50', teal: '#287786', ink: '#273946', muted: '#657582',
  pale: '#F6F8FA', paleBlue: '#EAF2F5', border: '#DFE7EB', white: '#FFFFFF',
  green: '#20745B', amber: '#A36C30', red: '#A44F52', bar: '#76AAB4'
});
const formatter = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
const value = v => v == null || String(v).trim() === '' ? '—' : String(v);
const hours = v => `${formatter.format(number(v) / 3600)} h`;
const elapsed = v => {
  const n = Math.round(number(v));
  return `${Math.floor(n / 3600)} h ${String(Math.floor(n % 3600 / 60)).padStart(2, '0')} min ${String(n % 60).padStart(2, '0')} s`;
};
const plc = id => `PLC-${String(id ?? '?').padStart(2, '0')}`;
function date(valueToFormat) {
  if (!valueToFormat) return 'No indicada';
  const d = new Date(valueToFormat);
  if (!Number.isFinite(d.getTime())) return 'No indicada';
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: TZ, dateStyle: 'medium', timeStyle: 'short'
  }).format(d);
}
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function render(doc, data) {
  const W = doc.page.width;
  const M = 46;
  const CW = W - M * 2;
  const B = doc.page.height - 76;
  const equipment = Array.isArray(data.equipos) ? data.equipos : [];
  const plans = Array.isArray(data.planes) ? data.planes : [];
  const events = data.eventos && typeof data.eventos === 'object' ? data.eventos : {};
  const totals = events.totales || null;
  const planned = new Map(plans.map(p => [String(p.id), p]));
  const totalSeconds = equipment.reduce((acc, item) => acc + number(item.segundos), 0);
  const complete = plans.filter(item => item.estado === 'REALIZADO').length;
  const noHours = equipment.filter(item => number(item.segundos) === 0).length;
  const period = `${value(data.dias?.[0] || data.semana)} al ${value(data.dias?.[6] || data.semana)}`;

  function newPage(cover = false) {
    if (!cover) doc.addPage();
    if (cover) {
      doc.rect(0, 0, W, 128).fill(COLOR.navy);
      doc.rect(M, 26, 37, 3).fill('#8DC0C9');
      doc.font('Helvetica-Bold').fontSize(9.1).fillColor('#D1E2E7')
        .text('PLATAFORMAFINAL  /  SUPERVISIÓN INDUSTRIAL', M, 38, { width: CW });
      doc.font('Helvetica-Bold').fontSize(21).fillColor(COLOR.white)
        .text('Informe semanal de PLC', M, 64, { width: CW });
      doc.font('Helvetica').fontSize(10).fillColor('#E1EBEE')
        .text(`Período: ${period}`, M, 97, { width: CW });
      doc.y = 150;
    } else {
      doc.rect(0, 0, W, 3).fill(COLOR.teal);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.navy)
        .text('PLATAFORMAFINAL', M, 24, { width: CW / 2 });
      doc.font('Helvetica').fontSize(8).fillColor(COLOR.muted)
        .text(`Semana ${value(data.semana)}`, M + CW / 2, 25, { width: CW / 2, align: 'right' });
      doc.moveTo(M, 49).lineTo(W - M, 49).strokeColor(COLOR.border).lineWidth(0.7).stroke();
      doc.y = 70;
    }
  }
  function reserve(h) {
    if (doc.y + h > B) newPage();
  }
  function heading(label, caption = '', forcePage = false) {
    if (forcePage) newPage();
    reserve(caption ? 76 : 51);
    const y = doc.y + 11;
    doc.rect(M, y + 1, 3, 18).fill(COLOR.teal);
    doc.font('Helvetica-Bold').fontSize(12.4).fillColor(COLOR.navy)
      .text(label, M + 12, y, { width: CW - 12 });
    doc.y = y + 29;
    if (caption) paragraph(caption, { size: 9.1, color: COLOR.muted, after: 12 });
    else doc.y += 5;
  }
  function paragraph(content, opts = {}) {
    const f = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
    const size = opts.size || 9.4;
    const before = opts.before || 0;
    const after = opts.after ?? 9;
    const text = String(content ?? '');
    doc.font(f).fontSize(size);
    const h = doc.heightOfString(text, { width: CW, lineGap: 3 });
    if (h + before + after < B - 70) reserve(h + before + after);
    else reserve(26);
    doc.y += before;
    doc.fillColor(opts.color || COLOR.ink).text(text, M, doc.y, { width: CW, lineGap: 3 });
    doc.y += after;
  }
  function note(content) {
    const f = 9;
    doc.font('Helvetica').fontSize(f);
    const h = doc.heightOfString(content, { width: CW - 27, lineGap: 2.6 }) + 20;
    if (h > B - 70) return paragraph(content, { size: f, color: COLOR.muted });
    reserve(h + 10);
    const y = doc.y;
    doc.roundedRect(M, y, CW, h, 5).fill(COLOR.paleBlue);
    doc.rect(M, y + 7, 3, h - 14).fill(COLOR.teal);
    doc.font('Helvetica').fontSize(f).fillColor(COLOR.ink)
      .text(content, M + 14, y + 10, { width: CW - 27, lineGap: 2.6 });
    doc.y = y + h + 12;
  }
  function titleLine(label) {
    reserve(32);
    doc.y += 10;
    doc.font('Helvetica-Bold').fontSize(10.3).fillColor(COLOR.navy)
      .text(label, M, doc.y, { width: CW });
    doc.y += 12;
  }
  function kpiGrid(items) {
    const gap = 12, colW = (CW - gap) / 2, boxH = 78;
    const rows = Math.ceil(items.length / 2);
    reserve(rows * (boxH + gap) + 3);
    const y0 = doc.y;
    items.forEach((item, i) => {
      const x = M + (i % 2) * (colW + gap);
      const y = y0 + Math.floor(i / 2) * (boxH + gap);
      doc.roundedRect(x, y, colW, boxH, 6).fill(COLOR.pale);
      doc.rect(x + 12, y + 14, 3, boxH - 28).fill(item.accent || COLOR.teal);
      doc.font('Helvetica').fontSize(9.2).fillColor(COLOR.muted)
        .text(item.label, x + 25, y + 14, { width: colW - 37 });
      doc.font('Helvetica-Bold').fontSize(19).fillColor(COLOR.navy)
        .text(String(item.value), x + 25, y + 39, { width: colW - 37, lineBreak: false });
    });
    doc.y = y0 + rows * (boxH + gap) + 3;
  }
  function incidentSummary(items) {
    reserve(93);
    const y = doc.y;
    doc.roundedRect(M, y, CW, 78, 6).fill(COLOR.paleBlue);
    const w = CW / 4;
    items.forEach((item, i) => {
      const x = M + i * w;
      if (i > 0) doc.moveTo(x, y + 15).lineTo(x, y + 62).strokeColor(COLOR.border).lineWidth(0.6).stroke();
      doc.font('Helvetica').fontSize(8.7).fillColor(COLOR.muted)
        .text(item.label, x + 11, y + 13, { width: w - 21, lineGap: 1.5 });
      doc.font('Helvetica-Bold').fontSize(11.2).fillColor(COLOR.navy)
        .text(String(item.value), x + 11, y + 42, { width: w - 21, lineGap: 1.5 });
    });
    doc.y = y + 90;
  }
  function table(headers, rows, widths, options = {}) {
    if (Math.abs(widths.reduce((a, b) => a + b, 0) - CW) > 0.5) throw new Error('Tabla excede el ancho de página');
    const body = Array.isArray(rows) ? rows : [];
    const font = options.size || 9;
    const headFont = options.headSize || 8.6;
    const padX = options.padX ?? 7;
    const padY = options.padY ?? 7;
    const align = options.align || [];
    const barValues = options.barValues || null;
    const barMax = barValues && Math.max(1, ...barValues.map(number));
    function height(values, isHead) {
      doc.font(isHead ? 'Helvetica-Bold' : 'Helvetica').fontSize(isHead ? headFont : font);
      return Math.max(isHead ? 32 : (barValues ? 35 : (options.minRowHeight || 29)),
        ...values.map((cell, j) => doc.heightOfString(value(cell), {
          width: widths[j] - 2 * padX, lineGap: 2
        }) + padY * 2 + (barValues && j === options.barIndex && !isHead ? 7 : 0)));
    }
    function draw(values, isHead, rowIndex = 0) {
      const h = height(values, isHead), y = doc.y;
      if (isHead) doc.roundedRect(M, y, CW, h, 3).fill(COLOR.paleBlue);
      else if (rowIndex % 2 === 1) doc.rect(M, y, CW, h).fill(COLOR.pale);
      doc.moveTo(M, y + h).lineTo(W - M, y + h).strokeColor(COLOR.border).lineWidth(0.5).stroke();
      let x = M;
      values.forEach((cell, j) => {
        doc.font(isHead ? 'Helvetica-Bold' : 'Helvetica').fontSize(isHead ? headFont : font)
          .fillColor(isHead ? COLOR.navy : COLOR.ink)
          .text(value(cell), x + padX, y + padY, { width: widths[j] - padX * 2, align: align[j] || 'left', lineGap: 2 });
        if (!isHead && barValues && j === options.barIndex) {
          const bw = widths[j] - 2 * padX;
          const by = y + h - 9;
          doc.roundedRect(x + padX, by, bw, 3.5, 1.75).fill(COLOR.border);
          const size = Math.min(bw, bw * number(barValues[rowIndex]) / barMax);
          if (size > 0) doc.roundedRect(x + padX, by, size, 3.5, 1.75).fill(COLOR.bar);
        }
        x += widths[j];
      });
      doc.y = y + h;
    }
    reserve(height(headers, true) + (body.length ? height(body[0], false) : 30) + 8);
    draw(headers, true);
    if (!body.length) {
      doc.y += 10;
      paragraph(options.empty || 'Sin registros para el período seleccionado.', { size: 9, color: COLOR.muted });
      return;
    }
    body.forEach((r, i) => {
      if (doc.y + height(r, false) > B) {
        newPage();
        draw(headers, true);
      }
      draw(r, false, i);
    });
    doc.y += 13;
  }
  function maintenanceCard(item) {
    const record = item.registro;
    const label = `${plc(item.id)}  /  ${value(item.modelo)}`;
    reserve(59);
    const y = doc.y;
    doc.roundedRect(M, y, CW, 33, 5).fill(COLOR.paleBlue);
    doc.font('Helvetica-Bold').fontSize(9.7).fillColor(COLOR.navy)
      .text(label, M + 12, y + 10, { width: CW - 24 });
    doc.y = y + 42;
    paragraph(`Responsable: ${value(record.responsable)}   ·   Registro: ${date(record.fecha)}`,
      { size: 9.1, after: 5 });
    const tasks = Array.isArray(record.tareas) ? record.tareas.filter(x => String(x).trim()) : [];
    paragraph(`Tareas realizadas: ${tasks.length ? tasks.map(value).join(' · ') : 'No especificadas'}`,
      { size: 9.1, after: 5 });
    paragraph(`Observaciones: ${value(record.observaciones || 'Sin observaciones')}`,
      { size: 9.1, after: 13 });
  }

  // 01 / Página de lectura rápida, sin tablas ni descripciones largas.
  newPage(true);
  paragraph(`Generado: ${date(new Date())}   ·   Zona horaria: Ecuador continental`,
    { size: 8.8, color: COLOR.muted, after: 7 });
  heading('01  Resumen ejecutivo', 'Indicadores generales registrados durante la semana.');
  kpiGrid([
    { label: 'Equipos registrados', value: String(equipment.length) },
    { label: 'Horas de comunicación', value: hours(totalSeconds) },
    { label: 'Mantenimientos realizados', value: `${complete} de ${plans.length}`, accent: COLOR.green },
    { label: 'Sin horas confirmadas', value: String(noHours), accent: COLOR.amber }
  ]);
  titleLine('Incidentes de la semana');
  if (totals) {
    incidentSummary([
      { label: 'Desconexiones', value: String(number(totals.desconexiones)) },
      { label: 'Fallas', value: String(number(totals.fallas)) },
      { label: 'Sin comunicación', value: elapsed(totals.segundosDesconexion) },
      { label: 'Tiempo en falla', value: elapsed(totals.segundosFalla) }
    ]);
    note(`Sin cierre registrado: ${number(totals.desconexionesSinCierre)} desconexiones y ${number(totals.fallasSinCierre)} fallas. Sus duraciones no están confirmadas.`);
  } else {
    note('El servicio de reportes no proporcionó indicadores de incidentes.');
  }
  paragraph('Criterio de lectura: las horas son tiempo de comunicación válida registrado, no tiempo físico de encendido. La falta de datos no demuestra una falla.',
    { size: 8.8, color: COLOR.muted, after: 4 });

  // 02 / Tabla compacta con lectura numérica y microbarras comparativas.
  heading('02  Comunicación por equipo', 'Horas acumuladas de comunicación válida durante el período.', true);
  table(['Equipo', 'Modelo', 'IP', 'Horas', 'Mantenimiento'], equipment.map(e => {
    const p = planned.get(String(e.id));
    return [plc(e.id), value(e.modelo), value(e.ip), hours(e.segundos), value(p?.estado)];
  }), [64, 123, 111, 112, CW - 410], {
    size: 9, barValues: equipment.map(e => number(e.segundos)), barIndex: 3,
    align: ['left', 'left', 'left', 'right']
  });
  note('Las barras comparan horas confirmadas entre equipos. Un valor 0,00 h no equivale necesariamente a un PLC apagado.');

  // 03 / Pág. independiente para no comprimir la matriz diaria.
  heading('03  Distribución diaria', 'Horas de comunicación por día (Lu a Do). Cada celda está expresada en horas.', true);
  const first = 84;
  table(['Equipo', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'], equipment.map(e => [
    plc(e.id), ...Array.from({ length: 7 }, (_, i) => formatter.format(number(e.diario?.[i]) / 3600))
  ]), [first, ...Array(7).fill((CW - first) / 7)], {
    size: 8.8, headSize: 8.7, padX: 5, align: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right']
  });

  // 04 / Resumen de mantenimiento, sin párrafo repetido por PLC pendiente.
  heading('04  Mantenimiento preventivo', 'Planificación y registros de ejecución. Los detalles se muestran solamente cuando existen.', true);
  table(['Equipo', 'Modelo', 'Estado', 'Fecha programada'], plans.map(p => [
    plc(p.id), value(p.modelo), value(p.estado), value(p.fechaProgramada)
  ]), [72, 147, 116, CW - 335], { size: 9.1 });
  const flagged = plans.filter(p => p.requiereRevisionSinComunicacion);
  if (flagged.length) {
    note(`Revisión sugerida por ausencia de comunicación de lunes a viernes: ${flagged.map(p => plc(p.id)).join(', ')}. Esta alerta no confirma que los equipos estén apagados.`);
  }
  const registered = plans.filter(p => p.registro);
  if (registered.length) {
    if (B - doc.y < 195) newPage();
    heading('04.1  Mantenimientos ejecutados', 'Se muestran solo los registros que incluyen responsable, tareas u observaciones.');
    for (const plan of registered) maintenanceCard(plan);
  }
  const unregistered = plans.filter(p => !p.registro);
  if (unregistered.length) {
    if (B - doc.y < 160) newPage();
    heading('04.2  Actividades sugeridas', 'Actividades planificadas para equipos sin ejecución registrada; no deben interpretarse como tareas realizadas.');
    table(['Equipo', 'Actividades sugeridas'], unregistered.map(p => [
      plc(p.id), Array.isArray(p.tareasSugeridas) && p.tareasSugeridas.length
        ? p.tareasSugeridas.map(value).join(' · ') : 'No definidas'
    ]), [82, CW - 82], { size: 9.1, padY: 9 });
  }

  // 05 / Resumen y detalle de eventos, con cabeceras repetidas en cada página.
  heading('05  Eventos e incidentes', 'Duraciones de incidentes cerrados, sin duplicar intervalos solapados.', true);
  if (Array.isArray(events.equipos)) {
    table(['Equipo', 'Desconex.', 'Fallas', 'Tiempo sin comunicación', 'Tiempo en falla'],
      events.equipos.map(e => [
        plc(e.plcId), String(number(e.desconexiones)), String(number(e.fallas)),
        elapsed(e.segundosDesconexion), elapsed(e.segundosFalla)
      ]), [67, 76, 54, 171, CW - 368], {
        size: 8.7, headSize: 8.2, padX: 5, align: ['left', 'right', 'right']
      });
  } else note('No se dispone de un resumen de eventos por equipo.');
  if (Array.isArray(events.incidentes) && events.incidentes.length) {
    if (B - doc.y < 165) newPage();
    heading('06  Cronología de incidentes', 'Detalle para consulta técnica. Los eventos abiertos se indican con duración no determinada.');
    table(['Equipo', 'Tipo', 'Inicio (Ecuador)', 'Duración semanal', 'Estado'],
      events.incidentes.map(e => [
        plc(e.plcId), value(e.tipo || e.categoria), date(e.inicio),
        e.segundosEnSemana == null ? 'No determinada' : elapsed(e.segundosEnSemana),
        value(e.estado)
      ]), [64, 78, 151, 108, CW - 401], { size: 8.65, headSize: 8.1, padX: 5, padY: 5.5, minRowHeight: 27 });
  }

  heading('Validación y observaciones', '', false);
  paragraph('Responsable: _________________________________________________________', { size: 9.4, after: 16 });
  paragraph('Firma del supervisor: __________________________________________________', { size: 9.4, after: 16 });
  paragraph('Observaciones adicionales: ____________________________________________', { size: 9.4, after: 12 });
  paragraph('Este documento utiliza los registros disponibles al generar el informe. Ausencia de datos no equivale automáticamente a un equipo apagado o averiado.',
    { size: 8.7, color: COLOR.muted });

  // Numeración, sin activar saltos automáticos al escribir pies.
  const range = doc.bufferedPageRange();
  const pages = range.count;
  for (let i = 0; i < pages; i++) {
    doc.switchToPage(range.start + i);
    const oldMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save();
    const y = doc.page.height - 47;
    doc.moveTo(M, y - 11).lineTo(W - M, y - 11).strokeColor(COLOR.border).lineWidth(0.7).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(COLOR.muted)
      .text(`PLATAFORMAFINAL  ·  Semana ${value(data.semana)}`, M, y, {
        width: CW / 2, height: 11, lineBreak: false
      });
    doc.font('Helvetica').fontSize(8).fillColor(COLOR.muted)
      .text(`${i + 1} / ${pages}`, M + CW / 2, y, {
        width: CW / 2, height: 11, align: 'right', lineBreak: false
      });
    doc.restore();
    doc.page.margins.bottom = oldMargin;
  }
  if (doc.bufferedPageRange().count !== pages) throw new Error('Paginación inválida al añadir pies de página');
}

async function descargar(req, res, url) {
  try {
    const data = await obtenerResumen(url.searchParams.get('semana') || undefined);
    fs.mkdirSync(DIR, { recursive: true });
    const week = String(data.semana || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error('Semana inválida al generar PDF');
    const file = `reporte_plc_${week}.pdf`;
    const dest = path.join(DIR, file);
    const doc = new PDFDocument({
      size: 'A4', margin: 46, autoFirstPage: false, bufferPages: true,
      info: { Title: `Informe semanal PLC ${week}`, Author: 'PLATAFORMAFINAL' }
    });
    doc.addPage();
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
    });
    render(doc, data);
    doc.end();
    await done;
    const bytes = Buffer.concat(chunks);
    fs.writeFileSync(dest, bytes);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
    });
    res.end(bytes);
  } catch (err) {
    console.error('[REPORTE V3]', err);
    if (!res.headersSent) json(res, err.statusCode || 500, {
      error: err.statusCode ? err.message : 'No se pudo generar el reporte PDF'
    });
    else res.end();
  }
}
async function resumenJson(req, res, url) {
  try {
    json(res, 200, await obtenerResumen(url.searchParams.get('semana') || undefined));
  } catch (err) {
    json(res, err.statusCode || 500, {
      error: err.statusCode ? err.message : 'No se pudo consultar el resumen'
    });
  }
}
module.exports = { descargar, resumenJson };
