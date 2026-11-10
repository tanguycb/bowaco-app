// OA-offerte laten inlezen (stap 3.8, bouwplan §6 "Twee wegen voor AI"). Kantoor (beheerder, calculator) geeft een opdracht: een bot
// leest de PDF of foto via de MCP-connector, of Caffeine leest de geplakte tekst. Het resultaat is altijd eerst een voorstel: kantoor
// neemt het over in het formulier van 2c.3 (HandSheet) en registreert zelf. Het voorstel met de bedragen komt enkel uit readOaRead
// (update-call met auditregel). Een bot op Zelf doen (na een geslaagde proefronde) laat de app de offerte zelf registreren.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalBlob, OrgKind, type OaReadBrief, type OaReadFull, type OaReadWay } from "../backend";
import { Button, Choice, Confirm, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtTime, unwrap, useBackend } from "../util";
import { Field } from "./Werven";
import { prepareUpload } from "../lib/uploadPrep";

const R = t.oaInlezen;
export const READ_MAX_BYTES = 1_350_000;

export type ReadTarget = { workId: bigint; inviteId?: bigint; orgId?: bigint; orgName?: string };

function useRefreshReads() {
  const qc = useQueryClient();
  return () => { for (const k of ["oaReads", "oaQuotes", "tender", "tenders"]) void qc.invalidateQueries({ queryKey: [k] }); };
}

/** Een opdracht geven: een bot (bestand) of Caffeine (tekst). */
export function StartReadSheet({ target, onClose }: { target: ReadTarget; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const refresh = useRefreshReads();
  const loose = target.inviteId === undefined;
  const bots = useQuery({ queryKey: ["oaReadBots", String(target.workId)], queryFn: () => actor!.listOaReadBots(target.workId), enabled: !!actor && !isFetching });
  const aiOk = useQuery({ queryKey: ["oaReadAiReady"], queryFn: () => actor!.oaReadAiReady(), enabled: !!actor && !isFetching });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching && loose });
  const ways = [...(bots.data ?? []).map((b) => ({ value: `bot:${b.id}`, label: R.wayBot(b.name) })), ...(aiOk.data ? [{ value: "ai", label: R.wayCaffeine }] : [])];
  const [way, setWay] = useState("");
  const [orgId, setOrgId] = useState(target.orgId !== undefined ? String(target.orgId) : "");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const chosen = way || ways[0]?.value || "";
  const isAi = chosen === "ai";
  const ready = chosen !== "" && orgId !== "" && (isAi ? text.trim().length > 0 : !!file);
  const send = async () => {
    setBusy(true);
    try {
      const w: OaReadWay = isAi ? { __kind__: "ai", ai: null } : { __kind__: "bot", bot: BigInt(chosen.slice(4)) };
      let content: Uint8Array<ArrayBuffer>;
      let mime = "text/plain";
      let name = "tekst van de offerte";
      let blob: ExternalBlob | undefined;
      if (isAi) {
        content = new TextEncoder().encode(text.trim()) as Uint8Array<ArrayBuffer>;
      } else {
        const pf = await prepareUpload(file!);
        content = new Uint8Array(await pf.arrayBuffer());
        if (content.length > READ_MAX_BYTES) throw new Error(R.tooBig);
        mime = pf.type || "application/pdf";
        name = pf.name;
        setProgress(0);
        blob = ExternalBlob.fromBytes(content, mime, name).withUploadProgress(setProgress);
      }
      const id = unwrap(await actor!.startOaRead({ workId: target.workId, orgId: BigInt(orgId), inviteId: target.inviteId, way: w, name, mime, content, blob }));
      if (isAi) {
        const r = unwrap(await actor!.runOaReadAi(id));
        toast.show({ kind: r.status === "voorstel" ? "ok" : "error", text: r.status === "voorstel" ? (r.dry ? R.dry : R.proposed) : R.failed });
      } else {
        toast.show({ kind: "ok", text: R.started });
      }
      refresh();
      onClose();
    } catch (e) { toast.show({ kind: "error", text: errText(e) }); } finally { setBusy(false); setProgress(null); }
  };
  const subs = (orgs.data ?? []).filter((o) => o.kind === OrgKind.subcontractor || o.kind === OrgKind.supplier).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Sheet title={R.sheetTitle(target.orgName ?? "")} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={!ready} onClick={() => void send()} data-testid="or-send">{progress !== null ? R.busy(progress) : isAi ? R.sendRead : R.send}</Button></>}>
      <p className="bw-muted">{R.lead}</p>
      {bots.data && aiOk.data !== undefined && ways.length === 0 && <p className="a-empty" data-testid="or-noway">{R.noWay}</p>}
      {ways.length > 0 && <Field label={R.way}><Choice label={R.way} value={chosen} onChange={(x) => setWay(x)} options={ways} /></Field>}
      {loose && (
        <Field label={R.firm}>
          <select className="bw-input" value={orgId} onChange={(e) => setOrgId(e.target.value)} data-testid="or-org">
            <option value="">{R.pick}</option>
            {subs.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
          </select>
        </Field>
      )}
      {ways.length > 0 && !isAi && <Field label={R.file}><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="or-file" /></Field>}
      {isAi && <Field label={R.text}><textarea className="bw-input" rows={12} maxLength={60_000} value={text} onChange={(e) => setText(e.target.value)} data-testid="or-text" /></Field>}
    </Sheet>
  );
}

