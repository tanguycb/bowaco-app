// De vergelijking van OA-offertes op één prijsvraag (stap 2c.3, ontwerp 2c §4.3, G4): dezelfde regels als
// src/backend/lib/TenderCompare.mo. De server stuurt invoer én uitkomst; de browser rekent na (verschil = melding). Wijzig je een
// regel, verhoog dan `version` (beide). Regels: zie het Motoko-bestand. Zonder React en zonder backend-imports: Node draait dit
// bestand rechtstreeks (tests/oaofferte-2c3.mjs).
import { roundDiv } from "./calc.ts";

export const version = 1n;

export type CIncluded = { yes: null } | { no: null } | { alt: string };
export type CLine = { itemId: bigint | null; qtyMilli: bigint; unitCents: bigint | null; amountCents: bigint | null; included: CIncluded; changed: string[] };
export type CItem = { id: bigint; chapter: string; qtyMilli: bigint; unit: string; libItemId: bigint | null };
export type CQuote = { id: bigint; orgId: bigint; form: string; discountBp: bigint | null; netCents: bigint; lines: CLine[]; chapterTotals: [string, bigint][] };
export type CHistory = { itemId: bigint; lastByOrg: [bigint, bigint][]; recent: bigint[] };
export type CPick = { itemId: bigint; oaQuoteId: bigint };
export type CInput = { items: CItem[]; quotes: CQuote[]; history: CHistory[]; thresholdBp: bigint; picks: CPick[] };

export type CCell = { itemId: bigint; oaQuoteId: bigint; state: string; unitCents: bigint | null; amountCents: bigint | null; alt: boolean; vhChanged: boolean; unitChanged: boolean; lowest: boolean; devLastBp: bigint | null; devMedianBp: bigint | null; deviates: boolean };
export type CQuoteTotals = { oaQuoteId: bigint; chapters: [string, bigint][]; ownCents: bigint; gross: bigint; discount: bigint; net: bigint; priced: bigint; items: bigint; complete: boolean };
export type CChapter = { chapter: string; lowest: bigint[] };
export type CChoice = { chosen: bigint; stale: bigint[]; chapters: [string, bigint][]; total: bigint };
export type CResult = { version: bigint; cells: CCell[]; quotes: CQuoteTotals[]; chapters: CChapter[]; lowestTotal: bigint[]; choice: CChoice };

const abs = (x: bigint) => (x < 0n ? -x : x);

export function median(xs: bigint[]): bigint | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : roundDiv(s[n / 2 - 1] + s[n / 2], 2n);
}
const devBp = (u: bigint, ref: bigint): bigint | null => (ref <= 0n ? null : roundDiv((u - ref) * 10_000n, ref));

function lowestIds(cand: [bigint, bigint][]): bigint[] {
  if (cand.length < 2) return [];
  let m = cand[0][1];
  for (const [, v] of cand) if (v < m) m = v;
  return cand.filter(([, v]) => v === m).map(([id]) => id);
}

