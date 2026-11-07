// 2d.1: meting van het rekenwerk per klokronde (instructies via meetKlok, enkel in de testbouw) en van veelgebruikte
// update-oproepen (cycli: saldo van de canister voor/na, mediaan van 3) bij 1, 10 en 100 VERZONNEN werven.
// Enkel op het EIGEN lokale net, na tests/rollen.mjs. Uitvoer: JSON-regels (MEET …) voor BOWACO_verslag_2d.md.
//   NET=<map van het net> node tests/meet-2d.mjs <canister-id>
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
const net = process.env.NET;
if (!cid || !net || !/localhost|127\.0\.0\.1/.test(process.env.ICP_HOST || "")) throw new Error("enkel lokaal: NET, ICP_HOST=localhost en een canister-id");
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const [admin, calc, wl] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider"].map((n) => backend(n, cid)));
// Het saldo via de beheercanister met de agent (de icp-opdrachten werken niet meer zodra de rollentest de klok verzette).
const { HttpAgent, Actor } = await import("../tools/node_modules/@icp-sdk/core/lib/esm/agent/index.js");
const { Principal } = await import("../tools/lib.mjs");
const { identity } = await import("../tools/lib.mjs");
const mAgent = await HttpAgent.create({ host: process.env.ICP_HOST, identity: identity("proef-admin"), shouldFetchRootKey: true, shouldSyncTime: true });
const mgmt = Actor.createActor(({ IDL }) => IDL.Service({ canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({ cycles: IDL.Nat, memory_size: IDL.Nat })], []) }), { agent: mAgent, canisterId: "aaaaa-aa", callTransform: (_m, a) => ({ effectiveCanisterId: a[0].canister_id }) });
const status = async () => { const r = await mgmt.canister_status({ canister_id: Principal.fromText(cid) }); return { cycles: r.cycles, memory: r.memory_size }; };
const med = (a) => [...a].sort((x, y) => (x < y ? -1 : 1))[Math.floor(a.length / 2)];
const cost = async (fn) => { const r = []; for (let i = 0; i < 3; i++) { const a = (await status()).cycles; await fn(i); r.push(a - (await status()).cycles); } return med(r); };
const sfx = Date.now().toString(36).slice(-4).toUpperCase();
const addr = { street: "Proefweg", number: "1", zip: "9999", city: "Verzonnendorp", country: "BE" };
const WLID = (await wl.me()).person[0].id;
const nowNs = BigInt((await admin.auditLog(0n, 1n))[0].at);
const today = BigInt(Math.floor(Number(nowNs / 1_000_000n) / 86_400_000));
const KLANT = ok(await admin.createOrg({ kind: { client: null }, name: `Proef Klant Meet ${sfx}`, kbo: [], vat: [], aliases: [], trades: [], address: [addr], notes: "verzonnen (2d.1)" })).id;
let made = 0;
let lastWork = null;
const addWork = async () => {
  made++;
  const w = ok(await admin.createWork({ code: `P-M${sfx}-${made}`, name: `Proefwerf meting ${made}`, address: addr, parentId: [], clientOrgId: [KLANT], architectOrgId: [], leaderPersonId: [WLID], vatBp: 2100n })).id;
  const v = (await wl.getPlan(w)).version;
  ok(await wl.saveTask(w, { id: [], title: "Proef ruwbouw", note: "", kind: { work: null }, trade: [], responsibleOrgId: [], status: { planned: null }, percent: 0n, start: today + 20n, workdays: 10n, leadDays: 0n, orderDay: [], reason: "" }, v));
  const t = (await wl.getPlan(w)).tasks?.[0]?.id;
  ok(await wl.savePermit(w, { id: [], kind: "container", title: "", municipalityId: [], status: { needed: null }, location: "voor de deur", taskIds: t != null ? [t] : [], neededFrom: [], neededTo: [], leadDays: [], requestedOn: [], validFrom: [], validTo: [], reference: "", costCents: [], note: "" }));
  ok(await calc.saveInsurance({ id: [], workId: [w], kind: { rc10Sub: null }, insurerOrgId: [], brokerOrgId: [], policyRef: `POL-${made}`, periodFrom: [], periodTo: [], status: { toDeclare: null }, note: "", rev: 0n }));
  const oa = ok(await admin.createOrg({ kind: { subcontractor: null }, name: `Proef OA Meet ${sfx} ${made}`, kbo: [], vat: [], aliases: [], trades: [], address: [addr], notes: "verzonnen (2d.1)" })).id;
  ok(await calc.saveOrgDoc({ orgId: oa, kind: "tienjarige", title: "", fileId: [], validFrom: [], validUntil: [today + 400n], note: "" }));
  lastWork = w;
};
const rounds = ["tick", "mail", "vergunningen", "vergunningen-lijst", "vergunningen-plan", "afspraken", "werfadmin"];
const fake = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64));
for (const N of [1, 10, 100]) {
  while (made < N) await addWork();
  const out = { N, memory: String((await status()).memory) };
  for (const r of rounds) { const a = []; for (let i = 0; i < 3; i++) a.push(await admin.meetKlok(r)); out[r] = String(med(a)); }
  const w = lastWork;
  out.calls = {
    leeg: String(await cost(async () => {})),
    "werf aanmaken": String(await cost(async () => { await addWork(); })),
    "taak bewaren": String(await cost(async () => { const v = (await wl.getPlan(w)).version; ok(await wl.saveTask(w, { id: [], title: "Proef taak", note: "", kind: { work: null }, trade: [], responsibleOrgId: [], status: { planned: null }, percent: 0n, start: today + 30n, workdays: 2n, leadDays: 0n, orderDay: [], reason: "" }, v)); })),
    "verslag (reportSync)": String(await cost(async () => { await wl.reportSync([{ opId: crypto.randomUUID(), clientKey: `K${sfx}${N}`, op: { ensure: { workId: w, day: today } } }]); })),
    "offerte aanmaken": String(await cost(async () => { ok(await calc.createQuote({ workId: w, number: "", title: "Proef offerte meting" })); })),
    "bestand registreren 1 MB": String(await cost(async (i) => { ok(await calc.addFile(`proef-${N}-${i}.pdf`, "application/pdf", 1_000_000n, fake(String(i)), [w], false)); })),
    "verzekering bewaren": String(await cost(async () => { ok(await calc.saveInsurance({ id: [], workId: [w], kind: { other: "Proef" }, insurerOrgId: [], brokerOrgId: [], policyRef: "POL", periodFrom: [], periodTo: [], status: { toDeclare: null }, note: "", rev: 0n })); })),
    "vergunningronde nu (scanPermits)": String(await cost(async () => { await admin.scanPermits(); })),
  };
  // Queries (werf openen, dashboard, lijst, Mijn week) kosten op de IC geen cycli; enkel nagaan dat ze lopen.
  await admin.getWork(w); await admin.listWorks(); await admin.dashboard(today); await admin.me();
  console.log("MEET " + JSON.stringify(out));
}
