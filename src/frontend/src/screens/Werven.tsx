// Werven (basis voor 1.1): lijst, nieuwe werf, en per werf wie erbij hoort en de bestanden.
// Wat iemand mag, beslist de backend (Rights.mo); een geweigerde handeling toont de reden.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalBlob, Grant, Role, WorkStatus, type Caps, type FileView } from "../backend";
import { Button, Choice, Icon, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtBytes, fmtTime, unwrap, useBackend } from "../util";
import { Loading, Page, RoleTags, useWorks, WorkBadge, WorkList } from "./common";

export function Werven({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const works = useWorks();
  const [open, setOpen] = useState(false);
  return (
    <Page title={t.werven.title} actions={caps.createWork && <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>{t.werven.new}</Button>}>
      <Loading q={works} />
      {works.data && <WorkList works={works.data} go={go} empty={t.werven.empty} />}
      {open && <NewWork onClose={() => setOpen(false)} />}
    </Page>
  );
}

function NewWork({ onClose }: { onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ code: "", name: "", street: "", number: "", zip: "", city: "", vat: 600 });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await actor!.createWork({
        code: f.code,
        name: f.name,
        address: { street: f.street, number: f.number, zip: f.zip, city: f.city, country: "BE" },
        vatBp: BigInt(f.vat),
      })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["works"] }); onClose(); },
  });
  return (
    <Sheet title={t.werven.new} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
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

const MEMBER_ROLES: Role[] = [Role.werfleider, Role.onderaannemer, Role.architect, Role.klant, Role.veiligheidscoordinator];

export function WerfDetail({ id, caps, go }: { id: bigint; caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const work = useQuery({ queryKey: ["work", String(id)], queryFn: () => actor!.getWork(id), enabled: on });
  const members = useQuery({ queryKey: ["members", String(id)], queryFn: () => actor!.listMembers(id), enabled: on && !!work.data });
  const [adding, setAdding] = useState(false);
  const status = useMutation({
    mutationFn: async (s: WorkStatus) => unwrap(await actor!.setWorkStatus(id, s)),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const end = useMutation({
    mutationFn: async (mid: bigint) => unwrap(await actor!.endMembership(mid)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["members", String(id)] }),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });

  if (!work.data) {
    return (
      <Page title={t.werven.title} actions={<Button icon="back" onClick={() => go("werven")}>{t.common.back}</Button>}>
        <Loading q={work} />
      </Page>
    );
  }
  const w = work.data;
  return (
    <Page label={w.code} title={w.name} actions={<Button icon="back" onClick={() => go("werven")}>{t.common.back}</Button>}>
      <div className="a-row">
        <WorkBadge status={w.status} />
        <span className="bw-muted">{[w.address.street, w.address.number].filter(Boolean).join(" ")}{w.address.city ? `, ${w.address.zip} ${w.address.city}` : ""}</span>
        <span className="a-tag">btw {Number(w.vatBp) / 100} %</span>
      </div>
      {caps.createWork && (
        <Choice label={t.werven.status} value={w.status} onChange={(s) => status.mutate(s)} options={[WorkStatus.planned, WorkStatus.running, WorkStatus.delivered, WorkStatus.aftercare].map((s) => ({ value: s, label: t.workStatus[s] }))} />
      )}
      <div className="a-cols">
        <section className="a-section">
          <div className="a-row a-row--between">
            <h2 className="bw-h2">{t.werven.members}</h2>
            {caps.createWork && <Button icon="plus" onClick={() => setAdding(true)}>{t.werven.addMember}</Button>}
          </div>
          <Loading q={members} />
          {members.data && members.data.length === 0 && <p className="a-empty">—</p>}
          {members.data && members.data.length > 0 && (
            <ul className="a-list">
              {members.data.map((m) => (
                <li key={String(m.id)}>
                  <span className="a-list__main">
                    <b>{m.name}</b>
                    <span className="a-row"><RoleTags roles={[m.role]} />{m.orgId !== undefined && m.personId === undefined && <span className="a-tag">{t.werven.org}</span>}{m.grants.map((g) => <span key={g} className="a-tag">{t.grants[g] ?? g}</span>)}</span>
                  </span>
                  {caps.createWork && <Button variant="quiet" busy={end.isPending && end.variables === m.id} onClick={() => end.mutate(m.id)}>{t.werven.endMember}</Button>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <Files workId={id} canUpload={caps.upload} />
      </div>
      {adding && <AddMember workId={id} onClose={() => setAdding(false)} />}
    </Page>
  );
}

function AddMember({ workId, onClose }: { workId: bigint; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on });
  const [who, setWho] = useState("");
  const [role, setRole] = useState<Role>(Role.onderaannemer);
  const save = useMutation({
    mutationFn: async () => {
      const [kind, raw] = who.split(":");
      const idv = BigInt(raw);
      const grants: Grant[] = role === Role.onderaannemer ? [Grant.confirmPlanning, Grant.confirmHours] : role === Role.architect ? [Grant.readReports] : role === Role.veiligheidscoordinator ? [Grant.uploadDocs] : [];
      return unwrap(await actor!.addMembership(workId, kind === "p" ? idv : null, kind === "o" ? idv : null, role, grants));
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["members", String(workId)] }); onClose(); },
  });
  return (
    <Sheet title={t.werven.addMember} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" disabled={!who} busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <Field label={`${t.werven.person} / ${t.werven.org}`}>
          <select className="bw-input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">—</option>
            <optgroup label={t.werven.person}>
              {(persons.data ?? []).map((p) => <option key={String(p.id)} value={`p:${p.id}`}>{p.name} ({p.roles.map((r) => t.roles[r]).join(", ")})</option>)}
            </optgroup>
            <optgroup label={t.werven.org}>
              {(orgs.data ?? []).map((o) => <option key={String(o.id)} value={`o:${o.id}`}>{o.name} ({t.orgKinds[o.kind]})</option>)}
            </optgroup>
          </select>
        </Field>
        <Field label={t.werven.role}>
          <Choice label={t.werven.role} value={role} onChange={setRole} options={MEMBER_ROLES.map((r) => ({ value: r, label: t.roles[r] }))} />
        </Field>
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

// Foto's worden op het toestel verkleind (≤ 1600 px, JPEG): kleiner en zonder EXIF-locatie (§8.5).
async function shrinkPhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Verkleinen mislukt"))), "image/jpeg", 0.82));
}

function Files({ workId, canUpload }: { workId: bigint; canUpload: boolean }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  const files = useQuery({ queryKey: ["files", String(workId)], queryFn: () => actor!.listFiles(workId), enabled: !!actor && !isFetching });
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
      <h2 className="bw-h2">{t.werven.files}</h2>
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
          {sorted.map((f) => <FileRow key={String(f.id)} f={f} />)}
        </ul>
      )}
    </section>
  );
}

function FileRow({ f }: { f: FileView }) {
  const url = f.blob?.getDirectURL();
  return (
    <li>
      <span className="a-list__main">
        <b>{f.name}</b>
        <span className="bw-muted bw-num">{fmtBytes(Number(f.size))} · {fmtTime(f.at)}</span>
      </span>
      {f.confidential && <span className="a-tag a-tag--warn">{t.werven.confidential}</span>}
      {url && <a className="bw-btn bw-btn--quiet" href={url} target="_blank" rel="noreferrer">{t.werven.open}</a>}
    </li>
  );
}
