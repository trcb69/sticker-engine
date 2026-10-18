export const FPS = 30;
const s = (sec: number) => Math.round(sec * FPS);
// [id, seconds]
export const SCENES = [
  ['Hook', 6],
  ['CurrentDraw', 16],
  ['Fuser3D', 17],
  ['Runtime', 16],
  ['Batch', 17],
  ['UpsLife', 13],
  ['Replacement', 15],
  ['Outro', 8],
] as const;
export const sceneFrames = Object.fromEntries(SCENES.map(([id, sec]) => [id, s(sec)])) as Record<
  (typeof SCENES)[number][0],
  number
>;
export const TOTAL = SCENES.reduce((a, [, sec]) => a + s(sec), 0);
