// Hulp voor de offertetests (2.4/2.5): hetzelfde model en dezelfde rekenmodule als de browser
// (src/frontend/src/quote/model.ts en calc.ts, rechtstreeks door Node gedraaid), met de omzetting naar ruwe Candid.
import * as M from "../src/frontend/src/quote/model.ts";
import * as C from "../src/frontend/src/quote/calc.ts";

export { M, C };
export const opt = (v) => (v === null || v === undefined ? [] : [v]);
export const unopt = (a) => (Array.isArray(a) && a.length ? a[0] : null);
export const tag = (v) => Object.keys(v)[0];
const variant = (k) => ({ [k]: null });
const ruleIn = (r) => (r === null ? null : "margin" in r ? { margin: r.margin } : { price: r.price });
const ruleOut = (r) => (r === null ? [] : "margin" in r ? [{ margin: r.margin }] : [{ price: r.price }]);

/** Een QuoteRead (ruwe Candid, scope #full) → het model van de browser. */
export function fromRead(r) {
  const costs = new Map(r.costs.map((c) => [c.lineId, c]));
  const std = unopt(r.margins)?.standardMarginBp ?? 2000n;
  return M.load({
    versionId: r.version.id,
    rev: r.version.rev,
    header: { title: r.version.title, vatBp: r.version.vatBp, clientOrgId: unopt(r.version.clientOrgId), validDays: r.version.validDays, intro: r.version.intro, note: r.version.note, standardMarginBp: std },
    chapters: r.chapters.map((c) => ({ id: c.id, code: c.code, title: c.title, order: c.order, libChapterId: unopt(c.libChapterId) })),
    lines: r.lines.map((l) => {
      const c = costs.get(l.id);
      const price = c ? { cost: unopt(c.costCents), rule: ruleIn(unopt(c.rule)), reason: c.reason, orgId: unopt(c.orgId), source: c.source, libCostId: unopt(c.libCostId) } : M.emptyPrice();
      return { id: l.id, chapterId: l.chapterId, order: l.order, kind: tag(l.kind), code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unit: l.unit, form: tag(l.form), libItemId: unopt(l.libItemId), libItemVersion: unopt(l.libItemVersion), price };
    }),
    form: formIn(r),
  });
}

// 2c.1: korting en de vorm van een versie (ruwe Candid ↔ model).
export const discIn = (d) => (d === null || d === undefined ? null : "amount" in d ? { amount: d.amount } : { percent: d.percent });
export const discOut = (d) => (d === null ? [] : "amount" in d ? [{ amount: d.amount }] : [{ percent: d.percent }]);
function formIn(r) {
  const f = unopt(r.form ?? []);
  if (!f) return null;
  const tm = unopt(r.terms ?? []);
  const g = tm ? unopt(tm.regie) : null;
  const pick = (c) => ({ id: c.id, classId: unopt(c.classId), marginBp: c.marginBp, fixed: c.fixed });
  return {
    hideZeroLines: f.hideZeroLines,
    regieText: f.regieText,
    textBlockKeys: f.textBlockKeys,
    subgroups: f.subgroups.map((x) => ({ id: x.id, chapterId: x.chapterId, title: x.title, order: x.order })),
    lineForms: f.lineForms.map((x) => ({ lineId: x.lineId, subgroupId: unopt(x.subgroupId), showToClient: unopt(x.showToClient) })),
    chapterMargins: tm ? tm.chapterMargins.map(pick) : [],
    orgMargins: tm ? tm.orgMargins.map(pick) : [],
    links: tm ? tm.links.map((l) => ({ key: l.key, classId: l.classId, marginBp: l.marginBp })) : [],
    regie: g ? { orgId: unopt(g.orgId), cost: g.costCents, sell: g.sellCents } : null,
    discount: tm ? discIn(unopt(tm.discount)) : null,
    discountText: tm ? tm.discountText : "",
    live: r.version.editable,
  };
}

/** M.formSave → de argumenten van saveQuoteForm (ruwe Candid). */
export function formArgs(m, fs) {
  const i = fs.input;
  return [
    m.versionId,
    m.rev,
    {
      hideZeroLines: i.hideZeroLines, regieText: i.regieText, textBlockKeys: i.textBlockKeys,
      subgroupOps: i.subgroupOps.map((g) => ({ id: opt(g.id), ref: g.ref, chapterId: g.chapterId, title: g.title, order: g.order, remove: g.remove })),
      lineOps: i.lineOps.map((l) => ({ lineId: l.lineId, subgroup: l.subgroup === null ? [] : "id" in l.subgroup ? [{ id: l.subgroup.id }] : [{ ref: l.subgroup.ref }], showToClient: opt(l.showToClient) })),
      chapterMargins: i.chapterMargins.map((c) => ({ id: c.id, classId: opt(c.classId), marginBp: c.marginBp })),
      regie: i.regie ? [{ orgId: opt(i.regie.orgId), costCents: i.regie.costCents, sellCents: opt(i.regie.sellCents) }] : [],
      discount: discOut(i.discount),
      discountText: i.discountText,
    },
    { subtotalCents: fs.expect.subtotal, discountCents: fs.expect.discount, totalCents: fs.expect.total },
  ];
}

