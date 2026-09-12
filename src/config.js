/**
 * Environment-driven configuration, validated once at boot.
 *
 * Nothing here has a silent fallback that could change how a document is read.
 * `STICKER_DATE_ORDER` has a default, but the resolved value is logged at boot
 * so a wrong setting is visible in the log rather than discovered on a printed
 * drum eleven months later.
 */

import { ConfigError } from './errors.js';

/** @typedef {'MDY'|'DMY'|'YMD'} DateOrder */

/** @type {readonly DateOrder[]} */
export const DATE_ORDERS = Object.freeze(['MDY', 'DMY', 'YMD']);

/**
 * Confirmed against the Sample Note and Picklist samples: `09/04/2026` on
 * those documents is 4 September 2026, so month comes first. Kept configurable
 * because a future document source in another format must be a config change,
 * not a code change and not a silent misreading.
 */
export const DEFAULT_DATE_ORDER = 'MDY';

/**
 * The manufacturer is pasted by the operator and prints after a fixed prefix,
 * giving the `MANUFACTURER - Miscellaneous Supplier` seen on the sample label.
 */
export const MANUFACTURER_PREFIX = 'MANUFACTURER - ';
export const DEFAULT_MANUFACTURER = 'Miscellaneous Supplier';

/**
 * Square dot allowance for the QR on a 4x1 label at 203 dpi, and the ceiling
 * on how many modules may be packed into it.
 *
 * The ceiling counts the symbol plus a two-module quiet zone each side, as the
 * QR specification requires. A version 2 symbol is 25 modules, so 29 total,
 * which at 96 dots gives 3 dots per module — the floor for a reliable scan.
 * Earlier working figures quoted 27; those counted a single-module quiet zone.
 */
export const DEFAULT_QR_BUDGET_DOTS = 96;
export const DEFAULT_QR_MAX_MODULES = 29;

/**
 * @typedef {object} Config
 * @property {DateOrder} dateOrder
 * @property {string} popplerBinDir Empty string means "on PATH".
 * @property {string} defaultManufacturer
 * @property {string} manufacturerPrefix
 * @property {RegExp|null} batchPattern
 * @property {string|null} shortBase Origin the QR points at, e.g. https://sh.lk
 * @property {string} shortLinkStorePath
 * @property {number} qrBudgetDots
 * @property {number} qrMaxModules
 * @property {number} port
 * @property {string} host
 * @property {string} tmpDir
 * @property {string} archiveDir
 * @property {string} auditLogPath
 * @property {number} jobTtlSeconds
 * @property {number} maxUploadBytes
 * @property {Record<string, {host: string, port: number, dpi: number}>} printers
 * @property {number} confirmThreshold
 * @property {'browser'|'network'} printTransport
 * @property {string|null} xgdApiKey
 * @property {boolean} xgdAnalytics
 */

/**
 * Load and validate configuration.
 *
 * Every problem is collected before anything is thrown, so a misconfigured
 * deployment reports all of its mistakes at once instead of revealing them one
 * restart at a time.
 *
 * @param {{ env?: Record<string, string|undefined>, logger?: { info: Function } }} [options]
 * @returns {Config}
 */
