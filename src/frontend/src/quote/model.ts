// Het model van één offerteversie zoals de browser het bijhoudt (stap 2.4): hoofdstukken en lijnen met hun prijs, wat
// veranderde sinds de laatste bewaring, en de bewaaropdrachten in stukken met de totalen die de backend ernaast legt.
// Zonder React en zonder backend-imports: de editor (screens/Offerte.tsx) en de tests (tests/offerte-lib.mjs) gebruiken
// hetzelfde model. Rekenen gebeurt enkel in calc.ts.
import { calcLine, calcTotals, type CalcLine, type Discount, type Kind, type LineOut, type Rule, type Totals } from "./calc.ts";

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
// 2c.1: de vorm en de voorwaarden van de versie (QuoteCalc versie 2). `form` = wat de editor nu toont, `formBase` = wat op
// de server staat (daarmee rekent saveQuoteDraft); saveQuoteForm bewaart het verschil (nadat de lijnen bewaard zijn).
export type Pick = { classId: bigint | null; marginBp: bigint };
type SubgroupData = { chapter: string; title: string; order: bigint };
export type Subgroup = SubgroupData & { key: string; id: bigint | null; removed: boolean; base: (SubgroupData & { removed: boolean }) | null };
export type RegieTerms = { orgId: bigint | null; cost: bigint; sell: bigint };
export type Form = {
  hideZeroLines: boolean;
  regieText: boolean;
  textBlockKeys: string[];
  chapterMargins: Map<string, Pick>; // hoofdstuksleutel → in de versie vastgelegde marge
  regie: RegieTerms | null;
  discount: Discount;
  discountText: string;
  lineSub: Map<string, string>; // lijnsleutel → subgroepsleutel
  lineShow: Map<string, boolean>; // lijnsleutel → toon toch (of verberg) bij hoeveelheid 0
};
// Wat de bibliotheek en de versie leveren zonder dat de editor ze wijzigt: koppelingen (enkel in een ontwerp) en de marges
// per leverancier die de versie al vastlegde.
export type Terms = { live: boolean; orgFixed: Map<string, Pick>; linkCh: Map<string, Pick>; linkOrg: Map<string, Pick> };
export type Model = { versionId: bigint; rev: bigint; header: Header; headerBase: Header; chapters: Chapter[]; lines: Line[]; next: number; v2: boolean; terms: Terms; form: Form; formBase: Form; subgroups: Subgroup[] };

export type ChapterRef = { id: bigint } | { ref: string };
export type ChapterOp = { id: bigint | null; ref: string; code: string; title: string; order: bigint; libChapterId: bigint | null; remove: boolean };
export type LineOp = Omit<LineData, "chapter"> & { id: bigint | null; ref: string; chapter: ChapterRef; remove: boolean };
export type Expect = { subtotal: bigint; vat: bigint; total: bigint; optionsPlus: bigint; optionsMinus: bigint; cost: bigint; margin: bigint; chapters: { chapter: ChapterRef; sell: bigint }[] };
export type Batch = { header: Header | null; chapterOps: ChapterOp[]; lineOps: LineOp[]; expect: Expect; keys: string[] };

export const MAX_OPS = 300;

// ── Laden ───────────────────────────────────────────────────────────────
export type LoadedForm = {
  hideZeroLines: boolean;
  regieText: boolean;
  textBlockKeys: string[];
  subgroups: { id: bigint; chapterId: bigint; title: string; order: bigint }[];
  lineForms: { lineId: bigint; subgroupId: bigint | null; showToClient: boolean | null }[];
  // vertrouwelijk (enkel #full): leeg voor wie de marges niet ziet
  chapterMargins: { id: bigint; classId: bigint | null; marginBp: bigint; fixed: boolean }[];
  orgMargins: { id: bigint; classId: bigint | null; marginBp: bigint; fixed: boolean }[];
  links: { key: string; classId: bigint; marginBp: bigint }[];
  regie: RegieTerms | null;
  discount: Discount;
  discountText: string;
  live: boolean;
};
export type Loaded = {
  versionId: bigint;
  rev: bigint;
  header: Header;
  chapters: (ChapterData & { id: bigint })[];
  lines: (Omit<LineData, "chapter"> & { id: bigint; chapterId: bigint })[];
  form?: LoadedForm | null;
};

export const emptyForm = (): Form => ({ hideZeroLines: true, regieText: false, textBlockKeys: [], chapterMargins: new Map(), regie: null, discount: null, discountText: "", lineSub: new Map(), lineShow: new Map() });
export const cloneForm = (f: Form): Form => ({ ...f, textBlockKeys: [...f.textBlockKeys], chapterMargins: new Map(f.chapterMargins), regie: f.regie ? { ...f.regie } : null, lineSub: new Map(f.lineSub), lineShow: new Map(f.lineShow) });

