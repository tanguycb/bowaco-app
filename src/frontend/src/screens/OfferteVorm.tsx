// De offerte zoals Alexis ze maakt (ontwerp 2c §4.1): wat de klant ziet (posten met 0, regietekst, tekstblokken), het
// regietarief en de korting (paneel naast de editor), de marge per hoofdstuk, de soort van de offerte (schadedossier met
// verzekeraar en dossiernummer), en in Beheer de margeklassen, hun standaardklasse per hoofdstuk of leverancier en de
// tekstblokken. Marges, klassen en tarieven zijn vertrouwelijk: enkel wie ook de aankoopprijzen ziet (caps.quotePrices).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { OrgKind, QuoteKind, type OrgView, type QuoteRead, type TextBlockPlace, type TextBlockView } from "../backend";
import { Button, Choice, Info, Sheet, useToast } from "../design";
import * as M from "../quote/model.ts";
import { t } from "../texts/nl";
import { errText, fmtBp, fmtEuro, parseEuro, parsePct, unwrap, useBackend } from "../util";
import { Loading } from "./common";

const V = t.vorm;
const eurIn = (c: bigint) => (Number(c) / 100).toFixed(2).replace(".", ",");
const pctIn = (bp: bigint) => (Number(bp) / 100).toLocaleString("nl-BE");

type Classes = NonNullable<QuoteRead["terms"]>["classes"];

