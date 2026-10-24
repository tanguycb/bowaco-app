// Werfverslag op de gsm in vier stappen (bouwplan §8.3, prototype 0.5): wie was er · wat is er gedaan · foto's ·
// bijzonderheden (materialen en bonnen, problemen en vertraging, rit, weer). Alles wat je invult, gaat eerst naar de
// wachtrij op de gsm (offline/outbox.tsx) en vandaar naar de backend zodra er bereik is. Wat je ziet = de blokken
// die de backend al heeft + wat nog wacht (met een klokje). Terug gaan verliest niets (§8.1 regel 4).
import { useEffect, useMemo, useState } from "react";
import { IssueKind, MaterialKind, type AttendanceView, type DayWork, type MyDayView, type PhotoView, type PlannedOrg, type ReportOp, type ReportView, type TimeSlot } from "../backend";
import { Button, Choice, Icon, PhotoGrid, Sheet, StatusBadge, Stepper, Steps, useToast, type PhotoItem, type Status } from "../design";
import { blobUrlOf, useCached } from "../offline/cached";
import { useOutbox, type QueuedOp } from "../offline/outbox";
import { fmtSize, shrink } from "../offline/photos";
import { t } from "../texts/nl";
import { errText, fmtDayNum, useBackend } from "../util";
import { useWorks } from "./common";

const T = t.verslag;
const DEFAULT_SLOTS: TimeSlot[] = [{ fromMin: 450n, toMin: 720n }, { fromMin: 750n, toMin: 960n }];

export const fmtMin = (m: number | bigint) => {
  const n = Number(m);
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};
export const fmtDur = (m: number | bigint) => {
  const n = Number(m);
  const h = Math.floor(n / 60);
  const mm = n % 60;
  return mm === 0 ? `${h} u` : `${h} u ${String(mm).padStart(2, "0")}`;
};
const slotMin = (s: TimeSlot[]) => s.reduce((a, x) => a + Number(x.toMin) - Number(x.fromMin), 0);
const TASK_STATUS: Record<string, Status> = { planned: "planned", busy: "busy", delayed: "delayed", done: "done", blocked: "blocked" };

/** Een aanwezigheidsregel zoals het scherm ze toont: van de backend, wachtend op de gsm, of een voorstel uit de planning. */
type Att = {
  key: string; // blockKey (backend), opId (wacht) of "plan:<org>"
  source: "server" | "pending" | "suggest";
  final: boolean;
  failed?: string;
  orgId?: bigint;
  code: string;
  orgName: string;
  names: string;
  headcount: number;
  slots: TimeSlot[];
  regie: boolean;
};

