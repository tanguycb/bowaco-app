// 4b.7 Assistenten als collega (bouwplan §9 fase 4b, optiedocument richting B punt 4).
// - Een assistent heet naar zijn taak ("Factuurcontrole (assistent)") met een vierkant icoon; de score van de proefbank staat bij de naam.
// - Een taak geven aan een collega (gewone taak in het model van 4b.5, zichtbaar in Te doen van die persoon) of aan een assistent
//   (vanaf de plek waar je werkt: de bestaande opdrachten van 3.8–3.11 blijven zoals ze waren, het dossier met zijn rechten ook).
// - De stand van een taak: wacht · bezig · voorstel klaar · mislukt (· klaar · geannuleerd).
// Rechten beslist de backend (Rights.taskSight, listAssistants enkel interne rollen); externen krijgen deze schermen niet.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { TaskStep, type AssistantCard } from "../backend";
import { Button, Choice, Confirm, Sheet, Tag, useToast, type TagTone } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtTime, inputToDay, unwrap, useBackend } from "../util";
import * as V from "../app/voorstel";
import { Loading, Page } from "./common";
import { Field } from "./Werven";
import { Tijdlijn, VoorstelVenster, useTaken } from "./Voorstel";
import "../app/voorstel.css";

const A = t.assistenten;
const N = Number;

const STAND_TOON: Record<string, TagTone> = { wacht: "neutral", bezig: "accent", voorstel: "warn", klaar: "ok", mislukt: "bad", geannuleerd: "neutral" };

/** De stand van een taak in één woord: wacht · bezig · voorstel klaar · mislukt. */
export function StandTag({ stand }: { stand: string }) {
  return <Tag tone={STAND_TOON[stand] ?? "neutral"}>{A.stand[stand] ?? stand}</Tag>;
}

/** De assistenten met hun score (interne rollen). Eén query, elke minuut opnieuw. */
export function useAssistenten() {
  const { actor, isFetching } = useBackend();
  return useQuery({ queryKey: ["assistenten"], queryFn: () => actor!.listAssistants(), enabled: !!actor && !isFetching, retry: 0, staleTime: 30_000, refetchInterval: 60_000 });
}

export function scoreTekst(a: Pick<AssistantCard, "score" | "cases">): string {
  return a.score === undefined ? A.scoreGeen : A.score(N(a.score), N(a.cases));
}

/** De naam van een assistent met zijn vierkante icoon en de score erbij ("96 % juist op 60 gevallen"). */
export function AssistentMetScore({ a, kort }: { a: AssistantCard; kort?: boolean }) {
  return (
    <span className="as-naam" data-testid="as-naam" data-kind={a.kind}>
      <span className="a-todo__sq" aria-hidden="true" />
      <b>{a.name}</b>
      <span className={`as-score${a.passed ? " as-score--ok" : ""}`} data-testid="as-score">{kort && a.score !== undefined ? `${N(a.score)} %` : scoreTekst(a)}</span>
    </span>
  );
}

/** Waar je een assistent zijn taak geeft (dezelfde routes als stukRoute in Voorstel.tsx). */
function plek(kind: string, werf: string): string | null {
  switch (kind) {
    case "oa-offerte-inlezen": return werf ? `werven/${werf}/offerte/oa-offertes` : null;
    case "offertes-vergelijken": return werf ? `werven/${werf}/offerte/prijsvragen` : null;
    case "offerte-nalezen": return werf ? `werven/${werf}/offerte` : null;
    case "factuurcontrole": return werf ? `werven/${werf}/facturatie` : "oa-facturen";
    default: return null;
  }
}

