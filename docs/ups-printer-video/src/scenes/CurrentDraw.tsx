import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BgMesh, Chapter, Finish} from '../components/Layers';
import {PrinterCutout} from '../components/Cutouts';
import {stepped, wobble, wobbleCss} from '../components/stop';
import {clamp, theme} from '../theme';
import {current, printer} from '../facts';

// ---------------------------------------------------------------- power profile (chart time, seconds)
const SLEEP_END = 3; // job arrives
const WARM1_END = SLEEP_END + printer.warmupS;
const PRINT1_END = WARM1_END + 8;
const READY1_END = PRINT1_END + 6;
const SLEEP2_END = READY1_END + 4; // second job arrives
const WARM2_END = SLEEP2_END + printer.warmupS;
const PRINT2_END = WARM2_END + 6;
const DOMAIN = 60;
const TRANS = 0.7;

const LEVELS: {t: number; w: number; name: string}[] = [
  {t: 0, w: printer.sleepW, name: 'Sleep'},
  {t: SLEEP_END, w: printer.peakW, name: 'Warm-up'},
  {t: WARM1_END, w: printer.printingW, name: 'Printing'},
  {t: PRINT1_END, w: printer.readyW, name: 'Ready'},
  {t: READY1_END, w: printer.sleepW, name: 'Sleep'},
  {t: SLEEP2_END, w: printer.peakW, name: 'Warm-up'},
  {t: WARM2_END, w: printer.printingW, name: 'Printing'},
  {t: PRINT2_END, w: printer.readyW, name: 'Ready'},
];
const smooth = (x: number) => x * x * (3 - 2 * x);
const levelIndex = (t: number) => {
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (t >= LEVELS[k].t) i = k;
  return i;
};
const watts = (t: number) => {
  const i = levelIndex(t);
  if (i === 0) return LEVELS[0].w;
  const x = Math.min(1, (t - LEVELS[i].t) / TRANS);
  return LEVELS[i - 1].w + (LEVELS[i].w - LEVELS[i - 1].w) * smooth(x);
};
const amps = (w: number) => w / printer.volts;

// ---------------------------------------------------------------- chart geometry (panel-local px)
const PANEL = {x: 96, y: 200, w: 1194, h: 780};
const PL = 100;
const PR = 1130;
const Y_BASE = 660;
const Y_1600 = 150;
const X = (t: number) => PL + (t / DOMAIN) * (PR - PL);
const Y = (w: number) => Y_BASE - (w / 1600) * (Y_BASE - Y_1600);
const Y_OFF = 106; // dashed "off the chart" marker

const pathFrom = (t0: number, t1: number) => {
  let d = '';
  for (let t = t0; t <= t1 + 1e-6; t += 0.1) d += `${d ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(watts(t)).toFixed(1)}`;
  return d;
};
const FULL = pathFrom(0, DOMAIN);
const HERO_PATHS = [
  pathFrom(SLEEP_END - 0.05, WARM1_END + TRANS),
  pathFrom(SLEEP2_END - 0.05, WARM2_END + TRANS),
];
const heroArea = (d: string, t0: number, t1: number) => `${d}L${X(t1).toFixed(1)} ${Y_BASE}L${X(t0).toFixed(1)} ${Y_BASE}Z`;

// ---------------------------------------------------------------- dial geometry
const DIAL = {cx: 226, cy: 255, r: 200, maxA: 8, span: 70};
const dialAngle = (a: number) => -DIAL.span + (Math.min(a, DIAL.maxA + 0.4) / DIAL.maxA) * 2 * DIAL.span;
const dialPt = (deg: number, r: number) => {
  const rad = (deg * Math.PI) / 180;
  return {x: DIAL.cx + r * Math.sin(rad), y: DIAL.cy - r * Math.cos(rad)};
};
const arc = (a0: number, a1: number, r: number) => {
  const p0 = dialPt(dialAngle(a0), r);
  const p1 = dialPt(dialAngle(a1), r);
  return `M${p0.x} ${p0.y}A${r} ${r} 0 0 1 ${p1.x} ${p1.y}`;
};

