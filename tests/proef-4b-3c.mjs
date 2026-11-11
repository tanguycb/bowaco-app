// De werkvorm (stap 4b.3c): het gedeelde skelet van het rekenblad voor OA-offertes vergelijken, opmeting, vorderingsstaat,
// min-meerstaat en OA-factuurcontrole. De zuivere kern (src/frontend/src/design/vormkern.ts + quote/blad.ts, door Node rechtstreeks
// gedraaid, zoals de browser) en, met een canister, de backend. Bewijst:
//   (A) wanneer de werkvorm kan (muis, ≥ 900 px) en hoe de indeling per breedte van het blad zelf volgt (groot: inhoud en paneel
//       vast; kleiner: ingeklapt; een klein document zonder kopjes heeft geen inhoud links nodig);
//   (B) ongedaan maken/opnieuw (stapel, limiet, geen stap voor een gelijke stand) en wanneer vanzelf bewaren mag: nooit bij een
//       alleen-lezen stuk (ingediend, goedgekeurd, gefactureerd), nooit zonder wijziging, nooit tijdens een bewaring of een fout;
//   (C) rekenresultaten ongewijzigd: de rekenmodules (tender/, progress/, minmeer/, quote/calc.ts) en de héle backend zijn
//       byte-gelijk aan 8a79006 (de vorige stap); de vorm kent geen rekenwerk;
//   (D) rechten per rol op de backend (enkel met een canister): wie vroeger een bedrag niet zag, ziet het nu ook niet
//       (werfleider, klant, onderaannemer), en een vastgelegd stuk blijft alleen-lezen.
// Enkel VERZONNEN gegevens, die de reeks van tests/lokaal.sh al op het eigen net zette (geen eigen gegevens nodig).
//   node tests/proef-4b-3c.mjs               (A–C)
//   ICP_HOST=http://localhost:84xx node tests/proef-4b-3c.mjs <canister-id>   (+ D, enkel op het eigen lokale net)
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as K from "../src/frontend/src/design/vormkern.ts";
import * as B from "../src/frontend/src/quote/blad.ts";

const cid = process.argv[2];
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);

// ── A. Wanneer en hoe breed ─────────────────────────────────────────────
check("(A1) de werkvorm enkel op een scherm met muis van minstens 900 px", K.werkvormKan(900, false) && K.werkvormKan(1920, false) && !K.werkvormKan(899, false) && !K.werkvormKan(1920, true) && !K.werkvormKan(375, true));
const I = (w, n, o) => B.indeling(w, n, o, K.WERKVORM_VAST_VANAF);
check("(A2) blad van 1380 px of meer (in een tabblad van een werf): inhoud en paneel vast", S(I(1380, 4)) === S({ inhoud: "vast", paneel: "vast" }) && S(I(1600, 4)) === S({ inhoud: "vast", paneel: "vast" }));
check("(A2) blad smaller dan 1380 px: allebei ingeklapt; geopend = zwevend over het raster, de totalen blijven", S(I(1379, 4)) === S({ inhoud: "dicht", paneel: "dicht" }) && S(I(900, 4, { inhoud: true, paneel: true })) === S({ inhoud: "zwevend", paneel: "zwevend" }));
check("(A2) een klein document (0 of 1 kopje): geen inhoud links, ook op een breed blad; het paneel blijft", I(1600, 1).inhoud === "dicht" && I(1600, 0).inhoud === "dicht" && I(1600, 1).paneel === "vast");
check("(A2) de keuze van de gebruiker wint", S(I(1600, 4, { inhoud: false, paneel: false })) === S({ inhoud: "dicht", paneel: "dicht" }));
check("(A2) het rekenblad van 4b.3b is ongewijzigd (indeling zonder vierde parameter = 1440 px)", S(B.indeling(1439, 5)) === S({ inhoud: "dicht", paneel: "dicht" }) && S(B.indeling(1440, 5)) === S({ inhoud: "vast", paneel: "vast" }));

