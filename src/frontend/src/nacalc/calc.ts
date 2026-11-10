// Rekenmodule van de nacalculatie (stap 4.6): gepland (getekende offerte) tegenover werkelijk (min-meerstaat + goedgekeurde aankoopfacturen)
// per werf, per OA, per hoofdstuk en per posttype. De backend (lib/Nacalc.mo) geeft enkel de FEITEN; ALLE rekenwerk gebeurt hier.
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks (tests/nacalc-4-6.mjs). Bedragen zijn eurocent (bigint).
//   • Gepland verkoop = Σ posten − korting op het totaal; gepland kost = Σ bekende aankoopprijzen; marge = verkoop − kost.
//   • Werkelijk verkoop = aanneemsom + saldo min-meer (mmTotals.contractCents); werkelijk kost = Σ GOEDGEKEURDE kostenregels (wachtende apart,
//     voorschotten en aftrek van voorschotten tellen niet, een creditnota negatief); marge = verkoop − kost.
//   • Afwijking van een groep = werkelijke kost − geplande kost. Ze valt op als |afwijking| ≥ drempelbedrag EN ≥ drempelpercentage van de
//     geplande kost (zonder geplande kost: enkel het bedrag). Meer dan gepland valt altijd op; minder dan gepland enkel als de werf
//     opgeleverd is (anders komen er nog facturen).
//   • Marge in basispunten = marge × 10.000 / verkoop (half weg van nul), null zonder verkoop.

export const version = 1n;

export type Flag = "ok" | "meer" | "minder" | "ongepland";
export type Planned = { chapter: string; form: string; sellCents: bigint; costCents: bigint | null; orgId: bigint | null; orgName: string };
export type Actual = { orgId: bigint; orgName: string; kind: string; chapter: string; form: string; amountCents: bigint; status: string };
export type MmChapter = { chapter: string; offerCents: bigint; balanceCents: bigint };
export type Settings = { pctBp: bigint; minCents: bigint };
export type Facts = {
  status: string;
  planned: Planned[];
  discountCents: bigint;
  mmChapters: MmChapter[];
  mmTotals: { contractCents: bigint; invoicedCents: bigint };
  actual: Actual[];
  settings: Settings;
};
export type Group = {
  key: string;
  label: string;
  plannedSellCents: bigint;
  plannedCostCents: bigint;
  actualSellCents: bigint | null; // enkel per hoofdstuk bekend
  actualCostCents: bigint;
  pendingCostCents: bigint;
  diffCents: bigint; // werkelijk − gepland (kost)
  diffBp: bigint | null; // diffCents / geplande kost, null zonder geplande kost
  plannedMarginCents: bigint;
  actualMarginCents: bigint | null;
  flag: Flag;
};
export type Result = {
  plannedSellCents: bigint;
  plannedCostCents: bigint;
  plannedMarginCents: bigint;
  plannedMarginBp: bigint | null;
  actualSellCents: bigint;
  actualCostCents: bigint;
  pendingCostCents: bigint;
  actualMarginCents: bigint;
  actualMarginBp: bigint | null;
  diffCents: bigint;
  diffBp: bigint | null;
  marginDeltaCents: bigint;
  invoicedCents: bigint;
  flag: Flag;
  finished: boolean;
  byOrg: Group[];
  byChapter: Group[];
  byType: Group[];
};

/** Een optioneel veld uit de backend: undefined (gegenereerde client), [] of [x] (rauwe Candid) → null of de waarde. */
export function nz<T>(x: T | null | undefined | [] | [T]): T | null {
  if (Array.isArray(x)) return x.length ? (x[0] as T) : null;
  return x === undefined ? null : (x as T);
}

export const NO_ORG = "eigen";
export const NO_CHAPTER = "(niet toe te wijzen)";

