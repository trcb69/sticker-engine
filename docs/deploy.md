# Deploying to a VPS

Written to be followed top to bottom on a fresh Ubuntu box. Every command is
literal; the only things to substitute are the domain, the printer address and
the x.gd key.

---

## 0. Settle this before anything else

**How is the printer connected?**

| Connection | Transport | Where the VPS can be |
|---|---|---|
| **USB, on each operator's PC** | `browser` (default) | Anywhere. The operator's own machine sends the label. |
| **Ethernet, on the factory LAN** | `network` | Must be able to route to the printer |

With USB printers this is not a constraint on hosting at all. Zebra Browser
Print runs on the operator's workstation and delivers the ZPL locally, so the
server never needs a route to a printer. **A VPS anywhere is fine.**

The `network` transport remains for any Ethernet Zebra added later, and there
a hosted VPS genuinely cannot reach a printer behind your office NAT — the
connection has to be initiated from inside the network. Section 9 covers that
case.

Everything except printing works identically either way: upload, parsing, the
grid, live preview, the short-link service, ZPL download.

---

## 1. Prerequisites

Ubuntu 22.04 or 24.04, root or sudo.

```bash
sudo apt update
sudo apt install -y curl git nginx poppler-utils

# Node 20 or newer. Check first — the distro version is usually too old.
node --version 2>/dev/null || true
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo npm install -g pm2
```

`poppler-utils` is not optional. It supplies `pdftotext`, which is how documents
are read; without it every upload fails. Confirm:

```bash
pdftotext -v          # prints a version to stderr
```

---

## 2. Install

The zip contains a single top-level folder holding the whole project. Unpack it
into `/srv` and it lands in the right shape — nothing is moved or copied
separately, and `ecosystem.config.cjs`, `bin/sticker.js` and `package.json` are
already inside it.

```bash
# From your own machine:
scp sticker-engine.zip root@YOUR-SERVER:/srv/

# On the server:
cd /srv
unzip sticker-engine.zip          # creates /srv/sticker-engine/
cd sticker-engine
npm ci
```

`npm ci` rather than `npm install`: the lockfile is in the zip, and `ci`
installs exactly what was tested. Install the dev dependencies too — they are
small, and they are what lets you run the test suite on the box when something
looks wrong. Drop them later with `npm prune --omit=dev` if you would rather.

Check it before wiring anything up:

```bash
npm test                                                    # 421 tests
node bin/sticker.js validate-template src/template/label-4x1.json
```

If the tests pass, this machine can do everything except talk to a printer.

The layout you should see:

```
/srv/sticker-engine/
├── ecosystem.config.cjs      PM2 reads this; do not move it
├── package.json  package-lock.json
├── .env.example              copy to .env in step 4
├── bin/sticker.js            the CLI, run as `node bin/sticker.js ...`
├── src/                      server and shared modules
├── public/                   the interface
│   └── vendor/               <- Zebra's BrowserPrint.js goes here (step 8b)
├── assets/                   logo ZPL, screenshots
├── docs/                     this guide, errors, operator guide
├── test/  scripts/
├── data/                     created empty; see step 3
└── logs/                     PM2 writes here
```

---

## 3. Persistent data

**This is the part a redeploy destroys if you let it.** `data/` holds the
short-link archive — the only record of what every printed QR code points at —
and the append-only audit trail. A drum labelled today may be looked up in five
years.

Put it outside the application directory:

```bash
sudo mkdir -p /var/lib/sticker-engine
sudo chown "$USER":"$USER" /var/lib/sticker-engine
```

---

## 4. Configuration

```bash
cp .env.example .env
chmod 600 .env          # it holds the x.gd API key
nano .env
```

Every variable, with what it does and what happens if it is wrong:

