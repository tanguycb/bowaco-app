// Verkoopfacturen (stap 2c.6, ontwerp 2c §3.1 en §4.6): werf → Facturatie → Facturen. Kantoor (admin, calculator) ziet het
// facturatieschema met bedragen (readSalesPlan: update-call met auditregel), maakt facturen uit een schijf, een vorderingsstaat, een
// min-meerversie of vrij, en opent een factuur (FactuurSheet). De werfleider ziet enkel het feit "voorschot betaald" (salesFacts, geen
// bedrag). De klant: Mijn werf → Facturatie (FacturenLijst.tsx). De browser rekent mee met sales/calc.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Caps, SalesBrief, SalesPlanView, SalesStepView, BillingWhen } from "../backend";
import { Button, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtBp, fmtDayNum, fmtEuro, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { FactuurSheet } from "./FactuurSheet";
import { PlanSheet } from "./FacturenPlan";

const T = t.sales;
export const whenText = (w: BillingWhen) => (w.__kind__ === "onDay" ? `${T.when.onDay} ${fmtDayNum(w.onDay)}` : T.when[w.__kind__]);

/** Werf → Facturatie → Facturen: kantoor met bedragen; de werfleider enkel "voorschot betaald". */
export function WorkSales({ workId, caps }: { workId: bigint; caps: Caps }) {
  return caps.sales ? <OfficeSales workId={workId} caps={caps} /> : <SalesFact workId={workId} />;
}

function SalesFact({ workId }: { workId: bigint }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["salesFacts", String(workId)], queryFn: () => actor!.salesFacts(workId), enabled: !!actor && !isFetching, retry: false });
  if (!q.data) return <section className="a-section"><h2 className="bw-h2">{T.title}</h2><Loading q={q} /></section>;
  return (
    <section className="a-section" data-testid="sales-fact">
      <h2 className="bw-h2">{T.title}</h2>
      <p>{T.fact[q.data.advance] ?? q.data.advance}{q.data.advanceDay !== undefined ? ` · ${T.cols.due.toLowerCase()} ${fmtDayNum(q.data.advanceDay)}` : ""}</p>
    </section>
  );
}

