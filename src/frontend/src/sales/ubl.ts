// UBL 2.1 volgens Peppol BIS Billing 3.0 (EN 16931) voor één uitgereikte factuur of creditnota (stap 2c.6b, ontwerp 2c §7.3, AC-22).
// De app MAAKT enkel het bestand (downloaden en opladen bij het toegangspunt van de boekhouder); geen verzending, geen externe dienst.
// Zelfde inhoud en bedragen als de PDF (uit SalesFrozen). Een creditnota wordt een <CreditNote> met positieve bedragen. Een negatieve
// regel (aftrek, korting) krijgt een negatieve hoeveelheid en een positieve prijs (BR-27: de prijs is nooit negatief).
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks (tests/factuur-2c6.mjs toetst verplichte velden en sommen).

type N = bigint | number;
type Addr = { street: string; number: string; zip: string; city: string; country: string } | null;
export type UblInput = {
  number: string;
  credit: boolean;
  issueDay: N;
  dueDay: N;
  serviceDay: N | null;
  serviceTo: N | null;
  issuer: { name: string; legalForm: string; address: Addr; vat: string; kbo: string; email: string; iban: string; bic: string };
  buyer: { name: string; address: Addr; vat: string; kbo: string };
  workCode: string;
  quoteRefs: string[];
  lines: { description: string; qtyMilli: bigint; unit: string; unitCents: bigint; amountCents: bigint; vatBp: bigint }[];
  vatLines: { vatBp: bigint; reverse: boolean; baseCents: bigint; vatCents: bigint }[];
  netCents: bigint;
  vatCents: bigint;
  totalCents: bigint;
  mentions: string[];
  paymentRef: string;
  paymentDays: N;
  creditOf: string | null;
  creditOfDay: N | null;
  scheme: string; // 0208 = Belgisch ondernemingsnummer
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const day = (d: N) => new Date(Number(d) * 86_400_000).toISOString().slice(0, 10);
const abs = (x: bigint) => (x < 0n ? -x : x);
export const amt = (c: bigint) => `${c < 0n ? "-" : ""}${abs(c) / 100n}.${String(abs(c) % 100n).padStart(2, "0")}`;
const qty = (m: bigint) => { const a = abs(m); const s = `${m < 0n ? "-" : ""}${a / 1000n}`; const r = a % 1000n; return r === 0n ? s : `${s}.${String(r).padStart(3, "0").replace(/0+$/, "")}`; };
const digits = (s: string) => s.replace(/\D/g, "");
const country = (a: Addr) => (a?.country || "BE").toUpperCase().slice(0, 2);
/** Het ondernemingsnummer (10 cijfers) uit het KBO-nummer of anders het btw-nummer (BE0123456789). */
export const enterprise = (kbo: string, vat: string) => { const k = digits(kbo); if (k.length === 10) return k; const v = digits(vat); return v.length === 9 ? `0${v}` : v.slice(-10); };
const UNIT: Record<string, string> = { m2: "MTK", m3: "MTQ", lm: "MTR", m: "MTR", kg: "KGM", u: "HUR", uur: "HUR", st: "H87", stuk: "H87", ton: "TNE", dag: "DAY", d: "DAY", km: "KMT" };
export const unitCode = (u: string) => UNIT[u.trim().toLowerCase()] ?? "C62";

function party(tag: "AccountingSupplierParty" | "AccountingCustomerParty", p: { name: string; address: Addr; vat: string; kbo: string; email?: string }, scheme: string): string {
  const a = p.address;
  const vat = p.vat.replace(/[\s.]/g, "").toUpperCase();
  const id = enterprise(p.kbo, p.vat);
  return `<cac:${tag}><cac:Party>`
    + `<cbc:EndpointID schemeID="${esc(scheme)}">${esc(id)}</cbc:EndpointID>`
    + `<cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName>`
    + `<cac:PostalAddress><cbc:StreetName>${esc(`${a?.street ?? ""} ${a?.number ?? ""}`.trim())}</cbc:StreetName><cbc:CityName>${esc(a?.city ?? "")}</cbc:CityName><cbc:PostalZone>${esc(a?.zip ?? "")}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${country(a)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>`
    + (vat ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : "")
    + `<cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>${id ? `<cbc:CompanyID schemeID="${esc(scheme)}">${esc(id)}</cbc:CompanyID>` : ""}</cac:PartyLegalEntity>`
    + (p.email ? `<cac:Contact><cbc:ElectronicMail>${esc(p.email)}</cbc:ElectronicMail></cac:Contact>` : "")
    + `</cac:Party></cac:${tag}>`;
}

const cat = (v: { vatBp: bigint; reverse: boolean }) => (v.reverse ? "AE" : "S");
const pctTxt = (bp: bigint) => { const s = (Number(bp) / 100).toFixed(2); return s.replace(/\.?0+$/, "") || "0"; };

/** Het UBL-bestand (XML-tekst). Een creditnota: <CreditNote>, alle bedragen met het omgekeerde teken (dus positief). */
export function ublXml(d: UblInput): string {
  const sg = d.credit ? -1n : 1n;
  const doc = d.credit ? "CreditNote" : "Invoice";
  const ns = d.credit ? "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" : "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<${doc} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`);
  out.push(`<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>`);
  out.push(`<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>`);
  out.push(`<cbc:ID>${esc(d.number)}</cbc:ID>`);
  out.push(`<cbc:IssueDate>${day(d.issueDay)}</cbc:IssueDate>`);
  if (!d.credit) out.push(`<cbc:DueDate>${day(d.dueDay)}</cbc:DueDate>`);
  out.push(d.credit ? `<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>` : `<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>`);
  for (const m of d.mentions) if (m.trim()) out.push(`<cbc:Note>${esc(m)}</cbc:Note>`);
  out.push(`<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>`);
  out.push(`<cbc:BuyerReference>${esc(d.workCode || d.number)}</cbc:BuyerReference>`);
  if (d.serviceDay !== null) out.push(`<cac:InvoicePeriod><cbc:StartDate>${day(d.serviceDay)}</cbc:StartDate><cbc:EndDate>${day(d.serviceTo ?? d.serviceDay)}</cbc:EndDate></cac:InvoicePeriod>`);
  if (d.credit && d.creditOf) out.push(`<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(d.creditOf)}</cbc:ID>${d.creditOfDay !== null ? `<cbc:IssueDate>${day(d.creditOfDay)}</cbc:IssueDate>` : ""}</cac:InvoiceDocumentReference></cac:BillingReference>`);
  if (!d.credit && d.quoteRefs.length) out.push(`<cac:ContractDocumentReference><cbc:ID>${esc(d.quoteRefs.join(", "))}</cbc:ID></cac:ContractDocumentReference>`);
  if (!d.credit && d.workCode) out.push(`<cac:ProjectReference><cbc:ID>${esc(d.workCode)}</cbc:ID></cac:ProjectReference>`);
  out.push(party("AccountingSupplierParty", { name: `${d.issuer.name}${d.issuer.legalForm ? " " + d.issuer.legalForm : ""}`, address: d.issuer.address, vat: d.issuer.vat, kbo: d.issuer.kbo, email: d.issuer.email }, d.scheme));
  out.push(party("AccountingCustomerParty", d.buyer, d.scheme));
  if (!d.credit) {
    out.push(`<cac:PaymentMeans><cbc:PaymentMeansCode name="Credit transfer">30</cbc:PaymentMeansCode>${d.paymentRef ? `<cbc:PaymentID>${esc(d.paymentRef)}</cbc:PaymentID>` : ""}<cac:PayeeFinancialAccount><cbc:ID>${esc(d.issuer.iban.replace(/\s/g, ""))}</cbc:ID>${d.issuer.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${esc(d.issuer.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ""}</cac:PayeeFinancialAccount></cac:PaymentMeans>`);
    out.push(`<cac:PaymentTerms><cbc:Note>${esc(`Te betalen binnen ${Number(d.paymentDays)} dagen, uiterlijk op ${day(d.dueDay)}`)}</cbc:Note></cac:PaymentTerms>`);
  }
  out.push(`<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${amt(sg * d.vatCents)}</cbc:TaxAmount>`);
  for (const v of d.vatLines) {
    out.push(`<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">${amt(sg * v.baseCents)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">${amt(sg * v.vatCents)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${cat(v)}</cbc:ID><cbc:Percent>${pctTxt(v.vatBp)}</cbc:Percent>${v.reverse ? `<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Verlegging van heffing</cbc:TaxExemptionReason>` : ""}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`);
  }
  out.push(`</cac:TaxTotal>`);
  out.push(`<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">${amt(sg * d.netCents)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">${amt(sg * d.netCents)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">${amt(sg * d.totalCents)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">${amt(sg * d.totalCents)}</cbc:PayableAmount></cac:LegalMonetaryTotal>`);
  const reverse = d.vatLines.some((v) => v.reverse);
  d.lines.forEach((l, i) => {
    const amount = sg * l.amountCents;
    // Hoeveelheid × prijs = bedrag (met het teken van het document); een negatieve prijs wordt een negatieve hoeveelheid (BR-27).
    const neg = l.unitCents < 0n;
    const q = (neg ? -1n : 1n) * sg * l.qtyMilli;
    const price = neg ? -l.unitCents : l.unitCents;
    const lt = d.credit ? "CreditNoteLine" : "InvoiceLine";
    const qt = d.credit ? "CreditedQuantity" : "InvoicedQuantity";
    out.push(`<cac:${lt}><cbc:ID>${i + 1}</cbc:ID><cbc:${qt} unitCode="${unitCode(l.unit)}">${qty(q)}</cbc:${qt}><cbc:LineExtensionAmount currencyID="EUR">${amt(amount)}</cbc:LineExtensionAmount>`
      + `<cac:Item><cbc:Name>${esc(l.description.slice(0, 200))}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${reverse ? "AE" : "S"}</cbc:ID><cbc:Percent>${pctTxt(reverse ? 0n : l.vatBp)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>`
      + `<cac:Price><cbc:PriceAmount currencyID="EUR">${amt(price)}</cbc:PriceAmount></cac:Price></cac:${lt}>`);
  });
  out.push(`</${doc}>`);
  return out.join("\n");
}
