// 3.5: Beheer → AI-medewerkers → Proefbank (enkel de beheerder, #manageBots). Testsets uit de historiek (wat mensen al koppelden of
// goedkeurden), proefrondes voor een bot (via zijn proeftools op /mcp) of voor de Caffeine-fiche van de taak, de score en de fouten per
// geval. Een geval toont enkel een verwijzing (bv. "bestand #12"), nooit de inhoud. Geen window.confirm: bevestigen gaat via een Sheet.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ProofRoundCaseView, ProofRoundView, ProofSetView, ProofSubject, ProofValue } from "../backend";
import { Button, Choice, Sheet, Table, useToast, type Column } from "../design";
import { t } from "../texts/nl";
import { errText, fmtTime, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { Field } from "./Werven";

const P = t.proof;
const taskText = (k: string) => P.task[k] ?? t.bots.task[k] ?? k;
const vals = (xs: ProofValue[]) => xs.map((v) => v.shown || v.value || "–").join(" · ") || "–";

export function Proefbank() {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const info = useQuery({ queryKey: ["proofInfo"], queryFn: () => actor!.proofInfo(), enabled: on });
  const sets = useQuery({ queryKey: ["proofSets"], queryFn: () => actor!.listProofSets(), enabled: on });
  const rounds = useQuery({ queryKey: ["proofRounds"], queryFn: () => actor!.listProofRounds(), enabled: on, refetchInterval: 20_000 });
  const bots = useQuery({ queryKey: ["bots"], queryFn: () => actor!.listBots(), enabled: on });
  const [newSet, setNewSet] = useState(false);
  const [showSet, setShowSet] = useState<ProofSetView | null>(null);
  const [start, setStart] = useState<ProofSetView | null>(null);
  const [showRound, setShowRound] = useState<ProofRoundView | null>(null);
  const [closing, setClosing] = useState<{ r: ProofRoundView; cancel: boolean } | null>(null);
  const [progress, setProgress] = useState<string>("");
  const refresh = () => { for (const k of ["proofSets", "proofRounds", "bots"]) void qc.invalidateQueries({ queryKey: [k] }); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const archive = useMutation({ mutationFn: async (s: ProofSetView) => unwrap(await actor!.archiveProofSet(s.id)), onSuccess: refresh, onError: fail });
  const close = useMutation({
    mutationFn: async (x: { r: ProofRoundView; cancel: boolean }) => unwrap(await actor!.closeProofRound(x.r.id, x.cancel)),
    onSuccess: () => { setClosing(null); refresh(); toast.show({ kind: "ok", text: t.common.saved }); },
    onError: fail,
  });
  // Caffeine: één geval per oproep, na elkaar tot de ronde klaar is of een fout geeft.
  const run = useMutation({
    mutationFn: async (r: ProofRoundView) => {
      for (let i = 0; i < 500; i++) {
        const s = unwrap(await actor!.runProofAi(r.id));
        setProgress(`${P.running(String(s.answered), String(s.left))}${s.dry ? ` · ${P.runDry}` : ""}`);
        if (s.closed) return;
      }
    },
    onSettled: () => { setProgress(""); refresh(); },
    onError: fail,
  });
  // 3.8: de bestanden van een testset met OA-offertes één keer laden (de bot leest ze via proef_bestand, nooit via een link).
  const load = useMutation({
    mutationFn: async (st: ProofSetView) => {
      const needs = (await actor!.proofContentNeeds(st.id)).filter((x) => !x.loaded);
      let done = 0;
      let skipped = 0;
      for (const x of needs) {
        setProgress(P.loading(done + skipped, needs.length));
        try {
          if (Number(x.size) > 1_350_000) { skipped++; continue; }
          const f = unwrap(await actor!.readConfidentialFile(x.fileId));
          if (!f.blob) { skipped++; continue; }
          const bytes = new Uint8Array(await f.blob.getBytes());
          unwrap(await actor!.loadProofContent(st.id, x.n, bytes));
          done++;
        } catch { skipped++; }
      }
      return { done, skipped };
    },
    onSuccess: (r) => toast.show({ kind: r.skipped ? "error" : "ok", text: P.loaded(r.done, r.skipped) }),
    onSettled: () => setProgress(""),
    onError: fail,
  });
  const i = info.data;
  const botName = new Map((bots.data ?? []).map((b) => [String(b.id), b.name]));

  const setCols: Column<ProofSetView>[] = [
    { key: "name", label: P.setCols.name, render: (s) => <b>{s.name}</b> },
    { key: "task", label: P.setCols.task, render: (s) => taskText(s.task) },
    { key: "cases", label: P.setCols.cases, right: true, render: (s) => String(s.cases) },
    { key: "works", label: P.setCols.works, right: true, render: (s) => String(s.works) },
    { key: "rounds", label: P.setCols.rounds, right: true, render: (s) => String(s.rounds) },
    { key: "made", label: P.setCols.made, render: (s) => fmtTime(s.createdAt) },
    {
      key: "acties", label: "", render: (s) => (
        <span className="a-row">
          <Button variant="quiet" onClick={() => setShowSet(s)}>{P.cases}</Button>
          {s.archivedAt === undefined ? <>
            {s.task === "oa-offerte-inlezen" && <Button variant="quiet" title={P.loadNote} busy={load.isPending && load.variables?.id === s.id} onClick={() => load.mutate(s)} data-testid="pb-load">{P.load}</Button>}
            <Button variant="quiet" onClick={() => setStart(s)}>{P.newRound}</Button>
            <Button variant="quiet" busy={archive.isPending && archive.variables?.id === s.id} onClick={() => archive.mutate(s)}>{P.archive}</Button>
          </> : <span className="a-tag">{P.archived}</span>}
        </span>
      ),
    },
  ];

  const roundCols: Column<ProofRoundView>[] = [
    { key: "subject", label: P.roundCols.subject, render: (r) => <b>{r.subject.__kind__ === "bot" ? P.subjectBot(botName.get(String(r.subject.bot)) ?? r.subjectName) : r.subject.__kind__ === "ai" ? P.subjectAi(r.subjectName) : r.subjectName}</b> },
    { key: "task", label: P.roundCols.task, render: (r) => taskText(r.task) },
    { key: "labels", label: P.roundCols.labels, render: (r) => [r.vendor, r.model, r.instruction].filter(Boolean).join(" · ") || "–" },
    { key: "set", label: P.roundCols.set, render: (r) => r.setName },
    {
      key: "score", label: P.roundCols.score, right: true, render: (r) => r.state.__kind__ === "open"
        ? `${String(r.answered)} / ${String(r.cases)}`
        : `${String(r.right)} / ${String(r.counted)} (${String(r.pct)} %)`,
    },
    {
      key: "state", label: P.roundCols.state, render: (r) => (
        <span className="a-row">
          <span className={`a-tag${r.state.__kind__ === "closed" ? (r.passed ? " a-tag--ok" : " a-tag--bad") : ""}`}>{r.state.__kind__ === "closed" ? (r.passed ? P.passed : P.failed) : P.state[r.state.__kind__]}</span>
          {r.latest && <span className="a-tag">{P.latest}</span>}
        </span>
      ),
    },
    { key: "when", label: P.roundCols.when, render: (r) => fmtTime(r.startedAt) },
    {
      key: "acties", label: "", render: (r) => (
        <span className="a-row">
          <Button variant="quiet" onClick={() => setShowRound(r)}>{P.cases}</Button>
          {r.state.__kind__ === "open" && <>
            {r.subject.__kind__ === "ai" && <Button variant="quiet" busy={run.isPending && run.variables?.id === r.id} onClick={() => run.mutate(r)}>{P.run}</Button>}
            <Button variant="quiet" onClick={() => setClosing({ r, cancel: false })}>{P.close}</Button>
            <Button variant="quiet" onClick={() => setClosing({ r, cancel: true })}>{P.cancel}</Button>
          </>}
        </span>
      ),
    },
  ];

  return (
    <>
      <section className="a-section">
        <h2 className="bw-h2">{P.title}</h2>
        {i && <p className="bw-muted">{P.lead(String(i.minPct), String(i.minCases))}</p>}
        <div className="a-row a-row--between">
          <h3 className="bw-h3">{P.sets}</h3>
          <Button icon="plus" onClick={() => setNewSet(true)}>{P.newSet}</Button>
        </div>
        <Loading q={sets} />
        {sets.data && sets.data.length === 0 && <p className="a-empty">{P.setsNone}</p>}
        {sets.data && sets.data.length > 0 && <Table columns={setCols} rows={sets.data} rowKey={(s) => String(s.id)} />}
      </section>

      <section className="a-section">
        <h3 className="bw-h3">{P.rounds}</h3>
        <p className="bw-muted">{P.botNote}</p>
        {progress && <p className="a-note">{progress}</p>}
        <Loading q={rounds} />
        {rounds.data && rounds.data.length === 0 && <p className="a-empty">{P.roundsNone}</p>}
        {rounds.data && rounds.data.length > 0 && <Table columns={roundCols} rows={rounds.data} rowKey={(r) => String(r.id)} />}
      </section>

      {newSet && i && <NewSetSheet tasks={i.tasks.map((x) => x.key)} max={Number(i.maxCases)} onClose={() => setNewSet(false)} onDone={(n) => { setNewSet(false); refresh(); toast.show({ kind: "ok", text: P.setMade(n) }); }} />}
      {showSet && <SetSheet set={showSet} onClose={() => setShowSet(null)} />}
      {start && i && <StartSheet set={start} aiKey={i.tasks.find((x) => x.key === start.task)?.aiKey ?? ""} onClose={() => setStart(null)} onDone={() => { setStart(null); refresh(); toast.show({ kind: "ok", text: P.roundStarted }); }} />}
      {showRound && <RoundSheet round={showRound} onClose={() => setShowRound(null)} />}
      {closing && (
        <Sheet title={closing.cancel ? P.cancelTitle : P.closeTitle} open onClose={() => setClosing(null)} side
          footer={<Button variant={closing.cancel ? "danger" : "primary"} busy={close.isPending} onClick={() => close.mutate(closing)}>{closing.cancel ? P.cancel : P.close}</Button>}>
          <p>{closing.cancel ? P.cancelText : P.closeText}</p>
        </Sheet>
      )}
    </>
  );
}

function NewSetSheet({ tasks, max, onClose, onDone }: { tasks: string[]; max: number; onClose: () => void; onDone: (n: string) => void }) {
  const { actor } = useBackend();
  const [task, setTask] = useState(tasks[0] ?? "");
  const [name, setName] = useState(`Historiek ${new Date().toLocaleDateString("nl-BE")}`);
  const [n, setN] = useState(String(max));
  const make = useMutation({
    mutationFn: async () => {
      const k = Number(n);
      if (!Number.isInteger(k) || k <= 0) throw new Error(P.setMax);
      const id = unwrap(await actor!.buildProofSet(task, name.trim(), BigInt(k)));
      const all = await actor!.listProofSets();
      return String(all.find((s) => s.id === id)?.cases ?? 0n);
    },
    onSuccess: onDone,
  });
  return (
    <Sheet title={P.newSet} open onClose={onClose} side footer={<Button variant="primary" busy={make.isPending} onClick={() => make.mutate()}>{P.newSet}</Button>}>
      <Field label={P.setTask}><Choice label={P.setTask} value={task} onChange={setTask} options={tasks.map((k) => ({ value: k, label: taskText(k) }))} /></Field>
      <Field label={P.setName}><input className="bw-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={P.setMax}><input className="bw-input bw-num" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /></Field>
      {make.error && <p className="a-err">{errText(make.error)}</p>}
    </Sheet>
  );
}

function SetSheet({ set, onClose }: { set: ProofSetView; onClose: () => void }) {
  const { actor } = useBackend();
  const q = useQuery({ queryKey: ["proofSetCases", String(set.id)], queryFn: () => actor!.proofSetCases(set.id), enabled: !!actor });
  return (
    <Sheet title={`${P.cases}: ${set.name}`} open onClose={onClose} side wide>
      <Loading q={q} />
      <ul className="a-list">
        {(q.data ?? []).map((c) => (
          <li key={String(c.n)}>
            <span className="a-list__main"><b>#{String(c.n)} · {c.ref}</b><span className="bw-muted">{P.caseAnswer}: {c.workCode} · {c.answer.filter(([k]) => k !== "werfId").map(([, v]) => v).join(" · ")}</span></span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function StartSheet({ set, aiKey, onClose, onDone }: { set: ProofSetView; aiKey: string; onClose: () => void; onDone: () => void }) {
  const { actor } = useBackend();
  const bots = useQuery({ queryKey: ["bots"], queryFn: () => actor!.listBots(), enabled: !!actor });
  const live = (bots.data ?? []).filter((b) => b.revokedAt === undefined && b.principal !== undefined);
  const [who, setWho] = useState<string>("");
  const options = [...live.map((b) => ({ value: `bot:${String(b.id)}`, label: P.subjectBot(`${b.name}${b.model ? ` (${b.model}${b.instruction ? `, ${b.instruction}` : ""})` : ""}`) })), ...(aiKey ? [{ value: `ai:${aiKey}`, label: P.subjectAi(taskText(set.task)) }] : [])];
  const pick = who || options[0]?.value || "";
  const go = useMutation({
    mutationFn: async () => {
      const [k, v] = pick.split(":");
      const subject: ProofSubject = k === "bot" ? { __kind__: "bot", bot: BigInt(v) } : { __kind__: "ai", ai: v };
      unwrap(await actor!.startProofRound(set.id, subject));
    },
    onSuccess: onDone,
  });
  return (
    <Sheet title={`${P.newRound}: ${set.name}`} open onClose={onClose} side footer={<Button variant="primary" busy={go.isPending} disabled={!pick} onClick={() => go.mutate()}>{P.newRound}</Button>}>
      <Loading q={bots} />
      <Field label={P.subject}><Choice label={P.subject} value={pick} onChange={setWho} options={options} /></Field>
      <p className="bw-muted">{P.botNote}</p>
      {go.error && <p className="a-err">{errText(go.error)}</p>}
    </Sheet>
  );
}

function outcomeText(c: ProofRoundCaseView): string {
  const o = c.outcome;
  if (!o) return P.open;
  if (o.__kind__ === "wrong") return `${P.outcome.wrong} (${P.wrongFields(o.wrong.join(", "))})`;
  return P.outcome[o.__kind__] ?? o.__kind__;
}

function RoundSheet({ round, onClose }: { round: ProofRoundView; onClose: () => void }) {
  const { actor } = useBackend();
  const [onlyWrong, setOnlyWrong] = useState(round.state.__kind__ === "closed");
  const q = useQuery({ queryKey: ["proofRoundCases", String(round.id)], queryFn: () => actor!.proofRoundCases(round.id), enabled: !!actor });
  const rows = (q.data ?? []).filter((c) => !onlyWrong || (c.outcome && (c.outcome.__kind__ === "wrong" || c.outcome.__kind__ === "none")));
  return (
    <Sheet title={`${P.detail} #${String(round.id)}`} open onClose={onClose} side wide>
      <p className="bw-muted">{round.subjectName} · {taskText(round.task)} · {[round.vendor, round.model, round.instruction].filter(Boolean).join(" · ")}</p>
      <label className="a-check"><input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} /> {P.onlyWrong}</label>
      <Loading q={q} />
      <ul className="a-list">
        {rows.map((c) => {
          const k = c.outcome?.__kind__;
          return (
            <li key={String(c.pos)}>
              <span className="a-list__main">
                <b>{String(c.pos)} · {c.ref}</b>
                <span className="bw-muted">{P.expected}: {vals(c.expected)}</span>
                <span className="bw-muted">{P.given}: {vals(c.given)}</span>
              </span>
              <span className={`a-tag${k === "right" ? " a-tag--ok" : k === "wrong" || k === "none" ? " a-tag--bad" : ""}`}>{outcomeText(c)}</span>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
