// Verkoopfacturen over alle werven en voor de klant (stap 2c.6, ontwerp 2c §3.2): de werklijst Facturatie → Facturen (te factureren,
// openstaande facturen, ontwerpen; 2c.6b: de kwartaallijst), Mijn werf → Facturatie voor de klant (enkel zijn uitgereikte facturen en
// het schema), en Beheer → Opmeting & facturatie → Facturen (wat de boekhouder nakijkt: gegevens, vermeldingen, tellers).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Caps, SalesSettingsView } from "../backend";
import { Button, Cijfer, Table, Tag, useToast, type CijferRegel, Info } from "../design";
import { t } from "../texts/nl";
import { errText, fmtBp, fmtDayNum, fmtEuro, parsePct, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { FactuurSheet } from "./FactuurSheet";
import { whenText } from "./Facturen";
import { downloadFactuurPdf, pdfData } from "../sales/adapt";
import { QuarterExport } from "./FactuurExtra";

const T = t.sales;

/** Werklijst Facturatie → Facturen (kantoor). */
/** 4b.3: de opbouw van een som voor de uitleg bij een cijfer: hoogstens zes regels, de rest samen, en het totaal. */
function som(xs: [string, bigint][]): CijferRegel[] {
  const tot = xs.reduce((n, x) => n + x[1], 0n);
  const top = xs.slice(0, 6).map(([label, c]) => ({ label, waarde: fmtEuro(c) }));
  const rest = xs.slice(6).reduce((n, x) => n + x[1], 0n);
  return [...top, ...(xs.length > 6 ? [{ label: t.schil.cijferRest(xs.length - 6), waarde: fmtEuro(rest) }] : []), { label: t.schil.cijferTotaal, waarde: fmtEuro(tot), totaal: true }];
}

export function SalesWorklist({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["salesWorklist"], queryFn: async () => unwrap(await actor!.salesWorklist()), enabled: !!actor && !isFetching, retry: false });
  const [open, setOpen] = useState<bigint | null>(null);
  const v = q.data;
  return (
    <Page label={t.menu.facturatie} title={T.list.tab}>
    <section className="a-section" data-testid="sales-worklist">
      {!v ? <Loading q={q} /> : <>
        {/* 4b.3: de som bovenaan met de uitleg erachter; beide lijsten in het ene tabelonderdeel (sorteren, vaste kop). */}
        <div className="a-row" style={{ gap: 24 }} data-testid="sales-sommen">
          <span className="bw-muted">{T.list.due}: <b className="bw-num"><Cijfer go={go} naam={T.list.due} uitleg={t.schil.cijfer.teFactureren} regels={som(v.due.map((d) => [`${d.workCode} · ${d.title}`, d.stepCents]))}>{fmtEuro(v.due.reduce((n, d) => n + d.stepCents, 0n))}</Cijfer></b></span>
          <span className="bw-muted">{T.list.open}: <b className="bw-num"><Cijfer go={go} naam={T.list.open} uitleg={t.schil.cijfer.open} regels={som(v.open.map((o) => [`${o.brief.number} · ${o.brief.workCode}`, o.openCents]))}>{fmtEuro(v.open.reduce((n, o) => n + o.openCents, 0n))}</Cijfer></b></span>
        </div>
        <h2 className="bw-h2">{T.list.due}</h2>
        <Table id="sales-due" rows={v.due} rowKey={(d) => `${d.workId}-${d.stepKey}`} onRow={(d) => go(`werven/${d.workId}/facturatie/facturen`)} defaultSort="wanneer" empty={T.list.dueNone}
          columns={[
            { key: "werf", label: "Werf", sort: (d) => d.workCode, render: (d) => `${d.workCode} · ${d.workName}` },
            { key: "titel", label: T.cols.title, render: (d) => d.title },
            { key: "pct", label: "%", right: true, optional: true, sort: (d) => d.pctBp, render: (d) => fmtBp(d.pctBp) },
            { key: "wanneer", label: T.cols.due, sort: (d) => d.dueDay ?? null, render: (d) => <>{whenText(d.when)}{d.dueDay !== undefined ? ` · ${fmtDayNum(d.dueDay)}` : ""}{d.now && <> <Tag tone="warn">{T.list.dueNow}</Tag></>}</> },
            { key: "bedrag", label: T.cols.total, right: true, sort: (d) => d.stepCents, render: (d) => fmtEuro(d.stepCents) },
            { key: "ontwerp", label: T.draft, optional: true, render: (d) => (d.draftId !== undefined ? <Tag>{T.draft}</Tag> : "") },
          ]} />
        <h2 className="bw-h2">{T.list.open}</h2>
        <Table id="sales-open" rows={v.open} rowKey={(o) => String(o.brief.id)} onRow={(o) => setOpen(o.brief.id)} defaultSort="-laat" empty={T.list.openNone}
          columns={[
            { key: "nummer", label: T.cols.number, sort: (o) => o.brief.number, render: (o) => <span className="bw-code">{o.brief.number}</span> },
            { key: "werf", label: "Werf", sort: (o) => o.brief.workCode, render: (o) => `${o.brief.workCode} · ${o.workName}` },
            { key: "klant", label: "Klant", optional: true, sort: (o) => o.clientName, render: (o) => o.clientName },
            { key: "laat", label: T.cols.due, sort: (o) => o.daysLate, render: (o) => <>{fmtDayNum(o.brief.dueDay)}{o.daysLate > 0n && <> <Tag tone="bad">{T.list.late(Number(o.daysLate))}</Tag></>}</> },
            { key: "totaal", label: T.cols.total, right: true, optional: true, sort: (o) => o.totalCents, render: (o) => fmtEuro(o.totalCents) },
            { key: "open", label: T.cols.open, right: true, sort: (o) => o.openCents, render: (o) => fmtEuro(o.openCents) },
          ]} />
        {v.drafts.length > 0 && <>
          <h2 className="bw-h2">{T.list.drafts}</h2>
          <ul>{v.drafts.map((d) => <li key={String(d.id)}><a href="#" onClick={(e) => { e.preventDefault(); setOpen(d.id); }}>{d.workCode} · {d.kindTitle} · {d.title}</a></li>)}</ul>
        </>}
        <QuarterExport today={v.today} />
      </>}
      {open !== null && <FactuurSheet id={open} caps={caps} onClose={() => { setOpen(null); void qc.invalidateQueries({ queryKey: ["salesWorklist"] }); }} onOpen={setOpen} />}
    </section>
    </Page>
  );
}

