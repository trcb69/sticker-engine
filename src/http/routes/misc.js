/**
 * Template, short-link and health routes.
 */

import { Router } from 'express';
import { AppError } from '../../errors.js';
import { BadRequestError } from './jobs.js';

/**
 * The resolved template, for the browser preview canvas.
 *
 * The canvas renderer consumes exactly this — the same geometry the ZPL
 * emitter uses — which is what stops the preview and the printed label from
 * drifting apart.
 * @param {{ template: (dpi: number) => object }} deps
 */
export function templateRoutes(deps) {
  const router = Router();
  router.get('/', (req, res) => {
    const dpi = Number(req.query.dpi ?? 203);
    if (![203, 300, 600].includes(dpi)) {
      throw new BadRequestError(`Print resolution must be 203, 300 or 600. Received "${req.query.dpi}".`);
    }
    res.json(deps.template(dpi));
  });
  return router;
}

/**
 * @param {{ shortLinks: object }} deps
 */
export function shortLinkRoutes(deps) {
  const router = Router();

  router.post('/', async (req, res) => {
    const url = req.body?.url;
    if (typeof url !== 'string' || url.trim() === '') {
      throw new BadRequestError('Send the ClickUp link as { "url": "https://..." }.');
    }
    const link = await deps.shortLinks.mint(url);
    res.status(link.reused ? 200 : 201).json({
      code: link.code,
      shortUrl: link.shortUrl,
      qrPayload: link.qrPayload,
      plan: link.plan,
      reused: link.reused,
    });
  });

  return router;
}

/**
 * Local redirect for archived short codes.
 *
 * The printed QR points at the provider, not here — this resolves a code from
 * the local archive, which is what makes a label traceable if the provider is
 * unreachable or gone.
 *
 * Matching is case-insensitive. A code read off a printed label may be typed in
 * either case, even though an HTTP path is case-sensitive by default.
 *
 * @param {{ shortLinks: object }} deps
 */
export function redirectRoute(deps) {
  const router = Router();
  router.get('/:code', async (req, res) => {
    const result = await deps.shortLinks.redirectFor(req.params.code);
    if (result.status === 404) {
      res.status(404).json({
        error: {
          code: 'SHORTLINK_NOT_FOUND',
          message: result.message,
          requestId: req.id,
        },
      });
      return;
    }
    res.redirect(302, result.location);
  });
  return router;
}

/**
 * Configured printers, for the selector.
 * @param {{ config: object }} deps
 */
export function printerRoutes(deps) {
  const router = Router();
  router.get('/', (req, res) => {
    res.json({
      printers: Object.entries(deps.config.printers).map(([name, printer]) => ({
        name, host: printer.host, port: printer.port, dpi: printer.dpi,
      })),
    });
  });
  return router;
}

/**
 * Print runs: verification and status.
 * @param {{ runs: object }} deps
 */
export function runRoutes(deps) {
  const router = Router();

  router.get('/:runId', (req, res) => {
    res.json({ run: deps.runs.get(req.params.runId) });
  });

  router.post('/:runId/sent', async (req, res) => {
    // What the operator's machine reports back after handing the ZPL to a USB
    // printer. This, not the print request, is what writes the audit trail.
    const run = await deps.runs.settle({
      runId: req.params.runId,
      ok: req.body?.ok === true,
      deviceName: typeof req.body?.deviceName === 'string' ? req.body.deviceName : undefined,
      error: typeof req.body?.error === 'string' ? req.body.error : undefined,
    });
    res.json({ run });
  });

  router.post('/:runId/verify', async (req, res) => {
    const operator = String(req.get('x-operator') ?? req.body?.operator ?? '').trim()
      || 'unattributed';
    const run = await deps.runs.verify({
      runId: req.params.runId,
      scanned: req.body?.scanned,
      operator,
    });
    res.json({ run });
  });

  return router;
}

/**
 * What the short-link service will actually do if asked.
 *
 * @param {{ config: object, shortLinks?: object }} deps
 */
function describeShortener(deps) {
  const provider = deps.shortLinks?.providerId ?? null;

  if (provider === 'self-hosted') {
    return {
      ok: true,
      provider,
      detail: `Self-hosted: codes are minted and resolved at ${deps.config.shortBase}/J/<code>`,
    };
  }
  if (provider === 'x.gd') {
    return { ok: true, provider, detail: 'API key configured' };
  }
  return {
    ok: true,
    provider: provider ?? 'manual',
    // Not a failure — the service runs fine — but it is the reason an operator
    // will be told a link cannot be created, so it belongs here in words.
    detail: 'No shortener configured: set STICKER_SHORT_BASE, or shorten links by hand and adopt them',
  };
}

/**
 * Health.
 *
 * Point monitoring at this. It is the difference between "labels stopped
 * working this morning" and "poppler is missing on the label host".
 *
 * @param {{ config: object, jobStore: object, probes: object, version?: string }} deps
 */
export function healthRoutes(deps) {
  const router = Router();

  router.get('/', async (req, res) => {
    const checks = {};

    checks.poppler = await safely(() => deps.probes.poppler());
    // Reported from the provider actually in use, not inferred from one env
    // var. Health that describes a different system than the one running is
    // worse than no health at all.
    checks.shortener = describeShortener(deps);
    checks.printers = await safely(() => deps.probes.printers());
    checks.jobs = { ok: true, active: deps.jobStore.size };

    // Degraded, not down. Poppler missing stops uploads; an unreachable
    // printer does not stop an operator preparing a job. Reporting both as
    // "unhealthy" would train whoever watches this to ignore it.
    const failing = Object.entries(checks).filter(([, check]) => check.ok === false);
    const status = checks.poppler.ok === false ? 'unhealthy'
      : failing.length > 0 ? 'degraded' : 'ok';

    res.status(status === 'unhealthy' ? 503 : 200).json({
      status,
      version: deps.version ?? '0.1.0',
      dateOrder: deps.config.dateOrder,
      // Sent so the browser does not carry its own copy of a limit that lives
      // in configuration.
      confirmThreshold: deps.config.confirmThreshold,
      // The browser needs to know which delivery path to take before it can
      // offer a printer selector at all.
      printTransport: deps.config.printTransport,
      checks,
    });
  });

  return router;
}

/** @param {() => Promise<object>} probe */
async function safely(probe) {
  try {
    return await probe();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof AppError ? error.message : 'The check could not be run.',
    };
  }
}
