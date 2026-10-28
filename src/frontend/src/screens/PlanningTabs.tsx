// 2b.4 (WC-03, V4 van 2b.2): Planning = één menu-item met drie tabbladen: Weekbord · Afwezigheden · Conflicten & regels.
// Het weekbord is ongewijzigd; Afwezigheden toont wie wanneer niet beschikbaar is (alle firma's of één firma, met toevoegen en
// wijzigen); Conflicten & regels bundelt wat vroeger in het Dashboard stond (conflicten, open bevestigingen van onderaannemers,
// achterstand) met de regels voor dubbele boeking. Niets is nieuw aan rechten: elke bron was al leesbaar voor deze rollen.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Caps } from "../backend";
import { Button } from "../design";
import { planningTabs } from "../app/nav";
import { t } from "../texts/nl";
import { fmtDayNum, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { TaskList, useDashboard } from "./Dashboard";
import { fmtShort, today, weekday } from "./planUtil";
import { TabBar } from "./Tabs";
import { AbsencePanel, ConflictList, RulesSheet, Weekbord } from "./Weekbord";

const P = t.planningTabs;
const N = Number;
const monday = () => today() - weekday(today());

export function PlanningHub({ caps, go, sub }: { caps: Caps; go: (to: string) => void; sub?: string }) {
  const tabs = planningTabs(caps);
  const cur = sub === "afwezigheden" || sub === "conflicten" ? sub : "weekbord";
  const key = cur === "weekbord" ? "weekbord" : `weekbord/${cur}`;
  return (
    <>
      <TabBar tabs={tabs} current={key} go={go} label={t.menu.tabs} />
      {cur === "weekbord" && <Weekbord key={window.location.hash} caps={caps} go={go} />}
      {cur === "afwezigheden" && <Afwezigheden caps={caps} />}
      {cur === "conflicten" && <Conflicten caps={caps} go={go} />}
    </>
  );
}

function Afwezigheden({ caps }: { caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const from = monday();
  const [org, setOrg] = useState<string>("");
  const oas = useQuery({ queryKey: ["oas-all"], queryFn: () => actor!.listOas({ includeArchived: false }), enabled: on });
  const all = useQuery({ queryKey: ["absences", "all", from], queryFn: () => actor!.listAbsences(null, BigInt(from - 28), BigInt(from + 7 * 26)), enabled: on, refetchOnWindowFocus: true });
  const one = org ? oas.data?.find((o) => String(o.org.id) === org) : undefined;
  const oa = useQuery({ queryKey: ["oa", org], queryFn: async () => unwrap(await actor!.getOa(BigInt(org))), enabled: on && !!org });
  const persons = (oa.data?.persons ?? []).filter((p) => p.archivedAt === undefined).map((p) => ({ id: p.id, name: p.name }));
  const canEdit = caps.manageAbsences;
  return (
    <Page label={t.board.title} title={P.afwezigheden}>
      <p className="bw-muted">{P.absLead}</p>
      <label className="bw-field"><span className="bw-label">{t.common.firm}</span>
        <select className="bw-input" value={org} onChange={(e) => setOrg(e.target.value)} style={{ maxWidth: 340 }} aria-label={t.common.firm}>
          <option value="">{t.common.allFirms}</option>
          {(oas.data ?? []).map((o) => <option key={String(o.org.id)} value={String(o.org.id)}>{o.org.aliases[0] ? `${o.org.aliases[0]} · ` : ""}{o.org.name}</option>)}
        </select>
      </label>
      {org && one && <AbsencePanel key={org} orgId={one.org.id} from={from} canEdit={canEdit} persons={persons} />}
      {!org && (
        <>
          <Loading q={all} />
          {all.data && all.data.length === 0 && <p className="a-empty">{P.absNone}</p>}
          {all.data && all.data.length > 0 && (
            <ul className="a-list">
              {all.data.map((a) => (
                <li key={String(a.id)}>
                  <button type="button" className="a-list__btn" onClick={() => setOrg(String(a.orgId))}>
                    <span className="a-list__main">
                      <b>{a.orgName} · {t.absence.kinds[a.kind]}{a.personName ? ` · ${a.personName}` : ` · ${t.absence.wholeFirm}`}</b>
                      <span className="bw-num">{fmtShort(a.from)} – {fmtShort(a.to)}</span>
                      {a.note && <span className="bw-muted">{a.note}</span>}
                    </span>
                    <span className="a-tag">{P.absOpen}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Page>
  );
}

function Conflicten({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const from = monday();
  const [rules, setRules] = useState(false);
  const conflicts = useQuery({ queryKey: ["boardConflicts", from, 12], queryFn: () => actor!.boardConflicts(BigInt(from), 12n, 50n), enabled: on, refetchOnWindowFocus: true });
  const rulesQ = useQuery({ queryKey: ["boardRules"], queryFn: () => actor!.boardRules(), enabled: on });
  const dash = useDashboard();
  const conf = dash.data?.confirmations ?? [];
  const late = dash.data?.late ?? [];
  return (
    <Page label={t.board.title} title={P.conflicten} actions={<Button icon="settings" onClick={() => setRules(true)}>{caps.manageBoardRules ? P.rulesEdit : P.rulesBtn}</Button>}>
      <section className="a-section">
        <h2 className="bw-h2">{P.confTitle} {conflicts.data && <span className="bw-muted">({N(conflicts.data.total)})</span>}</h2>
        <Loading q={conflicts} />
        {conflicts.data && conflicts.data.items.length === 0 && <p className="a-empty">{P.confNone}</p>}
        {conflicts.data && conflicts.data.items.length > 0 && <ConflictList items={conflicts.data.items} go={go} />}
      </section>
      <section className="a-section">
        <h2 className="bw-h2">{P.rulesTitle}</h2>
        {rulesQ.data && <p className="bw-muted" data-testid="regels-samenvatting">{P.rulesSummary(rulesQ.data.unit, N(rulesQ.data.defaultMax), rulesQ.data.rules.length)}</p>}
      </section>
      <div className="a-cols">
        <section className="a-section">
          <h2 className="bw-h2">{P.lateTitle} <span className="bw-muted">({late.length})</span></h2>
          {dash.data && late.length === 0 ? <p className="a-empty">{P.lateNone}</p> : <TaskList items={late} go={go} late />}
        </section>
        <section className="a-section">
          <h2 className="bw-h2">{P.confirmTitle} <span className="bw-muted">({conf.length})</span></h2>
          {dash.data && conf.length === 0 && <p className="a-empty">{P.confirmNone}</p>}
          {conf.length > 0 && (
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
      {rules && <RulesSheet caps={caps} onClose={() => setRules(false)} />}
    </Page>
  );
}