export function Werfverslag({ workId, day, go }: { workId: bigint; day: bigint; go: (to: string) => void }) {
  const { actor } = useBackend();
  const ob = useOutbox();
  const toast = useToast();
  const myDay = useCached<MyDayView>(["myDay", String(day), "all"], () => actor!.myDay(day, true));
  const reportDay = useCached<ReportView[]>(["reportDay", String(workId), String(day)], () => actor!.getReportDay(workId, day));
  const works = useWorks();
  const [step, setStep] = useState(0);
  const [seen, setSeen] = useState(0);
  const [clientKey, setClientKey] = useState<string>();
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Att | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (ob.ready) void ob.clientKeyFor(workId, day).then(setClientKey);
  }, [ob.ready, ob.clientKeyFor, workId, day]);

  const dw: DayWork | undefined = myDay.data?.value.works.find((w) => w.id === workId);
  const wv = works.data?.find((w) => w.id === workId);
  const title = dw ? `${dw.code} · ${dw.name}` : wv ? `${wv.code} · ${wv.name}` : `#${workId}`;
  const reports = reportDay.data?.value ?? [];
  const mine = ob.ops.filter((o) => o.clientKey === clientKey);
  const removed = new Set(mine.filter((o) => o.payload.__kind__ === "remove").map((o) => (o.payload as Extract<ReportOp, { __kind__: "remove" }>).remove.blockKey));
  const replaced = new Set(mine.flatMap((o) => (o.payload.__kind__ === "attendance" && o.payload.attendance.replaces ? [o.payload.attendance.replaces] : [])));
  const serverKeys = new Set(reports.flatMap((r) => [...r.attendances, ...r.workDone, ...r.materials, ...r.photos, ...r.issues, ...r.trips].map((b) => b.blockKey)));
  const pendingOps = mine.filter((o) => !serverKeys.has(o.opId));
  const open = reports.find((r) => r.status.__kind__ === "draft");
  const closedOnly = reports.length > 0 && !open;
  const finalQueued = mine.some((o) => o.kind === "finalize");
  const label = `${dw?.code ?? wv?.code ?? ""} ${fmtDayNum(day)}`;
  // Zodra de wachtrij iets van dit verslag verzond: het verslag van de backend opnieuw lezen (geen oude stand tonen).
  const waitingHere = mine.length;
  const [lastWaiting, setLastWaiting] = useState(0);
  useEffect(() => {
    if (waitingHere < lastWaiting) void reportDay.refetch();
    setLastWaiting(waitingHere);
  }, [waitingHere]); // eslint-disable-line react-hooks/exhaustive-deps
  // Een verslag dat al bestaat: alle stappen meteen open (enkel een nieuw verslag gaat stap voor stap).
  useEffect(() => {
    if (reports.length > 0 || mine.length > 0) setSeen(3);
  }, [reports.length, mine.length]);

  /** Een opdracht in de wachtrij zetten (eerst één keer "verslag openen"). */
  const send = async (op: ReportOp, lbl: string, file?: { blob: Blob; name: string; mime: string }, thumb?: { blob: Blob; name: string; mime: string }) => {
    try {
      const ck = await ob.ensureReport(workId, day, `${T.title} ${label}`);
      await ob.enqueue({ clientKey: ck, workId, day, label: lbl, op, file, thumb });
      return true;
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
      return false;
    }
  };

  // ── Stap 1: wie was er? ──
  const atts: Att[] = useMemo(() => {
    const out: Att[] = [];
    for (const r of reports) {
      for (const a of r.attendances) {
        if (removed.has(a.blockKey) || replaced.has(a.blockKey)) continue;
        out.push(fromServer(a, r.status.__kind__ !== "draft"));
      }
    }
    for (const o of pendingOps) {
      if (o.payload.__kind__ !== "attendance") continue;
      const p = o.payload.attendance;
      out.push({ key: o.opId, source: "pending", final: false, failed: o.state === "failed" ? o.error : undefined, orgId: p.orgId, code: codeOf(p.orgId), orgName: nameOf(p.orgId), names: p.names, headcount: Number(p.headcount), slots: p.slots, regie: p.regie });
    }
    return out;
  }, [reports, pendingOps, removed, replaced]); // eslint-disable-line react-hooks/exhaustive-deps

  function codeOf(orgId?: bigint): string {
    if (orgId === undefined) return "BOWACO";
    return myDay.data?.value.orgs.find((o) => o.orgId === orgId)?.code ?? dw?.planned.find((o) => o.orgId === orgId)?.code ?? `#${orgId}`;
  }
  function nameOf(orgId?: bigint): string {
    if (orgId === undefined) return T.own;
    return myDay.data?.value.orgs.find((o) => o.orgId === orgId)?.name ?? dw?.planned.find((o) => o.orgId === orgId)?.name ?? "";
  }
  function fromServer(a: AttendanceView, final: boolean): Att {
    return { key: a.blockKey, source: "server", final, orgId: a.orgId, code: a.orgCode, orgName: a.orgName, names: a.names, headcount: Number(a.headcount), slots: a.slots, regie: a.regie };
  }

  const present = new Set(atts.map((a) => (a.orgId === undefined ? "bowaco" : String(a.orgId))));
  const suggestions: Att[] = (dw?.planned ?? [])
    .filter((o) => !present.has(String(o.orgId)))
    .map((o) => ({ key: `plan:${o.orgId}`, source: "suggest", final: false, orgId: o.orgId, code: o.code, orgName: o.name, names: "", headcount: 1, slots: DEFAULT_SLOTS, regie: false }));
  const checkedSuggestions = suggestions.filter((s) => !unchecked.has(s.key));

  const saveSuggestions = async () => {
    for (const s of checkedSuggestions) await saveAtt(s);
  };

  const saveAtt = async (a: Att) => {
    const op: ReportOp = { __kind__: "attendance", attendance: { orgId: a.orgId, names: a.names, headcount: BigInt(a.headcount), slots: a.slots, regie: a.regie, note: "", replaces: a.source === "server" ? a.key : undefined } };
    const lbl = `${a.code} ${a.headcount > 1 ? `${a.headcount} × ` : ""}${fmtDur(slotMin(a.slots))}`;
    if (a.source === "pending") {
      if (await ob.patch(a.key, op, lbl)) return;
    }
    await send(op, lbl);
  };

  const removeAtt = async (a: Att) => {
    if (a.source === "suggest") setUnchecked((u) => new Set(u).add(a.key));
    else if (a.source === "pending") await ob.discard(a.key);
    else await send({ __kind__: "remove", remove: { blockKey: a.key } }, `${a.code} weg`);
  };

  const goStep = async (i: number) => {
    if (step === 0 && i > 0 && checkedSuggestions.length > 0) await saveSuggestions();
    if (step === 1) await flushSummary();
    setStep(i);
    setSeen((s) => Math.max(s, i));
    window.scrollTo({ top: 0 });
  };

  // ── Stap 2: wat is er gedaan? ──
  const serverSummary = open?.summary ?? reports[reports.length - 1]?.summary ?? "";
  const pendingSummary = [...pendingOps].reverse().find((o) => o.payload.__kind__ === "text" && o.payload.text.field === "summary");
  const [summary, setSummary] = useState<string | null>(null);
  const shownSummary = summary ?? (pendingSummary?.payload.__kind__ === "text" ? pendingSummary.payload.text.value : serverSummary);
  const flushSummary = async () => {
    if (summary === null) return;
    const base = pendingSummary?.payload.__kind__ === "text" ? pendingSummary.payload.text.value : serverSummary;
    if (summary.trim() !== base.trim()) {
      const op: ReportOp = { __kind__: "text", text: { field: "summary", value: summary } };
      if (!(pendingSummary && (await ob.patch(pendingSummary.opId, op)))) await send(op, T.summary);
    }
    setSummary(null);
  };
  const percentOf = (taskId: bigint, fallback: bigint): number => {
    const p = [...pendingOps].reverse().find((o) => o.payload.__kind__ === "workDone" && o.payload.workDone.taskId === taskId && o.payload.workDone.percent !== undefined);
    if (p?.payload.__kind__ === "workDone") return Number(p.payload.workDone.percent);
    let v: number | undefined;
    for (const r of reports) for (const w of r.workDone) if (w.taskId === taskId && w.percent !== undefined && !removed.has(w.blockKey)) v = Number(w.percent);
    return v ?? Number(fallback);
  };
  const setPercent = async (taskId: bigint, title: string, v: number) => {
    const op: ReportOp = { __kind__: "workDone", workDone: { taskId, text: "", percent: BigInt(v) } };
    const lbl = `«${title}» ${v === 100 ? T.ready : `${v} %`}`;
    const p = pendingOps.find((o) => o.payload.__kind__ === "workDone" && o.payload.workDone.taskId === taskId && o.payload.workDone.text === "");
    if (p && (await ob.patch(p.opId, op, lbl))) return;
    await send(op, lbl);
  };
  const [extra, setExtra] = useState("");
  const doneLines = [
    ...reports.flatMap((r) => r.workDone.filter((w) => w.taskId === undefined && !removed.has(w.blockKey)).map((w) => ({ key: w.blockKey, text: w.text, pending: false, final: r.status.__kind__ !== "draft" }))),
    ...pendingOps.filter((o) => o.payload.__kind__ === "workDone" && o.payload.workDone.taskId === undefined).map((o) => ({ key: o.opId, text: o.payload.__kind__ === "workDone" ? o.payload.workDone.text : "", pending: true, final: false })),
  ];

  // ── Stap 3: foto's ──
  const [urls, setUrls] = useState<Record<string, string>>({});
  const pendingPhotos = pendingOps.filter((o) => o.payload.__kind__ === "photo");
  useEffect(() => {
    let live = true;
    void (async () => {
      const next: Record<string, string> = {};
      for (const o of pendingPhotos) next[o.opId] = urls[o.opId] ?? (await ob.blobUrl(o.opId, "thumb")) ?? "";
      if (live) setUrls(next);
    })();
    return () => {
      live = false;
    };
  }, [pendingPhotos.map((o) => o.opId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const serverPhotos: (PhotoView & { final: boolean })[] = reports.flatMap((r) => r.photos.filter((p) => !removed.has(p.blockKey)).map((p) => ({ ...p, final: r.status.__kind__ !== "draft" })));
  const photoItems: PhotoItem[] = [
    ...pendingPhotos.map((o) => ({ id: o.opId, src: urls[o.opId] ?? "", caption: o.state === "failed" ? T.failedTag : o.label, pending: true })),
    ...serverPhotos.map((p) => ({ id: p.blockKey, src: blobUrlOf(p.thumb?.blob) ?? blobUrlOf(p.file.blob) ?? "", caption: p.caption || p.createdByName })),
  ];
  const [photo, setPhoto] = useState<PhotoItem | null>(null);
  const onFiles = async (files: File[]) => {
    let n = 0;
    for (const f of files) {
      try {
        const s = await shrink(f);
        const name = `foto-${fmtDayNum(day)}-${Date.now()}.jpg`;
        const op: ReportOp = { __kind__: "photo", photo: { file: undefined as never, caption: "", takenAt: BigInt(s.takenAt) * 1_000_000n } };
        if (await send(op, `${T.photo} · ${fmtSize(s.full.size)}`, { blob: s.full, name, mime: "image/jpeg" }, { blob: s.thumb, name: `mini-${name}`, mime: "image/jpeg" })) n++;
      } catch (e) {
        toast.show({ kind: "error", text: errText(e) });
      }
    }
    if (n) toast.show({ kind: "ok", text: n === 1 ? "Foto bewaard op de gsm" : `${n} foto's bewaard op de gsm` });
  };

  // ── Stap 4: bijzonderheden ──
  const [matSheet, setMatSheet] = useState(false);
  const [issueKind, setIssueKind] = useState<IssueKind | null>(null);
  const materials = [
    ...reports.flatMap((r) => r.materials.filter((m) => !removed.has(m.blockKey)).map((m) => ({ key: m.blockKey, kind: m.kind as string, text: [m.quantity, m.text].filter(Boolean).join(" "), file: m.hasFile, pending: false, final: r.status.__kind__ !== "draft" }))),
    ...pendingOps.filter((o) => o.payload.__kind__ === "material").map((o) => {
      const m = o.payload.__kind__ === "material" ? o.payload.material : null;
      return { key: o.opId, kind: m?.kind as string, text: [m?.quantity, m?.text].filter(Boolean).join(" "), file: !!o.file, pending: true, final: false };
    }),
  ];
  const issues = [
    ...reports.flatMap((r) => r.issues.filter((i) => !removed.has(i.blockKey)).map((i) => ({ key: i.blockKey, kind: i.kind as string, text: i.text, days: i.delayDays, shifts: i.taskTitles, pending: false, final: r.status.__kind__ !== "draft" }))),
    ...pendingOps.filter((o) => o.payload.__kind__ === "issue").map((o) => {
      const i = o.payload.__kind__ === "issue" ? o.payload.issue : null;
      return { key: o.opId, kind: i?.kind as string, text: i?.text ?? "", days: i?.delayDays, shifts: (i?.taskIds ?? []).map((id) => dw?.tasks.find((x) => x.id === id)?.title ?? `#${id}`), pending: true, final: false };
    }),
  ];
  const trips = [
    ...reports.flatMap((r) => r.trips.filter((x) => !removed.has(x.blockKey)).map((x) => ({ key: x.blockKey, text: `${x.plate}${x.vehicleName ? ` (${x.vehicleName})` : ""} · ${x.driverOutName || "–"} / ${x.driverBackName || "–"}`, pending: false, final: r.status.__kind__ !== "draft" }))),
    ...pendingOps.filter((o) => o.payload.__kind__ === "trip").map((o) => ({ key: o.opId, text: o.label, pending: true, final: false })),
  ];
  const removeBlock = async (b: { key: string; pending: boolean; final: boolean }, lbl: string) => {
    if (b.final) return;
    if (b.pending) await ob.discard(b.key);
    else await send({ __kind__: "remove", remove: { blockKey: b.key } }, `${lbl} weg`);
  };

  const finish = async () => {
    await flushSummary();
    if (step === 0) await saveSuggestions();
    if (await send({ __kind__: "finalize", finalize: null }, `${T.finish} ${label}`)) {
      toast.show({ kind: "ok", text: ob.online ? T.finished : T.finishedWait });
      go("vandaag");
    }
  };

  const regieTotals = new Map<string, number>();
  for (const a of atts) if (a.regie) regieTotals.set(a.code, (regieTotals.get(a.code) ?? 0) + a.headcount * slotMin(a.slots));

  if (myDay.data && !myDay.data.value.writer) return <p className="a-err">{T.notAllowed}</p>;

  return (
    <div className="a-page v-screen">
      <div className="m-hello">
        <span className="bw-label">{title} · {fmtDayNum(day)}</span>
        <Steps steps={[...T.steps]} current={step} visited={seen} onGo={(i) => void goStep(i)} />
        {(myDay.data?.fromCache || reportDay.data?.fromCache) && <span className="bw-muted">{T.staleAt(new Date(Math.min(myDay.data?.at ?? Date.now(), reportDay.data?.at ?? Date.now())).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }))}</span>}
        {myDay.error && !myDay.data && <span className="a-err">{T.noCache}</span>}
        {(closedOnly || finalQueued) && <div className="m-banner"><Icon name="check" size={18} /><span>{T.closedBanner}</span></div>}
        {reports.some((r) => r.corrects !== undefined) && <span className="bw-muted">{T.correction(String(reports.find((r) => r.corrects !== undefined)!.corrects))}</span>}
      </div>

      {step === 0 && (
        <section className="m-section">
          <h1 className="bw-h1">{T.steps[0]}</h1>
          <p className="bw-muted">{T.whoLead}</p>
          {[...atts, ...suggestions].length === 0 && <p className="a-empty">{T.empty}</p>}
          {atts.map((a) => <AttRow key={a.key} a={a} onOpen={() => !a.final && setEdit(a)} />)}
          {suggestions.map((a) => (
            <AttRow key={a.key} a={a} off={unchecked.has(a.key)} onOpen={() => (unchecked.has(a.key) ? setUnchecked((u) => { const n = new Set(u); n.delete(a.key); return n; }) : setEdit(a))} />
          ))}
          {checkedSuggestions.length > 0 && <Button variant="primary" block icon="check" onClick={() => void saveSuggestions()}>{T.saveSuggest(checkedSuggestions.length)}</Button>}
          <Button block icon="plus" onClick={() => setAdding(true)}>{T.addPerson}</Button>
          <div className="m-total">
            <span className="bw-label">{T.regieToday}</span>
            {regieTotals.size === 0 ? <span>{T.none}</span> : [...regieTotals].map(([code, min]) => <span key={code} className="bw-num"><b>{code}</b> {fmtDur(min)}</span>)}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="m-section">
          <h1 className="bw-h1">{T.steps[1]}</h1>
          <p className="bw-muted">{T.doneLead}</p>
          {(dw?.tasks ?? []).length === 0 && <p className="a-empty">{T.noTasks}</p>}
          {(dw?.tasks ?? []).map((task) => {
            const v = percentOf(task.id, task.percent);
            return (
              <div key={String(task.id)} className="m-taskdo">
                <div className="m-taskdo__head">
                  <span className="bw-h3">{task.title}</span>
                  <StatusBadge small status={v === 100 ? "done" : TASK_STATUS[task.status] ?? "planned"} />
                </div>
                {task.orgCodes.length > 0 && <span className="bw-muted bw-mono">{task.orgCodes.join(" · ")}</span>}
                <Choice label={T.progress(task.title)} fill value={v} options={[0, 25, 50, 75, 100].map((x) => ({ value: x, label: x === 100 ? T.ready : `${x}%` }))} onChange={(x) => void setPercent(task.id, task.title, x)} />
              </div>
            );
          })}
          <label className="bw-field">
            <span className="bw-label">{T.summary}</span>
            <textarea id="report-summary" className="bw-input" value={shownSummary} onChange={(e) => setSummary(e.target.value)} onBlur={() => void flushSummary()} placeholder={T.summaryPh} rows={4} />
          </label>
          <span className="bw-label">{T.extraWork}</span>
          {doneLines.map((l) => (
            <div key={l.key} className="m-line">
              <div className="m-line__head"><span>{l.text}</span>{l.pending && <span className="m-tag">{T.pendingTag}</span>}{!l.final && <Button variant="quiet" onClick={() => void removeBlock(l, l.text)}>{T.remove}</Button>}</div>
            </div>
          ))}
          <div className="m-two">
            <input id="report-extra" className="bw-input" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={T.extraWorkPh} />
            <Button icon="plus" disabled={!extra.trim()} onClick={() => { const x = extra.trim(); setExtra(""); void send({ __kind__: "workDone", workDone: { text: x } }, x); }}>{T.addLine}</Button>
          </div>
          <Button icon="mic" disabled>{T.voice}</Button>
        </section>
      )}

      {step === 2 && (
        <section className="m-section">
          <h1 className="bw-h1">{T.steps[2]}</h1>
          <p className="bw-muted">{T.photosLead}</p>
          <PhotoGrid photos={photoItems} onFiles={(f) => void onFiles(f)} onOpen={setPhoto} addLabel={T.takePhoto} />
          {pendingPhotos.length > 0 && <p className="bw-muted m-photos-wait"><Icon name="clock" size={18} />{T.photoWait}</p>}
        </section>
      )}

      {step === 3 && (
        <section className="m-section">
          <h1 className="bw-h1">{T.steps[3]}</h1>

          <h2 className="bw-h2 m-sub"><Icon name="box" />{T.materials}</h2>
          {materials.map((m) => (
            <div key={m.key} className="m-line">
              <div className="m-line__head">
                <span className="m-tag">{T.matKinds[m.kind] ?? m.kind}</span>
                {m.pending && <span className="m-tag">{T.pendingTag}</span>}
                {!m.final && <Button variant="quiet" onClick={() => void removeBlock(m, T.material)}>{T.remove}</Button>}
              </div>
              <span>{m.text || (m.file ? T.receiptTaken : "—")}{m.file && m.text ? ` · ${T.receiptPhoto.toLowerCase()}` : ""}</span>
            </div>
          ))}
          <Button block icon="plus" onClick={() => setMatSheet(true)}>{T.material}</Button>

          <h2 className="bw-h2 m-sub"><Icon name="alert" />{T.issues}</h2>
          {issues.length === 0 && <p className="bw-muted">{T.noIssues}</p>}
          {issues.map((i) => (
            <div key={i.key} className="m-line">
              <div className="m-line__head">
                <span className={`m-tag${i.kind === "delay" ? " m-tag--warn" : ""}`}>{T.issueKinds[i.kind] ?? i.kind}{i.days !== undefined ? ` +${i.days} wd` : ""}</span>
                {i.pending && <span className="m-tag">{T.pendingTag}</span>}
                {!i.final && <Button variant="quiet" onClick={() => void removeBlock(i, T.issueKinds[i.kind] ?? "")}>{T.remove}</Button>}
              </div>
              <span>{i.text}{i.shifts.length > 0 && <span className="bw-muted"> · {T.shifts}: {i.shifts.join(", ")}</span>}</span>
            </div>
          ))}
          <div className="m-two">
            <Button icon="alert" onClick={() => setIssueKind(IssueKind.problem)}>{T.problem}</Button>
            <Button icon="clock" onClick={() => setIssueKind(IssueKind.delay)}>{T.delay}</Button>
          </div>

          <h2 className="bw-h2 m-sub"><Icon name="truck" />{T.trip}</h2>
          {trips.map((x) => (
            <div key={x.key} className="m-line">
              <div className="m-line__head"><span>{x.text}</span>{x.pending && <span className="m-tag">{T.pendingTag}</span>}{!x.final && <Button variant="quiet" onClick={() => void removeBlock(x, T.trip)}>{T.remove}</Button>}</div>
            </div>
          ))}
          <TripForm myDay={myDay.data?.value} onSave={(op, lbl) => void send(op, lbl)} />

          <div className="bw-field">
            <span className="bw-label">{T.weather}</span>
            <Choice label={T.weather} fill value={pendingWeather(pendingOps) ?? open?.weather ?? ""} onChange={(v) => void send({ __kind__: "text", text: { field: "weather", value: v } }, `${T.weather.split(" ")[0]}: ${v}`)} options={T.weathers.map((w) => ({ value: w, label: w }))} />
          </div>
        </section>
      )}

      <div className="m-foot m-foot--two">
        <Button size="lg" icon="back" onClick={() => (step === 0 ? go("vandaag") : void goStep(step - 1))}>{t.common.back}</Button>
        {step < 3
          ? <Button size="lg" variant="primary" onClick={() => void goStep(step + 1)}>{T.next}<Icon name="next" /></Button>
          : <Button size="lg" variant="primary" icon="check" onClick={() => void finish()}>{T.finish}</Button>}
      </div>

      {edit && <AttendanceSheet a={edit} onClose={() => setEdit(null)} onSave={(a) => { setEdit(null); void saveAtt(a); }} onRemove={(a) => { setEdit(null); void removeAtt(a); }} />}
      {adding && (
        <AddSheet
          planned={dw?.planned ?? []}
          orgs={myDay.data?.value.orgs ?? []}
          onClose={() => setAdding(false)}
          onPick={(orgId, code, orgName) => { setAdding(false); setEdit({ key: `new:${Date.now()}`, source: "suggest", final: false, orgId, code, orgName, names: "", headcount: 1, slots: DEFAULT_SLOTS, regie: false }); }}
        />
      )}
      {photo && (
        <PhotoSheet
          item={photo}
          op={pendingOps.find((o) => o.opId === photo.id)}
          server={serverPhotos.find((p) => p.blockKey === photo.id)}
          tasks={dw?.tasks ?? []}
          onClose={() => setPhoto(null)}
          onPatch={(op) => void ob.patch(photo.id, op)}
          onRemove={async () => {
            const sp = serverPhotos.find((p) => p.blockKey === photo.id);
            setPhoto(null);
            if (sp) { if (!sp.final) await send({ __kind__: "remove", remove: { blockKey: sp.blockKey } }, `${T.photo} weg`); }
            else await ob.discard(photo.id);
          }}
        />
      )}
      {matSheet && <MaterialSheet onClose={() => setMatSheet(false)} onAdd={(op, lbl, file) => void send(op, lbl, file)} />}
      {issueKind && <IssueSheet start={issueKind} tasks={dw?.tasks ?? []} onClose={() => setIssueKind(null)} onSave={(op, lbl) => void send(op, lbl)} />}
    </div>
  );
}

