// Eén factuur of creditnota (stap 2c.6): een ontwerp bewerken (kop, btw, regels bij een vrije factuur of een creditnota), de controle
// van §7.2 zien, uitreiken met een bevestiging in het scherm (geen pop-up), wegdoen met reden; na het uitreiken: PDF, UBL voor een
// bedrijf, verstuurd markeren, betalingen, creditnota, herinnering. De browser rekent mee (sales/calc.ts) en de server weigert als
// het totaal verschilt.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Caps, SalesFullView, SalesVat } from "../backend";
import { SalesLineKind } from "../backend";
import { Button, Confirm, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtBp, fmtDayNum, fmtEuro, inputToDay, parseEuro, todayDay, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { lineAmount, totals as calcTotals } from "../sales/calc";
import { downloadFactuurPdf, pdfData } from "../sales/adapt";
import { SalesAfter } from "./FactuurNa";
import { parseQty } from "./MinMeer";

const T = t.sales;
type LineRow = { kind: SalesLineKind; group: string; description: string; ref: string; qty: string; unit: string; price: string; vatBp: bigint };
const vatOf = (k: string): SalesVat => (k === "reverse" ? { __kind__: "reverse", reverse: null } : k === "mixed" ? { __kind__: "mixed", mixed: null } : { __kind__: "rate", rate: k === "600" ? 600n : 2100n });
const vatKey = (v: SalesVat) => (v.__kind__ === "rate" ? String(v.rate) : v.__kind__);
const euroInput = (c: bigint) => (Number(c) / 100).toFixed(2).replace(".", ",");
const qtyIn = (m: bigint) => (Number(m) / 1000).toString().replace(".", ",");
const parseSigned = (s: string) => { const neg = s.trim().startsWith("-"); const x = parseEuro(s.replace("-", "")); return x === null || x === undefined ? x : neg ? -x : x; };

export function FactuurSheet({ id, caps, onClose, onOpen }: { id: bigint; caps: Caps; onClose: () => void; onOpen: (id: bigint) => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["salesInvoice", String(id)], queryFn: async () => unwrap(await actor!.readSalesInvoice(id)), enabled: !!actor && !isFetching, retry: false });
  const v = q.data;
  const title = v ? (v.brief.number ? `${v.brief.kindTitle} ${v.brief.number}` : `${v.brief.kindTitle} · ${T.draft}`) : T.title;
  return (
    <Sheet title={title} open onClose={onClose} wide>
      {!v ? <Loading q={q} /> : v.brief.status === "ontwerp" ? <DraftBody v={v} caps={caps} onClose={onClose} /> : <SalesAfter v={v} onOpen={onOpen} />}
    </Sheet>
  );
}

