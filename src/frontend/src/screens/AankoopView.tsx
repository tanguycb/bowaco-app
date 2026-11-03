// Een aankoopfactuur met bedragen (stap 2c.7; admin en calculator, update-call met auditregel): de regels per werf met hun controle
// (tarief van de werf per dag, kostensoorten, voorschot), de uren per dag naast het werfverslag, de werfdelen met hun eigen controle en
// goedkeuring (inhoudingsplicht), het voorschot van de OA, de betaalkorting; goedkeuren of betwisten zonder werfdelen (leverancier);
// intrekken; betaald markeren. Bevestigen in een paneel (geen window.confirm).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type PurchaseFullView } from "../backend";
import { Button, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtEuro, fmtTime, inputToDay, todayDay, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { OpenConfidential } from "./Dossier";
import { TA, purchaseTag, slotsText } from "./Aankoop";
import { fmtQty } from "./Offertes";

const T = t.oaFacturen;
const pct = (bp: bigint) => `${(Number(bp) / 100).toString().replace(".", ",")} %`;

export function PurchaseView({ id, go }: { id: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["purchaseFull", String(id)], queryFn: async () => unwrap(await actor!.readPurchase(id)), enabled: !!actor && !isFetching, staleTime: 0, gcTime: 0 });
  const [sheet, setSheet] = useState<null | "approve" | "dispute" | "withdraw" | "pay">(null);
  const [reason, setReason] = useState("");
  const [payDay, setPayDay] = useState(dayToInput(todayDay()));
  const [whDay, setWhDay] = useState("");
  const [busy, setBusy] = useState(false);
  const v: PurchaseFullView | undefined = q.data;
  if (!v) return <Page label={T.label} title={TA.title}><Loading q={q} /></Page>;
  const b = v.brief;
  const run = async (f: () => Promise<unknown>, text: string) => {
    setBusy(true);
    try {
      unwrap((await f()) as never);
      toast.show({ kind: "ok", text });
      setSheet(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["purchases"] });
      void qc.invalidateQueries({ queryKey: ["oaInvoices"] });
      await q.refetch();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const flagN = Number(v.flagCount);
  return (
    <Page
      wide
      label={`${T.label} · ${TA.kinds[b.kind]}`}
      title={`${b.orgName} · ${b.number}`}
      actions={<>
        <Button icon="back" onClick={() => go("oa-facturen/aankoop")}>{t.common.back}</Button>
        {v.canEdit && <Button icon="edit" onClick={() => go(`oa-facturen/aankoop/${id}/wijzigen`)} data-testid="pu-edit">{TA.edit}</Button>}
        {v.canDecide && <Button variant="primary" icon="check" onClick={() => setSheet("approve")} data-testid="pu-approve">{TA.approve}</Button>}
        {v.canDecide && b.status === "registered" && <Button icon="alert" onClick={() => setSheet("dispute")} data-testid="pu-dispute">{TA.dispute}</Button>}
        {v.canPay && <Button icon="check" onClick={() => { setPayDay(dayToInput(b.paidDay ?? todayDay())); setWhDay(dayToInput(b.withheldDay)); setSheet("pay"); }} data-testid="pu-pay-mark">{TA.pay}</Button>}
        {(b.status === "registered" || b.status === "disputed") && <Button variant="quiet" icon="close" onClick={() => setSheet("withdraw")} data-testid="pu-withdraw">{TA.withdraw}</Button>}
        {b.creditOf === undefined && (b.status === "approved" || b.status === "registered" || b.status === "checking") && v.lines.some((l) => l.kind !== "aftrek-voorschot" && (l.amountCents < 0n ? -l.amountCents : l.amountCents) > l.creditedCents) && <Button variant="quiet" icon="plus" onClick={() => go(`oa-facturen/aankoop/nieuw?credit=${id}`)} data-testid="pu-credit">{TA.credit}</Button>}
      </>}
    >
      <div className="vs-head">
        <span className={`a-tag ${purchaseTag(b.status)}`}>{TA.status[b.status]}</span>
        <span className="bw-muted">{T.dayLine(fmtDayNum(b.invoiceDay), b.dueDay !== undefined ? fmtDayNum(b.dueDay) : "–")}{v.periodFrom !== undefined ? ` · ${T.periodLine(fmtDayNum(v.periodFrom), fmtDayNum(v.periodTo))}` : ""}{b.paidDay !== undefined ? ` · ${TA.paidOn(fmtDayNum(b.paidDay))}` : ""}</span>
        {v.file && <OpenConfidential fileId={v.file.id} />}
        {v.statement && <span className="bw-muted">{v.oaStatementRef || TA.statement}: <OpenConfidential fileId={v.statement.id} /></span>}
      </div>
      {b.creditOf !== undefined && <p className="a-note" data-testid="pu-credit-of">{TA.creditOf("")}<a href={`#/oa-facturen/aankoop/${b.creditOf}`}>{b.creditOfNumber}</a></p>}
      {v.credits.length > 0 && (
        <div className="a-note" data-testid="pu-credits">
          <strong>{TA.credits}: </strong>
          {v.credits.map((c, k) => <span key={String(c.id)}>{k > 0 ? " · " : ""}<a href={`#/oa-facturen/aankoop/${c.id}`}>{c.number}</a> {fmtDayNum(c.invoiceDay)} −{fmtEuro(c.totalCents)} ({TA.status[c.status]})</span>)}
        </div>
      )}
      {v.decision && <p className={v.decision.approved ? "a-note" : "a-err"}>{v.decision.approved ? T.decisionOk(v.decision.byName, fmtTime(v.decision.at)) : T.decisionNo(v.decision.byName, fmtTime(v.decision.at))}{v.decision.reason ? `: ${v.decision.reason}` : ""}</p>}
      <div className="vs-top">
        <section className="vs-card" data-testid="pu-amounts">
          <h2 className="bw-h3">{T.amounts}</h2>
          <dl className="vs-dl">
            <div><dt>{T.net}</dt><dd className="bw-mono">{fmtEuro(v.netCents)}</dd></div>
            <div><dt>{T.sumLines}</dt><dd className={`bw-mono${v.sumLinesCents !== v.netCents ? " a-err" : ""}`}>{fmtEuro(v.sumLinesCents)}</dd></div>
            <div><dt>{v.vatRegime.__kind__ === "reverse" ? T.regimes.reverse : T.vatAt(String(Number(v.vatRegime.normal) / 100))}</dt><dd className="bw-mono">{fmtEuro(v.vatCents)}</dd></div>
            <div className="vs-dl__big"><dt>{T.total}</dt><dd className="bw-mono">{fmtEuro(v.totalCents)}</dd></div>
          </dl>
          {v.discountBp !== undefined && b.discountUntil !== undefined && <p className="a-note" data-testid="pu-discount">{TA.discountLine(pct(v.discountBp), fmtDayNum(b.discountUntil), fmtEuro(v.discountCents))}</p>}
          {v.withholdSocialCents + v.withholdFiscalCents > 0n && <p className="a-err" data-testid="pu-withhold">{TA.withhold(fmtEuro(v.withholdSocialCents), fmtEuro(v.withholdFiscalCents))}{b.withheldDay !== undefined ? ` · ${TA.withheldOn(fmtDayNum(b.withheldDay))}` : ""}</p>}
          {v.attestWarnings.length > 0 && <div className="a-alert"><strong>{t.afspraken.warnings}: </strong>{v.attestWarnings.join(" · ")}</div>}
          {v.headerFlags.length > 0 && <ul className="vs-findings">{v.headerFlags.map((f) => <li key={f.key}><span className="a-tag a-tag--warn">{T.flagTag}</span> {T.flags[f.key] ?? f.text}</li>)}</ul>}
          {v.advances.length > 0 && (
            <>
              <h3 className="bw-h3">{TA.advances}</h3>
              <ul className="vs-facts" data-testid="pu-advances">{v.advances.map((a) => <li key={String(a.workId)}>{TA.advanceLine(a.workCode, a.allowedCents !== undefined ? fmtEuro(a.allowedCents) : "–", fmtEuro(a.advancedCents), fmtEuro(a.deductedCents), fmtEuro(a.restCents))}{a.final ? ` · ${TA.final}` : ""}</li>)}</ul>
            </>
          )}
        </section>
        <section className="vs-card" data-testid="pu-parts">
          <h2 className="bw-h3">{TA.parts}</h2>
          {b.works.some((w) => w.partId !== undefined) ? (
            <>
              <p className="bw-muted">{TA.partsLead}</p>
              <ul className="vs-facts">{b.works.map((w) => <li key={String(w.workId)}>{w.workCode} {w.workName} · {w.partStatus ? T.status[w.partStatus] : "–"} {w.partId !== undefined && <button type="button" className="wb-link" onClick={() => go(`oa-facturen/${w.partId}`)} data-testid="pu-open-part">{TA.openPart}</button>}</li>)}</ul>
            </>
          ) : <p className="bw-muted">{TA.noParts}</p>}
        </section>
      </div>
      <section className="vs-section">
        <h2 className="bw-h3">{TA.lines} {flagN > 0 ? <span className="a-tag a-tag--warn">{T.flagCount(v.flagCount)}</span> : null}</h2>
        <div className="bw-table-wrap">
          <table className="bw-table bw-table--stack oi-table" data-testid="pu-lines">
            <thead><tr><th>{TA.description}</th><th>{TA.work}</th><th className="bw-right">{TA.qty}</th><th className="bw-right">{TA.unitPrice}</th><th className="bw-right">{T.agreed}</th><th className="bw-right">{TA.amount}</th></tr></thead>
            <tbody>
              {v.lines.map((l) => {
                const flags = [...l.qtyFlags, ...l.moneyFlags];
                return (
                  <tr key={String(l.index)} data-testid="pu-line-view">
                    <td data-label={TA.description}>
                      <span className="vs-post">
                        <b>{l.postTitle || l.description || l.kindName}</b>
                        <span className="bw-muted vs-sub">{l.kindName}{l.persons !== undefined ? ` · ${l.persons} ${TA.persons.toLowerCase()}` : ""}{l.passOn ? ` · ${TA.passOn.toLowerCase()}` : ""}</span>
                        {l.days.map((d) => <span key={String(d.claimId)} className="bw-muted vs-sub">{fmtDayNum(d.day)}: {String(d.persons)} × {slotsText(d.slots)}{d.pauseMin > 0n ? ` − ${d.pauseMin} min` : ""} = {fmtQty(d.hoursMilli)} u · {TA.hoursReport} {fmtQty(d.reportMilli)} u · {TA.claimStates[d.state]}{d.rateCents !== undefined ? ` · ${TA.dayRate(fmtQty(d.hoursMilli), fmtEuro(d.rateCents))} = ${fmtEuro(d.cents)}` : ""}{d.reviewNote ? ` · ${d.reviewNote}` : ""}</span>)}
                        {l.dayCents !== undefined && <span className="bw-muted vs-sub">{TA.dayCalc}: {fmtEuro(l.dayCents)}</span>}
                        {flags.length > 0 ? <span className="vs-flags">{flags.map((f, i) => <span key={i} className="a-tag a-tag--warn">{T.flags[f.key] ?? f.text}</span>)}</span> : <span className="vs-flags"><span className="a-tag a-tag--ok">{T.lineOk}</span></span>}
                      </span>
                    </td>
                    <td data-label={TA.work}>{l.workCode || TA.general}</td>
                    <td data-label={TA.qty} className="bw-right bw-mono">{fmtQty(l.qtyMilli)} {l.unit}</td>
                    <td data-label={TA.unitPrice} className="bw-right bw-mono">{fmtEuro(l.unitCents)}</td>
                    <td data-label={T.agreed} className="bw-right bw-mono">{l.agreedCents !== undefined ? fmtEuro(l.agreedCents) : "–"}</td>
                    <td data-label={TA.amount} className="bw-right bw-mono">{fmtEuro(l.amountCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <Sheet title={TA.approve} open={sheet === "approve"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={flagN > 0 && reason.trim().length < 5} onClick={() => void run(() => actor!.approvePurchase(id, b.rev, reason), TA.approvedOk)} data-testid="pu-approve-go">{TA.approve}</Button></>}>
        {flagN > 0 ? <label className="bw-field"><span className="bw-label">{TA.reasonFlags(flagN)}</span><textarea className="bw-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label> : <p>{TA.noFlags}</p>}
      </Sheet>
      <Sheet title={TA.dispute} open={sheet === "dispute"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 5} onClick={() => void run(() => actor!.disputePurchase(id, b.rev, reason), TA.disputedOk)}>{TA.dispute}</Button></>}>
        <label className="bw-field"><span className="bw-label">{TA.reason}</span><textarea className="bw-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </Sheet>
      <Sheet title={TA.withdraw} open={sheet === "withdraw"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 5} onClick={() => void run(() => actor!.withdrawPurchase(id, b.rev, reason), TA.withdrawnOk)} data-testid="pu-withdraw-go">{TA.withdraw}</Button></>}>
        <p>{T.withdrawLead}</p>
        <label className="bw-field"><span className="bw-label">{TA.reason}</span><textarea className="bw-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </Sheet>
      <Sheet title={TA.pay} open={sheet === "pay"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={false} onClick={() => void run(() => actor!.markPurchasePaid(id, b.rev, inputToDay(payDay) ?? null, inputToDay(whDay) ?? null), TA.paidOk)} data-testid="pu-pay-go">{TA.pay}</Button></>}>
        <label className="bw-field"><span className="bw-label">{TA.pay}</span><input type="date" className="bw-input" value={payDay} onChange={(e) => setPayDay(e.target.value)} /></label>
        {v.withholdSocialCents + v.withholdFiscalCents > 0n && <label className="bw-field"><span className="bw-label">{TA.withheld}</span><input type="date" className="bw-input" value={whDay} onChange={(e) => setWhDay(e.target.value)} /></label>}
      </Sheet>
    </Page>
  );
}
