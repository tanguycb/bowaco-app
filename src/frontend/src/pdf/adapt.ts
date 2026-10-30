// Van de gegevens van de backend naar de invoer van de offerte-PDF (stap 2.7). Twee bronnen: kantoor (readQuoteVersion, met
// de vastgelegde of de huidige velden van de PDF) en de klant (readMyQuote). Beide leveren enkel verkoopprijzen: er is geen
// pad waarlangs een aankoopprijs of een marge in de PDF komt.
import type { Address, MyQuoteRead, QuoteDocInfo, QuoteRead } from "../backend";
import type { PdfAddress, PdfForm, PdfLine, QuotePdfData } from "./offerte.ts";

const addr = (a: Address | undefined): PdfAddress => (a ? { street: a.street, number: a.number, zip: a.zip, city: a.city, country: a.country } : null);
const dayOfNs = (ns: bigint) => Math.floor(Number(ns / 1_000_000_000n) / 86_400);
const STATUS: Record<string, string> = { draft: "ontwerp", sent: "verstuurd", accepted: "aanvaard", rejected: "geweigerd", superseded: "vervangen", withdrawn: "ingetrokken" };

type Acc = { digital?: { at: bigint; byName: string }; signed?: { at: bigint; byName: string } };
function accepted(a: Acc | undefined): QuotePdfData["accepted"] {
  if (!a) return null;
  return {
    digital: a.digital ? { atDay: dayOfNs(a.digital.at), byName: a.digital.byName } : null,
    signed: a.signed ? { atDay: dayOfNs(a.signed.at), byName: a.signed.byName } : null,
  };
}

function head(i: QuoteDocInfo) {
  return {
    paymentDays: Number(i.paymentDays),
    vatNote: i.vatNote,
    issuer: i.issuer,
    clientName: i.clientName,
    clientAddress: addr(i.clientAddress),
    clientVat: i.clientVat ?? "",
    workCode: i.workCode,
    workName: i.workName,
    workAddress: addr(i.workAddress),
    terms: { version: Number(i.termsVersion), title: i.termsTitle, text: i.termsText, provisional: i.termsProvisional },
  };
}

type Block = { title: string; text: string; place: { __kind__: string; chapter?: string } };
const blockPlace = (b: Block) => (b.place.__kind__ === "chapter" ? b.place.chapter ?? "" : b.place.__kind__);

/** 2c.1, kantoor: de vorm van de versie (null = rekent nog met de oude regels). `regieSell` en `discountText` komen uit de
 *  vertrouwelijke voorwaarden (enkel wie ze mag zien). */
function formFromRead(r: QuoteRead): PdfForm | null {
  const f = r.form;
  if (!f) return null;
  const tm = r.terms;
  return {
    kind: f.kind as string,
    insurer: f.insurerName,
    claimRef: f.claimRef,
    subgroups: [...f.subgroups].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map((g) => ({ key: String(g.id), chapter: String(g.chapterId), title: g.title })),
    lineSub: Object.fromEntries(f.lineForms.filter((l) => l.subgroupId !== undefined && l.shown).map((l) => [String(l.lineId), String(l.subgroupId)])),
    blocks: f.blocks.map((b) => ({ title: b.title, text: b.text, place: blockPlace(b as Block) })),
    grossCents: r.totals.grossCents,
    discountCents: r.totals.discountCents,
    discountText: tm?.discountText ?? "",
    regieSellCents: f.regieText && tm?.regie ? tm.regie.sellCents : null,
  };
}