function pendingWeather(ops: QueuedOp[]): string | undefined {
  const o = [...ops].reverse().find((x) => x.payload.__kind__ === "text" && x.payload.text.field === "weather");
  return o?.payload.__kind__ === "text" ? o.payload.text.value : undefined;
}

function AttRow({ a, onOpen, off }: { a: Att; onOpen: () => void; off?: boolean }) {
  const per = slotMin(a.slots);
  const cls = ["m-person", a.source === "suggest" && "m-person--suggest", off && "m-person--off", a.source === "pending" && "m-person--wait"].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} onClick={onOpen} aria-pressed={a.source === "suggest" ? !off : undefined}>
      <span className="m-person__code">{a.code}</span>
      <span className="m-person__main">
        <span className="bw-h3">{a.orgName || a.code}</span>
        {a.names && <span className="bw-muted">{a.names}</span>}
        <span className="bw-muted bw-num">{a.slots.map((s) => `${fmtMin(s.fromMin)}–${fmtMin(s.toMin)}`).join(" · ")}</span>
        <span className="m-person__tags">
          {a.source === "suggest" && <span className="m-tag">{off ? T.notThere : `${T.fromPlan} · ${T.notSaved}`}</span>}
          {a.source === "pending" && <span className="m-tag">{a.failed ? T.failedTag : T.pendingTag}</span>}
          {a.regie && <span className="m-tag m-tag--regie">regie</span>}
          {a.final && <span className="m-tag">{T.status.final}</span>}
        </span>
      </span>
      <span className="m-person__sum bw-num">{a.headcount > 1 && <small>{a.headcount} × </small>}{fmtDur(per)}</span>
    </button>
  );
}