| Variable | Default | What it does |
|---|---|---|
| `STICKER_PORT` | `6969` | Listening port. Any unprivileged port works. |
| `STICKER_HOST` | `127.0.0.1` | Keep this as loopback when nginx is in front. Use `0.0.0.0` only if the warehouse reaches the service directly with no proxy. |
| `STICKER_DATE_ORDER` | `MDY` | **The one that quietly ruins labels.** `09/04/2026` is 4 September under `MDY`, 9 April under `DMY`. Logged at boot with a worked example. |
| `STICKER_POPPLER_BIN` | *(empty)* | Leave blank if `pdftotext` is on `PATH`. |
| `STICKER_DEFAULT_MANUFACTURER` | `Miscellaneous Supplier` | Prefilled into the manufacturer field. |
| `STICKER_MANUFACTURER_PREFIX` | `MANUFACTURER - ` | Fixed text printed before it. |
| `STICKER_BATCH_PATTERN` | *(none)* | No format is enforced unless you set one. The batch code is on no document, so the system has no basis for judging it. |
| `STICKER_XGD_API_KEY` | *(none)* | From <https://x.gd/en/developer>. Without it, links must be shortened by hand and pasted in. |
| `STICKER_XGD_ANALYTICS` | `false` | x.gd tracks clicks unless told otherwise. A scan on your factory floor is not something a third party needs a record of. |
| `STICKER_SHORTLINK_STORE` | `./data/shortlinks.json` | **Point this at `/var/lib/sticker-engine/`.** |
| `STICKER_AUDIT_LOG` | `./data/audit.jsonl` | **Point this at `/var/lib/sticker-engine/` too.** |
| `STICKER_ARCHIVE_DIR` | `./data/jobs` | Completed jobs, for reprints without re-uploading. |
| `STICKER_TMP` | `./data/uploads` | Staged uploads, deleted when a job expires. |
| `STICKER_JOB_TTL` | `1800` | Seconds a job stays open. Thirty minutes suits a shift. |
| `STICKER_PRINT_TRANSPORT` | `browser` | `browser` for USB printers via Zebra Browser Print; `network` for Ethernet Zebras this server can reach. |
| `STICKER_PRINTERS` | *(none)* | `name=host:port,dpi`, semicolons between machines. Only used by `network`. |
| `STICKER_CONFIRM_THRESHOLD` | `50` | Above this many labels, the operator must type the number to confirm. |
| `STICKER_MAX_UPLOAD_BYTES` | `10485760` | 10 MB per document. |
| `STICKER_QR_BUDGET_DOTS` | `96` | Square dot allowance for the QR. Do not change without recalibrating. |
| `STICKER_QR_MAX_MODULES` | `29` | Ceiling including quiet zone; 29 modules at 96 dots is 3 per module. |

A working `.env` for a first deployment:

```ini
STICKER_PORT=6969
STICKER_HOST=127.0.0.1
STICKER_DATE_ORDER=MDY
STICKER_DEFAULT_MANUFACTURER=Miscellaneous Supplier
STICKER_XGD_API_KEY=
STICKER_XGD_ANALYTICS=false
STICKER_SHORTLINK_STORE=/var/lib/sticker-engine/shortlinks.json
STICKER_AUDIT_LOG=/var/lib/sticker-engine/audit.jsonl
STICKER_ARCHIVE_DIR=/var/lib/sticker-engine/jobs
STICKER_TMP=/var/lib/sticker-engine/uploads
STICKER_JOB_TTL=1800
STICKER_CONFIRM_THRESHOLD=50
# STICKER_PRINTERS=wh1=192.168.1.50:9100,203
```

Misconfiguration fails at boot with **every** problem listed at once, not one
per restart. If it starts, the configuration is valid.

---

## 5. Run it under PM2

```bash
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup          # run the command it prints back, then `pm2 save` again
```

```bash
pm2 status
pm2 logs sticker-engine --lines 50
curl -s localhost:6969/api/health | head -c 400
```

Healthy output names the resolved date order and reports `pdftotext`. If
`status` is `unhealthy`, poppler is missing — go back to step 1.

**Fork mode, one instance, deliberately.** Cluster mode forks workers that do
not share memory, and two things break instantly: the job store is in-process,
so an operator's edit would land on a worker that has never seen their job; and
the print queue is serialised per printer so two people cannot interleave labels
on one machine, which separate queues defeat. Scaling past one process means
moving both to shared storage first.

