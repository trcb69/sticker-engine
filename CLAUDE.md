# sticker-engine

Project specifics. The operating doctrine (pipeline, gates, VPS rules) is in
`/root/.claude/CLAUDE.md` and applies here too.

> Drafted 2026-09-13 from the code and `/root/Project Management` docs. Confirm
> or correct each line — this section is what stops the agents guessing.

## 7. Project specifics

- **Stack:** Node.js 20 (ES modules), Express. Zebra 4×1 in drum labels, ZPL. Bound to 127.0.0.1:6969 and served through SH-IT Hub at `/stickers`.
- **Run locally:** `npm run dev` on another port, e.g. `STICKER_PORT=6970 npm run dev` (reads `.env` via `--env-file`).
- **Test command:** `npm test` (node:test; 497 tests as of 2026-09-13). Browser check: `test/browser-calibrate.spec.mjs` (Playwright, run from `/root/.render`).
- **Lint / typecheck:** none configured.
- **Database and migrations:** none. The job store is in-process, which is why PM2 runs a single fork-mode instance.
- **Known traps:**
  - Preview and ZPL share one layout module (`src/render/layout.js`). A preview/print disagreement is a bug in that module, not a drift between two.
  - `public/` is served with `Cache-Control: no-cache`, so front-end changes are live without a restart (`shdeploy` skips it).
  - Cluster mode would break the job store and the per-printer print queue. Keep one instance.
  - The canvas preview must stay at whole device pixels per dot — see `public/js/pixelFit.js` and its tests.
- **Live copy (never edit):** `/root/sticker-engine` — PM2 process `sticker-engine`. Deploy with `shdeploy sticker-engine` after pushing.
- **Before changing unfamiliar code:** `/understand <area>`. Architecture: `/root/Project Management/ARCHITECTURE.md`.
