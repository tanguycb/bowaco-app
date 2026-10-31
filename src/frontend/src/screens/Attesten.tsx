// Tarieven & attesten (stap 2c.4, ontwerp 2c §3.2 en §4.4): op de firmafiche de tarieven van een OA met datum (vertrouwelijk: enkel
// kantoor, opgehaald met een update-call met auditregel) en de attesten met vervaldatum (interne rollen lezen de stand; kantoor zet en
// keurt, ⚖11). Voor de OA: Mijn contracten en Mijn attesten (blokken op Mijn week, geen nieuw menu-item). In Beheer: het sjabloon van
// de overeenkomst onderaanneming (versies).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DocStatus, ExternalBlob, type Caps } from "../backend";
import { Button, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtEuro, inputToDay, parseEuro, todayDay, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { StateTag, contractDownload } from "./Afspraken";
import { Field } from "./Werven";

const A = t.afspraken;
const DOC: Record<string, string> = { received: "te keuren", approved: "goedgekeurd", expired: "afgekeurd", missing: "ontbreekt", requested: "gevraagd", notApplicable: "n.v.t." };
const blobOf = (file: File, bytes: Uint8Array<ArrayBuffer>, onP: (n: number) => void) => ExternalBlob.fromBytes(bytes, file.type || "application/pdf", file.name).withUploadProgress(onP);

/** Firmafiche → Tarieven & attesten. */
export function TarievenAttesten({ orgId, caps, isOa }: { orgId: bigint; caps: Caps; isOa: boolean }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const on = !!actor && !isFetching;
  const docs = useQuery({ queryKey: ["orgDocs", String(orgId)], queryFn: () => actor!.listOrgDocs(orgId), enabled: on && caps.readTeam });
  const [showRates, setShowRates] = useState(false);
  const rates = useQuery({ queryKey: ["oaRates", String(orgId)], queryFn: async () => unwrap(await actor!.listOaRates(orgId)), enabled: on && caps.deals && showRates });
  const setup = useQuery({ queryKey: ["dealSetup"], queryFn: () => actor!.dealSetup(), enabled: on && caps.readTeam });
  const [r, setR] = useState({ kind: "regie", unit: "", euro: "", from: dayToInput(todayDay()), source: "offerte", ref: "" });
  const [d, setD] = useState({ kind: "ba", until: "", from: "" });
  const [reject, setReject] = useState<{ id: bigint; why: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["orgDocs", String(orgId)] }); void qc.invalidateQueries({ queryKey: ["oaRates", String(orgId)] }); };
  const addRate = useMutation({
    mutationFn: async () => {
      const cents = parseEuro(r.euro);
      const from = inputToDay(r.from);
      if (!cents || from === undefined) throw new Error(t.common.error);
      return unwrap(await actor!.saveOaRate({ orgId, kind: r.kind, unit: r.unit, cents, validFrom: from, source: r.source, ref: r.ref, fileId: undefined, note: "" }));
    },
    onSuccess: () => { setR({ ...r, euro: "", ref: "" }); refresh(); toast.show({ kind: "ok", text: t.common.saved }); },
    onError: fail,
  });
  const archive = useMutation({ mutationFn: async (id: bigint) => unwrap(await actor!.archiveOaRate(id, "fout ingevoerd (firmafiche)")), onSuccess: refresh, onError: fail });
  const addDoc = useMutation({
    mutationFn: async (file: File | null) => {
      let fileId: bigint | undefined;
      if (file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        setProgress(0);
        fileId = unwrap(await actor!.addDealFile(file.name, file.type || "application/pdf", BigInt(bytes.length), blobOf(file, bytes, setProgress), { __kind__: "orgDoc", orgDoc: orgId }));
      }
      return unwrap(await actor!.saveOrgDoc({ orgId, kind: d.kind, title: "", fileId, validFrom: inputToDay(d.from), validUntil: inputToDay(d.until), note: "" }));
    },
    onSuccess: () => { setD({ ...d, until: "", from: "" }); refresh(); toast.show({ kind: "ok", text: t.common.saved }); },
    onError: fail,
    onSettled: () => setProgress(null),
  });
  const review = useMutation({ mutationFn: async (x: { id: bigint; ok: boolean; why: string }) => unwrap(await actor!.reviewOrgDoc(x.id, x.ok, x.why)), onSuccess: () => { setReject(null); refresh(); }, onError: fail });
  if (!caps.readTeam) return null;
  return (
    <section className="a-section" data-testid="fiche-tarieven">
      <h3 className="bw-h3">{A.firmTitle}</h3>
      <p className="bw-muted">{A.firmLead}</p>
      {docs.data && <div className="a-row" style={{ flexWrap: "wrap", gap: 8 }}>{docs.data.states.map((s) => <span key={s.kind}>{s.name}: <StateTag state={s.state} />{s.validUntil !== undefined ? <span className="bw-muted"> {fmtDayNum(s.validUntil)}</span> : null}</span>)}</div>}
      <Loading q={docs} />
      {docs.data && (docs.data.docs.length === 0 ? <p className="bw-muted">{A.noDocs}</p> : (
        <ul className="a-list">{docs.data.docs.map((x) => (
          <li key={String(x.id)} style={{ flexWrap: "wrap" }}>
            <span className="a-list__main"><b>{x.kindName}</b><span>{A.validUntil}: {fmtDayNum(x.validUntil)} · {DOC[x.status] ?? x.status}{x.deliveredByName ? ` · ${A.by(x.deliveredByName)}` : ""}{x.note ? ` · ${x.note}` : ""}</span></span>
            {docs.data!.mayReview && x.status === DocStatus.received && <span className="a-row" style={{ gap: 6 }}>
              <Button variant="primary" busy={review.isPending} onClick={() => review.mutate({ id: x.id, ok: true, why: "" })}>{A.approve}</Button>
              {reject?.id === x.id
                ? <><input className="bw-input" aria-label={A.rejectReason} placeholder={A.rejectReason} value={reject.why} onChange={(e) => setReject({ id: x.id, why: e.target.value })} /><Button onClick={() => review.mutate({ id: x.id, ok: false, why: reject.why })}>{A.reject}</Button></>
                : <Button variant="quiet" onClick={() => setReject({ id: x.id, why: "" })}>{A.reject}</Button>}
            </span>}
          </li>))}
        </ul>))}
      {caps.deals && isOa && (
        <div className="a-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "end" }}>
          <Field label={A.kind}><select className="bw-input" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>{(setup.data?.docKinds ?? []).map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select></Field>
          <Field label={A.validUntil}><input className="bw-input" type="date" value={d.until} onChange={(e) => setD({ ...d, until: e.target.value })} /></Field>
          <label className="bw-btn bw-btn--secondary">{progress !== null ? `${Math.round(progress)} %` : A.docAdd}<input type="file" accept="application/pdf,image/*" hidden disabled={!d.until} onChange={(e) => { const f = e.target.files?.[0] ?? null; addDoc.mutate(f); e.target.value = ""; }} /></label>
        </div>
      )}
      {caps.deals && isOa && (!showRates ? <div><Button variant="quiet" onClick={() => setShowRates(true)}>{A.ratesShow}</Button></div> : (
        <div style={{ display: "grid", gap: 8 }}>
          <Loading q={rates} />
          {rates.data && (rates.data.length === 0 ? <p className="bw-muted">{A.noRates}</p> : (
            <ul className="a-list">{rates.data.map((x) => (
              <li key={String(x.id)}>
                <span className="a-list__main"><b>{x.kindName}: {fmtEuro(x.cents)} / {x.unit}</b><span>{A.from} {fmtDayNum(x.validFrom)} · {x.source}{x.ref ? ` · ${x.ref}` : ""}{x.archivedAt !== undefined ? ` · ${A.archived}` : ""}</span></span>
                {x.archivedAt === undefined && <Button variant="quiet" onClick={() => archive.mutate(x.id)}>{A.archive}</Button>}
              </li>))}
            </ul>))}
          <div className="a-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "end" }}>
            <Field label={A.kind}><select className="bw-input" value={r.kind} onChange={(e) => setR({ ...r, kind: e.target.value })}>{(setup.data?.rateKinds ?? []).map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select></Field>
            <Field label={A.amount}><input className="bw-input" inputMode="decimal" value={r.euro} onChange={(e) => setR({ ...r, euro: e.target.value })} style={{ width: 110 }} /></Field>
            <Field label={A.from}><input className="bw-input" type="date" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} /></Field>
            <Field label={A.source}><select className="bw-input" value={r.source} onChange={(e) => setR({ ...r, source: e.target.value })}>{(setup.data?.sources ?? []).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
            <Field label={A.ref}><input className="bw-input" value={r.ref} onChange={(e) => setR({ ...r, ref: e.target.value })} /></Field>
            <Button icon="plus" busy={addRate.isPending} disabled={!r.euro} onClick={() => addRate.mutate()}>{A.rateAdd}</Button>
          </div>
        </div>))}
    </section>
  );
}

/** De OA: Mijn contracten (enkel zijn eigen firma; verwijzing in plaats van een id). */
export function MijnContracten() {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const q = useQuery({ queryKey: ["myContracts"], queryFn: () => actor!.listMyContracts(), enabled: !!actor && !isFetching, retry: false });
  const pdf = useMutation({ mutationFn: async (x: { ref: string; v: bigint }) => contractDownload(unwrap(await actor!.readMyContract(x.ref, x.v)), "", ""), onError: (e) => toast.show({ kind: "error", text: errText(e) }) });
  const signed = useMutation({
    mutationFn: async (x: { ref: string; v: bigint }) => { const f = unwrap(await actor!.readMyContractFile(x.ref, x.v)); const u = f.blob.getDirectURL(); if (!u) throw new Error(t.common.error); return u; },
    onSuccess: (u) => window.open(u, "_blank", "noopener"),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (q.error || !q.data || q.data.length === 0) return null;
  return (
    <section className="a-section">
      <h2 className="bw-h2">{A.myContracts}</h2>
      <p className="bw-muted">{A.myContractsLead}</p>
      <ul className="a-list">{q.data.map((c) => (
        <li key={c.ref} style={{ flexWrap: "wrap" }}>
          <span className="a-list__main"><b>{c.workAddress}</b><span>{A.deal[c.status] ?? c.status} · {A.version(Number(c.contractVersion))}</span></span>
          {c.versions.map((v) => <Button key={String(v)} variant="quiet" busy={pdf.isPending} onClick={() => pdf.mutate({ ref: c.ref, v })}>{A.pdf} v{String(v)}</Button>)}
          {c.signed && <Button variant="quiet" onClick={() => signed.mutate({ ref: c.ref, v: c.contractVersion })}>{A.openSigned}</Button>}
        </li>))}
      </ul>
    </section>
  );
}

/** De OA: Mijn attesten (opladen met geldig-tot; BOWACO keurt, ⚖11). */
export function MijnAttesten() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["myAttests"], queryFn: () => actor!.listMyAttests(), enabled: !!actor && !isFetching, retry: false });
  const [d, setD] = useState({ kind: "ba", until: "" });
  const [progress, setProgress] = useState<number | null>(null);
  const up = useMutation({
    mutationFn: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setProgress(0);
      return unwrap(await actor!.addMyAttest(d.kind, "", null, inputToDay(d.until) ?? null, file.name, file.type || "application/pdf", BigInt(bytes.length), blobOf(file, bytes, setProgress)));
    },
    onSuccess: () => { setD({ ...d, until: "" }); void qc.invalidateQueries({ queryKey: ["myAttests"] }); toast.show({ kind: "ok", text: A.uploaded }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
    onSettled: () => setProgress(null),
  });
  if (q.error || !q.data) return null;
  return (
    <section className="a-section">
      <h2 className="bw-h2">{A.myAttests}</h2>
      <p className="bw-muted">{A.myAttestsLead}</p>
      <div className="a-row" style={{ flexWrap: "wrap", gap: 8 }}>{q.data.states.map((s) => <span key={s.kind}>{s.name}: <StateTag state={s.state} />{s.validUntil !== undefined ? <span className="bw-muted"> {fmtDayNum(s.validUntil)}</span> : null}</span>)}</div>
      {q.data.docs.length > 0 && <ul className="a-list">{q.data.docs.map((x) => <li key={x.ref}><span className="a-list__main"><b>{x.kindName}</b><span>{A.validUntil}: {fmtDayNum(x.validUntil)} · {DOC[x.status] ?? x.status}{x.note ? ` · ${x.note}` : ""}</span></span></li>)}</ul>}
      <div className="a-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <Field label={A.kind}><select className="bw-input" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>{q.data.kinds.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select></Field>
        <Field label={A.validUntil}><input className="bw-input" type="date" value={d.until} onChange={(e) => setD({ ...d, until: e.target.value })} /></Field>
        <label className={`bw-btn bw-btn--primary${d.until ? "" : " is-disabled"}`}>{progress !== null ? `${Math.round(progress)} %` : A.upload}<input type="file" accept="application/pdf,image/*" hidden disabled={!d.until} onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} /></label>
      </div>
    </section>
  );
}

