// Offerte-editor (2.4, bouwplan §8.5): ziet eruit als de Excel van Alexis (hoofdstukken, posten, VH, eenheid, prijs) maar
// zonder formules: de totalen rekenen zichzelf (quote/calc.ts) en de server rekent ze bij elke bewaring na. Kantoor
// (beheerder, calculator) ziet en bewerkt aankoopprijs, OA en marge; de werfleider ziet hoeveelheden en hoofdstuktotalen;
// een architect met de grant de verkoopprijzen. Prijzen komen uit een update-call (auditregel) en blijven enkel in het
// geheugen van deze pagina (R23). Een verzonden of aanvaarde versie is alleen-lezen; verder werken = nieuwe versie.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ExternalBlob, ContractForm, OrgKind, QuoteLineKind, QuoteScope, QuoteStatus, type Caps, type LibChapterView, type LibItemView, type LibSellRule, type OrgView, type QuoteChapterRef, type QuoteRead, type QuoteSummary, type UnitView } from "../backend";
import { Button, Choice, Icon, Sheet, useToast } from "../design";
import { calcLine, type Kind, type Rule } from "../quote/calc.ts";
import * as M from "../quote/model.ts";
import { addressOk, blocks, evaluate, warnings, type Finding, type RuleSet, type StdPost } from "../quote/rules.ts";
import { runSelfTest } from "../quote/selftest.ts";
import { makePdf, pdfFromRead, pdfName } from "../pdf/adapt.ts";
import { blobUrlOf } from "../offline/cached";
import { t } from "../texts/nl";
import { errText, fmtBp, fmtEuro, fmtTime, parseEuro, parsePct, unwrap, useBackend } from "../util";
import { Loading, Page, useWorks } from "./common";

const O = t.offertes;
const FORMS: ContractForm[] = [ContractForm.vh, ContractForm.fixed, ContractForm.regie, ContractForm.estimate, ContractForm.budget, ContractForm.perAttachment];
// Niet bewaarde wijzigingen blijven in het geheugen van de pagina als je even naar een ander scherm gaat (nooit opgeslagen).
const unsaved = new Map<string, M.Model>();