function AttendanceSheet({ a, onClose, onSave, onRemove }: { a: Att; onClose: () => void; onSave: (a: Att) => void; onRemove: (a: Att) => void }) {
  const [d, setD] = useState<Att>(a);
  const upd = (p: Partial<Att>) => setD((x) => ({ ...x, ...p }));
  const setSlot = (i: number, j: "fromMin" | "toMin", v: number) => upd({ slots: d.slots.map((s, k) => (k === i ? { ...s, [j]: BigInt(v) } : s)) });
  const per = slotMin(d.slots);
  const bad = d.slots.some((s, i) => s.fromMin >= s.toMin || (i > 0 && s.fromMin < d.slots[i - 1].toMin));
  return (
    <Sheet title={`${d.code} · ${T.hoursTitle}`} open onClose={onClose}
      footer={<>
        <Button variant="danger" onClick={() => onRemove(a)}>{T.notThere}</Button>
        <Button variant="primary" icon="check" disabled={bad} onClick={() => onSave(d)}>{t.common.save}</Button>
      </>}>
      <div className="bw-field">
        <span className="bw-label">{T.persons}</span>
        <Stepper label={T.persons} value={d.headcount} min={1} max={30} onChange={(v) => upd({ headcount: v })} />
      </div>
      <label className="bw-field">
        <span className="bw-label">{T.names}</span>
        <input id="att-names" className="bw-input" value={d.names} maxLength={200} onChange={(e) => upd({ names: e.target.value })} />
      </label>
      {d.slots.map((s, i) => (
        <div key={i} className="bw-field">
          <span className="bw-label">{d.slots.length === 2 ? (i === 0 ? T.morning : T.afternoon) : T.slot(i)}</span>
          <div className="m-two">
            <Stepper label={`${T.from} ${i + 1}`} value={Number(s.fromMin)} step={15} min={300} max={1380} format={fmtMin} onChange={(v) => setSlot(i, "fromMin", v)} />
            <Stepper label={`${T.to} ${i + 1}`} value={Number(s.toMin)} step={15} min={315} max={1440} format={fmtMin} onChange={(v) => setSlot(i, "toMin", v)} />
          </div>
        </div>
      ))}
      {d.slots.length === 1
        ? <Button icon="plus" onClick={() => upd({ slots: [...d.slots, { fromMin: d.slots[0].toMin + 30n, toMin: d.slots[0].toMin + 240n > 1440n ? 1440n : d.slots[0].toMin + 240n }] })}>{T.secondSlot}</Button>
        : <Button variant="quiet" onClick={() => upd({ slots: [d.slots[0]] })}>{T.oneSlot}</Button>}
      <div className="bw-field">
        <span className="bw-label">{T.regieQ}</span>
        <Choice label="Regie" fill value={d.regie ? "ja" : "nee"} onChange={(v) => upd({ regie: v === "ja" })} options={[{ value: "ja", label: T.regieYes }, { value: "nee", label: t.common.no }]} />
      </div>
      {bad && <p className="a-err">Een tijdvak loopt van een vroeger naar een later uur, zonder overlap.</p>}
      <div className="m-total"><span className="bw-label">{T.together}</span><span className="bw-num"><b>{d.headcount} × {fmtDur(per)} = {fmtDur(per * d.headcount)}</b></span></div>
    </Sheet>
  );
}

