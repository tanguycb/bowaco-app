// OA-factuur laten controleren (stap 3.10, bouwplan §6 "Twee wegen voor AI"). Kantoor (beheerder, calculator) geeft een opdracht op
// een OA-factuur: een bot leest de bijlage (PDF, foto of Peppol-UBL) via de MCP-connector en legt ze naast het dossier, of Caffeine
// leest de geplakte tekst. Het resultaat is altijd een voorstel (goedkeuren · navragen · weigeren) met bevindingen; kantoor beslist met
// de gewone knoppen van de factuur. Het resultaat komt enkel uit readInvCheck (update-call met auditregel).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { InvCheckOutcome, type FileView, type InvCheckBrief, type InvCheckFull, type InvCheckWay } from "../backend";
import { Button, Choice, Confirm, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtEuro, fmtTime, unwrap, useBackend } from "../util";
import { Field } from "./Werven";
import { prepareUpload } from "../lib/uploadPrep";

const C = t.factuurControle;
const MAX_BYTES = 1_350_000;
const BOT_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/xml", "text/xml"];

function useRefresh() {
  const qc = useQueryClient();
  return () => { for (const k of ["invChecks", "oaInvoiceFull"]) void qc.invalidateQueries({ queryKey: [k] }); };
}

/** Een opdracht geven: een bot (de bijlage of een gekozen bestand) of Caffeine (tekst). */
function StartSheet({ invoiceId, workId, file: file0, onClose }: { invoiceId: bigint; workId: bigint; file?: FileView; onClose: () => void }) {
  // Review 3.10 L7: de bijlage enkel aanbieden als een bot ze kan lezen (type en grootte).
  const file = file0 && BOT_MIMES.includes(file0.mime) && Number(file0.size) <= MAX_BYTES ? file0 : undefined;
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const refresh = useRefresh();
  const bots = useQuery({ queryKey: ["invCheckBots", String(workId)], queryFn: () => actor!.listInvCheckBots(workId), enabled: !!actor && !isFetching });
  const aiOk = useQuery({ queryKey: ["invCheckAiReady"], queryFn: () => actor!.invCheckAiReady(), enabled: !!actor && !isFetching });
  const ways = [...(bots.data ?? []).map((b) => ({ value: `bot:${b.id}`, label: C.wayBot(b.name) })), ...(aiOk.data ? [{ value: "ai", label: C.wayCaffeine }] : [])];
  const [way, setWay] = useState("");
  const [own, setOwn] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = way || ways[0]?.value || "";
  const isAi = chosen === "ai";
  const useAttached = !!file && !own;
  const ready = chosen !== "" && (isAi ? text.trim().length > 0 : useAttached || !!own);
  const send = async () => {
    setBusy(true);
    try {
      const w: InvCheckWay = isAi ? { __kind__: "ai", ai: null } : { __kind__: "bot", bot: BigInt(chosen.slice(4)) };
      let content: Uint8Array<ArrayBuffer>;
      let mime = "text/plain";
      let name: string = C.textName;
      if (isAi) {
        content = new TextEncoder().encode(text.trim()) as Uint8Array<ArrayBuffer>;
      } else if (useAttached) {
        // De bijlage van de factuur: de browser haalt ze (vertrouwelijk) en geeft de bytes door; de bot krijgt nooit een link.
        const f = unwrap(await actor!.readConfidentialFile(file!.id));
        if (!f.blob) throw new Error(t.common.error);
        content = new Uint8Array(await f.blob.getBytes()) as Uint8Array<ArrayBuffer>;
        mime = f.mime;
        name = f.name;
      } else {
        const isXml = own!.type.includes("xml") || own!.name.toLowerCase().endsWith(".xml");
        const pf = isXml ? own! : await prepareUpload(own!);
        content = new Uint8Array(await pf.arrayBuffer());
        mime = isXml ? "application/xml" : pf.type || "application/pdf";
        name = pf.name;
      }
      if (!isAi && content.length > MAX_BYTES) throw new Error(C.tooBig);
      const id = unwrap(await actor!.startInvCheck({ invoiceId, way: w, name, mime, content }));
      if (isAi) {
        const r = unwrap(await actor!.runInvCheckAi(id));
        toast.show({ kind: r.status === "voorstel" ? "ok" : "error", text: r.status === "voorstel" ? (r.dry ? C.dry : C.proposed) : C.failed });
      } else {
        toast.show({ kind: "ok", text: C.started });
      }
      refresh();
      onClose();
    } catch (e) { toast.show({ kind: "error", text: errText(e) }); } finally { setBusy(false); }
  };
  return (
    <Sheet title={C.sheetTitle} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={!ready} onClick={() => void send()} data-testid="ic-send">{C.send}</Button></>}>
      <p className="bw-muted">{C.lead}</p>
      {bots.data && aiOk.data !== undefined && ways.length === 0 && <p className="a-empty" data-testid="ic-noway">{C.noWay}</p>}
      {ways.length > 0 && <Field label={C.way}><Choice label={C.way} value={chosen} onChange={(x) => setWay(x)} options={ways} /></Field>}
      {ways.length > 0 && !isAi && (
        <>
          {file && <p className="bw-muted" data-testid="ic-attached">{own ? C.ownFile : C.attached(file.name)}</p>}
          <Field label={file ? C.otherFile : C.file}><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,application/xml,text/xml,.xml" onChange={(e) => setOwn(e.target.files?.[0] ?? null)} data-testid="ic-file" /></Field>
        </>
      )}
      {isAi && <Field label={C.text}><textarea className="bw-input" rows={12} maxLength={60_000} value={text} onChange={(e) => setText(e.target.value)} data-testid="ic-text" /></Field>}
    </Sheet>
  );
}

