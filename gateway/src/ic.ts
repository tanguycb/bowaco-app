// De postbode belt de app (nooit omgekeerd, architectuur §6): als robotprincipal, met een eigen Ed25519-sleutel.
// Enkel de functies die een robot mag (R28): leaseJobs, completeJob, failJob, checkTicket, submitProposal. De IDL staat
// hier met de hand (klein en vast); tests/postbode-proef.mjs bewijst dat ze overeenkomt met de backend.
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { readFileSync } from "node:fs";
import type { Config } from "./config.ts";

export type MailTo = { name: string; email: string };
export type MailSection = { title: string; subtitle: string; lines: string[] };
export type MailOut = { to: MailTo[]; subject: string; preheader: string; heading: string; intro: string; sections: MailSection[]; outro: string; link: [] | [string]; tag: string };
export type JobLease = { id: bigint; kind: string; key: string; attempt: bigint; leaseUntil: bigint; mail: MailOut };
export type Res<T> = { ok: T } | { err: string };
export type TicketInfo = { ticketId: bigint; personId: bigint; personName: string; task: string; workId: [] | [bigint]; budgetCents: bigint; expiresAt: bigint };

export type Robot = {
  leaseJobs(max: bigint): Promise<JobLease[]>;
  completeJob(id: bigint, attempt: bigint, result: string): Promise<Res<null>>;
  failJob(id: bigint, attempt: bigint, why: string, retry: boolean): Promise<Res<null>>;
  checkTicket(ticket: string): Promise<Res<TicketInfo>>;
  submitProposal(ticketId: bigint, kind: string, content: string): Promise<Res<bigint>>;
};

export const idlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const MailTo = IDL.Record({ name: IDL.Text, email: IDL.Text });
  const MailSection = IDL.Record({ title: IDL.Text, subtitle: IDL.Text, lines: IDL.Vec(IDL.Text) });
  const MailOut = IDL.Record({ to: IDL.Vec(MailTo), subject: IDL.Text, preheader: IDL.Text, heading: IDL.Text, intro: IDL.Text, sections: IDL.Vec(MailSection), outro: IDL.Text, link: IDL.Opt(IDL.Text), tag: IDL.Text });
  const JobLease = IDL.Record({ id: IDL.Nat, kind: IDL.Text, key: IDL.Text, attempt: IDL.Nat, leaseUntil: IDL.Int, mail: MailOut });
  const Unit = IDL.Variant({ ok: IDL.Null, err: IDL.Text });
  const TicketInfo = IDL.Record({ ticketId: IDL.Nat, personId: IDL.Nat, personName: IDL.Text, task: IDL.Text, workId: IDL.Opt(IDL.Nat), budgetCents: IDL.Nat, expiresAt: IDL.Int });
  return IDL.Service({
    leaseJobs: IDL.Func([IDL.Nat], [IDL.Vec(JobLease)], []),
    completeJob: IDL.Func([IDL.Nat, IDL.Nat, IDL.Text], [Unit], []),
    failJob: IDL.Func([IDL.Nat, IDL.Nat, IDL.Text, IDL.Bool], [Unit], []),
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