function AddSheet({ planned, orgs, onClose, onPick }: { planned: PlannedOrg[]; orgs: PlannedOrg[]; onClose: () => void; onPick: (orgId: bigint | undefined, code: string, name: string) => void }) {
  const [q, setQ] = useState("");
  const first = new Set(planned.map((p) => String(p.orgId)));
  const list = [...planned, ...orgs.filter((o) => !first.has(String(o.orgId)))].filter((o) => !q || `${o.code} ${o.name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet title={T.addTitle} open onClose={onClose}>
      <p className="bw-muted">{T.addLead}</p>
      <button type="button" className="m-person" onClick={() => onPick(undefined, "BOWACO", T.own)}><span className="m-person__code">BOWACO</span><span className="m-person__main"><span className="bw-h3">{T.own}</span></span></button>
      <input id="add-search" className="bw-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek firma of code" />
      <div className="m-outbox">
        {list.slice(0, 40).map((o) => (
          <button key={String(o.orgId)} type="button" className="m-person" onClick={() => onPick(o.orgId, o.code, o.name)}>
            <span className="m-person__code">{o.code}</span>
            <span className="m-person__main"><span className="bw-h3">{o.name}</span>{first.has(String(o.orgId)) && <span className="m-person__tags"><span className="m-tag">{T.fromPlan}</span></span>}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function PhotoSheet({ item, op, server, tasks, onClose, onPatch, onRemove }: { item: PhotoItem; op?: QueuedOp; server?: PhotoView & { final: boolean }; tasks: DayWork["tasks"]; onClose: () => void; onPatch: (op: ReportOp) => void; onRemove: () => void }) {
  const { blobUrl } = useOutbox();
  const [big, setBig] = useState<string>();
  useEffect(() => {
    if (op) void blobUrl(op.opId, "full").then(setBig);
    else setBig(blobUrlOf(server?.file.blob));
  }, [op, server, blobUrl]);
  const p = op?.payload.__kind__ === "photo" ? op.payload.photo : null;
  const [caption, setCaption] = useState(p?.caption ?? server?.caption ?? "");
  const canEdit = !!p;
  return (
    <Sheet title={T.photo} open onClose={onClose}
      footer={<>
        {!(server?.final) && <Button variant="danger" onClick={onRemove}>{T.remove}</Button>}
        <Button variant="primary" icon="check" onClick={() => { if (p && caption !== p.caption) onPatch({ __kind__: "photo", photo: { ...p, caption } }); onClose(); }}>{t.common.close}</Button>
      </>}>
      {(big || item.src) && <img src={big ?? item.src} alt="" className="m-bigphoto" />}
      {canEdit ? (
        <>
          <span className="bw-label">{T.photoTask}</span>
          <Choice label="Taak" value={p?.taskId === undefined ? "" : String(p.taskId)} onChange={(v) => p && onPatch({ __kind__: "photo", photo: { ...p, taskId: v ? BigInt(v) : undefined } })} options={[{ value: "", label: T.noTask }, ...tasks.map((x) => ({ value: String(x.id), label: x.title.split(/[,+]/)[0] }))]} />
          <label className="bw-field"><span className="bw-label">{T.caption}</span><input id="photo-caption" className="bw-input" value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} /></label>
          {op?.error && <p className="a-err">{op.error}</p>}
        </>
      ) : (
        server && <p className="bw-muted">{server.caption || server.createdByName}{server.taskId !== undefined ? ` · ${tasks.find((x) => x.id === server.taskId)?.title ?? ""}` : ""}</p>
      )}
    </Sheet>
  );
}

function MaterialSheet({ onClose, onAdd }: { onClose: () => void; onAdd: (op: ReportOp, label: string, file?: { blob: Blob; name: string; mime: string }) => void }) {
  const [kind, setKind] = useState<MaterialKind>(MaterialKind.receipt);
  const [text, setText] = useState("");
  const [qty, setQty] = useState("");
  const [supplier, setSupplier] = useState("");
  const [bon, setBon] = useState<{ blob: Blob; url: string } | null>(null);
  const kinds = [MaterialKind.receipt, MaterialKind.fromWarehouse, MaterialKind.smallMaterial, MaterialKind.equipment, MaterialKind.wasteToWarehouse, MaterialKind.returned, MaterialKind.delivered];
  const ok = text.trim() !== "" || !!bon;
  return (
    <Sheet title={T.material} open onClose={onClose}
      footer={<>
        <Button onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="primary" icon="check" disabled={!ok} onClick={() => {
          onAdd({ __kind__: "material", material: { kind, text: text.trim(), quantity: qty.trim(), supplier: supplier.trim() } }, `${T.matKinds[kind]}: ${[qty, text].filter((x) => x.trim()).join(" ") || T.receiptPhoto}`, bon ? { blob: bon.blob, name: `bon-${Date.now()}.jpg`, mime: "image/jpeg" } : undefined);
          onClose();
        }}>{T.addLine}</Button>
      </>}>
      <span className="bw-label">{T.matKind}</span>
      <Choice label={T.matKind} value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: T.matKinds[k] }))} />
      <label className="bw-field"><span className="bw-label">{T.matWhat}</span><input id="mat-text" className="bw-input" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder={T.matWhatPh} /></label>
      <div className="m-two">
        <label className="bw-field"><span className="bw-label">{T.matQty}</span><input id="mat-qty" className="bw-input" value={qty} maxLength={60} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="bw-field"><span className="bw-label">{T.matSupplier}</span><input id="mat-supplier" className="bw-input" value={supplier} maxLength={80} onChange={(e) => setSupplier(e.target.value)} /></label>
      </div>
      {bon ? <img src={bon.url} alt={T.receiptPhoto} className="m-bigphoto" style={{ maxHeight: 180, objectFit: "cover" }} /> : (
        <label className="bw-btn bw-btn--secondary bw-btn--block">
          <Icon name="receipt" />{T.receiptPhoto}
          <input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const s = await shrink(f);
            setBon({ blob: s.full, url: URL.createObjectURL(s.thumb) });
          }} />
        </label>
      )}
    </Sheet>
  );
}

function IssueSheet({ start, tasks, onClose, onSave }: { start: IssueKind; tasks: DayWork["tasks"]; onClose: () => void; onSave: (op: ReportOp, label: string) => void }) {
  const [kind, setKind] = useState<IssueKind>(start);
  const [text, setText] = useState("");
  const [days, setDays] = useState(1);
  const [pick, setPick] = useState<bigint[]>([]);
  const kinds = [IssueKind.problem, IssueKind.delay, IssueKind.safety, IssueKind.extraWorkProposal, IssueKind.other];
  return (
    <Sheet title={T.issueKinds[kind]} open onClose={onClose}
      footer={<>
        <Button onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="primary" icon="check" disabled={!text.trim()} onClick={() => {
          onSave({ __kind__: "issue", issue: { kind, text: text.trim(), taskIds: pick, delayDays: kind === IssueKind.delay ? BigInt(days) : undefined } }, `${T.issueKinds[kind]}${kind === IssueKind.delay ? ` +${days} wd` : ""}: ${text.trim().slice(0, 40)}`);
          onClose();
        }}>{T.issueSave}</Button>
      </>}>
      <Choice label="Soort" value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: T.issueKinds[k] }))} />
      <label className="bw-field"><span className="bw-label">{T.issueWhat}</span><textarea id="issue-text" className="bw-input" rows={3} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} /></label>
      {kind === IssueKind.delay && (
        <div className="bw-field"><span className="bw-label">{T.delayDays}</span><Stepper label={T.delayDays} value={days} min={1} max={120} onChange={setDays} /></div>
      )}
      {tasks.length > 0 && (kind === IssueKind.delay || kind === IssueKind.problem) && (
        <>
          <span className="bw-label">{T.issueTasks}</span>
          <div className="bw-choice" role="group" aria-label={T.issueTasks}>
            {tasks.map((x) => (
              <button key={String(x.id)} type="button" className="bw-choice__opt" aria-pressed={pick.includes(x.id)} onClick={() => setPick((p) => (p.includes(x.id) ? p.filter((y) => y !== x.id) : [...p, x.id]))}>{x.title}</button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

const LAST_TRIP = "bw-laatste-rit";

function TripForm({ myDay, onSave }: { myDay?: MyDayView; onSave: (op: ReportOp, label: string) => void }) {
  const vehicles = myDay?.vehicles ?? [];
  const drivers = myDay?.drivers ?? [];
  const last = (() => {
    try {
      return JSON.parse(localStorage.getItem(LAST_TRIP) ?? "{}") as { v?: string; out?: string; back?: string };
    } catch {
      return {};
    }
  })();
  const [v, setV] = useState<string>(last.v ?? (vehicles[0] ? String(vehicles[0].id) : "andere"));
  const [plate, setPlate] = useState("");
  const [out, setOut] = useState<string>(last.out ?? "");
  const [back, setBack] = useState<string>(last.back ?? last.out ?? "");
  // 1b.2: uur van vertrek heen en terug (optioneel): helpt bij een boete ("wie reed er om 07:40?").
  const [outAt, setOutAt] = useState("");
  const [backAt, setBackAt] = useState("");
  const mins = (s: string) => (/^\d{2}:\d{2}$/.test(s) ? BigInt(Number(s.slice(0, 2)) * 60 + Number(s.slice(3))) : undefined);
  const veh = vehicles.find((x) => String(x.id) === v);
  const ok = !!veh || plate.trim() !== "";
  const name = (id: string) => drivers.find((d) => String(d.id) === id)?.name ?? "";
  // Voornaam als die uniek is, anders de volledige naam (twee keer "Jan" mag niet verwarren).
  const first = (n: string) => n.split(" ")[0];
  const label = (n: string) => (drivers.filter((d) => first(d.name) === first(n)).length > 1 ? n : first(n));
  return (
    <>
      {vehicles.length === 0 && <p className="bw-muted">{T.noVehicles}</p>}
      <div className="bw-field">
        <span className="bw-label">{T.vehicle} {last.v && <span className="m-tag">{T.lastChoice}</span>}</span>
        <Choice label={T.vehicle} value={v} onChange={setV} options={[...vehicles.map((x) => ({ value: String(x.id), label: x.name ? `${x.plate} · ${x.name}` : x.plate })), { value: "andere", label: T.otherPlate }]} />
      </div>
      {!veh && <label className="bw-field"><span className="bw-label">{T.plate}</span><input id="trip-plate" className="bw-input" value={plate} maxLength={20} onChange={(e) => setPlate(e.target.value.toUpperCase())} /></label>}
      <div className="bw-field">
        <span className="bw-label">{T.driverOut}</span>
        <Choice label={T.driverOut} value={out} onChange={setOut} options={drivers.map((d) => ({ value: String(d.id), label: label(d.name) }))} />
      </div>
      <div className="bw-field">
        <span className="bw-label">{T.driverBack}</span>
        <Choice label={T.driverBack} value={back} onChange={setBack} options={drivers.map((d) => ({ value: String(d.id), label: label(d.name) }))} />
      </div>
      <div className="a-row">
        <label className="bw-field"><span className="bw-label">{T.outAt}</span><input className="bw-input" type="time" value={outAt} onChange={(e) => setOutAt(e.target.value)} /></label>
        <label className="bw-field"><span className="bw-label">{T.backAt}</span><input className="bw-input" type="time" value={backAt} onChange={(e) => setBackAt(e.target.value)} /></label>
      </div>
      <Button block icon="truck" disabled={!ok} onClick={() => {
        try {
          localStorage.setItem(LAST_TRIP, JSON.stringify({ v, out, back }));
        } catch {
          /* enkel gemak */
        }
        onSave(
          { __kind__: "trip", trip: { vehicleId: veh?.id, plate: veh ? "" : plate.trim(), driverOutPersonId: out ? BigInt(out) : undefined, driverBackPersonId: back ? BigInt(back) : undefined, driverOutText: "", driverBackText: "", note: "", outMin: mins(outAt), backMin: mins(backAt) } },
          `${T.trip}: ${veh?.plate ?? plate.trim()} · ${name(out) || "–"}${outAt ? ` ${outAt}` : ""} / ${name(back) || "–"}${backAt ? ` ${backAt}` : ""}`,
        );
      }}>{T.tripSave}</Button>
    </>
  );
}
