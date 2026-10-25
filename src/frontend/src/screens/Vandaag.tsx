// "Vandaag" van de werfleider op de gsm (bouwplan §8.2, §8.3; prototype "Mijn dag"): de werven van vandaag als
// kaarten (wie komt er volgens de planning, taken, afspraken, stand van het verslag, open problemen) met onderaan
// één grote knop Werfverslag. Zonder bereik: de laatst bewaarde stand met haar tijdstip (architectuur §8.1).
import { useState } from "react";
import type { Caps, DayWork, MyDayView } from "../backend";
import { Button, Card, Choice, Icon } from "../design";
import { useCached } from "../offline/cached";
import { useOutbox } from "../offline/outbox";
import { t } from "../texts/nl";
import { fmtDayNum, todayDay, useBackend } from "../util";
import { Loading, Page, WorkBadge } from "./common";
import { IssueAttention } from "./Verslagen";
import { BoardAttention } from "./Weekbord";
import { PermitsOnSite } from "./Vergunningen";
import { PendingStarts } from "./WerfStart";

const V = t.vandaag;
const ALL_KEY = "bw-vandaag-alle";

export function Vandaag({ go, caps }: { go: (to: string) => void; caps: Caps }) {
  const { actor } = useBackend();
  const day = todayDay();
  const [all, setAll] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ALL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const q = useCached<MyDayView>(["myDay", String(day), all ? "all" : "mine"], () => actor!.myDay(day, all));
  const pick = (v: string) => {
    setAll(v === "all");
    try {
      localStorage.setItem(ALL_KEY, v === "all" ? "1" : "0");
    } catch {
      /* enkel gemak */
    }
  };
  const works = q.data?.value.works ?? [];
  return (
    <Page title={t.home.vandaag}>
      <Choice label={V.all} value={all ? "all" : "mine"} onChange={pick} options={[{ value: "mine", label: V.mine }, { value: "all", label: V.all }]} />
      {q.data?.fromCache && <p className="a-note"><Icon name="offline" size={16} /> {t.verslag.staleAt(new Date(q.data.at).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }))}</p>}
      {!q.data && <Loading q={q} />}
      {q.error && !q.data && <p className="a-err">{t.verslag.noCache}</p>}
      {q.data && works.length === 0 && <p className="a-empty">{V.noWorks}</p>}
      <PendingStarts caps={caps} go={go} compact />
      <div className="v-cards">
        {works.map((w) => <WorkCard key={String(w.id)} w={w} day={day} go={go} />)}
      </div>
      {caps.permits && <PermitsOnSite />}
      {caps.readOrgPlanning && (
        <section className="a-section">
          <h2 className="bw-h2">{t.overzicht.attention}</h2>
          <IssueAttention go={go} />
          <BoardAttention go={go} />
        </section>
      )}
    </Page>
  );
}

function WorkCard({ w, day, go }: { w: DayWork; day: bigint; go: (to: string) => void }) {
  const ob = useOutbox();
  const waiting = ob.ops.some((o) => o.workId === w.id && o.day === day);
  const final = w.reports.some((r) => r.status.__kind__ !== "draft") && !w.reports.some((r) => r.status.__kind__ === "draft");
  const open = w.reports.some((r) => r.status.__kind__ === "draft");
  const addr = [w.address.street, w.address.number].filter(Boolean).join(" ") + (w.address.city ? `, ${w.address.city}` : "");
  const todo = w.tasks.filter((x) => x.status !== "done").length;
  return (
    <Card
      raised
      title={<button type="button" className="m-titlelink" onClick={() => go(`werven/${w.id}`)}>{w.code} · {w.name} <Icon name="next" size={18} /></button>}
      meta={addr}
      aside={<WorkBadge status={w.status} />}
    >
      <div className="m-workcard">
        <ul className="m-facts">
          <li><Icon name="people" size={20} /><span>{w.planned.length ? w.planned.map((p) => p.code).join(" · ") : V.nobody}{w.leaderName ? <span className="bw-muted"> · {V.leader} {w.leaderName}</span> : null}</span></li>
          <li><Icon name="list" size={20} /><span>{V.tasksToday(todo)}{w.tasks.length > todo ? ` · ${w.tasks.length - todo} klaar` : ""}</span></li>
          {w.appointments.map(([time, text], i) => <li key={i}><Icon name="clock" size={20} /><span><b>{V.appointment}</b> {time && <span className="bw-mono">{time}</span>} {text}</span></li>)}
          {w.openIssues > 0n && <li className="m-facts--warn"><Icon name="alert" size={20} /><span>{V.openIssues(Number(w.openIssues))}</span></li>}
          {(waiting || open || final) && (
            <li className={final && !waiting ? "m-facts--ok" : ""}><Icon name={waiting ? "clock" : final ? "check" : "edit"} size={20} /><span>{waiting ? V.reportWait : final ? V.reportDone : V.reportOpen}</span></li>
          )}
        </ul>
        <Button variant={open || final || waiting ? "secondary" : "primary"} size="lg" block icon="edit" onClick={() => go(`verslag/${w.id}/${day}`)}>
          {open || final || waiting ? t.verslag.more : t.verslag.open}
        </Button>
        <span className="bw-muted bw-num">{fmtDayNum(day)}</span>
      </div>
    </Card>
  );
}
