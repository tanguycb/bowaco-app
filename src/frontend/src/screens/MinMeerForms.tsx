// Formulieren van de min-meerstaat (stap 2c.5): een regel (kantoor) of een voorstel (werfleider, zonder prijs), een automatische regel
// aanpassen (uitsluiten, ander hoofdstuk, doorrekenen; met reden), het regietarief van de werf met datum, een meerwerkofferte uit de
// gekozen regels, de meerwerkoffertes van de werf (Offerte → Meerwerk) en de instellingen (Beheer). Alles wordt op de server
// opnieuw nagekeken; bevestigen gebeurt in het scherm (geen pop-up).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MmKind, type MinMeerFullView, type MmEntryView, type MmPostRef, type MmRowView, type MmApproval, type MmEntryInput } from "../backend";
import { Button, Choice, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtBp, fmtDayNum, fmtEuro, inputToDay, parseEuro, parsePct, todayDay, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { Field } from "./Werven";
import { parseQty, qtyText } from "./MinMeer";

const T = t.minmeer;
const E = T.entry;
const euroIn = (c: bigint | undefined) => (c === undefined ? "" : (Number(c) / 100).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

type Form = { kind: MmKind; chapter: string; root: string; description: string; unit: string; qty: string; pct: string; day: string; unitPrice: string; cost: string; margin: string; appr: "notNeeded" | "pending" | "recorded"; how: string; howDay: string; note: string };

function formOf(e: MmEntryView | null, office: boolean): Form {
  if (!e) return { kind: MmKind.extra, chapter: "", root: "", description: "", unit: "st", qty: "1", pct: "", day: "", unitPrice: "", cost: "", margin: "", appr: office ? "notNeeded" : "pending", how: "", howDay: dayToInput(todayDay()), note: "" };
  const a = e.approval;
  return {
    kind: e.kind, chapter: e.chapter, root: e.root !== undefined ? String(e.root) : "", description: e.description, unit: e.unit, qty: qtyText(e.qtyMilli), pct: e.pctBp !== undefined ? (Number(e.pctBp) / 100).toLocaleString("nl-BE") : "",
    day: dayToInput(e.day), unitPrice: e.price && e.price.costCents === undefined ? euroIn(e.price.unitCents) : "", cost: euroIn(e.price?.costCents), margin: e.price?.marginBp !== undefined ? (Number(e.price.marginBp) / 100).toLocaleString("nl-BE") : "",
    appr: a.__kind__ === "recorded" ? "recorded" : a.__kind__ === "pending" ? "pending" : "notNeeded", how: a.__kind__ === "recorded" ? a.recorded.how : "", howDay: a.__kind__ === "recorded" ? dayToInput(a.recorded.day) : dayToInput(todayDay()), note: e.note,
  };
}

/** Een regel van kantoor of een voorstel van de werfleider. */
export function EntrySheet({ workId, view, posts, entry, office, onClose, onSaved }: { workId: bigint; view?: MinMeerFullView; posts?: MmPostRef[]; entry: MmEntryView | null; office: boolean; onClose: () => void; onSaved: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [f, setF] = useState<Form>(() => formOf(entry, office));
  const [reason, setReason] = useState<string | null>(null);
  const ps = posts ?? view?.posts ?? [];
  const viaQuote = entry?.approval.__kind__ === "quote";
  const kinds = office ? [MmKind.extra, MmKind.less, MmKind.regie, MmKind.cost, MmKind.discount, MmKind.settle, MmKind.invoiced] : [MmKind.extra, MmKind.less];
  const set = (p: Partial<Form>) => setF({ ...f, ...p });
  const qty = parseQty(f.qty);
  const pct = f.pct.trim() ? parsePct(f.pct) : undefined;
  const price = parseEuro(f.unitPrice);
  const cost = parseEuro(f.cost);
  const margin = f.margin.trim() ? parsePct(f.margin) : undefined;
  const withPrice = office && f.kind !== MmKind.settle;
  const bad = qty === null || pct === null || price === null || cost === null || margin === null;
  const input = (): MmEntryInput => {
    const approval: MmApproval = f.appr === "recorded" ? { __kind__: "recorded", recorded: { how: f.how.trim(), day: inputToDay(f.howDay) ?? todayDay() } } : f.appr === "pending" ? { __kind__: "pending", pending: null } : { __kind__: "notNeeded", notNeeded: null };
    const hasPrice = withPrice && (price !== undefined || cost !== undefined);
    return {
      kind: f.kind, chapter: f.chapter.trim(), root: f.root ? BigInt(f.root) : undefined, description: f.description.trim(), unit: f.unit.trim(), qtyMilli: qty ?? 0n,
      pctBp: pct ?? undefined, day: inputToDay(f.day), approval, photoFileId: undefined, note: f.note.trim(),
      price: hasPrice ? { unitCents: price ?? undefined, costCents: cost ?? undefined, marginBp: margin ?? undefined, orgId: undefined } : undefined,
    };
  };
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveMinMeerEntry(workId, entry?.id ?? null, entry?.rev ?? 0n, input())),
    onSuccess: () => { toast.show({ kind: "ok", text: office ? E.saved : E.proposed }); onSaved(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const archive = useMutation({
    mutationFn: async () => unwrap(await actor!.archiveMinMeerEntry(entry!.id, reason ?? "")),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const big = view && price !== undefined && price !== null && qty !== null && (f.kind === MmKind.extra || f.kind === MmKind.regie) && (qty * price) / 1000n >= view.quoteFromCents && f.appr !== "pending";
  const footer = (
    <div className="a-row" style={{ flexWrap: "wrap", gap: 6 }}>
      <Button variant="primary" busy={save.isPending} disabled={bad || viaQuote || !f.description.trim()} onClick={() => save.mutate()}>{t.common.save}</Button>
      {entry && office && reason === null && <Button variant="quiet" onClick={() => setReason("")}>{E.archive}</Button>}
    </div>
  );
  return (
    <Sheet title={office ? E.title : E.proposeTitle} open onClose={onClose} footer={footer}>
      <div className="a-form">
        {viaQuote && <p className="a-note" role="note">{E.viaQuote}</p>}
        <Field label={E.kind}><select className="bw-input" value={f.kind} disabled={!!entry} onChange={(e) => set({ kind: e.target.value as MmKind })}>{kinds.map((k) => <option key={k} value={k}>{E.kinds[k]}</option>)}</select></Field>
        <Field label={E.description}><input className="bw-input" maxLength={160} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        {f.kind !== MmKind.invoiced && (
          <Field label={E.post}>
            <select className="bw-input" value={f.root} onChange={(e) => { const p = ps.find((x) => String(x.root) === e.target.value); set({ root: e.target.value, ...(p ? { chapter: p.chapter, unit: p.unit } : {}) }); }}>
              <option value="">{E.noPost}</option>
              {ps.map((p) => <option key={String(p.root)} value={String(p.root)}>{p.chapter ? `${p.chapter} · ` : ""}{p.title} ({p.quoteNumber})</option>)}
            </select>
          </Field>
        )}
        <div className="a-grid2">
          <Field label={E.chapter}><input className="bw-input" maxLength={160} value={f.chapter} onChange={(e) => set({ chapter: e.target.value })} /></Field>
          {f.kind !== MmKind.discount && f.kind !== MmKind.invoiced && f.kind !== MmKind.settle && <Field label={E.unit}><input className="bw-input" maxLength={20} value={f.unit} onChange={(e) => set({ unit: e.target.value })} /></Field>}
        </div>
        {f.kind !== MmKind.discount && f.kind !== MmKind.invoiced && f.kind !== MmKind.settle && <Field label={E.qty}><input className="bw-input bw-num" inputMode="decimal" value={f.qty} onChange={(e) => set({ qty: e.target.value })} /></Field>}
        {office && (f.kind === MmKind.less || f.kind === MmKind.discount) && <Field label={f.kind === MmKind.discount ? E.pctDiscount : E.pct}><input className="bw-input bw-num" inputMode="decimal" value={f.pct} onChange={(e) => set({ pct: e.target.value })} /></Field>}
        {office && (f.kind === MmKind.regie || f.kind === MmKind.invoiced) && <Field label={E.day}><input className="bw-input" type="date" value={f.day} onChange={(e) => set({ day: e.target.value })} /></Field>}
        {withPrice && f.kind !== MmKind.cost && <Field label={f.kind === MmKind.discount || f.kind === MmKind.invoiced ? E.amount : E.unitPrice}><input className="bw-input bw-num" inputMode="decimal" value={f.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} /></Field>}
        {withPrice && (f.kind === MmKind.cost || f.kind === MmKind.extra || f.kind === MmKind.less) && (
          <div className="a-grid2">
            <Field label={E.cost}><input className="bw-input bw-num" inputMode="decimal" value={f.cost} onChange={(e) => set({ cost: e.target.value })} /></Field>
            <Field label={E.margin}><input className="bw-input bw-num" inputMode="decimal" value={f.margin} onChange={(e) => set({ margin: e.target.value })} /></Field>
          </div>
        )}
        {office && f.kind !== MmKind.invoiced && (
          <Field label={E.approval}><Choice label={E.approval} value={f.appr} onChange={(x) => set({ appr: x })} options={(["notNeeded", "pending", "recorded"] as const).map((k) => ({ value: k, label: E.approvals[k] }))} /></Field>
        )}
        {f.appr === "recorded" && office && (
          <div className="a-grid2">
            <Field label={E.how}><input className="bw-input" maxLength={60} value={f.how} onChange={(e) => set({ how: e.target.value })} /></Field>
            <Field label={E.howDay}><input className="bw-input" type="date" value={f.howDay} onChange={(e) => set({ howDay: e.target.value })} /></Field>
          </div>
        )}
        {big && <p className="a-note" role="note">{E.threshold(fmtEuro(view!.quoteFromCents))}</p>}
        <Field label={E.note}><textarea className="bw-input" rows={2} maxLength={1000} value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        {bad && <p className="a-err" role="alert">{E.badNumber}</p>}
        {reason !== null && (
          <div className="a-confirm" role="group" aria-label={E.archive}>
            <Field label={E.archiveReason}><input className="bw-input" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="a-row"><Button variant="primary" busy={archive.isPending} disabled={reason.trim().length < 5} onClick={() => archive.mutate()}>{E.archive}</Button><Button variant="quiet" onClick={() => setReason(null)}>{t.common.cancel}</Button></div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Een automatische regel (opmeting, regie-uren, kost) aanpassen, met reden. */
export function OverrideSheet({ workId, row, onClose, onSaved }: { workId: bigint; row: MmRowView; onClose: () => void; onSaved: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const O = T.override;
  const [exclude, setExclude] = useState(row.excluded);
  const [chapter, setChapter] = useState(row.chapterFrom ? row.chapter : "");
  const [passOn, setPassOn] = useState(row.passOn);
  const [reason, setReason] = useState("");
  const send = (reset: boolean) => actor!.setMinMeerOverride(workId, { key: row.key, exclude: reset ? false : exclude, chapter: reset || !chapter.trim() ? undefined : chapter.trim(), passOn: reset ? false : passOn, reason });
  const save = useMutation({
    mutationFn: async (reset: boolean) => unwrap(await send(reset)),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={O.title} open onClose={onClose} footer={<div className="a-row"><Button variant="primary" busy={save.isPending} disabled={reason.trim().length < 5} onClick={() => save.mutate(false)}>{O.action}</Button><Button variant="quiet" disabled={reason.trim().length < 5} onClick={() => save.mutate(true)}>{O.reset}</Button></div>}>
      <div className="a-form">
        <p><b>{row.description}</b><br /><span className="bw-muted">{row.sourceText}</span></p>
        <label className="a-row"><input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} /> {O.exclude}</label>
        {row.source === "kost" && <label className="a-row"><input type="checkbox" checked={passOn} onChange={(e) => setPassOn(e.target.checked)} /> {O.passOn}</label>}
        <Field label={O.chapter}><input className="bw-input" maxLength={160} value={chapter} onChange={(e) => setChapter(e.target.value)} /></Field>
        <Field label={O.reason}><input className="bw-input" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

/** Het regietarief van de werf met datum; voorstel uit de offerte en de afspraken met de OA (2c.4). */
export function RatesSheet({ workId, view, onClose, onSaved }: { workId: bigint; view: MinMeerFullView; onClose: () => void; onSaved: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const R = T.rates;
  const [rows, setRows] = useState(() => view.regieRates.map((r) => ({ from: dayToInput(r.fromDay), sell: euroIn(r.sellCents), note: r.note })));
  const parsed = rows.map((r) => ({ fromDay: inputToDay(r.from), sellCents: parseEuro(r.sell), note: r.note }));
  const bad = parsed.some((r) => r.fromDay === undefined || r.sellCents === null || r.sellCents === undefined || r.sellCents <= 0n);
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveMinMeerRegieRates(workId, parsed.map((r) => ({ fromDay: r.fromDay!, sellCents: r.sellCents!, note: r.note.trim() })))),
    onSuccess: () => { toast.show({ kind: "ok", text: R.saved }); onSaved(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <Sheet title={R.title} open onClose={onClose} footer={<Button variant="primary" busy={save.isPending} disabled={bad} onClick={() => save.mutate()}>{t.common.save}</Button>}>
      <div className="a-form">
        <p className="bw-muted">{R.lead}</p>
        {view.regieOffer !== undefined && <p className="bw-muted">{R.offer(fmtEuro(view.regieOffer))}</p>}
        {view.dealRates.map((d, k) => (
          <div key={k} className="a-row a-row--between"><span className="bw-muted">{R.deal(d.orgName, fmtEuro(d.costCents), fmtEuro(d.sellCents), fmtDayNum(d.fromDay))}</span><Button variant="quiet" onClick={() => setRows([...rows, { from: dayToInput(d.fromDay), sell: euroIn(d.sellCents), note: d.orgName }])}>{R.useDeal}</Button></div>
        ))}
        {rows.map((r, i) => (
          <div key={i} className="a-grid2">
            <Field label={R.from}><input className="bw-input" type="date" value={r.from} onChange={(e) => set(i, { from: e.target.value })} /></Field>
            <Field label={R.sell}><input className="bw-input bw-num" inputMode="decimal" value={r.sell} onChange={(e) => set(i, { sell: e.target.value })} /></Field>
            <Field label={R.note}><input className="bw-input" maxLength={200} value={r.note} onChange={(e) => set(i, { note: e.target.value })} /></Field>
            <div><Button variant="quiet" onClick={() => setRows(rows.filter((_, k) => k !== i))}>{T.rates.removeRow}</Button></div>
          </div>
        ))}
        <div><Button icon="plus" onClick={() => setRows([...rows, { from: dayToInput(todayDay()), sell: "", note: "" }])}>{R.addRow}</Button></div>
      </div>
    </Sheet>
  );
}

/** Een meerwerkofferte uit de gekozen regels (⚖3). */
export function QuoteSheet({ workId, view, onClose, onSaved, go }: { workId: bigint; view: MinMeerFullView; onClose: () => void; onSaved: () => void; go?: (to: string) => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const Q = T.quote;
  const ok = (e: MmEntryView) => (e.kind === MmKind.extra || e.kind === MmKind.regie || e.kind === MmKind.cost || e.kind === MmKind.less) && e.pctBp === undefined && e.approval.__kind__ !== "quote" && !view.rows.find((r) => r.entryId === e.id)?.flags.includes("te-prijzen");
  const cands = view.entries.filter(ok);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("Meerwerk");
  const make = useMutation({
    mutationFn: async () => unwrap(await actor!.makeExtraWorkQuote(workId, cands.filter((e) => pick.has(String(e.id))).map((e) => e.id), title)),
    onSuccess: (r) => { toast.show({ kind: "ok", text: Q.made(r.number) }); onSaved(); onClose(); go?.(`offertes/${r.quoteId}/${r.versionId}`); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={Q.title} open onClose={onClose} footer={<Button variant="primary" busy={make.isPending} disabled={!title.trim()} onClick={() => make.mutate()}>{Q.title}</Button>}>
      <div className="a-form">
        <p className="bw-muted">{Q.lead}</p>
        <Field label={Q.name}><input className="bw-input" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <span className="bw-label">{Q.pick}</span>
        {cands.length === 0 ? <p className="a-empty">{Q.none}</p> : cands.map((e) => {
          const r = view.rows.find((x) => x.entryId === e.id);
          return (
            <label key={String(e.id)} className="a-row" style={{ gap: 8 }}>
              <input type="checkbox" checked={pick.has(String(e.id))} onChange={(x) => { const s = new Set(pick); if (x.target.checked) s.add(String(e.id)); else s.delete(String(e.id)); setPick(s); }} />
              <span>{e.description} · {qtyText(e.qtyMilli)} {e.unit}{r ? ` · ${fmtEuro(r.extraCents + r.lessCents)}` : ""}</span>
            </label>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Offerte → Meerwerk: de meerwerkoffertes van de werf en een nieuwe (leeg, met de hand in de editor). */
export function MeerwerkOffertes({ workId, caps, go }: { workId: bigint; caps: { editQuotes: boolean; minMeer: boolean }; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const Q = T.quote;
  const list = useQuery({ queryKey: ["quotes", String(workId), false], queryFn: () => actor!.listQuotes(workId, false), enabled: !!actor && !isFetching });
  const [title, setTitle] = useState<string | null>(null);
  const extra = (list.data ?? []).filter((q) => /-M\d+$/.test(q.number));
  const make = useMutation({
    mutationFn: async () => unwrap(await actor!.makeExtraWorkQuote(workId, [], title ?? "")),
    onSuccess: (r) => { toast.show({ kind: "ok", text: Q.made(r.number) }); void qc.invalidateQueries({ queryKey: ["quotes"] }); go(`offertes/${r.quoteId}/${r.versionId}`); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <section className="a-section" data-testid="meerwerkoffertes">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{Q.list}</h2>
        {caps.editQuotes && caps.minMeer && title === null && <Button variant="primary" icon="plus" onClick={() => setTitle("Meerwerk")}>{Q.blank}</Button>}
      </div>
      <p className="bw-muted">{Q.blankLead}</p>
      {title !== null && (
        <div className="a-confirm" role="group" aria-label={Q.blank}>
          <Field label={Q.name}><input className="bw-input" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="a-row"><Button variant="primary" busy={make.isPending} disabled={!title.trim()} onClick={() => make.mutate()}>{Q.blank}</Button><Button variant="quiet" onClick={() => setTitle(null)}>{t.common.cancel}</Button></div>
        </div>
      )}
      <Loading q={list} />
      {list.data && (extra.length === 0 ? <p className="a-empty">{Q.noneList}</p> : (
        <ul className="a-list">
          {extra.map((q) => {
            const v = q.versions[0];
            return (
              <li key={String(q.id)}>
                <button type="button" className="a-list__btn" onClick={() => v && go(`offertes/${q.id}/${v.id}`)}>
                  <span className="a-tag">{q.number}</span>
                  <span className="a-list__main"><b>{q.title}</b></span>
                  {v && <span className="a-tag">{t.offertes.status[v.status] ?? v.status}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ))}
    </section>
  );
}

/** Beheer → Opmeting & facturatie → Min-meerstaat (enkel de beheerder bewaart). */
export function MinMeerSettingsAdmin() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const S = T.settings;
  const cur = useQuery({ queryKey: ["minMeerSettings"], queryFn: async () => unwrap(await actor!.minMeerSettings()), enabled: !!actor && !isFetching, retry: false });
  const [form, setForm] = useState<{ from: string; pass: string; client: string } | null>(null);
  const f = form ?? (cur.data ? { from: euroIn(cur.data.quoteFromCents), pass: (Number(cur.data.passOnBp) / 100).toLocaleString("nl-BE"), client: cur.data.client } : null);
  const from = f ? parseEuro(f.from) : null;
  const pass = f ? parsePct(f.pass) : null;
  const valid = !!f && typeof from === "bigint" && from > 0n && pass !== null && pass <= 9000n;
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveMinMeerSettings({ quoteFromCents: from as bigint, passOnBp: pass!, passOnByKind: cur.data?.passOnByKind ?? [], client: f!.client })),
    onSuccess: () => { toast.show({ kind: "ok", text: S.saved }); setForm(null); void qc.invalidateQueries({ queryKey: ["minMeerSettings"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (cur.isError) return null;
  return (
    <section className="a-section a-form" style={{ maxWidth: 560 }} data-testid="minmeer-settings">
      <h2 className="bw-h2">{S.title}</h2>
      <Loading q={cur} />
      {f && (
        <>
          <div className="a-grid2">
            <Field label={S.quoteFrom}><input className="bw-input bw-num" inputMode="decimal" value={f.from} onChange={(e) => setForm({ ...f, from: e.target.value })} /></Field>
            <Field label={S.passOn}><input className="bw-input bw-num" inputMode="decimal" value={f.pass} onChange={(e) => setForm({ ...f, pass: e.target.value })} /></Field>
          </div>
          {cur.data && cur.data.passOnByKind.length > 0 && <p className="bw-muted">{cur.data.passOnByKind.map(([k, bp]) => `${cur.data!.costKinds.find(([x]) => x === k)?.[1] ?? k}: ${fmtBp(bp)}`).join(" · ")}</p>}
          <Field label={S.client}><Choice label={S.client} value={f.client} onChange={(x) => setForm({ ...f, client: x })} options={["mogelijk", "uit"].map((k) => ({ value: k, label: S.clientModes[k] }))} /></Field>
          <div><Button variant="primary" busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{t.common.save}</Button></div>
        </>
      )}
    </section>
  );
}
