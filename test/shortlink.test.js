import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createShortLinkService, createXgdProvider, createManualProvider, createSelfHostedProvider,
  createMemoryStore, createJsonFileStore, generateShortId, toQrPayload, planPayload,
  ShortLinkError, QrPayloadTooDenseError, SHORT_ID_ALPHABET, SHORT_ID_LENGTH,
} from '../src/enrich/shortlink.js';
import { validateBatchCode } from '../src/enrich/batch.js';

const CLICKUP = 'https://forms.clickup.com/9012345678/f/8abcde-1234/XYZ123ABC';

/** Deterministic pseudo-random, so short codes are reproducible in tests. */
function seeded(seed = 1) {
  let state = seed;
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
}

/**
 * Stands in for x.gd. Records every request so the test can assert on what was
 * actually asked for.
 */
function fakeXgd({ taken = new Set(), status = 200, message } = {}) {
  const calls = [];
  const fetch = async (url) => {
    const q = new URL(url).searchParams;
    const shortId = q.get('shortid');
    calls.push({ url: q.get('url'), shortId, key: q.get('key'), analytics: q.get('analytics') });
    if (status !== 200) return { json: async () => ({ status, message }) };
    if (taken.has(shortId)) return { json: async () => ({ status: 409, message: 'taken' }) };
    return {
      json: async () => ({
        status: 200, shorturl: `https://x.gd/${shortId}`, originalurl: q.get('url'),
      }),
    };
  };
  return { fetch, calls };
}

const service = (overrides = {}) => {
  const xgd = overrides.xgd ?? fakeXgd();
  return {
    xgd,
    svc: createShortLinkService({
      provider: overrides.provider ?? createXgdProvider({
        apiKey: '0af50e06255c7004f9ad71338f5ad56e',
        fetch: xgd.fetch,
        ...overrides.providerOptions,
      }),
      store: overrides.store ?? createMemoryStore(),
      random: overrides.random ?? seeded(),
      now: () => '2026-09-06T00:00:00.000Z',
      ...overrides.serviceOptions,
    }),
  };
};

/* -- Short ids ------------------------------------------------------------ */

test('short ids avoid the characters an operator misreads', () => {
  for (const banned of ['O', '0', 'I', '1']) {
    assert.ok(!SHORT_ID_ALPHABET.includes(banned), banned);
  }
  assert.match(SHORT_ID_ALPHABET, /^[A-Z2-9]+$/, 'uppercase only, so QR stays alphanumeric');
});

test('short ids are six characters, meeting the x.gd minimum', () => {
  assert.equal(SHORT_ID_LENGTH, 6);
  const id = generateShortId(seeded());
  assert.equal(id.length, 6);
  assert.match(id, /^[0-9a-zA-Z_]{6,15}$/, 'inside the format x.gd accepts');
});

/* -- QR payload ----------------------------------------------------------- */

test('the scheme and host are uppercased, because they are case-insensitive', () => {
  assert.equal(toQrPayload('https://x.gd/HFH7K2'), 'HTTPS://X.GD/HFH7K2');
});

test('a port appears once, not twice', () => {
  // `url.host` already carries the port. Appending `url.port` as well produced
  // HTTPS://45.151.122.105:3001:3001/J/HFH7K2 — an unreachable URL printed
  // permanently onto a drum. x.gd has no port, so nothing caught it until the
  // redirect was self-hosted.
  assert.equal(
    toQrPayload('https://45.151.122.105:3001/J/HFH7K2'),
    'HTTPS://45.151.122.105:3001/J/HFH7K2',
  );
});

test('a self-hosted redirect on the apex domain still fits the label', () => {
  // 37 characters. The ceiling is 38, so the 6-character code is not
  // negotiable — see SHORT_ID_LENGTH.
  const plan = planPayload(toQrPayload('https://standard-holdings.lk/J/HFH7K2'));
  assert.equal(plan.mode, 'alphanumeric');
  assert.ok(plan.magnification >= 3, 'clears the dot floor');
  assert.ok(plan.modules <= 29, 'fits the label budget');
});

test('the path is left exactly as issued, because it is not case-insensitive', () => {
  // Uppercasing a code someone else generated points the QR at a different
  // link, or at nothing.
  assert.equal(toQrPayload('https://x.gd/aB3xK9'), 'HTTPS://X.GD/aB3xK9');
});

test('an all-uppercase code buys alphanumeric mode and stronger correction', () => {
  const upper = planPayload(toQrPayload('https://x.gd/HFH7K2'));
  const mixed = planPayload(toQrPayload('https://x.gd/aB3xK9'));
  assert.equal(upper.mode, 'alphanumeric');
  assert.equal(mixed.mode, 'byte');
  assert.equal(upper.ecc, 'Q', 'the strongest that still clears the dot floor');
  assert.ok(upper.magnification >= 3);
  assert.ok(mixed.magnification >= 3, 'a mixed-case code still scans, just with less headroom');
});

