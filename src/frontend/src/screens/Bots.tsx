// 3.4 + 3.13: Beheer → AI-medewerkers → Bots (enkel de beheerder, #manageBots). Elke bot is een eigen account met een eigen Internet
// Identity; de fiche bepaalt tools, werven, documentsoorten, oproepen per dag en de autonomie per taak (Zelf doen / Voorstel / Nooit).
// Hier ook de koppeling (adres van de connector, inlogpagina), de koppelcode, de koppelingen per bot, intrekken, de voorstellen en
// acties (aanvaarden, weigeren, ongedaan maken) en het logboek zonder inhoud. Geen window.confirm: bevestigen gaat via een Sheet.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { BotActionView, BotCallView, BotView, DocKindView, McpInfo, WorkView } from "../backend";
import { BotLevel } from "../backend";
import { Button, Choice, Confirm, Sheet, Table, useToast, type Column, Info } from "../design";
import { t } from "../texts/nl";
import { errText, fmtTime, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { Field } from "./Werven";

const B = t.bots;
const levelText = (l: BotLevel) => B.level[l] ?? l;

function useMcpUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/env.json").then((r) => r.json()).then((c) => {
      const id = c?.backend_canister_id;
      if (!off && id && id !== "undefined") setUrl(`https://${id}.icp0.io/mcp`);
    }).catch(() => {});
    return () => { off = true; };
  }, []);
  return url;
}

