// Upgrade van de backend op het EIGEN lokale net met de agent (in stukken van 1 MB, mode upgrade, geheugen behouden), voor als
// `icp deploy` weigert omdat een klokproef de tijd van het net verzette (ingress expiry, zie de les in docs/herstel.md §8).
// De testbeheerder (proef-admin) moet controller zijn (tests/lokaal.sh of tools/draft-opbouw.mjs --proef doen dat). Nooit op
// een draft of live: weigert een host die niet lokaal is.
//   ICP_HOST=http://localhost:<poort> node tools/upgrade-lokaal.mjs <canister> [<wasm>]
import { HttpAgent, Actor } from "@icp-sdk/core/agent";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { identity, Principal } from "./lib.mjs";

const [cid, wasmPath = new URL("../src/backend/dist/backend.wasm", import.meta.url).pathname] = process.argv.slice(2);
const host = process.env.ICP_HOST || "";
if (!cid || (!host.includes("localhost") && !host.includes("127.0.0.1"))) throw new Error("gebruik: ICP_HOST=http://localhost:<poort> node tools/upgrade-lokaal.mjs <canister> [<wasm>] (enkel lokaal)");
const agent = await HttpAgent.create({ host, identity: identity("proef-admin"), shouldFetchRootKey: true, shouldSyncTime: true });
const idl = ({ IDL }) => {
  const persist = IDL.Variant({ keep: IDL.Null, replace: IDL.Null });
  const mode = IDL.Variant({ install: IDL.Null, reinstall: IDL.Null, upgrade: IDL.Opt(IDL.Record({ skip_pre_upgrade: IDL.Opt(IDL.Bool), wasm_memory_persistence: IDL.Opt(persist) })) });
  return IDL.Service({
    upload_chunk: IDL.Func([IDL.Record({ canister_id: IDL.Principal, chunk: IDL.Vec(IDL.Nat8) })], [IDL.Record({ hash: IDL.Vec(IDL.Nat8) })], []),
    clear_chunk_store: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [], []),
    install_chunked_code: IDL.Func([IDL.Record({ mode, target_canister: IDL.Principal, store_canister: IDL.Opt(IDL.Principal), chunk_hashes_list: IDL.Vec(IDL.Record({ hash: IDL.Vec(IDL.Nat8) })), wasm_module_hash: IDL.Vec(IDL.Nat8), arg: IDL.Vec(IDL.Nat8), sender_canister_version: IDL.Opt(IDL.Nat64) })], [], []),
  });
};
const canister_id = Principal.fromText(cid);
const mgmt = Actor.createActor(idl, { agent, canisterId: "aaaaa-aa", callTransform: () => ({ effectiveCanisterId: canister_id }) });
const wasm = readFileSync(wasmPath);
await mgmt.clear_chunk_store({ canister_id });
const hashes = [];
for (let i = 0; i < wasm.length; i += 1_000_000) hashes.push(await mgmt.upload_chunk({ canister_id, chunk: [...wasm.subarray(i, i + 1_000_000)] }));
const arg = new Uint8Array([0x44, 0x49, 0x44, 0x4c, 0x00, 0x00]); // DIDL zonder argumenten
await mgmt.install_chunked_code({ mode: { upgrade: [{ skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }] }, target_canister: canister_id, store_canister: [], chunk_hashes_list: hashes, wasm_module_hash: [...createHash("sha256").update(wasm).digest()], arg: [...arg], sender_canister_version: [] });
await mgmt.clear_chunk_store({ canister_id });
console.log(`upgrade ${cid}: ${(wasm.length / 1_048_576).toFixed(2)} MiB in ${hashes.length} stukken`);
