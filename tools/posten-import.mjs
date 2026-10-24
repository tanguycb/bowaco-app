// Stap 2.2: de posten uit tools/posten-analyse.py in de postenbibliotheek zetten (proefronde, dan --echt). Idempotent via
// de importsleutel ("2026/231:r58"): een tweede ronde maakt niets nieuw. Aankoopprijs en verkoopregel komen enkel bij een
// post die in DEZE ronde nieuw is (nooit dubbel). R32: enkel de admin.
//   node tools/posten-import.mjs --plan ~/.bowaco/posten/posten-2026-231.json --canister <cid> [--identity proef-admin] [--echt]
// ECHTE gegevens (bron "echt": aankoopprijzen, marges, klant) gaan ENKEL naar het eigen lokale net. Een draft of live
// krijgt ze pas na het uitdrukkelijke "ja" van de eigenaar (dan JA_EIGENAAR=1); tot dan enkel verzonnen testposten
// (tests/posten-draft.mjs).
import { readFileSync } from "node:fs";
import { backend, ok } from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const planPath = arg("--plan");
const cid = arg("--canister");
const who = arg("--identity", "proef-admin");
const echt = process.argv.includes("--echt");
if (!planPath || !cid) throw new Error("gebruik: node tools/posten-import.mjs --plan <posten.json> --canister <cid> [--identity proef-admin] [--echt]");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const host = process.env.ICP_HOST || "";
const local = host.includes("localhost") || host.includes("127.0.0.1");
if (plan.bron === "echt" && !local && process.env.JA_EIGENAAR !== "1") {
  throw new Error("Echte posten en prijzen enkel op het eigen lokale net (ICP_HOST=http://localhost:…). Een draft krijgt enkel testposten tot de eigenaar uitdrukkelijk ja zegt.");
}
const admin = await backend(who, cid);
const fold = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
const day = BigInt(Math.floor(Date.parse(plan.datum + "T00:00:00Z") / 86_400_000));

// Wat er al staat
const chapters = await admin.libraryChapters(true);
const existing = new Map();
for (let offset = 0n; ; offset += 200n) {
  const p = await admin.listLibrary({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: true, offset, limit: 200n });
  for (const it of p.items) if (it.importKey.length) existing.set(it.importKey[0], it.id);
  if (BigInt(p.items.length) < 200n) break;
}
const units = new Set((await admin.libraryUnits(true)).map((u) => u.key));
const prices = echt ? ok(await admin.readLibraryPrices([])) : null;
const std = prices ? prices.standardMarginBp : 2000n;

// Hoofdstukken: zelfde code + titel = hetzelfde hoofdstuk; de rest wordt nieuw (of zou nieuw worden in de proefronde).
const chapterId = new Map();
let chNew = 0;
for (const c of plan.chapters) {
  const hit = chapters.find((x) => x.code === c.code && fold(x.title) === fold(c.title));
  if (hit) chapterId.set(plan.chapters.indexOf(c), hit.id);
  else {
    chNew++;
    if (echt) chapterId.set(plan.chapters.indexOf(c), ok(await admin.saveLibraryChapter({ id: [], code: c.code, title: c.title, order: BigInt(c.order), note: `uit offerte ${plan.offerte} (VOORLOPIG tot 0.3)` })));
  }
}
const form = (f) => ({ [f]: null });
let made = 0, skipped = 0, costs = 0, rules = 0, unknownUnit = 0;
const errors = [];
for (const p of plan.posts) {
  if (existing.has(p.key)) { skipped++; continue; }
  if (!units.has(p.unit)) { unknownUnit++; errors.push(`r${p.row}: eenheid ${p.unit} niet in de lijst`); continue; }
  made++;
  if (!echt) continue;
  const r = await admin.saveLibraryItem({ id: [], chapterId: chapterId.get(p.chapter), code: "", title: p.title, text: p.text.slice(0, 4000), unit: p.unit, form: form(p.form), trade: [], orgId: [], durationDays: [], perDayMilli: [], planStepKey: [], keywords: [], importKey: [p.key] }, 0n);
  if ("err" in r) { errors.push(`r${p.row}: ${r.err}`); made--; continue; }
  const id = r.ok.id;
  if (p.costCents !== null) {
    ok(await admin.addLibraryCost(id, { orgId: [], day, costCents: BigInt(p.costCents), source: "offerte", ref: `offerte ${plan.offerte} r${p.row}`, note: p.why }));
    costs++;
  }
  // Verkoopregel: X/0.8 = de standaardmarge (20 %); anders een vaste verkoopprijs met de reden uit de offerte.
  const rule = p.price === "margin20" ? (std === 2000n ? null : { margin: 2000n }) : { price: BigInt(p.sellCents) };
  if (rule) {
    const why = p.price === "margin20" ? `20 % zoals in offerte ${plan.offerte}` : p.price === "composite" ? `samengesteld in offerte ${plan.offerte}: deel zonder marge` : `vaste verkoopprijs in offerte ${plan.offerte}`;
    ok(await admin.setLibrarySell(id, { rule: [rule], reason: why }, 0n));
    rules++;
  }
}
console.log(`${echt ? "ECHT BEWAARD" : "PROEFRONDE (niets bewaard)"} · offerte ${plan.offerte}`);
console.log(`hoofdstukken nieuw ${chNew} · posten nieuw ${made} · al aanwezig ${skipped} · aankoopprijzen ${costs} · verkoopregels ${rules} · onbekende eenheid ${unknownUnit}`);
for (const e of errors.slice(0, 20)) console.log("  ✗ " + e);
process.exit(errors.length ? 1 : 0);
