// Het model van één vorderingsstaat zoals de browser hem bijhoudt (stap 2.10): de lijnen van de server (readProgressStatement),
// wat de gebruiker veranderde, het voorstel als hij een invoer wist, en de totalen die de backend ernaast legt (expect).
// Zonder React en zonder backend-imports: het scherm (screens/Vorderingen.tsx) en de proeven (tests/vordering-*.mjs) gebruiken
// hetzelfde model. Werkt met beide vormen van de backend-antwoorden: die van bindgen (backend.ts: varianten als tekst, opties als
// waarde of undefined) en die van de ruwe agent in de proeven (varianten als { naam: null }, opties als [] of [waarde]).
import { progressLine, progressTotals, type Basis, type PLine, type PTotals, type Revision, type Section } from "./calc.ts";

type Opt<T> = T | [] | [T] | undefined | null;
export function optOf<T>(x: Opt<T>): T | null {
  if (Array.isArray(x)) return x.length ? (x[0] as T) : null;
  return (x ?? null) as T | null;
}
export function variantKey(v: unknown): string {
  return typeof v === "string" ? v : Object.keys(v as object)[0];
}

export type Hints = { measuredMilli: bigint | null; hoursMilli: bigint | null; planPctBp: bigint | null };
export type ModelLine = {
  root: bigint;
  section: Section;
  basis: Basis;
  offerQtyMilli: bigint;
  unitPrice: bigint;
  prevCents: bigint;
  prevPctBp: bigint;
  prevQtyMilli: bigint;
  cumPctBp: bigint; // wat de server nu toont (invoer of voorstel)
  cumQtyMilli: bigint;
  hasInput: boolean;
  note: string;
  hints: Hints;
};
export type ModelHeader = {
  vatBp: bigint;
  retentionBp: bigint;
  retentionOnIncl: boolean;
  formula: string;
  model: { aBp: bigint; bBp: bigint; cBp: bigint; sBase: bigint; iBase: bigint } | null;
  sIndex: bigint | null;
  iIndex: bigint | null;
};
/** Een wijziging van de gebruiker. clear = terug naar het voorstel. */
export type Edit = { cumPctBp?: bigint; cumQtyMilli?: bigint; note?: string; clear?: boolean };

/* eslint-disable @typescript-eslint/no-explicit-any */
export function linesOf(view: any): ModelLine[] {
  return (view.lines as any[]).map((x) => {
    const q = x.q;
    const h = q.hints;
    return {
      root: q.root,
      section: variantKey(q.section) as Section,
      basis: variantKey(q.basis) as Basis,
      offerQtyMilli: q.offerQtyMilli,
      unitPrice: x.m.unitPriceCents,
      prevCents: x.m.prevCents,
      prevPctBp: q.prevPctBp,
      prevQtyMilli: q.prevQtyMilli,
      cumPctBp: q.cumPctBp,
      cumQtyMilli: q.cumQtyMilli,
      hasInput: q.hasInput,
      note: q.note,
      hints: { measuredMilli: optOf<bigint>(h.measuredMilli), hoursMilli: optOf<bigint>(h.hoursMilli), planPctBp: optOf<bigint>(h.planPctBp) },
    };
  });
}

export function headerOf(view: any): ModelHeader {
  const h = view.header;
  const m = optOf<any>(h.model);
  return {
    vatBp: h.vatBp,
    retentionBp: h.retentionBp,
    retentionOnIncl: h.retentionOnIncl,
    formula: h.formula,
    model: m ? { aBp: m.aBp, bBp: m.bBp, cBp: m.cBp, sBase: m.sBase, iBase: m.iBase } : null,
    sIndex: optOf<bigint>(h.sIndex),
    iIndex: optOf<bigint>(h.iIndex),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Het voorstel als niemand iets invult (dezelfde regel als lib/Progress.mo build). */
export function proposal(l: ModelLine): { cumPctBp: bigint; cumQtyMilli: bigint } {
  if (l.basis === "percent") {
    const p = l.hints.planPctBp;
    return { cumPctBp: p !== null && p > l.prevPctBp ? p : l.prevPctBp, cumQtyMilli: 0n };
  }
  const h = l.basis === "quantity" ? l.hints.measuredMilli : l.hints.hoursMilli;
  return { cumPctBp: 0n, cumQtyMilli: h ?? l.prevQtyMilli };
}

/** Wat geldt voor een lijn met de wijzigingen erbij: (pct, qty, invoer ja/nee, notitie). */
export function effective(l: ModelLine, e: Edit | undefined): { cumPctBp: bigint; cumQtyMilli: bigint; hasInput: boolean; note: string } {
  if (!e) return { cumPctBp: l.cumPctBp, cumQtyMilli: l.basis === "percent" ? 0n : l.cumQtyMilli, hasInput: l.hasInput, note: l.note };
  if (e.clear) return { ...proposal(l), hasInput: false, note: "" };
  return {
    cumPctBp: l.basis === "percent" ? (e.cumPctBp ?? (l.hasInput ? l.cumPctBp : proposal(l).cumPctBp)) : 0n,
    cumQtyMilli: l.basis !== "percent" ? (e.cumQtyMilli ?? (l.hasInput ? l.cumQtyMilli : proposal(l).cumQtyMilli)) : 0n,
    hasInput: true,
    note: e.note ?? l.note,
  };
}

export function calcLine(l: ModelLine, e: Edit | undefined): PLine {
  const x = effective(l, e);
  return { section: l.section, basis: l.basis, offerQtyMilli: l.offerQtyMilli, unitPrice: l.unitPrice, prevCents: l.prevCents, cumPctBp: x.cumPctBp, cumQtyMilli: x.cumQtyMilli };
}

export function lineOut(l: ModelLine, e: Edit | undefined) {
  return progressLine(calcLine(l, e));
}

export function revisionOf(h: ModelHeader, sIndex = h.sIndex, iIndex = h.iIndex): Revision | null {
  if (!h.formula || !h.model || sIndex === null || iIndex === null) return null;
  return { ...h.model, sIndex, iIndex };
}

export function totals(lines: ModelLine[], edits: Map<string, Edit>, h: ModelHeader, sIndex = h.sIndex, iIndex = h.iIndex): PTotals {
  return progressTotals(lines.map((l) => calcLine(l, edits.get(String(l.root)))), h.vatBp, h.retentionBp, h.retentionOnIncl, revisionOf(h, sIndex, iIndex));
}

export function expectOf(t: PTotals) {
  return { periodCents: t.periodCents, revisionCents: t.revisionCents, vatCents: t.vatCents, totalCents: t.totalCents, payableCents: t.payableCents };
}

/** De bewaaropdrachten (neutraal: null = geen waarde); het scherm en de proeven zetten ze om naar hun vorm van de backend. */
export function opsOf(lines: ModelLine[], edits: Map<string, Edit>): { root: bigint; cumPctBp: bigint | null; cumQtyMilli: bigint | null; note: string; clear: boolean }[] {
  const out = [];
  for (const l of lines) {
    const e = edits.get(String(l.root));
    if (!e) continue;
    if (e.clear) { out.push({ root: l.root, cumPctBp: null, cumQtyMilli: null, note: "", clear: true }); continue; }
    const x = effective(l, e);
    out.push({ root: l.root, cumPctBp: l.basis === "percent" ? x.cumPctBp : null, cumQtyMilli: l.basis === "percent" ? null : x.cumQtyMilli, note: x.note, clear: false });
  }
  return out;
}
