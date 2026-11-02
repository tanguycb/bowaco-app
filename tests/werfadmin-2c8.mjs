// Werfadministratie en oplevering (stap 2c.8, ontwerp 2c §4.8, §8 R45–R46, §10; AC-7, AC-25) op een canister die al in gebruik is
// (het eigen net, na tests/rollen.mjs). Bewijst:
//   (A) het opleveringsdocument (PDF) zonder bedragen, met een vaste controlecode (zonder netwerk);
//   (1) de aangiftedag = start + 15 dagen (ook als de start schuift), meldingen 5 dagen vooraf en op de dag, telkens één keer;
//   (2) de premie (‰ van de werfwaarde, met minimum, afronding), werfwaarde en premie enkel voor kantoor, met auditregel;
//   (3) het attest: de klant ziet enkel het gedeelde attest van zijn eigen werf;
//   (4) werfvergadering: nummering per werf, actiepunten zijn taken die de OA in Mijn week ziet (nooit de klantnaam);
//   (5) oplevering: restpunten per OA als taken, afronden onder een controlecode, delen met de klant, definitief;
//   (6) technische fiches (bibliotheek, per werf voor het PID), werfcode P.nnn zonder gaten, vaste documentsoorten;
//   (7) .did zonder bedragen buiten de premie; export; audit.
// Enkel VERZONNEN gegevens: firma's "Proef … 2c8", gemeente Hoeveldam, postcode 9994.
//   node tests/werfadmin-2c8.mjs <canister-id>
import { createRequire } from "node:module";
import { join } from "node:path";
import { backend, freshBackend } from "../tools/lib.mjs";
import { handoverPdf, handoverCode, handoverText } from "../src/frontend/src/pdf/oplevering.ts";
import { insuranceSheetPdf, insuranceSheetRows } from "../src/frontend/src/pdf/verzekering.ts";
import { fonts } from "./pdf-voorbeeld.mjs";

const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const un = (a) => (Array.isArray(a) && a.length ? a[0] : null);
const keysOf = (x, out = new Set()) => { if (Array.isArray(x)) x.forEach((y) => keysOf(y, out)); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.add(k); keysOf(v, out); } return out; };
const MONEY = /cents|price|margin|amount|euro|total|premium|rateMilli/i;
const noMoney = (x) => ![...keysOf(x)].some((k) => MONEY.test(k));
const fakeBlob = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64));

// ── A. Het opleveringsdocument (zonder netwerk) ─────────────────────────
const DOC = { kind: "provisional", workCode: "P.900", workName: "Proefwerf Hoeveldam", address: "Proefweg 8, 9994 Hoeveldam", client: "Proef Klant Merel 2c8", architect: "Proef Architect Uil 2c8", day: "12.11.2026", dayNum: 20_400, attendees: ["Proef Rita", "Proef Jan (Reiger)"], points: Array.from({ length: 40 }, (_, i) => ({ title: i === 3 ? "y".repeat(300) : `Restpunt ${i + 1}: schilderwerk bijwerken`, who: "onderaannemer schrijnwerk", due: "30.11.2026", dueNum: 20_418, done: i % 5 === 0 })), docNote: "Verzonnen opmerking op het document. ".repeat(20), madeOn: "12.11.2026" };
{
  const { PDFDocument } = createRequire(join(import.meta.dirname, "../src/frontend/package.json"))("pdf-lib");
  const code = await handoverCode(DOC);
  const bytes = await handoverPdf(DOC, fonts(), code);
  const d = await PDFDocument.load(bytes);
  check("(A1) opleveringsdocument: 40 restpunten en een lange regel over meerdere bladzijden, geldig PDF", d.getPageCount() >= 2 && bytes.length > 5_000, `${d.getPageCount()} blz.`);
  const short = await PDFDocument.load(await handoverPdf({ ...DOC, points: [], attendees: [], docNote: "" }, fonts(), code));
  check("(A2) zonder restpunten: één bladzijde", short.getPageCount() === 1);
  check("(A3) de controlecode is vast: dezelfde gegevens = dezelfde code (64 hex), een ander restpunt = een andere code", code === (await handoverCode({ ...DOC })) && /^[0-9a-f]{64}$/.test(code) && code !== (await handoverCode({ ...DOC, points: DOC.points.slice(1) })));
  check("(A4) de vaste tekst bevat geen bedrag (geen euroteken, geen cents, geen tarief)", !/€|cent|tarief|prijs|marge/i.test(handoverText(DOC)));
  const SHEET = { kindName: "Sub-polis abonnement RC10", policyRef: "POL-2c8", insurer: "Proef Verzekeraar Valk", broker: "Proef Makelaar Zwaluw", period: "01.01.2026 – 31.12.2026", workCode: "P.900", workName: "Proefwerf Hoeveldam", address: "Proefweg 8, 9994 Hoeveldam", client: "Proef Klant Merel", architect: "Proef Architect Uil", start: "01.03.2026", end: "30.09.2026", workValue: "€ 100.000,00", vat: "6 %", madeOn: "12.11.2026" };
  const sheet = await PDFDocument.load(await insuranceSheetPdf(SHEET, fonts()));
  check("(A5) makelaar-PDF 'Gegevens voor de verzekering': werf, adres, werfwaarde, periode, soort, polis, verzekeraar, makelaar; geldig PDF, geen OA-prijzen", sheet.getPageCount() === 1 && insuranceSheetRows(SHEET).length === 13 && insuranceSheetRows(SHEET).some(([l]) => l === "Werfwaarde (excl. btw)") && !insuranceSheetRows(SHEET).some(([l, v]) => /OA|onderaannemer|aankoop|marge/i.test(l + v)));
}