/** Beheer → Offertes & voorwaarden: het sjabloon van de overeenkomst onderaanneming (een nieuwe versie; de vorige blijven). */
export function ContractSjabloon({ caps }: { caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["contractTemplates"], queryFn: () => actor!.listContractTemplates(), enabled: !!actor && !isFetching && caps.deals });
  const [edit, setEdit] = useState<{ title: string; text: string; provisional: boolean; note: string } | null>(null);
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveContractTemplate(edit!.title, edit!.text, edit!.provisional, edit!.note)),
    onSuccess: () => { setEdit(null); void qc.invalidateQueries({ queryKey: ["contractTemplates"] }); toast.show({ kind: "ok", text: A.tplSaved }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (!caps.deals) return null;
  const cur = q.data ? (q.data.length > 1 ? q.data[1] : q.data[0]) : undefined; // [ingebouwd, eigen versies nieuwste eerst]
  return (
    <section className="a-section">
      <h2 className="bw-h2">{A.tplTitle}</h2>
      <p className="bw-muted">{A.tplLead}</p>
      <Loading q={q} />
      {q.data && <ul className="a-list">{q.data.map((x) => <li key={String(x.id)}><span className="a-list__main"><b>{A.version(Number(x.version))} · {x.title}</b><span>{x.version === 0n ? A.tplBuiltin : `${x.createdByName}${x.provisional ? ` · ${A.tplProvisional}` : ""}${x.note ? ` · ${x.note}` : ""}`}</span></span></li>)}</ul>}
      {caps.manageSettings && !edit && cur && <div><Button icon="plus" onClick={() => setEdit({ title: cur.title, text: cur.text, provisional: true, note: "" })}>{A.tplNew}</Button></div>}
      {edit && (
        <div style={{ display: "grid", gap: 8 }}>
          <Field label="Titel"><input className="bw-input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="Tekst"><textarea className="bw-input" rows={18} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></Field>
          <Field label={A.note}><input className="bw-input" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
          <label className="a-row" style={{ gap: 6 }}><input type="checkbox" checked={edit.provisional} onChange={(e) => setEdit({ ...edit, provisional: e.target.checked })} /> {A.tplProvisional}</label>
          <div className="a-row" style={{ gap: 8 }}><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button><Button variant="quiet" onClick={() => setEdit(null)}>{t.common.cancel}</Button></div>
        </div>
      )}
    </section>
  );
}
