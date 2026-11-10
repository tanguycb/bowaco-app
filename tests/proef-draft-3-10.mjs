// OA-factuurcontrole (3.10) op een DRAFT, via de ECHTE HTTP-gateway van het IC (https://<backend>.icp0.io/mcp), zoals Claude het doet:
// een proefwerf P-ICD-…, een verzonnen firma met twee verzonnen OA-facturen, een bot (wegwerp-identiteit) met de controletools,
// koppelen, twee opdrachten (een PDF van 6 kB en een van ± 1,3 MB: past de bijlage door de gateway?), controleopdrachten met het dossier,
// controlebestand als bijlage, voorstel_factuurcontrole, het resultaat lezen, gezien, de Caffeine-weg in de testmodus (droog), intrekken.
// De proefwerf en één open opdracht met voorstel BLIJVEN staan voor de testlijst van de eigenaar (§7 van het verslag); de koppeling
// van de bot wordt ingetrokken (3.12: de bot zelf intrekken zou het voorstel sluiten). Enkel VERZONNEN gegevens.
//   node tests/proef-draft-3-10.mjs <backend-canister>
import { createHash, randomBytes } from "node:crypto";
import { backend, freshBackend, ok, weigerLive } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/proef-draft-3-10.mjs <backend-canister>");
weigerLive(cid, "de factuurcontrole-proef op de draft");
const base = process.env.MCP_BASE || `https://${cid}.icp0.io`;
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const sfx = Date.now().toString(36).slice(-4).toUpperCase();
const today = BigInt(Math.floor(Date.now() / 86_400_000));
const pdfBytes = (n, tag) => { const b = new Uint8Array(n); const h = new TextEncoder().encode(`%PDF-1.4 proef ${tag} `); b.set(h); for (let i = h.length; i < n; i++) b[i] = 32 + (i % 90); return b; };

const admin = await backend("proef-admin", cid);
const bot = await freshBackend(cid);
const addr = { street: "Proefstraat", number: "11", zip: "9999", city: "Proefdorp", country: "BE" };
const W = ok(await admin.createWork({ code: `P-ICD-${sfx}`, name: "Proefwerf factuurcontrole draft", address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
const ORG = ok(await admin.createOrg({ kind: { subcontractor: null }, name: `Proef Tegel Mus draft ${sfx}`, kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "Verzonnen proeffirma (3.10 draft)" })).id;
const inv = (n, unit) => { const amt = 10n * unit; return { id: [], orgId: ORG, workId: W, number: `PICD-${sfx}-${n}`, invoiceDay: today, dueDay: [], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [], note: "verzonnen proeffactuur (3.10 draft)", netCents: amt, vatCents: 0n, totalCents: amt, lines: [{ kind: { other: null }, root: [], description: `Proef tegelwerk ${n}`, qtyMilli: 10_000n, unitCents: unit, amountCents: amt }] }; };
const I1 = ok(await admin.saveOaInvoice(inv("1", 8125n), 0n));
const I2 = ok(await admin.saveOaInvoice(inv("2", 8125n), 0n));
check("(1) proefwerf, verzonnen firma en twee verzonnen OA-facturen (zelfde bedrag)", !!W && !!ORG && !!I1 && !!I2);

const reg = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Proef draft 3.10" }) });
const regJ = await reg.json().catch(() => ({}));
const id = ok(await admin.saveBot({ id: [], rev: 0n, name: `Proef bot factuurcontrole draft ${sfx}`, vendor: "Anthropic", model: "Proefmodel", tools: ["mijn_fiche", "werven", "controleopdrachten", "controlebestand", "voorstel_factuurcontrole"], allWorks: false, works: [W], docKinds: [], callsPerDay: 200n, tasks: [], instruction: ["routine v1"] }));
ok(await bot.claimBotCode(ok(await admin.newBotCode(id)).code));
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const code = ok(await bot._caffeineMcpApprove({ clientId: regJ.client_id, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256" }));
const tok = await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: regJ.client_id }).toString() });
const tokJ = await tok.json().catch(() => ({}));
check("(2) bot gekoppeld via de gateway", tok.status === 200 && !!tokJ.access_token, String(tok.status));
let rid = 1;
const call = async (name, args = {}) => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokJ.access_token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: rid++, method: "tools/call", params: { name, arguments: args } }) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, size: text.length };
};

