// Stap 2c.9 (stap 8): ÉÉN werf volledig voor de demo (plan van tools/inrichting/lees-werf.py, stap8-werf-<code>.json):
//   1. documentsoorten die nog ontbreken (setDocKind) en de eenheden van de offerte (setLibraryUnit);
//   2. de firma's uit de documenten van de werf (importOrgs, zoals stap 2) en een plaatshouder voor de klant (createOrg);
//   3. de werf (createWork met code, adres, klant; status "aanvraag") met "nog na te kijken";
//   4. de offerte(s) als ONTWERP (createQuote + saveQuoteDraft/saveQuoteForm met de rekenmodule van de browser);
//   5. ALLE documenten: per (soort, map) een document in het dossier (saveDocument), elk bestand opgeladen (op live),
//      geregistreerd (addFile) en aan het document gehangen (attachDocumentFile).
// Herhaalbaar: werf op code, firma's op KBO/naam, klant op naam, offerte op nummer, document op (soort, titel), bestand op
// (document, naam, grootte) en, waar de verwijzing zichtbaar is, op de hash van de opslag.
// Opladen: lokaal is er geen opslagdienst. Dan registreert de echte run elk bestand met de verwijzing die live zou krijgen
// (dezelfde hash, berekend zonder upload), zodat alles behalve de blob getest is. Op live (JA_EIGENAAR=1, inrichting-live,
// --project) laadt hij elk bestand op met StorageClient, hoogstens 3 tegelijk; een logboek per canister onthoudt wat al
// opgeladen is, zodat een run na een fout hervat zonder opnieuw op te laden. Een draft krijgt nooit een echt bestand.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { isLiveCanister, LIVE_ID } from "../lib.mjs";
import { blobHash, blobRef, refText, storageClientInrichting } from "../opslag.mjs";
import { isLocal, ok, opt, pool, NAKIJKEN } from "./lib.mjs";
import { REGELS, raming, euro } from "./zuinig.mjs";
import { stap2 } from "./stap2-firmas.mjs";
import { M, fromRead, saveAll } from "../../tests/offerte-lib.mjs";

const S = 8;
const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;
const sleutel = (kind, titel) => `${kind}|${titel}`;
const fk = (naam, size) => `${naam}|${size}`;

