// Nakijkopdrachten (stappen 3.9 en 3.11, bouwplan §6 "Twee wegen voor AI"). Kantoor met de prijzen (beheerder, calculator):
// - TenderCheckPanel (3.9, bij Vergelijken van een prijsvraag): de offertes laten nakijken door een bot (via de MCP-connector) of
//   Caffeine; het voorstel = per post een firma + bevindingen. "In de keuze zetten" vult de keuze hieronder (de mens kijkt na en
//   bewaart), "Keuze bewaren en overnemen" doet in één klik kiezen + overnemen in een ontwerpversie (applyTenderCheck).
// - QuoteReviewPanel (3.11, bij Versturen van een offerte): de versie laten nalezen; enkel opmerkingen, versturen blijft altijd kan.
// Het resultaat komt enkel uit readAiCheck (update-call met auditregel).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AiCheckOutcome, type AiCheckBrief, type AiCheckFull, type AiCheckTargetIn, type AiCheckWay, type TenderDraftRef, type TenderItemView } from "../backend";
import { Button, Choice, Confirm, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtEuro, fmtTime, unwrap, useBackend } from "../util";
import { Field } from "./Werven";

const C = t.nakijken;
const keyOf = (target: AiCheckTargetIn) => (target.__kind__ === "tender" ? `t${target.tender}` : `q${target.quote}`);

function useRefresh() {
  const qc = useQueryClient();
  return () => { for (const k of ["aiChecks", "tenderCompare"]) void qc.invalidateQueries({ queryKey: [k] }); };
}

function StartSheet({ target, onClose }: { target: AiCheckTargetIn; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const refresh = useRefresh();
  const kind = target.__kind__ === "tender" ? "vergelijking" : "nalezen";
  const bots = useQuery({ queryKey: ["aiCheckBots", keyOf(target)], queryFn: () => actor!.listAiCheckBots(target), enabled: !!actor && !isFetching });
  const aiOk = useQuery({ queryKey: ["aiCheckAiReady", kind], queryFn: () => actor!.aiCheckAiReady(kind), enabled: !!actor && !isFetching });
  const ways = [...(bots.data ?? []).map((b) => ({ value: `bot:${b.id}`, label: C.wayBot(b.name) })), ...(aiOk.data ? [{ value: "ai", label: C.wayCaffeine }] : [])];
  const [way, setWay] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = way || ways[0]?.value || "";
  const send = async () => {
    setBusy(true);
    try {
      const isAi = chosen === "ai";
      const w: AiCheckWay = isAi ? { __kind__: "ai", ai: null } : { __kind__: "bot", bot: BigInt(chosen.slice(4)) };
      const id = unwrap(await actor!.startAiCheck({ target, way: w }));
      if (isAi) {
        const r = unwrap(await actor!.runAiCheckAi(id));
        toast.show({ kind: r.status === "voorstel" ? "ok" : "error", text: r.status === "voorstel" ? (r.dry ? C.dry : C.proposed) : C.failed });
      } else {
        toast.show({ kind: "ok", text: C.started });
      }
      refresh();
      onClose();
    } catch (e) { toast.show({ kind: "error", text: errText(e) }); } finally { setBusy(false); }
  };
  return (
    <Sheet title={C.sheetTitle} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={chosen === ""} onClick={() => void send()} data-testid="ac-send">{C.send}</Button></>}>
      <p className="bw-muted">{target.__kind__ === "tender" ? C.tenderLead : C.quoteLead}</p>
      {bots.data && aiOk.data !== undefined && ways.length === 0 && <p className="a-empty" data-testid="ac-noway">{C.noWay}</p>}
      {ways.length > 0 && <Field label={C.way}><Choice label={C.way} value={chosen} onChange={(x) => setWay(x)} options={ways} /></Field>}
    </Sheet>
  );
}