// ── Kleine hulp ──────────────────────────────────────────────────────────
const qtyFmt = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 3 });
export function fmtQty(milli: bigint): string {
  return qtyFmt.format(Number(milli) / 1000);
}
/** "12,5" · "12.5" · "-2" · "1.250,5" → duizendsten. Ongeldig → null. */
export function parseQty(s: string): bigint | null {
  let v = s.replace(/\s/g, "").replace("−", "-");
  if (v === "") return 0n;
  const neg = v.startsWith("-");
  if (neg) v = v.slice(1);
  const norm = v.includes(",") ? v.replaceAll(".", "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replaceAll(".", "") : v;
  if (!/^\d+(\.\d{1,3})?$/.test(norm)) return null;
  const [int, dec = ""] = norm.split(".");
  const m = BigInt(int) * 1000n + BigInt((dec + "000").slice(0, 3));
  return neg ? -m : m;
}
const fmtMargin = (bp: bigint | null | undefined) => (bp === null || bp === undefined ? "—" : bp < 0n ? `−${fmtBp(-bp)}` : fmtBp(bp));
const ruleFromTs = (r?: LibSellRule): Rule => (r ? (r.__kind__ === "margin" ? { margin: r.margin } : { price: r.price }) : null);
const ruleToTs = (r: Rule): LibSellRule | undefined => (r === null ? undefined : "margin" in r ? { __kind__: "margin", margin: r.margin } : { __kind__: "price", price: r.price });
const refTs = (r: M.ChapterRef): QuoteChapterRef => ("id" in r ? { __kind__: "id", id: r.id } : { __kind__: "ref", ref: r.ref });
const statusWord = (s: QuoteStatus) => O.status[s] ?? s;
const statusTag = (s: QuoteStatus) => (s === QuoteStatus.draft ? "a-tag--accent" : s === QuoteStatus.accepted ? "a-tag--ok" : s === QuoteStatus.rejected || s === QuoteStatus.withdrawn ? "a-tag--bad" : "");

function toLoaded(r: QuoteRead): M.Loaded {
  const costs = new Map(r.costs.map((c) => [String(c.lineId), c]));
  return {
    versionId: r.version.id,
    rev: r.version.rev,
    header: { title: r.version.title, vatBp: r.version.vatBp, clientOrgId: r.version.clientOrgId ?? null, validDays: r.version.validDays, intro: r.version.intro, note: r.version.note, standardMarginBp: r.margins?.standardMarginBp ?? 2000n },
    chapters: r.chapters.map((c) => ({ id: c.id, code: c.code, title: c.title, order: c.order, libChapterId: c.libChapterId ?? null })),
    lines: r.lines.map((l) => {
      const c = costs.get(String(l.id));
      return {
        id: l.id, chapterId: l.chapterId, order: l.order, kind: l.kind as Kind, code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unit: l.unit, form: l.form as string,
        libItemId: l.libItemId ?? null, libItemVersion: l.libItemVersion ?? null,
        price: c ? { cost: c.costCents ?? null, rule: ruleFromTs(c.rule), reason: c.reason, orgId: c.orgId ?? null, source: c.source, libCostId: c.libCostId ?? null } : M.emptyPrice(),
      };
    }),
  };
}

/** De controleregels (2.6) op wat er nu in de editor staat, met de instellingen van de beheerder. */
function findingsFor(m: M.Model, read: QuoteRead, orgs: OrgView[], rules: { rules: RuleSet[]; std: StdPost[] } | null): Finding[] {
  if (!rules) return [];
  const chapters = M.activeChapters(m);
  const client = m.header.clientOrgId === null ? undefined : orgs.find((o) => o.id === m.header.clientOrgId);
  return evaluate(
    {
      chapters: chapters.map((c) => ({ id: c.key, code: c.code, title: c.title })),
      lines: M.activeLines(m).map((l) => ({ id: l.key, chapter: l.chapter, kind: l.kind, code: l.code, title: l.title, qtyMilli: l.qtyMilli, cost: l.price.cost, rule: l.price.rule, reason: l.price.rule === null ? "" : l.price.reason.replace(/^ +| +$/g, "") })),
      standardBp: m.header.standardMarginBp,
      vatBp: m.header.vatBp,
      workVatBp: read.version.workVatBp,
      vatNote: read.vatNote,
      clientSet: m.header.clientOrgId !== null && !!client,
      clientAddressOk: addressOk(client?.address),
    },
    rules.rules,
    rules.std,
  );
}

// ── Lijst ────────────────────────────────────────────────────────────────
export function OffertesPage({ caps, go, route }: { caps: Caps; go: (to: string) => void; route: string[] }) {
  if (route[1] && /^\d+$/.test(route[1])) {
    const v = route[2] && /^\d+$/.test(route[2]) ? BigInt(route[2]) : undefined;
    return <OfferteEditor key={`${route[1]}-${route[2] ?? ""}`} quoteId={BigInt(route[1])} versionId={v} caps={caps} go={go} />;
  }
  return <QuotesOverview caps={caps} go={go} />;
}

function useQuotes(workId: bigint | null, archived: boolean) {
  const { actor, isFetching } = useBackend();
  return useQuery({ queryKey: ["quotes", workId === null ? "alle" : String(workId), archived], queryFn: () => actor!.listQuotes(workId, archived), enabled: !!actor && !isFetching });
}

function QuotesOverview({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useQuotes(null, archived);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (list.data ?? []).filter((x) => words.every((w) => `${x.number} ${x.title} ${x.workCode} ${x.workName} ${x.clientName}`.toLowerCase().includes(w)));
  return (
    <Page label={O.label} title={O.title} actions={caps.editQuotes && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{O.newQuote}</Button>}>
      <p className="bw-muted" style={{ maxWidth: 760 }}>{caps.quotePrices ? O.lead : O.leadTotals}</p>
      <div className="a-row" style={{ gap: 16 }}>
        <input className="bw-input" style={{ maxWidth: 420 }} type="search" aria-label={O.search} placeholder={O.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="a-check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> {O.showArchived}</label>
      </div>
      <Loading q={list} />
      {list.data && <QuoteTable rows={rows} go={go} empty={O.none} showWork />}
      {creating && <NewQuote onClose={() => setCreating(false)} go={go} />}
    </Page>
  );
}

function QuoteTable({ rows, go, empty, showWork }: { rows: QuoteSummary[]; go: (to: string) => void; empty: string; showWork?: boolean }) {
  if (rows.length === 0) return <p className="a-empty">{empty}</p>;
  return (
    <ul className="a-list">
      {rows.map((x) => {
        const v = x.versions[0];
        return (
          <li key={String(x.id)}>
            <button type="button" className="a-list__btn" onClick={() => go(`offertes/${x.id}/${v?.id ?? ""}`)}>
              <span className="a-tag">{x.number}</span>
              <span className="a-list__main">
                <b>{x.title}</b>
                <span className="bw-muted">{[showWork ? `${x.workCode} ${x.workName}` : "", x.clientName].filter(Boolean).join(" · ")}{x.archived ? ` · ${O.archived}` : ""}</span>
              </span>
              {v && <span className={`a-tag ${statusTag(v.status)}`}>{O.version(v.version)} {statusWord(v.status)}</span>}
              <span className="bw-muted q-when">{fmtTime(x.updatedAt)}</span>
              <Icon name="next" size={18} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Op de werfpagina: de offertes van die werf. */
export function WorkQuotes({ workId, caps, go }: { workId: bigint; caps: Caps; go: (to: string) => void }) {
  const list = useQuotes(workId, false);
  const [creating, setCreating] = useState(false);
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{O.title}</h2>
        {caps.editQuotes && <Button icon="plus" onClick={() => setCreating(true)}>{O.newQuote}</Button>}
      </div>
      <Loading q={list} />
      {list.data && <QuoteTable rows={list.data} go={go} empty={O.noneWork} />}
      {creating && <NewQuote workId={workId} onClose={() => setCreating(false)} go={go} />}
    </section>
  );
}

function NewQuote({ workId, onClose, go }: { workId?: bigint; onClose: () => void; go: (to: string) => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const works = useWorks();
  const [work, setWork] = useState(workId !== undefined ? String(workId) : "");
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = unwrap(await actor!.createQuote({ workId: BigInt(work), number, title }));
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      onClose();
      go(`offertes/${r.quoteId}/${r.versionId}`);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={O.newQuote} open onClose={onClose} side footer={<Button variant="primary" busy={busy} disabled={!work || !title.trim()} onClick={() => void create()}>{O.create}</Button>}>
      <div className="a-form">
        {workId === undefined && (
          <label className="bw-field">
            <span className="bw-label">{O.work}</span>
            <select className="bw-input" value={work} onChange={(e) => setWork(e.target.value)}>
              <option value="">{O.chooseWork}</option>
              {works.data?.map((w) => <option key={String(w.id)} value={String(w.id)}>{w.code} · {w.name}</option>)}
            </select>
          </label>
        )}
        <label className="bw-field"><span className="bw-label">{O.titleField}</span><input className="bw-input" value={title} placeholder={O.titlePh} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="bw-field"><span className="bw-label">{O.number}</span><input className="bw-input" value={number} placeholder="2026/…" onChange={(e) => setNumber(e.target.value)} /><span className="bw-muted">{O.numberHelp}</span></label>
        {err && <p className="a-err" role="alert">{err}</p>}
      </div>
    </Sheet>
  );
}

// Verschil met de vorige versie: nieuw of gewijzigd per lijn (via copiedFrom), en hoeveel lijnen van toen weggelaten zijn.
function diffWith(model: M.Model, pm: M.Model, read: QuoteRead): { marks: Map<string, "new" | "changed">; gone: number } {
  const old = new Map(pm.lines.map((l) => [String(l.id), l]));
  const from = new Map(read.lines.map((l) => [String(l.id), l.copiedFrom]));
  const marks = new Map<string, "new" | "changed">();
  const used = new Set<string>();
  for (const l of model.lines.filter((x) => !x.removed)) {
    const src = l.id !== null ? from.get(String(l.id)) : undefined;
    const o = src !== undefined ? old.get(String(src)) : undefined;
    if (!o) { marks.set(l.key, "new"); continue; }
    used.add(String(src));
    const a = calcLine({ chapter: "", kind: l.kind, qtyMilli: l.qtyMilli, cost: l.price.cost, rule: l.price.rule }, model.header.standardMarginBp);
    const b = calcLine({ chapter: "", kind: o.kind, qtyMilli: o.qtyMilli, cost: o.price.cost, rule: o.price.rule }, pm.header.standardMarginBp);
    if (l.qtyMilli !== o.qtyMilli || l.title !== o.title || l.text !== o.text || l.unit !== o.unit || l.form !== o.form || l.kind !== o.kind || a.unitSell !== b.unitSell) marks.set(l.key, "changed");
  }
  return { marks, gone: pm.lines.filter((l) => !used.has(String(l.id))).length };
}

// ── Editor ───────────────────────────────────────────────────────────────
function OfferteEditor({ quoteId, versionId: wanted, caps, go }: { quoteId: bigint; versionId?: bigint; caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const on = !!actor && !isFetching;
  const [read, setRead] = useState<QuoteRead | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [model, setModel] = useState<M.Model | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [saving, setSaving] = useState(false);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [sheet, setSheet] = useState<null | { kind: "line"; key: string } | { kind: "lib"; chapter: string } | { kind: "libChapters" } | { kind: "send" } | { kind: "decide"; accepted: boolean } | { kind: "signed" } | { kind: "archive" } | { kind: "header" }>(null);
  // De vorige versie, één keer gelezen; het verschil zelf rekent bij elke wijziging opnieuw (Chrome-test C3).
  const [prev, setPrev] = useState<M.Model | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Welke versie: de gevraagde, anders de nieuwste.
  const all = useQuery({ queryKey: ["quotes", "alle", true], queryFn: () => actor!.listQuotes(null, true), enabled: on && wanted === undefined });
  const versionId = wanted ?? all.data?.find((x) => x.id === quoteId)?.versions[0]?.id;

  const load = useCallback(async () => {
    if (!actor || versionId === undefined) return;
    setError(null);
    try {
      const r = unwrap(await actor.readQuoteVersion(versionId));
      setRead(r);
      setServerOk(null);
      setPrev(null);
      if (r.scope === QuoteScope.full) {
        const cached = unsaved.get(String(versionId));
        unsaved.delete(String(versionId));
        if (cached && cached.rev === r.version.rev && r.version.editable) {
          setModel(cached);
          toast.show({ kind: "ok", text: O.restored });
        } else setModel(M.load(toLoaded(r)));
      } else setModel(null);
    } catch (e) {
      setError(e);
    }
  }, [actor, versionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (on) void load(); }, [on, load]);

  // 2.5: de rekentest in deze browser; faalt er één geval, dan wordt er niet bewaard (liever geen offerte dan een fout totaal).
  const self = runSelfTest();
  const editable = !!read && read.scope === QuoteScope.full && read.version.editable && caps.editQuotes && !read.quote.archived && self.failed.length === 0;
  const pending = model ? M.pendingCount(model) : 0;

  // Niet bewaard: waarschuwen bij sluiten, en in het geheugen houden bij een ander scherm.
  const modelRef = useRef(model);
  modelRef.current = model;
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => { if (modelRef.current && M.pendingCount(modelRef.current) > 0) e.preventDefault(); };
    window.addEventListener("beforeunload", onBefore);
    return () => {
      window.removeEventListener("beforeunload", onBefore);
      const m = modelRef.current;
      if (m && M.pendingCount(m) > 0) unsaved.set(String(m.versionId), m);
    };
  }, []);

  const edit = (f: (m: M.Model) => void) => {
    if (!model || !editable) return;
    f(model);
    setServerOk(null);
    bump();
  };

  const save = useCallback(async () => {
    if (!actor || !model || !editable || saving) return;
    setSaving(true);
    try {
      for (let b = M.nextBatch(model); b; b = M.nextBatch(model)) {
        const h = b.header;
        const r = unwrap(await actor.saveQuoteDraft(
          model.versionId,
          model.rev,
          h ? { title: h.title, vatBp: h.vatBp, clientOrgId: h.clientOrgId ?? undefined, validDays: h.validDays, intro: h.intro, note: h.note, standardMarginBp: h.standardMarginBp } : null,
          b.chapterOps.map((c) => ({ id: c.id ?? undefined, ref: c.ref, code: c.code, title: c.title, order: c.order, libChapterId: c.libChapterId ?? undefined, remove: c.remove })),
          b.lineOps.map((l) => ({
            id: l.id ?? undefined, ref: l.ref, chapter: refTs(l.chapter), order: l.order, kind: l.kind as QuoteLineKind, code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unit: l.unit, form: l.form as ContractForm,
            libItemId: l.libItemId ?? undefined, libItemVersion: l.libItemVersion ?? undefined,
            price: { costCents: l.price.cost ?? undefined, rule: ruleToTs(l.price.rule), reason: l.price.reason, orgId: l.price.orgId ?? undefined, source: l.price.source, libCostId: l.price.libCostId ?? undefined },
            remove: l.remove,
          })),
          { subtotalCents: b.expect.subtotal, vatCents: b.expect.vat, totalCents: b.expect.total, optionsPlusCents: b.expect.optionsPlus, optionsMinusCents: b.expect.optionsMinus, costCents: b.expect.cost, marginCents: b.expect.margin, chapters: b.expect.chapters.map((c) => ({ chapter: refTs(c.chapter), sellCents: c.sell })) },
        ));
        M.applySaved(model, b, r.rev, r.refs);
        const mine = M.totals(model);
        setServerOk(r.totals.totalCents === mine.total && r.totals.subtotalCents === mine.subtotal && r.margins.marginCents === mine.margin);
      }
      toast.show({ kind: "ok", text: O.saved });
      void qc.invalidateQueries({ queryKey: ["quotes"] });
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setSaving(false);
      bump();
    }
  }, [actor, model, editable, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd/Ctrl+S = bewaren.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const rulesQ = useQuery({ queryKey: ["quoteRules"], queryFn: () => actor!.getQuoteRules(), enabled: on && caps.editQuotes });
  const libUnits = useQuery({ queryKey: ["libUnits", false], queryFn: () => actor!.libraryUnits(false), enabled: on && caps.readLibrary });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on && caps.readTeam });
  // Het getekende bewijs (een opgeladen PDF van de werf) openen.
  const signedFileId = read?.doc?.acceptance?.signed?.fileId;
  const wfiles = useQuery({ queryKey: ["workFiles", String(read?.quote.workId)], queryFn: () => actor!.listFiles(read!.quote.workId), enabled: on && signedFileId !== undefined && caps.quotePrices });
  const signedUrl = signedFileId === undefined ? undefined : blobUrlOf(wfiles.data?.find((f) => f.id === signedFileId)?.blob);

  if (error) return <Page label={O.label} title={O.title}><p className="a-err" role="alert">{errText(error)}</p><div><Button icon="back" onClick={() => go("offertes")}>{t.common.back}</Button></div></Page>;
  if (!read || versionId === undefined) return <Page label={O.label} title={O.title}><p className="bw-muted">{t.common.loading}</p></Page>;

  const v = read.version;
  const scope = read.scope;
  const units: UnitView[] = libUnits.data ?? [];
  const totals = model ? M.totals(model) : null;
  const ruleSet = rulesQ.data
    ? {
        rules: rulesQ.data.rules.map((r): RuleSet => ({ key: r.key, name: r.name, fixed: r.fixed, enabled: r.enabled, severity: r.severity, thresholdBp: r.thresholdBp ?? null })),
        std: rulesQ.data.stdPosts.map((s): StdPost => ({ key: s.key, name: s.name, keywords: s.keywords, enabled: s.enabled, severity: s.severity, archived: s.archived })),
      }
    : null;
  const findings = model && editable ? findingsFor(model, read, orgs.data ?? [], ruleSet) : [];
  const sellById = new Map(read.sell.map((s) => [String(s.lineId), s]));
  const serverChapter = new Map(read.totals.chapters.map((c) => [String(c.chapterId), c.sellCents]));
  const prevId = v.basedOnVersion !== undefined ? read.quote.versions.find((x) => x.version === v.basedOnVersion)?.id : undefined;
  const { marks: diff, gone: diffGone } = prev && model ? diffWith(model, prev, read) : { marks: null, gone: 0 };

  const showDiff = async () => {
    if (!actor || prevId === undefined || !model) return;
    try {
      setPrev(M.load(toLoaded(unwrap(await actor.readQuoteVersion(prevId)))));
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  };

  // Pijltjes en Enter: naar dezelfde kolom in de rij erboven of eronder (zoals in een spreadsheet).
  const onNav = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const col = el.dataset.col;
    if (!col || !tableRef.current) return;
    const dir = e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey) ? 1 : e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? -1 : 0;
    if (!dir || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return;
    const cells = [...tableRef.current.querySelectorAll<HTMLElement>(`[data-col="${col}"]`)];
    const next = cells[cells.indexOf(el) + dir];
    if (next) { e.preventDefault(); next.focus(); if (next instanceof HTMLInputElement) next.select(); }
  };

  const clientName = (id: bigint | null) => (id === null ? O.noClient : orgs.data?.find((o) => o.id === id)?.name ?? v.clientName);
  const header = model?.header;
  const chapters = model ? M.activeChapters(model) : read.chapters.map((c) => ({ key: `i${c.id}`, id: c.id, code: c.code, title: c.title }));

  return (
    <Page
      wide
      label={`${O.label} · ${read.quote.workCode} ${read.quote.workName}`}
      title={`${read.quote.number} · ${header?.title ?? v.title}`}
      actions={
        <>
          <Button icon="back" onClick={() => go(`werven/${read.quote.workId}`)}>{O.work}</Button>
          {editable && <Button variant="primary" icon="check" busy={saving} disabled={pending === 0} onClick={() => void save()}>{pending ? `${t.common.save} (${pending})` : t.common.save}</Button>}
        </>
      }
    >
      <div className="q-versions" role="tablist" aria-label={O.versions}>
        {read.quote.versions.map((x) => (
          <button key={String(x.id)} type="button" role="tab" aria-selected={x.id === v.id} className="q-ver" onClick={() => go(`offertes/${quoteId}/${x.id}`)}>
            <b>{O.version(x.version)}</b> <span className={`a-tag ${statusTag(x.status)}`}>{statusWord(x.status)}</span>
          </button>
        ))}
        <span className="q-versions__fill" />
        {scope === QuoteScope.full && caps.editQuotes && !read.quote.archived && !read.quote.versions.some((x) => x.status === QuoteStatus.draft) && <Button icon="plus" onClick={() => void newVersion()}>{O.newVersion}</Button>}
        {editable && <Button icon="share" disabled={pending > 0} onClick={() => setSheet({ kind: "send" })}>{O.send}</Button>}
        {scope === QuoteScope.full && caps.editQuotes && v.status === QuoteStatus.sent && <><Button onClick={() => setSheet({ kind: "decide", accepted: true })}>{O.accept}</Button><Button variant="quiet" onClick={() => setSheet({ kind: "decide", accepted: false })}>{O.reject}</Button></>}
        {scope === QuoteScope.full && read.doc && <Button icon="doc" disabled={pending > 0} onClick={() => void openPdf()}>{read.doc.info.frozen ? O.pdf : O.pdfPreview}</Button>}
        {scope === QuoteScope.full && caps.editQuotes && v.status === QuoteStatus.sent && read.doc?.info.frozen && caps.readConfidentialContact && <Button variant="quiet" icon="share" title={O.mailClientHelp} onClick={() => void mailClient()}>{O.mailClient}</Button>}
        {scope === QuoteScope.full && caps.editQuotes && (v.status === QuoteStatus.sent || v.status === QuoteStatus.accepted) && read.doc?.info.frozen && !read.doc.acceptance?.signed && <Button variant="quiet" onClick={() => setSheet({ kind: "signed" })}>{O.signed}</Button>}
        {scope === QuoteScope.full && prevId !== undefined && !diff && <Button variant="quiet" onClick={() => void showDiff()}>{O.diff(O.version(v.basedOnVersion!))}</Button>}
      </div>

      {!v.editable && <p className="a-note">{O.readOnly(statusWord(v.status))} {v.hash && <><span className="bw-mono">{O.hash} {v.hash.slice(0, 16)}…</span> · {v.intact ? O.intact : <b className="a-err">{O.notIntact}</b>}</>} {v.decisionNote && <>· {v.decisionNote}</>}</p>}
      {read.doc?.acceptance && (
        <p className="a-note" data-testid="acceptance">
          <b>{O.acceptance}.</b>{" "}
          {read.doc.acceptance.digital && <>{O.acceptedDigital(read.doc.acceptance.digital.byName, fmtTime(read.doc.acceptance.digital.at))} </>}
          {read.doc.acceptance.signed && <>{O.acceptedSigned(read.doc.acceptance.signed.byName, fmtTime(read.doc.acceptance.signed.at))} {signedUrl && <a className="wb-link" href={signedUrl} target="_blank" rel="noreferrer">{O.signedOpen}</a>} </>}
          {O.acceptedLocked}
        </p>
      )}
      {read.doc?.mailed !== undefined && <p className="bw-muted q-small" data-testid="mailed">{O.mailed(fmtTime(read.doc.mailed))}</p>}
      {read.check && (
        <p className="a-note" data-testid="check-done">
          {O.checkDoneLead(read.check.byName, fmtTime(read.check.at))} {read.check.warned.map((w) => `${w.name}${w.count > 1n ? ` (${w.count})` : ""}`).join(", ")}. <b>{O.checkDoneReason}</b> {read.check.reason}
        </p>
      )}
      {scope === QuoteScope.totals && <p className="a-note">{O.leadTotals}</p>}
      {scope === QuoteScope.sell && <p className="a-note">{O.leadSell}</p>}
      {scope === QuoteScope.full && <p className="bw-muted q-small">{O.auditNote}</p>}
      {diff && <p className="a-note">{O.diff(O.version(v.basedOnVersion!))}: {[...diff.values()].filter((x) => x === "new").length} {O.diffNew}, {[...diff.values()].filter((x) => x === "changed").length} {O.diffChanged}{diffGone > 0 ? ` · ${O.diffGone(diffGone)}` : ""}</p>}

      <div className="q-layout">
        <div className="q-main">
          {model && header && (
            <section className="q-head">
              <dl className="q-facts">
                <div><dt>{O.client}</dt><dd>{clientName(header.clientOrgId)}</dd></div>
                <div><dt>{O.vat}</dt><dd>{fmtBp(header.vatBp)}{header.vatBp !== v.workVatBp && <> <span className="a-tag a-tag--warn">{O.vatWork(fmtBp(v.workVatBp))}</span></>}</dd></div>
                <div><dt>{O.validDays}</dt><dd>{String(header.validDays)}</dd></div>
                <div><dt>{O.standardMargin}</dt><dd>{fmtBp(header.standardMarginBp)}</dd></div>
              </dl>
              {editable && <Button variant="quiet" icon="edit" onClick={() => setSheet({ kind: "header" })}>{O.header}</Button>}
            </section>
          )}

          <div className="q-table" ref={tableRef} onKeyDown={onNav}>
            <QuoteHeadRow scope={scope} />
            {chapters.length === 0 && <p className="a-empty">{O.noChapters}</p>}
            {chapters.map((c, ci) => {
              const rows = model ? M.rowsOf(model, c.key) : read.lines.filter((l) => l.chapterId === c.id);
              const sub = totals ? totals.chapters.find((x) => x.chapter === c.key)?.sell : c.id !== null ? serverChapter.get(String(c.id)) : undefined;
              return (
                <section key={c.key} className="q-ch" id={`ql-${c.key}`}>
                  <div className="q-ch__head">
                    {editable && model ? (
                      <>
                        <input className="q-in q-in--code" aria-label={O.code} value={c.code} onChange={(e) => edit((m) => M.updateChapter(m, c.key, { code: e.target.value }))} />
                        <input className="q-in q-in--chapter" aria-label={O.chapterTitlePh} placeholder={O.chapterTitlePh} value={c.title} onChange={(e) => edit((m) => M.updateChapter(m, c.key, { title: e.target.value }))} />
                      </>
                    ) : (
                      <h2 className="bw-h2 q-ch__title"><span className="bw-mono">{c.code}</span> {c.title}</h2>
                    )}
                    <span className="q-ch__sum bw-mono">{sub !== undefined ? fmtEuro(sub) : "—"}</span>
                    {editable && model && (
                      <span className="q-ch__tools">
                        <Button variant="quiet" icon="up" iconOnly disabled={ci === 0} onClick={() => edit((m) => M.moveChapter(m, c.key, -1))}>{O.up}</Button>
                        <Button variant="quiet" icon="down" iconOnly disabled={ci === chapters.length - 1} onClick={() => edit((m) => M.moveChapter(m, c.key, 1))}>{O.down}</Button>
                        <Button variant="quiet" icon="close" iconOnly onClick={() => edit((m) => M.removeChapter(m, c.key))}>{O.removeChapter}</Button>
                      </span>
                    )}
                  </div>
                  {rows.length === 0 && <p className="bw-muted q-empty">{O.emptyChapter}</p>}
                  {model
                    ? (rows as M.Line[]).map((l) => <LineRow key={l.key} m={model} l={l} scope={scope} editable={editable} units={units} orgs={orgs.data ?? []} mark={diff?.get(l.key)} edit={edit} open={() => setSheet({ kind: "line", key: l.key })} />)
                    : (rows as QuoteRead["lines"]).map((l) => <ReadRow key={String(l.id)} l={l} scope={scope} sell={sellById.get(String(l.id))} />)}
                  {editable && model && (
                    <div className="q-ch__add">
                      <Button variant="quiet" icon="plus" onClick={() => edit((m) => { M.addLine(m, c.key, { kind: "item", unit: units[0]?.key ?? "st", form: "vh" }); })}>{O.addItem}</Button>
                      {caps.readLibrary && <Button variant="quiet" icon="doc" onClick={() => setSheet({ kind: "lib", chapter: c.key })}>{O.addFromLib}</Button>}
                      <Button variant="quiet" icon="plus" onClick={() => edit((m) => { M.addLine(m, c.key, { kind: "text", unit: "" }); })}>{O.addText}</Button>
                      <Button variant="quiet" icon="plus" onClick={() => edit((m) => { M.addLine(m, c.key, { kind: "option", unit: units[0]?.key ?? "st", form: "fixed" }); })}>{O.addOption}</Button>
                    </div>
                  )}
                </section>
              );
            })}
            {editable && model && (
              <div className="q-ch__add">
                <Button icon="plus" onClick={() => edit((m) => { M.addChapter(m, { title: "" }); })}>{O.addChapter}</Button>
                {caps.readLibrary && <Button icon="list" onClick={() => setSheet({ kind: "libChapters" })}>{O.addChapters}</Button>}
              </div>
            )}
          </div>
        </div>

        <aside className="q-side">
          {/* Chrome-test C4: het tarief van het model (de kop kan net gewijzigd zijn), niet dat van de laatste lezing */}
          <Totals read={read} totals={totals} vatBp={model?.header.vatBp ?? v.vatBp} />
          {editable && pending > 0 && <p className="q-pending">{O.pending(pending)} <Button variant="quiet" onClick={() => { if (model) { unsaved.delete(String(model.versionId)); } void load(); }}>{O.discard}</Button></p>}
          {serverOk === true && <p className="q-ok"><Icon name="check" size={16} /> {O.serverOk}</p>}
          {serverOk === false && <p className="a-err" role="alert">{O.serverDiff}</p>}
          {model && <Controls m={model} findings={findings} loaded={!!ruleSet || !editable} onJump={(f) => jump(f)} />}
          <p className={self.failed.length ? "a-err" : "q-ok q-small"} role={self.failed.length ? "alert" : undefined}>
            {self.failed.length ? O.selfFail(self.failed.length, self.failed.join(" · ")) : O.selfOk(self.passed)}
          </p>
          {scope === QuoteScope.full && caps.editQuotes && (
            <div className="a-row">
              {!read.quote.archived && <Button variant="quiet" onClick={() => setSheet({ kind: "archive" })}>{O.archive}</Button>}
              {read.quote.archived && <Button variant="quiet" onClick={() => void unarchive()}>{O.unarchive}</Button>}
              <Button variant="quiet" icon="sync" onClick={() => void load()}>{O.reload}</Button>
            </div>
          )}
        </aside>
      </div>

      {sheet?.kind === "line" && model && <LineSheet m={model} lineKey={sheet.key} editable={editable} units={units} orgs={orgs.data ?? []} edit={edit} onClose={() => setSheet(null)} />}
      {sheet?.kind === "lib" && model && <LibPicker m={model} chapter={sheet.chapter} caps={caps} edit={edit} onClose={() => setSheet(null)} />}
      {sheet?.kind === "libChapters" && model && <LibChapters m={model} edit={edit} onClose={() => setSheet(null)} />}
      {sheet?.kind === "header" && model && <HeaderSheet m={model} orgs={orgs.data ?? []} workVatBp={v.workVatBp} edit={edit} onClose={() => setSheet(null)} />}
      {sheet?.kind === "send" && model && totals && <SendSheet total={totals.total} findings={findings} loaded={!!ruleSet} onSend={async (reason) => { await send(reason); }} onClose={() => setSheet(null)} />}
      {sheet?.kind === "signed" && <SignedSheet workId={read.quote.workId} onDone={async (fileId, note) => { await registerSigned(fileId, note); }} onClose={() => setSheet(null)} />}
      {sheet?.kind === "decide" && <DecideSheet accepted={sheet.accepted} onDone={async (note) => { await decide(sheet.accepted, note); }} onClose={() => setSheet(null)} />}
      {sheet?.kind === "archive" && <ArchiveSheet onDone={async (reason) => { await archive(reason); }} onClose={() => setSheet(null)} />}
    </Page>
  );

  async function newVersion() {
    try {
      const id = unwrap(await actor!.newQuoteVersion(quoteId, v.id));
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      go(`offertes/${quoteId}/${id}`);
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  }
  async function openPdf() {
    const d = pdfFromRead(read!);
    if (!d) return;
    try {
      const blob = await makePdf(d);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = pdfName(d);
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  }
  async function mailClient() {
    try {
      unwrap(await actor!.mailQuoteToClient(v.id));
      toast.show({ kind: "ok", text: O.mailedDone });
      await load();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  }
  async function registerSigned(fileId: bigint, note: string) {
    try {
      unwrap(await actor!.registerSignedQuote(v.id, fileId, note));
      toast.show({ kind: "ok", text: O.signedDone });
      setSheet(null);
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      await load();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  }
  // Naar de eerste lijn (of het eerste hoofdstuk) van een bevinding springen.
  function jump(f: Finding) {
    const key = f.lineIds[0] ?? f.chapterIds[0];
    if (!key) return;
    const el = document.getElementById(`ql-${key}`);
    if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("q-flash"); window.setTimeout(() => el.classList.remove("q-flash"), 1800); }
  }
  async function send(reason: string) {
    if (!model) return;
    try {
      unwrap(await actor!.sendQuoteVersion(v.id, model.rev, M.totals(model).total, reason));
      toast.show({ kind: "ok", text: O.sent });
      setSheet(null);
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      await load();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  }
  async function decide(accepted: boolean, note: string) {
    try {
      unwrap(await actor!.decideQuoteVersion(v.id, accepted, note));
      toast.show({ kind: "ok", text: O.decided });
      setSheet(null);
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      await load();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  }
  async function archive(reason: string) {
    try {
      unwrap(await actor!.setQuoteArchived(quoteId, true, reason));
      setSheet(null);
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      await load();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  }
  async function unarchive() {
    try {
      unwrap(await actor!.setQuoteArchived(quoteId, false, ""));
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      await load();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  }
}

// ── Tabel ────────────────────────────────────────────────────────────────
function QuoteHeadRow({ scope }: { scope: QuoteScope }) {
  return (
    <div className={`q-row q-row--head q-row--${scope}`} aria-hidden>
      <span>{O.code}</span>
      <span>{O.item}</span>
      <span>{O.form}</span>
      <span className="q-r">{O.qty}</span>
      <span>{O.unit}</span>
      {scope === QuoteScope.full && <><span className="q-r">{O.cost}</span><span className="q-r">{O.margin}</span></>}
      {scope !== QuoteScope.totals && <><span className="q-r">{O.sellUnit}</span><span className="q-r">{O.lineTotal}</span></>}
      <span />
    </div>
  );
}

/** Een getal dat je intikt: de tekst blijft staan tot je de cel verlaat (Enter, Tab, pijltje); een fout kleurt rood. */
function NumCell({ value, onCommit, col, label, placeholder }: { value: string; onCommit: (s: string) => boolean; col: string; label: string; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (draft === null) return;
    if (onCommit(draft)) { setDraft(null); setBad(false); } else setBad(true);
  };
  return (
    <input
      className={`q-in q-in--num${bad ? " q-in--bad" : ""}`}
      data-col={col}
      aria-label={label}
      aria-invalid={bad || undefined}
      title={bad ? O.badNumber : undefined}
      inputMode="decimal"
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(null); setBad(false); } }}
    />
  );
}

function Flags({ o, l, std }: { o: ReturnType<typeof calcLine>; l: M.Line; std: bigint }) {
  const tags: { k: string; cls: string }[] = [];
  if (l.kind === "text") return null;
  if (o.noPrice) tags.push({ k: "noPrice", cls: "a-tag--warn" });
  if (o.deviates) tags.push({ k: l.price.rule && "price" in l.price.rule ? "fixed" : "deviates", cls: "a-tag--warn" });
  if (o.deviates && l.price.reason.trim() === "") tags.push({ k: "noReason", cls: "a-tag--bad" });
  if (o.negative) tags.push({ k: "negative", cls: "a-tag--bad" });
  if (l.kind === "item" && l.qtyMilli === 0n) tags.push({ k: "zero", cls: "" });
  void std;
  return <>{tags.map((x) => <span key={x.k} className={`a-tag ${x.cls}`}>{O.flags[x.k]}</span>)}</>;
}

function LineRow({ m, l, scope, editable, units, orgs, mark, edit, open }: { m: M.Model; l: M.Line; scope: QuoteScope; editable: boolean; units: UnitView[]; orgs: OrgView[]; mark?: "new" | "changed"; edit: (f: (m: M.Model) => void) => void; open: () => void }) {
  const o = M.lineOut(m, l);
  const std = m.header.standardMarginBp;
  const up = (x: Parameters<typeof M.updateLine>[2]) => edit((mm) => M.updateLine(mm, l.key, x));
  const cls = `q-row q-row--${scope}${l.kind === "text" ? " q-row--text" : ""}${l.kind === "option" ? " q-row--option" : ""}${l.removed ? " q-row--removed" : ""}${mark ? ` q-row--${mark}` : ""}`;
  const orgName = l.price.orgId !== null ? orgs.find((x) => x.id === l.price.orgId)?.name ?? "" : "";
  const marginShown = o.marginBp;
  const ro = !editable || l.removed;
  const optionWord = l.kind === "option" ? (o.lineSell < 0n ? O.optionMinus : O.optionPlus) : "";
  return (
    <div className={cls} id={`ql-${l.key}`}>
      <span>{ro ? <span className="bw-mono">{l.code}</span> : <input className="q-in q-in--code" data-col="code" aria-label={O.code} value={l.code} onChange={(e) => up({ code: e.target.value })} />}</span>
      <span className={`q-desc${l.kind === "text" ? " q-desc--wide" : ""}`}>
        {ro ? <b>{l.title || l.text.split("\n")[0]}</b> : <input className="q-in" data-col="title" aria-label={O.item} placeholder={l.kind === "text" ? O.textPh : O.itemTitlePh} value={l.title} onChange={(e) => up({ title: e.target.value })} />}
        <span className="q-desc__sub">
          {l.kind !== "item" && <span className="a-tag">{O.kinds[l.kind]}{optionWord ? ` · ${optionWord}` : ""}</span>}
          {l.libItemId !== null && <span className="a-tag" title={O.fromLib(String(l.libItemVersion ?? ""))}>bib</span>}
          {mark && <span className="a-tag a-tag--accent">{mark === "new" ? O.diffNew : O.diffChanged}</span>}
          {l.removed && <span className="a-tag a-tag--bad">{O.removed}</span>}
          {scope === QuoteScope.full && <Flags o={o} l={l} std={std} />}
          {l.text && l.title && <span className="bw-muted q-first">{l.text.split("\n")[0]}</span>}
        </span>
      </span>
      {l.kind === "text" ? null : (
        <>
          <span data-l={O.form}>{ro ? <span className="a-tag" title={O.forms[l.form]}>{O.formsShort[l.form]}</span> : (
            <select className="q-in q-in--sel" data-col="form" aria-label={O.form} title={O.forms[l.form]} value={l.form} onChange={(e) => up({ form: e.target.value })}>
              {FORMS.map((f) => <option key={f} value={f}>{O.formsShort[f]}</option>)}
            </select>
          )}</span>
          <span className="q-r" data-l={O.qty}>{ro ? <span className="bw-mono">{fmtQty(l.qtyMilli)}</span> : <NumCell col="qty" label={O.qtyLong} value={fmtQty(l.qtyMilli)} onCommit={(s) => { const q = parseQty(s); if (q === null) return false; up({ qtyMilli: q }); return true; }} />}</span>
          <span data-l={O.unit}>{ro ? <span className="bw-mono">{l.unit}</span> : (
            <select className="q-in q-in--sel" data-col="unit" aria-label={O.unit} value={l.unit} onChange={(e) => up({ unit: e.target.value })}>
              {!units.some((u) => u.key === l.unit) && <option value={l.unit}>{l.unit}</option>}
              {units.map((u) => <option key={u.key} value={u.key}>{u.key}</option>)}
            </select>
          )}</span>
          {scope === QuoteScope.full && (
            <>
              <span className="q-r" data-l={O.cost}>
                {ro ? <span className="bw-mono">{l.price.cost !== null ? fmtEuro(l.price.cost) : "—"}</span> : <NumCell col="cost" label={O.cost} value={l.price.cost !== null ? (Number(l.price.cost) / 100).toFixed(2).replace(".", ",") : ""} placeholder="—" onCommit={(s) => { const c = parseEuro(s); if (c === null) return false; up({ price: { ...l.price, cost: c ?? null, source: l.price.source || "handmatig" } }); return true; }} />}
                {orgName && <span className="q-oa">{orgName}</span>}
              </span>
              <span className="q-r" data-l={O.margin}>
                {ro || (l.price.rule && "price" in l.price.rule) ? <span className="bw-mono">{fmtMargin(marginShown)}</span> : (
                  <NumCell col="margin" label={O.margin} value={l.price.rule && "margin" in l.price.rule ? (Number(l.price.rule.margin) / 100).toLocaleString("nl-BE") : ""} placeholder={(Number(std) / 100).toLocaleString("nl-BE")}
                    onCommit={(s) => { if (s.trim() === "") { up({ price: { ...l.price, rule: null, reason: "" } }); return true; } const bp = parsePct(s); if (bp === null || bp > 9000n) return false; up({ price: { ...l.price, rule: bp === std ? null : { margin: bp } } }); return true; }} />
                )}
              </span>
            </>
          )}
          {scope !== QuoteScope.totals && (
            <>
              <span className="q-r bw-mono" data-l={O.sellUnit}>{o.unitSell !== null ? fmtEuro(o.unitSell) : "—"}</span>
              <span className={`q-r bw-mono${l.kind === "option" ? " q-opt" : ""}`} data-l={O.lineTotal}>{o.unitSell !== null ? fmtEuro(o.lineSell) : "—"}</span>
            </>
          )}
        </>
      )}
      <span className="q-tools">
        {editable && !l.removed && <>
          <Button variant="quiet" icon="up" iconOnly onClick={() => edit((mm) => M.moveLine(mm, l.key, -1))}>{O.up}</Button>
          <Button variant="quiet" icon="down" iconOnly onClick={() => edit((mm) => M.moveLine(mm, l.key, 1))}>{O.down}</Button>
        </>}
        <Button variant="quiet" icon="edit" iconOnly onClick={open}>{O.details}</Button>
        {editable && (l.removed ? <Button variant="quiet" icon="undo" iconOnly onClick={() => edit((mm) => M.restoreLine(mm, l.key))}>{O.restore}</Button> : <Button variant="quiet" icon="close" iconOnly onClick={() => edit((mm) => M.removeLine(mm, l.key))}>{O.remove}</Button>)}
      </span>
    </div>
  );
}

/** Werfleider en architect: wat de server teruggaf (geen rekenwerk in de browser zonder aankoopprijzen). */
function ReadRow({ l, scope, sell }: { l: QuoteRead["lines"][number]; scope: QuoteScope; sell?: QuoteRead["sell"][number] }) {
  return (
    <div className={`q-row q-row--${scope}${l.kind === QuoteLineKind.text ? " q-row--text" : ""}${l.kind === QuoteLineKind.option ? " q-row--option" : ""}`}>
      <span className="bw-mono">{l.code}</span>
      <span className={`q-desc${l.kind === QuoteLineKind.text ? " q-desc--wide" : ""}`}>
        <b>{l.title || l.text.split("\n")[0]}</b>
        <span className="q-desc__sub">
          {l.kind !== QuoteLineKind.item && <span className="a-tag">{O.kinds[l.kind]}</span>}
          {l.text && l.title && <span className="bw-muted q-first">{l.text.split("\n")[0]}</span>}
        </span>
      </span>
      {l.kind === QuoteLineKind.text ? null : (
        <>
          <span data-l={O.form}><span className="a-tag" title={O.forms[l.form]}>{O.formsShort[l.form]}</span></span>
          <span className="q-r bw-mono" data-l={O.qty}>{fmtQty(l.qtyMilli)}</span>
          <span className="bw-mono" data-l={O.unit}>{l.unit}</span>
          {scope === QuoteScope.sell && sell && (
            <>
              <span className="q-r bw-mono" data-l={O.sellUnit}>{sell.unitSellCents !== undefined ? fmtEuro(sell.unitSellCents) : "—"}</span>
              <span className="q-r bw-mono" data-l={O.lineTotal}>{fmtEuro(sell.lineSellCents)}</span>
            </>
          )}
        </>
      )}
      <span />
    </div>
  );
}

function Totals({ read, totals, vatBp }: { read: QuoteRead; totals: ReturnType<typeof M.totals> | null; vatBp: bigint }) {
  const s = read.totals;
  const sub = totals?.subtotal ?? s.subtotalCents;
  const vat = totals?.vat ?? s.vatCents;
  const tot = totals?.total ?? s.totalCents;
  const plus = totals?.optionsPlus ?? s.optionsPlusCents;
  const minus = totals?.optionsMinus ?? s.optionsMinusCents;
  const noPrice = totals?.noPrice ?? Number(s.noPrice);
  return (
    <section className="q-totals" aria-label={O.total}>
      <div><span>{O.subtotal}</span><b className="bw-mono">{fmtEuro(sub)}</b></div>
      <div><span>{O.vatLine(fmtBp(vatBp))}</span><span className="bw-mono">{fmtEuro(vat)}</span></div>
      <div className="q-totals__big"><span>{O.total}</span><b className="bw-mono">{fmtEuro(tot)}</b></div>
      {(plus !== 0n || minus !== 0n) && <div className="q-totals__opt"><span>{O.options}</span><span className="bw-mono">+{fmtEuro(plus)} / {fmtEuro(minus)}</span></div>}
      {noPrice > 0 && <p className="a-tag a-tag--warn q-totals__warn">{O.incomplete(noPrice)}</p>}
      {totals && (
        <div className="q-totals__conf">
          <div><span>{O.costTotal}</span><span className="bw-mono">{fmtEuro(totals.cost)}</span></div>
          <div><span>{O.marginTotal}</span><span className="bw-mono">{fmtEuro(totals.margin)} · {fmtMargin(totals.marginBp)}</span></div>
          {totals.sellWithoutCost !== 0n && <div><span>{O.sellNoCost}</span><span className="bw-mono">{fmtEuro(totals.sellWithoutCost)}</span></div>}
        </div>
      )}
    </section>
  );
}

function Controls({ m, findings, loaded, onJump }: { m: M.Model; findings: Finding[]; loaded: boolean; onJump: (f: Finding) => void }) {
  // Wat de editor zelf al kende (markeringen), plus de controleregels van 2.6 zoals de beheerder ze instelde.
  const t2 = M.totals(m);
  const marks: string[] = [];
  if (t2.deviating) marks.push(`${t2.deviating}× ${O.flags.deviates}`);
  return (
    <section className="q-controls">
      <h3 className="bw-label">{O.controls}</h3>
      {!loaded && <p className="bw-muted">{t.common.loading}</p>}
      {loaded && findings.length === 0 && <p className="q-ok"><Icon name="check" size={16} /> {O.controlsNone}</p>}
      {findings.length > 0 && (
        <ul className="q-findings">
          {findings.map((f) => (
            <li key={f.rule} className={f.severity === "block" ? "q-find q-find--block" : "q-find q-find--warn"} data-rule={f.rule}>
              <button type="button" className="q-find__btn" disabled={!f.lineIds.length && !f.chapterIds.length} onClick={() => onJump(f)}>
                <span className="a-tag">{f.severity === "block" ? O.checkBlock : O.checkWarn}</span> {f.name}{f.count > 1 ? ` (${f.count})` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
      {marks.length > 0 && <p className="bw-muted q-small">{marks.join(" · ")}</p>}
      <p className="bw-muted q-small">{O.controlsLead}</p>
    </section>
  );
}
function LineSheet({ m, lineKey, editable, units, orgs, edit, onClose }: { m: M.Model; lineKey: string; editable: boolean; units: UnitView[]; orgs: OrgView[]; edit: (f: (m: M.Model) => void) => void; onClose: () => void }) {
  const l = m.lines.find((x) => x.key === lineKey);
  if (!l) return null;
  const ro = !editable || l.removed;
  const up = (x: Parameters<typeof M.updateLine>[2]) => edit((mm) => M.updateLine(mm, l.key, x));
  const o = M.lineOut(m, l);
  const std = m.header.standardMarginBp;
  const ruleKind = l.price.rule === null ? "std" : "margin" in l.price.rule ? "margin" : "fixed";
  const oas = orgs.filter((x) => (x.kind === OrgKind.subcontractor || x.kind === OrgKind.supplier) && x.archivedAt === undefined);
  return (
    <Sheet title={l.title || O.lineTitle} open onClose={onClose} side wide>
      <div className="a-form">
        <Choice label={O.kind} value={l.kind} onChange={(k) => { if (ro) return; up(k === "text" ? { kind: k, price: M.emptyPrice(), qtyMilli: 0n } : { kind: k }); }} options={(["item", "option", "text"] as Kind[]).map((k) => ({ value: k, label: O.kinds[k] }))} />
        <div className="a-grid2">
          <label className="bw-field"><span className="bw-label">{O.code}</span><input className="bw-input" disabled={ro} value={l.code} onChange={(e) => up({ code: e.target.value })} /></label>
          <label className="bw-field"><span className="bw-label">{O.specRef}</span><input className="bw-input" disabled={ro} value={l.specRef} onChange={(e) => up({ specRef: e.target.value })} /></label>
        </div>
        <label className="bw-field"><span className="bw-label">{O.item}</span><input className="bw-input" disabled={ro} value={l.title} onChange={(e) => up({ title: e.target.value })} /></label>
        <label className="bw-field"><span className="bw-label">{O.lineText}</span><textarea className="bw-input" rows={6} disabled={ro} value={l.text} onChange={(e) => up({ text: e.target.value })} /></label>
        {l.libItemId !== null && <p className="bw-muted">{O.fromLib(String(l.libItemVersion ?? ""))}</p>}
        {l.kind !== "text" && (
          <>
            <div className="a-grid3">
              <label className="bw-field"><span className="bw-label">{O.qtyLong}</span><NumCell col="sheet-qty" label={O.qtyLong} value={fmtQty(l.qtyMilli)} onCommit={(s) => { if (ro) return true; const q = parseQty(s); if (q === null) return false; up({ qtyMilli: q }); return true; }} /></label>
              <label className="bw-field"><span className="bw-label">{O.unit}</span>
                <select className="bw-input" disabled={ro} value={l.unit} onChange={(e) => up({ unit: e.target.value })}>{units.map((u) => <option key={u.key} value={u.key}>{u.key} · {u.name}</option>)}</select>
              </label>
              <label className="bw-field"><span className="bw-label">{O.form}</span>
                <select className="bw-input" disabled={ro} value={l.form} onChange={(e) => up({ form: e.target.value })}>{FORMS.map((f) => <option key={f} value={f}>{O.forms[f]}</option>)}</select>
              </label>
            </div>
            <section className="a-confidential a-form">
              <h3 className="bw-h2">{O.price}</h3>
              <div className="a-grid2">
                <label className="bw-field"><span className="bw-label">{O.costField}</span><NumCell col="sheet-cost" label={O.costField} value={l.price.cost !== null ? (Number(l.price.cost) / 100).toFixed(2).replace(".", ",") : ""} placeholder="—" onCommit={(s) => { if (ro) return true; const c = parseEuro(s); if (c === null) return false; up({ price: { ...l.price, cost: c ?? null, source: l.price.source || "handmatig" } }); return true; }} /></label>
                <label className="bw-field"><span className="bw-label">{O.oaField}</span>
                  <select className="bw-input" disabled={ro} value={l.price.orgId !== null ? String(l.price.orgId) : ""} onChange={(e) => up({ price: { ...l.price, orgId: e.target.value ? BigInt(e.target.value) : null } })}>
                    <option value="">{O.noOa}</option>
                    {oas.map((x) => <option key={String(x.id)} value={String(x.id)}>{x.name}</option>)}
                  </select>
                </label>
              </div>
              <Choice label={O.rule} value={ruleKind} onChange={(k) => { if (ro) return; up({ price: { ...l.price, rule: k === "std" ? null : k === "margin" ? { margin: l.price.rule && "margin" in l.price.rule ? l.price.rule.margin : std } : { price: o.unitSell ?? 0n }, reason: k === "std" ? "" : l.price.reason } }); }}
                options={[{ value: "std", label: O.ruleStandard(fmtBp(std)) }, { value: "margin", label: O.ruleMargin }, { value: "fixed", label: O.ruleFixed }]} />
              {ruleKind === "margin" && <label className="bw-field"><span className="bw-label">{O.marginField}</span><NumCell col="sheet-margin" label={O.marginField} value={l.price.rule && "margin" in l.price.rule ? (Number(l.price.rule.margin) / 100).toLocaleString("nl-BE") : ""} onCommit={(s) => { if (ro) return true; const bp = parsePct(s); if (bp === null || bp > 9000n) return false; up({ price: { ...l.price, rule: { margin: bp } } }); return true; }} /></label>}
              {ruleKind === "fixed" && <label className="bw-field"><span className="bw-label">{O.fixedField}</span><NumCell col="sheet-fixed" label={O.fixedField} value={l.price.rule && "price" in l.price.rule ? (Number(l.price.rule.price) / 100).toFixed(2).replace(".", ",") : ""} onCommit={(s) => { if (ro) return true; const c = parseEuro(s); if (c === null || c === undefined) return false; up({ price: { ...l.price, rule: { price: c } } }); return true; }} /></label>}
              {ruleKind !== "std" && <label className="bw-field"><span className="bw-label">{O.reason}</span><input className="bw-input" disabled={ro} value={l.price.reason} placeholder={O.reasonPh} onChange={(e) => up({ price: { ...l.price, reason: e.target.value } })} /></label>}
              <dl className="a-dl">
                <dt>{O.sellUnit}</dt><dd className="bw-mono">{o.unitSell !== null ? fmtEuro(o.unitSell) : "—"}</dd>
                <dt>{O.lineTotal}</dt><dd className="bw-mono">{fmtEuro(o.lineSell)}</dd>
                <dt>{O.margin}</dt><dd className="bw-mono">{fmtMargin(o.marginBp)}</dd>
                <dt>{O.source}</dt><dd>{O.sources[l.price.source] ?? l.price.source}</dd>
              </dl>
            </section>
          </>
        )}
      </div>
    </Sheet>
  );
}

function HeaderSheet({ m, orgs, workVatBp, edit, onClose }: { m: M.Model; orgs: OrgView[]; workVatBp: bigint; edit: (f: (m: M.Model) => void) => void; onClose: () => void }) {
  const h = m.header;
  const up = (x: Partial<M.Header>) => edit((mm) => M.setHeader(mm, x));
  const clients = orgs.filter((x) => x.kind === OrgKind.client && (x.archivedAt === undefined || x.id === h.clientOrgId));
  return (
    <Sheet title={O.header} open onClose={onClose} side>
      <div className="a-form">
        <label className="bw-field"><span className="bw-label">{O.titleField}</span><input className="bw-input" value={h.title} onChange={(e) => up({ title: e.target.value })} /></label>
        <label className="bw-field"><span className="bw-label">{O.client}</span>
          <select className="bw-input" value={h.clientOrgId !== null ? String(h.clientOrgId) : ""} onChange={(e) => up({ clientOrgId: e.target.value ? BigInt(e.target.value) : null })}>
            <option value="">{O.noClient}</option>
            {clients.map((x) => <option key={String(x.id)} value={String(x.id)}>{x.name}</option>)}
          </select>
        </label>
        <div>
          <span className="bw-label">{O.vat}</span>
          <Choice label={O.vat} value={Number(h.vatBp)} onChange={(x) => up({ vatBp: BigInt(x) })} options={[{ value: 600, label: "6 %" }, { value: 2100, label: "21 %" }]} />
          {h.vatBp !== workVatBp && <p className="a-tag a-tag--warn">{O.vatWork(fmtBp(workVatBp))}</p>}
        </div>
        <div className="a-grid2">
          <label className="bw-field"><span className="bw-label">{O.validDays}</span><NumCell col="h-days" label={O.validDays} value={String(h.validDays)} onCommit={(s) => { const n = Number(s); if (!Number.isInteger(n) || n < 1 || n > 365) return false; up({ validDays: BigInt(n) }); return true; }} /></label>
          <label className="bw-field"><span className="bw-label">{O.standardMargin} (%)</span><NumCell col="h-margin" label={O.standardMargin} value={(Number(h.standardMarginBp) / 100).toLocaleString("nl-BE")} onCommit={(s) => { const bp = parsePct(s); if (bp === null || bp > 9000n) return false; up({ standardMarginBp: bp }); return true; }} /></label>
        </div>
        <p className="bw-muted">{O.standardMarginHelp}</p>
        <label className="bw-field"><span className="bw-label">{O.intro}</span><textarea className="bw-input" rows={4} value={h.intro} onChange={(e) => up({ intro: e.target.value })} /></label>
        <label className="bw-field"><span className="bw-label">{O.note}</span><textarea className="bw-input" rows={3} value={h.note} onChange={(e) => up({ note: e.target.value })} /></label>
      </div>
    </Sheet>
  );
}

function LibPicker({ m, chapter, caps, edit, onClose }: { m: M.Model; chapter: string; caps: Caps; edit: (f: (m: M.Model) => void) => void; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [target, setTarget] = useState(chapter);
  const ch = m.chapters.find((c) => c.key === chapter);
  const [libCh, setLibCh] = useState(ch?.libChapterId !== null && ch?.libChapterId !== undefined ? String(ch.libChapterId) : "");
  const [picked, setPicked] = useState<Map<string, LibItemView>>(new Map());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const h = setTimeout(() => setQ(text), 200); return () => clearTimeout(h); }, [text]);
  const chapters = useQuery({ queryKey: ["libChapters", false], queryFn: () => actor!.libraryChapters(false), enabled: !!actor && !isFetching });
  const list = useQuery({
    queryKey: ["library", "pick", q, libCh],
    queryFn: () => actor!.listLibrary({ text: q, chapterId: libCh ? BigInt(libCh) : undefined, form: undefined, trade: undefined, unit: undefined, orgId: undefined, includeArchived: false, offset: 0n, limit: 100n }),
    enabled: !!actor && !isFetching,
    placeholderData: (prev) => prev,
  });
  const add = async () => {
    setBusy(true);
    try {
      const items = [...picked.values()];
      // Aankoopprijs en verkoopregel uit de bibliotheek (update-call met auditregel "bekeek:prijzen").
      const prices = caps.quotePrices ? unwrap(await actor!.readLibraryPrices(items.map((x) => x.id))).prices : [];
      const pr = new Map(prices.map((p) => [String(p.itemId), p]));
      edit((mm) => {
        for (const it of items) {
          const p = pr.get(String(it.id));
          M.addLine(mm, target, {
            kind: "item", code: it.code, title: it.title, text: it.text, unit: it.unit, form: it.form as string, qtyMilli: 0n, libItemId: it.id, libItemVersion: it.version,
            price: { cost: p?.cost?.costCents ?? null, rule: ruleFromTs(p?.rule), reason: p?.rule ? p.reason : "", orgId: p?.cost?.orgId ?? it.orgId ?? null, source: "bibliotheek", libCostId: p?.cost?.id ?? null },
          });
        }
      });
      toast.show({ kind: "ok", text: O.libAdded(items.length) });
      onClose();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const toggle = (it: LibItemView) => setPicked((p) => { const n = new Map(p); if (n.has(String(it.id))) n.delete(String(it.id)); else n.set(String(it.id), it); return n; });
  return (
    <Sheet title={O.libTitle} open onClose={onClose} side wide footer={<Button variant="primary" busy={busy} disabled={picked.size === 0} onClick={() => void add()}>{O.libAdd(picked.size)}</Button>}>
      <div className="a-form">
        <div className="a-grid2">
          <input className="bw-input" type="search" aria-label={t.posten.search} placeholder={t.posten.search} value={text} onChange={(e) => setText(e.target.value)} />
          <select className="bw-input" aria-label={t.posten.chapter} value={libCh} onChange={(e) => setLibCh(e.target.value)}>
            <option value="">{t.posten.allChapters}</option>
            {chapters.data?.map((c: LibChapterView) => <option key={String(c.id)} value={String(c.id)}>{c.code} {c.title}</option>)}
          </select>
        </div>
        <label className="bw-field"><span className="bw-label">{O.libTo}</span>
          <select className="bw-input" value={target} onChange={(e) => setTarget(e.target.value)}>{M.activeChapters(m).map((c) => <option key={c.key} value={c.key}>{c.code} {c.title}</option>)}</select>
        </label>
        {caps.quotePrices && <p className="bw-muted q-small">{O.libPricesNote}</p>}
        <Loading q={list} />
        <ul className="a-list">
          {list.data?.items.map((it) => (
            <li key={String(it.id)}>
              <label className="a-check q-pick">
                <input type="checkbox" checked={picked.has(String(it.id))} onChange={() => toggle(it)} />
                <span className="a-list__main"><b>{it.code ? `${it.code} · ` : ""}{it.title}</b><span className="bw-muted">{it.chapterCode} {it.chapterTitle} · {it.unit} · {O.forms[it.form]}</span></span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

function LibChapters({ m, edit, onClose }: { m: M.Model; edit: (f: (m: M.Model) => void) => void; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const chapters = useQuery({ queryKey: ["libChapters", false], queryFn: () => actor!.libraryChapters(false), enabled: !!actor && !isFetching });
  const have = new Set(M.activeChapters(m).map((c) => (c.libChapterId !== null ? String(c.libChapterId) : "")));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const add = () => {
    const rows = (chapters.data ?? []).filter((c) => picked.has(String(c.id)));
    edit((mm) => { for (const c of rows) M.addChapter(mm, { code: c.code, title: c.title, libChapterId: c.id }); });
    onClose();
  };
  return (
    <Sheet title={O.libChaptersTitle} open onClose={onClose} side footer={<Button variant="primary" disabled={picked.size === 0} onClick={add}>{O.libChaptersAdd(picked.size)}</Button>}>
      <Loading q={chapters} />
      <ul className="a-list">
        {chapters.data?.filter((c) => !have.has(String(c.id))).map((c) => (
          <li key={String(c.id)}>
            <label className="a-check q-pick">
              <input type="checkbox" checked={picked.has(String(c.id))} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(String(c.id))) n.delete(String(c.id)); else n.add(String(c.id)); return n; })} />
              <span><span className="bw-mono">{c.code}</span> {c.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function SendSheet({ total, findings, loaded, onSend, onClose }: { total: bigint; findings: Finding[]; loaded: boolean; onSend: (reason: string) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const bl = blocks(findings);
  const wr = warnings(findings);
  const reasonOk = wr.length === 0 || reason.trim().length >= 5;
  return (
    <Sheet title={O.sendTitle} open onClose={onClose} side footer={<Button variant="primary" icon="share" busy={busy} disabled={!loaded || bl.length > 0 || !reasonOk} onClick={() => { setBusy(true); void onSend(reason.trim()).finally(() => setBusy(false)); }}>{O.send}</Button>}>
      <div className="a-form">
        <p>{O.sendLead}</p>
        <dl className="a-dl"><dt>{O.total}</dt><dd className="bw-mono">{fmtEuro(total)}</dd></dl>
        {!loaded && <p className="a-tag a-tag--warn">{O.sendNoRules}</p>}
        {bl.length > 0 && (
          <div className="q-sendcheck" role="alert">
            <p><b>{O.sendBlocked}</b></p>
            <ul>{bl.map((f) => <li key={f.rule} data-rule={f.rule}>{f.name}{f.count > 1 ? ` (${f.count})` : ""}</li>)}</ul>
          </div>
        )}
        {bl.length === 0 && wr.length > 0 && (
          <div className="q-sendcheck">
            <p><b>{O.sendWarned}</b></p>
            <ul>{wr.map((f) => <li key={f.rule} data-rule={f.rule}>{f.name}{f.count > 1 ? ` (${f.count})` : ""}</li>)}</ul>
            <label className="bw-field">
              <span className="bw-label">{O.sendReason}</span>
              <textarea className="bw-input" rows={3} maxLength={300} value={reason} placeholder={O.sendReasonPh} onChange={(e) => setReason(e.target.value)} />
              <span className="bw-muted">{O.sendReasonHelp}</span>
            </label>
          </div>
        )}
        {loaded && bl.length === 0 && wr.length === 0 && <p className="q-ok"><Icon name="check" size={16} /> {O.controlsNone}</p>}
      </div>
    </Sheet>
  );
}
function DecideSheet({ accepted, onDone, onClose }: { accepted: boolean; onDone: (note: string) => Promise<void>; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={O.decideTitle(accepted)} open onClose={onClose} side footer={<Button variant="primary" busy={busy} onClick={() => { setBusy(true); void onDone(note).finally(() => setBusy(false)); }}>{accepted ? O.accept : O.reject}</Button>}>
      <label className="bw-field"><span className="bw-label">{O.decideNote}</span><input className="bw-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </Sheet>
  );
}

function ArchiveSheet({ onDone, onClose }: { onDone: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={O.archive} open onClose={onClose} side footer={<Button variant="danger" busy={busy} disabled={!reason.trim()} onClick={() => { setBusy(true); void onDone(reason).finally(() => setBusy(false)); }}>{O.archive}</Button>}>
      <label className="bw-field"><span className="bw-label">{O.archiveReason}</span><input className="bw-input" value={reason} placeholder={O.archiveReasonPh} onChange={(e) => setReason(e.target.value)} /></label>
    </Sheet>
  );
}


function SignedSheet({ workId, onDone, onClose }: { workId: bigint; onDone: (fileId: bigint, note: string) => Promise<void>; onClose: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      if (file.type !== "application/pdf") throw new Error(O.signedFile + ": PDF");
      const bytes = new Uint8Array(await file.arrayBuffer());
      setProgress(0);
      const blob = ExternalBlob.fromBytes(bytes, file.type, file.name).withUploadProgress(setProgress);
      const fileId = unwrap(await actor!.addFile(file.name, file.type, BigInt(bytes.length), blob, workId, false));
      await onDone(fileId, note.trim());
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  return (
    <Sheet title={O.signedTitle} open onClose={onClose} side>
      <div className="a-form">
        <p>{O.signedLead}</p>
        <label className="bw-field"><span className="bw-label">{O.signedNote}</span><input className="bw-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="bw-btn bw-btn--secondary" style={{ position: "relative" }}>
          <Icon name="doc" size={20} />
          {busy ? t.werven.uploading(progress ?? 0) : O.signedFile}
          <input type="file" accept="application/pdf" disabled={busy} data-testid="signed-file" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        </label>
      </div>
    </Sheet>
  );
}
