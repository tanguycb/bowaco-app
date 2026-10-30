// Rekenmodule van de offerte (stap 2.4/2.5, bouwplan §8.5): DEZELFDE regels als src/backend/lib/QuoteCalc.mo. De browser
// rekent en toont; de backend rekent bij elke bewaring opnieuw en weigert als hij iets anders vindt (tests/rekentest.mjs
// vergelijkt beide). Een totaal wordt nooit getypt of bewaard: het volgt altijd uit de invoer.
// Geld in eurocent (bigint), hoeveelheden in duizendsten (bigint, ook negatief: minwerk), marges in basispunten op de
// VERKOOPprijs (2000 = 20 %: verkoop = aankoop / 0,8). Afronden: op de cent, half weg van nul (−0,5 → −1).
// Volgorde: eerst de eenheidsprijs op de cent, dan hoeveelheid × eenheidsprijs op de cent, dan de som per hoofdstuk, dan
// de btw op het subtotaal. Opties tellen NIET mee in het totaal (apart: meer- en minprijs); tekstregels hebben geen bedrag.
// Versie 2 (stap 2c.1): per lijn een basismarge (klasse van de leverancier of van het hoofdstuk; null = de standaard van de
// versie), het regietarief van de versie voor een regiepost zonder eigen regel, en een korting op het subtotaal vóór btw
// (bedrag of %). Zonder klasse, regie en korting rekent versie 2 exact als versie 1.
// Zonder imports en zonder enums: Node draait dit bestand rechtstreeks (tests/rekentest.mjs).

export const CALC_VERSION = 2;

export type Kind = "item" | "text" | "option";
/** null = de basismarge van de lijn (v2), anders de standaardmarge van de versie */
export type Rule = { margin: bigint } | { price: bigint } | null;
/** v2: het regietarief van de versie (aankoop en verkoop per eenheid) */
export type Regie = { cost: bigint; sell: bigint };
/** v2: korting op het subtotaal: een bedrag in eurocent of basispunten */
export type Discount = { amount: bigint } | { percent: bigint } | null;
export type CalcLine = { chapter: string; kind: Kind; qtyMilli: bigint; cost: bigint | null; rule: Rule; baseBp?: bigint | null; regie?: Regie | null };

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
  /** som van de hoofdstukken (v2: vóór de korting) */
  gross: bigint;
  /** de korting (v2; positief = er gaat iets af) */
  discount: bigint;
  /** gross − korting: de basis van de btw */
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

/** De basismarge van een lijn: haar klasse (v2), anders de standaard van de versie. */
export function baseOf(l: CalcLine, standardBp: bigint): bigint {
  return l.baseBp ?? standardBp;
}

export function calcLine(l: CalcLine, standardBp: bigint): LineOut {
  if (l.kind === "text") return { unitSell: null, lineSell: 0n, lineCost: null, marginBp: null, noPrice: false, deviates: false, negative: false };
  const std = baseOf(l, standardBp);
  // v2: een regiepost zonder eigen regel neemt het regietarief van de versie (aankoop én verkoop).
  const g = l.regie && l.rule === null ? l.regie : null;
  const cost = g ? g.cost : l.cost;
  const rule: Rule = g ? { price: g.sell } : l.rule;
  const u = unitSell(cost, rule, std);
  const lineSell = u === null ? 0n : roundDiv(l.qtyMilli * u, 1000n);
  const lineCost = cost === null ? null : roundDiv(l.qtyMilli * cost, 1000n);
  const r = rule ?? { margin: std };
  let marginBp: bigint | null = null;
  if ("margin" in r) marginBp = u !== null ? r.margin : null;
  else if (cost !== null && r.price > 0n) marginBp = roundDiv((r.price - cost) * 10_000n, r.price);
  const negative = u !== null && cost !== null && u < cost;
  return { unitSell: u, lineSell, lineCost, marginBp, noPrice: u === null, deviates: deviates(l.rule, std), negative };
}

/** De korting op een bruto subtotaal (v2): een bedrag, of een percentage afgerond op de cent (half weg van nul). */
export function discountOf(gross: bigint, d: Discount): bigint {
  if (d === null) return 0n;
  return "amount" in d ? d.amount : roundDiv(gross * d.percent, 10_000n);
}

/** De hoofdstukken in de gegeven volgorde; een lijn moet bij een van die hoofdstukken horen (anders een fout, zodat een
 *  lijn nooit stil buiten het totaal valt: de fout van offerte 2026/231). */
export function calcTotals(chapters: string[], lines: CalcLine[], vatBp: bigint, standardBp: bigint, discount: Discount = null): Totals {
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
  const gross = sell.reduce((a, b) => a + b, 0n);
  const disc = discountOf(gross, discount);
  const subtotal = gross - disc;
  const costT = cost.reduce((a, b) => a + b, 0n);
  const swc = sellWithCost.reduce((a, b) => a + b, 0n);
  const vat = roundDiv(subtotal * vatBp, 10_000n);
  const margin = swc - costT;
  return {
    chapters: chapters.map((c, j) => ({ chapter: c, sell: sell[j], cost: cost[j], sellWithCost: sellWithCost[j], noPrice: noPriceCh[j] })),
    gross,
    discount: disc,
    subtotal,
    vat,
    total: subtotal + vat,
    optionsPlus,
    optionsMinus,
    cost: costT,
    sellWithCost: swc,
    sellWithoutCost: gross - swc,
    margin,
    marginBp: swc > 0n ? roundDiv(margin * 10_000n, swc) : null,
    noPrice,
    deviating,
    negative,
  };
}
