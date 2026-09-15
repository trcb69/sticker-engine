/**
 * Logo conversion: PNG to Zebra graphic hex.
 *
 * The same hex feeds a `~DG` stored graphic (recalled with `^XG`) and the
 * template's inline logo `data` (`scripts/write-logo-data.js`, emitted as `^GFA`).
 *
 * PNG only, decoded here with `node:zlib` and no dependency. A JPEG is refused
 * with instructions rather than half-decoded: writing a JPEG decoder to convert
 * a two-tone logo would be a lot of code to get a worse result than converting
 * the file once.
 */

import { inflateSync } from 'node:zlib';
import { AppError } from './errors.js';

export class ImageError extends AppError {
  static code = 'IMAGE_UNREADABLE';
  static httpStatus = 400;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Decode a PNG to greyscale samples.
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, grey: Uint8Array }}
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      throw new ImageError(
        'That is a JPEG. Convert it to PNG first — for example '
        + '`magick logo.jpg logo.png` — then run this again.',
      );
    }
    throw new ImageError('That file is not a PNG.');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  /** @type {Buffer[]} */
  const idat = [];
  /** @type {Buffer|null} */
  let palette = null;

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }

  if (interlace !== 0) throw new ImageError('Interlaced PNGs are not supported. Re-save without interlacing.');
  if (bitDepth !== 8 && bitDepth !== 1) {
    throw new ImageError(`Unsupported PNG bit depth ${bitDepth}. Re-save as 8-bit.`);
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new ImageError(`Unsupported PNG colour type ${colourType}.`);

  const raw = inflateSync(Buffer.concat(idat));
  const bytesPerPixel = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const bytesPerRow = Math.ceil((width * channels * bitDepth) / 8);
  const pixels = unfilter(raw, width, height, bytesPerPixel, bytesPerRow);

  const grey = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      grey[y * width + x] = sampleGrey(pixels, y * bytesPerRow, x, bitDepth, colourType, channels, palette);
    }
  }
  return { width, height, grey };
}

/**
 * Reverse the per-scanline PNG filters.
 * @returns {Buffer}
 */
function unfilter(raw, width, height, bytesPerPixel, bytesPerRow) {
  const out = Buffer.alloc(height * bytesPerRow);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const rowStart = y * bytesPerRow;
    const priorStart = (y - 1) * bytesPerRow;
    for (let i = 0; i < bytesPerRow; i += 1) {
      const value = raw[pos + i];
      const left = i >= bytesPerPixel ? out[rowStart + i - bytesPerPixel] : 0;
      const up = y > 0 ? out[priorStart + i] : 0;
      const upLeft = y > 0 && i >= bytesPerPixel ? out[priorStart + i - bytesPerPixel] : 0;
      let restored;
      switch (filter) {
        case 0: restored = value; break;
        case 1: restored = value + left; break;
        case 2: restored = value + up; break;
        case 3: restored = value + ((left + up) >> 1); break;
        case 4: restored = value + paeth(left, up, upLeft); break;
        default: throw new ImageError(`Unknown PNG filter ${filter} on row ${y}.`);
      }
      out[rowStart + i] = restored & 0xff;
    }
    pos += bytesPerRow;
  }
  return out;
}

/** @returns {number} */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** @returns {number} 0-255 */
function sampleGrey(pixels, rowStart, x, bitDepth, colourType, channels, palette) {
  if (bitDepth === 1) {
    const byte = pixels[rowStart + (x >> 3)];
    return ((byte >> (7 - (x & 7))) & 1) ? 255 : 0;
  }
  const base = rowStart + x * channels;
  if (colourType === 3) {
    const index = pixels[base] * 3;
    return luma(palette[index], palette[index + 1], palette[index + 2]);
  }
  if (colourType === 0 || colourType === 4) return pixels[base];
  const alpha = colourType === 6 ? pixels[base + 3] / 255 : 1;
  // Composite onto white: a transparent pixel is unprinted, not black.
  const value = luma(pixels[base], pixels[base + 1], pixels[base + 2]);
  return Math.round(value * alpha + 255 * (1 - alpha));
}

/** @returns {number} */
function luma(r, g, b) {
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

/**
 * Box-resample to a square and threshold to one bit.
 *
 * Deliberately not dithered. Floyd–Steinberg on a two-tone logo at 203 dpi
 * produces speckle that reads as printing defects and wastes heat; dithering
 * is for photographs, and there are none on this label.
 *
 * @param {{ width: number, height: number, grey: Uint8Array }} image
 * @param {number} size dots
 * @param {{ threshold?: number, knockout?: boolean }} [options]
 * @returns {{ size: number, bits: Uint8Array, coverage: number }}
 */
export function toMonochrome(image, size, options = {}) {
  const threshold = options.threshold ?? 128;
  const bits = new Uint8Array(size * size);
  const samples = new Float64Array(size * size);
  let black = 0;

  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor((y * image.height) / size);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / size));
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor((x * image.width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / size));
      let sum = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) { sum += image.grey[sy * image.width + sx]; count += 1; }
      }
      const value = sum / count;
      samples[y * size + x] = value;
      const dark = options.knockout ? value >= threshold : value < threshold;
      if (dark) bits[y * size + x] = 1;
    }
  }

  if (options.knockout) clearSurround(bits, samples, size, threshold);
  for (const bit of bits) if (bit) black += 1;

  return { size, bits, coverage: black / (size * size) };
}

/**
 * After inverting, put the background back to white.
 *
 * A logo drawn light-on-dark usually sits on a white page, and inverting it
 * turns that surround solid black — which is not a knockout, it is a black
 * rectangle. This floods in from the edges over pixels that were light in the
 * source and clears them, leaving the line art and nothing else.
 *
 * @param {Uint8Array} bits
 * @param {Float64Array} samples
 * @param {number} size
 * @param {number} threshold
 */
function clearSurround(bits, samples, size, threshold) {
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const at = y * size + x;
    if (bits[at] === 0 || samples[at] < threshold) return;
    bits[at] = 0;
    stack.push(at);
  };

  for (let i = 0; i < size; i += 1) {
    push(i, 0); push(i, size - 1); push(0, i); push(size - 1, i);
  }
  while (stack.length > 0) {
    const at = stack.pop();
    const x = at % size;
    const y = (at - x) / size;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
}

/**
 * Emit a `~DG` download command for a monochrome bitmap.
 * @param {{ size: number, bits: Uint8Array }} mono
 * @param {string} objectName e.g. R:LOGO.GRF
 * @returns {{ zpl: string, bytes: number, bytesPerRow: number }}
 */
export function toGraphicCommand(mono, objectName) {
  const bytesPerRow = Math.ceil(mono.size / 8);
  const total = bytesPerRow * mono.size;
  let hex = '';
  for (let y = 0; y < mono.size; y += 1) {
    const row = new Uint8Array(bytesPerRow);
    for (let x = 0; x < mono.size; x += 1) {
      if (mono.bits[y * mono.size + x]) row[x >> 3] |= 0x80 >> (x & 7);
    }
    for (const byte of row) hex += byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return {
    zpl: `~DG${objectName},${total},${bytesPerRow},\n${hex}\n`,
    bytes: total,
    bytesPerRow,
  };
}
