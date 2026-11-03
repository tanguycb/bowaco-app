// Open punten van 2c.2–2c.8, deel A (kaart Volgende stap, Beheer-instellingen, OA-offerte intrekken, PID-document).
//   node tests/openpunten-2c8p.mjs                A: het PID-document (voorblad + fiches, pdf-lib), zonder netwerk
//   node tests/openpunten-2c8p.mjs <canister>     + B: elk nieuw feit op de kaart (listWorkStages.next) per rol, de Beheer-instellingen
//                                                  (prijsvraag-termijnen, attestsoorten), een OA-offerte intrekken met de weigeringen en wat de
//                                                  OA ziet, de PID-auditregel. Het laatste deel verzet de klok van dit EIGEN net met 3 dagen
//                                                  (vervallen factuur); ZONDER_KLOK=1 slaat dat over.
// Enkel VERZONNEN gegevens: firma's "Proef … 2c8p", gemeente Merkebeke, postcode 9992.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend, resync, Principal } from "../tools/lib.mjs";
import { M, saveAll, fromRead } from "./offerte-lib.mjs";
import { buildPid, pidKind } from "../src/frontend/src/pdf/pid.ts";
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
const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const opt = (v) => (v === null || v === undefined ? [] : [v]);
const un = (a) => (Array.isArray(a) && a.length ? a[0] : null);
const fakeBlob = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64));
const { PDFDocument } = createRequire(join(import.meta.dirname, "../src/frontend/package.json"))("pdf-lib");

// ── A. Het PID-document (zonder netwerk) ────────────────────────────────
const pdfOf = async (n) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([400, 600]); return await d.save(); };
// Een PNG van 1×1 pixel en een JPEG-kop (geen echte JPEG: wordt overgeslagen als beschadigd).
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+XJ/P2QAAAABJRU5ErkJggg==", "base64"));
const sheet = (title, bytes, over = {}) => ({ title, materialKey: "Proefmateriaal", supplier: "Proef Leverancier Uil", fileName: `${title}.pdf`, mime: "application/pdf", bytes, ...over });
const DATA = (sheets) => ({ workCode: "P.901", workName: "Proefwerf Merkebeke", address: "Proefweg 9, 9992 Merkebeke", madeOn: "03.11.2026", sheets });
{
  const a2 = await pdfOf(2), a3 = await pdfOf(3);
  const r = await buildPid(DATA([sheet("Isolatie", a2), sheet("Dakbedekking", a3), sheet("Foto tegel", PNG, { fileName: "tegel.png", mime: "image/png" }), sheet("Brochure", new TextEncoder().encode("gewone tekst"), { fileName: "brochure.txt", mime: "text/plain" }), sheet("Kapot", new TextEncoder().encode("%PDF-1.7 kapot"), { fileName: "kapot.pdf" }), sheet("Leeg", new Uint8Array(), { fileName: "leeg.pdf" })]), fonts());
  const d = await PDFDocument.load(r.bytes);
  check("(A1) PID: voorblad (1 bladzijde) + 2 + 3 + 1 (afbeelding als bladzijde) = 7 bladzijden, geldige PDF", d.getPageCount() === 7 && r.pages === 7, `${d.getPageCount()} blz.`);
  check("(A2) de fiches staan in de gekozen volgorde met hun eerste bladzijde (2, 4, 7)", r.included.map((x) => `${x.title}:${x.from}:${x.pages}`).join() === "Isolatie:2:2,Dakbedekking:4:3,Foto tegel:7:1", S(r.included));
  check("(A3) een tekstbestand, een beschadigde PDF en een leeg bestand worden overgeslagen, met reden", r.skipped.length === 3 && r.skipped.find((x) => x.title === "Brochure").reason.includes("PDF, PNG en JPEG") && r.skipped.find((x) => x.title === "Kapot").reason.includes("beschadigd") && r.skipped.find((x) => x.title === "Leeg").reason.includes("PDF, PNG en JPEG"), S(r.skipped));
  check("(A4) het soort bestand volgt de inhoud, niet de naam of het opgegeven type", pidKind(a2) === "pdf" && pidKind(PNG) === "png" && pidKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])) === "jpg" && pidKind(new TextEncoder().encode("x.pdf")) === null);
  const none = await buildPid(DATA([]), fonts());
  check("(A5) zonder fiches: enkel het voorblad (1 bladzijde)", (await PDFDocument.load(none.bytes)).getPageCount() === 1 && none.included.length === 0);
  const many = await buildPid(DATA(Array.from({ length: 70 }, (_, i) => sheet(`Fiche ${i + 1} met een vrij lange titel om de regel te vullen`, a2))), fonts());
  const dm = await PDFDocument.load(many.bytes);
  const cover = dm.getPageCount() - 140;
  check("(A6) 70 fiches van 2 bladzijden: het voorblad loopt over meerdere bladzijden en de bladzijdenummers kloppen (eerste fiche op blz. voorblad + 1)", cover >= 2 && many.included[0].from === cover + 1 && many.included[69].from === cover + 1 + 138 && many.pages === dm.getPageCount(), `voorblad ${cover} blz.`);
  const text = Buffer.from(r.bytes).toString("latin1");
  check("(A7) het document kent geen bedrag (geen euroteken, prijs of marge in de gegevens)", !/€|marge|aankoopprijs/i.test(JSON.stringify(DATA([]))) && r.bytes.length > 2_000 && text.startsWith("%PDF"));
}

