// Het model van één offerteversie zoals de browser het bijhoudt (stap 2.4): hoofdstukken en lijnen met hun prijs, wat
// veranderde sinds de laatste bewaring, en de bewaaropdrachten in stukken met de totalen die de backend ernaast legt.
// Zonder React en zonder backend-imports: de editor (screens/Offerte.tsx) en de tests (tests/offerte-lib.mjs) gebruiken
// hetzelfde model. Rekenen gebeurt enkel in calc.ts.
import { calcLine, calcTotals, type CalcLine, type Kind, type LineOut, type Rule, type Totals } from "./calc.ts";

export type Price = { cost: bigint | null; rule: Rule; reason: string; orgId: bigint | null; source: string; libCostId: bigint | null };
type ChapterData = { code: string; title: string; order: bigint; libChapterId: bigint | null };
type LineData = {
  chapter: string; // sleutel van het hoofdstuk
  order: bigint;
  kind: Kind;
  code: string;
  title: string;
  text: string;
  specRef: string;
  qtyMilli: bigint;
  unit: string;
  form: string;
  libItemId: bigint | null;
  libItemVersion: bigint | null;
  price: Price;
};
// base = de stand op de server (null = nieuw, nog niet bewaard); removed = weg bij de volgende bewaring.
export type Chapter = ChapterData & { key: string; id: bigint | null; seq: number; removed: boolean; base: (ChapterData & { removed: boolean }) | null; dirty: boolean };
export type Line = LineData & { key: string; id: bigint | null; removed: boolean; base: (LineData & { removed: boolean }) | null; dirty: boolean };
export type Header = { title: string; vatBp: bigint; clientOrgId: bigint | null; validDays: bigint; intro: string; note: string; standardMarginBp: bigint };
export type Model = { versionId: bigint; rev: bigint; header: Header; headerBase: Header; chapters: Chapter[]; lines: Line[]; next: number };

export type ChapterRef = { id: bigint } | { ref: string };
export type ChapterOp = { id: bigint | null; ref: string; code: string; title: string; order: bigint; libChapterId: bigint | null; remove: boolean };
export type LineOp = Omit<LineData, "chapter"> & { id: bigint | null; ref: string; chapter: ChapterRef; remove: boolean };
export type Expect = { subtotal: bigint; vat: bigint; total: bigint; optionsPlus: bigint; optionsMinus: bigint; cost: bigint; margin: bigint; chapters: { chapter: ChapterRef; sell: bigint }[] };
export type Batch = { header: Header | null; chapterOps: ChapterOp[]; lineOps: LineOp[]; expect: Expect; keys: string[] };

export const MAX_OPS = 300;

// ── Laden ───────────────────────────────────────────────────────────────
export type Loaded = {
  versionId: bigint;
  rev: bigint;
  header: Header;
  chapters: (ChapterData & { id: bigint })[];
  lines: (Omit<LineData, "chapter"> & { id: bigint; chapterId: bigint })[];
};

export function load(x: Loaded): Model {
  const chapters: Chapter[] = x.chapters.map((c, i) => ({ ...c, key: `i${c.id}`, id: c.id, seq: i, removed: false, base: { ...c, removed: false }, dirty: false }));
  const lines: Line[] = x.lines.map((l) => {
    const d: LineData = { chapter: `i${l.chapterId}`, order: l.order, kind: l.kind, code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unit: l.unit, form: l.form, libItemId: l.libItemId, libItemVersion: l.libItemVersion, price: { ...l.price } };
    return { ...d, key: `i${l.id}`, id: l.id, removed: false, base: { ...d, price: { ...d.price }, removed: false }, dirty: false };
  });
  return { versionId: x.versionId, rev: x.rev, header: { ...x.header }, headerBase: { ...x.header }, chapters, lines, next: 1 };
}

// ── Lezen ───────────────────────────────────────────────────────────────
export function activeChapters(m: Model): Chapter[] {
  return m.chapters.filter((c) => !c.removed).sort((a, b) => (a.order === b.order ? a.seq - b.seq : a.order < b.order ? -1 : 1));
}

export function linesOf(m: Model, chapterKey: string): Line[] {
  return m.lines.filter((l) => !l.removed && l.chapter === chapterKey).sort((a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1));
}

export function activeLines(m: Model): Line[] {
  return activeChapters(m).flatMap((c) => linesOf(m, c.key));
}