export function compare(i: CInput): CResult {
  const chapters: string[] = [];
  for (const x of i.items) if (!chapters.includes(x.chapter)) chapters.push(x.chapter);
  const hist = new Map(i.history.map((h) => [h.itemId, h]));
  const thr = i.thresholdBp;

  // 1. Cellen.
  type Raw = Omit<CCell, "lowest">;
  const raw: Raw[] = [];
  for (const x of i.items) {
    for (const q of i.quotes) {
      const empty: Raw = { itemId: x.id, oaQuoteId: q.id, state: "ontbreekt", unitCents: null, amountCents: null, alt: false, vhChanged: false, unitChanged: false, devLastBp: null, devMedianBp: null, deviates: false };
      let cell: Raw;
      if (q.form !== "posten") cell = { ...empty, state: "geen-detail" };
      else {
        const l = q.lines.find((y) => y.itemId === x.id);
        if (!l) cell = empty;
        else {
          const vh = l.changed.includes("vh");
          const un = l.changed.includes("eenheid");
          const alt = "alt" in l.included;
          if ("no" in l.included) cell = { ...empty, state: "niet-inbegrepen", vhChanged: vh, unitChanged: un };
          else if (l.unitCents == null) cell = { ...empty, state: "geen-prijs", alt, vhChanged: vh, unitChanged: un };
          else {
            const u = l.unitCents;
            let dl: bigint | null = null;
            let dm: bigint | null = null;
            const h = hist.get(x.id);
            if (h) {
              const last = h.lastByOrg.find(([o]) => o === q.orgId);
              if (last) dl = devBp(u, last[1]);
              const m = median(h.recent);
              if (m !== null) dm = devBp(u, m);
            }
            const off = (d: bigint | null) => d !== null && abs(d) > thr;
            cell = { ...empty, state: "prijs", unitCents: u, amountCents: roundDiv(u * x.qtyMilli, 1000n), alt, vhChanged: vh, unitChanged: un, devLastBp: dl, devMedianBp: dm, deviates: off(dl) || off(dm) };
          }
        }
      }
      raw.push(cell);
    }
  }
  const comparable = (c: Raw) => c.state === "prijs" && !c.alt && !c.unitChanged;

  // 2. Laagste per post.
  const lowestOf = new Map<bigint, bigint>();
  for (const x of i.items) {
    const cs = raw.filter((c) => c.itemId === x.id && comparable(c));
    if (cs.length >= 2) {
      let m: bigint | null = null;
      for (const c of cs) if (c.amountCents != null && (m === null || c.amountCents < m)) m = c.amountCents;
      if (m !== null) lowestOf.set(x.id, m);
    }
  }
  const cells: CCell[] = raw.map((c) => ({ ...c, lowest: comparable(c) && lowestOf.has(c.itemId) && c.amountCents === lowestOf.get(c.itemId) }));
  const cellOf = (itemId: bigint, qid: bigint) => cells.find((c) => c.itemId === itemId && c.oaQuoteId === qid);
  const chapterOf = new Map(i.items.map((x) => [x.id, x.chapter]));

  // 3. Totalen per firma.
  const nItems = BigInt(i.items.length);
  const quotes: CQuoteTotals[] = i.quotes.map((q) => {
    const disc = (g: bigint) => (q.discountBp == null || q.discountBp === 0n ? 0n : roundDiv(g * q.discountBp, 10_000n));
    if (q.form === "posten") {
      const chs: [string, bigint][] = [];
      let priced = 0n;
      let gross = 0n;
      for (const ch of chapters) {
        let sum = 0n;
        let any = false;
        for (const x of i.items) {
          if (x.chapter !== ch) continue;
          const c = cellOf(x.id, q.id);
          if (c && c.amountCents != null) { sum += c.amountCents; any = true; priced += 1n; }
        }
        if (any) { chs.push([ch, sum]); gross += sum; }
      }
      let own = 0n;
      for (const l of q.lines) if (l.itemId == null && l.amountCents != null) own += l.amountCents;
      gross += own;
      const d = disc(gross);
      return { oaQuoteId: q.id, chapters: chs, ownCents: own, gross, discount: d, net: gross - d, priced, items: nItems, complete: priced === nItems };
    }
    if (q.form === "hoofdstukken") {
      const gross = q.chapterTotals.reduce((s, [, v]) => s + v, 0n);
      const d = disc(gross);
      const complete = chapters.every((ch) => q.chapterTotals.some(([n]) => n === ch));
      return { oaQuoteId: q.id, chapters: q.chapterTotals, ownCents: 0n, gross, discount: d, net: gross - d, priced: 0n, items: nItems, complete };
    }
    return { oaQuoteId: q.id, chapters: [], ownCents: 0n, gross: q.netCents, discount: 0n, net: q.netCents, priced: 0n, items: nItems, complete: true };
  });

  // 4. Laagste per hoofdstuk en in totaal.
  const chapterRes: CChapter[] = chapters.map((ch) => {
    const cand: [bigint, bigint][] = [];
    i.quotes.forEach((q, k) => {
      const full = q.form === "posten"
        ? i.items.filter((x) => x.chapter === ch).every((x) => { const c = cellOf(x.id, q.id); return !!c && c.state === "prijs" && !c.unitChanged; })
        : q.form === "hoofdstukken" ? q.chapterTotals.some(([n]) => n === ch) : false;
      if (full) { const v = quotes[k].chapters.find(([n]) => n === ch); if (v) cand.push([q.id, v[1]]); }
    });
    return { chapter: ch, lowest: lowestIds(cand) };
  });
  const lowestTotal = lowestIds(quotes.filter((t) => t.complete).map((t) => [t.oaQuoteId, t.net] as [bigint, bigint]));

  // 5. De keuze.
  let chosen = 0n;
  const stale: bigint[] = [];
  const sums = new Map<string, bigint>();
  let total = 0n;
  for (const p of i.picks) {
    const c = cellOf(p.itemId, p.oaQuoteId);
    if (c && c.amountCents != null) {
      chosen += 1n;
      total += c.amountCents;
      const ch = chapterOf.get(p.itemId) ?? "";
      sums.set(ch, (sums.get(ch) ?? 0n) + c.amountCents);
    } else stale.push(p.itemId);
  }
  const choiceChs = chapters.filter((ch) => sums.has(ch)).map((ch) => [ch, sums.get(ch)!] as [string, bigint]);
  return { version, cells, quotes, chapters: chapterRes, lowestTotal, choice: { chosen, stale, chapters: choiceChs, total } };
}

/** Voor de vergelijking: een lege optie (null of undefined, bindgen laat ze weg) telt als afwezig; velden in vaste volgorde (candid levert ze in de volgorde van hun hash). */
export function normalize(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(normalize);
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(x as Record<string, unknown>).sort()) { const v = (x as Record<string, unknown>)[k]; if (v !== null && v !== undefined) o[k] = normalize(v); }
    return o;
  }
  return x;
}

/** Twee uitkomsten gelijk? (diepe vergelijking na normalize; volgorde telt). */
export function sameResult(a: CResult, b: CResult): boolean {
  const s = (v: unknown) => JSON.stringify(normalize(v), (_, y) => (typeof y === "bigint" ? `${y}n` : y));
  return s(a) === s(b);
}