function ResultView({ full }: { full: InvCheckFull }) {
  const r = full.result;
  if (!r) return <p className="bw-muted">{C.noResult}</p>;
  return (
    <div data-testid="ic-result">
      <p><span className={`a-tag ${r.verdict === "goedkeuren" ? "a-tag--ok" : "a-tag--warn"}`} data-testid="ic-verdict">{C.verdicts[r.verdict] ?? r.verdict}</span> <span className="bw-muted">{C.from(full.brief.botName, Number(r.confidence))}</span></p>
      {r.summary && <p>{r.summary}</p>}
      {r.findings.length > 0 && (
        <ul className="vs-findings" data-testid="ic-findings">
          {r.findings.map((f, k) => <li key={k}><span className={`a-tag ${f.severity === "fout" ? "a-tag--warn" : ""}`}>{C.severities[f.severity] ?? f.severity}</span> <b>{C.kinds[f.kind] ?? f.kind}</b>: {f.text}{f.cents !== undefined ? ` (${fmtEuro(f.cents)})` : ""}</li>)}
        </ul>
      )}
      <p className="bw-muted">{C.notChecked}</p>
    </div>
  );
}

/** Op de factuur: de controleopdrachten, het resultaat bekijken, gezien of annuleren. Beslissen = de gewone knoppen erboven. */
export function InvCheckPanel({ invoiceId, workId, file, canStart }: { invoiceId: bigint; workId: bigint; file?: FileView; canStart: boolean }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const refresh = useRefresh();
  const q = useQuery({ queryKey: ["invChecks", String(invoiceId), canStart], queryFn: () => actor!.listInvChecks(invoiceId), enabled: !!actor && !isFetching, retry: 0,
    // Chrome-test 3.10: een bot antwoordt buiten de app; zolang er een opdracht wacht, kijkt de lijst elke 15 s opnieuw.
    refetchInterval: (qq) => (qq.state.data ?? []).some((r) => r.status === "open" && r.way !== "caffeine") ? 15_000 : false });
  const [start, setStart] = useState(false);
  const [shown, setShown] = useState<InvCheckFull | null>(null);
  const [cancel, setCancel] = useState<InvCheckBrief | null>(null);
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const open = useMutation({ mutationFn: async (r: InvCheckBrief) => unwrap(await actor!.readInvCheck(r.id)), onSuccess: setShown, onError: fail, gcTime: 0 });
  const finish = useMutation({
    mutationFn: async (x: { r: InvCheckBrief; o: InvCheckOutcome }) => unwrap(await actor!.finishInvCheck(x.r.id, x.o)),
    onSuccess: (_d, x) => { toast.show({ kind: "ok", text: x.o === InvCheckOutcome.seen ? C.seenOk : C.cancelOk }); setShown(null); setCancel(null); refresh(); },
    onError: fail,
  });
  const again = useMutation({
    mutationFn: async (r: InvCheckBrief) => unwrap(await actor!.runInvCheckAi(r.id)),
    onSuccess: (r) => { toast.show({ kind: r.status === "voorstel" ? "ok" : "error", text: r.status === "voorstel" ? (r.dry ? C.dry : C.proposed) : C.failed }); refresh(); },
    onError: fail,
  });
  const rows = q.data ?? [];
  if (q.isError) return null;
  return (
    <section className="vs-section" data-testid="ic-panel">
      <h2 className="bw-h3">{C.title}</h2>
      <p className="bw-muted">{C.panelLead}</p>
      {canStart && <Button onClick={() => setStart(true)} data-testid="ic-start">{C.start}</Button>}
      {q.data && rows.length === 0 && <p className="bw-muted">{C.none}</p>}
      <ul className="a-list">
        {rows.map((r) => {
          const live = r.status === "open" || r.status === "voorstel";
          return (
            <li key={String(r.id)} data-testid="ic-row">
              <span className="a-list__main">
                <b>{r.botName}</b>
                <span className="bw-muted">{[r.name, C.by(r.createdByName, fmtTime(r.createdAt)), r.verdict ? C.verdicts[r.verdict] ?? r.verdict : "", r.reason].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="a-tag" data-testid="ic-status">{C.status[r.status] ?? r.status}</span>
              {r.verdict && <Button variant="primary" busy={open.isPending} onClick={() => open.mutate(r)} data-testid="ic-open">{C.open}</Button>}
              {canStart && r.way === "caffeine" && r.status === "open" && <Button busy={again.isPending} onClick={() => again.mutate(r)} data-testid="ic-again">{C.again}</Button>}
              {live && <Button variant="quiet" onClick={() => setCancel(r)} data-testid="ic-cancel">{C.cancel}</Button>}
            </li>
          );
        })}
      </ul>
      {start && <StartSheet invoiceId={invoiceId} workId={workId} file={file} onClose={() => setStart(false)} />}
      {shown && (
        <Sheet title={C.resultTitle} open onClose={() => setShown(null)} side footer={<><Button onClick={() => setShown(null)}>{t.common.close}</Button>{shown.brief.status === "voorstel" && <Button variant="primary" busy={finish.isPending} onClick={() => finish.mutate({ r: shown.brief, o: InvCheckOutcome.seen })} data-testid="ic-seen">{C.seen}</Button>}</>}>
          <ResultView full={shown} />
        </Sheet>
      )}
      {cancel && <Confirm open title={C.cancelTitle} text={C.cancelText} confirmLabel={C.cancelConfirm} cancelLabel={C.back} busy={finish.isPending} onConfirm={() => finish.mutate({ r: cancel, o: InvCheckOutcome.cancelled })} onClose={() => setCancel(null)} />}
    </section>
  );
}
