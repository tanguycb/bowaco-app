// Gemeenschappelijke opzet voor de proeven van de vorderingsstaten (stap 2.10): een eigen proefwerf "P-VS-…" met een aanvaarde
// proefofferte (VH, vaste prijs, minwerk, regie), de werfstart (taken uit de posten, getekende versie in het contract), een
// proefcontract (inhouding 5 %, prijsherzieningsformule, 30 dagen) en het rekenmodel van de prijsherziening. Nooit echte
// gegevens. Gebruikt door tests/vordering-draft.mjs, tests/vordering-rekentest.mjs en tests/vordering-opzet.mjs (Chrome).
import { M, ensureProofClientAddress, fromRead, saveAll, opt, unopt } from "./offerte-lib.mjs";
import * as PM from "../src/frontend/src/progress/model.ts";

const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => (r && "err" in r ? r.err : "");
export { PM };

/** ctx = { admin, calc, wl }. */
export async function proefVordering({ admin, calc, wl }, { prefix = "P-VS", titleSuffix = "", contract = true, model = true } = {}) {
  const familie = await ensureProofClientAddress(admin);
  const orgs = await admin.listOrgs(false);
  const dak = orgs.find((o) => o.name === "Proef Dak NV");
  const wlId = (await wl.me()).person[0].id;
  const stamp = Date.now().toString(36).toUpperCase();
  const W = `${prefix}-${stamp}`;
  const addr = { street: "Proefstraat", number: "210", zip: "8670", city: "Koksijde", country: "BE" };
  const wid = ok(await admin.createWork({ code: W, name: `Proefwerf vorderingsstaat (2.10)${titleSuffix}`, address: addr, parentId: [], clientOrgId: [familie], architectOrgId: [], leaderPersonId: [wlId], vatBp: 2100n })).id;
  ok(await admin.setWorkStatus(wid, { quoting: null }));
  const price = (cost) => ({ cost, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null });
  const NR = `VS-${stamp}`;
  const q1 = ok(await calc.createQuote({ workId: wid, number: NR, title: "Proef offerte vorderingsstaat (2.10)" }));
  const v1 = q1.versionId;
  {
    const m = fromRead(ok(await calc.readQuoteVersion(v1)));
    M.setHeader(m, { clientOrgId: familie });
    const c1 = M.addChapter(m, { code: "01", title: "Afbraak" });
    M.addLine(m, c1.key, { title: "Proef afbraak vloeren (2.10)", qtyMilli: 40_000n, unit: "m2", form: "vh", price: price(2500n) });
    M.addLine(m, c1.key, { title: "Proef container (2.10)", qtyMilli: 2_000n, unit: "st", form: "fixed", price: price(32_000n) });
    const c2 = M.addChapter(m, { code: "02", title: "Ruwbouw" });
    M.addLine(m, c2.key, { title: "Proef metselwerk binnenmuur (2.10)", qtyMilli: 1_000n, unit: "sog", form: "fixed", price: price(800_000n) });
    M.addLine(m, c2.key, { title: "Proef minwerk bestaande muur (2.10)", qtyMilli: -2_000n, unit: "m2", form: "vh", price: price(4500n) });
    const c3 = M.addChapter(m, { code: "03", title: "Regie" });
    M.addLine(m, c3.key, { title: "Proef regie werfploeg (2.10)", qtyMilli: 40_000n, unit: "u", form: "regie", price: { ...price(4000n), orgId: dak.id } });
    const r = await saveAll(calc, m);
    if (r && "err" in r) throw new Error(errOf(r));
  }
  const rd = ok(await calc.readQuoteVersion(v1));
  ok(await calc.sendQuoteVersion(v1, rd.version.rev, rd.totals.totalCents, "proef: draftproef 2.10"));
  ok(await calc.decideQuoteVersion(v1, true, "proef: akkoord (draftproef 2.10)"));
  const lid = (t) => rd.lines.find((l) => l.title === t).id;
  const L = { afbraak: lid("Proef afbraak vloeren (2.10)"), container: lid("Proef container (2.10)"), metsel: lid("Proef metselwerk binnenmuur (2.10)"), minwerk: lid("Proef minwerk bestaande muur (2.10)"), regie: lid("Proef regie werfploeg (2.10)") };
  // Werfstart (2.8): de taken uit de posten (de regiepost krijgt een taak) en de getekende versie in het contract.
  const base = { target: { existing: null }, startDay: 0n, templateKey: "", leaderPersonId: [], lineSteps: [], options: [], groupDays: [], skipPermits: [], declaration: false };
  const today = BigInt(Math.floor(Date.now() / 86_400_000));
  let start = today;
  while ((Number(start) + 3) % 7 > 4) start += 1n;
  const pv = ok(await wl.workStartPreview(v1, { ...base, startDay: start }));
  ok(await wl.startWorkFromQuote(v1, { ...base, startDay: start }, pv.planVersion));
  const plan = await wl.getPlan(wid);
  const regieTask = plan.tasks.find((t) => t.quoteLineIds.some((x) => x === L.regie));
  if (contract) {
    const cur = ok(await calc.readContract(wid));
    const k = { estimatedAmountCents: opt(1_500_000n), priceRevision: { formula: "p = P × (0,4 s/S + 0,4 i/I + 0,2)" }, guarantee: { retention: null }, guaranteeBp: 500n, paymentTermDays: 30n, invoicingRhythm: { perProgress: null }, signedQuoteVersionId: [], note: "proef 2.10" };
    ok(await calc.setContract(wid, { contract: k, clientContact: [], notes: "Proef" }, cur.version));
  }
  if (model) ok(await calc.saveProgressRevision(wid, { aBp: 4000n, bBp: 4000n, cBp: 2000n, sBase: 100_000n, iBase: 200_000n, sLabel: "Proef loonindex", iLabel: "Proef materiaalindex", note: "verzonnen" }));
  return { familie, dak, wlId, stamp, W, wid, NR, q1, v1, rd, L, regieTask, start };
}