const abs = (x: bigint) => (x < 0n ? -x : x);
/** a / b, half weg van nul. */
export function roundDiv(a: bigint, b: bigint): bigint {
  if (b < 0n) return roundDiv(-a, -b);
  const q = a / b;
  const r = a % b;
  const twice = abs(r) * 2n;
  if (twice >= b) return a < 0n ? q - 1n : q + 1n;
  return q;
}
export const bpOf = (part: bigint, whole: bigint): bigint | null => (whole === 0n ? null : roundDiv(part * 10_000n, whole));

export function finished(status: string): boolean {
  return status === "opgeleverd" || status === "nazorg";
}

/** De afwijking van één groep tegenover de drempel. */
export function flagOf(plannedCost: bigint, actualCost: bigint, s: Settings, isFinished: boolean): Flag {
  const diff = actualCost - plannedCost;
  if (abs(diff) < s.minCents) return "ok";
  if (plannedCost > 0n && abs(diff) * 10_000n < s.pctBp * plannedCost) return "ok";
  if (diff > 0n) return plannedCost === 0n ? "ongepland" : "meer";
  return isFinished ? "minder" : "ok";
}

/** Posttype van een geplande post: haar vorm ("vast", "regie", …). */
export const plannedType = (p: Planned) => p.form;
/** Posttype van een werkelijke regel: een post van de offerte krijgt de vorm van die post; uren zijn "regie"; de rest "kosten". */
export function actualType(a: Actual): string {
  if (a.kind === "post") return a.form === "" ? "post" : a.form;
  if (a.kind === "regie" || a.kind === "ploeg") return "regie";
  return "kosten";
}

type Acc = { label: string; ps: bigint; pc: bigint; as: bigint | null; ac: bigint; pend: bigint };
function group(
  isFinished: boolean,
  s: Settings,
  rows: { key: string; label: string; plannedSell?: bigint; plannedCost?: bigint; actualSell?: bigint; actualCost?: bigint; pending?: bigint }[],
  order: (a: Group, b: Group) => number,
): Group[] {
  const m = new Map<string, Acc>();
  for (const r of rows) {
    const x = m.get(r.key) ?? { label: r.label, ps: 0n, pc: 0n, as: null, ac: 0n, pend: 0n };
    x.ps += r.plannedSell ?? 0n;
    x.pc += r.plannedCost ?? 0n;
    if (r.actualSell !== undefined) x.as = (x.as ?? 0n) + r.actualSell;
    x.ac += r.actualCost ?? 0n;
    x.pend += r.pending ?? 0n;
    m.set(r.key, x);
  }
  const out: Group[] = [];
  for (const [key, x] of m) {
    const diff = x.ac - x.pc;
    out.push({
      key,
      label: x.label,
      plannedSellCents: x.ps,
      plannedCostCents: x.pc,
      actualSellCents: x.as,
      actualCostCents: x.ac,
      pendingCostCents: x.pend,
      diffCents: diff,
      diffBp: bpOf(diff, x.pc),
      plannedMarginCents: x.ps - x.pc,
      actualMarginCents: x.as === null ? null : x.as - x.ac,
      flag: flagOf(x.pc, x.ac, s, isFinished),
    });
  }
  return out.sort(order);
}

// Meest opvallend eerst (grootste afwijking in geld), dan op naam.
const byDiff = (a: Group, b: Group) => (abs(b.diffCents) > abs(a.diffCents) ? 1 : abs(b.diffCents) < abs(a.diffCents) ? -1 : a.label.localeCompare(b.label, "nl"));

