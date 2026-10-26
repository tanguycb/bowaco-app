// Dashboard (stap 1.8, bouwplan §8.2 en §8.4): bovenaan de tellers (werven bezig · vertraagd · bevestigingen open ·
// open problemen · verslagen die ontbreken · vergunningen in 1b), daaronder de werven als kaarten met status,
// werfleider, voortgang, volgende mijlpaal en waarschuwingen (filter op werfleider en status; klik = werfpagina), en de
// lijsten achterstanden · deze week · openstaande bevestigingen. Alles berekend door de backend (dashboard).
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { WorkStatus, type DashTask, type DashWork, type DashboardView } from "../backend";
import { Choice, Icon, StatusBadge, type Status } from "../design";
import { t } from "../texts/nl";
import { fmtDayNum, todayDay, useBackend } from "../util";
import { Loading, Page, WorkPhase } from "./common";

const D = t.dash;
const N = Number;
const TASK: Record<string, Status> = { planned: "planned", busy: "busy", delayed: "delayed", done: "done", blocked: "blocked" };
const LEADER_KEY = "bw-dash-werfleider";
const STATUS_KEY = "bw-dash-status";

function remember(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* enkel gemak */
  }
}
function recall(k: string, d: string): string {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
}

export function useDashboard() {
  const { actor, isFetching } = useBackend();
  const day = todayDay();
  return useQuery({ queryKey: ["dashboard", String(day)], queryFn: () => actor!.dashboard(day), enabled: !!actor && !isFetching, refetchOnWindowFocus: true, refetchInterval: 120_000 });
}

export function DashboardPage({ go }: { go: (to: string) => void }) {
  return (
    <Page title={D.title}>
      <DashboardBody go={go} />
    </Page>
  );
}

export function DashCounters({ v }: { v: DashboardView }) {
  const c = v.counters;
  const cell = (n: bigint | number | undefined, label: string, tone?: "warn" | "accent", hint?: string) => (
    <div className={`a-counter${tone && Number(n ?? 0) > 0 ? ` a-counter--${tone}` : ""}`} title={hint}>
      <span className="a-counter__n">{n === undefined ? "–" : String(n)}</span>
      <span className="a-counter__l">{label}</span>
    </div>
  );
  return (
    <div className="a-counters d-counters">
      {cell(c.running, D.running)}
      {cell(c.delayed, D.delayed, "warn")}
      {cell(c.confirmOpen, D.confirmOpen + (c.confirmDeclined > 0n ? ` · ${D.declined(N(c.confirmDeclined))}` : ""), c.confirmDeclined > 0n ? "warn" : "accent")}
      {cell(c.openIssues, D.issues, "warn")}
      {cell(c.missingReports, D.missing, "warn")}
      {cell(c.permitsThisMonth, D.permits, "warn", c.permitsThisMonth === undefined ? D.permitsLater : undefined)}
    </div>
  );
}