function DraftBody({ v, caps, onClose }: { v: SalesFullView; caps: Caps; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const editable = v.brief.kind === "vrij" || v.brief.kind === "creditnota";
  const credit = v.brief.kind === "creditnota";
  const [title, setTitle] = useState(v.brief.title);
  const [note, setNote] = useState(v.note);
  const [svc, setSvc] = useState(dayToInput(v.serviceDay));
  const [svcTo, setSvcTo] = useState(dayToInput(v.serviceTo));
  const [days, setDays] = useState(String(v.paymentDays));
  const [vat, setVat] = useState(vatKey(v.vat));
  const [rows, setRows] = useState<LineRow[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => {
    setRows(v.lines.map((l) => ({ kind: l.kind, group: l.group, description: l.description, ref: l.ref, qty: qtyIn(l.qtyMilli), unit: l.unit, price: euroInput(l.unitCents), vatBp: l.vatBp })));
  }, [v]);
  const parsed = rows.map((r) => ({ q: parseQty(r.qty), u: parseSigned(r.price), r }));
  const bad = parsed.some((x) => x.q === null || x.u === null || x.u === undefined);
  const lines = parsed.map((x) => ({ kind: x.r.kind, group: x.r.group, description: x.r.description, ref: x.r.ref, qtyMilli: x.q ?? 0n, unit: x.r.unit, unitCents: x.u ?? 0n, vatBp: vat === "mixed" ? x.r.vatBp : vat === "reverse" ? 0n : BigInt(vat === "600" ? 600 : 2100) }));
  const tot = useMemo(() => calcTotals(lines.map((l) => ({ amountCents: lineAmount(l.qtyMilli, l.unitCents), vatBp: l.vatBp })), vat === "reverse"), [rows, vat]);
  const dirty = title !== v.brief.title || note !== v.note || svc !== dayToInput(v.serviceDay) || svcTo !== dayToInput(v.serviceTo) || days !== String(v.paymentDays) || vat !== vatKey(v.vat) || (editable && JSON.stringify(lines, (_, x) => (typeof x === "bigint" ? String(x) : x)) !== JSON.stringify(v.lines.map((l) => ({ kind: l.kind, group: l.group, description: l.description, ref: l.ref, qtyMilli: l.qtyMilli, unit: l.unit, unitCents: l.unitCents, vatBp: l.vatBp })), (_, x) => (typeof x === "bigint" ? String(x) : x)));
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["salesInvoice", String(v.brief.id)] }); void qc.invalidateQueries({ queryKey: ["sales", String(v.brief.workId)] }); void qc.invalidateQueries({ queryKey: ["salesPlan", String(v.brief.workId)] }); };
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveSalesDraft(v.brief.id, v.brief.rev, { title, note, serviceDay: inputToDay(svc), serviceTo: inputToDay(svcTo), paymentDays: BigInt(Number(days) || 0), vat: vatOf(vat), lines: editable ? lines : undefined, expectTotalCents: tot.totalCents })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); refresh(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const issue = useMutation({
    mutationFn: async () => unwrap(await actor!.issueSalesInvoice(v.brief.id, v.brief.rev, v.totals.totalCents)),
    onSuccess: (nr) => { toast.show({ kind: "ok", text: T.issued(nr) }); setConfirm(false); refresh(); },
    onError: (e) => { toast.show({ kind: "error", text: errText(e) }); setConfirm(false); refresh(); },
  });
  const drop = useMutation({
    mutationFn: async () => unwrap(await actor!.cancelSalesDraft(v.brief.id, reason)),
    onSuccess: () => { refresh(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const blocks = v.findings.filter((f) => f.block);
  const warns = v.findings.filter((f) => !f.block);
  const setRow = (i: number, p: Partial<LineRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const recheckOk = !dirty ? tot.totalCents === v.totals.totalCents : true;
  return (
    <div data-testid="sales-draft">
      <p className="bw-muted">{T.draft}{credit && v.brief.creditOf ? ` · ${T.credit} ${v.brief.creditOf}` : ""}</p>
      <div className="a-grid2">
        <label>{T.header.title}<input className="bw-input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>{T.header.vat}
          <select className="bw-input" value={vat} disabled={credit} onChange={(e) => setVat(e.target.value)}>
            <option value="600">{T.vat.rate600}</option><option value="2100">{T.vat.rate2100}</option><option value="reverse">{T.vat.reverse}</option><option value="mixed">{T.vat.mixed}</option>
          </select>
        </label>
        <label>{T.header.serviceDay}<input className="bw-input" type="date" value={svc} onChange={(e) => setSvc(e.target.value)} /></label>
        <label>{T.header.serviceTo}<input className="bw-input" type="date" value={svcTo} onChange={(e) => setSvcTo(e.target.value)} /></label>
        {!credit && <label>{T.header.paymentDays}<input className="bw-input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} /></label>}
      </div>
      <label>{T.header.note}<textarea className="bw-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <h3 className="bw-h3">{T.lines}</h3>
      {!editable && <p className="bw-muted">{T.sourceLines}</p>}
      <div className="a-tablewrap">
        <table className="a-table">
          <thead><tr><th>{T.line.group}</th><th>{T.line.desc}</th><th className="a-num">{T.line.qty}</th><th>{T.line.unit}</th><th className="a-num">{T.line.price}</th>{vat === "mixed" && <th>{T.line.vat}</th>}<th className="a-num">{T.line.amount}</th>{editable && <th />}</tr></thead>
          <tbody>
            {parsed.map(({ q, u, r }, i) => (
              <tr key={i}>
                {editable ? <>
                  <td><input className="bw-input" aria-label={T.line.group} value={r.group} onChange={(e) => setRow(i, { group: e.target.value })} /></td>
                  <td><input className="bw-input" aria-label={T.line.desc} value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} /></td>
                  <td><input className="bw-input" style={{ width: 80 }} aria-label={T.line.qty} inputMode="decimal" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} /></td>
                  <td><input className="bw-input" style={{ width: 60 }} aria-label={T.line.unit} value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} /></td>
                  <td><input className="bw-input" style={{ width: 100 }} aria-label={T.line.price} inputMode="decimal" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} /></td>
                </> : <><td>{r.group}</td><td>{r.description}{r.kind === SalesLineKind.revision ? ` (${T.line.revision})` : ""}</td><td className="a-num">{r.qty}</td><td>{r.unit}</td><td className="a-num">{fmtEuro(u ?? 0n)}</td></>}
                {vat === "mixed" && <td><select className="bw-input" aria-label={T.line.vat} value={String(r.vatBp)} disabled={!editable} onChange={(e) => setRow(i, { vatBp: BigInt(e.target.value) })}><option value="600">6 %</option><option value="2100">21 %</option></select></td>}
                <td className="a-num">{q === null || u === null || u === undefined ? "?" : fmtEuro(lineAmount(q, u))}</td>
                {editable && <td><Button iconOnly icon="close" aria-label={t.common.close} onClick={() => setRows(rows.filter((_, j) => j !== i))} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && <Button icon="plus" onClick={() => setRows([...rows, { kind: SalesLineKind.work, group: rows[rows.length - 1]?.group ?? "", description: "", ref: "", qty: credit ? "-1" : "1", unit: "sog", price: "0,00", vatBp: 2100n }])}>{T.addLine}</Button>}
      <Totals tot={tot} />
      {!recheckOk && <p className="a-err" role="alert">{T.recheck}</p>}
      {blocks.length > 0 && <div className="a-note a-note--warn" role="note"><b>{T.findings}</b><ul>{blocks.map((f) => <li key={f.key}>{f.text}</li>)}</ul></div>}
      {warns.length > 0 && <div className="a-note" role="note"><b>{T.warnings}</b><ul>{warns.map((f) => <li key={f.key}>{f.text}</li>)}</ul></div>}
      <div className="a-row" style={{ flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <Button variant="primary" disabled={!dirty || bad} busy={save.isPending} onClick={() => save.mutate()}>{T.save}</Button>
        <Button onClick={() => void downloadFactuurPdf(pdfData(v.doc, "", true))}>{T.pdf}</Button>
        <Button variant="primary" disabled={dirty || blocks.length > 0 || !caps.issueSales} onClick={() => setConfirm(true)}>{T.issue}</Button>
        <Button variant="danger" onClick={() => setCancel(true)}>{T.cancel}</Button>
      </div>
      <Confirm open={confirm} title={T.issue} text={T.issueConfirm(credit ? "CN" : "")} confirmLabel={T.issue} busy={issue.isPending} onConfirm={() => issue.mutate()} onClose={() => setConfirm(false)} />
      {cancel && (
        <div className="a-card" style={{ marginTop: 8 }}>
          <label>{T.cancelReason}<input className="bw-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="a-row" style={{ gap: 6 }}><Button onClick={() => setCancel(false)}>{t.common.cancel}</Button><Button variant="danger" disabled={reason.trim().length < 5} busy={drop.isPending} onClick={() => drop.mutate()}>{T.cancel}</Button></div>
        </div>
      )}
    </div>
  );
}

export function Totals({ tot }: { tot: { netCents: bigint; vatCents: bigint; totalCents: bigint; vatLines: { vatBp: bigint; reverse: boolean; baseCents: bigint; vatCents: bigint }[] } }) {
  return (
    <table className="a-table a-table--totals" style={{ marginTop: 8 }}>
      <tbody>
        {tot.vatLines.map((x, i) => <tr key={i}><td>{x.reverse ? T.vat.reverse : `${T.totals.vat} ${fmtBp(x.vatBp)} op ${fmtEuro(x.baseCents)}`}</td><td className="a-num">{fmtEuro(x.vatCents)}</td></tr>)}
        <tr><td>{T.totals.net}</td><td className="a-num">{fmtEuro(tot.netCents)}</td></tr>
        <tr><td>{T.totals.vat}</td><td className="a-num">{fmtEuro(tot.vatCents)}</td></tr>
        <tr><td><b>{T.totals.total}</b></td><td className="a-num"><b>{fmtEuro(tot.totalCents)}</b></td></tr>
      </tbody>
    </table>
  );
}

export const today = () => todayDay();
export const dayText = (d: bigint | undefined) => fmtDayNum(d);
