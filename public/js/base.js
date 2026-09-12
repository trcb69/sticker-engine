/**
 * Where this application is mounted.
 *
 * The engine normally owns its origin and every path is absolute from the
 * root. Behind SH-IT_Hub it does not: the Hub owns `/api` for its own gate
 * pass endpoints, so the engine is mounted under a prefix and `/api/jobs`
 * would otherwise reach the wrong service entirely.
 *
 * The prefix is served into the page rather than built in, so the same files
 * work mounted anywhere and unmounted at the root — which is what the tests
 * run against, and what `npm start` gives you.
 *
 * Static `import` specifiers cannot be rewritten at runtime. Those are handled
 * by the import map in index.html instead, which is why `/src/render/layout.js`
 * still reads as an absolute path in render-canvas.js: one implementation of
 * the geometry, wherever the app happens to be mounted.
 */

/** @type {string} '' at the root, otherwise '/stickers' — never with a trailing slash. */
export const BASE = (() => {
  if (typeof document === 'undefined') return '';
  const declared = document.querySelector('meta[name="sticker-base"]')?.content ?? '';
  // The placeholder survives if the page is opened as a file rather than
  // served. Treat that as the root, which is what it is.
  if (!declared || declared.startsWith('__')) return '';
  return declared.replace(/\/+$/, '');
})();

/**
 * @param {string} path Absolute, from the application root.
 * @returns {string}
 */
export function url(path) {
  return `${BASE}${path}`;
}
