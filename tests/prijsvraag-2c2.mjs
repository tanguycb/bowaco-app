// Prijsvraag naar onderaannemers (stap 2c.2, ontwerp 2c §4.2, §8 R35–R39 en §10).
//   node tests/prijsvraag-2c2.mjs                A: de rekenregels (tender/calc.ts) en de PDF van de prijsvraag, zonder netwerk
//   node tests/prijsvraag-2c2.mjs <canister>     + B: door de backend (eigen net of draft): klaarzetten (posten gekopieerd,
//                                                controlecode, nummer per offerte), voorstel van firma's, toegang in de app ZONDER
//                                                werf, verstuurd, Mijn prijsvragen (enkel de eigen firma, adres volgens de keuze,
//                                                nooit de klant of een andere firma), ontwerp (kantoor leest het niet), indienen
//                                                (server rekent na, versie 2 vervangt versie 1), eigen PDF opladen (vertrouwelijk),
//                                                bijlagen (enkel wat aan de prijsvraag hangt), geen interesse, eigen deadline,
//                                                verlengen, afsluiten (gekozen/bedankt), annuleren, 90 dagen na afsluiten niets meer,
//                                                de werfleider (stand, nooit een bedrag), de .did-controle (geen Cents in de views
//                                                van werfleider en OA) en lokaal de klokjob (herinnering, geen antwoord).
// Enkel VERZONNEN gegevens: firma's "Proef … 2c2", gemeente Hoeveldam, postcode 9991. De klokproef verzet de tijd van het EIGEN
// net (enkel lokaal; ZONDER_KLOK=1 slaat ze over) en loopt daarom als laatste.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { backend, freshBackend, KEYDIR, Principal, resync } from "../tools/lib.mjs";
import { M, saveAll } from "./offerte-lib.mjs";
import { totals, lineAmount, roundDiv } from "../src/frontend/src/tender/calc.ts";
import { tenderPdf } from "../src/frontend/src/pdf/prijsvraag.ts";
import { fonts } from "./pdf-voorbeeld.mjs";

const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);

// ── A. Rekenregels en PDF ───────────────────────────────────────────────
const Y = { yes: null };
check("(A1) bedrag = eenheidsprijs × VH, half weg van nul op de cent (12,345 st × € 0,15 = € 1,85)", lineAmount(15n, 12_345n, Y) === 185n && lineAmount(15n, 12_350n, Y) === 185n && roundDiv(-5n, 10n) === -1n);
check("(A1) niet inbegrepen of zonder prijs: geen bedrag; alternatief telt wel", lineAmount(1000n, 1000n, { no: null }) === null && lineAmount(null, 1000n, Y) === null && lineAmount(1000n, 2000n, { alt: "x" }) === 2000n);
const tt = totals([{ itemId: 1n, qtyMilli: 3000n, unitCents: 1999n, included: Y }, { itemId: 2n, qtyMilli: 1000n, unitCents: 500n, included: { no: null } }, { itemId: null, qtyMilli: 2500n, unitCents: 1000n, included: Y }], 750n, (i) => (i === 1n ? "5 Elektriciteit" : "6 Sanitair"));
check("(A2) totalen: som 59,97 + 25,00 = 84,97; korting 7,5 % = 6,37; netto 78,60; per hoofdstuk en Eigen posten", tt.gross === 8497n && tt.discount === 637n && tt.net === 7860n && S(tt.chapters) === S([["5 Elektriciteit", 5997n], ["Eigen posten", 2500n]]), S(tt));
{
  const data = {
    code: "PV 2026/412-1", title: "Proef elektriciteit", firm: "Proef Elektro Reiger 2c2", firmContact: "Proef Rita", place: ["9991 Hoeveldam"], deadlineDay: 20_385,
    contact: { name: "Proef Calculator", phone: "0470 00 00 00", email: "offertes@proef.invalid" }, message: "Plaatsbezoek na afspraak.", files: ["plan gelijkvloers.pdf"],
    accessCode: "BOW-7KQ2-M4XD-9TAB", appUrl: "https://app.proef.invalid", hash: "a".repeat(64),
    items: Array.from({ length: 70 }, (_, i) => ({ chapter: i < 40 ? "5 Elektriciteit" : "6 Sanitair", subgroup: i % 20 < 10 ? "Gelijkvloers" : "Verdiep +1", code: `5.${String(i + 1).padStart(2, "0")}`, title: `Proefpost ${i + 1}`, text: i === 3 ? "x".repeat(3000) : "Lastenboektekst (verzonnen).", unit: "st", qtyMilli: BigInt(1000 + i * 250), form: i % 7 === 0 ? "fixed" : "vh" })),
  };
  const bytes = await tenderPdf(data, fonts());
  const dir = mkdtempSync(join(tmpdir(), "bowaco-pv-"));
  const f = join(dir, "pv.pdf");
  writeFileSync(f, bytes);
  const PY = `
import fitz, json, sys
d = fitz.open(sys.argv[1])
out = {"pages": [], "text": ""}
for p in d:
    r = p.rect
    blocks = [b for b in p.get_text("blocks") if b[6] == 0]
    out["pages"].append([b[4][:30] for b in blocks if b[0] < 40 or b[2] > r.width - 40 or b[3] > r.height - 20 or b[1] < 20])
    out["text"] += p.get_text()
print(json.dumps(out))
`;
  const r = spawnSync("python3", ["-c", PY, f], { encoding: "utf8", cwd: dir });
  if (r.status === 0) {
    const o = JSON.parse(r.stdout);
    check("(A3) PDF prijsvraag: code, firma, deadline, contact, bijlage, toegangscode, 'Zo antwoordt u', overeenkomst onderaanneming, controlecode in de voet", ["PV 2026/412-1", "Proef Elektro Reiger 2c2", "Hoeveldam", "Proef Calculator", "plan gelijkvloers.pdf", "BOW-7KQ2-M4XD-9TAB", "ZO ANTWOORDT U", "overeenkomst onderaanneming", "aaaaaaaaaaaaaaaa"].every((x) => o.text.includes(x)));
    check("(A3) PDF: 70 posten over meerdere bladzijden, een post van 3.000 tekens breekt per regel af, niets buiten de marge", o.pages.length >= 3 && o.pages.every((p) => p.length === 0) && o.text.includes("Proefpost 70"), `${o.pages.length} bladzijden`);
    check("(A3) PDF: geen bedrag (geen €-teken: de prijskolom is leeg)", !o.text.includes("€"));
  } else console.log("· (A3) PyMuPDF ontbreekt: PDF niet nagelezen");
}

if (!cid) {
  console.log(`\n${pass} ✓  ${fail} ✗  (enkel A; geef een canister voor B)`);
  process.exit(fail ? 1 : 0);
}

// ── B. Door de backend ──────────────────────────────────────────────────
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r.ok; };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const host = process.env.ICP_HOST || "";
const local = host.includes("localhost") || host.includes("127.0.0.1");
const opt = (v) => (v === null || v === undefined ? [] : [v]);
// R37 "ook niet hoeveel": in wat de OA krijgt, staat geen enkel globaal id of volgnummer van de app.
const ID_KEYS = /^(id|inviteId|tenderId|itemId|fileId|oaQuoteId|orgId|workId|personId|lineId|root|supersedes|accessCodeId|sheetKey)$/;
const idKeys = (x, out = new Set()) => { if (Array.isArray(x)) x.forEach((y) => idKeys(y, out)); else if (x && typeof x === "object" && !(x instanceof Uint8Array)) for (const [k, v] of Object.entries(x)) { if (ID_KEYS.test(k)) out.add(k); idKeys(v, out); } return [...out]; };

