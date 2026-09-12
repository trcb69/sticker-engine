/**
 * Short links.
 *
 * The QR cannot carry a ClickUp form URL: at 60 characters it needs 37 modules
 * and drops to 2 dots per module in the label's 96-dot budget, which scans
 * intermittently. It has to be shortened.
 *
 * Shortening goes through a provider. The default is self-hosted: this service
 * already answers /j/:code from its own archive, so a code can be minted with
 * no third party, no API key and no rate limit, and the printed QR points at a
 * host we control. x.gd remains available for the stronger error correction a
 * shorter domain buys. Either way two things are non-negotiable here:
 *
 *   1. Every mapping is written to the local store as well. If x.gd ever goes
 *      away the printed QR codes stop resolving and nothing can fix that, but
 *      at least the record of what each one meant survives.
 *   2. The provider is an injected interface. Moving to a self-hosted redirect
 *      later is a new provider, not a rewrite.
 *
 * Case matters more than it looks. QR alphanumeric mode covers only uppercase,
 * digits and a few symbols; one lowercase character forces byte mode and costs
 * symbol size. But an HTTP *path* is case-sensitive, so uppercasing a link
 * someone else generated silently breaks it. The rule below is therefore:
 * uppercase the scheme and host, which RFC 3986 makes case-insensitive, and
 * never touch the path. The win is taken at mint time instead, by asking x.gd
 * for an all-uppercase custom id.
 */

import { AppError } from '../errors.js';
import { planQr } from '../render/symbology.js';

export class ShortLinkError extends AppError {
  static code = 'SHORTLINK_FAILED';
  static httpStatus = 502;
}

export class QrPayloadTooDenseError extends AppError {
  static code = 'QR_PAYLOAD_TOO_DENSE';
  static httpStatus = 400;
}

/**
 * Uppercase only, and without the characters an operator misreads when typing
 * a code off a printed label. These are the system's own values, so pruning
 * the alphabet costs nothing and removes a whole class of support call.
 */
export const SHORT_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** x.gd requires a custom id of 6 to 15 characters. */
export const SHORT_ID_LENGTH = 6;

/** Strongest first. The best that still clears the dot floor is chosen. */
export const ECC_PREFERENCE = Object.freeze(['Q', 'M']);

/**
 * @param {() => number} random
 * @param {number} [length]
 * @returns {string}
 */
export function generateShortId(random, length = SHORT_ID_LENGTH) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SHORT_ID_ALPHABET[Math.floor(random() * SHORT_ID_ALPHABET.length)];
  }
  return out;
}

/**
 * Turn a short URL into the string the QR encodes.
 *
 * Scheme and host are uppercased because they are case-insensitive. The path
 * is left exactly as issued, because it is not.
 *
 * @param {string} shortUrl
 * @returns {string}
 */
export function toQrPayload(shortUrl) {
  const url = parseHttpUrl(shortUrl, 'short link');
  // `url.host` already carries the port when there is one — appending
  // `url.port` again doubled it (45.151.122.105:3001:3001). Invisible with
  // x.gd, which has no port; immediately wrong with a self-hosted redirect.
  return `${url.protocol.toUpperCase()}//${url.host.toUpperCase()}${url.pathname}${url.search}`;
}

/**
 * Choose the strongest error correction that still meets the dot floor, and
 * refuse anything that cannot.
 *
 * @param {string} payload
 * @param {{ budgetDots?: number, maxModules?: number, minDotsPerModule?: number }} [options]
 * @returns {{ ecc: 'L'|'M'|'Q'|'H', mode: string, modules: number, magnification: number,
 *            size: number, version: number }}
 */