test('a raw ClickUp URL is refused with a reason, not encoded badly', () => {
  assert.throws(
    () => planPayload(CLICKUP.toUpperCase()),
    (error) => {
      assert.ok(error instanceof QrPayloadTooDenseError);
      assert.match(error.message, /too long for the QR/);
      return true;
    },
  );
});

test('the module ceiling is enforced', () => {
  assert.throws(() => planPayload('HTTPS://X.GD/HFH7K2', { maxModules: 20 }), QrPayloadTooDenseError);
});

/* -- Minting -------------------------------------------------------------- */

test('minting asks x.gd for an uppercase custom id and returns a plannable payload', async () => {
  const { svc, xgd } = service();
  const result = await svc.mint(CLICKUP);

  assert.equal(xgd.calls.length, 1);
  assert.equal(xgd.calls[0].url, CLICKUP);
  assert.match(xgd.calls[0].shortId, /^[A-Z2-9]{6}$/);
  assert.equal(result.shortUrl, `https://x.gd/${xgd.calls[0].shortId}`);
  assert.equal(result.qrPayload, `HTTPS://X.GD/${xgd.calls[0].shortId}`);
  assert.equal(result.plan.mode, 'alphanumeric');
  assert.ok(result.plan.magnification >= 3, 'confirmed scannable before anything is printed');
  assert.equal(result.reused, false);
});

test('the self-hosted provider mints from our own origin, with no network call', async () => {
  const svc = createShortLinkService({
    provider: createSelfHostedProvider({ baseUrl: 'https://standard-holdings.lk' }),
    store: createMemoryStore(),
  });
  const result = await svc.mint(CLICKUP);

  assert.match(result.shortUrl, /^https:\/\/standard-holdings\.lk\/J\/[A-Z2-9]{6}$/);
  assert.equal(result.provider, 'self-hosted');
  assert.equal(result.plan.mode, 'alphanumeric', 'the uppercase /J path keeps it out of byte mode');
  assert.ok(result.plan.magnification >= 3, 'still clears the dot floor on the label');
});

test('a self-hosted code resolves from the archive the redirect route reads', async () => {
  // The whole point of self-hosting: the printed QR points at a route this
  // service answers itself, so nothing outside has to stay alive for the label
  // to mean something.
  const svc = createShortLinkService({
    provider: createSelfHostedProvider({ baseUrl: 'https://standard-holdings.lk' }),
    store: createMemoryStore(),
  });
  const { code } = await svc.mint(CLICKUP);

  assert.deepEqual(await svc.redirectFor(code), { status: 302, location: CLICKUP, code });
  const lower = await svc.redirectFor(code.toLowerCase());
  assert.equal(lower.status, 302, 'a code typed off a label in either case still resolves');
});

test('a trailing slash on the base URL does not produce a double slash', async () => {
  const provider = createSelfHostedProvider({ baseUrl: 'https://standard-holdings.lk/' });
  const { shortUrl } = await provider.shorten({ shortId: 'HFH7K2' });
  assert.equal(shortUrl, 'https://standard-holdings.lk/J/HFH7K2');
});

test('self-hosting without a base URL fails loudly rather than minting nonsense', () => {
  assert.throws(() => createSelfHostedProvider({ baseUrl: '' }), /STICKER_SHORT_BASE/);
});

test('analytics is off unless switched on deliberately', async () => {
  const { svc, xgd } = service();
  await svc.mint(CLICKUP);
  assert.equal(xgd.calls[0].analytics, 'false');

  const opted = service({ providerOptions: { analytics: true } });
  await opted.svc.mint(CLICKUP);
  assert.equal(opted.xgd.calls[0].analytics, 'true');
});

test('re-pasting the same target returns the existing code without a second call', async () => {
  const { svc, xgd } = service();
  const first = await svc.mint(CLICKUP);
  const second = await svc.mint(CLICKUP);
  assert.equal(second.code, first.code);
  assert.equal(second.reused, true);
  assert.equal(xgd.calls.length, 1, 'no duplicate link left in circulation');
});

test('a taken code is retried with a new one', async () => {
  const random = seeded();
  const firstId = generateShortId(seeded());
  const xgd = fakeXgd({ taken: new Set([firstId]) });
  const { svc } = service({ xgd, random });
  const result = await svc.mint(CLICKUP);
  assert.notEqual(result.code, firstId);
  assert.equal(xgd.calls.length, 2, 'one rejected, one accepted');
});

test('giving up after repeated collisions is an error, not an infinite loop', async () => {
  const xgd = fakeXgd({ status: 409, message: 'taken' });
  const { svc } = service({ xgd, serviceOptions: { maxAttempts: 3 } });
  await assert.rejects(() => svc.mint(CLICKUP), /Could not find a free short code after 3/);
  assert.equal(xgd.calls.length, 3);
});

test('every x.gd failure becomes an operator-safe message', async () => {
  const cases = [
    [401, /API key is not valid/],
    [429, /rate limit/],
    [503, /temporarily unavailable/],
    [400, /rejected the request/],
  ];
  for (const [status, expected] of cases) {
    const { svc } = service({ xgd: fakeXgd({ status, message: 'detail' }) });
    await assert.rejects(() => svc.mint(CLICKUP), expected, `status ${status}`);
  }
});

