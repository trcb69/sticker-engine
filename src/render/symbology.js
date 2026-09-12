/**
 * Symbol planning for Code 128 and QR.
 *
 * These functions answer one question: given this data and this much room,
 * how many modules does the symbol need and how many printer dots does each
 * module get? Everything downstream — placement, guard warnings, the preview
 * canvas — depends on that single number, so it is computed once here rather
 * than estimated separately in each renderer.
 */

/** Minimum dots per module for a reliable Code 128 scan at 203 dpi. */
export const MIN_BARCODE_DOTS_PER_MODULE = 2;

/** Minimum dots per module for a reliable QR scan at 203 dpi. */
export const MIN_QR_DOTS_PER_MODULE = 3;

/** Quiet zone either side of a Code 128 symbol, in modules (ISO/IEC 15417). */
export const CODE128_QUIET_MODULES = 10;

/** Quiet zone around a QR symbol, in modules (ISO/IEC 18004). */
export const QR_QUIET_MODULES = 2;

/**
 * Module count for a Code 128 symbol.
 *
 * Assumes subset B — one 11-module symbol per character — plus a start
 * character, a checksum, and a 13-module stop pattern. Subset C would pack
 * digit pairs into single symbols and produce a narrower barcode, so this is a
 * deliberate over-estimate: planning for the wider case can only leave extra
 * room, whereas planning for the narrower case could leave too little.
 *
 * @param {string} data
 * @returns {number} modules, excluding quiet zones
 */
export function code128Modules(data) {
  if (typeof data !== 'string' || data.length === 0) {
    throw new TypeError('Code 128 data must be a non-empty string');
  }
  const symbols = 1 + data.length + 1; // start + payload + checksum
  return symbols * 11 + 13; // + stop pattern
}

/**
 * Plan a Code 128 symbol inside an available width.
 * @param {string} data
 * @param {number} availableWidth dots
 * @param {{ preferredModuleWidth?: number }} [options]
 * @returns {{ modules: number, moduleWidth: number, barWidth: number,
 *            quietZone: number, dotsPerModule: number, fits: boolean }}
 */
export function planCode128(data, availableWidth, options = {}) {
  const modules = code128Modules(data);
  const totalModules = modules + CODE128_QUIET_MODULES * 2;
  const affordable = Math.floor(availableWidth / totalModules);
  const preferred = options.preferredModuleWidth ?? MIN_BARCODE_DOTS_PER_MODULE;
  const moduleWidth = Math.max(1, Math.min(preferred, affordable));
  return {
    modules,
    moduleWidth,
    barWidth: modules * moduleWidth,
    quietZone: CODE128_QUIET_MODULES * moduleWidth,
    dotsPerModule: availableWidth / totalModules,
    fits: affordable >= MIN_BARCODE_DOTS_PER_MODULE,
  };
}

/** Characters encodable in QR alphanumeric mode. */
const QR_ALPHANUMERIC = new Set('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:');

/**
 * QR capacity in characters, versions 1-10, by mode and error correction.
 * Beyond version 10 the symbol is far too dense for a 1 inch label, so the
 * planner refuses rather than silently continuing.
 * @type {Readonly<Record<'alphanumeric'|'byte', Readonly<Record<'L'|'M'|'Q'|'H', number[]>>>}
 */
const QR_CAPACITY = Object.freeze({
  alphanumeric: Object.freeze({
    L: [25, 47, 77, 114, 154, 195, 224, 279, 335, 395],
    M: [20, 38, 61, 90, 122, 154, 178, 221, 262, 311],
    Q: [16, 29, 47, 67, 87, 108, 125, 157, 189, 221],
    H: [10, 20, 35, 50, 64, 84, 93, 122, 143, 174],
  }),
  byte: Object.freeze({
    L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271],
    M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
    Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
    H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119],
  }),
});

/**
 * Which QR encoding mode a payload will use.
 *
 * Alphanumeric mode covers uppercase, digits and a handful of symbols and
 * packs far more densely than byte mode. A single lowercase character forces
 * byte mode for the whole payload, which is why short-link URLs are emitted
 * entirely in uppercase.
 *
 * @param {string} data
 * @returns {'alphanumeric'|'byte'}
 */
export function qrMode(data) {
  for (const ch of data) if (!QR_ALPHANUMERIC.has(ch)) return 'byte';
  return 'alphanumeric';
}

/**
 * Plan a QR symbol inside a square dot budget.
 * @param {string} data
 * @param {number} budget dots available for symbol plus quiet zone
 * @param {{ ecc?: 'L'|'M'|'Q'|'H' }} [options]
 * @returns {{ mode: 'alphanumeric'|'byte', version: number, modules: number,
 *            totalModules: number, magnification: number, size: number,
 *            dotsPerModule: number, fits: boolean, ecc: 'L'|'M'|'Q'|'H' }}
 */
export function planQr(data, budget, options = {}) {
  if (typeof data !== 'string' || data.length === 0) {
    throw new TypeError('QR data must be a non-empty string');
  }
  const ecc = options.ecc ?? 'M';
  const mode = qrMode(data);
  const capacities = QR_CAPACITY[mode][ecc];
  const versionIndex = capacities.findIndex((cap) => data.length <= cap);
  if (versionIndex === -1) {
    return {
      mode, ecc, version: 0, modules: 0, totalModules: 0,
      magnification: 0, size: 0, dotsPerModule: 0, fits: false,
    };
  }
  const version = versionIndex + 1;
  const modules = 17 + 4 * version;
  const totalModules = modules + QR_QUIET_MODULES * 2;
  const magnification = Math.max(1, Math.floor(budget / totalModules));
  return {
    mode,
    ecc,
    version,
    modules,
    totalModules,
    magnification,
    size: totalModules * magnification,
    dotsPerModule: budget / totalModules,
    fits: Math.floor(budget / totalModules) >= MIN_QR_DOTS_PER_MODULE,
  };
}
