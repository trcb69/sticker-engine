/**
 * Shared set-up for the browser checks in this folder.
 *
 * These are not part of `npm test`: they need a running server and a real
 * Chrome. Start the dev instance first (see CLAUDE.md), then run a check with
 * plain node from the repository root.
 *
 * Everything points at the dev instance unless STICKER_BROWSER_URL says
 * otherwise, so a debugging session never exercises production by accident.
 */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Drives the system Chrome (channel: 'chrome'), because Playwright's own
// browser download is blocked from this box.
import { chromium } from 'playwright';

export const BASE_URL = (process.env.STICKER_BROWSER_URL ?? 'http://127.0.0.1:6970').replace(/\/+$/, '');
export const SAMPLE_PDF = process.env.STICKER_BROWSER_PDF ?? '/root/Sticker gen/PKG-146468.PDF';
// Relative to this file, not the working directory: run from inside the live
// tree, a cwd-relative default would write screenshots into production.
const OUT_DIR = process.env.STICKER_BROWSER_OUT
  ? resolve(process.env.STICKER_BROWSER_OUT)
  : fileURLToPath(new URL('../../data/dev/browser/', import.meta.url));

/**
 * Open the page and start recording everything that goes wrong on it.
 *
 * @param {{ query?: string, viewport?: { width: number, height: number } }} [options]
 *   query is appended to BASE_URL as is, e.g. '?calibrate=1'.
 */
export async function openPage({ query = '', viewport = { width: 1500, height: 1200 } } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const url = `${BASE_URL}${query}`;
  const problems = [];
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,          // the Hub's certificate is self-signed
      viewport,
    });
    const page = await context.newPage();

    page.on('console', (m) => { if (m.type() === 'error') problems.push(`[console] ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e}`));
    page.on('requestfailed', (r) => problems.push(`[failed] ${r.failure()?.errorText} ${r.url()}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`[HTTP ${r.status()}] ${r.url()}`); });

    await page.goto(url, { waitUntil: 'networkidle' });
    return { browser, page, problems, url };
  } catch (cause) {
    await browser.close();
    throw new Error(`Could not load ${url}. Is the dev server running?`, { cause });
  }
}

/** Upload documents and wait until the preview has been drawn. */
export async function uploadAndWaitForPreview(page, files) {
  await page.locator('input[type=file]').setInputFiles(files);
  await page.waitForFunction(() => document.querySelector('#preview-canvas')?.width > 0, null, { timeout: 20000 });
  // The first frame can be drawn before fonts and the logo have arrived.
  await page.waitForTimeout(2500);
}

/** Where a check writes a screenshot. Under ./data by default, which git ignores. */
export function outPath(name) {
  mkdirSync(OUT_DIR, { recursive: true });
  return join(OUT_DIR, name);
}