// ── B. Ongedaan maken en vanzelf bewaren ────────────────────────────────
let g = K.begin(new Map());
const m1 = new Map([["a", 1]]);
const m2 = new Map([["a", 1], ["b", 2]]);
g = K.zet(g, m1);
g = K.zet(g, m2);
check("(B1) elke wijziging is één stap; ongedaan maken zet de vorige stand terug, opnieuw de volgende", g.nu === m2 && K.ongedaan(g).nu === m1 && K.ongedaan(K.ongedaan(g)).nu.size === 0 && K.opnieuw(K.ongedaan(g)).nu === m2);
check("(B1) ongedaan maken zonder stappen en opnieuw zonder stappen doen niets", K.ongedaan(K.begin(1)).nu === 1 && K.opnieuw(K.begin(1)).nu === 1);
check("(B1) een nieuwe wijziging na ongedaan maken wist de stappen vooruit", K.zet(K.ongedaan(g), new Map([["z", 9]])).vooruit.length === 0);
check("(B1) een gelijke stand maakt geen stap; een eigen vergelijking kan (inhoud i.p.v. identiteit)", K.zet(g, m2) === g && K.zet(K.begin("x"), "x").terug.length === 0 && K.zet(K.begin({ a: 1 }), { a: 1 }, (p, q) => p.a === q.a).terug.length === 0);
let lang = K.begin(0);
for (let i = 1; i <= K.LIMIET + 20; i++) lang = K.zet(lang, i);
check(`(B1) de stapel houdt hoogstens ${K.LIMIET} stappen`, lang.terug.length === K.LIMIET && lang.nu === K.LIMIET + 20);
const klaar = { bewerkbaar: true, wijzigingen: 2, bezig: false, geldig: true, fout: false };
check("(B2) vanzelf bewaren mag enkel als het stuk bewerkbaar is, er wijzigingen zijn, niets bezig is, de invoer geldig is en er geen fout staat", K.vanzelfKan(klaar));
check("(B2) een ingediend, goedgekeurd of gefactureerd stuk (alleen-lezen) bewaart nooit vanzelf", !K.vanzelfKan({ ...klaar, bewerkbaar: false }));
check("(B2) niet zonder wijziging, niet tijdens een bewaring, niet bij ongeldige invoer, niet na een fout (tot Opnieuw proberen)", !K.vanzelfKan({ ...klaar, wijzigingen: 0 }) && !K.vanzelfKan({ ...klaar, bezig: true }) && !K.vanzelfKan({ ...klaar, geldig: false }) && !K.vanzelfKan({ ...klaar, fout: true }));
check("(B2) de pauze is 2,5 s, zoals het rekenblad", K.VANZELF_MS === 2500);

