// Van de gegevens van de backend naar de invoer van de offerte-PDF (stap 2.7). Twee bronnen: kantoor (readQuoteVersion, met
// de vastgelegde of de huidige velden van de PDF) en de klant (readMyQuote). Beide leveren enkel verkoopprijzen: er is geen
// pad waarlangs een aankoopprijs of een marge in de PDF komt.
import type { Address, MyQuoteRead, QuoteDocInfo, QuoteRead } from "../backend";
import type { PdfAddress, PdfLine, QuotePdfData } from "./offerte.ts";

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

/** Voor kantoor: de versie zoals ze nu in de backend staat (een ontwerp wordt een voorbeeld met watermerk). */
export function pdfFromRead(r: QuoteRead): QuotePdfData | null {
  if (!r.doc) return null;
  const v = r.version;
  const info = r.doc.info;
  const sell = new Map(r.sell.map((s) => [String(s.lineId), s]));
  const chSell = new Map(r.totals.chapters.map((c) => [String(c.chapterId), c.sellCents]));
  const lines: PdfLine[] = r.lines.map((l) => {
    const s = sell.get(String(l.id));
    return {
      chapter: String(l.chapterId), kind: l.kind as PdfLine["kind"], code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unitName: l.unitName,
      form: l.form as string, unitSellCents: s?.unitSellCents ?? null, lineSellCents: s?.lineSellCents ?? 0n,
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
      form: l.form as string, unitSellCents: l.unitSellCents ?? null, lineSellCents: l.lineSellCents,
    })),
    subtotalCents: r.subtotalCents,
    vatCents: r.vatCents,
    totalCents: r.totalCents,
    optionsPlusCents: r.optionsPlusCents,
    optionsMinusCents: r.optionsMinusCents,
    accepted: accepted(r.acceptance),
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
