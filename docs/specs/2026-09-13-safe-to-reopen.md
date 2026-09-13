# Sticker Engine: safe to reopen (label-station auth, print safety, availability)

Status: spec, **Revision 2.3**, Phase 1 implemented; review round 3 applied. Date: 2026-09-13.
Code baseline: sticker-engine `ead72e7` (dev = live), SH-IT Hub `5027702` (dev = live).
All `file:line` references are to the dev clones `/root/dev/sticker-engine` (engine) and
`/root/dev/SH-IT_Hub` (Hub) at those commits unless a path says otherwise.

## Revision 2.3 (2026-09-13): Phase 1 review fixes (tech lead)

Phase 1 code review: code-reviewer APPROVE WITH CHANGES, security-auditor PASS WITH FINDINGS. The fixes are tested in `SH-IT_Hub/backend/test/reviewFixes.test.js` (`REV_*`). Spec changes:
- **The station gate now requires `role === 'station'`**, at login and on every session check (security-auditor L2). This replaces "the role is not checked; the allowlist is the authority". An allowlisted name that belongs to a manager row, for example one created by managerSync with default PIN 1234, can no longer open `/stickers`.
- **Limiter:**
  - never clears every key at once; it evicts the oldest keys that are not blocked
  - the global count uses a fixed window, O(1) per call
  - IPv4-mapped addresses are normalised; IPv6 addresses are keyed by /64
- **Anti-framing:** `X-Frame-Options: DENY` and `frame-ancestors 'none'` on every gate response and every proxied `/stickers` response.
- **Cookie validation:**
  - canonical MAC string compare
  - canonical uid (no leading zeros)
  - at most 10 `sh_stickers` candidates checked
  - users lookup prepared once
- **Login body parse errors** return a generic 413/415/400 with no stack trace.
- **Logs:**
  - user-supplied names are JSON-encoded in log lines
  - `resolveGateConfig` returns `problems` (variable names only)
  - the missing Observability lines are added
- **`[::1]`** is accepted as an engine host. The dev-trap port check uses `Number(HUB_PORT) || 3001`.
- **`.env.example`** lines that hold default values are commented out.
- **Round 3 (after the fix-verification reviews):**
  - two-map limiter eviction (see the limiter section)
  - the proxied CSP gets `, frame-ancestors 'none'` as a separate policy
  - cookie MAC data is `v1.<uid>.<iat>.<exp>.<role>.<salt>.<hash>`
  - login and session handlers return a generic 500 on internal errors
  - the Origin value is JSON-encoded (≤200 chars) in log lines
  - Tests: `backend/test/round3.test.js`.

## Revision 2.2 (2026-09-13): plan-critic re-review applied

Re-review verdicts: Phase 1 APPROVE WITH CHANGES, Phase 2 APPROVE WITH CHANGES, Phase 2b APPROVE, Phase 3 APPROVE WITH CHANGES. There were no blockers. The tech lead's decisions F1–F9 are applied as follows.

**F1: admin brute-force protection no longer depends on an optional step.**
- **(a) New required release step.** Before `shdeploy gatepass`, every active admin resets their own PIN to at least 12 characters, using the **old** code. Phase 1 release step 2 has the count query and a sign-in check.
  - **UI check (done):** the admin UI does not cap PIN length.
    - PIN inputs at `apps/admin/index.html:341` (login), `:476` (new account) and `:489` (reset) have `inputmode="numeric"` only. There is no `maxlength` or `pattern`.
    - Values are only trimmed (`:562`, `:811`, `:839`), and the server has no length check (`server.js:844-851`, `:867-871`).
    - Admins have no self-service PIN change route. An admin uses **Reset PIN** on their own row (`server.js:865`). That does not end their current session, because sessions are not tied to the PIN (`:674-686`).
    - So no UI cap needs lifting.
  - **Mobile caveat.** `inputmode="numeric"` can show a digits-only keyboard on phones. The generated PINs contain letters, so the release steps say to use a desktop keyboard.
- **(b)** `adminLogin.js` rejects a PIN shorter than 12 characters as a `bad_body` failure.
- **(c)** P1-AC21 adds: a correct but 11-character admin PIN returns 401.
- **(d)** Q7 now blocks the Phase 1 release.
- **(e)** `POST /api/admin/users/reset-pin` rejects a new PIN shorter than 12 characters when the target row's role is `admin` or `station`. Manager and other rows are unchanged.
  - The handler moves to the new module `backend/pinPolicy.js`, which also exports the shared constant.
  - New P1-AC26.
  - Account creation (`server.js:842-851`) is not changed: a short-PIN admin or station created there simply cannot sign in, which fails closed.
- **Also:** R11 re-rated. D8 updated.

**F2: the limiter is per-IP only.**
- The global 429 bucket is removed. Crossing 300 failures in a window now only writes the log line `[login-limiter] global ceiling reached`.
- P1-AC5 and the failure-mode rows are updated.
- Recovery is documented: `pm2 restart gatepass` clears the limiter, and also logs everyone out.
- R16 is re-rated honestly: many-IP guessing is not throttled globally, and PIN length is the only defence against it.

**F3: httpxy skips `proxyReq` when a request carries `Expect`.**
- Confirmed at `node_modules/httpxy/dist/index.mjs:289`: `if (server && !proxyReq.getHeader("expect")) server.emit("proxyReq", …)`.
- Gate rule 4 and `/j` step 5 now clean `req.headers` in the gate middleware **before** calling the proxy:
  - delete `cookie`, `x-operator`, `x-request-id`, `x-admin-token`, `x-manager-token`, `authorization` and `expect`
  - then set `x-operator` (for `/stickers` only)
- `on.proxyReq` stays as a second layer.
- New P1-AC6b.

**F4: several `sh_stickers` cookies.**
- The session is accepted if **any** `sh_stickers` value is valid, using the first valid one in header order.
- The clearing cookie is sent only when none is valid.
- New P1-AC27.

**F5:** `apps/admin/index.html:705` button text becomes `Managers, admins and station`. Added to the admin UI table and P1-AC18.

**F6:** covered by F1(e). R-b and the Rollback table's "Revoke the station only" row now say the new PIN must be at least 12 characters.

**F7: dev environment and PIN generation.**
- `export D` added to the dev engine block.
- PIN generation is now `crypto.randomBytes(12).toString('base64url')`, which gives 16 characters and 96 bits. The earlier "search space at least 10^12" wording is corrected: `randomInt(1e11,1e12)` yields 9×10^11 values.

**F8: check 0.1 no longer gates the Phase 2 deploy.**
- It gates only P2-AC12 and Phase 2b.
- Made consistent in: 0.1 heading and last bullet, the Phase 2 preconditions, the Phase 2 release, the failure-mode row, QZ1/QZ2, and the verdict line.

**F9: real-document line lengths and poppler error mapping.**
- The P2-AC4b sweep also measures each real PDF's longest `pdftotext -layout` line (count only).
- 3.2 now says the killed/maxBuffer error mapping goes in **both** catch blocks, `extract.js:154-160` (pdfinfo) and `:172-178` (pdftotext).

---

## Revision 2.1 (2026-09-13): plan-critic N5 and N6 applied

**N5 (Phase 2 file list was incomplete).** Each reference was checked in the dev clone.
- **`test/http.browserTransport.test.js` added to the Phase 2 files.**
  - Its helper sends the operator as a *header* (`.set('x-operator', 'hadhee')` at `:27`). The assertion `runEntry.operator === 'hadhee'` is at `:117`.
  - Under D9 the operator comes only from the header, so **that assertion still holds unchanged**. The test gains one assertion, `runEntry.operatorName === null` (P2-AC7).
- **P2-AC3's guard stub needs a harness seam.**
  - The harness passes the real `guard` (`test/fixtures/app.js:24` import, `:170` deps).
  - `buildApp(options)` gains `options.guard`: `:170` passes `guard: options.guard ?? guard`, and the JSDoc at `:51-53` gains `guard?: Function`.
- **`README.md:275`** still documents `GET /api/jobs/:id/zpl`. Phase 2b updates it.
- **`bin/sticker.js:195-197`** selects only `ready` lines when `--line` is absent, so a `blocked` line is excluded with no change. `--line N` is recorded as a non-goal.

**N6 (admin UI treats `station` as an employee in three more places).**
- `apps/admin/index.html:694` (hidden-login count) and `:772`/`:777` (search widening) are changed alongside `:673`/`:683`.
- `:700` wording is updated.
- New `.role-station` badge style.
- P1-AC18 extended.

---

## Revision 2 (2026-09-13): changes after plan-critic BLOCK

**Blockers**
- **B1: admin PIN brute force closed in Phase 1.**
  - `POST /api/auth/admin` uses the same login limiter as the station login.
  - It returns one identical 401 body for every failure (P1-AC20–P1-AC23).
  - The handler moves to `backend/adminLogin.js`.
  - The manager login is unchanged; it is not a path to station access.
  - *(Rev 2.2: the admin PIN reset is now required, and short admin PINs are refused.)*
- **B2: WebUSB not yet proven on the station.**
  - Phase 0.1 is a real end-to-end USB print test.
  - Removing the `.zpl` download (old 2.6) moves to a later, separate deploy, **Phase 2b**.
  - Until then `/zpl` stays, but is guarded (2.3, P2-AC5).
  - New HIGH questions QZ1 and QZ2.

**Major**
- **N1:** the cookie is re-issued on a GET once it is older than 1 day (P1-AC24). No per-name lockout. Station PIN minimum is 12. *(Rev 2.2: the limiter is per-IP only.)*
- **N2:** Phase 2, 2b and 3 are separate engine deploys. The rollback rules cover the latest deploy vs an older phase. Never run rollback twice.
- **N3:** real-document guard sweep over a read-only scratchpad copy of the live orphaned PDFs. New HIGH question QG.
- **N4:** `HUB_HOST`; the dev Hub binds 127.0.0.1; no literal PINs anywhere.

**Minor**
- **N5–N7:** login body type/array/length checks (the full N5/N6 are in Rev 2.1).
- **N8:** `/j` depends only on the engine URL. The upstream path is built as `/j/<code>`. Absolute-form request targets are rejected.
- **N9:** even-length hex secret, synchronous limiter, Traefik caveat (R12).
- **N10:** the station row is created before the deploy; the shell environment is `unset` before `shdeploy`.
- **N11:** `bash -c` wrapper on 0.6.
- **N12:** P1-AC16 checks for a 404 on the live engine; no timing ACs; test script `node --test test/*.test.js`.
- **N13:** boot sweep in the listen callback; listen-error fix in Phase 3; stray processes killed as a precondition.
- **N14:** R13 and R14.
- **N15:** 2.8 kept.

**Simplify**
- **Audit key:** `operator` (header-only) plus `operatorName`.
- **Phase 2 scope:** 2.1–2.5, 2.7, 2.8, with the guard also on `/zpl`.
- **Phase 3 scope:** the minimum set (no FIFO limiter, no PNG/JPEG rejection).

---

## Decisions already made

| # | Decision | Made by | Date |
|---|---|---|---|
| D1 | **Who may use Sticker Engine: one dedicated label-printing computer (the "label station").** The human signs it in personally; operators never see the credentials. Access is granted to named gatepass accounts listed in Hub config. Admins and managers do not get access just because of their role. | Human (answered) | 2026-09-13 |
| D2 | **Live sticker-engine is NOT paused.** It stays up and reachable without login until Phase 1 ships. This is an accepted risk (R1). All work is built and tested in the dev clones on localhost; the human ships it with `shdeploy`. | Human | 2026-09-13 |
| D3 | Phase 1 (Hub only) ships first and on its own. Engine phases follow, each as a **separate** deploy: Phase 2, then Phase 3, then Phase 2b once its conditions are met. | Tech lead | 2026-09-13 |
| D4 | Station sessions are stateless HMAC-signed cookies bound to the account's current PIN hash. They last 30 days, are re-issued on use after 1 day, and survive gatepass restarts. No new table. | Tech lead | 2026-09-13 |
| D5 | The station account uses a role value `station`. The row is created through the existing admin API before the Hub deploy. The admin form gains a matching option. No schema change (`users.role` is free TEXT, `backend/db.js:30`). | Tech lead | 2026-09-13 |
| D6 | The `.zpl` download fallback is removed only in Phase 2b, after audited WebUSB printing is proven on the station. Until then `/zpl` is guarded but not audited. | Tech lead (Rev 2) | 2026-09-13 |
| D7 | A staged upload is deleted when its request finishes. After a successful listen, the engine deletes any leftover staged files. No TTL. | Tech lead | 2026-09-13 |
| D8 | In Phase 1, admin login gets a per-IP limiter, uniform errors and a 12-character minimum PIN. Resetting an admin's or the station's PIN also requires 12 or more characters. Every active admin moves to a 12+ character PIN before the deploy. Manager login and manager PINs are unchanged. | Tech lead (Rev 2, 2.2) | 2026-09-13 |
| D9 | Audit key `operator` is kept (Hub-verified, header only). A typed `operatorName` is optional and unverified. | Tech lead (Rev 2) | 2026-09-13 |
| D10 | Login limiting is per-IP only. There is no global lockout; the global count is only logged. PIN length is the defence against guessing from many IPs. | Tech lead (Rev 2.2) | 2026-09-13 |

---

## Problem

**Today.** SH-IT Hub (gatepass) listens publicly on `0.0.0.0:3001` and forwards `/stickers`, `/j` and `/J` to the sticker engine with no authentication (`backend/server.js:63-77`, `:1617`). The engine has no auth either. Anyone who can reach port 3001 can:
- read customer order lines
- edit batch codes and dates while an operator prints
- delete jobs
- put any name on the audit trail (`src/http/routes/jobs.js:166`)
- freeze the only Node process with one crafted PDF (`src/ingest/anchors.js:16`)
- fill the disk with uploads that are never deleted (`jobs.js:59-72`)

