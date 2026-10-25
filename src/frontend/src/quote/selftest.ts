// Rekentest in de browser (stap 2.5): de editor draait deze vaste gevallen één keer bij het openen. Faalt er één (een
// browser die BigInt anders rekent, een kapotte bouw), dan kan er niet bewaard worden: liever geen offerte dan een fout
// totaal. tests/rekentest.mjs draait dezelfde gevallen in Node. Alle bedragen zijn VERZONNEN; enkel de vorm van de fouten
// komt uit offerte 2026/231 (architectuur §1.3).
import { calcLine, calcTotals, roundDiv, type CalcLine } from "./calc.ts";

export type SelfCase = { name: string; ok: () => boolean };

const L = (chapter: string, qtyMilli: bigint, cost: bigint | null, rule: CalcLine["rule"] = null, kind: CalcLine["kind"] = "item"): CalcLine => ({ chapter, kind, qtyMilli, cost, rule });

export const SELF_CASES: SelfCase[] = [
  { name: "afronden half weg van nul (±0,5 cent)", ok: () => roundDiv(5n, 10n) === 1n && roundDiv(-5n, 10n) === -1n && roundDiv(4n, 10n) === 0n && roundDiv(-15n, 10n) === -2n },
  { name: "20 % marge = aankoop / 0,8 (45,00 → 56,25; 47,50 → 59,38)", ok: () => calcLine(L("a", 1000n, 4500n), 2000n).unitSell === 5625n && calcLine(L("a", 1000n, 4750n), 2000n).unitSell === 5938n },
  { name: "hoeveelheid × eenheidsprijs op de cent (12,5 × 56,25 = 703,13)", ok: () => calcLine(L("a", 12_500n, 4500n), 2000n).lineSell === 70_313n },
  { name: "minwerk negatief, VH 0 telt 0", ok: () => calcLine(L("a", -2000n, 4500n), 2000n).lineSell === -11_250n && calcLine(L("a", 0n, 4500n), 2000n).lineSell === 0n },
  {
    name: "hoofdstukken, btw 6 en 21 %, opties niet in het totaal",
    ok: () => {
      const ls = [L("h1", 1000n, null, { price: 90_000n }), L("h2", 12_500n, 4500n), L("h2", 12_500n, 800n, null, "option"), L("h2", 0n, null, null, "text")];
      const t6 = calcTotals(["h1", "h2"], ls, 600n, 2000n);
      const t21 = calcTotals(["h1", "h2"], ls, 2100n, 2000n);
      return t6.chapters[0].sell === 90_000n && t6.chapters[1].sell === 70_313n && t6.subtotal === 160_313n && t6.vat === 9619n && t21.vat === 33_666n && t6.optionsPlus === 12_500n;
    },
  },
  {
    name: "marge over de posten met een aankoopprijs; vaste prijs zonder aankoop apart",
    ok: () => {
      const t = calcTotals(["h"], [L("h", 1000n, 8000n), L("h", 1000n, null, { price: 5000n })], 600n, 2000n);
      return t.cost === 8000n && t.sellWithCost === 10_000n && t.margin === 2000n && t.marginBp === 2000n && t.sellWithoutCost === 5000n;
    },
  },
  // De vier fouten van 2026/231, verkleind en met verzonnen bedragen:
  {
    name: "2026/231 · een totaal stopt nooit bij een rij: elk hoofdstuk telt, ook het laatste",
    ok: () => calcTotals(["00", "10", "11"], [L("00", 1000n, null, { price: 100n }), L("10", 1000n, null, { price: 200n }), L("11", 1000n, null, { price: 300n }), L("11", 1000n, null, { price: 400n })], 600n, 2000n).subtotal === 1000n,
  },
  {
    name: "2026/231 · een hoofdstuk telt enkel zijn eigen posten (02 nooit met 03)",
    ok: () => {
      const t = calcTotals(["02", "03"], [L("02", 1000n, null, { price: 100n }), L("03", 1000n, null, { price: 200n })], 600n, 2000n);
      return t.chapters[0].sell === 100n && t.chapters[1].sell === 200n && t.subtotal === 300n;
    },
  },
  {
    name: "2026/231 · een lijn zonder hoofdstuk wordt geweigerd, nooit stil ergens bijgeteld",
    ok: () => { try { calcTotals(["10"], [L("11", 1000n, null, { price: 100n })], 600n, 2000n); return false; } catch { return true; } },
  },
  { name: "2026/231 · 1 × € 450 = € 450 (een lijntotaal wordt berekend, nooit getypt)", ok: () => calcLine(L("a", 1000n, null, { price: 45_000n }), 2000n).lineSell === 45_000n },
];

export type SelfResult = { passed: number; failed: string[] };

let cached: SelfResult | null = null;

/** Eén keer per pagina: de vaste gevallen; een uitzondering telt als gefaald. */
export function runSelfTest(): SelfResult {
  if (cached) return cached;
  const failed: string[] = [];
  for (const c of SELF_CASES) {
    try { if (!c.ok()) failed.push(c.name); } catch { failed.push(c.name); }
  }
  cached = { passed: SELF_CASES.length - failed.length, failed };
  return cached;
}
