// De gateway belt de app (nooit omgekeerd, architectuur §6): als robotprincipal, met een eigen Ed25519-sleutel.
// Enkel de functies die een robot mag (R28, ontwerp 3.1 §3.3): checkTicket, submitProposal, reportAiUsage,
// failAiTicket. De robot leest niets uit de app: alle invoer komt via de browser mee in de taak.
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { readFileSync } from "node:fs";
import type { Config } from "./config.ts";

export type Res<T> = { ok: T } | { err: string };
// TicketInfo zoals de app het vandaag teruggeeft (views.mo). `model`, `fallbackModel` en `payloadRef` zijn opt:
// ontbreken ze in het antwoord van de app, dan decodeert Candid ze als [] (getest). Geeft de app ze later mee, dan
// gaan ze vóór wat de browser in `invoer` zet (de app is dan de bron van het model, niet de browser).
export type TicketInfo = {
  ticketId: bigint;
  personId: bigint;
  personName: string;
  task: string;
  workId: [] | [bigint];
  budgetCents: bigint;
  expiresAt: bigint;
  model?: [] | [string];
  fallbackModel?: [] | [string];
  payloadRef?: [] | [string];
};

// reportAiUsage(ticketId, usage): de gateway meldt tokens, kost in eurocent, model en duur (ontwerp §2.9).
// Exact het record van de app (src/backend/types/aiviews.mo, AiUsage). De uitkomst van een mislukte taak gaat via
// failAiTicket; outputSha256 = SHA-256 (hex) van de voorstel-inhoud, enkel bij een geslaagde taak.
export type AiUsage = {
  model: string;
  promptTokens: bigint;
  completionTokens: bigint;
  cachedTokens: bigint;
  costCents: bigint;
  durationMs: bigint;
  outputSha256: [] | [string];
};

export type Robot = {
  checkTicket(ticket: string): Promise<Res<TicketInfo>>;
  submitProposal(ticketId: bigint, kind: string, content: string): Promise<Res<bigint>>;
  reportAiUsage(ticketId: bigint, usage: AiUsage): Promise<Res<null>>;
  failAiTicket(ticketId: bigint, why: string): Promise<Res<null>>;
};

export const idlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const TicketInfo = IDL.Record({
    ticketId: IDL.Nat,
    personId: IDL.Nat,
    personName: IDL.Text,
    task: IDL.Text,
    workId: IDL.Opt(IDL.Nat),
    budgetCents: IDL.Nat,
    expiresAt: IDL.Int,
    model: IDL.Opt(IDL.Text),
    fallbackModel: IDL.Opt(IDL.Text),
    payloadRef: IDL.Opt(IDL.Text),
  });
  const AiUsage = IDL.Record({
    model: IDL.Text,
    promptTokens: IDL.Nat,
    completionTokens: IDL.Nat,
    cachedTokens: IDL.Nat,
    costCents: IDL.Nat,
    durationMs: IDL.Nat,
    outputSha256: IDL.Opt(IDL.Text),
  });
  const Unit = IDL.Variant({ ok: IDL.Null, err: IDL.Text });
  return IDL.Service({
    checkTicket: IDL.Func([IDL.Text], [IDL.Variant({ ok: TicketInfo, err: IDL.Text })], []),
    submitProposal: IDL.Func([IDL.Nat, IDL.Text, IDL.Text], [IDL.Variant({ ok: IDL.Nat, err: IDL.Text })], []),
    reportAiUsage: IDL.Func([IDL.Nat, AiUsage], [Unit], []),
    failAiTicket: IDL.Func([IDL.Nat, IDL.Text], [Unit], []),
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
