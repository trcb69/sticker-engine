# UPS for the Ricoh M 2310N: explainer video

A ~1 min 47 s Remotion video for management: why the office A3 laser MFP should not run on a UPS, what a 3 kVA UPS would
actually buy, why prints should be bundled, what the load does to UPS batteries, and what to do instead.
Every number is in `src/facts.ts`; sources and working are in `SOURCES.md`.

Style follows https://github.com/haidrrrry/claude-remotion-skill (springs, clamped easing, layered scenes), with
paper cut-outs animated "on threes" for the stop-motion look and a react-three-fiber section that turns 2D → 3D → 2D.

```
npm install
node scripts/gen-sfx.mjs          # writes public/sfx/*.wav (deterministic)
npx remotion studio               # preview
npx remotion render src/index.ts UpsPrinter out/ups-printer-4k.mp4 --codec h264 --crf 17 --scale=2   # 3840x2160, 60 fps
```
Each scene also has its own composition (`S-Hook`, `S-Fuser3D`, ...) for quick checks.
`remotion.config.ts` points at the sandbox's headless Chromium; change or remove that line on another machine.
