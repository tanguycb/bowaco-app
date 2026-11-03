// Aankoopfactuur registreren of verbeteren (stap 2c.7): firma, soort, nummer, datums, betaalkorting, btw, bijlagen (factuur en
// vorderingsstaat van de OA, vertrouwelijk), regels per werf of algemene kost met kostensoort, ploeguren en uren per dag. Het bedrag van
// een regel rekent de browser als het leeg is (hoeveelheid × eenheidsprijs); wat op de factuur staat, wordt getypt.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ExternalBlob, OrgKind, PurchaseKind, type PurchaseInput, type PurchaseLineInput } from "../backend";
import { Button, Icon, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtEuro, inputToDay, todayDay, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { TA } from "./Aankoop";
import { euroIn, parseEuroSigned, roundDiv } from "./OaFacturen";
import { fmtQty, parseQty } from "./Offertes";

type DayForm = { day: string; persons: string; slots: string; pause: string };
type LineForm = { lineId?: bigint; work: string; kind: string; root: string; description: string; persons: string; qty: string; unit: string; price: string; amount: string; passOn: boolean; days: DayForm[] };
const KINDS = ["post", "regie", "ploeg", "transport", "diesel", "kmheffing", "materiaal", "container", "machine", "voorschot", "aftrek-voorschot"];
const OA_ONLY = new Set(["post", "regie", "ploeg", "voorschot", "aftrek-voorschot"]);
const HOURS = new Set(["regie", "ploeg"]);
const COST = new Set(["transport", "diesel", "kmheffing", "materiaal", "container", "machine"]);
const UNITS: Record<string, string> = { regie: "u", ploeg: "u", transport: "uur", diesel: "km", kmheffing: "km", container: "ton", machine: "dag", materiaal: "st", voorschot: "", "aftrek-voorschot": "" };
const toMin = (s: string): bigint | null => { const m = s.trim().match(/^(\d{1,2})[:.h]?(\d{2})?$/); if (!m) return null; const h = Number(m[1]); const mm = Number(m[2] ?? 0); return h <= 24 && mm < 60 ? BigInt(h * 60 + mm) : null; };
// "07:30-12:00, 12:30-16:00" → tijdvakken (review L2: niet samenplooien, zodat de dag dezelfde blijft en de bevestiging blijft).
const parseSlots = (s: string): { fromMin: bigint; toMin: bigint }[] | null => {
  const parts = s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out = [];
  for (const p of parts) { const m = p.split(/\s*[-–]\s*/); if (m.length !== 2) return null; const a = toMin(m[0]); const b = toMin(m[1]); if (a === null || b === null) return null; out.push({ fromMin: a, toMin: b }); }
  return out;
};
const hm = (m: bigint) => `${String(Number(m) / 60 | 0).padStart(2, "0")}:${String(Number(m) % 60).padStart(2, "0")}`;
const emptyLine = (work: string, passOn: boolean): LineForm => ({ work, kind: "regie", root: "", description: "", persons: "", qty: "", unit: "u", price: "", amount: "", passOn, days: [] });

function PostSelect({ workId, value, regie, onChange }: { workId: string; value: string; regie: boolean; onChange: (v: string) => void }) {
  const { actor, isFetching } = useBackend();
  const posts = useQuery({ queryKey: ["oaInvoicePosts", workId], queryFn: () => actor!.oaInvoicePosts(BigInt(workId)), enabled: !!actor && !isFetching && /^\d+$/.test(workId) });
  return (
    <select className="bw-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{regie ? t.oaFacturen.regieAll : "—"}</option>
      {(posts.data ?? []).filter((x) => regie === ((x.form as string) === "regie")).map((x) => <option key={String(x.root)} value={String(x.root)}>{x.chapter ? `${x.chapter} · ` : ""}{x.title}</option>)}
    </select>
  );
}

export function PurchaseForm({ id, go }: { id?: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching });
  const works = useQuery({ queryKey: ["works"], queryFn: () => actor!.listWorks(), enabled: !!actor && !isFetching });
  const set = useQuery({ queryKey: ["purchaseSettings"], queryFn: () => actor!.purchaseSettings(), enabled: !!actor && !isFetching });
  const cur = useQuery({ queryKey: ["purchaseFull", String(id ?? "")], queryFn: async () => unwrap(await actor!.readPurchase(id!)), enabled: !!actor && !isFetching && id !== undefined, staleTime: 0, gcTime: 0 });
  const w0 = window.location.hash.match(/[?&]w=(\d+)/)?.[1] ?? "";
  // 2c.8+ B: een creditnota op een aankoop (nieuw met ?credit=<id>, of verbeteren van een bestaande creditnota).
  const c0 = window.location.hash.match(/[?&]credit=(\d+)/)?.[1];
  const creditOf: bigint | undefined = cur.data ? cur.data.brief.creditOf : c0 ? BigInt(c0) : undefined;
  const orig = useQuery({ queryKey: ["purchaseFull", String(creditOf ?? "")], queryFn: async () => unwrap(await actor!.readPurchase(creditOf!)), enabled: !!actor && !isFetching && creditOf !== undefined, staleTime: 0, gcTime: 0 });
  const credit = creditOf !== undefined;
  const [f, setF] = useState({ kind: "oa", orgId: "", number: "", day: dayToInput(todayDay()), due: "", discUntil: "", discPct: "", from: "", to: "", regime: "reverse", mention: true, net: "", vat: "", total: "", note: "", statRef: "" });
  const [lines, setLines] = useState<LineForm[]>([emptyLine(w0, false)]);
  const [file, setFile] = useState<{ id: bigint; name: string } | null>(null);
  const [stat, setStat] = useState<{ id: bigint; name: string } | null>(null);
  const [finals, setFinals] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const v = cur.data;
  useEffect(() => {
    if (!v) return;
    const b = v.brief;
    setF({ kind: b.kind, orgId: String(b.orgId), number: b.number, day: dayToInput(b.invoiceDay), due: dayToInput(b.dueDay), discUntil: dayToInput(b.discountUntil), discPct: v.discountBp !== undefined ? String(Number(v.discountBp) / 100).replace(".", ",") : "", from: dayToInput(v.periodFrom), to: dayToInput(v.periodTo), regime: v.vatRegime.__kind__ === "reverse" ? "reverse" : String(v.vatRegime.normal), mention: v.reverseMention, net: euroIn(v.netCents), vat: euroIn(v.vatCents), total: euroIn(v.totalCents), note: v.note, statRef: v.oaStatementRef });
    setLines(v.lines.map((l) => ({ work: l.workId !== undefined ? String(l.workId) : "general", kind: l.kind, root: l.root !== undefined ? String(l.root) : "", description: l.description, persons: l.persons !== undefined ? String(l.persons) : "", qty: fmtQty(l.qtyMilli), unit: l.unit, price: euroIn(l.unitCents), amount: euroIn(l.amountCents), passOn: l.passOn, days: l.days.map((d) => ({ day: dayToInput(d.day), persons: String(d.persons), slots: d.slots.map((x) => `${hm(x.fromMin)}-${hm(x.toMin)}`).join(", "), pause: String(d.pauseMin) })), lineId: l.lineId })));
    setFile(v.file ? { id: v.file.id, name: v.file.name } : null);
    setStat(v.statement ? { id: v.statement.id, name: v.statement.name } : null);
    setFinals(v.finalWorkIds.map(String));
  }, [v]);
  const o0 = orig.data;
  useEffect(() => {
    if (!o0 || id !== undefined) return;
    const b = o0.brief;
    setF((x) => ({ ...x, kind: b.kind, orgId: String(b.orgId), due: "", discUntil: "", discPct: "", from: dayToInput(o0.periodFrom), to: dayToInput(o0.periodTo), regime: o0.vatRegime.__kind__ === "reverse" ? "reverse" : String(o0.vatRegime.normal), mention: o0.reverseMention }));
    const abs = (c: bigint) => (c < 0n ? -c : c);
    setLines(o0.lines.filter((l) => l.kind !== "aftrek-voorschot" && l.amountCents > 0n && l.amountCents > l.creditedCents).map((l) => ({ work: l.workId !== undefined ? String(l.workId) : "general", kind: l.kind, root: l.root !== undefined ? String(l.root) : "", description: l.description, persons: l.persons !== undefined ? String(l.persons) : "", qty: fmtQty(l.qtyMilli), unit: l.unit, price: euroIn(l.unitCents), amount: euroIn(abs(l.amountCents) - l.creditedCents), passOn: l.passOn, days: [], lineId: l.lineId })));
  }, [o0, id]);
  const firms = (orgs.data ?? []).filter((o) => (f.kind === "oa" ? o.kind === OrgKind.subcontractor : f.kind === "supplier" ? o.kind === OrgKind.supplier : o.kind === OrgKind.subcontractor || o.kind === OrgKind.supplier || o.kind === OrgKind.other || o.kind === OrgKind.authority));
  const kinds = KINDS.filter((k) => f.kind === "oa" || !OA_ONLY.has(k));
  const upLine = (k: number, x: Partial<LineForm>) => setLines((ls) => ls.map((l, i) => (i === k ? { ...l, ...x } : l)));
  const upDay = (k: number, j: number, x: Partial<DayForm>) => setLines((ls) => ls.map((l, i) => (i === k ? { ...l, days: l.days.map((d, m) => (m === j ? { ...d, ...x } : d)) } : l)));
  const lineOut = (l: LineForm): PurchaseLineInput | null => {
    const qty = parseQty(l.qty || "0");
    const unit = parseEuroSigned(l.price || "0");
    if (qty === null || unit === null || !l.work) return null;
    const amount = l.amount.trim() === "" ? roundDiv(qty * unit, 1000n) : parseEuroSigned(l.amount);
    if (amount === null) return null;
    const days = [];
    for (const d of l.days) {
      const day = inputToDay(d.day);
      const slots = parseSlots(d.slots);
      if (day === undefined || slots === null || !/^\d+$/.test(d.persons) || !/^\d*$/.test(d.pause)) return null;
      days.push({ day, persons: BigInt(d.persons), slots, pauseMin: BigInt(d.pause || "0") });
    }
    const general = l.work === "general";
    return { workId: general ? undefined : BigInt(l.work), kind: l.kind, root: (l.kind === "post" || HOURS.has(l.kind)) && l.root ? BigInt(l.root) : undefined, description: l.description, persons: l.kind === "ploeg" && /^\d+$/.test(l.persons) ? BigInt(l.persons) : undefined, qtyMilli: qty, unit: l.unit, unitCents: unit, amountCents: amount, passOn: !general && COST.has(l.kind) && l.passOn, days: HOURS.has(l.kind) && !general ? days : [], lineId: l.lineId };
  };
  const outs = lines.map(lineOut);
  const sum = outs.reduce((a, l) => a + (l?.amountCents ?? 0n), 0n);
  const net = parseEuroSigned(f.net);
  const vat = parseEuroSigned(f.vat || "0");
  const total = parseEuroSigned(f.total);
  const discBp = f.discPct.trim() ? Math.round(Number(f.discPct.replace(",", ".")) * 100) : null;
  const workIds = [...new Set(lines.map((l) => l.work).filter((w) => /^\d+$/.test(w)))];
  const valid = f.orgId && f.number.trim() && inputToDay(f.day) !== undefined && net !== null && vat !== null && total !== null && outs.every((x) => x !== null) && (discBp === null || (Number.isFinite(discBp) && discBp > 0));
  const upload = async (x: File, which: "file" | "stat") => {
    setBusy(true);
    try {
      if (!["application/pdf", "image/jpeg", "image/png"].includes(x.type)) throw new Error(t.oaFacturen.fileType);
      const bytes = new Uint8Array(await x.arrayBuffer());
      const blob = ExternalBlob.fromBytes(bytes, x.type, x.name);
      const fid = unwrap(await actor!.addFile(x.name, x.type, BigInt(bytes.length), blob, workIds.length === 1 ? BigInt(workIds[0]) : null, true));
      (which === "file" ? setFile : setStat)({ id: fid, name: x.name });
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const input: PurchaseInput = {
        id, orgId: BigInt(f.orgId), kind: f.kind as PurchaseKind, number: f.number.trim(), invoiceDay: inputToDay(f.day)!, dueDay: inputToDay(f.due), discountUntil: inputToDay(f.discUntil), discountBp: discBp !== null ? BigInt(discBp) : undefined,
        periodFrom: inputToDay(f.from), periodTo: inputToDay(f.to), vatRegime: f.regime === "reverse" ? { __kind__: "reverse", reverse: null } : { __kind__: "normal", normal: BigInt(f.regime) }, reverseMention: f.regime === "reverse" ? f.mention : false,
        fileId: file?.id, oaStatementFileId: stat?.id, oaStatementRef: f.statRef, note: f.note, netCents: net!, vatCents: vat!, totalCents: total!, lines: outs as PurchaseLineInput[], finalWorkIds: credit ? [] : finals.filter((w) => workIds.includes(w)).map((w) => BigInt(w)),
        creditOf,
      };
      const nid = unwrap(await actor!.savePurchase(input, v ? v.brief.rev : 0n));
      toast.show({ kind: "ok", text: TA.saved });
      void qc.invalidateQueries({ queryKey: ["purchases"] });
      void qc.invalidateQueries({ queryKey: ["oaInvoices"] });
      go(`oa-facturen/aankoop/${nid}`);
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const fld = (label: string, el: React.ReactNode) => <label className="bw-field"><span className="bw-label">{label}</span>{el}</label>;
  const fileBtn = (label: string, cur: { name: string } | null, which: "file" | "stat") => (
    <div className="a-row">
      <label className="bw-btn bw-btn--secondary" style={{ position: "relative" }}>
        <Icon name="doc" size={20} />{label}
        <input type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} data-testid={`pu-${which}`} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x, which); e.target.value = ""; }} />
      </label>
      <span className="bw-muted">{cur?.name || TA.noFile} · {TA.fileConfidential}</span>
    </div>
  );
  return (
    <Page wide label={t.oaFacturen.label} title={credit ? TA.creditTitle(o0?.brief.number ?? "") : id ? TA.editTitle : TA.newTitle} actions={<><Button icon="back" onClick={() => go(id ? `oa-facturen/aankoop/${id}` : "oa-facturen/aankoop")}>{t.common.back}</Button><Button variant="primary" icon="check" busy={busy} disabled={!valid} onClick={() => void save()} data-testid="pu-save">{TA.save}</Button></>}>
      {id !== undefined && <Loading q={cur} />}
      {credit && <p className="a-note" data-testid="pu-credit-lead">{TA.creditLead}</p>}
      <section className="vs-card a-form" data-testid="pu-form">
        <div className="a-grid3">
          {fld(TA.kind, <select className="bw-input" disabled={credit} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, orgId: "" })} data-testid="pu-kind">{["oa", "supplier", "other"].map((k) => <option key={k} value={k}>{TA.kinds[k]}</option>)}</select>)}
          {fld(TA.firm, <select className="bw-input" disabled={credit} value={f.orgId} onChange={(e) => setF({ ...f, orgId: e.target.value })} data-testid="pu-org"><option value="">—</option>{firms.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}</select>)}
          {fld(TA.number, <input className="bw-input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} data-testid="pu-number" />)}
        </div>
        <div className="a-grid3">
          {fld(TA.day, <input type="date" className="bw-input" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />)}
          {fld(TA.due, <input type="date" className="bw-input" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />)}
          {fld(TA.periodFrom, <span className="a-row"><input type="date" className="bw-input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><input type="date" className="bw-input" aria-label={TA.periodTo} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></span>)}
        </div>
        {!credit && <div className="a-grid3">
          {fld(TA.discountUntil, <input type="date" className="bw-input" value={f.discUntil} onChange={(e) => setF({ ...f, discUntil: e.target.value })} data-testid="pu-disc-until" />)}
          {fld(TA.discountPct, <input className="bw-input bw-num" inputMode="decimal" placeholder="1,5" value={f.discPct} onChange={(e) => setF({ ...f, discPct: e.target.value })} data-testid="pu-disc-pct" />)}
          {fld(TA.regime, <select className="bw-input" value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value })}><option value="reverse">{t.oaFacturen.regimes.reverse}</option><option value="2100">{t.oaFacturen.regimes.n21}</option><option value="600">{t.oaFacturen.regimes.n6}</option><option value="0">{t.oaFacturen.regimes.n0}</option></select>)}
        </div>}
        {credit && <div className="a-grid3">{fld(TA.regime, <select className="bw-input" value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value })}><option value="reverse">{t.oaFacturen.regimes.reverse}</option><option value="2100">{t.oaFacturen.regimes.n21}</option><option value="600">{t.oaFacturen.regimes.n6}</option><option value="0">{t.oaFacturen.regimes.n0}</option></select>)}</div>}
        {f.regime === "reverse" && <label className="a-check"><input type="checkbox" checked={f.mention} onChange={(e) => setF({ ...f, mention: e.target.checked })} /> {TA.mention}</label>}
        <div className="a-grid3">
          {fld(TA.net, <input className="bw-input bw-num" inputMode="decimal" value={f.net} onChange={(e) => setF({ ...f, net: e.target.value })} data-testid="pu-net" />)}
          {fld(TA.vat, <input className="bw-input bw-num" inputMode="decimal" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} />)}
          {fld(TA.total, <input className="bw-input bw-num" inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} data-testid="pu-total" />)}
        </div>
        {fileBtn(TA.file, file, "file")}
        {f.kind === "oa" && fileBtn(TA.statement, stat, "stat")}
        {f.kind === "oa" && fld(TA.statementRef, <input className="bw-input" value={f.statRef} onChange={(e) => setF({ ...f, statRef: e.target.value })} />)}
        {fld(TA.note, <textarea className="bw-input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />)}
      </section>
      <LinesEditor credit={credit} oa={f.kind === "oa"} lines={lines} outs={outs} kinds={kinds} works={(works.data ?? []).map((w) => ({ id: String(w.id), label: `${w.code} · ${w.name}` }))} upLine={upLine} upDay={upDay} setLines={setLines} passOnDefault={set.data?.passOn ?? true} />
      <div className="a-row a-row--between">
        {credit ? <span /> : <Button icon="plus" onClick={() => setLines((ls) => [...ls, emptyLine(ls[ls.length - 1]?.work || w0 || (f.kind === "oa" ? String((works.data ?? [])[0]?.id ?? "") : ""), false)])} data-testid="pu-add-line">{TA.addLine}</Button>}
        <span className={`bw-mono${net !== null && sum !== net ? " a-err" : ""}`}>{TA.sumLines}: {fmtEuro(sum)}{net !== null && sum !== net ? ` ≠ ${fmtEuro(net)}` : ""}</span>
      </div>
      {!credit && f.kind === "oa" && workIds.length > 0 && (
        <section className="vs-section">
          {workIds.map((w) => <label key={w} className="a-check"><input type="checkbox" checked={finals.includes(w)} onChange={(e) => setFinals(e.target.checked ? [...finals, w] : finals.filter((x) => x !== w))} /> {TA.final} ({(works.data ?? []).find((x) => String(x.id) === w)?.code})</label>)}
        </section>
      )}
    </Page>
  );
}