---

## 6. Put nginx in front

```bash
sudo tee /etc/nginx/sites-available/sticker-engine >/dev/null <<'NGINX'
server {
    listen 80;
    server_name sticker.example.com;      # <-- your domain

    # Uploads are PDFs and the default 1 MB limit will reject real documents.
    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:6969;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # A large run takes a moment to build and write.
        proxy_read_timeout 120s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/sticker-engine /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

TLS, if the box is reachable from the internet:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d sticker.example.com
```

Firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Do **not** open 6969. Nginx reaches it over loopback; nothing else should.

---

## 7. Open it

```
https://sticker.example.com
```

**Through the server, never as a file.** The page links `/css/app.css` and
`/js/app.js` as absolute paths that only resolve from the site root. Opening
`public/index.html` directly gives unstyled HTML and a dead page.

---

## 8. Put the logo on the printer

Once per printer, and again after any printer power cycle if it stores to `R:`
(RAM):

```bash
cat assets/logo-store.zpl | nc 192.168.1.50 9100
```

The service also checks on its first job to each printer after a restart and
sends the graphic if it is missing. A missing graphic prints a blank square and
reports nothing, so the labels come out looking almost right.

---

## 8b. USB printers — Zebra Browser Print

Do this once per workstation. Nothing here touches the server.

1. Download Browser Print from Zebra's support site.
2. Copy `BrowserPrint.js` (and `BrowserPrint-Zebra.js` if present) from the
   archive into `public/vendor/` **on the server**, once. They are Zebra's
   files and are not redistributed with this package.
3. Install the application on the workstation and let it run. **It is a tray
   application, not a service** — it must be running, and it does not always
   start itself after a reboot. This is the most common support call.
4. Plug the printer in over USB and switch it on.
5. Open `http://your-server/diagnostics.html`. It should report the application
   as running and list the printer.
6. Press **Send test label** and scan the barcode on it.

If the test label prints and scans, that workstation is done.

**Serve the interface over plain HTTP if you can.** Browser Print's local
service listens on plain HTTP, and an HTTPS page cannot call it — the browser
blocks it as mixed content, and the symptom is indistinguishable from the
application not being installed. On a warehouse LAN, HTTP is a reasonable
choice: the traffic never leaves your network, and the alternative is trusting a
local certificate on every workstation.

## 9. Printing when the VPS is off-site — network printers only

**This section applies only to `network` transport.** With USB printers and
Browser Print, printing happens on the operator's machine and none of it is
needed.

A hosted service cannot open a socket to an Ethernet printer behind your NAT.
Three ways round it, in order of how much they ask of you.

### a. Download and send by hand

Works today, no infrastructure. The operator downloads the `.zpl` and sends it
from a machine on the LAN:

```bash
cat run.zpl | nc 192.168.1.50 9100
```

No audit trail, no scan-back verification, no queue. A fallback, not a plan.

### b. Run a second instance on the LAN

Install this same package on a small machine inside the warehouse — a NUC, a
spare desktop, a Raspberry Pi 4 — and have the warehouse use *that* one. The VPS
instance then serves nobody, so skip it.

Simplest option by far if there is any machine on the factory network that can
stay switched on. Everything in this guide applies unchanged.

### c. A reverse tunnel from inside

Run this on a machine inside the factory network, so the connection is
established outbound and no inbound firewall rule is needed:

```bash
# On a LAN machine, forwarding the VPS's local 9100 to the real printer.
ssh -N -R 9100:192.168.1.50:9100 deploy@vps.example.com
```

Then on the VPS:

```ini
STICKER_PRINTERS=wh1=127.0.0.1:9100,203
```

Keep it alive with `autossh` or a systemd unit; a dropped tunnel means printing
stops with `PRINTER_UNREACHABLE`, which is at least an honest error.

**This is a real dependency on that machine staying up.** Option (b) is more
robust and less clever.

---

## 10. Verify the deployment

Run these in order. Each one tells you something the next depends on.

