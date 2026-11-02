// Van de vastgelegde factuur van de backend (SalesFrozen: kantoor via readSalesInvoice, de klant via readMySalesInvoice) naar de
// invoer van de PDF en de UBL. Er is geen pad waarlangs een kostprijs, een marge of een OA-naam in de factuur komt: SalesFrozen heeft
// die velden niet.
import type { SalesFrozen } from "../backend";
import type { FactuurPdfData } from "../pdf/factuur.ts";
import type { PdfAddress } from "../pdf/offerte.ts";

type Addr = { street: string; number: string; zip: string; city: string; country: string } | undefined;
const addr = (a: Addr): PdfAddress => (a ? { street: a.street, number: a.number, zip: a.zip, city: a.city, country: a.country } : null);
const kindKey = (k: unknown) => String(k);

export function pdfData(f: SalesFrozen, hash: string, draft: boolean): FactuurPdfData {
  return {
    number: f.number,
    kindText: f.kindText,
    draft,
    issueDay: f.issueDay,
    serviceDay: f.serviceDay ?? null,
    serviceTo: f.serviceTo ?? null,
    dueDay: f.dueDay,
    paymentDays: f.paymentDays,
    issuer: { ...f.issuer, address: addr(f.issuer.address) },
    buyer: { name: f.buyer.name, address: addr(f.buyer.address), vat: f.buyer.vat ?? "", kbo: f.buyer.kbo ?? "", company: f.buyer.company },
    workCode: f.workCode,
    workName: f.workName,
    workAddress: addr(f.workAddress),
    analyticCode: f.analyticCode,
    quoteRefs: f.quoteRefs,
    title: f.title,
    note: f.note,
    lines: f.lines.map((l) => ({ kind: kindKey(l.kind) === "revision" ? "herziening" : kindKey(l.kind) === "deduct" ? "aftrek" : "werk", group: l.group, description: l.description, qtyMilli: l.qtyMilli, unit: l.unit, unitCents: l.unitCents, amountCents: l.amountCents, vatBp: l.vatBp, baseCents: l.baseCents ?? null, pctBp: l.pctBp ?? null })),
    previous: f.previous.map((p) => ({ number: p.number, day: p.day, cents: p.cents, revisionCents: p.revisionCents })),
    vatLines: f.vatLines,
    netCents: f.netCents,
    vatCents: f.vatCents,
    totalCents: f.totalCents,
    retentionCents: f.retentionCents,
    mentions: f.mentions,
    paymentRef: f.paymentRef,
    creditOf: f.creditOf ?? null,
    creditOfDay: f.creditOfDay ?? null,
    hash,
  };
}

/** De PDF in de browser (pdf-lib, ingebedde lettertypes) en meteen downloaden. */
export async function downloadFactuurPdf(d: FactuurPdfData) {
  const [{ factuurPdf }, { loadPdfFonts }, { download }] = await Promise.all([import("../pdf/factuur.ts"), import("../pdf/fonts.ts"), import("../screens/Prijsvragen")]);
  const bytes = await factuurPdf(d, await loadPdfFonts());
  const name = d.reminder ? `Herinnering ${d.number}` : `${d.kindText} ${d.draft ? "ontwerp" : d.number}`;
  download(bytes, `${name} ${d.workCode}.pdf`, "application/pdf");
}

/** "2026-153" → bestandsnaam zonder vreemde tekens. */
export const safeName = (s: string) => s.replace(/[^A-Za-z0-9 ._-]/g, "_");
