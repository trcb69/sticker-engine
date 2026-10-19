import React from 'react';
import {AbsoluteFill, staticFile, useCurrentFrame} from 'remotion';
import {theme} from '../theme';

/** Layer 1: slow drifting dark mesh. */
export const BgMesh: React.FC<{tint?: string}> = ({tint = theme.color.hero}) => {
  const f = useCurrentFrame();
  const a = 30 + Math.sin(f / 90) * 8;
  const b = 70 + Math.cos(f / 110) * 8;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(60% 60% at ${a}% 30%, ${tint}18, transparent 70%),
          radial-gradient(50% 50% at ${b}% 80%, #3a7bd51a, transparent 70%), ${theme.color.bg}`,
      }}
    />
  );
};

/** Layers 4–5: grade, grain and vignette. Always the top-most children of a scene. */
export const Finish: React.FC<{paper?: boolean}> = ({paper}) => {
  const f = useCurrentFrame();
  return (
    <>
      {/* warm grade: plain low-opacity tint (blend modes are slow in software rendering) */}
      <AbsoluteFill style={{background: theme.color.hero, opacity: 0.025}} />
      {/* film grain: a pre-made tile, shifted each frame */}
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile('grain.png')})`,
          backgroundPosition: `${(f * 37) % 256}px ${(f * 61) % 256}px`,
          opacity: paper ? 0.55 : 0.4,
        }}
      />
      <AbsoluteFill style={{background: 'radial-gradient(75% 75% at 50% 50%, transparent 55%, rgba(0,0,0,0.55))'}} />
    </>
  );
};

/** Small uppercase chapter label in the top-left corner. */
export const Chapter: React.FC<{n: number; label: string}> = ({n, label}) => (
  <div
    style={{
      position: 'absolute', left: 96, top: 72, fontFamily: theme.font.mono, fontSize: 24,
      letterSpacing: '0.18em', color: theme.color.muted, textTransform: 'uppercase',
    }}
  >
    <span style={{color: theme.color.hero}}>{String(n).padStart(2, '0')}</span>&nbsp;&nbsp;{label}
  </div>
);
