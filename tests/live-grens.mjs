// 2b.6 (live): de grens rond de echte omgeving in het gereedschap. Een canister uit tools/live-canisters.json (hier via
// LIVE_CANISTERS_EXTRA een verzonnen id) weigert elke testsleutel, anoniem, een wegwerpidentiteit en de testscripts;
// enkel de inrichtingsidentiteit en de alleen-lezen lekcontrole mogen. Zonder netwerk: elke weigering valt vóór de oproep.
//   node tests/live-grens.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIVE = "rrkah-fqaaa-aaaaa-aaaaq-cai"; // een geldig maar willekeurig id (niet dat van BOWACO)
const DRAFT = "ryjl3-tyaaa-aaaaa-aaaba-cai";
process.env.LIVE_CANISTERS_EXTRA = LIVE;
process.env.LIVE_DEMO = "0"; // eerst de strikte grens (na de herinstallatie); de demo-uitzondering (2c.9) onderaan
const { backend, demoLive, freshBackend, isLiveCanister, LIVE_ID, setCanisterEnv, testsleutelOpLive, weigerLive } = await import("../tools/lib.mjs");

let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const weigert = async (f) => { try { await f(); return ""; } catch (e) { return String(e.message); } };

// 3.12 (review L): de livegrens van Config.mo (tools/config-grens.mjs, gebruikt door de meetlat): de echte Config.mo slaagt, en elke
// afwijking wordt geweigerd, ook als de veilige regel nog in commentaar staat of de definitie anders geschreven is.
{
  const { readFileSync } = await import("node:fs");
  const { configGrens } = await import("../tools/config-grens.mjs");
  const cfg = readFileSync(fileURLToPath(new URL("../src/backend/lib/Config.mo", import.meta.url)), "utf8");
  check("livegrens: de echte Config.mo slaagt", configGrens(cfg).length === 0, configGrens(cfg).join("; "));
  const muts = [
    ["aiLiveAnyCanister = true", (c) => c.replace("public let aiLiveAnyCanister : Bool = false;", "public let aiLiveAnyCanister : Bool = true;")],
    ["mailLiveAnyCanister = true", (c) => c.replace("public let mailLiveAnyCanister : Bool = false;", "public let mailLiveAnyCanister : Bool = true;")],
    ["measureAnyCanister = true", (c) => c.replace("public let measureAnyCanister : Bool = false;", "public let measureAnyCanister : Bool = true;")],
    ["aiGatewayEnabled = true", (c) => c.replace("public let aiGatewayEnabled : Bool = false;", "public let aiGatewayEnabled : Bool = true;")],
    ["aiLiveBackends met een id", (c) => c.replace("public func aiLiveBackends() : [Text] { [] };", 'public func aiLiveBackends() : [Text] { ["rrkah-fqaaa-aaaaa-aaaaq-cai"] };')],
    ["mailLiveBackends met een id", (c) => c.replace("public func mailLiveBackends() : [Text] { [] };", 'public func mailLiveBackends() : [Text] { ["rrkah-fqaaa-aaaaa-aaaaq-cai"] };')],
    ["veilige regel in commentaar, echte definitie zonder type", (c) => c.replace("public let aiLiveAnyCanister : Bool = false;", "// public let aiLiveAnyCanister : Bool = false;\n  public let aiLiveAnyCanister = true;")],
    ["lijst over meerdere regels", (c) => c.replace("public func aiLiveBackends() : [Text] { [] };", 'public func aiLiveBackends() : [Text] {\n    ["rrkah-fqaaa-aaaaa-aaaaq-cai"];\n  };')],
    ["tweede definitie", (c) => c + "\n  public let aiGatewayEnabled : Bool = false;\n"],
    ["vlag weg", (c) => c.replace("public let aiGatewayEnabled : Bool = false;", "")],
  ];
  for (const [n, f] of muts) {
    const m = f(cfg);
    check(`livegrens weigert: ${n}`, m !== cfg && configGrens(m).length > 0);
  }
}

check("live-id herkend, draft niet", isLiveCanister(LIVE) && !isLiveCanister(DRAFT));
for (const id of ["proef-admin", "robot-test", null]) {
  const e = await weigert(() => backend(id, LIVE));
  check(`backend als ${id ?? "anoniem"} op live geweigerd`, /Geweigerd: .* echte omgeving/.test(e), e);
}
check("backend als inrichtingsidentiteit op live toegelaten", (await weigert(() => backend(LIVE_ID, LIVE))) === "");
check("backend als proef-admin op een draft toegelaten", (await weigert(() => backend("proef-admin", DRAFT))) === "");
check("wegwerpidentiteit op live geweigerd", /echte omgeving/.test(await weigert(() => freshBackend(LIVE))));
const lees = await freshBackend(LIVE, { alleenLezen: true });
check("alleen-lezen: een update wordt geweigerd vóór ze vertrekt", /alleen lezen: createWork/.test(await weigert(() => lees.createWork({}))));
check("alleen-lezen: een query blijft een functie", typeof lees.listWorks === "function");
check("omgevingsvariabelen op live geweigerd", /echte omgeving/.test(await weigert(() => setCanisterEnv("proef-admin", LIVE, {}))));
check("weigerLive op een draft: niets", (await weigert(() => weigerLive(DRAFT, "x"))) === "");

