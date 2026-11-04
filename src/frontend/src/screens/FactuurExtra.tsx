// Stap 2c.6b bij een uitgereikte factuur: de UBL (Peppol BIS 3.0) voor een klant met een btw-nummer (enkel het bestand: opladen bij
// het toegangspunt van de boekhouder, AC-22), de herinnering bij een vervallen factuur (PDF, en desgewenst een mail in de wachtrij van
// de postbode, testmodus), en in de werklijst de kwartaallijst voor de boekhouder (CSV + PDF's + UBL's in één zip).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SalesFrozen, SalesFullView } from "../backend";
import { Button, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, unwrap, useBackend } from "../util";
import { pdfData, safeName } from "../sales/adapt";
import { ublMissing, ublXml, type UblInput } from "../sales/ubl";
import { quarterCsv, quarterOf } from "../sales/csv";
import { download } from "./Prijsvragen";

const T = t.sales;

/** Van de vastgelegde factuur naar de invoer van de UBL (dezelfde bedragen als de PDF). */
export function ublInput(f: SalesFrozen, scheme: string): UblInput {
  const a = (x: SalesFrozen["workAddress"] | undefined) => (x ? { street: x.street, number: x.number, zip: x.zip, city: x.city, country: x.country } : null);
  return {
    number: f.number, credit: !!f.creditOf, issueDay: f.issueDay, dueDay: f.dueDay, serviceDay: f.serviceDay ?? null, serviceTo: f.serviceTo ?? null,
    issuer: { name: f.issuer.name, legalForm: f.issuer.legalForm, address: a(f.issuer.address), vat: f.issuer.vat, kbo: f.issuer.kbo, email: f.issuer.email, iban: f.issuer.iban, bic: f.issuer.bic },
    buyer: { name: f.buyer.name, address: a(f.buyer.address), vat: f.buyer.vat ?? "", kbo: f.buyer.kbo ?? "" },
    workCode: f.workCode, quoteRefs: f.quoteRefs,
    lines: f.lines.map((l) => ({ description: l.description, qtyMilli: l.qtyMilli, unit: l.unit, unitCents: l.unitCents, amountCents: l.amountCents, vatBp: l.vatBp })),
    vatLines: f.vatLines, netCents: f.netCents, vatCents: f.vatCents, totalCents: f.totalCents, mentions: f.mentions, paymentRef: f.paymentRef,
    paymentDays: f.paymentDays, creditOf: f.creditOf ?? null, creditOfDay: f.creditOfDay ?? null, scheme,
  };
}

export function SalesExtra({ v, onDone }: { v: SalesFullView; onDone: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [mail, setMail] = useState(false);
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const ubl = useMutation({
    mutationFn: async () => {
      const s = await actor!.salesSettings();
      download(new TextEncoder().encode(ublXml(ublInput(v.doc, s.peppolScheme))), `${safeName(v.doc.number)}.xml`, "application/xml");
      unwrap(await actor!.markSalesUbl(v.brief.id));
    },
    onSuccess: onDone,
    onError: fail,
  });
  const remind = useMutation({
    // Review L5: eerst de PDF maken (lukt dat niet, dan ontstaat er geen herinnering en geen mail), dan het record en de mail.
    mutationFn: async () => {
      const s = await actor!.salesSettings();
      const { factuurPdf } = await import("../pdf/factuur.ts");
      const { loadPdfFonts } = await import("../pdf/fonts.ts");
      const d = { ...pdfData(v.doc, v.hash, false), reminder: { level: v.reminders.length + 1, day: v.today, text: s.reminderText, openCents: v.openCents, paidCents: v.paidCents } };
      const bytes = await factuurPdf(d, await loadPdfFonts());
      unwrap(await actor!.remindSalesInvoice(v.brief.id, mail, ""));
      download(bytes, `Herinnering ${safeName(v.doc.number)}.pdf`, "application/pdf");
    },
    onSuccess: () => { toast.show({ kind: "ok", text: T.reminder }); onDone(); },
    onError: fail,
  });
  return (
    <>
      {v.brief.company && <Button onClick={() => ubl.mutate()} busy={ubl.isPending}>{T.ubl}{v.brief.peppol === "ubl-gemaakt" ? " ✓" : ""}</Button>}
      {v.brief.overdue && (
        <span className="a-row" style={{ gap: 6 }}>
          <label className="a-check"><input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} /> mail (testmodus)</label>
          <Button onClick={() => remind.mutate()} busy={remind.isPending}>{T.reminder}{v.reminders.length ? ` ${v.reminders.length + 1}` : ""}</Button>
        </span>
      )}
    </>
  );
}

/** De kwartaallijst voor de boekhouder: CSV + de PDF's + de UBL's (bedrijven) in één zip. */
export function QuarterExport({ today }: { today: bigint }) {
  const { actor } = useBackend();
  const toast = useToast();
  const qc = useQueryClient();
  const [y0, q0] = quarterOf(today);
  const [year, setYear] = useState(String(y0));
  const [quarter, setQuarter] = useState(String(q0));
  const go = useMutation({
    mutationFn: async () => {
      const rows = unwrap(await actor!.salesQuarter(BigInt(Number(year)), BigInt(Number(quarter))));
      const s = await actor!.salesSettings();
      const [{ factuurPdf }, { loadPdfFonts }, { zipStore }] = await Promise.all([import("../pdf/factuur.ts"), import("../pdf/fonts.ts"), import("../tender/zip.ts")]);
      const fonts = await loadPdfFonts();
      const files: { name: string; data: Uint8Array | string }[] = [{ name: `kwartaallijst-${year}-K${quarter}.csv`, data: quarterCsv(rows.map((r) => ({ ...r, paidDay: r.paidDay ?? null }))) }];
      for (const r of rows) {
        const f = unwrap(await actor!.readSalesInvoice(r.invoiceId));
        files.push({ name: `pdf/${safeName(r.number)}.pdf`, data: await factuurPdf(pdfData(f.doc, f.hash, false), fonts) });
        if (f.doc.buyer.company && !ublMissing(f.doc)) files.push({ name: `ubl/${safeName(r.number)}.xml`, data: ublXml(ublInput(f.doc, s.peppolScheme)) });
      }
      download(zipStore(files), `BOWACO facturen ${year}-K${quarter}.zip`, "application/zip");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["salesWorklist"] }),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <div className="a-card" style={{ marginTop: 12 }} data-testid="sales-quarter">
      <h2 className="bw-h2">{T.list.quarter}</h2>
      <p className="bw-muted">{T.list.quarterLead}</p>
      <div className="a-row" style={{ gap: 6 }}>
        <input className="bw-input" style={{ width: 90 }} inputMode="numeric" aria-label="Jaar" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} />
        <select className="bw-input" aria-label="Kwartaal" value={quarter} onChange={(e) => setQuarter(e.target.value)}>{[1, 2, 3, 4].map((k) => <option key={k} value={String(k)}>K{k}</option>)}</select>
        <Button variant="primary" busy={go.isPending} onClick={() => go.mutate()}>{T.list.quarterGo}</Button>
      </div>
    </div>
  );
}
