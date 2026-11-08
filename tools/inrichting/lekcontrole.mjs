// Stap 2b.6: lekcontrole op een ingerichte canister (ook met echte gegevens, enkel lokaal of na het "ja"; de enige proef die op live mag): een onbekende
// identiteit (geen persoon, geen koppeling) roept ELKE query van de backend aan met lege of nul-argumenten. Elke oproep
// moet geweigerd worden of leeg/zonder inhoud terugkomen; wat iets met inhoud teruggeeft, staat in de uitvoer. Leest enkel.
//   ICP_HOST=http://localhost:8061 node tools/inrichting/lekcontrole.mjs <canister> [--ids 400]
// 2c.9 (stap 8): daarna per werf-id 0…ids (de import van één werf): werf, dossier, bestanden, offertes, planning, leden en
// OA-offertes met dat id; alles moet geweigerd of leeg zijn.
import { IDL } from "@icp-sdk/core/candid";
import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import { freshBackend } from "../lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tools/inrichting/lekcontrole.mjs <canister>");
const svc = idlFactory({ IDL });
const leeg = (t) => {
  const n = t.constructor.name;
  if (n.includes("Nat") || n.includes("Int")) return n.includes("64") || n.includes("Nat") && !n.includes("8") && !n.includes("16") && !n.includes("32") ? 0n : 0;
  if (n.includes("Text")) return "";
  if (n.includes("Bool")) return false;
  if (n.includes("Opt")) return [];
  if (n.includes("Vec")) return [];
  if (n.includes("Principal")) return { toUint8Array: () => new Uint8Array(), _isPrincipal: true };
  if (n.includes("Record")) return Object.fromEntries(t._fields.map(([k, v]) => [k, leeg(v)]));
  if (n.includes("Variant")) return { [t._fields[0][0]]: leeg(t._fields[0][1]) };
  if (n.includes("Rec")) return leeg(t._type);
  return null;
};
// Publiek bedoeld (geen gegevens van BOWACO): de begroeting van de app en de controle van een ticket door een robot.
// 3.13: myBot (wie ben ik voor de toestemmingspagina: enkel de eigen stand), de inlogpagina en een geregistreerde MCP-klant.
const PUBLIEK = new Set(["me", "myBot", "_caffeineMcpSignInOrigin", "_caffeineMcpClient", "_initialize_access_control", "http_request", "icrc10_supported_standards", "icrc21_canister_call_consent_message", "_caffeineStorageBlobIsLive", "_caffeineStorageBlobsToDelete", "_caffeineStorageRefillCashier", "_caffeineStorageUpdateGatewayPrincipals", "_caffeineStorageCreateCertificate"]);
const a = await freshBackend(cid, { alleenLezen: true }); // ook op live: enkel queries
let geweigerd = 0, leegTerug = 0, publiek = 0;
const inhoud = [];
for (const [naam, f] of svc._fields) {
  if (!f.annotations.includes("query")) continue;
  if (PUBLIEK.has(naam)) { publiek++; continue; }
  let args;
  try { args = f.argTypes.map(leeg); } catch { args = null; }
  try {
    const r = await a[naam](...(args ?? []));
    const s = JSON.stringify(r, (_, v) => (typeof v === "bigint" ? Number(v) : v));
    if (r === null || s === "[]" || s === "null" || /"err"/.test(s) || s === "0" || s === "false" || s === '""') leegTerug++;
    else inhoud.push(`${naam}: ${s.slice(0, 120)}`);
  } catch { geweigerd++; }
}
const ids = Number(process.argv.includes("--ids") ? process.argv[process.argv.indexOf("--ids") + 1] : 400);
let perWerf = 0;
for (let id = 0n; id <= BigInt(ids); id++) {
  for (const [naam, args] of [["getWork", [id]], ["getDossier", [id]], ["listFiles", [[id]]], ["listQuotes", [[id], true]], ["getPlan", [id]], ["listMembers", [id]], ["listOaQuotes", [id]], ["listTenders", [[id]]]]) {
    if (typeof a[naam] !== "function") continue;
    perWerf++;
    try {
      const r = await a[naam](...args);
      const s = JSON.stringify(r, (_, v) => (typeof v === "bigint" ? Number(v) : v));
      if (r === null || s === "[]" || s === "null" || /"err"/.test(s)) leegTerug++;
      else inhoud.push(`${naam}(${id}): ${s.slice(0, 120)}`);
    } catch { geweigerd++; }
  }
}
console.log(`per werf-id 0…${ids}: ${perWerf} oproepen`);
console.log(`queries: ${geweigerd} geweigerd · ${leegTerug} leeg of fout · ${publiek} publiek bedoeld · ${inhoud.length} met inhoud`);
for (const x of inhoud) console.log(`  ? ${x}`);
process.exit(inhoud.length ? 1 : 0);
