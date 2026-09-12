# Prompt — USB printing via Zebra Browser Print

Paste the whole of this as one prompt. It is written to produce working code in
a single pass, because it is being run on a launch day.

Read the two sections after the prompt before running it: one is a trap that
will cost you an afternoon if you meet it unprepared, the other is what to
check when it does not work.

---

## The prompt

> **Project:** Node.js 20 + Express thermal label engine, already complete and
> passing 390 tests. It parses Picklist and Sample Note PDFs, renders 4×1 inch
> labels, and prints ZPL II. Printing currently goes server-side over raw TCP to
> port 9100. See `README.md` for the design and `docs/errors.md` for the error
> taxonomy.
>
> **Standing rules:**
> 1. ESM modules, `"type": "module"`. No TypeScript, but full JSDoc typedefs on
>    every exported function and domain object.
> 2. No framework beyond Express. No build step for the frontend — vanilla ES
>    modules served directly.
> 3. Every module is pure and independently testable. Side effects live only in
>    named adapter modules and are injected, never imported deep in the tree.
> 4. Barcodes and QR codes stay native ZPL (`^BC`, `^BQ`). Nothing in this change
>    may cause a symbol to be rasterised.
> 5. Errors are typed `AppError` subclasses with a `code`, `httpStatus`, and a
>    message safe to show a warehouse operator. Never leak a stack trace.
> 6. Every module ships with a `node:test` file beside it. Tests use fixtures,
>    never a real printer and never the network.
> 7. Complete, production-ready code. No `TODO`, no placeholders.
> 8. State your assumptions briefly before writing code. If something is
>    ambiguous, pick the most defensible option, say so, and continue.
>
> **What changes and why**
>
> Every operator has a Zebra connected by **USB**, not by network. A server
> cannot reach a USB printer on someone else's desk, so the ZPL has to be
> delivered by the browser instead. Zebra Browser Print is the supported way:
> a small local application, installed per workstation, plus a JavaScript
> library that hands raw ZPL to a locally connected printer.
>
> The server keeps generating byte-identical ZPL. Only the delivery changes.
> Preserve everything valuable about the current print path — reprint gating,
> the append-only audit trail, scan-back verification — none of which may become
> optional just because the browser is doing the sending.
>
> **Add a transport mode, do not replace the existing one.**
> `STICKER_PRINT_TRANSPORT` is `browser` or `network`, defaulting to `browser`.
> Network printing stays working for any Ethernet Zebra added later, and its
> tests must still pass untouched.
>
> ---
>
> **1. `public/js/browserPrint.js` — a wrapper over Zebra's library**
>
> Zebra's `BrowserPrint.js` is callback-based and its failure modes are all
> reported as opaque strings. Wrap it so the rest of the app sees promises and
> typed errors:
>
> ```js
> BrowserPrint.getDefaultDevice('printer', onSuccess, onError)
> BrowserPrint.getLocalDevices(onSuccess, onError, 'printer')
> BrowserPrint.getApplicationConfiguration(onSuccess, onError)
> device.send(zplString, onSuccess, onError)
> device.readAllAvailable(onSuccess, onError)
> ```
>
> A device has `uid`, `name`, `deviceType` and `connection`. `getDefaultDevice`
> passes `null` when the operator has not set one — that is not an error.
>
> Export:
> - `isAvailable()` — resolves false when the local application is not running,
>   without throwing and without a long hang. Time it out at 3 seconds; a
>   warehouse PC that has not had the agent installed must not present as a
>   hung page.
> - `listPrinters()` — the default device first, then discovery. Zebra's own
>   guidance is to call both on page load, because full discovery is slow when
>   network and Bluetooth discovery are enabled, and showing the default
>   immediately makes it feel fast. Deduplicate by `uid`.
> - `sendZpl(device, zpl)` — promise, typed error on failure.
> - `readBack(device)` — drains anything the printer has said, for diagnostics.
>
> Load `BrowserPrint.js` from `/vendor/` on our own origin rather than from a
> CDN: a warehouse machine may have no route out, and a page that dies when the
> internet does is worse than one that never depended on it. Vendor the file,
> and if it is absent, `isAvailable()` resolves false with a message naming the
> file rather than throwing a module error.
>
> **2. Server: `browser` transport**
>
> `POST /api/jobs/:id/print` gains `transport`. When it resolves to `browser`:
> - run the same readiness check and the same reprint gating, unchanged;
> - create the run with status `pending` rather than `printed`;
> - return `{ run, zpl }` — the concatenated ZPL for the selected lines with
>   their copy counts, exactly as the download endpoint produces it;
> - write no `label.printed` audit entry yet. Nothing has been printed. Writing
>   one here would make the audit trail record intentions rather than events,
>   which is the one thing it must never do.
> - `printer` in the request body is the operator's device name, recorded for
>   the audit trail. It is not resolved against `STICKER_PRINTERS`.
>
> New `POST /api/runs/:runId/sent`, body `{ ok, deviceName, error? }`:
> - on `ok`, move the run to `printed`, write the `run.printed` entry and one
>   `label.printed` entry per line, exactly as the network path does;
> - on failure, move the run to `failed`, write `run.failed` with the reported
>   message, and do **not** write label entries — a batch code that never
>   reached a printer must not appear in the reprint history, or the next
>   genuine print of it will be wrongly gated as a reprint;
> - reject a run that is not `pending` with a typed error, so a replayed or
>   duplicated confirmation cannot double-write the audit trail.
>
> Refactor `runService.print` so the audit-writing half is a named function both
> paths call. Do not duplicate it.
>
> **3. Client: printing**
>
> The printer selector currently reads from `/api/printers`. In browser mode it
> lists local devices instead, with the default preselected. Remember the last
> chosen device in `localStorage` keyed by origin, since a workstation has one
> printer and choosing it every shift is friction with no purpose.
>
> The print flow becomes: confirm dialog → `POST /print` → `sendZpl` → `POST
> /sent`. Show progress; the send is fast but the operator should never be left
> wondering. If `sendZpl` fails, report it, `POST /sent` with the failure, and
> leave the run visibly failed rather than silently gone.
>
> Call `isReadyToPrint` before sending where the Zebra device wrapper is
> available, and surface paper out, head up and ribbon out **before** the ZPL
> goes, not after.
>
> **4. Diagnostics — build this, do not leave it to the console**
>
> A `/diagnostics` page, linked from the interface, showing:
> - whether the Browser Print application is reachable, and its version;
> - every discovered device with its uid, name, connection and default status;
> - a **Send test label** button that prints a small known label — a border, the
>   device name, and a Code 128 of `TEST12345` — so a barcode can be scanned
>   without setting up a whole job;
> - a **Send raw ZPL** box for pasting a label by hand;
> - whatever `readBack` returns after a send;
> - for each failure, what to do about it in words, not an error string.
>
> This page is the difference between debugging at a printer in ten minutes and
> debugging over the phone for an hour.
>
> **5. Error taxonomy**
>
> Add typed errors and document each in `docs/errors.md` with a "what to do"
> column, matching the existing table:
>
> | Code | When | Message should say |
> |---|---|---|
> | `BROWSER_PRINT_UNAVAILABLE` | The local application is not running or not installed | Name the installer and that it must be running |
> | `BROWSER_PRINT_NO_DEVICE` | Discovery returned nothing | Check the USB cable and that the printer is powered |
> | `BROWSER_PRINT_SEND_FAILED` | `device.send` failed | Carry Zebra's own message in the detail, not the message |
> | `BROWSER_PRINT_NOT_READY` | `isReadyToPrint` reported a fault | Name the fault: paper out, head up, ribbon out |
> | `RUN_ALREADY_SETTLED` | `/sent` called on a run that is not pending | The run has already been recorded |
>
> **6. Tests**
>
> - The wrapper against a stubbed `window.BrowserPrint`: available, unavailable,
>   timeout, no default device, discovery failure, send failure.
> - Route tests for browser transport: ZPL returned and not sent server-side;
>   no label audit entries until `/sent`; `/sent` writes them; a failed `/sent`
>   writes `run.failed` and no label entries; a replayed `/sent` is rejected.
> - **A test asserting the ZPL returned to the browser is byte-identical to what
>   the network path would have sent.** This is the property that matters: the
>   delivery changed, the label did not.
> - The existing network-transport tests must still pass unmodified.
>
> **7. Documentation**
>
> Update `README.md` and `docs/deploy.md`: how to install Browser Print, the
> transport setting, the mixed-content constraint in section 8 below, and the
> diagnostics page. Remove the claim in `docs/deploy.md` section 0 that a
> hosted VPS cannot print — with browser transport it can, because printing
> happens on the operator's machine.
>
> **8. The constraint that will bite**
>
> Browser Print's local service listens on `http://localhost:9100`. A page
> served over **HTTPS cannot call an HTTP localhost endpoint** — the browser
> blocks it as mixed content, and the failure looks exactly like "the
> application is not installed".
>
> Handle it explicitly: when the page is on HTTPS and the wrapper cannot reach
> the local service, the error must say so and name the two ways out — serve
> the interface over plain HTTP on the LAN, or configure Browser Print's HTTPS
> endpoint and trust its certificate. Guessing at this from a generic
> "unavailable" message wastes an afternoon.

