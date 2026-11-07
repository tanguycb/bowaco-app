// Werfadministratie en oplevering op de werf (stap 2c.8, tabblad Vergunningen & admin): de verzekering met de aangifte binnen 15 dagen,
// het attest voor de klant, werfwaarde en premie (enkel kantoor), daarna de werfvergadering, de oplevering en de technische fiches
// (zie WerfbeheerOplevering.tsx). Geen window.confirm; alles in de werf, geen nieuw menu-item.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ExternalBlob, type InsuranceConfInput, type InsuranceInput, type InsuranceView, type WorkView } from "../backend";
import { Button, Confirm, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtEuro, inputToDay, parseEuro, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { Field } from "./Werven";
import { WorkHandovers, WorkMeetings, WorkSheets } from "./WerfbeheerOplevering";
import { prepareUpload } from "../lib/uploadPrep";

const T = t.siteAdmin;
const I = T.insurance;

/** De premie zoals de backend ze rekent (lib/SiteAdmin.premium): werfwaarde × ‰ (in duizendsten), half omhoog, minstens het minimum. */
export function premiumCents(valueCents: bigint, rateMilli: bigint, minCents: bigint): bigint | null {
  if (rateMilli === 0n) return null;
  const v = valueCents < 0n ? 0n : valueCents;
  const raw = (v * rateMilli + 500_000n) / 1_000_000n;
  return raw > minCents ? raw : minCents;
}

/** Een bestand zonder vertrouwelijkheid opladen bij een werf (of zonder werf); geeft het id. */
export async function uploadPlain(actor: NonNullable<ReturnType<typeof useBackend>["actor"]>, x: File, workId: bigint | undefined, confidential = false): Promise<bigint> {
  x = await prepareUpload(x);
  if (!["application/pdf", "image/jpeg", "image/png"].includes(x.type)) throw new Error(t.oaFacturen.fileType);
  const bytes = new Uint8Array(await x.arrayBuffer());
  return unwrap(await actor.addFile(x.name, x.type, BigInt(bytes.length), ExternalBlob.fromBytes(bytes, x.type, x.name), workId ?? null, confidential));
}

export const kindKey = (k: InsuranceView["kind"]) => (k.__kind__ === "rc10Sub" ? "rc10" : k.__kind__ === "other" ? "other" : k.__kind__);
const stateTag = (s: string) => (s === "te-laat" || s === "vandaag" ? "a-tag--bad" : s === "binnenkort" ? "a-tag--warn" : "");

export function FileButton({ label, busy, onFile }: { label: string; busy?: boolean; onFile: (f: File) => void }) {
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <Button disabled={busy}>{label}</Button>
      <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => { const x = e.target.files?.[0]; if (x) onFile(x); e.target.value = ""; }} />
    </span>
  );
}