```bash
# 1. The service is up and can read PDFs.
curl -s localhost:6969/api/health | python3 -m json.tool

# 2. The template is intact and scales.
node bin/sticker.js validate-template src/template/label-4x1.json

# 3. Network printers reachable from THIS machine. (Not needed for USB.)
node bin/sticker.js printers

# 4. What a printer says about itself. Silence here is normal.
node bin/sticker.js status --printer wh1

# 5. Parsing works against a real document.
node bin/sticker.js parse /path/to/a/real/picklist.pdf
```

Then in the browser: upload a Picklist and a Sample Note, fill one line, check
the preview, and print one label.

**Then scan it back.** The run is not complete until a scanner has read a
printed label and it matched. That check catches darkness drift, a dead
printhead element and a stock change — all of which produce labels that look
fine to a human and fail at the customer.

---

## 11. First run with a real printer

The order that saves the most time when something is off:

1. `node bin/sticker.js printers` — if this says `DOWN`, stop. It is a network
   problem and nothing in the interface will work either.
2. `cat assets/logo-store.zpl | nc HOST 9100` — logo into printer memory.
3. Print **one** label, not a run.
4. Hold it against the preview on screen. They should match closely; the preview
   is dot-accurate and 1-bit for exactly this comparison.
5. Scan the barcode. If it does not read, see the troubleshooting section of the
   README — barcode problems are almost always either geometry (which the guard
   warns about) or darkness (which it cannot).
6. Only then print a run.

If the geometry is off, `?calibrate=1` overlays a 1 mm grid and lets slots be
dragged, so tuning against a printed label takes ten minutes rather than an
afternoon of editing numbers blind.

---

## 12. Backups

```bash
sudo tee /etc/cron.daily/sticker-backup >/dev/null <<'CRON'
#!/bin/sh
tar -czf "/var/backups/sticker-$(date +%F).tar.gz" -C /var/lib sticker-engine
find /var/backups -name 'sticker-*.tar.gz' -mtime +90 -delete
CRON
sudo chmod +x /etc/cron.daily/sticker-backup
```

The audit trail and the short-link archive are the parts that cannot be
regenerated. A printed label whose QR no longer resolves is unrecoverable.

---

## 13. Upgrading

```bash
cd /srv/sticker-engine
cp .env /tmp/sticker.env.bak

# Unpack the new version over the top, then:
npm ci
npm test                       # if this fails, do not restart
cp /tmp/sticker.env.bak .env
pm2 restart sticker-engine
pm2 logs sticker-engine --lines 30
```

`data/` is untouched because it lives in `/var/lib`. To roll back, unpack the
previous zip and restart — nothing in the data directory is version-specific.

---

## 14. When something is wrong

| Symptom | First thing to check |
|---|---|
| Page loads unstyled | Being opened as a file rather than through the server |
| Every upload fails | `pdftotext -v` — poppler missing |
| Service will not start | `pm2 logs` — configuration errors are listed in full at boot |
| Upload rejected as too large | nginx `client_max_body_size`, then `STICKER_MAX_UPLOAD_BYTES` |
| `PRINTER_UNREACHABLE` | `node bin/sticker.js printers`; then whether this machine can route to the LAN at all |
| Printer missing from the dropdown | Browser Print not running (tray application), or the USB cable. Open `/diagnostics.html`. |
| "Browser Print is not running" on HTTPS | It probably is running — an HTTPS page cannot call its HTTP service. Serve over `http://` on the LAN. |
| Printer silent to `~HS` | Normal on many networked Zebras. Not a fault. |
| Labels print without a logo | Re-send `assets/logo-store.zpl`; `R:` is RAM and clears on power cycle |
| Dates wrong by months | `STICKER_DATE_ORDER` — check the boot log's worked example |
| QR will not scan | Interface shows dots-per-module before printing; below 3 is unreliable |
| Barcode scans intermittently | Worse than not scanning. See the README troubleshooting section |

Every error carries a stable code and a request id. `docs/errors.md` lists all
of them with what to do.
