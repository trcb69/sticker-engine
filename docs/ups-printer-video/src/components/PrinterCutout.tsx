import React from 'react';
import {theme} from '../theme';

// Ricoh M 2310N with ARDF, front elevation, traced from the official straight-front photo.
// All geometry is in millimetres: x from the body's left edge (0..575), y = height above the floor
// (0..~508 with the ARDF tray tip). The 3D model (Fuser3DModel.tsx) reuses this spec so the flat
// card and the 3D printer line up exactly when the 3D camera looks at it front-on.

export const RICOH = {
  W: 575,
  D: 565,
  H_BODY: 402,
  col: {
    body: '#D4D5D3',
    door: '#C8C9C7',
    white: '#EDEDEB',
    black: '#1F1F20',
    key: '#3A3A3C',
    lcd: '#B5C8A6',
    green: '#59C23F',
    orange: '#F28C28',
    yellow: '#F2C230',
    blue: '#1FA0D0',
    word: '#222222',
    cavity: '#0F0F10',
    notch: '#BDBEBC',
  },
  // heights
  cassetteTop: 90,
  bayFloor: 253, // grey body top on the left (under the output tray)
  trayTop: 287, // output tray floor surface
  deckBottom: 350,
  deckTop: 403,
  scanTop: 432,
  ardfTop: 491,
  bayRight: 291, // x where the grey body steps up
  bayLeftWall: 40,
  bayDepth: 330,
  fillet: 20,
  door: {x0: 222, x1: 433, y0: 140, y1: 306, r: 14},
  badge: {x0: 248, x1: 322, y0: 180, y1: 220},
  a4: {x0: 459, x1: 516, y0: 37, y1: 63},
  notch: {x0: 214, x1: 356, h: 24},
  ardf: {x0: 8, x1: 204, slopeX: 150, slopeY: 476},
  feeder: {x0: 177, x1: 290, y0: 432, y1: 486},
  // ARDF input tray as traced from the front photo (top surface seen slightly from above)
  inTray: [[177, 474], [538, 505], [540, 495], [507, 489], [372, 472], [291, 455], [204, 436]] as [number, number][],
  panel: {x0: 291, x1: 572, y0: 352, y1: 402},
  led: {x: 300, y: 395, r: 4.5},
} as const;

const C = RICOH.col;

/** Control-panel parts in the same mm frame. Shared with the 3D panel texture. */
export type PanelPart = {x0: number; y0: number; x1: number; y1: number; fill: string; r?: number};
export const PANEL_PARTS: PanelPart[] = (() => {
  const p: PanelPart[] = [];
  p.push({x0: 309, y0: 374, x1: 331, y1: 390, fill: C.key, r: 2}); // left icon / NFC
  p.push({x0: 346, y0: 393, x1: 364, y1: 399, fill: C.green, r: 2}); // top-row keys
  p.push({x0: 368, y0: 393, x1: 386, y1: 399, fill: C.key, r: 2});
  p.push({x0: 341, y0: 369, x1: 413, y1: 389, fill: C.lcd, r: 1.5}); // LCD
  p.push({x0: 350, y0: 362, x1: 366, y1: 366, fill: C.key, r: 1});
  p.push({x0: 384, y0: 362, x1: 400, y1: 366, fill: C.key, r: 1});
  for (let i = 0; i < 3; i++) p.push({x0: 424 + i * 20, y0: 395, x1: 436 + i * 20, y1: 399, fill: C.key, r: 1});
  const ax = 455, ay = 380; // arrow cluster
  p.push({x0: ax - 4, y0: ay + 5, x1: ax + 4, y1: ay + 10, fill: C.key, r: 1});
  p.push({x0: ax - 4, y0: ay - 10, x1: ax + 4, y1: ay - 5, fill: C.key, r: 1});
  p.push({x0: ax - 13, y0: ay - 3, x1: ax - 6, y1: ay + 3, fill: C.key, r: 1});
  p.push({x0: ax + 6, y0: ay - 3, x1: ax + 13, y1: ay + 3, fill: C.key, r: 1});
  p.push({x0: ax - 3.5, y0: ay - 3, x1: ax + 3.5, y1: ay + 3, fill: C.key, r: 3});
  for (let r = 0; r < 4; r++) // 3 × 4 keypad
    for (let c = 0; c < 3; c++)
      p.push({x0: 486 + c * 14, y0: 391 - r * 7.5, x1: 497 + c * 14, y1: 396 - r * 7.5, fill: C.key, r: 1});
  p.push({x0: 538, y0: 395, x1: 562, y1: 400, fill: C.green, r: 2}); // coloured keys, far right
  p.push({x0: 538, y0: 387, x1: 562, y1: 393, fill: C.orange, r: 2});
  p.push({x0: 538, y0: 380, x1: 562, y1: 385.5, fill: C.yellow, r: 2});
  p.push({x0: 536, y0: 367, x1: 564, y1: 377, fill: C.blue, r: 4});
  return p;
})();

