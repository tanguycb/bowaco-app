// De proefgegevens opnieuw opbouwen op een NIEUWE draftcanister (na een verlopen draft, M11): alles staat in git en in de
// proefscripts, niets alleen op de draft. Voorwaarde: de eigenaar claimde de draft met zijn eigen opstartcode en koppelde
// de testbeheerder (tools/proef-admin-koppelen.mjs). Daarna, na elkaar (logs in ~/.bowaco/opbouw-<canister>/):
//   1. de rollentest in de modus GECLAIMD (proefpersonen, proefwerven P-A/P-B, proeffirma's …; geen claim, geen mail);
//   2. de draftproeven van elke stap (werf, oa, plan, board, extern, verslag, vergunning, boete, wadm, import, posten,
//      offerte, mail droog) en de review;
//   3. NIET de lektest (± 30 min, alleen te draaien: node tests/lek.mjs <canister>).
//   node tools/draft-opbouw.mjs <canister>            op een draft (enkel testgegevens, geen echte mail)
//   node tools/draft-opbouw.mjs --proef <canister>    generale repetitie op het EIGEN lokale net: een eigen sleutel
//                                                     "proef-eigenaar" claimt met de TEST-opstartcode en koppelt de
//                                                     testbeheerder zoals de eigenaar dat op de draft doet
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, identity, KEYDIR, ok } from "./lib.mjs";