const [admin, calc, wl, oaDak, oaTegels, arch, klant, vc] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-oa2", "proef-oa", "proef-architect", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const vreemd = await freshBackend(cid);
const oaA = await freshBackend(cid); // Proef Elektro Reiger 2c2 (via de toegangscode van de prijsvraag)
const oaB = await freshBackend(cid); // Proef Elektro Merel 2c2
const oaC = await freshBackend(cid); // Proef Sanitair Fuut 2c2 (niet gevraagd)
const everyone = [admin, calc, wl, oaDak, oaTegels, arch, klant, vc, vreemd, oaA, oaB, oaC];
const suffix = Date.now().toString(36).slice(-5).toUpperCase();

// B0. Opzet: vakgebied, firma's, contactpersonen, werven, een bibliotheekpost, een offerte met posten.
const TRADE = "proef-elek-2c2";
if (!(await admin.listTrades(true)).some((t) => t.key === TRADE)) ok(await admin.setTrade({ key: TRADE, name: "Proef elektriciteit 2c2", order: 990n, archived: false }));
const orgs0 = await admin.listOrgs(true);
const orgOf = async (name, trades = [], kind = "subcontractor") => orgs0.find((o) => o.name === name && o.archivedAt.length === 0)?.id ?? ok(await admin.createOrg({ kind: { [kind]: null }, name, kbo: [], vat: [], aliases: [], trades, address: [], notes: "Verzonnen proeffirma (2c.2)" })).id;
// Per ronde eigen firma's (de test mag op dezelfde canister opnieuw lopen: een eerder contact zou de standaardkeuze veranderen).
const REIGER = await orgOf(`Proef Elektro Reiger 2c2 ${suffix}`, [TRADE]);
const MEREL = await orgOf(`Proef Elektro Merel 2c2 ${suffix}`);
const FUUT = await orgOf(`Proef Sanitair Fuut 2c2 ${suffix}`);
const KLANTORG = await orgOf("Proef Klant Kievit 2c2", [], "client");
const personOf = async (orgId, name) => {
  const v = ok(await admin.getOa(orgId));
  return v.persons?.find((p) => p.name === name)?.id ?? ok(await admin.saveOaPerson(orgId, { id: [], name, shortCode: [], phone: [], email: [`${name.toLowerCase().replace(/[^a-z]+/g, ".")}@proef.invalid`], jobTitle: "zaakvoerder", note: "" })).id;
};
const ritaName = `Proef Rita ${suffix}`;
const RITA = await personOf(REIGER, ritaName);
const MO = await personOf(MEREL, `Proef Mo ${suffix}`);
const FIEN = await personOf(FUUT, `Proef Fien ${suffix}`);
const addr = (street, zip, city) => ({ street, number: "12", zip, city, country: "BE" });
const W1 = ok(await admin.createWork({ code: `P-PV${suffix}`, name: "Proef prijsvraag 2c2", address: addr("Proefstraat", "9991", "Hoeveldam"), parentId: [], clientOrgId: [KLANTORG], architectOrgId: [], leaderPersonId: [], vatBp: 600n })).id;
const W2 = ok(await admin.createWork({ code: `P-PW${suffix}`, name: "Proef prijsvraag 2c2 andere werf", address: addr("Kerkweg", "9992", "Merkebeke"), parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
const wlMe = await wl.me();
const WL = wlMe.person[0].id;
ok(await admin.addMembership(W1, [WL], [], { werfleider: null }, []));
const libChs = await calc.libraryChapters(false);
if (!libChs.length) throw new Error("geen hoofdstukken in de bibliotheek: eerst tests/posten-draft.mjs");
const libItem = ok(await calc.saveLibraryItem({ id: [], chapterId: libChs[0].id, code: "", title: `Proef stopcontact 2c2 ${suffix}`, text: "Verzonnen.", unit: "st", form: { vh: null }, trade: [TRADE], orgId: [MEREL], durationDays: [], perDayMilli: [], planStepKey: [], keywords: [], importKey: [] }, 0n)).id;

const mkQuote = async (workId, title) => {
  const q = ok(await calc.createQuote({ workId, number: "", title }));
  const { fromRead } = await import("./offerte-lib.mjs");
  const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
  const c1 = M.addChapter(m, { code: "05", title: "Proef elektriciteit" });
  const c2 = M.addChapter(m, { code: "06", title: "Proef sanitair" });
  M.addLine(m, c1.key, { title: "Proef stopcontact", text: "Inbouw, wit (verzonnen).", qtyMilli: 12_000n, unit: "st", form: "vh", libItemId: libItem, libItemVersion: 1n, price: M.emptyPrice() });
  M.addLine(m, c1.key, { title: "Proef lichtpunt", qtyMilli: 8_000n, unit: "st", form: "vh", price: M.emptyPrice() });
  M.addLine(m, c1.key, { kind: "text", title: "Proef tekstregel", qtyMilli: 0n, unit: "", form: "vh", price: M.emptyPrice() });
  M.addLine(m, c2.key, { title: "=Proef wastafel", qtyMilli: 2_000n, unit: "st", form: "fixed", price: M.emptyPrice() });
  M.addLine(m, c2.key, { title: "Proef leiding", qtyMilli: 15_250n, unit: "lm", form: "vh", price: M.emptyPrice() });
  const r = await saveAll(calc, m);
  if (r && "err" in r) throw new Error(r.err);
  const rd = ok(await calc.readQuoteVersion(q.versionId));
  return { q, rd };
};
const { q: Q1, rd: R1 } = await mkQuote(W1, "Proef 2c2 offerte");
const { q: Q2, rd: R2 } = await mkQuote(W2, "Proef 2c2 andere offerte");
const items1 = R1.lines.filter((l) => !("text" in l.kind));
const textLine = R1.lines.find((l) => "text" in l.kind);
const plan = ok(await calc.addFile("plan gelijkvloers (proef).pdf", "application/pdf", 1200n, new TextEncoder().encode("!caf!sha256:" + "1".repeat(64)), [W1], false));
const other = ok(await calc.addFile("foto opmeting (proef).jpg", "image/jpeg", 900n, new TextEncoder().encode("!caf!sha256:" + "2".repeat(64)), [W1], false));
const secret = ok(await calc.addFile("contract (proef).pdf", "application/pdf", 900n, new TextEncoder().encode("!caf!sha256:" + "3".repeat(64)), [W1], true));
const planW2 = ok(await calc.addFile("plan andere werf (proef).pdf", "application/pdf", 900n, new TextEncoder().encode("!caf!sha256:" + "4".repeat(64)), [W2], false));
check("(B0) opzet: twee werven, offertes met 4 posten en een tekstregel, een plan en een vertrouwelijk bestand", items1.length === 4 && !!textLine);

// B1. Voorstel van firma's en standaarddeadline.
const sug = ok(await calc.tenderSuggestions(R1.version.id, items1.slice(0, 2).map((l) => l.id)));
const sR = sug.firms.find((f) => f.orgId === REIGER);
const sM = sug.firms.find((f) => f.orgId === MEREL);
check("(B1) voorstel: Reiger op vakgebied, Merel als standaard-OA van de post; Fuut (geen reden) niet", sR?.reasons.includes("vakgebied") && sM?.reasons.includes("standaard-OA") && !sug.firms.some((f) => f.orgId === FUUT), S(sug.firms.map((f) => [f.orgName, f.reasons])));
check("(B1) standaard: 10 werkdagen (≥ 14 kalenderdagen), herinnering 3 werkdagen vooraf; contacten bij het voorstel", sug.remindDays === 3n && sR.contacts.some((c) => c.id === RITA));
check("(B1) voorstel vragen: werfleider, OA, klant, architect geweigerd", (await Promise.all([wl, oaDak, klant, arch].map((x) => denied(x.tenderSuggestions(R1.version.id, []))))).every(Boolean));

// B2. Klaarzetten: geweigerde invoer en rechten.
const base = (over = {}) => ({ versionId: R1.version.id, lineIds: items1.map((l) => l.id), title: "Proef elektriciteit & sanitair", noteForOa: "Plaatsbezoek na afspraak (verzonnen).", internalNote: "intern: niet voor de OA", deadlineDay: sug.deadlineDay, remindDays: 3n, fileIds: [plan], addressMode: { city: null }, firms: [{ orgId: REIGER, contactPersonId: [] }, { orgId: MEREL, contactPersonId: [MO] }], ...over });
check("(B2) een tekstregel kan niet in een prijsvraag", /tekstregel/.test(errOf(await calc.createTender(base({ lineIds: [textLine.id] })))));
check("(B2) een post van een andere versie: geweigerd", /hoort niet bij versie/.test(errOf(await calc.createTender(base({ lineIds: [R2.lines[0].id] })))));
check("(B2) een klant als firma, dezelfde firma twee keer, geen firma: geweigerd", /onderaannemer of leverancier/.test(errOf(await calc.createTender(base({ firms: [{ orgId: KLANTORG, contactPersonId: [] }] })))) && /twee keer/.test(errOf(await calc.createTender(base({ firms: [{ orgId: REIGER, contactPersonId: [] }, { orgId: REIGER, contactPersonId: [] }] })))) && /minstens één firma/.test(errOf(await calc.createTender(base({ firms: [] })))));
check("(B2) een deadline vandaag of vroeger: geweigerd", /Deadline/.test(errOf(await calc.createTender(base({ deadlineDay: sug.deadlineDay - 30n })))));
check("(B2) bijlagen: een vertrouwelijk bestand of een bestand van een andere werf: geweigerd (R39)", /niet-vertrouwelijk/.test(errOf(await calc.createTender(base({ fileIds: [secret] })))) && /niet-vertrouwelijk/.test(errOf(await calc.createTender(base({ fileIds: [planW2] })))));
check("(B2) een contactpersoon van een andere firma: geweigerd", /hoort niet bij die firma/.test(errOf(await calc.createTender(base({ firms: [{ orgId: REIGER, contactPersonId: [MO] }] })))));
check("(B2) klaarzetten: werfleider, architect, klant, VC, OA en een onbekende login geweigerd", (await Promise.all([wl, arch, klant, vc, oaDak, vreemd].map((x) => denied(x.createTender(base()))))).every(Boolean));
const T1 = ok(await calc.createTender(base()));
const T1b = ok(await calc.createTender(base({ title: "Proef tweede prijsvraag", firms: [{ orgId: FUUT, contactPersonId: [] }] })));
const TW2 = ok(await admin.createTender({ ...base(), versionId: R2.version.id, lineIds: R2.lines.filter((l) => !("text" in l.kind)).map((l) => l.id), fileIds: [planW2], firms: [{ orgId: REIGER, contactPersonId: [] }] }));
let v1 = ok(await calc.readTender(T1));
const invA = v1.invites.find((i) => i.orgId === REIGER);
const invB = v1.invites.find((i) => i.orgId === MEREL);
check("(B3) klaargezet: 4 posten gekopieerd in de volgorde van de offerte, sleutel PV<id>.<post>, controlecode", v1.items.length === 4 && v1.items[0].title === "Proef stopcontact" && v1.items[3].title === "Proef leiding" && v1.items.every((x) => x.key === `PV${T1}.${x.id}`) && /^[0-9a-f]{64}$/.test(v1.sentHash));
check("(B3) hoofdstuk als tekst, eenheid en VH van BOWACO, contractvorm", v1.items[0].chapter === "05 Proef elektriciteit" && v1.items[2].chapter === "06 Proef sanitair" && v1.items[3].qtyMilli === 15_250n && v1.items[3].unit === "lm" && "fixed" in v1.items[2].form);
check("(B3) code PV <offertenummer>-1 en -2 (volgnummer per offerte uit de tellers)", v1.code === `PV ${Q1.number}-1` && ok(await calc.readTender(T1b)).code === `PV ${Q1.number}-2` && ok(await calc.readTender(TW2)).code === `PV ${Q2.number}-1`);
check("(B3) per firma: klaar, uitkomst open, eigen sleutel van 12 tekens (verschillend); Reiger kreeg zijn enige contact, Merel het gekozen", v1.invites.every((i) => "ready" in i.status && "open" in i.outcome && /^[0-9A-Z]{12}$/.test(i.sheetKey)) && invA.sheetKey !== invB.sheetKey && invA.contactPersonId[0] === RITA && invB.contactPersonId[0] === MO);
// De offerte kan nog veranderen; de prijsvraag niet meer.
{
  const { fromRead } = await import("./offerte-lib.mjs");
  const m = fromRead(ok(await calc.readQuoteVersion(R1.version.id)));
  const l = m.lines.find((x) => x.title === "Proef stopcontact");
  M.updateLine(m, l.key, { title: "Proef stopcontact (gewijzigd)", qtyMilli: 99_000n });
  const r = await saveAll(calc, m);
  check("(B3) de offerte verandert na het klaarzetten: de posten van de prijsvraag en de controlecode niet", !(r && "err" in r) && ok(await calc.readTender(T1)).items[0].title === "Proef stopcontact" && ok(await calc.readTender(T1)).items[0].qtyMilli === 12_000n && ok(await calc.readTender(T1)).sentHash === v1.sentHash, errOf(r));
}

// B4. De werfleider: stand zonder bedrag; enkel zijn werven als "werfleider ziet alles" uit staat.
const st = await wl.listTenders([W1]);
check("(B4) werfleider van de werf: firma's, stand en deadline; de prijsvraag zelf en een OA-offerte niet", st.some((x) => x.id === T1 && x.invites.length === 2) && (await denied(wl.readTender(T1))));
const set0 = await admin.getSettings();
const setIn = (zietAlles) => ({ werfleiderZietAlles: zietAlles, inviteDays: set0.inviteDays, threshold30bisCents: set0.threshold30bisCents, thresholdCheckinatworkCents: set0.thresholdCheckinatworkCents });
try {
  ok(await admin.setSettings(setIn(false)));
  check("(B4) werfleider van een andere werf (werfleider ziet alles uit): geweigerd; zijn eigen werf wel", (await denied(wl.listTenders([W2]))) && (await wl.listTenders([W1])).length >= 2 && !(await wl.listTenders([])).some((x) => x.id === TW2));
} finally { ok(await admin.setSettings(setIn(set0.werfleiderZietAlles))); }
check("(B4) architect, klant, VC, OA van de werf en een onbekende login: geen prijsvragen van de werf", (await Promise.all([arch, klant, vc, oaDak, oaTegels, vreemd].map((x) => denied(x.listTenders([W1]))))).every(Boolean));
check("(B4) de werklijst (alle werven): kantoor ziet ze; OA, klant geweigerd", (await calc.listTenders([])).some((x) => x.id === T1) && (await denied(oaDak.listTenders([]))) && (await denied(klant.listTenders([]))));

// B5. .did-controle: de views van werfleider en OA dragen geen bedrag en verwijzen niet naar een bedragtype.
{
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((m) => [m[1], m[2]]));
  const fieldsOf = (n) => [...(types.get(n) ?? "").matchAll(/^\s+(\w+)\s*:/gm)].map((m) => m[1]);
  const views = ["TenderStatusView", "TenderInviteStatusView", "MyTenderView", "MyTenderBrief", "MyTenderItem", "MyTenderAddress", "MyTenderFile", "TenderFileView", "TenderContactView", "TenderView", "TenderInviteView", "TenderItemView", "OaQuoteBrief", "TenderSuggestion", "TenderPersonRef"];
  const bad = views.flatMap((n) => fieldsOf(n).filter((f) => /cents|cost|margin|price|prijs|amount|bedrag|total|euro|discount/i.test(f)).map((f) => `${n}.${f}`));
  const money = ["OaQuoteLine", "OaQuoteAmounts", "OaQuoteFull", "OaDraftView", "QuoteLinePrice", "TenderChoice", "OaQuoteDraft"];
  const refs = views.filter((n) => money.some((t) => new RegExp(`\\b${t}\\b`).test(types.get(n) ?? "")));
  check("(B5) .did: de views van werfleider en OA (en de lijsten van kantoor) hebben geen bedragveld en geen bedragtype", views.every((n) => types.has(n)) && bad.length === 0 && refs.length === 0, bad.concat(refs).join(", ") || `${views.length} typen`);
  const svc = did.slice(did.indexOf("service"));
  const q = (fn) => new RegExp(`\\b${fn}\\s*:\\s*\\([^)]*\\)\\s*->\\s*\\([^)]*\\)\\s*query`).test(svc);
  check("(B5) bedragen enkel via update-calls (readOaQuote, readMyTenderAnswer, readTenderFile); de lijsten zijn queries", !q("readOaQuote") && !q("readMyTenderAnswer") && !q("readTenderFile") && q("listTenders") && q("listMyTenders") && q("readMyTender"));
}

// B6. Toegang in de app: een toegangscode ZONDER werf; de OA wordt geen lid.
check("(B6) toegang geven: werfleider, OA, klant geweigerd", (await Promise.all([wl, oaDak, klant].map((x) => denied(x.tenderAccess(invA.id, 0n))))).every(Boolean));
const accA = ok(await calc.tenderAccess(invA.id, 0n));
check("(B6) toegangscode voor de contactpersoon (geen werf), BOW-…", !accA.alreadyLinked && /^BOW-/.test(accA.code[0] ?? "") && accA.personName === ritaName);
const meA = ok(await oaA.redeemCode(accA.code[0]));
check("(B6) de OA logt in met de code: meteen actief, rol onderaannemer, Mijn prijsvragen, GEEN werf", "active" in meA.status && meA.caps[0].myTenders && !meA.caps[0].tenders && (await oaA.listWorks()).length === 0);
check("(B6) een tweede keer toegang: geen code nodig (heeft al toegang)", ok(await calc.tenderAccess(invA.id, 0n)).alreadyLinked);
const accB = ok(await calc.tenderAccess(invB.id, 0n));
ok(await oaB.redeemCode(accB.code[0]));
const invC = ok(await admin.inviteExistingPerson({ personId: FIEN, workIds: [], validDays: 1n, tag: "proef 2c2" }));
ok(await oaC.redeemCode(invC.code));
check("(B6) vóór Markeer als verstuurd ziet de OA niets (klaar = niet verstuurd)", (await oaA.listMyTenders()).length === 0 && (await denied(oaA.readMyTender(invA.ref))));
ok(await calc.updateTenderInvite(invA.id, { markSent: ["pdf", "excel", "app"] }));
v1 = ok(await calc.readTender(T1));
const iA = v1.invites.find((i) => i.id === invA.id);
check("(B6) Markeer als verstuurd: gevraagd, met datum en kanalen; kanaal 'fax' geweigerd", "asked" in iA.status && iA.askedDay.length === 1 && S([...iA.channels].sort()) === S(["app", "excel", "pdf"]) && /pdf, excel, app of mail/.test(errOf(await calc.updateTenderInvite(invA.id, { markSent: ["fax"] }))));

// B7. Wat de OA ziet: enkel zijn uitnodiging, het adres volgens de keuze, nooit de klant of een andere firma.
const mineA = await oaA.listMyTenders();
const myA = ok(await oaA.readMyTender(invA.ref));
check("(B7) Mijn prijsvragen: enkel de eigen (verstuurde) prijsvraag", mineA.length === 1 && mineA[0].ref === invA.ref && /^[0-9A-Z]{16}$/.test(invA.ref) && mineA[0].canAnswer && mineA[0].items === 4n);
check("(B7) adres: enkel de gemeente (gekozen): geen straat en nummer", myA.address.street === "" && myA.address.number === "" && myA.address.city === "Hoeveldam" && myA.address.zip === "9991" && mineA[0].place === "9991 Hoeveldam");
check("(B7) contact van BOWACO (de calculator), bericht, deadline, bijlage (enkel het plan), posten zonder id van de offerte", myA.contact.name.length > 0 && myA.noteForOa.includes("Plaatsbezoek") && myA.files.length === 1 && myA.files[0].name === "plan gelijkvloers (proef).pdf" && myA.items.length === 4 && !("lineId" in myA.items[0]) && !("root" in myA.items[0]));
const txtA = S(myA) + S(mineA);
check("(B7) nooit de naam van de klant, een andere firma, de interne notitie of het aantal gevraagde firma's", !txtA.includes("Kievit") && !txtA.includes("Merel") && !txtA.includes("intern: niet voor de OA") && !("invites" in myA) && !txtA.includes("sheetKey"));
check("(B7) M2: in de lijst en de prijsvraag van de OA staat geen enkel id of volgnummer (enkel de willekeurige verwijzing en posities)", idKeys([mineA, myA]).length === 0 && myA.items.map((x) => x.pos).join() === "1,2,3,4" && myA.files[0].pos === 1n, idKeys([mineA, myA]).join());
check("(B7) OA B (gevraagd, nog niet verstuurd) ziet niets; OA C (niet gevraagd) ziet niets; Proef Dak (andere firma) niets", (await oaB.listMyTenders()).length === 0 && (await oaC.listMyTenders()).length === 0 && (await oaDak.listMyTenders()).every((x) => x.inviteId !== invA.id));
ok(await calc.updateTenderInvite(invB.id, { markSent: ["pdf"] }));
check("(B7) OA B ziet enkel zijn eigen uitnodiging, niet die van A (lezen, antwoord, bijlage, bewaren: geweigerd)", (await oaB.listMyTenders()).length === 1 && (await denied(oaB.readMyTender(invA.ref))) && (await denied(oaB.readMyTenderAnswer(invA.ref))) && (await denied(oaB.readTenderFile(invA.ref, 1n))) && (await denied(oaB.saveMyTender(invA.ref, { number: "", quoteDay: [], validUntil: [], discountBp: [], reverse: true, lines: [], remark: "" }, false, 0n))));
check("(B7) OA C (niet gevraagd): elke functie van een uitnodiging geweigerd (geen id-orakel)", (await denied(oaC.readMyTender(invA.ref))) && (await denied(oaC.readMyTender("ZZZZZZZZZZZZZZZZ"))) && (await denied(oaC.readTenderFile(invA.ref, 1n))));
check("(B7) werfleider, architect, klant, VC en kantoor: Mijn prijsvragen geweigerd", (await Promise.all([wl, arch, klant, vc, calc].map((x) => denied(x.listMyTenders())))).every(Boolean));

// B8. Bijlagen (R39).
const fA = ok(await oaA.readTenderFile(invA.ref, 1n));
check("(B8) de OA leest het plan van de prijsvraag (met opslagverwijzing; auditregel), zonder werf, persoon of id van het bestand", fA.name === "plan gelijkvloers (proef).pdf" && idKeys(fA).length === 0 && !("workId" in fA) && !("personId" in fA) && fA.blob.length > 0 && (await admin.auditLog(0n, 40n)).some((e) => e.action === "bekeek:prijsvraag-bijlage"));
check("(B8) een bestand van de werf dat niet aan de prijsvraag hangt, of het vertrouwelijke contract: geweigerd", (await denied(oaA.readTenderFile(invA.ref, 2n))) && (await denied(oaA.readTenderFile(invA.ref, 0n))));
check("(B8) de OA ziet de bestanden van de werf niet (geen lid)", await denied(oaA.listFiles([W1])));

// B9. Ontwerp: enkel zijn firma; kantoor ziet het niet.
const it = myA.items;
const lineIn = (x, unitCents, included = { yes: null }, remark = "") => ({ pos: [x.pos], description: "", unit: "", qtyMilli: 0n, unitCents: opt(unitCents), included, remark });
const draftA = { number: "PROEF-R-1", quoteDay: [], validUntil: [], discountBp: [500n], reverse: true, remark: "verzonnen", lines: [lineIn(it[0], 1234n), lineIn(it[1], 4550n), lineIn(it[2], null, { no: null }), lineIn(it[3], 700n, { alt: "PE-leiding 20 mm" }), { pos: [], description: "Proef aarding meten", unit: "pst", qtyMilli: 1000n, unitCents: [15_000n], included: { yes: null }, remark: "" }] };
const sv = ok(await oaA.saveMyTender(invA.ref, draftA, false, 0n));
const expect = totals([{ itemId: 1n, qtyMilli: 12_000n, unitCents: 1234n, included: Y }, { itemId: 2n, qtyMilli: 8_000n, unitCents: 4550n, included: Y }, { itemId: 3n, qtyMilli: 2_000n, unitCents: null, included: { no: null } }, { itemId: 4n, qtyMilli: 15_250n, unitCents: 700n, included: { alt: "x" } }, { itemId: null, qtyMilli: 1000n, unitCents: 15_000n, included: Y }], 500n, () => "h");
check("(B9) ontwerp bewaard: de server rekent hetzelfde als de browser (tender/calc.ts)", sv.netCents === expect.net && sv.version.length === 0, `${sv.netCents} / ${expect.net}`);
const ansA = ok(await oaA.readMyTenderAnswer(invA.ref));
check("(B9) de OA leest zijn ontwerp terug (VH en eenheid van BOWACO, bedrag per regel gerekend)", ansA.draft.length === 1 && ansA.draft[0].lines.length === 5 && ansA.draft[0].lines[0].qtyMilli === 12_000n && ansA.draft[0].lines[0].amountCents[0] === 14_808n && ansA.draft[0].lines[2].amountCents.length === 0);
check("(B9) kantoor ziet het ontwerp niet: geen OA-offerte, geen weg naar het ontwerp (R38)", ok(await calc.readTender(T1)).invites.find((i) => i.id === invA.id).oaQuotes.length === 0 && (await denied(calc.readMyTenderAnswer(invA.ref))));
check("(B9) OA B ziet het ontwerp van A niet (zijn eigen antwoord is leeg)", ok(await oaB.readMyTenderAnswer(invB.ref)).draft.length === 0);
check("(B9) ongeldig: een post van een andere prijsvraag, een post twee keer, een negatieve prijs, een eigen post zonder omschrijving", /hoort niet bij de prijsvraag/.test(errOf(await oaA.saveMyTender(invA.ref, { ...draftA, lines: [{ ...lineIn(it[0], 1n), pos: [99n] }] }, false, 0n))) && /twee keer/.test(errOf(await oaA.saveMyTender(invA.ref, { ...draftA, lines: [lineIn(it[0], 1n), lineIn(it[0], 2n)] }, false, 0n))) && /0 tot/.test(errOf(await oaA.saveMyTender(invA.ref, { ...draftA, lines: [lineIn(it[0], -1n)] }, false, 0n))) && /omschrijving/.test(errOf(await oaA.saveMyTender(invA.ref, { ...draftA, lines: [{ pos: [], description: " ", unit: "", qtyMilli: 1000n, unitCents: [1n], included: { yes: null }, remark: "" }] }, false, 0n))));
check("(B9) M3: een omschrijving van een eigen post boven 160 tekens, een opmerking boven 500 tekens: geweigerd", /160/.test(errOf(await oaA.saveMyTender(invA.ref, { ...draftA, lines: [{ pos: [], description: "x".repeat(161), unit: "", qtyMilli: 1000n, unitCents: [1n], included: { yes: null }, remark: "" }] }, false, 0n))) && /500/.test(errOf(await oaA.saveMyTender(invA.ref, { ...draftA, lines: [lineIn(it[0], 1n, { yes: null }, "x".repeat(501))] }, false, 0n))));
check("(B9) meer dan 100 eigen posten, korting boven 50 %: geweigerd", /eigen posten|Te veel regels/.test(errOf(await oaA.saveMyTender(invA.ref, { ...draftA, lines: Array.from({ length: 101 }, (_, i) => ({ pos: [], description: `p${i}`, unit: "", qtyMilli: 1000n, unitCents: [1n], included: { yes: null }, remark: "" })) }, false, 0n))) && /Korting/.test(errOf(await oaA.saveMyTender(invA.ref, { ...draftA, discountBp: [6000n] }, false, 0n))));

// B10. Eigen PDF opladen (R39): vertrouwelijk aan de werf; de OA ziet naam en grootte, nooit de verwijzing.
const blobA = new TextEncoder().encode("!caf!sha256:" + "5".repeat(64));
check("(B10) de opslagpoort: een OA met een open uitnodiging (zonder werf) krijgt een uploadcertificaat; OA C (niets open) niet", !(await rejects(oaA._immutableObjectStorageCreateCertificate("sha256:" + "5".repeat(64)))) && (await rejects(oaC._immutableObjectStorageCreateCertificate("sha256:" + "6".repeat(64)))));
check("(B10) enkel een PDF; een foto geweigerd", /Enkel een PDF/.test(errOf(await oaA.addMyTenderFile(invA.ref, "foto.jpg", "image/jpeg", 100n, blobA))));
const upA = ok(await oaA.addMyTenderFile(invA.ref, "offerte Reiger (proef).pdf", "application/pdf", 2048n, blobA));
const ans2 = ok(await oaA.readMyTenderAnswer(invA.ref));
check("(B10) opgeladen: in zijn ontwerp met naam en grootte, zonder opslagverwijzing", upA.name === "offerte Reiger (proef).pdf" && ans2.draft[0].file[0].name === "offerte Reiger (proef).pdf" && ans2.draft[0].file[0].size === 2048n && !("blob" in ans2.draft[0].file[0]));
const exC = ok(await admin.exportChunk("confidentialFiles", 0n, 2000n)).files ?? [];
check("(B10) het bestand is vertrouwelijk aan de werf; het staat niet tussen de losse bestanden (ook niet bij kantoor)", exC.some((f) => f.name === "offerte Reiger (proef).pdf" && f.confidential && f.workId[0] === W1) && !(await calc.listFiles([W1])).some((f) => f.name === "offerte Reiger (proef).pdf") && !(await wl.listFiles([W1])).some((f) => f.name === "offerte Reiger (proef).pdf"));
const upA2 = ok(await oaA.addMyTenderFile(invA.ref, "offerte Reiger v2 (proef).pdf", "application/pdf", 3000n, blobA));
const upA2Id = (ok(await admin.exportChunk("confidentialFiles", 0n, 5000n)).files ?? []).find((f) => f.name === "offerte Reiger v2 (proef).pdf" && f.workId[0] === W1).id;
check("(B10) M1 (R38): kantoor leest de PDF in het ontwerp NIET (calculator en beheerder: zelfde antwoord als een onbekend bestand)", errOf(await calc.readConfidentialFile(upA2Id)) === "Onbekend bestand" && errOf(await admin.readConfidentialFile(upA2Id)) === errOf(await calc.readConfidentialFile(999_999_999n)));
check("(B10) een tweede PDF vervangt de eerste in het ontwerp; het bestand van een OA-offerte archiveer je niet via de losse bestanden", ok(await oaA.readMyTenderAnswer(invA.ref)).draft[0].file[0].name === upA2.name && /OA-offerte/.test(errOf(await admin.archiveFile(upA2Id))));

// B11. Indienen: de server rekent na; kantoor ziet de offerte; een tweede indiening = versie 2.
check("(B11) indienen met een ander totaal dan de server: geweigerd, niets ingediend", /totaal klopt niet/.test(errOf(await oaA.saveMyTender(invA.ref, draftA, true, sv.netCents + 1n))) && ok(await calc.readTender(T1)).invites.find((i) => i.id === invA.id).oaQuotes.length === 0);
const sub1 = ok(await oaA.saveMyTender(invA.ref, draftA, true, sv.netCents));
v1 = ok(await calc.readTender(T1));
const iA1 = v1.invites.find((i) => i.id === invA.id);
check("(B11) ingediend: versie 1, bron app, ontvangen, met de PDF; het ontwerp is weg", sub1.version[0] === 1n && "received" in iA1.status && iA1.answeredAt.length === 1 && iA1.oaQuotes.length === 1 && "app" in iA1.oaQuotes[0].source && iA1.oaQuotes[0].fileId[0] === upA2Id && isOk(await calc.readConfidentialFile(upA2Id)) && ok(await oaA.readMyTenderAnswer(invA.ref)).draft.length === 0);
check("(B11) de calculator krijgt een melding (zonder bedrag)", (await calc.myNotifications(true)).some((n) => n.kind === "prijsvraag-ingediend" && n.text.includes("Reiger") && !/€|\d+,\d\d/.test(n.text)));
const oq1 = iA1.oaQuotes[0].id;
const full1 = ok(await calc.readOaQuote(oq1));
check("(B11) kantoor leest de bedragen (update-call, auditregel bekeek:oa-offerte): netto, korting, regels, totalen per hoofdstuk", full1.netCents === expect.net && full1.discountBp[0] === 500n && full1.lines.length === 5 && S(full1.chapterTotals.map((x) => x[0])) === S(["05 Proef elektriciteit", "06 Proef sanitair", "Eigen posten"]) && "reverse" in full1.quote.vatRegime && (await admin.auditLog(0n, 30n)).some((e) => e.action === `bekeek:oa-offerte:${oq1}` && !/\d{3,}/.test(e.detail.replace(/v\d+/, ""))));
check("(B11) de bedragen: werfleider, OA zelf (via kantoorfunctie), architect, klant geweigerd", (await Promise.all([wl, oaA, arch, klant].map((x) => denied(x.readOaQuote(oq1))))).every(Boolean));
const sub2 = ok(await oaA.saveMyTender(invA.ref, { ...draftA, lines: draftA.lines.slice(0, 2) }, true, totals([{ itemId: 1n, qtyMilli: 12_000n, unitCents: 1234n, included: Y }, { itemId: 2n, qtyMilli: 8_000n, unitCents: 4550n, included: Y }], 500n, () => "").net));
const qs = ok(await calc.readTender(T1)).invites.find((i) => i.id === invA.id).oaQuotes;
check("(B11) opnieuw indienen = versie 2 die versie 1 vervangt (versie 1 blijft in de historiek)", sub2.version[0] === 2n && qs.length === 2 && qs[1].supersedes[0] === oq1 && qs[1].current && !qs[0].current);
check("(B11) de OA ziet zijn eigen ingediende versies met zijn prijzen", ok(await oaA.readMyTenderAnswer(invA.ref)).versions.length === 2 && ok(await oaA.readMyTender(invA.ref)).versions === 2n);

check("(B11) M2: zijn antwoord (ontwerp en versies) draagt geen id: posten als positie, versies als nummer", idKeys(ok(await oaA.readMyTenderAnswer(invA.ref))).length === 0 && ok(await oaA.readMyTenderAnswer(invA.ref)).versions.map((x) => x.version).join() === "1,2" && ok(await oaA.readMyTenderAnswer(invA.ref)).versions[0].lines[0].pos[0] === 1n, idKeys(ok(await oaA.readMyTenderAnswer(invA.ref))).join());
{
  // M3: hoogstens 20 indieningen per firma.
  const small = { ...draftA, discountBp: [], lines: draftA.lines.slice(0, 1) };
  const net = totals([{ itemId: 1n, qtyMilli: 12_000n, unitCents: 1234n, included: Y }], null, () => "").net;
  for (let v = 3; v <= 20; v++) ok(await oaA.saveMyTender(invA.ref, small, true, net));
  check("(B11) M3: hoogstens 20 versies per firma; de 21ste geweigerd (L6: versienummer = hoogste + 1)", /Hoogstens 20 ingediende versies/.test(errOf(await oaA.saveMyTender(invA.ref, small, true, net))) && ok(await oaA.readMyTender(invA.ref)).versions === 20n);
}

// B12. Geen interesse, eigen deadline, verlengen.
ok(await oaB.declineMyTender(invB.ref, "geen tijd (verzonnen)"));
check("(B12) OA B: geen interesse → kantoor ziet de stand en de reden, en krijgt een melding", "declined" in ok(await calc.readTender(T1)).invites.find((i) => i.id === invB.id).status && (await calc.myNotifications(true)).some((n) => n.kind === "prijsvraag-geen-interesse"));
check("(B12) wie al indiende, kan geen 'geen interesse' meer zeggen", /al een offerte/.test(errOf(await oaA.declineMyTender(invA.ref, ""))));
const own = sug.deadlineDay + 7n;
ok(await calc.updateTenderInvite(invB.id, { extend: [own] }));
check("(B12) eigen deadline voor één firma: de OA ziet ze; de andere firma niet", ok(await oaB.readMyTender(invB.ref)).deadlineDay === own && ok(await oaA.readMyTender(invA.ref)).deadlineDay === sug.deadlineDay);
const rev = ok(await calc.readTender(T1)).rev;
check("(B12) verlengen met een oude stand: geweigerd (iemand anders wijzigde)", /laad opnieuw/.test(errOf(await calc.updateTender(T1, rev + 5n, { extend: sug.deadlineDay + 2n }))));
check("(B12) L3: vervroegen geweigerd (prijsvraag en eigen deadline)", /latere datum/.test(errOf(await calc.updateTender(T1, rev, { extend: sug.deadlineDay - 1n }))) && /later vallen/.test(errOf(await calc.updateTenderInvite(invB.id, { extend: [own - 1n] }))) && /minder tijd/.test(errOf(await calc.updateTenderInvite(invB.id, { extend: [] }))));
ok(await calc.updateTender(T1, rev, { extend: sug.deadlineDay + 2n }));
check("(B12) verlengd: de deadline van de prijsvraag schuift (de eigen deadline van B blijft)", ok(await oaA.readMyTender(invA.ref)).deadlineDay === sug.deadlineDay + 2n && ok(await oaB.readMyTender(invB.ref)).deadlineDay === own);

// B13. Firma erbij, annuleren, afsluiten, 90 dagen.
const addC = ok(await calc.addTenderFirm(T1, { orgId: FUUT, contactPersonId: [] }));
ok(await calc.updateTenderInvite(addC, { declined: "telefonisch, vóór het versturen" }));
check("(B13) L1: 'geen interesse' door kantoor vóór het versturen maakt niets zichtbaar voor de OA", !(await oaC.listMyTenders()).some((x) => x.code === v1.code));
{
  // Keuze 5 en L4: de calculator maakt een code enkel voor iemand zonder werf; een ander contact trekt de open code in.
  const LID = await orgOf(`Proef Lid 2c2 ${suffix}`);
  const pLid = await personOf(LID, `Proef Lid ${suffix}`);
  const pVrij = await personOf(LID, `Proef Vrij ${suffix}`);
  ok(await admin.addMembership(W2, [pLid], [], { onderaannemer: null }, []));
  const invL = ok(await calc.addTenderFirm(T1, { orgId: LID, contactPersonId: [pLid] }));
  check("(B13) keuze 5: toegang voor iemand die al lid is van een werf: geweigerd met de weg 'Toegang geven'", /al lid van een werf.*Toegang geven/.test(errOf(await calc.tenderAccess(invL, 0n))));
  ok(await calc.updateTenderInvite(invL, { contact: [pVrij] }));
  const accV = ok(await calc.tenderAccess(invL, 0n));
  const withCode = ok(await calc.readTender(T1)).invites.find((i) => i.id === invL);
  ok(await calc.updateTenderInvite(invL, { contact: [pLid] }));
  const after = ok(await calc.readTender(T1)).invites.find((i) => i.id === invL);
  const stray = await freshBackend(cid);
  check("(B13) L4: een ander contact kiezen trekt de open code in (verwijzing leeg, code onbruikbaar)", withCode.accessCodeId.length === 1 && after.accessCodeId.length === 0 && "err" in (await stray.redeemCode(accV.code[0])));
}
check("(B13) firma erbij terwijl de prijsvraag loopt (dezelfde controlecode); dezelfde firma nog eens: geweigerd", ok(await calc.readTender(T1)).invites.length === 4 && ok(await calc.readTender(T1)).sentHash === v1.sentHash && /al gevraagd/.test(errOf(await calc.addTenderFirm(T1, { orgId: FUUT, contactPersonId: [] }))));
ok(await calc.updateTenderInvite(addC, { markSent: ["mail"] }));
const refC = ok(await calc.readTender(T1)).invites.find((i) => i.id === addC).ref;
check("(B13) OA C ziet nu de prijsvraag aan zijn firma", (await oaC.listMyTenders()).some((x) => x.ref === refC));
const b1 = ok(await calc.readTender(T1b));
ok(await calc.updateTenderInvite(b1.invites[0].id, { markSent: ["pdf"] }));
check("(B13) annuleren vraagt een reden; daarna ziet de OA niets meer", /reden/.test(errOf(await calc.updateTender(T1b, b1.rev, { cancel: "x" }))) && isOk(await calc.updateTender(T1b, b1.rev, { cancel: "proef: niet meer nodig" })) && !(await oaC.listMyTenders()).some((x) => x.ref === b1.invites[0].ref) && (await denied(oaC.readMyTender(b1.invites[0].ref))));
check("(B13) een geannuleerde prijsvraag: niets meer te wijzigen", /geannuleerd/.test(errOf(await calc.updateTenderInvite(b1.invites[0].id, { markSent: ["pdf"] }))));
const rv = ok(await calc.readTender(T1)).rev;
check("(B13) afsluiten met een firma die niet gevraagd is: geweigerd", /niet gevraagd/.test(errOf(await calc.updateTender(T1, rv, { close: [999_999n] }))));
ok(await calc.updateTender(T1, rv, { close: [invA.id, invA.id] })); // L5: dubbel = één keer
const closed = ok(await calc.readTender(T1));
check("(B13) afgesloten: Reiger gekozen, de anderen bedankt", "closed" in closed.status && "chosen" in closed.invites.find((i) => i.id === invA.id).outcome && "thanked" in closed.invites.find((i) => i.id === invB.id).outcome);
const afterA = ok(await oaA.readMyTender(invA.ref));
const afterB = ok(await oaB.readMyTender(invB.ref));
check("(B13) na het afsluiten: elke OA ziet enkel zijn eigen uitkomst, alleen lezen (niet meer indienen of opladen)", "chosen" in afterA.outcome && "thanked" in afterB.outcome && !afterA.canAnswer && !afterA.open && /enkel lezen/.test(errOf(await oaA.saveMyTender(invA.ref, draftA, false, 0n))) && /enkel lezen/.test(errOf(await oaA.addMyTenderFile(invA.ref, "x.pdf", "application/pdf", 10n, blobA))) && !S(afterB).includes("Reiger"));
check("(B13) wie niet gekozen is, ziet niet wie wel (geen naam, geen prijs)", !S(afterB).includes("Reiger") && !S(await oaB.listMyTenders()).includes("Reiger"));

// B14. Export: het domein zit in de bewaarkopie (intern zonder bedragen, vertrouwelijk apart).
const exI = await admin.exportIntern();
check("(B14) export intern: prijsvragen, posten, firma's en OA-offertes, zonder bedragen", exI.tenders.some((x) => x.id === T1) && exI.tenderItems.length >= 4 && exI.tenderInvites.some((x) => x.id === invA.id) && exI.oaQuotes.some((x) => x.id === oq1) && !S(exI.oaQuotes).includes("netCents"));
check("(B14) export vertrouwelijk: bedragen en ontwerpen; enkel de beheerder (calculator en werfleider geweigerd)", isOk(await admin.exportChunk("oaQuoteAmounts", 0n, 50n)) && isOk(await admin.exportChunk("oaQuoteDrafts", 0n, 50n)) && (await Promise.all([calc, wl].map((x) => denied(x.exportChunk("oaQuoteAmounts", 0n, 5n))))).every(Boolean));

// B15. De klokjob: herinnering (één keer) en "geen antwoord" na de deadline; 90 dagen na afsluiten niets meer. Enkel lokaal.
if (local && !process.env.ZONDER_KLOK) {
  const netDir = process.env.BOWACO_NET || join(KEYDIR, "net");
  const descr = join(netDir, ".icp/cache/networks/local/descriptor.json");
  if (!existsSync(descr)) { console.log("· (B15) geen eigen PocketIC-net gevonden: klokproef overgeslagen"); }
  else {
    const advance = async (ns) => {
      const d = JSON.parse(readFileSync(descr, "utf8"));
      if (d["project-dir"] !== netDir) throw new Error("niet ons eigen net");
      const baseUrl = `http://127.0.0.1:${d["pocketic-config-port"]}/instances/${d["pocketic-instance-id"]}`;
      let t = null;
      for (let i = 0; i < 6 && t === null; i++) {
        const j = await (await fetch(`${baseUrl}/read/get_time`)).json().catch(() => ({}));
        if (j && j.nanos_since_epoch !== undefined) t = j.nanos_since_epoch;
        else await new Promise((res) => setTimeout(res, 5000));
      }
      if (t === null) throw new Error("PocketIC gaf geen tijd terug");
      // PocketIC antwoordt 409 als het net net een ronde verwerkt: even later opnieuw.
      let r = null;
      for (let i = 0; i < 10; i++) {
        r = await fetch(`${baseUrl}/update/set_time`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nanos_since_epoch: Number(BigInt(t) + ns) }) });
        if (r.status !== 409) break;
        await new Promise((res) => setTimeout(res, 2000));
      }
      if (!r.ok) throw new Error(`set_time: ${r.status}`);
      await new Promise((res) => setTimeout(res, 1500));
      await resync(...everyone);
    };
    const DAY = 86_400_000_000_000n;
    const waitFor = async (cond, tries = 30) => { for (let i = 0; i < tries; i++) { if (await cond()) return true; await advance(11n * 60n * 1_000_000_000n); } return false; };
    // Een prijsvraag met deadline over 10 werkdagen en een herinnering 3 werkdagen vooraf; Merel gevraagd vandaag.
    const sg = ok(await calc.tenderSuggestions(R1.version.id, [items1[0].id]));
    const T3 = ok(await calc.createTender(base({ title: "Proef klok", lineIds: [items1[0].id], firms: [{ orgId: MEREL, contactPersonId: [] }], deadlineDay: sg.deadlineDay })));
    // L2: een firma die pas na de herinneringsdag gevraagd wordt (herinnering 30 werkdagen vooraf), krijgt geen herinnering.
    const T4 = ok(await calc.createTender(base({ title: "Proef klok laat gevraagd", lineIds: [items1[0].id], firms: [{ orgId: MEREL, contactPersonId: [] }], deadlineDay: sg.deadlineDay, remindDays: 30n })));
    ok(await calc.updateTenderInvite(ok(await calc.readTender(T4)).invites[0].id, { markSent: ["pdf"] }));
    const inv3 = ok(await calc.readTender(T3)).invites[0].id;
    const ref3 = ok(await calc.readTender(T3)).invites[0].ref;
    ok(await calc.updateTenderInvite(inv3, { markSent: ["pdf"] }));
    const days = Number(sg.deadlineDay - ok(await calc.readTender(T3)).invites[0].askedDay[0]);
    // Naar 1 dag vóór de deadline: de herinnering is dan zeker gevallen (3 werkdagen vooraf), de deadline nog niet.
    await advance(BigInt(days - 1) * DAY);
    const rem = await waitFor(async () => "reminded" in ok(await calc.readTender(T3)).invites[0].status);
    check("(B15) klokjob: op de dag van de herinnering → herinnerd, met een melding 'Herinner …' aan de calculator", rem && (await calc.myNotifications(true)).some((n) => n.kind === "prijsvraag-herinner" && n.text.includes("Merel")));
    check("(B15) L2: wie na de herinneringsdag gevraagd werd, krijgt geen herinnering", "asked" in ok(await calc.readTender(T4)).invites[0].status);
    const n1 = (await calc.myNotifications(true)).filter((n) => n.kind === "prijsvraag-herinner" && n.text.includes("Proef klok")).length;
    await advance(30n * 60n * 1_000_000_000n);
    check("(B15) de herinnering valt één keer per firma (een volgende ronde herinnert niet opnieuw)", (await calc.myNotifications(true)).filter((n) => n.kind === "prijsvraag-herinner" && n.text.includes("Proef klok")).length === n1);
    await advance(2n * DAY);
    const none = await waitFor(async () => "noAnswer" in ok(await calc.readTender(T3)).invites[0].status);
    check("(B15) na de deadline zonder antwoord → geen antwoord, met een melding; de OA kan niet meer indienen", none && (await calc.myNotifications(true)).some((n) => n.kind === "prijsvraag-geen-antwoord" && n.text.includes("Proef klok")) && !ok(await oaB.readMyTender(ref3)).canAnswer);
    const rv3 = ok(await calc.readTender(T3)).rev;
    ok(await calc.updateTender(T3, rv3, { extend: ok(await calc.tenderSuggestions(R1.version.id, [])).deadlineDay }));
    check("(B15) verlengen na 'geen antwoord': de firma mag weer antwoorden (stand terug naar herinnerd)", "reminded" in ok(await calc.readTender(T3)).invites[0].status && ok(await oaB.readMyTender(ref3)).canAnswer);
    // 90 dagen na het afsluiten van T1: de OA ziet niets meer.
    check("(B15) kort na het afsluiten ziet de OA zijn uitkomst nog", (await oaA.listMyTenders()).some((x) => x.ref === invA.ref));
    // 91 dagen kosten de canister op het eigen net veel cycles (opslag): eerst bijvullen, anders bevriest hij (IC0207).
    // (Via PocketIC zelf: de icp-cli weigert na het verzetten van de klok, zijn aanvraag "verloopt" dan in het verleden.)
    const topUp = async () => {
      const d = JSON.parse(readFileSync(descr, "utf8"));
      const baseUrl = `http://127.0.0.1:${d["pocketic-config-port"]}/instances/${d["pocketic-instance-id"]}`;
      const r = await fetch(`${baseUrl}/update/add_cycles`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canister_id: Buffer.from(Principal.fromText(cid).toUint8Array()).toString("base64"), amount: 100_000_000_000_000 }) });
      if (!r.ok) console.log(`· bijvullen: ${r.status}`);
    };
    await topUp();
    await advance(91n * DAY);
    await topUp();
    check("(B15) 90 dagen na het afsluiten: niets meer (lijst, lezen, bijlage)", !(await oaA.listMyTenders()).some((x) => x.ref === invA.ref) && (await denied(oaA.readMyTender(invA.ref))) && (await denied(oaA.readTenderFile(invA.ref, 1n))));
  }
} else console.log("· (B15) klokproef enkel op het eigen net (lokaal)");

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