// mm → SVG viewBox (500 × 400): the printer stands on y=370 and is centred on x=250.
export const CUT_K = 340 / 508; // viewBox units per mm (≈ 0.669)
const T = `translate(${250 - (RICOH.W / 2) * CUT_K} 370) scale(${CUT_K})`;

const R = RICOH;
const rect = (x0: number, y0: number, x1: number, y1: number) => ({x: x0, y: -y1, width: x1 - x0, height: y1 - y0});
const I = theme.color.ink;
const SW = 7; // outer ink stroke, mm (≈ 4.7 viewBox units)
const sw = 3.5; // inner detail stroke

const bodyPath = () => {
  const f = R.fillet;
  return [
    `M0 ${-R.cassetteTop}`, `L${R.W} ${-R.cassetteTop}`, `L${R.W} ${-R.deckBottom}`, `L${R.bayRight} ${-R.deckBottom}`,
    `L${R.bayRight} ${-(R.bayFloor + f)}`, `Q${R.bayRight} ${-R.bayFloor} ${R.bayRight - f} ${-R.bayFloor}`,
    `L0 ${-R.bayFloor}`, 'Z',
  ].join(' ');
};

const doorPath = () => {
  const d = R.door, f = R.fillet;
  return [
    `M${d.x0} ${-d.y0}`, `L${d.x1 - d.r} ${-d.y0}`, `Q${d.x1} ${-d.y0} ${d.x1} ${-(d.y0 + d.r)}`,
    `L${d.x1} ${-(d.y1 - d.r)}`, `Q${d.x1} ${-d.y1} ${d.x1 - d.r} ${-d.y1}`,
    `L${R.bayRight + 18} ${-d.y1}`, `Q${R.bayRight} ${-d.y1} ${R.bayRight} ${-(d.y1 - 18)}`,
    `L${R.bayRight} ${-(R.bayFloor + f)}`, `Q${R.bayRight} ${-R.bayFloor} ${R.bayRight - f} ${-R.bayFloor}`,
    `L${d.x0} ${-R.bayFloor}`, 'Z',
  ].join(' ');
};

const ardfPath = () => {
  const a = R.ardf;
  return `M${a.x0} ${-R.scanTop} L${a.x1} ${-R.scanTop} L${a.x1} ${-a.slopeY} L${a.slopeX} ${-R.ardfTop} L${a.x0 + 6} ${-R.ardfTop} Q${a.x0} ${-R.ardfTop} ${a.x0} ${-(R.ardfTop - 6)} Z`;
};

const inTrayPath = () => 'M' + R.inTray.map(([x, y]) => `${x} ${-y}`).join(' L') + ' Z';

