// Zet een verzonnen proefwerf klaar voor de proef in Chrome (stap 2.9): werf "P-OMUI-…" met een aanvaarde proefofferte (7 posten),
// de proef-OA (Proef Dak NV) als lid en de werfleider als werfleider. GEEN opmeting: die maak je in de app. Schrijft wat
// ze maakte naar stdout. Enkel testgegevens.
//   node tests/opmeting-opzet.mjs <canister-id>
import { backend } from "../tools/lib.mjs";
import { proefWerf } from "./opmeting-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/opmeting-opzet.mjs <canister-id>");
const [admin, wl, calc, oa2] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-oa2"].map((n) => backend(n, cid)));
const w = await proefWerf({ admin, calc, wl }, { prefix: "P-OMUI", titleSuffix: " voor Chrome" });
const m = await admin.addMembership(w.wid, [(await oa2.me()).person[0].id], [], { onderaannemer: null }, []);
if ("err" in m) throw new Error(m.err);
await admin.setWorkStatus(w.wid, { running: null });
console.log(JSON.stringify({ werf: w.W, id: String(w.wid), offerte: w.NR }));
