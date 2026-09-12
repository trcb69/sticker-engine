/**
 * Symbol bitmaps for the preview canvas.
 *
 * The printer builds these itself from `^BC` and `^BQ`; nothing in the print
 * path needs them. They exist so the operator can see the actual bars before
 * committing a run, which is the difference between catching a squeezed
 * barcode on screen and catching it on a pallet.
 */

/**
 * Code 128 patterns, values 0 to 105. Each is eleven modules written as bits:
 * 1 is a bar, 0 is a space.
 * @type {readonly string[]}
 */
const CODE128 = Object.freeze([
  '11011001100', '11001101100', '11001100110', '10010011000',
  '10010001100', '10001001100', '10011001000', '10011000100',
  '10001100100', '11001001000', '11001000100', '11000100100',
  '10110011100', '10011011100', '10011001110', '10111001100',
  '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110',
  '11101001100', '11100101100', '11100100110', '11101100100',
  '11100110100', '11100110010', '11011011000', '11011000110',
  '11000110110', '10100011000', '10001011000', '10001000110',
  '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110',
  '10001101110', '10111011000', '10111000110', '10001110110',
  '11101110110', '11010001110', '11000101110', '11011101000',
  '11011100010', '11011101110', '11101011000', '11101000110',
  '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000',
  '10100001100', '10010110000', '10010000110', '10000101100',
  '10000100110', '10110010000', '10110000100', '10011010000',
  '10011000010', '10000110100', '10000110010', '11000010010',
  '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100',
  '10011110100', '10011110010', '11110100100', '11110010100',
  '11110010010', '11011011110', '11011110110', '11110110110',
  '10101111000', '10100011110', '10001011110', '10111101000',
  '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100',
  '11010010000', '11010011100',
]);

const STOP = '1100011101011';   // stop pattern plus its two-module terminator
const START_B = 104;
const START_C = 105;
const CODE_C = 99;
const CODE_B = 100;

/**
 * Encode Code 128 to a run of modules.
 *
 * Subsets B and C are both used, switching to C for runs of four or more
 * digits, which is what a Zebra does by default. Encoding in B alone would
 * draw a wider barcode than the printer produces and make the preview
 * pessimistic about fit.
 *
 * Note the deliberate asymmetry with `symbology.js`: the guard sizes the slot
 * assuming subset B throughout, because planning for the widest case can only
 * leave spare room, while planning for the narrowest could leave too little.
 * The preview then draws what will actually print inside that space.
 *
 * @param {string} data
 * @returns {{ bits: string, modules: number, values: number[] }}
 */
export function encodeCode128(data) {
  /** @type {number[]} */
  const values = [];
  let index = 0;
  let subset = digitRunAt(data, 0) >= 4 ? 'C' : 'B';
  values.push(subset === 'C' ? START_C : START_B);

  while (index < data.length) {
    const run = digitRunAt(data, index);
    if (subset === 'B' && run >= 4) {
      values.push(CODE_C);
      subset = 'C';
      continue;
    }
    if (subset === 'C' && run < 2) {
      values.push(CODE_B);
      subset = 'B';
      continue;
    }
    if (subset === 'C') {
      // C encodes digit pairs, so an odd-length run drops back for its last
      // digit rather than mis-pairing it with whatever follows.
      const pairs = Math.floor(run / 2);
      for (let i = 0; i < pairs; i += 1) {
        values.push(Number(data.slice(index, index + 2)));
        index += 2;
      }
      if (run % 2 === 1) {
        values.push(CODE_B);
        subset = 'B';
      }
      continue;
    }
    const code = data.charCodeAt(index);
    if (code < 32 || code > 126) {
      throw new RangeError(`Code 128 subset B cannot encode "${data[index]}".`);
    }
    values.push(code - 32);
    index += 1;
  }

  let checksum = values[0];
  for (let i = 1; i < values.length; i += 1) checksum += i * values[i];
  values.push(checksum % 103);

  const bits = values.map((value) => CODE128[value]).join('') + STOP;
  return { bits, modules: bits.length, values };
}

/**
 * @param {string} data
 * @param {number} from
 * @returns {number} how many consecutive digits start at `from`
 */
function digitRunAt(data, from) {
  let run = 0;
  while (from + run < data.length && data[from + run] >= '0' && data[from + run] <= '9') run += 1;
  return run;
}
