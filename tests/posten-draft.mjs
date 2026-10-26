// Postenbibliotheek (2.2) op een canister die al in gebruik is (een draft). Zet enkel VERZONNEN testposten en testprijzen
// ("Proef …", importsleutel "proef-2.2:…"; standaard-OA enkel een proeffirma, nooit een van de echte firma's van E-0). De
// echte posten en prijzen uit offerte 2026/231 komen pas op een draft na het uitdrukkelijke "ja" van de eigenaar.
// Bewijst vooral dat aankoopprijzen en marges NOOIT naar werfleider, OA, architect, klant of veiligheidscoördinator gaan.
// Laat achter: de startlijst van de hoofdstukken (als die er nog niet was) en drie proefposten met hun proefprijzen.
// Opnieuw draaien mag (idempotent via de importsleutel; een prijs komt er enkel bij een nieuwe post bij).
//   node tests/posten-draft.mjs <canister-id>
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/posten-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => (r && "err" in r ? r.err : "");
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
// Enkel de teksten (geen tijdstippen of ids: daar kan elk cijferreeksje in staan).
const texts = (x) => JSON.stringify(x, (k, v) => (typeof v === "bigint" ? "" : v));
const today = BigInt(Math.floor(Date.now() / 86_400_000));
const filter = (f = {}) => ({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 50n, ...f });

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const me = await admin.me();
check("versie 2.2 of later op de canister", /^2\.([2-9]|1\d)|^(2b|[3-9])\./.test(me.version), me.version);

// Hoofdstukken: de voorlopige startlijst (19, uit offerte 2026/231 zonder werfgegevens) als er nog geen zijn.
let chs = await calc.libraryChapters(false);
if (chs.length === 0) {
  const l = await calc.loadLibraryStartChapters();
  check("startlijst geladen door de calculator (19 hoofdstukken)", isOk(l) && l.ok === 19n, errOf(l));
  chs = await calc.libraryChapters(false);
}
check("hoofdstukken: werfleider leest ze, OA, architect, klant en VC niet", (await wl.libraryChapters(false)).length === chs.length && (await Promise.all([oa2, arch, klant, vc].map((x) => rejects(x.libraryChapters(false))))).every(Boolean));
const ch = (t) => chs.find((c) => c.title.includes(t)) ?? chs[0];

// Een proeffirma als standaard-OA (nooit een van de echte firma's).
const orgs = await admin.listOrgs(false);
const dak = orgs.find((o) => o.name === "Proef Dak NV" && "subcontractor" in o.kind);
check("proeffirma Proef Dak NV gevonden (geen echte firma)", !!dak);

const posts = [
  { key: "proef-2.2:goot", chapter: ch("Dakwerken"), code: "P7.01", title: "Proef dakgoot in zink", text: "Verzonnen testpost (draftproef 2.2).\nLeveren en plaatsen van een zinken dakgoot.", unit: "lm", form: { vh: null }, trade: ["dak"], orgId: dak ? [dak.id] : [], durationDays: [2n], cost: 4500n, org: dak ? [dak.id] : [], rule: null },
  { key: "proef-2.2:chape", chapter: ch("Chape"), code: "P10.3.01", title: "Proef chape 6 cm", text: "Verzonnen testpost (draftproef 2.2).", unit: "m2", form: { fixed: null }, trade: ["chape"], orgId: [], durationDays: [], perDay: [80_000n], cost: 1800n, org: [], rule: { margin: 2500n }, why: "proef: kleine oppervlakte" },
  { key: "proef-2.2:werfinrichting", chapter: ch("Werfinrichting"), code: "P1.01", title: "Proef werfinrichting", text: "Verzonnen testpost (draftproef 2.2): signalisatie, klein materiaal.", unit: "sog", form: { fixed: null }, trade: [], orgId: [], durationDays: [1n], cost: null, org: [], rule: { price: 90_000n }, why: "proef: eigen prestatie" },
];
const existing = new Map();
for (const it of (await calc.listLibrary(filter({ text: "Proef", includeArchived: true, limit: 200n }))).items) if (it.importKey.length) existing.set(it.importKey[0], it);
const ids = {};
for (const p of posts) {
  let it = existing.get(p.key);
  if (!it) {
    const r = await calc.saveLibraryItem({ id: [], chapterId: p.chapter.id, code: p.code, title: p.title, text: p.text, unit: p.unit, form: p.form, trade: p.trade, orgId: p.orgId, durationDays: p.durationDays, perDayMilli: p.perDay ?? [], planStepKey: [], keywords: ["proef"], importKey: [p.key] }, 0n);
    check(`proefpost «${p.title}» gemaakt`, isOk(r), errOf(r));
    it = r.ok;
    if (p.cost !== null) check(`  proefprijs ${Number(p.cost) / 100} €/${p.unit}`, isOk(await calc.addLibraryCost(it.id, { orgId: p.org, day: today - 7n, costCents: p.cost, source: p.org.length ? "oa-offerte" : "eigen", ref: "PROEF", note: "verzonnen" })));
    if (p.rule) check(`  verkoopregel ${"margin" in p.rule ? "eigen marge" : "vaste prijs"}`, isOk(await calc.setLibrarySell(it.id, { rule: [p.rule], reason: p.why }, 0n)));
  } else {
    console.log(`· proefpost «${p.title}» bestond al (#${it.id})`);
  }
  ids[p.key] = it.id;
}
const all = Object.values(ids);

