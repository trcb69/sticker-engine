import {Easing} from 'remotion';
import {staticFile} from 'remotion';

// Fonts are served from public/ (the render browser has no internet access).
// Plain @font-face; FontGate (components/FontGate.tsx) holds each render until they load.
if (typeof document !== 'undefined' && !document.getElementById('ups-fonts')) {
  const style = document.createElement('style');
  style.id = 'ups-fonts';
  style.textContent = `
@font-face{font-family:'Space Grotesk';src:url('${staticFile('fonts/SpaceGrotesk.woff2')}') format('woff2');font-weight:300 700;font-display:block}
@font-face{font-family:'JetBrains Mono';src:url('${staticFile('fonts/JetBrainsMono.woff2')}') format('woff2');font-weight:100 800;font-display:block}`;
  document.head.appendChild(style);
}
const display = {fontFamily: "'Space Grotesk', sans-serif"};
const mono = {fontFamily: "'JetBrains Mono', monospace"};

export const theme = {
  color: {
    bg: '#0E1217',
    panel: '#171D25',
    line: '#2A3440',
    text: '#EDEFF2',
    muted: '#8A96A3',
    hero: '#FF6A2B', // heat / fuser / danger — the one hero colour
    ok: '#3DDC97', // used sparingly for the "replacement" answer
    paper: '#F3EEE3', // stop-motion paper cut-outs
    ink: '#1B1F24',
  },
  font: {display: display.fontFamily, mono: mono.fontFamily},
  ease: {
    out: Easing.bezier(0.16, 1, 0.3, 1),
    inOut: Easing.bezier(0.83, 0, 0.17, 1),
    in: Easing.bezier(0.7, 0, 0.84, 0),
  },
  spring: {
    snappy: {damping: 14, stiffness: 160, mass: 0.6},
    smooth: {damping: 20, stiffness: 90, mass: 1},
    bouncy: {damping: 11, stiffness: 170, mass: 0.7},
  },
} as const;

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
