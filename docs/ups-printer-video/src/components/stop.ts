// Motion helpers. These used to give a stop-motion look (poses held for a few frames
// plus a hand-placed wobble). The video is now fully smooth: STOP_MOTION = false makes
// `stepped` return the frame unchanged and `wobble` return zero. Flip it back to get
// the stop-motion look again.
export const STOP_MOTION = false;

export const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Frame snapped to a hold of `hold` frames (default: on threes = 10 poses/s at 30 fps). */
export const stepped = (frame: number, hold = 3) => (STOP_MOTION ? Math.floor(frame / hold) * hold : frame);

/** Per-pose hand-placement wobble for element `seed`. Returns px offsets and degrees. */
export const wobble = (frame: number, seed: number, amount = 1, hold = 3) => {
  if (!STOP_MOTION) return {x: 0, y: 0, r: 0};
  const k = Math.floor(frame / hold);
  return {
    x: (hash(seed * 13 + k) - 0.5) * 4 * amount,
    y: (hash(seed * 29 + k) - 0.5) * 4 * amount,
    r: (hash(seed * 47 + k) - 0.5) * 1.6 * amount,
  };
};

export const wobbleCss = (frame: number, seed: number, amount = 1, hold = 3) => {
  const w = wobble(frame, seed, amount, hold);
  return `translate(${w.x}px, ${w.y}px) rotate(${w.r}deg)`;
};
