// 1.9 V-02 / 2.2: bewijst dat de back-up van de app (src/frontend/src/backup.ts, dezelfde code als de knop in Auditlog)
// terug te zetten is met tests/herstel.mjs. Schrijft intern.json, vertrouwelijk.json en audit.json in <map> (buiten git!)
// als testbeheerder. Enkel op een eigen lokaal net of een draft.
//   ICP_HOST=http://localhost:8050 node tools/backup-proef.mjs <canister> <map>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backend } from "./lib.mjs";
import { backupAudit, backupConfidential, backupIntern, toJson } from "../src/frontend/src/backup.ts";

const [cid, dir] = process.argv.slice(2);
if (!cid || !dir) throw new Error("gebruik: node tools/backup-proef.mjs <canister> <map>");
const raw = await backend("proef-admin", cid);
const b = { actor: raw, me: () => raw.me() }; // zoals de Backend-klasse van de app: de ruwe actor zit in .actor
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(join(dir, "intern.json"), toJson(await backupIntern(b)), { mode: 0o600 });
writeFileSync(join(dir, "vertrouwelijk.json"), toJson(await backupConfidential(b)), { mode: 0o600 });
writeFileSync(join(dir, "audit.json"), toJson(await backupAudit(b)), { mode: 0o600 });
console.log(`back-up zoals de app → ${dir}`);
