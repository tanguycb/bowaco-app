// Werfvergadering, oplevering en technische fiches op de werf (stap 2c.8). Actiepunten en restpunten zijn gewone taken van de
// planning: de firma ziet ze in Mijn week. Het opleveringsdocument (PDF, zonder bedragen) wordt in de browser gemaakt, opgeladen en
// ligt daarna vast onder een controlecode (sha-256 van de vaste tekst).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalBlob, HandoverKind, HandoverStatus, type HandoverView, type MeetingView, type PointInput, type PointView, type WorkView } from "../backend";
import { Button, Confirm, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, inputToDay, todayDay, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { download } from "./Prijsvragen";
import { MAX_PID_BYTES, type PidSheet } from "../pdf/pid.ts";
import { Field } from "./Werven";
import { FileButton, uploadPlain, useOpenFile } from "./Werfbeheer";

const M = t.siteAdmin.meeting;
const H = t.siteAdmin.handover;
const S = t.siteAdmin.sheets;

type PointRow = { title: string; org: string; day: string };
const lines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

function PointRows({ rows, setRows, help }: { rows: PointRow[]; setRows: (r: PointRow[]) => void; help: string }) {
  const { actor, isFetching } = useBackend();
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching });
  const firms = (orgs.data ?? []).filter((o) => o.kind === "subcontractor");
  const upd = (i: number, k: keyof PointRow, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <p className="bw-muted">{help}</p>
      {rows.map((r, i) => (
        <div key={i} className="a-grid3" style={{ alignItems: "end", marginBottom: 6 }}>
          <Field label={M.what}><input className="bw-input" maxLength={80} value={r.title} onChange={(e) => upd(i, "title", e.target.value)} /></Field>
          <Field label={M.who}><select className="bw-input" value={r.org} onChange={(e) => upd(i, "org", e.target.value)}><option value="">—</option>{firms.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}</select></Field>
          <Field label={M.when}><input type="date" className="bw-input" value={r.day} onChange={(e) => upd(i, "day", e.target.value)} /></Field>
        </div>
      ))}
      <Button variant="quiet" onClick={() => setRows([...rows, { title: "", org: "", day: dayToInput(todayDay()) }])}>{M.addPoint}</Button>
    </div>
  );
}

const toPoints = (rows: PointRow[]): PointInput[] => rows.filter((r) => r.title.trim()).map((r) => ({ title: r.title.trim(), orgId: r.org ? BigInt(r.org) : undefined, day: inputToDay(r.day) ?? todayDay() }));

function Points({ points }: { points: PointView[] }) {
  return (
    <ul className="a-list">
      {points.map((p) => (
        <li key={String(p.taskId)} className="a-doc">
          <span className="a-list__main"><span>{p.title}</span><span className="bw-muted">{p.orgName || "BOWACO"} · {fmtDayNum(p.day)}{p.inTeam ? "" : ` · ${M.notInTeam}`}</span></span>
          <span className={`a-tag ${p.done ? "a-tag--ok" : ""}`}>{p.done ? M.done : M.open}</span>
        </li>
      ))}
    </ul>
  );
}