function calcOf(l: { chapter: string; kind: Kind; qtyMilli: bigint; price: Price }): CalcLine {
  return { chapter: l.chapter, kind: l.kind, qtyMilli: l.qtyMilli, cost: l.price.cost, rule: l.price.rule };
}

export function lineOut(m: Model, l: Line): LineOut {
  return calcLine(calcOf(l), m.header.standardMarginBp);
}

export function totals(m: Model): Totals {
  return calcTotals(activeChapters(m).map((c) => c.key), activeLines(m).map(calcOf), m.header.vatBp, m.header.standardMarginBp);
}

// ── Bewerken ────────────────────────────────────────────────────────────
export function setHeader(m: Model, h: Partial<Header>): void {
  m.header = { ...m.header, ...h };
}

export function headerDirty(m: Model): boolean {
  const a = m.header;
  const b = m.headerBase;
  return a.title !== b.title || a.vatBp !== b.vatBp || a.clientOrgId !== b.clientOrgId || a.validDays !== b.validDays || a.intro !== b.intro || a.note !== b.note || a.standardMarginBp !== b.standardMarginBp;
}

const STEP = 10n;

export function addChapter(m: Model, c: Partial<ChapterData> & { title: string }): Chapter {
  const last = activeChapters(m).at(-1);
  const ch: Chapter = { code: c.code ?? "", title: c.title, order: c.order ?? (last ? last.order + STEP : STEP), libChapterId: c.libChapterId ?? null, key: `n${m.next++}`, id: null, seq: 10_000 + m.next, removed: false, base: null, dirty: true };
  m.chapters.push(ch);
  return ch;
}

export function updateChapter(m: Model, key: string, c: Partial<ChapterData>): void {
  const ch = m.chapters.find((x) => x.key === key);
  if (!ch) throw new Error(`onbekend hoofdstuk ${key}`);
  Object.assign(ch, c, { dirty: true });
}

/** Een hoofdstuk weg met al zijn lijnen. */
export function removeChapter(m: Model, key: string): void {
  for (const l of m.lines.filter((x) => x.chapter === key && !x.removed)) removeLine(m, l.key);
  const ch = m.chapters.find((x) => x.key === key);
  if (!ch) return;
  if (ch.id === null) m.chapters = m.chapters.filter((x) => x.key !== key);
  else Object.assign(ch, { removed: true, dirty: true });
}

export const emptyPrice = (): Price => ({ cost: null, rule: null, reason: "", orgId: null, source: "", libCostId: null });

export function addLine(m: Model, chapterKey: string, l: Partial<LineData> & { kind?: Kind }, after?: string): Line {
  const rows = linesOf(m, chapterKey);
  let order: bigint;
  const i = after ? rows.findIndex((r) => r.key === after) : -1;
  if (i >= 0) {
    const a = rows[i].order;
    const b = rows[i + 1]?.order;
    if (b === undefined) order = a + STEP;
    else if (b - a > 1n) order = a + (b - a) / 2n;
    else {
      renumber(m, chapterKey);
      return addLine(m, chapterKey, l, after);
    }
  } else order = rows.length ? rows[rows.length - 1].order + STEP : STEP;
  const line: Line = {
    chapter: chapterKey,
    order,
    kind: l.kind ?? "item",
    code: l.code ?? "",
    title: l.title ?? "",
    text: l.text ?? "",
    specRef: l.specRef ?? "",
    qtyMilli: l.qtyMilli ?? 0n,
    unit: l.unit ?? (l.kind === "text" ? "" : "st"),
    form: l.form ?? "fixed",
    libItemId: l.libItemId ?? null,
    libItemVersion: l.libItemVersion ?? null,
    price: l.price ? { ...l.price } : emptyPrice(),
    key: `n${m.next++}`,
    id: null,
    removed: false,
    base: null,
    dirty: true,
  };
  m.lines.push(line);
  return line;
}

export function updateLine(m: Model, key: string, l: Partial<LineData>): void {
  const line = m.lines.find((x) => x.key === key);
  if (!line) throw new Error(`onbekende lijn ${key}`);
  Object.assign(line, l, { dirty: true });
  if (l.price) line.price = { ...l.price };
}

