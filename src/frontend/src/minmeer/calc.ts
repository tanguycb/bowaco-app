// Rekenmodule van de min-meerstaat (stap 2c.5, ontwerp 2c §4.5, G4): DEZELFDE regels als src/backend/lib/MinMeerCalc.mo. De server
// stuurt per regel de invoer (hoeveelheid, eenheidsprijs, deel, kolom, telt mee) én de uitkomst; de browser rekent na (verschil =
// melding) en rekent live mee wanneer kantoor een prijs invult. Zonder React en zonder backend-imports: Node draait dit bestand
// rechtstreeks (tests/minmeer-2c5.mjs). Wijzig je een regel, verhoog dan `version` (beide).
//   • Bedrag = hoeveelheid × eenheidsprijs (op de cent, half weg van nul); met pctBp daarvan dat deel (op de cent).
//   • Kolom offer/less/extra/auto: minwerk = −bedrag, meerwerk = +bedrag, auto volgt het teken (een regel van kantoor is nooit negatief).
//   • Een regel die niet meetelt, telt enkel in "in afwachting".
//   • Korting: een bedrag, of een % van het meerwerk van dat hoofdstuk ("" = van al het meerwerk); altijd minwerk.
//   • Saldo = minwerk + meerwerk; aanneemsom + saldo = offerte + saldo; nog te factureren = dat − reeds gefactureerd.
import { roundDiv } from "../quote/calc.ts";

export const version = 1n;

export type Col = "offer" | "less" | "extra" | "auto";
export type MLine = { chapter: string; col: Col; qtyMilli: bigint; unitCents: bigint; pctBp: bigint | null; counted: boolean };
export type MDisc = { chapter: string; pctBp: bigint | null; amountCents: bigint; counted: boolean };
export type MOut = { amountCents: bigint; offerCents: bigint; lessCents: bigint; extraCents: bigint };
export type MChapter = { chapter: string; offerCents: bigint; lessCents: bigint; extraCents: bigint; balanceCents: bigint };
export type MTotals = {
  lines: MOut[];
  discs: MOut[];
  chapters: MChapter[];
  offerCents: bigint;
  lessCents: bigint;
  extraCents: bigint;
  balanceCents: bigint;
  contractCents: bigint;
  invoicedCents: bigint;
  toInvoiceCents: bigint;
  pendingCents: bigint;
  vatBp: bigint;
};

export function amount(l: MLine): bigint {
  const base = roundDiv(l.qtyMilli * l.unitCents, 1000n);
  return l.pctBp === null ? base : roundDiv(base * l.pctBp, 10_000n);
}

export function line(l: MLine): MOut {
  const a = amount(l);
  switch (l.col) {
    case "offer": return { amountCents: a, offerCents: a, lessCents: 0n, extraCents: 0n };
    case "less": return { amountCents: a, offerCents: 0n, lessCents: -a, extraCents: 0n };
    case "extra": return { amountCents: a, offerCents: 0n, lessCents: 0n, extraCents: a };
    default: return a >= 0n ? { amountCents: a, offerCents: 0n, lessCents: 0n, extraCents: a } : { amountCents: a, offerCents: 0n, lessCents: a, extraCents: 0n };
  }
}

export function disc(d: MDisc, extraBase: bigint): MOut {
  const a = d.pctBp !== null ? roundDiv(extraBase * d.pctBp, 10_000n) : d.amountCents;
  return { amountCents: a, offerCents: 0n, lessCents: -a, extraCents: 0n };
}

export function totals(lines: MLine[], discs: MDisc[], invoicedCents: bigint, vatBp: bigint): MTotals {
  const order: string[] = [];
  const ch = new Map<string, [bigint, bigint, bigint]>();
  const bump = (c: string, o: bigint, l: bigint, e: bigint) => {
    const x = ch.get(c);
    if (x) ch.set(c, [x[0] + o, x[1] + l, x[2] + e]);
    else { order.push(c); ch.set(c, [o, l, e]); }
  };
  let offer = 0n, less = 0n, extra = 0n, pending = 0n;
  const outs = lines.map(line);
  lines.forEach((l, i) => {
    const o = outs[i];
    if (l.counted) {
      offer += o.offerCents; less += o.lessCents; extra += o.extraCents;
      bump(l.chapter, o.offerCents, o.lessCents, o.extraCents);
    } else {
      pending += o.lessCents + o.extraCents;
      bump(l.chapter, 0n, 0n, 0n);
    }
  });
  const allExtra = extra;
  const dOuts = discs.map((d) => disc(d, d.chapter === "" ? allExtra : (ch.get(d.chapter)?.[2] ?? 0n)));
  discs.forEach((d, i) => {
    const o = dOuts[i];
    if (d.counted) { less += o.lessCents; bump(d.chapter, 0n, o.lessCents, 0n); } else { pending += o.lessCents; bump(d.chapter, 0n, 0n, 0n); }
  });
  const chapters = order.map((c) => {
    const [o, l, e] = ch.get(c) ?? [0n, 0n, 0n];
    return { chapter: c, offerCents: o, lessCents: l, extraCents: e, balanceCents: l + e };
  });
  const balance = less + extra;
  const contract = offer + balance;
  return { lines: outs, discs: dOuts, chapters, offerCents: offer, lessCents: less, extraCents: extra, balanceCents: balance, contractCents: contract, invoicedCents, toInvoiceCents: contract - invoicedCents, pendingCents: pending, vatBp };
}

/** De volle view van de server (readMinMeer) → de invoer van de rekenmodule (enkel wat in een versie komt telt). */
type RowIn = { chapter: string; col: unknown; qtyMilli: bigint; unitCents: bigint; pctBp?: [] | [bigint] | bigint | null; counted: boolean; inVersion: boolean };
type DiscIn = { chapter: string; pctBp?: [] | [bigint] | bigint | null; amountCents: bigint; counted: boolean };
const optBig = (x: [] | [bigint] | bigint | null | undefined): bigint | null => (Array.isArray(x) ? (x.length ? x[0] : null) : x ?? null);
export const colOf = (c: unknown): Col => {
  if (typeof c === "string") return c as Col;
  const k = c && typeof c === "object" ? Object.keys(c)[0] : "auto";
  return (k === "__kind__" ? (c as { __kind__: string }).__kind__ : k) as Col;
};
export const lineOf = (r: RowIn): MLine => ({ chapter: r.chapter, col: colOf(r.col), qtyMilli: r.qtyMilli, unitCents: r.unitCents, pctBp: optBig(r.pctBp), counted: r.counted });
export const discOf = (d: DiscIn): MDisc => ({ chapter: d.chapter, pctBp: optBig(d.pctBp), amountCents: d.amountCents, counted: d.counted });

/** Rekent de volle view na: dezelfde totalen als de server? (melding bij een verschil) */
export function recheck(view: { rows: RowIn[]; discs: DiscIn[]; invoiced: { cents: bigint }[]; totals: { balanceCents: bigint; contractCents: bigint; toInvoiceCents: bigint; offerCents: bigint; pendingCents: bigint; vatBp: bigint } }): { ok: boolean; totals: MTotals } {
  const inv = view.invoiced.reduce((a, x) => a + x.cents, 0n);
  const t = totals(view.rows.filter((r) => r.inVersion).map(lineOf), view.discs.map(discOf), inv, view.totals.vatBp);
  const s = view.totals;
  const ok = t.balanceCents === s.balanceCents && t.contractCents === s.contractCents && t.toInvoiceCents === s.toInvoiceCents && t.offerCents === s.offerCents && t.pendingCents === s.pendingCents;
  return { ok, totals: t };
}
