// Een uitgereikte factuur of creditnota (stap 2c.6): wat vastligt (controlecode), PDF, verstuurd markeren, betalingen inboeken en
// ongedaan maken, een creditnota maken (volledig of deels). Niets van de inhoud is nog te wijzigen.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SalesFullView } from "../backend";
import { Button, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtEuro, inputToDay, parseEuro, todayDay, unwrap, useBackend } from "../util";
import { downloadFactuurPdf, pdfData } from "../sales/adapt";
import { Totals } from "./FactuurSheet";
import { SalesExtra } from "./FactuurExtra";

const T = t.sales;

export function SalesAfter({ v, onOpen }: { v: SalesFullView; onOpen: (id: bigint) => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [how, setHow] = useState("");
  const [payDay, setPayDay] = useState(dayToInput(todayDay()));
  const [payAmount, setPayAmount] = useState("");
  const [payHow, setPayHow] = useState("overschrijving");
  const [undo, setUndo] = useState<bigint | null>(null);
  const [undoWhy, setUndoWhy] = useState("");
  const b = v.brief;
  const credit = b.kind === "creditnota";
  const refresh = () => { for (const k of ["salesInvoice"]) void qc.invalidateQueries({ queryKey: [k, String(b.id)] }); for (const k of ["sales", "salesPlan", "minmeer"]) void qc.invalidateQueries({ queryKey: [k, String(b.workId)] }); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const sent = useMutation({ mutationFn: async () => unwrap(await actor!.markSalesSent(b.id, how)), onSuccess: () => { setHow(""); refresh(); }, onError: fail });
  const pay = useMutation({
    mutationFn: async () => unwrap(await actor!.addSalesPayment(b.id, inputToDay(payDay) ?? todayDay(), parseEuro(payAmount) ?? 0n, payHow, "")),
    onSuccess: () => { setPayAmount(""); refresh(); },
    onError: fail,
  });
  const unpay = useMutation({ mutationFn: async () => unwrap(await actor!.archiveSalesPayment(undo!, undoWhy)), onSuccess: () => { setUndo(null); setUndoWhy(""); refresh(); }, onError: fail });
  const mkCredit = useMutation({
    mutationFn: async (full: boolean) => unwrap(await actor!.newSalesInvoice(b.workId, { __kind__: "credit", credit: { invoiceId: b.id, full } })),
    onSuccess: (id) => { refresh(); onOpen(id); },
    onError: fail,
  });
  const amount = parseEuro(payAmount);
  return (
    <div data-testid="sales-issued">
      <p><b>{b.kindTitle} {b.number}</b> · {fmtDayNum(b.issueDay)}{!credit && b.dueDay !== undefined ? ` · ${T.cols.due.toLowerCase()} ${fmtDayNum(b.dueDay)}` : ""}{b.overdue ? ` · ${T.overdue}` : ""}</p>
      <p className="bw-muted">{T.hash(v.hash.slice(0, 16))}{v.intact ? "" : " · controlecode klopt niet!"}{b.creditOf ? ` · bij ${b.creditOf}` : ""}{b.credits.length ? ` · ${T.credit}: ${b.credits.join(", ")}` : ""}</p>
      <div className="a-tablewrap">
        <table className="a-table">
          <thead><tr><th>{T.line.group}</th><th>{T.line.desc}</th><th className="a-num">{T.line.amount}</th></tr></thead>
          <tbody>{v.lines.map((l, i) => <tr key={i}><td>{l.group}</td><td>{l.description}</td><td className="a-num">{fmtEuro(l.amountCents)}</td></tr>)}</tbody>
        </table>
      </div>
      <Totals tot={v.totals} />
      {!credit && <p>{T.totals.paid}: {fmtEuro(v.paidCents)} · {T.totals.credited}: {fmtEuro(v.creditedCents)} · <b>{T.totals.open}: {fmtEuro(v.openCents)}</b> ({T.pay[b.pay] ?? b.pay})</p>}
      <div className="a-row" style={{ flexWrap: "wrap", gap: 6 }}>
        <Button onClick={() => void downloadFactuurPdf(pdfData(v.doc, v.hash, false))}>{T.pdf}</Button>
        <SalesExtra v={v} onDone={refresh} />
        {!credit && b.pay !== "gecrediteerd" && <><Button onClick={() => mkCredit.mutate(true)} disabled={v.creditedCents !== 0n} busy={mkCredit.isPending}>{T.creditFull}</Button><Button onClick={() => mkCredit.mutate(false)} busy={mkCredit.isPending}>{T.creditPart}</Button></>}
      </div>
      <div className="a-card" style={{ marginTop: 8 }}>
        <p className="bw-muted">{b.sent ? "Verstuurd" : T.sent}</p>
        <div className="a-row" style={{ gap: 6 }}><input className="bw-input" aria-label={T.sentHow} placeholder={T.sentHow} value={how} onChange={(e) => setHow(e.target.value)} /><Button disabled={!how.trim()} busy={sent.isPending} onClick={() => sent.mutate()}>{T.sent}</Button></div>
      </div>
      {!credit && (
        <div className="a-card" style={{ marginTop: 8 }} data-testid="sales-payments">
          <h3 className="bw-h3">{T.payment}</h3>
          {v.payments.map((p) => (
            <div key={String(p.id)} className="a-row a-row--between">
              <span className={p.archived ? "bw-muted" : ""}>{fmtDayNum(p.day)} · {fmtEuro(p.cents)} · {p.how}{p.archived ? ` · ongedaan: ${p.archiveReason}` : ""}</span>
              {!p.archived && <Button onClick={() => setUndo(p.id)}>{T.payUndo}</Button>}
            </div>
          ))}
          {undo !== null && <div className="a-row" style={{ gap: 6 }}><input className="bw-input" aria-label={T.cancelReason} placeholder={T.cancelReason} value={undoWhy} onChange={(e) => setUndoWhy(e.target.value)} /><Button variant="danger" disabled={undoWhy.trim().length < 5} busy={unpay.isPending} onClick={() => unpay.mutate()}>{T.payUndo}</Button></div>}
          {v.openCents > 0n && (
            <div className="a-row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <input className="bw-input" type="date" aria-label={T.payDay} value={payDay} onChange={(e) => setPayDay(e.target.value)} />
              <input className="bw-input" inputMode="decimal" aria-label={T.payAmount} placeholder={fmtEuro(v.openCents)} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              <input className="bw-input" aria-label={T.payHow} value={payHow} onChange={(e) => setPayHow(e.target.value)} />
              <Button variant="primary" disabled={!amount || amount > v.openCents} busy={pay.isPending} onClick={() => pay.mutate()}>{T.payment}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