export function Bots() {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const info = useQuery({ queryKey: ["mcpInfo"], queryFn: () => actor!.mcpInfo(), enabled: on });
  const bots = useQuery({ queryKey: ["bots"], queryFn: () => actor!.listBots(), enabled: on, refetchInterval: 30_000 });
  const works = useQuery({ queryKey: ["works"], queryFn: () => actor!.listWorks(), enabled: on });
  const kinds = useQuery({ queryKey: ["docKinds", false], queryFn: () => actor!.listDocKinds(false), enabled: on });
  const url = useMcpUrl();
  const [edit, setEdit] = useState<BotView | "new" | null>(null);
  const [code, setCode] = useState<{ bot: BotView; code: string; expiresAt: bigint } | null>(null);
  const [conns, setConns] = useState<BotView | null>(null);
  const [revoke, setRevoke] = useState<BotView | null>(null);
  const refresh = () => { for (const k of ["bots", "mcpInfo", "botActions", "botLog"]) void qc.invalidateQueries({ queryKey: [k] }); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const [askOrigin, setAskOrigin] = useState(false);
  const origin = useMutation({ mutationFn: async () => unwrap(await actor!._caffeineMcpSetSignInOrigin(window.location.origin)), onSuccess: () => { setAskOrigin(false); toast.show({ kind: "ok", text: B.originSet }); refresh(); }, onError: fail });
  // 3.12 (review M1): de toepassingen waar een koppeling naar terug mag (hosts); leeg = de standaard.
  const [hosts, setHosts] = useState<string | null>(null);
  const saveHosts = useMutation({
    mutationFn: async () => unwrap(await actor!.setMcpRedirectHosts((hosts ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean))),
    onSuccess: () => { setHosts(null); toast.show({ kind: "ok", text: B.hostsSaved }); refresh(); },
    onError: fail,
  });
  const mkCode = useMutation({ mutationFn: async (b: BotView) => ({ bot: b, ...unwrap(await actor!.newBotCode(b.id)) }), onSuccess: (r) => { setCode(r); refresh(); }, onError: fail });
  const doRevoke = useMutation({ mutationFn: async (b: BotView) => unwrap(await actor!.revokeBot(b.id)), onSuccess: () => { setRevoke(null); toast.show({ kind: "ok", text: B.revokeDone }); refresh(); }, onError: fail });
  const workCode = new Map((works.data ?? []).map((w) => [String(w.id), w.code]));

  const cols: Column<BotView>[] = [
    { key: "name", label: B.cols.name, render: (b) => <b>{b.name}{b.kind === "zaakvoerder" ? ` · ${B.form.kindOwner}` : ""}</b> },
    { key: "vendor", label: B.cols.vendor, render: (b) => [b.vendor, b.model, b.instruction].filter(Boolean).join(" · ") || "–" },
    { key: "linked", label: B.cols.linked, render: (b) => (b.principal ? B.linked : b.codePending ? B.codeRuns : B.notLinked) },
    { key: "works", label: B.cols.works, render: (b) => (b.allWorks ? B.allWorks : b.works.map((w) => workCode.get(String(w)) ?? `#${String(w)}`).join(", ") || "–") },
    { key: "calls", label: B.cols.calls, right: true, render: (b) => `${String(b.callsToday)} / ${String(b.callsPerDay)}` },
    { key: "open", label: B.cols.open, right: true, render: (b) => String(b.openActions) },
    { key: "state", label: B.cols.state, render: (b) => <span className={`a-tag${b.revokedAt === undefined ? " a-tag--ok" : " a-tag--bad"}`}>{b.revokedAt === undefined ? B.active : B.revoked}</span> },
    {
      key: "acties", label: "", render: (b) => b.revokedAt !== undefined ? null : (
        <span className="a-row">
          <Button variant="quiet" onClick={() => setEdit(b)}>{B.fiche}</Button>
          {!b.principal && <Button variant="quiet" busy={mkCode.isPending && mkCode.variables?.id === b.id} onClick={() => mkCode.mutate(b)}>{B.makeCode}</Button>}
          {b.principal && <Button variant="quiet" onClick={() => setConns(b)}>{B.connections} ({String(b.connections)})</Button>}
          <Button variant="quiet" onClick={() => setRevoke(b)}>{B.revoke}</Button>
        </span>
      ),
    },
  ];

  const i = info.data;
  return (
    <>
      <section className="a-section">
        <h2 className="bw-h2">{B.title}<Info text={B.lead} label={t.uitleg.label} /></h2>
        <h3 className="bw-h3">{B.connection}</h3>
        <p><span className="bw-label">{B.url}</span><br /><code>{url ?? "…"}</code></p>
        <p>
          <span className="bw-label">{B.origin}</span><br />
          {i?.signInOrigin ? <code>{i.signInOrigin}/mcp-authorize</code> : <span className="a-note a-note--bad">{B.originNone}</span>}
          {i && i.signInOrigin !== window.location.origin && <> <Button variant="quiet" onClick={() => setAskOrigin(true)}>{B.originHere}</Button></>}
        </p>
        <Confirm open={askOrigin} title={B.originConfirmTitle} text={B.originConfirm(i?.signInOrigin ?? "", window.location.origin)} confirmLabel={B.originHere} busy={origin.isPending} onConfirm={() => origin.mutate()} onClose={() => setAskOrigin(false)} />
        {i && (
          <label className="bw-field">
            <span className="bw-label">{B.hosts}</span>
            <textarea className="bw-input" rows={3} value={hosts ?? i.redirectHosts.join("\n")} onChange={(e) => setHosts(e.target.value)} spellCheck={false} />
            <span className="bw-muted">{B.hostsHelp} {B.hostsDefault(i.redirectDefault.join(", "))}</span>
            {hosts !== null && <span><Button busy={saveHosts.isPending} onClick={() => saveHosts.mutate()}>{B.hostsSave}</Button></span>}
          </label>
        )}
        <div className="a-row a-row--between">
          <h3 className="bw-h3">{B.title}</h3>
          <Button icon="plus" onClick={() => setEdit("new")}>{B.newBot}</Button>
        </div>
        <Loading q={bots} />
        {bots.data && bots.data.length === 0 && <p className="a-empty">{B.none}</p>}
        {bots.data && bots.data.length > 0 && <Table columns={cols} rows={bots.data} rowKey={(b) => String(b.id)} />}
      </section>

      <Actions />
      <BotLog />

      {edit && i && <BotSheet bot={edit === "new" ? null : edit} info={i} works={works.data ?? []} kinds={kinds.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); toast.show({ kind: "ok", text: t.common.saved }); }} />}
      {code && (
        <Sheet title={`${B.codeTitle}: ${code.bot.name}`} open onClose={() => setCode(null)} side>
          <p className="bw-muted">{B.codeLead}</p>
          <p style={{ fontSize: "1.4rem", letterSpacing: "0.05em" }}><code>{code.code}</code></p>
          <p className="bw-muted">{B.codeExpires(fmtTime(code.expiresAt))}</p>
          <ol>{B.codeSteps.map((s) => <li key={s}>{s}</li>)}</ol>
          <p><code>{url ?? ""}</code></p>
        </Sheet>
      )}
      {conns && <ConnSheet bot={conns} onClose={() => { setConns(null); refresh(); }} />}
      {revoke && (
        <Sheet title={B.revokeTitle} open onClose={() => setRevoke(null)} side
          footer={<Button variant="danger" busy={doRevoke.isPending} onClick={() => doRevoke.mutate(revoke)}>{B.revoke}</Button>}>
          <p>{B.revokeText(revoke.name)}</p>
        </Sheet>
      )}
    </>
  );
}