/** Het paneel naast de editor: regietarief, korting, wat de klant ziet en de tekstblokken. */
export function FormPanel({ m, editable, orgs, edit }: { m: M.Model; editable: boolean; orgs: OrgView[]; edit: (f: (m: M.Model) => void) => void }) {
  const { actor, isFetching } = useBackend();
  const blocks = useQuery({ queryKey: ["textBlocks", false], queryFn: () => actor!.listTextBlocks(false), enabled: !!actor && !isFetching && editable });
  const f = m.form;
  const oas = orgs.filter((x) => (x.kind === OrgKind.subcontractor || x.kind === OrgKind.bowaco) && (x.archivedAt === undefined || x.id === f.regie?.orgId));
  const discKind = f.discount === null ? "none" : "amount" in f.discount ? "amount" : "percent";
  const setForm = (x: Partial<M.Form>) => edit((mm) => { Object.assign(mm.form, x); });
  return (
    <section className="q-controls a-confidential" data-testid="quote-form">
      <h3 className="bw-label">{V.regie}<Info text={V.regieHelp} label={t.uitleg.label} /></h3>
      {f.regie === null ? (
        editable ? <Button variant="quiet" icon="plus" onClick={() => setForm({ regie: { orgId: null, cost: 0n, sell: 0n } })}>{V.regieAdd}</Button> : <p className="bw-muted">{V.regieNone}</p>
      ) : (
        <div className="a-form">
          <label className="bw-field"><span className="bw-label">{V.regieOa}</span>
            <select className="bw-input" disabled={!editable} value={f.regie.orgId !== null ? String(f.regie.orgId) : ""} onChange={(e) => setForm({ regie: { ...f.regie!, orgId: e.target.value ? BigInt(e.target.value) : null } })}>
              <option value="">{V.regieNoOa}</option>
              {oas.map((x) => <option key={String(x.id)} value={String(x.id)}>{x.name}</option>)}
            </select>
          </label>
          <div className="a-grid2">
            <label className="bw-field"><span className="bw-label">{V.regieCost}</span>
              <EuroField disabled={!editable} value={f.regie.cost} testid="regie-cost" onCommit={(c) => setForm({ regie: { ...f.regie!, cost: c, sell: M.regieSell(c) } })} />
            </label>
            <label className="bw-field"><span className="bw-label">{V.regieSell}</span>
              <EuroField disabled={!editable} value={f.regie.sell} testid="regie-sell" onCommit={(c) => setForm({ regie: { ...f.regie!, sell: c } })} />
            </label>
          </div>
          <label className="a-check"><input type="checkbox" disabled={!editable} checked={f.regieText} onChange={(e) => setForm({ regieText: e.target.checked })} /> {V.regieText}</label>
          {f.regieText && <p className="bw-muted q-small">{V.regieSentence(fmtEuro(f.regie.sell))}</p>}
          {editable && <Button variant="quiet" icon="close" onClick={() => setForm({ regie: null, regieText: false })}>{V.regieRemove}</Button>}
        </div>
      )}

      <h3 className="bw-label">{V.discount}</h3>
      <Choice label={V.discount} value={discKind} onChange={(k) => { if (!editable) return; setForm({ discount: k === "none" ? null : k === "amount" ? { amount: 0n } : { percent: 0n }, discountText: k === "none" ? "" : f.discountText }); }}
        options={[{ value: "none", label: V.discountNone }, { value: "amount", label: V.discountAmount }, { value: "percent", label: V.discountPercent }]} />
      {f.discount !== null && (
        <div className="a-grid2">
          {"amount" in f.discount
            ? <label className="bw-field"><span className="bw-label">{V.discountValueEur}</span><EuroField disabled={!editable} value={f.discount.amount} testid="discount-amount" onCommit={(c) => setForm({ discount: { amount: c } })} /></label>
            : <label className="bw-field"><span className="bw-label">{V.discountValuePct}</span><PctField disabled={!editable} value={f.discount.percent} max={10_000n} testid="discount-pct" onCommit={(bp) => setForm({ discount: { percent: bp } })} /></label>}
          <label className="bw-field"><span className="bw-label">{V.discountText}</span><input className="bw-input" disabled={!editable} maxLength={160} placeholder={V.discountTextPh} value={f.discountText} onChange={(e) => setForm({ discountText: e.target.value })} /></label>
        </div>
      )}

      <h3 className="bw-label">{V.title}</h3>
      <label className="a-check"><input type="checkbox" disabled={!editable} checked={f.hideZeroLines} data-testid="hide-zero" onChange={(e) => setForm({ hideZeroLines: e.target.checked })} /> {V.hideZero}<Info text={V.hideZeroHelp} label={t.uitleg.label} /></label>
      <h3 className="bw-label">{V.blocks}</h3>
      {editable && <Loading q={blocks} />}
      {editable && blocks.data?.length === 0 && <p className="bw-muted q-small">{V.blocksNone}</p>}
      {(editable ? blocks.data ?? [] : []).map((b) => (
        <label key={b.key} className="a-check" title={b.text}>
          <input type="checkbox" disabled={!editable} checked={f.textBlockKeys.includes(b.key)} onChange={(e) => setForm({ textBlockKeys: e.target.checked ? [...f.textBlockKeys, b.key] : f.textBlockKeys.filter((k) => k !== b.key) })} /> {b.title} <span className="bw-muted q-small">({placeText(b.place)})</span>
        </label>
      ))}
      {!editable && f.textBlockKeys.length > 0 && <p className="bw-muted q-small">{f.textBlockKeys.join(", ")}</p>}
    </section>
  );
}

export const placeText = (p: TextBlockPlace) => (p.__kind__ === "chapter" ? `${V.places.chapter} ${p.chapter}` : V.places[p.__kind__]);