function Findings({ full, items }: { full: AiCheckFull; items?: TenderItemView[] }) {
  const label = (pos?: bigint) => {
    if (pos === undefined) return "";
    const x = items?.[Number(pos) - 1];
    return x ? `${x.code ? `${x.code} ` : ""}${x.title}` : C.post(Number(pos));
  };
  if (full.findings.length === 0) return null;
  return (
    <>
      <h3 className="bw-h4">{C.findingsTitle}</h3>
      <ul className="vs-findings" data-testid="ac-findings">
        {full.findings.map((f, k) => <li key={k}><span className={`a-tag ${f.severity === "fout" ? "a-tag--warn" : ""}`}>{C.severities[f.severity] ?? f.severity}</span> <b>{C.kinds[f.kind] ?? f.kind}</b>{f.pos !== undefined ? ` (${label(f.pos)})` : ""}: {f.text}{f.cents !== undefined ? ` (${fmtEuro(f.cents)})` : ""}</li>)}
      </ul>
    </>
  );
}

function Head({ full }: { full: AiCheckFull }) {
  return (
    <>
      <p><span className={`a-tag ${full.brief.verdict === "in_orde" || full.brief.verdict === "keuze" ? "a-tag--ok" : "a-tag--warn"}`} data-testid="ac-verdict">{C.verdicts[full.brief.verdict] ?? full.brief.verdict}</span> <span className="bw-muted">{C.from(full.brief.botName, Number(full.confidence))}</span></p>
      {full.brief.stale && <p className="a-tag a-tag--warn" data-testid="ac-stale">{C.stale}</p>}
      {full.summary && <p>{full.summary}</p>}
    </>
  );
}

/** De lijst van opdrachten op een doel, met starten, bekijken, opnieuw (Caffeine) en annuleren. */
function useChecks(target: AiCheckTargetIn) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: ["aiChecks", keyOf(target)],
    queryFn: () => actor!.listAiChecks(target),
    enabled: !!actor && !isFetching,
    retry: 0,
    // Een bot antwoordt buiten de app: zolang er een opdracht wacht, kijkt de lijst elke 15 s opnieuw (les 3.10).
    refetchInterval: (qq) => (qq.state.data ?? []).some((r) => r.status === "open" && r.way !== "caffeine") ? 15_000 : false,
  });
}

