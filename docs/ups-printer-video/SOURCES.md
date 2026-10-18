# Sources and working for the numbers in the video

All figures live in `src/facts.ts`. "≈" in the video marks an estimate.

## Printer — Ricoh M 2310N (A3 mono laser MFP)
- Ricoh Europe spec sheet (product 423847): weight 24.4 kg; 220–240 V; max. < 1,500 W; ready 83.51 W; warm-up 15 s; 23 ppm.
  https://s3-eu-west-1.amazonaws.com/zisopoulos/website-brochures/38400-ricoh-m-2310n-423847-AuTVu3GNq2.pdf
- Ricoh APAC product page (seen as a search snippet only, page did not load): operating 722 W, low power 6.86 W, sleep 0.94 W.
  https://www.ricoh-ap.com/products/office-printing/mfp-black-and-white/m-2310n
- Current = power / 230 V: 1500 W → 6.5 A, 722 W → 3.1 A, 83.5 W → 0.36 A.
- Switch-on inrush ≈ 40 A: not a Ricoh figure. Field measurements of laser printer fusers at 230 V (cold halogen heater has low
  resistance). Treat as an order of magnitude. https://forums.anandtech.com/threads/how-do-you-prevent-laser-printer-from-killing-ups.2008898

## UPS — Prolink PRO903ES (3 kVA / 2700 W online tower)
- 190 × 421 × 318 mm, 27.6 kg: anphatpc.com.vn listing
  https://www.anphatpc.com.vn/bo-luu-dien-ups-prolink-pro903-es-online/-tower/-3000v-/-2700w.html
- Battery pack 6 × 12 V 9 Ah (= 648 Wh nominal): retailer listings, e.g.
  https://www.phucanh.vn/bo-luu-dien-ups-prolink-pro903-es-3000va-2700w.html (not confirmed against a Prolink datasheet).
- Prolink publishes no runtime chart for it. Estimates: ~70 % of the nominal Wh is usable at ~1 C discharge,
  the online inverter is ~90 % efficient and uses ~70 W itself. Printing nonstop (~722 W) ≈ 30 min;
  printer idling (~84 W) ≈ 3 h; realistic mix ≈ 2 h. For comparison, APC's published chart for a 3 kVA unit with
  a 432 Wh pack gives 16.5 min at 1000 W (https://www.bhphotovideo.com/c/product/1384846-REG/apc_smt3000rm2uc_smart_ups_3000va_lcd_rm.html).

## Vendor guidance on laser printers and UPS
- Vertiv Liebert PSA quick start: "Do not connect equipment that may overload the UPS … such as a laser printer."
  https://vertiv.com/4956b1/globalassets/products/critical-power/uninterruptible-power-supplies-ups/liebert-psa-500-600va-quick-start-guide.pdf
- Lexmark KB: "most commonly available UPS devices do not have the peak current capability to support the inrush current typical of a laser printer."
  https://support.lexmark.com/content/support/guides/en/kb20211110015958126/other-troubleshooting/other-issues/use-of-power-strips-rpt-surge-devices-rtp-and-unin.html

## Battery life
- APC FAQ FA158934: 3–5 years typical; each +8 °C roughly halves life; keep load below 80 %. https://www.se.com/tw/zh/faqs/FA158934
- ≈250 deep cycles: typical VRLA figure at 100 % depth of discharge (order of magnitude, varies by battery).

## Batching
- One warm-up = 15 s × 1500 W = 6.25 Wh.
- 100 pages at 23 ppm ≈ 4.3 min × 722 W ≈ 52 Wh.
- 20 separate jobs: 20 warm-ups + printing ≈ 177 Wh. One bundle: 1 warm-up + printing ≈ 59 Wh → about 3× less, 19 fewer heat cycles.
- End of life = 80 % of rated capacity: IEEE 1188 practice for VRLA batteries. The "printer load" curve in the video is illustrative.
