# Brief: "Why the Ricoh M 2310N can't live on a UPS"

Audience: the company CEO, who asked for a UPS quote for the office printer. Video is 1920x1080, 30 fps, about 107 s, no voiceover,
so **on-screen text carries the story**. Keep text short, large (body ≥ 40 px, headline 90–140 px), readable for 3+ s.
English, calm, confident, factual. No emoji.

Project: /home/user/ups-video (Remotion 4.0.290, React 18, @remotion/three + three 0.169 + @react-three/fiber 8 are installed).
- `src/theme.ts` — colours, fonts, easings, springs. Use `theme.*` only; no new hex codes except greys/derived alpha.
  One hero colour (`theme.color.hero`, orange = heat/danger); `theme.color.ok` (green) only for the good answer.
- `src/facts.ts` — EVERY number shown must come from here (import it; never hard-code a different figure).
  Prefix estimates with "≈" (the font falls back for ≈ and →, which is fine).
- `src/components/Layers.tsx` — `BgMesh` (layer 1), `Finish` (grade+grain+vignette, must be the LAST child), `Chapter` label.
- `src/components/stop.ts` — stop-motion helpers: `stepped(frame, hold)`, `wobble`, `wobbleCss`, `hash`.
- `src/components/Cutouts.tsx` — `PrinterCutout` (heat 0..1 glows the fuser), `UpsCutout` (charge 0..1, alarm).
- `src/timeline.ts` — scene lengths. Do not change them; build your scene to its length (`useVideoConfig().durationInFrames`).

Motion rules (from the claude-remotion-skill):
1. Never linear: every `interpolate` gets an `easing` from theme and `extrapolateLeft/Right: 'clamp'` (use the exported `clamp`).
2. Entrances animate 2–3 properties together (opacity + translateY + scale), via `spring` with `theme.spring.*`.
3. Stagger 3–6 frames. Exits exist and are faster (~10 frames) than entrances (~20). Scene must be clean (faded) in its last ~8 frames.
4. Idle things breathe: `1 + Math.sin(frame/22)*0.015`.
5. Timing from fps (`Math.round(fps * seconds)`), no magic frame numbers scattered around.
6. Layer order: BgMesh → content → Finish.
7. Use px, not em, for gaps. Deterministic only: no Math.random, use `hash`.

**Stop-motion look** (the human asked for stop-motion): paper cut-outs (PrinterCutout/UpsCutout, paper-coloured cards with
a dark ink outline and a hard offset shadow like `boxShadow: '6px 6px 0 rgba(0,0,0,0.45)'`), moved **on threes**: compute motion
from `stepped(frame, 3)` instead of `frame`, and add `wobbleCss(frame, seed)` to each cut-out so held poses jitter slightly.
Use smooth motion only for data (charts, counters) — the contrast between "hand-made" and "precise" is the style.

Your file(s) only: edit just the scene file(s) you were assigned under `src/scenes/` (you may add new files under
`src/components/<YourScene>*.tsx`). Do not edit shared files; if you need something there, say so in your report.
Keep the export name of the scene component.

Verify (mandatory): `cd /home/user/ups-video && npx tsc -p .` must be clean, then render stills of your scene at 4–6 frames
spread across it, e.g. `npx remotion still src/index.ts S-<Scene> out/<scene>-<frame>.png --frame=<n> --overwrite`,
**look at them** with the Read tool, fix layout problems (overlaps, cut-off text, unreadable contrast), and re-render.
Optionally render the scene as a clip to check motion: `npx remotion render src/index.ts S-<Scene> out/<scene>.mp4 --crf 28`.
Report: what is on screen and when (seconds), the stills you checked, and anything you could not do.
