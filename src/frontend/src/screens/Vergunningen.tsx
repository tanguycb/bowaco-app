// Vergunningenregister (stap 1b.1, bouwplan §5.3): per werf (met suggesties uit de planning), over alle werven
// (kantoor), de vergunning op de gsm als bewijs bij controle (ook zonder bereik, als ze op het toestel bewaard is),
// de soorten (admin) en de kennisbank per gemeente. De backend zegt wat iemand mag (canEdit, caps).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { ExternalBlob, PermitStatus, type Caps, type MunicipalityView, type PermitKindView, type PermitSuggestion, type PermitView, type PermitWarning, type WorkView } from "../backend";
import { Button, Choice, Confirm, Icon, Sheet, useToast } from "../design";
import { blobUrlOf, useCached } from "../offline/cached";
import { cacheGet, cachePut } from "../offline/db";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtEuro, fmtTime, inputToDay, optText, parseEuro, todayDay, unwrap, useBackend } from "../util";
import { EmptyState, Loading, Page } from "./common";
import { Field, shrinkPhoto } from "./Werven";

const P = t.permits;
const G = t.gemeenten;
const N = Number;

export function warnText(w: PermitWarning): string {
  switch (w.__kind__) {
    case "deadlineSoon": return P.warn.deadlineSoon(N(w.deadlineSoon));
    case "deadlinePassed": return P.warn.deadlinePassed(N(w.deadlinePassed));
    case "noDates": return P.warn.noDates;
    case "refused": return P.warn.refused;
    case "noDocument": return P.warn.noDocument;
    case "expiresSoon": return P.warn.expiresSoon(N(w.expiresSoon));
    case "expired": return P.warn.expired;
    case "outsidePlan": return P.warn.outsidePlan(fmtDayNum(w.outsidePlan.neededFrom), fmtDayNum(w.outsidePlan.neededTo));
  }
}

const STATUS_TAG: Record<string, string> = { needed: "a-tag--warn", requested: "a-tag--accent", granted: "a-tag--ok", extended: "a-tag--ok", refused: "a-tag--bad", expired: "a-tag--bad", cancelled: "" };

export function PermitStatusTag({ s }: { s: PermitStatus }) {
  return <span className={`a-tag ${STATUS_TAG[s] ?? ""}`}>{P.statuses[s] ?? s}</span>;
}

const period = (a?: bigint, b?: bigint) => (a === undefined ? "–" : `${fmtDayNum(a)} – ${fmtDayNum(b ?? a)}`);

function PermitLine({ p, onOpen, showWork }: { p: PermitView; onOpen: (p: PermitView) => void; showWork?: boolean }) {
  return (
    <li className="a-doc">
      <button type="button" className="a-list__btn" onClick={() => onOpen(p)}>
        <span className="a-list__main">
          <b>{showWork ? `${p.workCode} · ` : ""}{p.title}</b>
          <span className="bw-muted">
            {p.kindName}{p.location ? ` · ${p.location}` : ""} · {P.period.toLowerCase()} {period(p.neededFrom, p.neededTo)}
            {p.status === PermitStatus.needed && p.deadline !== undefined ? ` · ${P.deadline.toLowerCase()} ${fmtDayNum(p.deadline)}` : ""}
            {p.validTo !== undefined ? ` · ${P.valid.toLowerCase()} ${period(p.validFrom, p.validTo)}` : ""}
          </span>
          {p.warnings.length > 0 && <span className="a-warnline"><Icon name="alert" size={14} /> {p.warnings.map(warnText).join(" · ")}</span>}
        </span>
        <PermitStatusTag s={p.status} />
        <Icon name="next" size={18} />
      </button>
    </li>
  );
}

