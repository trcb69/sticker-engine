// AC8: emit the made-up calibration label from the fixed tree (a) and from e9e7a81 (o).
import { readFileSync, writeFileSync } from 'node:fs';
const NEW = '/root/dev/sticker-engine';
const OLD = process.argv[2];
const OUT = process.argv[3];

async function build(root) {
  const { resolve } = await import(`${root}/src/template/schema.js`);
  const { emit } = await import(`${root}/src/render/zpl.js`);
  const { field } = await import(`${root}/src/model/types.js`);
  const { formatQuantity } = await import(`${root}/src/model/qty.js`);
  const raw = JSON.parse(readFileSync(`${root}/src/template/label-4x1.json`, 'utf8'));
  // Every value is made up. Manufacturer is a same-length stand-in.
  const context = {
    customer: field('Te Fashion Testing Co Pvt Ltd', 'extracted'),
    docNo: field('TESTINV0000001', 'extracted'),
    manufacturer: field('Calibrate Test Company', 'manual'),
    displayName: field('Cal-Test Blue 0001', 'extracted'),
    qtyText: field(formatQuantity('310', 'ml'), 'extracted'),
    mnfDate: field('05/2026', 'manual'),
    expDate: field('05/2028', 'manual'),
    batchCode: field('CAL260725', 'manual'),
    qrPayload: field('HTTPS://X.GD/TEST01', 'derived'),
    qrEcc: field('M', 'derived'),
  };
  const { zpl, placed } = emit(resolve(raw, 203), context);
  return { zpl: zpl.split('\n').filter((l) => !l.includes('^XG')).join('\n'), placed };
}

const a = await build(NEW);
const o = await build(OLD);
const b = a.zpl.split('\n').filter((l) => !(l.includes('^FR') && l.includes('^GB'))).join('\n');
writeFileSync(`${OUT}/a-fixed.zpl`, a.zpl);
writeFileSync(`${OUT}/o-before.zpl`, o.zpl);
writeFileSync(`${OUT}/b-strikes-only.zpl`, b);
const bars = a.placed.elements.filter((el) => el.kind === 'box' && el.fill).map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
writeFileSync(`${OUT}/bars.json`, JSON.stringify(bars));
console.log(JSON.stringify(bars));