test('a rate limit says plainly that nothing was printed', async () => {
  const { svc } = service({ xgd: fakeXgd({ status: 429 }) });
  await assert.rejects(() => svc.mint(CLICKUP), /no labels have been printed/);
});

test('a network failure does not leak the underlying error', async () => {
  const provider = createXgdProvider({
    apiKey: '0af50e06255c7004f9ad71338f5ad56e',
    fetch: async () => { throw new Error('ECONNREFUSED 1.2.3.4:443'); },
  });
  const { svc } = service({ provider });
  await assert.rejects(() => svc.mint(CLICKUP), (error) => {
    assert.match(error.message, /Could not reach the link shortener/);
    assert.ok(!/ECONNREFUSED/.test(error.message));
    return true;
  });
});

test('a missing API key is caught when the provider is built', () => {
  assert.throws(() => createXgdProvider({ apiKey: '' }), /STICKER_XGD_API_KEY/);
});

test('a non-http target is refused before any call is made', async () => {
  const { svc, xgd } = service();
  await assert.rejects(() => svc.mint('ftp://example.com/form'), /must start with http/);
  await assert.rejects(() => svc.mint('not a url'), /not a valid URL/);
  assert.equal(xgd.calls.length, 0);
});

/* -- Manual provider ------------------------------------------------------ */

test('without an API key, minting is refused but a hand-made link can be adopted', async () => {
  const { svc } = service({ provider: createManualProvider() });
  await assert.rejects(() => svc.mint(CLICKUP), /Shorten the link at x\.gd/);

  const adopted = await svc.adopt('https://x.gd/HFH7K2', CLICKUP);
  assert.equal(adopted.code, 'HFH7K2');
  assert.equal(adopted.qrPayload, 'HTTPS://X.GD/HFH7K2');
  assert.equal(adopted.plan.mode, 'alphanumeric');
  assert.equal(await svc.lookup('HFH7K2').then((r) => r.target), CLICKUP);
});

test('adopting a link with no code in it is refused', async () => {
  const { svc } = service({ provider: createManualProvider() });
  await assert.rejects(() => svc.adopt('https://x.gd/', CLICKUP), /no short code/);
});

/* -- Archive and redirect ------------------------------------------------- */

test('the local archive records what every printed code meant', async () => {
  const { svc } = service();
  const minted = await svc.mint(CLICKUP);
  const archive = await svc.archive();
  assert.deepEqual(archive[minted.code], {
    code: minted.code,
    shortUrl: minted.shortUrl,
    target: CLICKUP,
    provider: 'x.gd',
    createdAt: '2026-09-06T00:00:00.000Z',
  });
});

test('a lookup is case-insensitive, since a code may be typed off a label', async () => {
  const { svc } = service();
  const minted = await svc.mint(CLICKUP);
  assert.equal((await svc.lookup(minted.code.toLowerCase())).target, CLICKUP);
  assert.equal((await svc.lookup(minted.code)).target, CLICKUP);
});

test('an unknown code gives 404, a known one gives 302 to the target', async () => {
  const { svc } = service();
  const minted = await svc.mint(CLICKUP);
  assert.deepEqual(await svc.redirectFor('NOPE99'), {
    status: 404, message: 'That short code is not in the archive.',
  });
  assert.deepEqual(await svc.redirectFor(minted.code), {
    status: 302, location: CLICKUP, code: minted.code,
  });
});

test('a blank or missing code never resolves to something', async () => {
  const { svc } = service();
  await svc.mint(CLICKUP);
  for (const bad of ['', null, undefined]) {
    assert.equal(await svc.lookup(bad), null);
  }
});

test('mappings survive a restart through the file store', async () => {
  const files = new Map();
  const store = createJsonFileStore('/tmp/store/shortlinks.json', {
    readFile: async (path) => {
      if (!files.has(path)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; }
      return files.get(path);
    },
    writeFile: async (path, data) => { files.set(path, data); },
    mkdir: async () => {},
  });

  const first = createShortLinkService({
    provider: createXgdProvider({ apiKey: '0af50e06255c7004f9ad71338f5ad56e', fetch: fakeXgd().fetch }),
    store, random: seeded(), now: () => '2026-09-06T00:00:00.000Z',
  });
  const minted = await first.mint(CLICKUP);

  const restarted = createShortLinkService({
    provider: createManualProvider(), store, random: seeded(),
  });
  assert.equal((await restarted.lookup(minted.code)).target, CLICKUP,
    'a label printed today still resolves after a restart');
});

/* -- Interaction with batch codes ----------------------------------------- */

test('the unambiguous alphabet applies to short codes only, never to batch codes', () => {
  // A batch code containing O is warned about and printed as typed. A short
  // code, which the system generates for itself, simply never contains one.
  const validation = validateBatchCode('JUR26O725');
  assert.equal(validation.value, 'JUR26O725', 'unchanged');
  assert.ok(!SHORT_ID_ALPHABET.includes('O'));
});
