// Documentenlijst en checklist per werf (stap 1.1, A5 voorlopig). De backend geeft enkel wat de beller
// mag zien (Rights.mayReadDoc) en zegt per document of hij een bestand mag leveren (canDeliver).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Applies, DocStatus, ExternalBlob, type ChecklistLine, type DocKindView, type DocumentView, type WorkView } from "../backend";
import { Button, Confirm, Icon, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, inputToDay, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { Field, shrinkPhoto } from "./Werven";

const STATUS_TAG: Record<string, string> = {
  missing: "a-tag--bad",
  requested: "a-tag--warn",
  received: "a-tag--accent",
  approved: "a-tag--ok",
  expired: "a-tag--bad",
  notApplicable: "",
};

function StatusTag({ status }: { status: DocStatus }) {
  return <span className={`a-tag ${STATUS_TAG[status] ?? ""}`}>{t.docs.statuses[status] ?? status}</span>;
}

export function Dossier({ w }: { w: WorkView }) {
  const { actor, isFetching } = useBackend();
  const dossier = useQuery({ queryKey: ["dossier", String(w.id)], queryFn: () => actor!.getDossier(w.id), enabled: !!actor && !isFetching, refetchOnWindowFocus: true });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<DocumentView | null>(null);
  const d = dossier.data;
  const inChecklist = new Set(d?.checklist.map((l) => l.doc?.id).filter((x) => x !== undefined).map(String));
  const others = (d?.documents ?? []).filter((x) => !inChecklist.has(String(x.id)));
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.docs.heading}</h2>
        {d && (d.canManage || d.deliverKinds.length > 0) && <Button icon="plus" onClick={() => setAdding(true)}>{t.docs.add}</Button>}
      </div>
      <Loading q={dossier} />
      {d && (
        <>
          <span className="bw-label">{t.docs.checklist}</span>
          {d.canManage && <p className="bw-muted">{t.docs.checklistLead}</p>}
          {d.checklist.length === 0 && <p className="a-empty">{t.docs.emptyChecklist}</p>}
          {d.checklist.length > 0 && (
            <ul className="a-list">
              {d.checklist.map((l) => <Line key={l.kind} l={l} w={w} canManage={d.canManage} canDeliver={l.doc ? l.doc.canDeliver : d.deliverKinds.some((k) => k.key === l.kind)} onOpen={setOpen} />)}
            </ul>
          )}
          <span className="bw-label">{t.docs.other}</span>
          {others.length === 0 && <p className="a-empty">{t.docs.noDocs}</p>}
          {others.length > 0 && (
            <ul className="a-list">
              {others.map((x) => (
                <li key={String(x.id)} className="a-doc">
                  <span className="a-list__main">
                    <b>{x.title}</b>
                    <span className="bw-muted">{x.kindLabel}{x.files.length > 0 ? ` · ${t.docs.versions(x.files.length)}` : ""}{x.validUntil !== undefined ? ` · ${t.docs.validUntil.toLowerCase()} ${fmtDayNum(x.validUntil)}` : ""}</span>
                  </span>
                  <StatusTag status={x.status} />
                  <Latest doc={x} />
                  {(d.canManage || x.canDeliver) && <Button variant="quiet" onClick={() => setOpen(x)}>{t.team.edit}</Button>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {adding && d && <AddDocument w={w} kinds={d.deliverKinds} canManage={d.canManage} onClose={() => setAdding(false)} />}
      {open && d && <DocSheet w={w} doc={open} canManage={d.canManage} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Latest({ doc }: { doc: DocumentView }) {
  const f = doc.files[doc.files.length - 1];
  if (!f) return null;
  const url = f.blob?.getDirectURL();
  if (!url) return <><span className="a-tag a-tag--warn">{t.werven.confidential}</span><OpenConfidential fileId={f.id} /></>;
  return <a className="bw-btn bw-btn--quiet" href={url} target="_blank" rel="noreferrer">{t.werven.open}</a>;
}

/** Vertrouwelijk bestand: de verwijzing komt enkel uit een update-call met auditregel (R12, R23) en blijft
 *  alleen in het geheugen van dit onderdeel. Eerst ophalen, dan een gewone link die je zelf aanklikt
 *  (een venster openen na het wachten blokkeert de browser). */
function OpenConfidential({ fileId }: { fileId: bigint }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const get = useMutation({
    mutationFn: async () => {
      const f = unwrap(await actor!.readConfidentialFile(fileId));
      const u = f.blob?.getDirectURL();
      if (!u) throw new Error(t.common.error);
      return u;
    },
    onSuccess: setUrl,
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (url) return <a className="bw-btn bw-btn--secondary" href={url} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => setUrl(null), 1000)}>{t.docs.openFile}</a>;
  return <Button variant="quiet" busy={get.isPending} onClick={() => get.mutate()}>{t.werven.open}</Button>;
}

function Line({ l, w, canManage, canDeliver, onOpen }: { l: ChecklistLine; w: WorkView; canManage: boolean; canDeliver: boolean; onOpen: (d: DocumentView) => void }) {
  const doc = l.doc;
  const why = l.applies === Applies.unknown ? t.docs.unknownWhy[l.rule] : undefined;
  return (
    <li className="a-doc">
      <span className="a-list__main">
        <b>{l.name}</b>
        <span className="bw-muted">
          {t.docs.deliverer[l.deliverer] ?? l.deliverer} · {t.docs.rules[l.rule] ?? l.rule}
          {doc?.dueDay !== undefined && doc.status !== DocStatus.received && doc.status !== DocStatus.approved ? ` · ${t.docs.due.toLowerCase()} ${fmtDayNum(doc.dueDay)}` : ""}
          {doc?.validUntil !== undefined ? ` · ${t.docs.validUntil.toLowerCase()} ${fmtDayNum(doc.validUntil)}` : ""}
          {why ? ` · ${why}` : ""}
        </span>
      </span>
      {doc ? <StatusTag status={doc.status} /> : l.applies === Applies.unknown ? <span className="a-tag a-tag--warn">{t.docs.unknownApplies}</span> : <StatusTag status={DocStatus.missing} />}
      {doc && <Latest doc={doc} />}
      {doc && (canManage || doc.canDeliver) && <Button variant="quiet" onClick={() => onOpen(doc)}>{t.team.edit}</Button>}
      {!doc && canDeliver && <UploadButton w={w} kind={l.kind} confidential={false} label={t.docs.upload} />}
    </li>
  );
}

/** Opladen naar de opslagdienst (poort: StorageGate) en het bestand aan het document hangen. */
function UploadButton({ w, kind, docId, confidential, label, onDone }: { w: WorkView; kind: string; docId?: bigint; confidential: boolean; label: string; onDone?: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  const up = useMutation({
    mutationFn: async (file: File) => {
      const isImage = file.type.startsWith("image/");
      const data = isImage ? await shrinkPhoto(file) : file;
      const mime = isImage ? "image/jpeg" : file.type;
      const name = isImage ? file.name.replace(/\.[^.]+$/, "") + ".jpg" : file.name;
      const bytes = new Uint8Array(await data.arrayBuffer());
      setProgress(0);
      const blob = ExternalBlob.fromBytes(bytes, mime, name).withUploadProgress(setProgress);
      const fileId = unwrap(await actor!.addFile(name, mime, BigInt(bytes.length), blob, w.id, confidential));
      return unwrap(await actor!.attachDocumentFile(w.id, kind, docId ?? null, fileId));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["dossier", String(w.id)] }); void qc.invalidateQueries({ queryKey: ["work", String(w.id)] }); void qc.invalidateQueries({ queryKey: ["works"] }); onDone?.(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
    onSettled: () => setProgress(null),
  });
  return (
    <label className="bw-btn bw-btn--secondary" style={{ position: "relative" }}>
      <Icon name="camera" size={20} />
      {up.isPending ? t.werven.uploading(progress ?? 0) : label}
      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={up.isPending} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} />
    </label>
  );
}

function AddDocument({ w, kinds, canManage, onClose }: { w: WorkView; kinds: DocKindView[]; canManage: boolean; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  // Beheerders kiezen uit alle soorten; externen enkel uit wat ze mogen leveren.
  const all = useQuery({ queryKey: ["docKinds", false], queryFn: () => actor!.listDocKinds(false), enabled: !!actor && !isFetching && canManage });
  const list = canManage ? all.data ?? [] : kinds;
  const [kind, setKind] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const k = list.find((x) => x.key === kind);
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveDocument(w.id, { id: undefined, kind, title, dueDay: inputToDay(due), validUntil: undefined, note: "", ownerOrgId: undefined })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["dossier", String(w.id)] }); void qc.invalidateQueries({ queryKey: ["works"] }); onClose(); },
  });
  const canDeliverKind = kinds.some((x) => x.key === kind);
  return (
    <Sheet title={t.docs.add} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.close}</Button>{canManage && <Button variant="primary" disabled={!kind} busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button>}</>}>
      <div className="a-form">
        <Field label={t.docs.kind}>
          <select className="bw-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">—</option>
            {list.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
          </select>
        </Field>
        {canManage && (
          <>
            <Field label={t.docs.title}><input className="bw-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={k?.name} /></Field>
            <Field label={t.docs.due}><input type="date" className="bw-input bw-num" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          </>
        )}
        {k?.confidential && <p className="a-note">{t.docs.confidentialUpload}</p>}
        {kind && canDeliverKind && <UploadButton w={w} kind={kind} confidential={!!k?.confidential} label={t.docs.upload} onDone={onClose} />}
        {kind && canManage && <p className="bw-muted">{t.docs.addHelp}</p>}
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

function DocSheet({ w, doc, canManage, onClose }: { w: WorkView; doc: DocumentView; canManage: boolean; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(doc.title);
  const [due, setDue] = useState(dayToInput(doc.dueDay));
  const [valid, setValid] = useState(dayToInput(doc.validUntil));
  const [note, setNote] = useState(doc.note);
  const [archiving, setArchiving] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["dossier", String(w.id)] }); void qc.invalidateQueries({ queryKey: ["works"] }); void qc.invalidateQueries({ queryKey: ["work", String(w.id)] }); };
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveDocument(w.id, { id: doc.id, kind: doc.kind, title, dueDay: inputToDay(due), validUntil: inputToDay(valid), note, ownerOrgId: doc.ownerOrgId })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); refresh(); onClose(); },
  });
  const status = useMutation({
    mutationFn: async (s: DocStatus) => unwrap(await actor!.setDocumentStatus(doc.id, s, note)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); refresh(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const archive = useMutation({
    mutationFn: async () => unwrap(await actor!.archiveDocument(doc.id)),
    onSuccess: () => { refresh(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const choices = [DocStatus.requested, DocStatus.approved, DocStatus.notApplicable, DocStatus.missing].filter((s) => s !== doc.status && (doc.files.length > 0 || s !== DocStatus.approved));
  return (
    <Sheet title={doc.title} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.close}</Button>{canManage && <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button>}</>}>
      <div className="a-form">
        <div className="a-row"><StatusTag status={doc.status} /><span className="bw-muted">{doc.kindLabel} · {doc.updatedByName}</span></div>
        {doc.files.length > 0 && (
          <ul className="a-list">
            {doc.files.slice().reverse().map((f, i) => {
              const url = f.blob?.getDirectURL();
              return (
                <li key={String(f.id)}>
                  <span className="a-list__main"><b>{f.name}</b><span className="bw-muted">v{doc.files.length - i}</span></span>
                  {url ? <a className="bw-btn bw-btn--quiet" href={url} target="_blank" rel="noreferrer">{t.werven.open}</a> : <><span className="a-tag a-tag--warn">{t.werven.confidential}</span><OpenConfidential fileId={f.id} /></>}
                </li>
              );
            })}
          </ul>
        )}
        {doc.canDeliver && <UploadButton w={w} kind={doc.kind} docId={doc.id} confidential={doc.confidential} label={doc.files.length ? t.docs.newVersion : t.docs.upload} onDone={onClose} />}
        {canManage && (
          <>
            <span className="bw-label">{t.docs.setStatus}</span>
            <div className="a-row">{choices.map((s) => <Button key={s} busy={status.isPending && status.variables === s} onClick={() => status.mutate(s)}>{t.docs.statuses[s]}</Button>)}</div>
            <Field label={t.docs.title}><input className="bw-input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <div className="a-grid2">
              <Field label={t.docs.due}><input type="date" className="bw-input bw-num" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
              <Field label={t.docs.validUntil}><input type="date" className="bw-input bw-num" value={valid} onChange={(e) => setValid(e.target.value)} /></Field>
            </div>
            <Field label={t.docs.note}><input className="bw-input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div><Button variant="quiet" onClick={() => setArchiving(true)}>{t.docs.archive}</Button></div>
          </>
        )}
        {(save.error ?? status.error) && <p className="a-err" role="alert">{errText(save.error ?? status.error)}</p>}
      </div>
      <Confirm open={archiving} title={t.docs.archive} text={t.docs.archiveConfirm} confirmLabel={t.docs.archive} busy={archive.isPending} onConfirm={() => archive.mutate()} onClose={() => setArchiving(false)} />
    </Sheet>
  );
}
