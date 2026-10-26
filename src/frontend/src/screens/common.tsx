// Kleine bouwstenen die meerdere schermen delen.
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WorkStatus, type WorkStageView, type WorkView } from "../backend";
import { Icon, STATUS_WORD, StatusBadge, type Status } from "../design";
import { t } from "../texts/nl";
import { errText, fmtDay, todayLabel, useBackend } from "../util";
import { faseNaam, PHASE_KEYS, werfFase, type Fase, type StageFacts } from "../app/fase";

export function Page({ label, title, actions, children, wide }: { label?: string; title: string; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "a-page a-page--wide" : "a-page"}>
      <header className="a-head">
        <div>
          <span className="bw-label">{label ?? todayLabel()}</span>
          <h1 className="bw-h1">{title}</h1>
        </div>
        {actions && <div className="a-row">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

/** 2b.3: een scherm staat op zichzelf (eigen pagina) of als tabblad in de werf (embedded: geen eigen kop, de knoppen rechts). */
export function Frame({ embedded, label, title, actions, children, wide }: { embedded?: boolean; label?: string; title: string; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  if (!embedded) return <Page label={label} title={title} actions={actions} wide={wide}>{children}</Page>;
  return (
    <div className="a-tabbody">
      {actions && <div className="a-row a-tabbody__actions">{actions}</div>}
      {children}
    </div>
  );
}

export function Loading({ q }: { q: { isLoading: boolean; error: unknown } }) {
  if (q.isLoading) return <p className="bw-muted">{t.common.loading}</p>;
  if (q.error) return <p className="a-err" role="alert"><Icon name="alert" size={16} /> {errText(q.error)}</p>;
  return null;
}

/** Werfstatus → een van de vijf vaste statussen + het eigen woord als aanvulling. */
const WORK_TO_STATUS: Record<string, Status> = {
  request: "planned",
  quoting: "planned",
  planned: "planned",
  running: "busy",
  delivered: "done",
  aftercare: "done",
  cancelled: "blocked",
};

export function WorkBadge({ status }: { status: WorkStatus }) {
  const s = WORK_TO_STATUS[status] ?? "planned";
  const word = t.workStatus[status] ?? status;
  return <StatusBadge status={s} small extra={word !== STATUS_WORD[s] ? word : undefined} />;
}

/** 2b.3: de stand van alle werven die je ziet (één query; de fase rekent app/fase.ts). */
export function useStages() {
  const { actor, isFetching } = useBackend();
  // Na een handeling elders (offerte versturen, opmeting afsluiten, staat versturen …) ververst App.tsx de stand; op de
  // werfpagina ook bij elk ander tabblad en elke 30 s (review 2b.3: geen verouderde stappenbalk).
  return useQuery({ queryKey: ["stages"], queryFn: () => actor!.listWorkStages(), enabled: !!actor && !isFetching, refetchOnWindowFocus: true, staleTime: 5_000 });
}

/** De feiten van één werf voor werfFase: de status + (als de stand er al is) de momenten uit listWorkStages. */
export function factsOf(w: Pick<WorkView, "id" | "status">, stages?: WorkStageView[]): StageFacts {
  const s = stages?.find((x) => x.workId === w.id);
  return s ? { ...s, status: w.status } : { status: w.status };
}

/** Werffase-label: een meter van acht streepjes + het woord in mono, los van de vijf taakstatussen (B6). */
export function PhaseLabel({ fase, client }: { fase: Fase; client?: boolean }) {
  return (
    <span className={`a-ph${fase.cancelled ? " a-ph--x" : ""}`} title={fase.manual ? `${faseNaam(fase, client)} · ${t.fase.byHand}` : faseNaam(fase, client)}>
      <span className="a-ph__m" aria-hidden>{PHASE_KEYS.map((k, i) => <i key={k} className={i < fase.index ? "on" : i === fase.index ? "now" : ""} />)}</span>
      <span className="a-ph__w">{faseNaam(fase, client)}</span>
    </span>
  );
}

/** Het werffase-label van één werf (haalt zelf de stand op; zonder bereik volgt het enkel de status). */
export function WorkPhase({ w }: { w: Pick<WorkView, "id" | "status"> }) {
  const stages = useStages();
  return <PhaseLabel fase={werfFase(factsOf(w, stages.data))} />;
}

/** De stappenbalk: acht fases (desktop) of "Fase 5 van 8" met een balkje (gsm). Overgeslagen fases (bv. een opdracht zonder offerte) met een stippellijn. */
export function StepBar({ fase, client }: { fase: Fase; client?: boolean }) {
  const names = client ? t.fase.client : t.fase.names;
  const day = (x?: bigint) => (x === undefined ? "" : fmtDay(x));
  return (
    <div className="a-stepbar" aria-label={t.fase.bar}>
      <ol className="a-steps">
        {names.map((n, i) => {
          const st = fase.steps[i];
          return (
            <li key={n} className={`a-step a-step--${st}`} aria-current={st === "now" ? "step" : undefined} title={t.fase.stepTitle(n, t.fase.state[st])}>
              <span className="a-step__d" />
              <span className="a-step__t">{n}</span>
              <span className="a-step__s">{st === "skipped" ? t.fase.skipped : st === "now" && fase.cancelled ? t.fase.cancelled : day(fase.at[i])}</span>
            </li>
          );
        })}
      </ol>
      <div className="a-steps-n">
        <div className="a-row a-row--between"><span className="bw-label">{t.fase.of(fase.index + 1, names.length)}</span><b>{faseNaam(fase, client)}</b></div>
        <div className="a-steps-n__bar" aria-hidden>{names.map((n, i) => <i key={n} className={i < fase.index ? "on" : i === fase.index ? "now" : ""} />)}</div>
      </div>
    </div>
  );
}

export function useWorks() {
  const { actor, isFetching } = useBackend();
  return useQuery({ queryKey: ["works"], queryFn: () => actor!.listWorks(), enabled: !!actor && !isFetching });
}

export function WorkList({ works, go, empty, client }: { works: WorkView[]; go: (to: string) => void; empty: string; client?: boolean }) {
  const stages = useStages();
  if (works.length === 0) return <p className="a-empty">{empty}</p>;
  return (
    <ul className="a-list">
      {works.map((w) => (
        <li key={String(w.id)}>
          <button type="button" className={`a-list__btn${w.parentId !== undefined ? " a-list__btn--sub" : ""}`} onClick={() => go(`werven/${w.id}`)}>
            <span className="a-tag">{w.code}</span>
            <span className="a-list__main">
              <b>{w.name}</b>
              <span className="bw-muted">{w.parentId !== undefined ? `${t.werven.sub} · ` : ""}{[w.address.street, w.address.number].filter(Boolean).join(" ")}{w.address.city ? `, ${w.address.city}` : ""}</span>
            </span>
            {w.checklistOpen !== undefined && w.checklistOpen > 0n && <span className="a-tag a-tag--warn">{t.werven.docsOpen(Number(w.checklistOpen))}</span>}
            <PhaseLabel fase={werfFase(factsOf(w, stages.data))} client={client} />
            <Icon name="next" size={18} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RoleTags({ roles }: { roles: string[] }) {
  return <span className="a-row">{roles.map((r) => <span key={r} className={`a-tag${r === "admin" ? " a-tag--accent" : ""}`}>{t.roles[r] ?? r}</span>)}</span>;
}
