import React from 'react';
import {theme} from '../theme';

// Flat front elevation of the Prolink PRO903ES (190 x 318 mm, 3 kVA tower) as a paper cut-out.
// The hard offset shadow is applied by the caller (drop-shadow filter), like PrinterCutout.
// viewBox 250 x 400; 1 mm = 1.21 units. Layout mirrored in Ups3DModel.tsx (world = units / 100).
export const UPS_BLACK = '#1A1A1A';
export const UPS_GLOSS = '#101010';
export const UPS_RIM = '#3a4350';
export const UPS_LCD = '#2D6BD0';
const LCD_LIGHT = '#EAF2FF';

/** Flat cut-out of a Prolink PRO903ES tower UPS. The LCD shows `label` and a battery bar for `charge` 0..1. */
export const UpsCutout: React.FC<{size?: number; charge?: number; label?: string; alarm?: boolean}> = ({
  size = 260, charge = 1, label = '3 kVA', alarm = false,
}) => {
  const lcd = alarm ? theme.color.hero : UPS_LCD;
  const fg = alarm ? theme.color.ink : LCD_LIGHT;
  const low = charge < 0.25;
  const barFill = alarm ? theme.color.ink : low ? theme.color.hero : LCD_LIGHT;
  const cols = [0, 1, 2, 3];
  return (
    <svg width={size} height={size * 1.6} viewBox="0 0 250 400" style={{overflow: 'visible'}}>
      <defs>
        <pattern id="ups-slats" x="0" y="0" width="50" height="6" patternUnits="userSpaceOnUse">
          <rect width="50" height="6" fill="#0b0b0b" />
          <rect y="0" width="50" height="2.4" fill="#2c2e31" />
        </pattern>
      </defs>
      {/* feet */}
      <rect x={40} y={380} width={30} height={14} rx={5} fill="#0b0b0b" stroke={UPS_RIM} strokeWidth={2} />
      <rect x={180} y={380} width={30} height={14} rx={5} fill="#0b0b0b" stroke={UPS_RIM} strokeWidth={2} />
      {/* matte black body */}
      <rect x={10} y={9} width={230} height={373} rx={3} fill={UPS_BLACK} stroke={UPS_RIM} strokeWidth={3} />
      {/* glossy upper bezel + recessed panel */}
      <rect x={13} y={12} width={224} height={138} fill={UPS_GLOSS} />
      <rect x={58} y={20} width={134} height={130} rx={2} fill="#0b0b0b" stroke="#252a31" strokeWidth={2} />
      {/* LCD */}
      <rect x={73} y={29} width={104} height={70} rx={2} fill="#05070a" />
      <rect x={78} y={34} width={94} height={60} fill={lcd} />
      <text x={125} y={62} textAnchor="middle" fontFamily={theme.font.mono} fontWeight={700} fontSize={22} fill={fg}>{label}</text>
      <rect x={90} y={70} width={64} height={14} rx={2} fill="none" stroke={fg} strokeWidth={2} />
      <rect x={154} y={74} width={4} height={6} fill={fg} />
      <rect x={93} y={73} width={Math.max(0, 58 * charge)} height={8} fill={barFill} />
      {/* wordmark + buttons */}
      <text x={125} y={116} textAnchor="middle" fontFamily={theme.font.display} fontWeight={700} fontSize={13} fill="#fff" letterSpacing={0.5}>PROLiNK</text>
      {[92, 125, 158].map((cx, i) => (
        <g key={cx}>
          <rect x={cx - 14} y={124} width={28} height={5} rx={1} fill="#F2F2F2" />
          <text x={cx} y={139} textAnchor="middle" fontFamily={theme.font.display} fontSize={6.5} fill="#d5d9de">
            {['ON/MUTE', 'SELECT', 'OFF/ENTER'][i]}
          </text>
          <text x={cx} y={146} textAnchor="middle" fontFamily={theme.font.display} fontSize={6} fill="#d5d9de">
            {['▲', '▼', '↵'][i]}
          </text>
        </g>
      ))}
      {/* grille: 4 columns of horizontal slats */}
      {cols.map((i) => (
        <rect key={i} x={22 + i * 51.5} y={158} width={49} height={218} fill="url(#ups-slats)" />
      ))}
    </svg>
  );
};