export function load(x: Loaded): Model {
  const m = load1(x);
  const f = x.form;
  if (!f) return m;
  m.v2 = true;
  const pick = (p: { classId: bigint | null; marginBp: bigint }): Pick => ({ classId: p.classId, marginBp: p.marginBp });
  const linkCh = new Map<string, Pick>();
  const linkOrg = new Map<string, Pick>();
  for (const l of f.links) {
    if (l.key.startsWith("ch:")) linkCh.set(l.key.slice(3), { classId: l.classId, marginBp: l.marginBp });
    else if (l.key.startsWith("org:")) linkOrg.set(l.key.slice(4), { classId: l.classId, marginBp: l.marginBp });
  }
  m.terms = { live: f.live, orgFixed: new Map(f.orgMargins.filter((o) => o.fixed).map((o) => [String(o.id), pick(o)])), linkCh, linkOrg };
  m.subgroups = f.subgroups.map((g) => {
    const d: SubgroupData = { chapter: `i${g.chapterId}`, title: g.title, order: g.order };
    return { ...d, key: `s${g.id}`, id: g.id, removed: false, base: { ...d, removed: false } };
  });
  const form: Form = {
    hideZeroLines: f.hideZeroLines,
    regieText: f.regieText,
    textBlockKeys: [...f.textBlockKeys],
    chapterMargins: new Map(f.chapterMargins.filter((c) => c.fixed).map((c) => [`i${c.id}`, pick(c)])),
    regie: f.regie ? { ...f.regie } : null,
    discount: f.discount,
    discountText: f.discountText,
    lineSub: new Map(f.lineForms.filter((l) => l.subgroupId !== null).map((l) => [`i${l.lineId}`, `s${l.subgroupId}`])),
    lineShow: new Map(f.lineForms.filter((l) => l.showToClient !== null).map((l) => [`i${l.lineId}`, l.showToClient as boolean])),
  };
  m.form = form;
  m.formBase = cloneForm(form);
  return m;
}