/** Voor kantoor: de versie zoals ze nu in de backend staat (een ontwerp wordt een voorbeeld met watermerk). */
export function pdfFromRead(r: QuoteRead): QuotePdfData | null {
  if (!r.doc) return null;
  const v = r.version;
  const info = r.doc.info;
  const sell = new Map(r.sell.map((s) => [String(s.lineId), s]));
  const chSell = new Map(r.totals.chapters.map((c) => [String(c.chapterId), c.sellCents]));
  // 2c.1: een post met hoeveelheid 0 die de klant niet ziet, staat ook niet in de PDF.
  const hidden = new Set((r.form?.lineForms ?? []).filter((x) => !x.shown).map((x) => String(x.lineId)));
  const lines: PdfLine[] = r.lines.filter((l) => !hidden.has(String(l.id))).map((l) => {
    const s = sell.get(String(l.id));
    return {
      chapter: String(l.chapterId), kind: l.kind as PdfLine["kind"], code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unitName: l.unitName,
      form: l.form as string, unitSellCents: s?.unitSellCents ?? null, lineSellCents: s?.lineSellCents ?? 0n, key: String(l.id),
    };
  });
  return {
    number: r.quote.number,
    version: Number(v.version),
    title: v.title,
    intro: v.intro,
    status: STATUS[v.status] ?? v.status,
    frozen: info.frozen,
    hash: v.hash,
    sentDay: v.sentAt !== undefined ? dayOfNs(v.sentAt) : null,
    validUntilDay: info.frozen ? Number(info.validUntil) : null,
    validDays: Number(v.validDays),
    vatBp: v.vatBp,
    ...head(info),
    chapters: r.chapters.map((c) => ({ key: String(c.id), code: c.code, title: c.title, sellCents: chSell.get(String(c.id)) ?? 0n })),
    lines,
    subtotalCents: r.totals.subtotalCents,
    vatCents: r.totals.vatCents,
    totalCents: r.totals.totalCents,
    optionsPlusCents: r.totals.optionsPlusCents,
    optionsMinusCents: r.totals.optionsMinusCents,
    accepted: accepted(r.doc.acceptance),
    form: formFromRead(r),
  };
}

/** Voor de klant: de verzonden versie, enkel met verkoopprijzen. */
export function pdfFromMine(r: MyQuoteRead): QuotePdfData {
  return {
    number: r.number,
    version: Number(r.version),
    title: r.title,
    intro: r.intro,
    status: STATUS[r.status] ?? r.status,
    frozen: true,
    hash: r.hash,
    sentDay: dayOfNs(r.sentAt),
    validUntilDay: Number(r.doc.validUntil),
    validDays: 0,
    vatBp: r.vatBp,
    ...head(r.doc),
    chapters: r.chapters.map((c) => ({ key: String(c.id), code: c.code, title: c.title, sellCents: c.sellCents })),
    lines: r.lines.map((l) => ({
      chapter: String(l.chapterId), kind: l.kind as PdfLine["kind"], code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unitName: l.unitName,
      form: l.form as string, unitSellCents: l.unitSellCents ?? null, lineSellCents: l.lineSellCents, key: String(l.id),
    })),
    subtotalCents: r.subtotalCents,
    vatCents: r.vatCents,
    totalCents: r.totalCents,
    optionsPlusCents: r.optionsPlusCents,
    optionsMinusCents: r.optionsMinusCents,
    accepted: accepted(r.acceptance),
    form: r.form
      ? {
          kind: r.form.kind as string,
          insurer: r.form.insurerName,
          claimRef: r.form.claimRef,
          subgroups: [...r.form.subgroups].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map((g) => ({ key: String(g.id), chapter: String(g.chapterId), title: g.title })),
          lineSub: Object.fromEntries(r.form.lineSubgroups.map(([l, g]) => [String(l), String(g)])),
          blocks: r.form.blocks.map((b) => ({ title: b.title, text: b.text, place: blockPlace(b as Block) })),
          grossCents: r.form.grossCents,
          discountCents: r.form.discountCents,
          discountText: r.form.discountText,
          regieSellCents: r.form.regieSellCents ?? null,
        }
      : null,
  };
}

