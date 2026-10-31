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

// Lineair in posten × firma's (review L7): de cel van post xi en firma qi staat op plaats xi × nQ + qi.
export function compare(i: CInput): CResult {
  const nI = i.items.length;
  const nQ = i.quotes.length;
  const chapters: string[] = [];
  const chSeen = new Set<string>();
  for (const x of i.items) if (!chSeen.has(x.chapter)) { chSeen.add(x.chapter); chapters.push(x.chapter); }
  const hist = new Map(i.history.map((h) => [h.itemId, h]));
  const thr = i.thresholdBp;
  const lineMaps = i.quotes.map((q) => { const m = new Map<bigint, CLine>(); for (const l of q.lines) if (l.itemId != null && !m.has(l.itemId)) m.set(l.itemId, l); return m; });
  const medians = i.items.map((x) => { const h = hist.get(x.id); return h ? median(h.recent) : null; });

  // 1. Cellen.
  type Raw = Omit<CCell, "lowest">;
  const raw: Raw[] = [];
  i.items.forEach((x, xi) => {
    i.quotes.forEach((q, qi) => {
      const empty: Raw = { itemId: x.id, oaQuoteId: q.id, state: "ontbreekt", unitCents: null, amountCents: null, alt: false, vhChanged: false, unitChanged: false, devLastBp: null, devMedianBp: null, deviates: false };
      let cell: Raw;
      if (q.form !== "posten") cell = { ...empty, state: "geen-detail" };
      else {
        const l = lineMaps[qi].get(x.id);
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
            const h = hist.get(x.id);
            if (h) { const last = h.lastByOrg.find(([o]) => o === q.orgId); if (last) dl = devBp(u, last[1]); }
            const m = medians[xi];
            const dm = m !== null ? devBp(u, m) : null;
            const off = (d: bigint | null) => d !== null && abs(d) > thr;
            cell = { ...empty, state: "prijs", unitCents: u, amountCents: roundDiv(u * x.qtyMilli, 1000n), alt, vhChanged: vh, unitChanged: un, devLastBp: dl, devMedianBp: dm, deviates: off(dl) || off(dm) };
          }
        }
      }
      raw.push(cell);
    });
  });
  const at = (xi: number, qi: number) => raw[xi * nQ + qi];
  const comparable = (c: Raw) => c.state === "prijs" && !c.alt && !c.unitChanged;

  // 2. Laagste per post.
  const lowestOf: (bigint | null)[] = i.items.map((_, xi) => {
    let m: bigint | null = null;
    let n = 0;
    for (let qi = 0; qi < nQ; qi++) { const c = at(xi, qi); if (comparable(c) && c.amountCents != null) { if (m === null || c.amountCents < m) m = c.amountCents; n++; } }
    return n >= 2 ? m : null;
  });
  const cells: CCell[] = raw.map((c, k) => { const m = lowestOf[Math.floor(k / (nQ || 1))]; return { ...c, lowest: comparable(c) && m !== null && c.amountCents === m }; });
  const itemIdx = new Map<bigint, number>();
  i.items.forEach((x, xi) => { if (!itemIdx.has(x.id)) itemIdx.set(x.id, xi); });
  const quoteIdx = new Map<bigint, number>();
  i.quotes.forEach((q, qi) => { if (!quoteIdx.has(q.id)) quoteIdx.set(q.id, qi); });

  // 3. Totalen per firma.
  const quotes: CQuoteTotals[] = i.quotes.map((q, qi) => {
    const disc = (g: bigint) => (q.discountBp == null || q.discountBp === 0n ? 0n : roundDiv(g * q.discountBp, 10_000n));
    if (q.form === "posten") {
      const sums = new Map<string, bigint>();
      let priced = 0n;
      i.items.forEach((x, xi) => { const a = at(xi, qi).amountCents; if (a != null) { sums.set(x.chapter, (sums.get(x.chapter) ?? 0n) + a); priced += 1n; } });
      const chs = chapters.filter((ch) => sums.has(ch)).map((ch) => [ch, sums.get(ch)!] as [string, bigint]);
      let gross = chs.reduce((s, [, v]) => s + v, 0n);
      let own = 0n;
      for (const l of q.lines) if (l.itemId == null && l.amountCents != null) own += l.amountCents;
      gross += own;
      const d = disc(gross);
      return { oaQuoteId: q.id, chapters: chs, ownCents: own, gross, discount: d, net: gross - d, priced, items: BigInt(nI), complete: priced === BigInt(nI) };
    }
    if (q.form === "hoofdstukken") {
      const gross = q.chapterTotals.reduce((s, [, v]) => s + v, 0n);
      const d = disc(gross);
      const given = new Set(q.chapterTotals.map(([n]) => n));
      return { oaQuoteId: q.id, chapters: q.chapterTotals, ownCents: 0n, gross, discount: d, net: gross - d, priced: 0n, items: BigInt(nI), complete: chapters.every((ch) => given.has(ch)) };
    }
    return { oaQuoteId: q.id, chapters: [], ownCents: 0n, gross: q.netCents, discount: 0n, net: q.netCents, priced: 0n, items: BigInt(nI), complete: true };
  });

  // 4. Laagste per hoofdstuk en in totaal.
  const chapterRes: CChapter[] = chapters.map((ch) => {
    const cand: [bigint, bigint][] = [];
    i.quotes.forEach((q, qi) => {
      let full = false;
      if (q.form === "posten") { full = true; i.items.forEach((x, xi) => { if (x.chapter === ch) { const c = at(xi, qi); if (c.state !== "prijs" || c.unitChanged) full = false; } }); }
      else if (q.form === "hoofdstukken") full = q.chapterTotals.some(([n]) => n === ch);
      if (full) { const v = quotes[qi].chapters.find(([n]) => n === ch); if (v) cand.push([q.id, v[1]]); }
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
    const xi = itemIdx.get(p.itemId);
    const qi = quoteIdx.get(p.oaQuoteId);
    const a = xi !== undefined && qi !== undefined ? at(xi, qi).amountCents : null;
    if (a != null && xi !== undefined) {
      chosen += 1n;
      total += a;
      const ch = i.items[xi].chapter;
      sums.set(ch, (sums.get(ch) ?? 0n) + a);
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
