# Connecting Sticker Engine to SH-IT_Hub (IT Conduit)

I don't know SH-IT_Hub. This document defines what the sticker engine *offers*
a host system, sets out the three ways it can be plugged in, and ends with the
questions that decide which one applies. Answer those and this becomes a build
spec rather than a menu.

Read this before prompt 4 is written. The integration shape determines the auth
model, the job store, and whether the engine keeps its own UI — all of which
prompt 4 would otherwise have to guess at.

---

## 1. What the engine is, as a component

A self-contained service that turns warehouse documents into printed labels.

```
  PDFs in  ─────►  extract · parse · join  ─────►  job
                                                    │
                     operator fills 5 fields ───────┤
                                                    ▼
                                         ZPL out ──► printer
```

It owns four things and nothing else:

1. **Document understanding** — reading a Picklist or Sample Note PDF into
   structured lines, with provenance on every value.
2. **Label geometry** — a template resolved to 203/300/600 dpi, plus a guard
   that refuses layouts which would print off the label or scan unreliably.
3. **ZPL generation** — native `^BC` barcodes and `^BQ` QR codes, no bitmaps.
4. **The short-link archive** — a permanent local record of what every printed
   QR code was supposed to point at.

It deliberately owns *no* master data. There is no item catalogue, no customer
list, no product name mapping. Everything printed comes off an uploaded
document or is typed by the operator. That matters for integration: the engine
needs nothing from SH-IT_Hub except documents and identity.

---

## 2. Three ways to connect

### A. Embedded page — the Hub links or frames the engine

SH-IT_Hub adds a menu item. Clicking it opens the engine's own interface,
either full-page or in an iframe. The Hub passes identity; the engine handles
everything else.

```
SH-IT_Hub ──(SSO token)──► Sticker Engine UI ──► printer
```

**Choose this if** SH-IT_Hub is primarily a portal — a set of links to internal
tools behind one login.

- Fastest to ship. The engine's UI is being built anyway in prompt 5.
- Only integration work is authentication and a menu entry.
- Cost: two interfaces to learn, and the operator moves between them.

### B. API-backed — the Hub builds its own screen

SH-IT_Hub renders the label form itself and calls the engine's REST API for
parsing, preview and printing. The engine ships no UI in production.

```
SH-IT_Hub UI ──HTTP──► Sticker Engine API ──► printer
```

**Choose this if** SH-IT_Hub is a real application with its own component
library and the warehouse team should never see a second product.

- Best operator experience. One system, one look, one login.
- Most integration work: every field, warning and preview has to be rebuilt.
- The live preview is the hard part. It's a canvas renderer sharing the
  template and text-metrics modules with the ZPL emitter, which is what keeps
  preview and print from drifting. Reimplementing it in the Hub would break
  that guarantee, so it should be served as a mountable script instead.

### C. Batch handoff — no UI at all

SH-IT_Hub posts documents and field values in one request and gets ZPL back, or
has the engine print directly. No interactive session.

```
SH-IT_Hub ──POST job──► Sticker Engine ──► ZPL / printer
```

**Choose this if** the batch number, dates and ClickUp link already exist inside
SH-IT_Hub and nobody needs to type them again.

- Simplest contract by far: one endpoint.
- Only works if the Hub genuinely holds those five values. It cannot invent a
  batch number, and there is no preview step to catch a bad one.

**My guess, subject to your answers:** start at A, move toward B once the
warehouse team has used it for a few weeks and you know which parts of the
interface they actually touch.

---

## 3. The API contract

This is what prompt 4 will build. It serves all three patterns — B and C use it
directly, A uses it behind the engine's own UI.

### Jobs

```http
POST   /api/jobs                          multipart: one or two PDFs
GET    /api/jobs/:id
PATCH  /api/jobs/:id                      manufacturer, customer, docNo, qrUrl
PATCH  /api/jobs/:id/lines/:index         batchCode, mnfDate, expDate, copies
DELETE /api/jobs/:id
```