export function DashboardBody({ go, withCounters = true }: { go: (to: string) => void; withCounters?: boolean }) {
  const q = useDashboard();
  const [leader, setLeader] = useState(() => recall(LEADER_KEY, "all"));
  const [status, setStatus] = useState(() => recall(STATUS_KEY, "active"));
  const [text, setText] = useState("");
  const v = q.data;
  if (!v) return <Loading q={q} />;
  const match = (w: DashWork) =>
    (leader === "all" || (leader === "none" ? w.leaderId === undefined : String(w.leaderId) === leader)) &&
    (status === "all" ||
      (status === "active" && (w.status === WorkStatus.running || w.status === WorkStatus.planned)) ||
      (status === "delayed" && w.delayed) ||
      w.status === status) &&
    (!text || `${w.code} ${w.name} ${w.city}`.toLowerCase().includes(text.toLowerCase()));
  const shown = v.works.filter(match);
  const inShown = new Set(shown.map((w) => String(w.id)));
  const late = v.late.filter((x) => inShown.has(String(x.workId)));
  const week = v.thisWeek.filter((x) => inShown.has(String(x.workId)));
  const conf = v.confirmations.filter((x) => inShown.has(String(x.workId)));
  return (
    <div className="a-stack d-dash">
      {withCounters && <DashCounters v={v} />}
      <div className="d-filters">
        <label className="bw-field"><span className="bw-label">{D.leader}</span>
          <select id="dash-leader" className="bw-input" value={leader} onChange={(e) => { setLeader(e.target.value); remember(LEADER_KEY, e.target.value); }}>
            <option value="all">{D.allLeaders}</option>
            {v.leaders.map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
            <option value="none">{D.noLeader}</option>
          </select>
        </label>
        <div className="bw-field"><span className="bw-label">{D.status}</span>
          <Choice label={D.status} value={status} onChange={(s) => { setStatus(s); remember(STATUS_KEY, s); }} options={[
            { value: "active", label: D.active },
            { value: "delayed", label: D.onlyDelayed },
            { value: WorkStatus.running, label: t.workStatus.running },
            { value: WorkStatus.planned, label: t.workStatus.planned },
            { value: WorkStatus.delivered, label: t.workStatus.delivered },
            { value: "all", label: D.all },
          ]} />
        </div>
        <label className="bw-field"><span className="bw-label">{D.search}</span><input id="dash-search" className="bw-input" type="search" value={text} onChange={(e) => setText(e.target.value)} /></label>
      </div>
      <h2 className="bw-h2">{D.works} <span className="bw-muted">({shown.length})</span></h2>
      {shown.length === 0 && <p className="a-empty">{D.noWorks}</p>}
      <div className="d-cards">{shown.map((w) => <WorkCard key={String(w.id)} w={w} go={go} />)}</div>

      <div className="a-cols">
        <section className="a-section">
          <h2 className="bw-h2">{D.late} <span className="bw-muted">({late.length})</span></h2>
          {late.length === 0 ? <p className="a-empty">{D.noLate}</p> : <TaskList items={late} go={go} late />}
        </section>
        <section className="a-section">
          <h2 className="bw-h2">{D.confirmations} <span className="bw-muted">({conf.length})</span></h2>
          {conf.length === 0 ? <p className="a-empty">{D.noConfirm}</p> : (
            <ul className="a-list">
              {conf.slice(0, 40).map((c) => (
                <li key={String(c.assignmentId)}>
                  <button type="button" className="a-list__btn" onClick={() => go(`werven/${c.workId}/planning?taak=${c.taskId}`)}>
                    <span className="a-tag">{c.workCode}</span>
                    <span className="a-list__main">
                      <b>{c.orgName} · {c.taskTitle}</b>
                      <span className="bw-muted bw-num">{fmtDayNum(c.start)}{c.end !== c.start ? ` – ${fmtDayNum(c.end)}` : ""}{c.reason ? ` · ${c.reason}` : ""}</span>
                    </span>
                    <span className={`a-tag ${c.declined ? "a-tag--bad" : ""}`}>{c.declined ? t.plan.conf.declined : t.plan.conf.open}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="a-section">
        <h2 className="bw-h2">{D.thisWeek(fmtDayNum(v.monday), fmtDayNum(v.monday + 4n))} <span className="bw-muted">({week.length})</span></h2>
        {week.length === 0 ? <p className="a-empty">{D.noWeek}</p> : <TaskList items={week} go={go} />}
      </section>
      <p className="bw-muted bw-num">{D.computed(N(v.instructions) / 1e6)}</p>
    </div>
  );
}

function WorkCard({ w, go }: { w: DashWork; go: (to: string) => void }) {
  const pct = N(w.percent);
  return (
    <button type="button" className={`d-card${w.delayed ? " d-card--late" : ""}`} onClick={() => go(`werven/${w.id}`)}>
      <span className="d-card__head">
        <span className="a-tag">{w.code}</span>
        <WorkPhase w={w} />
        {w.delayed && <StatusBadge status="delayed" small />}
      </span>
      <b className="d-card__name">{w.name}</b>
      <span className="bw-muted">{w.city}{w.leaderName ? ` · ${w.leaderName}` : ""}</span>
      <span className="d-bar" aria-label={`${pct} %`}><span style={{ width: `${pct}%` }} /></span>
      <span className="bw-muted bw-num">{pct} % · {w.start !== undefined ? fmtDayNum(w.start) : "–"} → {w.end !== undefined ? fmtDayNum(w.end) : "–"}</span>
      {w.nextMilestone && <span className="bw-num"><Icon name="calendar" size={14} /> {w.nextMilestone[0]} · {fmtDayNum(w.nextMilestone[1])}</span>}
      <span className="d-card__stats bw-num">
        <span>{D.cardWeek(N(w.tasksThisWeek))}</span>
        {w.confirmOpen > 0n && <span>{D.cardConfirm(N(w.confirmOpen))}</span>}
        {w.openIssues > 0n && <span className="d-warn">{t.vandaag.openIssues(N(w.openIssues))}</span>}
        {w.lastReport !== undefined && <span>{D.lastReport(fmtDayNum(w.lastReport))}</span>}
      </span>
      {w.warnings.length > 0 && <span className="d-card__warn"><Icon name="alert" size={14} /> {w.warnings.join(" · ")}</span>}
    </button>
  );
}

function TaskList({ items, go, late }: { items: DashTask[]; go: (to: string) => void; late?: boolean }) {
  const [more, setMore] = useState(false);
  const list = more ? items : items.slice(0, 15);
  return (
    <>
      <ul className="a-list">
        {list.map((x) => (
          <li key={String(x.taskId)}>
            <button type="button" className="a-list__btn" onClick={() => go(`werven/${x.workId}/planning?taak=${x.taskId}`)}>
              <span className="a-tag">{x.workCode}</span>
              <span className="a-list__main">
                <b>{x.title}</b>
                <span className="bw-muted bw-num">{x.orgNames.join(" · ") || "—"} · {fmtDayNum(x.start)}{x.end !== x.start ? ` – ${fmtDayNum(x.end)}` : ""}{x.percent > 0n ? ` · ${x.percent} %` : ""}</span>
              </span>
              {late && x.lateDays > 0n && <span className="a-tag a-tag--warn">{D.lateDays(N(x.lateDays))}</span>}
              <StatusBadge status={TASK[x.status] ?? "planned"} small />
            </button>
          </li>
        ))}
      </ul>
      {items.length > 15 && !more && <button type="button" className="wb-link" onClick={() => setMore(true)}>{t.common.more} ({items.length - 15})</button>}
    </>
  );
}