export function planPayload(payload, options = {}) {
  const budgetDots = options.budgetDots ?? 96;
  const maxModules = options.maxModules ?? 29;
  const floor = options.minDotsPerModule ?? 3;

  let best = null;
  for (const ecc of ECC_PREFERENCE) {
    const plan = planQr(payload, budgetDots, { ecc });
    if (!plan.version) continue;
    if (plan.totalModules > maxModules) continue;
    if (plan.magnification < floor) continue;
    best = plan;
    break;
  }

  if (!best) {
    const attempted = planQr(payload, budgetDots, { ecc: 'M' });
    throw new QrPayloadTooDenseError(
      `"${payload}" is too long for the QR on this label. ` +
      `It needs ${attempted.totalModules || 'more than 29'} modules, and only ${maxModules} fit ` +
      `at ${floor} dots each. Shorten the link before printing.`,
      { detail: `chars=${payload.length} mode=${attempted.mode} budget=${budgetDots}` },
    );
  }

  return {
    ecc: best.ecc,
    mode: best.mode,
    modules: best.totalModules,
    magnification: best.magnification,
    size: best.size,
    version: best.version,
  };
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} ShortLinkProvider
 * @property {string} id
 * @property {boolean} canMint
 * @property {(request: { url: string, shortId: string }) => Promise<{ shortUrl: string }>} [shorten]
 */

/** x.gd status codes that mean "try a different id". */
const ALIAS_TAKEN = 409;

/**
 * x.gd provider.
 *
 * Analytics defaults to off. x.gd enables it unless told otherwise, and a scan
 * on a factory floor is not something a third party needs a record of.
 *
 * @param {{ apiKey: string, fetch?: typeof globalThis.fetch, endpoint?: string,
 *           analytics?: boolean, filterBots?: boolean, timeoutMs?: number }} options
 * @returns {ShortLinkProvider}
 */
export function createXgdProvider(options) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? 'https://xgd.io/V1/shorten';
  const timeoutMs = options.timeoutMs ?? 10000;

  if (!options.apiKey) {
    throw new ShortLinkError(
      'No x.gd API key is configured. Set STICKER_XGD_API_KEY.',
      { detail: 'request a key at https://x.gd/en/developer' },
    );
  }

  return {
    id: 'x.gd',
    canMint: true,
    async shorten({ url, shortId }) {
      const query = new URLSearchParams({
        url,
        shortid: shortId,
        key: options.apiKey,
        analytics: String(options.analytics ?? false),
        filterbots: String(options.filterBots ?? false),
      });

      let response;
      let body;
      try {
        response = await fetchImpl(`${endpoint}?${query}`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        body = await response.json();
      } catch (cause) {
        throw new ShortLinkError(
          'Could not reach the link shortener. Check the connection and try again.',
          { cause, detail: `endpoint=${endpoint}` },
        );
      }

      // x.gd reports failures in the body, with HTTP 200 on the envelope, so
      // the HTTP status alone is not a reliable success signal.
      const status = Number(body?.status ?? response.status);
      if (status === 200 && typeof body.shorturl === 'string') {
        return { shortUrl: body.shorturl };
      }

      const err = new ShortLinkError(describeXgdStatus(status, body?.message), {
        detail: `x.gd status=${status} message=${body?.message ?? '(none)'}`,
      });
      err.providerStatus = status;
      err.retryable = status === ALIAS_TAKEN;
      throw err;
    },
  };
}

/**
 * @param {number} status
 * @param {string|undefined} message
 * @returns {string}
 */
function describeXgdStatus(status, message) {
  switch (status) {
    case 400: return `The link shortener rejected the request: ${message ?? 'bad request'}.`;
    case 401: return 'The x.gd API key is not valid. Check STICKER_XGD_API_KEY.';
    case 403: return 'The link shortener is unavailable for this account.';
    case ALIAS_TAKEN: return 'That short code is already taken.';
    case 429: return 'The x.gd rate limit has been reached. Wait a little and try again — ' +
      'no labels have been printed.';
    case 500:
    case 503: return 'The link shortener is temporarily unavailable. Try again shortly.';
    default: return `The link shortener returned an unexpected status (${status}).`;
  }
}

