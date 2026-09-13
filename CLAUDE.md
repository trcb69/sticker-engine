# sticker-engine

Project specifics. The operating doctrine (pipeline, gates, VPS rules) is in
`/root/.claude/CLAUDE.md` and applies here too.

> Drafted 2026-09-13 from the code and `/root/Project Management` docs. Confirm
> or correct each line — this section is what stops the agents guessing.

## 7. Project specifics

- **Stack:** Node.js (production runs 24.18 under PM2; `engines` allows ≥20; CI uses 24), ES modules, Express. Zebra 4×1 in drum labels, ZPL. Bound to 127.0.0.1:6969 and served through SH-IT Hub at `/stickers`.
- **Run locally:** `node --env-file=.env.dev --watch src/server.js` → http://127.0.0.1:6970/ (committed, no secrets, data under `./data/dev`). `npm run dev` needs a `.env`, which clones do not have.
- **Test command:** `npm test` (node:test; 497 tests as of 2026-09-13, ~8 s). Browser checks in `test/browser/` need the dev instance running — see *Debug loop*.
- **Lint / typecheck:** none configured.
- **Database and migrations:** none. The job store is in-process, which is why PM2 runs a single fork-mode instance.
- **Known traps:**
  - Preview and ZPL share one layout module (`src/render/layout.js`). A preview/print disagreement is a bug in that module, not a drift between two.
  - `public/` is served with `Cache-Control: no-cache`, so front-end changes are live without a restart (`shdeploy` skips it).
  - Cluster mode would break the job store and the per-printer print queue. Keep one instance.
  - The canvas preview must stay at whole device pixels per dot — see `public/js/pixelFit.js` and its tests.
- **Live copy (never edit):** `/root/sticker-engine` — PM2 process `sticker-engine`. Deploy with `shdeploy sticker-engine` after pushing.
- **Before changing unfamiliar code:** `/understand <area>`. Architecture: `/root/Project Management/ARCHITECTURE.md`.

## Debug loop

```
edit ──► dev instance :6970 (--watch) ──► failing test ──► fix ──► npm test ──► one browser check
```

1. **Start the dev instance** in the background: `node --env-file=.env.dev --watch src/server.js`. Front-end edits need only a reload; server edits restart it.
2. **Reproduce as a failing test first** under `test/*.test.js` — layout, parsing and ZPL bugs can all be pinned without a browser (`test/pixelFit.test.js`, `test/layout.test.js`). Screenshots confirm a fix; they do not find one.
3. **Fix, then `npm test`** after every change, not once at the end.
4. **Confirm in a real browser** with a committed check, not a new throwaway script:
   - `node test/browser/smoke.mjs [doc.pdf …]` — page text, preview ink, every console error and failed request.
   - `node test/browser/calibrate.spec.mjs` — calibrate mode end to end (15 checks).
   - `node test/browser/slot-map.mjs [doc.pdf …]` — which slot each click on the preview selects.
   A check that proves useful twice belongs in `test/browser/`. Screenshots go to `./data/dev/browser/` (ignored by git).
5. **Settings** (environment): `STICKER_BROWSER_URL` (default `http://127.0.0.1:6970`), `STICKER_BROWSER_PDF` (default `/root/Sticker gen/PKG-146468.PDF`), `STICKER_BROWSER_OUT`. Playwright is a devDependency; it drives the system Chrome at `/usr/bin/google-chrome`, because its own browser download is blocked from this box — never run `npx playwright install`.

- **Never point a check at production** (`https://127.0.0.1:3001/stickers`, the live Hub) without the human's go-ahead: every upload there creates a job and stores the PDF in production's upload folder.
- Ports: 6969 is production, 6970 this dev instance. The safe-to-reopen spec (`docs/specs/2026-09-13-safe-to-reopen.md`, untracked in the main clone as of 2026-09-13) uses 6975 (engine) and 3101 (Hub) — leave those free.

## Sessions

- **Start:** `git log --oneline -10`, `git status` (untracked files count — specs are often not committed yet), and the newest file in `docs/specs/` if there is one — that is where the last session stopped. Check `git worktree list` too; another session may be working on a branch.
- **End:** commit or state what is uncommitted, then `/retro`.