function load1(x: Loaded): Model {
  const chapters: Chapter[] = x.chapters.map((c, i) => ({ ...c, key: `i${c.id}`, id: c.id, seq: i, removed: false, base: { ...c, removed: false }, dirty: false }));
  const lines: Line[] = x.lines.map((l) => {
    const d: LineData = { chapter: `i${l.chapterId}`, order: l.order, kind: l.kind, code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unit: l.unit, form: l.form, libItemId: l.libItemId, libItemVersion: l.libItemVersion, price: { ...l.price } };
    return { ...d, key: `i${l.id}`, id: l.id, removed: false, base: { ...d, price: { ...d.price }, removed: false }, dirty: false };
  });
  return { versionId: x.versionId, rev: x.rev, header: { ...x.header }, headerBase: { ...x.header }, chapters, lines, next: 1, v2: false, terms: { live: false, orgFixed: new Map(), linkCh: new Map(), linkOrg: new Map() }, form: emptyForm(), formBase: emptyForm(), subgroups: [] };
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

type CalcIn = { chapter: string; kind: Kind; qtyMilli: bigint; form: string; price: Price };

/** 2c.1: een regiepost (contractvorm regie, geen tekstregel). */
export const isRegie = (l: { kind: Kind; form: string }): boolean => l.kind !== "text" && l.form === "regie";

/** 2c.1: de basismarge van een lijn zonder eigen regel en waar ze vandaan komt (zelfde volgorde als lib/QuoteForms.mo:
 *  klasse van de leverancier > klasse van het hoofdstuk > standaard). Een koppeling telt enkel in een ontwerp. */
export function lineBase(m: Model, l: CalcIn, f: Form = m.form): { pick: Pick | null; source: "leverancier" | "hoofdstuk" | "standaard" } {
  if (!m.v2) return { pick: null, source: "standaard" };
  const org = l.price.orgId;
  if (org !== null) {
    const p = m.terms.orgFixed.get(String(org)) ?? (m.terms.live ? m.terms.linkOrg.get(String(org)) : undefined);
    if (p) return { pick: p, source: "leverancier" };
  }
  const ch = m.chapters.find((c) => c.key === l.chapter);
  const p = f.chapterMargins.get(l.chapter) ?? (m.terms.live && ch && ch.libChapterId !== null ? m.terms.linkCh.get(String(ch.libChapterId)) : undefined);
  return p ? { pick: p, source: "hoofdstuk" } : { pick: null, source: "standaard" };
}

function calcOf(m: Model, l: CalcIn, f: Form = m.form): CalcLine {
  const base = lineBase(m, l, f).pick;
  const regie = m.v2 && isRegie(l) && l.price.rule === null && f.regie ? { cost: f.regie.cost, sell: f.regie.sell } : null;
  return { chapter: l.chapter, kind: l.kind, qtyMilli: l.qtyMilli, cost: l.price.cost, rule: l.price.rule, baseBp: base ? base.marginBp : null, regie };
}

/** De rekenlijn zoals de versie ze rekent (ook voor de controleregels). */
export function calcLineOf(m: Model, l: Line): CalcLine {
  return calcOf(m, l);
}

export function lineOut(m: Model, l: Line): LineOut {
  return calcLine(calcOf(m, l), m.header.standardMarginBp);
}

export function totals(m: Model): Totals {
  return calcTotals(activeChapters(m).map((c) => c.key), activeLines(m).map((l) => calcOf(m, l)), m.header.vatBp, m.header.standardMarginBp, m.v2 ? m.form.discount : null);
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
  return m.chapters.filter(changedChapter).length + m.lines.filter(changedLine).length + (headerDirty(m) ? 1 : 0) + (formDirty(m) ? 1 : 0);
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
  // 2c.1: met de vorm zoals ze op de server staat (de gewijzigde vorm volgt met saveQuoteForm).
  const t = calcTotals(stateCh.map((c) => c.key), stateLn.map((l) => calcOf(m, l, m.formBase)), vatBp, std, m.v2 ? m.formBase.discount : null);
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

// ── 2c.1: subgroepen, wat de klant ziet, marges, regie en korting ───────
export function activeSubgroups(m: Model, chapterKey?: string): Subgroup[] {
  const live = new Set(activeChapters(m).map((c) => c.key));
  return m.subgroups.filter((g) => !g.removed && live.has(g.chapter) && (chapterKey === undefined || g.chapter === chapterKey)).sort((a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1));
}

export function addSubgroup(m: Model, chapterKey: string, title: string): Subgroup {
  const last = activeSubgroups(m, chapterKey).at(-1);
  const g: Subgroup = { chapter: chapterKey, title, order: last ? last.order + STEP : STEP, key: `t${m.next++}`, id: null, removed: false, base: null };
  m.subgroups.push(g);
  return g;
}

export function updateSubgroup(m: Model, key: string, d: Partial<SubgroupData>): void {
  const g = m.subgroups.find((x) => x.key === key);
  if (g) Object.assign(g, d);
}

export function removeSubgroup(m: Model, key: string): void {
  const g = m.subgroups.find((x) => x.key === key);
  if (!g) return;
  for (const [k, v] of [...m.form.lineSub]) if (v === key) m.form.lineSub.delete(k);
  if (g.id === null) m.subgroups = m.subgroups.filter((x) => x.key !== key);
  else g.removed = true;
}

/** De subgroep van een lijn (null = geen, of een subgroep van een ander hoofdstuk). */
export function lineSubgroup(m: Model, l: Line, f: Form = m.form): Subgroup | null {
  const k = f.lineSub.get(l.key);
  const g = k ? m.subgroups.find((x) => x.key === k && !x.removed) : undefined;
  return g && g.chapter === l.chapter ? g : null;
}

export function setLineSubgroup(m: Model, lineKey: string, subgroupKey: string | null): void {
  if (subgroupKey) m.form.lineSub.set(lineKey, subgroupKey);
  else m.form.lineSub.delete(lineKey);
}

/** Ziet de klant deze lijn? Zelfde regel als lib/QuoteForms.shown: enkel een lijn met hoeveelheid 0 kan verborgen zijn. */
export function shown(m: Model, l: Line, f: Form = m.form): boolean {
  if (!m.v2 || l.kind === "text" || l.qtyMilli !== 0n) return true;
  const s = f.lineShow.get(l.key);
  return s !== undefined ? s : !f.hideZeroLines;
}

export function setLineShow(m: Model, lineKey: string, show: boolean | null): void {
  if (show === null) m.form.lineShow.delete(lineKey);
  else m.form.lineShow.set(lineKey, show);
}

/** Regietarief voor de klant: uurloon / (1 − regiemarge), op de cent (zelfde als QuoteForms.regieSell). */
export function regieSell(cost: bigint, marginBp = 2000n): bigint {
  return calcLine({ chapter: "", kind: "item", qtyMilli: 1000n, cost, rule: null }, marginBp).unitSell ?? cost;
}

const pickKey = (p: Pick | undefined) => (p ? `${p.classId ?? "-"}:${p.marginBp}` : "");
const discKey = (d: Discount) => (d === null ? "" : "amount" in d ? `a${d.amount}` : `p${d.percent}`);

function subChanged(g: Subgroup): boolean {
  if (!g.base) return !g.removed;
  return g.removed !== g.base.removed || g.title !== g.base.title || g.order !== g.base.order || g.chapter !== g.base.chapter;
}

export function formDirty(m: Model): boolean {
  if (!m.v2) return false;
  const a = m.form;
  const b = m.formBase;
  if (a.hideZeroLines !== b.hideZeroLines || a.regieText !== b.regieText || a.textBlockKeys.join("|") !== b.textBlockKeys.join("|") || a.discountText !== b.discountText || discKey(a.discount) !== discKey(b.discount)) return true;
  if (JSON.stringify(a.regie, (_, v) => (typeof v === "bigint" ? String(v) : v)) !== JSON.stringify(b.regie, (_, v) => (typeof v === "bigint" ? String(v) : v))) return true;
  const keys = new Set([...a.chapterMargins.keys(), ...b.chapterMargins.keys()]);
  for (const k of keys) if (pickKey(a.chapterMargins.get(k)) !== pickKey(b.chapterMargins.get(k))) return true;
  if (m.subgroups.some(subChanged)) return true;
  return m.lines.some((l) => !l.removed && ((lineSubgroup(m, l)?.key ?? "") !== (lineSubgroup(m, l, b)?.key ?? "") || a.lineShow.get(l.key) !== b.lineShow.get(l.key)));
}

export type FormSave = {
  input: {
    hideZeroLines: boolean;
    regieText: boolean;
    textBlockKeys: string[];
    subgroupOps: { id: bigint | null; ref: string; chapterId: bigint; title: string; order: bigint; remove: boolean }[];
    lineOps: { lineId: bigint; subgroup: { id: bigint } | { ref: string } | null; showToClient: boolean | null }[];
    chapterMargins: { id: bigint; classId: bigint | null; marginBp: bigint }[];
    regie: { orgId: bigint | null; costCents: bigint; sellCents: bigint | null } | null;
    discount: Discount;
    discountText: string;
  };
  expect: { subtotal: bigint; discount: bigint; total: bigint };
};

/** De bewaaropdracht voor saveQuoteForm (na de lijnen: elke lijn en elk hoofdstuk heeft dan een id). null = niets. */
export function formSave(m: Model): FormSave | null {
  if (!formDirty(m)) return null;
  const chId = (k: string) => m.chapters.find((c) => c.key === k && !c.removed)?.id ?? null;
  const subgroupOps = m.subgroups.filter(subChanged).flatMap((g) => {
    const c = chId(g.chapter);
    if (g.removed) return g.id === null ? [] : [{ id: g.id, ref: g.key, chapterId: c ?? 0n, title: g.title, order: g.order, remove: true }];
    return c === null ? [] : [{ id: g.id, ref: g.key, chapterId: c, title: g.title, order: g.order, remove: false }];
  });
  const lineOps = m.lines.filter((l) => !l.removed && l.id !== null).flatMap((l) => {
    const g = lineSubgroup(m, l);
    const gb = lineSubgroup(m, l, m.formBase);
    const show = m.form.lineShow.get(l.key);
    if ((g?.key ?? "") === (gb?.key ?? "") && show === m.formBase.lineShow.get(l.key)) return [];
    return [{ lineId: l.id as bigint, subgroup: g ? (g.id !== null ? { id: g.id } : { ref: g.key }) : null, showToClient: show ?? null }];
  });
  const chapterMargins = [...m.form.chapterMargins].flatMap(([k, p]) => { const c = chId(k); return c === null ? [] : [{ id: c, classId: p.classId, marginBp: p.marginBp }]; });
  const f = m.form;
  const t = totals(m);
  return {
    input: { hideZeroLines: f.hideZeroLines, regieText: f.regieText, textBlockKeys: [...f.textBlockKeys], subgroupOps, lineOps, chapterMargins, regie: f.regie ? { orgId: f.regie.orgId, costCents: f.regie.cost, sellCents: f.regie.sell } : null, discount: f.discount, discountText: f.discountText },
    expect: { subtotal: t.subtotal, discount: t.discount, total: t.total },
  };
}

/** Na een geslaagde saveQuoteForm: de nieuwe ids van de subgroepen en de vorm is de nieuwe basis. */
export function applyFormSaved(m: Model, rev: bigint, refs: [string, bigint][]): void {
  const ids = new Map(refs);
  m.rev = rev;
  for (const g of m.subgroups) {
    if (g.id === null) g.id = ids.get(g.key) ?? null;
    g.base = { chapter: g.chapter, title: g.title, order: g.order, removed: g.removed };
  }
  m.subgroups = m.subgroups.filter((g) => !g.removed);
  m.formBase = cloneForm(m.form);
}
