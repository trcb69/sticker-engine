import React from 'react';
import {theme} from '../theme';

const P = theme.color.paper;
const I = theme.color.ink;

/** Flat paper cut-out of a desktop laser printer. `heat` 0..1 makes the fuser glow. */
export const PrinterCutout: React.FC<{size?: number; heat?: number; paperOut?: number}> = ({
  size = 420, heat = 0, paperOut = 0,
}) => (
  <svg width={size} height={size * 0.8} viewBox="0 0 500 400" style={{overflow: 'visible'}}>
    {/* paper sliding out the top */}
    <rect x={150} y={60 - paperOut * 70} width={200} height={80} fill="#fff" stroke={I} strokeWidth={4} />
    {/* body */}
    <path d="M60 110 L440 110 L460 330 L40 330 Z" fill={P} stroke={I} strokeWidth={6} strokeLinejoin="round" />
    <rect x={40} y={330} width={420} height={40} rx={6} fill="#D9D2C3" stroke={I} strokeWidth={6} />
    {/* output slot */}
    <rect x={130} y={130} width={240} height={18} rx={4} fill={I} />
    {/* fuser window */}
    <rect x={150} y={190} width={200} height={70} rx={10} fill={I} />
    <rect x={165} y={205} width={170} height={40} rx={20}
      fill={theme.color.hero} opacity={0.15 + heat * 0.85}
      style={{filter: `drop-shadow(0 0 ${heat * 30}px ${theme.color.hero})`}} />
    {/* control panel */}
    <rect x={370} y={280} width={60} height={24} rx={4} fill="#D9D2C3" stroke={I} strokeWidth={4} />
    <circle cx={90} cy={292} r={10} fill={heat > 0.05 ? theme.color.hero : theme.color.ok} stroke={I} strokeWidth={3} />
  </svg>
);

/** Flat paper cut-out of a tower UPS. `charge` 0..1 fills the battery gauge. */
export const UpsCutout: React.FC<{size?: number; charge?: number; label?: string; alarm?: boolean}> = ({
  size = 260, charge = 1, label = '3 kVA', alarm = false,
}) => (
  <svg width={size} height={size * 1.6} viewBox="0 0 250 400" style={{overflow: 'visible'}}>
    <rect x={20} y={20} width={210} height={360} rx={18} fill={P} stroke={I} strokeWidth={6} />
    <rect x={50} y={60} width={150} height={60} rx={8} fill={I} />
    <text x={125} y={101} textAnchor="middle" fontFamily={theme.font.mono} fontSize={28}
      fill={alarm ? theme.color.hero : theme.color.ok}>{label}</text>
    {/* battery gauge */}
    <rect x={80} y={160} width={90} height={170} rx={8} fill="none" stroke={I} strokeWidth={5} />
    <rect x={105} y={148} width={40} height={14} rx={3} fill={I} />
    <rect x={88} y={168 + (1 - charge) * 154} width={74} height={154 * charge} rx={4}
      fill={charge < 0.25 ? theme.color.hero : theme.color.ok} />
    {[0, 1, 2, 3].map((i) => (
      <circle key={i} cx={70 + i * 37} cy={355} r={6} fill={I} />
    ))}
  </svg>
);
