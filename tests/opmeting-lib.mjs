// Gemeenschappelijke opzet voor de proeven van de opmeting (stap 2.9): VERZONNEN proefposten in de bibliotheek, een eigen
// proefwerf met een proefofferte (7 posten, een tekstregel en een optie) en, naar keuze, het akkoord van kantoor. Nooit echte
// gegevens. Gebruikt door tests/opmeting-draft.mjs en tests/opmeting-opzet.mjs (de werf voor de proef in Chrome).
import { M, ensureProofClientAddress, fromRead, saveAll } from "./offerte-lib.mjs";

const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => (r && "err" in r ? r.err : "");

/** ctx = { admin, calc, wl }. Geeft de werf, de offerte en de lijnen terug. accept=false laat de offerte onaanvaard. */
export async function proefWerf({ admin, calc, wl }, { prefix = "P-OM", accept = true, titleSuffix = "" } = {}) {
  const familie = await ensureProofClientAddress(admin);
  const orgs = await admin.listOrgs(false);
  const dak = orgs.find((o) => o.name === "Proef Dak NV");
  const elek = orgs.find((o) => o.name === "Proef Elektro BV");
  const wlId = (await wl.me()).person[0].id;
  // ── Proefposten (verzonnen; idempotent via de importsleutel) en een aanvaarde proefofferte ──
  const chs = await calc.libraryChapters(false);
  if (chs.length === 0) ok(await calc.loadLibraryStartChapters());
  const ch0 = (await calc.libraryChapters(false))[0];
  const have = new Map();
  for (const it of (await calc.listLibrary({ text: "Proef", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: true, offset: 0n, limit: 200n })).items) if (it.importKey.length) have.set(it.importKey[0], it);
  const lib = async (key, x) => have.get(key) ?? ok(await calc.saveLibraryItem({ id: [], chapterId: ch0.id, code: x.code, title: x.title, text: "Verzonnen proefpost (draftproef 2.9).", unit: x.unit, form: { vh: null }, trade: x.trade ?? [], orgId: x.orgId ?? [], durationDays: x.days ?? [], perDayMilli: [], planStepKey: [], keywords: ["proef"], importKey: [key] }, 0n));
  const iAfbraak = await lib("proef-2.9:afbraak", { code: "P2.9-01", title: "Proef afbraak binnenmuren (2.9)", unit: "m2", trade: ["afbraak"], days: [4n] });
  const iDak = await lib("proef-2.9:dak", { code: "P2.9-02", title: "Proef dakgoot vervangen (2.9)", unit: "lm", trade: ["dak"], orgId: [dak.id], days: [2n] });
  const iElek = await lib("proef-2.9:elek", { code: "P2.9-03", title: "Proef stopcontacten (2.9)", unit: "st", trade: ["elektriciteit"], orgId: [elek.id], days: [3n] });

  const stamp = Date.now().toString(36).toUpperCase();
  const W = `${prefix}-${stamp}`;
  const addr = { street: "Proefstraat", number: "29", zip: "8670", city: "Koksijde", country: "BE" };
  const wid = ok(await admin.createWork({ code: W, name: `Proefwerf opmeting (2.9)${titleSuffix}`, address: addr, parentId: [], clientOrgId: [familie], architectOrgId: [], leaderPersonId: [wlId], vatBp: 2100n })).id;
  ok(await admin.setWorkStatus(wid, { quoting: null }));
  const price = (cost) => ({ cost, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null });
  const fromLib = (it) => ({ libItemId: it.id, libItemVersion: it.version });
  const NR = `OM-${stamp}`;
  const q1 = ok(await calc.createQuote({ workId: wid, number: NR, title: "Proef offerte opmeting (2.9)" }));
  const v1 = q1.versionId;
  {
    const m = fromRead(ok(await calc.readQuoteVersion(v1)));
    M.setHeader(m, { clientOrgId: familie });
    const c1 = M.addChapter(m, { code: "01", title: "Afbraak" });
    M.addLine(m, c1.key, { title: iAfbraak.title, qtyMilli: 40_000n, unit: "m2", form: "vh", price: price(2500n), ...fromLib(iAfbraak) });
    M.addLine(m, c1.key, { title: "Proef container 10 m³ puin", qtyMilli: 2_000n, unit: "st", form: "fixed", price: price(32_000n) });
    M.addLine(m, c1.key, { kind: "text", title: "Proef: tekstregel zonder hoeveelheid", unit: "" });
    const c2 = M.addChapter(m, { code: "02", title: "Dak" });
    M.addLine(m, c2.key, { title: iDak.title, qtyMilli: 12_000n, unit: "lm", form: "vh", price: price(4500n), ...fromLib(iDak) });
    M.addLine(m, c2.key, { title: "Proef minwerk bestaande goot", qtyMilli: -2_000n, unit: "lm", form: "vh", price: price(4500n) });
    const c3 = M.addChapter(m, { code: "03", title: "Elektriciteit" });
    M.addLine(m, c3.key, { title: iElek.title, qtyMilli: 24_000n, unit: "st", form: "vh", price: price(6000n), ...fromLib(iElek) });
    M.addLine(m, c3.key, { title: "Proef p.m. verlichting", qtyMilli: 0n, unit: "st", form: "vh", price: price(9000n) });
    M.addLine(m, c3.key, { kind: "option", title: "Proef optie buitenstopcontact", qtyMilli: 1_000n, unit: "st", form: "fixed", price: price(15_000n) });
    const c4 = M.addChapter(m, { code: "04", title: "Gevel" });
    M.addLine(m, c4.key, { title: "Proef gevelreiniging", qtyMilli: 80_000n, unit: "m2", form: "vh", price: price(2_000n) });
    const r = await saveAll(calc, m);
    if (r && "err" in r) throw new Error(errOf(r));
  }
  const rd = ok(await calc.readQuoteVersion(v1));
  const lid = (t) => rd.lines.find((l) => l.title === t).id;
  const L = { afbraak: lid(iAfbraak.title), container: lid("Proef container 10 m³ puin"), goot: lid(iDak.title), minwerk: lid("Proef minwerk bestaande goot"), stop: lid(iElek.title), pm: lid("Proef p.m. verlichting"), optie: lid("Proef optie buitenstopcontact"), gevel: lid("Proef gevelreiniging") };


  const acceptNow = async () => {
    const r = ok(await calc.readQuoteVersion(v1));
    ok(await calc.sendQuoteVersion(v1, r.version.rev, r.totals.totalCents, "proef: draftproef 2.9"));
    ok(await calc.decideQuoteVersion(v1, true, "proef: akkoord (draftproef 2.9)"));
  };
  if (accept) await acceptNow();
  return { familie, dak, elek, wlId, iAfbraak, iDak, iElek, stamp, W, wid, NR, v1, rd, L, acceptNow };
}