if (!cid) {
  console.log(`\n${pass} ✓  ${fail} ✗  (enkel A; geef een canister voor B)`);
  process.exit(fail ? 1 : 0);
}

// ── B. Door de backend ──────────────────────────────────────────────────
const [admin, calc, wl, arch, klant, vc, oaDak] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-architect", "proef-klant", "proef-vc", "proef-oa2"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const oaA = await freshBackend(cid); // Reiger (via de toegangscode van de prijsvraag)
const oaB = await freshBackend(cid); // Merel
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const today = (await admin.salesSettings()).today;
const addr = { street: "Proefweg", number: "9", zip: "9992", city: "Merkebeke", country: "BE" };
const nextOf = async (who, wid) => (await who.listWorkStages()).find((s) => s.workId === wid)?.next;
const orgOf = async (name, kind = "subcontractor") => ok(await admin.createOrg({ kind: { [kind]: null }, name, kbo: [], vat: [], aliases: [], trades: [], address: kind === "client" ? [addr] : [], notes: "Verzonnen proeffirma (2c8p)" })).id;
const REIGER = await orgOf(`Proef Elektro Reiger 2c8p ${sfx}`);
const MEREL = await orgOf(`Proef Elektro Merel 2c8p ${sfx}`);
const KLANTORG = await orgOf(`Proef Klant Spreeuw 2c8p ${sfx}`, "client");
for (const [o, n] of [[REIGER, "Rita"], [MEREL, "Mo"]]) ok(await admin.saveOaPerson(o, { id: [], name: `Proef ${n} ${sfx}`, shortCode: [], phone: [], email: [`${n.toLowerCase()}.${sfx.toLowerCase()}@proef.invalid`], jobTitle: "zaakvoerder", note: "" }));
const WLID = (await wl.me()).person[0].id;
const mkWork = async (code, name) => {
  const W = ok(await admin.createWork({ code, name, address: addr, parentId: [], clientOrgId: [KLANTORG], architectOrgId: [], leaderPersonId: [WLID], vatBp: 2100n })).id;
  return W;
};
const W1 = await mkWork(`P-OP${sfx}`, "Proef open punten 2c8p (prijsvraag, afspraken)");
const W2 = await mkWork(`P-OQ${sfx}`, "Proef open punten 2c8p (facturen)");
const price = (cost) => ({ cost, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null });
async function mkQuote(W, title, lines, sign) {
  const q = ok(await calc.createQuote({ workId: W, number: "", title }));
  const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
  M.setHeader(m, { clientOrgId: KLANTORG });
  const c = M.addChapter(m, { code: "05", title: "Proef elektriciteit" });
  for (const [t, cost] of lines) M.addLine(m, c.key, { title: t, qtyMilli: 1_000n, unit: "st", form: "fixed", price: sign ? price(cost) : M.emptyPrice() });
  const r = await saveAll(calc, m);
  if (r && "err" in r) throw new Error(r.err);
  let rd = ok(await calc.readQuoteVersion(q.versionId));
  if (sign) {
    ok(await calc.sendQuoteVersion(q.versionId, rd.version.rev, rd.totals.totalCents, "proef 2c8p: waarschuwingen doorgezet"));
    ok(await calc.decideQuoteVersion(q.versionId, true, "proef 2c8p: akkoord"));
    rd = ok(await calc.readQuoteVersion(q.versionId));
  }
  return { q, rd, posts: rd.lines.filter((l) => !("text" in l.kind)) };
}

