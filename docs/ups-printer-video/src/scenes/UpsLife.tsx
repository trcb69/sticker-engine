import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BgMesh, Chapter, Finish} from '../components/Layers';
import {stepped, wobbleCss} from '../components/stop';
import {battery} from '../facts';
import {clamp, theme} from '../theme';

const P = theme.color.paper;
const I = theme.color.ink;
const SHADOW = '6px 6px 0 rgba(0,0,0,0.45)';
// End-of-life threshold for VRLA UPS batteries: 80 % of rated capacity (IEEE 1188 practice).
const EOL_PCT = battery.eolPct;

/** Paper cut-out battery pack with 4 cells. `cells` = how many have been placed (0..4). */
const BatteryPack: React.FC<{cells: number; lift: number[]}> = ({cells, lift}) => (
  <svg width={640} height={400} viewBox="0 0 640 400" style={{overflow: 'visible'}}>
    <rect x={40} y={90} width={560} height={260} rx={22} fill={P} stroke={I} strokeWidth={6} />
    <rect x={120} y={50} width={70} height={40} rx={6} fill={I} />
    <rect x={450} y={50} width={70} height={40} rx={6} fill={I} />
    <text x={155} y={80} textAnchor="middle" fontFamily={theme.font.mono} fontSize={30} fill={P}>+</text>
    <text x={485} y={80} textAnchor="middle" fontFamily={theme.font.mono} fontSize={30} fill={P}>−</text>
    {[0, 1, 2, 3].map((i) => (
      <g key={i} opacity={cells > i ? 1 : 0} transform={`translate(0 ${lift[i]})`}>
        <rect x={72 + i * 130} y={130} width={110} height={190} rx={10} fill="#D9D2C3" stroke={I} strokeWidth={5} />
        <rect x={100 + i * 130} y={118} width={54} height={14} rx={3} fill={I} />
        <path d={`M${139 + i * 130} 160 L${114 + i * 130} 235 H${134 + i * 130} L${124 + i * 130} 295 L${166 + i * 130} 215 H${146 + i * 130} Z`}
          fill={I} />
      </g>
    ))}
  </svg>
);

const IconDeep: React.FC = () => (
  <svg width={110} height={110} viewBox="0 0 110 110">
    <rect x={30} y={14} width={50} height={86} rx={8} fill="none" stroke={I} strokeWidth={6} />
    <rect x={43} y={6} width={24} height={10} rx={2} fill={I} />
    <rect x={38} y={78} width={34} height={14} rx={3} fill={theme.color.hero} />
    <path d="M55 34 V62 M44 52 L55 64 L66 52" fill="none" stroke={I} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconHeat: React.FC = () => (
  <svg width={110} height={110} viewBox="0 0 110 110">
    <rect x={44} y={10} width={22} height={64} rx={11} fill="none" stroke={I} strokeWidth={6} />
    <circle cx={55} cy={82} r={19} fill={theme.color.hero} stroke={I} strokeWidth={6} />
    <rect x={51} y={34} width={8} height={48} fill={theme.color.hero} />
    <path d="M78 28 H94 M78 44 H90 M78 60 H94" stroke={I} strokeWidth={5} strokeLinecap="round" />
  </svg>
);
const IconOverload: React.FC = () => (
  <svg width={110} height={110} viewBox="0 0 110 110">
    <path d="M10 82 A45 45 0 0 1 100 82" fill="none" stroke={I} strokeWidth={8} strokeLinecap="round" />
    <path d="M78 42 A45 45 0 0 1 100 82" fill="none" stroke={theme.color.hero} strokeWidth={8} strokeLinecap="round" />
    <path d="M55 82 L82 40" stroke={I} strokeWidth={6} strokeLinecap="round" />
    <circle cx={55} cy={82} r={9} fill={I} />
  </svg>
);

type CardDef = {title: string; body: string; chip?: string; icon: React.ReactNode};
const CARDS: CardDef[] = [
  {
    title: 'Deep discharges',
    body: 'Every outage at 1.5 kW drains the pack.',
    chip: `≈${battery.deepCycles} deep cycles`,
    icon: <IconDeep />,
  },
  {
    title: 'Heat',
    body: `Every +${battery.halvesEveryC} °C roughly halves battery life. High current heats the cells.`,
    icon: <IconHeat />,
  },
  {
    title: 'Overload',
    body: `Inrush spikes push the inverter past its limit. Keep load under ${battery.maxLoadPct} %.`,
    icon: <IconOverload />,
  },
];

const Card: React.FC<{def: CardDef; start: number; exit: number; seed: number; y: number}> = ({def, start, exit, seed, y}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const sf = stepped(frame, 3);
  const p = spring({frame: sf - start, fps, config: theme.spring.bouncy});
  const out = interpolate(sf, [exit, exit + 9], [0, 1], {...clamp, easing: theme.ease.in});
  const op = interpolate(sf, [start, start + 3], [0, 1], clamp) * (1 - out);
  const drop = (1 - p) * -420 - out * 80;
  const scale = 1 + (1 - p) * 0.18;
  const sh = 6 + (1 - Math.min(p, 1)) * 26;
  return (
    <div
      style={{
        position: 'absolute', left: 96, top: y, width: 1000, height: 252, opacity: op, background: P,
        border: `5px solid ${I}`, borderRadius: 14, boxShadow: `${sh}px ${sh}px 0 rgba(0,0,0,0.45)`,
        transform: `translateY(${drop}px) scale(${scale}) ${wobbleCss(frame, seed)}`,
        display: 'flex', alignItems: 'center', gap: 28, padding: '0 36px', color: I, fontFamily: theme.font.display,
      }}
    >
      <div style={{flex: 'none'}}>{def.icon}</div>
      <div style={{flex: 1}}>
        <div style={{fontSize: 52, fontWeight: 700, lineHeight: 1.05}}>{def.title}</div>
        <div style={{fontSize: 36, lineHeight: 1.2, marginTop: 8, fontWeight: 500}}>{def.body}</div>
        {def.chip && (
          <div style={{display: 'inline-block', marginTop: 8, fontFamily: theme.font.mono, fontSize: 30, fontWeight: 700,
            background: I, color: P, padding: '2px 14px', borderRadius: 6}}>{def.chip}</div>
        )}
      </div>
    </div>
  );
};

// ---- smooth data chart -------------------------------------------------------
const W = 644, H = 756;
const PX = 96, PR = 30, PT = 150, PB = 120; // plot margins inside the panel
const X_MAX = 6, Y_MIN = 60, Y_MAX = 100;
const sx = (t: number) => PX + (t / X_MAX) * (W - PX - PR);
const sy = (v: number) => PT + ((Y_MAX - v) / (Y_MAX - Y_MIN)) * (H - PT - PB);
const cap = (t: number, life: number) => Y_MAX - (Y_MAX - EOL_PCT) * Math.pow(t / life, 1.6);
const curve = (life: number, upTo: number) => {
  const pts: string[] = [];
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const t = (life * i) / n;
    if (t > upTo) break;
    pts.push(`${i === 0 ? 'M' : 'L'}${sx(t).toFixed(1)} ${sy(cap(t, life)).toFixed(1)}`);
  }
  return pts.join(' ');
};