`POST /api/jobs` returns the parsed job with every value carrying its
provenance, plus any warnings:

```jsonc
{
  "id": "job_01HZ...",
  "createdAt": "2026-09-06T09:14:22.031Z",
  "source": {
    "sampleNoteNo": "RSMINV26091087",
    "picklistNo": "PL-76120",
    "salesOrderNo": null
  },
  "customer":     { "value": "Jay Jay Mills Lanka (PVT) Ltd", "provenance": "extracted" },
  "docNo":        { "value": "RSMINV26091087", "provenance": "extracted" },
  "manufacturer": { "value": null, "provenance": "missing",
                    "note": "Entered by the operator" },
  "lines": [
    {
      "index": 1,
      "displayName": { "value": "FW-777-Hybrid White", "provenance": "extracted" },
      "qtyAmount":   { "value": "0.30", "provenance": "extracted" },
      "qtyUom":      { "value": "kg",   "provenance": "extracted" },
      "mnfDate":     { "value": null, "provenance": "missing" },
      "expDate":     { "value": null, "provenance": "missing" },
      "batchCode":   { "value": null, "provenance": "missing" },
      "copies": 1,
      "status": "incomplete"
    }
  ],
  "warnings": []
}
```

**`provenance` is the field SH-IT_Hub should build its UI around.** Every value
is `extracted`, `derived`, `manual` or `missing`. A `missing` field is not an
error — it is a field waiting for an operator, and its `note` says what for.
That is enough to render the whole form generically, without hard-coding which
fields are editable.

### Rendering and printing

```http
POST /api/jobs/:id/lines/:index/preview   → { zpl, warnings }
GET  /api/jobs/:id/zpl?lines=1,3&dpi=203  → application/octet-stream
POST /api/jobs/:id/print                  → { jobId, printer, queued, labels }
GET  /api/printers                        → configured printers and their dpi
```

### Short links

```http
POST /api/shortlinks    { "url": "https://forms.clickup.com/..." }
```

Returns the short URL, the QR payload, and the symbol plan — module count,
error-correction level and dots per module — so the Hub can show the operator
that the code will scan **before** anything is printed.

### Health and readiness

```http
GET /api/health   → poppler present, printers reachable, shortener configured
```

Point SH-IT_Hub's monitoring at this. It is the difference between "labels
stopped working this morning" and "poppler is missing on the label host".

### Errors

Every failure is a typed error with an operator-safe message:

```jsonc
{ "error": {
    "code": "DOCUMENT_UNRECOGNISED",
    "message": "This document is not a Sample Note or a Picklist.",
    "requestId": "req_01HZ..."
} }
```

`code` is stable and safe to branch on. `message` is safe to show a warehouse
operator — it never contains a stack trace, a file path or an internal
identifier. Surface `requestId` somewhere in the Hub's UI; it is what makes a
support call solvable.

The codes that matter to a host system:

| Code | Status | Meaning |
|---|---|---|
| `DOCUMENT_UNRECOGNISED` | 422 | Not a Picklist or Sample Note |
| `DOCUMENT_UNREADABLE` | 422 | Corrupt PDF, or a scan with no text layer |
| `DATE_UNPARSEABLE` | 422 | A date that cannot be read in the configured order |
| `QR_PAYLOAD_TOO_DENSE` | 400 | The link is too long to encode on this label |
| `SHORTLINK_FAILED` | 502 | x.gd unreachable, rate-limited or rejecting |
| `CONFIG_INVALID` | 500 | Misconfigured at boot; the service will not start |

---

## 4. Authentication

The engine has no user accounts and should not grow any. Two workable models:

**Service-to-service (patterns B and C).** SH-IT_Hub holds a shared secret and
signs requests, or presents a bearer token the engine validates. The engine
records the calling identity in the print audit log and otherwise doesn't care
who the end user is.

**Forwarded identity (pattern A).** SH-IT_Hub authenticates the person and
passes a signed assertion — a JWT with the user's name and a short expiry, or a
header injected by a reverse proxy the engine trusts. The engine reads a name
for the audit log and trusts the Hub for everything else.