function MeetingForm({ w, cur, onClose }: { w: bigint; cur?: MeetingView; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ day: dayToInput(cur?.day ?? todayDay()), att: (cur?.attendees ?? []).join("\n"), note: cur?.note ?? "" });
  const [file, setFile] = useState<{ id: bigint; name: string } | null>(cur?.fileId !== undefined ? { id: cur.fileId, name: cur.fileName } : null);
  const [rows, setRows] = useState<PointRow[]>([]);
  const [opId] = useState(() => crypto.randomUUID()); // review L9: een herhaalde bewaring maakt geen tweede vergadering
  const up = useMutation({ mutationFn: async (x: File) => ({ id: await uploadPlain(actor!, x, w), name: x.name }), onSuccess: setFile, onError: (e) => toast.show({ kind: "error", text: errText(e) }) });
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveMeeting(w, { id: cur?.id, opId: cur ? "" : opId, rev: cur?.rev ?? 0n, day: inputToDay(f.day) ?? todayDay(), attendees: lines(f.att), fileId: file?.id, note: f.note, addPoints: toPoints(rows) })),
    onSuccess: (r) => { toast.show({ kind: r.warnings.length ? "info" : "ok", text: r.warnings.length ? r.warnings.join(" ") : M.saved }); void qc.invalidateQueries({ queryKey: ["meetings"] }); void qc.invalidateQueries({ queryKey: ["plan"] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={cur ? M.number(cur.number) : M.add} open onClose={onClose} side wide footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <Field label={M.day}><input type="date" className="bw-input" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>
        <Field label={M.attendees}><textarea className="bw-input" rows={3} value={f.att} onChange={(e) => setF({ ...f, att: e.target.value })} /></Field>
        <div><span className="bw-label">{M.report}: </span>{file ? <b>{file.name}</b> : "—"} <FileButton label={M.report} busy={up.isPending} onFile={(x) => up.mutate(x)} /></div>
        <PointRows rows={rows} setRows={setRows} help={M.pointsHelp} />
        <Field label={M.note}><textarea className="bw-input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Sheet>
  );
}

export function WorkMeetings({ w }: { w: WorkView }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["meetings", String(w.id)], queryFn: () => actor!.listMeetings(w.id), enabled: !!actor && !isFetching, retry: 0 });
  const [edit, setEdit] = useState<MeetingView | "new" | null>(null);
  const [ask, setAsk] = useState<MeetingView | null>(null);
  const openFile = useOpenFile(w.id);
  const arch = useMutation({ mutationFn: async (id: bigint) => unwrap(await actor!.archiveMeeting(id)), onSuccess: () => void qc.invalidateQueries({ queryKey: ["meetings"] }), onError: (e) => toast.show({ kind: "error", text: errText(e) }) });
  return (
    <section className="a-section" data-testid="meeting-block">
      <h2 className="bw-h2">{M.title}</h2>
      <Loading q={q} />
      {q.data && (q.data.length === 0 ? <p className="bw-muted">{M.none}</p> : (
        <ul className="a-list">
          {q.data.map((m) => (
            <li key={String(m.id)} className="a-doc" style={{ display: "block" }}>
              <div className="a-row"><b>{M.number(m.number)} · {fmtDayNum(m.day)}</b><span className="bw-muted">{m.attendees.join(", ")}</span>
                {m.fileId !== undefined && <button className="a-link" onClick={() => openFile(m.fileId!)}>{m.fileName}</button>}
                <Button variant="quiet" onClick={() => setEdit(m)}>{t.siteAdmin.insurance.edit}</Button><Button variant="quiet" onClick={() => setAsk(m)}>{M.archive}</Button></div>
              {m.points.length > 0 && <Points points={m.points} />}
            </li>
          ))}
        </ul>
      ))}
      <Button onClick={() => setEdit("new")}>{M.add}</Button>
      <Confirm open={ask !== null} title={M.archive} text={ask ? M.archiveAsk(ask.number) : ""} confirmLabel={M.archive} busy={arch.isPending} onClose={() => setAsk(null)} onConfirm={() => ask && arch.mutate(ask.id, { onSuccess: () => setAsk(null) })} />
      {edit && <MeetingForm w={w.id} cur={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function HandoverForm({ w, cur, onClose }: { w: bigint; cur?: HandoverView; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const locked = cur?.finishedAt !== undefined;
  const [f, setF] = useState({ kind: cur?.kind ?? HandoverKind.provisional, day: dayToInput(cur?.day ?? todayDay()), att: (cur?.attendees ?? []).join("\n"), note: cur?.note ?? "", docNote: cur?.docNote ?? "" });
  const [pv, setPv] = useState<{ id: bigint; name: string } | null>(cur?.pvFileId !== undefined ? { id: cur.pvFileId, name: cur.pvFileName } : null);
  const [signed, setSigned] = useState<{ id: bigint; name: string } | null>(cur?.signedFileId !== undefined ? { id: cur.signedFileId, name: cur.signedFileName } : null);
  const [rows, setRows] = useState<PointRow[]>([]);
  const [opId] = useState(() => crypto.randomUUID());
  const up = useMutation({ mutationFn: async (a: { x: File; to: "pv" | "signed" }) => ({ to: a.to, id: await uploadPlain(actor!, a.x, w), name: a.x.name }), onSuccess: (r) => (r.to === "pv" ? setPv : setSigned)({ id: r.id, name: r.name }), onError: (e) => toast.show({ kind: "error", text: errText(e) }) });
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveHandover(w, { id: cur?.id, opId: cur ? "" : opId, rev: cur?.rev ?? 0n, kind: f.kind, day: inputToDay(f.day), attendees: lines(f.att), pvFileId: pv?.id, signedFileId: signed?.id, note: f.note, docNote: f.docNote, addPoints: toPoints(rows) })),
    onSuccess: (r) => { toast.show({ kind: r.warnings.length ? "info" : "ok", text: r.warnings.length ? r.warnings.join(" ") : H.saved }); void qc.invalidateQueries({ queryKey: ["handovers"] }); void qc.invalidateQueries({ queryKey: ["plan"] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={cur ? H.kinds[cur.kind] : H.add} open onClose={onClose} side wide footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        {!cur && <Field label={H.kind}><select className="bw-input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as HandoverKind })}>{Object.entries(H.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
        <Field label={H.day}><input type="date" className="bw-input" disabled={locked} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>
        <Field label={H.attendees}><textarea className="bw-input" rows={3} disabled={locked} value={f.att} onChange={(e) => setF({ ...f, att: e.target.value })} /></Field>
        <div><span className="bw-label">{H.pv}: </span>{pv ? <b>{pv.name}</b> : "—"} {!locked && <FileButton label={H.pv} busy={up.isPending} onFile={(x) => up.mutate({ x, to: "pv" })} />}</div>
        <div><span className="bw-label">{H.signed}: </span>{signed ? <b>{signed.name}</b> : "—"} <FileButton label={H.signed} busy={up.isPending} onFile={(x) => up.mutate({ x, to: "signed" })} /></div>
        <PointRows rows={rows} setRows={setRows} help={H.pointsHelp} />
        <Field label={H.docNote}><textarea className="bw-input" rows={2} disabled={locked} value={f.docNote} onChange={(e) => setF({ ...f, docNote: e.target.value })} /></Field>
        <p className="bw-muted">{H.docNoteHelp}</p>
        <Field label={H.note}><textarea className="bw-input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <p className="bw-muted">{H.noteHelp}</p>
      </div>
    </Sheet>
  );
}

export function WorkHandovers({ w }: { w: WorkView }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["handovers", String(w.id)], queryFn: () => actor!.listHandovers(w.id), enabled: !!actor && !isFetching, retry: 0 });
  const me = useQuery({ queryKey: ["me"], queryFn: () => actor!.me(), enabled: !!actor && !isFetching });
  const office = !!me.data?.caps?.editSiteAdmin;
  const [edit, setEdit] = useState<HandoverView | "new" | null>(null);
  const openFile = useOpenFile(w.id);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["handovers"] }); void qc.invalidateQueries({ queryKey: ["plan"] }); };
  const finish = useMutation({
    mutationFn: async (h: HandoverView) => {
      if (h.day === undefined) throw new Error(H.dayNeeded);
      const d = unwrap(await actor!.handoverDoc(h.id));
      const data = { kind: d.kind as "provisional" | "final", workCode: d.workCode, workName: d.workName, address: d.address, client: d.clientName, architect: d.architectName, day: fmtDayNum(d.day), dayNum: d.day !== undefined ? Number(d.day) : null, attendees: d.attendees, points: d.points.map((p) => ({ title: p.title, who: p.who, due: fmtDayNum(p.day), dueNum: Number(p.day), done: p.done })), docNote: d.docNote, madeOn: fmtDayNum(todayDay()) };
      const [{ handoverPdf, handoverCode }, { loadPdfFonts }] = await Promise.all([import("../pdf/oplevering.ts"), import("../pdf/fonts.ts")]);
      const code = await handoverCode(data);
      const bytes = await handoverPdf(data, await loadPdfFonts(), code);
      const name = `oplevering-${d.workCode}-${d.kind}.pdf`;
      const fid = unwrap(await actor!.addFile(name, "application/pdf", BigInt(bytes.length), ExternalBlob.fromBytes(new Uint8Array(bytes), "application/pdf", name), w.id, false));
      // Review L9: weigert het afronden (andere code, intussen gewijzigd), dan wordt de opgeladen PDF weer weggehaald: geen wees-bestand.
      try {
        return unwrap(await actor!.finishHandover(h.id, fid, code));
      } catch (e) {
        await actor!.archiveFile(fid).catch(() => undefined);
        throw e;
      }
    },
    onSuccess: () => { toast.show({ kind: "ok", text: H.finished }); refresh(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const share = useMutation({ mutationFn: async (a: { id: bigint; on: boolean }) => unwrap(await actor!.shareHandover(a.id, a.on)), onSuccess: refresh, onError: (e) => toast.show({ kind: "error", text: errText(e) }) });
  return (
    <section className="a-section" data-testid="handover-block">
      <h2 className="bw-h2">{H.title}</h2>
      <Loading q={q} />
      {q.data && (q.data.length === 0 ? <p className="bw-muted">{H.none}</p> : (
        <ul className="a-list">
          {q.data.map((h) => (
            <li key={String(h.id)} className="a-doc" style={{ display: "block" }}>
              <div className="a-row">
                <b>{H.kinds[h.kind]}{h.day !== undefined ? ` · ${fmtDayNum(h.day)}` : ""}</b>
                <span className={`a-tag ${h.status === HandoverStatus.done ? "a-tag--ok" : h.status === HandoverStatus.withRemarks ? "a-tag--warn" : ""}`}>{H.status[h.status]}</span>
                <span className="bw-muted">{H.openPoints(h.openPoints)}</span>
                {h.isShared && <span className="a-tag a-tag--ok">{H.shared}</span>}
                {h.pvFileId !== undefined && <button className="a-link" onClick={() => openFile(h.pvFileId!)}>{h.pvFileName}</button>}
                {h.docFileId !== undefined && <button className="a-link" onClick={() => openFile(h.docFileId!)}>{H.open}</button>}
                {h.controlCode && <span className="bw-mono bw-muted" title={h.controlCode}>{H.code} {h.controlCode.slice(0, 16)}</span>}
                <Button variant="quiet" onClick={() => setEdit(h)}>{t.siteAdmin.insurance.edit}</Button>
                {h.finishedAt === undefined && <Button variant="primary" busy={finish.isPending} onClick={() => finish.mutate(h)}>{H.finish}</Button>}
                {office && h.finishedAt !== undefined && <Button variant="quiet" onClick={() => share.mutate({ id: h.id, on: !h.isShared })}>{h.isShared ? H.unshare : H.share}</Button>}
              </div>
              {h.finishedAt === undefined && <p className="bw-muted">{H.finishHelp}</p>}
              {h.points.length > 0 && <Points points={h.points} />}
            </li>
          ))}
        </ul>
      ))}
      <Button onClick={() => setEdit("new")}>{H.add}</Button>
      {edit && <HandoverForm w={w.id} cur={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

/** Technische fiches voor het PID van deze werf: aanvinken uit de bibliotheek (Beheer). */
export function WorkSheets({ w }: { w: WorkView }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const lib = useQuery({ queryKey: ["techSheets"], queryFn: () => actor!.listTechSheets(false), enabled: !!actor && !isFetching, retry: 0 });
  const chosen = useQuery({ queryKey: ["workSheets", String(w.id)], queryFn: () => actor!.workTechSheets(w.id), enabled: !!actor && !isFetching, retry: 0 });
  const set = useMutation({
    mutationFn: async (ids: bigint[]) => unwrap(await actor!.setWorkTechSheets(w.id, ids)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workSheets"] }),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const ids = chosen.data ?? [];
  const sorted = [...(lib.data ?? [])];
  // Het PID: voorblad + de gekozen fiches in één PDF (de browser voegt samen; de server krijgt enkel een auditregel).
  const [pidInfo, setPidInfo] = useState<{ pages: number; included: number; skipped: { title: string; reason: string }[] } | null>(null);
  const pid = useMutation({
    mutationFn: async () => {
      const picked = sorted.filter((x) => ids.includes(x.id));
      const files = await actor!.listFiles(null);
      const sheets: PidSheet[] = [];
      let total = 0;
      for (const x of picked) {
        const f = files.find((y) => y.id === x.fileId);
        const bytes = f?.blob ? new Uint8Array(await f.blob.getBytes()) : new Uint8Array();
        total += bytes.length;
        if (total > MAX_PID_BYTES) throw new Error(S.pidTooBig);
        sheets.push({ title: x.title, materialKey: x.materialKey, supplier: x.supplierName, fileName: x.fileName, mime: f?.mime ?? "", bytes });
      }
      const [{ buildPid }, { loadPdfFonts }] = await Promise.all([import("../pdf/pid.ts"), import("../pdf/fonts.ts")]);
      const addr = [w.address.street, w.address.number].filter(Boolean).join(" ") + (w.address.city ? `, ${w.address.zip} ${w.address.city}` : "");
      const r = await buildPid({ workCode: w.code, workName: w.name, address: addr, madeOn: fmtDayNum(todayDay()), sheets }, await loadPdfFonts());
      unwrap(await actor!.recordPid(w.id, BigInt(r.included.length), BigInt(r.skipped.length), BigInt(r.pages)));
      download(r.bytes, `PID-${w.code}.pdf`, "application/pdf");
      return r;
    },
    onSuccess: (r) => { setPidInfo({ pages: r.pages, included: r.included.length, skipped: r.skipped.map((x) => ({ title: x.title, reason: x.reason })) }); toast.show({ kind: "ok", text: S.pidDone }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <section className="a-section" data-testid="sheets-block">
      <h2 className="bw-h2">{S.title}</h2>
      <Loading q={lib} />
      {lib.data && (sorted.length === 0 ? <p className="bw-muted">{S.none}</p> : (
        <>
          <p className="bw-muted">{S.pick}</p>
          <ul className="a-list">
            {sorted.map((x) => (
              <li key={String(x.id)} className="a-doc"><label className="a-check"><input type="checkbox" checked={ids.includes(x.id)} disabled={set.isPending} onChange={(e) => set.mutate(e.target.checked ? [...ids, x.id] : ids.filter((i) => i !== x.id))} /><span><b>{x.materialKey}</b> · {x.title}{x.supplierName ? ` · ${x.supplierName}` : ""}</span></label></li>
            ))}
          </ul>
          {w.caps.edit && (
            <div className="a-row" style={{ gap: 8 }}>
              <Button icon="doc" busy={pid.isPending} disabled={ids.length === 0} onClick={() => pid.mutate()} data-testid="pid-make">{S.pidMake}</Button>
              <span className="bw-muted">{ids.length === 0 ? S.pidNone : S.pidLead}</span>
            </div>
          )}
          {pidInfo && (
            <div role="status" data-testid="pid-result">
              <p>{S.pidResult(pidInfo.included, pidInfo.pages)}</p>
              {pidInfo.skipped.length > 0 && <ul className="a-list">{pidInfo.skipped.map((x, i) => <li key={i}><span className="a-list__main"><b>{x.title}</b><span className="bw-muted">{S.pidSkipped}: {x.reason}</span></span></li>)}</ul>}
            </div>
          )}
        </>
      ))}
    </section>
  );
}