const Chart: React.FC<{start: number; exit: number}> = ({start, exit}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const gentleLife = battery.lifeYears[1];
  const loadedLife = battery.lifeYears[0] / 2;
  const enter = spring({frame: frame - start, fps, config: theme.spring.smooth});
  const out = interpolate(frame, [exit, exit + 10], [0, 1], {...clamp, easing: theme.ease.in});
  const grow = interpolate(frame, [start + 14, start + 14 + fps * 4.2], [0, 1], {...clamp, easing: theme.ease.inOut});
  const tG = grow * gentleLife;
  const tL = Math.min(grow * gentleLife, loadedLife);
  const loadedDone = grow * gentleLife >= loadedLife;
  const pulse = 1 + Math.sin(frame / 8) * 0.12;
  return (
    <div
      style={{
        position: 'absolute', left: 1180, top: 160, width: W, height: H, borderRadius: 16,
        background: theme.color.panel, border: `2px solid ${theme.color.line}`,
        opacity: Math.min(enter, 1) * (1 - out), transform: `translateY(${(1 - enter) * 40}px)`,
      }}
    >
      <svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
        <text x={PX - 56} y={56} fill={theme.color.text} fontFamily={theme.font.display} fontSize={36} fontWeight={600}>Battery capacity</text>
        <text x={PX - 56} y={94} fill={theme.color.muted} fontFamily={theme.font.mono} fontSize={24}>% of new, by year</text>
        {[100, 90, 80, 70, 60].map((v) => (
          <g key={v}>
            <line x1={PX} x2={W - PR} y1={sy(v)} y2={sy(v)} stroke={theme.color.line} strokeWidth={1.5} />
            <text x={PX - 12} y={sy(v) + 8} textAnchor="end" fill={theme.color.muted} fontFamily={theme.font.mono} fontSize={24}>{v}</text>
          </g>
        ))}
        {[0, 1, 2, 3, 4, 5, 6].map((t) => (
          <text key={t} x={sx(t)} y={H - PB + 36} textAnchor="middle" fill={theme.color.muted} fontFamily={theme.font.mono} fontSize={24}>{t}</text>
        ))}
        <text x={sx(X_MAX / 2)} y={H - PB + 66} textAnchor="middle" fill={theme.color.muted} fontFamily={theme.font.mono} fontSize={24}>years</text>
        {/* end-of-life line */}
        <line x1={PX} x2={W - PR} y1={sy(EOL_PCT)} y2={sy(EOL_PCT)} stroke={theme.color.muted} strokeWidth={2.5} strokeDasharray="10 8" />
        <text x={sx(2.0)} y={sy(EOL_PCT) + 38} fill={theme.color.muted} fontFamily={theme.font.mono} fontSize={24}>end of life ({EOL_PCT} %)</text>
        {/* curves */}
        <path d={curve(gentleLife, tG)} fill="none" stroke={theme.color.text} strokeWidth={5} strokeLinecap="round" />
        <path d={curve(loadedLife, tL)} fill="none" stroke={theme.color.hero} strokeWidth={5} strokeLinecap="round" />
        {loadedDone && (
          <circle cx={sx(loadedLife)} cy={sy(EOL_PCT)} r={10 * pulse} fill={theme.color.hero} />
        )}
        {/* legend */}
        <g fontFamily={theme.font.mono} fontSize={24}>
          <line x1={PX + 6} x2={PX + 46} y1={H - 22} y2={H - 22} stroke={theme.color.text} strokeWidth={5} strokeLinecap="round" />
          <text x={PX + 58} y={H - 14} fill={theme.color.text}>gentle use</text>
          <line x1={PX + 236} x2={PX + 276} y1={H - 22} y2={H - 22} stroke={theme.color.hero} strokeWidth={5} strokeLinecap="round" />
          <text x={PX + 288} y={H - 14} fill={theme.color.hero}>printer load</text>
        </g>
      </svg>
      <div style={{position: 'absolute', right: 28, top: 58, fontFamily: theme.font.mono, fontSize: 24, color: theme.color.hero,
        border: `2px solid ${theme.color.hero}`, borderRadius: 6, padding: '2px 12px', opacity: loadedDone ? 1 : 0.55}}>
        illustrative
      </div>
    </div>
  );
};