function LinesEditor({ credit, oa, lines, outs, kinds, works, upLine, upDay, setLines, passOnDefault }: { credit: boolean; oa: boolean; lines: LineForm[]; outs: (PurchaseLineInput | null)[]; kinds: string[]; works: { id: string; label: string }[]; upLine: (k: number, x: Partial<LineForm>) => void; upDay: (k: number, j: number, x: Partial<DayForm>) => void; setLines: React.Dispatch<React.SetStateAction<LineForm[]>>; passOnDefault: boolean }) {
  return (
    <section className="vs-section">
      <h2 className="bw-h3">{TA.lines}</h2>
      <p className="bw-muted">{TA.linesLead}</p>
      {lines.map((l, k) => {
        const o = outs[k];
        const general = l.work === "general";
        return (
          <div key={k} className="vs-card a-form pu-line" data-testid="pu-line">
            <div className="a-grid3">
              <label className="bw-field"><span className="bw-label">{TA.work}</span>
                <select className="bw-input" disabled={credit} value={l.work} onChange={(e) => upLine(k, { work: e.target.value, root: "" })} data-testid="pu-line-work">
                  <option value="">—</option>
                  {works.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                  {!oa && <option value="general">{TA.general}</option>}
                </select>
              </label>
              <label className="bw-field"><span className="bw-label">{TA.costKind}</span>
                <select className="bw-input" disabled={credit} value={l.kind} onChange={(e) => upLine(k, { kind: e.target.value, root: "", unit: UNITS[e.target.value] ?? "", passOn: COST.has(e.target.value) ? passOnDefault : false, days: HOURS.has(e.target.value) ? l.days : [] })} data-testid="pu-line-kind">
                  {kinds.map((x) => <option key={x} value={x}>{TA.costKinds[x] ?? x}</option>)}
                </select>
              </label>
              {(l.kind === "post" || HOURS.has(l.kind)) && !general ? (
                <label className="bw-field"><span className="bw-label">{TA.post}</span><PostSelect workId={l.work} value={l.root} regie={l.kind !== "post"} onChange={(v) => upLine(k, { root: v })} /></label>
              ) : <span />}
            </div>
            <div className="a-grid3">
              <label className="bw-field"><span className="bw-label">{TA.description}</span><input className="bw-input" value={l.description} onChange={(e) => upLine(k, { description: e.target.value })} /></label>
              {l.kind === "ploeg" && <label className="bw-field"><span className="bw-label">{TA.persons}</span><input className="bw-input bw-num" inputMode="numeric" value={l.persons} onChange={(e) => upLine(k, { persons: e.target.value })} data-testid="pu-line-persons" /></label>}
              <label className="bw-field"><span className="bw-label">{TA.qty}</span><span className="vs-val"><input className="bw-input bw-num vs-input" inputMode="decimal" value={l.qty} onChange={(e) => upLine(k, { qty: e.target.value })} /><input className="bw-input vs-input" aria-label={TA.unit} style={{ maxWidth: 70 }} value={l.unit} onChange={(e) => upLine(k, { unit: e.target.value })} /></span></label>
              <label className="bw-field"><span className="bw-label">{TA.unitPrice}</span><input className="bw-input bw-num vs-input" inputMode="decimal" value={l.price} onChange={(e) => upLine(k, { price: e.target.value })} /></label>
              <label className="bw-field"><span className="bw-label">{TA.amount}</span><input className={`bw-input bw-num vs-input${o === null ? " vs-input--bad" : ""}`} inputMode="decimal" placeholder={o ? euroIn(o.amountCents) : ""} value={l.amount} onChange={(e) => upLine(k, { amount: e.target.value })} /></label>
            </div>
            {COST.has(l.kind) && !general && <label className="a-check"><input type="checkbox" disabled={credit} checked={l.passOn} onChange={(e) => upLine(k, { passOn: e.target.checked })} /> {TA.passOn}</label>}
            {HOURS.has(l.kind) && !general && !credit && (
              <div className="pu-days">
                <span className="bw-label">{TA.days}</span>
                {l.days.map((d, j) => (
                  <div key={j} className="a-row pu-day" data-testid="pu-day">
                    <input type="date" className="bw-input" value={d.day} onChange={(e) => upDay(k, j, { day: e.target.value })} />
                    <input className="bw-input bw-num" style={{ maxWidth: 60 }} inputMode="numeric" aria-label={TA.persons} value={d.persons} onChange={(e) => upDay(k, j, { persons: e.target.value })} />
                    <input className="bw-input" style={{ maxWidth: 220 }} aria-label={TA.slots} placeholder="07:30-12:00, 12:30-16:00" value={d.slots} onChange={(e) => upDay(k, j, { slots: e.target.value })} />
                    <input className="bw-input bw-num" style={{ maxWidth: 70 }} inputMode="numeric" aria-label={TA.pause} placeholder="30" value={d.pause} onChange={(e) => upDay(k, j, { pause: e.target.value })} />
                    <Button variant="quiet" icon="close" iconOnly onClick={() => upLine(k, { days: l.days.filter((_, m) => m !== j) })}>{TA.removeLine}</Button>
                  </div>
                ))}
                <Button variant="quiet" icon="plus" onClick={() => upLine(k, { days: [...l.days, { day: "", persons: l.persons || "1", slots: "07:30-16:00", pause: "30" }] })} data-testid="pu-add-day">{TA.addDay}</Button>
              </div>
            )}
            <div className="a-row"><Button variant="quiet" icon="close" onClick={() => setLines((ls) => ls.filter((_, i) => i !== k))}>{TA.removeLine}</Button></div>
          </div>
        );
      })}
    </section>
  );
}
