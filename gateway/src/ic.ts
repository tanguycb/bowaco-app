// De gateway belt de app (nooit omgekeerd, architectuur §6): als robotprincipal, met een eigen Ed25519-sleutel.
// Enkel de functies die een robot mag (R28) en die de gateway vandaag gebruikt: checkTicket en submitProposal. Geen
// mailopdrachten meer (mail-caffeine, E-11): leaseJobs/completeJob/failJob blijven in de app voor latere robotsoorten.
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { readFileSync } from "node:fs";
import type { Config } from "./config.ts";

export type Res<T> = { ok: T } | { err: string };
export type TicketInfo = { ticketId: bigint; personId: bigint; personName: string; task: string; workId: [] | [bigint]; budgetCents: bigint; expiresAt: bigint };

export type Robot = {
  checkTicket(ticket: string): Promise<Res<TicketInfo>>;
  submitProposal(ticketId: bigint, kind: string, content: string): Promise<Res<bigint>>;
};

export const idlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const TicketInfo = IDL.Record({ ticketId: IDL.Nat, personId: IDL.Nat, personName: IDL.Text, task: IDL.Text, workId: IDL.Opt(IDL.Nat), budgetCents: IDL.Nat, expiresAt: IDL.Int });
  return IDL.Service({
    checkTicket: IDL.Func([IDL.Text], [IDL.Variant({ ok: TicketInfo, err: IDL.Text })], []),
    submitProposal: IDL.Func([IDL.Nat, IDL.Text, IDL.Text], [IDL.Variant({ ok: IDL.Nat, err: IDL.Text })], []),
  });
};

export function loadIdentity(file: string): Ed25519KeyIdentity {
  return Ed25519KeyIdentity.fromJSON(readFileSync(file, "utf8"));
}

export async function connect(cfg: Config): Promise<{ robot: Robot; principal: string }> {
  const identity = loadIdentity(cfg.robotKeyFile);
  const agent = await HttpAgent.create({ host: cfg.icHost, identity, shouldFetchRootKey: cfg.local, shouldSyncTime: true });
  const robot = Actor.createActor(idlFactory, { agent, canisterId: cfg.canisterId }) as unknown as Robot;
  return { robot, principal: identity.getPrincipal().toText() };
}
