// Het startpunt (stap 2b.4): de kaart "Aan de slag" op het Overzicht van de beheerder, de blauwe uitlegbalk op het scherm waar
// elke stap heen gaat, en de kaart "Zo werkt het voor jou" (één keer per persoon). Wat bewaard wordt staat in settings.values
// (backend/mixins/StartApi.mo); wat de app zelf kan zien komt uit bestaande queries.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Caps } from "../backend";
import { Button, Icon, useToast } from "../design";
import { issuerFilled, START_KEYS, startDoneCount, startRoute, startSteps, startVisible, type IntroKind, type StartFacts, type StartKey } from "../app/start";
import { t } from "../texts/nl";
import { errText, unwrap, useBackend } from "../util";
import { useStages, useWorks } from "./common";

const S = t.start;
const BOWACO_ROLES = ["admin", "werfleider", "calculator"];

export function useStartState() {
  const { actor, isFetching } = useBackend();
  return useQuery({ queryKey: ["startState"], queryFn: () => actor!.startState(), enabled: !!actor && !isFetching, retry: 0, staleTime: 10_000 });
}

/** Wat de app zelf ziet (alleen voor de beheerder: de bronnen vragen kantoorrechten). */
export function useStartFacts(enabled: boolean): StartFacts | undefined {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching && enabled;
  const doc = useQuery({ queryKey: ["quoteDocSettings"], queryFn: () => actor!.getQuoteDocSettings(), enabled: on });
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on });
  const oas = useQuery({ queryKey: ["oas-all"], queryFn: () => actor!.listOas({ includeArchived: false }), enabled: on });
  const lib = useQuery({ queryKey: ["startLib"], queryFn: () => actor!.listLibrary({ text: "", chapterId: undefined, form: undefined, trade: undefined, unit: undefined, orgId: undefined, includeArchived: false, offset: 0n, limit: 1n }), enabled: on });
  const works = useWorks();
  const stages = useStages();
  if (!on || !doc.data || !persons.data || !oas.data || !lib.data || !works.data || !stages.data) return undefined;
  const live = new Set(works.data.filter((w) => w.archivedAt === undefined).map((w) => w.id));
  return {
    issuer: issuerFilled(doc.data.issuer),
    team: persons.data.filter((p) => p.roles.some((r) => BOWACO_ROLES.includes(r))).length,
    oas: oas.data.length,
    posts: Number(lib.data.total),
    works: live.size,
    planned: stages.data.filter((s) => live.has(s.workId) && Number(s.tasks) > 0).length,
  };
}

/** De kaart Aan de slag bovenaan het Overzicht: zes stappen, klaar als de app het ziet of als je het markeerde; te verbergen. */
export function AanDeSlag({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const state = useStartState();
  const facts = useStartFacts(caps.manageSettings);
  const qc = useQueryClient();
  const toast = useToast();
  const { actor } = useBackend();
  const hide = useMutation({
    mutationFn: async (hidden: boolean) => unwrap(await actor!.setStartHidden(hidden)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["startState"] }),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (!caps.manageSettings || !state.data || !facts) return null;
  const steps = startSteps(facts, state.data.marked);
  if (state.data.hidden) {
    return startDoneCount(steps) < steps.length ? (
      <p className="bw-muted a-note-small" data-testid="start-verborgen">{S.hiddenNote} <button type="button" className="wb-link" onClick={() => hide.mutate(false)}>{S.show}</button></p>
    ) : null;
  }
  if (!startVisible(steps, false)) return null;
  const n = startDoneCount(steps);
  return (
    <section className="a-start" data-testid="aan-de-slag" aria-label={S.title}>
      <div className="a-start__h">
        <h2 className="bw-h2">{S.title}</h2>
        <span className="bw-mono bw-muted" data-testid="start-teller">{S.of(n, steps.length)}</span>
        <span className="a-start__prog" aria-hidden>{steps.map((x) => <i key={x.key} className={x.done ? "on" : ""} />)}</span>
        <Button variant="quiet" onClick={() => hide.mutate(true)} busy={hide.isPending}>{S.hide}</Button>
      </div>
      <ul className="a-start__list">
        {steps.map((x) => (
          <li key={x.key}>
            <button type="button" className={`a-sstep${x.done ? " a-sstep--ok" : ""}`} data-step={x.key} data-done={x.done ? "1" : "0"} onClick={() => go(startRoute(x.key))}>
              <span className="a-sstep__n">{x.done ? <Icon name="check" size={14} /> : x.n}</span>
              <span className="a-sstep__t"><b>{S.steps[x.key].t}</b><span>{S.steps[x.key].d}{x.done && x.how ? ` · ${x.how === "app" ? S.byApp : S.byHand}` : ""}</span></span>
              <Icon name="next" size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** De blauwe uitlegbalk op het scherm van een stap ("Aan de slag · stap 3 van 6"). */
export function StartBanner({ n, caps, go }: { n: number; caps: Caps; go: (to: string) => void }) {
  const state = useStartState();
  const facts = useStartFacts(caps.manageSettings);
  const qc = useQueryClient();
  const toast = useToast();
  const { actor } = useBackend();
  const key: StartKey = START_KEYS[n - 1];
  const mark = useMutation({
    mutationFn: async (done: boolean) => unwrap(await actor!.setStartStep(key, done)),
    onSuccess: () => { toast.show({ kind: "ok", text: S.saved }); void qc.invalidateQueries({ queryKey: ["startState"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (!caps.manageSettings) return null;
  const step = facts && state.data ? startSteps(facts, state.data.marked).find((x) => x.key === key) : undefined;
  const next = n < 6 ? START_KEYS[n] : undefined;
  return (
    <div className="a-guide" role="status" data-testid="start-balk">
      <div className="a-guide__t">
        <span className="bw-label">{S.step(n)}</span>
        <b>{S.steps[key].t}</b>
        <span>{S.steps[key].how}</span>
        {step?.done && <span className="a-guide__ok"><Icon name="check" size={14} /> {S.done}{step.how === "app" ? ` · ${S.byApp}` : ` · ${S.byHand}`}</span>}
      </div>
      <div className="a-row">
        {step?.how === "hand" ? <Button onClick={() => mark.mutate(false)} busy={mark.isPending}>{S.markUndone}</Button> : !step?.done && <Button variant="primary" icon="check" onClick={() => mark.mutate(true)} busy={mark.isPending}>{S.markDone}</Button>}
        {step?.done && next && <Button variant="primary" onClick={() => go(startRoute(next))}>{S.steps[next].t}</Button>}
        <Button onClick={() => go("overzicht")}>{S.back}</Button>
      </div>
    </div>
  );
}

/** "Zo werkt het voor jou": één zin per rol en Begrepen; per persoon één keer (bewaard bij de persoon, niet in het toestel). */
export function IntroCard({ kind }: { kind: IntroKind }) {
  const qc = useQueryClient();
  const { actor } = useBackend();
  const seen = useMutation({
    mutationFn: async () => actor!.markIntroSeen(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["startState"] }),
  });
  return (
    <div className="a-intro" role="note" data-testid="zo-werkt-het" data-kind={kind}>
      <Icon name="info" size={20} />
      <p><b>{t.intro.title}.</b> {t.intro.text[kind]}</p>
      <Button onClick={() => seen.mutate()} busy={seen.isPending}>{t.intro.understood}</Button>
    </div>
  );
}
