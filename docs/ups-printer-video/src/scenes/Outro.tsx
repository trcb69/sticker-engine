import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BgMesh, Finish} from '../components/Layers';
import {theme, clamp} from '../theme';
import {printer, current, ups} from '../facts';

// Timing in seconds, converted with fps. The scene itself is 8 s long.
const at = (fps: number, s: number) => Math.round(fps * s);
const STAGGER = 6; // frames between recap lines (brief: 3-6)

const LINES: {text: React.ReactNode; color?: string}[] = [
  {text: <>Fuser peaks of {printer.peakW} W and ≈{current.inrushA} A switch-on spikes overload a UPS.</>},
  {
    text: (
      <>
        Even {ups.ratingVA / 1000} kVA buys minutes of printing, not a working day — and shortens the UPS battery
        life.
      </>
    ),
  },
  {
    text: <>Better: small UPS for PC + network, AVR for the printer, bundle prints when power returns.</>,
    color: theme.color.ok,
  },
];

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const linesStart = at(fps, 0.4);
  const cardAt = at(fps, 2.5);
  const fadeEnd = durationInFrames - at(fps, 0.27); // fully bg for the last ~8 frames
  const fadeStart = fadeEnd - at(fps, 0.4);
  const toBg = interpolate(frame, [fadeStart, fadeEnd], [0, 1], {easing: theme.ease.inOut, ...clamp});

  const cardIn = interpolate(frame, [cardAt, cardAt + at(fps, 0.6)], [0, 1], {easing: theme.ease.out, ...clamp});
  const breathe = 1 + Math.sin(frame / 22) * 0.015;

  return (
    <AbsoluteFill>
      <BgMesh />
      <AbsoluteFill>
        <div style={{position: 'absolute', left: 96, right: 96, top: 170, display: 'flex', flexDirection: 'column', gap: 52}}>
          {LINES.map((line, i) => {
            const s = spring({
              frame: Math.max(0, frame - (linesStart + i * STAGGER)),
              fps,
              config: theme.spring.smooth,
            });
            const isGood = i === LINES.length - 1;
            return (
              <div
                key={i}
                style={{
                  display: 'flex', gap: 36, alignItems: 'baseline',
                  opacity: Math.max(0, Math.min(1, s)),
                  transform: `translateY(${(1 - s) * 26}px) scale(${0.98 + 0.02 * s})`,
                  transformOrigin: 'left center',
                }}
              >
                <span style={{fontFamily: theme.font.mono, fontSize: 28, color: theme.color.hero, minWidth: 56}}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  style={{
                    fontFamily: theme.font.display, fontSize: 46, lineHeight: 1.3, fontWeight: 500,
                    color: line.color ?? theme.color.text,
                    transform: isGood ? `scale(${breathe})` : undefined,
                    transformOrigin: 'left center',
                  }}
                >
                  {line.text}
                </span>
              </div>
            );
          })}
        </div>

        <div
          style={{
            position: 'absolute', left: 96, right: 96, bottom: 96,
            background: theme.color.panel, border: `1px solid ${theme.color.line}`, borderRadius: 12,
            padding: '22px 30px', opacity: cardIn, transform: `translateY(${(1 - cardIn) * 12}px)`,
            fontFamily: theme.font.mono, fontSize: 24, lineHeight: 1.5, color: theme.color.muted,
          }}
        >
          Sources: Ricoh M 2310N spec sheet · Prolink PRO903ES listings (6 × 12 V 9 Ah) · APC FAQ FA158934 (battery life) ·
          Vertiv &amp; Lexmark UPS guidance on laser printers. Estimates marked ≈.
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{background: theme.color.bg, opacity: toBg}} />
      <Finish />
    </AbsoluteFill>
  );
};
