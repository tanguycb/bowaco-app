// OA-facturen (stap 2.11, bouwplan §9 rij 2.11 en §5.1; zonder AI): kantoor registreert de factuur van een onderaannemer (firma,
// werf, nummer, datum, bedragen, btw-regime, bijlage, regels) en ziet de controle per regel: de afgesproken prijs, wat gemeten of
// gepresteerd is (opmeting, VH, regie-uren van die OA met bevestigd/betwist), wat al gefactureerd is, en de markeringen boven de
// drempel. Goedkeuren vraagt de inhoudingsplicht-raadpleging van vandaag (met referentie) of een gemotiveerde uitzondering;
// betwisten vraagt een reden. De werfleider ziet de regels met hoeveelheden en uren, nooit een bedrag (oaInvoiceQty). De OA ziet
// enkel de status van zijn eigen facturen (MijnFacturenPage), als de beheerder dat aanzette. Bevestigen in een paneel.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ExternalBlob, OaInvoiceLineKind, OaInvoiceStatus, OrgKind, WithholdingResult, type Caps, type OaInvoiceFullView, type OaInvoiceInput, type OaInvoiceLine, type OaInvoiceQtyView, type OaLineQty, type OaPostOption, type OaVatRegime } from "../backend";
import { Button, Icon, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtEuro, fmtTime, inputToDay, parseEuro, todayDay, unwrap, useBackend } from "../util";
import { EmptyState, Loading, Page } from "./common";
import { OpenConfidential } from "./Dossier";
import { fmtQty, parseQty } from "./Offertes";
import "../app/oafactuur.css";

const T = t.oaFacturen;
const statusTag = (s: OaInvoiceStatus) => (s === OaInvoiceStatus.approved ? "a-tag--ok" : s === OaInvoiceStatus.disputed ? "a-tag--bad" : s === OaInvoiceStatus.withdrawn ? "" : "a-tag--accent");
const unitOf = (u: string) => (u === "m2" ? "m²" : u === "m3" ? "m³" : u);
const flagsText = (fs: string[]) => fs.map((f) => T.flags[f] ?? f);
const regimeOf = (r: OaVatRegime): string => (r.__kind__ === "reverse" ? "reverse" : String(r.normal));
const regimeTs = (k: string): OaVatRegime => (k === "reverse" ? { __kind__: "reverse", reverse: null } : { __kind__: "normal", normal: BigInt(k) });

export function OaFacturenPage({ caps, go, route }: { caps: Caps; go: (to: string) => void; route: string[] }) {
  if (route[1] === "nieuw") return caps.quotePrices ? <InvoiceForm go={go} /> : <ListPage caps={caps} go={go} />;
  if (route[1] && /^\d+$/.test(route[1])) {
    if (route[2] === "wijzigen" && caps.quotePrices) return <InvoiceForm key={`e${route[1]}`} id={BigInt(route[1])} go={go} />;
    return caps.quotePrices ? <FullInvoice key={route[1]} id={BigInt(route[1])} go={go} /> : <QtyInvoice key={route[1]} id={BigInt(route[1])} go={go} />;
  }
  return <ListPage caps={caps} go={go} />;
}

