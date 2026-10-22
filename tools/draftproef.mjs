// Metingen op de draft zonder persoon (de opstartcode blijft voor de eigenaar):
// vetkd_public_key (h), timer en omgevingsvariabelen (g), robotherkenning (d), proefnotities (f).
//   node tools/draftproef.mjs <backend-canister> [notitie]
import { backend } from "./lib.mjs";

const [cid, note] = process.argv.slice(2);
if (!cid) throw new Error("gebruik: node tools/draftproef.mjs <backend-canister> [notitie]");
const t = async (label, f) => {
  const t0 = Date.now();
  try {
    const r = await f();
    console.log(`${label} (${Date.now() - t0} ms):`, typeof r === "string" ? r : JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    return r;
  } catch (e) {
    console.log(`${label} (${Date.now() - t0} ms): FOUT ${String(e.message ?? e).split("\n")[0].slice(0, 200)}`);
  }
};

const gast = await backend("proef-vreemde", cid);
const robot = await backend("robot-test", cid);
const anon = await backend(null, cid);

await t("me (anoniem)", () => anon.me());
await t("me (robot)", () => robot.me());
await t("probeStatus anoniem (moet falen)", () => anon.probeStatus());
const s = await t("probeStatus", () => gast.probeStatus());
if (s?.timerRecent?.length > 1) {
  const gaps = s.timerRecent.slice(1).map((v, i) => Number(v - s.timerRecent[i]) / 1e9);
  console.log(`timer: ${s.timerTicks} tikken, tussentijden ${gaps.map((g) => g.toFixed(1)).join(" ")} s`);
}
await t("probeVetkd", () => gast.probeVetkd());
await t("checkTicket onbekend door robot", () => robot.checkTicket("TK-00000000000000000000000000000000"));
await t("checkTicket door niet-robot (moet falen)", () => gast.checkTicket("TK-00000000000000000000000000000000"));
await t("listFiles door gast zonder koppeling (moet falen)", () => gast.listFiles());
if (note) await t("addProbeNote", () => gast.addProbeNote(note));
await t("probeNotes", () => gast.probeNotes());