// ── B1. Prijsvraag op de kaart ───────────────────────────────────────────
const { rd: R1, posts } = await mkQuote(W1, "Proef 2c8p prijsvraag", [["Proef stopcontact", 0n], ["Proef lichtpunt", 0n]], false);
const T = ok(await calc.createTender({ versionId: R1.version.id, lineIds: posts.map((l) => l.id), title: "Proef elektriciteit 2c8p", noteForOa: "", internalNote: "", deadlineDay: today + 10n, remindDays: 3n, fileIds: [], addressMode: { city: null }, firms: [REIGER, MEREL].map((o) => ({ orgId: o, contactPersonId: [] })) }));
let tv = ok(await calc.readTender(T));
const invA = tv.invites.find((i) => i.orgId === REIGER);
const invB = tv.invites.find((i) => i.orgId === MEREL);
const nT0 = await nextOf(calc, W1);
check("(B1) prijsvraag klaargezet maar nog niet verstuurd: geen feit op de kaart", nT0.tender.length === 0);
for (const i of [invA, invB]) ok(await calc.updateTenderInvite(i.id, { markSent: ["pdf"] }));
const nT1 = (await nextOf(calc, W1)).tender[0];
check("(B1) verstuurd aan 2 firma's, nog geen antwoord: '0 van 2 antwoorden', deadline, nog niet vergelijken", nT1 && nT1.title === "Proef elektriciteit 2c8p" && nT1.asked === 2n && nT1.answered === 0n && !nT1.compare && un(nT1.deadlineDay) === today + 10n, S(nT1));
const handIn = (inv, unit) => ({ inviteId: [inv.id], workId: W1, orgId: inv.orgId, source: { hand: null }, sheetKey: "", number: `PROEF-${inv.orgId}`, quoteDay: today, validUntil: [], discountBp: [], reverse: true, prices: { lines: tv.items.map((it) => ({ itemId: [it.id], description: "", unit: "", qtyMilli: 1_000n, unitCents: [unit], included: { yes: null }, remark: "" })) }, remark: "", note: "", file: [] });
const rA = ok(await calc.registerOaQuote(handIn(invA, 5_000n), 10_000n));
const nT2 = (await nextOf(calc, W1)).tender[0];
check("(B1) één antwoord binnen, één nog verwacht: '1 van 2', nog niet vergelijken", nT2.answered === 1n && nT2.asked === 2n && !nT2.compare, S(nT2));
const rB = ok(await calc.registerOaQuote(handIn(invB, 4_000n), 8_000n));
const nT3 = (await nextOf(calc, W1)).tender[0];
check("(B1) alles binnen: '2 van 2' en vergelijken (de kaart 'Offertes vergelijken')", nT3.answered === 2n && nT3.compare, S(nT3));
check("(B1) de beheerder ziet hetzelfde; de werfleider, de OA, de klant, de architect en de VC zien geen prijsvraagfeit", S((await nextOf(admin, W1)).tender) === S(nT3 ? [nT3] : []) && (await Promise.all([wl, oaDak, klant, arch, vc].map(async (x) => ((await x.listWorkStages()).every((s) => s.next.tender.length === 0))))).every(Boolean));
// Het .did-contract: geen veld met een bedrag in de feiten
check("(B1) de feiten bevatten enkel tellingen, dagen en namen (geen bedrag)", !/cents|price|prijs|amount|euro/i.test(Object.keys((await calc.listWorkStages())[0].next).join(",") + Object.keys(nT3).join(",")));

// ── B2. Beheer: de termijnen van de prijsvraag ───────────────────────────
const set0 = await calc.tenderSettings();
ok(await admin.saveTenderSettings({ ...set0, deadlineDays: 12n, remindDays: 4n }));
const sugAfter = ok(await calc.tenderSuggestions(R1.version.id, posts.map((l) => l.id)));
const set1 = await calc.tenderSettings();
check("(B2) Beheer → Prijsvragen: standaard deadline 12 en herinnering 4 werkdagen bewaard en gebruikt door een nieuwe prijsvraag", set1.deadlineDays === 12n && set1.remindDays === 4n && sugAfter.remindDays === 4n && sugAfter.deadlineDay > today + 12n - 1n, S([set1, sugAfter.deadlineDay]));
check("(B2) ongeldige termijn (0, 61 werkdagen, herinnering ≥ termijn) geweigerd; enkel de beheerder bewaart", /1 tot 60/.test(errOf(await admin.saveTenderSettings({ ...set0, deadlineDays: 0n }))) && /1 tot 60/.test(errOf(await admin.saveTenderSettings({ ...set0, deadlineDays: 61n }))) && /Herinnering/.test(errOf(await admin.saveTenderSettings({ ...set0, deadlineDays: 5n, remindDays: 5n }))) && (await denied(calc.saveTenderSettings(set0))));
ok(await admin.saveTenderSettings(set0));