The admin PIN can also be brute-forced, and an admin can reset any account's PIN. That would make any Hub-side gate worthless unless it is fixed at the same time (B1).

Separately, the engine's safety checks only warn. A label whose expiry is earlier than its manufacture date shows as Ready and prints (`src/model/types.js:263`, `jobs.js:228-237`). Live operators print through the `.zpl` download, which skips the audit trail, because the server rejects the WebUSB path (`jobs.js:169-171` vs `public/js/app.js:592`).

**Desired.**
- Only the label station can open `/stickers`.
- Neither the station credentials nor admin powers can be obtained by guessing a short PIN.
- Every audited run records the verified station account.
- A line with an error-level problem cannot be printed by any path.
- Audited WebUSB printing works and, once proven, becomes the only path.
- One upload cannot stall the service or leave customer PDFs on disk.

**Who is harmed today:** the customers whose order data is exposed; the warehouse, which can ship drums with wrong dates or unscannable codes; anyone who later relies on the audit trail to trace a batch.

---

## Current behaviour (with file:line evidence)

### Exposure and identity
- **Hub proxy.** Mounts at `backend/server.js:63-77`. Target hardcoded to `http://127.0.0.1:6969` (`:64`). Mounted before `express.json()` (`:79`) and CORS (`:101-107`).
- **Listen.** Hub listens on `0.0.0.0` with port forced to 3001 (`server.js:1608`, `:1617`, `:1621`). `.env.example:35` confirms `PORT` is not read.
- **trust proxy.** Set to 1 (`:23`), but the Hub is exposed directly (`/root/Project Management/ARCHITECTURE.md:51`), so a client controls `req.ip` via `X-Forwarded-For`.
- **Sessions.** In-memory `Map` with an 8h TTL, keyed by token only (`server.js:671-686`). Not tied to the PIN. Tokens are sent in the `x-admin-token` / `x-manager-token` headers (`:715-750`).
- **Admin login** (`server.js:696-705`):
  - no rate limit
  - different errors: `'Admin not found or inactive'` (`:700`) vs `'Invalid PIN'` (`:701`)
  - compare is not constant-time (`:701`)
  - a missing body makes it return 500 with the exception message (`:698`, `:704`)
  - PIN hash is `sha256(pin + salt)` (`:151-153`)
  - no minimum PIN length
- **Names are public.** Unauthenticated `GET /api/employees` returns employee names (`server.js:642-657`), and `GET /api/manager-list` returns manager names (`:659-664`).
- **Admin powers.**
  - An admin token can reset any row's PIN (`server.js:865-874`, any length, no role check) and toggle any row active (`:856-863`).
  - Admins have no self-service PIN change route; they reset their own row.
  - Live has 1 active admin (checked by the tech lead with `sqlite3 -readonly`).
- **Manager powers.** Manager login (`server.js:1020-1031`, `authManager` `:159-172`) and manager change-pin (`:1040-1051`) act only on `role='manager'` rows (`:162`, `:1043`, `:1048`; names are unique, `db.js:29`).
- **Admin UI.**
  - User creation accepts any `role` (`server.js:842-851`).
  - The form offers Manager and Admin only (`apps/admin/index.html:474`).
  - "Staff" is hard-coded as manager/admin at `:673`, `:683-686`, `:694` (text `:700`), `:705` (button text), `:772` and `:777`.
  - Only `.role-admin` and `.role-manager` badge styles exist (`:118-119`).
  - PIN inputs `:341`, `:476`, `:489` have `inputmode="numeric"` with no `maxlength` or `pattern`. Values are trimmed (`:562`, `:811`, `:839`). Errors are shown from `body.error` (`:567-570`, `:845`).
- **Role filters elsewhere.** `server.js:162`, `:661`, `:699`, `:732`, `:1043`, `:1225`, `:1279`, `:1326`; `managerSync.js:103`, `:156`; `weekly-late-report.js:171`. `managerSync` only touches rows linked by `employee_master_id` or manager rows by name. User creation triggers no Sheets sync and no WhatsApp message.
- **dotenv** is loaded from `backend/.env` (`server.js:1`) and does not override variables that are already set.
- **shdeploy** restarts with `pm2 restart "$pm2name" --update-env` (`/root/ops/shdeploy:171`, `:206`).
- **Proxy library.** `http-proxy-middleware` 4.2.0 uses `httpxy`. httpxy emits `proxyReq` only when the outgoing request has no `expect` header (`node_modules/httpxy/dist/index.mjs:289`). It copies `req.headers` into the outgoing request (`:60`).
- **Engine identity.**
  - Operator is `String(req.get('x-operator') ?? req.body?.operator ?? '')`, falling back to `'unattributed'` (`jobs.js:166-167`, `misc.js:124-125`).
  - The engine trusts `x-request-id` (`src/http/middleware/requestId.js:18`).
  - The redirect is GET-only (`misc.js:67`), mounted at `/j` (`src/http/app.js:39`), and case-insensitive (`misc.js:60-61`).

### Print safety
- **Ready means fields present, nothing more.** `lineStatus()` checks field presence only (`src/model/types.js:255-265`). `enrichLine` sets `status` from it (`src/enrich/enrichJob.js:131`) despite `EXPIRY_BEFORE_MANUFACTURE` being severity `error` (`:105-116`).
- **No guard at print time.**
  - `requireReady` checks only `status !== 'ready'` (`jobs.js:228-237`).
  - Neither `/print` (`:149-194`) nor `/zpl` (`:201-218`) calls `guard()`; only preview does (`:140-147`). `isPrintable()` is at `src/render/guard.js:144-146`.
  - The test harness wires the real `guard` in (`test/fixtures/app.js:24`, `:170`).
- **Warnings dropped by the UI.**
  - PATCH line returns `{line, warnings, readiness}` (`jobs.js:130-137`), and `state.js:154-159` drops `warnings`.
  - The row badge reads `state.job.enrichWarnings` (`public/js/components/lineGrid.js:73`).
  - The counter reads `job.provenance` (`provenanceBar.js:64-65`).
- **Unaudited download.** Fallback at `public/js/app.js:578-583`, served by `GET /api/jobs/:id/zpl` (`jobs.js:201-218`) and documented at `README.md:275`.
- **WebUSB rejected by the server.** Config allows `webusb` (`src/config.js:145`) and live uses it. The browser sends `transport: state.transport` (`app.js:592`, `:648`). The route accepts only `browser`/`network` and returns 400 for anything else (`jobs.js:169-171`).
- **WebUSB claim sequence** (`public/js/webusb.js:140`, `:152`, `:17`, `:288`, `:309`, `:326`; vendor `0x0a5f` at `:28`).
- **Reprints fail from the UI.** The UI always sends `reason: null` (`app.js:591`), so a reprint always fails with `REPRINT_REASON_REQUIRED` (`src/print/runService.js:98-106`).
- **CLI.** `sticker print` without `--line` selects only `ready` lines (`bin/sticker.js:195-197`).
- **Race and settle gaps.** The reprint check reads only settled `label.printed` entries (`auditLog.js:81-86`, `runService.js:64-72`), and `prepare` writes nothing (`:153-166`). The browser settles through a separate `reportSent` call (`public/js/print.js:112-123`).

### Availability and hygiene
- **Quadratic trim.** `toLines` uses `/\s+$/` (`anchors.js:16`). Measured: 10k chars 125 ms, 20k 495 ms, 40k 2,300 ms.
- **Poppler.** `execFile` with `maxBuffer` 32 MiB and no timeout (`extract.js:126-133`). Its errors are wrapped in two catch blocks: `:154-160` (pdfinfo) and `:172-178` (pdftotext).
- **Staged files.**
  - Written before extraction (`jobs.js:60`) and never removed on a throw (`:59-86`).
  - Kept until the job expires (`jobStore.js:211-222`, `:244-252`).
  - No directory sweep.
  - Names are `randomUUID()` plus the extension (`src/store/files.js:37-38`).
- **Listen error ignored.** `app.listen` at `src/server.js:140-142` ignores the callback error. Express 5 wires the callback to `error` (`node_modules/express/lib/application.js:601-603`).

### Release tooling
- **Wrong health URL.** `shdeploy:25` health URL is `http://127.0.0.1:6969/api/health`, which returns 404.
- **Rollback reads only the latest log line.** Rollback reads the last line only (`shdeploy:195-196`) and writes `<stamp> <name> <current> <prev> rollback` (`:207`). A second rollback re-applies the undone deploy.

---

## Proposed behaviour

### Phase 0: human-run preparation (no containment; D2)

**0.1 WebUSB end-to-end test on the station.**

*Gates P2-AC12 and Phase 2b only. Does not gate the Phase 1 or Phase 2 deploys.*

1. On the station PC, in the browser that will be used, open `https://<hub-host>:3001/stickers/` with the exact host name the station will always use. After Phase 1 this needs the station sign-in first.
2. Open DevTools → Console and paste:

```js
(() => {
  const b = document.createElement('button');
  b.textContent = 'USB TEST';
  b.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;font-size:20px';
  document.body.appendChild(b);
  b.onclick = async () => {
    const log = (...a) => console.log('[usb-test]', ...a);
    try {
      log('secureContext', window.isSecureContext, 'usb', 'usb' in navigator);
      const d = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x0a5f }] });
      await d.open(); log('opened', d.productName);
      if (d.configuration === null) await d.selectConfiguration(1);
      const iface = d.configuration.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === 7));
      await d.claimInterface(iface.interfaceNumber); log('claimed', iface.interfaceNumber);
      const alt = iface.alternates.find((a) => a.interfaceClass === 7);
      const out = alt.endpoints.find((e) => e.direction === 'out');
      const r = await d.transferOut(out.endpointNumber,
        new TextEncoder().encode('^XA^FO40,40^A0N,40,40^FDWEBUSB TEST^FS^XZ'));
      log('transferOut', r.status, r.bytesWritten);
      await d.releaseInterface(iface.interfaceNumber); await d.close();
    } catch (e) { console.error('[usb-test] FAILED at', e.name, e.message); }
  };
})();
```

3. Click **USB TEST**, pick the Zebra, and record:

| Record | Value |
|---|---|
| (a) `secureContext true, usb true` shown | yes / no |
| (b) Last `[usb-test]` line (`transferOut ok <n>` or `FAILED at …`) | |
| (c) Did a label reading `WEBUSB TEST` physically print? | yes / no |
| (d) Was Zadig or any driver change used? | yes / no, and exactly what |

- **Pass:** (a) yes, (b) `transferOut ok`, (c) yes.
- **If `claimInterface` fails:** do **not** run Zadig or change the driver until QZ1 and QZ2 are answered and a written procedure exists to restore the current Windows driver.
- Report the four records to the coordinator. The result gates P2-AC12 and Phase 2b. Until it passes, operators keep using the guarded download that Phase 2 leaves in place.

**0.2 Fix the shdeploy health URL.** The human edits `/root/ops/shdeploy:25` to `http://127.0.0.1:6969/stickers/api/health`. Verify:
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6969/stickers/api/health   # expect 200
```
Required before the first engine deploy.

**0.3 Stray engine processes.** A precondition for dev work on port 6975 and for the Phase 3 deploy.
```bash
ps -o pid,ppid,etime,args -p 168776,171406
# Only if both show "node src/server.js" with ppid 1:
kill 168776 171406
ss -ltnp | grep -E '127\.0\.0\.1:697[01]\b' || echo "no strays"     # expect "no strays"
```

**0.4 Confirm live engine paths.** Prints only the keys named.
```bash
grep -E '^STICKER_(TMP|AUDIT_LOG|BASE_PATH)=' /root/sticker-engine/.env
```
If `STICKER_TMP` is absent, the uploads directory is `/root/sticker-engine/data/uploads` (`src/config.js:128`).

**0.5 Keep the orphaned PDFs until the Phase 2 real-document sweep has used them.**
- Do not run 0.6 before the P2-AC4b sweep has its read-only copy, unless the sweep uses the 0.6 archive as its source.
- Phase 3's boot sweep deletes these files, so Phase 3 must not deploy before P2-AC4b has run.

**0.6 OPTIONAL, DESTRUCTIVE: back up, then delete orphaned customer PDFs.** Only files older than 60 minutes are touched.
```bash
bash -c '
set -euo pipefail
SRC=/root/sticker-engine/data/uploads        # replace with STICKER_TMP from 0.4 if set
STAMP=$(date +%Y%m%d-%H%M%S)
Q=/root/ops/quarantine
install -d -m 700 "$Q"
find "$SRC" -maxdepth 1 -type f -mmin +60 -printf "%f\n" | sort > "$Q/sticker-uploads-$STAMP.list"
N=$(wc -l < "$Q/sticker-uploads-$STAMP.list"); echo "files: $N"
tar -C "$SRC" -czf "$Q/sticker-uploads-$STAMP.tgz" -T "$Q/sticker-uploads-$STAMP.list"
chmod 600 "$Q/sticker-uploads-$STAMP.tgz" "$Q/sticker-uploads-$STAMP.list"
T=$(tar -tzf "$Q/sticker-uploads-$STAMP.tgz" | wc -l); echo "archived: $T"
[ "$N" = "$T" ] || { echo "count mismatch, nothing deleted"; exit 1; }
# ---- DESTRUCTIVE: deletes customer documents from the live tree ----
( cd "$SRC" && xargs -d "\n" rm -f -- < "$Q/sticker-uploads-$STAMP.list" )
echo "remaining old files: $(find "$SRC" -maxdepth 1 -type f -mmin +60 | wc -l)"
'
```
The archive contains customer PII. Recommended retention is 7 days (Q4).

**0.7 Pre-flight for Phase 1 config.** Counts only, no secrets.
```bash
grep -cE '^(HUB_PORT|HUB_HOST|STICKERS_[A-Z_]+)=' /root/SH-IT_Hub/backend/.env   # expect 0
sqlite3 -readonly /root/SH-IT_Hub/backend/gatepass.db "select count(*) from users where role='admin' and active=1"   # note N (live: 1)
```

---

### Phase 1 (CRITICAL, Hub only, ships first and alone)

**Phase 1 is self-contained.**
- It changes only `/root/dev/SH-IT_Hub`.
- It needs no engine change: the engine already records `x-operator` (`jobs.js:166`) and uses same-origin `fetch` (`public/js/api.js:35`).
- Its data steps use APIs that exist today: creating the station row and resetting the admin PINs (`server.js:842-851`, `:865-874`).

#### Shape of the flow

```
Station browser                          SH-IT Hub :3001 (gatepass)                         Engine 127.0.0.1:6969
───────────────                          ──────────────────────────                         ─────────────────────
GET /stickers/  (no cookie) ───────────▶ stickerGate: no valid cookie
                ◀─── 303 /stickers/_auth/login