// ── Op de werfpagina ───────────────────────────────────────────────────────
export function WorkPermits({ w, fallback = null }: { w: WorkView; fallback?: ReactNode }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["workPermits", String(w.id)], queryFn: () => actor!.workPermits(w.id), enabled: !!actor && !isFetching, refetchOnWindowFocus: true, retry: 0 });
  const [open, setOpen] = useState<PermitView | null>(null);
  const [preset, setPreset] = useState<PermitSuggestion | "new" | null>(null);
  if (q.error) return <>{fallback}</>; // geen recht (klant): de sectie bestaat dan niet
  const v = q.data;
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{P.heading}</h2>
        {v?.canEdit && <Button icon="plus" onClick={() => setPreset("new")}>{P.add}</Button>}
      </div>
      <Loading q={q} />
      {v && (
        <>
          {v.permits.length === 0 && <p className="a-empty">{P.none}</p>}
          {v.permits.length > 0 && <ul className="a-list">{v.permits.map((p) => <PermitLine key={String(p.id)} p={p} onOpen={setOpen} />)}</ul>}
          {v.suggestions.length > 0 && (
            <>
              <span className="bw-label">{P.fromPlan}</span>
              <p className="bw-muted">{P.fromPlanLead}</p>
              <ul className="a-list">
                {v.suggestions.map((s) => (
                  <li key={`${s.taskId}-${s.kind}`} className="a-doc">
                    <span className="a-list__main">
                      <b>{s.taskTitle}</b>
                      <span className="bw-muted">{s.kindName} · {P.period.toLowerCase()} {period(s.start, s.end)} · {P.deadline.toLowerCase()} {fmtDayNum(s.deadline)}</span>
                    </span>
                    {s.deadline < todayDay() && <span className="a-tag a-tag--bad">{P.warn.deadlinePassed(N(todayDay() - s.deadline))}</span>}
                    <Button variant="secondary" onClick={() => setPreset(s)}>{P.create}</Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {v.canEdit && (
            <p className="bw-muted">
              {G.forWork}: {v.municipality ? <b>{v.municipality.name}</b> : G.notFound}
              {v.municipality && v.municipality.procedures.length > 0 && ` · ${v.municipality.procedures.map((p) => `${p.kindName}: ${G.hows[p.how] ?? p.how}, ${P.days(N(p.leadDays))}`).join(" · ")}`}
            </p>
          )}
        </>
      )}
      {open && v && <PermitSheet workId={w.id} permit={open} kinds={v.kinds} canEdit={open.canEdit} onClose={() => setOpen(null)} />}
      {preset && v && <PermitSheet workId={w.id} preset={preset === "new" ? undefined : preset} kinds={v.kinds} canEdit onClose={() => setPreset(null)} />}
    </section>
  );
}

// ── Formulier ──────────────────────────────────────────────────────────────
const STATUSES: PermitStatus[] = [PermitStatus.needed, PermitStatus.requested, PermitStatus.granted, PermitStatus.extended, PermitStatus.refused, PermitStatus.cancelled];

export function PermitSheet({ workId, permit, preset, kinds, canEdit, onClose }: { workId: bigint; permit?: PermitView; preset?: PermitSuggestion; kinds: PermitKindView[]; canEdit: boolean; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const plan = useQuery({ queryKey: ["plan", String(workId)], queryFn: () => actor!.getPlan(workId), enabled: !!actor && !isFetching && canEdit });
  const munis = useQuery({ queryKey: ["municipalities"], queryFn: () => actor!.listMunicipalities(false), enabled: !!actor && !isFetching && canEdit });
  const [cur, setCur] = useState<PermitView | undefined>(permit);
  const [kind, setKind] = useState(permit?.kind ?? preset?.kind ?? kinds[0]?.key ?? "");
  const [title, setTitle] = useState(permit?.title ?? "");
  const [status, setStatus] = useState<PermitStatus>(permit ? (permit.status === PermitStatus.expired ? PermitStatus.granted : permit.status) : PermitStatus.needed);
  const [location, setLocation] = useState(permit?.location ?? "");
  const [tasks, setTasks] = useState<bigint[]>(permit?.taskIds ?? (preset ? [preset.taskId] : []));
  const [from, setFrom] = useState(dayToInput(permit?.manualFrom));
  const [to, setTo] = useState(dayToInput(permit?.manualTo));
  const [lead, setLead] = useState(permit ? String(permit.leadDays) : "");
  const [requested, setRequested] = useState(dayToInput(permit?.requestedOn));
  const [vFrom, setVFrom] = useState(dayToInput(permit?.validFrom));
  const [vTo, setVTo] = useState(dayToInput(permit?.validTo));
  const [ref, setRef] = useState(permit?.reference ?? "");
  const [cost, setCost] = useState(permit?.costCents !== undefined ? (N(permit.costCents) / 100).toLocaleString("nl-BE") : "");
  const [note, setNote] = useState(permit?.note ?? "");
  const [muni, setMuni] = useState<string>(permit?.municipalityId !== undefined ? String(permit.municipalityId) : "");
  const [archiving, setArchiving] = useState(false);
  const [showProof, setShowProof] = useState(false);
  const history = useQuery({ queryKey: ["permitHistory", String(permit?.id)], queryFn: () => actor!.permitHistory(permit!.id), enabled: !!actor && !!permit && canEdit });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["workPermits", String(workId)] });
    void qc.invalidateQueries({ queryKey: ["permits"] });
    void qc.invalidateQueries({ queryKey: ["permitHistory"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const c = parseEuro(cost);
      if (c === null) throw new Error("Kost: bedrag klopt niet");
      const leadN = lead.trim() === "" ? undefined : Number(lead);
      if (leadN !== undefined && (!Number.isInteger(leadN) || leadN < 0)) throw new Error(P.lead2);
      return unwrap(await actor!.savePermit(workId, {
        id: cur?.id,
        kind,
        title,
        municipalityId: muni ? BigInt(muni) : undefined,
        status,
        location,
        taskIds: tasks,
        neededFrom: inputToDay(from),
        neededTo: inputToDay(to),
        leadDays: leadN === undefined ? undefined : BigInt(leadN),
        requestedOn: inputToDay(requested),
        validFrom: inputToDay(vFrom),
        validTo: inputToDay(vTo),
        reference: ref,
        costCents: c,
        note,
      }));
    },
    onSuccess: (p) => { setCur(p); setLead(String(p.leadDays)); setMuni(p.municipalityId !== undefined ? String(p.municipalityId) : ""); toast.show({ kind: "ok", text: t.common.saved }); refresh(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const archive = useMutation({
    mutationFn: async () => unwrap(await actor!.archivePermit(cur!.id, "")),
    onSuccess: () => { refresh(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });

  const taskOpts = (plan.data?.tasks ?? []).filter((x) => x.status !== "done" || tasks.includes(x.id));
  const toggle = (id: bigint) => setTasks((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const head = cur ? `${cur.kindName}` : P.add;

  if (!canEdit && cur) {
    return (
      <Sheet title={head} open onClose={onClose} side>
        <ReadOnly p={cur} />
        <Button variant="primary" icon="permit" onClick={() => setShowProof(true)}>{P.show}</Button>
        {showProof && <ProofSheet p={cur} onClose={() => setShowProof(false)} />}
      </Sheet>
    );
  }
  return (
    <Sheet title={head} open onClose={onClose} side wide
      footer={<>
        {cur && <Button variant="danger" onClick={() => setArchiving(true)}>{P.archive}</Button>}
        {cur && <Button icon="permit" onClick={() => setShowProof(true)}>{P.show}</Button>}
        <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button>
      </>}>
      {cur && cur.warnings.length > 0 && <p className="a-err"><Icon name="alert" size={16} /> {cur.warnings.map(warnText).join(" · ")}</p>}
      <Field label={P.kind}>
        <select className="bw-input" value={kind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
        </select>
      </Field>
      <Field label={P.titleF}><input className="bw-input" value={title} placeholder={P.titlePh} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label={P.status}>
        <Choice label={P.status} value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: P.statuses[s] }))} />
      </Field>
      <Field label={P.location}><input className="bw-input" value={location} placeholder={P.locationPh} onChange={(e) => setLocation(e.target.value)} /></Field>
      <span className="bw-label">{P.tasks}</span>
      <p className="bw-muted">{P.tasksHelp}</p>
      {plan.isLoading && <p className="bw-muted">{t.common.loading}</p>}
      <div className="p-tasks">
        {taskOpts.map((x) => (
          <label key={String(x.id)} className="p-task">
            <input type="checkbox" checked={tasks.includes(x.id)} onChange={() => toggle(x.id)} />
            <span>{x.title} <span className="bw-muted bw-num">{fmtDayNum(x.start)} – {fmtDayNum(x.end)}</span></span>
          </label>
        ))}
        {plan.data && taskOpts.length === 0 && <p className="bw-muted">{"–"}</p>}
      </div>
      {tasks.length === 0 && (
        <div className="a-row">
          <Field label={P.from}><input className="bw-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={P.to}><input className="bw-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      )}
      <div className="a-row">
        <Field label={G.name}>
          <select className="bw-input" value={muni} onChange={(e) => setMuni(e.target.value)}>
            <option value="">{cur ? (cur.municipalityId === undefined ? P.noMunicipality : "–") : P.autoMunicipality}</option>
            {(munis.data ?? []).map((m) => <option key={String(m.id)} value={String(m.id)}>{m.name}</option>)}
          </select>
        </Field>
        <Field label={P.lead2}><input className="bw-input" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ""))} /></Field>
      </div>
      <p className="bw-muted">{P.leadHelp}{cur?.deadline !== undefined ? ` · ${P.deadline}: ${fmtDayNum(cur.deadline)}` : ""}</p>
      <div className="a-row">
        <Field label={P.requestedOn}><input className="bw-input" type="date" value={requested} onChange={(e) => setRequested(e.target.value)} /></Field>
        <Field label={P.reference}><input className="bw-input" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
      <div className="a-row">
        <Field label={P.validFrom}><input className="bw-input" type="date" value={vFrom} onChange={(e) => setVFrom(e.target.value)} /></Field>
        <Field label={P.validTo}><input className="bw-input" type="date" value={vTo} onChange={(e) => setVTo(e.target.value)} /></Field>
      </div>
      <div className="a-row">
        <Field label={P.cost}><input className="bw-input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
      </div>
      <Field label={P.note}><textarea className="bw-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {cur && <PermitFiles p={cur} workId={workId} onDone={(p) => { setCur(p); refresh(); }} />}
      {!cur && <p className="bw-muted">{P.filesHelp}</p>}
      {cur && history.data && history.data.length > 0 && (
        <>
          <span className="bw-label">{P.history}</span>
          <ul className="a-hist">
            {history.data.map((h, i) => <li key={i}><span className="bw-num">{fmtTime(h.at)}</span> {h.byName}: {h.field}{h.from || h.to ? ` ${h.from}${h.from && h.to ? " → " : ""}${h.to}` : ""}</li>)}
          </ul>
        </>
      )}
      <Confirm open={archiving} title={P.archiveTitle} text={P.archiveText} confirmLabel={P.archive} busy={archive.isPending} onConfirm={() => archive.mutate()} onClose={() => setArchiving(false)} />
      {showProof && cur && <ProofSheet p={cur} onClose={() => setShowProof(false)} />}
    </Sheet>
  );
}

function ReadOnly({ p }: { p: PermitView }) {
  return (
    <dl className="a-dl">
      <dt>{P.status}</dt><dd><PermitStatusTag s={p.status} /></dd>
      <dt>{P.titleF}</dt><dd>{p.title}</dd>
      {p.location && <><dt>{P.location}</dt><dd>{p.location}</dd></>}
      <dt>{P.period}</dt><dd>{period(p.neededFrom, p.neededTo)}</dd>
      <dt>{P.valid}</dt><dd>{period(p.validFrom, p.validTo)}</dd>
      {p.reference && <><dt>{P.reference}</dt><dd className="bw-num">{p.reference}</dd></>}
      {p.municipalityName && <><dt>{G.name}</dt><dd>{p.municipalityName}</dd></>}
      {p.costCents !== undefined && <><dt>{P.cost}</dt><dd>{fmtEuro(p.costCents)}</dd></>}
    </dl>
  );
}

function PermitFiles({ p, workId, onDone }: { p: PermitView; workId: bigint; onDone: (p: PermitView) => void }) {
  const { actor } = useBackend();
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
      const fileId = unwrap(await actor!.addFile(name, mime, BigInt(bytes.length), blob, workId, false));
      return unwrap(await actor!.attachPermitFile(p.id, fileId));
    },
    onSuccess: (x) => { toast.show({ kind: "ok", text: t.common.saved }); onDone(x); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
    onSettled: () => setProgress(null),
  });
  return (
    <>
      <span className="bw-label">{P.files}</span>
      <p className="bw-muted">{P.filesHelp}</p>
      <ul className="a-list">
        {p.files.map((f) => (
          <li key={String(f.id)} className="a-doc">
            <span className="a-list__main"><b>{f.name}</b><span className="bw-muted">{fmtTime(f.at)}</span></span>
            {blobUrlOf(f.blob) && <a className="bw-btn bw-btn--quiet" href={blobUrlOf(f.blob)} target="_blank" rel="noreferrer">{t.werven.open}</a>}
          </li>
        ))}
      </ul>
      <label className="bw-btn bw-btn--secondary" style={{ position: "relative" }}>
        <Icon name="camera" size={20} />
        {up.isPending ? t.werven.uploading(progress ?? 0) : P.upload}
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={up.isPending} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} />
      </label>
    </>
  );
}

// ── De vergunning tonen (gsm, bewijs bij controle) ──────────────────────────
type Kept = { mime: string; name: string; data: Blob };
const keepKey = (fileId: bigint) => `vergunning-bestand|${fileId}`;

export function ProofSheet({ p, onClose }: { p: PermitView; onClose: () => void }) {
  const toast = useToast();
  const f = p.files[p.files.length - 1];
  const remote = f ? blobUrlOf(f.blob) : undefined;
  const [local, setLocal] = useState<{ url: string; mime: string } | null>(null);
  useEffect(() => {
    let url: string | null = null;
    if (!f) return;
    void cacheGet<Kept>(keepKey(f.id)).then((c) => {
      if (c?.value?.data) { url = URL.createObjectURL(c.value.data); setLocal({ url, mime: c.value.mime }); }
    });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [f?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = useMutation({
    mutationFn: async () => {
      if (!f || !remote) throw new Error(P.noFile);
      const r = await fetch(remote);
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.blob();
      await cachePut(keepKey(f.id), { mime: f.mime, name: f.name, data } satisfies Kept);
      setLocal({ url: URL.createObjectURL(data), mime: f.mime });
    },
    onSuccess: () => toast.show({ kind: "ok", text: P.kept }),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const src = local?.url ?? remote;
  const mime = local?.mime ?? f?.mime ?? "";
  return (
    <Sheet title={P.proofTitle} open onClose={onClose}>
      <div className="p-proof">
        <span className="bw-label">{p.workCode} · {p.workName}</span>
        <h2 className="bw-h1">{p.kindName}</h2>
        <PermitStatusTag s={p.status} />
        <dl className="a-dl">
          {p.location && <><dt>{P.location}</dt><dd>{p.location}</dd></>}
          <dt>{P.valid}</dt><dd className="bw-num">{period(p.validFrom, p.validTo)}</dd>
          {p.reference && <><dt>{P.reference}</dt><dd className="bw-num">{p.reference}</dd></>}
          {p.municipalityName && <><dt>{G.name}</dt><dd>{p.municipalityName}</dd></>}
        </dl>
        {!f && <p className="a-err">{P.noFile}</p>}
        {f && src && (mime.startsWith("image/") ? <img className="p-proof__img" src={src} alt={p.kindName} /> : <a className="bw-btn bw-btn--primary bw-btn--lg" href={src} target="_blank" rel="noreferrer">{f.name} ↗</a>)}
        {local && <p className="bw-muted"><Icon name="offline" size={14} /> {P.kept}</p>}
        {f && remote && !local && <Button icon="offline" busy={keep.isPending} onClick={() => keep.mutate()}>{P.keep}</Button>}
      </div>
    </Sheet>
  );
}

/** Op Vandaag: de vergunningen die vandaag gelden of nodig zijn, ook zonder bereik (laatste stand). */
export function PermitsOnSite() {
  const { actor } = useBackend();
  const day = todayDay();
  const q = useCached<PermitView[]>(["permitsOnSite", String(day)], () => actor!.permitsOnSite(day));
  const [show, setShow] = useState<PermitView | null>(null);
  const list = q.data?.value ?? [];
  if (!q.data) return null;
  return (
    <section className="a-section">
      <h2 className="bw-h2">{P.onSite}</h2>
      {list.length === 0 && <p className="a-empty">{P.onSiteNone}</p>}
      <ul className="a-list">
        {list.map((p) => (
          <li key={String(p.id)} className="a-doc">
            <span className="a-list__main">
              <b>{p.workCode} · {p.kindName}</b>
              <span className="bw-muted">{p.location || p.title} · {P.valid.toLowerCase()} {period(p.validFrom, p.validTo)}</span>
              {p.warnings.length > 0 && <span className="a-warnline"><Icon name="alert" size={14} /> {p.warnings.map(warnText).join(" · ")}</span>}
            </span>
            <PermitStatusTag s={p.status} />
            <Button variant="secondary" icon="permit" onClick={() => setShow(p)}>{P.show}</Button>
          </li>
        ))}
      </ul>
      {show && <ProofSheet p={show} onClose={() => setShow(null)} />}
    </section>
  );
}

// ── Overzicht over alle werven ─────────────────────────────────────────────
const FILTER_KEY = "bw-vergunningen-filter";

export function VergunningenPage({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const [filter, setFilter] = useState<string>(() => { try { return localStorage.getItem(FILTER_KEY) ?? "aandacht"; } catch { return "aandacht"; } });
  const q = useQuery({ queryKey: ["permits", filter], queryFn: () => actor!.listPermits(filter, null), enabled: !!actor && !isFetching, refetchOnWindowFocus: true });
  const [open, setOpen] = useState<PermitView | null>(null);
  const kinds = useQuery({ queryKey: ["permitKinds", false], queryFn: () => actor!.listPermitKinds(false), enabled: !!actor && !isFetching });
  const pick = (v: string) => { setFilter(v); try { localStorage.setItem(FILTER_KEY, v); } catch { /* enkel gemak */ } };
  return (
    <Page title={P.title}>
      <p className="bw-muted">{P.lead}</p>
      <PermitsOnSite />
      <section className="a-section">
        <Choice label={P.title} value={filter} onChange={pick} options={["aandacht", "lopend", "alles"].map((f) => ({ value: f, label: P.filter[f] }))} />
        <Loading q={q} />
        {q.data && q.data.length === 0 && (filter === "aandacht" ? <p className="a-empty">{P.overviewEmpty}</p> : <EmptyState title={t.leeg.vergunningen.t} text={t.leeg.vergunningen.d} action={<Button onClick={() => go("werven/lopend")}>{t.nav.werven}</Button>} />)}
        {q.data && q.data.length > 0 && <ul className="a-list">{q.data.map((p) => <PermitLine key={String(p.id)} p={p} onOpen={setOpen} showWork />)}</ul>}
      </section>
      {caps.managePermitKinds && <p className="a-note">{P.kindsMoved} <a href="#/beheer/documenten">{t.beheer.tabs.documenten}</a></p>}
      {open && kinds.data && (
        <PermitSheet workId={open.workId} permit={open} kinds={kinds.data} canEdit={open.canEdit} onClose={() => setOpen(null)} />
      )}
      {open && !open.canEdit && <Button onClick={() => go(`werven/${open.workId}/vergunningen`)}>{P.work}</Button>}
    </Page>
  );
}

/** De vergunningsoorten; sinds 2b.3 in Beheer → Documenten (AD-07). */
export function PermitKindsSettings() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const kinds = useQuery({ queryKey: ["permitKinds", true], queryFn: () => actor!.listPermitKinds(true), enabled: !!actor && !isFetching });
  const rules = useQuery({ queryKey: ["permitRules"], queryFn: () => actor!.permitRules(), enabled: !!actor && !isFetching });
  const [edit, setEdit] = useState<PermitKindView | "new" | null>(null);
  const [warn, setWarn] = useState("");
  const [exp, setExp] = useState("");
  useEffect(() => { if (rules.data) { setWarn(String(rules.data.warnDays)); setExp(String(rules.data.expiryDays)); } }, [rules.data]);
  const saveRules = useMutation({
    mutationFn: async () => unwrap(await actor!.setPermitRules({ warnDays: BigInt(warn || "0"), expiryDays: BigInt(exp || "0") })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const scan = useMutation({
    mutationFn: async () => actor!.scanPermits(),
    onSuccess: (n) => toast.show({ kind: "ok", text: P.scanned(N(n)) }),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{P.kinds}</h2>
        <Button icon="plus" onClick={() => setEdit("new")}>{P.addKind}</Button>
      </div>
      <p className="bw-muted">{P.kindsLead}</p>
      <ul className="a-list">
        {(kinds.data ?? []).map((k) => (
          <li key={k.key} className="a-doc">
            <span className="a-list__main">
              <b>{k.name}</b>
              <span className="bw-muted">{P.days(N(k.leadDays))}{k.words.length ? ` · ${k.words.join(", ")}` : ""}{k.publicDomain ? ` · ${P.kindPublic}` : ""}</span>
            </span>
            {k.archived && <span className="a-tag">{"gearchiveerd"}</span>}
            <Button variant="quiet" onClick={() => setEdit(k)}>{t.team.edit}</Button>
          </li>
        ))}
      </ul>
      <span className="bw-label">{P.rules}</span>
      <div className="a-row">
        <Field label={P.warnDays}><input className="bw-input" inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label={P.expiryDays}><input className="bw-input" inputMode="numeric" value={exp} onChange={(e) => setExp(e.target.value.replace(/\D/g, ""))} /></Field>
      </div>
      <div className="a-row">
        <Button busy={saveRules.isPending} onClick={() => saveRules.mutate()}>{t.common.save}</Button>
        <Button variant="quiet" icon="sync" busy={scan.isPending} onClick={() => scan.mutate()}>{P.scanNow}</Button>
      </div>
      {edit && <KindSheet k={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function KindSheet({ k, onClose }: { k?: PermitKindView; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [key, setKey] = useState(k?.key ?? "");
  const [name, setName] = useState(k?.name ?? "");
  const [lead, setLead] = useState(String(k?.leadDays ?? 14));
  const [words, setWords] = useState((k?.words ?? []).join(", "));
  const [pub, setPub] = useState(k?.publicDomain ?? true);
  const [archived, setArchived] = useState(k?.archived ?? false);
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.setPermitKind({ key, name, leadDays: BigInt(lead || "0"), words: words.split(",").map((w) => w.trim()).filter(Boolean), publicDomain: pub, order: k?.order ?? 999n, archived })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["permitKinds"] }); void qc.invalidateQueries({ queryKey: ["workPermits"] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={k ? k.name : P.addKind} open onClose={onClose} side footer={<Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button>}>
      <Field label={P.kindKey}><input className="bw-input" value={key} disabled={!!k} onChange={(e) => setKey(e.target.value.toLowerCase())} /></Field>
      <Field label={P.kindName}><input className="bw-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={P.kindLead}><input className="bw-input" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ""))} /></Field>
      <Field label={P.kindWords}><input className="bw-input" value={words} onChange={(e) => setWords(e.target.value)} /></Field>
      <label className="a-check"><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} /> {P.kindPublic}</label>
      {k && <label className="a-check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> {"gearchiveerd"}</label>}
    </Sheet>
  );
}

// ── Kennisbank per gemeente ────────────────────────────────────────────────
export function GemeentenPage({ caps }: { caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["municipalities"], queryFn: () => actor!.listMunicipalities(false), enabled: !!actor && !isFetching });
  const kinds = useQuery({ queryKey: ["permitKinds", false], queryFn: () => actor!.listPermitKinds(false), enabled: !!actor && !isFetching });
  const [edit, setEdit] = useState<MunicipalityView | "new" | null>(null);
  const [text, setText] = useState("");
  const list = (q.data ?? []).filter((m) => !text || m.name.toLowerCase().includes(text.toLowerCase()) || m.zips.some((z) => z.startsWith(text)));
  return (
    <Page title={G.title} actions={caps.manageMunicipalities ? <Button icon="plus" onClick={() => setEdit("new")}>{G.add}</Button> : undefined}>
      <p className="bw-muted">{G.lead}</p>
      <input className="bw-input" placeholder={"Zoeken"} value={text} onChange={(e) => setText(e.target.value)} />
      <Loading q={q} />
      {q.data && list.length === 0 && <p className="a-empty">{G.none}</p>}
      <ul className="a-list">
        {list.map((m) => (
          <li key={String(m.id)}>
            <button type="button" className="a-list__btn" onClick={() => setEdit(m)}>
              <span className="a-list__main">
                <b>{m.name}</b>
                <span className="bw-muted">{m.zips.join(", ")}{m.procedures.length ? ` · ${m.procedures.map((p) => `${p.kindName} ${P.days(N(p.leadDays))}`).join(" · ")}` : ` · ${G.noProcedures}`}</span>
              </span>
              <span className="a-tag">{G.permits(N(m.permitCount))}</span>
              <Icon name="next" size={18} />
            </button>
          </li>
        ))}
      </ul>
      {edit && <MunicipalitySheet m={edit === "new" ? undefined : edit} kinds={kinds.data ?? []} canEdit={caps.manageMunicipalities} onClose={() => setEdit(null)} />}
    </Page>
  );
}

function MunicipalitySheet({ m, kinds, canEdit, onClose }: { m?: MunicipalityView; kinds: PermitKindView[]; canEdit: boolean; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [cur, setCur] = useState<MunicipalityView | undefined>(m);
  const [name, setName] = useState(m?.name ?? "");
  const [zips, setZips] = useState((m?.zips ?? []).join(", "));
  const [portal, setPortal] = useState(m?.portal ?? "");
  const [email, setEmail] = useState(m?.email ?? "");
  const [phone, setPhone] = useState(m?.phone ?? "");
  const [contact, setContact] = useState(m?.contact ?? "");
  const [notes, setNotes] = useState(m?.notes ?? "");
  const [proc, setProc] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveMunicipality({ id: cur?.id, name, zips: zips.split(",").map((z) => z.trim()).filter(Boolean), portal: optText(portal), email: optText(email), phone: optText(phone), contact, notes, archived: false })),
    onSuccess: (x) => { setCur(x); toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["municipalities"] }); void qc.invalidateQueries({ queryKey: ["workPermits"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const ro = !canEdit;
  return (
    <Sheet title={cur?.name ?? G.add} open onClose={onClose} side wide footer={canEdit ? <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button> : undefined}>
      <Field label={G.name}><input className="bw-input" value={name} disabled={ro} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={G.zips}><input className="bw-input" value={zips} disabled={ro} onChange={(e) => setZips(e.target.value)} /></Field>
      <Field label={G.portal}><input className="bw-input" value={portal} disabled={ro} onChange={(e) => setPortal(e.target.value)} /></Field>
      {portal && /^https:\/\//.test(portal) && <a className="wb-link" href={portal} target="_blank" rel="noreferrer">{portal} ↗</a>}
      <div className="a-row">
        <Field label={G.email}><input className="bw-input" type="email" value={email} disabled={ro} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={G.phone}><input className="bw-input" value={phone} disabled={ro} onChange={(e) => setPhone(e.target.value)} /></Field>
      </div>
      <Field label={G.contact}><input className="bw-input" value={contact} disabled={ro} onChange={(e) => setContact(e.target.value)} /></Field>
      <Field label={G.notes}><textarea className="bw-input" rows={2} value={notes} disabled={ro} onChange={(e) => setNotes(e.target.value)} /></Field>
      {cur && (
        <>
          <div className="a-row a-row--between">
            <span className="bw-label">{G.procedures}</span>
            {canEdit && <Button variant="quiet" icon="plus" onClick={() => setProc(kinds.find((k) => !cur.procedures.some((p) => p.kind === k.key))?.key ?? kinds[0]?.key)}>{G.addProcedure}</Button>}
          </div>
          {cur.procedures.length === 0 && <p className="a-empty">{G.noProcedures}</p>}
          <ul className="a-list">
            {cur.procedures.map((p) => (
              <li key={p.kind} className="a-doc">
                <span className="a-list__main">
                  <b>{p.kindName}</b>
                  <span className="bw-muted">{G.hows[p.how] ?? p.how}{p.portal ? ` · ${p.portal}` : ""}{p.email ? ` · ${p.email}` : ""} · {P.days(N(p.leadDays))}{p.cost ? ` · ${p.cost}` : ""}{p.attachments.length ? ` · ${p.attachments.join(", ")}` : ""}</span>
                </span>
                {canEdit && <Button variant="quiet" onClick={() => setProc(p.kind)}>{t.team.edit}</Button>}
              </li>
            ))}
          </ul>
        </>
      )}
      {proc && cur && <ProcedureSheet m={cur} kinds={kinds} kindKey={proc} onClose={() => setProc(null)} onSaved={(x) => setCur(x)} />}
    </Sheet>
  );
}

function ProcedureSheet({ m, kinds, kindKey, onClose, onSaved }: { m: MunicipalityView; kinds: PermitKindView[]; kindKey: string; onClose: () => void; onSaved: (m: MunicipalityView) => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const ex = m.procedures.find((p) => p.kind === kindKey);
  const [kind, setKind] = useState(kindKey);
  const [how, setHow] = useState(ex?.how ?? "portaal");
  const [portal, setPortal] = useState(ex?.portal ?? m.portal ?? "");
  const [email, setEmail] = useState(ex?.email ?? m.email ?? "");
  const [lead, setLead] = useState(String(ex?.leadDays ?? kinds.find((k) => k.key === kindKey)?.leadDays ?? 14));
  const [cost, setCost] = useState(ex?.cost ?? "");
  const [att, setAtt] = useState((ex?.attachments ?? []).join(", "));
  const [contact, setContact] = useState(ex?.contact ?? m.contact);
  const [notes, setNotes] = useState(ex?.notes ?? "");
  const save = useMutation({
    mutationFn: async (archived: boolean) => unwrap(await actor!.saveProcedure({ municipalityId: m.id, kind, how, portal: optText(portal), email: optText(email), leadDays: BigInt(lead || "0"), cost, attachments: att.split(",").map((a) => a.trim()).filter(Boolean), contact, notes, archived })),
    onSuccess: (x) => { toast.show({ kind: "ok", text: t.common.saved }); onSaved(x); void qc.invalidateQueries({ queryKey: ["municipalities"] }); void qc.invalidateQueries({ queryKey: ["workPermits"] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={`${m.name} · ${G.procedures}`} open onClose={onClose} side
      footer={<>{ex && <Button variant="danger" onClick={() => save.mutate(true)}>{G.remove}</Button>}<Button variant="primary" busy={save.isPending} onClick={() => save.mutate(false)}>{t.common.save}</Button></>}>
      <Field label={P.kind}>
        <select className="bw-input" value={kind} disabled={!!ex} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
        </select>
      </Field>
      <Field label={G.how}><Choice label={G.how} value={how} onChange={setHow} options={["portaal", "e-mail", "loket", "andere"].map((h) => ({ value: h, label: G.hows[h] }))} /></Field>
      <Field label={G.portal}><input className="bw-input" value={portal} onChange={(e) => setPortal(e.target.value)} /></Field>
      <Field label={G.email}><input className="bw-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label={G.leadDays}><input className="bw-input" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ""))} /></Field>
      <Field label={G.cost}><input className="bw-input" value={cost} placeholder={G.costPh} onChange={(e) => setCost(e.target.value)} /></Field>
      <Field label={G.attachments}><input className="bw-input" value={att} placeholder={G.attachmentsPh} onChange={(e) => setAtt(e.target.value)} /></Field>
      <Field label={G.contact}><input className="bw-input" value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
      <Field label={G.notes}><textarea className="bw-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
