// AC9: emit the made-up label from this tree, swap the logo for an outline box,
// render through Labelary, and measure margins and the barcode gap.
import { readFileSync, writeFileSync } from 'node:fs';
const R = '/root/dev/sticker-engine';
const OUT = process.argv[2];
const { resolve } = await import(`${R}/src/template/schema.js`);
const { emit } = await import(`${R}/src/render/zpl.js`);
const { field } = await import(`${R}/src/model/types.js`);
const { formatQuantity } = await import(`${R}/src/model/qty.js`);
const raw = JSON.parse(readFileSync(`${R}/src/template/label-4x1.json`, 'utf8'));
const made = {
  customer: field('Te Fashion Testing Co Pvt Ltd', 'extracted'), docNo: field('TESTINV0000001', 'extracted'),
  manufacturer: field('Calibrate Test Company', 'manual'), displayName: field('Cal-Test Blue 0001', 'extracted'),
  qtyText: field(formatQuantity('310', 'ml'), 'extracted'), mnfDate: field('05/2026', 'manual'), expDate: field('05/2028', 'manual'),
  batchCode: field('CAL260725', 'manual'), qrPayload: field('HTTPS://X.GD/TEST01', 'derived'), qrEcc: field('M', 'derived'),
};
const cases = { made, madeLong: { ...made, displayName: field('FW-777-Hybrid White Reactant Compound', 'extracted'), qtyText: field(formatQuantity('0.30', 'kg'), 'extracted') } };
const meta = {};
for (const [name, ctx] of Object.entries(cases)) {
  const { zpl, placed } = emit(resolve(raw, 203), ctx);
  const logo = placed.elements.find((e) => e.id === 'logo');
  // The company mark stays off third-party services: same footprint, outline only.
  const swapped = zpl.replace(/\^FO(\d+),(\d+)\^GFA,[^\n]*/, `^FO$1,$2^GB${logo.w},${logo.h},2^FS`);
  writeFileSync(`${OUT}/${name}.zpl`, swapped);
  const b = placed.elements.find((e) => e.id === 'batch');
  meta[name] = { batch: { x: b.x, y: b.y, quietZone: b.plan.quietZone, barWidth: b.plan.barWidth }, mnf: placed.elements.find((e) => e.id === 'mnf'), exp: placed.elements.find((e) => e.id === 'exp') };
  // The logo itself, rendered locally from the template's hex for the human.
  const hex = logo.data.hex; const bpr = logo.data.bytesPerRow; const rows = [];
  for (let y = 0; y < logo.h; y += 1) rows.push(hex.slice(y * bpr * 2, (y + 1) * bpr * 2));
  writeFileSync(`${OUT}/logo-rows.txt`, rows.join('\n'));
}
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta));
