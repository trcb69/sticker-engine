#!/usr/bin/env node
/**
 * Put a logo bitmap into the template's `logo` slot as inline `data`.
 *
 * The label carries its logo as ^GFA, so nothing has to be stored on the
 * printer first. This converts a square PNG with the same code the `sticker
 * logo` command uses and rewrites only that slot.
 *
 *   node scripts/write-logo-data.js assets/logo-lineart-bold-144.png
 */
import { readFile, writeFile } from 'node:fs/promises';
import { decodePng, toMonochrome, toGraphicCommand } from '../src/logo.js';

const [file] = process.argv.slice(2);
if (!file) {
  process.stderr.write('Usage: node scripts/write-logo-data.js <logo.png>\n');
  process.exit(2);
}

const templateUrl = new URL('../src/template/label-4x1.json', import.meta.url);
const template = JSON.parse(await readFile(templateUrl, 'utf8'));
const slot = template.slots.find((candidate) => candidate.id === 'logo');
if (!slot || slot.w !== slot.h) {
  process.stderr.write('The template needs a square "logo" slot.\n');
  process.exit(1);
}

const image = decodePng(await readFile(file));
if (image.width !== slot.w || image.height !== slot.h) {
  process.stderr.write(`${file} is ${image.width}x${image.height}; the logo slot is ${slot.w}x${slot.h}.\n`);
  process.exit(1);
}
const mono = toMonochrome(image, slot.w);
const { bytesPerRow, zpl } = toGraphicCommand(mono, 'R:UNUSED.GRF');
const hex = zpl.split('\n')[1];

delete slot.source;
slot.data = { bytesPerRow, hex };
await writeFile(templateUrl, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
process.stdout.write(`logo: ${slot.w}x${slot.h} dots, ${hex.length / 2} bytes, `
  + `${(mono.coverage * 100).toFixed(1)}% black\n`);