function OfficeSales({ workId, caps }: { workId: bigint; caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const plan = useQuery({ queryKey: ["salesPlan", String(workId)], queryFn: async () => unwrap(await actor!.readSalesPlan(workId)), enabled: !!actor && !isFetching, retry: false });
  const list = useQuery({ queryKey: ["sales", String(workId)], queryFn: () => actor!.listSales(workId), enabled: !!actor && !isFetching });
  const [open, setOpen] = useState<bigint | null>(null);
  const [editPlan, setEditPlan] = useState(false);
  const refresh = () => { for (const k of ["salesPlan", "sales", "minmeer"]) void qc.invalidateQueries({ queryKey: [k, String(workId)] }); };
  const make = useMutation({
    mutationFn: async (src: Parameters<NonNullable<typeof actor>["newSalesInvoice"]>[1]) => unwrap(await actor!.newSalesInvoice(workId, src)),
    onSuccess: (id) => { refresh(); setOpen(id); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const p = plan.data;
  return (
    <section className="a-section" data-testid="sales">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{T.title}</h2>
        <Button icon="plus" onClick={() => make.mutate({ __kind__: "free", free: null })} busy={make.isPending}>{T.makeFree}</Button>
      </div>
      <p className="bw-muted">{T.lead}</p>
      {plan.isError ? <p className="bw-muted">{T.noBase}</p> : !p ? <Loading q={plan} /> : <PlanCard p={p} onEdit={() => setEditPlan(true)} onMake={(src) => make.mutate(src)} busy={make.isPending} />}
      {p && p.progress.some((x) => x.billing === "klaar") && (
        <div className="a-row" style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {p.progress.filter((x) => x.billing === "klaar").map((x) => <Button key={String(x.id)} onClick={() => make.mutate({ __kind__: "progress", progress: x.id })}>{T.makeFromProgress} {x.code} ({fmtEuro(x.subtotalCents)})</Button>)}
        </div>
      )}
      <InvoiceList rows={list.data ?? []} onOpen={setOpen} />
      {open !== null && <FactuurSheet id={open} caps={caps} onClose={() => { setOpen(null); refresh(); }} onOpen={setOpen} />}
      {editPlan && p && <PlanSheet workId={workId} p={p} onClose={() => { setEditPlan(false); refresh(); }} />}
    </section>
  );
}

type Src = Parameters<NonNullable<ReturnType<typeof useBackend>["actor"]>["newSalesInvoice"]>[1];

function PlanCard({ p, onEdit, onMake, busy }: { p: SalesPlanView; onEdit: () => void; onMake: (src: Src) => void; busy: boolean }) {
  const [mmPick, setMmPick] = useState<string>("");
  const current = p.minMeer.filter((v) => v.current);
  return (
    <div className="a-card" data-testid="sales-plan" style={{ marginTop: 8 }}>
      <div className="a-row a-row--between">
        <h3 className="bw-h3">{T.plan}</h3>
        <Button onClick={onEdit}>{T.planEdit}</Button>
      </div>
      <p className="bw-muted">{T.planLead(p.baseQuote)} {T.contract}: <b>{fmtEuro(p.contractCents)}</b>{p.discountCents !== 0n ? ` (${T.discount} ${fmtEuro(p.discountCents)})` : ""}</p>
      <div className="a-tablewrap">
        <table className="a-table">
          <thead><tr><th>{T.cols.title}</th><th>%</th><th>{T.cols.due}</th><th className="a-num">{T.cols.total}</th><th>{T.cols.status}</th><th /></tr></thead>
          <tbody>
            {p.steps.map((s: SalesStepView) => (
              <tr key={s.key} data-testid={`step-${s.key}`}>
                <td>{s.title}{s.chapterPct.length > 0 && <div className="bw-muted">{s.chapterPct.map((c) => `${c.chapter}: ${fmtBp(c.pctBp)}`).join(" · ")}</div>}</td>
                <td>{fmtBp(s.pctBp)}</td>
                <td>{whenText(s.when)}{s.dueDay !== undefined ? ` · ${fmtDayNum(s.dueDay)}` : ""}</td>
                <td className="a-num">{fmtEuro(s.stepCents)}</td>
                <td>{T.stepStatus[s.status] ?? s.status}{s.numbers.length ? ` · ${s.numbers.join(", ")}` : ""}</td>
                <td>
                  {s.status === "open" && s.when.__kind__ !== "final" && <Button size="md" disabled={busy} onClick={() => onMake({ __kind__: "step", step: { key: s.key } })}>{T.makeFromStep}</Button>}
                  {s.status === "open" && s.when.__kind__ === "final" && (
                    <div className="a-row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <Button disabled={busy} onClick={() => onMake({ __kind__: "step", step: { key: s.key } })}>{T.makeFromStep}</Button>
                      {current.length > 0 && (
                        <>
                          <select className="bw-input" aria-label={T.makeFromMm} value={mmPick} onChange={(e) => setMmPick(e.target.value)}>
                            <option value="">{T.makeFromMm}</option>
                            {current.map((v) => <option key={String(v.id)} value={String(v.id)}>{`versie ${v.number} · ${fmtDayNum(v.day)} · ${fmtEuro(v.toInvoiceCents)}`}</option>)}
                          </select>
                          <Button disabled={busy || !mmPick} onClick={() => onMake({ __kind__: "step", step: { key: s.key, minMeerVersionId: BigInt(mmPick) } })}>{T.makeFromStep}</Button>
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoiceList({ rows, onOpen }: { rows: SalesBrief[]; onOpen: (id: bigint) => void }) {
  return (
    <div className="a-card" style={{ marginTop: 8 }} data-testid="sales-list">
      <h3 className="bw-h3">{T.invoices}</h3>
      {rows.length === 0 ? <p className="bw-muted">{T.none}</p> : (
        <div className="a-tablewrap">
          <table className="a-table">
            <thead><tr><th>{T.cols.number}</th><th>{T.cols.kind}</th><th>{T.cols.title}</th><th>{T.cols.issued}</th><th>{T.cols.due}</th><th>{T.cols.status}</th><th>{T.cols.pay}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)} className="a-click" onClick={() => onOpen(r.id)} data-testid={`sales-row-${r.id}`}>
                  <td><a href="#" onClick={(e) => { e.preventDefault(); onOpen(r.id); }}>{r.number || T.draft}</a></td>
                  <td>{r.kindTitle}{r.creditOf ? ` (${r.creditOf})` : ""}</td>
                  <td>{r.title}</td>
                  <td>{r.issueDay !== undefined ? fmtDayNum(r.issueDay) : ""}</td>
                  <td>{r.dueDay !== undefined ? fmtDayNum(r.dueDay) : ""}{r.overdue ? ` · ${T.overdue}` : ""}</td>
                  <td>{T.status[r.status] ?? r.status}{r.sent ? " · verstuurd" : ""}</td>
                  <td>{T.pay[r.pay] ?? r.pay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
