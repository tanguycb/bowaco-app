// Werfpagina (stap 1.1; 2b.3: de werf als centrum). Bovenaan de stappenbalk (acht fases, afgeleid uit wat er gebeurde,
// app/fase.ts) en één kaart "Volgende stap"; daaronder de tabbladen Overzicht · Offerte · Planning · Verslagen · Opmeting ·
// Facturatie · Vergunningen & admin · Documenten · Wie werkt mee (desktop) of een knoppenlijst (gsm, regel 4). Het tabblad
// staat in de URL (#/werven/12/planning). Elk blok van de vroegere werfpagina heeft een tabblad (BOWACO_verslag_2b.3.md §2).
// Wat iemand mag, zegt de backend per werf (WorkView.caps, Rights.mo); elke handeling wordt opnieuw nagekeken.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { GuaranteeKind, OrgKind, QuoteStatus, Role, WorkStatus, type Caps, type ContractInput, type ContractView, type InvoicingRhythm, type WorkView } from "../backend";
import { Button, Info, Choice, Icon, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtBp, fmtDayNum, fmtEuro, fmtTime, inputToDay, optText, parseEuro, parsePct, todayDay, unwrap, useBackend } from "../util";
import { factsOf, Loading, Page, PhaseLabel, StepBar, useStages, useWorks } from "./common";
import { isClient } from "../app/nav";
import { faseNaam, toontFase, volgendeStap, werfFase, werfTabs, type Fase, type Stap, type StageFacts, type TabKey, type WerfTab } from "../app/fase";
import { WorkConflicts } from "./Weekbord";
import { WorkQuotes } from "./Offertes";
import { Dossier } from "./Dossier";
import { PlanningPage, PlanSummary, useMedia } from "./Planning";
import { Field, Files, NewWork } from "./Werven";
import { IssueList, ReportsSection, SummaryRow, ReportSheet } from "./Verslagen";
import { WieWerktMee } from "./Toegang";
import { WorkPermits } from "./Vergunningen";
import { WorkAdmin } from "./Werfadministratie";
import { PendingStarts } from "./WerfStart";
import { OpmetingWerf } from "./Opmeting";
import { MyStatements, WorkStatements } from "./Vorderingen";
import { WorkOaInvoices } from "./OaFacturen";
import { MyQuotes } from "./MijnOfferte";

const F = t.fase;