export function removeLine(m: Model, key: string): void {
  const line = m.lines.find((x) => x.key === key);
  if (!line) return;
  if (line.id === null) m.lines = m.lines.filter((x) => x.key !== key);
  else Object.assign(line, { removed: true, dirty: true });
}

/** Een lijn een plaats op of neer binnen haar hoofdstuk (verwisselt de volgorde met de buur). */
export function moveLine(m: Model, key: string, dir: -1 | 1): void {
  const line = m.lines.find((x) => x.key === key);
  if (!line) return;
  const rows = linesOf(m, line.chapter);
  const i = rows.findIndex((r) => r.key === key);
  const j = i + dir;
  if (j < 0 || j >= rows.length) return;
  if (rows[i].order === rows[j].order) renumber(m, line.chapter);
  const a = rows[i].order;
  rows[i].order = rows[j].order;
  rows[j].order = a;
  rows[i].dirty = true;
  rows[j].dirty = true;
}

/** Een weggehaalde (nog niet bewaarde) lijn terug. */
export function restoreLine(m: Model, key: string): void {
  const line = m.lines.find((x) => x.key === key);
  if (line && line.removed) Object.assign(line, { removed: false, dirty: true });
}

/** De lijnen van een hoofdstuk, ook die bij de volgende bewaring weggaan (doorstreept in de editor). */
export function rowsOf(m: Model, chapterKey: string): Line[] {
  return m.lines.filter((l) => l.chapter === chapterKey).sort((a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1));
}