export function loadConfig(options = {}) {
  const env = options.env ?? process.env;
  /** @type {string[]} */
  const problems = [];
  const fail = (message) => { problems.push(message); };

  let dateOrder = env.STICKER_DATE_ORDER ?? DEFAULT_DATE_ORDER;
  if (!DATE_ORDERS.includes(dateOrder)) {
    fail(`STICKER_DATE_ORDER must be one of ${DATE_ORDERS.join(', ')}. Received "${dateOrder}".`);
    dateOrder = DEFAULT_DATE_ORDER;
  }

  // No pattern unless one is configured. The batch code is on no document, so
  // the system has no basis for deciding what a valid one looks like.
  let batchPattern = null;
  if (env.STICKER_BATCH_PATTERN) {
    try {
      batchPattern = new RegExp(env.STICKER_BATCH_PATTERN);
    } catch {
      fail(`STICKER_BATCH_PATTERN is not a valid regular expression: "${env.STICKER_BATCH_PATTERN}".`);
    }
  }

  let shortBase = null;
  if (env.STICKER_SHORT_BASE) {
    try {
      shortBase = normaliseOrigin(env.STICKER_SHORT_BASE);
    } catch (error) {
      fail(error.message);
    }
  }

  const config = {
    dateOrder,
    popplerBinDir: env.STICKER_POPPLER_BIN ?? '',
    defaultManufacturer: env.STICKER_DEFAULT_MANUFACTURER ?? DEFAULT_MANUFACTURER,
    manufacturerPrefix: env.STICKER_MANUFACTURER_PREFIX ?? MANUFACTURER_PREFIX,
    batchPattern,
    shortBase,
    // Where this application is mounted. Empty means it owns its origin.
    // Behind SH-IT_Hub it is '/stickers', because the Hub already answers
    // /api for its own endpoints. The /J redirect is never prefixed — see
    // the note in http/app.js.
    basePath: env.STICKER_BASE_PATH ?? '',
    shortLinkStorePath: env.STICKER_SHORTLINK_STORE ?? './data/shortlinks.json',
    qrBudgetDots: positiveInt(env.STICKER_QR_BUDGET_DOTS, DEFAULT_QR_BUDGET_DOTS, 'STICKER_QR_BUDGET_DOTS'),
    qrMaxModules: positiveInt(env.STICKER_QR_MAX_MODULES, DEFAULT_QR_MAX_MODULES, 'STICKER_QR_MAX_MODULES'),
    port: number(env.STICKER_PORT, 6969, 'STICKER_PORT', fail),
    host: env.STICKER_HOST ?? '127.0.0.1',
    tmpDir: env.STICKER_TMP ?? './data/uploads',
    archiveDir: env.STICKER_ARCHIVE_DIR ?? './data/jobs',
    // Append-only, and it must outlive a redeploy: this is the record of who
    // printed which batch, and it gets consulted months later.
    auditLogPath: env.STICKER_AUDIT_LOG ?? './data/audit.jsonl',
    jobTtlSeconds: number(env.STICKER_JOB_TTL, 1800, 'STICKER_JOB_TTL', fail),
    maxUploadBytes: number(env.STICKER_MAX_UPLOAD_BYTES, 10 * 1024 * 1024,
      'STICKER_MAX_UPLOAD_BYTES', fail),
    printers: parsePrinters(env.STICKER_PRINTERS, fail),
    // Where the ZPL is delivered from.
    //   webusb   the page itself opens the printer's USB endpoint. Nothing to
    //            install, and unaffected by the page being on HTTPS — but on
    //            Windows the printer must be rebound to WinUSB first.
    //   browser  Zebra Browser Print, a helper application on the operator's
    //            machine. Needs the install; needs the browser to permit the
    //            call to its local HTTP service.
    //   network  this server opens a socket to port 9100. Ethernet Zebras only.
    printTransport: oneOf(env.STICKER_PRINT_TRANSPORT, ['webusb', 'browser', 'network'], 'browser',
      'STICKER_PRINT_TRANSPORT', fail),
    // Above this many labels in one run, the confirmation dialog makes the
    // operator type the number. Accidentally sending four hundred labels is
    // the failure this prevents.
    confirmThreshold: number(env.STICKER_CONFIRM_THRESHOLD, 50, 'STICKER_CONFIRM_THRESHOLD', fail),
    xgdApiKey: env.STICKER_XGD_API_KEY ?? null,
    // x.gd turns click analytics on unless told otherwise. A scan on a factory
    // floor is not something a third party needs a record of, so this defaults
    // off and has to be switched on deliberately.
    xgdAnalytics: boolean(env.STICKER_XGD_ANALYTICS, false, 'STICKER_XGD_ANALYTICS'),
  };

  if (config.xgdApiKey && !/^[0-9a-f]{32}$/i.test(config.xgdApiKey)) {
    fail('STICKER_XGD_API_KEY does not look like an x.gd key (32 hexadecimal characters).');
  }

  if (problems.length > 0) {
    throw new ConfigError(
      `The service cannot start. ${problems.length} configuration ` +
      `${problems.length === 1 ? 'problem' : 'problems'}:\n  - ${problems.join('\n  - ')}`,
      { detail: problems.join('; ') },
    );
  }

  if (options.logger) {
    options.logger.info({
      event: 'config.resolved',
      dateOrder: config.dateOrder,
      dateOrderSource: env.STICKER_DATE_ORDER ? 'environment' : 'default',
      example: describeDateOrder(config.dateOrder),
      manufacturer: config.defaultManufacturer,
      batchPattern: config.batchPattern?.source ?? '(none enforced)',
      shortBase: config.shortBase ?? '(not set)',
      shortener: config.xgdApiKey ? 'x.gd' : 'manual (no API key)',
      printTransport: config.printTransport,
      printers: Object.keys(config.printers).length,
      listen: `${config.host}:${config.port}`,
    });
  }

  return config;
}

