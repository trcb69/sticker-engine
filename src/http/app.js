/**
 * Express application.
 *
 * Everything the app touches from the outside world — the filesystem, poppler,
 * the network, the clock — arrives through `deps`. Nothing is imported for its
 * side effects, which is why the whole route suite runs without poppler
 * installed, without a printer and without writing a file.
 */

import express from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId, requestLogging } from './middleware/requestId.js';
import { jobRoutes } from './routes/jobs.js';
import {
  healthRoutes, printerRoutes, redirectRoute, runRoutes, shortLinkRoutes, templateRoutes,
} from './routes/misc.js';

/**
 * @param {object} deps
 * @returns {import('express').Express}
 */
export function createApp(deps) {
  const app = express();
  const basePath = normaliseBasePath(deps.config?.basePath);

  app.disable('x-powered-by');
  app.use(requestId({ id: deps.id }));
  app.use(requestLogging({ logger: deps.logger, now: deps.now }));
  app.use(express.json({ limit: '256kb' }));

  // The redirect stays at the root even when the rest is mounted under a
  // prefix, and this is not a detail. The QR carries the whole URL, the label
  // budget is 38 characters, and https://standard-holdings.lk/J/HFH7K2 already
  // spends 37 of them. A /stickers in front of it would not fit — so a code
  // printed on a drum resolves at the root or it does not resolve at all.
  app.use('/j', redirectRoute(deps));

  const routes = express.Router();

  routes.use('/api/jobs', jobRoutes(deps));
  routes.use('/api/template', templateRoutes(deps));
  routes.use('/api/shortlinks', shortLinkRoutes(deps));
  routes.use('/api/health', healthRoutes(deps));
  routes.use('/api/printers', printerRoutes(deps));
  routes.use('/api/runs', runRoutes(deps));

  // The browser imports the layout, metrics and symbology modules directly.
  // That is the whole reason preview and print cannot drift: there is one
  // implementation, not two that have to be kept in step. Serving them means
  // the source is readable to anyone who can reach the app, which is an
  // acceptable trade for an internal tool on a warehouse network and is worth
  // revisiting if this is ever exposed more widely.
  const srcDir = fileURLToPath(new URL('..', import.meta.url));
  routes.use('/src', express.static(srcDir, {
    index: false,
    extensions: [],
    setHeaders: (res, path) => {
      if (!path.endsWith('.js')) res.status(404);
      res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // The two HTML pages are served through a handler rather than statically,
  // because each carries the mount point the browser needs to find everything
  // else. At the root the substitution writes an empty string and the markup
  // is what it always was.
  const publicDir = fileURLToPath(new URL('../../public', import.meta.url));
  const page = (file) => async (req, res, next) => {
    try {
      const html = await readFile(join(publicDir, file), 'utf8');
      res.type('html')
        .setHeader('Cache-Control', 'no-cache');
      res.send(html.replaceAll('__BASE__', basePath));
    } catch (error) {
      next(error);
    }
  };
  routes.get('/', page('index.html'));
  routes.get('/index.html', page('index.html'));
  routes.get('/diagnostics', page('diagnostics.html'));
  routes.get('/diagnostics.html', page('diagnostics.html'));

  routes.use(express.static(publicDir, {
    extensions: ['html'],
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));

  app.use(basePath === '' ? '/' : basePath, routes);

  app.use(notFoundHandler());
  app.use(errorHandler({ logger: deps.logger }));

  return app;
}

/**
 * '' for the root; otherwise a single leading slash and no trailing one, so
 * `${basePath}/api/jobs` is always well formed.
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
function normaliseBasePath(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '' || trimmed === '/') return '';
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}
