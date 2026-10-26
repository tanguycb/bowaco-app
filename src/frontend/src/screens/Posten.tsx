// Postenbibliotheek (2.2): hoofdstukken, posten met lastenboektekst, eenheid, contractvorm, standaard-OA of vakgebied en
// standaardduur; versies en archiveren (nooit wissen). Intern: elke interne rol leest (zonder prijzen), beheerder en
// calculator bewerken. De prijzen (aankoopprijzen per OA, marge, verkoopprijs) zijn VERTROUWELIJK: enkel met
// caps.libraryPrices, via update-calls die in de auditlog staan, en ze blijven enkel in het geheugen van deze pagina (R23).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ContractForm, OrgKind, type Caps, type LibChapterView, type LibCostView, type LibItemView, type LibPriceView, type LibSellRule, type UnitView } from "../backend";
import { Button, Choice, Sheet, Table, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtBp, fmtDayNum, fmtEuro, fmtTime, inputToDay, parseEuro, parsePct, todayDay, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { Field } from "./Werven";

const P = t.posten;
const FORMS: ContractForm[] = [ContractForm.fixed, ContractForm.vh, ContractForm.regie, ContractForm.estimate, ContractForm.budget, ContractForm.perAttachment];
const SOURCES = ["oa-offerte", "factuur", "offerte", "eigen", "import"];
const PAGE = 50n;

function useLib() {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const chapters = useQuery({ queryKey: ["libChapters", true], queryFn: () => actor!.libraryChapters(true), enabled: on });
  const units = useQuery({ queryKey: ["libUnits", true], queryFn: () => actor!.libraryUnits(true), enabled: on });
  const trades = useQuery({ queryKey: ["trades", true], queryFn: () => actor!.listTrades(true), enabled: on });
  return { chapters, units, trades };
}

export function Posten({ caps }: { caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const { chapters, units, trades } = useLib();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [chapter, setChapter] = useState("");
  const [form, setForm] = useState("");
  const [trade, setTrade] = useState("");
  const [archived, setArchived] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [prices, setPrices] = useState(false);
  const [open, setOpen] = useState<bigint | "new" | null>(null);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setQ(text), 200);
    return () => clearTimeout(h);
  }, [text]);
  useEffect(() => setLimit(PAGE), [q, chapter, form, trade, archived]);
  const list = useQuery({
    queryKey: ["library", q, chapter, form, trade, archived, String(limit)],
    queryFn: () => actor!.listLibrary({ text: q, chapterId: chapter ? BigInt(chapter) : undefined, form: (form || undefined) as ContractForm | undefined, trade: trade || undefined, unit: undefined, orgId: undefined, includeArchived: archived, offset: 0n, limit }),
    enabled: !!actor && !isFetching,
    placeholderData: (prev) => prev,
  });
  const ids = list.data?.items.map((i) => i.id) ?? [];
  // Vertrouwelijk: een update-call (auditregel "bekeek:prijzen"), enkel als de calculator erom vraagt; nooit opnieuw vanzelf.
  const priceQ = useQuery({
    queryKey: ["libPrices", ids.map(String).join(",")],
    queryFn: async () => unwrap(await actor!.readLibraryPrices(ids)),
    enabled: !!actor && !isFetching && caps.libraryPrices && prices && ids.length > 0,
    // R23: prijzen enkel in het geheugen van het scherm; wie terugkeert, leest opnieuw (met een nieuwe auditregel; review 2.12).
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const priceOf = new Map((priceQ.data?.prices ?? []).map((p) => [String(p.itemId), p]));
  const groups = useMemo(() => {
    const out: { key: string; head: string; rows: LibItemView[] }[] = [];
    for (const it of list.data?.items ?? []) {
      const key = String(it.chapterId);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(it);
      else out.push({ key, head: `${it.chapterCode} ${it.chapterTitle}`.trim(), rows: [it] });
    }
    return out;
  }, [list.data]);
  const tradeName = (k?: string) => (k ? trades.data?.find((x) => x.key === k)?.name ?? k : "");
  const filtered = q !== "" || chapter !== "" || form !== "" || trade !== "";
  const total = Number(list.data?.total ?? 0n);
  const shown = list.data?.items.length ?? 0;
  const noChapters = chapters.data && chapters.data.length === 0;
  return (
    <Page
      label={P.label}
      title={P.title}
      actions={
        <>
          <Button icon="list" onClick={() => setChaptersOpen(true)}>{P.chapters}</Button>
          {caps.editLibrary && <Button variant="primary" icon="plus" disabled={!!noChapters} onClick={() => setOpen("new")}>{P.newItem}</Button>}
        </>
      }
    >
      <p className="bw-muted" style={{ maxWidth: 760 }}>{P.lead} {!caps.libraryPrices && P.leadNoPrices}</p>
      <div className="a-grid3">
        <input className="bw-input" type="search" aria-label={P.search} placeholder={P.search} value={text} onChange={(e) => setText(e.target.value)} />
        <select className="bw-input" aria-label={P.chapter} value={chapter} onChange={(e) => setChapter(e.target.value)}>
          <option value="">{P.allChapters}</option>
          {chapters.data?.filter((c) => !c.archived).map((c) => <option key={String(c.id)} value={String(c.id)}>{c.code} {c.title}</option>)}
        </select>
        <select className="bw-input" aria-label={P.form} value={form} onChange={(e) => setForm(e.target.value)}>
          <option value="">{P.allForms}</option>
          {FORMS.map((f) => <option key={f} value={f}>{P.forms[f]}</option>)}
        </select>
      </div>
      <div className="a-row" style={{ flexWrap: "wrap", gap: 16 }}>
        <select className="bw-input" style={{ maxWidth: 280 }} aria-label={P.trade} value={trade} onChange={(e) => setTrade(e.target.value)}>
          <option value="">{P.allTrades}</option>
          {trades.data?.filter((x) => !x.archived).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
        <label className="a-check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> {P.showArchived}</label>
        {caps.libraryPrices && <label className="a-check"><input type="checkbox" checked={prices} onChange={(e) => setPrices(e.target.checked)} /> {P.showPrices}</label>}
        {prices && priceQ.data && <span className="bw-muted">{P.standardMargin}: <b className="bw-mono">{fmtBp(priceQ.data.standardMarginBp)}</b></span>}
      </div>
      {prices && <p className="a-note">{P.pricesNote}</p>}
      <Loading q={list} />
      {prices && <Loading q={priceQ} />}
      {noChapters && (
        <div className="a-empty">
          {P.noChapters} {caps.editLibrary && <LoadStart />}
        </div>
      )}
      {list.data && <span className="bw-label" role="status">{P.count(shown, total)}</span>}
      {list.data && total === 0 && !noChapters && <p className="a-empty">{filtered ? P.noMatch : caps.editLibrary ? P.empty : P.emptyRead}</p>}
      {groups.map((g) => (
        <section key={g.key} className="a-section a-lib">
          <h2 className="bw-h2">{g.head}</h2>
          <Table
            rows={g.rows}
            rowKey={(r) => String(r.id)}
            onRow={(r) => setOpen(r.id)}
            columns={[
              { key: "c", label: P.code, width: "92px", render: (r) => <span className="bw-mono">{r.code || "—"}</span> },
              { key: "t", label: P.item, render: (r) => <ItemCell r={r} /> },
              { key: "u", label: P.unit, width: "76px", render: (r) => <span className="bw-mono">{r.unit}</span> },
              { key: "f", label: P.form, width: "112px", render: (r) => <span className="a-tag">{P.formsShort[r.form] ?? r.form}</span> },
              { key: "o", label: P.oaTradeShort, width: "190px", render: (r) => <span>{r.orgName || <span className="bw-muted">{tradeName(r.trade) || "—"}</span>}</span> },
              { key: "d", label: P.duration, width: "92px", right: true, render: (r) => <span className="bw-mono">{r.durationDays !== undefined ? `${r.durationDays} d` : r.perDayMilli !== undefined ? `${fmtMilli(r.perDayMilli)}/${r.unit}·d` : "—"}</span> },
              ...(prices
                ? [
                    { key: "pc", label: P.cost, width: "120px", right: true, render: (r: LibItemView) => <CostCell p={priceOf.get(String(r.id))} /> },
                    { key: "pm", label: P.margin, width: "116px", right: true, render: (r: LibItemView) => <MarginCell p={priceOf.get(String(r.id))} /> },
                    { key: "ps", label: P.sell, width: "104px", right: true, render: (r: LibItemView) => <span className="bw-mono">{priceOf.get(String(r.id))?.sellCents !== undefined ? fmtEuro(priceOf.get(String(r.id))!.sellCents) : "—"}</span> },
                  ]
                : []),
            ]}
          />
        </section>
      ))}
      {shown < total && <div><Button onClick={() => setLimit(limit + PAGE)}>{t.common.more}</Button></div>}
      {open !== null && <ItemSheet id={open} caps={caps} chapters={chapters.data ?? []} units={units.data ?? []} defaultChapter={chapter} onClose={() => setOpen(null)} onCreated={(id) => setOpen(id)} />}
      {chaptersOpen && <ChaptersSheet caps={caps} chapters={chapters.data ?? []} units={units.data ?? []} onClose={() => setChaptersOpen(false)} />}
    </Page>
  );
}

function fmtMilli(m: bigint): string {
  return (Number(m) / 1000).toLocaleString("nl-BE", { maximumFractionDigits: 3 });
}

function ItemCell({ r }: { r: LibItemView }) {
  const first = r.text.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  return (
    <span>
      <b>{r.title}</b>
      {r.archived && <> <span className="a-tag a-tag--bad">{P.archived}</span></>}
      {first && first !== r.title && <><br /><span className="bw-muted">{first.length > 110 ? first.slice(0, 110) + "…" : first}</span></>}
    </span>
  );
}

function CostCell({ p }: { p?: LibPriceView }) {
  if (!p) return <span className="bw-muted">—</span>;
  // Zonder aankoopprijs is enkel een post met een marge onvolledig (geen verkoopprijs); een vaste prijs heeft er geen nodig.
  if (!p.cost) return p.rule?.__kind__ === "price" ? <span className="bw-muted">—</span> : <span className="a-tag a-tag--warn">{P.noCost}</span>;
  return (
    <span>
      <span className="bw-mono">{fmtEuro(p.cost.costCents)}</span>
      {p.cost.orgName && <><br /><span className="bw-muted">{p.cost.orgName}</span></>}
    </span>
  );
}

function MarginCell({ p }: { p?: LibPriceView }) {
  if (!p) return <span className="bw-muted">—</span>;
  return (
    <span className="bw-mono">
      {p.marginBp !== undefined ? fmtBpInt(p.marginBp) : "—"}
      {p.deviates && <><br /><span className="a-tag a-tag--warn">{p.rule?.__kind__ === "price" ? P.fixedShort : P.deviates}</span></>}
    </span>
  );
}

function fmtBpInt(bp: bigint): string {
  return bp < 0n ? `−${fmtBp(-bp)}` : fmtBp(bp);
}

function LoadStart() {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: async () => unwrap(await actor!.loadLibraryStartChapters()),
    onSuccess: (n) => { toast.show({ kind: "ok", text: P.loadStartDone(Number(n)) }); void qc.invalidateQueries({ queryKey: ["libChapters"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return <Button busy={m.isPending} onClick={() => m.mutate()}>{P.loadStart}</Button>;
}

// ── Eén post: gegevens, versies en (voor kantoor) de prijzen ──────────────
function ItemSheet({ id, caps, chapters, units, defaultChapter, onClose, onCreated }: { id: bigint | "new"; caps: Caps; chapters: LibChapterView[]; units: UnitView[]; defaultChapter: string; onClose: () => void; onCreated: (id: bigint) => void }) {
  const { actor, isFetching } = useBackend();
  const one = useQuery({ queryKey: ["libItem", String(id)], queryFn: async () => unwrap(await actor!.getLibraryItem(id as bigint)), enabled: !!actor && !isFetching && id !== "new" });
  const it = id === "new" ? null : one.data ?? null;
  return (
    <Sheet title={id === "new" ? P.newItem : it ? it.title : t.common.loading} open onClose={onClose} side wide>
      {id !== "new" && <Loading q={one} />}
      {(id === "new" || it) && (
        <div className="a-form">
          {it?.archived && <p className="a-note">{P.archivedBecause(it.archiveReason)}</p>}
          <ItemForm key={`${String(it?.id ?? "new")}-${String(it?.version ?? 0)}`} it={it} canEdit={caps.editLibrary && !it?.archived} chapters={chapters} units={units} defaultChapter={defaultChapter} onCreated={onCreated} />
          {it && caps.editLibrary && <ArchiveRow it={it} />}
          {it && caps.libraryPrices && <PricesSection it={it} canEdit={caps.editLibrary && !it.archived} canMargin={caps.manageSettings} />}
          {it && <Versions id={it.id} />}
        </div>
      )}
    </Sheet>
  );
}

function ItemForm({ it, canEdit, chapters, units, defaultChapter, onCreated }: { it: LibItemView | null; canEdit: boolean; chapters: LibChapterView[]; units: UnitView[]; defaultChapter: string; onCreated: (id: bigint) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const { trades } = useLib();
  const oas = useQuery({ queryKey: ["oas", "", "", "", "lib"], queryFn: () => actor!.listOas({ text: undefined, trade: undefined, kind: undefined, includeArchived: false }), enabled: !!actor && !isFetching });
  const tpls = useQuery({ queryKey: ["templates"], queryFn: () => actor!.listTemplates(), enabled: !!actor && !isFetching });
  const firstChapter = defaultChapter || String(chapters.find((c) => !c.archived)?.id ?? "");
  const [f, setF] = useState({
    chapterId: it ? String(it.chapterId) : firstChapter,
    code: it?.code ?? "",
    title: it?.title ?? "",
    text: it?.text ?? "",
    unit: it?.unit ?? "st",
    form: it?.form ?? ContractForm.fixed,
    trade: it?.trade ?? "",
    orgId: it?.orgId !== undefined ? String(it.orgId) : "",
    durationDays: it?.durationDays !== undefined ? String(it.durationDays) : "",
    perDay: it?.perDayMilli !== undefined ? fmtMilli(it.perDayMilli) : "",
    planStepKey: it?.planStepKey ?? "",
    keywords: it?.keywords.join(", ") ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const perDayMilli = f.perDay.trim() === "" ? undefined : Math.round(Number(f.perDay.replace(",", ".")) * 1000);
  const durationOk = f.durationDays.trim() === "" || /^\d{1,3}$/.test(f.durationDays.trim());
  // Review 2.12: enkel een gewoon getal met hoogstens 3 decimalen ("1e3" of "0x10" wordt niet stil een ander getal).
  const perDayOk = perDayMilli === undefined || (/^\d{1,6}([.,]\d{1,3})?$/.test(f.perDay.trim()) && Number.isFinite(perDayMilli) && perDayMilli > 0);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await actor!.saveLibraryItem(
          {
            id: it?.id,
            chapterId: BigInt(f.chapterId),
            code: f.code,
            title: f.title,
            text: f.text,
            unit: f.unit,
            form: f.form,
            trade: f.trade || undefined,
            orgId: f.orgId ? BigInt(f.orgId) : undefined,
            durationDays: f.durationDays.trim() ? BigInt(f.durationDays.trim()) : undefined,
            perDayMilli: perDayMilli !== undefined ? BigInt(perDayMilli) : undefined,
            planStepKey: f.planStepKey || undefined,
            keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean),
            importKey: it?.importKey,
          },
          it?.version ?? 0n,
        ),
      ),
    onSuccess: (v) => {
      toast.show({ kind: "ok", text: t.common.saved });
      void qc.invalidateQueries({ queryKey: ["library"] });
      void qc.invalidateQueries({ queryKey: ["libItem"] });
      void qc.invalidateQueries({ queryKey: ["libVersions"] });
      void qc.invalidateQueries({ queryKey: ["libChapters"] });
      if (!it) onCreated(v.id);
    },
  });
  const steps = (tpls.data ?? []).filter((x) => !x.archived).flatMap((x) => x.steps.map((s) => ({ key: s.key, label: `${x.name}: ${s.title}` })));
  const orgs = (oas.data ?? []).map((o) => o.org).filter((o) => o.kind === OrgKind.subcontractor || o.kind === OrgKind.supplier);
  const dis = !canEdit;
  return (
    <section className="a-section">
      {it && <span className="bw-label">{P.version(it.version)} · {P.lastBy(it.updatedByName, fmtTime(it.updatedAt))}</span>}
      <div className="a-grid2">
        <Field label={P.chapter}>
          <select className="bw-input" value={f.chapterId} disabled={dis} onChange={set("chapterId")}>
            <option value="" disabled>{P.chooseChapter}</option>
            {chapters.filter((c) => !c.archived || String(c.id) === f.chapterId).map((c) => <option key={String(c.id)} value={String(c.id)}>{c.code} {c.title}</option>)}
          </select>
        </Field>
        <Field label={P.code}><input className="bw-input bw-mono" value={f.code} maxLength={20} disabled={dis} placeholder="7.06" onChange={set("code")} /></Field>
      </div>
      <Field label={P.titleLabel}><input className="bw-input" value={f.title} maxLength={160} disabled={dis} onChange={set("title")} /></Field>
      <Field label={P.text}><textarea className="bw-input" rows={8} value={f.text} maxLength={4000} disabled={dis} onChange={set("text")} /></Field>
      <div className="a-grid2">
        <Field label={P.unit}>
          <select className="bw-input" value={f.unit} disabled={dis} onChange={set("unit")}>
            {units.filter((u) => !u.archived || u.key === f.unit).map((u) => <option key={u.key} value={u.key}>{u.key} · {u.name}</option>)}
          </select>
        </Field>
        <Field label={P.trade}>
          <select className="bw-input" value={f.trade} disabled={dis} onChange={set("trade")}>
            <option value="">{P.noTrade}</option>
            {trades.data?.filter((x) => !x.archived || x.key === f.trade).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
          </select>
        </Field>
      </div>
      <span className="bw-label">{P.form}</span>
      {dis ? <span className="a-tag">{P.forms[f.form]}</span> : <Choice label={P.form} value={f.form} onChange={(v) => setF({ ...f, form: v })} options={FORMS.map((x) => ({ value: x, label: P.forms[x] }))} />}
      <Field label={P.org}>
        <select className="bw-input" value={f.orgId} disabled={dis} onChange={set("orgId")}>
          <option value="">{P.noOrg}</option>
          {orgs.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}{o.aliases.length ? ` (${o.aliases.slice(0, 3).join(", ")})` : ""}</option>)}
          {it?.orgId !== undefined && !orgs.some((o) => o.id === it.orgId) && <option value={String(it.orgId)}>{it.orgName}</option>}
        </select>
      </Field>
      <div className="a-grid2">
        <Field label={P.durationDays}><input className="bw-input bw-mono" inputMode="numeric" value={f.durationDays} disabled={dis} onChange={set("durationDays")} /></Field>
        <Field label={P.perDay}><input className="bw-input bw-mono" inputMode="decimal" value={f.perDay} disabled={dis} onChange={set("perDay")} /></Field>
      </div>
      <span className="bw-muted">{P.perDayHelp}</span>
      <div className="a-grid2">
        <Field label={P.planStep}>
          <select className="bw-input" value={f.planStepKey} disabled={dis} onChange={set("planStepKey")}>
            <option value="">{P.noPlanStep}</option>
            {steps.map((s) => <option key={s.key + s.label} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label={P.keywords}><input className="bw-input" value={f.keywords} disabled={dis} onChange={set("keywords")} /></Field>
      </div>
      {it?.importKey && <span className="bw-muted">{P.importKey}: <span className="bw-mono">{it.importKey}</span></span>}
      {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      {canEdit && (
        <div>
          <Button variant="primary" busy={save.isPending} disabled={f.title.trim() === "" || f.chapterId === "" || !durationOk || !perDayOk} onClick={() => save.mutate()}>{P.save}</Button>
        </div>
      )}
    </section>
  );
}

function ArchiveRow({ it }: { it: LibItemView }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: async (archived: boolean) => unwrap(await actor!.setLibraryItemArchived(it.id, archived, reason)),
    onSuccess: () => {
      toast.show({ kind: "ok", text: t.common.saved });
      setAsk(false);
      void qc.invalidateQueries({ queryKey: ["library"] });
      void qc.invalidateQueries({ queryKey: ["libItem"] });
      void qc.invalidateQueries({ queryKey: ["libChapters"] });
    },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <div className="a-row">
      {it.archived ? <Button busy={m.isPending} onClick={() => m.mutate(false)}>{P.restore}</Button> : <Button variant="quiet" onClick={() => setAsk(true)}>{P.archive}</Button>}
      {ask && (
        <Sheet title={P.archiveTitle} open onClose={() => setAsk(false)} footer={<><Button onClick={() => setAsk(false)}>{t.common.cancel}</Button><Button variant="danger" busy={m.isPending} onClick={() => m.mutate(true)}>{P.archive}</Button></>}>
          <div className="a-form">
            <p>{P.archiveText}</p>
            <Field label={P.archiveReason}><input className="bw-input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Versions({ id }: { id: bigint }) {
  const { actor, isFetching } = useBackend();
  const v = useQuery({ queryKey: ["libVersions", String(id)], queryFn: async () => unwrap(await actor!.libraryItemHistory(id)), enabled: !!actor && !isFetching });
  const [show, setShow] = useState<bigint | null>(null);
  return (
    <section className="a-section">
      <h2 className="bw-h2">{P.versions}</h2>
      <Loading q={v} />
      {v.data && v.data.length === 0 && <p className="a-empty">{P.noVersions}</p>}
      {v.data && v.data.length > 0 && (
        <ul className="a-list">
          {v.data.map((x) => (
            <li key={String(x.version)}>
              <span className="a-list__main">
                <b>{P.version(x.version)}</b>
                <span className="bw-muted">{fmtTime(x.at)} · {x.byName} · {x.fields}</span>
                {show === x.version && <span style={{ whiteSpace: "pre-wrap" }}><b>{x.item.title}</b>{"\n"}{x.item.text || "—"}{"\n"}<span className="bw-mono">{x.item.unit} · {P.forms[x.item.form]}</span></span>}
              </span>
              <Button variant="quiet" onClick={() => setShow(show === x.version ? null : x.version)}>{P.showVersion}</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Prijzen (vertrouwelijk) ──────────────────────────────────────────────
function PricesSection({ it, canEdit, canMargin }: { it: LibItemView; canEdit: boolean; canMargin: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="a-section" style={{ borderTop: "1px solid var(--bw-line)", paddingTop: 14 }}>
      <h2 className="bw-h2">{P.prices}</h2>
      <p className="bw-muted">{P.pricesLead}</p>
      {!open ? <div><Button icon="receipt" onClick={() => setOpen(true)}>{P.showHistory}</Button></div> : <PriceDetail it={it} canEdit={canEdit} canMargin={canMargin} />}
    </section>
  );
}

function PriceDetail({ it, canEdit, canMargin }: { it: LibItemView; canEdit: boolean; canMargin: boolean }) {
  const { actor, isFetching } = useBackend();
  const opts = { staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false } as const;
  const cur = useQuery({ queryKey: ["libPrice", String(it.id)], queryFn: async () => unwrap(await actor!.readLibraryPrices([it.id])), enabled: !!actor && !isFetching, ...opts });
  const hist = useQuery({ queryKey: ["libPriceHist", String(it.id)], queryFn: async () => unwrap(await actor!.readLibraryPriceHistory(it.id)), enabled: !!actor && !isFetching, ...opts });
  const p = cur.data?.prices[0];
  const std = cur.data?.standardMarginBp ?? 2000n;
  return (
    <div className="a-form">
      <Loading q={cur} />
      {p && (
        <div className="a-grid3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <span className="bw-label">{P.current}</span>
            <div className="bw-mono" style={{ fontSize: 18 }}>{p.cost ? fmtEuro(p.cost.costCents) : "—"}</div>
            <span className="bw-muted">{p.cost ? `${p.cost.orgName || P.costNoOrg} · ${fmtDayNum(p.cost.day)}` : P.noCosts}</span>
          </div>
          <div>
            <span className="bw-label">{P.margin}</span>
            <div className="bw-mono" style={{ fontSize: 18 }}>{p.marginBp !== undefined ? fmtBpInt(p.marginBp) : "—"}</div>
            <span className="bw-muted">{p.rule === undefined ? P.ruleStandard(fmtBp(std)) : p.rule.__kind__ === "margin" ? P.ruleMargin : P.rulePrice}{p.deviates && " · "}{p.deviates && <span className="a-tag a-tag--warn">{P.deviates}</span>}</span>
          </div>
          <div>
            <span className="bw-label">{P.sellComputed}</span>
            <div className="bw-mono" style={{ fontSize: 18 }}>{p.sellCents !== undefined ? fmtEuro(p.sellCents) : "—"}</div>
            <span className="bw-muted">{P.perUnit} ({it.unit})</span>
          </div>
        </div>
      )}
      <span className="bw-muted">{P.currentHelp}</span>
      {p && p.reason && <p className="a-note">{p.reason}</p>}
      {p && canEdit && <SellForm it={it} p={p} std={std} />}
      {canMargin && <MarginForm std={std} />}
      <h3 className="bw-label">{P.history}</h3>
      <Loading q={hist} />
      {hist.data && hist.data.costs.length === 0 && <p className="a-empty">{P.noCosts}</p>}
      {hist.data && hist.data.costs.length > 0 && <CostTable costs={hist.data.costs} canEdit={canEdit} itemId={it.id} />}
      {canEdit && <CostForm it={it} />}
      {hist.data && hist.data.sells.length > 0 && (
        <>
          <h3 className="bw-label">{P.sellHistory}</h3>
          <ul className="a-list">
            {hist.data.sells.map((s) => (
              <li key={String(s.version)}>
                <span className="a-list__main">
                  <b>{P.version(s.version)} · {ruleLabel(s.rule, std)}</b>
                  <span className="bw-muted">{fmtTime(s.at)} · {s.byName}{s.reason ? ` · ${s.reason}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ruleLabel(r: LibSellRule | undefined, std: bigint): string {
  if (!r) return P.ruleStandard(fmtBp(std));
  return r.__kind__ === "margin" ? `${P.ruleMargin} ${fmtBp(r.margin)}` : `${P.rulePrice} ${fmtEuro(r.price)}`;
}

function invalidatePrices(qc: ReturnType<typeof useQueryClient>, id: bigint) {
  void qc.invalidateQueries({ queryKey: ["libPrice", String(id)] });
  void qc.invalidateQueries({ queryKey: ["libPriceHist", String(id)] });
  void qc.invalidateQueries({ queryKey: ["libPrices"] });
}

function CostTable({ costs, canEdit, itemId }: { costs: LibCostView[]; canEdit: boolean; itemId: bigint }) {
  const [archive, setArchive] = useState<LibCostView | null>(null);
  return (
    <>
      <Table
        rows={costs}
        rowKey={(c) => String(c.id)}
        columns={[
          { key: "d", label: P.costDay, render: (c) => <span className="bw-mono">{fmtDayNum(c.day)}</span> },
          { key: "o", label: P.costOrg, render: (c) => <span>{c.orgName || <span className="bw-muted">{P.costNoOrg}</span>}</span> },
          { key: "p", label: P.cost, right: true, render: (c) => <span className="bw-mono" style={c.archived ? { textDecoration: "line-through" } : undefined}>{fmtEuro(c.costCents)}</span> },
          { key: "s", label: P.costSource, render: (c) => <span>{P.sources[c.source] ?? c.source}{c.ref ? <><br /><span className="bw-muted">{c.ref}</span></> : null}</span> },
          { key: "b", label: "", render: (c) => (c.archived ? <span className="a-tag a-tag--bad" title={c.archiveReason}>{P.archived}</span> : canEdit ? <Button variant="quiet" onClick={() => setArchive(c)}>{P.archiveCost}</Button> : <span className="bw-muted">{c.byName}</span>) },
        ]}
      />
      {archive && <ArchiveCost c={archive} itemId={itemId} onClose={() => setArchive(null)} />}
    </>
  );
}

function ArchiveCost({ c, itemId, onClose }: { c: LibCostView; itemId: bigint; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: async () => unwrap(await actor!.archiveLibraryCost(c.id, reason)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); invalidatePrices(qc, itemId); onClose(); },
  });
  return (
    <Sheet title={P.archiveCost} open onClose={onClose} footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="danger" busy={m.isPending} disabled={reason.trim() === ""} onClick={() => m.mutate()}>{P.archiveCost}</Button></>}>
      <div className="a-form">
        <p>{P.archiveCostText}</p>
        <p className="bw-mono">{fmtDayNum(c.day)} · {c.orgName || P.costNoOrg} · {fmtEuro(c.costCents)}</p>
        <Field label={P.archiveCostReason}><input className="bw-input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
        {m.error && <p className="a-err" role="alert">{errText(m.error)}</p>}
      </div>
    </Sheet>
  );
}

function CostForm({ it }: { it: LibItemView }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const oas = useQuery({ queryKey: ["oas", "", "", "", "lib"], queryFn: () => actor!.listOas({ text: undefined, trade: undefined, kind: undefined, includeArchived: false }), enabled: !!actor && !isFetching });
  const orgs = (oas.data ?? []).map((o) => o.org).filter((o) => o.kind === OrgKind.subcontractor || o.kind === OrgKind.supplier);
  const [f, setF] = useState({ orgId: it.orgId !== undefined ? String(it.orgId) : "", day: dayToInput(todayDay()), cost: "", source: "oa-offerte", ref: "", note: "" });
  const cents = parseEuro(f.cost);
  const m = useMutation({
    mutationFn: async () => unwrap(await actor!.addLibraryCost(it.id, { orgId: f.orgId ? BigInt(f.orgId) : undefined, day: inputToDay(f.day) ?? todayDay(), costCents: cents as bigint, source: f.source, ref: f.ref, note: f.note })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); setF({ ...f, cost: "", ref: "", note: "" }); invalidatePrices(qc, it.id); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="a-section" style={{ background: "var(--bw-sunken)", padding: 12, borderRadius: "var(--bw-radius)" }}>
      <span className="bw-label">{P.addCost}</span>
      <div className="a-grid2">
        <Field label={P.costOrg}>
          <select className="bw-input" value={f.orgId} onChange={set("orgId")}>
            <option value="">{P.costNoOrg}</option>
            {orgs.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
          </select>
        </Field>
        <Field label={P.costDay}><input className="bw-input" type="date" value={f.day} onChange={set("day")} /></Field>
      </div>
      <div className="a-grid2">
        <Field label={`${P.costCents} · ${it.unit}`}><input className="bw-input bw-mono" inputMode="decimal" value={f.cost} placeholder="0,00" onChange={set("cost")} /></Field>
        <Field label={P.costSource}>
          <select className="bw-input" value={f.source} onChange={set("source")}>
            {SOURCES.map((s) => <option key={s} value={s}>{P.sources[s]}</option>)}
          </select>
        </Field>
      </div>
      <Field label={P.costRef}><input className="bw-input" value={f.ref} maxLength={80} onChange={set("ref")} /></Field>
      {m.error && <p className="a-err" role="alert">{errText(m.error)}</p>}
      <div><Button variant="primary" busy={m.isPending} disabled={cents === undefined || cents === null || !f.day} onClick={() => m.mutate()}>{P.saveCost}</Button></div>
    </div>
  );
}

type RuleKind = "standard" | "margin" | "price";

function SellForm({ it, p, std }: { it: LibItemView; p: LibPriceView; std: bigint }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<RuleKind>(p.rule === undefined ? "standard" : p.rule.__kind__);
  const [margin, setMargin] = useState(p.rule?.__kind__ === "margin" ? (Number(p.rule.margin) / 100).toLocaleString("nl-BE") : (Number(std) / 100).toLocaleString("nl-BE"));
  const [price, setPrice] = useState(p.rule?.__kind__ === "price" ? (Number(p.rule.price) / 100).toLocaleString("nl-BE", { minimumFractionDigits: 2 }) : "");
  const [reason, setReason] = useState(p.reason);
  const bp = parsePct(margin);
  const cents = parseEuro(price);
  const rule: LibSellRule | undefined = kind === "margin" && bp !== null ? { __kind__: "margin", margin: bp } : kind === "price" && typeof cents === "bigint" ? { __kind__: "price", price: cents } : undefined;
  const valid = kind === "standard" || rule !== undefined;
  const sendReason = kind === "standard" ? "" : reason.trim();
  const same = JSON.stringify(rule ?? null, (_k, v) => (typeof v === "bigint" ? String(v) : v)) === JSON.stringify(p.rule ?? null, (_k, v) => (typeof v === "bigint" ? String(v) : v)) && sendReason === p.reason;
  const m = useMutation({
    mutationFn: async () => unwrap(await actor!.setLibrarySell(it.id, { rule, reason: sendReason }, p.sellVersion)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); invalidatePrices(qc, it.id); },
  });
  return (
    <div className="a-section" style={{ background: "var(--bw-sunken)", padding: 12, borderRadius: "var(--bw-radius)" }}>
      <span className="bw-label">{P.sellRule}</span>
      <Choice label={P.sellRule} value={kind} onChange={setKind} options={[{ value: "standard", label: P.ruleStandard(fmtBp(std)) }, { value: "margin", label: P.ruleMargin }, { value: "price", label: P.rulePrice }]} />
      {kind === "margin" && <Field label={P.marginPct}><input className="bw-input bw-mono" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} /></Field>}
      {kind === "margin" && <span className="bw-muted">{P.marginHelp}</span>}
      {kind === "price" && <Field label={`${P.priceCents} · ${it.unit}`}><input className="bw-input bw-mono" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>}
      {kind !== "standard" && <Field label={P.ruleReason}><input className="bw-input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>}
      {m.error && <p className="a-err" role="alert">{errText(m.error)}</p>}
      <div><Button variant="primary" busy={m.isPending} disabled={!valid || same} onClick={() => m.mutate()}>{P.saveRule}</Button></div>
    </div>
  );
}

function MarginForm({ std }: { std: bigint }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState((Number(std) / 100).toLocaleString("nl-BE"));
  const bp = parsePct(v);
  const m = useMutation({
    mutationFn: async () => unwrap(await actor!.setLibraryMargin(bp as bigint)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["libPrice"] }); void qc.invalidateQueries({ queryKey: ["libPrices"] }); },
  });
  return (
    <details>
      <summary className="bw-label" style={{ cursor: "pointer" }}>{P.setMargin}</summary>
      <div className="a-row" style={{ marginTop: 8 }}>
        <input className="bw-input bw-mono" style={{ maxWidth: 120 }} aria-label={P.standardMargin} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} />
        <Button busy={m.isPending} disabled={bp === null} onClick={() => m.mutate()}>{t.common.save}</Button>
      </div>
      <span className="bw-muted">{P.setMarginHelp}</span>
      {m.error && <p className="a-err" role="alert">{errText(m.error)}</p>}
    </details>
  );
}

// ── Hoofdstukken en eenheden ─────────────────────────────────────────────
function ChaptersSheet({ caps, chapters, units, onClose }: { caps: Caps; chapters: LibChapterView[]; units: UnitView[]; onClose: () => void }) {
  const [edit, setEdit] = useState<LibChapterView | "new" | null>(null);
  return (
    <Sheet title={P.chapters} open onClose={onClose} side wide>
      <div className="a-form">
        <p className="bw-muted">{P.chaptersLead}</p>
        {chapters.length === 0 && <div className="a-empty">{P.noChapters} {caps.editLibrary && <LoadStart />}</div>}
        {chapters.length > 0 && (
          <Table
            rows={chapters}
            rowKey={(c) => String(c.id)}
            onRow={caps.editLibrary ? (c) => setEdit(c) : undefined}
            columns={[
              { key: "c", label: P.code, width: "60px", render: (c) => <span className="bw-mono">{c.code}</span> },
              { key: "t", label: P.chapterTitle, render: (c) => <span><b>{c.title}</b>{c.archived && <> <span className="a-tag a-tag--bad">{P.archived}</span></>}{c.note.startsWith("VOORLOPIG") && <> <span className="a-tag a-tag--warn">{P.provisional}</span></>}</span> },
              { key: "n", label: "", right: true, render: (c) => <span className="bw-muted">{P.items(c.items)}</span> },
              { key: "o", label: P.order, right: true, width: "70px", render: (c) => <span className="bw-mono">{String(c.order)}</span> },
            ]}
          />
        )}
        {caps.editLibrary && <div><Button icon="plus" onClick={() => setEdit("new")}>{P.addChapter}</Button></div>}
        <UnitsSection units={units} canEdit={caps.manageSettings} />
      </div>
      {edit && <ChapterForm c={edit === "new" ? null : edit} next={BigInt((chapters.reduce((a, c) => Math.max(a, Number(c.order)), 0) + 10))} onClose={() => setEdit(null)} />}
    </Sheet>
  );
}

function ChapterForm({ c, next, onClose }: { c: LibChapterView | null; next: bigint; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ code: c?.code ?? "", title: c?.title ?? "", order: String(c?.order ?? next), note: c?.note ?? "" });
  const done = () => { void qc.invalidateQueries({ queryKey: ["libChapters"] }); void qc.invalidateQueries({ queryKey: ["library"] }); };
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveLibraryChapter({ id: c?.id, code: f.code, title: f.title, order: BigInt(f.order || "0"), note: f.note })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); done(); onClose(); },
  });
  const arch = useMutation({
    mutationFn: async (archived: boolean) => unwrap(await actor!.setLibraryChapterArchived(c!.id, archived)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); done(); onClose(); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet title={c ? `${c.code} ${c.title}` : P.addChapter} open onClose={onClose} footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} disabled={f.title.trim() === "" || !/^\d{1,7}$/.test(f.order)} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <div className="a-grid2">
          <Field label={P.code}><input className="bw-input bw-mono" value={f.code} maxLength={20} onChange={set("code")} /></Field>
          <Field label={P.order}><input className="bw-input bw-mono" inputMode="numeric" value={f.order} onChange={set("order")} /></Field>
        </div>
        <Field label={P.chapterTitle}><input className="bw-input" value={f.title} maxLength={80} onChange={set("title")} /></Field>
        <Field label={P.note}><input className="bw-input" value={f.note} maxLength={1000} onChange={set("note")} /></Field>
        {(save.error || arch.error) && <p className="a-err" role="alert">{errText(save.error ?? arch.error)}</p>}
        {c && <div>{c.archived ? <Button busy={arch.isPending} onClick={() => arch.mutate(false)}>{P.restoreChapter}</Button> : <Button variant="quiet" busy={arch.isPending} onClick={() => arch.mutate(true)}>{P.archiveChapter}</Button>}</div>}
      </div>
    </Sheet>
  );
}

function UnitsSection({ units, canEdit }: { units: UnitView[]; canEdit: boolean }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ key: "", name: "" });
  const m = useMutation({
    mutationFn: async (u: UnitView) => unwrap(await actor!.setLibraryUnit(u)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); setF({ key: "", name: "" }); void qc.invalidateQueries({ queryKey: ["libUnits"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const next = BigInt(units.reduce((a, u) => Math.max(a, Number(u.order)), 0) + 10);
  return (
    <section className="a-section" style={{ borderTop: "1px solid var(--bw-line)", paddingTop: 14 }}>
      <h2 className="bw-h2">{P.units}</h2>
      <p className="bw-muted">{P.unitsLead}</p>
      <div className="a-row" style={{ flexWrap: "wrap" }}>
        {units.map((u) => (
          <span key={u.key} className={`a-tag${u.archived ? " a-tag--bad" : ""}`} title={u.name}>
            {u.key} · {u.name}
            {canEdit && <button type="button" className="a-tag a-tag--link" style={{ marginLeft: 6 }} onClick={() => m.mutate({ ...u, archived: !u.archived })}>{u.archived ? P.restoreChapter : P.archiveChapter}</button>}
          </span>
        ))}
      </div>
      {canEdit && (
        <div className="a-row">
          <input className="bw-input bw-mono" style={{ maxWidth: 110 }} aria-label={P.unitKey} placeholder={P.unitKey} value={f.key} maxLength={20} onChange={(e) => setF({ ...f, key: e.target.value })} />
          <input className="bw-input" style={{ maxWidth: 240 }} aria-label={P.unitName} placeholder={P.unitName} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Button icon="plus" busy={m.isPending} disabled={f.key.trim() === "" || f.name.trim() === ""} onClick={() => m.mutate({ key: f.key, name: f.name, order: next, archived: false })}>{P.addUnit}</Button>
        </div>
      )}
    </section>
  );
}
