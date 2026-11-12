// Te doen (stap 4b.1, bouwplan §9 fase 4b): één lijst per persoon, het dringendste eerst, met de handeling als knop bij elke regel en
// "Uitstellen tot". Eén query (myTodo); de rechten per regel beslist de backend (lib/Todo.mo), de browser toont enkel wat hij krijgt.
// De bel en "Vraagt aandacht" gaan erin op: de teller in de kop opent deze lijst, de startschermen tonen er de eerste regels van.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Principal } from "@icp-sdk/core/principal";
import { useState } from "react";
import { TaskStep, type TodoAct, type TodoItem, type TodoPage as TodoPageView } from "../backend";
import { Button, Icon, Sheet, useToast, Werklijst } from "../design";
import { useBreed, WERKLIJST_VANAF } from "../design/Werklijst";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, inputToDay, todayDay, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { NotesSheet, noteTarget } from "./Meldingen";
import { TodoVoorstel } from "./Voorstel";
import { KanNietSheet, TaakGeven } from "./Assistenten";

const T = t.todo;
const N = Number;
const PAGE = 50;

type Q = { snoozed: boolean; kind: string; offset: number };
/** De gewone eerste pagina: de teller in de kop, het blok op het startscherm en de pagina delen deze ene query (review L10). */
const FIRST: Q = { snoozed: false, kind: "", offset: 0 };

/** De lijst van de ingelogde persoon, per pagina van 50. Elke 30 s een lichte navraag (geen push op Caffeine; queries zijn gratis). */
export function useTodo(q: Q) {
  const { actor, isFetching } = useBackend();
  const day = todayDay();
  return useQuery<TodoPageView>({
    queryKey: ["todo", String(day), q.snoozed, q.kind, q.offset],
    queryFn: () => actor!.myTodo({ day, offset: BigInt(q.offset), limit: BigInt(PAGE), snoozed: q.snoozed, kind: q.kind }),
    enabled: !!actor && !isFetching,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 0,
  });
}

