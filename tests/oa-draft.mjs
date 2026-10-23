// Onderaannemers-database (1.2) op een canister die al in gebruik is (een draft): de volledige rollentest
// vraagt een LEGE canister, deze proef niet. Gebruikt de testidentiteiten van tests/rollen.mjs en laat
// uitsluitend verzonnen testdata achter (namen die met "Test" beginnen, tests/oa-testdata.csv): op een draft
// komen NOOIT echte firma- of persoonsnamen. Draait ook tools/oa-import.mjs (proef, echt, en nog eens).
//   node tests/oa-draft.mjs <canister-id>
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/oa-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && "err" in r ? r.err : "");
const opt = (v) => (v === undefined ? [] : [v]);
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const f = (o = {}) => ({ text: opt(o.text), trade: opt(o.trade), kind: opt(o.kind ? { [o.kind]: null } : undefined), includeArchived: false });
const me = await admin.me();
check("versie 1.2 of later op de canister", /^1\.[23]/.test(me.version), me.version);

// Rechten
const trd = await admin.listTrades(false);
check("vakgebieden: standaardlijst aanwezig (≥ 21)", trd.length >= 21, `${trd.length}`);
check("werfleider en calculator lezen de database", (await wl.listOas(f())).length >= 0 && (await calc.listOas(f())).length >= 0);
check("OA, architect, klant, veiligheid en anoniem lezen de database niet", (await Promise.all([oa2, arch, klant, vc, anon].map((x) => rejects(x.listOas(f()))))).every(Boolean));
check("OA, architect, klant, veiligheid lezen de vakgebieden niet", (await Promise.all([oa2, arch, klant, vc].map((x) => rejects(x.listTrades(false))))).every(Boolean));
check("werfleider, calculator, OA, klant kunnen niet importeren", (await Promise.all([wl, calc, oa2, klant].map((x) => rejects(x.importOrgs(true, []))))).every(Boolean));
check("calculator en OA kunnen geen contact bewaren", (await Promise.all([calc, oa2].map((x) => rejects(x.saveOrgContact(1n, { phone: [], email: [], website: [], contactNote: "" }))))).every(Boolean));

// Firma + contact + persoon door de werfleider
const naam = `Test Draftfirma ${Date.now() % 100000} BV`;
const o = await wl.createOrg({ kind: { subcontractor: null }, name: naam, kbo: [], vat: [], aliases: [], trades: ["tegels"], address: [], notes: "" });
check("werfleider maakt een testfirma met vakgebied", isOk(o), errOf(o));
const id = o.ok.id;
check("werfleider bewaart contact van de testfirma", isOk(await wl.saveOrgContact(id, { phone: ["0470 99 99 99"], email: ["test@draftfirma.example"], website: [], contactNote: "testdata" })));
const p = await wl.saveOaPerson(id, { id: [], name: "Test Contactpersoon", shortCode: [], phone: [], email: ["persoon@draftfirma.example"], jobTitle: "testfunctie", note: "" });
check("werfleider maakt een contactpersoon (geen login)", isOk(p) && !p.ok.hasLogin, errOf(p));
const found = await calc.listOas(f({ text: "draftfirma" }));
check("zoeken vindt de firma met contact en persoon", found.length >= 1 && found.some((v) => v.org.id === id && v.persons.length === 1 && v.contact.length === 1));
check("filter op vakgebied vindt de firma", (await admin.listOas(f({ trade: "tegels" }))).some((v) => v.org.id === id));

// Import-script (proef, echt, nog eens): verzonnen CSV
const csv = join(import.meta.dirname, "oa-testdata.csv");
const run = (extra) => { try { return execFileSync("node", [join(import.meta.dirname, "../tools/oa-import.mjs"), "--csv", csv, "--canister", cid, "--identity", "proef-admin", ...extra], { encoding: "utf8", env: process.env }); } catch (e) { return `EXIT ${e.status}\n${e.stdout}`; } };
const before = (await admin.exportIntern()).orgs.length;
const r1 = run([]);
check("import-script, proefronde: niets bewaard", r1.includes("PROEFRONDE") && (await admin.exportIntern()).orgs.length === before, r1.split("\n").find((l) => l.startsWith("nieuw")));
const r2 = run(["--echt"]);
const after = (await admin.exportIntern()).orgs.length;
const firstRun = /nieuw (\d+)/.exec(r2)?.[1];
// Een tweede run op dezelfde canister vindt alles al terug ("ongewijzigd"): ook goed (idempotent).
check("import-script, echt: firma's erbij (of al aanwezig bij een tweede run)", r2.includes("ECHT BEWAARD") && (after > before || (/nieuw 0 /.test(r2) && /conflicten 0/.test(r2))), `${before} → ${after}; ${r2.split("\n").find((l) => l.startsWith("nieuw"))}`);
const r3 = run(["--echt"]);
check("import-script, nog eens: niets nieuw, niets aangevuld (idempotent)", /nieuw 0 · aangevuld 0 · ongewijzigd \d+/.test(r3) && (await admin.exportIntern()).orgs.length === after, r3.split("\n").find((l) => l.startsWith("nieuw")));
const elek = await admin.listOas(f({ text: "TESTELEK2" }));
check("'dezelfde firma als' werd een alias van de firma", elek.length === 1 && elek[0].org.aliases.includes("TESTELEK2") && elek[0].org.aliases.includes("TESTELEK") && elek[0].org.trades.includes("elektriciteit"));
check("persoon van een firma staat bij die firma, zonder login", (await admin.listOas(f({ text: "Jan Test" }))).some((v) => v.org.name === "Testfirma Dak NV" && v.persons.some((x) => x.name === "Jan Test" && !x.hasLogin)));
check("leverancier en nutsbedrijf hebben de juiste soort", (await admin.listOas(f({ kind: "supplier" }))).some((v) => v.org.name === "Test Leverancier BV") && (await admin.listOas(f({ kind: "authority" }))).some((v) => v.org.name === "Test Nutsbedrijf"));
check("genegeerde en onbeslischte rijen zijn niet geïmporteerd", (await admin.listOas(f({ text: "TESTSYS" }))).length === 0 && (await admin.listOas(f({ text: "TESTLEEG" }))).length === 0);
const log = await admin.auditLog(0n, 100n);
check("auditlog: import gelogd, zonder testmailadressen", log.some((e) => e.action === "import-organisaties") && !log.some((e) => e.detail.includes("@")));

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
