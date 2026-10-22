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
  });
  return Actor.createActor(idlFactory, { agent, canisterId });
}

export function ok(r) {
  if (r && typeof r === "object" && "err" in r) throw new Error(r.err);
  return r && typeof r === "object" && "ok" in r ? r.ok : r;
}
