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
  });
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
  return last ?? { ok: null };
}

/** Totalen van het model in de vorm van QuoteTotalsView (om met de backend te vergelijken). */
export function totalsOf(m) {
  const t = M.totals(m);
  return { subtotal: t.subtotal, vat: t.vat, total: t.total, optionsPlus: t.optionsPlus, optionsMinus: t.optionsMinus, cost: t.cost, margin: t.margin, noPrice: t.noPrice };
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
