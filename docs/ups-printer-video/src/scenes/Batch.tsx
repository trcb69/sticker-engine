import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BgMesh, Chapter, Finish} from '../components/Layers';
import {PrinterCutout} from '../components/Cutouts';
import {hash, stepped, wobbleCss} from '../components/stop';
import {clamp, theme} from '../theme';
import {batch, batchedWh, scatteredWh} from '../facts';

const T = theme.color;
const N = batch.jobs;
const PAGES = N * batch.pagesPerJob;
const RATIO = Math.round(scatteredWh / batchedWh);
const FEWER = N - 1;

// printer placement (px) and slot position on the page
const PR = {left: 900, top: 250, size: 460};
const SLOT = {x: PR.left + 230, y: PR.top + 120};
const DOC = {w: 56, h: 72};

const FLAME = 'M0 0 C -16 -22, -5 -38, 0 -70 C 5 -38, 16 -22, 0 0 Z';

export const Batch: React.FC = () => {
  const f = useCurrentFrame();
  const {fps, durationInFrames: D} = useVideoConfig();
  const S = (s: number) => Math.round(fps * s);
  const sf = stepped(f, 3);
  const breathe = 1 + Math.sin(f / 22) * 0.015;

  const sceneOut = interpolate(f, [D - 14, D - 6], [1, 0], {...clamp, easing: theme.ease.in});
  const stageOut = interpolate(f, [S(13.0), S(13.4)], [1, 0], {...clamp, easing: theme.ease.in});
  const stageIn = spring({frame: f, fps, config: theme.spring.smooth});

  const enter = (delaySec: number) => {
    const p = spring({frame: f - S(delaySec), fps, config: theme.spring.smooth});
    return {opacity: p, transform: `translateY(${(1 - p) * 40}px) scale(${0.96 + p * 0.04})`};
  };

  // ---------- phase 1: scattered arrivals
  const arrive = Array.from({length: N}, (_, i) => S(0.5 + (6.0 * (i + 0.75 * hash(i + 3))) / N));
  const FLY = S(0.5);
  const HEAT = S(0.9);
  const P1_END = S(7.0);
  const inP1 = f < P1_END;
  const warmupsP1 = arrive.filter((a) => sf >= a).length;

  // ---------- phase 2: bundled
  const GATHER0 = S(7.3);
  const GATHER = S(1.3);
  const TOPRINTER = S(8.9);
  const INTO = S(0.7);
  const HEAT_ON = TOPRINTER + INTO; // 9.6 s
  const HEAT_DONE = S(12.4);
  const PRINT0 = S(10.1);
  const inP2 = f >= P1_END && f < S(13.0);
  const PILE = {x: 360, y: 640};

  // heat 0..1 (on threes)
  let heat = 0;
  if (inP1) {
    for (const a of arrive) {
      const d = sf - a;
      if (d >= 0 && d < HEAT) heat = Math.max(heat, Math.sin((Math.PI * d) / HEAT));
    }
  } else {
    heat = interpolate(sf, [HEAT_ON, HEAT_ON + S(0.5), HEAT_DONE, HEAT_DONE + S(0.6)], [0, 1, 1, 0], {...clamp, easing: theme.ease.out});
  }

  // energy readout
  const energy1 = warmupsP1 * batch.warmupWh + batch.printWh * (warmupsP1 / N);
  const pf = interpolate(f, [HEAT_ON, HEAT_DONE], [0, 1], {...clamp, easing: theme.ease.inOut});
  const energy2 = f >= HEAT_ON ? batch.warmupWh + batch.printWh * pf : 0;
  const warm2 = f >= HEAT_ON ? 1 : 0;
  const energy = inP1 ? energy1 : energy2;
  const warm = inP1 ? warmupsP1 : warm2;
  const statFade = interpolate(f, [P1_END - 4, P1_END + 2, P1_END + 10], [1, 0, 1], clamp);

  const shadow = 'drop-shadow(5px 5px 0 rgba(0,0,0,0.45))';

  const Doc: React.FC<{x: number; y: number; s?: number; r?: number; o?: number; seed: number; white?: boolean}> = ({x, y, s = 1, r = 0, o = 1, seed, white}) => (
    <div style={{position: 'absolute', left: x - DOC.w / 2, top: y - DOC.h / 2, width: DOC.w, height: DOC.h, opacity: o,
      background: white ? '#fff' : T.paper, border: `3px solid ${T.ink}`, boxShadow: '4px 4px 0 rgba(0,0,0,0.45)',
      transform: `${wobbleCss(f, seed, 0.6)} rotate(${r}deg) scale(${s})`}}>
      {[0, 1, 2, 3].map((k) => (
        <div key={k} style={{position: 'absolute', left: 8, right: k === 3 ? 22 : 8, top: 12 + k * 12, height: 3, background: T.ink, opacity: 0.55}} />
      ))}
    </div>
  );

  // timeline strip geometry
  const TL = {x0: 96, x1: 1824, y: 880};
  const tlX1 = (frame: number) => TL.x0 + (frame / P1_END) * (TL.x1 - TL.x0);
  const tlX2 = (frame: number) => TL.x0 + ((frame - P1_END) / (S(13.0) - P1_END)) * (TL.x1 - TL.x0);

  // phase 1 docs
  const docs1 = arrive.map((a, i) => {
    const start = a - FLY;
    if (sf < start || sf >= a) return null;
    const p = interpolate(sf, [start, a], [0, 1], {...clamp, easing: theme.ease.out});
    const x0 = 130 + hash(i * 3 + 1) * 160;
    const y0 = 300 + hash(i * 3 + 2) * 420;
    const x = x0 + (SLOT.x - x0) * p;
    const y = y0 + (SLOT.y - y0) * p - Math.sin(p * Math.PI) * 60;
    return <Doc key={i} x={x} y={y} s={1 - p * 0.45} r={(hash(i + 9) - 0.5) * 50 * (1 - p)} o={1} seed={i + 10} />;
  });

  // phase 2 docs: gather into pile, then into printer
  const docs2 = f >= P1_END && f < HEAT_ON ? Array.from({length: N}, (_, i) => {
    const st = GATHER0 + i * 3;
    const p = interpolate(sf, [st, st + GATHER * 0.45], [0, 1], {...clamp, easing: theme.ease.out});
    const x0 = 90 + hash(i * 5 + 1) * 60;
    const y0 = 260 + hash(i * 5 + 2) * 520;
    let x = x0 + (PILE.x + (hash(i + 40) - 0.5) * 8 - x0) * p;
    let y = y0 + (PILE.y - i * 3.5 - y0) * p;
    let r = (hash(i + 20) - 0.5) * 90 * (1 - p) + (hash(i + 60) - 0.5) * 3;
    let s = 1;
    let o = interpolate(sf, [st, st + 3], [0, 1], clamp);
    const q = interpolate(sf, [TOPRINTER, HEAT_ON], [0, 1], {...clamp, easing: theme.ease.inOut});
    x += (SLOT.x - PILE.x) * q;
    y += (SLOT.y - PILE.y + i * 3.5) * q - Math.sin(q * Math.PI) * 40;
    s = 1 - q * 0.45;
    if (sf >= HEAT_ON) o = 0;
    return <Doc key={i} x={x} y={y} s={s} r={r} o={o} seed={i + 70} />;
  }) : null;

  // phase 2 pages flying out into the output stack
  const STACK = {x: 700, y: 520};
  const pageCount = 24;
  const pages = inP2 ? Array.from({length: pageCount}, (_, i) => {
    const st = PRINT0 + i * 3;
    if (sf < st) return null;
    const p = interpolate(sf, [st, st + S(0.55)], [0, 1], {...clamp, easing: theme.ease.out});
    const x = SLOT.x - 40 + (STACK.x - SLOT.x + 40) * p;
    const y = SLOT.y - 40 + (STACK.y - i * 2.2 - SLOT.y + 40) * p - Math.sin(p * Math.PI) * 140;
    return <Doc key={i} x={x} y={y} s={0.9} r={(hash(i + 5) - 0.5) * 14 + p * -18} seed={i + 100} white />;
  }) : null;

  const paperOut = !inP1 && sf >= PRINT0 && sf < HEAT_DONE ? 0.5 + 0.5 * Math.sin(sf / 2) : 0;

  // phase 3 comparison bars
  const barP = interpolate(f, [S(13.5), S(15.2)], [0, 1], {...clamp, easing: theme.ease.inOut});
  const BAR_W = 900;
  const bars = [
    {name: `Scattered · ${N} warm-ups`, wh: scatteredWh, color: T.hero},
    {name: 'Bundled · 1 warm-up', wh: batchedWh, color: T.ok},
  ];

  return (
    <AbsoluteFill>
      <BgMesh />
      <AbsoluteFill style={{opacity: sceneOut, fontFamily: theme.font.display, color: T.text}}>
        <Chapter n={5} label="Batch the prints" />

        <AbsoluteFill style={{opacity: stageOut * Math.min(1, stageIn * 2)}}>
          {/* phase title */}
          <div style={{position: 'absolute', left: 96, top: 130, fontSize: 76, fontWeight: 700}}>
            {inP1 ? 'Scattered' : 'Bundled'}
          </div>
          <div style={{position: 'absolute', left: 96, top: 226, fontSize: 40, color: T.muted}}>
            {inP1 ? `${N} small jobs, sent one by one` : `${N} jobs, one bundle of ${PAGES} pages`}
          </div>

          <div style={{position: 'absolute', left: PR.left, top: PR.top, transform: `${wobbleCss(f, 3)} scale(${breathe})`, filter: shadow}}>
            <PrinterCutout size={PR.size} heat={heat} paperOut={paperOut} />
          </div>

          {docs1}
          {docs2}
          {pages}

          {/* stats */}
          <div style={{position: 'absolute', left: 1480, top: 260, width: 360, opacity: statFade}}>
            <div style={{fontSize: 40, color: T.muted}}>Warm-ups</div>
            <div style={{fontFamily: theme.font.mono, fontSize: 120, fontWeight: 700, color: warm > 0 ? T.hero : T.muted, lineHeight: 1.1}}>
              {warm}
            </div>
            <div style={{fontSize: 40, color: T.muted, marginTop: 28}}>Energy</div>
            <div style={{fontFamily: theme.font.mono, fontSize: 72, fontWeight: 600}}>
              ≈ {energy.toFixed(0)} Wh
            </div>
          </div>

          {/* timeline strip */}
          <div style={{position: 'absolute', left: TL.x0, top: TL.y + 28, width: TL.x1 - TL.x0, height: 3, background: T.line}} />
          <div style={{position: 'absolute', left: TL.x0, top: TL.y + 44, fontSize: 30, color: T.muted}}>Fuser heat cycles over time</div>
          <svg width={1920} height={1080} style={{position: 'absolute', left: 0, top: 0}}>
            {inP1 && arrive.map((a, i) => {
              const d = sf - a;
              if (d < 0) return null;
              const g = interpolate(d, [0, 6], [0, 1], {...clamp, easing: theme.ease.out});
              return <path key={i} d={FLAME} fill={T.hero} transform={`translate(${tlX1(a)} ${TL.y + 28}) scale(${0.8 * g} ${g * (0.85 + hash(i) * 0.3)})`} />;
            })}
            {inP1 && <rect x={tlX1(f) - 2} y={TL.y - 50} width={4} height={80} fill={T.muted} opacity={0.6} />}
            {!inP1 && f >= HEAT_ON && (
              <>
                <rect x={tlX2(HEAT_ON)} y={TL.y + 8} width={Math.max(0, tlX2(Math.min(sf, HEAT_DONE)) - tlX2(HEAT_ON))} height={20} fill={T.hero} opacity={0.35} />
                <path d={FLAME} fill={T.hero}
                  transform={`translate(${tlX2(HEAT_ON)} ${TL.y + 28}) scale(${0.8 * interpolate(sf - HEAT_ON, [0, 6], [0, 1], {...clamp, easing: theme.ease.out})} ${interpolate(sf - HEAT_ON, [0, 6], [0, 1], {...clamp, easing: theme.ease.out})})`} />
              </>
            )}
            {!inP1 && f < S(13.0) && <rect x={tlX2(f) - 2} y={TL.y - 50} width={4} height={80} fill={T.muted} opacity={0.6} />}
          </svg>
        </AbsoluteFill>

        {/* comparison */}
        {f >= S(13.2) && (
          <AbsoluteFill style={{padding: '0 96px'}}>
            <div style={{position: 'absolute', left: 96, top: 170, width: 1728, ...enter(13.3)}}>
              {bars.map((b, i) => (
                <div key={b.name} style={{position: 'relative', height: 140}}>
                  <div style={{fontSize: 42, color: T.text}}>{b.name}</div>
                  <div style={{position: 'absolute', top: 62, left: 0, height: 44, width: (b.wh / scatteredWh) * BAR_W * barP, background: b.color, borderRadius: 6}} />
                  <div style={{position: 'absolute', top: 44, left: (b.wh / scatteredWh) * BAR_W * barP + 24, fontSize: 64, fontWeight: 600,
                    fontFamily: theme.font.mono, color: b.color, opacity: barP}}>
                    ≈{(b.wh * barP).toFixed(0)} Wh
                  </div>
                  {i === 0 && null}
                </div>
              ))}
            </div>
            <div style={{position: 'absolute', left: 96, top: 520, width: 1700, fontSize: 96, fontWeight: 700, lineHeight: 1.1, ...enter(14.0)}}>
              Same {PAGES} pages · {RATIO}× less energy ·{' '}
              <span style={{whiteSpace: 'nowrap'}}>{FEWER} fewer heat cycles</span>
            </div>
            <div style={{position: 'absolute', left: 96, top: 820, width: 1600, fontSize: 48, color: T.muted, ...enter(14.9)}}>
              Fewer fuser heat cycles also means a longer-lasting fuser.
            </div>
          </AbsoluteFill>
        )}
      </AbsoluteFill>
      <Finish />
    </AbsoluteFill>
  );
};