/** De PDF maken in de browser en als bestand aanbieden (downloaden) of openen in een nieuw tabblad. */
export async function makePdf(d: QuotePdfData): Promise<Blob> {
  const [{ quotePdf }, { loadPdfFonts }] = await Promise.all([import("./offerte.ts"), import("./fonts.ts")]);
  const bytes = await quotePdf(d, await loadPdfFonts());
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export function pdfName(d: QuotePdfData): string {
  return `BOWACO offerte ${d.number.replace(/[^\w.-]+/g, "-")} v${d.version}${d.frozen ? "" : " ontwerp"}.pdf`;
}

// ── 2.10: de vorderingsstaat ──────────────────────────────────────────────
// Twee bronnen: kantoor (readProgressStatement: een ontwerp wordt een voorbeeld met watermerk) en de klant (readMyProgress).
// Beide enkel met verkoopprijzen: er bestaat in dit domein geen aankoopprijs of marge.
import type { MyProgressRead, ProgressDocInfo, ProgressFullView, ProgressLineFrozen, ProgressTotals } from "../backend";
import type { ProgressPdfData, ProgressPdfLine } from "./vorderingsstaat.ts";

function progressHead(i: ProgressDocInfo) {
  const r = i.revision;
  return {
    issuer: i.issuer,
    clientName: i.clientName,
    clientAddress: addr(i.clientAddress),
    clientVat: i.clientVat ?? "",
    workCode: i.workCode,
    workName: i.workName,
    workAddress: addr(i.workAddress),
    quoteRefs: i.quoteRefs,
    vatNote: i.vatNote,
    paymentDays: Number(i.paymentDays),
    guarantee: i.guarantee as string,
    retentionOnIncl: i.retentionOnIncl,
    revision: r ? { formula: r.formula, aBp: r.aBp, bBp: r.bBp, cBp: r.cBp, sBase: r.sBase, iBase: r.iBase, sIndex: r.sIndex, iIndex: r.iIndex, sLabel: r.sLabel, iLabel: r.iLabel } : null,
  };
}
function progressTot(t: ProgressTotals): ProgressPdfData["totals"] {
  return { ...t, sections: t.sections.map((s) => ({ ...s, section: s.section as string })) };
}
const pLine = (l: Pick<ProgressLineFrozen, "section" | "basis" | "code" | "title" | "chapter" | "unit" | "offerQtyMilli" | "unitPriceCents" | "offerCents" | "prevPctBp" | "prevQtyMilli" | "prevCents" | "cumPctBp" | "cumQtyMilli" | "cumCents" | "periodCents">): ProgressPdfLine => ({
  section: l.section as ProgressPdfLine["section"], basis: l.basis as ProgressPdfLine["basis"], code: l.code, title: l.title, chapter: l.chapter, unit: l.unit,
  offerQtyMilli: l.offerQtyMilli, unitPriceCents: l.unitPriceCents, offerCents: l.offerCents, prevPctBp: l.prevPctBp, prevQtyMilli: l.prevQtyMilli, prevCents: l.prevCents, cumPctBp: l.cumPctBp, cumQtyMilli: l.cumQtyMilli, cumCents: l.cumCents, periodCents: l.periodCents,
});

/** Voor kantoor. `live` = de totalen en lijnen zoals de browser ze nu rekent (ontwerp), anders die van de server. */
export function pdfFromProgress(v: ProgressFullView, note: string, live?: { lines: ProgressPdfLine[]; totals: ProgressPdfData["totals"] }): ProgressPdfData | null {
  if (!v.doc) return null;
  const i = v.doc;
  return {
    code: v.brief.code,
    credit: (v.brief.kind as string) === "credit",
    creditsCode: v.brief.creditsCode,
    frozen: v.frozen,
    hash: v.hash,
    periodFrom: Number(v.brief.periodFrom),
    periodTo: Number(v.brief.periodTo),
    sendDay: v.frozen ? Number(i.sendDay) : null,
    dueDay: v.frozen ? Number(i.dueDay) : null,
    vatBp: v.header.vatBp,
    note,
    ...progressHead(i),
    lines: live?.lines ?? v.lines.map((x) => pLine({ ...x.q, ...x.m })),
    totals: live?.totals ?? progressTot(v.totals),
    answer: v.answer ? { ok: v.answer.ok, atDay: dayOfNs(v.answer.at), byName: v.answer.byName, note: v.answer.note } : null,
  };
}

export function pdfFromMyProgress(r: MyProgressRead): ProgressPdfData {
  return {
    code: r.code,
    credit: (r.kind as string) === "credit",
    creditsCode: r.creditsCode,
    frozen: true,
    hash: r.hash,
    periodFrom: Number(r.periodFrom),
    periodTo: Number(r.periodTo),
    sendDay: Number(r.doc.sendDay),
    dueDay: Number(r.doc.dueDay),
    vatBp: r.totals.vatBp,
    note: r.note,
    ...progressHead(r.doc),
    lines: r.lines.map(pLine),
    totals: progressTot(r.totals),
    answer: r.answer ? { ok: r.answer.ok, atDay: dayOfNs(r.answer.at), byName: r.answer.byName, note: r.answer.note } : null,
  };
}

export async function makeProgressPdf(d: ProgressPdfData): Promise<Blob> {
  const [{ progressPdf }, { loadPdfFonts }] = await Promise.all([import("./vorderingsstaat.ts"), import("./fonts.ts")]);
  const bytes = await progressPdf(d, await loadPdfFonts());
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export function progressPdfName(d: ProgressPdfData): string {
  return `BOWACO ${d.credit ? "creditnota" : "vorderingsstaat"} ${(d.code || `${d.workCode} ontwerp`).replace(/[^\w.-]+/g, "-")}.pdf`;
}
