// Every number shown in the video comes from here. Sources in SOURCES.md.
export const printer = {
  name: 'Ricoh M 2310N',
  kind: 'A3 mono laser MFP',
  weightKg: 24.4,
  volts: 230,
  peakW: 1500, // brochure: "max. < 1,500 W" (fuser warm-up)
  printingW: 722, // Ricoh APAC spec page (operating)
  readyW: 83.5, // brochure
  lowPowerW: 6.86,
  sleepW: 0.94,
  warmupS: 15, // brochure
  ppm: 23,
};
const amps = (w: number) => w / printer.volts;
export const current = {
  peakA: amps(printer.peakW), // 6.5 A
  printingA: amps(printer.printingW), // 3.1 A
  readyA: amps(printer.readyW), // 0.36 A
  inrushA: 40, // cold halogen fuser switch-on, field measurements report ~40 A peaks for a few ms
};
export const ups = {
  model: 'Prolink PRO903ES',
  type: 'online (double conversion)',
  ratingVA: 3000,
  ratingW: 2700,
  weightKg: 27.6, // anphatpc.com.vn listing
  sizeMm: {w: 190, d: 421, h: 318},
  batteries: '6 × 12 V 9 Ah', // retailer listings (phucanh.vn, Indonesian stores)
  batteryWh: 648, // 6 × 12 V × 9 Ah, nominal
  // No published runtime chart. Estimated from the 648 Wh pack, lead-acid
  // capacity loss at high discharge rates (~70 % usable at ~1 C) and the
  // online inverter's own losses (~90 % efficient, ~70 W self-use).
  printingMin: 30, // continuous printing at ~722 W
  readyHours: 3, // printer idling at ~84 W
  mixedHours: 2, // realistic office mix, if it never reheats from sleep
};
export const batch = {
  // one warm-up = 15 s at ~1500 W
  warmupWh: (printer.peakW * printer.warmupS) / 3600, // 6.25 Wh
  jobs: 20,
  pagesPerJob: 5,
  // 100 pages at 23 ppm ≈ 4.3 min at 722 W ≈ 52 Wh
  printWh: ((20 * 5) / printer.ppm / 60) * printer.printingW,
};
export const scatteredWh = batch.jobs * batch.warmupWh + batch.printWh; // ≈ 177 Wh
export const batchedWh = batch.warmupWh + batch.printWh; // ≈ 59 Wh
export const battery = {
  lifeYears: [3, 5], // APC FAQ FA158934
  halvesEveryC: 8, // each +8 °C roughly halves life
  maxLoadPct: 80,
  eolPct: 80, // VRLA end of life = 80 % of rated capacity (IEEE 1188)
  deepCycles: 250, // typical VRLA cycles to 100 % depth of discharge (order of magnitude)
};
