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
export interface AccessStats {
    pendingLinks: bigint;
    failuresThisHour: bigint;
    codesLockedUntil?: bigint;
    persons: bigint;
    activeLinks: bigint;
    openInvites: bigint;
}
export interface Address {
    zip: string;
    street: string;
    country: string;
    city: string;
    number: string;
}
export interface AuditEntry {
    at: bigint;
    who: Principal;
    action: string;
    detail: string;
    personId?: PersonId;
    workId?: WorkId;
}
export interface Caps {
    manageAccess: boolean;
    inviteExternal: boolean;
    home: string;
    createWork: boolean;
    manageSettings: boolean;
    readTeam: boolean;
    upload: boolean;
    manageOrgs: boolean;
    manageRobots: boolean;
    export: boolean;
    readConfidentialContact: boolean;
    readAudit: boolean;
}
export type CodeState = {
    __kind__: "revoked";
    revoked: {
        at: bigint;
        by: PersonId;
    };
} | {
    __kind__: "expired";
    expired: {
        at: bigint;
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
export interface Contact {
    name: string;
    email?: string;
    address?: Address;
    phone?: string;
}
export interface ContactConfidentialView {
    contact?: Contact;
    sealed: boolean;
    version: bigint;
    notes?: string;
}
export interface Decision {
    at: bigint;
    by: PersonId;
    note: string;
    accepted: boolean;
}
export interface ExportConfidential {
    at: bigint;
    files: Array<FileView>;
    orgs: Array<[OrgId, ContactConfidentialView]>;
    persons: Array<[PersonId, ContactConfidentialView]>;
}
export interface ExportIntern {
    at: bigint;
    files: Array<FileView>;
    invites: Array<InviteView>;
    schema: bigint;
    orgs: Array<OrgView>;
    links: Array<LinkView>;
    version: string;
    persons: Array<PersonView>;
    settings: SettingsView;
    robots: Array<RobotView>;
    proposals: Array<ProposalView>;
    works: Array<WorkView>;
    auditCount: bigint;
    memberships: Array<MembershipView>;
    linkHistory: Array<LinkHistory>;
}
export interface FileView {
    at: bigint;
    id: bigint;
    blob?: ExternalBlob;
    mime: string;
    name: string;
    size: bigint;
    personId: PersonId;
    confidential: boolean;
    workId?: WorkId;
}
export interface InviteRequest {
    tag: string;
    validDays: bigint;
    orgId?: OrgId;
    lang?: string;
    name: string;
    shortCode?: string;
    workIds: Array<WorkId>;
    phone?: string;
    roles: Array<Role>;
}
export interface InviteView {
    id: bigint;
    tag: string;
    expiresAt: bigint;
    hint: string;
    kind: CodeKind;
    createdAt: bigint;
    createdBy: PersonId;
    personName: string;
    personId: PersonId;
    state: CodeState;
    workIds: Array<WorkId>;
}
export interface LinkHistory {
    id: bigint;
    tag: string;
    linkedAt: bigint;
    principal: Principal;
    movedAt: bigint;
    codeHint: string;
    personId: PersonId;
    revokedAt?: bigint;
    revokedBy?: PersonId;
}
export interface LinkView {
    tag: string;
    status: LinkStatus;
    linkedAt: bigint;
    principal: Principal;
    confirmedAt?: bigint;
    confirmedBy?: PersonId;
    personName: string;
    codeHint: string;
    personId: PersonId;
    revokedAt?: bigint;
    revokedBy?: PersonId;
}
export interface MeView {
    blockedUntil?: bigint;
    status: Variant_active_pending_anonymous_unlinked;
    principal: Principal;
    person?: PersonView;
    caps?: Caps;
    version: string;
    isRobot: boolean;
}
export interface MembershipView {
    id: bigint;
    grants: Array<Grant>;
    grantedAt: bigint;
    grantedBy: PersonId;
    orgId?: OrgId;
    endedAt?: bigint;
    name: string;
    role: Role;
    personId?: PersonId;
    workId: WorkId;
}
export interface NewCode {
    expiresAt: bigint;
    code: string;
    inviteId: bigint;
    personId: PersonId;
}
export interface NewTicket {
    ticket: string;
    expiresAt: bigint;
    ticketId: bigint;
}
export interface NotificationView {
    id: bigint;
    kind: string;
    createdAt: bigint;
    text: string;
    workId?: WorkId;
    readAt?: bigint;
}
export type OrgId = bigint;
export interface OrgInput {
    kbo?: string;
    vat?: string;
    trades: Array<string>;
    kind: OrgKind;
    name: string;
    address?: Address;
    notes: string;
    aliases: Array<string>;
}
export interface OrgView {
    id: OrgId;
    kbo?: string;
    vat?: string;
    trades: Array<string>;
    kind: OrgKind;
    name: string;
    createdAt: bigint;
    createdBy: PersonId;
    address?: Address;
    notes: string;
    aliases: Array<string>;
    archivedAt?: bigint;
}
export type PersonId = bigint;
export interface PersonUpdate {
    orgId?: OrgId;
    lang?: string;
    name: string;
    shortCode?: string;
    phone?: string;
    roles: Array<Role>;
}
export interface PersonView {
    id: PersonId;
    orgId?: OrgId;
    lang?: string;
    name: string;
    createdAt: bigint;
    createdBy: PersonId;
    shortCode?: string;
    phone?: string;
    roles: Array<Role>;
    archivedAt?: bigint;
}
export interface ProposalView {
    at: bigint;
    by: Principal;
    id: bigint;
    decision?: Decision;
    content: string;
    kind: string;
    ticketId?: bigint;
    personId?: PersonId;
    workId?: WorkId;
}
export type Result = {
    __kind__: "ok";
    ok: PersonView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_1 = {
    __kind__: "ok";
    ok: OrgView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_10 = {
    __kind__: "ok";
    ok: TicketInfo;
} | {
    __kind__: "err";
    err: string;
};
export type Result_2 = {
    __kind__: "ok";
    ok: bigint;
} | {
    __kind__: "err";
    err: string;
};
export type Result_3 = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: string;
};
export type Result_4 = {
    __kind__: "ok";
    ok: MeView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_5 = {
    __kind__: "ok";
    ok: ContactConfidentialView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_6 = {
    __kind__: "ok";
    ok: FileView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_7 = {
    __kind__: "ok";
    ok: NewCode;
} | {
    __kind__: "err";
    err: string;
};
export type Result_8 = {
    __kind__: "ok";
    ok: WorkView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_9 = {
    __kind__: "ok";
    ok: NewTicket;
} | {
    __kind__: "err";
    err: string;
};
export interface RobotView {
    principal: Principal;
    name: string;
    addedAt: bigint;
    addedBy: PersonId;
    kinds: Array<string>;
    revokedAt?: bigint;
}
export interface SettingsView {
    inviteDays: bigint;
    werfleiderZietAlles: boolean;
}
export interface TicketInfo {
    expiresAt: bigint;
    budgetCents: bigint;
    task: string;
    personName: string;
    ticketId: bigint;
    personId: PersonId;
    workId?: WorkId;
}
export type WorkId = bigint;
export interface WorkInput {
    leaderPersonId?: PersonId;
    clientOrgId?: OrgId;
    vatBp: bigint;
    code: string;
    name: string;
    address: Address;
    parentId?: WorkId;
    architectOrgId?: OrgId;
}
export interface WorkView {
    id: WorkId;
    status: WorkStatus;
    leaderPersonId?: PersonId;
    clientOrgId?: OrgId;
    vatBp: bigint;
    code: string;
    name: string;
    createdAt: bigint;
    createdBy: PersonId;
    address: Address;
    parentId?: WorkId;
    architectOrgId?: OrgId;
    archivedAt?: bigint;
}
export enum CodeKind {
    invite = "invite",
    recovery = "recovery"
}
export enum Grant {
    readReports = "readReports",
    confirmHours = "confirmHours",
    confirmPlanning = "confirmPlanning",
    readSellPrices = "readSellPrices",
    readProgress = "readProgress",
    uploadDocs = "uploadDocs"
}
export enum LinkStatus {
    active = "active",
    revoked = "revoked",
    pending = "pending"
}
export enum OrgKind {
    client = "client",
    other = "other",
    supplier = "supplier",
    bowaco = "bowaco",
    subcontractor = "subcontractor",
    authority = "authority",
    architect = "architect"
}
export enum Role {
    admin = "admin",
    werfleider = "werfleider",
    onderaannemer = "onderaannemer",
    calculator = "calculator",
    veiligheidscoordinator = "veiligheidscoordinator",
    architect = "architect",
    klant = "klant"
}
export enum Variant_active_pending_anonymous_unlinked {
    active = "active",
    pending = "pending",
    anonymous = "anonymous",
    unlinked = "unlinked"
}
export enum WorkStatus {
    cancelled = "cancelled",
    request = "request",
    quoting = "quoting",
    planned = "planned",
    delivered = "delivered",
    aftercare = "aftercare",
    running = "running"
}
export interface backendInterface {
    accessStats(): Promise<AccessStats>;
    addFile(name: string, mime: string, size: bigint, blob: ExternalBlob, workId: bigint | null, confidential: boolean): Promise<Result_2>;
    addMembership(workId: bigint, personId: bigint | null, orgId: bigint | null, role: Role, grants: Array<Grant>): Promise<Result_2>;
    addRobot(principal: Principal, name: string, kinds: Array<string>): Promise<Result_3>;
    archiveFile(id: bigint): Promise<Result_3>;
    archiveOrg(id: bigint): Promise<Result_3>;
    archivePerson(id: bigint): Promise<Result_3>;
    auditCount(): Promise<bigint>;
    auditLog(from: bigint, limit: bigint): Promise<Array<AuditEntry>>;
    checkTicket(ticket: string): Promise<Result_10>;
    claimBootstrap(code: string, name: string): Promise<Result>;
    confirmLink(p: Principal): Promise<Result_3>;
    createOrg(input: OrgInput): Promise<Result_1>;
    createRecoveryCode(personId: bigint, validDays: bigint, tag: string): Promise<Result_7>;
    createTicket(task: string, workId: bigint | null): Promise<Result_9>;
    createWork(i: WorkInput): Promise<Result_8>;
    decideProposal(id: bigint, accepted: boolean, note: string): Promise<Result_3>;
    endMembership(id: bigint): Promise<Result_3>;
    exportConfidential(): Promise<ExportConfidential>;
    exportIntern(): Promise<ExportIntern>;
    getSettings(): Promise<SettingsView>;
    getWork(id: bigint): Promise<WorkView>;
    invitePerson(req: InviteRequest): Promise<Result_7>;
    listFiles(workId: bigint | null): Promise<Array<FileView>>;
    listInvites(from: bigint, limit: bigint): Promise<Array<InviteView>>;
    listLinks(): Promise<Array<LinkView>>;
    listMembers(workId: bigint): Promise<Array<MembershipView>>;
    listOrgs(includeArchived: boolean): Promise<Array<OrgView>>;
    listPersons(includeArchived: boolean): Promise<Array<PersonView>>;
    listRobots(): Promise<Array<RobotView>>;
    listWorks(): Promise<Array<WorkView>>;
    markNotificationsRead(ids: Array<bigint>): Promise<void>;
    me(): Promise<MeView>;
    myNotifications(unreadOnly: boolean): Promise<Array<NotificationView>>;
    myProposals(): Promise<Array<ProposalView>>;
    readConfidentialFile(id: bigint): Promise<Result_6>;
    readOrgConfidential(id: bigint): Promise<Result_5>;
    redeemCode(code: string): Promise<Result_4>;
    restorePerson(id: bigint): Promise<Result_3>;
    revokeInvite(inviteId: bigint): Promise<Result_3>;
    revokeLink(p: Principal): Promise<Result_3>;
    revokeRobot(principal: Principal): Promise<Result_3>;
    setLinkLabel(p: Principal, tag: string): Promise<Result_3>;
    setOrgConfidential(id: bigint, contact: Contact | null, notes: string): Promise<Result_2>;
    setSettings(s: SettingsView): Promise<Result_3>;
    setWorkStatus(id: bigint, status: WorkStatus): Promise<Result_3>;
    submitProposal(ticketId: bigint, kind: string, content: string): Promise<Result_2>;
    updateOrg(id: bigint, input: OrgInput): Promise<Result_1>;
    updatePerson(id: bigint, u: PersonUpdate): Promise<Result>;
}
