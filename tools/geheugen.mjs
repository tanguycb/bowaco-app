// Geheugen en cycles van een canister via de beheercanister (canister_status), met de agent: werkt ook op een EIGEN testnet
// waarvan de klok verzet is (dan weigert `icp canister status` met "ingress_expiry"). Vraagt dat de testbeheerder controller is
// (tests/lokaal.sh maakt hem dat op het eigen net). Securityreview 2.12 (A5: geheugen meten na de volledige keten).
//   ICP_HOST=http://localhost:8091 node tools/geheugen.mjs <canister-id>
import { HttpAgent, Actor } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import { identity } from "./lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: ICP_HOST=http://localhost:<poort> node tools/geheugen.mjs <canister-id>");
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("enkel op het eigen lokale net (op een draft is Caffeine controller)");
const agent = await HttpAgent.create({ host, identity: identity("proef-admin"), shouldFetchRootKey: true, shouldSyncTime: true });
const idl = ({ IDL }) =>
  IDL.Service({
    canister_status: IDL.Func(
      [IDL.Record({ canister_id: IDL.Principal })],
      [IDL.Record({ status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }), memory_size: IDL.Nat, cycles: IDL.Nat })],
      [],
    ),
  });
const mgmt = Actor.createActor(idl, { agent, canisterId: "aaaaa-aa", callTransform: (_m, args) => ({ effectiveCanisterId: args[0].canister_id }) });
const s = await mgmt.canister_status({ canister_id: Principal.fromText(cid) });
const mb = Number(s.memory_size) / 1_048_576;
console.log(JSON.stringify({ canister: cid, status: Object.keys(s.status)[0], geheugenMB: Math.round(mb * 10) / 10, cycles: s.cycles.toString() }));