function EuroField({ value, onCommit, disabled, testid }: { value: bigint; onCommit: (c: bigint) => void; disabled?: boolean; testid?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const c = parseEuro(draft);
    if (c === null || c === undefined || c < 0n) { setBad(true); return; }
    setBad(false);
    setDraft(null);
    onCommit(c);
  };
  return <input className={`bw-input bw-num${bad ? " q-in--bad" : ""}`} inputMode="decimal" disabled={disabled} data-testid={testid} aria-invalid={bad || undefined} value={draft ?? eurIn(value)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />;
}

function PctField({ value, onCommit, disabled, max, testid }: { value: bigint; onCommit: (bp: bigint) => void; disabled?: boolean; max: bigint; testid?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const bp = parsePct(draft);
    if (bp === null || bp > max) { setBad(true); return; }
    setBad(false);
    setDraft(null);
    onCommit(bp);
  };
  return <input className={`bw-input bw-num${bad ? " q-in--bad" : ""}`} inputMode="decimal" disabled={disabled} data-testid={testid} aria-invalid={bad || undefined} value={draft ?? pctIn(value)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />;
}

/** De marge van een hoofdstuk: standaard, de standaardklasse uit de bibliotheek, of een klasse die de versie vastlegt. */
export function ChapterMargin({ m, chapterKey, classes, editable, edit }: { m: M.Model; chapterKey: string; classes: Classes; editable: boolean; edit: (f: (m: M.Model) => void) => void }) {
  const fixed = m.form.chapterMargins.get(chapterKey);
  const ch = m.chapters.find((c) => c.key === chapterKey);
  const lib = m.terms.live && ch && ch.libChapterId !== null ? m.terms.linkCh.get(String(ch.libChapterId)) : undefined;
  const nameOf = (id: bigint | null) => (id === null ? "" : classes.find((c) => c.id === id)?.name ?? `#${id}`);
  const stdLabel = lib ? V.chapterMarginLib(nameOf(lib.classId), fmtBp(lib.marginBp)) : V.chapterMarginStd(fmtBp(m.header.standardMarginBp));
  // Een vastgelegde klasse waarvan de marge intussen veranderde, blijft op haar oude marge (zoals de server bewaart).
  const stale = !!fixed && fixed.classId !== null && classes.some((c) => c.id === fixed.classId && c.marginBp !== fixed.marginBp);
  const value = fixed ? (stale ? "v" : fixed.classId !== null ? `c${fixed.classId}` : `m${fixed.marginBp}`) : "";
  if (!editable) return fixed ? <span className="a-tag" title={V.chapterMargin}>{fixed.classId !== null ? V.classLabel(fmtBp(fixed.marginBp), nameOf(fixed.classId)) : fmtBp(fixed.marginBp)}</span> : null;
  return (
    <select className="q-in q-in--sel" aria-label={V.chapterMargin} title={V.chapterMargin} data-testid={`chapter-margin-${chapterKey}`} value={value}
      onChange={(e) => edit((mm) => {
        const x = e.target.value;
        if (x === "v") return;
        if (x === "") mm.form.chapterMargins.delete(chapterKey);
        else if (x.startsWith("c")) { const c = classes.find((k) => `c${k.id}` === x); if (c) mm.form.chapterMargins.set(chapterKey, { classId: c.id, marginBp: c.marginBp }); }
      })}>
      <option value="">{stdLabel}</option>
      {fixed && fixed.classId === null && <option value={value}>{fmtBp(fixed.marginBp)}</option>}
      {stale && <option value="v">{V.classLabel(fmtBp(fixed!.marginBp), nameOf(fixed!.classId))}</option>}
      {classes.map((c) => <option key={String(c.id)} value={`c${c.id}`}>{V.classLabel(fmtBp(c.marginBp), c.name)}</option>)}
    </select>
  );
}

/** De subgroepen van een hoofdstuk: titel wijzigen, weghalen; nieuwe via de knop in de kop van het hoofdstuk. */
export function SubgroupHead({ m, g, sum, editable, edit }: { m: M.Model; g: M.Subgroup; sum: bigint | null; editable: boolean; edit: (f: (m: M.Model) => void) => void }) {
  void m;
  return (
    <div className="q-sub" data-testid={`subgroup-${g.key}`}>
      {editable ? <input className="q-in q-in--chapter" aria-label={V.subgroupField} placeholder={V.subgroupPh} value={g.title} onChange={(e) => edit((mm) => M.updateSubgroup(mm, g.key, { title: e.target.value }))} /> : <b>{g.title}</b>}
      {sum !== null && <span className="q-ch__sum bw-mono">{fmtEuro(sum)}</span>}
      {editable && <Button variant="quiet" icon="close" iconOnly onClick={() => edit((mm) => M.removeSubgroup(mm, g.key))}>{V.subgroupRemove}</Button>}
    </div>
  );
}

/** De soort van de offerte (schadedossier met verzekeraar en dossiernummer). Bewaart meteen. */
export function KindSheet({ read, orgs, onDone, onClose }: { read: QuoteRead; orgs: OrgView[]; onDone: () => void; onClose: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const f = read.form;
  const [kind, setKind] = useState<QuoteKind>(f?.kind ?? QuoteKind.standard);
  const [insurer, setInsurer] = useState<string>(f?.insurerOrgId !== undefined ? String(f.insurerOrgId) : "");
  const [claim, setClaim] = useState(f?.claimRef ?? "");
  const [busy, setBusy] = useState(false);
  const insurers = orgs.filter((x) => (x.kind === OrgKind.other || x.kind === OrgKind.client) && (x.archivedAt === undefined || String(x.id) === insurer));
  const damage = kind === QuoteKind.damage;
  const save = async () => {
    if (!actor) return;
    setBusy(true);
    try {
      unwrap(await actor.setQuoteInfo(read.quote.id, { kind, insurerOrgId: damage && insurer ? BigInt(insurer) : undefined, claimRef: damage ? claim : "" }));
      toast.show({ kind: "ok", text: V.kindSaved });
      onDone();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={V.kind} open onClose={onClose} side>
      <div className="a-form">
        <Choice label={V.kind} value={kind} onChange={(k) => setKind(k)} options={[QuoteKind.standard, QuoteKind.damage, QuoteKind.regie].map((k) => ({ value: k, label: V.kinds[k] }))} />
        {damage && (
          <>
            <label className="bw-field"><span className="bw-label">{V.insurer}<Info text={V.insurerHelp} label={t.uitleg.label} /></span>
              <select className="bw-input" value={insurer} onChange={(e) => setInsurer(e.target.value)}>
                <option value="">{V.noInsurer}</option>
                {insurers.map((x) => <option key={String(x.id)} value={String(x.id)}>{x.name}</option>)}
              </select>
            </label>
            <label className="bw-field"><span className="bw-label">{V.claimRef}</span><input className="bw-input" maxLength={60} value={claim} onChange={(e) => setClaim(e.target.value)} /></label>
            <p className="bw-muted">{V.vatZeroHelp}</p>
          </>
        )}
        <div><Button variant="primary" busy={busy} onClick={() => void save()}>{t.common.save}</Button></div>
      </div>
    </Sheet>
  );
}

// ── Beheer → Offertes: margeklassen, standaardklasse, tekstblokken ──────
export function MarginClassesAdmin() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const on = !!actor && !isFetching;
  const cls = useQuery({ queryKey: ["marginClasses"], queryFn: async () => unwrap(await actor!.listMarginClasses()), enabled: on });
  const chapters = useQuery({ queryKey: ["libChapters", false], queryFn: () => actor!.libraryChapters(false), enabled: on });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on });
  const [name, setName] = useState("");
  const [pct, setPct] = useState("");
  const done = (text: string) => { toast.show({ kind: "ok", text }); void qc.invalidateQueries({ queryKey: ["marginClasses"] }); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const setClass = useMutation({ mutationFn: async (i: { id?: bigint; name: string; marginBp: bigint; note: string; archived: boolean }) => unwrap(await actor!.setMarginClass(i)), onSuccess: () => { setName(""); setPct(""); done(V.classSaved); }, onError: fail });
  const setLink = useMutation({ mutationFn: async (x: { key: string; classId?: bigint }) => unwrap(await actor!.setMarginClassLink(x.key, x.classId ?? null)), onSuccess: () => done(V.linkSaved), onError: fail });
  const list = cls.data?.classes ?? [];
  const active = list.filter((c) => !c.archived);
  const linkOf = (key: string) => cls.data?.links.find((l) => l.key === key);
  const bp = parsePct(pct);
  const oas = (orgs.data ?? []).filter((o) => o.kind === OrgKind.subcontractor || o.kind === OrgKind.supplier);
  const linkSelect = (key: string, label: string) => (
    <label key={key} className="bw-field"><span className="bw-label">{label}</span>
      <select className="bw-input" value={linkOf(key) ? String(linkOf(key)!.classId) : ""} onChange={(e) => setLink.mutate({ key, classId: e.target.value ? BigInt(e.target.value) : undefined })}>
        <option value="">{V.linkNone}</option>
        {active.map((c) => <option key={String(c.id)} value={String(c.id)}>{c.name} ({fmtBp(c.marginBp)})</option>)}
      </select>
    </label>
  );
  const [pickCh, setPickCh] = useState("");
  const [pickOrg, setPickOrg] = useState("");
  return (
    <section className="a-section a-form a-confidential" style={{ maxWidth: 720 }} data-testid="margin-classes">
      <h2 className="bw-h2">{V.classesTitle}</h2>
      <p className="bw-muted">{V.classesLead}</p>
      <Loading q={cls} />
      <table className="a-table">
        <thead><tr><th>{V.className}</th><th>{V.classMargin}</th><th /></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={String(c.id)} className={c.archived ? "bw-muted" : undefined}>
              <td>{c.name}{c.archived && <> <span className="a-tag">{V.classArchived}</span></>}</td>
              <td className="bw-mono">{fmtBp(c.marginBp)}</td>
              <td><Button variant="quiet" onClick={() => setClass.mutate({ id: c.id, name: c.name, marginBp: c.marginBp, note: c.note, archived: !c.archived })}>{c.archived ? V.unarchive : V.archive}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="a-row">
        <label className="bw-field"><span className="bw-label">{V.className}</span><input className="bw-input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="bw-field"><span className="bw-label">{V.classMargin}</span><input className="bw-input bw-num" style={{ maxWidth: 100 }} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></label>
        <Button busy={setClass.isPending} disabled={!name.trim() || bp === null || pct.trim() === "" || bp > 9000n} onClick={() => setClass.mutate({ name, marginBp: bp ?? 0n, note: "", archived: false })}>{V.classAdd}</Button>
      </div>
      <h3 className="bw-h2">{V.linksTitle}</h3>
      {(cls.data?.links ?? []).map((l) => {
        const lab = l.key.startsWith("ch:") ? chapters.data?.find((c) => `ch:${c.id}` === l.key) : undefined;
        const org = l.key.startsWith("org:") ? orgs.data?.find((o) => `org:${o.id}` === l.key) : undefined;
        return linkSelect(l.key, lab ? `${lab.code} ${lab.title}` : org ? org.name : l.key);
      })}
      <div className="a-grid2">
        <label className="bw-field"><span className="bw-label">{V.linkChapter}</span>
          <select className="bw-input" value={pickCh} onChange={(e) => setPickCh(e.target.value)}>
            <option value="" />
            {(chapters.data ?? []).filter((c) => !linkOf(`ch:${c.id}`)).map((c) => <option key={String(c.id)} value={`ch:${c.id}`}>{c.code} {c.title}</option>)}
          </select>
        </label>
        <label className="bw-field"><span className="bw-label">{V.linkOrg}</span>
          <select className="bw-input" value={pickOrg} onChange={(e) => setPickOrg(e.target.value)}>
            <option value="" />
            {oas.filter((o) => !linkOf(`org:${o.id}`)).map((o) => <option key={String(o.id)} value={`org:${o.id}`}>{o.name}</option>)}
          </select>
        </label>
      </div>
      {pickCh && linkSelect(pickCh, V.linkChapter)}
      {pickOrg && linkSelect(pickOrg, V.linkOrg)}
    </section>
  );
}

const emptyBlock = { key: "", title: "", text: "", defaultOn: false, place: { __kind__: "end", end: null } as TextBlockPlace, order: 0n, archived: false };

export function TextBlocksAdmin() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["textBlocks", true], queryFn: () => actor!.listTextBlocks(true), enabled: !!actor && !isFetching });
  const [edit, setEdit] = useState<(typeof emptyBlock) | null>(null);
  const save = useMutation({
    mutationFn: async (b: typeof emptyBlock) => unwrap(await actor!.setTextBlock(b)),
    onSuccess: () => { toast.show({ kind: "ok", text: V.blockSaved }); setEdit(null); void qc.invalidateQueries({ queryKey: ["textBlocks"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const of = (b: TextBlockView) => ({ key: b.key, title: b.title, text: b.text, defaultOn: b.defaultOn, place: b.place, order: b.order, archived: b.archived });
  return (
    <section className="a-section a-form" style={{ maxWidth: 720 }} data-testid="text-blocks">
      <h2 className="bw-h2">{V.blocksTitle}</h2>
      <p className="bw-muted">{V.blocksLead}</p>
      <Loading q={list} />
      <table className="a-table">
        <tbody>
          {(list.data ?? []).map((b) => (
            <tr key={b.key} className={b.archived ? "bw-muted" : undefined}>
              <td><b>{b.title}</b> <span className="bw-muted q-small">({placeText(b.place)}{b.defaultOn ? ` · ${V.blockDefault.toLowerCase()}` : ""})</span>{b.archived && <> <span className="a-tag">{V.classArchived}</span></>}</td>
              <td><Button variant="quiet" icon="edit" onClick={() => setEdit(of(b))}>{V.blockEdit}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div><Button icon="plus" onClick={() => setEdit({ ...emptyBlock })}>{V.blockAdd}</Button></div>
      {edit && <BlockSheet b={edit} isNew={!(list.data ?? []).some((x) => x.key === edit.key)} busy={save.isPending} onSave={(b) => save.mutate(b)} onClose={() => setEdit(null)} />}
    </section>
  );
}

function BlockSheet({ b: b0, isNew, busy, onSave, onClose }: { b: typeof emptyBlock; isNew: boolean; busy: boolean; onSave: (b: typeof emptyBlock) => void; onClose: () => void }) {
  const [b, setB] = useState(b0);
  useEffect(() => setB(b0), [b0]);
  const up = (x: Partial<typeof emptyBlock>) => setB({ ...b, ...x });
  const place = b.place.__kind__;
  return (
    <Sheet title={b.title || V.blockAdd} open onClose={onClose} side wide>
      <div className="a-form">
        <div className="a-grid2">
          <label className="bw-field"><span className="bw-label">{V.blockKey}</span><input className="bw-input" disabled={!isNew} maxLength={40} value={b.key} onChange={(e) => up({ key: e.target.value.toLowerCase() })} /></label>
          <label className="bw-field"><span className="bw-label">{V.blockOrder}</span><input className="bw-input bw-num" inputMode="numeric" value={String(b.order)} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= 1000) up({ order: BigInt(n) }); }} /></label>
        </div>
        <label className="bw-field"><span className="bw-label">{V.blockTitle}</span><input className="bw-input" maxLength={160} value={b.title} onChange={(e) => up({ title: e.target.value })} /></label>
        <label className="bw-field"><span className="bw-label">{V.blockText}</span><textarea className="bw-input" rows={6} maxLength={4000} value={b.text} onChange={(e) => up({ text: e.target.value })} /></label>
        <Choice label={V.blockPlace} value={place} onChange={(k) => up({ place: k === "chapter" ? { __kind__: "chapter", chapter: "" } : k === "top" ? { __kind__: "top", top: null } : { __kind__: "end", end: null } })}
          options={[{ value: "top", label: V.places.top }, { value: "end", label: V.places.end }, { value: "chapter", label: V.places.chapter }]} />
        {b.place.__kind__ === "chapter" && <label className="bw-field"><span className="bw-label">{V.blockChapterCode}</span><input className="bw-input" maxLength={20} value={b.place.chapter} onChange={(e) => up({ place: { __kind__: "chapter", chapter: e.target.value } })} /></label>}
        <label className="a-check"><input type="checkbox" checked={b.defaultOn} onChange={(e) => up({ defaultOn: e.target.checked })} /> {V.blockDefault}</label>
        <label className="a-check"><input type="checkbox" checked={b.archived} onChange={(e) => up({ archived: e.target.checked })} /> {V.archive}</label>
        <div><Button variant="primary" busy={busy} onClick={() => onSave(b)}>{t.common.save}</Button></div>
      </div>
    </Sheet>
  );
}