export async function stap8({ actor, plan, echt, verslag, gelijktijdig, cid, opties = {} }) {
  const w = plan.werf;
  const echtPlan = plan.bron !== "test";
  // Opladen enkel buiten het lokale net: op live (echt plan, ja van de eigenaar) of, met een testplan, op een draft.
  const opladen = !isLocal();
  if (opladen && echtPlan && !isLiveCanister(cid)) throw new Error("echte bestanden enkel naar live (tools/live-canisters.json), nooit naar een draft");
  if (opladen && echtPlan && process.env.JA_EIGENAAR !== "1") throw new Error("opladen naar live enkel met JA_EIGENAAR=1");

  // ── 1. Documentsoorten en eenheden ─────────────────────────────────────
  const soorten = await actor.listDocKinds(true);
  let orde = soorten.reduce((m, k) => (k.order > m ? k.order : m), 0n);
  for (const k of plan.soorten ?? []) {
    const er = soorten.find((x) => x.key === k.key);
    if (er) { verslag.add(S, "documentsoort", k.key, k.name, "overgeslagen", er.archived ? "bestaat (gearchiveerd!)" : "bestaat al"); continue; }
    orde += 10n;
    if (echt) ok(await actor.setDocKind({ ...k, order: orde, archived: false }), `documentsoort ${k.key}`);
    verslag.add(S, "documentsoort", k.key, k.name, "aangemaakt", `${NAKIJKEN.toLowerCase()}: nieuwe soort voor de werfmappen${k.confidential ? " (vertrouwelijk)" : ""}`);
  }
  const units = await actor.libraryUnits(true);
  let uorde = units.reduce((m, u) => (u.order > m ? u.order : m), 0n);
  const nodig = [...new Set((plan.offertes ?? []).flatMap((o) => o.lijnen.map((l) => l.eenheid)))];
  for (const e of nodig) {
    if (units.some((u) => u.key === e)) continue;
    uorde += 10n;
    if (echt) {
      const r = await actor.setLibraryUnit({ key: e, name: e, order: uorde, archived: false });
      if ("err" in r) { verslag.add(S, "eenheid", e, "", "fout", r.err); continue; }
    }
    verslag.add(S, "eenheid", e, e, "aangemaakt", `uit de offerte van de werf; ${NAKIJKEN.toLowerCase()} (naam = code)`);
  }

  // ── 2. Firma's en de klant ─────────────────────────────────────────────
  await stap2({ actor, plan: { rijen: plan.firmas.rijen, nietInDeApp: {} }, echt, verslag, S });
  for (const f of plan.firmas.nietInDeApp ?? []) verslag.add(S, "firma", f.firma, "", "overgeslagen", f.reden);
  const orgs = await actor.listOrgs(true);
  let klant = orgs.find((o) => o.name === plan.klant.name && "client" in o.kind);
  if (klant) verslag.add(S, "klant", plan.klant.name, plan.klant.name, "overgeslagen", "bestaat al");
  else {
    if (echt) klant = ok(await actor.createOrg({ kind: { client: null }, name: plan.klant.name, kbo: [], vat: [], aliases: [], trades: [], address: [w.adres], notes: plan.klant.notes }), "klant");
    verslag.add(S, "klant", plan.klant.name, plan.klant.name, "aangemaakt", plan.klant.notes);
  }

  // ── 3. De werf ─────────────────────────────────────────────────────────
  let werf = (await actor.listWorks()).find((x) => x.code === w.code);
  if (werf) {
    verslag.add(S, "werf", w.code, w.naam, "overgeslagen", "bestaat al");
    if (klant && !werf.clientOrgId.length) {
      if (echt) ok(await actor.updateWork(werf.id, { code: werf.code, name: werf.name, address: werf.address, parentId: werf.parentId, clientOrgId: [klant.id], architectOrgId: werf.architectOrgId, leaderPersonId: werf.leaderPersonId, vatBp: werf.vatBp, plannedStart: werf.plannedStart, plannedEnd: werf.plannedEnd, analyticCode: werf.analyticCode, vatNote: werf.vatNote }), "klant bij de werf");
      verslag.add(S, "werf", w.code, w.naam, "bijgewerkt", "klant (plaatshouder) gekoppeld");
    }
  } else {
    if (echt) {
      werf = ok(await actor.createWork({ code: w.code, name: w.naam, address: w.adres, parentId: [], clientOrgId: klant ? [klant.id] : [], architectOrgId: [], leaderPersonId: [], vatBp: BigInt(w.vatBp) }), `werf ${w.code}`);
      ok(await actor.setWorkReviewNote(werf.id, `${NAKIJKEN}: ${w.nakijken}.`), "nog na te kijken");
    }
    verslag.add(S, "werf", w.code, w.naam, "aangemaakt", `status aanvraag; ${w.nakijken}`);
  }

  // ── 4. De offerte(s) als ontwerp ───────────────────────────────────────
  const quotes = werf ? await actor.listQuotes([werf.id], true) : [];
  for (const o of plan.offertes ?? []) {
    const bestaand = quotes.find((q) => q.number === o.nummer);
    let vid = null;
    if (bestaand) {
      const v = bestaand.versions[bestaand.versions.length - 1]; // de eerste versie (nieuwste eerst)
      const r = ok(await actor.readQuoteVersion(v.id), "offerte lezen");
      if (r.lines.length || !r.version.editable) { verslag.add(S, "offerte", o.nummer, o.id, "overgeslagen", `bestaat al (${r.lines.length} lijnen)`); continue; }
      vid = v.id; // aangemaakt, maar het vullen liep vorige keer niet af
    }
    if (!echt) {
      verslag.add(S, "offerte", o.nummer, o.id, "aangemaakt", `ontwerp met ${o.hoofdstukken.length} hoofdstukken en ${o.lijnen.length} lijnen (Excel: ${o.overgeslagen} regels overgeslagen)`);
      continue;
    }
    if (vid === null) vid = ok(await actor.createQuote({ workId: werf.id, number: o.nummer, title: `Offerte ${w.naam}`.slice(0, 120) }), `offerte ${o.nummer}`).versionId;
    const m = fromRead(ok(await actor.readQuoteVersion(vid), "offerte lezen"));
    const std = Number(m.header.standardMarginBp);
    const hk = new Map(), sg = new Map();
    o.hoofdstukken.forEach((t, i) => hk.set(t, M.addChapter(m, { code: String(i + 1).padStart(2, "0"), title: t }).key));
    for (const l of o.lijnen) {
      const prijs = l.kostCents !== null
        ? { cost: BigInt(l.kostCents), rule: l.margeBp === null || l.margeBp === std ? null : { margin: BigInt(l.margeBp) }, reason: l.margeBp === null || l.margeBp === std ? "" : `Marge uit de oude Excel (${l.prijsvorm}); ${NAKIJKEN.toLowerCase()}`, orgId: null, source: "eigen", libCostId: null }
        : { cost: null, rule: { price: BigInt(l.verkoopCents) }, reason: `${l.prijsvorm === "vaste prijs" ? "Vaste prijs" : "Andere formule"} in de oude Excel; ${NAKIJKEN.toLowerCase()}`, orgId: null, source: "", libCostId: null };
      const lijn = M.addLine(m, hk.get(l.hoofdstuk), { title: l.titel, text: l.tekst, qtyMilli: BigInt(l.qtyMilli), unit: l.eenheid, form: l.vorm, price: prijs });
      if (l.subgroep) {
        const k = `${l.hoofdstuk}|${l.subgroep}`;
        if (!sg.has(k)) sg.set(k, M.addSubgroup(m, hk.get(l.hoofdstuk), l.subgroep).key);
        M.setLineSubgroup(m, lijn.key, sg.get(k));
      }
    }
    const r = await saveAll(actor, m);
    if (r && "err" in r) { verslag.add(S, "offerte", o.nummer, o.id, "fout", r.err); continue; }
    const t = M.totals(m);
    const verschil = o.totaalIndexCents === null ? "" : `; subtotaal ${(Number(t.subtotal) / 100).toFixed(2)} € (Excel ${(o.totaalIndexCents / 100).toFixed(2)} €, verschil ${((Number(t.subtotal) - o.totaalIndexCents) / 100).toFixed(2)} €)`;
    verslag.add(S, "offerte", o.nummer, o.id, "aangemaakt", `ontwerp (versie 1) met ${o.hoofdstukken.length} hoofdstukken, ${o.lijnen.length} lijnen, ${sg.size} subgroepen${verschil}`);
  }
  for (const x of plan.nietAlsOfferte ?? []) verslag.add(S, "offerte", x.offerte, "", "overgeslagen", x.reden);

  // ── 5. Alle documenten ─────────────────────────────────────────────────
  for (const g of plan.geweerd ?? []) verslag.add(S, "bestand", g.doc, "", "overgeslagen", `GEWEERD: ${g.reden}`);
  for (const f of plan.fouten ?? []) verslag.add(S, "bestand", f.doc, "", "fout", f.reden);
  const manifest = [];
  const doel = (b) => `werf ${w.code} → dossier: ${b.soort} «${b.documentTitel}»${b.vertrouwelijk ? " (vertrouwelijk)" : ""}`;
  // De hash van de opslag (zonder upload) voor elk bestand dat opgeladen wordt.
  const op = plan.bestanden.filter((b) => !b.nietOpladen);
  await pool(op, 8, async (b) => {
    const bytes = readFileSync(b.bestand);
    if (bytes.length !== b.bytes) throw new Error(`${b.doc}: het bestand in de werkmap veranderde sinds de lezer (lees opnieuw)`);
    b.blobHash = await blobHash(bytes, b.mime, b.naam);
  });
  for (const b of plan.bestanden.filter((x) => x.nietOpladen)) {
    verslag.add(S, "bestand", b.doc, b.naam, "overgeslagen", `niet opgeladen: ${b.nietOpladen}`);
    manifest.push({ ...b, doel: doel(b), actie: `niet opgeladen: ${b.nietOpladen}` });
  }

  const dossier = werf ? await actor.getDossier(werf.id) : { documents: [] };
  const docs = new Map(dossier.documents.map((d) => [sleutel(d.kind, d.title), d]));
  const inDoc = new Map(); // documentsleutel → (naam|grootte → [bestanden])
  const gehangen = new Set();
  for (const d of dossier.documents) {
    const mp = new Map();
    for (const f of d.files) { gehangen.add(f.id); const k = fk(f.name, f.size); mp.set(k, [...(mp.get(k) ?? []), f]); }
    inDoc.set(sleutel(d.kind, d.title), mp);
  }
  const los = werf ? (await actor.listFiles([werf.id])).filter((f) => !gehangen.has(f.id)) : [];

  // Wat er al staat (per document: naam + grootte, en de hash waar die zichtbaar is), wat nog moet.
  const todo = [];
  for (const b of op) {
    const mp = inDoc.get(sleutel(b.soort, b.documentTitel));
    const lijst = mp?.get(fk(b.naam, BigInt(b.bytes)));
    if (lijst?.length) {
      const f = lijst.shift();
      const ref = f.blob?.length ? refText(f.blob[0]) : null;
      if (ref && ref !== "!caf!" + b.blobHash) verslag.add(S, "bestand", b.doc, b.naam, "conflict", `zelfde naam en grootte, andere inhoud in de app (bestand #${f.id})`);
      else verslag.add(S, "bestand", b.doc, b.naam, "overgeslagen", "staat al in het dossier");
      manifest.push({ ...b, doel: doel(b), actie: "overgeslagen (staat al in de app)", fileId: String(f.id) });
      continue;
    }
    todo.push(b);
  }
  // Documenten eerst, na elkaar (twee gelijktijdige oproepen zouden hetzelfde document twee keer maken).
  const nieuweDocs = [...new Map(todo.map((b) => [sleutel(b.soort, b.documentTitel), b])).values()].filter((b) => !docs.has(sleutel(b.soort, b.documentTitel)));
  for (const b of nieuweDocs) {
    const n = todo.filter((x) => x.soort === b.soort && x.documentTitel === b.documentTitel).length;
    if (echt) {
      const r = await actor.saveDocument(werf.id, { id: [], kind: b.soort, title: b.documentTitel, dueDay: [], validUntil: [], note: `Uit de werfmap (inrichting 2c.9); ${NAKIJKEN.toLowerCase()}.`, ownerOrgId: [] });
      if ("err" in r) { verslag.add(S, "document", b.soort, b.documentTitel, "fout", r.err); continue; }
      docs.set(sleutel(b.soort, b.documentTitel), { id: r.ok, kind: b.soort, title: b.documentTitel });
    }
    verslag.add(S, "document", b.soort, b.documentTitel, "aangemaakt", `${n} bestand(en)`);
  }

  // Het logboek van de uploads (per canister): wat al in de opslag staat, hoeft na een fout niet opnieuw.
  const logPad = join(opties.werkmap ?? join(homedir(), ".bowaco", "inrichting", "werf", w.code), `upload-${cid}.json`);
  const log = existsSync(logPad) ? JSON.parse(readFileSync(logPad, "utf8")) : {};
  const bewaarLog = () => { mkdirSync(dirname(logPad), { recursive: true, mode: 0o700 }); writeFileSync(logPad, JSON.stringify(log, null, 1), { mode: 0o600 }); };
  const store = echt && opladen ? await storageClientInrichting(cid, opties.project, opties.identity ?? LIVE_ID) : null;
  const tUp = Date.now();
  let opgeladen = 0, bytesOp = 0;
  const losPer = new Map();
  for (const f of los) { const k = `${f.name}|${f.size}|${f.blob?.length ? refText(f.blob[0]) : ""}`; losPer.set(k, [...(losPer.get(k) ?? []), f]); }
  const hang = async (b, fileId) => {
    const d = docs.get(sleutel(b.soort, b.documentTitel));
    if (!d) throw new Error("document ontbreekt");
    ok(await actor.attachDocumentFile(werf.id, b.soort, [d.id], fileId), "aan het document hangen");
  };
  await pool(todo, Math.max(1, Math.min(opties.uploads ?? 3, 3, gelijktijdig)), async (b) => {
    const ref = "!caf!" + b.blobHash;
    if (!echt) {
      manifest.push({ ...b, doel: doel(b), actie: opladen ? "zou opgeladen en geregistreerd worden" : "zou geregistreerd worden (lokaal zonder blob)" });
      verslag.add(S, "bestand", b.doc, b.naam, "aangemaakt", `${b.soort} «${b.documentTitel}» · ${mb(b.bytes)}`);
      return;
    }
    try {
      // Een vorige run registreerde het bestand al, maar hing het niet aan het document: enkel nog hangen.
      const losse = losPer.get(`${b.naam}|${BigInt(b.bytes)}|${b.vertrouwelijk ? "" : ref}`);
      if (losse?.length) {
        const f = losse.shift();
        await hang(b, f.id);
        manifest.push({ ...b, doel: doel(b), actie: "aan het document gehangen (was al geregistreerd)", fileId: String(f.id) });
        verslag.add(S, "bestand", b.doc, b.naam, "bijgewerkt", "was al geregistreerd; nu aan het document gehangen");
        return;
      }
      if (store && log[b.blobHash] !== "opgeladen") {
        const bytes = readFileSync(b.bestand);
        const { hash } = await store.putFile(bytes, () => {}, b.mime, b.naam);
        if (hash !== b.blobHash) throw new Error(`de opslag gaf een andere hash (${hash})`);
        log[b.blobHash] = "opgeladen";
        bewaarLog();
        opgeladen++;
        bytesOp += b.bytes;
      }
      const fileId = ok(await actor.addFile(b.naam, b.mime, BigInt(b.bytes), blobRef(b.blobHash), [werf.id], b.vertrouwelijk), "registreren");
      await hang(b, fileId);
      manifest.push({ ...b, doel: doel(b), actie: store ? "opgeladen en geregistreerd" : "geregistreerd (lokaal zonder blob)", fileId: String(fileId) });
      verslag.add(S, "bestand", b.doc, b.naam, "aangemaakt", `${b.soort} «${b.documentTitel}» · ${mb(b.bytes)}${store ? "" : " · zonder blob (lokaal)"}`);
    } catch (e) {
      manifest.push({ ...b, doel: doel(b), actie: `fout: ${String(e.message ?? e).slice(0, 160)}` });
      verslag.add(S, "bestand", b.doc, b.naam, "fout", String(e.message ?? e).slice(0, 300));
    }
  });

  // ── Manifest en tellingen ──────────────────────────────────────────────
  const tel = (f) => op.filter(f).length;
  const totaal = op.reduce((s, b) => s + b.bytes, 0);
  verslag.noteer(S, `werf ${w.code}: ${plan.telling?.indexrijen ?? "?"} rijen in de documenten-index · ${plan.bestanden.length} bestanden in het plan · op te laden ${op.length} (${mb(totaal)}; foto's omgezet naar JPEG ≤ ${REGELS.maxZijde} px zonder EXIF: ${tel((b) => b.omgezet)}) · niet opgeladen ${plan.bestanden.length - op.length} · geweerd (persoonsgegevens) ${(plan.geweerd ?? []).length} · leesfouten ${(plan.fouten ?? []).length}`);
  verslag.noteer(S, `per soort: ${Object.entries(op.reduce((a, b) => ({ ...a, [b.soort]: (a[b.soort] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(", ")} · documenten in het dossier ${new Set(op.map((b) => sleutel(b.soort, b.documentTitel))).size} · vertrouwelijk ${tel((b) => b.vertrouwelijk)} · dubbels ${tel((b) => b.dubbel)}`);
  // 2d.4: vooraf de kost (IC-tarief zonder de marge van Caffeine, BOWACO_verslag_2d.md §4) en de video's (nooit opgeladen).
  const bronTot = op.reduce((s, b) => s + (b.bronBytes || b.bytes), 0);
  const k = raming(totaal, op.length);
  const videos = plan.bestanden.filter((b) => b.video);
  verslag.noteer(S, `raming werf ${w.code}: ${op.length} bestanden, ${mb(bronTot)} vóór → ${mb(totaal)} na verkleining; ${euro(k.eenmalig)} eenmalig + ${euro(k.maand)}/maand (IC-tarief, zonder de marge van Caffeine; groter subnet × 2,6: ${euro(k.eenmaligGroot)} + ${euro(k.maandGroot)}/maand) · video's niet opgeladen: ${videos.length} (${mb(videos.reduce((s, b) => s + b.bytes, 0))})`);
  console.log(`   raming ${w.code}: ${op.length} bestanden, ${mb(bronTot)} → ${mb(totaal)}; ${euro(k.eenmalig)} eenmalig + ${euro(k.maand)}/maand (× 2,6 groter subnet) · video's niet: ${videos.length}`);
  if (store) verslag.noteer(S, `opgeladen in deze run: ${opgeladen} bestanden, ${mb(bytesOp)} in ${((Date.now() - tUp) / 1000).toFixed(0)} s`);
  else if (!opladen) verslag.noteer(S, "lokaal: geen opslagdienst. De echte run registreert elk bestand met de verwijzing die live krijgt (zelfde hash, zonder blob); openen kan lokaal niet.");
  const csvPad = opties.manifest;
  if (csvPad) {
    mkdirSync(dirname(csvPad), { recursive: true, mode: 0o700 });
    const kol = ["doc", "naam", "categorie", "soort", "documentTitel", "vertrouwelijk", "mime", "bytes", "sha256", "blobHash", "omgezet", "dubbel", "doel", "actie", "fileId", "pad"];
    const rijen = manifest.sort((a, b) => a.doc.localeCompare(b.doc)).map((r) => kol.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(";"));
    writeFileSync(csvPad, "﻿" + [kol.join(";"), ...rijen].join("\n") + "\n", { mode: 0o600 });
    verslag.noteer(S, `manifest (per bestand: soort, grootte, sha256, hash van de opslag, doel in de app, actie): ${csvPad}`);
  }
  return { manifest };
}
