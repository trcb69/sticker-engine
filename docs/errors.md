# Error codes

Every failure the system produces is a typed error with a stable `code`, an
HTTP status, and a message written for whoever is standing at the printer. The
code is safe to branch on; the message is safe to show. Anything not in this
table is a bug and surfaces as `INTERNAL_ERROR` with a request id.

    { "error": { "code": "DOCUMENT_UNRECOGNISED",
                 "message": "This document is not a Sample Note or a Picklist.",
                 "requestId": "req_01HZ..." } }

## Configuration and startup

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `CONFIG_INVALID` | 500 | One or more environment variables are wrong. Every problem is listed at once. | Fix them all; the service will not start until they are right. |
| `ITEM_MASTER_INVALID` | 500 | Reserved. No item master exists any more. | Should not occur. |

## Documents

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `DOCUMENT_UNRECOGNISED` | 422 | No Sample Note, Picklist or Sales Order marker was found. The detail lists every marker searched for. | Check the right file was uploaded. A re-exported PDF whose heading became an image will still match on its document number. |
| `DOCUMENT_UNREADABLE` | 422 | The file is not a readable PDF, or it has no text layer. | A scan needs OCR, which is not built. Export the document from the ERP rather than scanning it. |
| `DATE_UNPARSEABLE` | 422 | A date is impossible under the configured order — for example month 13 under `MDY`. | Check `STICKER_DATE_ORDER` before assuming the document is wrong. The parse is refused rather than the parts being swapped. |
| `CSV_INVALID` | 500 | Reserved. | Should not occur. |
| `JOIN_FAILED` | 422 | No usable document was supplied. | Upload a Picklist; it carries the item names and quantities. |

## Template and rendering

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `TEMPLATE_INVALID` | 500 | The label template is malformed. | `sticker validate-template src/template/label-4x1.json` names the slot. |
| `TEMPLATE_BIND_FAILED` | 500 | A slot refers to a value that does not exist. | A template bug; the detail names the slot and token. |
| `LAYOUT_FAILED` | 500 | A slot has no room left on the label. | Usually a very long quantity or date pushing the barcode off the edge. |
| `QR_PAYLOAD_TOO_DENSE` | 400 | The link needs more modules than fit at three dots each. | Shorten it. A full ClickUp URL never fits; that is what the shortener is for. |

## Uploads

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `UPLOAD_REJECTED` | 415 | Nothing was attached, or a file's bytes are not a PDF, PNG or JPEG. | The name is ignored; only the content counts. |
| `UPLOAD_TOO_LARGE` | 413 | A file exceeds `STICKER_MAX_UPLOAD_BYTES`. | Default 10 MB. Raise it if a real Picklist is bigger. |

## Jobs

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `JOB_NOT_FOUND` | 404 | Expired or never existed. Jobs live for `STICKER_JOB_TTL`, default 30 minutes. | Upload the documents again. |
| `LINE_NOT_FOUND` | 404 | No such line on this job. | |
| `BAD_REQUEST` | 400 | A field that is not editable, a bad copy count, an unsupported dpi. | The message says what is allowed. |
| `JOB_NOT_READY` | 409 | A selected line still needs a batch code or dates. The message names the lines. | |

## Short links

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `SHORTLINK_FAILED` | 502 | x.gd is unreachable, rate limited, or rejected the request. The detail carries their status. | 401 means the API key is wrong. 429 means wait — no labels were printed. |
| `SHORTLINK_NOT_FOUND` | 404 | A short code is not in the local archive. | Only codes minted by this system are archived. |

## Printing

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `PRINTER_UNKNOWN` | 400 | No printer by that name. The message lists the configured ones. | Check `STICKER_PRINTERS`. |
| `PRINTER_UNREACHABLE` | 502 | No connection within the timeout, or the socket errored. | Check the printer is on and on the network. The detail carries the errno. |
| `PRINTER_WRITE_FAILED` | 502 | Connected, then the write failed. | Usually the printer was switched off mid-job. Nothing was verified; treat the run as unknown. |
| `REPRINT_REASON_REQUIRED` | 409 | A batch code in this run has been printed before. | Supply `reason`. A duplicate batch code in circulation is a traceability event and is never allowed to happen silently. |
| `VERIFICATION_MISMATCH` | 409 | The scanned label does not match what the run printed. | **Do not release the labels.** See the troubleshooting section in the README. |
| `RUN_NOT_FOUND` | 404 | Unknown print run. Runs are held in memory; a restart clears them. | The audit log still has the record. |

## USB printing (Zebra Browser Print)

These arise in the browser, not on the server, and appear in the interface and
on `/diagnostics`.

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `BROWSER_PRINT_UNAVAILABLE` | — | The local application is not running, or `public/vendor/BrowserPrint.js` is missing | It is a **tray application**, not a service: check the system tray and start it. If the page is on HTTPS see the note below — the symptom is identical. |
| `BROWSER_PRINT_NO_DEVICE` | — | Discovery found no printer | Check the USB cable and that the printer is switched on, then reload. |
| `BROWSER_PRINT_SEND_FAILED` | — | `device.send` failed or timed out | Zebra's own wording is in the detail. Usually the printer is off or showing an error. |
| `BROWSER_PRINT_NOT_READY` | — | The printer reported a fault before sending | The message names it: out of paper, printhead open, out of ribbon, paused. |
| `RUN_ALREADY_SETTLED` | 409 | `/sent` called on a run that is not pending | The run was already recorded. A replay is refused rather than written twice. |

**The HTTPS trap.** Browser Print's local service listens on plain HTTP. A page
served over HTTPS cannot call it — the browser blocks it as mixed content, and
the failure looks exactly like the application not being installed. The wrapper
detects the protocol and says which problem it is. Either serve the interface
over `http://` on the local network, or configure Browser Print's HTTPS endpoint
and trust its certificate on each workstation.

## Images

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `IMAGE_UNREADABLE` | 400 | Not a PNG, or a PNG this decoder does not handle. | JPEG is refused with the conversion command. Interlaced PNGs need re-saving. |

## CLI exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | A bug — an unexpected error, with a stack trace |
| 2 | Usage — wrong arguments or a missing file |
| 3 | The document could not be read or parsed |
| 4 | Printing failed |
| 5 | The template or image is invalid |
