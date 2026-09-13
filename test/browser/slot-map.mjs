/**
 * Which slot does a click select, across the whole preview?
 *
 * Sweeps a grid of clicks over the canvas in calibrate mode and prints the
 * slot id each one lands on, then every distinct slot with its position and
 * size. Use it when a click selects the wrong thing, or when a slot cannot be
 * reached at all.
 *
 *   node test/browser/slot-map.mjs [document.pdf ...]     defaults to SAMPLE_PDF
 */

import { openPage, uploadAndWaitForPreview, SAMPLE_PDF } from './browser.mjs';

const files = process.argv.length > 2 ? process.argv.slice(2) : [SAMPLE_PDF];
const { browser, page, problems } = await openPage({ query: '?calibrate=1' });

try {
  await uploadAndWaitForPreview(page, files);
  const box = await page.locator('#preview-canvas').boundingBox();
  const readout = page.locator('.calibrate__readout');

  // Fractions of the canvas, which includes the bleed margin around the label.
  const seen = new Map();
  for (let fy = 0.12; fy < 0.95; fy += 0.09) {
    const row = [];
    for (let fx = 0.06; fx < 0.98; fx += 0.06) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      const text = (await readout.textContent()) ?? '';
      const id = (text.match(/^(\S+)\s+·/) ?? [, '—'])[1];
      row.push(id.padEnd(9).slice(0, 9));
      if (!seen.has(id)) seen.set(id, text.split('·').slice(1, 3).join('·').trim());
    }
    console.log(row.join(''));
  }

  console.log('\ndistinct slots reachable by clicking:');
  for (const [id, detail] of seen) console.log(`  ${id.padEnd(14)} ${detail}`);
} catch (error) {
  problems.push(`[check] ${error.message}`);
} finally {
  await browser.close();
}

if (problems.length) console.log(`\n--- problems ---\n  ${problems.join('\n  ')}`);
process.exitCode = problems.length === 0 ? 0 : 1;
