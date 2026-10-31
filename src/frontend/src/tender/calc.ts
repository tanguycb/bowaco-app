// Het rekenen van een OA-offerte (stap 2c.2, ontwerp 2c G4): dezelfde regels als src/backend/lib/TenderCalc.mo. De browser toont
// het totaal; de server rekent bij het indienen na en weigert een ander totaal. Wijzig je een regel, verhoog dan `version` (beide).
// Bedrag = eenheidsprijs × hoeveelheid (duizendsten), half weg van nul op de cent; "niet inbegrepen" telt niet; zonder prijs geen
// bedrag. Netto = som − korting (% op de som, op de cent). Totalen per hoofdstuk vóór de korting; eigen posten onder "Eigen posten".
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks (tests/prijsvraag-excel.mjs, tests/prijsvraag-2c2.mjs).

export const version = 1n;
export const OWN_CHAPTER = "Eigen posten";

export type Included = { yes: null } | { no: null } | { alt: string };
export type CalcLine = { itemId: bigint | null; qtyMilli: bigint; unitCents: bigint | null; included: Included };

export function roundDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("roundDiv: deler ≤ 0");
  return n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d);
}

export function lineAmount(unitCents: bigint | null, qtyMilli: bigint, included: Included): bigint | null {
  if (unitCents === null || "no" in included) return null;
  return roundDiv(unitCents * qtyMilli, 1000n);
}

export type Totals = { gross: bigint; discount: bigint; net: bigint; chapters: [string, bigint][] };

export function totals(lines: CalcLine[], discountBp: bigint | null, chapterOf: (itemId: bigint) => string): Totals {
  let gross = 0n;
  const sums = new Map<string, bigint>();
  for (const l of lines) {
    const a = lineAmount(l.unitCents, l.qtyMilli, l.included);
    if (a === null) continue;
    gross += a;
    const ch = l.itemId === null ? OWN_CHAPTER : chapterOf(l.itemId);
    sums.set(ch, (sums.get(ch) ?? 0n) + a);
  }
  const discount = discountBp === null || discountBp === 0n ? 0n : roundDiv(gross * discountBp, 10_000n);
  return { gross, discount, net: gross - discount, chapters: [...sums.entries()] };
}