POST /stickers/_auth/login name+PIN ───▶ origin-form? Origin ok? per-IP limiter →
                                         body types → users row → active? allowlisted?
                                         PIN ≥ 12? hash ok?  (limiter records failure, sync)
                ◀─── 303 /stickers/  Set-Cookie: sh_stickers=v1.<uid>.<iat>.<exp>.<mac>
GET /stickers/api/jobs  (cookie) ──────▶ any sh_stickers value valid? (mac over secret +
                                         user's current salt+hash, exp, active, allowlist);
                                         Origin check if not GET/HEAD; re-issue if GET and
                                         older than 1 day; delete cookie/x-operator/
                                         x-request-id/tokens/authorization/expect from
                                         req.headers; set x-operator ───────────────────────▶ unchanged engine
GET /J/abc234  (anyone) ───────────────▶ engine URL valid; GET/HEAD; code [A-Za-z0-9]{1,32};
                                         same header deletion; upstream /j/abc234 ──────────▶ 302 redirect

POST /api/auth/admin ──────────────────▶ adminLogin: per-IP limiter → PIN ≥ 12 → one 401 body
                                         for every failure → unchanged success response
POST /api/admin/users/reset-pin ───────▶ requireAdmin → pinPolicy: target role admin/station
                                         needs newPin ≥ 12 → else 400, no write
```

#### Why this design (and what was rejected)

| Option | Verdict | Reason |
|---|---|---|
| **Stateless HMAC cookie, Path=/stickers, bound to the account's salt+hash, re-issued after 1 day (chosen)** | Accept | Survives gatepass restarts; revoked instantly by a PIN reset or disabling the account; no table, no dependency; HttpOnly. |
| New `sticker_sessions` table | Reject (Q3) | Per-device revoke is not needed for one station. Needs human approval plus db-migration-guard. |
| Reuse the in-memory `sessions` Map (`server.js:672`) | Reject | 8 hours and lost on restart, which breaks D1. |
| Hub header tokens passed to the engine front end | Reject | A page navigation cannot carry a header, and the token would be readable by JS. |
| Auth inside the engine | Reject | The engine has no user store. |
| HTTP Basic auth at the proxy | Reject | No logout; browser-cached; credentials sent on every request. |
| `jsonwebtoken` (`package.json:20`) | Reject | Adds an `alg` surface we do not need. |
| Role-based access | Reject (D1) | Would include auto-created managers with PIN 1234 (`managerSync.js:49,123-129`). |
| Station account as role `manager` | Reject | It would be listed in `/api/manager-list` (`server.js:659-663`). |
| Per-name login lockout | Reject (N1) | Anyone could lock the station name out. |
| Global 429 ceiling | Reject (Rev 2.2, F2) | One attacker with many IPs would lock every admin out. Replaced by a log line; long PINs are the defence (R16). |
| Leave admin login and PIN reset as they are | Reject (B1, F1) | A guessed short admin PIN gives reset-pin on the station row, bypassing the gate. |
| Rely only on the proxy's `on.proxyReq` hook to strip headers | Reject (F3) | httpxy skips that hook when the request has `Expect` (`httpxy/dist/index.mjs:289`). |

**Why the manager login is not changed (B1 scope).**
- The only routes that change another account's PIN or active flag are `/api/admin/users/reset-pin` (`server.js:865`) and `/api/admin/users/toggle` (`:856`). Both require `requireAdmin`.
- Manager routes act only on `role='manager'` rows.
- A guessed manager PIN gives gate-pass manager actions, not station access (R10).

**CSRF.** Two layers: `SameSite=Strict`, plus an Origin check on POST, PATCH and DELETE.

**/api/health and /src** require the station session once gated.

#### Hub configuration (read once at boot)

| Env var | Default | Validation | Scope if invalid |
|---|---|---|---|
| `STICKERS_ENGINE_URL` | `http://127.0.0.1:6969` | URL, protocol `http:`, hostname one of `127.0.0.1`, `localhost`, `::1` | `/stickers` **and** `/j` → 503 |
| `STICKERS_ALLOWED_USERS` | empty | Comma-separated, trimmed, empty entries dropped. Each entry matches `^[\x20-\x7E]{1,100}$`. At least one entry. | `/stickers` only → 503 |
| `STICKERS_SESSION_SECRET` | none | `^(?:[0-9a-fA-F]{2}){32,}$` | `/stickers` only → 503 |
| `STICKERS_SESSION_DAYS` | `30` | Integer 1–90 | `/stickers` only → 503 |
| `HUB_PORT` | `3001` | `server.js:1608` becomes `const PORT = Number(process.env.HUB_PORT) \|\| 3001;` | n/a |
| `HUB_HOST` | `0.0.0.0` | `const HOST = process.env.HUB_HOST \|\| '0.0.0.0';` used at `:1617`, `:1621` | n/a |

**Dev trap.** If `HUB_PORT` is set to anything other than `3001` and `STICKERS_ENGINE_URL` is unset, the engine URL is treated as invalid.

**503 body.** HTML when `Accept: text/html`. Otherwise JSON `{"error":{"code":"STICKERS_NOT_CONFIGURED","message":"Sticker Engine sign-in is not configured on this server.","requestId":null}}`. Gatepass itself always boots.

#### PIN policy (`backend/pinPolicy.js`, new, CommonJS)

- **Exports:**
  - `MIN_PRIVILEGED_PIN_LENGTH = 12`
  - `PRIVILEGED_ROLES = ['admin', 'station']`
  - `createResetPinHandler({ db, hashPin, log })`
- **Mounting.** `server.js:865-874` becomes:

  ```js
  app.post('/api/admin/users/reset-pin', requireAdmin, createResetPinHandler({ db, hashPin, log: console }))
  ```

  `adminLogin.js` and `stickerGate.js` import `MIN_PRIVILEGED_PIN_LENGTH`.
- **Handler, in order:**
  1. `const { rowIndex, newPin } = req.body || {}`. If `!rowIndex`, `!newPin` or `typeof newPin !== 'string'` → **400** `{"error":"rowIndex and newPin required"}`. This is the existing message.
  2. `SELECT role FROM users WHERE id = ?`. No row → **404** `{"error":"User not found"}`, no write.
  3. If `PRIVILEGED_ROLES.includes(row.role)` and `newPin.length < 12` → **400** `{"error":"Admin and station PINs must be at least 12 characters."}`, no write. Log `[reset-pin] refused short PIN role=<role> id=<id>`. The admin UI shows this message (`apps/admin/index.html:845`).
  4. Otherwise run the existing salt/hash update → `{ ok: true }`.
  5. Exception → 500 `{"error": e.message}`. This is the existing behaviour on an admin-only route.
- **Not changed:** manager and other rows accept any non-empty PIN, as today. Account creation (`server.js:842-851`) is also unchanged: a short-PIN admin or station created there fails closed at sign-in.

#### Limiter (`backend/loginLimiter.js`, new, CommonJS). Per-IP only (D10).

- **Factory:** `createLoginLimiter({ name, now, perIp = 10, windowMs = 15*60*1000, maxKeys = 10000, globalLogThreshold = 300, log })` → `{ blocked(ip), fail(ip) }`.
- **`blocked(ip)`** is true iff that IP has ≥ `perIp` failures in the window.
- **`fail(ip)`** records one timestamp for the IP. It also records a timestamp in a window-wide counter, which is **only logged** and never blocks. The first time the counter reaches `globalLogThreshold` within a window, it logs `[login-limiter] global ceiling reached limiter=<name> failures=<n>`, once per window.
- **Housekeeping:**
  - Timestamps older than the window are pruned on every call.
  - Storage is two insertion-ordered maps, unblocked keys and blocked keys (a key moves across when it reaches `perIp`), each capped at `maxKeys`. On overflow the oldest key of that map is evicted, never the key being recorded, in O(1). At most one `[login-limiter] <name> evicted count=<n>` line is logged per window. The whole map is never cleared (Rev 2.3 / round 3).
- **IP key:** `req.socket.remoteAddress`, never `req.ip`.
- **Synchronous rule:** `blocked()`, the credential check and `fail()` run in one synchronous sequence, with no `await` between them.
- A successful login clears nothing.
- There are two independent instances: `stickers` and `admin`.
- **Recovery:** if a legitimate user's IP is limited (for example, typos behind a shared office NAT), either wait 15 minutes or run `pm2 restart gatepass`. The restart clears both limiters and also logs out every manager and admin.

#### Gate rules (`backend/stickerGate.js`, new, CommonJS; mounted at `/stickers`)

0. **Request target.** If `req.originalUrl` does not start with `/`, respond **400** JSON `BAD_REQUEST_TARGET`, not proxied. The same applies to `/j`.

1. **Auth routes, never proxied:**
   - **`GET /stickers/_auth/login`** → 200 HTML form (fields `name` and `pin`; `method=post action=/stickers/_auth/login`; no JavaScript). Headers: `Cache-Control: no-store` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`. The PIN is not trimmed.
   - **`POST /stickers/_auth/login`.** Body parser only here: `express.urlencoded({ extended: false, limit: '2kb' })`. Steps, in order:
     1. Config invalid → 503.
     2. Origin check (rule 3). A failure returns 403 and does not count as a login failure.
     3. `limiter.blocked(socketIp)` → **429** HTML "Too many sign-in attempts. Wait 15 minutes."
     4. Body checks. Each failure calls `limiter.fail` and returns the generic 401:
        - `typeof name === 'string'` and `typeof pin === 'string'` (a repeated field arrives as an array and fails)
        - `name.length` 1–100 and matches `^[\x20-\x7E]+$`
        - `pin.length` from `MIN_PRIVILEGED_PIN_LENGTH` to 128
     5. `SELECT id, name, role, salt, hash, active FROM users WHERE name = ?`. For an unknown name, compare against a fixed dummy salt/hash.
     6. Success requires: the row exists, `active = 1`, `name` is in `STICKERS_ALLOWED_USERS`, `role === 'station'` (Rev 2.3), and `timingSafeEqual` of the hex hashes (equal lengths).
     7. Any failure → `limiter.fail(socketIp)` → **401** with the same HTML body and no `sh_stickers` cookie. The reason is logged.
     8. Success → **303** `Location: /stickers/` with the cookie from rule 2.
   - **`POST /stickers/_auth/logout`** → Origin check → 303 to the login page, with `Set-Cookie: sh_stickers=; Path=/stickers; HttpOnly; Secure; SameSite=Strict; Max-Age=0`.
   - **`GET /stickers/_auth/logout`** → 200 page containing only a POST "Sign out" button.

2. **Session check.** Config invalid → 503. Otherwise parse the `Cookie` header by hand (split on `;`, trim, split at the first `=`) and collect **every** `sh_stickers` value in header order (F4).
   - **A value is valid iff:**
     - it matches `^v1\.(\d{1,10})\.(\d{10})\.(\d{10})\.([A-Za-z0-9_-]{43})$`
     - `exp > nowSec`, `iat <= nowSec + 300`, and `exp - iat <= 90*86400`
     - user `id = uid` exists, has `active = 1`, has `role = 'station'` (Rev 2.3), is in the allowlist, and its name matches `^[\x20-\x7E]{1,100}$`
     - `uid` is canonical (no leading zeros), at most 10 `sh_stickers` candidates are checked, and the MAC is compared as its base64url string
     - `mac` equals base64url (no padding) of `HMAC-SHA256(key = Buffer.from(secret,'hex'), data = "v1.<uid>.<iat>.<exp>.<role>.<salt>.<hash>")` (role added in round 3), compared with `timingSafeEqual`
   - **Selection.** The first valid value in header order is the session. Other values are ignored, and no clearing cookie is sent.
   - **Issue:** `sh_stickers=v1.<uid>.<iat>.<exp>.<mac>; Path=/stickers; HttpOnly; Secure; SameSite=Strict; Max-Age=<days*86400>`, with `iat = floor(now/1000)` and `exp = iat + days*86400`.
   - **Re-issue (N1).** If the method is `GET` and `nowSec - iat > 86400` for the selected value, append a freshly issued cookie to `proxyRes.headers['set-cookie']` in `on.proxyRes`. P1-AC24 is the requirement.
   - **No valid value:**
     - `GET`/`HEAD` with `Accept` containing `text/html` → **303** to `/stickers/_auth/login`
     - otherwise → **401** JSON `{"error":{"code":"AUTH_REQUIRED","message":"Your Sticker Engine sign-in has ended. Reload the page to sign in again.","requestId":null}}`
     - if at least one `sh_stickers` value was present, also send the clearing cookie (Max-Age=0)

3. **Method and Origin.**
   - Allowed methods: GET, HEAD, POST, PATCH, DELETE. Anything else → **405** `METHOD_NOT_ALLOWED`.
   - For POST, PATCH and DELETE: allowed iff `Origin === req.protocol + '://' + req.get('host')`, or `Origin` is absent and `Sec-Fetch-Site === 'same-origin'`. Otherwise → **403** `ORIGIN_REJECTED`.

4. **Header cleaning, then proxy (F3).**
   - **(a) In the gate middleware, before calling the proxy:**
     - delete `req.headers.cookie`, `['x-operator']`, `['x-request-id']`, `['x-admin-token']`, `['x-manager-token']`, `authorization` and `expect`
     - then set `req.headers['x-operator'] = user.name`
     - Node's HTTP server has already answered `100 Continue` by this point, because gatepass registers no `checkContinue` listener. Deleting `expect` therefore does not stall the body.
   - **(b) Proxy** to `STICKERS_ENGINE_URL` with upstream path `'/stickers' + req.url`, `changeOrigin: false`, `ws: false`.
   - **(c) `on.proxyReq` (second layer):** `removeHeader` for the same seven names, then `setHeader('x-operator', user.name)`.
   - **(d) `on.error`:** if headers are not yet sent → **502** `ENGINE_UNAVAILABLE`.
   - The gate never reads the request body.

#### Short-link mount (`/j`, public; also matches `/J`)

Express 4 path matching is case-insensitive, so one `app.use('/j', …)` replaces both existing mounts (`server.js:76-77`).

1. Rule 0 → 400.
2. Engine URL invalid → 503. The secret, allowlist and session days are not consulted.
3. Method other than GET or HEAD → **405**.
4. `req.path` must match `^/([A-Za-z0-9]{1,32})$`, otherwise **404** `SHORTLINK_NOT_FOUND`.
5. Delete the same seven headers from `req.headers`, as in rule 4(a); do not set `x-operator`. Proxy with upstream path exactly `/j/<captured code>` and no query string. `on.proxyReq` removes the same seven headers as a second layer.

#### Admin login hardening (`backend/adminLogin.js`, new, CommonJS)

`createAdminLoginHandler({ db, hashPin, issueSession, limiter, log })`. `server.js:696-705` becomes `app.post('/api/auth/admin', createAdminLoginHandler({ db, hashPin, issueSession, limiter: adminLimiter, log: console }))`.

1. `limiter.blocked(req.socket.remoteAddress)` → **429** `{"error":"Too many sign-in attempts. Wait 15 minutes."}`.
2. `const { name, pin } = req.body || {}`. Required: `typeof name === 'string'` with length 1–100, and `typeof pin === 'string'` with length `MIN_PRIVILEGED_PIN_LENGTH`–128. Anything else is a `bad_body` failure (F1b).
3. `SELECT name, salt, hash FROM users WHERE name = ? AND role = 'admin' AND active = 1`. A missing row is compared against the dummy salt/hash, using `timingSafeEqual`.
4. Any failure → `limiter.fail(ip)` → **401** with body `{"error":"Invalid name or PIN"}`, byte-identical for every reason. Log `[admin-login] failed ip=<addr> reason=<bad_body|unknown_or_inactive|bad_pin>`.
5. Success → unchanged: `{ ok: true, name, token }` with `token = issueSession(name, 'admin')`.
6. Unexpected exception → 500 `{"error":"Sign-in failed. Try again."}`.

#### Admin UI (static; `apps/admin/index.html`)

| Location | Today | Change |
|---|---|---|
| `:474` | options Manager, Admin | add `<option value="station">Label station (Sticker Engine only)</option>` |
| `:673` | staff filter `manager \|\| admin` | add `\|\| u.role === 'station'` |
| `:683-686` | rank `{ admin: 0, manager: 1 }`, fallback 2 | `{ admin: 0, manager: 1, station: 2 }`, fallback 3 |
| `:694` | hidden-login count excludes manager/admin | also exclude `station` |
| `:700` | `' manager/admin account'` | `' manager/admin/station account'` |
| `:705` | button `Managers and admins only` | `Managers, admins and station` (F5) |
| `:772` | search: outside staff excludes manager/admin | also exclude `station` |
| `:777` | search: inside staff requires manager/admin | also accept `station` |
| `:118-119` | `.role-admin`, `.role-manager` | add `.role-station{background:rgba(120,200,160,0.14); color:var(--phosphor);}` (`--phosphor` is used by `.active-yes`, `:121`; badge markup `:723` already emits `role-<role>`) |

PIN inputs at `:341`, `:476` and `:489` stay as they are: no length cap exists. The new PIN rule is enforced on the server (pinPolicy, adminLogin, gate).

#### Station setup (human). The row is created before the Phase 1 deploy (N10).

1. **Generate a 16-character PIN** (96 bits) and keep it only in the human's password manager:
   ```bash
   node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"
   ```
2. **Create the row.** Signed in to live `/admin` on a desktop browser, run this in the DevTools console, typing the PIN in place of `<PIN>`:
   ```js
   fetch('/api/admin/users', { method: 'POST',
     headers: { 'content-type': 'application/json', 'x-admin-token': sessionStorage.getItem('shit_admin_token') },
     body: JSON.stringify({ name: 'Label Station', dept: 'Warehouse', role: 'station', pin: '<PIN>' }) })
     .then(r => r.json()).then(console.log)      // expect { ok: true }
   ```
   Before Phase 1 this row cannot sign in anywhere. The pre-Phase-1 admin UI shows it only under "Show all accounts".
3. **After the Phase 1 deploy,** on the station PC and using the same host name as in check 0.1: open `/stickers/`, sign in, decline saving the password, and choose the printer.

**Revocation (no code needed):**
- (R-a) Sign out at `/stickers/_auth/logout`. Affects only that browser.
- (R-b) Admin → Reset PIN on the station account, with a **new PIN of at least 12 characters** (a shorter one is refused, P1-AC26). Every station cookie fails on its next request. No restart.
- (R-c) Admin → Disable the account.
- (R-d) Remove the name from `STICKERS_ALLOWED_USERS`, then restart gatepass.
- (R-e) Rotate `STICKERS_SESSION_SECRET`, then restart gatepass.

---

### Phase 2 (HIGH, engine deploy A): print safety; download kept but guarded

**2.1 Error-severity warnings block a line.**
- `LineStatus` becomes `'incomplete'|'ready'|'blocked'` (`types.js:216`).
- In `enrichLine` (`enrichJob.js:131`): any warning for `line.index` with `severity === 'error'` sets `'blocked'`; otherwise the status is `lineStatus(next)`. `blocked` wins over `incomplete`.
- Readiness still counts only `ready`.
- UI (`lineGrid.js:159-164`): text `Blocked`, `title` holding the error messages, class `status--incomplete`. The checkbox stays disabled (`:93`).
- CLI: `sticker print` without `--line` already selects only `ready` lines (`bin/sticker.js:195-197`). No change.

**2.2 Blocked lines are refused, with the reason.** `requireReady` (`jobs.js:228-237`) keeps 409 `JOB_NOT_READY`. For each blocked line the message includes `Line <n> cannot be printed: <first error message>.` This applies to both `/print` and `/zpl`.

**2.3 Server-side guard on `/print` and `/zpl`.**
- **Helper.** `requirePrintable(record, selected, dpi)` in `jobs.js` runs, for each line: `emit(template(dpi), renderContext(job, line), {copies: 1})` → `deps.guard(placed)` → `isPrintable` (import from `src/render/guard.js`).
- **Error.** Any failure throws `LabelNotPrintableError` (`src/errors.js`, code `LABEL_NOT_PRINTABLE`, 409). Message: `Line <n> will not print correctly: <first error message>.` Detail: `jobId=<id> line<n>=<CODES>`.
- **Where it runs.** After `requireReady`, in `POST /:id/print` before `runs.prepare`/`runs.print`, and in `GET /:id/zpl` before emitting. A refused request creates no run, no audit entry and no file.
- **Test seam.** `test/fixtures/app.js` gains `options.guard`: `:170` passes `guard: options.guard ?? guard`, and the JSDoc at `:51-53` is updated.

**2.4 Edit warnings and the counter reach the screen.**
- The PATCH line response adds `provenance: provenanceSummary(record.job)` (`serialise.js:74`).
- `state.js:154-159`:
  - `enrichWarnings = [...state.job.enrichWarnings.filter(w => w.line !== undefined && w.line !== index), ...result.warnings]`
  - `provenance = result.provenance`

**2.5 WebUSB transport accepted and audited.**
- `jobs.js:169-171` accepts `browser`, `webusb` and `network`. `browser` and `webusb` go to `runs.prepare({...request, transport})`.
- `runService.prepare` (`:162-166`) records `transport: request.transport === 'webusb' ? 'webusb' : 'browser'`.

**2.6** moved to Phase 2b.

**2.7 Identity, simplified (D9).**
- **Helper `src/http/identity.js`,** used by `jobs.js:166-167` and `misc.js:124-125`:
  - `operator` = the `x-operator` header, trimmed, or `'unattributed'`. **The body is no longer read into `operator`.**
  - `operatorName` = `req.body.operator` if it is a string, trimmed and cut to 80 characters; otherwise `null`; an empty string becomes `null`.
- **Records.** The run object (`runService.js:108-130`) and every audit entry that already has `operator` (`:219-265`, `:300-308`) keep it and add `operatorName`. The `auditLog.js:22` typedef gains `operatorName`.
- **UI.**
  - `printDialog.js` gains an optional input `Your name (optional, not verified)`, `maxlength=80`, empty on each open.
  - The value flows `onConfirm(name)` → `print(lines, {operatorName})` → `runPrint` → `api.startPrint` body `operator`.
  - It is also passed as `api.verifyRun(runId, scanned, operatorName)` body `operator`.
- **Existing tests.** Header-based tests keep their expectations: `test/http.print.test.js:26`, `:153`; `test/http.browserTransport.test.js:27`, `:117`. test-author confirms no body-only operator test exists with `grep -n "operator" test/*.test.js`.

**2.8 Reprint reason (kept, N15).**
- On `REPRINT_REASON_REQUIRED`, reopen the print dialog with a required `Reprint reason` field; Confirm stays disabled while it is blank.
- Confirm calls `print(lines, {operatorName, reason})`.
- The server trims `reason` and cuts it to 200 characters. An empty reason counts as absent.
- This affects only the audited path. In Phase 2 the download path still has no reprint check (R15).

### Phase 2b (engine deploy B, later): remove the `.zpl` download

**Preconditions, all required:**
1. Check 0.1 passed, and P2-AC12 passed on the station.
2. Audited WebUSB printing has run for the agreed period (QP; recommended: 10 working days).
3. In that period, the engine logs show no `/:id/zpl` requests (log path from `ecosystem.config.cjs:40-41`; compare against the count at P2-AC12 time):
   ```bash
   grep -c '"route":"/:id/zpl"' /root/sticker-engine/logs/out.log
   ```
4. QZ1 and QZ2 are answered.

**Change:**
- Delete `GET /:id/zpl` (`jobs.js:201-218`) and `zplUrl` (`api.js:151-155`).
- In `app.js:578-583`, when `!canPrint`: `store.set({ error: { message: 'Choose the label printer first: use "Choose printer…" next to Print.', requestId: null } })`, then return.
- `Download only` at `app.js:197` and `:204` becomes `No printer`. Update the comment at `app.js:187-190`.
- Docs: remove the route from `docs/sh-it-hub-integration.md:161` and `README.md:275`.

**Why remove it rather than audit it.** A downloaded file can be printed any number of times, offline, where the server cannot see it. An audited download would record an intention, not an event (`runService.js:153-158`).

### Phase 3 (HIGH, engine deploy C): availability and hygiene (minimum)

**3.1 Linear trim and line cap.**
- `anchors.js:16`: `line.replace(/\s+$/, '')` becomes `line.trimEnd()`.
- In `createExtractor().extract` (`extract.js:216-217`), after `reader.read` and before `detectKind`: if any line of `layoutText` (split on `\r\n|\r|\n`) is longer than 2,000 characters, throw `DocumentReadError` (422): `"<basename>" has a line longer than 2,000 characters, which is not a document this service reads.` Export the constant `MAX_LAYOUT_LINE_CHARS = 2000`.

**3.2 Poppler timeout and output cap.**
- `execFileRunner(command, args, options = {})` (`extract.js:126`) passes `timeout: options.timeoutMs ?? 20000`, `killSignal: 'SIGKILL'` and `maxBuffer: 8 * 1024 * 1024`.
- **Both** catch blocks in `createPopplerReader` — `:154-160` (pdfinfo) and `:172-178` (pdftotext) — apply the same mapping before their existing generic message (F9):
  - `cause.killed === true` → `DocumentReadError` `Reading "<basename>" took longer than 20 seconds and was stopped.` with detail `pdfinfo timed out` or `pdftotext timed out`
  - `cause.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'` → `DocumentReadError` `"<basename>" produced more text than this service reads (8 MB).` with detail `pdfinfo output cap` or `pdftotext output cap`
  - anything else → the existing message and detail, unchanged

**3.3 Uploads never outlive their request (D7).**
- `POST /api/jobs` (`jobs.js:51-86`): everything after `validateUploads` goes inside `try { … } finally { for each staged path: await fileStore.remove(path) }`.
- A remove failure logs `upload.remove_failed` as a warning and is not thrown.
- `jobStore.create` receives `stagedFiles: []`.

**3.4 Boot sweep after a successful listen, plus the listen-error fix.**
- **New `sweepStagedUploads(directory, { io, logger })`** in `src/store/files.js`:
  - lists the directory non-recursively
  - deletes regular files named `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.(pdf|png|jpg|jpeg))?$`
  - returns the count and logs `{event:'uploads.swept', removed}`
  - returns 0 on `ENOENT`
- **`src/server.js:140-142`** becomes:
  ```js
  const server = app.listen(config.port, config.host, (error) => {
    if (error) {
      logger.error({ event: 'server.listen_failed', host: config.host, port: config.port, code: error.code, message: error.message });
      process.exit(1);
    }
    logger.info({ event: 'server.listening', host: config.host, port: config.port });
    sweepStagedUploads(config.tmpDir, { logger })
      .catch((e) => logger.warn({ event: 'uploads.sweep_failed', error: e.message }));
  });
  ```

---

## Acceptance criteria

**Key:**
- **HG**: Hub unit test (`backend/test/*.test.js`, node:test)
- **PW**: Playwright MCP against the dev stack
- **DEV**: command against the dev stack, with expected output
- **SMOKE**: human-run command around the deploy
- Engine tests are node:test files under `test/`

HG test PINs are generated in memory at test start with `crypto.randomBytes(12).toString('base64url')`, and shorter variants are sliced from them. No literal PIN appears in any test or document.

### Phase 1 (Hub): final for test-author

**Unauthenticated access and login**
- **P1-AC1** No cookie, `GET /stickers/` with `Accept: text/html` → 303 `Location: /stickers/_auth/login`. Upstream receives 0 requests. (HG)
- **P1-AC2** No cookie. Each of `GET /stickers/api/jobs`, `GET /stickers/src/render/layout.js`, `GET /stickers/api/health`, and a multipart `POST /stickers/api/jobs` → 401 JSON `AUTH_REQUIRED`. Upstream receives 0. (HG)
- **P1-AC3** Active user `Label Station` (id 7, generated 16-character PIN) is in the allowlist. `POST /stickers/_auth/login` with a matching Origin → 303 `Location: /stickers/`. Exactly one `Set-Cookie` header starting `sh_stickers=v1.7.`, containing `Path=/stickers`, `HttpOnly`, `Secure`, `SameSite=Strict` and `Max-Age=2592000`. Log `[stickers] login ok name="Label Station"`. (HG)
- **P1-AC4** Each of the following → 401 with a byte-identical body and no `sh_stickers=v1` cookie (HG):
  - wrong PIN
  - name not in the allowlist
  - `active=0`
  - correct PIN on an account whose PIN is 11 characters
  - unknown name
  - name containing `é`
  - `name` sent twice
  - `pin` missing
  - `pin` of 129 characters
- **P1-AC5** Per-IP limiter only (F2), with an injected clock and a captured log (HG):
  - (a) After 10 failed station logins from socket address X within 15 minutes, the 11th attempt from X with the correct PIN → 429, no cookie. After 15 minutes and 1 second, it succeeds.
  - (b) 300 failed logins spread over 30 addresses (10 each) → a correct login from a 31st address → 303 with a cookie. The log contains `[login-limiter] global ceiling reached limiter=stickers` exactly once in that window.
  - (c) 20 concurrent wrong logins from one address → exactly 10 responses are 401 and 10 are 429.
  - (d) A new limiter instance (simulated `pm2 restart`) does not block X.

**Proxied requests**
- **P1-AC6** Valid cookie. `GET /stickers/api/jobs` sent with `x-operator: Mallory`, `x-request-id: evil`, `x-admin-token: t` and `authorization: Bearer x` reaches upstream with path `/stickers/api/jobs` and `x-operator: Label Station`, and with none of `cookie`, `x-request-id`, `x-admin-token`, `x-manager-token`, `authorization`. (HG)
- **P1-AC6b** Same as P1-AC6 plus `Expect: 100-continue`, sent as a `POST /stickers/api/jobs` with a matching Origin and a 64 KiB body. The stub upstream receives: `x-operator: Label Station`; none of `cookie`, `x-request-id`, `x-admin-token`, `x-manager-token`, `authorization` or `expect`; and a body with the same SHA-256. Likewise, `GET /j/ABC234` with `Expect: 100-continue`, `cookie: a=b` and `x-operator: Mallory` reaches upstream with no `expect`, `cookie` or `x-operator`. (HG, using `node:http` `request` so the `Expect` header is really sent)
- **P1-AC7** Valid cookie and matching Origin. A 1 MiB multipart `POST /stickers/api/jobs` reaches upstream with the same SHA-256. (HG)
- **P1-AC8** Valid cookie. POST, PATCH or DELETE with (a) no Origin and no `Sec-Fetch-Site`, (b) `Origin: https://evil.example`, or (c) the same host on another port → 403 `ORIGIN_REJECTED`, upstream receives 0. With (d) no Origin plus `Sec-Fetch-Site: same-origin`, or (e) a matching Origin → proxied. (HG)
- **P1-AC9** Valid cookie. PUT or OPTIONS → 405, upstream receives 0. (HG)

**Session lifetime and revocation**
- **P1-AC10** Take a cookie issued earlier. The next `GET /stickers/api/jobs` → 401 with `Set-Cookie: sh_stickers=;` and `Max-Age=0` after any one of (HG):
  - (a) one character of the mac changed
  - (b) the clock moved past `exp`
  - (c) the user set to `active=0`
  - (d) the salt/hash replaced
  - (e) the name removed from the allowlist
  - (f) a different secret
  - (g) the user row deleted
- **P1-AC11** A cookie from gate instance A is accepted by gate instance B built with the same env and DB. (HG)
- **P1-AC27** Multiple cookies (F4, HG):
  - (a) `Cookie: sh_stickers=garbage; sh_stickers=<valid>` → proxied, and the response has no `sh_stickers` Set-Cookie.
  - (b) `Cookie: sh_stickers=<valid>; sh_stickers=<tampered>` → proxied, no clearing cookie.
  - (c) `Cookie: sh_stickers=garbage; sh_stickers=<tampered>` → 401 with exactly one clearing `Set-Cookie: sh_stickers=;` with `Max-Age=0`.
  - (d) `Cookie: sh_stickers=<valid for uid 7>; sh_stickers=<valid for uid 8>`, both allowlisted → upstream `x-operator` is uid 7's name.

**Configuration and dev trap**
- **P1-AC12** (HG, plus the exported `resolveGateConfig(env)`)
  - Each of the following → `GET /stickers/` and `POST /stickers/_auth/login` return 503 `STICKERS_NOT_CONFIGURED`, **while `GET /j/ABC234` is still proxied**:
    - secret unset
    - 63 hex characters
    - 65 hex characters
    - allowlist empty
    - `STICKERS_SESSION_DAYS=0`
  - `STICKERS_ENGINE_URL=http://10.0.0.5:6969`, or `HUB_PORT=3101` with `STICKERS_ENGINE_URL` unset → `/stickers/`, the login POST and `/j/ABC234` all return 503. Upstream receives 0.
  - Both unset → target is `http://127.0.0.1:6969`.

**Short links and request targets**
- **P1-AC13** No cookie (HG):
  - `GET /j/ABC234?x=1` → upstream receives `GET /j/ABC234`: no query, no `cookie`, no `x-operator`.
  - `HEAD /J/abc234` → upstream receives `HEAD /j/abc234`.
  - `POST /j/ABC234` → 405.
  - `GET /j/ABC/def`, `GET /j/%2e%2e`, `GET /j/` and a 33-character code → 404.
  - Upstream receives 0 for the last five.
- **P1-AC14** Valid cookie, upstream stopped. `GET /stickers/api/jobs` → 502 `ENGINE_UNAVAILABLE`, and `GET /stickers/_auth/login` still → 200. (HG)
- **P1-AC15** `POST /stickers/_auth/logout` with a matching Origin → 303 to the login page plus the clearing cookie. `GET /stickers/_auth/login` → 200 with `Cache-Control: no-store` and the exact CSP. (HG)
- **P1-AC25** Over a raw TCP socket, `GET http://127.0.0.1/j/ABC234 HTTP/1.1` and `GET http://127.0.0.1/stickers/api/jobs HTTP/1.1` → 400 `BAD_REQUEST_TARGET`. Upstream receives 0. (HG)

**Dev stack end-to-end**
- **P1-AC16** (PW) Open `https://localhost:3101/stickers/` → login form. Sign in as `Label Station` with the PIN read from `$D/station-pin` → engine UI loads. Upload `/root/Sticker gen/PKG-146468.PDF` → job `<id>`. Then (DEV):
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6975/stickers/api/jobs/<id>   # 200
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6969/stickers/api/jobs/<id>   # 404
  ```
  A new browser context loaded with the stored cookies opens `/stickers/` without a login prompt.
- **P1-AC17** (DEV/PW) `GET /health` → 200. `GET /` → 200. `POST /api/auth/manager` for `Dev Manager` returns a `token`. `GET /api/manager-list` does not contain `Label Station`.
- **P1-AC18** (PW) Signed in to the dev admin UI as `Dev Admin`, with the PIN from `$D/admin-pin`. The dev DB holds `Dev Admin`, `Dev Manager`, `Label Station`, and `Dev Employee` (role `employee`, `active=0`).
  - (a) The new-account form offers `Label station (Sticker Engine only)`. Creating `Label Station 2` with it stores `role='station'`. Check with `sqlite3 -readonly data/dev-gatepass.db "select role from users where name='Label Station 2'"` → `station`.
  - (b) The default view lists `Dev Admin`, `Dev Manager`, `Label Station` and `Label Station 2` in that rank order, and not `Dev Employee`. The note reads `4 manager/admin/station accounts. 1 employee login hidden.` with a `Show all accounts` button.
  - (c) Station rows have badge class `role-badge role-station`, with a non-transparent computed background.
  - (d) Typing `Label` in search lists both station rows. `Show all accounts` is still offered, so the view has not widened.
  - (e) Typing `Dev Employee` widens the view to all accounts and lists that account.
  - (f) After `Show all accounts`, the toggle button reads `Managers, admins and station` (F5).

**Admin login and PIN policy (B1, F1)**
- **P1-AC20** In-memory DB with active admin `A` (16-character PIN). `POST /api/auth/admin` with `{name:'A', pin:<wrong 16 chars>}` and with `{name:'Nobody', pin:<16 chars>}` → both 401. The bodies are byte-identical, equal `{"error":"Invalid name or PIN"}`, and have equal `Content-Type` and `Content-Length`. (HG, `backend/test/adminLogin.test.js`)
- **P1-AC21** Each of the following → 401 with the P1-AC20 body, never 500:
  - admin `A` with `active=0`
  - body `{}`
  - no body at all
  - `{"name":["A"],"pin":"<16 chars>"}`
  - `{"name":"A","pin":1234}`
  - **admin `B` whose stored PIN is 11 characters, signing in with that correct PIN (F1c)**; the log reason is `bad_body`

  (HG)
- **P1-AC22** After 10 failed admin logins from one socket address within 15 minutes, the 11th attempt, even with the correct PIN → 429 `{"error":"Too many sign-in attempts. Wait 15 minutes."}`, and `issueSession` is not called. After 15 minutes and 1 second, the correct PIN → 200 `{ok:true, name:'A', token}`. (HG)
- **P1-AC23** The admin and station limiters are independent: 10 admin failures from X do not block a station login from X, and the reverse also holds. (HG)
- **P1-AC26** Reset-PIN policy (F1e), via `createResetPinHandler` behind a stub `requireAdmin`, in-memory DB (HG, `backend/test/pinPolicy.test.js`):
  - (a) Target role `admin`, 11-character `newPin` → 400 `{"error":"Admin and station PINs must be at least 12 characters."}`. The row's salt and hash are unchanged.
  - (b) Target role `station`, 11 characters → the same 400, unchanged.
  - (c) Target role `manager`, `"1234"` → 200 `{ok:true}`, and the hash now matches `hashPin("1234", newSalt)`.
  - (d) Target role `admin`, 12 characters → 200, hash changed.
  - (e) `rowIndex` of a missing row → 404 `{"error":"User not found"}`.
  - (f) `newPin` missing, or `newPin: 123456789012` (a number) → 400 `{"error":"rowIndex and newPin required"}`.
  - (g) After (d), `POST /api/auth/admin` with the new 12-character PIN → 200.

**Cookie re-issue (N1)**
- **P1-AC24** Valid cookie with `iat = now - 86401 s` (HG):
  - An authenticated GET response includes `Set-Cookie: sh_stickers=v1.7.` with `iat` = now and `exp = iat + 30*86400`.
  - The same request as POST (matching Origin) gets no `sh_stickers` Set-Cookie.
  - `iat = now - 3600 s` gets no Set-Cookie on GET.
  - After a PIN reset, the re-issued cookie → 401.

**Release and production smoke**
- **P1-AC28 (SMOKE, before deploy, on the old code)**
  - The count from 0.7 equals the number of admins who completed release step 2.
  - Each of them has signed out and back in to `/admin` with their new PIN of 12 or more characters.
  - After that, `POST /api/auth/admin` with each admin's old PIN → 401. On the old code this body is `Invalid PIN`, which is expected before deploy.
- **P1-AC19 (SMOKE, after deploy)** From the VPS:
  ```bash
  curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:3001/stickers/api/jobs                       # 401
  curl -sk -H 'Accept: text/html' -o /dev/null -w '%{http_code} %{redirect_url}\n' https://127.0.0.1:3001/stickers/   # 303 …/stickers/_auth/login
  curl -sk -o /dev/null -w '%{http_code}\n' -X POST https://127.0.0.1:3001/j/ABC234                         # 405
  curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:3001/j/NOSUCH2                                # 404
  curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:3001/health                                   # 200
  curl -sk -w '\n%{http_code}\n' -H 'content-type: application/json' -d '{"name":"x","pin":"yyyyyyyyyyyy"}' https://127.0.0.1:3001/api/auth/admin   # {"error":"Invalid name or PIN"} 401
  pm2 logs gatepass --lines 80 --nostream | grep -E '\[stickers\] gate'                                     # "gate configured … allowedUsers=1"
  ```
  Then, by hand:
  - Each admin signs in to `/admin` with their 12+ character PIN.
  - At the station: sign in once, fully close the browser, reopen it, and confirm there is no login prompt.
  - In `/admin`, `Label Station` is listed without `Show all accounts` and shows the station badge.

**Phase 1 AC IDs (final):** P1-AC1, AC2, AC3, AC4, AC5, AC6, AC6b, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC15, AC16, AC17, AC18, AC19, AC20, AC21, AC22, AC23, AC24, AC25, AC26, AC27, AC28. (P1 has no AC29 or higher. The numbering gap between AC19 and AC20 is historical, not a missing criterion.)
- **HG:** AC1–15, AC6b, AC20–27
- **PW/DEV:** AC16–18
- **SMOKE:** AC19, AC28

### Phase 2 (engine deploy A)

- **P2-AC1** A line has qty, batch and `mnfDate 09/2026`. `PATCH /api/jobs/:id/lines/:n {"expDate":"08/2026"}` returns (`test/http.jobs.test.js`, `test/enrich.test.js`):
  - `line.status === 'blocked'`
  - `readiness.ready` excludes the line
  - `warnings` contains `{code:'EXPIRY_BEFORE_MANUFACTURE', severity:'error', line:n}`
  - `provenance` deep-equals `GET /api/jobs/:id` `provenance`
- **P2-AC2** That blocked line. `POST /print` with `lines=[n]` for `browser`, `webusb` and `network` → 409 `JOB_NOT_READY`. The message contains `Line n cannot be printed:` and the expiry message. No runs exist, and the audit log is empty. (`test/http.print.test.js`)
- **P2-AC3** `buildApp({ guard: stub })`, where the stub returns one `severity:'error'` `BARCODE_TOO_NARROW` for line n when `placed.width` matches the 300-dpi template, and `[]` otherwise. `POST /print` at dpi 300 → 409 `LABEL_NOT_PRINTABLE` naming line n, no run, empty audit. At dpi 203 → 202. A test that does not pass `guard` still gets the real guard. (`test/http.print.test.js`, `test/fixtures/app.js`)
- **P2-AC4** Fixture guard sweep (`test/guard.fixtures.test.js`, written and run first). For every fixture job, give each line mnf `09/2026` and exp `09/2028`, and try each batch code `A1B2C3`, `260900123`, `PB2609001234` and `PB26090012345678`. Run the real `guard()` at 203, 300 and 600 dpi → 0 error-severity warnings. **If this fails: stop and escalate. Do not weaken it.**
- **P2-AC4b (DEV, real documents; N3, F9).** Run the real-document sweep (Phase 2 delivery step 2) over every PDF in the read-only snapshot.
  - **(a) Guard.** For every document, line and batch code above, each `POST …/lines/:n/preview?dpi=203|300|600` has 0 `severity:'error'` warnings.
  - **(b) Line length.** For every PDF, the longest `pdftotext -layout` line is measured and reported as a number only. Every value must be under 2,000. Otherwise the Phase 3 line cap would reject a real document, and that finding must be escalated before Phase 3.
  - The report lists only document index, counts, warning codes and max line length. It never includes document contents.
  - **If (a) or (b) fails: stop, delete the snapshot, report, and escalate (QG for (a); Phase 3 line cap for (b)).**
- **P2-AC5** A blocked line. `GET /api/jobs/:id/zpl?lines=n` → 409 `JOB_NOT_READY`. With `buildApp({ guard: stub })` as in P2-AC3: `…/zpl?lines=n&dpi=300` → 409 `LABEL_NOT_PRINTABLE`, and `?dpi=203` → 200 `application/octet-stream`. (`test/http.render.test.js`)
- **P2-AC6** Config transport `webusb` (`test/http.print.test.js`):
  - `POST /print` with ready, printable lines and either `transport:'webusb'` or no transport → 202, `run.transport === 'webusb'`, `run.status === 'pending'`, `zpl` starts with `^XA`.
  - `POST /api/runs/:id/sent {"ok":true,"deviceName":"ZD421"}` writes `run.printed` with `transport:'webusb'`, plus one `label.printed` per line.
- **P2-AC7** Identity (`test/http.print.test.js`, `test/http.browserTransport.test.js`):
  - Header `x-operator: Label Station` plus body `operator:"Nimal"` → run has `operator:'Label Station'` and `operatorName:'Nimal'`. Every `run.printed`, `label.printed` and `run.verified` entry has both.
  - No header, body `operator:"Nimal"` → `operator:'unattributed'`, `operatorName:'Nimal'`.
  - An 81-character body operator → 80 characters stored.
  - A numeric body operator → `operatorName: null`.
  - `http.browserTransport.test.js:102-122`: `:117` passes unchanged, and the test gains `runEntry.operatorName === null`.
  - The existing `http.print.test.js` expectations (`:26-38`, `:128-135`, `:138-142`, `:153-161`) pass unchanged.
- **P2-AC8** `state.job.enrichWarnings = [{line:2,code:'A'},{line:3,code:'B'},{code:'DUP'}]`. `editLine(2, …)` resolves with `warnings:[{line:2,code:'C'}]` and `provenance:P` → the state holds exactly `{line:3,code:'B'}` and `{line:2,code:'C'}`, and `job.provenance === P`. (`test/frontend.state.test.js`)
- **P2-AC10** Reprint reason (`test/http.print.test.js`; PW with WebUSB delivery stubbed):
  - A prior `label.printed` exists for the batch. Confirming Print reopens the dialog with `Reprint reason`, and Confirm is disabled while it is blank.
  - `torn label` → `/print` is resent with `reason:'torn label'`, and `run.printed` records `reprint:true, reason:'torn label'`.
  - Server: `reason:"   "` → 409 `REPRINT_REASON_REQUIRED`.
- **P2-AC11 (PW, dev stack)** After uploading `PKG-146468.PDF` and setting line 2 to EXP 08/2026 with MNF 09/2026:
  - the badge `title` contains `before it was made`
  - the status reads `Blocked`
  - the checkbox is disabled
  - the provenance count text has changed
  - a page-context `POST …/print` and `GET …/zpl?lines=2` both return 409
- **P2-AC12 (SMOKE, production, station; requires check 0.1 to have passed)** Print one label with batch `TEST-<yyyymmdd>` over WebUSB through the app. Then:
  ```bash
  tail -n 3 <STICKER_AUDIT_LOG from 0.4, default /root/sticker-engine/data/audit.jsonl>
  ```
  Expect `run.printed` with `"transport":"webusb"` and `"operator":"Label Station"`, and a physical label.

### Phase 2b (engine deploy B)

- **P2b-AC1** `GET /api/jobs/:id/zpl` → 404 `ROUTE_NOT_FOUND`. (`test/http.render.test.js`)
- **P2b-AC2** No device selected. Confirming Print causes no navigation and no request to `/zpl`, and the toast shows `Choose the label printer first`. (`test/frontend.dom.test.js`, PW network log)
- **P2b-AC3** `grep -n "/zpl" README.md docs/sh-it-hub-integration.md` finds no `GET /api/jobs/:id/zpl` entry. The CLI `sticker zpl` lines stay. (DEV)

### Phase 3 (engine deploy C)

- **P3-AC1** `toLines('x' + ' '.repeat(100000))` deep-equals `['x']`. For every `test/fixtures/*.txt`, the output deep-equals the old regex implementation, kept as a helper in the test. (`test/anchors.test.js`)
- **P3-AC2** A reader returns layoutText containing a 2,001-character line → `DocumentReadError` containing `longer than 2,000 characters`, and no parser is called. A 2,000-character line is accepted. Every fixture `.txt` has a max line length under 2,000. (`test/extract.test.js`)
- **P3-AC3** Poppler failures (`test/extract.test.js`):
  - `execFileRunner(process.execPath, ['-e','setTimeout(()=>{},60000)'], {timeoutMs: 200})` rejects with `error.killed === true` (test timeout 10 s).
  - A reader whose runner rejects with `{killed:true}` on the **pdfinfo** call → `DocumentReadError` containing `took longer than 20 seconds`, detail `pdfinfo timed out`.
  - The same on the **pdftotext** call (pdfinfo succeeds) → detail `pdftotext timed out`.
  - `{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'}` on either call → message contains `8 MB`, with the matching detail.
  - Any other rejection keeps the existing message.
- **P3-AC5** Memory file store. After `POST /api/jobs` succeeds, and after it fails with `UnknownDocumentError`, "Two … documents", a missing parser, `JoinError`, or a PNG upload that fails extraction → `fileStore.files.size === 0`. On success the stored record has `stagedFiles` `[]`. (`test/http.jobs.test.js`)
- **P3-AC6** Temp directory containing `0b8e6b7e-8a8c-4c1e-9b0a-2f6f7e8d9c10.pdf`, `…9c11` (no extension), `…9c12.png`, `notes.txt`, `KEEP.pdf`, and a directory `…9c13.pdf/` → `sweepStagedUploads(dir)` returns 3. The three UUID files are gone and the other three entries remain. A missing directory → 0, no throw. (`test/http.infra.test.js`)
- **P3-AC7 (DEV)** With the dev engine stopped, create `$D/uploads/11111111-2222-4333-8444-555555555555.pdf`, then start it. Within 5 s, stdout shows `"event":"server.listening"` followed by `"event":"uploads.swept"` with `"removed":1`, and the file is gone.
- **P3-AC8 (DEV)** Another process holds the port:
  ```bash
  node -e "require('net').createServer().listen(6975,'127.0.0.1')" &
  ```
  Create `$D/uploads/11111111-2222-4333-8444-555555555556.pdf` and start the dev engine on 6975. Expect: exit code 1 within 5 s; stderr contains `"event":"server.listen_failed"`; no `server.listening` and no `uploads.swept`; the file still exists.
- **P3-AC9** `npm test` passes with ≥ 497 tests plus the new ones, and `npm run golden` produces no diff in `test/fixtures/`.

---

## Non-goals

- Changing gatepass PIN hashing.
- Hardening the **manager** login or manager PIN length (not a path to station access).
- Enforcing a minimum PIN length at account creation (`server.js:842-851`). A short admin or station PIN fails closed at sign-in.
- Hiding names returned by `/api/employees` or `/api/manager-list`.
- A global login lockout (rejected, D10).
- Host firewall, TLS certificates, domain name, or Traefik in front of gatepass.
- Authentication inside the engine.
- Multiple stations, per-device revocation, a session list UI, or role-based sticker access.
- Validating `role` values in `POST /api/admin/users`.
- Mandatory scan-back verification.
- Closing the audit gaps R13 and R14.
- Limiting poppler concurrency, or rejecting PNG/JPEG uploads (both in Backlog).
- CLI status or guard checks for `sticker print --line N` (`bin/sticker.js:195-196`).
- Network-printer, short-link, CLI and diagnostics fixes (Backlog).
- Engine CSP, running as non-root, the possible x.gd key (paused by the human).
- Updating `SH-IT_Hub/CLAUDE.md` "Test command" (the human does this after Phase 1 merges).
- Hiding the home-page tile (`apps/home/index.html:405`).

---

## Data model changes

- **gatepass.db: no schema change and no migration. db-migration-guard is not required.**
  - One new `users` row (`role='station'`) is created through the existing API before the deploy. `role` is free TEXT.
  - Admin PIN hashes change through the existing reset-pin route, run by the admins themselves before the deploy. No structural change.
  - Rollback: disable the station row. Admin PINs stay long, which also works with the old code.
- **Hub config:** new env lines in `backend/.env`. Old code ignores them.
- **Cookie format:** `v1`.
- **Engine audit record (Phase 2):** `operator` becomes header-only; `operatorName` is added.
- **Engine staged uploads (Phase 3):** kept only until the end of the request, plus the boot sweep.

---

## Failure modes and required handling

| failure | detection | system response |
|---|---|---|
| Hub `.env` lacks or mis-parses `STICKERS_*` | Boot log `[stickers] gate misconfigured: …` | `/stickers` returns 503 (fail closed); `/j` works if the engine URL is valid; gatepass otherwise normal |
| Shell running `shdeploy` has `HUB_*` or `STICKERS_*` exported | Release step `unset`; boot log | Prevented by procedure. If it happens, fix with `unset` then `pm2 restart gatepass --update-env` |
| Dev Hub started without `STICKERS_ENGINE_URL` | `HUB_PORT≠3001` rule | 503 on `/stickers` and `/j`; live engine never contacted |
| Engine down | Proxy `error` event | 502 `ENGINE_UNAVAILABLE`; Hub stays up |
| Request carries `Expect: 100-continue` | httpxy skips `proxyReq` (`index.mjs:289`) | Headers already cleaned in `req.headers` before the proxy (F3, P1-AC6b) |
| Several `sh_stickers` cookies | Parse collects every value | First valid value is used; clearing cookie only when none is valid (P1-AC27) |
| Admin PIN guessing from one IP | Admin limiter | 429 after 10 failures per IP per 15 min; identical 401 bodies; PIN of 12+ characters required |
| Station PIN guessing from one IP | Station limiter | Same limits; 12+ character PIN required; generated PINs are 16 base64url characters (96 bits) |
| Guessing from many IPs | Per-IP only; `[login-limiter] global ceiling reached` log | Not blocked (D10). Defence is PIN length: 10 guesses per IP per 15 min against 2^96 (generated) or a 12+ character minimum. Human reads the log (R16) |
| Legitimate user's IP is rate-limited (typos, shared office NAT) | 429 response; `[admin-login] failed … rate_limited` | Wait 15 min, or `pm2 restart gatepass` (clears limiters; logs everyone out) |
| Limiter tracks more than 10,000 IPs in one map | `[login-limiter] <name> evicted count=<n>` (once per window) | Oldest key of that map evicted. A newcomer is always tracked. An attacker unblocks one old key only by blocking a new one (10 failures per address). |
| An admin or station PIN reset to fewer than 12 characters | pinPolicy | 400, no write (P1-AC26). The UI shows the message |
| An admin still has a short PIN at deploy | Release step 2 and P1-AC28 missed | That admin cannot sign in (401, `bad_body`). Recovery: another admin resets their PIN (12+); if they are the only admin, `shdeploy rollback gatepass`, then reset on the old code, then redeploy |
| Station cookie stolen | n/a | Reset PIN (R-b, 12+ characters) invalidates it on the next request |
| Station account disabled, PIN reset, removed from allowlist, or deleted | Per-request DB check | 401 or 303; clearing cookie when no valid value remains |
| gatepass restart | n/a | Station cookie still valid; limiters cleared; managers and admins logged out |
| Station idle more than 30 days | `exp` | Human signs the station in again |
| Cross-site or cross-port write | Origin / Sec-Fetch-Site | 403, nothing proxied |
| Absolute-form request target | Rule 0 | 400, nothing proxied |
| Forged `x-operator` / `x-request-id` | Header cleaning (two layers) | Engine sees only the values the gate set |
| Bad `/j` method or code | Filter | 405 / 404, nothing proxied |
| Station row created before Phase 1 ships | Pre-Phase-1 admin UI | Listed only under "Show all accounts"; cosmetic |
| Blocked or guard-failing line on `/print` or `/zpl` | 2.2 / 2.3 | 409; no run, no audit entry, no file |
| WebUSB unusable on the station | Check 0.1 | Phase 2 still deploys and the guarded download remains; P2-AC12 and Phase 2b wait |
| Zadig rebinding breaks the download driver | QZ1 | 0.1 forbids rebinding until QZ1/QZ2 are answered |
| Reprint needed | 409 `REPRINT_REASON_REQUIRED` | Reason dialog; audited reprint |
| Two tabs prepare the same new batch at once | Not detected (R13) | Both may print; the duplicate is visible in the audit log |
| USB send succeeds but `reportSent` is lost | Run stays `pending` (R14) | No audit entry; lost on engine restart |
| Guard refuses a real batch code | P2-AC4 / P2-AC4b; 409 in production | Escalate (QG); rollback if seen after release |
| Real document has a line of 2,000+ characters | P2-AC4b(b) | Escalate before Phase 3 |
| Huge whitespace line in an upload | Line cap | 422; file removed |
| Poppler hangs or floods output (either call) | 20 s SIGKILL / 8 MiB, both catch blocks | 422; file removed |
| Crash mid-upload | Boot sweep after listen | Orphan deleted on next start |
| Second engine instance on the same port | Listen error | Exit 1; no sweep |
| `STICKER_TMP` misconfigured | UUID name pattern | Other files untouched |
| `shdeploy rollback` run twice | Procedure warning | Forbidden (re-applies the bad commit) |

---

## Observability

**Hub** (`pm2 logs gatepass`; never logs a PIN, cookie or secret):
- Boot: `[stickers] gate configured engine=<url> allowedUsers=<n> sessionDays=<n>` or `[stickers] gate misconfigured: <problems>`; `[stickers] shortlinks engine=<url>` or `[stickers] shortlinks misconfigured: <problem>`
- `[stickers] login ok name="<name>" ip=<addr>`
- `[stickers] login failed name="<submitted, ≤100 chars, non-printable→?>" ip=<addr> reason=<bad_body|unknown_user|inactive|not_allowed|bad_role|bad_pin|rate_limited|origin_rejected>` (the name is JSON-encoded)
- `[stickers] session rejected reason=<malformed|expired|future_iat|bad_mac|user_missing|inactive|not_allowed|bad_role> uid=<uid|->` (one line per request, for the first rejected value)
- `[stickers] session reissued uid=<uid>`
- `[stickers] origin rejected method=<M> path=<path> origin=<JSON-encoded value, raw value capped at 200 chars, or "-">`
- `[stickers] bad request target`
- `[stickers] engine unavailable code=<code>`
- `[admin-login] failed ip=<addr> reason=<bad_body|unknown_or_inactive|bad_pin|rate_limited>`
- `[admin-login] ok name="<name>" ip=<addr>`
- `[reset-pin] refused short PIN role=<role> id=<id>`
- `[login-limiter] global ceiling reached limiter=<stickers|admin> failures=<n>` (once per window)
- `[login-limiter] <name> evicted count=<n>` (at most once per window)
- `[stickers] login error <message>` / `[stickers] session error <message>` (generic 500 returned, no stack)

**Engine** (`pm2 logs sticker-engine`, JSON):
- `http.request`
- `http.error` with `code`
- `server.listen_failed`
- `uploads.swept {removed}`
- `uploads.sweep_failed`
- `run.prepared` with `operator`
- `audit.jsonl`

**What a human checks:**

| When | Check |
|---|---|
| Phase 1, before deploy | P1-AC28 |
| Phase 1, after deploy | P1-AC19; also `pm2 logs gatepass --lines 500 --nostream \| grep -E 'global ceiling\|rate_limited'` weekly for the first month |
| Phase 2 | P2-AC12 (after 0.1) |
| Phase 2b | The precondition grep |
| Phase 3 | `pm2 logs sticker-engine --lines 50 --nostream \| grep -E 'uploads.swept\|listen_failed'`, then `find <STICKER_TMP> -maxdepth 1 -type f \| wc -l` |

---

## Delivery plan

### Dev environment (all phases; localhost only)

**Preconditions (the agent checks these and stops on failure):**
```bash
test ! -e /root/dev/SH-IT_Hub/backend/.env && test ! -e /root/dev/SH-IT_Hub/backend/credentials \
  && test ! -e /root/dev/SH-IT_Hub/backend/baileys_session || echo "STOP: dev Hub clone holds secrets or a WhatsApp session"
ss -ltnp | grep -E '127\.0\.0\.1:(6975|3101)\b' && echo "STOP: dev port in use"
```

Starting `server.js` has side effects:
- WhatsApp pairing starts (`whatsapp-client.js:82`). Nobody may scan the QR code.
- `managerSync` skips without a token (`managerSync.js:62-65`).
- `sheetSync` fails without credentials.

Never create passes on the dev Hub.

**Dev engine:**
```bash
export D=$(mktemp -d "<session scratchpad>/sticker-dev.XXXX")
cd /root/dev/sticker-engine && STICKER_PORT=6975 STICKER_HOST=127.0.0.1 STICKER_BASE_PATH=/stickers \
  STICKER_PRINT_TRANSPORT=webusb STICKER_TMP="$D/uploads" STICKER_AUDIT_LOG="$D/audit.jsonl" \
  STICKER_SHORTLINK_STORE="$D/shortlinks.json" STICKER_ARCHIVE_DIR="$D/jobs" \
  STICKER_SHORT_BASE=https://standard-holdings.lk node src/server.js
```

**Dev Hub** (127.0.0.1:3101, fresh DB, throwaway cert; generated PINs are never printed). Run in a shell where `D` is exported from the block above:
```bash
cd /root/dev/SH-IT_Hub/backend && mkdir -p data && umask 077
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 7 -subj "/CN=localhost" 2>/dev/null
DB_PATH=data/dev-gatepass.db node -e "
const db=require('./db'),c=require('crypto'),fs=require('fs');
const seed=(n,r,p,a=1)=>{const s=c.randomBytes(16).toString('hex');db.prepare('INSERT OR IGNORE INTO users (name,role,dept,salt,hash,active) VALUES (?,?,?,?,?,?)').run(n,r,'Dev',s,c.createHash('sha256').update(p+s).digest('hex'),a)};
const long=()=>c.randomBytes(12).toString('base64url');
const station=long(), admin=long(), manager=String(c.randomInt(1e5,1e6));
seed('Label Station','station',station); seed('Dev Admin','admin',admin); seed('Dev Manager','manager',manager);
seed('Dev Employee','employee',String(c.randomInt(1e5,1e6)),0);
for (const [f,v] of [['station-pin',station],['admin-pin',admin],['manager-pin',manager]]) fs.writeFileSync(process.env.D+'/'+f,v,{mode:0o600});
console.log('seeded');"
HUB_HOST=127.0.0.1 HUB_PORT=3101 DB_PATH=data/dev-gatepass.db STICKERS_ENGINE_URL=http://127.0.0.1:6975 \
  STICKERS_ALLOWED_USERS='Label Station' \
  STICKERS_SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  node server.js
```
- PINs exist only in `$D/station-pin`, `$D/admin-pin` and `$D/manager-pin`.
- If Playwright MCP rejects the self-signed certificate, remove `key.pem`/`cert.pem` and use `http://localhost:3101`. Then confirm that Chromium keeps the `Secure` cookie on localhost.
- For realistic user data only: `sqlite3 /root/SH-IT_Hub/backend/gatepass.db ".backup '/root/dev/SH-IT_Hub/backend/data/gatepass-snap.db'"` (never `cp`). Delete the copy afterwards.

**Cleanup:**
```bash
rm -rf "$D" /root/dev/SH-IT_Hub/backend/{data/dev-gatepass.db*,data/gatepass-snap.db*,key.pem,cert.pem,baileys_session}
```

**Test commands:**
- Engine: `cd /root/dev/sticker-engine && npm test` (baseline 497).
- Hub: `cd /root/dev/SH-IT_Hub/backend && npm test`. New script: `"test": "node --test test/*.test.js"`.
  - Uses node:test, global `fetch`, `node:http` for P1-AC6b, raw `net` for P1-AC25, `better-sqlite3` `:memory:` with the `users` DDL from `db.js:27-36`, and a stub upstream on port 0.
  - No new dependency.
  - Test modules never `require` `./db`, `./whatsapp-client` or `server.js`.

### Phase 1: Hub (ships first, alone)

**Files (final):**

| File | Change |
|---|---|
| `backend/loginLimiter.js` | **new** (per-IP limiter) |
| `backend/pinPolicy.js` | **new** (`MIN_PRIVILEGED_PIN_LENGTH`, `PRIVILEGED_ROLES`, `createResetPinHandler`) |
| `backend/adminLogin.js` | **new** (`createAdminLoginHandler`) |
| `backend/stickerGate.js` | **new** (`createStickerGate({ db, hashPin, env, now, log, limiter })` → `{ stickers, shortLinks }`; `resolveGateConfig(env)`) |
| `backend/test/loginLimiter.test.js` | **new** |
| `backend/test/pinPolicy.test.js` | **new** |
| `backend/test/adminLogin.test.js` | **new** |
| `backend/test/stickerGate.test.js` | **new** |
| `backend/server.js` | Replace `:51-77` with the gate construction plus `app.use('/stickers', gate.stickers)` and `app.use('/j', gate.shortLinks)`, same position before `express.json()`. Replace `:696-705` with the `createAdminLoginHandler` mount. Replace `:865-874` with the `createResetPinHandler` mount behind `requireAdmin`. `:1608` becomes `HUB_PORT`; `:1617` and `:1621` use `HUB_HOST`. `hashPin` (`:151`) and `issueSession` (`:674`) are hoisted function declarations. |
| `backend/package.json` | `"test": "node --test test/*.test.js"` |
| `backend/.env.example` | Document `STICKERS_*`, `HUB_PORT`, `HUB_HOST`; replace the note at `:35` |
| `apps/admin/index.html` | `:118-119` (`.role-station`), `:474`, `:673`, `:683-686`, `:694`, `:700`, `:705`, `:772`, `:777` |

**Tests first (test-author):** write the HG tests for P1-AC1–15, AC6b and AC20–27, red against stub modules whose factories throw. Write the PW scripts for P1-AC16–18.

**Gates:**
1. plan-critic (done: APPROVE WITH CHANGES, applied in Rev 2.2)
2. test-author
3. implementer
4. test-runner (Hub `npm test`; engine `npm test` still green)
5. code-reviewer and security-auditor, in parallel
6. release-captain

db-migration-guard: not required.

**Release (human), in this order:**

1. **Pre-flight 0.7.** Note N, the number of active admins (live: 1).
2. **REQUIRED: every active admin resets their own PIN, using the OLD code (F1a).**
   1. Generate a new PIN on a desktop:
      ```bash
      node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"
      ```
      Store it in a password manager.
   2. Sign in to `/admin` with the current PIN. In Managers and admins, find your own row → **Reset PIN** → paste the new PIN → confirm `PIN reset.`. The current session stays valid.
   3. Sign out, then sign in again with the new PIN. It must succeed.
   4. Repeat for each of the N admins (each admin may do it for themselves, or one admin for all, sharing new PINs only through the password manager).
   5. Record P1-AC28.

   Ordering guarantee: the old code accepts any PIN length, so this step cannot lock anyone out. The new code is deployed only once every admin has confirmed signing in with a long PIN.
3. **Create the station row** with a generated 16-character PIN (Station setup, steps 1–2).
4. **Merge and push** the Hub dev commit.
5. **Append to `/root/SH-IT_Hub/backend/.env`,** leaving `STICKERS_ENGINE_URL`, `HUB_PORT` and `HUB_HOST` unset:
   ```
   STICKERS_ALLOWED_USERS=Label Station
   STICKERS_SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   STICKERS_SESSION_DAYS=30
   ```
6. **In the deploying shell:**
   ```bash
   unset HUB_PORT HUB_HOST STICKERS_ENGINE_URL STICKERS_ALLOWED_USERS STICKERS_SESSION_SECRET STICKERS_SESSION_DAYS
   env | grep -cE '^(HUB_|STICKERS_)'     # expect 0
   ```
7. **Deploy** at a time with no gate-pass activity: `shdeploy gatepass`.
8. **Run P1-AC19.** If `misconfigured`, fix the `.env` and run `pm2 restart gatepass`.
9. **Sign in the station.**

**Rollback:** see the Rollback plan. Admin PINs stay long after a rollback, which is harmless.

### Phase 2: engine deploy A

**Preconditions:** Phase 1 live and P1-AC19 passed; 0.2 done; P2-AC4 and P2-AC4b green. **Check 0.1 is not a precondition for this deploy (F8).**

**Files:**
- `src/model/types.js`, `src/enrich/enrichJob.js`
- `src/http/routes/jobs.js`, `src/http/routes/misc.js`, **new** `src/http/identity.js`
- `src/errors.js`, `src/print/runService.js`, `src/audit/auditLog.js`
- `public/js/state.js`, `public/js/app.js`, `public/js/print.js`, `public/js/api.js`
- `public/js/components/printDialog.js`, `public/js/components/lineGrid.js`
- Test harness: `test/fixtures/app.js` (`:51-53`, `:170`)
- Tests: **new** `test/guard.fixtures.test.js`; `test/http.print.test.js`; `test/http.browserTransport.test.js`; `test/http.render.test.js`; `test/http.jobs.test.js`; `test/enrich.test.js`; `test/frontend.state.test.js`
- Reviewed, no change: `bin/sticker.js:195-197`; `README.md:275` (updated in Phase 2b)

**Tests first:**

1. **P2-AC4.** Fixture sweep, as a go/no-go check.
2. **P2-AC4b.** Real-document sweep:
   1. Make a read-only copy into the session scratchpad:
      ```bash
      S=$(mktemp -d "<session scratchpad>/live-pdfs.XXXX"); chmod 700 "$S"
      find /root/sticker-engine/data/uploads -maxdepth 1 -type f -name '*.pdf' -exec cp -p {} "$S/" \;
      ls "$S" | wc -l
      ```
      Use `STICKER_TMP` from 0.4 if it is set. If 0.6 already ran, extract its archive into `$S` instead.
   2. **Line-length measurement (F9, count only):**
      ```bash
      i=0; for f in "$S"/*.pdf; do i=$((i+1)); \
        printf 'doc %d max_line ' "$i"; \
        pdftotext -layout "$f" - | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(d.split(/\r\n|\r|\n/).reduce((m,l)=>Math.max(m,l.length),0)))"; \
      done
      ```
      If `pdftotext` is not on PATH, use the binary directory from `STICKER_POPPLER_BIN`.
   3. Start the dev engine (no Hub needed).
   4. For each PDF, via `127.0.0.1:6975/stickers`:
      - `POST /api/jobs`
      - `PATCH /api/jobs/:id {"qrUrl":"https://example.com/p/123"}`
      - For each line and each batch code: `PATCH …/lines/:n {mnfDate, expDate, batchCode}`, then `POST …/lines/:n/preview?dpi=203|300|600`
      - Count error-severity warnings. Count documents rejected with 422 separately.
   5. The report holds only document index, counts, codes and max line length.
   6. Always run `rm -rf "$S"` afterwards.
3. **Harness seam,** then P2-AC1–3, 5–8 and 10, red.
4. **PW P2-AC11.**

**Gates:**
1. plan-critic
2. test-author
3. implementer
4. test-runner
5. code-reviewer and security-auditor, in parallel
6. release-captain

**Release (human):**
1. Push.
2. `shdeploy sticker-engine` while the station is idle.
3. Operators keep using the guarded download until check 0.1 passes. Then run P2-AC12.

### Phase 2b: engine deploy B (remove download)

**Preconditions:** see Phase 2b (includes check 0.1 and P2-AC12).

**Files:**
- `src/http/routes/jobs.js`, `public/js/api.js`, `public/js/app.js`
- `docs/sh-it-hub-integration.md:161`, `README.md:275`
- Tests: `test/http.render.test.js`, `test/frontend.dom.test.js`

**Gates:** plan-critic (delta) → test-author → implementer → test-runner → code-reviewer → release-captain.

**Release:** `shdeploy sticker-engine` while the station is idle.

### Phase 3: engine deploy C

**Preconditions:** 0.3 (no strays); P2-AC4b has run, including (b); 0.2 done.

**Files:**
- `src/ingest/anchors.js`, `src/ingest/extract.js` (both catch blocks `:154-160`, `:172-178`)
- `src/http/routes/jobs.js`, `src/store/files.js`, `src/server.js`
- Tests: `test/anchors.test.js`, `test/extract.test.js`, `test/http.jobs.test.js`, `test/http.infra.test.js`

**Tests first:** P3-AC1–6 red. P3-AC7–8 as DEV checks after implementation. P3-AC9 last.

**Gates:**
1. plan-critic
2. test-author
3. implementer
4. test-runner
5. code-reviewer and security-auditor, in parallel
6. release-captain

**Release (human):**
1. Optionally run 0.6.
2. `shdeploy sticker-engine` while the station is idle.
3. Check the `uploads.swept` log line.

### Deploy order

1. **Phase 1 (gatepass).**
2. **Phase 2 (engine).** Deploys without waiting for check 0.1.
3. **Phase 3 (engine).** A separate deploy.
4. **Phase 2b (engine).** When its preconditions, including check 0.1, are met.

**Restart impact:**
- A gatepass restart logs out managers and admins and clears both limiters.
- An engine restart clears open jobs.
- If gatepass is rolled back after Phase 2, record the window: `operator` values in that window are client-supplied.

---

## Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **Accepted by the human, 2026-09-13:** live stays up without login until Phase 1 ships | Real now / High | Phase 1 is Hub-only and first |
| R2 | WebUSB does not work on the station | Unknown / High | Check 0.1; the guarded download stays until Phase 2b |
| R3 | `backend/.env` mis-parses appended vars | Medium / Low | Fail closed; boot log; P1-AC19 |
| R4 | Guard enforcement blocks labels that print acceptably today | Low–medium / High | P2-AC4, P2-AC4b; QG; rollback |
| R5 | Shared station: anyone at it prints as `Label Station` | Certain / Medium | By design (D1) |
| R6 | Cookies are not port-isolated on the same host | Low / Medium | Path scope; Origin check |
| R7 | Station uses a different host name | Medium / Low | Setup pins one host |
| R8 | Dev Hub side effects | Low / Low | Preconditions; 127.0.0.1; cleanup |
| R9 | New tests do not cover `server.js` wiring | Medium / Medium | PW P1-AC16–18, SMOKE P1-AC19/AC28 |
| R10 | Manager PINs remain guessable (4 digits); gives gate-pass manager powers, not station access | Existing / Medium | Out of scope |
| R11 | An admin PIN is short | **Low** after Rev 2.2 / High | Required release step 2 and P1-AC28; adminLogin refuses PINs under 12 characters; reset-pin refuses them for admin rows (P1-AC26) |
| R12 | Traefik caveat: behind any proxy, `req.socket.remoteAddress` is the proxy, so every client shares one per-IP bucket; `req.protocol` then depends on `trust proxy` | Future / High | Revisit limiter keying and Origin derivation when a proxy is added |
| R13 | Concurrent `prepare` for the same new batch | Low / Medium | Visible in the audit log afterwards |
| R14 | USB send succeeds but `reportSent` is lost | Low / Medium | Scan-back and physical count |
| R15 | Until Phase 2b, the download path is unaudited, though guarded | Certain until 2b / Medium | Phase 2b preconditions |
| R16 | **Guessing from many IPs is not throttled globally (D10).** An attacker with N addresses gets 10·N guesses per 15 minutes per login. Against a generated 16-character base64url PIN (2^96) this is infeasible at any realistic N. Against a human-chosen PIN at the 12-character minimum it depends entirely on that PIN's real entropy. The only signal is the `global ceiling reached` log line, which nobody is paged on. | Low likelihood / **High** impact | Generated PINs in every release step; weekly log check (Observability); a global lockout was rejected because it would let one attacker lock every admin out |
| R17 | Zadig/WinUSB rebinding removes the Windows driver the download relies on | Unknown / High | Check 0.1 forbids rebinding until QZ1/QZ2 are answered |
| R18 | Phase 3 boot sweep deletes live orphaned PDFs on deploy | Certain / Low (intended) | 0.5 ordering; optional 0.6 archive |
| R19 | A shared office NAT puts the station and admins behind one IP, so 10 typos by anyone lock the admin or station login for 15 minutes | Medium / Low | Wait, or `pm2 restart gatepass`; the station normally does not need to log in (30-day cookie) |

---

## Rollback plan

**Rules (from `/root/ops/shdeploy:191-211`):**
- `shdeploy rollback <service>` undoes **only the latest deploy of that service**.
- **Never run `shdeploy rollback` twice in a row** for the same service. The second run re-applies the deploy you just undid.
- To undo an **older** phase: in `/root/dev/<repo>`, `git revert` that phase's commits, run the tests, push, then `shdeploy <service>` (a forward deploy).
- After any `shdeploy rollback`, also revert in `/root/dev/<repo>` and push (`shdeploy:210`).

| Phase to undo | If it is the latest deploy of that service | If a later deploy of that service exists | Side effects | What remains |
|---|---|---|---|---|
| 1 (gatepass) | `shdeploy rollback gatepass` | revert → push → `shdeploy gatepass` | Logs out managers and admins; `/stickers` open again; admin login brute-forceable again (but admin PINs are now long); station row visible only under "Show all accounts" | `STICKERS_*` lines (ignored); station row (unusable); long admin PINs (still valid) |
| 2 (engine A) | `shdeploy rollback sticker-engine` | revert Phase 2 commits → push → `shdeploy sticker-engine` | Clears open jobs; unsafe print and download paths return; WebUSB `/print` 400 again | Audit lines with `operatorName` (compatible) |
| 2b (engine B) | `shdeploy rollback sticker-engine` | revert → push → deploy | Clears open jobs; guarded download returns | — |
| 3 (engine C) | `shdeploy rollback sticker-engine` | revert → push → deploy | Clears open jobs; quadratic trim, no poppler limits, retained uploads, silent listen failure | Swept PDFs stay deleted (0.6 archive if taken) |
| Revoke the station only | Admin → Reset PIN on `Label Station`, **new PIN of 12+ characters** (generated) | same | Station must sign in again | — |

---

## Backlog (one line each)

- `src/print/runService.js:40`: runs Map never evicted.
- `src/net/printer.js:81`: `'binary'` write mangles `^`/`~` from Latin-1 look-alikes (latent).
- `public/js/app.js:193-199`, `:594-596`: network printer select ignored (latent).
- `src/enrich/shortlink.js:325-330`, `:381-412`: open redirect and non-atomic `shortlinks.json` (latent).
- `bin/sticker.js:59`: CLI lacks the packaging-slip parser.
- `bin/sticker.js:195-196`: `sticker print --line N` ignores line status and guard.
- `public/diagnostics.html:9,17`: base path meta and back link.
- `public/js/state.js:200`: short URL hardcoded to x.gd.
- `src/config.js:115`: dead `STICKER_MANUFACTURER_PREFIX`.
- `public/js/app.js:125,139,145`: stale upload copy.
- `src/http/middleware/uploads.js:94-108`: reject PNG/JPEG at upload.
- Poppler concurrency cap.
- `src/http/middleware/requestId.js:18`: validate `x-request-id` in the engine.
- `server.js:842-851`: validate `role` and enforce a 12-character minimum at account creation for admin/station.
- `apps/admin/index.html:341,476,489`: drop `inputmode="numeric"` now that privileged PINs contain letters.
- R13/R14 audit gaps.
- Manager login rate limiting and uniform errors (R10).
- An alert (not only a log line) on `global ceiling reached` (R16).
- All services run as root.
- **HIGH, accepted risk (human decision, 2026-09-13):** `SH-IT_Hub/backend/server.js:1544` `POST /api/test-whatsapp` has no auth, so anyone on the internet can send any WhatsApp message from the company account. No front end calls it. It was kept out of Phase 1 by the human's choice. Fix: delete it or add `requireAdmin`.
- IT Utilities `src/middleware/upload.js:11-19` trusts the client Content-Type and keeps the original extension. A `.html` upload is then served as HTML on :4100, which is same-site with :3001, so it can be used for clickjacking (security-auditor L1). Phase 1 adds anti-framing headers on `/stickers`; the upload handling itself is a separate service fix.
- Rotate the station cookie secret on a schedule; disabling or re-enabling an account alone does not revoke cookies. Pair it with a PIN reset (security-auditor, informational).

---

## Open questions (blocking)

None block Phase 1 **implementation**. **Q7 is now a required Phase 1 release step** (release step 2). Phase-2 items block only what is named.

| # | Question | Blocks | Severity | Recommended answer (assumed by this spec) |
|---|---|---|---|---|
| Q7 | Has every active admin (live: 1) moved to a PIN of 12 or more characters on the old code, and confirmed sign-in with it? | **Phase 1 release** (`shdeploy gatepass`) | **HIGH** | Required. Release step 2; recorded as P1-AC28. |
| QZ1 | On the station, does rebinding the Zebra to WinUSB (Zadig) remove the Windows driver that today's `.zpl` download printing uses, and how is it restored? | Rebinding during check 0.1; P2-AC12; Phase 2b | **HIGH** (Phase 2 only) | Assume yes. Write down and try the restore steps before any rebinding. |
| QZ2 | How do operators print the downloaded `.zpl` today? | Rebinding decision; Phase 2b | **HIGH** (Phase 2 only) | Human describes the exact steps. If they use the Windows driver, the download stops working on that PC after rebinding. |
| QG | When the server guard refuses a label for a real batch code, what should happen? | Phase 2 release | **HIGH** (Phase 2 only) | Block, no override. P2-AC4b(a) must show zero refusals before release. |
| QP | How long must audited WebUSB printing run before Phase 2b? | Phase 2b | Medium | 10 working days with zero `/:id/zpl` requests. |
| Q2 | Are the Phase 1 variables loaded from `backend/.env`? | Finishing the Phase 1 release (fails closed) | Medium | Verify via the boot log (P1-AC19). |
| Q3 | Stateless cookies instead of a table? | Nothing if accepted | Low | Accept. |
| Q4 | Retention for the 0.6 archive? | Nothing | Low | 7 days. |
| Q5 | Role `station` created via API before deploy? | Nothing if accepted | Low | Accept. |
| Q6 | Anyone besides the station on the allowlist? | Nothing | Low | No. |

VERDICT: READY (Phase 1 ACs final for test-author; Phase 1 release gated on Q7 / P1-AC28. Phase 2 release gated on QG and P2-AC4/AC4b; P2-AC12 and Phase 2b gated on check 0.1, QZ1 and QZ2)