// ── C. Rekenresultaten ongewijzigd ──────────────────────────────────────
const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }); } catch (e) { return String(e); } };
const basis = "8a79006";
const verschil = (pad) => git("diff", "--stat", basis, "--", pad).trim();
for (const pad of ["src/frontend/src/tender", "src/frontend/src/progress", "src/frontend/src/minmeer", "src/frontend/src/nacalc", "src/frontend/src/quote/calc.ts", "src/frontend/src/quote/rules.ts", "src/frontend/src/pdf", "src/backend"]) {
  check(`(C1) ${pad} is ongewijzigd t.o.v. ${basis} (de vorm rekent niets)`, verschil(pad) === "", verschil(pad).slice(0, 200));
}
const gewijzigd = git("diff", "--name-only", basis).split("\n").filter(Boolean);
check("(C2) enkel schermen, ontwerp, teksten, opmaak, de proef en de documentatie zijn aangeraakt", gewijzigd.every((f) => /^src\/frontend\/src\/(screens|design|app|texts|quote\/blad\.ts)|^tests\/|^docs\//.test(f)), gewijzigd.filter((f) => !/^src\/frontend\/src\/(screens|design|app|texts|quote\/blad\.ts)|^tests\/|^docs\//.test(f)).join(", "));

// ── D. Rechten per rol op de backend ────────────────────────────────────
if (cid) {
  const { backend, freshBackend } = await import("../tools/lib.mjs");
  const [admin, calc, wl, arch, klant, oa2, vc] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-architect", "proef-klant", "proef-oa2", "proef-vc"].map((n) => backend(n, cid)));
  const vreemd = await freshBackend(cid);
  const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
  const okr = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
  const geld = (x) => /Cents|totals|unitPrice|amount|price/i.test(S(x).replace(/"(?:[a-zA-Z]*(?:Count|count|Discount)[a-zA-Z]*)":/g, ""));
  const tag = (v) => Object.keys(v)[0];

  // D1 vorderingsstaten: werfleider = hoeveelheden zonder bedrag, calculator = volledig; een verstuurde staat is alleen-lezen.
  const werken = await admin.progressWorks();
  let sent = null;
  let draft = null;
  for (const w of werken) {
    const lijst = await admin.listProgress(w.workId);
    sent ??= lijst.find((b) => tag(b.status) === "sent") ?? null;
    draft ??= lijst.find((b) => tag(b.status) === "draft") ?? null;
  }
  check("(D1) de reeks liet een verstuurde en een ontwerp-vorderingsstaat achter om mee te proeven", !!sent, `${werken.length} werven`);
  if (sent) {
    const volledig = okr(await calc.readProgressStatement(sent.id));
    check("(D1) calculator leest de staat met bedragen", volledig.totals && volledig.lines.length > 0 && volledig.lines.every((l) => l.m));
    const qty = await wl.progressQty(sent.id);
    check("(D1) werfleider: hoeveelheden en %, geen enkel bedragveld, geen totalen", !geld(qty) && qty.lines.length === volledig.lines.length, geld(qty) ? S(qty).slice(0, 200) : "");
    check("(D1) werfleider, klant, onderaannemer en een vreemde: geen staat met bedragen", (await denied(wl.readProgressStatement(sent.id))) && (await denied(klant.readProgressStatement(sent.id))) && (await denied(oa2.readProgressStatement(sent.id))) && (await denied(vreemd.readProgressStatement(sent.id))));
    const r = await admin.saveProgressDraft(sent.id, volledig.brief.rev, { periodTo: [], note: [], setIndexes: false, sIndex: [], iIndex: [], lines: [], expect: [] });
    check("(D1) een verstuurde staat is alleen-lezen: bewaren wordt geweigerd (dus ook vanzelf bewaren)", "err" in r, S(r).slice(0, 120));
  }
  if (draft) {
    const r = await wl.readProgressStatement(draft.id).catch((e) => ({ err: String(e) }));
    check("(D1) ook een ontwerp-staat is voor de werfleider zonder bedragen", "err" in r);
  }

  // D2 OA-facturen: de controle met bedragen enkel voor beheerder en calculator; goedgekeurd = alleen-lezen.
  const facturen = await admin.listOaInvoices([], []);
  const goed = facturen.find((b) => tag(b.status) === "approved") ?? null;
  const open = facturen.find((b) => tag(b.status) === "registered" || tag(b.status) === "disputed") ?? facturen[0] ?? null;
  check("(D2) de reeks liet OA-facturen achter", facturen.length > 0, String(facturen.length));
  if (open) {
    const vol = okr(await calc.readOaInvoice(open.id));
    check("(D2) calculator: factuurcontrole met bedragen per regel", vol.lines.length > 0 && vol.lines.some((l) => l.m !== undefined && (Array.isArray(l.m) ? l.m.length > 0 : true)) && vol.totalCents !== undefined);
    const q = await wl.oaInvoiceQty(open.id);
    check("(D2) werfleider: hoeveelheden en uren, nooit een bedrag", !geld(q) && q.lines.length === vol.lines.length, geld(q) ? S(q).slice(0, 200) : "");
    check("(D2) werfleider, klant, onderaannemer en een vreemde lezen de factuur met bedragen niet", (await denied(wl.readOaInvoice(open.id))) && (await denied(klant.readOaInvoice(open.id))) && (await denied(oa2.readOaInvoice(open.id))) && (await denied(vreemd.readOaInvoice(open.id))));
  }
  if (goed) {
    const vol = okr(await admin.readOaInvoice(goed.id));
    const r1 = await admin.approveOaInvoice(goed.id, vol.brief.rev, { exception: "Proef 4b.3c: nog eens goedkeuren" }, "").catch((e) => ({ err: String(e) }));
    const r2 = await admin.withdrawOaInvoice(goed.id, vol.brief.rev + 99n, "proef").catch((e) => ({ err: String(e) }));
    check("(D2) een goedgekeurde factuur is alleen-lezen: nog eens goedkeuren en met een oude versie intrekken worden geweigerd", "err" in r1 && "err" in r2, S(r1).slice(0, 100));
  }

  // D3 min-meerstaat: enkel kantoor ziet bedragen; de werfleider hoeveelheden en uren.
  const mmWerf = werken[0]?.workId;
  if (mmWerf !== undefined) {
    const full = await calc.readMinMeer(mmWerf);
    if ("ok" in full) {
      const mq = await wl.minMeerQty(mmWerf);
      check("(D3) werfleider: min-meer in hoeveelheden en uren, geen enkel bedragveld", !geld(mq), geld(mq) ? S(mq).slice(0, 200) : "");
      check("(D3) werfleider, klant en onderaannemer lezen de min-meerstaat met bedragen niet", (await denied(wl.readMinMeer(mmWerf))) && (await denied(oa2.readMinMeer(mmWerf))) && (await denied(vreemd.readMinMeer(mmWerf))));
    } else check("(D3) kantoor leest de min-meerstaat", false, S(full).slice(0, 100));
  }

  // D4 prijsvragen: de vergelijking met bedragen enkel voor wie de prijsvragen beheert; de werfleider ziet enkel de gekozen firma.
  const tenders = await admin.listTenders([]);
  const tv = tenders.find((s) => tag(s.status) === "open" || tag(s.status) === "closed") ?? tenders[0] ?? null;
  check("(D4) de reeks liet prijsvragen achter", !!tv, String(tenders.length));
  if (tv) {
    check("(D4) calculator en beheerder vergelijken met bedragen", "ok" in (await calc.compareTender(tv.id)) && "ok" in (await admin.compareTender(tv.id)));
    check("(D4) werfleider, architect, klant, onderaannemer en een vreemde: geen vergelijking", (await denied(wl.compareTender(tv.id))) && (await denied(arch.compareTender(tv.id))) && (await denied(klant.compareTender(tv.id))) && (await denied(oa2.compareTender(tv.id))) && (await denied(vreemd.compareTender(tv.id))));
    const lijstWl = await wl.listTenders([tv.workId]).catch(() => []);
    check("(D4) de werfleider ziet in de lijst van prijsvragen geen bedrag", !geld(lijstWl), geld(lijstWl) ? S(lijstWl).slice(0, 200) : "");
  }
  void vc;
}

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