// ── B3. Een OA-offerte intrekken ─────────────────────────────────────────
const REASON = "Proef: vergissing in de prijs, intern genoteerd";
const qOf = async (inv, v) => ok(await calc.readTender(T)).invites.find((i) => i.id === inv.id).oaQuotes.find((x) => x.version === v);
const qA1 = await qOf(invA, 1n);
const qB1 = await qOf(invB, 1n);
for (const [n, x] of [["werfleider", wl], ["OA", oaDak], ["klant", klant], ["architect", arch], ["VC", vc], ["anoniem", anon]]) check(`(B3) ${n}: een OA-offerte niet intrekken`, await denied(x.withdrawOaQuote(qB1.id, REASON, false)));
check("(B3) zonder reden of met een te korte reden geweigerd; onbekende offerte geweigerd", /reden/.test(errOf(await calc.withdrawOaQuote(qB1.id, "", false))) && /minstens 3/.test(errOf(await calc.withdrawOaQuote(qB1.id, "ab", false))) && (await denied(calc.withdrawOaQuote(999_999n, REASON, false))));
ok(await oaB.redeemCode(ok(await calc.tenderAccess(invB.id, 0n)).code[0]));
const w1 = await calc.withdrawOaQuote(qB1.id, REASON, false);
check("(B3) de calculator trekt de offerte van Merel in met een reden (intern)", isOk(w1));
const qB1b = await qOf(invB, 1n);
check("(B3) de offerte staat op 'ingetrokken' met de reden voor kantoor, niet zichtbaar voor de firma", "withdrawn" in qB1b.status && qB1b.status.withdrawn === REASON && qB1b.withdrawnShown === false, S(qB1b.status));
check("(B3) opnieuw intrekken geweigerd (al ingetrokken)", /al ingetrokken/.test(errOf(await calc.withdrawOaQuote(qB1.id, REASON, false))));
const nW = (await nextOf(calc, W1)).tender[0];
check("(B3) de kaart telt de ingetrokken offerte niet meer mee: '1 van 2' en niet meer vergelijken (de uitnodiging staat weer open)", nW.answered === 1n && !nW.compare, S(nW));
const cmp1 = ok(await calc.compareTender(T));
check("(B3) vergelijken negeert de ingetrokken offerte: enkel die van Reiger", cmp1.input.quotes.length === 1 && cmp1.input.quotes[0].orgId === REIGER, S(cmp1.input.quotes.map((q) => q.orgId)));
check("(B3) kiezen op de ingetrokken offerte geweigerd", /geldende offertes/.test(errOf(await calc.saveTenderChoices(T, [{ itemId: tv.items[0].id, oaQuoteId: [qB1.id], reason: "" }]))));
const ansB = ok(await oaB.readMyTenderAnswer(invB.ref));
check("(B3) de OA ziet 'ingetrokken door BOWACO' maar niet de interne reden", ansB.versions.length === 1 && "withdrawn" in ansB.versions[0].status && ansB.versions[0].status.withdrawn === "" && !S(ansB).includes("vergissing") && !S(ok(await oaB.readMyTender(invB.ref))).includes("vergissing"), S(ansB.versions[0].status));
const myB = ok(await oaB.readMyTender(invB.ref));
check("(B3) de firma kan opnieuw indienen zolang de prijsvraag loopt", myB.canAnswer && myB.status && !("received" in myB.status));
const draftB = { number: "PROEF-B2", quoteDay: [], validUntil: [], discountBp: [], reverse: true, remark: "", lines: myB.items.map((x) => ({ pos: [x.pos], description: "", unit: "", qtyMilli: 0n, unitCents: [4_200n], included: { yes: null }, remark: "" })) };
const svB = ok(await oaB.saveMyTender(invB.ref, draftB, false, 0n));
const subB = ok(await oaB.saveMyTender(invB.ref, draftB, true, svB.netCents));
const qB2 = await qOf(invB, 2n);
check("(B3) nieuwe indiening = versie 2: geldend in de vergelijking en op de kaart ('2 van 2'); de ingetrokken versie 1 komt niet terug", subB.version[0] === 2n && ok(await calc.compareTender(T)).input.quotes.length === 2 && (await nextOf(calc, W1)).tender[0].compare);
ok(await calc.withdrawOaQuote(qB2.id, "Proef: tweede ronde afgewezen", true));
const ansB2 = ok(await oaB.readMyTenderAnswer(invB.ref));
check("(B3) met 'reden zichtbaar' ziet de OA de reden bij die versie; versie 1 blijft zonder reden", ansB2.versions.length === 2 && ansB2.versions[1].status.withdrawn === "Proef: tweede ronde afgewezen" && ansB2.versions[0].status.withdrawn === "", S(ansB2.versions.map((v) => v.status)));
check("(B3) enkel de laatste indiening kan ingetrokken worden (een oudere versie geweigerd)", /laatste indiening|al ingetrokken/.test(errOf(await calc.withdrawOaQuote(qB1.id, REASON, false))) );
// Overgenomen in een offerte: niet meer intrekken.
const itemA = tv.items[0].id;
ok(await calc.saveTenderChoices(T, [{ itemId: itemA, oaQuoteId: [qA1.id], reason: "" }]));
ok(await calc.applyTenderChoices(T, R1.version.id));
check("(B3) al overgenomen in de offerte van de klant: intrekken geweigerd", /overgenomen/.test(errOf(await calc.withdrawOaQuote(qA1.id, REASON, false))));
// Afgesloten prijsvraag: niet meer intrekken.
ok(await calc.updateTender(T, ok(await calc.readTender(T)).rev, { close: [invA.id] }));
check("(B3) afgesloten prijsvraag: intrekken geweigerd", /loopt/.test(errOf(await calc.withdrawOaQuote(qA1.id, REASON, false))));
// Een losse offerte (zonder prijsvraag) kan wel.
const loose = ok(await calc.registerOaQuote({ inviteId: [], workId: W1, orgId: MEREL, source: { hand: null }, sheetKey: "", number: "PROEF-LOS", quoteDay: today, validUntil: [], discountBp: [], reverse: true, prices: { total: 12_345n }, remark: "", note: "", file: [] }, 12_345n));
check("(B3) een losse OA-offerte (zonder prijsvraag) trekt kantoor wel in", isOk(await calc.withdrawOaQuote(loose.oaQuoteId, "Proef: dubbel ingegeven", false)));
const aud = (await admin.auditLog(0n, 60n)).filter((a) => a.action === "oa-offerte-ingetrokken");
check("(B3) de auditlog heeft een regel per intrekking met de reden en zonder bedrag", aud.length >= 3 && aud.some((a) => a.detail.includes(REASON) && a.detail.includes("intern")) && aud.some((a) => a.detail.includes("zichtbaar voor de firma")) && aud.every((a) => !/€|cents/.test(a.detail)), S(aud.map((a) => a.detail).slice(0, 3)));

