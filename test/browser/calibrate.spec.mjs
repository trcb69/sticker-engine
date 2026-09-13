/**
 * Does calibrate mode actually work, end to end in a real Chrome?
 *
 *   node test/browser/calibrate.spec.mjs
 *
 * Needs the dev instance running (see CLAUDE.md). Uploads SAMPLE_PDF, then
 * clicks, nudges and resizes slots the way an operator would.
 */

import { openPage, uploadAndWaitForPreview, outPath, SAMPLE_PDF } from './browser.mjs';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const { browser, page, problems: errors } = await openPage({ query: '?calibrate=1' });

check('page loads without error in calibrate mode',
  await page.locator('input[type=file]').count() > 0);

await uploadAndWaitForPreview(page, SAMPLE_PDF);

const canvas = page.locator('#preview-canvas');
const box = await canvas.boundingBox();

// The bleed margin is what makes an overhang visible instead of clipped away.
const geometry = await page.evaluate(() => {
  const c = document.querySelector('#preview-canvas');
  return { intrinsic: [c.width, c.height], displayed: [c.clientWidth, c.clientHeight] };
});
const ratio = geometry.intrinsic[0] / geometry.intrinsic[1];
const shown = geometry.displayed[0] / geometry.displayed[1];
check('canvas keeps its aspect ratio', Math.abs(ratio - shown) < 0.02,
  `intrinsic ${geometry.intrinsic.join('x')}, displayed ${geometry.displayed.join('x')}`);
check('canvas is drawn wider than the label (bleed margin present)',
  geometry.intrinsic[0] / geometry.intrinsic[1] < 812 / 203,
  `ratio ${ratio.toFixed(2)} vs a bare label 4.00`);

check('the calibration panel appears once a job is loaded',
  await page.locator('#calibrate-panel').isVisible());

const readout = page.locator('.calibrate__readout');
check('readout starts by inviting a click',
  /click a slot/i.test((await readout.textContent()) ?? ''));

// The product name: a slot with no coordinates of its own, declared inside
// nameBg. This is the case that silently did nothing.
await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.45);
await page.waitForTimeout(400);
const afterClick = (await readout.textContent()) ?? '';
const slot = (afterClick.match(/^(\S+)\s+·/) ?? [, null])[1];
check('clicking selects a slot', slot !== null, afterClick.slice(0, 90));

const coords = (t) => {
  const m = t.match(/x (-?\d+) y (-?\d+)/);
  return m ? { x: +m[1], y: +m[2] } : null;
};
const before = coords(afterClick);

for (let i = 0; i < 4; i += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(90);
}
const afterRight = coords((await readout.textContent()) ?? '');
check('arrow key moves one dot per press',
  before && afterRight && afterRight.x - before.x === 4,
  `x ${before?.x} -> ${afterRight?.x}`);

await page.keyboard.down('Shift');
await page.keyboard.press('ArrowDown');
await page.keyboard.up('Shift');
await page.waitForTimeout(200);
const afterShift = coords((await readout.textContent()) ?? '');
check('shift moves ten dots', afterShift && afterShift.y - afterRight.y === 10,
  `y ${afterRight?.y} -> ${afterShift?.y}`);

// Alt resizes the slot that states a size — which for a derived slot is its
// anchor, so the SELECTED element's own measured size is the wrong thing to
// assert on: the product name text stays 391x38 while its bar grows.
const sizeOf = (t) => (t.match(/(\d+)×(\d+) dots/) ?? [, null, null]).slice(1).join('x');

// Select nameBg itself, which states both dimensions.
await page.mouse.click(box.x + box.width * 0.71, box.y + box.height * 0.45);
await page.waitForTimeout(350);
const boxBefore = sizeOf((await readout.textContent()) ?? '');
await page.keyboard.down('Alt');
await page.keyboard.press('ArrowRight');
await page.keyboard.up('Alt');
await page.waitForTimeout(250);
const boxAfter = sizeOf((await readout.textContent()) ?? '');
check('alt+arrow resizes a slot that states a size',
  boxBefore !== boxAfter, `${boxBefore} -> ${boxAfter}`);

// qtyBg states a height and no width, so widening must be refused out loud
// rather than reported as done.
await page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.58);
await page.waitForTimeout(350);
await page.keyboard.down('Alt');
await page.keyboard.press('ArrowRight');
await page.keyboard.up('Alt');
await page.waitForTimeout(250);
const refused = (await readout.textContent()) ?? '';
check('widening a content-sized box is refused in words, not silently',
  /takes its width from its content/i.test(refused), refused.slice(0, 95));

// Back to the derived slot for the clipping checks.
await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.45);
await page.waitForTimeout(350);

// Push it off the right edge; the warning is the point of the whole mode.
await page.keyboard.down('Shift');
for (let i = 0; i < 40; i += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(25);
}
await page.keyboard.up('Shift');
await page.waitForTimeout(400);
const pushed = (await readout.textContent()) ?? '';
check('pushing a slot off the sticker warns that it will not print',
  /OUTSIDE THE STICKER/i.test(pushed), pushed.slice(0, 100));
check('the warning is marked visually too',
  (await readout.getAttribute('class') ?? '').includes('is-clipped'));

// Red overflow marking should now exist on the canvas.
const red = await page.evaluate(() => {
  const c = document.querySelector('#preview-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 150 && d[i + 1] < 110 && d[i + 2] < 110) n += 1;
  }
  // Per square dot, because the canvas is drawn at however many pixels per
  // dot the window allows and a raw pixel count would change with it.
  const k = Number(c.dataset.cssPerDot) * devicePixelRatio;
  return n / (k * k);
});
check('the cut-off area is shaded red on the artwork', red > 50, `${Math.round(red)} red dots`);

await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('escape deselects', /click a slot/i.test((await readout.textContent()) ?? ''));

check('no console errors or failed requests', errors.length === 0,
  errors.slice(0, 3).join(' | '));

const shot = outPath('calibrate.png');
await page.screenshot({ path: shot, fullPage: true });
console.log(`screenshot: ${shot}`);
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
