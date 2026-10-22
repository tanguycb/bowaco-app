import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
import type { ExternalBlob } from "@caffeineai/object-storage";
export type { ExternalBlob } from "@caffeineai/object-storage";
export interface AuditEntry {
    at: bigint;
    who: Principal;
    action: string;
    detail: string;
    personId?: bigint;
}
export type CodeState = {
    __kind__: "revoked";
    revoked: {
        at: bigint;
        by: bigint;
    };
} | {
    __kind__: "open";
    open: null;
} | {
    __kind__: "used";
    used: {
        at: bigint;
        by: Principal;
    };
};
export interface FileRec {
    at: bigint;
    id: bigint;
    blob: ExternalBlob;
    mime: string;
    name: string;
    size: bigint;
    personId: bigint;
}
export interface InviteView {
    id: bigint;
    expiresAt: bigint;
    hint: string;
    kind: CodeKind;
    createdAt: bigint;
    createdBy: bigint;
    personName: string;
    personId: bigint;
    state: CodeState;
}
export interface LinkView {
    status: LinkStatus;
    linkedAt: bigint;
    principal: Principal;
    confirmedBy?: bigint;
    personName: string;
    codeHint: string;
    personId: bigint;
}
export interface MeView {
    blockedUntil?: bigint;
    status: Variant_active_pending_anonymous_unlinked;
    principal: Principal;
    person?: Person;
    isRobot: boolean;
}
export interface NewCode {
    expiresAt: bigint;
    code: string;
    inviteId: bigint;
    personId: bigint;
}
export interface NewTicket {
    ticket: string;
    expiresAt: bigint;
    ticketId: bigint;
}
export interface Person {
    id: bigint;
    name: string;
    createdAt: bigint;
    createdBy: bigint;
    phone?: string;
    roles: Array<Role>;
}
export interface ProbeNote {
    at: bigint;
    by: Principal;
    id: bigint;
    text: string;
    version: bigint;
}
export interface ProbeStatus {
    files: bigint;
    canisterTime: bigint;
    expiredTickets: bigint;
    timerRecent: Array<bigint>;
    probeNotes: bigint;
    version: string;
    persons: bigint;
    vetkdLastAt: bigint;
    timerTicks: bigint;
    vetkdLastReport: string;
    envNames: Array<string>;
    timerLastTick: bigint;
}
export interface Proposal {
    at: bigint;
    by: Principal;
    id: bigint;
    content: string;
    ticketId: bigint;
    personId: bigint;
}
export type Result = {
    __kind__: "ok";
    ok: bigint;
} | {
    __kind__: "err";
    err: string;
};
export type Result_1 = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: string;
};
export type Result_2 = {
    __kind__: "ok";
    ok: MeView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_3 = {
    __kind__: "ok";
    ok: NewCode;
} | {
    __kind__: "err";
    err: string;
};
export type Result_4 = {
    __kind__: "ok";
    ok: NewTicket;
} | {
    __kind__: "err";
    err: string;
};
export type Result_5 = {
    __kind__: "ok";
    ok: Person;
} | {
    __kind__: "err";
    err: string;
};
export type Result_6 = {
    __kind__: "ok";
    ok: TicketInfo;
} | {
    __kind__: "err";
    err: string;
};
export interface TicketInfo {
    expiresAt: bigint;
    budgetCents: bigint;
    task: string;
    werf: string;
    personName: string;
    ticketId: bigint;
    personId: bigint;
}
export enum CodeKind {
    invite = "invite",
    recovery = "recovery"
}
export enum LinkStatus {
    active = "active",
    pending = "pending"
}
export enum Role {
    admin = "admin",
    werfleider = "werfleider",
    onderaannemer = "onderaannemer",
    calculator = "calculator",
    architect = "architect",
    klant = "klant"
}
export enum Variant_active_pending_anonymous_unlinked {
    active = "active",
    pending = "pending",
    anonymous = "anonymous",
    unlinked = "unlinked"
}
export interface backendInterface {
    addFile(name: string, mime: string, size: bigint, blob: ExternalBlob): Promise<Result>;
    addProbeNote(text: string): Promise<Result>;
    auditLog(last: bigint): Promise<Array<AuditEntry>>;
    checkTicket(ticket: string): Promise<Result_6>;
    claimBootstrap(code: string, name: string): Promise<Result_5>;
    confirmLink(p: Principal): Promise<Result_1>;
    createRecoveryCode(personId: bigint, validDays: bigint): Promise<Result_3>;
    createTicket(task: string, werf: string): Promise<Result_4>;
    invitePerson(name: string, roles: Array<Role>, validDays: bigint): Promise<Result_3>;
    listFiles(): Promise<Array<FileRec>>;
    listInvites(): Promise<Array<InviteView>>;
    listLinks(): Promise<Array<LinkView>>;
    listPersons(): Promise<Array<Person>>;
    me(): Promise<MeView>;
    myProposals(): Promise<Array<Proposal>>;
    probeNotes(): Promise<Array<ProbeNote>>;
    probeStatus(): Promise<ProbeStatus>;
    probeVetkd(): Promise<string>;
    redeemCode(code: string): Promise<Result_2>;
    revokeInvite(inviteId: bigint): Promise<Result_1>;
    revokeLink(p: Principal): Promise<Result_1>;
    submitProposal(ticketId: bigint, content: string): Promise<Result>;
}