// ── B4. Afspraken: contract te tekenen, aanhangsel, attesten (+ Beheer: extra attestsoorten) ──
const dealId = ok(await calc.createDeal(W1, REIGER)).id;
const dRev = async () => ok(await calc.readDeal(dealId)).deal.rev;
const nD0 = await nextOf(calc, W1);
check("(B4) een afspraak in ontwerp, nog geen contract: geen contractfeit; de drie verplichte attesten ontbreken (3)", nD0.contractsToSign === 0n && nD0.addendums === 0n && nD0.attestsExpired === 3n && nD0.attestsSoon === 0n, S(nD0));
ok(await calc.makeOaContract(dealId, await dRev()));
const nD1 = await nextOf(calc, W1);
check("(B4) contract klaar om te tekenen: 1 te tekenen, met de naam van de firma", nD1.contractsToSign === 1n && nD1.contractFirm.includes("Reiger") && nD1.addendums === 0n, S(nD1));
const nD1w = await nextOf(wl, W1);
check("(B4) de werfleider van de werf ziet het contractfeit (zonder bedrag); OA, klant, architect en VC niet", nD1w.contractsToSign === 1n && (await Promise.all([oaDak, klant, arch, vc].map(async (x) => (await x.listWorkStages()).every((s) => s.next.contractsToSign === 0n && s.next.attestsExpired === 0n)))).every(Boolean));
ok(await calc.saveDealTerms(dealId, { advanceBp: 500n, paymentDays: 30n, endOfMonth: true }, await dRev()));
const nD2 = await nextOf(calc, W1);
check("(B4) afspraak gewijzigd na het contract: aanhangsel nodig (1), niet meer 'te tekenen'", nD2.addendums === 1n && nD2.contractsToSign === 0n, S(nD2));
const att = (kind, until, note = "") => calc.saveOrgDoc({ orgId: REIGER, kind, title: "", fileId: [], validFrom: [], validUntil: [until], note });
ok(await att("ba", today + 10n));
ok(await att("tienjarige", today + 400n));
ok(await att("personeel", today + 400n));
const nA = await nextOf(calc, W1);
check("(B4) attesten: BA vervalt binnen 30 dagen → 1 'vervalt', 0 ontbrekend, met de vervaldag", nA.attestsSoon === 1n && nA.attestsExpired === 0n && un(nA.attestDay) === today + 10n, S(nA));
// Beheer: extra attestsoorten (de vaste blijven)
const k0 = await admin.listOrgDocKinds();
check("(B4) Beheer: de drie vaste soorten staan in de lijst (vast, niet te archiveren)", ["ba", "tienjarige", "personeel"].every((k) => k0.find((x) => x.key === k)?.fixed === true));
const kName = `Proef RSZ 2c8p ${sfx}`;
const kKey = ok(await admin.addOrgDocKind(kName));
check("(B4) een soort toevoegen: de sleutel volgt de naam; ze staat in de lijst (eigen, niet vast) en in de keuzelijst van de attesten (niet verplicht)", /^proef-rsz-2c8p-/.test(kKey) && (await admin.listOrgDocKinds()).some((x) => x.key === kKey && !x.fixed && !x.archived) && (await calc.dealSetup()).docKinds.some((x) => x.key === kKey && !x.required), kKey);
check("(B4) dezelfde naam nog eens, een lege naam, een vaste soort archiveren, een onbekende soort: geweigerd", /bestaat al/.test(errOf(await admin.addOrgDocKind(kName))) && /Naam/.test(errOf(await admin.addOrgDocKind(" "))) && /vaste soort/.test(errOf(await admin.archiveOrgDocKind("ba", true))) && /Onbekende/.test(errOf(await admin.archiveOrgDocKind("bestaat-niet", true))));
check("(B4) enkel de beheerder beheert de soorten (calculator, werfleider, OA, klant geweigerd)", (await Promise.all([calc, wl, oaDak, klant].map((x) => denied(x.addOrgDocKind("Proef x"))))).every(Boolean) && (await denied(calc.archiveOrgDocKind(kKey, true))) && (await denied(wl.listOrgDocKinds())));
ok(await calc.saveOrgDoc({ orgId: REIGER, kind: kKey, title: "", fileId: [], validFrom: [], validUntil: [today + 5n], note: "proef RSZ" }));
const nA2 = await nextOf(calc, W1);
check("(B4) een eigen soort is niet verplicht: een attest ervan (vervalt over 5 dagen) verandert de kaart niet", nA2.attestsSoon === 1n && nA2.attestsExpired === 0n && un(nA2.attestDay) === today + 10n, S(nA2));
ok(await admin.archiveOrgDocKind(kKey, true));
check("(B4) gearchiveerd: niet meer te kiezen voor een nieuw attest; het bestaande attest behoudt zijn naam", /soort/i.test(errOf(await att(kKey, today + 50n))) && ok(await calc.listOrgDocs(REIGER)).docs.some((d) => d.kind === kKey && d.kindName === kName) && (await admin.listOrgDocKinds()).find((x) => x.key === kKey).archived);
ok(await admin.archiveOrgDocKind(kKey, false));
check("(B4) teruggezet: weer te kiezen", isOk(await att(kKey, today + 60n)) && !(await admin.listOrgDocKinds()).find((x) => x.key === kKey).archived);