/** De totalen zoals de browser ze rekent (zelfde model als het scherm), met wijzigingen per post (root → Edit). */
export function browserTotals(view, edits = new Map(), idx = {}) {
  const lines = PM.linesOf(view);
  const h = PM.headerOf(view);
  const s = "sIndex" in idx ? idx.sIndex : h.sIndex;
  const i = "iIndex" in idx ? idx.iIndex : h.iIndex;
  return PM.totals(lines, edits, h, s, i);
}

/** De bewaaropdrachten in de vorm van de ruwe agent. */
export function rawOps(view, edits) {
  return PM.opsOf(PM.linesOf(view), edits).map((o) => ({ root: o.root, cumPctBp: opt(o.cumPctBp), cumQtyMilli: opt(o.cumQtyMilli), note: o.note, clear: o.clear }));
}

/** Bewaren als calculator of beheerder: de browser rekent de totalen mee (of `expect` om een fout totaal te proberen). */
export async function saveAs(actor, id, edits = new Map(), extra = {}) {
  const view = ok(await actor.readProgressStatement(id));
  const setIdx = "sIndex" in extra || "iIndex" in extra;
  const idx = setIdx ? { sIndex: extra.sIndex ?? null, iIndex: extra.iIndex ?? null } : {};
  const t = browserTotals(view, edits, idx);
  const r = await actor.saveProgressDraft(id, view.brief.rev, {
    periodTo: opt(extra.periodTo ?? null),
    note: opt(extra.note ?? null),
    setIndexes: setIdx,
    sIndex: opt(extra.sIndex ?? null),
    iIndex: opt(extra.iIndex ?? null),
    lines: rawOps(view, edits),
    expect: [extra.expect ?? PM.expectOf(t)],
  });
  return { r, t, view };
}

/** Bewaren als werfleider: enkel hoeveelheden en %, zonder totalen (hij ziet geen bedragen). */
export async function prepareAs(actor, id, ops, extra = {}) {
  const v = await actor.progressQty(id);
  return actor.saveProgressDraft(id, v.brief.rev, { periodTo: opt(extra.periodTo ?? null), note: [], setIndexes: false, sIndex: [], iIndex: [], lines: ops, expect: [] });
}

export { ok, errOf, opt, unopt };