if (!cid) {
  console.log(`\n${pass} ✓  ${fail} ✗  (enkel A; geef een canister voor B)`);
  process.exit(fail ? 1 : 0);
}

// ── B. Door de backend ──────────────────────────────────────────────────
const [admin, calc, wl, arch, klant, vc] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-architect", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const oaR = await freshBackend(cid);
const oaM = await freshBackend(cid);
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
// De dag van de canister (Belgische kalenderdag, zoals de uurlijkse ronde): de rollentest verzet de netklok, dus nooit de dag van de browser.
const nowNs = BigInt((await admin.auditLog(0n, 1n))[0].at);
const brussels = (ms) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); return BigInt(Math.floor(Date.parse(p + "T00:00:00Z") / 86_400_000)); };
const today = brussels(Number(nowNs / 1_000_000n));
const wd = (d) => (Number(d) + 3) % 7;
const nextWd = (d) => { let x = BigInt(d); while (wd(x) > 4) x++; return x; };
const s0 = await admin.getSettings();
const setIn = (z) => ({ werfleiderZietAlles: z, inviteDays: s0.inviteDays, threshold30bisCents: s0.threshold30bisCents, thresholdCheckinatworkCents: s0.thresholdCheckinatworkCents });
const st0 = await admin.siteAdminSettings();
ok(await admin.setSettings(setIn(false)));
try {

// B0. Opzet: verzekeraar, makelaar, twee OA-firma's met login, een klant, twee werven (W1 met de werfleider, W2 zonder).
const addr = { street: "Proefweg", number: "8", zip: "9994", city: "Hoeveldam", country: "BE" };
const orgOf = async (name, kind = "subcontractor") => ok(await admin.createOrg({ kind: { [kind]: null }, name, kbo: [], vat: [], aliases: [], trades: [], address: [addr], notes: "Verzonnen proeffirma (2c.8)" })).id;
const VERZ = await orgOf(`Proef Verzekeraar Valk 2c8 ${sfx}`, "other");
const MAKE = await orgOf(`Proef Makelaar Zwaluw 2c8 ${sfx}`, "other");
const REIGER = await orgOf(`Proef Bouw Reiger 2c8 ${sfx}`);
const MEREL = await orgOf(`Proef Elektro Merel 2c8 ${sfx}`);
const KLANTNAAM = `Proef Klant Spreeuw 2c8 ${sfx}`;
const KLANTORG = await orgOf(KLANTNAAM, "client");
const login = async (who, orgId, name) => { const c = ok(await admin.invitePerson({ name, roles: [{ onderaannemer: null }], orgId: [orgId], shortCode: [], lang: [], phone: [], workIds: [], validDays: 0n, tag: "proef 2c8" })); ok(await who.redeemCode(c.code)); };
await login(oaR, REIGER, `Proef OA Reiger ${sfx}`);
await login(oaM, MEREL, `Proef OA Merel ${sfx}`);
const WLID = (await wl.me()).person[0].id;
const mkWork = async (code, leader) => ok(await admin.createWork({ code, name: "Proef werfadmin 2c8", address: addr, parentId: [], clientOrgId: [KLANTORG], architectOrgId: [], leaderPersonId: leader ? [WLID] : [], vatBp: 2100n }));
const w1 = await mkWork(`P-WA1${sfx}`, true);
const w2 = await mkWork(`P-WA2${sfx}`, false);
const W1 = w1.id;
const W2 = w2.id;
ok(await admin.addMembership(W1, [(await oaR.me()).person[0].id], [], { onderaannemer: null }, []));
// Twee klanten op W1: klantA van de firma die op de werf als klant staat, klantB van een ANDERE firma (review M2). De architect wordt lid van W1.
const KLANTORG2 = await orgOf(`Proef Andere Klant 2c8 ${sfx}`, "client");
const mkKlant = async (orgId, name) => { const c = ok(await admin.invitePerson({ name, roles: [{ klant: null }], orgId: [orgId], shortCode: [], lang: [], phone: [], workIds: [W1], validDays: 0n, tag: "proef 2c8" })); const b = await freshBackend(cid); ok(await b.redeemCode(c.code)); return b; };
const klantA = await mkKlant(KLANTORG, `Proef Klant A ${sfx}`);
const klantB = await mkKlant(KLANTORG2, `Proef Klant B ${sfx}`);
const klantId = (await klantA.me()).person[0].id;
ok(await admin.addMembership(W1, [(await arch.me()).person[0].id], [], { architect: null }, []));
const setStart = async (W, start) => { const w = (await admin.listWorks()).find((x) => x.id === W); ok(await admin.updateWork(W, { code: w.code, name: w.name, address: w.address, parentId: [], clientOrgId: w.clientOrgId, architectOrgId: w.architectOrgId, leaderPersonId: w.leaderPersonId, vatBp: w.vatBp, plannedStart: [start], plannedEnd: [], analyticCode: [], vatNote: "" })); };
const insIn = (o = {}) => ({ id: [], workId: [W1], kind: { rc10Sub: null }, insurerOrgId: [VERZ], brokerOrgId: [MAKE], policyRef: `POL-${sfx}`, periodFrom: [], periodTo: [], status: { toDeclare: null }, note: "", rev: 0n, ...o });
// Bewaren met de rev van het moment (review M3): de rev van de laatste weergave / het laatste lezen.
const cur = async (id) => (await calc.listInsurances([W1], true)).find((i) => i.id === id);
const upd = async (id, o) => { const c = await cur(id); return calc.saveInsurance({ id: [id], workId: c.workId, kind: c.kind, insurerOrgId: c.insurerOrgId, brokerOrgId: c.brokerOrgId, policyRef: c.policyRef, periodFrom: c.periodFrom, periodTo: c.periodTo, status: c.status, note: c.note, ...o, rev: c.rev }); };
const cf = async (id, o, who = calc) => who.saveInsuranceConf(id, { ...o, rev: (await calc.readInsuranceConf(id)).ok?.rev ?? 0n });
const notes = async (x, re) => (await x.myNotifications(false)).filter((n) => n.kind === "verzekering" && re.test(n.text)).length;

// ── 1. Aangifte uiterlijk 15 dagen na de start; meldingen één keer ──────────
await setStart(W1, nextWd(today + 2n));
const I1 = ok(await calc.saveInsurance(insIn()));
let v1 = (await calc.listInsurances([W1], false)).find((i) => i.id === I1);
const start1 = un(v1.startDay);
check("(1) de aangifte is uiterlijk start + 15 dagen", un(v1.declareBy) === start1 + 15n, `start ${start1}, uiterlijk ${un(v1.declareBy)}`);
check("(1) verzekeraar en makelaar zijn firma's van soort andere; geen werfwaarde of premie in de gewone weergave", v1.insurerName.includes("Valk") && v1.brokerName.includes("Zwaluw") && noMoney(v1));
const start2 = nextWd(today + 9n);
await setStart(W1, start2);
v1 = (await calc.listInsurances([W1], false)).find((i) => i.id === I1);
check("(1) schuift de start, dan schuift de uiterste dag mee", un(v1.declareBy) === start2 + 15n && un(v1.startDay) === start2);
// Review M6: een geplande taak VOOR de start van de werf vervroegt de start (en dus de uiterste aangifte); actie- en restpunten tellen niet mee.
{
  const plan0 = await wl.getPlan(W1);
  const early = nextWd(start2 - 5n);
  const tr = ok(await wl.saveTask(W1, { id: [], title: "Proef voorbereiding 2c8", note: "", kind: { work: null }, trade: [], responsibleOrgId: [], status: { planned: null }, percent: 0n, start: early, workdays: 1n, leadDays: 0n, orderDay: [], reason: "proef 2c8 (M6)" }, plan0.version));
  const v = (await calc.listInsurances([W1], false)).find((i) => i.id === I1);
  check("(1) review M6: een taak naar voren schuiven vervroegt de uiterste aangifte (start = het minimum van werfstart, geplande taken en werkelijke starten)", un(v.startDay) === early && un(v.declareBy) === early + 15n, `start ${un(v.startDay)} verwacht ${early}`);
  const p1 = await wl.getPlan(W1);
  ok(await wl.archiveTask(W1, tr.taskId[0], p1.version));
  const v3 = (await calc.listInsurances([W1], false)).find((i) => i.id === I1);
  check("(1) de taak weg: de start is weer die van de werf", un(v3.startDay) === start2);
}// Meldingen: 5 dagen vooraf (uiterste dag = vandaag + 5), één keer.
await setStart(W1, today + 5n - 15n);
const before = await notes(admin, new RegExp(`P-WA1${sfx}`));
const n1 = Number(await admin.scanSiteAdmin());
const n1b = Number(await admin.scanSiteAdmin());
check("(1) 5 dagen vooraf: één melding bij de ronde, de tweede ronde meldt niets meer", n1 >= 1 && n1b === 0, `${n1} / ${n1b}`);
check("(1) de melding gaat naar kantoor en de werfleider van de werf, niet naar de OA", (await notes(admin, new RegExp(`P-WA1${sfx}`))) === before + 1 && (await notes(calc, new RegExp(`P-WA1${sfx}`))) >= 1 && (await notes(wl, new RegExp(`P-WA1${sfx}`))) >= 1 && (await notes(oaR, /./)) === 0);
v1 = (await calc.listInsurances([W1], false)).find((i) => i.id === I1);
check("(1) staat in de weergave als 'binnenkort'", v1.declareState === "binnenkort");
// Op de dag zelf.
await setStart(W1, today - 15n);
const n2 = Number(await admin.scanSiteAdmin());
const n2b = Number(await admin.scanSiteAdmin());
check("(1) op de dag zelf: één melding, daarna geen", n2 >= 1 && n2b === 0 && (await notes(admin, /vandaag/)) >= 1, `${n2} / ${n2b}`);
v1 = (await calc.listInsurances([W1], false)).find((i) => i.id === I1);
check("(1) staat in de weergave als 'vandaag'", v1.declareState === "vandaag");
// Aangegeven: geen melding meer, ook niet na het schuiven van de start.
ok(await upd(I1, { status: { declared: today } }));
await setStart(W1, today - 20n);
check("(1) aangegeven: geen verdere meldingen", Number(await admin.scanSiteAdmin()) === 0);
check("(1) een reden is verplicht bij 'niet nodig'; periode die eindigt vóór ze begint geweigerd", /reden/i.test(errOf(await calc.saveInsurance(insIn({ status: { notNeeded: "" } })))) && /periode/i.test(errOf(await calc.saveInsurance(insIn({ periodFrom: [today], periodTo: [today - 1n] })))));
check("(1) een onbekende verzekeraar wordt geweigerd", /verzekeraar/i.test(errOf(await calc.saveInsurance(insIn({ insurerOrgId: [99_999_999n] })))));

// ── 2. Premie: ‰ van de werfwaarde met minimum; vertrouwelijk ───────────────
ok(await admin.saveSiteAdminSettings({ codeP: false, rates: [["rc10", 3040n, 0n], ["ba10", 0n, 0n], ["abr", 2200n, 50_000n]] }));
const cv = ok(await cf(I1, { workValueCents: [10_000_000n], rateMilli: [], minPremiumCents: [], taxesCents: [], paid: false }));
check("(2) RC10: werfwaarde € 100.000 × 3,04 ‰ = € 304,00", un(cv.premiumNetCents) === 30_400n && cv.defaultRateMilli === 3040n, S(cv));
const cv2 = ok(await cf(I1, { workValueCents: [123_457n], rateMilli: [], minPremiumCents: [], taxesCents: [], paid: false }));
check("(2) afronden op de cent: € 1.234,57 × 3,04 ‰ = 375 cent", un(cv2.premiumNetCents) === 375n, S(cv2));
const I2 = ok(await calc.saveInsurance(insIn({ kind: { abr: null }, status: { insured: null } })));
const cv3 = ok(await cf(I2, { workValueCents: [10_000_000n], rateMilli: [], minPremiumCents: [], taxesCents: [925n], paid: false }));
check("(2) ABR: 2,20 ‰ van € 100.000 = € 220,00, het minimum van € 500,00 geldt", un(cv3.premiumNetCents) === 50_000n && un(cv3.taxesCents) === 925n, S(cv3));
const cv4 = ok(await cf(I2, { workValueCents: [30_000_000n], rateMilli: [], minPremiumCents: [], taxesCents: [], paid: true }));
check("(2) ABR boven het minimum: 2,20 ‰ van € 300.000 = € 660,00; betaald onthouden", un(cv4.premiumNetCents) === 66_000n && cv4.paid);
const cv5 = ok(await cf(I2, { workValueCents: [10_000_000n], rateMilli: [1000n], minPremiumCents: [0n], taxesCents: [], paid: false }));
check("(2) een eigen tarief (1 ‰) en minimum 0 op deze verzekering", un(cv5.premiumNetCents) === 10_000n);
const I3 = ok(await calc.saveInsurance(insIn({ kind: { ba10: null } })));
check("(2) BA10 zonder ingesteld tarief: geen premie", un(ok(await cf(I3, { workValueCents: [10_000_000n], rateMilli: [], minPremiumCents: [], taxesCents: [], paid: false })).premiumNetCents) === null);
check("(2) negatieve of te grote bedragen geweigerd", /Bedrag/.test(errOf(await cf(I1, { workValueCents: [-5n], rateMilli: [], minPremiumCents: [], taxesCents: [], paid: false }))));
check("(2) de werfleider, architect, klant, OA en VC lezen noch bewaren werfwaarde en premie", (await Promise.all([wl, arch, klant, oaR, vc].map(async (x) => (await denied(x.readInsuranceConf(I1))) && (await denied(x.saveInsuranceConf(I1, { workValueCents: [1n], rateMilli: [], minPremiumCents: [], taxesCents: [], paid: false, rev: 0n }))) ))).every(Boolean));
check("(2) lezen van de premie staat in de auditlog (bekeek:verzekering)", ok(await calc.readInsuranceConf(I1)) && (await admin.auditLog(0n, 60n)).some((l) => l.action === "bekeek:verzekering"));

// ── 3. Het attest voor de klant ─────────────────────────────────────────
const fAtt = ok(await calc.addFile("proef-attest-2c8.pdf", "application/pdf", 20_000n, fakeBlob("a"), [W1], false));
const fPol = ok(await calc.addFile("proef-polis-2c8.pdf", "application/pdf", 20_000n, fakeBlob("b"), [W1], true)); // review M1: de polis bevat werfwaarde of premie: vertrouwelijk
const fOpen = ok(await calc.addFile("proef-open-2c8.pdf", "application/pdf", 20_000n, fakeBlob("9"), [W1], false));
const fSecret = ok(await calc.addFile("proef-geheim-2c8.pdf", "application/pdf", 20_000n, fakeBlob("c"), [W1], true));
check("(3) review M1/L2: een niet-vertrouwelijk bestand als polis, een vertrouwelijk bestand als attest en een andere soort worden geweigerd", /vertrouwelijk/.test(errOf(await calc.attachInsuranceFile(I1, "verzekering", "Polis", fOpen, false))) && /niet-vertrouwelijk/.test(errOf(await calc.attachInsuranceFile(I1, "verzekering-attest", "Attest", fSecret, true))) && /soort/.test(errOf(await calc.attachInsuranceFile(I1, "plannen", "Polis", fSecret, false))));
ok(await calc.attachInsuranceFile(I1, "verzekering", "Polis", fPol, false));
check("(3) review M1: de werfleider mag geen polis aanhangen (vertrouwelijk stuk: enkel kantoor)", await denied(wl.attachInsuranceFile(I1, "verzekering", "Polis", fPol, false)));
check("(3) delen zonder attest geweigerd", /attest/i.test(errOf(await calc.shareInsuranceAttest(I1, true))));
const attDoc = ok(await calc.attachInsuranceFile(I1, "x", "Attest RC10", fAtt, true));
const vAtt = (await calc.listInsurances([W1], false)).find((i) => i.id === I1);
check("(3) polis en attest hangen als documenten van 1.1 aan de verzekering", vAtt.documents.length === 2 && un(vAtt.attestDocId) === attDoc);
check("(3) de klant ziet niets zolang kantoor niet deelt", (await klantA.clientSiteAdmin(W1)).attests.length === 0);
ok(await calc.shareInsuranceAttest(I1, true));
const ca = await klantA.clientSiteAdmin(W1);
check("(3) gedeeld: de klant ziet enkel het attest (geen polis, geen premie, geen verzekeraar)", ca.attests.length === 1 && ca.attests[0].file.name === "proef-attest-2c8.pdf" && noMoney(ca) && !S(ca).includes(`POL-${sfx}`) && !S(ca).includes("Valk"));
// Review L3: bewaar het gedeelde fileId. Een latere versie van het attest-document in het dossier (hier een ander bestand) komt niet bij de klant.
ok(await calc.attachDocumentFile(W1, "verzekering-attest", [attDoc], fSecret));
check("(3) review L3: een latere versie van het attest in het dossier verandert niet wat de klant ziet (het gedeelde bestand blijft)", (await klantA.clientSiteAdmin(W1)).attests.length === 1 && (await klantA.clientSiteAdmin(W1)).attests[0].file.name === "proef-attest-2c8.pdf");
check("(3) een klant van een andere werf, de klant van een ANDERE FIRMA op dezelfde werf (M2) en een OA zien niets; de architect ziet geen attest", (await denied(klant.clientSiteAdmin(W2))) && (await denied(klantB.clientSiteAdmin(W1))) && (await denied(oaR.clientSiteAdmin(W1))) && (await arch.clientSiteAdmin(W1)).attests.length === 0);
const dossierOf = async (x) => { try { return S((await x.getDossier(W1)).documents); } catch { return ""; } };
check("(3) in het dossier van de werf zien de klant en de OA noch de polis noch het attest (enkel via Mijn werf, en alleen het gedeelde attest)", !(await dossierOf(klantA)).includes("Polis") && !(await dossierOf(klantA)).includes("Attest RC10") && !(await dossierOf(oaR)).includes("Polis") && !(await dossierOf(oaR)).includes("Attest RC10"));
{
  const names = async (x) => { try { return S((await x.getDossier(W1)).documents) + S((await x.listFiles([W1])).map((f) => f.name)); } catch { return ""; } };
  const forWl = await names(wl), forArch = await names(arch), forCalc = await names(calc);
  check("(3) review M1: ook de architect (lid van de werf) en de werfleider zien de polis noch het attest in het dossier of de bestandenlijst; kantoor wel", !/Polis|polis|Attest RC10|attest-2c8/.test(forWl + forArch) && /proef-polis-2c8/.test(forCalc) && /Polis/.test(forCalc));
  const lw = (await wl.listInsurances([W1], false)).find((i) => i.id === I1);
  const lc = (await calc.listInsurances([W1], false)).find((i) => i.id === I1);
  check("(3) review M1: de lijst van de verzekering toont de documenten enkel aan wie de bedragen ziet", lw.documents.length === 0 && lc.documents.length === 2);
  check("(3) review M1: kantoor opent het vertrouwelijke stuk met een update-call (auditregel bekeek:bestand-vertrouwelijk)", isOk(await calc.readConfidentialFile(fPol)) && (await denied(wl.readConfidentialFile(fPol))) && (await denied(arch.readConfidentialFile(fPol))));
}
// Review M3: gelijktijdig bewaren. B laadde de verzekering, A zet de stand op 'verzekerd'; B bewaart daarna een notitie met de oude rev: geweigerd, de stand blijft.
{
  const c0 = await cur(I1);
  ok(await upd(I1, { status: { insured: null } }));
  const stale = await calc.saveInsurance({ id: [I1], workId: c0.workId, kind: c0.kind, insurerOrgId: c0.insurerOrgId, brokerOrgId: c0.brokerOrgId, policyRef: c0.policyRef, periodFrom: c0.periodFrom, periodTo: c0.periodTo, status: c0.status, note: "bewaard met een oude weergave", rev: c0.rev });
  check("(3) review M3: bewaren met een oude rev wordt geweigerd; de stand 'aangegeven/verzekerd' wordt niet teruggezet", /Iemand anders bewaarde dit intussen/.test(errOf(stale)) && "insured" in (await cur(I1)).status && (await cur(I1)).note !== "bewaard met een oude weergave");
  const r0 = ok(await calc.readInsuranceConf(I1)).rev;
  ok(await calc.saveInsuranceConf(I1, { workValueCents: [10_000_000n], rateMilli: [], minPremiumCents: [], taxesCents: [], paid: false, rev: r0 }));
  check("(3) review M3: de premie bewaren met een oude rev wordt geweigerd", /Iemand anders/.test(errOf(await calc.saveInsuranceConf(I1, { workValueCents: [1n], rateMilli: [], minPremiumCents: [], taxesCents: [], paid: false, rev: r0 }))));
}
check("(1) review L8: 'aangegeven op' een datum na vandaag wordt geweigerd", /na vandaag/.test(errOf(await upd(I1, { status: { declared: today + 1n } }))));
{
  const OLD = await orgOf(`Proef Verzekeraar Oud 2c8 ${sfx}`, "other");
  const iO = ok(await calc.saveInsurance(insIn({ insurerOrgId: [OLD] })));
  ok(await admin.archiveOrg(OLD));
  check("(1) review L1: een bestaande keuze van een intussen gearchiveerde verzekeraar blijft aanvaard; een nieuw gekozen gearchiveerde firma niet", isOk(await upd(iO, { note: "nog altijd bewaard" })) && /verzekeraar/i.test(errOf(await calc.saveInsurance(insIn({ insurerOrgId: [OLD] })))));
}ok(await calc.shareInsuranceAttest(I1, false));
check("(3) kantoor trekt het attest terug: de klant ziet het niet meer", (await klantA.clientSiteAdmin(W1)).attests.length === 0);
check("(3) de werfleider mag het attest niet delen (enkel kantoor)", await denied(wl.shareInsuranceAttest(I1, true)));
check("(3) werf W2: de werfleider van W1 ziet er geen verzekeringen", await denied(wl.listInsurances([W2], false)));
const jaar = ok(await admin.saveInsurance(insIn({ workId: [], kind: { other: "Jaarpolis abonnement" } })));
check("(3) de jaarpolis (zonder werf) staat in Beheer: kantoor leest ze, de werfleider ook; bewaren enkel admin en calculator", (await admin.listInsurances([], false)).some((i) => i.id === jaar) && (await wl.listInsurances([], false)).some((i) => i.id === jaar) && (await denied(wl.saveInsurance(insIn({ workId: [] })))));

console.log(`\n${pass} ✓  ${fail} ✗  (deel 1)`);
globalThis.__w = { W1, W2, REIGER, MEREL, KLANTNAAM, today, sfx, I1, I2, fAtt, klantId };
await (await import("./werfadmin-2c8-b.mjs")).run({ admin, calc, wl, arch, klant: klantA, klantB, vc, oaR, oaM, check, ok, isOk, errOf, denied, un, noMoney, S, fakeBlob, DOC, ctx: globalThis.__w, big, pass: () => pass, fail: () => fail });
} finally {
  ok(await admin.setSettings(setIn(s0.werfleiderZietAlles)));
  await admin.saveSiteAdminSettings({ codeP: st0.codeP, rates: st0.rates.map(([a, b, c]) => [a, b, c]) }).catch(() => {});
}
