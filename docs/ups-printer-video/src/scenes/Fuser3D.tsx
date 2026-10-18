import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {BgMesh, Chapter, Finish} from '../components/Layers';
import {PrinterCutout} from '../components/Cutouts';
import {stepped, wobbleCss} from '../components/stop';
import {CameraRig, CamState, PrinterModel} from '../components/Fuser3DModel';
import {clamp, theme} from '../theme';
import {current, printer} from '../facts';

// 03 "Inside the printer": flat cut-out → 3D paper model → fuser close-up → back to the flat card.

const W = 1920;
const H = 1080;
const CUT = 700; // cut-out width in px → 140 px per world unit (viewBox 500 wide = 5 units)
const FLAT_H = H / (CUT / 5); // world height visible when the 3D view matches the cut-out
const FLAT_DIST = 60;
const NEAR_DIST = 9;
const WIDE_FOV = 42;
const NEAR_H = 2 * NEAR_DIST * Math.tan((WIDE_FOV / 2) * (Math.PI / 180));
const deg = Math.PI / 180;

const ease = (f: number, a: number, b: number, e: (t: number) => number = theme.ease.inOut) =>
  interpolate(f, [a, b], [0, 1], {...clamp, easing: e});
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [
  mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t),
];

export const Fuser3D: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames: D} = useVideoConfig();
  const s = (sec: number) => Math.round(fps * sec);
  const sf = stepped(frame, 3);

  // ── timeline (seconds → frames)
  const T = {
    capIn: s(0.25), capOut: s(2.2),
    reveal0: s(2.5), reveal1: s(4.6), // flat → 3D (dolly-zoom + swing)
    lidUp0: s(4.6), lidUp1: s(6.1),
    dolly0: s(5.4), dolly1: s(7.9), // move in to the fuser
    heat0: s(5.8), heat1: s(10),
    label0: s(6.0), labelGap: s(0.6), labelOut: s(10.8),
    back0: s(11), back1: s(12.5), // pull back out
    lidDn0: s(11), lidDn1: s(12.2),
    flat0: s(12.4), flat1: s(14.2), // 3D → flat
    lineIn: s(14.5),
    exit: D - s(0.3) - 10, // everything gone ~8 frames before the end
  };

  // ── camera: flat → reveal (dolly-zoom keeps size) → dolly in → back → flatten
  const flatFocus = [0, 1.7, 1.5] as const; // centre of the cut-out, on the front face
  const bodyFocus = [0, 1.5, 0] as const;
  const fuserFocus = [0, 1.2, 0] as const;
  const r = ease(frame, T.reveal0, T.reveal1) * (1 - ease(frame, T.flat0, T.flat1)); // 0 flat .. 1 3D
  const din = ease(frame, T.dolly0, T.dolly1) * (1 - ease(frame, T.back0, T.back1)); // 0 body .. 1 fuser
  const vertigoDist = FLAT_DIST * Math.pow(NEAR_DIST / FLAT_DIST, r);
  const visH = mix(FLAT_H, NEAR_H, r);
  const vertigoFov = (2 * Math.atan(visH / (2 * vertigoDist))) / deg;
  const cam: CamState = {
    az: mix(0, 35 * deg, r) + mix(0, -7 * deg, din),
    el: mix(0, 12 * deg, r) + mix(0, 14 * deg, din),
    dist: mix(vertigoDist, 6.6, din),
    fov: vertigoFov,
    focus: mix3(mix3(flatFocus, bodyFocus, r), fuserFocus, din),
    shift: mix(0, 1.75, din),
  };

  // ── model state (lid on threes = stop-motion; heat smooth = data)
  const lid = ease(sf, T.lidUp0, T.lidUp1, theme.ease.out) * (1 - ease(sf, T.lidDn0, T.lidDn1, theme.ease.out));
  const see = ease(frame, T.lidUp0 + s(0.4), T.lidUp1 + s(0.3)) * (1 - ease(frame, T.back0, T.back1 - s(0.2)));
  const heat = ease(frame, T.heat0, T.heat1);
  const model = {bodyOpacity: mix(1, 0.12, see), lid, heat, paperRun: see};

  // ── cross-fades between the flat card and the 3D canvas
  const canvasOp =
    interpolate(frame, [T.reveal0 - s(0.1), T.reveal0 + s(0.8)], [0, 1], {...clamp, easing: theme.ease.out}) *
    interpolate(frame, [T.flat1 - s(0.5), T.flat1 + s(0.3)], [1, 0], {...clamp, easing: theme.ease.inOut});
  const cutOp =
    interpolate(sf, [T.reveal0 + s(0.1), T.reveal0 + s(1.0)], [1, 0], {...clamp, easing: theme.ease.in}) +
    interpolate(sf, [T.flat1 - s(0.6), T.flat1], [0, 1], {...clamp, easing: theme.ease.out});
  const cardTilt = (35 * ease(sf, T.reveal0, T.reveal1)) * (1 - ease(sf, T.flat0, T.flat1)); // on threes
  const cutHeat = frame < T.back0 ? 0 : 1;
  const exitT = ease(frame, T.exit, T.exit + 10, theme.ease.in);
  const breathe = frame >= T.lineIn ? 1 + Math.sin(frame / 22) * 0.015 : 1;

  // ── text
  const enter = (start: number) => spring({frame: frame - start, fps, config: theme.spring.snappy});
  const capIn = enter(T.capIn);
  const capOut = ease(frame, T.capOut, T.capOut + 10, theme.ease.in);
  const lineIn = enter(T.lineIn);

  const fmt = (n: number) => n.toLocaleString('en-US');
  const labels: {pre?: string; big: React.ReactNode; post?: string}[] = [
    {pre: 'Fuser heater', big: <>up to <Hot>{fmt(printer.peakW)} W</Hot></>},
    {pre: 'Warm-up from cold', big: <><Hot>{printer.warmupS} s</Hot> at full power</>},
    {pre: 'Hot enough to melt toner', big: <Hot>≈ 180 °C</Hot>, post: 'into the paper'},
    {pre: 'Cold heater = low resistance →', big: <>inrush up to <Hot>≈ {current.inrushA} A</Hot></>, post: 'for a few milliseconds'},
  ];
  const scrimOp = ease(frame, T.label0 - s(0.3), T.label0 + s(0.3)) * (1 - ease(frame, T.labelOut, T.labelOut + s(0.6)));

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <BgMesh />

      {/* 3D printer */}
      {canvasOp * (1 - exitT) > 0.001 && (
        <AbsoluteFill style={{opacity: canvasOp * (1 - exitT)}}>
          <ThreeCanvas width={W} height={H} flat frameloop="never" dpr={1}
            camera={{fov: 7, near: 0.1, far: 400, position: [0, 1.7, 61.5]}}>
            <PrinterModel state={model} />
            <CameraRig cam={cam} />
          </ThreeCanvas>
        </AbsoluteFill>
      )}

      {/* flat stop-motion card, tilted in CSS 3D during the hand-off */}
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', perspective: 1800, opacity: Math.min(1, cutOp) * (1 - exitT)}}>
        <div
          style={{
            transform: `${wobbleCss(frame, 3)} rotateY(${-cardTilt}deg) scale(${breathe * (1 - exitT * 0.08)})`,
            filter: 'drop-shadow(6px 6px 0 rgba(0,0,0,0.45))',
          }}
        >
          <PrinterCutout size={CUT} heat={cutHeat} />
        </div>
      </AbsoluteFill>

      {/* label scrim + labels (HTML overlay, not in the canvas) */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(90deg, ${theme.color.bg}EE 0%, ${theme.color.bg}C0 38%, transparent 58%)`,
          opacity: scrimOp,
        }}
      />
      <div style={{position: 'absolute', left: 96, top: 200, width: 820, display: 'flex', flexDirection: 'column', gap: 40}}>
        {labels.map((l, i) => {
          const inn = enter(T.label0 + i * T.labelGap);
          const out = ease(frame, T.labelOut + i * 3, T.labelOut + i * 3 + 10, theme.ease.in);
          return (
            <div
              key={i}
              style={{
                opacity: Math.min(1, inn) * (1 - out),
                transform: `translateY(${(1 - inn) * 30 - out * 12}px) scale(${0.94 + 0.06 * inn})`,
                transformOrigin: 'left center',
                borderLeft: `6px solid ${theme.color.hero}`,
                paddingLeft: 28,
              }}
            >
              {l.pre && <div style={small}>{l.pre}</div>}
              <div style={{fontFamily: theme.font.display, fontSize: 62, fontWeight: 600, color: theme.color.text, lineHeight: 1.15}}>
                {l.big}
              </div>
              {l.post && <div style={small}>{l.post}</div>}
            </div>
          );
        })}
      </div>

      {/* captions under the card */}
      <Caption op={Math.min(1, capIn) * (1 - capOut)} y={(1 - capIn) * 30 - capOut * 12} scale={0.94 + 0.06 * capIn}>
        What's inside?
      </Caption>
      <Caption op={Math.min(1, lineIn) * (1 - exitT)} y={(1 - lineIn) * 30 - exitT * 12} scale={0.94 + 0.06 * lineIn}>
        Every wake-up = <Hot>re-heat from cold.</Hot>
      </Caption>

      <div style={{opacity: ease(frame, 0, s(0.5), theme.ease.out) * (1 - exitT)}}>
        <Chapter n={3} label="Inside the printer" />
      </div>

      <Finish paper />
    </AbsoluteFill>
  );
};

const small: React.CSSProperties = {fontFamily: theme.font.display, fontSize: 40, color: theme.color.muted, lineHeight: 1.15};

const Hot: React.FC<{children: React.ReactNode}> = ({children}) => <span style={{color: theme.color.hero}}>{children}</span>;

const Caption: React.FC<{op: number; y: number; scale: number; children: React.ReactNode}> = ({op, y, scale, children}) => (
  <div
    style={{
      position: 'absolute', top: 880, left: 0, right: 0, textAlign: 'center', fontFamily: theme.font.display,
      fontSize: 84, fontWeight: 600, color: theme.color.text, opacity: op, letterSpacing: '-0.01em',
      transform: `translateY(${y}px) scale(${scale})`,
    }}
  >
    {children}
  </div>
);
