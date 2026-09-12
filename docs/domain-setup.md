# Pointing standard-holdings.lk at the label QR codes

**This is the pause point.** Everything else is built, deployed and running.
Short-link minting is deliberately switched off until the steps below are done,
because a QR printed against an address that is about to change is a drum
nobody can trace.

Nothing here is urgent. The engine is fully usable today — upload, parsing, the
line grid, live preview, ZPL download and printing all work without it. The
only thing waiting on the domain is the automatic minting of QR short links.

---

## Why the domain is needed at all

The QR on a 4×1 label has a 96-dot budget. Measured with the engine's own
planner, that allows **38 characters, and not one more**:

| Payload | Chars | Result |
|---|---|---|
| `HTTPS://STANDARD-HOLDINGS.LK/J/HFH7K2` | 37 | fits, error correction **M** |
| `HTTPS://45.151.122.105:3001/J/HFH7K2` | 36 | fits, but the address is not permanent |
| `HTTPS://STICKER.STANDARD-HOLDINGS.LK/J/…` | 43 | **refused — will not print** |

Two consequences:

- **It must be the apex** — `standard-holdings.lk`, not a subdomain. A
  subdomain does not fit, and the engine will refuse to print rather than
  produce a QR that scans intermittently.
- **The path must stay `/J/<6 chars>`.** One character of headroom is left.
  A longer code, or a prefix like `/stickers/J/`, does not fit.

This is why the Hub proxies `/J` at its root rather than under `/stickers`.

---

## Step 1 — DNS, at the registrar

Once `standard-holdings.lk` is bought, create one record:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` (the apex itself) | `45.151.122.105` | default |

Optionally `A` for `www` to the same address. Nothing else is required for the
labels to work.

Check it has taken effect before going further — LK domains can take a few
hours:

```
dig +short standard-holdings.lk
```

It should print `45.151.122.105` and nothing else.

---

## Step 2 — Routing, in EasyPanel

Ports 80 and 443 on this box are held by **Traefik**, managed by **EasyPanel**
(reachable at `http://45.151.122.105:3000`). So the domain is attached there,
not in a config file — and Traefik will issue a real Let's Encrypt certificate
in the process.

What is needed is one rule:

- **Host** `standard-holdings.lk`
- **Path prefix** `/J`
- **Forward to** the sticker engine

One wrinkle worth knowing before you start: Traefik runs inside Docker, so
`127.0.0.1` there means *the container*, not this server. The host is
`172.17.0.1` from inside. The engine currently listens on `127.0.0.1:6969`
only, so it is not reachable from a container as things stand.

There are two ways round it, and the choice is worth making deliberately:

**a. Route through the Hub** — point Traefik at `172.17.0.1:3001`, which
already proxies `/J` to the engine and is already listening on all interfaces.
Nothing about the engine changes. The Hub's certificate is self-signed, so
Traefik has to be told not to verify it on that hop.

**b. Open the engine to the bridge** — set `STICKER_HOST=0.0.0.0` and point
Traefik straight at `172.17.0.1:6969`. One less hop and no certificate
awkwardness, but the engine is then reachable from anything that can route to
this box on 6969, so it should be firewalled to the Docker bridge.

I'd take (a): it changes nothing that is currently working, and the extra hop
costs nothing on a redirect.

---

## Step 3 — Switch minting on

Once `https://standard-holdings.lk/J/TEST` reaches the engine (it will answer
`SHORTLINK_NOT_FOUND`, which is the correct answer for a code that was never
minted — it proves the routing works):

```bash
# /root/sticker-engine/.env
STICKER_SHORT_BASE=https://standard-holdings.lk
```

```bash
pm2 restart sticker-engine --update-env
curl -s http://127.0.0.1:6969/stickers/api/health | grep -o '"provider":"[^"]*"'
```

That should report `"provider":"self-hosted"`. Minting is then live: no API
key, no rate limit, no third party, and every mapping written to
`data/shortlinks.json` — which is what lets a label printed today still be
looked up years from now even if everything else is rebuilt.

**Back that file up along with `data/audit.jsonl`.** They are the only record
of what a printed QR means and of who printed which batch, and neither can be
reconstructed.

---

## A side benefit worth noticing

A real certificate on `standard-holdings.lk` also makes the label interface a
properly trusted origin, rather than one reached past a browser warning. That
removes any doubt about WebUSB, which needs a secure context to expose
`navigator.usb` at all. Serving the interface at
`https://standard-holdings.lk/stickers` — the same Traefik rule, with the
prefix `/stickers` — is worth doing at the same time for that reason alone.