export function WerfDetail({ id, caps, go, tab }: { id: bigint; caps: Caps; go: (to: string) => void; tab?: string }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const work = useQuery({ queryKey: ["work", String(id)], queryFn: () => actor!.getWork(id), enabled: on });
  const stages = useStages();
  const pending = useQuery({ queryKey: ["pendingWorkStarts", String(id)], queryFn: () => actor!.pendingWorkStarts(id), enabled: on && caps.workStarts, refetchOnWindowFocus: true });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on && caps.readTeam });
  const works = useWorks();
  const phone = useMedia("(max-width: 899px)");
  const [editing, setEditing] = useState(false);
  const [override, setOverride] = useState(false);
  const [toStatus, setToStatus] = useState<"delivered" | "aftercare" | null>(null);
  // Elk ander tabblad: de stand opnieuw (een handeling in een tabblad kan de fase doen schuiven), en elke 30 s.
  useEffect(() => { void stages.refetch(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const i = setInterval(() => void stages.refetch(), 30_000); return () => clearInterval(i); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!work.data) {
    return (
      <Page title={t.werven.title} actions={<Button icon="back" onClick={() => go("werven")}>{t.common.back}</Button>}>
        <Loading q={work} />
      </Page>
    );
  }
  const w = work.data;
  const client = isClient(caps);
  const facts = factsOf(w, stages.data);
  const fase = werfFase(facts);
  const tabs = werfTabs(caps, fase, facts);
  const cur = tabs.find((x) => x.key === tab) ?? (phone && !tab ? null : tabs[0]);
  const open = (k: TabKey) => go(k === "overzicht" && !phone ? `werven/${id}` : `werven/${id}/${k}`);
  const stap = volgendeStap(fase, facts, caps, w.caps.edit);
  const act = () => {
    const a = stap?.action;
    if (!a) return;
    if (a.kind === "tab") open(a.tab);
    else if (a.kind === "report") go(`verslag/${id}/${todayDay()}`);
    else if (a.kind === "werfstart") { const p = pending.data?.[0]; if (p) go(`werfstart/${p.versionId}`); else open("offerte"); }
    else if (a.kind === "status") setToStatus(a.status);
    else go(a.to);
  };
  const orgName = (oid?: bigint) => (oid === undefined ? undefined : orgs.data?.find((o) => o.id === oid)?.name);
  const parent = w.parentId !== undefined ? works.data?.find((x) => x.id === w.parentId) : undefined;
  const addr = [w.address.street, w.address.number].filter(Boolean).join(" ") + (w.address.city ? `, ${w.address.zip} ${w.address.city}` : "");
  const tabOpen = phone && cur !== null; // gsm: één onderdeel volledig in beeld

  const body = cur && <TabBody key={cur.key} tab={cur} w={w} caps={caps} go={go} fase={fase} facts={facts} stap={stap} act={act} client={client} />;
  return (
    <Page label={w.code} title={tabOpen && cur ? cur.label : w.name} wide={cur?.key === "planning" && !phone} actions={<>
      {w.caps.edit && !tabOpen && <Button icon="edit" onClick={() => setEditing(true)}>{t.werven.edit}</Button>}
      {tabOpen ? <Button icon="back" onClick={() => go(`werven/${id}`)}>{w.name}</Button> : <Button icon="back" onClick={() => go(caps.home === "week" ? "week" : "werven")}>{t.common.back}</Button>}
    </>}>
      {!tabOpen && (
        <>
          <div className="a-row">
            <PhaseLabel fase={fase} client={client} /><Info text={t.uitleg.fase} label={t.uitleg.label} />
            {fase.manual && <span className="a-tag" title={F.provisional}>{F.byHand}</span>}
            <span className="bw-muted">{addr}</span>
            {orgName(w.clientOrgId) && <span className="a-tag">{orgName(w.clientOrgId)}</span>}
            {parent && <button type="button" className="a-tag a-tag--link" onClick={() => go(`werven/${parent.id}`)}>{t.werven.subOf} {parent.code}</button>}
          </div>
          {toontFase(caps) && <StepBar fase={fase} client={client} />}
          {stap && <NextCard stap={stap} onAct={act} />}
        </>
      )}
      {phone ? (
        cur ? body : (
          <>
            {caps.writeReports && fase.index >= 3 && !fase.cancelled && (
              <div className={stap?.action?.kind === "report" ? "a-row" : "a-quick"}>
                {/* het werfverslag staat al als volgende stap: dan enkel de foto (geen twee knoppen voor hetzelfde) */}
                {stap?.action?.kind !== "report" && <Button variant="primary" size="lg" icon="edit" onClick={() => go(`verslag/${id}/${todayDay()}`)}>{F.report}</Button>}
                <Button size="lg" icon="camera" block={stap?.action?.kind === "report"} onClick={() => open("documenten")}>{F.photo}</Button>
              </div>
            )}
            <nav className="a-blist" aria-label={t.menu.tabs}>
              {tabs.map((x) => (
                <a key={x.key} href={`#/werven/${id}/${x.key}`} className={`a-bli${x.off ? " a-bli--off" : ""}`} onClick={(e) => { e.preventDefault(); open(x.key); }}>
                  <span className="a-bli__m"><b>{x.label}</b><span>{x.off ? x.off.split(".")[0] : F.hints[x.key]}</span></span>
                  <Icon name={x.off ? "lock" : "next"} size={18} />
                </a>
              ))}
            </nav>
          </>
        )
      ) : (
        <>
          <div className="a-wtabs" role="tablist" aria-label={t.menu.tabs}>
            {tabs.map((x) => (
              <a key={x.key} role="tab" href={`#/werven/${id}${x.key === "overzicht" ? "" : `/${x.key}`}`} aria-selected={cur?.key === x.key} className={`a-wtab${x.off ? " a-wtab--off" : ""}`} title={x.off} onClick={(e) => { e.preventDefault(); open(x.key); }}>
                {x.off && <Icon name="lock" size={14} />}{x.label}
              </a>
            ))}
          </div>
          {body}
        </>
      )}
      {cur?.key === "overzicht" && w.caps.edit && <div className="a-row"><Button variant="quiet" onClick={() => setOverride(true)}>{F.override}</Button></div>}

      {editing && <EditWork w={w} caps={caps} onClose={() => setEditing(false)} />}
      {override && <OverrideSheet w={w} fase={fase} onClose={() => setOverride(false)} />}
      {toStatus && <StatusSheet w={w} status={toStatus} onClose={() => setToStatus(null)} />}
    </Page>
  );
}

/** De kaart "Volgende stap": één zin en één knop (prototype 2b, vraag 14). */
function NextCard({ stap, onAct }: { stap: Stap; onAct: () => void }) {
  const S = t.stap[stap.key];
  return (
    <section className={`a-next${stap.action ? "" : " a-next--quiet"}`} aria-label={F.next}>
      <div className="a-next__t"><span className="bw-label">{F.next}</span><b>{S.t}</b><span className="bw-muted">{S.d}</span></div>
      {stap.action && <Button variant="primary" icon="next" onClick={onAct}>{S.b}</Button>}
    </section>
  );
}

/** Eén tabblad: wat er vroeger als blok op de werfpagina stond (zie het verslag van 2b.3, §2). */
function TabBody({ tab, w, caps, go, fase, facts, stap, act, client }: { tab: WerfTab; w: WorkView; caps: Caps; go: (to: string) => void; fase: Fase; facts: StageFacts; stap: Stap | null; act: () => void; client: boolean }) {
  const [force, setForce] = useState(false);
  const works = useWorks();
  const none = <p className="a-empty">{F.noRight}</p>;
  if (tab.off && !force) {
    return (
      <div className="a-off" role="note">
        <Icon name="lock" size={22} />
        <div className="a-off__b">
          <b>{F.notYet(tab.label)}</b>
          <span className="bw-muted">{tab.off}</span>
          <div className="a-row">
            {tab.key === "planning" && w.caps.edit && <Button onClick={() => setForce(true)}>{F.planByHand}</Button>}
            {stap?.action && <Button variant="quiet" icon="next" onClick={act}>{F.toNext}</Button>}
          </div>
        </div>
      </div>
    );
  }
  const id = w.id;
  switch (tab.key) {
    case "overzicht":
      return client || !caps.readTeam ? <ExternOverzicht w={w} caps={caps} go={go} client={client} /> : <Overzicht w={w} caps={caps} go={go} fase={fase} />;
    case "offerte":
      if (client) return <MyQuotes go={go} embedded workName={w.name} />;
      return (
        <div className="a-tabbody">
          <PendingStarts workId={id} caps={caps} go={go} />
          <WorkQuotes workId={id} caps={caps} go={go} />
          {fase.index >= 2 && <Meerwerk workId={id} caps={caps} go={go} facts={facts} />}
        </div>
      );
    case "planning":
      return (
        <div className="a-tabbody">
          <PlanningPage id={id} caps={caps} go={go} embedded />
          {caps.readOrgPlanning && <WorkConflicts workId={id} go={go} />}
        </div>
      );
    case "verslagen":
      return <ReportsSection workId={id} caps={caps} go={go} fallback={none} />;
    case "opmeting":
      return <OpmetingWerf workId={id} go={go} embedded />;
    case "facturatie":
      if (client) return <MyStatements go={go} embedded workName={w.name} />;
      return (
        <div className="a-tabbody">
          {caps.progress && <WorkStatements workId={id} caps={caps} go={go} embedded />}
          {caps.oaInvoices && <WorkOaInvoices workId={id} caps={caps} go={go} />}
          {w.caps.contract && <Contract w={w} works={works.data ?? []} />}
        </div>
      );
    case "vergunningen":
      return (
        <div className="a-tabbody">
          <WorkPermits w={w} fallback={none} />
          <WorkAdmin w={w} />
        </div>
      );
    case "documenten":
      return (
        <div className="a-tabbody">
          <Dossier w={w} />
          <Files workId={id} canUpload={caps.upload && w.caps.upload} title={t.werven.loose} canConfidential={caps.readContracts} />
        </div>
      );
    case "wie":
      return <WieWerktMee w={w} caps={caps} />;
  }
}

/** Overzicht (kantoor en werfleider): wat aandacht vraagt op déze werf, het laatste verslag, en de werffiche. */
function Overzicht({ w, caps, go, fase }: { w: WorkView; caps: Caps; go: (to: string) => void; fase: Fase }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const works = useWorks();
  const last = useQuery({ queryKey: ["reports", String(w.id), "laatste"], queryFn: () => actor!.listReports(w.id, 0n, 1n), enabled: on && fase.index >= 3, retry: 0 });
  const [report, setReport] = useState<bigint | null>(null);
  const docs = w.checklistOpen !== undefined && w.checklistOpen > 0n;
  return (
    <div className="a-cols">
      <div className="a-tabbody">
        <section className="a-section">
          <h2 className="bw-h2">{F.aandacht}</h2>
          {docs && (
            <ul className="a-list"><li>
              <button type="button" className="a-list__btn" onClick={() => go(`werven/${w.id}/documenten`)}>
                <Icon name="doc" size={20} /><span className="a-list__main"><b>{t.werven.docsOpen(Number(w.checklistOpen))}</b></span><Icon name="next" size={18} />
              </button>
            </li></ul>
          )}
          <IssueList workId={w.id} />
          {caps.readOrgPlanning && <WorkConflicts workId={w.id} go={go} />}
          {!docs && <p className="bw-muted">{F.nothing}</p>}
        </section>
        {last.data && last.data.length > 0 && (
          <section className="a-section">
            <div className="a-row a-row--between">
              <h2 className="bw-h2">{F.laatsteVerslag}</h2>
              <Button variant="quiet" onClick={() => go(`werven/${w.id}/verslagen`)}>{F.allReports}</Button>
            </div>
            <ul className="a-list"><SummaryRow r={last.data[0]} onOpen={() => setReport(last.data![0].id)} /></ul>
          </section>
        )}
        {report !== null && <ReportSheet id={report} onClose={() => setReport(null)} />}
        <details className="a-note">
          <summary>{F.rules.title}</summary>
          <ol>{F.rules.list.map((x) => <li key={x}>{x}</li>)}</ol>
          <p>{F.rules.foot}</p>
        </details>
      </div>
      <Fiche w={w} caps={caps} go={go} works={works.data ?? []} />
    </div>
  );
}

/** Voortgang (klant) of overzicht (architect, OA, VC): de werffiche zonder interne gegevens, de planning in het kort (klant). */
function ExternOverzicht({ w, caps, go, client }: { w: WorkView; caps: Caps; go: (to: string) => void; client: boolean }) {
  const works = useWorks();
  return (
    <div className="a-cols">
      <div className="a-tabbody">{client ? <PlanSummary workId={w.id} go={go} noLink /> : <PlanSummary workId={w.id} go={go} />}</div>
      <Fiche w={w} caps={caps} go={go} works={works.data ?? []} />
    </div>
  );
}

/** De werffiche (1.1): klant, architect, werfleider, VC, periode, btw, analytische code, deelwerven, feiten uit het contract. */
function Fiche({ w, caps, go, works }: { w: WorkView; caps: Caps; go: (to: string) => void; works: WorkView[] }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const members = useQuery({ queryKey: ["members", String(w.id)], queryFn: () => actor!.listMembers(w.id), enabled: on, refetchOnWindowFocus: true });
  // Namen van klant, architect en werfleider: enkel voor interne rollen (team en organisaties lezen).
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on && caps.readTeam });
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on && caps.readTeam });
  const [newSub, setNewSub] = useState(false);
  const orgName = (oid?: bigint) => (oid === undefined ? t.common.none : orgs.data?.find((o) => o.id === oid)?.name ?? `#${oid}`);
  const personName = (pid?: bigint) => (pid === undefined ? t.werven.noLeader : persons.data?.find((p) => p.id === pid)?.name ?? members.data?.find((m) => m.personId === pid)?.name ?? `#${pid}`);
  const subs = works.filter((x) => x.parentId === w.id);
  const vcs = (members.data ?? []).filter((m) => m.role === Role.veiligheidscoordinator);
  const leaders = (members.data ?? []).filter((m) => m.role === Role.werfleider);
  return (
    <section className="a-section">
      <h2 className="bw-h2">{t.werven.fiche}</h2>
      <dl className="a-dl">
        {caps.readTeam && <>
          <dt>{t.werven.client}</dt><dd>{orgs.data || w.clientOrgId === undefined ? orgName(w.clientOrgId) : "…"}</dd>
          <dt>{t.werven.architect}</dt><dd>{orgs.data || w.architectOrgId === undefined ? orgName(w.architectOrgId) : "…"}</dd>
        </>}
        <dt>{t.werven.leader}</dt><dd>{w.leaderPersonId === undefined && leaders.length ? leaders.map((m) => m.name).join(", ") : personName(w.leaderPersonId)}</dd>
        {/* externen zien de andere firma's op de werf niet (listMembers, 1.9): geen VC-regel en geen analytische code voor hen */}
        {caps.readTeam && <><dt>{t.werven.vc}</dt><dd>{vcs.length ? vcs.map((m) => m.name).join(", ") : <span className="a-tag a-tag--warn">{t.werven.noVc}</span>}</dd></>}
        <dt>{t.werven.period}</dt><dd className="bw-num">{w.plannedStart !== undefined || w.plannedEnd !== undefined ? `${fmtDayNum(w.plannedStart)} – ${fmtDayNum(w.plannedEnd)}` : t.common.none}</dd>
        <dt>{t.werven.vat}</dt><dd>{Number(w.vatBp) / 100} %{w.vatNote ? <span className="bw-muted"> · {w.vatNote}</span> : null}</dd>
        {caps.readTeam && <><dt>{t.werven.analytic}</dt><dd className="bw-mono">{w.analyticCode ?? <>{w.code} <span className="bw-muted">{t.werven.analyticSame}</span></>}</dd></>}
        {subs.length > 0 && <><dt>{t.werven.subs}</dt><dd className="a-row">{subs.map((x) => <button key={String(x.id)} type="button" className="a-tag a-tag--link" onClick={() => go(`werven/${x.id}`)}>{x.code}</button>)}</dd></>}
      </dl>
      {caps.createWork && w.parentId === undefined && <div><Button variant="quiet" icon="plus" onClick={() => setNewSub(true)}>{t.werven.newSub}</Button></div>}
      {w.facts && <Facts w={w} works={works} />}
      {newSub && <NewWork parent={w} onClose={() => setNewSub(false)} go={go} />}
    </section>
  );
}