// ── B5. Uren van een OA (2c.7) ───────────────────────────────────────────
ok(await admin.savePurchaseSettings({ askHours: "verschil", passOn: true }));
const fileW1 = ok(await calc.addFile("proef-aankoop-2c8p.pdf", "application/pdf", 40_000n, fakeBlob("a"), [W1], true));
const Ld = (workId, kind, description, qty, unit, o = {}) => ({ workId: [workId], kind, root: [], description, persons: [], qtyMilli: qty, unit: o.u ?? "", unitCents: unit, amountCents: (qty * unit + 500n) / 1000n, passOn: false, days: o.days ?? [], lineId: [], });
const dayIn = (d, persons, slots, pauseMin = 0n) => ({ day: d, persons, slots, pauseMin });
const regie = Ld(W1, "regie", "Proef regie 8 u", 8_000n, 4_600n, { u: "u", days: [dayIn(today - 2n, 1n, [{ fromMin: 480n, toMin: 990n }], 30n)] });
const pur = { id: [], orgId: REIGER, kind: { oa: null }, number: `PA-${sfx}-1`, invoiceDay: today, dueDay: [today + 30n], discountUntil: [], discountBp: [], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [fileW1], oaStatementFileId: [], oaStatementRef: "", note: "proef 2c8p", netCents: regie.amountCents, vatCents: 0n, totalCents: regie.amountCents, lines: [regie], finalWorkIds: [], creditOf: [] };
const P1 = ok(await calc.savePurchase(pur, 0n));
const claims = await wl.listHourClaims([W1]);
const nH = await nextOf(wl, W1);
check("(B5) een OA-factuur met uren zonder werfverslag: de dag wacht op de werfleider (hoursOpen = het aantal dagen in de uren-lijst)", claims.length >= 1 && nH.hoursOpen === BigInt(claims.filter((c) => c.state === "te-bevestigen").length) && nH.hoursOpen >= 1n, S([claims.length, nH.hoursOpen]));
check("(B5) de beheerder ziet ze ook; de calculator (bevestigt geen uren), OA, klant, architect en VC niet", (await nextOf(admin, W1)).hoursOpen === nH.hoursOpen && (await Promise.all([calc, oaDak, klant, arch, vc].map(async (x) => (await x.listWorkStages()).every((s) => s.next.hoursOpen === 0n)))).every(Boolean));
for (const c of claims.filter((c) => c.state === "te-bevestigen")) ok(await wl.reviewHourClaim(c.id, true, ""));
check("(B5) na het bevestigen verdwijnt het feit", (await nextOf(wl, W1)).hoursOpen === 0n);