/** De opdrachten van een werf; "Voorstel overnemen" opent het formulier met het voorstel (onUse). */
export function ReadList({ workId, onUse }: { workId: bigint; onUse: (full: OaReadFull) => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const refresh = useRefreshReads();
  const q = useQuery({ queryKey: ["oaReads", String(workId)], queryFn: () => actor!.listOaReads(workId), enabled: !!actor && !isFetching, retry: 0 });
  const [ask, setAsk] = useState<{ k: "reject" | "cancel"; r: OaReadBrief } | null>(null);
  const [reason, setReason] = useState("");
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const open = useMutation({ mutationFn: async (r: OaReadBrief) => unwrap(await actor!.readOaRead(r.id)), onSuccess: onUse, onError: fail, gcTime: 0 });
  const finish = useMutation({
    mutationFn: async (x: { k: "reject" | "cancel"; r: OaReadBrief }) => unwrap(await actor!.finishOaRead(x.r.id, x.k === "reject" ? { __kind__: "rejected", rejected: reason } : { __kind__: "cancelled", cancelled: null })),
    onSuccess: (_d, x) => { toast.show({ kind: "ok", text: x.k === "reject" ? R.rejectOk : R.cancelOk }); setAsk(null); setReason(""); refresh(); },
    onError: fail,
  });
  const rows = q.data ?? [];
  return (
    <div className="pv-card" data-testid="or-list">
      <b>{R.listTitle}</b>
      {q.data && rows.length === 0 && <p className="bw-muted">{R.listNone}</p>}
      <ul className="a-list">
        {rows.map((r) => {
          const live = r.status === "open" || r.status === "voorstel";
          return (
            <li key={String(r.id)} data-testid="or-row" style={{ flexWrap: "wrap" }}>
              <span className="a-list__main" style={{ minWidth: "14rem" }}>
                <b>{r.orgName}</b>
                <span className="bw-muted">{[r.tenderCode, r.botName, r.name, R.by(r.createdByName, fmtTime(r.createdAt))].filter(Boolean).join(" · ")}{r.reason ? ` · ${r.reason}` : ""}</span>
              </span>
              <span className="a-tag" data-testid="or-status">{r.auto ? R.auto : (R.status[r.status] ?? r.status)}</span>
              {r.status === "voorstel" && <Button variant="primary" busy={open.isPending} onClick={() => open.mutate(r)} data-testid="or-use">{R.use}</Button>}
              {r.status === "voorstel" && <Button variant="quiet" onClick={() => setAsk({ k: "reject", r })} data-testid="or-reject">{R.reject}</Button>}
              {live && <Button variant="quiet" onClick={() => setAsk({ k: "cancel", r })} data-testid="or-cancel">{R.cancel}</Button>}
            </li>
          );
        })}
      </ul>
      {ask?.k === "cancel" && <Confirm open title={R.cancelTitle} text={R.cancelText} confirmLabel={R.cancelConfirm} cancelLabel={R.back} busy={finish.isPending} onConfirm={() => finish.mutate(ask)} onClose={() => setAsk(null)} />}
      {ask?.k === "reject" && (
        <Sheet title={R.rejectTitle} open onClose={() => setAsk(null)} footer={<><Button onClick={() => setAsk(null)}>{t.common.cancel}</Button><Button variant="danger" busy={finish.isPending} disabled={reason.trim().length === 0} onClick={() => finish.mutate(ask)} data-testid="or-reject-ok">{R.reject}</Button></>}>
          <Field label={R.rejectReason}><input className="bw-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="or-reason" /></Field>
        </Sheet>
      )}
    </div>
  );
}

/** Bovenaan het formulier: van wie het voorstel komt en de opmerkingen (onbetrouwbare tekst: enkel tonen). */
export function ReadBanner({ read }: { read: OaReadFull }) {
  const p = read.proposal;
  if (!p) return null;
  return (
    <div className="pv-card" data-testid="or-banner">
      <p><b>{R.banner(read.brief.botName, Number(p.confidence))}</b></p>
      {p.remarks.length > 0 && (
        <>
          <p className="bw-muted">{R.remarks}</p>
          <ul className="a-list">{p.remarks.map((x, k) => <li key={k}>{x}</li>)}</ul>
        </>
      )}
    </div>
  );
}