---

## Before you run it: the HTTPS trap

If you followed `docs/deploy.md` and ran certbot, **turn TLS off for today** or
you will spend the launch fighting mixed content rather than printing labels.

On a warehouse LAN, plain HTTP is a reasonable choice: the traffic never leaves
your network, and the alternative is asking every operator to trust a local
certificate. Serve it at `http://sticker.yourdomain.local` or straight at the
VPS address, get printing working, and revisit TLS afterwards.

If the interface must be HTTPS, configure Browser Print's HTTPS endpoint and
install its certificate on each workstation **before** the shift starts, not
during it.

## When it does not work

In this order. Each step rules out everything below it.

1. **Is the Browser Print application running?** It is a tray application, not
   a service that starts itself. Check the system tray.
2. **Open `/diagnostics`.** If it says unavailable, it is the application or the
   mixed-content trap above — not your printer.
3. **Does the printer appear in the device list?** If not, it is the USB cable
   or the power, and no software will find it.
4. **Send a test label from `/diagnostics`.** A blank label means the printer is
   fine and the ZPL is wrong. Nothing at all means the connection is wrong.
5. **Scan the test barcode.** If it prints but will not scan, that is darkness
   or the printhead, not the software — see the barcode section in the README.
6. **Only then print a real job.**

## What has not changed

Worth saying plainly, because it is the point of doing it this way:

- The server generates identical ZPL. A test asserts it byte for byte.
- Reprint gating still refuses a batch code that has been printed before,
  without a reason.
- The audit trail still records who printed which batch, when, and whether it
  was verified — and still records it only after something was actually sent.
- Scan-back verification is untouched. The run is still not complete until a
  printed label has been read back and matched.