/**
 * Self-hosted provider.
 *
 * Mints nothing remotely: the short URL is this service's own /j/:code route,
 * and the archive that route already reads is the authority for what exists.
 * That removes the outside dependency the module header warns about — a drum
 * labelled today resolves for as long as this host does, which is a promise we
 * can actually keep.
 *
 * The path is uppercase `/J` deliberately. QR alphanumeric mode covers only
 * uppercase, digits and a few symbols, and one lowercase character forces byte
 * mode and costs symbol size. Uppercasing someone else's path would be wrong —
 * but this path is ours, so the win is free. Express matches case-insensitively
 * by default, so /j/:code still answers.
 *
 * @param {{ baseUrl: string, path?: string }} options
 * @returns {ShortLinkProvider}
 */
export function createSelfHostedProvider(options) {
  const base = String(options.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new ShortLinkError(
      'No public base URL is configured for self-hosted short links. Set STICKER_SHORT_BASE.',
      { detail: 'e.g. STICKER_SHORT_BASE=https://standard-holdings.lk' },
    );
  }
  const path = (options.path ?? '/J').replace(/\/+$/, '');

  return {
    id: 'self-hosted',
    canMint: true,
    async shorten({ shortId }) {
      return { shortUrl: `${base}${path}/${shortId}` };
    },
  };
}

/**
 * A provider for when no API key is configured.
 *
 * Minting is refused, but a link the operator shortened by hand can still be
 * adopted, so the system is usable before an API key arrives.
 * @returns {ShortLinkProvider}
 */
export function createManualProvider() {
  return { id: 'manual', canMint: false };
}

/* -------------------------------------------------------------------------- */
/* Stores                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} ShortLinkStore
 * @property {() => Promise<Record<string, ShortLinkRecord>>} load
 * @property {(records: Record<string, ShortLinkRecord>) => Promise<void>} save
 */

/**
 * @typedef {object} ShortLinkRecord
 * @property {string} code
 * @property {string} shortUrl
 * @property {string} target
 * @property {string} provider
 * @property {string} createdAt
 */

/**
 * @param {Record<string, ShortLinkRecord>} [initial]
 * @returns {ShortLinkStore}
 */
export function createMemoryStore(initial = {}) {
  let records = { ...initial };
  return {
    async load() { return { ...records }; },
    async save(next) { records = { ...next }; },
  };
}

/**
 * @param {string} path
 * @param {{ readFile?: Function, writeFile?: Function, mkdir?: Function }} [io]
 * @returns {ShortLinkStore}
 */
