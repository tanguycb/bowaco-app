// Tellingen van een canister (voor en na een upgrade, M9/M11): personen, koppelingen, codes, werven …
//   node tools/telling.mjs <backend-canister>      (als testbeheerder; enkel op een draft of lokaal)
import { backend } from "./lib.mjs";
const e = await (await backend("proef-admin", process.argv[2])).exportIntern();
console.log(JSON.stringify({ versie: e.version, personen: e.persons.length, koppelingen: e.links.length, historiek: e.linkHistory.length, codes: e.invites.length, organisaties: e.orgs.length, werven: e.works.length, leden: e.memberships.length, bestanden: e.files.length, robots: e.robots.length, voorstellen: e.proposals.length, audit: Number(e.auditCount) }));