const paperCard = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: theme.color.paper,
  color: theme.color.ink,
  border: `5px solid ${theme.color.ink}`,
  borderRadius: 14,
  boxShadow: '6px 6px 0 rgba(0,0,0,0.45)',
  ...extra,
});

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  background: theme.color.panel,
  border: `2px solid ${theme.color.line}`,
  borderRadius: 24,
};

export const CurrentDraw: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const T = (sec: number) => Math.round(fps * sec);

  // scene timing (frames)
  const SPEC_OUT = T(2.75);
  const PANEL_IN = T(3);
  const CH_START = T(3.5);
  const CH_END = T(11.5);
  const CHART_OUT = T(11.6);
  const SUM_IN = T(12);
  const SUM_OUT = durationInFrames - T(0.75);
  const OUT_LEN = 10;

  const ent = (start: number, cfg: typeof theme.spring[keyof typeof theme.spring] = theme.spring.snappy, snap = false) =>
    spring({frame: (snap ? stepped(frame - start, 3) : frame - start), fps, config: cfg});
  const exitK = (start: number, len = OUT_LEN) =>
    interpolate(frame, [start, start + len], [0, 1], {easing: theme.ease.in, ...clamp});
  const appear = (p: number, ex = 0, rise = 60): React.CSSProperties => ({
    opacity: Math.max(0, Math.min(1, p)) * (1 - ex),
    transform: `translateY(${(1 - p) * rise + ex * 40}px) scale(${0.94 + 0.06 * Math.min(p, 1.05)})`,
  });

  // playhead time as a function of frame: smooth, mostly even pace with a soft start/end
  const tAt = (f: number) => {
    const raw = interpolate(f, [CH_START, CH_END], [0, 1], clamp);
    const eased = interpolate(f, [CH_START, CH_END], [0, 1], {easing: theme.ease.inOut, ...clamp});
    return (0.55 * raw + 0.45 * eased) * DOMAIN;
  };
  let inrushF = CH_START;
  while (inrushF < CH_END && tAt(inrushF) < SLEEP_END) inrushF++;
  let inrush2F = inrushF;
  while (inrush2F < CH_END && tAt(inrush2F) < SLEEP2_END) inrush2F++;

  const playT = tAt(frame);
  const W = watts(playT);
  const A = amps(W);
  const lvl = LEVELS[levelIndex(playT)];

  // ------------------------------------------------ section visibilities
  const specEx = exitK(SPEC_OUT);
  const chartIn = ent(PANEL_IN, theme.spring.smooth);
  const chartEx = exitK(CHART_OUT);
  const sumEx = exitK(SUM_OUT);

  // ------------------------------------------------ spec cut-outs (on threes)
  const strip = (i: number, delay: number, rot: number, content: React.ReactNode, extra: React.CSSProperties = {}) => {
    const p = ent(delay, theme.spring.bouncy, true);
    const exS = stepped(frame, 3) >= SPEC_OUT ? specEx : 0;
    const ap = appear(p, exS, 80);
    return (
      <div
        key={i}
        style={{
          ...paperCard({padding: '14px 36px', ...extra}),
          opacity: ap.opacity,
          transform: `${ap.transform} rotate(${rot}deg) ${wobbleCss(frame, 10 + i, 1.2)}`,
          transformOrigin: 'left center',
        }}
      >
        {content}
      </div>
    );
  };

  const printerP = ent(6, theme.spring.bouncy, true);
  const printerAp = appear(printerP, specEx, 80);
  const heat = interpolate(frame, [T(1.2), T(2.6)], [0, 0.9], {easing: theme.ease.out, ...clamp});
  const noteP = ent(T(0.9), theme.spring.bouncy, true);
  const noteAp = appear(noteP, specEx, 60);

  // ------------------------------------------------ chart
  const playX = X(playT);
  const chartPanelStyle = appear(chartIn, chartEx, 50);

  const zap = (since: number) => interpolate(frame, [since, since + 6], [0, 1], {easing: theme.ease.out, ...clamp});
  const zap1 = frame >= inrushF ? zap(inrushF) : 0;
  const zap2 = frame >= inrush2F ? zap(inrush2F) : 0;
  const calloutLen = T(2.8);
  const calloutP = ent(inrushF, theme.spring.bouncy, true);
  const calloutEx = exitK(inrushF + calloutLen);
  const flash = frame >= inrushF && frame < inrushF + 8 ? (Math.floor((frame - inrushF) / 2) % 2 === 0 ? 1 : 0.35) : 1;
  const lineDim = interpolate(frame, [inrushF + calloutLen, inrushF + calloutLen + 12], [1, 0.45], {easing: theme.ease.out, ...clamp});
  const showCallout = frame >= inrushF && calloutEx < 1;

  // ------------------------------------------------ ammeter
  const sFrame = stepped(frame, 3);
  const pegged = sFrame >= inrushF && sFrame < inrushF + 9;
  const needleA = pegged ? DIAL.maxA + 0.4 : amps(watts(tAt(sFrame)));
  const nw = wobble(frame, 7, 1.2);
  const needleDeg = dialAngle(needleA) + nw.r * 1.5;
  const readoutHot = A > 3.5;

  // ------------------------------------------------ summary
  const rows = [
    {label: 'Ready', val: current.readyA, dec: 2, prefix: '', hot: false, off: false},
    {label: 'Printing', val: current.printingA, dec: 1, prefix: '', hot: false, off: false},
    {label: 'Warm-up', val: current.peakA, dec: 1, prefix: '', hot: true, off: false},
    {label: 'Switch-on', val: current.inrushA, dec: 0, prefix: '≈ ', hot: true, off: true},
  ];
  const BAR_W = 760;

  return (
    <AbsoluteFill>
      <BgMesh />

      <div style={{opacity: 1 - sumEx}}>
        <Chapter n={2} label="Current draw" />
      </div>

      {/* ------------------------------------------------ 0-3 s: spec cut-outs */}
      {frame < SPEC_OUT + OUT_LEN + 2 && (
        <AbsoluteFill style={{fontFamily: theme.font.display, color: theme.color.text}}>
          <div style={{position: 'absolute', left: 130, top: 230, display: 'flex', flexDirection: 'column', gap: 26, alignItems: 'flex-start'}}>
            {strip(0, 0, -1.5, <span style={{fontSize: 118, fontWeight: 700, letterSpacing: '-0.02em'}}>{printer.name}</span>)}
            {strip(1, 4, 1, <span style={{fontSize: 64, fontWeight: 500}}>{printer.kind}</span>)}
            <div style={{display: 'flex', gap: 28}}>
              {strip(2, 8, -1, <span style={{fontSize: 76, fontWeight: 700}}>{printer.weightKg} kg</span>)}
              {strip(3, 12, 1.5, <span style={{fontSize: 76, fontWeight: 700}}>{printer.volts} V</span>)}
            </div>
          </div>
          <div
            style={{
              position: 'absolute', left: 1130, top: 250, ...printerAp,
              transform: `${printerAp.transform} scale(${1 + Math.sin(frame / 22) * 0.015}) ${wobbleCss(frame, 20, 1.5)}`,
            }}
          >
            <PrinterCutout size={640} heat={heat} paperOut={0.5 + 0.5 * Math.sin(stepped(frame, 3) / 9)} />
          </div>
          <div
            style={{
              position: 'absolute', left: 130, top: 790,
              ...paperCard({padding: '14px 32px', borderBottom: `5px solid ${theme.color.ink}`}),
              opacity: noteAp.opacity,
              transform: `${noteAp.transform} rotate(-2deg) ${wobbleCss(frame, 30, 1.2)}`,
              fontSize: 48, fontWeight: 600,
            }}
          >
            heavy = big <span style={{color: theme.color.hero}}>fuser</span> = big current
          </div>
        </AbsoluteFill>
      )}

      {/* ------------------------------------------------ 3-12 s: chart + ammeter */}
      {frame >= PANEL_IN - 2 && frame < CHART_OUT + OUT_LEN + 2 && (
        <AbsoluteFill style={{fontFamily: theme.font.display, color: theme.color.text}}>
          <div
            style={{
              position: 'absolute', left: 96, top: 104, fontSize: 64, fontWeight: 700,
              opacity: chartPanelStyle.opacity, transform: chartPanelStyle.transform,
            }}
          >
            A print day, in watts
          </div>

          <div style={{...panelStyle, left: PANEL.x, top: PANEL.y, width: PANEL.w, height: PANEL.h, ...chartPanelStyle}}>
            <svg width={PANEL.w} height={PANEL.h} style={{position: 'absolute', left: 0, top: 0}}>
              <defs>
                <clipPath id="cd-progress">
                  <rect x={PL - 4} y={0} width={Math.max(0, playX - PL + 4)} height={PANEL.h} />
                </clipPath>
              </defs>
              {/* grid + axes */}
              {[0, 500, 1000, 1500].map((w) => (
                <g key={w}>
                  <line x1={PL} x2={PR} y1={Y(w)} y2={Y(w)} stroke={theme.color.line} strokeWidth={w === 0 ? 3 : 1.5} strokeDasharray={w === 0 ? undefined : '4 8'} />
                  <text x={PL - 16} y={Y(w) + 9} textAnchor="end" fontFamily={theme.font.mono} fontSize={26} fill={theme.color.muted}>
                    {w.toLocaleString('en-US')}
                  </text>
                </g>
              ))}
              <text x={PL - 16} y={Y_1600 - 34} textAnchor="end" fontFamily={theme.font.mono} fontSize={26} fill={theme.color.muted}>W</text>
              {[0, 10, 20, 30, 40, 50, 60].map((t) => (
                <text key={t} x={X(t)} y={Y_BASE + 44} textAnchor="middle" fontFamily={theme.font.mono} fontSize={26} fill={theme.color.muted}>
                  {t}
                </text>
              ))}
              <text x={PR} y={Y_BASE + 84} textAnchor="end" fontFamily={theme.font.mono} fontSize={26} fill={theme.color.muted}>time, seconds</text>

              {/* data, revealed left to right */}
              <g clipPath="url(#cd-progress)">
                <path d={heroArea(HERO_PATHS[0], SLEEP_END - 0.05, WARM1_END + TRANS)} fill={theme.color.hero} opacity={0.16} />
                <path d={heroArea(HERO_PATHS[1], SLEEP2_END - 0.05, WARM2_END + TRANS)} fill={theme.color.hero} opacity={0.16} />
                <path d={FULL} fill="none" stroke={theme.color.text} strokeWidth={4} strokeLinejoin="round" />
                {HERO_PATHS.map((d, i) => (
                  <path key={i} d={d} fill="none" stroke={theme.color.hero} strokeWidth={6} strokeLinejoin="round" />
                ))}
              </g>
              {/* warm-up labels: whole, faded in once the playhead has passed them (never half-clipped) */}
              {[SLEEP_END, SLEEP2_END].map((t0) => {
                const o = interpolate(playX, [X(t0) + 160, X(t0) + 200], [0, 1], {...clamp, easing: theme.ease.out});
                return (
                  <g key={t0} fontFamily={theme.font.mono} fontSize={30} fill={theme.color.text} opacity={o}>
                    <text x={X(t0) + 22} y={Y(1500) + 70}>{printer.peakW.toLocaleString('en-US')} W</text>
                    <text x={X(t0) + 22} y={Y(1500) + 108} fill={theme.color.muted}>for {printer.warmupS} s</text>
                  </g>
                );
              })}

              {/* inrush spikes: far taller than the chart, clipped by the dashed marker */}
              {[
                {x: X(SLEEP_END), k: zap1, o: lineDim},
                {x: X(SLEEP2_END), k: zap2, o: 0.45},
              ].map((s, i) =>
                s.k > 0 ? (
                  <g key={i} opacity={s.o}>
                    <line x1={s.x} x2={s.x} y1={Y_BASE} y2={Y_BASE - (Y_BASE - Y_OFF) * s.k} stroke={theme.color.hero} strokeWidth={5} strokeLinecap="round" />
                    {s.k > 0.95 && (
                      <>
                        <line x1={s.x - 44} x2={s.x + 44} y1={Y_OFF} y2={Y_OFF} stroke={theme.color.hero} strokeWidth={3} strokeDasharray="10 8" />
                        <path d={`M${s.x - 11} ${Y_OFF - 8}L${s.x} ${Y_OFF - 26}L${s.x + 11} ${Y_OFF - 8}Z`} fill={theme.color.hero} />
                      </>
                    )}
                  </g>
                ) : null
              )}
              {zap1 > 0.95 && (
                <text x={X(SLEEP_END) + 56} y={Y_OFF + 9} fontFamily={theme.font.mono} fontSize={26} fill={theme.color.muted} opacity={lineDim}>
                  off the chart
                </text>
              )}

              {/* playhead */}
              {frame >= CH_START - 6 && frame <= CH_END + 8 && (
                <g>
                  <line x1={playX} x2={playX} y1={Y_1600 - 10} y2={Y_BASE} stroke={theme.color.text} strokeWidth={2} opacity={0.55} />
                  <circle cx={playX} cy={Y(W)} r={10} fill={W > 1000 ? theme.color.hero : theme.color.text} stroke={theme.color.bg} strokeWidth={3} />
                </g>
              )}
            </svg>

            {showCallout && (
              <div
                style={{
                  position: 'absolute', left: X(SLEEP_END) + 40, top: 2,
                  ...paperCard({padding: '8px 22px', background: theme.color.hero, borderRadius: 10}),
                  fontSize: 40, fontWeight: 700, whiteSpace: 'nowrap',
                  opacity: Math.min(1, calloutP) * (1 - calloutEx) * flash,
                  transform: `scale(${0.85 + 0.15 * Math.min(calloutP, 1.1)}) rotate(-2deg) ${wobbleCss(frame, 41, 1)}`,
                  transformOrigin: 'left center',
                }}
              >
                Inrush ≈ {current.inrushA} A for a few ms
              </div>
            )}
          </div>

          {/* ammeter */}
          <div
            style={{
              ...panelStyle, left: 1324, top: PANEL.y, width: 500, height: PANEL.h,
              ...appear(ent(PANEL_IN + 5, theme.spring.smooth), chartEx, 50),
              padding: 24, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 22,
            }}
          >
            <div style={{...paperCard({padding: 8}), transform: wobbleCss(frame, 3, 0.8)}}>
              <svg width={440} height={290} viewBox="0 0 452 300" style={{display: 'block'}}>
                <path d={arc(0, DIAL.maxA, 178)} fill="none" stroke={theme.color.ink} strokeWidth={3} />
                <path d={arc(6, DIAL.maxA, 178)} fill="none" stroke={theme.color.hero} strokeWidth={12} />
                {Array.from({length: 9}, (_, a) => {
                  const d = dialAngle(a);
                  const major = a % 2 === 0;
                  const p0 = dialPt(d, major ? 150 : 160);
                  const p1 = dialPt(d, 178);
                  const lp = dialPt(d, 122);
                  return (
                    <g key={a}>
                      <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={theme.color.ink} strokeWidth={major ? 5 : 3} />
                      {major && (
                        <text x={lp.x} y={lp.y + 11} textAnchor="middle" fontFamily={theme.font.mono} fontSize={32} fontWeight={700} fill={theme.color.ink}>
                          {a}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text x={DIAL.cx} y={DIAL.cy - 62} textAnchor="middle" fontFamily={theme.font.mono} fontSize={28} fontWeight={700} fill={theme.color.ink}>AMPS</text>
                <g transform={`rotate(${needleDeg} ${DIAL.cx} ${DIAL.cy})`}>
                  <polygon points={`${DIAL.cx - 7},${DIAL.cy} ${DIAL.cx},${DIAL.cy - 188} ${DIAL.cx + 7},${DIAL.cy}`} fill={theme.color.ink} />
                </g>
                <circle cx={DIAL.cx} cy={DIAL.cy} r={18} fill={theme.color.ink} />
                <circle cx={DIAL.cx} cy={DIAL.cy} r={6} fill={theme.color.paper} />
              </svg>
            </div>

            <div
              style={{
                background: theme.color.bg, border: `2px solid ${theme.color.line}`, borderRadius: 16,
                padding: '10px 24px 14px', display: 'flex', flexDirection: 'column',
              }}
            >
              <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 12}}>
                <span
                  style={{
                    fontFamily: theme.font.mono, fontSize: 124, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    color: readoutHot ? theme.color.hero : theme.color.text,
                  }}
                >
                  {A.toFixed(2)}
                </span>
                <span style={{fontFamily: theme.font.mono, fontSize: 56, color: theme.color.muted}}>A</span>
              </div>
              <div style={{fontFamily: theme.font.mono, fontSize: 28, color: theme.color.muted, fontVariantNumeric: 'tabular-nums', textAlign: 'right'}}>
                {W.toFixed(0).padStart(4, ' ')} W ÷ {printer.volts} V
              </div>
            </div>

            <div style={{fontSize: 60, fontWeight: 700, color: lvl.name === 'Warm-up' ? theme.color.hero : theme.color.text, paddingLeft: 6}}>
              {lvl.name}
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* ------------------------------------------------ 12-16 s: summary */}
      {frame >= SUM_IN - 2 && (
        <AbsoluteFill style={{fontFamily: theme.font.display, color: theme.color.text}}>
          <div style={{position: 'absolute', left: 96, top: 120, fontSize: 110, fontWeight: 700, letterSpacing: '-0.02em', ...appear(ent(SUM_IN, theme.spring.smooth), sumEx, 40)}}>
            The peaks are the problem
          </div>
          <div style={{position: 'absolute', left: 96, top: 290, width: 1728, display: 'flex', flexDirection: 'column', gap: 20}}>
            {rows.map((r, i) => {
              const start = SUM_IN + 8 + i * 5;
              const p = ent(start, theme.spring.snappy);
              const c = Math.max(0, ent(start + 2, theme.spring.smooth));
              const barW = (r.off ? 1 : r.val / current.peakA) * BAR_W * Math.min(c, 1);
              const ap = appear(p, sumEx, 50);
              return (
                <div
                  key={r.label}
                  style={{
                    ...ap, height: 130, boxSizing: 'border-box', padding: '0 36px', display: 'flex', alignItems: 'center', gap: 24,
                    background: theme.color.panel, borderRadius: 20,
                    border: `2px solid ${r.off ? theme.color.hero : theme.color.line}`,
                  }}
                >
                  <div style={{width: 400, fontSize: 60, fontWeight: 600}}>{r.label}</div>
                  <div style={{width: 380, display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 12}}>
                    <span
                      style={{
                        fontFamily: theme.font.mono, fontSize: 92, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                        color: r.hot ? theme.color.hero : theme.color.text,
                      }}
                    >
                      {r.prefix}{(r.val * c).toFixed(r.dec)}
                    </span>
                    <span style={{fontFamily: theme.font.mono, fontSize: 48, color: theme.color.muted}}>A</span>
                  </div>
                  <div style={{width: BAR_W, height: 40, position: 'relative'}}>
                    <div
                      style={{
                        width: barW, height: 40, borderRadius: 8,
                        background: r.hot ? theme.color.hero : theme.color.muted,
                        opacity: r.hot ? 1 : 0.7, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                        paddingRight: 14, boxSizing: 'border-box', overflow: 'hidden',
                      }}
                    >
                      {r.off && barW > BAR_W * 0.9 && (
                        <span style={{fontFamily: theme.font.mono, fontSize: 26, fontWeight: 700, color: theme.color.ink, whiteSpace: 'nowrap'}}>
                          off the scale »
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      )}

      <Finish />
    </AbsoluteFill>
  );
};
