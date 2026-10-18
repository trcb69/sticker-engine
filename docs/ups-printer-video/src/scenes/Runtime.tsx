import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {BgMesh, Chapter, Finish} from '../components/Layers';
import {PrinterCutout, UpsCutout} from '../components/Cutouts';
import {stepped, wobbleCss} from '../components/stop';
import {Ups3DModel} from '../components/Ups3DModel';
import {CameraRig, CamState} from '../components/Fuser3DModel';
import {clamp, theme} from '../theme';
import {current, ups} from '../facts';

const T = theme.color;

// Model facts for the opening beat (sources in SOURCES.md).
const UPS_MODEL = ups.model;
const UPS_KG = ups.weightKg;

const deg = Math.PI / 180;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (f: number, a: number, b: number, e: (t: number) => number = theme.ease.inOut) =>
  interpolate(f, [a, b], [0, 1], {...clamp, easing: e});

// Opening layout: big UPS (size 300) centred at BIG; later shrinks to the chart-layout spot (size 200).
const BIG = {size: 300, cx: 520, cy: 560};
const SMALL = {size: 200, cx: 210, cy: 490};
// 3D canvas is a 1000 px square centred on the big cut-out so the flat camera is pixel-aligned with it.
const CV = 1000;
const FLAT_H = CV / (BIG.size / 2.5); // world units visible vertically (250 viewBox units = 2.5 world units wide)
const FLAT_DIST = 60;
const NEAR_DIST = 16;
const FLAT_FOCUS = [0, 1.94, 2.55] as const; // cut-out centre, on the front face
const BODY_FOCUS = [0, 1.94, 0] as const;
const fmtClock = (min: number) => {
  const m = Math.floor(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

export const Runtime: React.FC = () => {
  const f = useCurrentFrame();
  const {fps, durationInFrames: D} = useVideoConfig();
  const S = (s: number) => Math.round(fps * s);
  const breathe = 1 + Math.sin(f / 22) * 0.015;

  // ---- phase windows
  const sceneOut = interpolate(f, [D - 14, D - 6], [1, 0], {...clamp, easing: theme.ease.in});
  const stageOut = interpolate(f, [S(10.7), S(11.1)], [1, 0], {...clamp, easing: theme.ease.in});
  const introOut = interpolate(f, [S(3.9), S(4.2)], [1, 0], {...clamp, easing: theme.ease.in});

  // generic entrance: opacity + translateY + scale
  const enter = (delay: number, cfg = theme.spring.smooth) => {
    const p = spring({frame: f - delay, fps, config: cfg});
    return {
      opacity: interpolate(p, [0, 1], [0, 1], clamp),
      transform: `translateY(${(1 - p) * 40}px) scale(${0.96 + p * 0.04})`,
    };
  };

  // stop-motion slide-ins (on threes)
  const sf = stepped(f, 3);
  const upsP = spring({frame: sf, fps, config: theme.spring.smooth});
  const prP = spring({frame: sf - S(4.1), fps, config: theme.spring.smooth});
  const cableP = interpolate(stepped(f, 3), [S(4.9), S(5.7)], [0, 1], {...clamp, easing: theme.ease.inOut});

  // UPS opening beat: flat → 3D swing (on threes) → flat → shrinks to its chart spot
  const r = ease(sf, S(1.05), S(2.1)) * (1 - ease(sf, S(3.0), S(3.9))); // 0 flat .. 1 swung
  const vDist = FLAT_DIST * Math.pow(NEAR_DIST / FLAT_DIST, r);
  const vFov = (2 * Math.atan(mix(FLAT_H, FLAT_H, r) / (2 * vDist))) / deg;
  const cam: CamState = {
    az: 35 * deg * r, el: 8 * deg * r, dist: vDist, fov: vFov,
    focus: [0, 1.94, mix(FLAT_FOCUS[2], BODY_FOCUS[2], r)], shift: 0,
  };
  const canvasOp = ease(f, S(0.95), S(1.2), theme.ease.out) * (1 - ease(f, S(3.7), S(3.95), theme.ease.out));
  const cardOp = Math.min(1, 1 - ease(sf, S(1.05), S(1.3), theme.ease.out) + ease(sf, S(3.6), S(3.85), theme.ease.out));
  const shrink = ease(sf, S(4.0), S(4.8));
  const cx = mix(BIG.cx, SMALL.cx, shrink);
  const cy = mix(BIG.cy, SMALL.cy, shrink);
  const k = mix(1, SMALL.size / BIG.size, shrink);

  // ---- chart time (smooth data) in minutes of battery runtime
  const maxMin = ups.readyHours * 60;
  const t = interpolate(f, [S(5.8), S(10.5)], [0, maxMin], {...clamp, easing: theme.ease.inOut});
  const tStep = interpolate(sf, [S(5.8), S(10.5)], [0, maxMin], {...clamp, easing: theme.ease.inOut});
  const charge = Math.max(0, 1 - tStep / maxMin);
  const chartIn = f >= S(5.2);

  const rows = [
    {name: 'Printing nonstop', min: ups.printingMin, label: `≈${ups.printingMin} min`, color: T.hero},
    {name: 'Idle (ready)', min: ups.readyHours * 60, label: `≈${ups.readyHours} h`, color: 'rgba(237,239,242,0.8)'},
    {name: 'Realistic office mix', min: ups.mixedHours * 60, label: `≈${ups.mixedHours} h`, color: 'rgba(237,239,242,0.8)'},
  ];
  const BAR_W = 640;
  const footnote = `${ups.batteries} = ${ups.batteryWh} Wh nominal · estimated from lead-acid discharge rate and online-inverter losses`;

  const cardShadow = {filter: 'drop-shadow(6px 6px 0 rgba(0,0,0,0.45))'};
  const stmt = (delay: number) => {
    const p = spring({frame: f - S(delay), fps, config: theme.spring.smooth});
    return {opacity: p, transform: `translateY(${(1 - p) * 40}px) scale(${0.96 + p * 0.04})`};
  };

  return (
    <AbsoluteFill>
      <BgMesh />
      <AbsoluteFill style={{opacity: sceneOut, fontFamily: theme.font.display, color: T.text}}>
        <Chapter n={4} label="Even with a 3 kVA UPS" />

        {/* stage: cut-outs, cable, chart */}
        <AbsoluteFill style={{opacity: stageOut}}>
          {/* 3D PRO903ES (hand-off from / to the flat cut-out, pixel-aligned) */}
          {canvasOp > 0.001 && (
            <div style={{position: 'absolute', left: BIG.cx - CV / 2, top: BIG.cy - CV / 2, width: CV, height: CV, opacity: canvasOp}}>
              <ThreeCanvas width={CV} height={CV} flat frameloop="never" dpr={1}
                camera={{fov: 8, near: 0.1, far: 400, position: [0, 1.94, 60]}}>
                <Ups3DModel charge={1} label="3 kVA" />
                <CameraRig cam={cam} />
              </ThreeCanvas>
            </div>
          )}
          {/* flat cut-out */}
          <div style={{position: 'absolute', left: cx - BIG.size / 2 + (1 - upsP) * -760, top: cy - (BIG.size * 1.6) / 2,
            opacity: Math.min(1, upsP * 3) * cardOp, transformOrigin: 'center',
            transform: `${wobbleCss(f, 1)} scale(${k * (f > S(4.8) ? breathe : 1)})`, ...cardShadow}}>
            <UpsCutout size={BIG.size} charge={f < S(5.8) ? 1 : charge} label="3 kVA" alarm={charge < 0.25 && f > S(5.8)} />
          </div>
          <div style={{position: 'absolute', left: 400 + (1 - prP) * 520, top: 440, opacity: Math.min(1, prP * 3),
            transform: `${wobbleCss(f, 2)} scale(${breathe})`, ...cardShadow}}>
            <PrinterCutout size={330} />
          </div>
          {/* paper cable, drawn on */}
          <svg width={900} height={1080} style={{position: 'absolute', left: 0, top: 0, opacity: cableP > 0 ? 1 : 0}}>
            <path d="M296 628 C 330 720, 390 720, 420 640" fill="none" stroke={T.ink} strokeWidth={14}
              strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - cableP} />
            <path d="M296 628 C 330 720, 390 720, 420 640" fill="none" stroke={T.paper} strokeWidth={7}
              strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - cableP} />
          </svg>

          {/* intro text */}
          {f < S(4.3) && (
            <div style={{position: 'absolute', left: 900, top: 600, width: 920, opacity: introOut * enter(S(1.7)).opacity,
              transform: enter(S(1.7)).transform}}>
              <div style={{fontSize: 52, fontWeight: 600}}>A {UPS_KG} kg box of batteries</div>
              <div style={{fontSize: 32, fontFamily: theme.font.mono, color: T.muted, marginTop: 18}}>
                {UPS_MODEL} · {ups.ratingVA / 1000} kVA / {ups.ratingW} W · {UPS_KG} kg
              </div>
            </div>
          )}
          {f < S(4.3) && (
            <div style={{position: 'absolute', left: 900, top: 300, width: 920, fontSize: 92, fontWeight: 600, lineHeight: 1.1,
              opacity: introOut * (enter(S(0.8)).opacity), transform: enter(S(0.8)).transform}}>
              A 3 kVA UPS holds <span style={{color: T.hero}}>{ups.batteryWh} Wh</span> of battery
            </div>
          )}

          {/* chart */}
          {chartIn && (
            <div style={{position: 'absolute', left: 860, top: 190, width: 964, ...enter(S(5.2))}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <div style={{fontSize: 44, color: T.muted}}>Runtime on battery (new batteries)</div>
                <div style={{fontFamily: theme.font.mono, fontSize: 64, color: T.text}}>{fmtClock(t)}</div>
              </div>
              <div style={{height: 2, background: T.line, marginTop: 22}} />
              {rows.map((r, i) => {
                const w = (Math.min(t, r.min) / maxMin) * BAR_W;
                const done = t >= r.min - 0.01;
                return (
                  <div key={r.name} style={{position: 'relative', height: 150, marginTop: i === 0 ? 40 : 0}}>
                    <div style={{fontSize: 42, color: T.text}}>{r.name}</div>
                    <div style={{position: 'absolute', top: 66, left: 0, height: 44, width: Math.max(w, 0), background: r.color, borderRadius: 6}} />
                    <div style={{position: 'absolute', top: 52, left: Math.max(w, 0) + 22, fontSize: 64, fontWeight: 600,
                      fontFamily: theme.font.mono, color: r.color === T.hero ? T.hero : T.text,
                      opacity: done ? 1 : 0}}>
                      {r.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {chartIn && (
            <div style={{position: 'absolute', left: 96, right: 96, top: 930, fontSize: 30, color: T.muted, ...enter(S(5.8))}}>
              {UPS_MODEL}: {footnote}
            </div>
          )}
        </AbsoluteFill>

        {/* statement */}
        {f >= S(11.0) && (
          <AbsoluteFill style={{justifyContent: 'center', padding: '0 96px'}}>
            <div style={{fontSize: 118, fontWeight: 700, lineHeight: 1.08, maxWidth: 1600, ...stmt(11.1)}}>
              Minutes to a couple of hours — not a working day.
            </div>
            <div style={{fontSize: 56, color: T.muted, marginTop: 56, maxWidth: 1500, lineHeight: 1.25, ...stmt(12.6)}}>
              And every warm-up spike can trip the UPS into overload (<span style={{color: T.hero}}>≈{current.inrushA} A</span> inrush vs a {ups.ratingW} W inverter).
            </div>
          </AbsoluteFill>
        )}
      </AbsoluteFill>
      <Finish />
    </AbsoluteFill>
  );
};
