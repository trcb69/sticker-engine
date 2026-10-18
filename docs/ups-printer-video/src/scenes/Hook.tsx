import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BgMesh, Finish} from '../components/Layers';
import {PrinterCutout, UpsCutout} from '../components/Cutouts';
import {stepped, wobbleCss} from '../components/stop';
import {clamp, theme} from '../theme';
import {printer} from '../facts';

// Timing in seconds, converted with fps. The scene itself is 6 s long.
const at = (fps: number, s: number) => Math.round(fps * s);

const SHADOW = 'drop-shadow(6px 6px 0 rgba(0,0,0,0.45))';

/** Stop-motion pop: the pose changes on threes, the spring overshoots, the cut-out appears on its first frame. */
const pop = (frame: number, start: number, fps: number) => {
  const local = Math.max(0, frame - start);
  const s = spring({frame: stepped(local, 3), fps, config: theme.spring.bouncy});
  return {
    visible: frame >= start ? 1 : 0,
    scale: 0.55 + 0.45 * s,
    y: 40 * (1 - s),
  };
};

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const T = {
    printer: at(fps, 0.2),
    ups: at(fps, 0.4),
    headline: at(fps, 0.6),
    heatFrom: at(fps, 1.0),
    heatTo: at(fps, 2.8),
    alarm: at(fps, 2.2),
    sub: at(fps, 3.0),
    exitEnd: durationInFrames - at(fps, 0.25),
    exitStart: durationInFrames - at(fps, 0.25) - at(fps, 0.33),
  };

  const p = pop(frame, T.printer, fps);
  const u = pop(frame, T.ups, fps);

  // Heat ramps up in steps, like a hand-moved overlay, so the glow is held between shots.
  const heatRaw = interpolate(frame, [T.heatFrom, T.heatTo], [0, 1], {easing: theme.ease.inOut, ...clamp});
  const heat = Math.floor(heatRaw * 5) / 5;

  const head = spring({frame: Math.max(0, frame - T.headline), fps, config: theme.spring.snappy});
  const headOpacity = interpolate(frame, [T.headline, T.headline + at(fps, 0.2)], [0, 1], clamp);

  const subIn = interpolate(frame, [T.sub, T.sub + at(fps, 0.4)], [0, 1], {easing: theme.ease.out, ...clamp});
  const exit = interpolate(frame, [T.exitStart, T.exitEnd], [1, 0], {easing: theme.ease.in, ...clamp});

  const breathe = 1 + Math.sin(frame / 22) * 0.015;

  return (
    <AbsoluteFill>
      <BgMesh />
      <AbsoluteFill style={{opacity: exit}}>
        <div
          style={{
            position: 'absolute', left: 96, right: 96, top: 140,
            fontFamily: theme.font.display, fontWeight: 700, fontSize: 112, lineHeight: 1.04,
            letterSpacing: '-0.015em', color: theme.color.text, whiteSpace: 'nowrap',
            opacity: headOpacity,
            transform: `translateY(${(1 - head) * 28}px) scale(${0.97 + 0.03 * head})`,
            transformOrigin: 'left top',
          }}
        >
          Can we put the {printer.name}
          <br />
          <span style={{color: theme.color.muted}}>on a </span>
          <span style={{color: theme.color.hero}}>UPS?</span>
        </div>

        <div
          style={{
            position: 'absolute', left: 0, right: 0, top: 470,
            display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 140,
          }}
        >
          <div
            style={{
              opacity: p.visible, filter: SHADOW,
              transform: `${wobbleCss(frame, 1)} translateY(${p.y}px) scale(${p.scale * breathe})`,
            }}
          >
            <PrinterCutout size={460} heat={heat} />
          </div>
          <div
            style={{
              opacity: u.visible, filter: SHADOW,
              transform: `${wobbleCss(frame, 2)} translateY(${u.y}px) scale(${u.scale * breathe})`,
            }}
          >
            <UpsCutout size={260} alarm={frame >= T.alarm} />
          </div>
        </div>

        <div
          style={{
            position: 'absolute', left: 96, right: 96, top: 940, textAlign: 'center',
            fontFamily: theme.font.display, fontSize: 44, lineHeight: 1.3, color: theme.color.text,
            opacity: subIn, transform: `translateY(${(1 - subIn) * 16}px)`,
          }}
        >
          <span style={{color: theme.color.muted}}>Short answer: </span>
          <span style={{color: theme.color.hero}}>not a good idea.</span>
          <span style={{color: theme.color.muted}}> Here's the physics.</span>
        </div>
      </AbsoluteFill>
      <Finish />
    </AbsoluteFill>
  );
};