export function createJsonFileStore(path, io = {}) {
  return {
    async load() {
      const { readFile } = io.readFile ? io : await import('node:fs/promises');
      try {
        return JSON.parse(await (io.readFile ?? readFile)(path, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return {};
        throw new ShortLinkError(
          `The short-link store at ${path} could not be read.`,
          { cause: error },
        );
      }
    },
    async save(records) {
      const fs = io.writeFile ? io : await import('node:fs/promises');
      const dir = path.replace(/[^/\\]+$/, '');
      if (dir) await (io.mkdir ?? fs.mkdir)(dir, { recursive: true });
      await (io.writeFile ?? fs.writeFile)(path, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @param {{ provider: ShortLinkProvider, store: ShortLinkStore, budgetDots?: number,
 *           maxModules?: number, minDotsPerModule?: number, random?: () => number,
 *           now?: () => string, maxAttempts?: number }} options
 */
export function createShortLinkService(options) {
  const { provider, store } = options;
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => new Date().toISOString());
  const maxAttempts = options.maxAttempts ?? 5;
  const planOptions = {
    budgetDots: options.budgetDots,
    maxModules: options.maxModules,
    minDotsPerModule: options.minDotsPerModule,
  };

  /** @type {Record<string, ShortLinkRecord>|null} */
  let cache = null;
  const records = async () => {
    if (cache === null) cache = await store.load();
    return cache;
  };

  const describe = (record) => {
    const qrPayload = toQrPayload(record.shortUrl);
    return { ...record, qrPayload, plan: planPayload(qrPayload, planOptions) };
  };

  return {
    /** Which provider is in use, so health can report the truth rather than infer it. */
    providerId: provider.id,

    /**
     * Mint a short link for a target URL.
     *
     * Re-pasting a target that has already been shortened returns the existing
     * code. Minting a second link for the same destination would leave two
     * codes in circulation for one form, and no way to tell from a printed
     * drum which was which.
     *
     * @param {string} targetUrl
     * @returns {Promise<ShortLinkRecord & { qrPayload: string, plan: object, reused: boolean }>}
     */
    async mint(targetUrl) {
      const target = parseHttpUrl(targetUrl, 'ClickUp link').toString();
      const existing = Object.values(await records()).find((r) => r.target === target);
      if (existing) return { ...describe(existing), reused: true };

      if (!provider.canMint) {
        throw new ShortLinkError(
          'No link shortener is configured, so a short link cannot be created automatically. ' +
          'Shorten the link at x.gd and paste the short link instead.',
          { detail: `provider=${provider.id}` },
        );
      }

      const taken = new Set(Object.keys(await records()));
      let lastError = null;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const code = generateShortId(random);
        if (taken.has(code)) continue;
        try {
          const { shortUrl } = await provider.shorten({ url: target, shortId: code });
          // Plan before storing. A link that cannot be encoded is not a link
          // worth recording, and the operator needs to know now rather than at
          // the printer.
          const record = {
            code, shortUrl, target, provider: provider.id, createdAt: now(),
          };
          const described = describe(record);
          const next = { ...(await records()), [code]: record };
          await store.save(next);
          cache = next;
          return { ...described, reused: false };
        } catch (error) {
          lastError = error;
          if (error?.retryable) { taken.add(code); continue; }
          throw error;
        }
      }

      throw new ShortLinkError(
        `Could not find a free short code after ${maxAttempts} attempts.`,
        { cause: lastError },
      );
    },

    /**
     * Record a short link the operator created by hand.
     * @param {string} shortUrl
     * @param {string} targetUrl
     */
    async adopt(shortUrl, targetUrl) {
      const short = parseHttpUrl(shortUrl, 'short link');
      const target = parseHttpUrl(targetUrl, 'ClickUp link').toString();
      const code = short.pathname.replace(/^\/+/, '');
      if (!code) {
        throw new ShortLinkError(`"${shortUrl}" has no short code in it.`);
      }
      const record = {
        code, shortUrl: short.toString(), target, provider: 'manual', createdAt: now(),
      };
      const described = describe(record);
      const next = { ...(await records()), [code]: record };
      await store.save(next);
      cache = next;
      return { ...described, reused: false };
    },

    /**
     * Look a code up in the local archive.
     *
     * Case-insensitive, because a code read off a printed label may be typed
     * in either case even though the provider's own path is case-sensitive.
     * An exact match always wins.
     *
     * @param {string} code
     * @returns {Promise<ShortLinkRecord|null>}
     */
    async lookup(code) {
      if (typeof code !== 'string' || code === '') return null;
      const all = await records();
      if (all[code]) return all[code];
      const upper = code.toUpperCase();
      return Object.values(all).find((r) => r.code.toUpperCase() === upper) ?? null;
    },

    /**
     * What a redirect route would answer. Kept here so the archive's behaviour
     * is testable without an HTTP server.
     * @param {string} code
     */
    async redirectFor(code) {
      const record = await this.lookup(code);
      if (!record) {
        return { status: 404, message: 'That short code is not in the archive.' };
      }
      return { status: 302, location: record.target, code: record.code };
    },

    /** Every mapping, for archiving alongside a job. */
    async archive() {
      return { ...(await records()) };
    },
  };
}

/**
 * @param {string} raw
 * @param {string} what
 * @returns {URL}
 */
function parseHttpUrl(raw, what) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch (cause) {
    throw new ShortLinkError(`That ${what} is not a valid URL: "${raw}".`, { cause });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ShortLinkError(`A ${what} must start with http:// or https://.`);
  }
  return url;
}
