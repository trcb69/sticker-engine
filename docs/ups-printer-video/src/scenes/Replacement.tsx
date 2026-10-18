import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BgMesh, Chapter, Finish} from '../components/Layers';
import {stepped, wobbleCss} from '../components/stop';
import {clamp, theme} from '../theme';

const P = theme.color.paper;
const I = theme.color.ink;
const OK = theme.color.ok;
const OKD = '#1E8F5E'; // ok-green darkened for use on paper (derived from theme.color.ok)

// ---- SVG icons --------------------------------------------------------------
const IconUps: React.FC = () => (
  <svg width={150} height={150} viewBox="0 0 110 110">
    <rect x={26} y={8} width={58} height={94} rx={9} fill="none" stroke={I} strokeWidth={6} />
    <rect x={36} y={20} width={38} height={18} rx={3} fill={I} />
    <rect x={38} y={52} width={34} height={38} rx={4} fill={OKD} />
    <rect x={49} y={46} width={12} height={7} fill={I} />
  </svg>
);
const IconAvr: React.FC = () => (
  <svg width={150} height={150} viewBox="0 0 110 110">
    <rect x={8} y={58} width={94} height={34} rx={8} fill="none" stroke={I} strokeWidth={6} />
    {[28, 55, 82].map((x) => (<rect key={x} x={x - 4} y={68} width={8} height={14} rx={2} fill={I} />))}
    <path d="M55 6 L82 16 V34 C82 46 70 52 55 56 C40 52 28 46 28 34 V16 Z" fill={OKD} stroke={I} strokeWidth={5} strokeLinejoin="round" />
    <path d="M44 30 L52 38 L67 22" fill="none" stroke={P} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconInkjet: React.FC = () => (
  <svg width={150} height={150} viewBox="0 0 110 110">
    <rect x={30} y={8} width={50} height={36} fill="#fff" stroke={I} strokeWidth={5} />
    <path d="M38 20 H72 M38 30 H62" stroke={I} strokeWidth={4} strokeLinecap="round" />
    <rect x={10} y={44} width={90} height={44} rx={8} fill="#D9D2C3" stroke={I} strokeWidth={6} />
    <rect x={30} y={62} width={50} height={8} rx={3} fill={I} />
    <path d="M78 98 L70 108 L80 108 L74 118" transform="translate(-4 -10)" fill="none" stroke={OKD} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type CardDef = {title: string; body: string; icon: React.ReactNode};
const CARDS: CardDef[] = [
  {title: 'Small UPS', body: '≈1 kVA, for the PC, router and print server only. Jobs stay queued, nothing is lost.', icon: <IconUps />},
  {title: 'Printer on AVR', body: 'Surge protector or voltage stabiliser (AVR) protects the M 2310N without fighting its fuser.', icon: <IconAvr />},
  {title: 'Print in outage?', body: 'A small business inkjet (≈20–30 W) on that UPS, or run the office from a generator/inverter.', icon: <IconInkjet />},
];

const CW = 544, CH = 650, CGAP = 48, CTOP = 270;

const DealtCard: React.FC<{def: CardDef; index: number; start: number; exit: number}> = ({def, index, start, exit}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const sf = stepped(frame, 3);
  const p = spring({frame: sf - start, fps, config: theme.spring.snappy});
  const out = interpolate(sf, [exit, exit + 9], [0, 1], {...clamp, easing: theme.ease.in});
  const homeX = 96 + index * (CW + CGAP);
  const deckX = 1560, deckY = 760; // the "deck" the cards are dealt from
  const x = homeX + (1 - p) * (deckX - homeX);
  const y = CTOP + (1 - p) * (deckY - CTOP) - out * 120;
  const rot = (1 - p) * 24 + (index - 1) * 1.2;
  const op = interpolate(sf, [start, start + 3], [0, 1], clamp) * (1 - out);
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: CW, height: CH, opacity: op, background: P,
        border: `5px solid ${I}`, borderRadius: 20, boxShadow: '6px 6px 0 rgba(0,0,0,0.45)', boxSizing: 'border-box',
        transform: `rotate(${rot}deg) ${wobbleCss(frame, index + 31)}`, padding: '34px 36px', color: I, fontFamily: theme.font.display,
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <div style={{fontFamily: theme.font.mono, fontSize: 40, fontWeight: 700, color: OKD}}>{index + 1}</div>
        {def.icon}
      </div>
      <div style={{fontSize: 52, fontWeight: 700, lineHeight: 1.05, marginTop: 14}}>{def.title}</div>
      <div style={{fontSize: 40, lineHeight: 1.22, marginTop: 16, fontWeight: 500}}>{def.body}</div>
    </div>
  );
};

// ---- wiring diagram -----------------------------------------------------------
type NodeDef = {id: string; cx: number; cy: number; label: string; sub?: string; ok?: boolean; at: number};
const NW = 340, NH = 120;
const NODES: NodeDef[] = [
  {id: 'mains', cx: 270, cy: 640, label: 'Mains', sub: '230 V', at: 0},
  {id: 'avr', cx: 870, cy: 420, label: 'AVR', sub: 'surge + stabiliser', ok: true, at: 1},
  {id: 'printer', cx: 1500, cy: 420, label: 'Printer', sub: 'Ricoh M 2310N', at: 2},
  {id: 'ups', cx: 870, cy: 780, label: 'Small UPS', sub: '≈1 kVA', ok: true, at: 1},
  {id: 'pc', cx: 1500, cy: 600, label: 'PC', at: 2},
  {id: 'router', cx: 1500, cy: 750, label: 'Router', at: 3},
  {id: 'queue', cx: 1500, cy: 900, label: 'Print queue', at: 4},
];
const L = (id: string) => NODES.find((n) => n.id === id)!;
const link = (a: string, b: string, at: number) => {
  const A = L(a), B = L(b);
  const x1 = A.cx + NW / 2, y1 = A.cy, x2 = B.cx - NW / 2, y2 = B.cy;
  const mx = (x1 + x2) / 2;
  return {d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, at, x2, y2};
};
const LINKS = [link('mains', 'avr', 6), link('avr', 'printer', 16), link('mains', 'ups', 6), link('ups', 'pc', 16), link('ups', 'router', 20), link('ups', 'queue', 24)];

const Diagram: React.FC<{start: number; exit: number}> = ({start, exit}) => {
  const frame = useCurrentFrame();
  const sf = stepped(frame, 3);
  const out = interpolate(frame, [exit, exit + 10], [0, 1], {...clamp, easing: theme.ease.in});
  const breathe = 1 + Math.sin(frame / 22) * 0.015;
  return (
    <AbsoluteFill style={{opacity: 1 - out}}>
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
        {LINKS.map((l, i) => {
          const t = interpolate(frame, [start + l.at, start + l.at + 22], [0, 1], {...clamp, easing: theme.ease.inOut});
          return (
            <g key={i}>
              <path d={l.d} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={8} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - t}
                strokeLinecap="round" transform="translate(4 4)" />
              <path d={l.d} fill="none" stroke={OK} strokeWidth={8} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - t} strokeLinecap="round" />
              {t >= 1 && <circle cx={l.x2} cy={l.y2} r={9} fill={OK} />}
            </g>
          );
        })}
      </svg>
      {NODES.map((n) => {
        const p = spring({frame: sf - (start + n.at * 5), fps: 30, config: theme.spring.bouncy});
        const op = interpolate(sf, [start + n.at * 5, start + n.at * 5 + 3], [0, 1], clamp);
        return (
          <div key={n.id} style={{
            position: 'absolute', left: n.cx - NW / 2, top: n.cy - NH / 2, width: NW, height: NH, boxSizing: 'border-box', opacity: op,
            background: P, border: `5px solid ${n.ok ? OK : I}`, outline: `3px solid ${I}`, borderRadius: 16, boxShadow: '6px 6px 0 rgba(0,0,0,0.45)',
            transform: `scale(${(0.7 + 0.3 * Math.min(p, 1.1)) * breathe}) rotate(${(1 - Math.min(p, 1)) * -6}deg) ${wobbleCss(frame, n.cx + n.cy)}`,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: I, fontFamily: theme.font.display,
          }}>
            <div style={{fontSize: 46, fontWeight: 700, lineHeight: 1.05}}>{n.label}</div>
            {n.sub && <div style={{fontFamily: theme.font.mono, fontSize: 26, color: '#4a5058', marginTop: 4}}>{n.sub}</div>}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const Replacement: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const s = (sec: number) => Math.round(fps * sec);
  const sceneOut = interpolate(frame, [durationInFrames - 10, durationInFrames - 2], [1, 0], {...clamp, easing: theme.ease.in});

  // headline: big at 0–2 s, then settles to the top for the rest of the diagram
  const hIn = spring({frame, fps, config: theme.spring.smooth});
  const hMove = interpolate(frame, [s(1.6), s(2.3)], [0, 1], {...clamp, easing: theme.ease.inOut});
  const hOut = interpolate(frame, [s(12), s(12) + 10], [0, 1], {...clamp, easing: theme.ease.in});
  const hSize = 150 - 70 * hMove;
  const hTop = 400 - 290 * hMove;

  const cardStart = [s(2.2), s(3.4), s(4.6)];
  const cardsExit = s(8.0);

  const steps = ['Outage', 'jobs wait in the queue', 'power back', 'bundle-print all at once'];
  const endStart = s(12.2);

  return (
    <AbsoluteFill style={{opacity: sceneOut}}>
      <BgMesh tint={OK} />
      <Chapter n={7} label="What we do instead" />
      <div style={{
        position: 'absolute', left: 96, top: hTop, fontFamily: theme.font.display, fontWeight: 700, fontSize: hSize, lineHeight: 1,
        color: theme.color.text, opacity: Math.min(hIn, 1) * (1 - hOut), transform: `translateY(${(1 - Math.min(hIn, 1)) * 40}px)`,
        width: 1728, textAlign: hMove < 0.5 ? 'left' : 'left',
      }}>
        A better <span style={{color: OK}}>plan</span>
      </div>

      {CARDS.map((c, i) => (<DealtCard key={c.title} def={c} index={i} start={cardStart[i]} exit={cardsExit + i * 3} />))}
      <Diagram start={s(8.3)} exit={s(12)} />

      <AbsoluteFill style={{padding: '0 120px', justifyContent: 'center'}}>
        <div style={{display: 'flex', flexDirection: 'column', gap: 24, fontFamily: theme.font.display, fontSize: 100, fontWeight: 700, lineHeight: 1.1}}>
          {steps.map((t, i) => {
            const a = spring({frame: frame - (endStart + i * 12), fps, config: theme.spring.smooth});
            const last = i === steps.length - 1;
            return (
              <div key={t} style={{opacity: Math.min(a, 1), transform: `translateX(${(1 - Math.min(a, 1)) * -50}px)`,
                color: last ? OK : i === 0 ? theme.color.hero : theme.color.text}}>
                {i > 0 && <span style={{color: theme.color.muted}}>→&nbsp;</span>}{t}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      <Finish />
    </AbsoluteFill>
  );
};
