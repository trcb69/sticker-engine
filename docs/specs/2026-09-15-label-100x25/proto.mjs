import { readFileSync, writeFileSync } from 'node:fs';
const R = '/root/dev/sticker-engine';
const { resolve } = await import(`${R}/src/template/schema.js`);
const { emit } = await import(`${R}/src/render/zpl.js`);
const { guard } = await import(`${R}/src/render/guard.js`);
const { field } = await import(`${R}/src/model/types.js`);
const { formatQuantity } = await import(`${R}/src/model/qty.js`);
const fx = await import(`${R}/test/fixtures/context.js`);
const t = JSON.parse(readFileSync(`${R}/src/template/label-4x1.json`, 'utf8'));
const slot = (id) => t.slots.find((s) => s.id === id);

// ---- candidate geometry: 800x200, 12-dot quiet zone, border inside it ----
t.id = 'label-100x25-v2';
t.widthIn = 800 / 203; t.heightIn = 200 / 203;
Object.assign(slot('logo'), { x: 14, y: 28, w: 144, h: 144 });
Object.assign(slot('qr'), { y: 18, rightMargin: 18 });
Object.assign(slot('header'), { x: 166, y: 18, w: 510, lineGap: 24 });
Object.assign(slot('nameBg'), { x: 166, y: 67, w: 510, h: 48 });
Object.assign(slot('name'), { y: 67 });
Object.assign(slot('qtyBg'), { x: 166, y: 119, h: 40 });
Object.assign(slot('qty'), { y: 119, size: 22 });
Object.assign(slot('mnf'), { y: 119, flow: { after: 'qtyBg', gap: 6 } });
Object.assign(slot('exp'), { y: 141, flow: { after: 'qtyBg', gap: 6 } });
Object.assign(slot('batch'), { y: 118, barHeight: 40, rightMargin: 16, flow: { after: ['mnf', 'exp'], gap: 4 } });
Object.assign(slot('border'), { x: 12, y: 12, w: 776, h: 176, thickness: 2, edge: false });

const made = {
  customer: field('Te Fashion Testing Co Pvt Ltd', 'extracted'), docNo: field('TESTINV0000001', 'extracted'),
  manufacturer: field('Calibrate Test Company', 'manual'), displayName: field('Cal-Test Blue 0001', 'extracted'),
  qtyText: field(formatQuantity('310', 'ml'), 'extracted'), mnfDate: field('05/2026', 'manual'), expDate: field('05/2028', 'manual'),
  batchCode: field('CAL260725', 'manual'), qrPayload: field('HTTPS://X.GD/TEST01', 'derived'), qrEcc: field('M', 'derived'),
};
const madeLong = { ...made, displayName: field('FW-777-Hybrid White Reactant Compound', 'extracted'), qtyText: field(formatQuantity('0.30', 'kg'), 'extracted') };
for (const [name, ctx] of [['reference', fx.referenceContext], ['longName', fx.longNameContext], ['noDocNo', fx.noDocNoContext], ['made', made], ['madeLong', madeLong]]) {
  const r = resolve(t, 203);
  const { zpl, placed } = emit(r, ctx);
  const w = guard(placed, {});
  const els = placed.elements.map((e) => `${e.id}:${e.x},${e.y},${e.w}x${e.h}`).join(' ');
  console.log(`${name}: ${placed.width}x${placed.height} q=${placed.quietZone} warnings=${JSON.stringify(w.map((x) => `${x.code}:${x.slotId}`))}`);
  if (name === 'reference') console.log('  ', els);
  if (name.startsWith('made')) writeFileSync(`${name}.zpl`, zpl.replace(/\^FO(\d+),(\d+)\^XG[^\n]*/, '^FO$1,$2^GB144,144,2^FS'));
}

// ---- second pass: quiet zone applied by the emitter (simulated on the ZPL text) ----
for (const [name, ctx] of [['made', made], ['madeLong', madeLong], ['reference', fx.referenceContext]]) {
  const { zpl, placed } = emit(resolve(t, 203), ctx);
  const b = placed.elements.find((e) => e.id === 'batch');
  const w = guard(placed, {});
  console.log(`q2 ${name}: batch x=${b.x} w=${b.w} plan=${JSON.stringify(b.plan)} warnings=${JSON.stringify(w.map((x) => x.code))}`);
  if (name.startsWith('made')) {
    const shifted = zpl.replace(`^FO${b.x},${b.y}^BC`, `^FO${b.x + b.plan.quietZone},${b.y}^BC`)
      .replace(/\^FO(\d+),(\d+)\^XG[^\n]*/, '^FO$1,$2^GB144,144,2^FS');
    writeFileSync(`${name}-q.zpl`, shifted);
  }
}