/** + Meerwerk (flow-analyse §4.5): een nieuwe versie van de aanvaarde offerte; na het akkoord start Werf starten enkel het verschil. */
function Meerwerk({ workId, caps, go, facts }: { workId: bigint; caps: Caps; go: (to: string) => void; facts: StageFacts }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["quotes", String(workId), false], queryFn: () => actor!.listQuotes(workId, false), enabled: !!actor && !isFetching });
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  // De offertes met een aanvaarde versie; meerwerk = de versies die daarna kwamen.
  const accepted = (list.data ?? []).filter((q) => q.versions.some((v) => v.status === QuoteStatus.accepted));
  const later = accepted.flatMap((q) => {
    const first = Math.min(...q.versions.filter((v) => v.status === QuoteStatus.accepted).map((v) => Number(v.version)));
    return q.versions.filter((v) => Number(v.version) > first).map((v) => ({ q, v }));
  });
  // Meer dan één aanvaarde offerte op de werf: eerst kiezen op welke (review 2b.3).
  const make = async (q = accepted.length === 1 ? accepted[0] : undefined) => {
    if (!q) { setPick(true); return; }
    setPick(false);
    const draft = q.versions.find((v) => v.status === QuoteStatus.draft);
    if (draft) { go(`offertes/${q.id}/${draft.id}`); return; }
    const base = q.versions.filter((v) => v.status === QuoteStatus.accepted).sort((a, b) => Number(b.version - a.version))[0];
    setBusy(true);
    try {
      const nid = unwrap(await actor!.newQuoteVersion(q.id, base.id));
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      toast.show({ kind: "ok", text: F.meerwerkMade });
      go(`offertes/${q.id}/${nid}`);
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  if (accepted.length === 0) return null;
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{F.meerwerk}</h2>
        {caps.editQuotes && <Button variant="primary" icon="plus" busy={busy} onClick={() => void make()}>{F.meerwerkNew}</Button>}
      </div>
      <p className="bw-muted">{F.meerwerkLead}{facts.startPending ? ` ${t.stap.meerwerkStarten.d}` : ""}</p>
      {pick && (
        <div className="a-blist" role="group" aria-label={F.meerwerkPick}>
          <span className="bw-label" style={{ padding: "10px 14px 0" }}>{F.meerwerkPick}</span>
          {accepted.map((q) => (
            <button key={String(q.id)} type="button" className="a-bli" onClick={() => void make(q)}>
              <span className="a-bli__m"><b>{q.number}</b><span>{q.title}</span></span>
              <Icon name="next" size={18} />
            </button>
          ))}
        </div>
      )}
      {later.length === 0 ? <p className="a-empty">{F.meerwerkNone}</p> : (
        <ul className="a-list">
          {later.map(({ q, v }) => (
            <li key={String(v.id)}>
              <button type="button" className="a-list__btn" onClick={() => go(`offertes/${q.id}/${v.id}`)}>
                <span className="a-tag">{q.number}</span>
                <span className="a-list__main"><b>{t.offertes.version(v.version)}</b><span className="bw-muted">{fmtTime(v.updatedAt)}</span></span>
                <span className="a-tag">{t.offertes.status[v.status] ?? v.status}</span>
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Fase overschrijven: de status met de hand (vooruit, opleveren, nazorg, annuleren). Akkoord, Opgemeten en Gefactureerd volgen altijd uit de gegevens. */
function OverrideSheet({ w, fase, onClose }: { w: WorkView; fase: Fase; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [pick, setPick] = useState<WorkStatus>(w.status);
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.setWorkStatus(w.id, pick)),
    onSuccess: () => { toast.show({ kind: "ok", text: F.overrideDone(F.choices[pick]) }); void qc.invalidateQueries(); onClose(); },
  });
  const opts = [WorkStatus.request, WorkStatus.quoting, WorkStatus.planned, WorkStatus.running, WorkStatus.delivered, WorkStatus.aftercare, WorkStatus.cancelled];
  return (
    <Sheet title={`${F.override} · ${w.code}`} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" disabled={pick === w.status} busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <p className="bw-muted">{F.overrideLead}</p>
        <p className="bw-num"><b>{F.of(fase.index + 1, 8)}</b> · {faseNaam(fase)}</p>
        <div className="a-blist" role="radiogroup" aria-label={F.override}>
          {opts.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={pick === o} className="a-bli" onClick={() => setPick(o)}>
              <span className="a-bli__m"><b>{F.choices[o]}</b><span>{F.choiceHelp[o]}</span></span>
              {pick === o && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
        <p className="bw-muted">{F.overrideNote}</p>
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

/** Opleveren of nazorg vanuit "Volgende stap": bevestigen in een paneel (geen window.confirm). */
function StatusSheet({ w, status, onClose }: { w: WorkView; status: "delivered" | "aftercare"; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const S = status === "delivered" ? t.stap.opleveren : t.stap.nazorg;
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.setWorkStatus(w.id, status === "delivered" ? WorkStatus.delivered : WorkStatus.aftercare)),
    onSuccess: () => { toast.show({ kind: "ok", text: F.overrideDone(F.choices[status]) }); void qc.invalidateQueries(); onClose(); },
  });
  return (
    <Sheet title={`${S.t} · ${w.code}`} open onClose={onClose} footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{S.b}</Button></>}>
      <p>{S.d}</p>
      {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
    </Sheet>
  );
}

/** De afgeleide feiten: wat de werfleider moet weten, zonder bedragen (R27). */
function Facts({ w, works }: { w: WorkView; works: WorkView[] }) {
  const f = w.facts!;
  if (!f.contractKnown) return <p className="a-note">{t.facts.unknown}</p>;
  const yn = (b?: boolean) => (b === undefined ? t.facts.unknownValue : b ? t.facts.yes : t.facts.no);
  const need = (b?: boolean) => (b === undefined ? <span className="a-tag a-tag--warn">{t.facts.unknownValue}</span> : b ? <span className="a-tag a-tag--accent">{t.facts.needed}</span> : <span className="a-tag">{t.facts.notNeeded}</span>);
  const from = f.inheritedFrom !== undefined ? works.find((x) => x.id === f.inheritedFrom)?.code ?? `#${f.inheritedFrom}` : null;
  return (
    <div className="a-facts">
      <span className="bw-label">{t.facts.title}{from ? ` · ${t.facts.inherited(from)}` : ""}</span>
      <dl className="a-dl">
        <dt>{t.facts.guarantee}</dt><dd>{yn(f.guarantee)}</dd>
        <dt>{t.facts.revision}</dt><dd>{yn(f.priceRevision)}</dd>
        <dt>{t.facts.art30bis}</dt><dd>{need(f.art30bis)}</dd>
        <dt>{t.facts.checkinatwork}</dt><dd>{need(f.checkinatwork)}</dd>
      </dl>
      <p className="bw-muted">{t.facts.help}</p>
    </div>
  );
}

/** Contractparameters: pas na een klik gelezen (update-call met auditregel), nooit in een cache (R23). */
function Contract({ w, works }: { w: WorkView; works: WorkView[] }) {
  const { actor } = useBackend();
  const [view, setView] = useState<ContractView | null>(null);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof loadHistory>> | null>(null);
  const loadHistory = async () => unwrap(await actor!.readContractHistory(w.id));
  const read = useMutation({ mutationFn: async () => unwrap(await actor!.readContract(w.id)), onSuccess: setView });
  const hist = useMutation({ mutationFn: loadHistory, onSuccess: setHistory });
  // Weg bij het verlaten van de werf: niets vertrouwelijks blijft in het geheugen hangen.
  useEffect(() => () => { setView(null); setHistory(null); }, [w.id]);
  const code = (id?: bigint) => works.find((x) => x.id === id)?.code ?? `#${id}`;
  const k = view?.contract;
  // 2.8: welke offerteversie getekend is (nummer en versie uit de offertes van de werf; de werfstart zet ze).
  const quotes = useQuery({ queryKey: ["quotes", String(w.id)], queryFn: () => actor!.listQuotes(w.id, true), enabled: !!actor && k?.signedQuoteVersionId !== undefined });
  const signedLabel = (vid: bigint) => {
    for (const q of quotes.data ?? []) { const v = q.versions.find((x) => x.id === vid); if (v) return `${q.number} v${v.version}`; }
    return `#${vid}`;
  };
  return (
    <section className="a-section a-confidential">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.contract.title}</h2>
        <span className="a-tag a-tag--warn">{t.werven.confidential}</span>
      </div>
      <p className="bw-muted">{t.contract.lead}</p>
      {!view && <div><Button icon="key" busy={read.isPending} onClick={() => read.mutate()}>{t.contract.show}</Button></div>}
      {read.error && <p className="a-err" role="alert">{errText(read.error)}</p>}
      {view && (
        <>
          {view.inheritedFrom !== undefined && <p className="a-note">{t.contract.inherited(code(view.inheritedFrom))}</p>}
          {view.sealed && <p className="a-note">{t.contract.sealed}</p>}
          {!k && !view.sealed && <p className="a-empty">{t.contract.empty}</p>}
          {k && (
            <dl className="a-dl">
              <dt>{t.contract.amount}</dt><dd className="bw-num">{fmtEuro(k.estimatedAmountCents)}</dd>
              <dt>{t.contract.revision}</dt><dd>{k.priceRevision.__kind__ === "formula" ? <span className="bw-mono">{k.priceRevision.formula}</span> : t.contract.revisionNone}</dd>
              <dt>{t.contract.guarantee}</dt><dd>{t.contract.guaranteeKinds[k.guarantee]}{k.guarantee !== GuaranteeKind.none ? ` · ${fmtBp(k.guaranteeBp)}` : ""}</dd>
              <dt>{t.contract.term}</dt><dd className="bw-num">{t.contract.days(String(k.paymentTermDays))}</dd>
              <dt>{t.contract.rhythm}</dt><dd>{k.invoicingRhythm.__kind__ === "other" ? k.invoicingRhythm.other : t.contract.rhythms[k.invoicingRhythm.__kind__]}</dd>
              {k.signedQuoteVersionId !== undefined && <><dt>{t.werfstart.signedVersion}</dt><dd className="bw-mono">{signedLabel(k.signedQuoteVersionId)}</dd></>}
              {k.note && <><dt>{t.contract.note}</dt><dd>{k.note}</dd></>}
              {view.clientContact && view.clientContact.name && <><dt>{t.contract.contact}</dt><dd>{[view.clientContact.name, view.clientContact.phone, view.clientContact.email].filter(Boolean).join(" · ")}</dd></>}
              {view.notes && <><dt>{t.contract.notes}</dt><dd>{view.notes}</dd></>}
            </dl>
          )}
          {view.version > 0n && view.updatedAt !== undefined && <p className="bw-muted bw-num">{t.contract.version(String(view.version), view.updatedByName, fmtTime(view.updatedAt))}</p>}
          <div className="a-row">
            {!view.sealed && <Button icon="edit" onClick={() => setEditing(true)}>{t.contract.edit}</Button>}
            {view.version > 0n && view.inheritedFrom === undefined && <Button variant="quiet" busy={hist.isPending} onClick={() => hist.mutate()}>{t.contract.history}</Button>}
            <Button variant="quiet" onClick={() => { setView(null); setHistory(null); }}>{t.contract.hide}</Button>
          </div>
          {history && (
            <ul className="a-list">
              {history.slice().reverse().map((h) => (
                <li key={String(h.version)}>
                  <span className="a-list__main">
                    <b className="bw-num">v{String(h.version)} · {fmtEuro(h.contract?.estimatedAmountCents)}</b>
                    <span className="bw-muted bw-num">{h.byName} · {fmtTime(h.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {editing && view && <EditContract w={w} view={view} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setHistory(null); read.mutate(); }} />}
    </section>
  );
}

function EditContract({ w, view, onClose, onSaved }: { w: WorkView; view: ContractView; onClose: () => void; onSaved: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const k = view.contract;
  const [f, setF] = useState({
    amount: k?.estimatedAmountCents !== undefined ? (Number(k.estimatedAmountCents) / 100).toLocaleString("nl-BE", { minimumFractionDigits: 2 }) : "",
    revision: k?.priceRevision.__kind__ ?? "none",
    formula: k?.priceRevision.__kind__ === "formula" ? k.priceRevision.formula : "",
    guarantee: k?.guarantee ?? GuaranteeKind.none,
    pct: k && k.guaranteeBp > 0n ? (Number(k.guaranteeBp) / 100).toLocaleString("nl-BE") : "",
    term: k ? String(k.paymentTermDays) : "30",
    rhythm: (k?.invoicingRhythm.__kind__ ?? "perProgress") as InvoicingRhythm["__kind__"],
    rhythmOther: k?.invoicingRhythm.__kind__ === "other" ? k.invoicingRhythm.other : "",
    note: k?.note ?? "",
    cName: view.clientContact?.name ?? "",
    cPhone: view.clientContact?.phone ?? "",
    cEmail: view.clientContact?.email ?? "",
    notes: view.notes ?? "",
  });
  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [key]: e.target.value });
  // Een overgenomen contract (deelwerf) wordt een eigen contract: versie 0.
  const expected = view.inheritedFrom !== undefined ? 0n : view.version;
  const save = useMutation({
    mutationFn: async () => {
      const amount = parseEuro(f.amount);
      if (amount === null) throw new Error(t.contract.amount + ": ongeldig bedrag");
      const pct = f.guarantee === GuaranteeKind.none ? 0n : parsePct(f.pct);
      if (pct === null) throw new Error(t.contract.guaranteePct + ": ongeldig percentage");
      if (!/^\d{1,3}$/.test(f.term.trim())) throw new Error(t.contract.term + ": een getal");
      const rhythm: InvoicingRhythm = f.rhythm === "other" ? { __kind__: "other", other: f.rhythmOther } : ({ __kind__: f.rhythm, [f.rhythm]: null } as InvoicingRhythm);
      const input: ContractInput = {
        contract: {
          estimatedAmountCents: amount,
          priceRevision: f.revision === "formula" ? { __kind__: "formula", formula: f.formula } : { __kind__: "none", none: null },
          guarantee: f.guarantee,
          guaranteeBp: pct,
          paymentTermDays: BigInt(f.term.trim()),
          invoicingRhythm: rhythm,
          signedQuoteVersionId: undefined,
          note: f.note,
        },
        clientContact: f.cName || f.cPhone || f.cEmail ? { name: f.cName, phone: optText(f.cPhone), email: optText(f.cEmail), address: undefined } : undefined,
        notes: f.notes,
      };
      return unwrap(await actor!.setContract(w.id, input, expected));
    },
    // De feiten bepalen ook de checklist (30bis, Checkinatwork) van deze werf en van haar deelwerven.
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["work"] }); void qc.invalidateQueries({ queryKey: ["works"] }); void qc.invalidateQueries({ queryKey: ["dossier"] }); onSaved(); },
  });
  return (
    <Sheet title={`${t.contract.title} · ${w.code}`} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <Field label={t.contract.amount}><input className="bw-input bw-num" value={f.amount} onChange={set("amount")} inputMode="decimal" placeholder="45.000,00" /></Field>
        <p className="bw-muted">{t.contract.amountHelp}</p>
        <Field label={t.contract.revision}>
          <Choice label={t.contract.revision} value={f.revision} onChange={(v) => setF({ ...f, revision: v })} options={[{ value: "none", label: t.contract.revisionNone }, { value: "formula", label: t.contract.revisionFormula }]} />
        </Field>
        {f.revision === "formula" && <Field label={t.contract.formula}><input className="bw-input bw-mono" value={f.formula} onChange={set("formula")} placeholder={t.contract.formulaPh} /></Field>}
        <Field label={t.contract.guarantee}>
          <Choice label={t.contract.guarantee} value={f.guarantee} onChange={(v) => setF({ ...f, guarantee: v })} options={[GuaranteeKind.none, GuaranteeKind.retention, GuaranteeKind.bankGuarantee].map((g) => ({ value: g, label: t.contract.guaranteeKinds[g] }))} />
        </Field>
        {f.guarantee !== GuaranteeKind.none && <Field label={t.contract.guaranteePct}><input className="bw-input bw-num" style={{ maxWidth: 120 }} value={f.pct} onChange={set("pct")} inputMode="decimal" placeholder="5" /></Field>}
        <div className="a-grid2">
          <Field label={t.contract.term}><input className="bw-input bw-num" value={f.term} onChange={set("term")} inputMode="numeric" /></Field>
          <Field label={t.contract.rhythm}>
            <select className="bw-input" value={f.rhythm} onChange={(e) => setF({ ...f, rhythm: e.target.value as InvoicingRhythm["__kind__"] })}>
              {(["monthly", "perPhase", "perProgress", "other"] as const).map((r) => <option key={r} value={r}>{t.contract.rhythms[r]}</option>)}
            </select>
          </Field>
        </div>
        {f.rhythm === "other" && <Field label={t.contract.rhythmOther}><input className="bw-input" value={f.rhythmOther} onChange={set("rhythmOther")} /></Field>}
        <Field label={t.contract.note}><input className="bw-input" value={f.note} onChange={set("note")} /></Field>
        <span className="bw-label">{t.contract.contact}</span>
        <div className="a-grid3">
          <Field label={t.contract.contactName}><input className="bw-input" value={f.cName} onChange={set("cName")} /></Field>
          <Field label={t.team.phone}><input className="bw-input" value={f.cPhone} onChange={set("cPhone")} inputMode="tel" /></Field>
          <Field label={t.orgs.email}><input className="bw-input" value={f.cEmail} onChange={set("cEmail")} inputMode="email" /></Field>
        </div>
        <Field label={t.contract.notes}><textarea className="bw-input" rows={3} value={f.notes} onChange={set("notes")} /></Field>
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

function EditWork({ w, caps, onClose }: { w: WorkView; caps: Caps; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const works = useWorks();
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on });
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on && w.caps.setLeader });
  const [f, setF] = useState({
    code: w.code,
    name: w.name,
    street: w.address.street,
    number: w.address.number,
    zip: w.address.zip,
    city: w.address.city,
    vat: Number(w.vatBp),
    vatNote: w.vatNote,
    analytic: w.analyticCode ?? "",
    start: dayToInput(w.plannedStart),
    end: dayToInput(w.plannedEnd),
    client: w.clientOrgId !== undefined ? String(w.clientOrgId) : "",
    architect: w.architectOrgId !== undefined ? String(w.architectOrgId) : "",
    parent: w.parentId !== undefined ? String(w.parentId) : "",
    leader: w.leaderPersonId !== undefined ? String(w.leaderPersonId) : "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const big = (s: string) => (s === "" ? undefined : BigInt(s));
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await actor!.updateWork(w.id, {
        code: f.code,
        name: f.name,
        address: { ...w.address, street: f.street, number: f.number, zip: f.zip, city: f.city },
        parentId: big(f.parent),
        clientOrgId: big(f.client),
        architectOrgId: big(f.architect),
        leaderPersonId: big(f.leader),
        vatBp: BigInt(f.vat),
        plannedStart: inputToDay(f.start),
        plannedEnd: inputToDay(f.end),
        analyticCode: optText(f.analytic),
        vatNote: f.vatNote,
      })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); onClose(); },
  });
  const orgOpts = (kind: string) => (orgs.data ?? []).filter((o) => o.kind === kind);
  // P-10 (1.1): een nieuwe klant of een nieuw bureau meteen hier aanmaken (enkel de naam; de rest in Firma's & contacten).
  const [newOrg, setNewOrg] = useState<{ kind: "client" | "architect"; name: string } | null>(null);
  const makeOrg = useMutation({
    mutationFn: async (v: { kind: "client" | "architect"; name: string }) =>
      unwrap(await actor!.createOrg({ kind: v.kind === "client" ? OrgKind.client : OrgKind.architect, name: v.name, kbo: undefined, vat: undefined, aliases: [], trades: [], address: undefined, notes: "" })),
    onSuccess: (o, v) => { void qc.invalidateQueries({ queryKey: ["orgs"] }); setF((x) => ({ ...x, [v.kind]: String(o.id) })); setNewOrg(null); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  // Mogelijke hoofdwerven: zelfstandige werven, niet deze, en niet als deze werf zelf deelwerven heeft.
  const hasSubs = (works.data ?? []).some((x) => x.parentId === w.id);
  const parents = (works.data ?? []).filter((x) => x.parentId === undefined && x.id !== w.id);
  return (
    <Sheet title={`${t.werven.edit} · ${w.code}`} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <div className="a-grid2">
          <Field label={t.werven.code}><input className="bw-input bw-mono" value={f.code} onChange={set("code")} /></Field>
          <Field label={t.werven.analytic}><input className="bw-input bw-mono" value={f.analytic} onChange={set("analytic")} placeholder={f.code} /></Field>
        </div>
        <p className="bw-muted">{t.werven.analyticHelp}</p>
        <Field label={t.werven.name}><input className="bw-input" value={f.name} onChange={set("name")} /></Field>
        <div className="a-grid3">
          <Field label={t.werven.street}><input className="bw-input" value={f.street} onChange={set("street")} /></Field>
          <Field label={t.werven.number}><input className="bw-input" value={f.number} onChange={set("number")} /></Field>
          <Field label={t.werven.zip}><input className="bw-input" value={f.zip} onChange={set("zip")} inputMode="numeric" /></Field>
        </div>
        <Field label={t.werven.city}><input className="bw-input" value={f.city} onChange={set("city")} /></Field>
        <Field label={t.werven.vat}><Choice label={t.werven.vat} value={f.vat} onChange={(v) => setF({ ...f, vat: v })} options={[{ value: 600, label: "6 %" }, { value: 2100, label: "21 %" }]} /></Field>
        <Field label={t.werven.vatNote}><input className="bw-input" value={f.vatNote} onChange={set("vatNote")} placeholder={t.werven.vatNotePh} /></Field>
        <div className="a-grid2">
          <Field label={t.werven.start}><input type="date" className="bw-input bw-num" value={f.start} onChange={set("start")} /></Field>
          <Field label={t.werven.end}><input type="date" className="bw-input bw-num" value={f.end} onChange={set("end")} /></Field>
        </div>
        <div className="a-grid2">
          <Field label={t.werven.client}>
            <select className="bw-input" value={f.client} onChange={set("client")}>
              <option value="">{t.werven.noOrgPick}</option>
              {orgOpts("client").map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
            </select>
            {caps.manageOrgs && <Button variant="quiet" icon="plus" onClick={() => setNewOrg({ kind: "client", name: "" })}>{t.werven.newClient}</Button>}
          </Field>
          <Field label={t.werven.architect}>
            <select className="bw-input" value={f.architect} onChange={set("architect")}>
              <option value="">{t.werven.noOrgPick}</option>
              {orgOpts("architect").map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
            </select>
            {caps.manageOrgs && <Button variant="quiet" icon="plus" onClick={() => setNewOrg({ kind: "architect", name: "" })}>{t.werven.newArchitect}</Button>}
          </Field>
        </div>
        {newOrg && (
          <div className="a-row">
            <input id="new-org" className="bw-input" value={newOrg.name} maxLength={80} placeholder={newOrg.kind === "client" ? t.werven.newClient : t.werven.newArchitect} onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })} />
            <Button variant="primary" disabled={!newOrg.name.trim()} busy={makeOrg.isPending} onClick={() => makeOrg.mutate(newOrg)}>{t.common.save}</Button>
            <Button variant="quiet" onClick={() => setNewOrg(null)}>{t.common.cancel}</Button>
          </div>
        )}
        <div>
        </div>
        <Field label={t.werven.leader}>
          {w.caps.setLeader ? (
            <select className="bw-input" value={f.leader} onChange={set("leader")}>
              <option value="">{t.werven.noLeader}</option>
              {(persons.data ?? []).filter((p) => p.roles.includes(Role.werfleider)).map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
            </select>
          ) : <span className="bw-muted">{t.werven.leaderAdminOnly}</span>}
        </Field>
        {!hasSubs && (
          <Field label={t.werven.parent}>
            <select className="bw-input" value={f.parent} onChange={set("parent")}>
              <option value="">{t.werven.noParent}</option>
              {parents.map((x) => <option key={String(x.id)} value={String(x.id)}>{x.code} · {x.name}</option>)}
            </select>
          </Field>
        )}
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}
