// Startscherm van de beheerder (stap 2b.4, bouwplan §8.2 en §8.4, prototype §1.6): Aan de slag (zolang niet alles klaar is) ·
// Vraagt aandacht, per soort gegroepeerd met hoogstens vijf regels · Vandaag op de werven · Werven per fase (een klik opent
// Werven op het juiste tabblad) · Deze week. De tellers van het vroegere Dashboard staan nu in Werven → Lopend en in Deze week;
// de toegangscijfers en de foute codepogingen in Beheer → Toegang & codes; gewone meldingen gebundeld in de bel.
import { useState } from "react";
import type { Caps, MyDayView } from "../backend";
import { Button, Icon } from "../design";
import { PHASE_KEYS, werfFase, werfGroep } from "../app/fase";
import { overzichtBlocks } from "../app/start";
import { useCached } from "../offline/cached";
import { t } from "../texts/nl";
import { todayDay, useBackend } from "../util";
import { AttentionBlock } from "./Aandacht";
import { EmptyState, factsOf, Loading, Page, useStages, useWorks } from "./common";
import { TaskList, useDashboard } from "./Dashboard";
import { AanDeSlag } from "./Start";
import { NewRequest } from "./Werven";

const A = t.aandacht;

export function Overzicht({ go, caps }: { go: (to: string) => void; caps: Caps }) {
  const [request, setRequest] = useState(false);
  const blocks = overzichtBlocks(caps, true);
  const empty = useEmptyApp(caps);
  return (
    <Page title={t.overzicht.title} actions={caps.createWork && <Button variant="primary" icon="plus" onClick={() => setRequest(true)}>{t.wervenFase.newRequest}</Button>}>
      {blocks.includes("start") && <AanDeSlag caps={caps} go={go} />}
      {blocks.includes("aandacht") && <AttentionBlock caps={caps} go={go} hideEmpty={empty} />}
      {empty ? (
        <EmptyState title={t.leeg.overzicht.t} text={t.leeg.overzicht.d} action={caps.createWork && <Button variant="primary" icon="plus" onClick={() => setRequest(true)}>{t.leeg.request}</Button>} />
      ) : (
        <div className="a-cols">
          <div className="a-stack">
            {blocks.includes("vandaag") && <VandaagBlok go={go} />}
          </div>
          <div className="a-stack">
            {blocks.includes("fase") && <PerFase go={go} />}
            {blocks.includes("week") && <DezeWeek go={go} caps={caps} />}
          </div>
        </div>
      )}
      <p className="bw-muted a-note-small">{A.beheerCijfers}</p>
      {request && <NewRequest caps={caps} onClose={() => setRequest(false)} go={go} />}
    </Page>
  );
}

/** Een lege app: nog geen werven. Dan toont het Overzicht uitleg in plaats van lege blokken. */
function useEmptyApp(caps: Caps): boolean {
  const works = useWorks();
  return caps.readTeam && !!works.data && works.data.filter((w) => w.archivedAt === undefined).length === 0;
}

/** 2b.2 (vraag 13): de beheerder heeft geen menu-item Vandaag; de werven met werk vandaag staan hier, met de knop Werfverslag. */
function VandaagBlok({ go }: { go: (to: string) => void }) {
  const { actor } = useBackend();
  const day = todayDay();
  const q = useCached<MyDayView>(["myDay", String(day), "all"], () => actor!.myDay(day, true));
  const works = q.data?.value.works ?? [];
  return (
    <section className="a-section" data-testid="vandaag-blok">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.menu.vandaagTitel}</h2>
        <Button variant="quiet" onClick={() => go("vandaag")}>{t.menu.vandaagAlles}</Button>
      </div>
      {!q.data && <Loading q={q} />}
      {q.data && works.length === 0 && <p className="a-empty">{t.menu.vandaagGeen}</p>}
      {works.length > 0 && (
        <ul className="a-list">
          {works.slice(0, 5).map((w) => (
            <li key={String(w.id)}>
              <span className="a-list__main">
                <b>{w.code} · {w.name}</b>
                <span className="bw-muted">{w.planned.length ? w.planned.map((p) => p.code).join(" · ") : t.vandaag.nobody}</span>
              </span>
              <span className="a-row">
                <Button variant="quiet" onClick={() => go(`werven/${w.id}`)}>{t.nav.werven}</Button>
                <Button icon="edit" onClick={() => go(`verslag/${w.id}/${day}`)}>{t.verslag.open}</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Werven per fase: acht regels met het aantal; een klik opent Werven op het juiste tabblad (aanvragen · lopend · afgerond). */
function PerFase({ go }: { go: (to: string) => void }) {
  const works = useWorks();
  const stages = useStages();
  const live = (works.data ?? []).filter((w) => w.archivedAt === undefined);
  const fases = live.map((w) => werfFase(factsOf(w, stages.data)));
  const counts = PHASE_KEYS.map((_, i) => fases.filter((f) => !f.cancelled && f.index === i).length);
  return (
    <section className="a-section" data-testid="werven-per-fase">
      <h2 className="bw-h2">{A.byPhase}</h2>
      {works.data && live.length === 0 && <p className="a-empty">{A.byPhaseNone}</p>}
      {live.length > 0 && (
        <ul className="a-list">
          {PHASE_KEYS.map((k, i) => {
            const tab = werfGroep({ index: i, key: k, cancelled: false, aftercare: false, manual: false, steps: [], at: [] });
            return (
              <li key={k}>
                <button type="button" className="a-list__btn" data-fase={k} onClick={() => go(`werven/${tab}`)}>
                  <span className="a-list__main"><b>{t.fase.names[i]}</b></span>
                  <span className="bw-mono">{counts[i]}</span>
                  <Icon name="next" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Deze week: de taken van de week, de bevestigingen van onderaannemers en de vergunningen die aandacht vragen (de tellers van het Dashboard). */
function DezeWeek({ go, caps }: { go: (to: string) => void; caps: Caps }) {
  const dash = useDashboard();
  const v = dash.data;
  const c = v?.counters;
  return (
    <section className="a-section" data-testid="deze-week">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{A.week}</h2>
        {caps.readOrgPlanning && <Button variant="quiet" onClick={() => go("weekbord")}>{A.toPlanning}</Button>}
      </div>
      <Loading q={dash} />
      {v && c && (
        <>
          <ul className="a-bullets bw-muted">
            <li>{A.weekTasks(v.thisWeek.length)}</li>
            <li>{A.weekConfirm(Number(c.confirmOpen), Number(c.confirmDeclined))}</li>
            {c.permitsThisMonth !== undefined && Number(c.permitsThisMonth) > 0 && <li>{A.weekPermits(Number(c.permitsThisMonth))}</li>}
          </ul>
          {v.thisWeek.length > 0 && <TaskList items={v.thisWeek} go={go} />}
        </>
      )}
    </section>
  );
}