const refRaw = (r) => ("id" in r ? { id: r.id } : { ref: r.ref });

/** Een stuk uit M.nextBatch → de argumenten van saveQuoteDraft (ruwe Candid). */
export function batchArgs(m, b) {
  const h = b.header;
  return [
    m.versionId,
    m.rev,
    h ? [{ title: h.title, vatBp: h.vatBp, clientOrgId: opt(h.clientOrgId), validDays: h.validDays, intro: h.intro, note: h.note, standardMarginBp: h.standardMarginBp }] : [],
    b.chapterOps.map((c) => ({ id: opt(c.id), ref: c.ref, code: c.code, title: c.title, order: c.order, libChapterId: opt(c.libChapterId), remove: c.remove })),
    b.lineOps.map((l) => ({
      id: opt(l.id), ref: l.ref, chapter: refRaw(l.chapter), order: l.order, kind: variant(l.kind), code: l.code, title: l.title, text: l.text, specRef: l.specRef,
      qtyMilli: l.qtyMilli, unit: l.unit, form: variant(l.form), libItemId: opt(l.libItemId), libItemVersion: opt(l.libItemVersion),
      price: { costCents: opt(l.price.cost), rule: ruleOut(l.price.rule), reason: l.price.reason, orgId: opt(l.price.orgId), source: l.price.source, libCostId: opt(l.price.libCostId) },
      remove: l.remove,
    })),
    expectRaw(b.expect),
  ];
}

export function expectRaw(e) {
  return { subtotalCents: e.subtotal, vatCents: e.vat, totalCents: e.total, optionsPlusCents: e.optionsPlus, optionsMinusCents: e.optionsMinus, costCents: e.cost, marginCents: e.margin, chapters: e.chapters.map((c) => ({ chapter: refRaw(c.chapter), sellCents: c.sell })) };
}

/** Alles bewaren in stukken zoals de browser; geeft het laatste antwoord (of de fout) terug. */
export async function saveAll(actor, m, max = M.MAX_OPS) {
  let last = null;
  for (let b = M.nextBatch(m, max); b; b = M.nextBatch(m, max)) {
    const r = await actor.saveQuoteDraft(...batchArgs(m, b));
    if ("err" in r) return r;
    M.applySaved(m, b, r.ok.rev, r.ok.refs);
    last = r;
  }
  // 2c.1: daarna de vorm (zoals de editor).
  const fs = M.formSave(m);
  if (fs) {
    const r = await actor.saveQuoteForm(...formArgs(m, fs));
    if ("err" in r) return r;
    M.applyFormSaved(m, r.ok.rev, r.ok.refs);
    last = r;
  }
  return last ?? { ok: null };
}

/** Totalen van het model in de vorm van QuoteTotalsView (om met de backend te vergelijken). */
export function totalsOf(m) {
  const t = M.totals(m);
  return { gross: t.gross, discount: t.discount, subtotal: t.subtotal, vat: t.vat, total: t.total, optionsPlus: t.optionsPlus, optionsMinus: t.optionsMinus, cost: t.cost, margin: t.margin, noPrice: t.noPrice };
}

export function sameTotals(m, view, margins) {
  const t = totalsOf(m);
  return view.subtotalCents === t.subtotal && view.vatCents === t.vat && view.totalCents === t.total && view.optionsPlusCents === t.optionsPlus && view.optionsMinusCents === t.optionsMinus && BigInt(view.noPrice) === BigInt(t.noPrice) && (!margins || (margins.costCents === t.cost && margins.marginCents === t.margin));
}

export const euro = (c) => (Number(c) / 100).toLocaleString("nl-BE", { style: "currency", currency: "EUR" });

/** 2.6: een offerte wordt niet verstuurd naar een klant zonder volledig adres. Geeft de proefklant "Familie Proef" een
 *  (verzonnen) adres als hij er geen heeft (idempotent; op een draft die vóór 2.6 opgebouwd werd). */
export async function ensureProofClientAddress(admin) {
  const o = (await admin.listOrgs(true)).find((x) => x.name === "Familie Proef");
  if (!o) return null;
  if (o.address.length === 1 && o.address[0].street && o.address[0].zip && o.address[0].city) return o.id;
  const r = await admin.updateOrg(o.id, { kind: o.kind, name: o.name, kbo: o.kbo, vat: o.vat, aliases: o.aliases, trades: o.trades, address: [{ street: "Proefstraat", number: "1", zip: "8670", city: "Koksijde", country: "BE" }], notes: o.notes });
  if ("err" in r) throw new Error(r.err);
  return o.id;
}