export const UpsLife: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const s = (sec: number) => Math.round(fps * sec);
  const sf = stepped(frame, 3);

  // scene fade-out in the last ~10 frames
  const sceneOut = interpolate(frame, [durationInFrames - 10, durationInFrames - 2], [1, 0], {...clamp, easing: theme.ease.in});

  // 0–4 s: battery + headline
  const introOut = interpolate(sf, [s(3.6), s(3.6) + 9], [0, 1], {...clamp, easing: theme.ease.in});
  const cellsIn = Math.floor(interpolate(sf, [s(0.3), s(1.6)], [0, 4.99], {...clamp, easing: theme.ease.out}));
  const lift = [0, 1, 2, 3].map((i) => {
    const t = interpolate(sf, [s(0.3) + i * 8, s(0.3) + i * 8 + 12], [0, 1], {...clamp, easing: theme.ease.out});
    return (1 - t) * -140;
  });
  const batt = spring({frame: sf, fps, config: theme.spring.snappy});
  const breathe = 1 + Math.sin(frame / 22) * 0.015;
  const head = interpolate(sf, [s(0.5), s(0.5) + 20], [0, 1], {...clamp, easing: theme.ease.out});

  // 10–13 s: closing line
  const endIn = spring({frame: frame - s(10.2), fps, config: theme.spring.smooth});
  const endOut = 1;

  const cardsExit = s(9.6);
  const cardY = [160, 432, 704];
  const cardStart = [s(4.2), s(5.6), s(7.0)];

  return (
    <AbsoluteFill style={{opacity: sceneOut}}>
      <BgMesh />
      <Chapter n={6} label="What it does to the UPS" />

      {/* 0–4 s */}
      <div style={{position: 'absolute', left: 96, top: 330, opacity: Math.min(batt, 1) * (1 - introOut),
        transform: `scale(${(0.9 + 0.1 * Math.min(batt, 1)) * breathe}) ${wobbleCss(frame, 3)}`, filter: 'drop-shadow(8px 8px 0 rgba(0,0,0,0.45))'}}>
        <BatteryPack cells={cellsIn} lift={lift} />
      </div>
      <div style={{position: 'absolute', left: 840, top: 330, width: 980, color: theme.color.text, fontFamily: theme.font.display,
        fontSize: 88, fontWeight: 700, lineHeight: 1.08, opacity: head * (1 - introOut), transform: `translateY(${(1 - head) * 30}px)`}}>
        Lead-acid UPS batteries last{' '}
        <span style={{color: theme.color.text, borderBottom: `6px solid ${theme.color.hero}`, whiteSpace: 'nowrap'}}>
          {battery.lifeYears[0]}–{battery.lifeYears[1]} years
        </span>{' '}
        <span style={{color: theme.color.muted, fontWeight: 500}}>— when treated gently.</span>
      </div>

      {/* 4–10 s */}
      {CARDS.map((c, i) => (
        <Card key={c.title} def={c} start={cardStart[i]} exit={cardsExit + i * 3} seed={i + 11} y={cardY[i]} />
      ))}
      <Chart start={s(4.2)} exit={s(9.6)} />

      {/* 10–13 s */}
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', padding: '0 100px', opacity: Math.min(endIn, 1) * endOut,
        transform: `translateY(${(1 - Math.min(endIn, 1)) * 40}px)`}}>
        <div style={{color: theme.color.text, fontFamily: theme.font.display, fontSize: 86, fontWeight: 700, lineHeight: 1.15, textAlign: 'center'}}>
          So the UPS dies early —<br />
          <span style={{color: theme.color.hero}}>and still can't run the printer for long.</span>
        </div>
      </AbsoluteFill>
      <Finish />
    </AbsoluteFill>
  );
};