function Rows({ rows, onOpen, onAgain, onCancel, busyOpen, busyAgain }: { rows: AiCheckBrief[]; onOpen: (r: AiCheckBrief) => void; onAgain: (r: AiCheckBrief) => void; onCancel: (r: AiCheckBrief) => void; busyOpen: boolean; busyAgain: boolean }) {
  return (
    <ul className="a-list">
      {rows.map((r) => {
        const live = r.status === "open" || r.status === "voorstel";
        return (
          <li key={String(r.id)} data-testid="ac-row">
            <span className="a-list__main">
              <b>{r.botName}</b>
              <span className="bw-muted">{[C.by(r.createdByName, fmtTime(r.createdAt)), r.verdict ? C.verdicts[r.verdict] ?? r.verdict : "", r.stale ? C.stale : "", r.reason].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="a-tag" data-testid="ac-status">{C.status[r.status] ?? r.status}</span>
            {r.verdict && <Button variant="primary" busy={busyOpen} onClick={() => onOpen(r)} data-testid="ac-open">{C.open}</Button>}
            {r.way === "caffeine" && r.status === "open" && <Button busy={busyAgain} onClick={() => onAgain(r)} data-testid="ac-again">{C.again}</Button>}
            {live && <Button variant="quiet" onClick={() => onCancel(r)} data-testid="ac-cancel">{C.cancel}</Button>}
          </li>
        );
      })}
    </ul>
  );
}

function useActions(onShown: (f: AiCheckFull | null) => void) {
  const { actor } = useBackend();
  const toast = useToast();
  const refresh = useRefresh();
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const open = useMutation({ mutationFn: async (r: AiCheckBrief) => unwrap(await actor!.readAiCheck(r.id)), onSuccess: onShown, onError: fail });
  const finish = useMutation({
    mutationFn: async (x: { id: bigint; o: AiCheckOutcome }) => unwrap(await actor!.finishAiCheck(x.id, x.o)),
    onSuccess: (_d, x) => { toast.show({ kind: "ok", text: x.o === AiCheckOutcome.seen ? C.seenOk : C.cancelOk }); onShown(null); refresh(); },
    onError: fail,
  });
  const again = useMutation({
    mutationFn: async (r: AiCheckBrief) => unwrap(await actor!.runAiCheckAi(r.id)),
    onSuccess: (r) => { toast.show({ kind: r.status === "voorstel" ? "ok" : "error", text: r.status === "voorstel" ? (r.dry ? C.dry : C.proposed) : C.failed }); refresh(); },
    onError: fail,
  });
  return { open, finish, again, refresh, toast };
}

/** 3.9: bij Vergelijken van een prijsvraag. */
export function TenderCheckPanel({ tenderId, items, drafts, target0, isOpen, onUse }: { tenderId: bigint; items: TenderItemView[]; drafts: TenderDraftRef[]; target0: string; isOpen: boolean; onUse: (picks: Map<string, bigint>, reasons: Record<string, string>) => void }) {
  const { actor } = useBackend();
  const target: AiCheckTargetIn = { __kind__: "tender", tender: tenderId };
  const q = useChecks(target);
  const [start, setStart] = useState(false);
  const [shown, setShown] = useState<AiCheckFull | null>(null);
  const [cancel, setCancel] = useState<AiCheckBrief | null>(null);
  const [applyTo, setApplyTo] = useState(target0);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setApplyTo(target0); }, [target0]);
  const { open, finish, again, refresh, toast } = useActions(setShown);
  const chosen = (shown?.picks ?? []).filter((p) => p.oaQuoteId !== undefined);
  const apply = useMutation({
    mutationFn: async () => unwrap(await actor!.applyTenderCheck(shown!.brief.id, chosen.map((p) => ({ itemId: p.itemId, oaQuoteId: p.oaQuoteId, reason: p.reason })), BigInt(applyTo))),
    onSuccess: (r) => { toast.show({ kind: "ok", text: C.applied(Number(r.lines)) }); if (r.skipped.length) toast.show({ kind: "error", text: r.skipped.join("; ") }); setConfirm(false); setShown(null); refresh(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const use = () => {
    onUse(new Map(chosen.map((p) => [String(p.itemId), p.oaQuoteId as bigint])), Object.fromEntries(chosen.map((p) => [String(p.itemId), p.reason])));
    toast.show({ kind: "ok", text: C.usedPicks });
    setShown(null);
  };
  if (q.isError) return null;
  const rows = q.data ?? [];
  const live = shown?.brief.status === "voorstel";
  return (
    <section className="vs-section" data-testid="ac-tender">
      <h2 className="bw-h3">{C.tenderTitle}</h2>
      <p className="bw-muted">{C.tenderLead}</p>
      {isOpen && <Button onClick={() => setStart(true)} data-testid="ac-start">{C.start}</Button>}
      {q.data && rows.length === 0 && <p className="bw-muted">{C.none}</p>}
      <Rows rows={rows} onOpen={(r) => open.mutate(r)} onAgain={(r) => again.mutate(r)} onCancel={setCancel} busyOpen={open.isPending} busyAgain={again.isPending} />
      {start && <StartSheet target={target} onClose={() => setStart(false)} />}
      {shown && (
        <Sheet title={C.resultTitle} open wide onClose={() => setShown(null)} side footer={<>
          <Button onClick={() => setShown(null)}>{t.common.close}</Button>
          {live && <Button busy={finish.isPending} onClick={() => finish.mutate({ id: shown.brief.id, o: AiCheckOutcome.seen })} data-testid="ac-seen">{C.seen}</Button>}
          {live && isOpen && chosen.length > 0 && !shown.brief.stale && <Button onClick={use} data-testid="ac-use">{C.usePicks}</Button>}
        </>}>
          <div data-testid="ac-result">
            <Head full={shown} />
            {shown.picks.length > 0 && (
              <>
                <h3 className="bw-h4">{C.picksTitle}</h3>
                <ul className="a-list" data-testid="ac-picks">
                  {shown.picks.map((p) => { const x = items[Number(p.pos) - 1]; return <li key={String(p.itemId)}><span className="a-list__main"><b>{x ? `${x.code ? `${x.code} ` : ""}${x.title}` : C.post(Number(p.pos))}</b><span className="bw-muted">{[p.oaQuoteId !== undefined ? p.orgName : C.noPick, p.reason].filter(Boolean).join(" · ")}</span></span></li>; })}
                </ul>
              </>
            )}
            <Findings full={shown} items={items} />
            <p className="bw-muted">{C.notChecked}</p>
            {live && isOpen && chosen.length > 0 && !shown.brief.stale && (drafts.length > 0 ? (
              <div className="oq-bar">
                <select className="bw-input pv-sm" aria-label={C.applyTo} value={applyTo} onChange={(e) => setApplyTo(e.target.value)} data-testid="ac-apply-to">{drafts.map((x) => <option key={String(x.versionId)} value={String(x.versionId)}>{t.offertes.version(Number(x.version))}</option>)}</select>
                <Button variant="primary" disabled={!applyTo} onClick={() => setConfirm(true)} data-testid="ac-apply">{C.apply}</Button>
              </div>
            ) : <p className="bw-muted">{C.applyNone}</p>)}
          </div>
        </Sheet>
      )}
      <Confirm open={confirm && !!shown} title={C.applyTitle} text={C.applyText(chosen.length, Number(drafts.find((x) => String(x.versionId) === applyTo)?.version ?? 0n))} confirmLabel={C.apply} cancelLabel={C.back} busy={apply.isPending} onConfirm={() => apply.mutate()} onClose={() => setConfirm(false)} />
      {cancel && <Confirm open title={C.cancelTitle} text={C.cancelText} confirmLabel={C.cancelConfirm} cancelLabel={C.back} busy={finish.isPending} onConfirm={() => { finish.mutate({ id: cancel.id, o: AiCheckOutcome.cancelled }); setCancel(null); }} onClose={() => setCancel(null)} />}
    </section>
  );
}

/** 3.11: in het venster Versturen. Niet blokkerend: de opmerkingen van het laatste voorstel op deze versie staan er meteen bij. */
export function QuoteReviewPanel({ versionId }: { versionId: bigint }) {
  const target: AiCheckTargetIn = { __kind__: "quote", quote: versionId };
  const q = useChecks(target);
  const [start, setStart] = useState(false);
  const [shown, setShown] = useState<AiCheckFull | null>(null);
  const [cancel, setCancel] = useState<AiCheckBrief | null>(null);
  const { open, finish, again } = useActions(setShown);
  const rows = q.data ?? [];
  // Het nieuwste voorstel meteen lezen (update-call met auditregel), zodat de opmerkingen bij Versturen staan.
  const latest = rows.find((r) => r.status === "voorstel");
  const [auto, setAuto] = useState<string>("");
  useEffect(() => {
    if (latest && auto !== String(latest.id) && !open.isPending) { setAuto(String(latest.id)); open.mutate(latest); }
  }, [latest, auto, open]);
  if (q.isError) return null;
  const waiting = rows.some((r) => r.status === "open");
  return (
    <section className="q-sendcheck" data-testid="ac-quote">
      <p><b>{C.quoteTitle}</b></p>
      <p className="bw-muted">{C.quoteLead}</p>
      {shown && (
        <div data-testid="ac-remarks">
          <p><b>{C.remarksSend}</b></p>
          <Head full={shown} />
          {shown.findings.length === 0 ? <p className="bw-muted">{C.remarksNone}</p> : <Findings full={shown} />}
          <p className="bw-muted">{C.notChecked}</p>
          {shown.brief.status === "voorstel" && <Button variant="quiet" busy={finish.isPending} onClick={() => finish.mutate({ id: shown.brief.id, o: AiCheckOutcome.seen })} data-testid="ac-seen">{C.seen}</Button>}
        </div>
      )}
      {waiting && <p className="bw-muted" data-testid="ac-wait">{C.remarksWait}</p>}
      <Button onClick={() => setStart(true)} data-testid="ac-start">{C.startQuote}</Button>
      {rows.length > 0 && <details><summary>{C.history(rows.length)}</summary><Rows rows={rows} onOpen={(r) => open.mutate(r)} onAgain={(r) => again.mutate(r)} onCancel={setCancel} busyOpen={open.isPending} busyAgain={again.isPending} /></details>}
      {start && <StartSheet target={target} onClose={() => setStart(false)} />}
      {cancel && <Confirm open title={C.cancelTitle} text={C.cancelText} confirmLabel={C.cancelConfirm} cancelLabel={C.back} busy={finish.isPending} onConfirm={() => { finish.mutate({ id: cancel.id, o: AiCheckOutcome.cancelled }); setCancel(null); }} onClose={() => setCancel(null)} />}
    </section>
  );
}
