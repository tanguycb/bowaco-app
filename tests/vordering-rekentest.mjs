// Rekentests van de vorderingsstaat (stap 2.10, zoals 2.5 voor de offerte). Twee delen:
//   (A) de rekenmodule zelf (src/frontend/src/progress/calc.ts) op met de hand nagerekende gevallen: % van een vaste prijs,
//       negatieve hoeveelheden (minwerk), afronding op de cent half weg van nul (AL21), prijsherziening als exacte breuk,
//       inhouding excl./incl. btw, secties en de basis van de herziening zonder regie, cumulatief (vorige + periode = totaal);
//   (B) browser = server: op de canister een proefwerf (tests/vordering-lib.mjs) en N willekeurige invullingen (%, hoeveelheden,
//       uren, indexwaarden, inhouding excl./incl.). Elke keer rekent het model van de browser (progress/model.ts) de totalen, de
//       server rekent na met lib/ProgressCalc.mo en WEIGERT bij een verschil; daarna moet wat de server toont gelijk zijn.
//   node tests/vordering-rekentest.mjs [<canister-id>]     (zonder canister enkel deel A; N = 200 lokaal, 25 op een draft)
import { backend } from "../tools/lib.mjs";
import { progressLine, progressTotals, revisionOf } from "../src/frontend/src/progress/calc.ts";
import { proefVordering, browserTotals, saveAs, PM, ok, errOf } from "./vordering-lib.mjs";

let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };

// ── (A) De rekenmodule ──
const L = (o) => ({ section: "contract", basis: "quantity", offerQtyMilli: 0n, unitPrice: 0n, prevCents: 0n, cumPctBp: 0n, cumQtyMilli: 0n, ...o });
{
  const o = progressLine(L({ basis: "percent", offerQtyMilli: 3_000n, unitPrice: 3_333n, cumPctBp: 3_333n }));
  check("(A) vaste prijs: 3 × 33,33 = 99,99; 33,33 % = 33,33 (33,3267 → 33,33); hoeveelheid ter info 1,000", o.offerCents === 9_999n && o.cumCents === 3_333n && o.cumQtyMilli === 1_000n);
}
{
  const o = progressLine(L({ basis: "percent", offerQtyMilli: 1_000n, unitPrice: 15n, cumPctBp: 5_000n }));
  check("(A) afronding half weg van nul: 50 % van 0,15 = 0,075 → 0,08", o.cumCents === 8n);
  const n = progressLine(L({ basis: "percent", offerQtyMilli: -1_000n, unitPrice: 15n, cumPctBp: 5_000n }));
  check("(A) en negatief: 50 % van −0,15 = −0,075 → −0,08", n.offerCents === -15n && n.cumCents === -8n);
}
{
  const o = progressLine(L({ offerQtyMilli: -2_000n, unitPrice: 5_625n, cumQtyMilli: -1_500n }));
  check("(A) minwerk: offerte −2 × 56,25 = −112,50; tot nu −1,5 × 56,25 = −84,375 → −84,38; rest −28,12; nooit 'boven de VH'", o.offerCents === -11_250n && o.cumCents === -8_438n && o.restCents === -2_812n && o.overVhCents === 0n);
}
{
  const o = progressLine(L({ offerQtyMilli: 40_000n, unitPrice: 3_125n, cumQtyMilli: 42_000n, prevCents: 100_000n }));
  check("(A) VH: 42 van 40 × 31,25 = 1.312,50; boven de VH 62,50; deze periode = 1.312,50 − 1.000,00 (vorige)", o.cumCents === 131_250n && o.overVhCents === 6_250n && o.periodCents === 31_250n && o.restCents === -6_250n);
}
{
  const r = { aBp: 4_000n, bBp: 4_000n, cBp: 2_000n, sBase: 100_000n, iBase: 200_000n, sIndex: 105_000n, iIndex: 210_000n };
  check("(A) prijsherziening: 0,4·1,05 + 0,4·1,05 + 0,2 = 1,04 → 1.000,00 × 0,04 = 40,00", revisionOf(100_000n, r) === 4_000n);
  check("(A) herziening afgerond: 3,33 × 0,04 = 0,1332 → 0,13; −3,33 → −0,13", revisionOf(333n, r) === 13n && revisionOf(-333n, r) === -13n);
  const r2 = { aBp: 5_500n, bBp: 2_500n, cBp: 2_000n, sBase: 112_340n, iBase: 98_765n, sIndex: 115_678n, iIndex: 101_234n };
  // exact: 0,55·115,678/112,34 + 0,25·101,234/98,765 + 0,2 − 1 = 0,02158… ; 12.345,67 × dat = 266,47…
  const exact = (12_345_67 * (0.55 * 115.678 / 112.34 + 0.25 * 101.234 / 98.765 + 0.2 - 1));
  check("(A) herziening met krom getallen = de exacte breuk (± een halve cent)", Math.abs(Number(revisionOf(1_234_567n, r2)) - exact) <= 0.5, `${revisionOf(1_234_567n, r2)} vs ${exact.toFixed(3)}`);
  check("(A) zonder basisindex (0): geen herziening", revisionOf(100_000n, { ...r, sBase: 0n }) === 0n);
}
{
  const lines = [
    L({ section: "contract", offerQtyMilli: 10_000n, unitPrice: 1_000n, cumQtyMilli: 5_000n }),
    L({ section: "extra", offerQtyMilli: 2_000n, unitPrice: 2_500n, cumQtyMilli: 2_000n }),
    L({ section: "less", offerQtyMilli: -1_000n, unitPrice: 4_000n, cumQtyMilli: -1_000n }),
    L({ section: "regie", basis: "hours", offerQtyMilli: 10_000n, unitPrice: 5_000n, cumQtyMilli: 3_000n }),
  ];
  const r = { aBp: 4_000n, bBp: 4_000n, cBp: 2_000n, sBase: 100_000n, iBase: 100_000n, sIndex: 110_000n, iIndex: 100_000n }; // factor 1,04
  const t = progressTotals(lines, 600n, 500n, false, r);
  check("(A) secties: aanneming 50,00 · meerwerk 50,00 · minderwerk −40,00 · regie 150,00; periode 210,00", t.sections.map((s) => s.periodCents).join(",") === "5000,5000,-4000,15000" && t.periodCents === 21_000n);
  check("(A) herziening op 60,00 (zonder regie) × 0,04 = 2,40; subtotaal 212,40", t.revisionBaseCents === 6_000n && t.revisionCents === 240n && t.subtotalCents === 21_240n);
  check("(A) btw 6 % = 12,74 (12,744); totaal 225,14; inhouding 5 % excl. = 10,62; te betalen 214,52", t.vatCents === 1_274n && t.totalCents === 22_514n && t.retentionCents === 1_062n && t.payableCents === 21_452n, `${t.vatCents} ${t.totalCents} ${t.retentionCents}`);
  const ti = progressTotals(lines, 600n, 500n, true, r);
  check("(A) inhouding incl. btw: 5 % van 225,14 = 11,26 (11,257)", ti.retentionCents === 1_126n && ti.payableCents === 22_514n - 1_126n);
  const t0 = progressTotals(lines, 2_100n, 0n, false, null);
  check("(A) zonder model: geen herziening, geen basis; zonder waarborg: geen inhouding", t0.revisionCents === 0n && t0.revisionBaseCents === 0n && t0.retentionCents === 0n && t0.payableCents === t0.totalCents);
  // Cumulatief over drie staten: telkens vorige = totaal tot nu van de vorige staat; de som van de perioden = het totaal.
  let prev = 0n;
  let sum = 0n;
  for (const pct of [2_500n, 6_000n, 10_000n]) {
    const o = progressLine(L({ basis: "percent", offerQtyMilli: 1_000n, unitPrice: 123_457n, cumPctBp: pct, prevCents: prev }));
    sum += o.periodCents;
    prev = o.cumCents;
  }
  check("(A) cumulatief: 25 % → 60 % → 100 % van 1.234,57: de perioden tellen precies op tot het geheel", sum === 123_457n && prev === 123_457n);
}