const small = pdfBytes(6000, "klein " + sfx);
const large = pdfBytes(1_300_000, "groot " + sfx);
const j1 = ok(await admin.startInvCheck({ invoiceId: I1, way: { bot: id }, name: `proef-factuur-${sfx}.pdf`, mime: "application/pdf", content: small }));
const j2 = ok(await admin.startInvCheck({ invoiceId: I2, way: { bot: id }, name: `proef-factuur-groot-${sfx}.pdf`, mime: "application/pdf", content: large }));
check("(3) twee opdrachten gegeven (6 kB en 1,3 MB)", !!j1 && !!j2);
const ops = await call("controleopdrachten");
const o1 = ops.json?.result?.structuredContent?.opdrachten?.find((o) => o.opdracht === Number(j1));
check("(3) controleopdrachten via de gateway: beide opdrachten met het dossier (zelfde bedrag als de andere factuur), geen URL", ops.status === 200 && [j1, j2].every((j) => ops.json?.result?.structuredContent?.opdrachten?.some((o) => o.opdracht === Number(j))) && (o1?.dossier?.zelfdeBedragAls ?? []).includes(`PICD-${sfx}-2`) && !/https?:\/\/|!caf!/.test(JSON.stringify(ops.json?.result?.structuredContent)));
const f1 = await call("controlebestand", { opdracht: Number(j1) });
const p1 = f1.json?.result?.content?.[1];
check("(4) controlebestand (6 kB) als resource, byte voor byte gelijk", f1.status === 200 && p1?.type === "resource" && Buffer.from(p1.resource.blob, "base64").equals(Buffer.from(small)), `${f1.status} ${f1.size} tekens`);
const f2 = await call("controlebestand", { opdracht: Number(j2) });
const p2 = f2.json?.result?.content?.[1];
check("(4) controlebestand (1,3 MB) past door de gateway, byte voor byte gelijk", f2.status === 200 && p2?.type === "resource" && Buffer.from(p2.resource.blob, "base64").equals(Buffer.from(large)), `${f2.status} ${f2.size} tekens`);
const prop = { opdracht: Number(j1), voorstel: "navragen", bevindingen: [{ soort: "dubbel", ernst: "let_op", tekst: `Zelfde bedrag als PICD-${sfx}-2 (verzonnen proef).`, bedragCent: 81250 }], samenvatting: "Verzonnen proefcontrole.", vertrouwen: 0.7 };
const v1 = await call("voorstel_factuurcontrole", prop);
check("(5) voorstel_factuurcontrole: een voorstel; de factuur blijft geregistreerd", v1.json?.result?.structuredContent?.stand === "voorstel" && "registered" in ok(await admin.readOaInvoice(I1)).brief.status, JSON.stringify(v1.json?.result).slice(0, 200));
const full = ok(await admin.readInvCheck(j1));
check("(5) readInvCheck: navragen met één bevinding", full.result[0]?.verdict === "navragen" && full.result[0].findings.length === 1);
ok(await admin.finishInvCheck(j1, { seen: null }));
check("(6) gezien: opdracht afgesloten", (await admin.listInvChecks(I1))[0]?.status === "afgesloten");
// De tweede opdracht blijft open met een voorstel voor de testlijst.
const v2 = await call("voorstel_factuurcontrole", { ...prop, opdracht: Number(j2), voorstel: "weigeren", bevindingen: [{ soort: "dubbel", ernst: "fout", tekst: `Zelfde bedrag als PICD-${sfx}-1 (verzonnen proef).`, bedragCent: 81250 }] });
check("(6) tweede opdracht: voorstel klaar (blijft staan voor de testlijst)", v2.json?.result?.structuredContent?.stand === "voorstel");
// Caffeine-weg op de draft: testmodus, er vertrekt niets.
const ws = await admin.listAiWorkers();
const wk = ws.find((w) => w.key === "oa-factuurcontrole");
if (wk && !wk.enabled) ok(await admin.saveAiWorker({ key: "oa-factuurcontrole", name: wk.name || "Factuurcontrole", route: { caffeine: null }, modelAlias: wk.modelAlias || "auto", fallback: false, fallbackModel: [], budgetMonthCents: 500n, maxCallCents: 20n, clientData: false, autonomy: { proposal: null }, instructionVersion: 1n, enabled: true, rev: wk.rev }));
const ja = ok(await admin.startInvCheck({ invoiceId: I1, way: { ai: null }, name: "tekst", mime: "text/plain", content: new TextEncoder().encode(`Verzonnen factuur PICD-${sfx}-1, tegelwerk 812,50 EUR`) }));
const ra = await admin.runInvCheckAi(ja);
check("(7) Caffeine-weg op de draft: testmodus (droog), er vertrekt niets", "ok" in ra && ra.ok.dry === true, S(ra));
ok(await admin.finishInvCheck(ja, { cancelled: null }));
// 3.12 (review M3): de bot intrekken sluit nu ook zijn open opdrachten en voorstellen. Het voorstel moet hier blijven staan voor de
// testlijst van de eigenaar: daarom enkel de KOPPELING intrekken (het token is dood, de bot en zijn voorstel blijven).
for (const c of await admin.botConnections(id)) ok(await admin.revokeBotConnection(id, c.id));
const after = await call("controleopdrachten");
check("(8) na het intrekken van de koppeling: de bot kan niets meer (401)", after.status === 401, String(after.status));
console.log(`\nproef-draft-3-10: ${pass} geslaagd, ${fail} mislukt (proefwerf P-ICD-${sfx})`);
process.exit(fail ? 1 : 0);
