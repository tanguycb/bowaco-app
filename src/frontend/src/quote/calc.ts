// Rekenmodule van de offerte (stap 2.4/2.5, bouwplan §8.5): DEZELFDE regels als src/backend/lib/QuoteCalc.mo. De browser
// rekent en toont; de backend rekent bij elke bewaring opnieuw en weigert als hij iets anders vindt (tests/rekentest.mjs
// vergelijkt beide). Een totaal wordt nooit getypt of bewaard: het volgt altijd uit de invoer.
// Geld in eurocent (bigint), hoeveelheden in duizendsten (bigint, ook negatief: minwerk), marges in basispunten op de
// VERKOOPprijs (2000 = 20 %: verkoop = aankoop / 0,8). Afronden: op de cent, half weg van nul (−0,5 → −1).
// Volgorde: eerst de eenheidsprijs op de cent, dan hoeveelheid × eenheidsprijs op de cent, dan de som per hoofdstuk, dan
// de btw op het subtotaal. Opties tellen NIET mee in het totaal (apart: meer- en minprijs); tekstregels hebben geen bedrag.
// Zonder imports en zonder enums: Node draait dit bestand rechtstreeks (tests/rekentest.mjs).

export const CALC_VERSION = 1;

export type Kind = "item" | "text" | "option";
/** null = de standaardmarge van de versie */
export type Rule = { margin: bigint } | { price: bigint } | null;
export type CalcLine = { chapter: string; kind: Kind; qtyMilli: bigint; cost: bigint | null; rule: Rule };

export type LineOut = {
  unitSell: bigint | null;
  lineSell: bigint;
  lineCost: bigint | null;
  marginBp: bigint | null;
  noPrice: boolean;
  deviates: boolean;
  negative: boolean;
};

export type ChapterOut = { chapter: string; sell: bigint; cost: bigint; sellWithCost: bigint; noPrice: number };

export type Totals = {
  chapters: ChapterOut[];
  subtotal: bigint;
  vat: bigint;
  total: bigint;
  optionsPlus: bigint;
  optionsMinus: bigint;
  cost: bigint;
  sellWithCost: bigint;
  sellWithoutCost: bigint;
  margin: bigint;
  marginBp: bigint | null;
  noPrice: number;
  deviating: number;
  negative: number;
};

/** n / d afgerond op het dichtste geheel, half weg van nul (d > 0). BigInt deelt afkappend naar nul, zoals Motoko. */
export function roundDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("roundDiv: deler ≤ 0");
  return n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d);
}

export function unitSell(cost: bigint | null, rule: Rule, standardBp: bigint): bigint | null {
  const r = rule ?? { margin: standardBp };
  if ("price" in r) return r.price;
  if (cost === null || r.margin >= 10_000n) return null;
  return roundDiv(cost * 10_000n, 10_000n - r.margin);
}

function deviates(rule: Rule, standardBp: bigint): boolean {
  if (rule === null) return false;
  return "price" in rule || rule.margin !== standardBp;
}

export function calcLine(l: CalcLine, standardBp: bigint): LineOut {
  if (l.kind === "text") return { unitSell: null, lineSell: 0n, lineCost: null, marginBp: null, noPrice: false, deviates: false, negative: false };
  const u = unitSell(l.cost, l.rule, standardBp);
  const lineSell = u === null ? 0n : roundDiv(l.qtyMilli * u, 1000n);
  const lineCost = l.cost === null ? null : roundDiv(l.qtyMilli * l.cost, 1000n);
  const r = l.rule ?? { margin: standardBp };
  let marginBp: bigint | null = null;
  if ("margin" in r) marginBp = u !== null ? r.margin : null;
  else if (l.cost !== null && r.price > 0n) marginBp = roundDiv((r.price - l.cost) * 10_000n, r.price);
  const negative = u !== null && l.cost !== null && u < l.cost;
  return { unitSell: u, lineSell, lineCost, marginBp, noPrice: u === null, deviates: deviates(l.rule, standardBp), negative };
}

/** De hoofdstukken in de gegeven volgorde; een lijn moet bij een van die hoofdstukken horen (anders een fout, zodat een
 *  lijn nooit stil buiten het totaal valt: de fout van offerte 2026/231). */
export function calcTotals(chapters: string[], lines: CalcLine[], vatBp: bigint, standardBp: bigint): Totals {
  const idx = new Map(chapters.map((c, i) => [c, i]));
  const sell = chapters.map(() => 0n);
  const cost = chapters.map(() => 0n);
  const sellWithCost = chapters.map(() => 0n);
  const noPriceCh = chapters.map(() => 0);
  let optionsPlus = 0n;
  let optionsMinus = 0n;
  let noPrice = 0;
  let deviating = 0;
  let negative = 0;
  for (const l of lines) {
    const k = idx.get(l.chapter);
    if (k === undefined) throw new Error(`Lijn zonder hoofdstuk ${l.chapter}`);
    if (l.kind === "text") continue;
    const o = calcLine(l, standardBp);
    if (o.noPrice) { noPrice++; noPriceCh[k]++; }
    if (o.deviates) deviating++;
    if (o.negative) negative++;
    if (l.kind === "item") {
      sell[k] += o.lineSell;
      if (o.lineCost !== null) { cost[k] += o.lineCost; sellWithCost[k] += o.lineSell; }
    } else if (o.lineSell > 0n) optionsPlus += o.lineSell;
    else optionsMinus += o.lineSell;
  }
  const subtotal = sell.reduce((a, b) => a + b, 0n);
  const costT = cost.reduce((a, b) => a + b, 0n);
  const swc = sellWithCost.reduce((a, b) => a + b, 0n);
  const vat = roundDiv(subtotal * vatBp, 10_000n);
  const margin = swc - costT;
  return {
    chapters: chapters.map((c, j) => ({ chapter: c, sell: sell[j], cost: cost[j], sellWithCost: sellWithCost[j], noPrice: noPriceCh[j] })),
    subtotal,
    vat,
    total: subtotal + vat,
    optionsPlus,
    optionsMinus,
    cost: costT,
    sellWithCost: swc,
    sellWithoutCost: subtotal - swc,
    margin,
    marginBp: swc > 0n ? roundDiv(margin * 10_000n, swc) : null,
    noPrice,
    deviating,
    negative,
  };
}