const args = process.argv.slice(2);
const proef = args[0] === "--proef";
const cid = proef ? args[1] : args[0];
if (!cid) throw new Error("gebruik: node tools/draft-opbouw.mjs [--proef] <canister>");
const host = process.env.ICP_HOST || "https://icp-api.io";
const local = host.includes("localhost") || host.includes("127.0.0.1");
if (proef && !local) throw new Error("--proef enkel op het eigen lokale net (ICP_HOST=http://localhost:<poort>)");
if (!proef && local) throw new Error("zonder --proef enkel op een draft (lokaal: tests/lokaal.sh)");
const cfg = readFileSync(join(import.meta.dirname, "../src/backend/lib/Config.mo"), "utf8");
if ((cfg.match(/mailLiveBackends\(\)[^{]*\{\s*\[([^\]]*)\]/)?.[1] ?? "").includes(cid)) throw new Error("Geweigerd: dit is een live-canister (Config.mailLiveBackends)");
const repo = join(import.meta.dirname, "..");
const logs = join(KEYDIR, `opbouw-${cid}`);
mkdirSync(logs, { recursive: true, mode: 0o700 });

const admin = await backend("proef-admin", cid);
if (proef) {
  // Zoals de eigenaar op de draft: claimen, de testbeheerder uitnodigen als beheerder, hem laten inwisselen, bevestigen.
  const eig = await backend("proef-eigenaar", cid);
  const code = readFileSync(join(KEYDIR, "test-opstartcode.txt"), "utf8").trim();
  if (Object.keys((await eig.me()).status)[0] !== "active") ok(await eig.claimBootstrap(code, "Proef Eigenaar"));
  if (Object.keys((await admin.me()).status)[0] === "unlinked") {
    const inv = ok(await eig.invitePerson({ name: "Testbeheerder", roles: [{ admin: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [], validDays: 1n, tag: "opbouw" }));
    ok(await admin.redeemCode(inv.code));
    ok(await eig.confirmLink((await admin.me()).principal));
  }
}
// Lokaal (repetitie): de testbeheerder ook controller van de canister op het EIGEN net, zoals tests/lokaal.sh (review D9).
if (proef && process.env.BOWACO_NET && existsSync(join(process.env.BOWACO_NET, "icp.yaml"))) {
  try { execFileSync("icp", ["canister", "settings", "update", "backend", "-e", "local", "--add-controller", admin && (await admin.me()).principal.toText()], { cwd: process.env.BOWACO_NET, stdio: "ignore" }); } catch { /* al controller */ }
}
const me = await admin.me();
const st = Object.keys(me.status)[0];
if (st !== "active" || !me.caps[0]?.manageAccess) {
  console.error(`De testbeheerder is op ${cid} niet actief als beheerder (status: ${st}).`);
  console.error("Eigenaar: Team → Persoon uitnodigen → \"Testbeheerder\", rol Beheerder → code kopiëren →");
  console.error(`  node tools/proef-admin-koppelen.mjs ${cid}   → en de wachtende koppeling bevestigen.`);
  process.exit(2);
}
const works = await admin.listWorks();
if (works.some((w) => w.code === "P-A") && !process.env.OPNIEUW) {
  console.log(`P-A bestaat al op ${cid}: de rollentest draaide hier al (OPNIEUW=1 om enkel de draftproeven te herhalen).`);
}

const env = { ...process.env, ICP_HOST: host };
const run = (name, file, extra = {}, argv = [cid]) => {
  const fd = openSync(join(logs, `${name}.log`), "w");
  const t = Date.now();
  let code = 0;
  try {
    execFileSync("node", [join(repo, file), ...argv], { env: { ...env, ...extra }, stdio: ["ignore", fd, fd] });
  } catch (e) {
    code = e.status ?? 1;
  }
  const out = readFileSync(join(logs, `${name}.log`), "utf8");
  const tail = out.trim().split("\n").filter((l) => /✓.*✗|✗/.test(l)).slice(-1)[0] ?? "";
  const fails = out.split("\n").filter((l) => l.startsWith("✗"));
  console.log(`${code === 0 ? "✓" : "✗"} ${name.padEnd(12)} ${tail.trim()}  [${((Date.now() - t) / 1000).toFixed(0)} s]`);
  for (const f of fails.slice(0, 8)) console.log(`    ${f}`);
  return code;
};

let rood = 0;
if (!works.some((w) => w.code === "P-A")) rood += run("rollen", "tests/rollen.mjs", { GECLAIMD: "1", ZONDER_KLOK: "1" }) ? 1 : 0;
// De rollentest trekt de proefrobot op het einde in (en registreert hem enkel lokaal opnieuw, na de klokproef). Zonder
// registratie is "robot-test" een gewone principal: de review (B4, D3) en de lektest vragen een geregistreerde proefrobot.
await admin.addRobot(identity("robot-test").getPrincipal(), "Proefrobot", ["proef"]).catch(() => {});
for (const [name, file] of [
  ["werf", "tests/werf-draft.mjs"],
  ["oa", "tests/oa-draft.mjs"],
  ["plan", "tests/plan-draft.mjs"],
  ["board", "tests/board-draft.mjs"],
  ["extern", "tests/extern-draft.mjs"],
  ["vergunning", "tests/vergunning-draft.mjs"],
  ["boete", "tests/boete-draft.mjs"],
  ["wadm", "tests/wadm-draft.mjs"],
  ["posten", "tests/posten-draft.mjs"],
  ["offerte", "tests/offerte-draft.mjs"],
  ["rekentest", "tests/rekentest.mjs"], // 2.5: browser = server (op een draft 25 willekeurige offertes)
  ["mail", "tests/mail-proef.mjs"],
]) rood += run(name, file) ? 1 : 0;
// De import van de planning: enkel het GEANONIMISEERDE bestand (tools/plan-anonimiseer.mjs; de proef weigert een ander).
const anon = join(KEYDIR, "plan/plan-anoniem.json");
rood += run("import", "tests/import-draft.mjs", {}, [cid, anon]) ? 1 : 0;
// De draftproef van het werfverslag vraagt ook het project-id (echte upload naar de opslag van dat project).
const project = (readFileSync(join(repo, "caffeine.toml"), "utf8").match(/id = "([^"]+)"/) ?? [])[1];
if (!proef && project) rood += run("verslag", "tests/verslag-draft.mjs", {}, [cid, project]) ? 1 : 0;
rood += run("review", "tests/review.mjs") ? 1 : 0;
console.log(rood ? `\n${rood} onderdeel(en) rood: zie ${logs}` : `\nAlles groen. Daarna alleen: node tests/lek.mjs ${cid}`);
process.exit(rood ? 1 : 0);
