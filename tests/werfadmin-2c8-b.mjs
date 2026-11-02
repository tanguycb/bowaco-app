// Deel 2 van tests/werfadmin-2c8.mjs: werfvergadering, oplevering, technische fiches, werfcode P.nnn, documentsoorten, export, .did.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { handoverPdf, handoverCode, handoverText } from "../src/frontend/src/pdf/oplevering.ts";
import { fonts } from "./pdf-voorbeeld.mjs";

export async function run(t) {
  const { admin, calc, wl, arch, klant, klantB, vc, oaR, oaM, check, ok, isOk, errOf, denied, un, noMoney, S, fakeBlob, ctx, pass, fail } = t;
  const { W1, W2, REIGER, MEREL, KLANTNAAM, today, sfx, klantId } = ctx;
  const { PDFDocument } = createRequire(join(import.meta.dirname, "../src/frontend/package.json"))("pdf-lib");
  const nextWd = (d) => { let x = BigInt(d); while ((Number(x) + 3) % 7 > 4) x++; return x; };
  const pt = (title, orgId, day = today) => ({ title, orgId: orgId === null ? [] : [orgId], day });
  const tasksOf = async (W) => (await admin.exportIntern()).tasks.filter((x) => x.workId === W && x.archivedAt.length === 0);
  const orgAs = async (x) => x.orgAssignments([], today - 5n, today + 60n);

  // ── 4. Werfvergadering: actiepunten zijn taken ─────────────────────────
  const fMeet = ok(await calc.addFile("proef-verslag-vergadering-2c8.pdf", "application/pdf", 20_000n, fakeBlob("d"), [W1], false));
  const v0 = (await wl.getPlan(W1)).version;
  const m1 = ok(await wl.saveMeeting(W1, { id: [], opId: "", rev: 0n, day: today, attendees: ["Proef Rita (Reiger)", "Proef Jan (architect)"], fileId: [fMeet], note: "", addPoints: [pt("Stopcontacten bijwerken", REIGER, nextWd(today + 3n)), pt("Plan aanpassen", MEREL), pt("Intern opvolgen", null, today - 40n)] }));
  check("(4) werfvergadering met drie actiepunten: de firma die nog niet meewerkt krijgt een waarschuwing", m1.warnings.length === 1 && m1.warnings[0].includes("Merel"), S(m1.warnings));
  const m2 = ok(await admin.saveMeeting(W1, { id: [], opId: "", rev: 0n, day: today, attendees: [], fileId: [], note: "tweede", addPoints: [] }));
  const ml = await wl.listMeetings(W1);
  check("(4) nummering per werf uit de teller: 1 en 2; de nieuwste eerst; het verslag hangt eraan", ml.length >= 2 && ml[0].number === 2n && ml[1].number === 1n && ml[1].fileName === "proef-verslag-vergadering-2c8.pdf" && ml[1].points.length === 3);
  const m3 = ok(await admin.saveMeeting(W2, { id: [], opId: "", rev: 0n, day: today, attendees: [], fileId: [], note: "", addPoints: [] }));
  check("(4) een andere werf telt apart (nummer 1)", (await calc.listMeetings(W2))[0].number === 1n && m3.id !== m1.id);
  const tk = (await tasksOf(W1)).filter((x) => x.templateKey[0] === "actiepunt");
  check("(4) de actiepunten zijn gewone taken (sleutel actiepunt) met de firma als uitvoerder; de planningsversie ging omhoog", tk.length === 3 && tk.filter((x) => x.responsibleOrgId[0] === REIGER).length === 1 && (await wl.getPlan(W1)).version > v0);
  const mineR = (await orgAs(oaR)).filter((a) => a.taskTitle === "Stopcontacten bijwerken");
  check("(4) de OA ziet het actiepunt in Mijn week en kan het bevestigen; geen klantnaam, geen andere punten", mineR.length === 1 && mineR[0].canConfirm !== undefined && !S(await orgAs(oaR)).includes(KLANTNAAM) && !(await orgAs(oaR)).some((a) => a.taskTitle === "Plan aanpassen"));
  check("(4) de firma die niet meewerkt, ziet het punt niet", (await orgAs(oaM)).every((a) => a.taskTitle !== "Plan aanpassen"));
  check("(4) de OA leest de werfvergaderingen niet (en ziet in de planning enkel zijn eigen taak)", (await denied(oaR.listMeetings(W1))) && (await oaR.getPlan(W1)).tasks.every((x) => x.title === "Stopcontacten bijwerken") && !S(await oaR.getPlan(W1)).includes(KLANTNAAM));
  check("(4) de klant en de architect lezen de werfvergaderingen niet", (await denied(klant.listMeetings(W1))) && (await denied(arch.listMeetings(W1))));
  check("(4) bij de vergadering van W2 mag de werfleider van W1 niets", (await denied(wl.listMeetings(W2))) && (await denied(wl.saveMeeting(W2, { id: [], opId: "", rev: 0n, day: today, attendees: [], fileId: [], note: "", addPoints: [] }))));
  check("(4) een bestand van een andere werf of een lege titel wordt geweigerd", /bestand/i.test(errOf(await wl.saveMeeting(W1, { id: [], opId: "", rev: 0n, day: today, attendees: [], fileId: [(ok(await calc.addFile("x.pdf", "application/pdf", 1000n, fakeBlob("e"), [W2], false)))], note: "", addPoints: [] }))) && /Punt/.test(errOf(await wl.saveMeeting(W1, { id: [m2.id], opId: "", rev: 0n, day: today, attendees: [], fileId: [], note: "", addPoints: [pt("  ", null)] }))));
  const m2v = (await wl.listMeetings(W1)).find((x) => x.id === m2.id);
  ok(await wl.saveMeeting(W1, { id: [m2.id], opId: "", rev: m2v.rev, day: today, attendees: [], fileId: [], note: "tweede", addPoints: [pt("Extra punt", REIGER)] }));
  check("(4) punten erbij bij een bestaande vergadering", (await wl.listMeetings(W1)).find((x) => x.id === m2.id).points.length === 1);
  check("(4) review M3: bewaren met een oude rev (de vergadering veranderde intussen) wordt geweigerd", /Iemand anders/.test(errOf(await wl.saveMeeting(W1, { id: [m2.id], opId: "", rev: m2v.rev, day: today, attendees: [], fileId: [], note: "oud", addPoints: [] }))));
  // Review L9: een opId maakt het aanmaken idempotent.
  const op = crypto.randomUUID();
  const mA = ok(await wl.saveMeeting(W1, { id: [], opId: op, rev: 0n, day: today, attendees: [], fileId: [], note: "idempotent", addPoints: [] }));
  const mB = ok(await wl.saveMeeting(W1, { id: [], opId: op, rev: 0n, day: today, attendees: [], fileId: [], note: "idempotent", addPoints: [] }));
  check("(4) review L9: dezelfde opId maakt geen tweede vergadering", mA.id === mB.id && (await wl.listMeetings(W1)).filter((x) => x.note === "idempotent").length === 1);
  check("(4) review M5: de calculator maakt geen vergadering of actiepunt (planningstaken: beheerder of werfleider van de werf)", (await denied(calc.saveMeeting(W1, { id: [], opId: "", rev: 0n, day: today, attendees: [], fileId: [], note: "", addPoints: [] }))) && (await denied(calc.archiveMeeting(m2.id))));
  ok(await admin.archiveMeeting(m2.id));
  check("(4) een gearchiveerde vergadering verdwijnt uit de lijst (de taken blijven in de planning)", !(await wl.listMeetings(W1)).some((x) => x.id === m2.id) && (await tasksOf(W1)).some((x) => x.title === "Extra punt"));
  check("(4) review M6: een actiepunt vóór de start van de werf telt niet mee voor de aangifte", un((await calc.listInsurances([W1], false)).find((i) => i.id === ctx.I1).startDay) === today - 20n);

  // ── 5. Oplevering: restpunten per OA, afronden onder een controlecode ──────
  const fPv = ok(await calc.addFile("proef-pv-2c8.pdf", "application/pdf", 20_000n, fakeBlob("f"), [W1], false));
  const hIn = (o = {}) => ({ id: [], opId: "", rev: 0n, kind: { provisional: null }, day: [today], attendees: ["Proef Rita", "Proef architect Uil"], pvFileId: [fPv], signedFileId: [], note: "INTERNE-NOTITIE-2c8 niet voor de klant", docNote: "Opmerking op het document 2c8", addPoints: [pt("Kraan lekt", REIGER), pt("Verf bijwerken", REIGER, nextWd(today + 7n))], ...o });
  const h1 = ok(await wl.saveHandover(W1, hIn()));
  check("(5) oplevering met twee restpunten voor de OA", h1.warnings.length === 0);
  check("(5) een tweede voorlopige oplevering voor dezelfde werf geweigerd", /al een oplevering/.test(errOf(await wl.saveHandover(W1, hIn({ day: [], attendees: [], pvFileId: [], addPoints: [] })))));
  check("(5) review M5: de calculator bewaart of rondt geen oplevering af", (await denied(calc.saveHandover(W1, hIn({ kind: { final: null } })))) && (await denied(calc.finishHandover(h1.id, 1n, "0".repeat(64)))));
  check("(5) de restpunten zijn taken (sleutel restpunt) en staan bij de OA in Mijn week", (await tasksOf(W1)).filter((x) => x.templateKey[0] === "restpunt").length === 2 && (await orgAs(oaR)).filter((a) => /Kraan lekt|Verf bijwerken/.test(a.taskTitle)).length === 2);
  check("(5) delen of afronden kan niet vóór het afronden", /af/i.test(errOf(await calc.shareHandover(h1.id, true))) && (await calc.listHandovers(W1))[0].openPoints === 2n);
  const doc = ok(await wl.handoverDoc(h1.id));
  check("(5) review M4/L12: het document draagt de opmerking op het document, NIET de interne notitie, en het vakgebied i.p.v. een firmanaam; geen bedrag", doc.points.length === 2 && doc.clientName === KLANTNAAM && noMoney(doc) && doc.docNote === "Opmerking op het document 2c8" && !S(doc).includes("INTERNE-NOTITIE") && !S(doc).includes("Reiger") && doc.points.every((p) => /^onderaannemer/.test(p.who)) && doc.previousControlCode.length === 0);
  const pdfData = { kind: "provisional", workCode: doc.workCode, workName: doc.workName, address: doc.address, client: doc.clientName, architect: doc.architectName, day: "vandaag", dayNum: Number(un(doc.day)), attendees: doc.attendees, points: doc.points.map((p) => ({ title: p.title, who: p.who, due: String(p.day), dueNum: Number(p.day), done: p.done })), docNote: doc.docNote, madeOn: "vandaag" };
  check("(5) review M4: de interne notitie staat niet in de tekst van het document", !handoverText(pdfData).includes("INTERNE-NOTITIE") && handoverText(pdfData).includes("Opmerking op het document 2c8"));
  check("(5) review L4: de vaste tekst van de browser = die van de backend (zelfde hash)", handoverText(pdfData) === doc.controlText);
  const code = await handoverCode(pdfData);
  const bytes = await handoverPdf(pdfData, fonts(), code);
  check("(5) PDF van de oplevering gemaakt (geldig, bladzijden)", (await PDFDocument.load(bytes)).getPageCount() >= 1);
  const fDoc = ok(await calc.addFile("oplevering-2c8.pdf", "application/pdf", BigInt(bytes.length), fakeBlob("1"), [W1], false));
  check("(5) afronden met een foute controlecode, een code van andere gegevens of een niet-PDF geweigerd (review L4)", /controlecode/.test(errOf(await wl.finishHandover(h1.id, fDoc, "xyz"))) && /controlecode klopt niet met de gegevens/.test(errOf(await wl.finishHandover(h1.id, fDoc, "a".repeat(64)))) && /PDF/.test(errOf(await wl.finishHandover(h1.id, ok(await calc.addFile("x.png", "image/png", 100n, fakeBlob("2"), [W1], false)), code))));
  const fin = ok(await wl.finishHandover(h1.id, fDoc, code));
  check("(5) afgerond met openstaande restpunten = met opmerkingen; de controlecode ligt vast", "withRemarks" in fin.status && un(fin.controlCode) === code && fin.openPoints === 2n);
  check("(5) tweemaal afronden of archiveren van een afgeronde oplevering geweigerd", /al afgerond/.test(errOf(await wl.finishHandover(h1.id, fDoc, code))) && /bewaard/.test(errOf(await admin.archiveHandover(h1.id))));
  check("(5) de klant ziet het document nog niet", (await klant.clientSiteAdmin(W1)).handovers.length === 0);
  check("(5) review L12: de architect (lid van de werf) opent het afgeronde opleveringsdocument ook zonder dat kantoor het deelde; geen bedrag", (await arch.clientSiteAdmin(W1)).handovers.length === 1 && noMoney(await arch.clientSiteAdmin(W1)));
  check("(5) de werfleider deelt niet met de klant, kantoor wel", (await denied(wl.shareHandover(h1.id, true))) && isOk(await calc.shareHandover(h1.id, true)));
  const cs = await klant.clientSiteAdmin(W1);
  check("(5) de klant ziet het gedeelde opleveringsdocument met zijn controlecode, zonder bedragen", cs.handovers.length === 1 && cs.handovers[0].controlCode === code && cs.handovers[0].file.name === "oplevering-2c8.pdf" && noMoney(cs));
  check("(5) review M2: de klant van een andere firma op dezelfde werf ziet het opleveringsdocument niet", await denied(klantB.clientSiteAdmin(W1)));
  check("(5) de OA en de architect lezen de opleveringen van kantoor niet (de OA ziet enkel zijn restpunten in de planning)", (await denied(oaR.listHandovers(W1))) && (await denied(oaR.handoverDoc(h1.id))) && (await denied(arch.listHandovers(W1))) && (await denied(vc.handoverDoc(h1.id))));
  // Een restpunt afwerken in de planning: de oplevering telt het mee.
  const kraan = (await tasksOf(W1)).find((x) => x.title === "Kraan lekt");
  const plan = await wl.getPlan(W1);
  const tv = plan.tasks.find((x) => x.id === kraan.id);
  ok(await wl.saveTask(W1, { id: [kraan.id], title: tv.title, note: "", kind: { work: null }, trade: [], responsibleOrgId: [REIGER], status: { done: null }, percent: 100n, start: tv.start, workdays: tv.workdays, leadDays: 0n, orderDay: [], reason: "proef 2c8: afgewerkt" }, plan.version));
  check("(5) een afgewerkt restpunt (taak klaar) telt niet meer als open", (await calc.listHandovers(W1))[0].openPoints === 1n);
  const hNow = (await calc.listHandovers(W1))[0];
  ok(await wl.saveHandover(W1, hIn({ id: [h1.id], rev: hNow.rev, day: [today + 99n], attendees: ["Andere"], pvFileId: [], note: "na afronden", docNote: "WIJZIGING-NA-AFRONDEN", addPoints: [pt("Nog een restpunt", REIGER)] })));
  const hv = (await calc.listHandovers(W1))[0];
  check("(5) na afronden blijven datum, aanwezigen, PV en de opmerking op het document vast; een nieuw restpunt en de interne notitie mogen nog", un(hv.day) === today && hv.attendees.length === 2 && un(hv.pvFileId) === fPv && hv.points.length === 3 && hv.note === "na afronden" && hv.docNote === "Opmerking op het document 2c8");
  check("(5) review L5: de status volgt de open restpunten (met opmerkingen zolang er een open is)", "withRemarks" in hv.status && hv.openPoints === 2n);
  check("(5) review M3: bewaren met de oude rev van de oplevering geweigerd", /Iemand anders/.test(errOf(await wl.saveHandover(W1, hIn({ id: [h1.id], rev: hNow.rev, addPoints: [] })))));
  const h2 = ok(await wl.saveHandover(W1, hIn({ kind: { final: null }, docNote: "", addPoints: [] })));
  const doc2 = ok(await wl.handoverDoc(h2.id));
  const fDoc2 = ok(await calc.addFile("oplevering-def-2c8.pdf", "application/pdf", 5_000n, fakeBlob("3"), [W1], false));
  const fin2 = ok(await wl.finishHandover(h2.id, fDoc2, await handoverCode({ ...pdfData, kind: "final", points: [], docNote: "" })));
  check("(5) definitieve oplevering zonder restpunten = afgerond", "done" in fin2.status && doc2.points.length === 0);
  check("(5) een bestand van de oplevering is niet los te archiveren", /oplevering/i.test(errOf(await calc.archiveFile(fPv))));
  {
    // Review L10: de bestanden van een GEARCHIVEERD record mogen gearchiveerd worden (de vergadering van hierboven).
    const fm = ok(await calc.addFile("proef-verslag-2-2c8.pdf", "application/pdf", 5_000n, fakeBlob("7"), [W1], false));
    const mm = ok(await wl.saveMeeting(W1, { id: [], opId: "", rev: 0n, day: today, attendees: [], fileId: [fm], note: "met bestand", addPoints: [] }));
    const blocked = /werfvergadering/i.test(errOf(await calc.archiveFile(fm)));
    ok(await admin.archiveMeeting(mm.id));
    check("(5) review L10: een bestand van een vergadering is niet los te archiveren, na het archiveren van de vergadering wel", blocked && isOk(await calc.archiveFile(fm)));
  }

  // ── 6. Technische fiches, werfcode P.nnn, documentsoorten ────────────────
  const fSheet = ok(await calc.addFile("proef-fiche-2c8.pdf", "application/pdf", 8_000n, fakeBlob("4"), [], false));
  const fSheet2 = ok(await calc.addFile("proef-fiche-2-2c8.pdf", "application/pdf", 8_000n, fakeBlob("5"), [], false));
  const s1 = ok(await calc.saveTechSheet({ id: [], materialKey: "isolatie", title: "Proef PIR-plaat", fileId: fSheet, supplierOrgId: [] }));
  const s2 = ok(await admin.saveTechSheet({ id: [], materialKey: "dakbedekking", title: "Proef EPDM", fileId: fSheet2, supplierOrgId: [] }));
  check("(6) bibliotheek van fiches: kantoor bewaart; de werfleider leest ze maar bewaart niet", (await wl.listTechSheets(false)).filter((x) => [s1, s2].includes(x.id)).length === 2 && (await denied(wl.saveTechSheet({ id: [], materialKey: "x", title: "x", fileId: fSheet, supplierOrgId: [] }))));
  check("(6) een fiche met een bestand van een werf wordt geweigerd", /zonder werf/.test(errOf(await calc.saveTechSheet({ id: [], materialKey: "x", title: "x", fileId: fPv, supplierOrgId: [] }))));
  ok(await wl.setWorkTechSheets(W1, [s1, s2, s1]));
  check("(6) de werfleider vinkt fiches aan voor het PID van zijn werf (zonder dubbels); van een andere werf niet", (await wl.workTechSheets(W1)).length === 2 && (await denied(wl.setWorkTechSheets(W2, [s1]))));
  ok(await calc.archiveTechSheet(s2));
  check("(6) een gearchiveerde fiche kan niet gekozen worden, een onbekende ook niet", /gearchiveerd/.test(errOf(await wl.setWorkTechSheets(W1, [s2]))) && /Onbekende/.test(errOf(await wl.setWorkTechSheets(W1, [99_999_999n]))));
  const kinds = (await admin.listDocKinds(false)).map((k) => k.key);
  check("(6) vaste documentsoorten erbij: oplevering, vergadering, attest, min-meer, getekend, mail, fiche", ["opleveringsdocument", "werfvergadering-verslag", "verzekering-attest", "min-meer", "getekend-document", "mail", "technische-fiche", "plannen", "oa-offerte", "verzekering"].every((k) => kinds.includes(k)));
  const rates = (await admin.siteAdminSettings()).rates;
  ok(await admin.saveSiteAdminSettings({ codeP: true, rates }));
  const c0 = un(await admin.nextWorkCode());
  const n0 = Number(c0.slice(2));
  const mk = (code, vat = 600n) => admin.createWork({ code, name: "Proef P.nnn 2c8", address: { street: "Proefweg", number: "9", zip: "9994", city: "Hoeveldam", country: "BE" }, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: vat });
  const a = ok(await mk(""));
  const bad = await mk("", 700n);
  const b = ok(await mk(""));
  const c = ok(await mk(`P-HAND${sfx}`));
  const d = ok(await mk(""));
  check("(6) werfcode P.nnn: opeenvolgend uit de teller, een mislukte poging verbruikt geen nummer, een eigen code blijft toegelaten", /^P\.\d{3,}$/.test(c0) && a.code === c0 && !isOk(bad) && b.code === `P.${String(n0 + 1).padStart(3, "0")}` && c.code === `P-HAND${sfx}` && d.code === `P.${String(n0 + 2).padStart(3, "0")}`, `${a.code} ${b.code} ${c.code} ${d.code}`);
  check("(6) bestaande codes blijven (AC-25); de volgende code is het voorstel voor wie een werf maakt", (await admin.listWorks()).some((w) => w.code === `P-WA1${sfx}`) && un(await admin.nextWorkCode()) === `P.${String(n0 + 3).padStart(3, "0")}` && (await denied(calc.nextWorkCode())));
  ok(await admin.saveSiteAdminSettings({ codeP: false, rates }));
  check("(6) instelling uit: een lege code wordt geweigerd; geen voorstel", /Code/.test(errOf(await mk(""))) && un(await admin.nextWorkCode()) === null);
  check("(6) enkel de beheerder bewaart de instellingen; tarief hoogstens 100 ‰; onbekende soort geweigerd", (await denied(calc.saveSiteAdminSettings({ codeP: true, rates: [] }))) && /hoogstens/.test(errOf(await admin.saveSiteAdminSettings({ codeP: false, rates: [["rc10", 200_000n, 0n]] }))) && /Onbekende/.test(errOf(await admin.saveSiteAdminSettings({ codeP: false, rates: [["x", 1n, 0n]] }))));

  // ── 7. .did zonder bedragen, export, audit ──────────────────────────────
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const block = (name) => { const i = did.search(new RegExp(`\\ntype ${name}(__\\d+)? = `)); if (i < 0) return ""; const j = did.indexOf("\ntype ", i + 5); return did.slice(i, j < 0 ? undefined : j); };
  const names = ["InsuranceView", "InsuranceDocView", "MeetingView", "HandoverView", "HandoverDocData", "PointView", "TechSheetView", "ClientSiteView", "ClientAttest", "ClientHandover"];
  check("(7) .did: geen veld met een bedrag, tarief of premie in de weergaven voor werfleider en klant", names.every((n) => block(n) !== "" && !/cents|premium|rateMilli|price/i.test(block(n))), names.filter((n) => block(n) === "" || /cents|premium|rateMilli|price/i.test(block(n))).join(","));
  check("(7) .did: de werfwaarde en premie staan enkel in InsuranceConfView", /cents/i.test(block("InsuranceConfView")));
  check("(7) de weergaven zelf bevatten geen bedrag", noMoney(await calc.listInsurances([W1], false)) && noMoney(await wl.listMeetings(W1)) && noMoney(await wl.listHandovers(W1)) && noMoney(await wl.listTechSheets(false)));
  const part = async (k) => { const r = ok(await admin.exportChunk(k, 0n, 500n)); return Object.values(r)[0]; };
  check("(7) export: verzekeringen, vergaderingen, opleveringen, fiches, fichekeuze; werfwaarde en premie apart (vertrouwelijk)", (await part("insurances")).some((x) => x.id === ctx.I1) && (await part("siteMeetings")).some((x) => x.id === m1.id) && (await part("handovers")).some((x) => x.id === h1.id) && (await part("techSheets")).some((x) => x.id === s1) && (await part("workSheets")).some((x) => x[0] === W1) && (await part("insuranceConf")).some((x) => x[0] === ctx.I1) && (await part("siteNotices")).length >= 2);
  check("(7) de premie staat niet in de interne export", !S(await admin.exportIntern()).includes("premiumNetCents"));
  check("(7) de export van werfwaarde en premie vraagt de beheerder; de calculator mag de export niet", await denied(calc.exportChunk("insuranceConf", 0n, 10n)));
  const log = (await admin.auditLog(0n, 400n)).map((l) => l.action);
  check("(7) auditregels: verzekering, vergadering, oplevering afgerond, deling, fiches, werfcode-instellingen", ["verzekering-gemaakt", "verzekering-premie", "werfvergadering-gemaakt", "oplevering-afgerond", "oplevering-gedeeld", "verzekering-attest-gedeeld", "fiche-gemaakt", "fiches-pid", "werfadmin-instellingen"].every((a) => log.includes(a)));
  check("(7) de auditlog bevat geen bedrag van de premie", !S((await admin.auditLog(0n, 400n)).filter((l) => l.action === "verzekering-premie")).includes("30400"));
  console.log(`\n${pass()} ✓  ${fail()} ✗`);
  process.exitCode = fail() ? 1 : 0;
}
