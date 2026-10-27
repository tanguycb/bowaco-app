// Testsleutel uit ~/.bowaco als browsersessie (zonder Internet Identity), om de schermen per rol in Chrome te
// bekijken. Stap 1 in de draftpagina: maak een ECDSA-sleutelpaar (niet exporteerbaar) en geef de publieke sleutel
// (SPKI, hex). Stap 2 hier: de testsleutel delegeert 2 uur aan die sleutel. Stap 3 in de pagina: zet sleutelpaar +
// keten in de slots "session" en "app" van @icp-sdk/auth 9 en de staat "ic-session-state"; herladen.
// De testsleutel zelf verlaat deze computer niet.
// LET OP (2.2): de app wist bij elke login de lokale databanken van ANDERE logins op dit toestel (architectuur §8.5,
// offline/db.ts wipeOthers). Na een test als andere rol is de lokale cache en wachtrij van de eigenaar in deze browser dus
// weg (op de server verandert niets): enkel gebruiken als de eigenaar niets meer in de wachtrij heeft staan.
//   node tools/browser-sessie.mjs proef-klant <spki-hex>
import { DelegationChain } from "@icp-sdk/core/identity";
import { Principal } from "@icp-sdk/core/principal";
import { identity } from "./lib.mjs";

const [name, hex, cid = "45zqo-tiaaa-aaaam-qefla-cai"] = process.argv.slice(2);
if (!name || !hex) throw new Error("gebruik: node tools/browser-sessie.mjs <sleutelnaam> <spki-hex> [backend-id]");
// @icp-sdk/auth 9 eist een sessieketen beperkt tot de II-canister en een app-keten voor de backend.
const II = Principal.fromText("rdmx6-jaaaa-aaaaa-aaadq-cai");
const der = Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
const exp = new Date(Date.now() + 2 * 3600_000);
const id = identity(name);
const key = { toDer: () => der, derKey: der };
const session = await DelegationChain.create(id, key, exp, { targets: [II] });
// 2.2 (25-10): met een app-keten beperkt tot de backend gooide de app de sessie bij het laden weg; de app-keten van een
// echte II-login heeft geen targets, dus deze ook niet (cid blijft als argument voor de compatibiliteit).
void cid;
const app = await DelegationChain.create(id, key, exp);
console.log(JSON.stringify({ session: JSON.stringify(session.toJSON()), app: JSON.stringify(app.toJSON()), state: `${id.getPrincipal().toText()}|${BigInt(exp.getTime()) * 1_000_000n}` }));