**Whichever is chosen, one thing is not negotiable.** The print audit log
records who printed which batch code, when, how many copies and to which
printer. A reprint puts a second label carrying the same batch number into
circulation, which is a traceability event. If the engine cannot name a person,
that record is worth much less. So identity has to reach the engine somehow,
even in pattern C.

---

## 5. Network reality — the part that usually surprises people

**A browser cannot open a raw TCP socket, and a hosted server cannot reach a
printer behind factory NAT.** Zebra printers listen on port 9100 on the factory
LAN. Neither the Hub's front end nor a cloud-hosted engine can talk to them
directly.

Three deployments, in order of how much they ask of you:

**On the factory LAN.** The engine runs on a machine inside the warehouse
network and opens sockets to the printers directly. Nothing else needed. If
SH-IT_Hub is also internal, this is the whole answer.

**Hosted, with a local print agent.** The engine runs wherever SH-IT_Hub runs.
A small agent on a factory PC polls it for pending jobs and writes them to the
printers. Outbound HTTP only, so no firewall changes and no inbound exposure.
This is the standard answer when the host system is off-site, and it is why the
job queue in prompt 4 is a table rather than an in-memory list — the agent needs
something to poll.

**Hosted, download only.** The engine returns a `.zpl` file and the operator
sends it to the printer themselves. Requires no infrastructure and no agent. It
also means no audit trail, no verification and no queue, so treat it as a
fallback rather than a plan.

---

## 6. What SH-IT_Hub would own, and what stays here

| | Owner | Why |
|---|---|---|
| User accounts, login, permissions | **SH-IT_Hub** | The engine has none and shouldn't |
| Uploaded PDFs | Either | The engine stages them and deletes them on job expiry |
| Job state while an operator is working | **Engine** | Preview, warnings and readiness all depend on it |
| Completed job archive | Either | Needs to survive for reprints; see below |
| Short-link archive | **Engine** | A printed QR must resolve years later |
| Print audit log | **Engine** | Written at the moment of printing, where the facts are |
| ClickUp form definitions | **SH-IT_Hub** | The engine only ever sees a URL |

**The archives are the part worth deciding deliberately.** A drum labelled today
may be looked up in five years. The engine keeps the short-link mapping and the
print log locally so that record exists at all — but if SH-IT_Hub already has a
document archive with backups and a retention policy, mirroring both into it is
better than trusting a folder on a warehouse PC. That's a one-way push, not a
migration: the engine keeps its own copy regardless, because a printed label
that no longer resolves is unrecoverable.

---

## 7. What I need to know

These decide which of the three patterns applies, and prompt 4 shouldn't be
written until at least the first four are answered.

1. **What is SH-IT_Hub?** An internal portal, a full web application, an
   intranet page, something bought off the shelf? What is it built on?
2. **Where does it run** — a server inside the factory network, a VPS, or a
   cloud host? This decides the printing deployment on its own.
3. **How does someone log in to it today,** and can it issue a token or a signed
   header the engine could trust?
4. **Should the warehouse team see the engine's own interface, or must
   everything live inside the Hub?** This is the A-versus-B question.
5. **Does SH-IT_Hub already hold batch numbers, manufacture dates or ClickUp
   links?** If it holds all three, pattern C becomes possible and the operator
   stops typing anything.
6. **Does it have a document archive** the engine should push completed jobs
   into, rather than keeping its own?
7. **Is there an existing house style** — a component library, a design system —
   the label interface should match?

---

## 8. What can start now, regardless

Nothing above blocks the next stage. These hold true under all three patterns:

- The REST API in section 3, since B and C consume it directly and A sits on
  top of it.
- Typed errors with stable codes and operator-safe messages.
- The persistent job queue, which the print agent polls and which any deployment
  needs.
- The print audit log.
- The health endpoint.

The only genuinely pattern-dependent decisions are the auth mechanism and
whether the engine ships a user interface at all. Both can be deferred to
prompt 5 without holding up prompt 4.