/** Een taak geven, vanaf de plek waar je werkt (`werf` = die werf al gekozen). */
export function TaakGeven({ werf, kind, onClose, go }: { werf?: bigint; kind?: string; onClose: () => void; go?: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const [soort, setSoort] = useState<"mens" | "assistent">(kind ? "assistent" : "mens");
  const [werfKeuze, setWerfKeuze] = useState(werf !== undefined ? String(werf) : "");
  const [wie, setWie] = useState("");
  const [tekst, setTekst] = useState("");
  const [dag, setDag] = useState("");
  const [welke, setWelke] = useState(kind ?? "");
  const works = useQuery({ queryKey: ["works"], queryFn: () => actor!.listWorks(), enabled: on });
  const cols = useQuery({ queryKey: ["collegas", werfKeuze], queryFn: () => actor!.listColleagues(werfKeuze ? BigInt(werfKeuze) : null), enabled: on && soort === "mens", retry: 0 });
  const ass = useAssistenten();
  const geef = useMutation({
    mutationFn: async () => unwrap(await actor!.giveTask({ doerId: BigInt(wie), workId: werfKeuze ? BigInt(werfKeuze) : undefined, title: tekst.trim(), dueDay: dag ? inputToDay(dag) : undefined })),
    onSuccess: () => { toast.show({ kind: "ok", text: A.gegeven }); for (const k of ["taken", "todo"]) void qc.invalidateQueries({ queryKey: [k] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const route = plek(welke, werfKeuze);
  return (
    <Sheet title={A.geefTitel} open side onClose={onClose} footer={soort === "mens"
      ? <><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={geef.isPending} disabled={!wie || tekst.trim().length < 3} onClick={() => geef.mutate()} data-testid="geef-ok">{A.geven}</Button></>
      : <><Button onClick={onClose}>{t.common.close}</Button>{go && route && <Button variant="primary" onClick={() => { onClose(); go(route); }} data-testid="geef-plek">{A.naarPlek}</Button>}</>}>
      <p className="bw-muted">{A.geefLead}</p>
      <Field label={A.wie}>
        <Choice label={A.wie} value={soort} onChange={setSoort} options={[{ value: "mens", label: A.collegas }, { value: "assistent", label: A.assistenten }]} />
      </Field>
      <Field label={A.werf}>
        <select className="bw-input" value={werfKeuze} onChange={(e) => { setWerfKeuze(e.target.value); setWie(""); }} data-testid="geef-werf">
          <option value="">{A.geenWerf}</option>
          {(works.data ?? []).map((w) => <option key={String(w.id)} value={String(w.id)}>{w.code}</option>)}
        </select>
      </Field>
      {soort === "mens" && (
        <>
          <Field label={A.collegas}>
            <select className="bw-input" value={wie} onChange={(e) => setWie(e.target.value)} data-testid="geef-wie">
              <option value="">{A.kiesCollega}</option>
              {(cols.data ?? []).map((c) => <option key={String(c.id)} value={String(c.id)}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={A.omschrijving}>
            <textarea className="bw-input" rows={3} maxLength={160} value={tekst} placeholder={A.omschrijvingHint} onChange={(e) => setTekst(e.target.value)} data-testid="geef-tekst" />
          </Field>
          <Field label={A.uiterlijk}>
            <input type="date" className="bw-input" value={dag} min={dayToInput(BigInt(Math.floor(Date.now() / 86_400_000)))} onChange={(e) => setDag(e.target.value)} data-testid="geef-dag" />
          </Field>
        </>
      )}
      {soort === "assistent" && (
        <ul className="a-list" data-testid="geef-assistenten">
          {(ass.data ?? []).map((a) => (
            <li key={a.kind}>
              <button type="button" className="a-list__btn" aria-pressed={welke === a.kind} onClick={() => setWelke(a.kind)} data-kind={a.kind}>
                <span className="a-list__main"><AssistentMetScore a={a} /><span className="bw-muted">{A.plekUitleg[a.kind] ?? ""}</span></span>
                {welke === a.kind && <Tag tone="accent">✓</Tag>}
              </button>
            </li>
          ))}
          {["oa-offerte-inlezen", "offertes-vergelijken", "offerte-nalezen"].includes(welke) && !werfKeuze && <li className="bw-muted a-note-small">{A.kiesWerfVoorPlek}</li>}
        </ul>
      )}
    </Sheet>
  );
}

/** Eén gewone taak: wie, wat, de stand, de knoppen van de uitvoerder, annuleren door de gever, de tijdlijn. */
export function TaakVenster({ taskKey, onClose }: { taskKey: string; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useTaken({ key: taskKey });
  const me = useQuery({ queryKey: ["meSelf"], queryFn: () => actor!.me(), enabled: !!actor && !isFetching });
  const [vraag, setVraag] = useState<"kan-niet" | "annuleer" | null>(null);
  const [reden, setReden] = useState("");
  const g = q.data?.items[0];
  const ik = me.data?.person ? `persoon:${String(me.data.person.id)}` : "";
  const stap = useMutation({
    mutationFn: async (s: TaskStep) => unwrap(await actor!.stepTask(g!.task.id, s, reden.trim())),
    onSuccess: () => { toast.show({ kind: "ok", text: A.gedaan }); setVraag(null); setReden(""); for (const k of ["taken", "todo"]) void qc.invalidateQueries({ queryKey: [k] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const k = g?.task;
  const open = k && (k.state === "wacht" || k.state === "bezig");
  const uitvoerder = !!k && k.doer === ik;
  const gever = !!k && k.givenBy === ik;
  return (
    <Sheet title={A.taakTitel} open side onClose={onClose} footer={<Button onClick={onClose}>{t.common.close}</Button>}>
      {q.data && !g && <p className="a-empty">{t.voorstel.geen}</p>}
      {k && (
        <div className="a-stack" data-testid="taak-venster" data-key={k.key}>
          <div className="a-row"><StandTag stand={k.state} />{k.workCode && <Tag code>{k.workCode}</Tag>}</div>
          {g.full ? <h2 className="bw-h2" data-testid="taak-titel">{k.title}</h2> : <p className="bw-muted" data-testid="taak-kort">{A.kort}</p>}
          <p className="bw-muted">{A.gaf(k.givenByName)} · {A.voor(k.doerName)}{k.dueDay !== undefined ? ` · ${A.uiterlijkOp(fmtDayNum(k.dueDay))}` : ""}</p>
          {k.reason && <p><b>{A.reden}:</b> {k.reason}</p>}
          {g.full && open && (
            <div className="a-row">
              {uitvoerder && k.state === "wacht" && <Button variant="secondary" busy={stap.isPending && stap.variables === TaskStep.start} onClick={() => stap.mutate(TaskStep.start)} data-act="taak-start">{A.begin}</Button>}
              {uitvoerder && <Button variant="primary" busy={stap.isPending && stap.variables === TaskStep.done} onClick={() => stap.mutate(TaskStep.done)} data-act="taak-klaar">{A.klaar}</Button>}
              {uitvoerder && <Button variant="quiet" onClick={() => setVraag("kan-niet")} data-act="taak-kan-niet">{A.kanNiet}</Button>}
              {(gever || !uitvoerder) && <Button variant="quiet" onClick={() => setVraag("annuleer")} data-act="taak-annuleer">{A.annuleer}</Button>}
            </div>
          )}
          <Tijdlijn regels={V.wieDeedWat([g])} kort max={20} />
        </div>
      )}
      {vraag === "annuleer" && <Confirm open title={A.annuleer} text={A.annuleerTekst} confirmLabel={A.annuleer} cancelLabel={t.common.cancel} busy={stap.isPending} onConfirm={() => stap.mutate(TaskStep.cancel)} onClose={() => setVraag(null)} />}
      {vraag === "kan-niet" && <KanNietSheet busy={stap.isPending} reden={reden} setReden={setReden} onOk={() => stap.mutate(TaskStep.cannot)} onClose={() => setVraag(null)} />}
    </Sheet>
  );
}

/** Waarom kan het niet? (geen browservenster). */
export function KanNietSheet({ busy, reden, setReden, onOk, onClose }: { busy: boolean; reden: string; setReden: (s: string) => void; onOk: () => void; onClose: () => void }) {
  return (
    <Sheet title={A.kanNietTitel} open onClose={onClose} footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={reden.trim().length < 3} onClick={onOk} data-testid="kan-niet-ok">{A.kanNietOk}</Button></>}>
      <Field label={A.reden}><input className="bw-input" value={reden} maxLength={200} onChange={(e) => setReden(e.target.value)} data-testid="kan-niet-reden" /></Field>
    </Sheet>
  );
}

/** Een regel met een taak (gewone taak of van een assistent): naam, stand en wie. Een tik opent haar venster. */
function TaakRij({ g, onOpen }: { g: V.Gezien; onOpen: (g: V.Gezien) => void }) {
  const k = g.task;
  const assistent = k.kind !== "taak";
  const titel = assistent ? `${k.name}${g.subjectLabel ? ` · ${g.subjectLabel}` : ""}` : g.full ? k.title : A.kind.taak;
  return (
    <li data-testid="taak-rij" data-kind={k.kind} data-state={k.state}>
      <button type="button" className="a-list__btn" onClick={() => onOpen(g)}>
        <span className="a-list__main">
          <b>{assistent && <span className="a-todo__sq" aria-hidden="true" />}{k.workCode ? `${k.workCode} · ` : ""}{titel}</b>
          <span className="bw-muted">{assistent ? A.gaf(k.givenByName) : `${A.gaf(k.givenByName)} · ${A.voor(k.doerName)}`} · {fmtTime(k.updatedAt)}</span>
        </span>
        <StandTag stand={k.state} />
      </button>
    </li>
  );
}

/** De open taken (alle die jij ziet) met hun stand, en de vensters erbij. `werf` = enkel die werf. */
export function TakenLijst({ werf, go, leeg = true }: { werf?: bigint; go: (to: string) => void; leeg?: boolean }) {
  const q = useTaken({ workId: werf, openOnly: true });
  const [open, setOpen] = useState<V.Gezien | null>(null);
  const xs = q.data?.items ?? [];
  if (q.isError) return null;
  return (
    <>
      {q.data && xs.length === 0 && leeg && <p className="bw-muted" data-testid="taken-leeg">{werf !== undefined ? A.geenTaken : A.geenOpen}</p>}
      {xs.length > 0 && <ul className="a-list" data-testid="taken-lijst">{xs.map((g) => <TaakRij key={g.task.key} g={g} onOpen={setOpen} />)}</ul>}
      {open && (open.task.kind === "taak"
        ? <TaakVenster taskKey={open.task.key} onClose={() => setOpen(null)} />
        : <VoorstelVenster taskKey={open.task.key} go={go} onClose={() => setOpen(null)} />)}
    </>
  );
}

/** Op de werf (Overzicht): de open taken van deze werf en de knop om een taak te geven. */
export function TakenBlok({ werf, go }: { werf: bigint; go: (to: string) => void }) {
  const [geef, setGeef] = useState(false);
  return (
    <section className="a-section" data-testid="taken-blok">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{A.takenWerf}</h2>
        <Button variant="secondary" onClick={() => setGeef(true)} data-testid="taak-geven">{A.geef}</Button>
      </div>
      <TakenLijst werf={werf} go={go} />
      {geef && <TaakGeven werf={werf} onClose={() => setGeef(false)} go={go} />}
    </section>
  );
}

/** Het scherm Assistenten (#/assistenten): de assistenten met naam, icoon, score en stand, en de open taken. */
export function AssistentenPage({ go, beheer }: { go: (to: string) => void; beheer: boolean }) {
  const q = useAssistenten();
  const [geef, setGeef] = useState<string | null>(null);
  return (
    <Page title={A.title} actions={<Button variant="secondary" onClick={() => setGeef("")} data-testid="taak-geven">{A.geef}</Button>}>
      <p className="bw-muted">{A.lead}</p>
      <Loading q={q} />
      <ul className="a-list as-lijst" data-testid="assistenten">
        {(q.data ?? []).map((a) => (
          <li key={a.kind} data-kind={a.kind}>
            <span className="a-list__main">
              <AssistentMetScore a={a} />
              <span className="bw-muted">{[a.open > 0n ? A.open(N(a.open)) : "", a.failed > 0n ? A.mislukt(N(a.failed)) : "", a.score !== undefined ? (a.passed ? A.gehaald : A.nietGehaald) : ""].filter(Boolean).join(" · ") || A.geenOpen}</span>
            </span>
            {a.kind !== "document-koppelen" && <Button variant="quiet" size="sm" onClick={() => setGeef(a.kind)} data-testid="assistent-geef">{A.geef}</Button>}
          </li>
        ))}
      </ul>
      <p className="bw-muted a-note-small">{A.scoreUitleg(95, 50)}</p>
      <section className="a-section">
        <h2 className="bw-h2">{A.taken}</h2>
        <TakenLijst go={go} />
      </section>
      {beheer && <p className="bw-muted a-note-small">{A.beheerLink}</p>}
      {geef !== null && <TaakGeven kind={geef || undefined} onClose={() => setGeef(null)} go={go} />}
    </Page>
  );
}

/** Beheer → Assistenten: het overzicht met de score bij de naam; de fiche en de koppeling staan op het volgende tabblad. */
export function AssistentenOverzicht({ onTab }: { onTab: (k: "bots" | "proof") => void }) {
  const q = useAssistenten();
  return (
    <section className="a-section" data-testid="assistenten-overzicht">
      <p className="bw-muted">{t.proof.overzichtLead}</p>
      <Loading q={q} />
      <ul className="a-list as-lijst">
        {(q.data ?? []).map((a) => (
          <li key={a.kind} data-kind={a.kind}>
            <span className="a-list__main">
              <AssistentMetScore a={a} />
              <span className="bw-muted">{[a.open > 0n ? A.open(N(a.open)) : "", a.failed > 0n ? A.mislukt(N(a.failed)) : "", a.score !== undefined ? (a.passed ? A.gehaald : A.nietGehaald) : ""].filter(Boolean).join(" · ") || A.geenOpen}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="bw-muted a-note-small">{A.scoreUitleg(95, 50)}</p>
      <div className="a-row">
        <Button variant="secondary" onClick={() => onTab("bots")}>{t.proof.naarFiches}</Button>
        <Button variant="quiet" onClick={() => onTab("proof")}>{A.naarProef}</Button>
      </div>
    </section>
  );
}
