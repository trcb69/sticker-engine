// Stop-motion helpers. Animate "on twos/threes": the frame number is snapped so a pose
// is held for `hold` frames, and every held pose gets a tiny deterministic wobble,
// like a paper cut-out being nudged by hand between shots.

export const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Frame snapped to a hold of `hold` frames (default: on threes = 10 poses/s at 30 fps). */
export const stepped = (frame: number, hold = 3) => Math.floor(frame / hold) * hold;

/** Per-pose hand-placement wobble for element `seed`. Returns px offsets and degrees. */
export const wobble = (frame: number, seed: number, amount = 1, hold = 3) => {
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
