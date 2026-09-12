# Vendored libraries

## BrowserPrint.js — required for USB printing

Zebra's Browser Print library is **not redistributed here**; it is Zebra's, and
downloading it from their site is how you get a version matching the
application your workstations have installed.

1. Download Browser Print from Zebra's support site. The archive contains both
   the Windows/macOS installer and a `js` directory.
2. Copy these two files into this directory:

       BrowserPrint.js          required
       BrowserPrint-Zebra.js    optional, adds isReadyToPrint and getStatus

3. Reload `/diagnostics`. It should report the application as reachable.

Until `BrowserPrint.js` is here, the interface says so in a sentence naming this
file rather than failing with a module error, and printing falls back to
downloading a `.zpl`.

The files are served from this origin rather than a CDN on purpose: a warehouse
machine may have no route to the internet, and a page that dies when the
connection does is worse than one that never depended on it.