/** Mijn werf → Facturatie: de uitgereikte facturen van de klant (met PDF) en het schema. */
export function MySales({ workId }: { workId: bigint }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const q = useQuery({ queryKey: ["mySales"], queryFn: async () => unwrap(await actor!.listMySales()), enabled: !!actor && !isFetching, retry: false });
  const pdf = useMutation({
    mutationFn: async (id: bigint) => { const d = unwrap(await actor!.readMySalesInvoice(id)); await downloadFactuurPdf(pdfData(d.doc, d.hash, false)); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const rows = (q.data?.invoices ?? []).filter((r) => r.workId === workId);
  const sched = (q.data?.schedule ?? []).filter((s) => s.workId === workId);
  if (!q.data) return <Loading q={q} />;
  if (rows.length === 0 && sched.length === 0) return null;
  return (
    <section className="a-section" data-testid="my-sales">
      <h2 className="bw-h2">{T.mine.title}<Info text={T.mine.lead} label={t.uitleg.label} /></h2>
      {rows.length === 0 ? <p className="bw-muted">{T.mine.none}</p> : (
        <div className="a-tablewrap"><table className="a-table">
          <thead><tr><th>{T.cols.number}</th><th>{T.cols.kind}</th><th>{T.cols.issued}</th><th>{T.cols.due}</th><th className="a-num">{T.cols.total}</th><th className="a-num">{T.cols.open}</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={String(r.id)}>
              <td>{r.number}</td><td>{r.kindTitle}{r.creditOf ? ` (${r.creditOf})` : ""}</td><td>{fmtDayNum(r.issueDay)}</td>
              <td>{fmtDayNum(r.dueDay)}{r.overdue ? ` · ${T.overdue}` : ""}</td><td className="a-num">{fmtEuro(r.totalCents)}</td>
              <td className="a-num">{fmtEuro(r.openCents)} ({T.pay[r.pay] ?? r.pay})</td>
              <td><Button busy={pdf.isPending} onClick={() => pdf.mutate(r.id)}>{T.pdf}</Button></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {sched.length > 0 && <>
        <h3 className="bw-h3">{T.mine.schedule}</h3>
        <ul>{sched.map((s, i) => <li key={i}>{s.title} {fmtBp(s.pctBp)} · {whenText(s.when)} · {T.stepStatus[s.status] ?? s.status}{s.numbers.length ? ` (${s.numbers.join(", ")})` : ""}</li>)}</ul>
      </>}
    </section>
  );
}

/** Beheer → Opmeting & facturatie → Facturen (de beheerder): gegevens van BOWACO, vermeldingen, betaaltermijn, tellers (AC-6/20/22/27). */
export function SalesSettingsAdmin() {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["salesSettings"], queryFn: () => actor!.salesSettings(), enabled: !!actor && !isFetching, retry: false });
  if (!q.data) return <section className="a-section"><h2 className="bw-h2">{T.settings.title}</h2><Loading q={q} /></section>;
  return <SettingsForm s={q.data} />;
}

function SettingsForm({ s }: { s: SalesSettingsView }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const S = T.settings;
  const [iss, setIss] = useState<Record<string, string>>({ name: s.issuerName, legalForm: s.issuer.legalForm, street: s.issuer.address.street, number: s.issuer.address.number, zip: s.issuer.address.zip, city: s.issuer.address.city, country: s.issuer.address.country, vat: s.issuer.vat, kbo: s.issuer.kbo, rpr: s.issuer.rpr, email: s.issuer.email, phone: s.issuer.phone, website: s.issuer.website, iban: s.issuer.iban, bic: s.issuer.bic });
  const [txt, setTxt] = useState({ vat6Text: s.vat6Text, reverseText: s.reverseText, creditText: s.creditText, paymentText: s.paymentText, footerText: s.footerText, reminderText: s.reminderText });
  const [num, setNum] = useState({ paymentDays: String(s.paymentDays), reminderDays: String(s.reminderDays), firstSeqF: String(s.firstSeqF), firstSeqCN: String(s.firstSeqCN), peppolScheme: s.peppolScheme });
  const [plan, setPlan] = useState(s.planBp.map((b) => fmtBp(b).replace(" %", "")).join(" / "));
  const [only, setOnly] = useState(s.issuerOnly);
  const [ctr, setCtr] = useState<Record<string, string>>({});
  const refresh = () => void qc.invalidateQueries({ queryKey: ["salesSettings"] });
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const save = useMutation({
    mutationFn: async () => {
      const planBp = plan.split("/").map((x) => parsePct(x.trim()) ?? 0n);
      unwrap(await actor!.saveSalesSettings({
        issuer: { name: iss.name, legalForm: iss.legalForm, address: { street: iss.street, number: iss.number, zip: iss.zip, city: iss.city, country: iss.country || "BE" }, vat: iss.vat, kbo: iss.kbo, rpr: iss.rpr, email: iss.email, phone: iss.phone, website: iss.website, iban: iss.iban, bic: iss.bic },
        ...txt, paymentDays: BigInt(Number(num.paymentDays) || 0), reminderDays: BigInt(Number(num.reminderDays) || 0), firstSeqF: BigInt(Number(num.firstSeqF) || 0), firstSeqCN: BigInt(Number(num.firstSeqCN) || 0), peppolScheme: num.peppolScheme, issuerOnly: only, planBp,
      }));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: S.saved }); refresh(); },
    onError: fail,
  });
  const setCounter = useMutation({
    mutationFn: async (c: { series: string; year: bigint }) => unwrap(await actor!.setSalesCounter(c.series, c.year, BigInt(Number(ctr[`${c.series}:${c.year}`]) || 0))),
    onSuccess: () => { toast.show({ kind: "ok", text: S.saved }); refresh(); },
    onError: fail,
  });
  return (
    <section className="a-section" data-testid="sales-settings">
      <h2 className="bw-h2">{S.title}<Info text={S.lead} label={t.uitleg.label} /></h2>
      <div className="a-grid2">{Object.keys(S.issuer).map((k) => <label key={k}>{S.issuer[k]}<input className="bw-input" value={iss[k] ?? ""} onChange={(e) => setIss({ ...iss, [k]: e.target.value })} /></label>)}</div>
      <div className="a-grid2">
        {(["paymentDays", "reminderDays", "firstSeqF", "firstSeqCN"] as const).map((k) => <label key={k}>{S[k]}<input className="bw-input" inputMode="numeric" value={num[k]} onChange={(e) => setNum({ ...num, [k]: e.target.value.replace(/\D/g, "") })} /></label>)}
        <label>{S.peppolScheme}<input className="bw-input" value={num.peppolScheme} onChange={(e) => setNum({ ...num, peppolScheme: e.target.value })} /></label>
        <label>{S.plan}<input className="bw-input" value={plan} onChange={(e) => setPlan(e.target.value)} /></label>
      </div>
      <label className="a-check"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> {S.issuerOnly}</label>
      {(["vat6Text", "reverseText", "creditText", "paymentText", "footerText", "reminderText"] as const).map((k) => <label key={k}>{S[k]}<textarea className="bw-input" rows={k === "vat6Text" || k === "reverseText" || k === "reminderText" ? 4 : 2} value={txt[k]} onChange={(e) => setTxt({ ...txt, [k]: e.target.value })} /></label>)}
      <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{T.save}</Button>
      <h3 className="bw-h3">{S.counters}</h3>
      <p className="bw-muted">{S.counterLead}</p>
      {s.counters.map((c) => (
        <div key={`${c.series}:${c.year}`} className="a-row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span>{S.counter(c.series, String(c.year), String(c.last), String(c.next))}{c.locked ? ` · ${S.locked}` : ""}</span>
          {!c.locked && <><input className="bw-input" style={{ width: 90 }} inputMode="numeric" aria-label={S.setCounter} value={ctr[`${c.series}:${c.year}`] ?? ""} onChange={(e) => setCtr({ ...ctr, [`${c.series}:${c.year}`]: e.target.value.replace(/\D/g, "") })} /><Button busy={setCounter.isPending} disabled={!ctr[`${c.series}:${c.year}`]} onClick={() => setCounter.mutate({ series: c.series, year: c.year })}>{S.setCounter}</Button></>}
        </div>
      ))}
    </section>
  );
}
