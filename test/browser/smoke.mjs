/**
 * Load the page, optionally upload documents, and report what a person would
 * see: the page text, whether the preview drew anything, and every console
 * error or failed request. The first thing to run when "the page is broken".
 *
 *   node test/browser/smoke.mjs                          load only
 *   node test/browser/smoke.mjs a.pdf [b.pdf ...]        load, upload, preview
 *
 * Exits 1 if anything went wrong, so it can gate a change.
 */

import { openPage, uploadAndWaitForPreview, outPath } from './browser.mjs';

const files = process.argv.slice(2);
const { browser, page, problems, url } = await openPage();

try {
  const hasUpload = await page.locator('input[type=file]').count() > 0;
  console.log(`page       : ${url}`);
  console.log(`title      : ${await page.title()}`);
  console.log(`upload     : ${hasUpload ? 'present' : 'MISSING'}`);
  if (!hasUpload) problems.push('[check] the page has no file input');

  if (files.length > 0 && hasUpload) {
    await uploadAndWaitForPreview(page, files);
    const ink = await page.evaluate(() => {
      const c = document.querySelector('#preview-canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0 && d[i - 1] < 200) n += 1;
      return n;
    });
    console.log(`preview    : ${ink} dark pixels drawn`);
    if (ink === 0) problems.push('[check] the preview canvas is blank');
  }

  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 560));
  console.log(`text       : ${text}`);
  const shot = outPath('smoke.png');
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`screenshot : ${shot}`);
} catch (error) {
  problems.push(`[check] ${error.message}`);
} finally {
  await browser.close();
}

console.log('\n--- problems ---');
console.log(problems.length ? problems.map((p) => `  ${p}`).join('\n') : '  (none)');
process.exitCode = problems.length === 0 ? 0 : 1;