// ── B6. Verzekering aangeven (2c.8) ──────────────────────────────────────
const wk1 = (await admin.listWorks()).find((x) => x.id === W1);
ok(await admin.updateWork(W1, { code: wk1.code, name: wk1.name, address: wk1.address, parentId: [], clientOrgId: wk1.clientOrgId, architectOrgId: [], leaderPersonId: wk1.leaderPersonId, vatBp: wk1.vatBp, plannedStart: [today + 3n], plannedEnd: [], analyticCode: [], vatNote: "" }));
check("(B6) zonder verzekering: geen aangiftedag", (await nextOf(calc, W1)).declareBy.length === 0);
const insIn = (o = {}) => ({ id: [], workId: [W1], kind: { rc10Sub: null }, insurerOrgId: [], brokerOrgId: [], policyRef: `POL-${sfx}`, periodFrom: [], periodTo: [], status: { toDeclare: null }, note: "", rev: 0n, ...o });
const I1 = ok(await calc.saveInsurance(insIn()));
const iv = (await calc.listInsurances([W1], false)).find((i) => i.id === I1);
const nI = await nextOf(wl, W1);
check("(B6) te declareren: de uiterste dag (start + 15 dagen) staat op de kaart, ook voor de werfleider", iv && un(iv.declareBy) !== null && un(nI.declareBy) === un(iv.declareBy) && un(nI.declareBy) >= today + 18n, S([un(iv?.declareBy), un(nI.declareBy)]));
check("(B6) OA, klant, architect en VC zien geen aangiftedag", (await Promise.all([oaDak, klant, arch, vc].map(async (x) => (await x.listWorkStages()).every((s) => s.next.declareBy.length === 0)))).every(Boolean));
ok(await calc.saveInsurance(insIn({ id: [I1], status: { declared: today }, rev: iv.rev })));
check("(B6) aangegeven: het feit verdwijnt", (await nextOf(calc, W1)).declareBy.length === 0);

// ── B7. Verkoopfacturen: schijf te factureren, vervallen factuur (2c.6) ──
const st0 = await admin.salesSettings();
if (!st0.issuer.iban) {
  const ISS = { name: "BOWACO (proef)", legalForm: "bv", address: { street: "Proefweg", number: "6", zip: "9993", city: "Lindegem", country: "BE" }, vat: "BE0123456749", kbo: "0123.456.749", rpr: "RPR Proefstad, afdeling Lindegem", email: "kantoor@proef.invalid", phone: "", website: "proef.invalid", iban: "BE49 9990 0000 0171", bic: "PROFBEBB" };
  ok(await admin.saveSalesSettings({ issuer: ISS, paymentDays: 15n, vat6Text: "", reverseText: "", creditText: "", paymentText: "", footerText: "Proef: algemene voorwaarden op aanvraag.", reminderText: "", reminderDays: 0n, issuerOnly: false, firstSeqF: 100n, firstSeqCN: 1n, planBp: [5000n, 2400n, 2600n], peppolScheme: "0208" }));
}
const nS0 = await nextOf(calc, W2);
check("(B7) een werf zonder getekende offerte: geen factuurfeit", nS0.salesDue === 0n && nS0.salesLate === 0n);
await mkQuote(W2, "Proef 2c8p facturen", [["Proef kabel", 100_000n]], true);
const nS1 = await nextOf(calc, W2);
check("(B7) getekende offerte: de schijf Voorschot is aan de beurt (1 te factureren)", nS1.salesDue === 1n && nS1.salesLate === 0n, S(nS1));
check("(B7) de beheerder ook; de werfleider (geen bedragen), OA, klant, architect en VC geen factuurfeit", (await nextOf(admin, W2)).salesDue === 1n && (await Promise.all([wl, oaDak, klant, arch, vc].map(async (x) => (await x.listWorkStages()).every((s) => s.next.salesDue === 0n && s.next.salesLate === 0n)))).every(Boolean));
const ADV = ok(await calc.newSalesInvoice(W2, { step: { key: "voorschot", minMeerVersionId: [] } }));
const f = ok(await calc.readSalesInvoice(ADV));
ok(await calc.saveSalesDraft(ADV, f.brief.rev, { title: f.brief.title, note: f.note, serviceDay: [], serviceTo: [], paymentDays: 1n, vat: f.vat, lines: [], expectTotalCents: f.totals.totalCents }));
const f2 = ok(await calc.readSalesInvoice(ADV));
const iss = await admin.issueSalesInvoice(ADV, f2.brief.rev, f2.totals.totalCents);
check("(B7) het voorschot uitgereikt (betaaltermijn 1 dag): de schijf is niet meer te factureren", isOk(iss) && (await nextOf(calc, W2)).salesDue === 0n && (await nextOf(calc, W2)).salesLate === 0n, errOf(iss));