export function compute(f: Facts): Result {
  const fin = finished(f.status);
  const s = f.settings;
  let ps = -f.discountCents;
  let pc = 0n;
  for (const p of f.planned) { ps += p.sellCents; pc += nz(p.costCents as bigint | null) ?? 0n; }
  let ac = 0n;
  let pend = 0n;
  for (const a of f.actual) { if (a.status === "goedgekeurd") ac += a.amountCents; else pend += a.amountCents; }
  const sell = f.mmTotals.contractCents;
  const diff = ac - pc;

  // Per OA: de geplande kost per firma (aankoopprijs van de post) tegenover de goedgekeurde facturen van die firma.
  const orgRows = [
    ...f.planned.map((p) => { const o = nz(p.orgId as bigint | null); return { key: o === null ? NO_ORG : String(o), label: o === null ? "Eigen prestatie of zonder aankoopprijs" : p.orgName || `#${o}`, plannedSell: p.sellCents, plannedCost: nz(p.costCents as bigint | null) ?? 0n }; }),
    ...f.actual.map((a) => ({ key: String(a.orgId), label: a.orgName || `#${a.orgId}`, actualCost: a.status === "goedgekeurd" ? a.amountCents : 0n, pending: a.status === "goedgekeurd" ? 0n : a.amountCents })),
  ];
  // Per hoofdstuk: verkoop volgens de min-meerstaat (offerte + saldo), kost via de post van de regel.
  const chRows = [
    ...f.planned.map((p) => ({ key: p.chapter || NO_CHAPTER, label: p.chapter || NO_CHAPTER, plannedSell: p.sellCents, plannedCost: nz(p.costCents as bigint | null) ?? 0n })),
    ...f.mmChapters.map((c) => ({ key: c.chapter || NO_CHAPTER, label: c.chapter || NO_CHAPTER, actualSell: c.offerCents + c.balanceCents })),
    ...f.actual.map((a) => ({ key: a.chapter || NO_CHAPTER, label: a.chapter || NO_CHAPTER, actualCost: a.status === "goedgekeurd" ? a.amountCents : 0n, pending: a.status === "goedgekeurd" ? 0n : a.amountCents })),
  ];
  const tyRows = [
    ...f.planned.map((p) => ({ key: plannedType(p), label: plannedType(p), plannedSell: p.sellCents, plannedCost: nz(p.costCents as bigint | null) ?? 0n })),
    ...f.actual.map((a) => ({ key: actualType(a), label: actualType(a), actualCost: a.status === "goedgekeurd" ? a.amountCents : 0n, pending: a.status === "goedgekeurd" ? 0n : a.amountCents })),
  ];
  return {
    plannedSellCents: ps,
    plannedCostCents: pc,
    plannedMarginCents: ps - pc,
    plannedMarginBp: bpOf(ps - pc, ps),
    actualSellCents: sell,
    actualCostCents: ac,
    pendingCostCents: pend,
    actualMarginCents: sell - ac,
    actualMarginBp: bpOf(sell - ac, sell),
    diffCents: diff,
    diffBp: bpOf(diff, pc),
    marginDeltaCents: sell - ac - (ps - pc),
    invoicedCents: f.mmTotals.invoicedCents,
    flag: flagOf(pc, ac, s, fin),
    finished: fin,
    byOrg: group(fin, s, orgRows, byDiff),
    byChapter: group(fin, s, chRows, (a, b) => a.label.localeCompare(b.label, "nl")),
    byType: group(fin, s, tyRows, byDiff),
  };
}

/** Het overzicht over alle werven: dezelfde regels op de totalen van elke werf. */
export type Brief = { status: string; plannedSellCents: bigint; plannedCostCents: bigint; contractCents: bigint; invoicedCents: bigint; actualCents: bigint; pendingCents: bigint };
export type BriefOut = {
  plannedMarginCents: bigint;
  plannedMarginBp: bigint | null;
  actualMarginCents: bigint;
  actualMarginBp: bigint | null;
  diffCents: bigint;
  diffBp: bigint | null;
  marginDeltaCents: bigint;
  flag: Flag;
};
export function computeBrief(b: Brief, s: Settings): BriefOut {
  const pm = b.plannedSellCents - b.plannedCostCents;
  const am = b.contractCents - b.actualCents;
  const diff = b.actualCents - b.plannedCostCents;
  return { plannedMarginCents: pm, plannedMarginBp: bpOf(pm, b.plannedSellCents), actualMarginCents: am, actualMarginBp: bpOf(am, b.contractCents), diffCents: diff, diffBp: bpOf(diff, b.plannedCostCents), marginDeltaCents: am - pm, flag: flagOf(b.plannedCostCents, b.actualCents, s, finished(b.status)) };
}