/** Een hoofdstuk een plaats op of neer. */
export function moveChapter(m: Model, key: string, dir: -1 | 1): void {
  const rows = activeChapters(m);
  const i = rows.findIndex((r) => r.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  let o = STEP;
  for (const r of rows) {
    if (r.order !== o) { r.order = o; r.dirty = true; }
    o += STEP;
  }
  const a = rows[i].order;
  rows[i].order = rows[j].order;
  rows[j].order = a;
  rows[i].dirty = true;
  rows[j].dirty = true;
}

function renumber(m: Model, chapterKey: string): void {
  let o = STEP;
  for (const r of linesOf(m, chapterKey)) {
    if (r.order !== o) { r.order = o; r.dirty = true; }
    o += STEP;
  }
}

// ── Wat er te bewaren valt ──────────────────────────────────────────────
function changedChapter(c: Chapter): boolean {
  if (!c.dirty) return false;
  if (!c.base) return !c.removed;
  const b = c.base;
  return c.removed !== b.removed || c.code !== b.code || c.title !== b.title || c.order !== b.order || c.libChapterId !== b.libChapterId;
}

function samePrice(a: Price, b: Price): boolean {
  const r = (x: Rule) => (x === null ? "" : "margin" in x ? `m${x.margin}` : `p${x.price}`);
  return a.cost === b.cost && r(a.rule) === r(b.rule) && a.reason === b.reason && a.orgId === b.orgId && a.source === b.source && a.libCostId === b.libCostId;
}

function changedLine(l: Line): boolean {
  if (!l.dirty) return false;
  if (!l.base) return !l.removed;
  const b = l.base;
  return l.removed !== b.removed || l.chapter !== b.chapter || l.order !== b.order || l.kind !== b.kind || l.code !== b.code || l.title !== b.title || l.text !== b.text || l.specRef !== b.specRef || l.qtyMilli !== b.qtyMilli || l.unit !== b.unit || l.form !== b.form || l.libItemId !== b.libItemId || l.libItemVersion !== b.libItemVersion || !samePrice(l.price, b.price);
}

export function pendingCount(m: Model): number {
  return m.chapters.filter(changedChapter).length + m.lines.filter(changedLine).length + (headerDirty(m) ? 1 : 0);
}

const refOf = (m: Model, chapterKey: string): ChapterRef => {
  const c = m.chapters.find((x) => x.key === chapterKey);
  return c && c.id !== null ? { id: c.id } : { ref: chapterKey };
};

/** Het volgende stuk om te bewaren (≤ MAX_OPS), met de totalen ZOALS ZE NA DIT STUK zijn: wat nog niet in een stuk zit,
 *  telt in zijn bewaarde vorm (of niet, als het nieuw is). null = niets te bewaren. */
export function nextBatch(m: Model, max = MAX_OPS): Batch | null {
  const chs = m.chapters.filter(changedChapter);
  const lns = m.lines.filter(changedLine);
  const header = headerDirty(m) ? { ...m.header } : null;
  if (!chs.length && !lns.length && !header) return null;
  // Eerst de hoofdstukken (≤ 100, dus allemaal in het eerste stuk: een lijn in een nieuw hoofdstuk kan dan altijd mee),
  // dan zoveel lijnen als er nog passen, de verwijderde eerst. Een hoofdstuk gaat pas weg in het stuk waarin ook al zijn
  // lijnen (zoals ze op de server staan) weg of verhuisd zijn; anders weigert de backend terecht.
  const keep = chs.filter((c) => !c.removed);
  const sorted = [...lns].sort((a, b) => Number(b.removed) - Number(a.removed));
  const takeLn = sorted.slice(0, Math.max(0, max - chs.length));
  const inBatch = new Set(takeLn.map((l) => l.key));
  const gone = chs.filter((c) => c.removed && m.lines.every((l) => inBatch.has(l.key) || !l.base || l.base.removed || l.base.chapter !== c.key));
  const takeCh = [...keep, ...gone];
  const keys = new Set([...takeCh.map((c) => c.key), ...takeLn.map((l) => l.key)]);
  // De stand na dit stuk.
  const vatBp = (header ?? m.headerBase).vatBp;
  const std = (header ?? m.headerBase).standardMarginBp;
  const stateCh = m.chapters
    .map((c) => (keys.has(c.key) || !changedChapter(c) ? (c.removed ? null : c) : c.base && !c.base.removed ? { ...c, ...c.base } : null))
    .filter((c): c is Chapter => c !== null)
    .sort((a, b) => (a.order === b.order ? a.seq - b.seq : a.order < b.order ? -1 : 1));
  const chKeys = new Set(stateCh.map((c) => c.key));
  const stateLn = m.lines
    .map((l) => (keys.has(l.key) || !changedLine(l) ? (l.removed ? null : l) : l.base && !l.base.removed ? { ...l, ...l.base } : null))
    .filter((l): l is Line => l !== null && chKeys.has(l.chapter));
  const t = calcTotals(stateCh.map((c) => c.key), stateLn.map(calcOf), vatBp, std);
  return {
    header,
    chapterOps: takeCh.map((c) => ({ id: c.id, ref: c.key, code: c.code, title: c.title, order: c.order, libChapterId: c.libChapterId, remove: c.removed })),
    lineOps: takeLn.map((l) => ({ id: l.id, ref: l.key, chapter: refOf(m, l.chapter), order: l.order, kind: l.kind, code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unit: l.unit, form: l.form, libItemId: l.libItemId, libItemVersion: l.libItemVersion, price: { ...l.price }, remove: l.removed })),
    expect: {
      subtotal: t.subtotal,
      vat: t.vat,
      total: t.total,
      optionsPlus: t.optionsPlus,
      optionsMinus: t.optionsMinus,
      cost: t.cost,
      margin: t.margin,
      chapters: t.chapters.map((c) => ({ chapter: refOf(m, c.chapter), sell: c.sell })),
    },
    keys: [...keys],
  };
}

/** Na een geslaagde bewaring: de nieuwe ids, de nieuwe stand en wat bewaard is, is niet meer "gewijzigd". */
export function applySaved(m: Model, b: Batch, rev: bigint, refs: [string, bigint][]): void {
  const ids = new Map(refs);
  m.rev = rev;
  if (b.header) m.headerBase = { ...b.header };
  const keys = new Set(b.keys);
  for (const c of m.chapters) {
    if (!keys.has(c.key)) continue;
    if (c.id === null) c.id = ids.get(c.key) ?? null;
    c.base = { code: c.code, title: c.title, order: c.order, libChapterId: c.libChapterId, removed: c.removed };
    c.dirty = false;
  }
  for (const l of m.lines) {
    if (!keys.has(l.key)) continue;
    if (l.id === null) l.id = ids.get(l.key) ?? null;
    l.base = { chapter: l.chapter, order: l.order, kind: l.kind, code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unit: l.unit, form: l.form, libItemId: l.libItemId, libItemVersion: l.libItemVersion, price: { ...l.price }, removed: l.removed };
    l.dirty = false;
  }
  m.chapters = m.chapters.filter((c) => !(c.removed && !c.dirty));
  m.lines = m.lines.filter((l) => !(l.removed && !l.dirty));
}