/**
 * @param {string} raw
 * @returns {string} origin with any trailing slash removed
 */
function normaliseOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new ConfigError(`STICKER_SHORT_BASE is not a valid URL: "${raw}".`, { cause });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`STICKER_SHORT_BASE must be http or https. Received "${raw}".`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Printers as `name=host:port,dpi`, comma-separated between machines.
 * @param {string|undefined} raw
 * @param {(message: string) => void} fail
 * @returns {Record<string, { host: string, port: number, dpi: number }>}
 */
function parsePrinters(raw, fail) {
  /** @type {Record<string, { host: string, port: number, dpi: number }>} */
  const printers = {};
  if (!raw) return printers;
  for (const entry of raw.split(';').map((part) => part.trim()).filter(Boolean)) {
    const match = /^([\w-]+)=([^:]+):(\d+)(?:,(\d+))?$/.exec(entry);
    if (!match) {
      fail(`STICKER_PRINTERS entry "${entry}" is not in the form name=host:port,dpi.`);
      continue;
    }
    printers[match[1]] = {
      host: match[2],
      port: Number(match[3]),
      dpi: match[4] ? Number(match[4]) : 203,
    };
  }
  return printers;
}

/**
 * @param {string|undefined} raw
 * @param {number} fallback
 * @param {string} name
 * @param {(message: string) => void} fail
 * @returns {number}
 */
function number(raw, fallback, name, fail) {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`${name} must be a positive whole number. Received "${raw}".`);
    return fallback;
  }
  return parsed;
}

/**
 * @param {string|undefined} raw
 * @param {string[]} allowed
 * @param {string} fallback
 * @param {string} name
 * @param {(message: string) => void} fail
 * @returns {string}
 */
function oneOf(raw, allowed, fallback, name, fail) {
  if (raw === undefined || raw === '') return fallback;
  if (!allowed.includes(raw)) {
    fail(`${name} must be one of ${allowed.join(', ')}. Received "${raw}".`);
    return fallback;
  }
  return raw;
}

/**
 * @param {string|undefined} raw
 * @param {boolean} fallback
 * @param {string} name
 * @returns {boolean}
 */
function boolean(raw, fallback, name) {
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ConfigError(`${name} must be "true" or "false". Received "${raw}".`);
}

/**
 * @param {string|undefined} raw
 * @param {number} fallback
 * @param {string} name
 * @returns {number}
 */
function positiveInt(raw, fallback, name) {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive whole number. Received "${raw}".`);
  }
  return parsed;
}

/**
 * A worked example of the resolved order, so the boot log is unambiguous to
 * whoever reads it rather than requiring them to know the acronym.
 * @param {DateOrder} order
 * @returns {string}
 */
export function describeDateOrder(order) {
  return {
    MDY: '09/04/2026 is read as 4 September 2026',
    DMY: '09/04/2026 is read as 9 April 2026',
    YMD: '2026/09/04 is read as 4 September 2026',
  }[order];
}
