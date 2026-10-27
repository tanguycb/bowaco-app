// Gemeenschappelijke hulp voor de proefscripts van stap 0.2.
// Sleutels staan in ~/.bowaco (buiten de repo, nooit in git).
import { HttpAgent, Actor } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { IDL } from "@icp-sdk/core/candid";
import { idlFactory } from "../src/frontend/src/declarations/backend.did.js";

// 2b.4: een tijdelijke netwerk- of leesfout (ETIMEDOUT, fetch failed, gateway 5xx) breekt een proef niet meer af: QUERIES worden
// tot 5 keer opnieuw geprobeerd (met wachttijd). Updates nooit: een herhaalde update kan dubbel uitgevoerd worden.
const transient = (e) => /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|network|Transport|50[234]/i.test(`${e?.message ?? e} ${e?.cause?.kind ?? ""} ${e?.cause?.code ?? ""}`);
const queryNames = new Set(idlFactory({ IDL })._fields.filter(([, f]) => f.annotations.includes("query")).map(([n]) => n));
function withRetry(actor) {
  return new Proxy(actor, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof k !== "string" || !queryNames.has(k) || typeof v !== "function") return v;
      return async (...a) => {
        for (let i = 0; ; i++) {
          try { return await v.apply(t, a); } catch (e) {
            if (i >= 5 || !transient(e)) throw e;
            await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
          }
        }
      };
    },
  });
}

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
  return withRetry(Actor.createActor(idlFactory, { agent, canisterId }));
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
  return withRetry(Actor.createActor(idlFactory, { agent, canisterId }));
}

// Na het verzetten van de klok (alleen lokaal): elke agent opnieuw gelijkzetten.
export async function resync(...actors) {
  for (const a of actors) await Actor.agentOf(a).syncTime();
}
import { Principal } from "@icp-sdk/core/principal";
export { Principal };

/** 2b.4: de principal van een actor (tests/start-draft.mjs: een verse testpersoon bevestigen). */
export const principalOf = (actor) => Actor.agentOf(actor).getPrincipal();

// 1b.5 (review D9): omgevingsvariabelen van een canister zetten via de beheercanister (update_settings), zoals `icp`
// dat doet. Enkel op het EIGEN lokale net, waar tests/lokaal.sh de testbeheerder controller maakt; de `icp`-opdrachten
// werken daar niet meer zodra de rollentest de klok verzet heeft (ingress expiry), de agent wel (syncTime).
// `vars` vervangt de HELE lijst: geef alles mee wat moet blijven.
export async function setCanisterEnv(identityName, canisterId, vars) {
  const host = process.env.ICP_HOST || "";
  if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("omgevingsvariabelen zetten: enkel lokaal");
  const agent = await HttpAgent.create({ host, identity: identity(identityName), shouldFetchRootKey: true, shouldSyncTime: true });
  const idl = ({ IDL }) =>
    IDL.Service({
      update_settings: IDL.Func([IDL.Record({ canister_id: IDL.Principal, settings: IDL.Record({ environment_variables: IDL.Opt(IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text }))) }), sender_canister_version: IDL.Opt(IDL.Nat64) })], [], []),
    });
  const mgmt = Actor.createActor(idl, { agent, canisterId: "aaaaa-aa", callTransform: (_m, args) => ({ effectiveCanisterId: args[0].canister_id }) });
  const canister_id = Principal.fromText(canisterId);
  await mgmt.update_settings({ canister_id, settings: { environment_variables: [Object.entries(vars).map(([name, value]) => ({ name, value }))] }, sender_canister_version: [] });
}

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
