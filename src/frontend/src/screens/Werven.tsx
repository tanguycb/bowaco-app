// Werven (1.1): lijst met zoeken en deelwerven, nieuwe werf of deelwerf, en de onderdelen die de
// werfpagina (Werf.tsx) gebruikt. Wat iemand mag, beslist de backend (Rights.mo).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalBlob, type Caps, type FileView, type WorkView } from "../backend";
import { Button, Choice, Icon, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { OpenConfidential } from "./Dossier";
import { errText, fmtBytes, fmtTime, unwrap, useBackend } from "../util";
import { Loading, Page, RoleTags, useWorks, WorkList } from "./common";

/** Hoofdwerven met hun deelwerven er meteen onder; zoeken op code, naam of gemeente. */
function nested(works: WorkView[], q: string): WorkView[] {
  const s = q.trim().toLowerCase();
  const hit = (w: WorkView) => !s || [w.code, w.name, w.address.city, w.analyticCode ?? ""].some((x) => x.toLowerCase().includes(s));
  const byCode = (a: WorkView, b: WorkView) => a.code.localeCompare(b.code, "nl");
  const tops = works.filter((w) => w.parentId === undefined || !works.some((p) => p.id === w.parentId)).sort(byCode);
  const out: WorkView[] = [];
  for (const top of tops) {
    const subs = works.filter((w) => w.parentId === top.id).sort(byCode);
    if (hit(top) || subs.some(hit)) out.push(top, ...subs.filter((x) => hit(x) || hit(top)));
  }
  return out;
}

export function Werven({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const works = useWorks();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = works.data ? nested(works.data, q) : [];
  return (
    <Page title={t.werven.title} actions={caps.createWork && <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>{t.werven.new}</Button>}>
      {works.data && works.data.length > 6 && <input className="bw-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.werven.search} aria-label={t.werven.search} />}
      <Loading q={works} />
      {works.data && <WorkList works={list} go={go} empty={q ? t.werven.noMatch : t.werven.empty} />}
      {open && <NewWork onClose={() => setOpen(false)} go={go} />}
    </Page>
  );
}

/** Nieuwe werf, of een deelwerf van `parent` (zelfde adres, klant en btw als vertrekpunt). */
export function NewWork({ onClose, parent, go }: { onClose: () => void; parent?: WorkView; go?: (to: string) => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    code: parent ? `${parent.code}-` : "",
    name: parent ? `${parent.name} ` : "",
    street: parent?.address.street ?? "",
    number: parent?.address.number ?? "",
    zip: parent?.address.zip ?? "",
    city: parent?.address.city ?? "",
    vat: parent ? Number(parent.vatBp) : 600,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await actor!.createWork({
        code: f.code,
        name: f.name,
        address: { street: f.street, number: f.number, zip: f.zip, city: f.city, country: "BE" },
        parentId: parent?.id,
        clientOrgId: parent?.clientOrgId,
        architectOrgId: parent?.architectOrgId,
        leaderPersonId: undefined,
        vatBp: BigInt(f.vat),
      })),
    onSuccess: (w) => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["works"] }); onClose(); go?.(`werven/${w.id}`); },
  });
  return (
    <Sheet title={parent ? `${t.werven.newSub} · ${parent.code}` : t.werven.new} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <div className="a-grid2">
          <Field label={t.werven.code}><input className="bw-input bw-mono" value={f.code} onChange={set("code")} placeholder="2026-231" /></Field>
          <Field label={t.werven.vat}><Choice label={t.werven.vat} value={f.vat} onChange={(v) => setF({ ...f, vat: v })} options={[{ value: 600, label: "6 %" }, { value: 2100, label: "21 %" }]} /></Field>
        </div>
        <Field label={t.werven.name}><input className="bw-input" value={f.name} onChange={set("name")} /></Field>
        <div className="a-grid3">
          <Field label={t.werven.street}><input className="bw-input" value={f.street} onChange={set("street")} /></Field>
          <Field label={t.werven.number}><input className="bw-input" value={f.number} onChange={set("number")} /></Field>
          <Field label={t.werven.zip}><input className="bw-input" value={f.zip} onChange={set("zip")} inputMode="numeric" /></Field>
        </div>
        <Field label={t.werven.city}><input className="bw-input" value={f.city} onChange={set("city")} /></Field>
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="bw-field">
      <span className="bw-label">{label}</span>
      {children}
    </label>
  );
}

// Foto's worden op het toestel verkleind (≤ 1600 px, JPEG): kleiner en zonder EXIF-locatie (§8.5).
export async function shrinkPhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Verkleinen mislukt"))), "image/jpeg", 0.82));
}

export function Files({ workId, canUpload, title, canConfidential }: { workId: bigint; canUpload: boolean; title?: string; canConfidential?: boolean }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  // Bestanden van anderen verschijnen zonder herladen: bij terugkeren naar het tabblad en elke 30 s.
  const files = useQuery({ queryKey: ["files", String(workId)], queryFn: () => actor!.listFiles(workId), enabled: !!actor && !isFetching, refetchOnWindowFocus: true, refetchInterval: 30_000 });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const isImage = file.type.startsWith("image/");
      const data = isImage ? await shrinkPhoto(file) : file;
      const mime = isImage ? "image/jpeg" : file.type;
      const name = isImage ? file.name.replace(/\.[^.]+$/, "") + ".jpg" : file.name;
      const bytes = new Uint8Array(await data.arrayBuffer());
      setProgress(0);
      const blob = ExternalBlob.fromBytes(bytes, mime, name).withUploadProgress(setProgress);
      return unwrap(await actor!.addFile(name, mime, BigInt(bytes.length), blob, workId, false));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["files", String(workId)] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
    onSettled: () => setProgress(null),
  });
  const sorted = (files.data ?? []).slice().sort((a, b) => Number(b.at - a.at));
  return (
    <section className="a-section">
      <h2 className="bw-h2">{title ?? t.werven.files}</h2>
      {canUpload && (
        <label className="bw-btn bw-btn--secondary" style={{ position: "relative" }}>
          <Icon name="camera" size={22} />
          {upload.isPending ? t.werven.uploading(progress ?? 0) : t.werven.upload}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={upload.isPending} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
        </label>
      )}
      <Loading q={files} />
      {files.data && sorted.length === 0 && <p className="a-empty">{t.werven.noFiles}</p>}
      {sorted.length > 0 && (
        <ul className="a-list">
          {sorted.map((f) => <FileRow key={String(f.id)} f={f} canConfidential={!!canConfidential} />)}
        </ul>
      )}
    </section>
  );
}

function FileRow({ f, canConfidential }: { f: FileView; canConfidential: boolean }) {
  const url = f.blob?.getDirectURL();
  return (
    <li>
      <span className="a-list__main">
        <b>{f.name}</b>
        <span className="bw-muted bw-num">{fmtBytes(Number(f.size))} · {fmtTime(f.at)}</span>
      </span>
      {f.confidential && <span className="a-tag a-tag--warn">{t.werven.confidential}</span>}
      {url && <a className="bw-btn bw-btn--quiet" href={url} target="_blank" rel="noreferrer">{t.werven.open}</a>}
      {/* P-15 (1.1): ook een los vertrouwelijk bestand opent, via de gelogde update-call (R12, R23). */}
      {!url && f.confidential && canConfidential && <OpenConfidential fileId={f.id} />}
    </li>
  );
}