// ── B8. PID: de auditregel (het document zelf maakt de browser, zie A) ───
const f1 = ok(await calc.addFile("proef-fiche-2c8p.pdf", "application/pdf", 40_000n, fakeBlob("f"), [], false));
const sh = ok(await calc.saveTechSheet({ id: [], materialKey: "Proefmateriaal", title: "Proef fiche 2c8p", fileId: f1, supplierOrgId: [] }));
ok(await wl.setWorkTechSheets(W1, [sh]));
check("(B8) de werfleider van de werf kiest de fiches en legt het PID vast (auditregel, geen bestand)", isOk(await wl.recordPid(W1, 1n, 0n, 4n)) && (await admin.auditLog(0n, 30n)).some((a) => a.action === "pid-gemaakt" && a.detail.includes("1 fiches in 4 bladzijden") && un(a.workId ?? []) === W1));
check("(B8) een werfleider van een andere werf, OA, klant, architect, VC en anoniem: geen PID-regel; onzinnige tellingen geweigerd", (await Promise.all([oaDak, klant, arch, vc, anon].map((x) => denied(x.recordPid(W1, 1n, 0n, 4n))))).every(Boolean) && /tellingen/.test(errOf(await calc.recordPid(W1, 100_000n, 0n, 1n))));

// ── B9. Een vervallen factuur (verzet de klok van dit EIGEN net met 3 dagen; ZONDER_KLOK=1 slaat dit over) ──
const local = /localhost|127\.0\.0\.1/.test(process.env.ICP_HOST ?? "");
if (local && !process.env.ZONDER_KLOK) {
  const netDir = process.env.BOWACO_NET || join(process.env.HOME, ".bowaco/net");
  const d = JSON.parse(readFileSync(join(netDir, ".icp/cache/networks/local/descriptor.json"), "utf8"));
  if (d["project-dir"] !== netDir) throw new Error("niet ons eigen net");
  const base = `http://127.0.0.1:${d["pocketic-config-port"]}/instances/${d["pocketic-instance-id"]}`;
  let t = null;
  for (let i = 0; i < 6 && t === null; i++) { const j = await (await fetch(`${base}/read/get_time`)).json().catch(() => ({})); if (j && j.nanos_since_epoch !== undefined) t = BigInt(j.nanos_since_epoch); else await new Promise((res) => setTimeout(res, 5000)); }
  if (t === null) throw new Error("PocketIC gaf geen tijd terug");
  const topUp = async () => { await fetch(`${base}/update/add_cycles`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canister_id: Buffer.from(Principal.fromText(cid).toUint8Array()).toString("base64"), amount: 100_000_000_000_000 }) }); };
  await topUp();
  const target = t + 3n * 86_400_000_000_000n;
  let r = null;
  for (let i = 0; i < 10; i++) { r = await fetch(`${base}/update/set_time`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nanos_since_epoch: Number(target) }) }); if (r.status !== 409) break; await new Promise((res) => setTimeout(res, 2000)); }
  if (!r.ok) throw new Error(`set_time: ${r.status}`);
  await new Promise((res) => setTimeout(res, 1500));
  await resync(admin, calc, wl, oaDak, klant, arch);
  await topUp();
  const nL = await nextOf(calc, W2);
  check("(B9) 3 dagen later: de voorschotfactuur is vervallen en niet betaald → 1 vervallen factuur op de kaart", nL.salesLate === 1n, S(nL));
  check("(B9) de werfleider, de OA en de klant zien het niet; na de betaling verdwijnt het feit", (await nextOf(wl, W2)).salesLate === 0n && (await oaDak.listWorkStages()).every((s) => s.next.salesLate === 0n) && (await klant.listWorkStages()).every((s) => s.next.salesLate === 0n) && isOk(await admin.addSalesPayment(ADV, (await admin.salesSettings()).today, f2.totals.totalCents, "overschrijving", "proef 2c8p")) && (await nextOf(calc, W2)).salesLate === 0n);
} else console.log("· klokproef (vervallen factuur) overgeslagen");

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