/** De handelingen van een regel: meteen uitvoeren (gelezen, bevestigen, aanvaarden) of naar de plek gaan. */
function useActs(go: (to: string) => void, home: string) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  // 4b.7: "Kan niet" bij een taak van een collega vraagt eerst een reden (geen browservenster).
  const [kanNiet, setKanNiet] = useState<TodoAct | null>(null);
  const [reden, setReden] = useState("");
  const run = useMutation({
    mutationFn: async ({ a }: { a: TodoAct; key: string }) => {
      switch (a.kind) {
        case "taak-start": unwrap(await actor!.stepTask(a.refs[0], TaskStep.start, "")); return t.assistenten.gedaan;
        case "taak-klaar": unwrap(await actor!.stepTask(a.refs[0], TaskStep.done, "")); return t.assistenten.gedaan;
        case "taak-kan-niet": unwrap(await actor!.stepTask(a.refs[0], TaskStep.cannot, reden.trim())); return t.assistenten.gedaan;
        case "gelezen": await actor!.markNotificationsRead(a.refs); return T.done;
        case "koppeling-bevestigen": unwrap(await actor!.confirmLink(Principal.fromText(a.refText))); return t.common.saved;
        case "bot-aanvaarden": unwrap(await actor!.decideBotAction(a.refs[0], true, "")); return t.common.saved;
        case "bot-weigeren": unwrap(await actor!.decideBotAction(a.refs[0], false, "")); return t.common.saved;
        case "taak-bevestigen": unwrap(await actor!.confirmAssignment(a.refs[0], true, "")); return t.common.saved;
        default: return "";
      }
    },
    onSuccess: (text) => {
      setKanNiet(null);
      setReden("");
      if (text) toast.show({ kind: "ok", text });
      void qc.invalidateQueries({ queryKey: ["taken"] });
      void qc.invalidateQueries({ queryKey: ["todo"] });
      void qc.invalidateQueries({ queryKey: ["notes"] });
      void qc.invalidateQueries({ queryKey: ["notesAll"] });
    },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  /** Waar een regel heen gaat: een melding volgt de regels van de vroegere bel. */
  const where = (x: TodoItem): string | null => (x.kind === "melding" ? noteTarget({ kind: x.sub, workId: x.workId }, home) : x.to || null);
  const fire = (x: TodoItem, a: TodoAct) => {
    if (a.kind === "taak-kan-niet") { setKanNiet(a); return; }
    if (a.kind === "open" || !["gelezen", "koppeling-bevestigen", "bot-aanvaarden", "bot-weigeren", "taak-bevestigen", "taak-start", "taak-klaar"].includes(a.kind)) {
      const to = a.to || where(x);
      if (to) go(to);
      return;
    }
    run.mutate({ a, key: x.key });
  };
  const busy = (x: TodoItem, a: TodoAct) => run.isPending && run.variables?.key === x.key && run.variables?.a === a;
  /** Een tik op de regel zelf: naar de plek (een melding telt dan als gelezen). */
  const openRow = (x: TodoItem) => {
    const to = where(x);
    if (x.kind === "melding") { const g = x.acts.find((a) => a.kind === "gelezen"); if (g) run.mutate({ a: g, key: x.key }); }
    if (to) go(to);
  };
  const dialoog = kanNiet ? <KanNietSheet busy={run.isPending} reden={reden} setReden={setReden} onOk={() => run.mutate({ a: kanNiet, key: "" })} onClose={() => setKanNiet(null)} /> : null;
  return { fire, busy, openRow, where, dialoog };
}

/** De volgende maandag na vandaag. */
function nextMonday(today: bigint): bigint {
  const wd = (N(today) + 3) % 7; // 0 = maandag (zoals Plan.weekday)
  return today + BigInt(7 - wd);
}

/** Uitstellen tot: snelle keuzes en een eigen dag (geen venster van de browser, R: geen window.confirm). */
function SnoozeSheet({ item, onClose }: { item: TodoItem; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayDay();
  const [own, setOwn] = useState(dayToInput(today + 2n));
  const save = useMutation({
    mutationFn: async (until: bigint) => unwrap(await actor!.snoozeTodo(item.key, until)),
    onSuccess: () => { toast.show({ kind: "ok", text: T.snoozed }); void qc.invalidateQueries({ queryKey: ["todo"] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const choices: [string, bigint][] = [[T.snoozeTomorrow, today + 1n], [T.snoozeMonday, nextMonday(today)], [T.snoozeWeek, today + 7n], [T.snoozeMonth, today + 30n]];
  const ownDay = inputToDay(own);
  return (
    <Sheet title={T.snoozeTitle} open onClose={onClose} footer={<Button onClick={onClose}>{t.common.close}</Button>}>
      <p className="bw-muted a-note-small">{T.snoozeLead}</p>
      <p><b>{item.workCode ? `${item.workCode} · ` : ""}{item.title}</b></p>
      <div className="a-row" data-testid="todo-snooze-choices">
        {choices.map(([label, d]) => (
          <Button key={label} busy={save.isPending && save.variables === d} onClick={() => save.mutate(d)}>{label} · {fmtDayNum(d)}</Button>
        ))}
      </div>
      <label className="bw-field">
        <span className="bw-label">{T.snoozeDate}</span>
        <input type="date" className="bw-input" value={own} min={dayToInput(today + 1n)} onChange={(e) => setOwn(e.target.value)} />
      </label>
      <Button variant="primary" disabled={!ownDay || ownDay <= today} busy={save.isPending && save.variables === ownDay} onClick={() => ownDay && save.mutate(ownDay)}>{T.snoozeOk}</Button>
    </Sheet>
  );
}

/** Eén regel: titel en detail (tik = naar de plek), de knoppen, Uitstellen of Terugzetten. */
function Row({ x, acts, onSnooze }: { x: TodoItem; acts: ReturnType<typeof useActs>; onSnooze: (x: TodoItem) => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const back = useMutation({
    mutationFn: async () => unwrap(await actor!.snoozeTodo(x.key, null)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["todo"] }),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const to = acts.where(x);
  const meta = [x.kind === "taak" && x.sub === "bezig" ? t.assistenten.stand.bezig : "", x.detail, x.age > 0 && x.kind !== "melding" ? T.age(N(x.age)) : "", x.snoozedUntil !== undefined ? T.snoozedUntil(fmtDayNum(x.snoozedUntil)) : ""].filter(Boolean).join(" · ");
  return (
    <li className="a-todo" data-kind={x.kind} data-key={x.key} data-urgency={N(x.urgency)}>
      <button type="button" className="a-list__btn a-todo__main" disabled={!to} onClick={() => acts.openRow(x)}>
        <span className="a-list__main">
          <b>{x.workCode ? `${x.workCode} · ` : ""}{x.title}</b>
          {meta && <span className="bw-muted">{meta}</span>}
          {x.by && <span className="a-todo__by" data-testid="todo-by"><span className="a-todo__sq" aria-hidden="true" />{x.by}</span>}
        </span>
      </button>
      <span className="a-todo__acts">
        {x.acts.map((a, i) => (
          <Button key={`${a.kind}${i}`} variant={i === 0 ? "secondary" : "quiet"} size="sm" busy={acts.busy(x, a)} onClick={() => acts.fire(x, a)} data-act={a.kind}>{a.text}</Button>
        ))}
        {x.snoozedUntil !== undefined
          ? <Button variant="quiet" size="sm" busy={back.isPending} onClick={() => back.mutate()} data-act="terugzetten">{T.unsnooze}</Button>
          : <Button variant="quiet" size="sm" icon="clock" onClick={() => onSnooze(x)} data-act="uitstellen">{T.snooze}</Button>}
      </span>
    </li>
  );
}

/** De regels gegroepeerd per dringendheid (Nu · Vandaag · Deze week · Later). */
function Groups({ items, acts, onSnooze }: { items: TodoItem[]; acts: ReturnType<typeof useActs>; onSnooze: (x: TodoItem) => void }) {
  return (
    <>
      {[0, 1, 2, 3].map((u) => {
        const xs = items.filter((x) => N(x.urgency) === u);
        if (xs.length === 0) return null;
        return (
          <div key={u} className="a-attn" data-urgency={u}>
            <span className="bw-label a-attn__h">{u === 0 && <Icon name="alert" size={14} />} {T.urgency[u]} · {xs.length}</span>
            <ul className="a-list a-todo-list">{xs.map((x) => <Row key={x.key} x={x} acts={acts} onSnooze={onSnooze} />)}</ul>
          </div>
        );
      })}
    </>
  );
}

/** 4b.4: de gekozen regel in de Werklijst: titel, detail en alle knoppen groot genoeg om er op te mikken. */
function TodoKaart({ x, acts, onSnooze, onGone, go }: { x?: TodoItem; acts: ReturnType<typeof useActs>; onSnooze: (x: TodoItem) => void; onGone: () => void; go: (to: string) => void }) {
  if (!x) return <div className="a-page--paneel"><p className="a-empty" data-testid="todo-kaart-weg">{T.nothing}</p><Button onClick={onGone}>{T.back}</Button></div>;
  const to = acts.where(x);
  const meta = [x.kind === "taak" && x.sub === "bezig" ? t.assistenten.stand.bezig : "", x.detail, x.age > 0 && x.kind !== "melding" ? T.age(N(x.age)) : "", x.snoozedUntil !== undefined ? T.snoozedUntil(fmtDayNum(x.snoozedUntil)) : ""].filter(Boolean).join(" · ");
  return (
    <div className="a-page--paneel a-stack" data-testid="todo-kaart" data-key={x.key}>
      <span className="bw-label">{T.urgency[N(x.urgency)]} · {T.kinds[x.kind] ?? x.kind}</span>
      <h2 className="bw-h2">{x.workCode ? `${x.workCode} · ` : ""}{x.title}</h2>
      {meta && <p className="bw-muted">{meta}</p>}
      {x.by && <span className="a-todo__by"><span className="a-todo__sq" aria-hidden="true" />{x.by}</span>}
      <div className="a-row">
        {x.acts.map((a, i) => (
          <Button key={`${a.kind}${i}`} variant={i === 0 ? "primary" : "secondary"} busy={acts.busy(x, a)} onClick={() => acts.fire(x, a)} data-act={a.kind}>{a.text}</Button>
        ))}
        {to && !x.acts.some((a) => a.kind === "open") && <Button variant="secondary" icon="next" onClick={() => acts.openRow(x)}>{t.offertes.open}</Button>}
        {x.snoozedUntil === undefined && <Button variant="quiet" icon="clock" onClick={() => onSnooze(x)} data-act="uitstellen">{T.snooze}</Button>}
      </div>
      {/* 4b.6: het voorstel zelf (nu → na, bron, beslissen, wie deed wat), met de rechten van het bronscherm. */}
      {x.kind === "voorstel" && <TodoVoorstel todoKey={x.key} go={go} />}
    </div>
  );
}

/** De pagina Te doen (#/te-doen): filter per soort, het uitgestelde apart, alle meldingen (ook gelezen) achter een knop. */
export function TodoPage({ go, home, selected, intern }: { go: (to: string) => void; home: string; selected?: string; intern?: boolean }) {
  const breed = useBreed(WERKLIJST_VANAF);
  const [snoozed, setSnoozed] = useState(false);
  const [kind, setKind] = useState("");
  const [offset, setOffset] = useState(0);
  const [snooze, setSnooze] = useState<TodoItem | null>(null);
  const [notes, setNotes] = useState(false);
  const [geef, setGeef] = useState(false);
  const q = useTodo({ snoozed, kind, offset });
  const all = useTodo(FIRST); // de tellers per soort over de hele lijst (dezelfde query als de teller in de kop)
  const acts = useActs(go, home);
  const d = q.data;
  const kinds = (all.data?.kinds ?? []).slice().sort((a, b) => N(b[1]) - N(a[1]));
  const pick = (k: string) => { setKind(k); setSnoozed(false); setOffset(0); };
  const total = N(d?.total ?? 0n);
  return (
    <Page title={T.title} actions={<><Button variant="quiet" icon="bell" onClick={() => setNotes(true)}>{T.notesAll}</Button>{intern && <Button variant="secondary" onClick={() => setGeef(true)} data-testid="taak-geven">{t.assistenten.geef}</Button>}</>}>
      <div className="a-row a-todo-filter" role="group" aria-label={T.title}>
        {/* 4b.3: filters zijn filterknoppen (zoals in het tabelonderdeel), geen hoofdknoppen. */}
        <button type="button" className="bw-filter" aria-pressed={!snoozed && kind === ""} onClick={() => pick("")}>{T.filterAll}<span className="bw-filter__n">{N(all.data?.total ?? 0n)}</span></button>
        {kinds.map(([k, n]) => (
          <button key={k} type="button" className="bw-filter" aria-pressed={!snoozed && kind === k} onClick={() => pick(k)} data-kind={k}>{T.kinds[k] ?? k}<span className="bw-filter__n">{N(n)}</span></button>
        ))}
        {(all.data?.snoozed ?? 0n) > 0n && <button type="button" className="bw-filter" aria-pressed={snoozed} onClick={() => { setSnoozed(true); setKind(""); setOffset(0); }} data-testid="todo-snoozed">{T.snoozedTab(N(all.data!.snoozed))}</button>}
      </div>
      <Loading q={q} />
      {d && d.items.length === 0 && <p className="a-empty" data-testid="todo-leeg">{snoozed ? T.nothingSnoozed : T.nothing}</p>}
      {/* 4b.4 Werklijst: op een breed scherm de regels links (dringendste eerst) en de gekozen regel rechts met zijn knoppen; pijltjes lopen erdoor. */}
      {d && breed && d.items.length > 0 && (
        <Werklijst items={d.items} rowKey={(x) => x.key} selected={selected} label={T.title} testid="todo-werklijst" onSelect={(k) => go(`te-doen/${encodeURIComponent(k)}`)}
          detail={selected ? <TodoKaart x={d.items.find((x) => x.key === selected)} acts={acts} onSnooze={setSnooze} onGone={() => go("te-doen")} go={go} /> : undefined}
          row={(x) => (
            <span className="a-list__main" data-urgency={N(x.urgency)} data-kind={x.kind}>
              <b>{x.workCode ? `${x.workCode} · ` : ""}{x.title}</b>
              <span className="bw-muted">{T.urgency[N(x.urgency)]}{x.detail ? ` · ${x.detail}` : ""}{x.by ? ` · ${x.by}` : ""}</span>
            </span>
          )} />
      )}
      {d && !breed && <Groups items={d.items} acts={acts} onSnooze={setSnooze} />}
      {d && total > PAGE && (
        <div className="a-row" data-testid="todo-pages">
          <Button variant="quiet" icon="back" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>{T.prev}</Button>
          <span className="bw-muted bw-num">{T.range(offset + 1, Math.min(offset + PAGE, total), total)}</span>
          <Button variant="quiet" icon="next" disabled={offset + PAGE >= total} onClick={() => setOffset((o) => o + PAGE)}>{T.next}</Button>
        </div>
      )}
      {d?.capped && <p className="bw-muted a-note-small">{T.capped}</p>}
      {snoozed && <Button variant="quiet" icon="back" onClick={() => { setSnoozed(false); setOffset(0); }}>{T.back}</Button>}
      {snooze && <SnoozeSheet item={snooze} onClose={() => setSnooze(null)} />}
      {acts.dialoog}
      {geef && <TaakGeven onClose={() => setGeef(false)} go={go} />}
      {notes && <NotesSheet go={go} home={home} onClose={() => setNotes(false)} />}
    </Page>
  );
}

/** Het blok bovenaan een startscherm: de eerste regels en "Alles bekijken". */
export function TodoBlock({ go, home, hideEmpty, max = 6, zonder = [] }: { go: (to: string) => void; home: string; hideEmpty?: boolean; max?: number; zonder?: string[] }) {
  const q = useTodo(FIRST);
  const acts = useActs(go, home);
  const [snooze, setSnooze] = useState<TodoItem | null>(null);
  const d = q.data;
  const verborgen = d ? d.items.filter((x) => x.acts.some((a) => zonder.includes(a.kind))).length : 0;
  const total = N(d?.total ?? 0n) - verborgen;
  if (hideEmpty && d && total <= 0) return null;
  return (
    <section className="a-section" data-testid="te-doen">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{T.title}{total > 0 && <span className="bw-muted bw-num">&nbsp;({total})</span>}</h2>
        {total > 0 && <Button variant="quiet" onClick={() => go("te-doen")}>{T.all(total)}</Button>}
      </div>
      {!d && <Loading q={q} />}
      {d && total === 0 && <p className="a-empty">{T.nothing}</p>}
      {d && <Groups items={d.items.filter((x) => !x.acts.some((a) => zonder.includes(a.kind))).slice(0, max)} acts={acts} onSnooze={setSnooze} />}
      {snooze && <SnoozeSheet item={snooze} onClose={() => setSnooze(null)} />}
      {acts.dialoog}
    </section>
  );
}

/** De teller in de kop (waar de bel stond): het aantal regels, opvallend als er iets dringend is. */
export function TodoTeller({ go }: { go: (to: string) => void }) {
  const q = useTodo(FIRST);
  const n = N(q.data?.total ?? 0n);
  const urgent = N(q.data?.urgent ?? 0n) > 0;
  return (
    <button type="button" className={`bw-conn${urgent ? " a-bell--on" : ""}`} aria-label={n > 0 ? T.teller(n) : T.title} title={T.title} onClick={() => go("te-doen")} data-testid="todo-teller">
      <Icon name="list" size={16} />{n > 0 ? n : ""}
    </button>
  );
}

/** 4b.4: de regels van Te doen met een bevestiging van één tik (taak bevestigen, voorstel aanvaarden, koppeling bevestigen), groot en bovenaan
 *  op de gsm. De rest van Te doen staat eronder. Rechten per regel beslist de backend, zoals overal in Te doen. */
const EEN_TIK = ["taak-bevestigen", "bot-aanvaarden", "koppeling-bevestigen"];
export const eenTikActs = (x: TodoItem) => x.acts.filter((a) => EEN_TIK.includes(a.kind));
export function TodoEenTik({ go, home, max = 4, zonder = [] }: { go: (to: string) => void; home: string; max?: number; zonder?: string[] }) {
  const q = useTodo(FIRST);
  const acts = useActs(go, home);
  const rows = (q.data?.items ?? []).filter((x) => eenTikActs(x).some((a) => !zonder.includes(a.kind))).slice(0, max);
  if (rows.length === 0) return null;
  return (
    <section className="a-section v-tik" data-testid="een-tik-todo" aria-label={T.eenTik}>
      <h2 className="bw-h2">{T.eenTik}</h2>
      <ul className="a-list">
        {rows.map((x) => (
          <li key={x.key} className="v-tik__row" data-key={x.key}>
            <span className="a-list__main"><span className="bw-muted">{x.workCode ? `${x.workCode} · ` : ""}{x.detail || T.kinds[x.kind] || x.kind}</span><b>{x.title}</b></span>
            {eenTikActs(x).filter((a) => !zonder.includes(a.kind)).map((a, i) => <Button key={`${a.kind}${i}`} variant={i === 0 ? "primary" : "secondary"} size="lg" busy={acts.busy(x, a)} onClick={() => acts.fire(x, a)} data-act={a.kind}>{a.text}</Button>)}
          </li>
        ))}
      </ul>
    </section>
  );
}