// Zoeken, filteren, versies (intern)
check("werfleider vindt de proefposten (zoeken 'proef zink')", (await wl.listLibrary(filter({ text: "proef zink" }))).items.some((x) => x.id === ids["proef-2.2:goot"]));
check("filter op contractvorm VH", (await wl.listLibrary(filter({ text: "proef", form: [{ vh: null }] }))).items.every((x) => "vh" in x.form));
const v = await calc.saveLibraryItem({ id: [ids["proef-2.2:chape"]], chapterId: ch("Chape").id, code: "P10.3.01", title: "Proef chape 6 cm", text: `Verzonnen testpost (draftproef 2.2). Versie van ${new Date().toISOString().slice(0, 10)}.`, unit: "m2", form: { fixed: null }, trade: ["chape"], orgId: [], durationDays: [], perDayMilli: [80_000n], planStepKey: [], keywords: ["proef"], importKey: ["proef-2.2:chape"] }, (await calc.getLibraryItem(ids["proef-2.2:chape"])).ok.version);
check("nieuwe versie van een proefpost", isOk(v), errOf(v));
const h = await wl.libraryItemHistory(ids["proef-2.2:chape"]);
check("werfleider ziet de versies (≥ 2)", isOk(h) && h.ok.length >= 2);

// Prijzen: calculator en admin wel
const pr = await calc.readLibraryPrices(all);
const pv = (k) => pr.ok?.prices.find((x) => x.itemId === ids[k]);
check("calculator: geldende prijs + 20 % = verkoop (goot 45,00 → 56,25)", pv("proef-2.2:goot")?.sellCents[0] === 5625n && pv("proef-2.2:goot").deviates === false, JSON.stringify(pv("proef-2.2:goot")?.sellCents, big));
check("calculator: eigen marge 25 % gemarkeerd (chape 18,00 → 24,00)", pv("proef-2.2:chape")?.sellCents[0] === 2400n && pv("proef-2.2:chape").deviates === true);
check("calculator: vaste prijs zonder aankoopprijs (werfinrichting € 900)", pv("proef-2.2:werfinrichting")?.sellCents[0] === 90_000n && pv("proef-2.2:werfinrichting").cost.length === 0);
check("admin leest de prijshistoriek", isOk(await admin.readLibraryPriceHistory(ids["proef-2.2:goot"])));

// Prijzen: NOOIT voor werfleider, OA, architect, klant of veiligheidscoördinator
const goot = ids["proef-2.2:goot"];
for (const [n, x] of [["werfleider", wl], ["OA", oa2], ["architect", arch], ["klant", klant], ["veiligheidscoördinator", vc]]) {
  const rs = await Promise.all([x.readLibraryPrices([goot]), x.readLibraryPriceHistory(goot), x.addLibraryCost(goot, { orgId: [], day: today, costCents: 1n, source: "eigen", ref: "", note: "" }), x.setLibrarySell(goot, { rule: [], reason: "" }, 0n), x.setLibraryMargin(2000n), x.exportConfidential(), x.exportChunk("libCosts", 0n, 1n)].map(denied));
  check(`${n}: geen enkele prijsfunctie (7 oproepen geweigerd)`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
}
const wlView = await wl.listLibrary(filter({ text: "proef" }));
check("werfleider: de posten zonder prijs of marge (geen 45,00 / 5625 / 25 %)", wlView.items.length >= 3 && !/45,00|56,25|24,00|18,00|900|cost|sell|marg/i.test(texts(wlView)) && !Object.keys(wlView.items[0]).some((k) => /cost|sell|marg|price/i.test(k)));
check("caps: werfleider ziet geen prijskolommen, de calculator wel", !(await wl.me()).caps[0].libraryPrices && (await calc.me()).caps[0].libraryPrices);
check("OA, architect, klant en VC: geen bibliotheek", (await Promise.all([oa2, arch, klant, vc].map((x) => rejects(x.listLibrary(filter()))))).every(Boolean));

// Auditlog
const log = await admin.auditLog(0n, 200n);
check("auditlog: 'bekeek:prijzen' door de calculator, zonder bedrag", log.some((e) => e.action === "bekeek:prijzen") && !log.filter((e) => /prijs|verkoopregel/.test(e.action)).some((e) => /4500|45,00|5625|2500|Proef Dak/.test(e.detail)));
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