// ── (B) Browser = server ──
const cid = process.argv[2];
if (cid) {
  const local = (process.env.ICP_HOST || "").includes("localhost") || (process.env.ICP_HOST || "").includes("127.0.0.1");
  const N = Number(process.env.N ?? (local ? 200 : 25));
  const [admin, wl, calc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator"].map((n) => backend(n, cid)));
  const settings0 = await admin.progressSettings();
  const S = await proefVordering({ admin, calc, wl }, { prefix: "P-VR", titleSuffix: " rekentest" });
  const id = ok(await calc.newProgress(S.wid));
  let seed = 2_100_026;
  const rnd = (n) => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed % n; };
  let same = 0;
  let firstErr = "";
  for (let k = 0; k < N; k++) {
    if (k % 50 === 25) ok(await admin.saveProgressSettings({ client: "mogelijk", retentionOnIncl: !(await admin.progressSettings()).retentionOnIncl }));
    const view = ok(await calc.readProgressStatement(id));
    const lines = PM.linesOf(view);
    const edits = new Map();
    for (const l of lines) {
      const r = rnd(10);
      if (r === 0) edits.set(String(l.root), { clear: true });
      else if (r < 8) {
        if (l.basis === "percent") edits.set(String(l.root), { cumPctBp: BigInt(rnd(10_001)) });
        else edits.set(String(l.root), { cumQtyMilli: BigInt(rnd(90_001) - 5_000) });
      }
    }
    const idx = rnd(4) === 0 ? { sIndex: null, iIndex: null } : { sIndex: BigInt(60_000 + rnd(90_000)), iIndex: BigInt(150_000 + rnd(100_000)) };
    const { r, t } = await saveAs(calc, id, edits, idx);
    if ("err" in r) { if (!firstErr) firstErr = r.err; continue; }
    const after = ok(await calc.readProgressStatement(id)).totals;
    const tb = browserTotals(ok(await calc.readProgressStatement(id)));
    if (after.totalCents === t.totalCents && after.payableCents === t.payableCents && after.revisionCents === t.revisionCents && tb.totalCents === after.totalCents) same++;
    else if (!firstErr) firstErr = `ronde ${k}: browser ${t.totalCents} server ${after.totalCents}`;
  }
  check(`(B) browser = server op ${N} willekeurige invullingen (de server aanvaardt de totalen van de browser en toont dezelfde)`, same === N, firstErr);
  ok(await calc.cancelProgressDraft(id, "proef: rekentest klaar"));
  ok(await admin.setWorkStatus(S.wid, { cancelled: null }));
  ok(await admin.saveProgressSettings(settings0));
}
console.log(`\n${pass} ✓ ${fail} ✗`);
process.exit(fail ? 1 : 0);