// De scripts zelf (eigen proces, zelfde extra lijst): ze stoppen vóór elke oproep.
const root = fileURLToPath(new URL("..", import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", env: { ...process.env, ICP_HOST: "https://icp-api.io", ...env }, timeout: 60_000 });
for (const [n, args] of [["rollentest", ["tests/rollen.mjs", LIVE]], ["lektest", ["tests/lek.mjs", LIVE]], ["review", ["tests/review.mjs", LIVE]], ["geheugen", ["tools/geheugen.mjs", LIVE]]]) {
  const r = run(args);
  check(`${n} op live: stopt met "Geweigerd"`, r.status !== 0 && /Geweigerd: .* echte omgeving/.test(r.stderr + r.stdout), (r.stderr || r.stdout).split("\n").find((l) => /Geweigerd|Error/.test(l)) ?? `exit ${r.status}`);
}
const k = run(["tools/proef-admin-koppelen.mjs", LIVE], { UITNODIGING_CODE: "BOW-0000-0000-0000-0000" });
check("testbeheerder koppelen op live geweigerd", k.status === 1 && /Geweigerd: dit is een live-canister/.test(k.stderr), k.stderr.trim());
const k2 = run(["tools/inrichting/koppelen.mjs", DRAFT], { UITNODIGING_CODE: "BOW-0000-0000-0000-0000" });
check("inrichtingsidentiteit koppelen: enkel aan een canister uit de live-lijst", k2.status === 1 && /live-canisters.json/.test(k2.stderr), k2.stderr.trim());
const i = run(["tools/inrichting.mjs", "--canister", LIVE, "--stap", "1"]);
check("inrichting op live zonder JA_EIGENAAR: geweigerd", i.status !== 0, (i.stderr || i.stdout).split("\n").find((l) => l.trim()) ?? "");

// 2c.9 demo-live: testsleutels mogen, testreeksen en testgegevens niet; echte mail blijft uit.
process.env.LIVE_DEMO = "1";
check("demo-live: vlag aan", demoLive());
const argv1 = process.argv[1];
process.argv[1] = fileURLToPath(new URL("../tools/losse-oproep.mjs", import.meta.url)); // alsof een script uit tools/ het vraagt
check("demo-live: backend als proef-admin op live toegelaten (vanuit tools/)", (await weigert(() => backend("proef-admin", LIVE))) === "");
process.argv[1] = argv1;
check("demo-live: backend als proef-admin vanuit tests/ nog geweigerd", /echte omgeving/.test(await weigert(() => backend("proef-admin", LIVE))));
check("demo-live: anoniem en robot op live nog geweigerd", /echte omgeving/.test(await weigert(() => backend(null, LIVE))) && /echte omgeving/.test(await weigert(() => backend("robot-test", LIVE))));
check("demo-live: wegwerpidentiteit en omgevingsvariabelen nog geweigerd", /echte omgeving/.test(await weigert(() => freshBackend(LIVE))) && /echte omgeving/.test(await weigert(() => setCanisterEnv("proef-admin", LIVE, {}))));
check("demo-live: geen uitzondering op een draft nodig, geen op een niet-live canister", !testsleutelOpLive(DRAFT, "proef-admin"));
for (const [n, args] of [["rollentest", ["tests/rollen.mjs", LIVE]], ["lektest", ["tests/lek.mjs", LIVE]], ["review", ["tests/review.mjs", LIVE]], ["geheugen", ["tools/geheugen.mjs", LIVE]], ["stresstest", ["tools/weekbord-stress.mjs", LIVE]], ["proefopbouw", ["tools/draft-opbouw.mjs", LIVE]]]) {
  const r = run(args, { LIVE_DEMO: "1" });
  check(`demo-live: ${n} op live stopt nog met "Geweigerd"`, r.status !== 0 && /Geweigerd: .* echte omgeving/.test(r.stderr + r.stdout), (r.stderr || r.stdout).split("\n").find((l) => /Geweigerd|Error/.test(l)) ?? `exit ${r.status}`);
}
const kd = run(["tools/proef-admin-koppelen.mjs", LIVE], { LIVE_DEMO: "1", UITNODIGING_CODE: "BOW-0000-0000-0000-0000" });
check("demo-live: testbeheerder koppelen voorbij de live-weigering (de code zelf faalt: geen netwerkcanister)", !/Geweigerd: dit is een live-canister/.test(kd.stderr) && /Demo-live/.test(kd.stdout), (kd.stdout + kd.stderr).split("\n").find((l) => l.trim()) ?? "");

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
