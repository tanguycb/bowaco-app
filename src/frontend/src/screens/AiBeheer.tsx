// 3.1-B2: minimaal beheerscherm van de AI-connector (Beheer → AI-medewerkers, enkel #manageAi). Toont de fiches (weg, model,
// terugval, budget, klantgegevens), het verbruik van de maand, de catalogus met "Modellen vernieuwen" en het logboek zonder
// inhoud. Een fiche wijzigen gaat met rev-controle (saveAiWorker); de proeftaak loopt op de caffeine-weg via aiTestCall en op de
// gateway-weg via de connector (ticket → /v2/taak → pollen). Het volledige scherm komt in 3.4.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AiCallView, AiModel, AiOverview, AiWorkerView } from "../backend";
import { AiAutonomy, AiRoute } from "../backend";
import { runAi } from "../aiConnector";
import { Button, Choice, Sheet, Table, useToast, type Column } from "../design";
import { t } from "../texts/nl";
import { errText, fmtEuro, fmtTime, parseEuro, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { Field } from "./Werven";
import { Bots } from "./Bots";

const A = t.ai;
const PAGE = 50n;
// Verzonnen proeftekst (zoals AiPrompts.testText): nooit echte gegevens in een proef.
const PROEF = "Proef: offerte van Firma Voorbeeld bv voor werf W-901 (Voorbeeldstraat 1, 9999 Voorbeeld), totaal € 1.234,00 excl. btw.";
const fmtCycles = (n: bigint) => `${(Number(n) / 1e12).toLocaleString("nl-BE", { maximumFractionDigits: 2 })} T`;
const centsInput = (c: bigint) => (Number(c) / 100).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const usdPerM = (per1e10: bigint) => (Number(per1e10) / 1e4).toLocaleString("nl-BE", { maximumFractionDigits: 4 });

function callTone(c: AiCallView): string {
  const k = c.state.__kind__;
  return k === "done" ? "a-tag--ok" : k === "running" || k === "dryRun" ? "" : "a-tag--bad";
}
function callText(c: AiCallView): string {
  const s = c.state;
  const base = A.state[s.__kind__] ?? s.__kind__;
  const why = s.__kind__ === "failed" ? s.failed : s.__kind__ === "invalid" ? s.invalid : s.__kind__ === "unsure" ? s.unsure : "";
  return why ? `${base}: ${why}` : base;
}

export function AiBeheer() {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const ov = useQuery({ queryKey: ["aiOverview"], queryFn: () => actor!.aiOverview(), enabled: on, refetchInterval: 30_000 });
  const ws = useQuery({ queryKey: ["aiWorkers"], queryFn: () => actor!.listAiWorkers(), enabled: on });
  const [from, setFrom] = useState(0n);
  const log = useQuery({ queryKey: ["aiLog", String(from)], queryFn: () => actor!.aiLog(from, PAGE), enabled: on, refetchInterval: 30_000 });
  const [edit, setEdit] = useState<AiWorkerView | null>(null);
  const refreshAll = () => { for (const k of ["aiOverview", "aiWorkers", "aiLog"]) void qc.invalidateQueries({ queryKey: [k] }); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const models = useMutation({ mutationFn: async () => unwrap(await actor!.refreshAiModels()), onSuccess: (n) => { toast.show({ kind: "ok", text: A.refreshed(Number(n)) }); refreshAll(); }, onError: fail });
  const test = useMutation({
    mutationFn: async (w: AiWorkerView): Promise<bigint> => {
      if (w.route === AiRoute.caffeine) return unwrap(await actor!.aiTestCall(w.key));
      const r = await runAi(actor!, w.key, null, { tekst: PROEF, instructieVersie: Number(w.instructionVersion) });
      return r.callId;
    },
    onSuccess: (id) => { toast.show({ kind: "ok", text: A.testDone(String(id)) }); refreshAll(); },
    onError: (e) => { fail(e); refreshAll(); },
  });
  const o = ov.data;
  const stats = new Map((o?.workers ?? []).map((s) => [s.key, s]));
  const names = new Map((ws.data ?? []).map((w) => [w.key, w.name]));

  const cols: Column<AiWorkerView>[] = [
    { key: "name", label: A.cols.name, render: (w) => <span className="a-list__main"><b>{w.name}</b><span className="bw-muted">{w.key} · v{String(w.instructionVersion)}</span></span> },
    { key: "route", label: A.cols.route, render: (w) => A.route[w.route] ?? w.route },
    { key: "model", label: A.cols.model, render: (w) => <code>{w.modelAlias}</code> },
    { key: "fallback", label: A.cols.fallback, render: (w) => (w.fallback && w.fallbackModel ? <code>{w.fallbackModel}</code> : A.no) },
    { key: "budget", label: A.cols.budget, right: true, render: (w) => (w.budget ? `${fmtEuro(w.budget.budgetMonthCents)} (≤ ${fmtEuro(w.budget.maxCallCents)} per oproep)` : "–") },
    { key: "used", label: A.cols.used, right: true, render: (w) => (w.budget ? `${fmtEuro(w.budget.spentCents)}${w.budget.reservedCents > 0n ? ` + ${fmtEuro(w.budget.reservedCents)} ${A.reserved.toLowerCase()}` : ""} · ${String(stats.get(w.key)?.calls ?? 0n)} / ${String(stats.get(w.key)?.errors ?? 0n)}` : "–") },
    { key: "clientData", label: A.cols.clientData, render: (w) => (w.clientData ? A.yes : A.no) },
    { key: "state", label: A.cols.state, render: (w) => <span className={`a-tag${w.enabled ? " a-tag--ok" : ""}`}>{!w.configured ? A.notSet : w.enabled ? A.on : A.off}</span> },
    {
      key: "acties", label: "", render: (w) => (
        <span className="a-row">
          <Button variant="quiet" onClick={() => setEdit(w)}>{A.edit}</Button>
          <Button variant="quiet" disabled={!w.configured || !w.enabled} busy={test.isPending && test.variables?.key === w.key} onClick={() => test.mutate(w)}>{A.test}</Button>
        </span>
      ),
    },
  ];

  return (
    <Page title={A.title} label={t.beheer.title}>
      <p className="bw-muted">{A.lead}</p>
      <Loading q={ov} />
      {o && <Overview o={o} />}

      <section className="a-section">
        <h2 className="bw-h2">{A.workers}</h2>
        <Loading q={ws} />
        {ws.data && <Table columns={cols} rows={ws.data} rowKey={(w) => w.key} />}
        {test.isPending && test.variables?.route === AiRoute.gateway && <p className="bw-muted">{A.gatewayRunning}</p>}
      </section>

      <section className="a-section">
        <div className="a-row a-row--between">
          <h2 className="bw-h2">{A.models}</h2>
          <Button icon="sync" busy={models.isPending} onClick={() => models.mutate()}>{A.refresh}</Button>
        </div>
        {o && o.models.length === 0 && <p className="a-empty">{A.noModels}</p>}
        {o && o.models.length > 0 && (
          <Table<AiModel>
            rows={[...o.models].sort((a, b) => a.alias.localeCompare(b.alias))}
            rowKey={(m) => m.alias}
            columns={[
              { key: "alias", label: A.modelCols.alias, render: (m) => <code>{m.alias}</code> },
              { key: "p", label: A.modelCols.prompt, right: true, render: (m) => usdPerM(m.promptPer1e10) },
              { key: "c", label: A.modelCols.completion, right: true, render: (m) => usdPerM(m.completionPer1e10) },
              { key: "s", label: A.modelCols.seen, render: (m) => fmtTime(m.seenAt) },
            ]}
          />
        )}
      </section>

      <section className="a-section">
        <h2 className="bw-h2">{A.log}</h2>
        <p className="bw-muted">{A.logLead}</p>
        <Loading q={log} />
        {log.data && log.data.length === 0 && <p className="a-empty">{A.noLog}</p>}
        {log.data && log.data.length > 0 && (
          <ul className="a-list">
            {log.data.map((c) => (
              <li key={String(c.id)}>
                <span className="a-list__main">
                  <b>#{String(c.id)} · {fmtTime(c.startedAt)} · {names.get(c.workerKey) ?? c.workerKey}</b>
                  <span className="bw-muted">
                    {A.route[c.route] ?? c.route} · <code>{c.model}</code>{c.fellBack ? ` · ${A.fellBack}` : ""} · {A.tokens(String(c.promptTokens), String(c.completionTokens))} · {fmtEuro(c.costCents)}
                    {c.workId !== undefined ? ` · werf ${String(c.workId)}` : ""}{c.proposalId !== undefined ? ` · voorstel #${String(c.proposalId)}` : ""}
                  </span>
                </span>
                <span className={`a-tag ${callTone(c)}`}>{callText(c)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="a-row">
          {from > 0n && <Button variant="quiet" onClick={() => setFrom(from > PAGE ? from - PAGE : 0n)}>{A.newer}</Button>}
          {log.data && BigInt(log.data.length) === PAGE && <Button variant="quiet" onClick={() => setFrom(from + PAGE)}>{A.more}</Button>}
        </div>
      </section>

      <Bots />

      {edit && <WorkerSheet w={edit} models={o?.models ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refreshAll(); toast.show({ kind: "ok", text: t.common.saved }); }} />}
    </Page>
  );
}

function Overview({ o }: { o: AiOverview }) {
  const spent = o.workers.reduce((s, w) => s + w.spentCents, 0n);
  const budget = o.workers.reduce((s, w) => s + (w.enabled ? w.budgetMonthCents : 0n), 0n);
  const reserved = o.workers.reduce((s, w) => s + w.reservedCents, 0n);
  return (
    <>
      <div className="a-counters">
        <div className="a-counter"><span className="a-counter__n a-counter__n--small">{o.month}</span><span className="a-counter__l">{A.month}</span></div>
        <div className="a-counter"><span className="a-counter__n a-counter__n--small">{fmtEuro(spent)}</span><span className="a-counter__l">{A.spent} / {fmtEuro(budget)}</span></div>
        <div className="a-counter"><span className="a-counter__n a-counter__n--small">{fmtEuro(reserved)}</span><span className="a-counter__l">{A.reserved}</span></div>
        <div className="a-counter"><span className="a-counter__n">{String(o.running)}</span><span className="a-counter__l">{A.running}</span></div>
        <div className={`a-counter${o.cyclesBalance < o.cyclesFloor ? " a-counter--warn" : ""}`}><span className="a-counter__n a-counter__n--small">{fmtCycles(o.cyclesBalance)}</span><span className="a-counter__l">{A.cycles}</span></div>
        <div className="a-counter"><span className="a-counter__n a-counter__n--small">{o.modelsSeenAt !== undefined ? fmtTime(o.modelsSeenAt) : A.catalogNever}</span><span className="a-counter__l">{A.catalog}</span></div>
      </div>
      <p className={`a-note${o.live && !o.draft ? " a-note--bad" : ""}`}>{o.draft ? A.mode.draft : o.live ? A.mode.live : A.mode.test}</p>
      <p className="bw-muted">{A.gateway}: {o.gatewayUrl ?? A.gatewayNone} · {A.rate}: {(Number(o.usdEurMilli) / 1000).toLocaleString("nl-BE", { minimumFractionDigits: 3 })}</p>
    </>
  );
}

function ModelInput({ route, value, onChange, models, label, noAuto }: { route: AiRoute; value: string; onChange: (v: string) => void; models: AiModel[]; label: string; noAuto?: boolean }) {
  if (route === AiRoute.caffeine) {
    const list = [...(noAuto ? [] : ["auto"]), ...models.map((m) => m.alias).filter((a) => a !== "auto").sort()];
    if (value && !list.includes(value)) list.unshift(value);
    return (
      <select className="bw-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">–</option>
        {list.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    );
  }
  return <input className="bw-input" aria-label={label} value={value} placeholder="claude/sonnet-5.5" onChange={(e) => onChange(e.target.value.trim())} />;
}

function WorkerSheet({ w, models, onClose, onSaved }: { w: AiWorkerView; models: AiModel[]; onClose: () => void; onSaved: () => void }) {
  const { actor } = useBackend();
  const F = A.form;
  const [name, setName] = useState(w.name);
  const [enabled, setEnabled] = useState(w.enabled);
  const [route, setRoute] = useState<AiRoute>(w.route);
  const [model, setModel] = useState(w.modelAlias);
  const [fallback, setFallback] = useState(w.fallback);
  const [fbModel, setFbModel] = useState(w.fallbackModel ?? "");
  const [budget, setBudget] = useState(centsInput(w.budget?.budgetMonthCents ?? 0n));
  const [maxCall, setMaxCall] = useState(centsInput(w.budget?.maxCallCents ?? 0n));
  const [clientData, setClientData] = useState(w.clientData);
  const [version, setVersion] = useState(String(w.instructionVersion));
  const other = route === AiRoute.caffeine ? AiRoute.gateway : AiRoute.caffeine;
  const save = useMutation({
    mutationFn: async () => {
      const b = parseEuro(budget);
      const m = parseEuro(maxCall);
      if (b === null || m === null) throw new Error(F.badAmount);
      unwrap(await actor!.saveAiWorker({
        key: w.key, rev: w.rev, name: name.trim(), enabled, route, modelAlias: model,
        fallback, fallbackModel: fallback && fbModel ? fbModel : undefined,
        budgetMonthCents: b ?? 0n, maxCallCents: m ?? 0n, clientData, autonomy: AiAutonomy.proposal, instructionVersion: BigInt(version),
      }));
    },
    onSuccess: onSaved,
  });
  const yn = [{ value: "ja", label: A.yes }, { value: "nee", label: A.no }];
  return (
    <Sheet title={`${F.title}: ${w.name}`} open onClose={onClose} side
      footer={<Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button>}>
      <Field label={F.name}><input className="bw-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={F.enabled}><Choice label={F.enabled} value={enabled ? "aan" : "uit"} onChange={(v) => setEnabled(v === "aan")} options={[{ value: "aan", label: A.on }, { value: "uit", label: A.off }]} /></Field>
      <Field label={F.route}><Choice label={F.route} value={route} onChange={(v) => { setRoute(v); setModel(""); setFbModel(""); }} options={[{ value: AiRoute.caffeine, label: A.route.caffeine }, { value: AiRoute.gateway, label: A.route.gateway }]} /></Field>
      <Field label={F.model}><ModelInput route={route} value={model} onChange={setModel} models={models} label={F.model} /></Field>
      <p className="bw-muted">{route === AiRoute.caffeine ? F.modelHelpCaffeine : F.modelHelpGateway}</p>
      <Field label={F.fallback}><Choice label={F.fallback} value={fallback ? "ja" : "nee"} onChange={(v) => setFallback(v === "ja")} options={yn} /></Field>
      {fallback && <Field label={F.fallbackModel}><ModelInput route={other} value={fbModel} onChange={setFbModel} models={models} label={F.fallbackModel} noAuto /></Field>}
      <div className="a-row">
        <Field label={F.budget}><input className="bw-input bw-num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field>
        <Field label={F.maxCall}><input className="bw-input bw-num" inputMode="decimal" value={maxCall} onChange={(e) => setMaxCall(e.target.value)} /></Field>
      </div>
      <Field label={F.clientData}><Choice label={F.clientData} value={clientData ? "ja" : "nee"} onChange={(v) => setClientData(v === "ja")} options={yn} /></Field>
      <p className="bw-muted">{F.clientHelp}</p>
      <Field label={F.version}>
        <select className="bw-input" value={version} onChange={(e) => setVersion(e.target.value)}>
          {(w.versions.length ? w.versions : [w.instructionVersion]).map((v) => <option key={String(v)} value={String(v)}>v{String(v)}</option>)}
        </select>
      </Field>
      {save.error && <p className="a-err">{errText(save.error)}</p>}
    </Sheet>
  );
}