// ── Lijst ──────────────────────────────────────────────────────────────────
function ListPage({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const [status, setStatus] = useState<string>("");
  const q = useQuery({ queryKey: ["oaInvoices", status], queryFn: () => actor!.listOaInvoices(null, status ? (status as OaInvoiceStatus) : null), enabled: !!actor && !isFetching });
  const rows = q.data ?? [];
  return (
    <Page label={T.label} title={T.title} actions={caps.quotePrices ? <Button variant="primary" icon="plus" onClick={() => go("oa-facturen/nieuw")} data-testid="oi-new">{T.register}</Button> : undefined}>
      <p className="bw-muted" style={{ maxWidth: 720 }}>{caps.quotePrices ? T.lead : T.leadQty}</p>
      <label className="bw-field" style={{ maxWidth: 240 }}>
        <span className="bw-label">{T.statusFilter}</span>
        <select className="bw-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{T.allOpen}</option>
          {[OaInvoiceStatus.registered, OaInvoiceStatus.disputed, OaInvoiceStatus.approved, OaInvoiceStatus.withdrawn].map((s) => <option key={s} value={s}>{T.status[s]}</option>)}
        </select>
      </label>
      <Loading q={q} />
      {q.data && rows.length === 0 && <EmptyState title={t.leeg.oafacturen.t} text={t.leeg.oafacturen.d} action={<Button onClick={() => go("werven/lopend")}>{t.nav.werven}</Button>} />}
      {rows.length > 0 && (
        <ul className="a-list" data-testid="oi-list">
          {rows.map((b) => (
            <li key={String(b.id)}>
              <button type="button" className="a-list__btn" onClick={() => go(`oa-facturen/${b.id}`)}>
                <span className="a-tag bw-mono">{b.number}</span>
                <span className="a-list__main">
                  <b>{b.orgName}</b>
                  <span className="bw-muted">{b.workCode} {b.workName} · {fmtDayNum(b.invoiceDay)}{b.reverse ? ` · ${T.reverseShort}` : ""}{b.hasFile ? "" : ` · ${T.noFile}`}</span>
                </span>
                <span className={`a-tag ${statusTag(b.status)}`}>{T.status[b.status]}</span>
                <Icon name="next" size={18} />
              </button>
              {/* 2b.3: werklijst → de werf, op het tabblad Facturatie */}
              <Button variant="quiet" onClick={() => go(`werven/${b.workId}/facturatie`)}>{b.workCode}</Button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/** 2b.3: de facturen van onderaannemers van één werf (tabblad Facturatie). De werfleider ziet de status, geen bedragen. */
export function WorkOaInvoices({ workId, caps, go }: { workId: bigint; caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["oaInvoices", "werf", String(workId)], queryFn: () => actor!.listOaInvoices(workId, null), enabled: !!actor && !isFetching, retry: 0 });
  if (q.error) return null;
  const rows = q.data ?? [];
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.fase.oaInvoices}</h2>
        {caps.quotePrices && <Button icon="plus" onClick={() => go(`oa-facturen/nieuw?w=${workId}`)}>{T.register}</Button>}
      </div>
      <Loading q={q} />
      {q.data && rows.length === 0 && <p className="a-empty">{T.none}</p>}
      {rows.length > 0 && (
        <ul className="a-list">
          {rows.map((b) => (
            <li key={String(b.id)}>
              <button type="button" className="a-list__btn" onClick={() => go(`oa-facturen/${b.id}`)}>
                <span className="a-tag bw-mono">{b.number}</span>
                <span className="a-list__main"><b>{b.orgName}</b><span className="bw-muted">{fmtDayNum(b.invoiceDay)}{b.hasFile ? "" : ` · ${T.noFile}`}</span></span>
                <span className={`a-tag ${statusTag(b.status)}`}>{T.status[b.status]}</span>
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Registreren of verbeteren ──────────────────────────────────────────────
type LineForm = { kind: OaInvoiceLineKind; root: string; description: string; qty: string; unit: string; amount: string };
const emptyLine = (): LineForm => ({ kind: OaInvoiceLineKind.post, root: "", description: "", qty: "", unit: "", amount: "" });

function InvoiceForm({ id, go }: { id?: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching });
  const works = useQuery({ queryKey: ["works"], queryFn: () => actor!.listWorks(), enabled: !!actor && !isFetching });
  const cur = useQuery({ queryKey: ["oaInvoiceFull", String(id ?? "")], queryFn: async () => unwrap(await actor!.readOaInvoice(id!)), enabled: !!actor && !isFetching && id !== undefined, staleTime: 0, gcTime: 0 });
  const [f, setF] = useState({ orgId: "", workId: window.location.hash.match(/[?&]w=(\d+)/)?.[1] ?? "", number: "", day: dayToInput(todayDay()), due: "", from: "", to: "", regime: "reverse", mention: true, net: "", vat: "", total: "", note: "" });
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [fileId, setFileId] = useState<bigint | null>(null);
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const posts = useQuery({ queryKey: ["oaInvoicePosts", f.workId], queryFn: () => actor!.oaInvoicePosts(BigInt(f.workId)), enabled: !!actor && !isFetching && f.workId !== "" });
  const v = cur.data;
  useEffect(() => {
    if (!v) return;
    setF({ orgId: String(v.brief.orgId), workId: String(v.brief.workId), number: v.brief.number, day: dayToInput(v.brief.invoiceDay), due: dayToInput(v.brief.dueDay), from: dayToInput(v.periodFrom), to: dayToInput(v.periodTo), regime: regimeOf(v.vatRegime), mention: v.reverseMention, net: euroIn(v.netCents), vat: euroIn(v.vatCents), total: euroIn(v.totalCents), note: v.note });
    setLines(v.lines.map((l) => ({ kind: l.q.kind, root: l.q.root !== undefined ? String(l.q.root) : "", description: l.q.description, qty: fmtQty(l.q.qtyMilli), unit: euroIn(l.m.unitCents), amount: euroIn(l.m.amountCents) })));
    setFileId(v.file ? v.file.id : null);
    setFileName(v.file ? v.file.name : "");
  }, [v]);
  const subs = (orgs.data ?? []).filter((o) => o.kind === OrgKind.subcontractor || o.kind === OrgKind.supplier);
  const postMap = useMemo(() => new Map((posts.data ?? []).map((p) => [String(p.root), p])), [posts.data]);
  const upLine = (k: number, x: Partial<LineForm>) => setLines((ls) => ls.map((l, i) => (i === k ? { ...l, ...x } : l)));
  // Een regelbedrag dat leeg is, rekent de browser uit (hoeveelheid × eenheidsprijs); wat er op de factuur staat, wordt getypt.
  const lineOut = (l: LineForm): OaInvoiceLine | null => {
    const qty = parseQty(l.qty || "0");
    const unit = parseEuroSigned(l.unit || "0");
    if (qty === null || unit === null) return null;
    const amount = l.amount.trim() === "" ? roundDiv(qty * unit, 1000n) : parseEuroSigned(l.amount);
    if (amount === null) return null;
    return { kind: l.kind, root: l.kind !== OaInvoiceLineKind.other && l.root ? BigInt(l.root) : undefined, description: l.description, qtyMilli: qty, unitCents: unit, amountCents: amount };
  };
  const outs = lines.map(lineOut);
  const sum = outs.reduce((a, l) => a + (l?.amountCents ?? 0n), 0n);
  const net = parseEuroSigned(f.net);
  const vat = parseEuroSigned(f.vat || "0");
  const total = parseEuroSigned(f.total);
  const valid = f.orgId && f.workId && f.number.trim() && inputToDay(f.day) !== undefined && net !== null && vat !== null && total !== null && outs.every((x) => x !== null);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      if (!f.workId) throw new Error(T.workFirst);
      if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) throw new Error(T.fileType);
      const bytes = new Uint8Array(await file.arrayBuffer());
      setProgress(0);
      const blob = ExternalBlob.fromBytes(bytes, file.type, file.name).withUploadProgress(setProgress);
      const fid = unwrap(await actor!.addFile(file.name, file.type, BigInt(bytes.length), blob, BigInt(f.workId), true));
      setFileId(fid);
      setFileName(file.name);
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const input: OaInvoiceInput = {
        id, orgId: BigInt(f.orgId), workId: BigInt(f.workId), number: f.number.trim(), invoiceDay: inputToDay(f.day)!, dueDay: inputToDay(f.due), periodFrom: inputToDay(f.from), periodTo: inputToDay(f.to),
        vatRegime: regimeTs(f.regime), reverseMention: f.regime === "reverse" ? f.mention : false, fileId: fileId ?? undefined, note: f.note, netCents: net!, vatCents: vat!, totalCents: total!, lines: outs as OaInvoiceLine[],
      };
      const nid = unwrap(await actor!.saveOaInvoice(input, v ? v.brief.rev : 0n));
      toast.show({ kind: "ok", text: T.saved });
      void qc.invalidateQueries({ queryKey: ["oaInvoices"] });
      go(`oa-facturen/${nid}`);
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const fld = (label: string, el: React.ReactNode) => <label className="bw-field"><span className="bw-label">{label}</span>{el}</label>;
  return (
    <Page wide label={T.label} title={id ? T.editTitle : T.newTitle} actions={<><Button icon="back" onClick={() => go(id ? `oa-facturen/${id}` : "oa-facturen")}>{t.common.back}</Button><Button variant="primary" icon="check" busy={busy} disabled={!valid} onClick={() => void save()} data-testid="oi-save">{T.save}</Button></>}>
      {id !== undefined && <Loading q={cur} />}
      <section className="vs-card a-form" data-testid="oi-form">
        <div className="a-grid2">
          {fld(T.org, <select className="bw-input" value={f.orgId} onChange={(e) => setF({ ...f, orgId: e.target.value })} data-testid="oi-org"><option value="">—</option>{subs.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}</select>)}
          {fld(T.work, <select className="bw-input" value={f.workId} onChange={(e) => setF({ ...f, workId: e.target.value })} data-testid="oi-work"><option value="">—</option>{(works.data ?? []).filter((w) => (w.status as string) !== "cancelled" || String(w.id) === f.workId).map((w) => <option key={String(w.id)} value={String(w.id)}>{w.code} · {w.name}</option>)}</select>)}
        </div>
        <div className="a-grid3">
          {fld(T.number, <input className="bw-input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} data-testid="oi-number" />)}
          {fld(T.day, <input type="date" className="bw-input" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />)}
          {fld(T.due, <input type="date" className="bw-input" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />)}
        </div>
        <div className="a-grid2">
          {fld(T.periodFrom, <input type="date" className="bw-input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />)}
          {fld(T.periodTo, <input type="date" className="bw-input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />)}
        </div>
        <div className="a-grid2">
          {fld(T.regime, <select className="bw-input" value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value })} data-testid="oi-regime"><option value="reverse">{T.regimes.reverse}</option><option value="2100">{T.regimes.n21}</option><option value="600">{T.regimes.n6}</option><option value="0">{T.regimes.n0}</option></select>)}
          {f.regime === "reverse" && <label className="a-check"><input type="checkbox" checked={f.mention} onChange={(e) => setF({ ...f, mention: e.target.checked })} /> {T.mention}</label>}
        </div>
        <div className="a-grid3">
          {fld(T.net, <input className="bw-input bw-num" inputMode="decimal" value={f.net} onChange={(e) => setF({ ...f, net: e.target.value })} data-testid="oi-net" />)}
          {fld(T.vat, <input className="bw-input bw-num" inputMode="decimal" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} data-testid="oi-vat" />)}
          {fld(T.total, <input className="bw-input bw-num" inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} data-testid="oi-total" />)}
        </div>
        <div className="a-row">
          <label className="bw-btn bw-btn--secondary" style={{ position: "relative" }}>
            <Icon name="doc" size={20} />
            {busy && progress !== null ? t.werven.uploading(progress) : fileName ? T.fileReplace : T.file}
            <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy || !f.workId} data-testid="oi-file" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x); e.target.value = ""; }} />
          </label>
          <span className="bw-muted">{fileName || T.noFile} · {T.fileConfidential}</span>
        </div>
        {fld(T.note, <textarea className="bw-input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />)}
      </section>

      <section className="vs-section">
        <h2 className="bw-h3">{T.lines}</h2>
        <p className="bw-muted">{T.linesLead}</p>
        <div className="bw-table-wrap">
          <table className="bw-table bw-table--stack oi-form-table">
            <thead><tr><th>{T.kind}</th><th>{T.post}</th><th>{T.description}</th><th className="bw-right">{T.qty}</th><th className="bw-right">{T.unitPrice}</th><th className="bw-right">{T.amount}</th><th /></tr></thead>
            <tbody>
              {lines.map((l, k) => {
                const p = postMap.get(l.root);
                const o = outs[k];
                return (
                  <tr key={k} data-testid="oi-line">
                    <td data-label={T.kind}><select className="bw-input" value={l.kind} onChange={(e) => upLine(k, { kind: e.target.value as OaInvoiceLineKind, root: "" })}>{[OaInvoiceLineKind.post, OaInvoiceLineKind.regie, OaInvoiceLineKind.other].map((x) => <option key={x} value={x}>{T.kinds[x]}</option>)}</select></td>
                    <td data-label={T.post}>
                      {l.kind === OaInvoiceLineKind.other ? <span className="bw-muted">–</span> : (
                        <select className="bw-input" value={l.root} onChange={(e) => upLine(k, { root: e.target.value })}>
                          <option value="">{l.kind === OaInvoiceLineKind.regie ? T.regieAll : "—"}</option>
                          {(posts.data ?? []).filter((x: OaPostOption) => (l.kind === OaInvoiceLineKind.regie) === ((x.form as string) === "regie")).map((x) => <option key={String(x.root)} value={String(x.root)}>{x.chapter ? `${x.chapter} · ` : ""}{x.title}</option>)}
                        </select>
                      )}
                    </td>
                    <td data-label={T.description}><input className="bw-input" value={l.description} onChange={(e) => upLine(k, { description: e.target.value })} /></td>
                    <td data-label={T.qty} className="bw-right"><span className="vs-val"><input className="bw-input bw-num vs-input" inputMode="decimal" value={l.qty} onChange={(e) => upLine(k, { qty: e.target.value })} /><span className="bw-muted vs-unit">{p ? unitOf(p.unit) : l.kind === OaInvoiceLineKind.regie ? "u" : ""}</span></span></td>
                    <td data-label={T.unitPrice} className="bw-right"><input className="bw-input bw-num vs-input" inputMode="decimal" value={l.unit} onChange={(e) => upLine(k, { unit: e.target.value })} /></td>
                    <td data-label={T.amount} className="bw-right"><input className={`bw-input bw-num vs-input${o === null ? " vs-input--bad" : ""}`} inputMode="decimal" placeholder={o ? euroIn(o.amountCents) : ""} value={l.amount} onChange={(e) => upLine(k, { amount: e.target.value })} /></td>
                    <td><Button variant="quiet" icon="close" iconOnly onClick={() => setLines((ls) => ls.filter((_, i) => i !== k))}>{T.removeLine}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="a-row a-row--between">
          <Button icon="plus" onClick={() => setLines((ls) => [...ls, emptyLine()])} data-testid="oi-add-line">{T.addLine}</Button>
          <span className={`bw-mono${net !== null && sum !== net ? " a-err" : ""}`} data-testid="oi-sum">{T.sumLines}: {fmtEuro(sum)}{net !== null && sum !== net ? ` ≠ ${fmtEuro(net)}` : ""}</span>
        </div>
      </section>
    </Page>
  );
}

// ── Controle (admin, calculator) ───────────────────────────────────────────
function FullInvoice({ id, go }: { id: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["oaInvoiceFull", String(id)], queryFn: async () => unwrap(await actor!.readOaInvoice(id)), enabled: !!actor && !isFetching, staleTime: 0, gcTime: 0 });
  const [sheet, setSheet] = useState<null | "approve" | "dispute" | "withdraw" | "check">(null);
  const [reason, setReason] = useState("");
  const [exc, setExc] = useState("");
  const [useExc, setUseExc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chk, setChk] = useState({ result: WithholdingResult.clear as WithholdingResult, reference: "", note: "" });
  const v: OaInvoiceFullView | undefined = q.data;
  if (!v) return <Page label={T.label} title={T.title}><Loading q={q} /></Page>;
  const b = v.brief;
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e) { toast.show({ kind: "error", text: errText(e) }); } finally { setBusy(false); } };
  const done = async (text: string) => { toast.show({ kind: "ok", text }); setSheet(null); setReason(""); void qc.invalidateQueries({ queryKey: ["oaInvoices"] }); await q.refetch(); };
  const approve = () => run(async () => {
    const proof = useExc ? { __kind__: "exception" as const, exception: exc } : { __kind__: "check" as const, check: v.todayCheck!.id };
    unwrap(await actor!.approveOaInvoice(id, b.rev, proof, reason));
    await done(T.approvedOk);
  });
  const dispute = () => run(async () => { unwrap(await actor!.disputeOaInvoice(id, b.rev, reason)); await done(T.disputedOk); });
  const withdraw = () => run(async () => { unwrap(await actor!.withdrawOaInvoice(id, b.rev, reason)); await done(T.withdrawnOk); });
  const record = () => run(async () => {
    unwrap(await actor!.recordWithholdingCheck(b.orgId, { result: chk.result, consultedOn: todayDay(), reference: chk.reference, note: chk.note, workId: b.workId }));
    toast.show({ kind: "ok", text: T.checkOk });
    setSheet("approve");
    await q.refetch();
  });
  const flagN = v.flagCount;
  const w = v.withholding;
  const canApprove = useExc ? exc.trim().length >= 10 : !!v.todayCheck && v.todayCheck.reference.trim() !== "" && v.todayCheck.result !== WithholdingResult.unknown;
  return (
    <Page
      wide
      label={`${T.label} · ${b.workCode} ${b.workName}`}
      title={`${b.orgName} · ${b.number}`}
      actions={<>
        <Button icon="back" onClick={() => go("oa-facturen")}>{t.common.back}</Button>
        <Button icon="building" onClick={() => go(`werven/${b.workId}/facturatie`)}>{b.workCode}</Button>
        {v.canEdit && <Button icon="edit" onClick={() => go(`oa-facturen/${id}/wijzigen`)} data-testid="oi-edit">{T.edit}</Button>}
        {v.canDecide && <Button variant="primary" icon="check" onClick={() => { setReason(""); setSheet("approve"); }} data-testid="oi-approve">{T.approve}</Button>}
        {v.canEdit && <Button icon="alert" onClick={() => { setReason(""); setSheet("dispute"); }} data-testid="oi-dispute">{T.dispute}</Button>}
        {v.canDecide && <Button variant="quiet" icon="close" onClick={() => { setReason(""); setSheet("withdraw"); }}>{T.withdraw}</Button>}
      </>}
    >
      <div className="vs-head">
        <span className={`a-tag ${statusTag(b.status)}`}>{T.status[b.status]}</span>
        <span className="bw-muted">{T.dayLine(fmtDayNum(b.invoiceDay), b.dueDay !== undefined ? fmtDayNum(b.dueDay) : "–")}{v.periodFrom !== undefined ? ` · ${T.periodLine(fmtDayNum(v.periodFrom), fmtDayNum(v.periodTo))}` : ""}</span>
        {v.file && <OpenConfidential fileId={v.file.id} />}
      </div>
      {v.decision && <p className={v.decision.approved ? "a-note" : "a-err"} data-testid="oi-decision">{v.decision.approved ? T.decisionOk(v.decision.byName, fmtTime(v.decision.at)) : T.decisionNo(v.decision.byName, fmtTime(v.decision.at))}{v.decision.reason ? `: ${v.decision.reason}` : ""}{v.decision.withholding ? ` · ${v.decision.withholding.__kind__ === "check" ? T.proofCheck(t.wadm.results[v.decision.withholding.check.result], v.decision.withholding.check.reference) : T.proofException(v.decision.withholding.exception)}` : ""}</p>}

      <div className="vs-top">
        <section className="vs-card" data-testid="oi-amounts">
          <h2 className="bw-h3">{T.amounts}</h2>
          <dl className="vs-dl">
            <div><dt>{T.net}</dt><dd className="bw-mono">{fmtEuro(v.netCents)}</dd></div>
            <div><dt>{T.sumLines}</dt><dd className={`bw-mono${v.sumLinesCents !== v.netCents ? " a-err" : ""}`}>{fmtEuro(v.sumLinesCents)}</dd></div>
            <div><dt>{v.vatRegime.__kind__ === "reverse" ? T.regimes.reverse : T.vatAt(String(Number(v.vatRegime.normal) / 100))}</dt><dd className="bw-mono">{fmtEuro(v.vatCents)}{v.expectedVatCents !== undefined && v.expectedVatCents !== v.vatCents ? ` (${T.expected} ${fmtEuro(v.expectedVatCents)})` : ""}</dd></div>
            <div className="vs-dl__big"><dt>{T.total}</dt><dd className="bw-mono">{fmtEuro(v.totalCents)}</dd></div>
          </dl>
          {v.headerFlags.length > 0 && <ul className="vs-findings" data-testid="oi-header-flags">{v.headerFlags.map((f) => <li key={f.key}><span className="a-tag a-tag--warn">{T.flagTag}</span> {T.flags[f.key] ?? f.text}</li>)}</ul>}
          <p className="bw-muted">{T.hoursAll(fmtQty(v.hoursAll.validMilli), fmtQty(v.hoursAll.disputedMilli))}</p>
          {v.previous.length > 0 && (
            <>
              <h3 className="bw-h3">{T.previous}</h3>
              <ul className="vs-facts">{v.previous.map((p) => <li key={String(p.id)}><button type="button" className="wb-link" onClick={() => go(`oa-facturen/${p.id}`)}>{p.number}</button> · {fmtDayNum(p.invoiceDay)} · {T.status[p.status]} · <span className="bw-mono">{fmtEuro(p.netCents)}</span></li>)}</ul>
            </>
          )}
        </section>
        <section className="vs-card" data-testid="oi-withholding">
          <h2 className="bw-h3">{T.withholding}</h2>
          <p>{t.wadm.states[w.state] ?? w.state}{w.last ? ` · ${t.wadm.lastCheck} ${fmtDayNum(w.last.consultedOn)}${w.last.reference ? ` (${w.last.reference})` : ""}` : ""}</p>
          {v.todayCheck ? <p className="a-note" data-testid="oi-today">{T.today(t.wadm.results[v.todayCheck.result], v.todayCheck.reference || "–")}</p> : <p className="a-note">{T.noToday}</p>}
          {(v.withholdSocialCents > 0n || v.withholdFiscalCents > 0n) && <p className="a-err">{T.withhold(fmtEuro(v.withholdSocialCents), fmtEuro(v.withholdFiscalCents))}</p>}
          <div className="a-row">
            {w.link && <a className="bw-btn bw-btn--secondary" href={w.link} target="_blank" rel="noreferrer">{t.wadm.consult} ↗</a>}
            {v.canDecide && <Button onClick={() => setSheet("check")} data-testid="oi-record">{t.wadm.record}</Button>}
          </div>
        </section>
      </div>

      <section className="vs-section">
        <h2 className="bw-h3">{T.control} {flagN > 0 ? <span className="a-tag a-tag--warn">{T.flagCount(flagN)}</span> : <span className="a-tag a-tag--ok">{T.noFlags}</span>}</h2>
        <LinesControl lines={v.lines.map((l) => ({ q: l.q, m: l.m }))} />
      </section>

      <Sheet title={T.approveTitle} open={sheet === "approve"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={!canApprove || (flagN > 0 && reason.trim().length < 5)} onClick={() => void approve()} data-testid="oi-approve-go">{T.approve}</Button></>}>
        <p>{T.approveLead}</p>
        {v.todayCheck && !useExc ? <p className="a-note">{T.today(t.wadm.results[v.todayCheck.result], v.todayCheck.reference || "–")}</p> : null}
        {!v.todayCheck && !useExc && <p className="a-err">{T.needCheck}</p>}
        <label className="a-check"><input type="checkbox" checked={useExc} onChange={(e) => setUseExc(e.target.checked)} data-testid="oi-use-exc" /> {T.useException}</label>
        {useExc && <label className="bw-field"><span className="bw-label">{T.exception}</span><textarea className="bw-input" rows={2} value={exc} onChange={(e) => setExc(e.target.value)} data-testid="oi-exc" /></label>}
        {flagN > 0 && <label className="bw-field"><span className="bw-label">{T.flagReason(flagN)}</span><textarea className="bw-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="oi-reason" /></label>}
      </Sheet>
      <Sheet title={T.disputeTitle} open={sheet === "dispute"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 5} onClick={() => void dispute()} data-testid="oi-dispute-go">{T.dispute}</Button></>}>
        <p>{T.disputeLead(T.notice[v.disputeNotice] ?? v.disputeNotice)}</p>
        <label className="bw-field"><span className="bw-label">{T.reason}</span><textarea className="bw-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="oi-dispute-reason" /></label>
      </Sheet>
      <Sheet title={T.withdrawTitle} open={sheet === "withdraw"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 5} onClick={() => void withdraw()}>{T.withdraw}</Button></>}>
        <p>{T.withdrawLead}</p>
        <label className="bw-field"><span className="bw-label">{T.reason}</span><textarea className="bw-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </Sheet>
      <Sheet title={t.wadm.record} open={sheet === "check"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={chk.reference.trim() === ""} onClick={() => void record()} data-testid="oi-check-go">{t.wadm.record}</Button></>}>
        <p className="bw-muted">{t.wadm.recordLead}</p>
        <label className="bw-field"><span className="bw-label">{t.wadm.result}</span><select className="bw-input" value={chk.result} onChange={(e) => setChk({ ...chk, result: e.target.value as WithholdingResult })} data-testid="oi-check-result">{[WithholdingResult.clear, WithholdingResult.social, WithholdingResult.fiscal, WithholdingResult.both, WithholdingResult.unknown].map((r) => <option key={r} value={r}>{t.wadm.results[r]}</option>)}</select></label>
        <label className="bw-field"><span className="bw-label">{t.wadm.reference}</span><input className="bw-input" value={chk.reference} onChange={(e) => setChk({ ...chk, reference: e.target.value })} data-testid="oi-check-ref" /></label>
        <label className="bw-field"><span className="bw-label">{t.wadm.note}</span><input className="bw-input" value={chk.note} onChange={(e) => setChk({ ...chk, note: e.target.value })} /></label>
        <p className="bw-muted">{T.checkToday}</p>
      </Sheet>
    </Page>
  );
}

type CRow = { q: OaLineQty; m?: { unitCents: bigint; amountCents: bigint; agreedCents?: bigint; agreedOrg: boolean; prevCents: bigint; flags: string[] } };

function LinesControl({ lines }: { lines: CRow[] }) {
  const money = lines.some((l) => l.m);
  if (lines.length === 0) return <p className="a-empty">{T.noLines}</p>;
  return (
    <div className="bw-table-wrap">
      <table className="bw-table bw-table--stack oi-table" data-testid="oi-control">
        <thead>
          <tr>
            <th>{T.line}</th>
            <th className="bw-right">{T.qty}</th>
            <th className="bw-right">{T.expectedCol}</th>
            <th className="bw-right">{T.prevQty}</th>
            {money && <th className="bw-right">{T.unitPrice}</th>}
            {money && <th className="bw-right">{T.agreed}</th>}
            {money && <th className="bw-right">{T.amount}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const q = l.q;
            const u = unitOf(q.unit);
            const flags = [...q.flags, ...(l.m?.flags ?? [])];
            return (
              <tr key={String(q.index)} data-testid="oi-control-line">
                <td data-label={T.line}>
                  <span className="vs-post">
                    <b>{q.postTitle || q.description || T.kinds[q.kind]}</b>
                    <span className="bw-muted vs-sub">{T.kinds[q.kind]}{q.postTitle && q.description ? ` · ${q.description}` : ""}</span>
                    {q.hours && <span className="bw-muted vs-sub">{T.hoursLine(fmtQty(q.hours.validMilli), fmtQty(q.hours.openMilli), fmtQty(q.hours.disputedMilli))}</span>}
                    {flags.length > 0 ? <span className="vs-flags">{flagsText(flags).map((f, i) => <span key={i} className="a-tag a-tag--warn">{f}</span>)}</span> : <span className="vs-flags"><span className="a-tag a-tag--ok">{T.lineOk}</span></span>}
                  </span>
                </td>
                <td data-label={T.qty} className="bw-right bw-mono">{fmtQty(q.qtyMilli)} {u}</td>
                <td data-label={T.expectedCol} className="bw-right bw-mono">{q.expectedQtyMilli !== undefined ? `${fmtQty(q.expectedQtyMilli)} ${u}` : "–"}<span className="bw-muted vs-sub">{T.expectedFrom[q.expectedFrom] ?? ""}</span></td>
                <td data-label={T.prevQty} className="bw-right bw-mono">{fmtQty(q.prevQtyMilli)} {u}{l.m && <span className="bw-muted vs-sub">{fmtEuro(l.m.prevCents)}</span>}</td>
                {money && <td data-label={T.unitPrice} className="bw-right bw-mono">{fmtEuro(l.m?.unitCents)}</td>}
                {money && <td data-label={T.agreed} className="bw-right bw-mono">{l.m?.agreedCents !== undefined ? fmtEuro(l.m.agreedCents) : "–"}</td>}
                {money && <td data-label={T.amount} className="bw-right bw-mono">{fmtEuro(l.m?.amountCents)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── De werfleider: hoeveelheden en uren, geen bedragen ─────────────────────
function QtyInvoice({ id, go }: { id: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["oaInvoiceQty", String(id)], queryFn: () => actor!.oaInvoiceQty(id), enabled: !!actor && !isFetching });
  const v: OaInvoiceQtyView | undefined = q.data;
  if (!v) return <Page label={T.label} title={T.title}><Loading q={q} /></Page>;
  const b = v.brief;
  return (
    <Page wide label={`${T.label} · ${b.workCode} ${b.workName}`} title={`${b.orgName} · ${b.number}`} actions={<><Button icon="back" onClick={() => go("oa-facturen")}>{t.common.back}</Button><Button icon="building" onClick={() => go(`werven/${b.workId}/facturatie`)}>{b.workCode}</Button></>}>
      <div className="vs-head"><span className={`a-tag ${statusTag(b.status)}`}>{T.status[b.status]}</span><span className="bw-muted">{T.dayLine(fmtDayNum(b.invoiceDay), b.dueDay !== undefined ? fmtDayNum(b.dueDay) : "–")}</span></div>
      <p className="a-note">{T.qtyOnly}</p>
      {!v.oaOnWork && <p className="a-note">{T.flags["oa-niet-op-werf"]}</p>}
      <p className="bw-muted">{T.hoursAll(fmtQty(v.hoursAll.validMilli), fmtQty(v.hoursAll.disputedMilli))}</p>
      <LinesControl lines={v.lines.map((l) => ({ q: l }))} />
    </Page>
  );
}

// ── De OA: de status van zijn eigen facturen ───────────────────────────────
export function MijnFacturenPage() {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["myOaInvoices"], queryFn: () => actor!.myOaInvoices(), enabled: !!actor && !isFetching });
  const rows = q.data ?? [];
  return (
    <Page label={T.mine} title={T.mineTitle}>
      <p className="bw-muted" style={{ maxWidth: 640 }}>{T.mineLead}</p>
      <Loading q={q} />
      {q.data && rows.length === 0 && <EmptyState title={t.leeg.mijnFacturen.t} text={t.leeg.mijnFacturen.d} />}
      {rows.length > 0 && (
        <ul className="a-list" data-testid="my-oi">
          {rows.map((x) => (
            <li key={String(x.id)} className="oi-mine">
              <span className="a-tag bw-mono">{x.number}</span>
              <span className="a-list__main"><b>{x.workName}</b><span className="bw-muted">{fmtDayNum(x.invoiceDay)}{x.decidedAt !== undefined ? ` · ${fmtTime(x.decidedAt)}` : ""}{x.reason ? ` · ${x.reason}` : ""}</span></span>
              <span className={`a-tag ${statusTag(x.status)}`}>{T.status[x.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

// ── Kleine hulp ────────────────────────────────────────────────────────────
function roundDiv(n: bigint, d: bigint): bigint { return n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d); }
function euroIn(c: bigint | undefined): string {
  if (c === undefined) return "";
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / 100n},${String(a % 100n).padStart(2, "0")}`;
}
function parseEuroSigned(s: string): bigint | null {
  const v = s.trim().replace("−", "-");
  const neg = v.startsWith("-");
  const r = parseEuro(neg ? v.slice(1) : v);
  if (r === null || r === undefined) return r === undefined ? null : null;
  return neg ? -r : r;
}
