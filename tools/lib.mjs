// Gemeenschappelijke hulp voor de proefscripts van stap 0.2.
// Sleutels staan in ~/.bowaco (buiten de repo, nooit in git).
import { HttpAgent, Actor } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { idlFactory } from "../src/frontend/src/declarations/backend.did.js";

export const KEYDIR = join(homedir(), ".bowaco");

// Laadt of maakt een Ed25519-sleutel met deze naam (bv. "robot-test", "proef-admin").
export function identity(name) {
  const file = join(KEYDIR, `${name}.json`);
  if (!existsSync(file)) {
    mkdirSync(KEYDIR, { recursive: true, mode: 0o700 });
    const id = Ed25519KeyIdentity.generate();
    writeFileSync(file, JSON.stringify(id.toJSON()), { mode: 0o600 });
  }
  return Ed25519KeyIdentity.fromJSON(readFileSync(file, "utf8"));
}

// HOST = http://localhost:<poort> voor het eigen testnetwerk, anders mainnet (draft).
export async function backend(identityName, canisterId) {
  const host = process.env.ICP_HOST || "https://icp-api.io";
  const local = host.includes("localhost") || host.includes("127.0.0.1");
  const agent = await HttpAgent.create({
    host,
    identity: identityName ? identity(identityName) : undefined,
    shouldFetchRootKey: local, // alleen lokaal; op mainnet zit de sleutel in de agent
    shouldSyncTime: local, // lokaal kan de rollentest de klok van het net verzetten
  });
  return Actor.createActor(idlFactory, { agent, canisterId });
}

export function ok(r) {
  if (r && typeof r === "object" && "err" in r) throw new Error(r.err);
  return r && typeof r === "object" && "ok" in r ? r.ok : r;
}

// Wegwerpidentiteit (niet bewaard): voor de remmingstest en de lektestrobot.
export async function freshBackend(canisterId) {
  const host = process.env.ICP_HOST || "https://icp-api.io";
  const local = host.includes("localhost") || host.includes("127.0.0.1");
  const agent = await HttpAgent.create({ host, identity: Ed25519KeyIdentity.generate(), shouldFetchRootKey: local, shouldSyncTime: local });
  return Actor.createActor(idlFactory, { agent, canisterId });
}

// Na het verzetten van de klok (alleen lokaal): elke agent opnieuw gelijkzetten.
export async function resync(...actors) {
  for (const a of actors) await Actor.agentOf(a).syncTime();
}
export { Principal } from "@icp-sdk/core/principal";

// mail-caffeine: de nep-maildienst van het EIGEN lokale net (tests/net/nepmail.mo). Enkel lokaal; NEPMAIL = canister-id
// (tests/lokaal.sh zet het). Op een draft is er geen nep-maildienst: daar gaat de mail naar Caffeine (testmodus).
export async function nepmail(canisterId) {
  const host = process.env.ICP_HOST || "";
  if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("nep-maildienst enkel lokaal");
  const agent = await HttpAgent.create({ host, shouldFetchRootKey: true });
  const idl = ({ IDL }) => {
    const Mail = IDL.Record({ to: IDL.Text, subject: IDL.Text, size: IDL.Nat, sub: IDL.Text, from: IDL.Text, html: IDL.Text });
    return IDL.Service({
      zet: IDL.Func([IDL.Text, IDL.Nat, IDL.Nat], [], []),
      mails: IDL.Func([IDL.Nat], [IDL.Vec(Mail)], ["query"]),
      aantal: IDL.Func([], [IDL.Nat], ["query"]),
      onderweg: IDL.Func([], [IDL.Nat], ["query"]),
    });
  };
  return Actor.createActor(idl, { agent, canisterId });
}
