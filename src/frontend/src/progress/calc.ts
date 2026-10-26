// Rekenmodule van de vorderingsstaat (stap 2.10, bouwplan §9 rij 2.10 en §5.1): DEZELFDE regels als
// src/backend/lib/ProgressCalc.mo. De browser rekent en toont; de backend rekent bij elke bewaring en bij het versturen opnieuw
// en weigert als hij iets anders vindt (tests/vordering-rekentest.mjs vergelijkt beide). Een totaal wordt nooit getypt.
// Geld in eurocent (bigint), hoeveelheden in duizendsten, percentages in basispunten (10_000 = 100 %), indexwaarden in
// duizendsten. Afronden zoals de offerte (AL21): op de cent, half weg van nul (roundDiv van quote/calc.ts).
// Volgorde per post: bedrag offerte = hoeveelheid × eenheidsprijs op de cent; totaal tot nu = (vaste prijs) bedrag offerte × %
// op de cent, of (VH, regie) hoeveelheid tot nu × eenheidsprijs op de cent; deze periode = totaal tot nu − vorige staten. Dan per
// sectie en samen de som; de prijsherziening op deze periode zonder regie; btw op (deze periode + prijsherziening); de inhouding
// van de waarborg op dat bedrag excl. of incl. btw; te betalen = totaal − inhouding.
// Zonder enums en zonder backend-imports: Node draait dit bestand rechtstreeks (tests/vordering-rekentest.mjs).
import { roundDiv as rd } from "../quote/calc.ts";

export const PROGRESS_CALC_VERSION = 1;

export type Section = "contract" | "extra" | "less" | "regie";
export type Basis = "percent" | "quantity" | "hours";
export const SECTIONS: Section[] = ["contract", "extra", "less", "regie"];

/** prevCents = het totaal tot nu van deze post in de vorige (niet gecrediteerde) staat. */
export type PLine = { section: Section; basis: Basis; offerQtyMilli: bigint; unitPrice: bigint; prevCents: bigint; cumPctBp: bigint; cumQtyMilli: bigint };
export type PLineOut = { offerCents: bigint; cumQtyMilli: bigint; cumCents: bigint; periodCents: bigint; restCents: bigint; overVhCents: bigint };
export type Revision = { aBp: bigint; bBp: bigint; cBp: bigint; sBase: bigint; iBase: bigint; sIndex: bigint; iIndex: bigint };
export type SectionOut = { section: Section; offerCents: bigint; prevCents: bigint; cumCents: bigint; periodCents: bigint };
export type PTotals = {
  sections: SectionOut[];
  offerCents: bigint;
  prevCents: bigint;
  cumCents: bigint;
  periodCents: bigint;
  restCents: bigint;
  overVhCents: bigint;
  revisionBaseCents: bigint;
  revisionCents: bigint;
  subtotalCents: bigint;
  vatBp: bigint;
  vatCents: bigint;
  totalCents: bigint;
  retentionBp: bigint;
  retentionCents: bigint;
  payableCents: bigint;
};

export function progressLine(l: PLine): PLineOut {
  const offerCents = rd(l.offerQtyMilli * l.unitPrice, 1000n);
  const pct = l.basis === "percent";
  const cumQty = pct ? rd(l.offerQtyMilli * l.cumPctBp, 10_000n) : l.cumQtyMilli;
  const cumCents = pct ? rd(offerCents * l.cumPctBp, 10_000n) : rd(l.cumQtyMilli * l.unitPrice, 1000n);
  const over = !pct && l.offerQtyMilli >= 0n && cumQty > l.offerQtyMilli ? cumCents - offerCents : 0n;
  return { offerCents, cumQtyMilli: cumQty, cumCents, periodCents: cumCents - l.prevCents, restCents: offerCents - cumCents, overVhCents: over };
}

/** De herziening van een bedrag: bedrag × (factor − 1), exact als breuk en dan één keer afgerond. */
export function revisionOf(base: bigint, r: Revision): bigint {
  if (r.sBase === 0n || r.iBase === 0n) return 0n;
  const sI = r.sBase * r.iBase;
  const num = r.aBp * r.sIndex * r.iBase + r.bBp * r.iIndex * r.sBase + r.cBp * sI - 10_000n * sI;
  return rd(base * num, 10_000n * sI);
}

export function progressTotals(lines: PLine[], vatBp: bigint, retentionBp: bigint, retentionOnIncl: boolean, rev: Revision | null): PTotals {
  const z = () => [0n, 0n, 0n, 0n];
  const offer = z(), prev = z(), cum = z(), period = z();
  let rest = 0n;
  let over = 0n;
  for (const l of lines) {
    const o = progressLine(l);
    const k = SECTIONS.indexOf(l.section);
    offer[k] += o.offerCents;
    prev[k] += l.prevCents;
    cum[k] += o.cumCents;
    period[k] += o.periodCents;
    rest += o.restCents;
    over += o.overVhCents;
  }
  const sum = (a: bigint[]) => a[0] + a[1] + a[2] + a[3];
  const periodT = sum(period);
  const base = period[0] + period[1] + period[2];
  const revC = rev ? revisionOf(base, rev) : 0n;
  const subtotal = periodT + revC;
  const vat = rd(subtotal * vatBp, 10_000n);
  const total = subtotal + vat;
  const retention = rd((retentionOnIncl ? total : subtotal) * retentionBp, 10_000n);
  return {
    sections: SECTIONS.map((s, k) => ({ section: s, offerCents: offer[k], prevCents: prev[k], cumCents: cum[k], periodCents: period[k] })),
    offerCents: sum(offer),
    prevCents: sum(prev),
    cumCents: sum(cum),
    periodCents: periodT,
    restCents: rest,
    overVhCents: over,
    revisionBaseCents: rev ? base : 0n,
    revisionCents: revC,
    subtotalCents: subtotal,
    vatBp,
    vatCents: vat,
    totalCents: total,
    retentionBp,
    retentionCents: retention,
    payableCents: total - retention,
  };
}