function InsuranceForm({ w, cur, onClose }: { w: bigint | undefined; cur?: InsuranceView; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching });
  const others = (orgs.data ?? []).filter((o) => o.kind === "other");
  const [f, setF] = useState({
    kind: cur ? kindKey(cur.kind) : "rc10", other: cur?.kind.__kind__ === "other" ? cur.kind.other : "", insurer: String(cur?.insurerOrgId ?? ""), broker: String(cur?.brokerOrgId ?? ""),
    policy: cur?.policyRef ?? "", from: dayToInput(cur?.periodFrom), to: dayToInput(cur?.periodTo), status: cur?.status.__kind__ ?? "toDeclare",
    declared: cur?.status.__kind__ === "declared" ? dayToInput(cur.status.declared) : dayToInput(BigInt(Math.floor(Date.now() / 86_400_000))), reason: cur?.status.__kind__ === "notNeeded" ? cur.status.notNeeded : "", note: cur?.note ?? "",
  });
  const save = useMutation({
    mutationFn: async () => {
      const kind = f.kind === "rc10" ? { __kind__: "rc10Sub" as const, rc10Sub: null } : f.kind === "other" ? { __kind__: "other" as const, other: f.other } : f.kind === "ba10" ? { __kind__: "ba10" as const, ba10: null } : { __kind__: "abr" as const, abr: null };
      const status = f.status === "declared" ? { __kind__: "declared" as const, declared: inputToDay(f.declared) ?? 0n } : f.status === "notNeeded" ? { __kind__: "notNeeded" as const, notNeeded: f.reason } : f.status === "insured" ? { __kind__: "insured" as const, insured: null } : { __kind__: "toDeclare" as const, toDeclare: null };
      const i: InsuranceInput = { id: cur?.id, workId: w, kind, insurerOrgId: f.insurer ? BigInt(f.insurer) : undefined, brokerOrgId: f.broker ? BigInt(f.broker) : undefined, policyRef: f.policy, periodFrom: inputToDay(f.from), periodTo: inputToDay(f.to), status, note: f.note, rev: cur?.rev ?? 0n };
      return unwrap(await actor!.saveInsurance(i));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: I.saved }); void qc.invalidateQueries({ queryKey: ["insurances"] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const orgSel = (k: "insurer" | "broker") => (
    <select className="bw-input" value={f[k]} onChange={set(k)}><option value="">{I.noneChosen}</option>{others.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}</select>
  );
  return (
    <Sheet title={cur ? I.edit : I.add} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <Field label={I.kind}><select className="bw-input" value={f.kind} onChange={set("kind")}>{Object.entries(I.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {f.kind === "other" && <Field label={I.otherName}><input className="bw-input" value={f.other} maxLength={80} onChange={set("other")} /></Field>}
        <div className="a-grid2"><Field label={I.insurer}>{orgSel("insurer")}</Field><Field label={I.broker}>{orgSel("broker")}</Field></div>
        <Field label={I.policy}><input className="bw-input bw-mono" value={f.policy} maxLength={80} onChange={set("policy")} /></Field>
        <div className="a-grid2"><Field label={I.from}><input type="date" className="bw-input" value={f.from} onChange={set("from")} /></Field><Field label={I.to}><input type="date" className="bw-input" value={f.to} onChange={set("to")} /></Field></div>
        <Field label={I.status}><select className="bw-input" value={f.status} onChange={set("status")}>{Object.entries(I.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {f.status === "declared" && <Field label={I.declaredOn}><input type="date" className="bw-input" value={f.declared} onChange={set("declared")} /></Field>}
        {f.status === "notNeeded" && <Field label={I.reason}><input className="bw-input" value={f.reason} onChange={set("reason")} /></Field>}
        <Field label={I.note}><textarea className="bw-input" rows={2} value={f.note} onChange={set("note")} /></Field>
      </div>
    </Sheet>
  );
}

function PremiumSheet({ ins, onClose }: { ins: InsuranceView; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const cur = useQuery({ queryKey: ["insuranceConf", String(ins.id)], queryFn: async () => unwrap(await actor!.readInsuranceConf(ins.id)), staleTime: 0, gcTime: 0 });
  const [f, setF] = useState({ value: "", rate: "", min: "", taxes: "", paid: false });
  useEffect(() => {
    const c = cur.data;
    if (c) setF({ value: c.workValueCents !== undefined ? fmtEuro(c.workValueCents) : "", rate: c.rateMilli !== undefined ? (Number(c.rateMilli) / 1000).toString().replace(".", ",") : "", min: c.minPremiumCents !== undefined ? fmtEuro(c.minPremiumCents) : "", taxes: c.taxesCents !== undefined ? fmtEuro(c.taxesCents) : "", paid: c.paid });
  }, [cur.data]);
  const opt = (s: string) => (s.trim() === "" ? undefined : parseEuro(s));
  const rateOf = (s: string): bigint | undefined | null => (s.trim() === "" ? undefined : /^\d+([.,]\d{1,3})?$/.test(s.trim()) ? BigInt(Math.round(Number(s.replace(",", ".")) * 1000)) : null);
  const value = opt(f.value);
  const rate = rateOf(f.rate);
  const min = opt(f.min);
  const taxes = opt(f.taxes);
  const valid = value !== null && rate !== null && min !== null && taxes !== null;
  const effRate = rate ?? cur.data?.defaultRateMilli ?? 0n;
  const effMin = min ?? cur.data?.defaultMinCents ?? 0n;
  const prem = valid && value !== undefined ? premiumCents(value, effRate, effMin) : null;
  // Review L14: veranderde de soort of het tarief sinds de premie bewaard werd, dan zegt het scherm dat (opnieuw bewaren herrekent de premie).
  const changed = cur.data !== undefined && valid && value !== undefined && cur.data.premiumNetCents !== undefined && prem !== cur.data.premiumNetCents;
  const sheet = useMutation({
    mutationFn: async () => {
      const d = unwrap(await actor!.insuranceSheet(ins.id));
      const [{ insuranceSheetPdf }, { loadPdfFonts }] = await Promise.all([import("../pdf/verzekering.ts"), import("../pdf/fonts.ts")]);
      const bytes = await insuranceSheetPdf({ kindName: d.kindName, policyRef: d.policyRef, insurer: d.insurerName, broker: d.brokerName, period: `${fmtDayNum(d.periodFrom)} – ${fmtDayNum(d.periodTo)}`, workCode: d.workCode, workName: d.workName, address: d.address, client: d.clientName, architect: d.architectName, start: fmtDayNum(d.startDay), end: fmtDayNum(d.endDay), workValue: d.workValueCents !== undefined ? fmtEuro(d.workValueCents) : "—", vat: `${Number(d.vatBp) / 100} %`, madeOn: fmtDayNum(BigInt(Math.floor(Date.now() / 86_400_000))) }, await loadPdfFonts());
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `gegevens-verzekering-${d.workCode}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const save = useMutation({
    mutationFn: async () => { const i: InsuranceConfInput = { workValueCents: value ?? undefined, rateMilli: rate ?? undefined, minPremiumCents: min ?? undefined, taxesCents: taxes ?? undefined, paid: f.paid, rev: cur.data?.rev ?? 0n }; return unwrap(await actor!.saveInsuranceConf(ins.id, i)); },
    onSuccess: () => { toast.show({ kind: "ok", text: I.saved }); void qc.invalidateQueries({ queryKey: ["insuranceConf"] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const set = (k: "value" | "rate" | "min" | "taxes") => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet title={`${I.premium} · ${ins.kindName}`} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <Loading q={cur} />
      {cur.data && (
        <div className="a-form">
          <Field label={I.workValue}><input className="bw-input bw-mono" inputMode="decimal" value={f.value} onChange={set("value")} /></Field>
          <div className="a-grid2">
            <Field label={I.rate}><input className="bw-input bw-mono" inputMode="decimal" value={f.rate} placeholder={(Number(cur.data.defaultRateMilli) / 1000).toString().replace(".", ",")} onChange={set("rate")} /></Field>
            <Field label={I.minimum}><input className="bw-input bw-mono" inputMode="decimal" value={f.min} placeholder={fmtEuro(cur.data.defaultMinCents)} onChange={set("min")} /></Field>
          </div>
          <p className="bw-muted">{I.rateHelp((Number(cur.data.defaultRateMilli) / 1000).toString().replace(".", ","), fmtEuro(cur.data.defaultMinCents))}</p>
          <Field label={I.taxes}><input className="bw-input bw-mono" inputMode="decimal" value={f.taxes} onChange={set("taxes")} /></Field>
          <label className="a-check"><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} />{I.paid}</label>
          <p><b>{I.premiumNet}:</b> {prem === null ? I.noPremium : fmtEuro(prem)}</p>
          {changed && <p className="a-err" role="status">{I.rateChanged(cur.data.premiumNetCents !== undefined ? fmtEuro(cur.data.premiumNetCents) : "—")}</p>}
          <div><Button variant="quiet" busy={sheet.isPending} onClick={() => sheet.mutate()}>{I.sheetPdf}</Button></div>
        </div>
      )}
    </Sheet>
  );
}

function InsuranceRow({ ins, workId, openFile }: { ins: InsuranceView; workId: bigint | undefined; openFile: (id: bigint) => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [prem, setPrem] = useState(false);
  const [kindDoc, setKindDoc] = useState("verzekering");
  const [askArchive, setAskArchive] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["insurances"] });
  const run = useMutation({ mutationFn: async (fn: () => Promise<unknown>) => fn(), onSuccess: refresh, onError: (e) => toast.show({ kind: "error", text: errText(e) }) });
  const attach = useMutation({
    mutationFn: async (x: File) => { const fid = await uploadPlain(actor!, x, workId, kindDoc !== "attest"); return unwrap(await actor!.attachInsuranceFile(ins.id, kindDoc === "attest" ? "verzekering-attest" : "verzekering", x.name.replace(/\.[^.]+$/, ""), fid, kindDoc === "attest")); },
    onSuccess: refresh, onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const s = ins.status;
  const statusText = s.__kind__ === "declared" ? `${I.statuses.declared} ${fmtDayNum(s.declared)}` : s.__kind__ === "notNeeded" ? `${I.statuses.notNeeded}: ${s.notNeeded}` : I.statuses[s.__kind__];
  return (
    <li className="a-doc" data-testid="insurance-row">
      <span className="a-list__main">
        <b>{ins.kindName}{ins.archived ? " (gearchiveerd)" : ""}</b>
        <span className="bw-muted">{[ins.insurerName && `${I.insurer}: ${ins.insurerName}`, ins.brokerName && `${I.broker}: ${ins.brokerName}`, ins.policyRef && `${I.policy} ${ins.policyRef}`].filter(Boolean).join(" · ")}</span>
        {(ins.periodFrom !== undefined || ins.periodTo !== undefined) && <span className="bw-muted">{fmtDayNum(ins.periodFrom)} – {fmtDayNum(ins.periodTo)}</span>}
        <span className="bw-muted">{statusText}{s.__kind__ === "toDeclare" ? ` · ${ins.declareBy !== undefined ? I.declareBy(fmtDayNum(ins.declareBy)) : workId !== undefined ? I.noStart : ""}` : ""}</span>
        {ins.documents.length > 0 && <span className="bw-muted">{I.docs}: {ins.documents.map((d) => <button key={String(d.docId)} className="a-link" disabled={d.fileId === undefined} onClick={() => d.fileId !== undefined && openFile(d.fileId)}>{d.title}{ins.attestDocId === d.docId ? ` (${I.attest.toLowerCase()})` : ""}</button>).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, " · ", x] : [x]), [])}</span>}
      </span>
      {ins.declareState && I.state[ins.declareState] ? <span className={`a-tag ${stateTag(ins.declareState)}`}>{I.state[ins.declareState]}</span> : null}
      {ins.attestShared && <span className="a-tag a-tag--ok">{I.shared}</span>}
      {ins.canEdit && !ins.archived && (
        <span className="a-row">
          <Button variant="quiet" onClick={() => setEdit(true)}>{I.edit}</Button>
          {ins.canSeeCosts && <Button variant="quiet" onClick={() => setPrem(true)}>{I.premium}</Button>}
          {workId !== undefined && (
            <>
              <select className="bw-input" aria-label={I.fileKind} value={kindDoc} onChange={(e) => setKindDoc(e.target.value)} style={{ width: "auto" }}>{Object.entries(I.kindsDoc).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <FileButton label={I.addFile} busy={attach.isPending} onFile={(x) => attach.mutate(x)} />
            </>
          )}
          {ins.canSeeCosts && ins.attestDocId !== undefined && <Button variant="quiet" busy={run.isPending} onClick={() => run.mutate(async () => unwrap(await actor!.shareInsuranceAttest(ins.id, !ins.attestShared)))}>{ins.attestShared ? I.unshare : I.share}</Button>}
          <Button variant="quiet" onClick={() => setAskArchive(true)}>{I.archive}</Button>
        </span>
      )}
      <Confirm open={askArchive} title={I.archive} text={I.archiveAsk(ins.kindName)} confirmLabel={I.archive} busy={run.isPending} onClose={() => setAskArchive(false)} onConfirm={() => run.mutate(async () => { unwrap(await actor!.archiveInsurance(ins.id)); setAskArchive(false); })} />
      {edit && <InsuranceForm w={workId} cur={ins} onClose={() => setEdit(false)} />}
      {prem && <PremiumSheet ins={ins} onClose={() => setPrem(false)} />}
    </li>
  );
}

/** Verzekeringen van een werf, of (workId leeg) de jaarpolissen in Beheer. */
export function InsuranceBlock({ workId, title }: { workId?: bigint; title?: string }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["insurances", String(workId ?? "jaar")], queryFn: () => actor!.listInsurances(workId ?? null, false), enabled: !!actor && !isFetching, retry: 0 });
  const [add, setAdd] = useState(false);
  const openFile = useOpenFile(workId);
  return (
    <section className="a-section" data-testid="insurance-block">
      <h2 className="bw-h2">{title ?? I.title}</h2>
      <Loading q={q} />
      {q.data && (q.data.length === 0 ? <p className="bw-muted">{workId === undefined ? T.settings.annualNone : I.none}</p> : <ul className="a-list">{q.data.map((x) => <InsuranceRow key={String(x.id)} ins={x} workId={workId} openFile={openFile} />)}</ul>)}
      <Button onClick={() => setAdd(true)}>{I.add}</Button>
      {add && <InsuranceForm w={workId} onClose={() => setAdd(false)} />}
    </section>
  );
}

/** Een bestand openen: via de lijst van de werf (niet vertrouwelijk) in een nieuw venster. */
export function useOpenFile(workId: bigint | undefined) {
  const { actor } = useBackend();
  const toast = useToast();
  return (id: bigint) => {
    void (async () => {
      try {
        const list = await actor!.listFiles(workId ?? null);
        const f = list.find((x) => x.id === id);
        // Stukken met werfwaarde of premie zijn vertrouwelijk: de opslag-URL komt dan enkel uit een update-call met auditregel (kantoor).
        const u = f?.confidential ? unwrap(await actor!.readConfidentialFile(id)).blob?.getDirectURL() : f?.blob?.getDirectURL();
        if (!u) throw new Error(t.common.error);
        window.open(u, "_blank", "noopener");
      } catch (e) {
        toast.show({ kind: "error", text: errText(e) });
      }
    })();
  };
}

/** Het blok op de werfpagina (interne rollen). */
export function WorkSiteAdmin({ w }: { w: WorkView }) {
  if (w.facts === undefined) return null; // externen: geen werfadministratie
  return (
    <>
      <InsuranceBlock workId={w.id} />
      <WorkMeetings w={w} />
      <WorkHandovers w={w} />
      <WorkSheets w={w} />
    </>
  );
}
