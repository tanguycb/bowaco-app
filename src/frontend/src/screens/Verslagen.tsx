// Werfverslagen lezen (stap 1.6, R8): de tijdlijn op de werfpagina, één verslag in detail, de open problemen en
// vertragingen ("Vraagt aandacht") en de wachtrij van de gsm. Wat iemand ziet, beslist de backend (reportScope).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Caps, IssueView, ReportSummary, ReportView } from "../backend";
import { Button, Icon, Sheet, useToast } from "../design";
import { blobUrlOf } from "../offline/cached";
import { useOutbox } from "../offline/outbox";
import { t } from "../texts/nl";
import { errText, fmtDayNum, fmtTime, todayDay, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { fmtDur, fmtMin } from "./Werfverslag";

const R = t.reports;
const V = t.verslag;

function statusWord(s: ReportView["status"]): string {
  return V.status[s.__kind__] ?? s.__kind__;
}

/** Werfpagina: de verslagen van deze werf, nieuwste eerst. */
export function ReportsSection({ workId, caps, go }: { workId: bigint; caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["reports", String(workId)], queryFn: () => actor!.listReports(workId, 0n, 30n), enabled: !!actor && !isFetching, retry: 0 });
  const [open, setOpen] = useState<bigint | null>(null);
  if (q.error && !caps.writeReports) return null; // geen leesrecht (bv. OA): de sectie valt weg
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{R.title}</h2>
        {caps.writeReports && <Button icon="edit" onClick={() => go(`verslag/${workId}/${todayDay()}`)}>{R.write}</Button>}
      </div>
      <IssueList workId={workId} />
      <Loading q={q} />
      {q.data && q.data.length === 0 && <p className="a-empty">{R.none}</p>}
      {q.data && q.data.length > 0 && (
        <ul className="a-list">
          {q.data.map((r) => <SummaryRow key={String(r.id)} r={r} onOpen={() => setOpen(r.id)} />)}
        </ul>
      )}
      {open !== null && <ReportSheet id={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function SummaryRow({ r, onOpen }: { r: ReportSummary; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="a-list__btn" onClick={onOpen}>
        <span className="a-tag">{fmtDayNum(r.day)}</span>
        <span className="a-list__main">
          <b>{r.workDone.length ? r.workDone.join(" · ") : r.authorName || "—"}</b>
          <span className="bw-muted bw-num">
            {r.authorName && `${R.by} ${r.authorName} · `}{R.people(Number(r.headcount))}{r.totalMinutes > 0n ? ` · ${fmtDur(r.totalMinutes)}` : ""}{r.regieMinutes > 0n ? ` (${R.regie} ${fmtDur(r.regieMinutes)})` : ""} · {R.photos(Number(r.photos))}
            {r.corrects !== undefined ? ` · ${V.correction(String(r.corrects))}` : ""}
          </span>
        </span>
        {r.openIssues > 0n && <span className="a-tag a-tag--warn">{t.vandaag.openIssues(Number(r.openIssues))}</span>}
        <span className={`a-tag${r.status.__kind__ === "draft" ? " a-tag--accent" : ""}`}>{statusWord(r.status)}</span>
        <Icon name="next" size={18} />
      </button>
    </li>
  );
}

/** Eén verslag, zoals de beller het mag zien. */
export function ReportSheet({ id, onClose }: { id: bigint; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["report", String(id)], queryFn: () => actor!.getReport(id), enabled: !!actor && !isFetching });
  const r = q.data;
  return (
    <Sheet title={r ? `${R.title.slice(0, -2)} ${r.workCode} · ${fmtDayNum(r.day)}` : R.openReport} open onClose={onClose} side wide>
      <Loading q={q} />
      {r && <ReportBody r={r} />}
    </Sheet>
  );
}

export function ReportBody({ r }: { r: ReportView }) {
  return (
    <div className="a-stack">
      <div className="a-row">
        <span className={`a-tag${r.status.__kind__ === "draft" ? " a-tag--accent" : ""}`}>{statusWord(r.status)}</span>
        {r.authorName && <span className="bw-muted">{R.by} {r.authorName}</span>}
        {r.weather && <span className="a-tag">{r.weather}</span>}
        {r.corrects !== undefined && <span className="a-tag">{V.correction(String(r.corrects))}</span>}
      </div>
      {r.summary && <p>{r.summary}</p>}
      {r.attendances.length > 0 && (
        <>
          <h3 className="bw-h3">{R.hours} · {fmtDur(r.totalMinutes)}{r.regieMinutes > 0n ? ` (${R.regie} ${fmtDur(r.regieMinutes)})` : ""}</h3>
          <ul className="a-list">
            {r.attendances.map((a) => (
              <li key={String(a.id)}>
                <span className="a-tag">{a.orgCode}</span>
                <span className="a-list__main">
                  <span>{a.names || a.orgName}{a.headcount > 1n ? ` · ${a.headcount} personen` : ""}</span>
                  <span className="m-slots">{a.slots.map((s) => `${fmtMin(s.fromMin)}–${fmtMin(s.toMin)}`).join(" · ")} = {fmtDur(a.minutesTotal)}</span>
                  {a.confirmations.map((c) => <span key={String(c.id)} className={`a-tag ${c.ok ? "a-tag--ok" : "a-tag--bad"}`}>{c.ok ? t.hours.confirmed : t.hours.disputed} · {c.byName}{c.remark ? `: ${c.remark}` : ""}</span>)}
                </span>
                {a.regie && <span className="m-tag m-tag--regie">regie</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.workDone.length > 0 && (
        <>
          <h3 className="bw-h3">{R.work}</h3>
          <ul className="a-list">
            {r.workDone.map((w) => (
              <li key={String(w.id)}><span className="a-list__main"><span>{w.taskTitle ? `${w.taskTitle}${w.percent !== undefined ? ` · ${w.percent === 100n ? V.ready : `${w.percent} %`}` : ""}` : w.text}</span>{w.taskTitle && w.text && <span className="bw-muted">{w.text}</span>}</span></li>
            ))}
          </ul>
        </>
      )}
      {r.photos.length > 0 && (
        <div className="m-gallery">
          {r.photos.map((p) => (
            <a key={String(p.id)} href={blobUrlOf(p.file.blob)} target="_blank" rel="noreferrer" title={p.caption}>
              <img src={blobUrlOf(p.thumb?.blob) ?? blobUrlOf(p.file.blob)} alt={p.caption} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {r.materials.length > 0 && (
        <>
          <h3 className="bw-h3">{V.materials}</h3>
          <ul className="a-list">
            {r.materials.map((m) => (
              <li key={String(m.id)}>
                <span className="a-tag">{V.matKinds[m.kind] ?? m.kind}</span>
                <span className="a-list__main"><span>{[m.quantity, m.text].filter(Boolean).join(" ") || "—"}{m.supplier ? ` · ${m.supplier}` : ""}</span>
                  {m.file ? <a className="wb-link" href={blobUrlOf(m.file.blob)} target="_blank" rel="noreferrer">{V.receiptPhoto} ↗</a> : m.hasFile && <span className="bw-muted">{R.noReceipt}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {r.issues.length > 0 && (
        <>
          <h3 className="bw-h3">{V.issues}</h3>
          <ul className="a-list">{r.issues.map((i) => <IssueRow key={String(i.id)} i={i} />)}</ul>
        </>
      )}
      {r.trips.length > 0 && (
        <>
          <h3 className="bw-h3">{R.trips}</h3>
          <ul className="a-list">
            {r.trips.map((x) => <li key={String(x.id)}><span className="a-tag">{x.plate}</span><span className="a-list__main"><span>{V.driverOut}: {x.driverOutName || "–"}{x.outTime ? ` (${x.outTime})` : ""} · {V.driverBack}: {x.driverBackName || "–"}{x.backTime ? ` (${x.backTime})` : ""}</span>{x.vehicleName && <span className="bw-muted">{x.vehicleName}</span>}</span></li>)}
          </ul>
        </>
      )}
      {r.changes.length > 0 && (
        <>
          <h3 className="bw-h3">{R.changes}</h3>
          <ul className="a-list">{r.changes.map((c, i) => <li key={i}><span className="a-list__main"><span className="bw-muted">{fmtTime(c.at)} · {c.byName} · {c.field === "summary" ? "samenvatting" : c.field === "weather" ? "weer" : c.field}</span><span>{c.from || "—"} → {c.to || "—"}</span></span></li>)}</ul>
        </>
      )}
    </div>
  );
}

function IssueRow({ i, showWork, onHandle }: { i: IssueView; showWork?: boolean; onHandle?: (i: IssueView) => void }) {
  const handled = i.status.__kind__ === "handled";
  return (
    <li>
      <span className={`a-tag${i.kind === "delay" ? " a-tag--warn" : i.kind === "safety" ? " a-tag--bad" : ""}`}>{V.issueKinds[i.kind] ?? i.kind}{i.delayDays !== undefined ? ` +${i.delayDays} wd` : ""}</span>
      <span className="a-list__main">
        <span>{showWork && <b>{i.workCode} · </b>}{i.text}</span>
        <span className="bw-muted">{fmtDayNum(i.day)} · {i.createdByName}{i.taskTitles.length ? ` · ${V.shifts}: ${i.taskTitles.join(", ")}` : ""}{handled && i.status.__kind__ === "handled" ? ` · ${t.issues.handled} (${i.handledByName}${i.status.handled.note ? `: ${i.status.handled.note}` : ""})` : ""}</span>
      </span>
      {!handled && onHandle && <Button variant="quiet" onClick={() => onHandle(i)}>{t.issues.handle}</Button>}
    </li>
  );
}

/** Open problemen van één werf (werfpagina) met afhandelen. */
function IssueList({ workId }: { workId: bigint }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["issues", String(workId)], queryFn: () => actor!.listIssues(workId, true, 50n), enabled: !!actor && !isFetching, retry: 0 });
  const [handle, setHandle] = useState<IssueView | null>(null);
  if (!q.data || q.data.length === 0) return null;
  return (
    <>
      <ul className="a-list">{q.data.map((i) => <IssueRow key={String(i.id)} i={i} onHandle={setHandle} />)}</ul>
      {handle && <HandleSheet i={handle} onClose={() => setHandle(null)} />}
    </>
  );
}

/** "Vraagt aandacht": open vertragingen en problemen over alle werven. */
export function IssueAttention({ go, limit = 8 }: { go: (to: string) => void; limit?: number }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["issues", "open"], queryFn: () => actor!.listIssues(null, true, 50n), enabled: !!actor && !isFetching, retry: 0, refetchOnWindowFocus: true });
  const [handle, setHandle] = useState<IssueView | null>(null);
  if (!q.data || q.data.length === 0) return null;
  return (
    <>
      <div className="a-alert"><Icon name="alert" size={20} /><span><b>{t.vandaag.openIssues(q.data.length)}</b></span></div>
      <ul className="a-list">
        {q.data.slice(0, limit).map((i) => (
          <IssueRow key={String(i.id)} i={i} showWork onHandle={setHandle} />
        ))}
      </ul>
      {q.data.length > limit && <Button variant="quiet" onClick={() => go("werven")}>{t.common.more}</Button>}
      {handle && <HandleSheet i={handle} onClose={() => setHandle(null)} onPlan={() => go(`werven/${handle.workId}/planning`)} />}
    </>
  );
}

function HandleSheet({ i, onClose, onPlan }: { i: IssueView; onClose: () => void; onPlan?: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: async () => unwrap(await actor!.handleIssue(i.id, note)),
    onSuccess: () => {
      toast.show({ kind: "ok", text: t.common.saved });
      void qc.invalidateQueries({ queryKey: ["issues"] });
      onClose();
    },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={t.issues.handleTitle} open onClose={onClose}
      footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" icon="check" busy={m.isPending} onClick={() => m.mutate()}>{t.issues.handle}</Button></>}>
      <p><b>{i.workCode}</b> · {V.issueKinds[i.kind]}{i.delayDays !== undefined ? ` +${i.delayDays} wd` : ""}: {i.text}</p>
      {i.taskTitles.length > 0 && <p className="bw-muted">{V.shifts}: {i.taskTitles.join(", ")}</p>}
      {i.kind === "delay" && onPlan && <Button icon="calendar" onClick={onPlan}>{t.issues.planLink}</Button>}
      <label className="bw-field"><span className="bw-label">{t.issues.note}</span><textarea id="issue-note" className="bw-input" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
    </Sheet>
  );
}

/** De wachtrij op deze gsm: wat nog wacht of mislukte, met Opnieuw en Weghalen. */
export function OutboxSheet({ onClose }: { onClose: () => void }) {
  const ob = useOutbox();
  return (
    <Sheet title={t.outbox.title} open onClose={onClose}
      footer={<Button variant="primary" icon="sync" busy={ob.syncing} disabled={ob.ops.length === 0} onClick={() => void ob.sync()}>{t.outbox.send}</Button>}>
      <p className="bw-muted">{t.outbox.lead}</p>
      {ob.ops.length === 0 && <p className="a-empty">{t.outbox.empty}</p>}
      <div className="m-outbox">
        {ob.ops.map((o) => (
          <div key={o.opId} className={`m-outbox__item${o.state === "failed" ? " m-outbox__item--failed" : ""}`}>
            <div className="m-line__head">
              <b>{o.label}</b>
              <span className={`m-tag${o.state === "failed" ? " m-tag--warn" : ""}`}>{o.state === "failed" ? t.outbox.failed : t.verslag.pendingTag}</span>
            </div>
            <span className="bw-muted bw-num">{fmtTime(BigInt(o.createdAt) * 1_000_000n)}{o.tries > 0 ? ` · ${t.outbox.tries(o.tries)}` : ""}</span>
            {o.error && <span className="a-err">{o.error}</span>}
            {o.state === "failed" && (
              <div className="a-row">
                <Button onClick={() => void ob.retry(o.opId)}>{t.outbox.retry}</Button>
                <Button variant="quiet" onClick={() => void ob.discard(o.opId)}>{t.outbox.discard}</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