/** Flat paper cut-out of the Ricoh M 2310N. `heat` 0..1 glows the output bay; `paperOut` slides a sheet out. */
export const PrinterCutout: React.FC<{size?: number; heat?: number; paperOut?: number}> = ({
  size = 420, heat = 0, paperOut = 0,
}) => {
  const hero = theme.color.hero;
  const id = `pc${Math.round(size)}`;
  // the sheet leaves the fuser at the back-right of the bay and slides left along the output tray
  const sheetW = 170;
  const sheetX1 = R.bayRight - 6 - (1 - paperOut) * (sheetW - 4);
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 500 400" style={{overflow: 'visible'}}>
      <defs>
        <radialGradient id={`${id}g`} cx="0.6" cy="0.6" r="0.6">
          <stop offset="0" stopColor={hero} stopOpacity={1} />
          <stop offset="0.5" stopColor={hero} stopOpacity={0.6} />
          <stop offset="1" stopColor={hero} stopOpacity={0} />
        </radialGradient>
        <clipPath id={`${id}c`}>
          <rect {...rect(R.bayLeftWall, R.trayTop - 2, R.bayRight, R.deckBottom)} />
        </clipPath>
      </defs>
      <g transform={T} strokeLinejoin="round">
        {/* scanner + ARDF */}
        <rect {...rect(6, R.deckTop - 2, 560, R.scanTop)} rx={5} fill={C.white} stroke={I} strokeWidth={SW} />
        <line x1={12} y1={-418} x2={554} y2={-418} stroke="#B9BAB8" strokeWidth={2.5} />
        <rect {...rect(R.feeder.x0, R.feeder.y0, R.feeder.x1, R.feeder.y1)} rx={8} fill={C.black} stroke={I} strokeWidth={SW * 0.7} />
        <path d={inTrayPath()} fill={C.black} stroke={I} strokeWidth={SW * 0.7} />
        <path d={ardfPath()} fill={C.white} stroke={I} strokeWidth={SW} />
        <line x1={R.ardf.x0 + 14} y1={-446} x2={R.ardf.x1 - 10} y2={-446} stroke="#B9BAB8" strokeWidth={2.5} />

        {/* output bay: black shell, dark cavity, warm glow, exiting sheet, black tray floor */}
        <rect {...rect(0, R.bayFloor, R.bayRight, R.deckBottom)} fill={C.black} />
        <rect {...rect(R.bayLeftWall, R.trayTop, R.bayRight, R.deckBottom)} fill={C.cavity} />
        <g clipPath={`url(#${id}c)`}>
          <ellipse cx={200} cy={-(R.trayTop + 24)} rx={160} ry={44} fill={`url(#${id}g)`} opacity={heat * 0.95} />
          {paperOut > 0.01 && (
            <path
              d={`M${sheetX1 - sheetW} ${-(R.trayTop + 2)} L${sheetX1} ${-(R.trayTop + 2)} L${sheetX1 + 6} ${-(R.trayTop + 14)} L${sheetX1 - sheetW + 6} ${-(R.trayTop + 14)} Z`}
              fill="#ffffff" stroke={I} strokeWidth={sw}
            />
          )}
        </g>
        <rect {...rect(4, R.bayFloor - 3, R.bayRight, R.trayTop)} rx={4} fill={C.black} stroke={I} strokeWidth={sw} />

        {/* grey body, door, badge */}
        <path d={bodyPath()} fill={C.body} stroke={I} strokeWidth={SW} />
        <path d={doorPath()} fill={C.door} stroke={I} strokeWidth={sw} />
        <line x1={R.door.x1} y1={-R.door.y0} x2={R.door.x1} y2={-R.cassetteTop} stroke={I} strokeWidth={sw} />
        <line x1={R.badge.x0 + 6} y1={-201} x2={R.badge.x1 - 6} y2={-201} stroke="#A9AAA8" strokeWidth={1.2} />
        <text x={(R.badge.x0 + R.badge.x1) / 2} y={-205} textAnchor="middle" fontFamily={theme.font.display}
          fontWeight={700} fontSize={17} letterSpacing={1} fill={C.word}>RICOH</text>
        <text x={(R.badge.x0 + R.badge.x1) / 2} y={-187} textAnchor="middle" fontFamily={theme.font.display}
          fontWeight={500} fontSize={10} fill={C.word}>M 2310N</text>

        {/* scanner deck + control panel */}
        <rect {...rect(3, R.deckBottom, 572, R.deckTop)} rx={6} fill={C.black} stroke={I} strokeWidth={SW} />
        {PANEL_PARTS.map((k, i) => (
          <rect key={i} {...rect(k.x0, k.y0, k.x1, k.y1)} rx={k.r ?? 0} fill={k.fill} />
        ))}
        <circle cx={R.led.x} cy={-R.led.y} r={R.led.r} fill={heat > 0.05 ? hero : C.key}
          style={{filter: heat > 0.05 ? `drop-shadow(0 0 ${2 + heat * 6}px ${hero})` : undefined}} />

        {/* paper cassette */}
        <rect {...rect(0, 0, R.W, R.cassetteTop)} rx={8} fill={C.body} stroke={I} strokeWidth={SW} />
        <path
          d={`M${R.notch.x0} 0 L${R.notch.x0} ${-(R.notch.h - 8)} Q${R.notch.x0} ${-R.notch.h} ${R.notch.x0 + 8} ${-R.notch.h} L${R.notch.x1 - 8} ${-R.notch.h} Q${R.notch.x1} ${-R.notch.h} ${R.notch.x1} ${-(R.notch.h - 8)} L${R.notch.x1} 0 Z`}
          fill={C.notch} stroke={I} strokeWidth={sw}
        />
        <rect {...rect(R.a4.x0, R.a4.y0, R.a4.x1, R.a4.y1)} rx={4} fill={C.white} stroke="#8E8F8D" strokeWidth={2} />
        <text x={R.a4.x0 + 8} y={-42} fontFamily={theme.font.display} fontWeight={500} fontSize={16} fill={C.word}>A4</text>
        <path d={`M${R.a4.x1 - 18} -45 L${R.a4.x1 - 18} -57 L${R.a4.x1 - 9} -57 L${R.a4.x1 - 9} -49 L${R.a4.x1 - 13} -45 Z`}
          fill="none" stroke={C.word} strokeWidth={1.6} />
      </g>
    </svg>
  );
};