function BotSheet({ bot, info, works, kinds, onClose, onSaved }: { bot: BotView | null; info: McpInfo; works: WorkView[]; kinds: DocKindView[]; onClose: () => void; onSaved: () => void }) {
  const { actor } = useBackend();
  const F = B.form;
  const [name, setName] = useState(bot?.name ?? "");
  const [vendor, setVendor] = useState(bot?.vendor ?? "Anthropic");
  const [model, setModel] = useState(bot?.model ?? "");
  const [instruction, setInstruction] = useState(bot?.instruction ?? "");
  // 3.5: Zelf doen enkel als de laatste proefronde geslaagd is met dezelfde labels (de backend controleert dat ook).
  const proofOf = (k: string) => bot?.proof.find((p) => p.task === k);
  const labelsSame = !!bot && bot.vendor === vendor.trim() && bot.model === model.trim() && bot.instruction === instruction.trim();
  const autoOk = (k: string) => { const p = proofOf(k); return !!p && p.autoAllowed && labelsSame; };
  const proofLine = (k: string) => {
    const p = proofOf(k);
    if (!p) return null;
    if (p.openRound !== undefined) return B.form.proofOpen;
    if (p.roundId === undefined) return B.form.proofNone;
    const pct = p.counted > 0n ? String((p.right * 100n) / p.counted) : "0";
    if (!p.sameLabels || !labelsSame) return B.form.proofOther;
    return p.passed ? B.form.proofOk(String(p.right), String(p.counted), pct) : B.form.proofLow(String(p.right), String(p.counted), pct);
  };
  const [tools, setTools] = useState<string[]>(bot?.tools ?? ["mijn_fiche", "werven"]);
  // 4b.8: de assistent van de zaakvoerder (bredere leesfiche, enkel voorstellen; de backend controleert het ook).
  const [owner, setOwnerRaw] = useState(bot?.kind === "zaakvoerder");
  // Review 4b.8 M1: wat al bewaard is (soort en rev), zodat een tweede poging na een fout niet met een oude rev vertrekt.
  const [saved, setSaved] = useState<{ rev: bigint; owner: boolean }>({ rev: bot?.rev ?? 0n, owner: bot?.kind === "zaakvoerder" });
  const ownerTools = info.tools.filter((x) => x.readOnly).map((x) => x.name);
  // Bij het wisselen van soort meteen de fiche passend maken (geen verborgen tools, geen Zelf doen bij de zaakvoerder).
  const setOwner = (v: boolean) => {
    setOwnerRaw(v);
    setTools((ts) => (v ? ts.filter((x) => ownerTools.includes(x)) : ts.filter((x) => x !== "facturen_wachten")));
    if (v) setTasks((ts) => Object.fromEntries(Object.entries(ts).map(([k, l]) => [k, l === BotLevel.auto ? BotLevel.proposal : l])));
  };
  const [allWorks, setAllWorks] = useState(bot?.allWorks ?? false);
  const [ws, setWs] = useState<string[]>((bot?.works ?? []).map(String));
  const [dk, setDk] = useState<string[]>(bot?.docKinds ?? []);
  const [calls, setCalls] = useState(String(bot?.callsPerDay ?? 100n));
  const [tasks, setTasks] = useState<Record<string, BotLevel>>(Object.fromEntries((bot?.tasks ?? info.tasks.map((x) => [x.key, BotLevel.proposal] as [string, BotLevel]))));
  const toggle = (xs: string[], x: string, set: (v: string[]) => void) => set(xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const save = useMutation({
    mutationFn: async () => {
      const n = Number(calls);
      if (!Number.isInteger(n) || n <= 0) throw new Error(F.calls);
      // 4b.8: eerst de soort (een bestaande bot), dan de fiche met de nieuwe rev. Een nieuwe bot: eerst de fiche zonder de tool van
      // de zaakvoerder, dan de soort, dan (als die tool erbij moet) de fiche nog eens.
      let rev = saved.rev;
      if (bot && saved.owner !== owner) { unwrap(await actor!.setBotKind(bot.id, rev, owner)); rev += 1n; setSaved({ rev, owner }); }
      const first = !bot && owner ? tools.filter((x) => x !== "facturen_wachten") : tools;
      const input = (id: bigint | undefined, r: bigint, ts: string[]) => ({
        id, rev: r, name: name.trim(), vendor: vendor.trim(), model: model.trim(), tools: ts, allWorks,
        works: allWorks ? [] : ws.map((w) => BigInt(w)), docKinds: dk, callsPerDay: BigInt(n),
        tasks: info.tasks.map((x) => [x.key, tasks[x.key] ?? BotLevel.proposal] as [string, BotLevel]),
        instruction: instruction.trim(),
      });
      const id = unwrap(await actor!.saveBot(input(bot?.id, rev, first)));
      if (!bot && owner) {
        unwrap(await actor!.setBotKind(id, 1n, true));
        if (first.length !== tools.length) unwrap(await actor!.saveBot(input(id, 2n, tools)));
      }
    },
    onSuccess: onSaved,
  });
  const openKinds = kinds.filter((k) => !k.confidential && !k.archived);
  const liveWorks = works.filter((w) => w.archivedAt === undefined);
  return (
    <Sheet title={`${F.title}: ${bot?.name ?? B.newBot}`} open onClose={onClose} side wide
      footer={<Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button>}>
      <Field label={F.name}><input className="bw-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="a-row">
        <Field label={F.vendor}><input className="bw-input" value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
        <Field label={F.model}><input className="bw-input" value={model} onChange={(e) => setModel(e.target.value)} /></Field>
      </div>
      <Field label={F.instruction}><input className="bw-input" value={instruction} maxLength={60} onChange={(e) => setInstruction(e.target.value)} /></Field>
      <p className="bw-muted">{F.instructionHelp}</p>
      <Field label={F.kind}>
        <Choice label={F.kind} value={owner ? "owner" : "normal"} onChange={(v) => setOwner(v === "owner")} options={[{ value: "normal", label: F.kindNormal }, { value: "owner", label: F.kindOwner }]} />
      </Field>
      {owner && (
        <div className="a-stack">
          <p className="bw-muted">{F.kindHelp}</p>
          <div><Button variant="secondary" size="sm" onClick={() => { setTools(ownerTools); setAllWorks(true); setTasks(Object.fromEntries(info.tasks.map((x) => [x.key, x.key === "vrije-taak" ? BotLevel.proposal : BotLevel.never] as [string, BotLevel]))); }} data-testid="bot-owner-preset">{F.ownerPreset}</Button></div>
        </div>
      )}
      <fieldset className="bw-field">
        <legend className="bw-label">{F.tools}</legend>
        {info.tools.filter((x) => owner ? ownerTools.includes(x.name) : x.name !== "facturen_wachten").map((x) => (
          <label key={x.name} className="a-check"><input type="checkbox" checked={tools.includes(x.name)} onChange={() => toggle(tools, x.name, setTools)} /> {B.tool[x.name] ?? x.name}</label>
        ))}
      </fieldset>
      <Field label={F.works}><Choice label={F.works} value={allWorks ? "alle" : "enkel"} onChange={(v) => setAllWorks(v === "alle")} options={[{ value: "enkel", label: F.someWorks }, { value: "alle", label: F.allWorks }]} /></Field>
      {!allWorks && (
        <div className="a-scroll" style={{ maxHeight: 220, overflowY: "auto", flexShrink: 0 }}>
          {liveWorks.map((w) => (
            <label key={String(w.id)} className="a-check"><input type="checkbox" checked={ws.includes(String(w.id))} onChange={() => toggle(ws, String(w.id), setWs)} /> {w.code} · {w.name}</label>
          ))}
        </div>
      )}
      <fieldset className="bw-field">
        <legend className="bw-label">{F.docKinds}</legend>
        {openKinds.map((k) => (
          <label key={k.key} className="a-check"><input type="checkbox" checked={dk.includes(k.key)} onChange={() => toggle(dk, k.key, setDk)} /> {k.name}</label>
        ))}
      </fieldset>
      <Field label={F.calls}><input className="bw-input bw-num" inputMode="numeric" value={calls} onChange={(e) => setCalls(e.target.value)} /></Field>
      <fieldset className="bw-field">
        <legend className="bw-label">{F.tasks}</legend>
        <p className="bw-muted">{F.newTaskNote}</p>
        {info.tasks.map((x) => (
          <Field key={x.key} label={B.task[x.key] ?? x.key}>
            <Choice<BotLevel> label={B.task[x.key] ?? x.key} value={tasks[x.key] ?? BotLevel.proposal} onChange={(v) => setTasks({ ...tasks, [x.key]: v })}
              options={[...(x.maxAuto && (autoOk(x.key) || tasks[x.key] === BotLevel.auto) ? [{ value: BotLevel.auto, label: levelText(BotLevel.auto) }] : []), { value: BotLevel.proposal, label: levelText(BotLevel.proposal) }, { value: BotLevel.never, label: levelText(BotLevel.never) }]} />
            {proofLine(x.key) && <span className="bw-muted">{proofLine(x.key)}</span>}
            {tasks[x.key] === BotLevel.auto && !autoOk(x.key) && <span className="a-note a-note--bad">{F.autoOff}</span>}
          </Field>
        ))}
        <span className="bw-label">{F.never}</span>
        <ul className="a-list">{info.never.map((n) => <li key={n}><span className="a-list__main">{B.neverTask[n] ?? n}</span><span className="a-tag a-tag--bad">{levelText(BotLevel.never)}</span></li>)}</ul>
      </fieldset>
      {save.error && <p className="a-err">{errText(save.error)}</p>}
    </Sheet>
  );
}

function ConnSheet({ bot, onClose }: { bot: BotView; onClose: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const q = useQuery({ queryKey: ["botConnections", String(bot.id)], queryFn: () => actor!.botConnections(bot.id), enabled: !!actor });
  const rv = useMutation({ mutationFn: async (id: string) => unwrap(await actor!.revokeBotConnection(bot.id, id)), onSuccess: () => void q.refetch(), onError: (e) => toast.show({ kind: "error", text: errText(e) }) });
  return (
    <Sheet title={`${B.connTitle}: ${bot.name}`} open onClose={onClose} side>
      <Loading q={q} />
      {q.data && q.data.length === 0 && <p className="a-empty">{B.connNone}</p>}
      <ul className="a-list">
        {(q.data ?? []).map((c) => (
          <li key={c.id}>
            <span className="a-list__main"><b>{B.connTarget(c.clientName, c.target)}</b><span className="bw-muted">{fmtTime(c.createdAt)} · {B.connExpires(fmtTime(c.expiresAt))}</span></span>
            <Button variant="quiet" busy={rv.isPending && rv.variables === c.id} onClick={() => rv.mutate(c.id)}>{B.revoke}</Button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function actionText(a: BotActionView): string {
  const d = a.detail;
  if (d.__kind__ === "docLink") return B.docLink(d.docLink.fileName, d.docLink.title);
  if (d.__kind__ === "invoiceCheck") return B.invoiceCheck(d.invoiceCheck.number, d.invoiceCheck.firm, B.verdict[d.invoiceCheck.verdict] ?? d.invoiceCheck.verdict);
  return d.other.tool;
}

function Actions() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [onlyOpen, setOnlyOpen] = useState(true);
  const q = useQuery({ queryKey: ["botActions", onlyOpen], queryFn: () => actor!.botActions(onlyOpen), enabled: !!actor && !isFetching, refetchInterval: 30_000 });
  const after = () => { for (const k of ["botActions", "bots"]) void qc.invalidateQueries({ queryKey: [k] }); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const decide = useMutation({ mutationFn: async (x: { a: BotActionView; accept: boolean }) => unwrap(await actor!.decideBotAction(x.a.id, x.accept, "")), onSuccess: () => { toast.show({ kind: "ok", text: B.decided }); after(); }, onError: fail });
  const undo = useMutation({ mutationFn: async (a: BotActionView) => unwrap(await actor!.undoBotAction(a.id)), onSuccess: () => { toast.show({ kind: "ok", text: B.undone }); after(); }, onError: fail });
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{B.actions}</h2>
        <label className="a-check"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> {B.onlyOpen}</label>
      </div>
      <p className="bw-muted">{B.actionsLead}</p>
      <Loading q={q} />
      {q.data && q.data.length === 0 && <p className="a-empty">{B.actionsNone}</p>}
      <ul className="a-list">
        {(q.data ?? []).map((a) => {
          const k = a.state.__kind__;
          const remarks = a.detail.__kind__ === "invoiceCheck" ? a.detail.invoiceCheck.remarks : [];
          return (
            <li key={String(a.id)}>
              <span className="a-list__main">
                <b>#{String(a.id)} · {a.botName} · {B.task[a.task] ?? a.task}{a.workCode ? ` · ${a.workCode}` : ""}</b>
                <span>{actionText(a)}</span>
                {(a.reason || remarks.length > 0) && (
                  <span className="bw-muted" title={B.untrusted}>“{[a.reason, ...remarks].filter(Boolean).join(" · ")}”</span>
                )}
                {a.detail.__kind__ === "invoiceCheck" && k === "proposed" && <span className="bw-muted">{B.invoiceNote}</span>}
                <span className="bw-muted">{fmtTime(a.at)}{k === "failed" ? ` · ${a.state.__kind__ === "failed" ? a.state.failed : ""}` : ""}</span>
              </span>
              <span className="a-row">
                <span className={`a-tag${k === "done" || k === "accepted" ? " a-tag--ok" : k === "proposed" ? "" : " a-tag--bad"}`}>{B.state[k] ?? k}</span>
                {k === "proposed" && <>
                  <Button variant="quiet" busy={decide.isPending && decide.variables?.a.id === a.id && decide.variables.accept} onClick={() => decide.mutate({ a, accept: true })}>{B.accept}</Button>
                  <Button variant="quiet" busy={decide.isPending && decide.variables?.a.id === a.id && !decide.variables.accept} onClick={() => decide.mutate({ a, accept: false })}>{B.reject}</Button>
                </>}
                {a.canUndo && <Button variant="quiet" busy={undo.isPending && undo.variables?.id === a.id} onClick={() => undo.mutate(a)}>{B.undo}</Button>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BotLog() {
  const { actor, isFetching } = useBackend();
  const [from, setFrom] = useState(0n);
  const PAGE = 50n;
  const q = useQuery({ queryKey: ["botLog", String(from)], queryFn: () => actor!.botLog(from, PAGE), enabled: !!actor && !isFetching, refetchInterval: 30_000 });
  const outcome = (c: BotCallView) => {
    const o = c.outcome;
    const base = B.outcome[o.__kind__] ?? o.__kind__;
    const why = o.__kind__ === "refused" ? o.refused : o.__kind__ === "error" ? o.error : "";
    return why ? `${base}: ${why}` : base;
  };
  return (
    <section className="a-section">
      <h2 className="bw-h2">{B.log}</h2>
      <p className="bw-muted">{B.logLead}</p>
      <Loading q={q} />
      {q.data && q.data.length === 0 && <p className="a-empty">{B.logNone}</p>}
      <ul className="a-list">
        {(q.data ?? []).map((c) => (
          <li key={String(c.id)}>
            <span className="a-list__main">
              <b>#{String(c.id)} · {fmtTime(c.at)} · {c.botName} · {B.tool[c.tool] ?? c.tool}</b>
              <span className="bw-muted">{c.workId !== undefined ? `werf ${String(c.workId)} · ` : ""}<code>{c.argsSha256.slice(0, 12)}</code>{c.actionId !== undefined ? ` · actie #${String(c.actionId)}` : ""}</span>
            </span>
            <span className={`a-tag${c.outcome.__kind__ === "ok" ? " a-tag--ok" : " a-tag--bad"}`}>{outcome(c)}</span>
          </li>
        ))}
      </ul>
      <div className="a-row">
        {from > 0n && <Button variant="quiet" onClick={() => setFrom(from > PAGE ? from - PAGE : 0n)}>{t.ai.newer}</Button>}
        {q.data && BigInt(q.data.length) === PAGE && <Button variant="quiet" onClick={() => setFrom(from + PAGE)}>{t.ai.more}</Button>}
      </div>
    </section>
  );
}
