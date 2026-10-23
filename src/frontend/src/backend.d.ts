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
    readContracts: boolean;
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
export interface ChecklistLine {
    doc?: DocumentView;
    kind: string;
    name: string;
    rule: string;
    applies: Applies;
    deliverer: string;
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
export type Confidential = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: Contact;
};
export type Confidential_1 = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: ContractParams;
};
export type Confidential_2 = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: string;
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
export interface ContractInput {
    contract: ContractParams;
    notes: string;
    clientContact?: Contact;
}
export interface ContractParams {
    note: string;
    signedQuoteVersionId?: bigint;
    invoicingRhythm: InvoicingRhythm;
    guarantee: GuaranteeKind;
    paymentTermDays: bigint;
    estimatedAmountCents?: bigint;
    priceRevision: PriceRevision;
    guaranteeBp: bigint;
}
export interface ContractVersionView {
    at: bigint;
    byName: string;
    contract?: ContractParams;
    sealed: boolean;
    version: bigint;
    notes?: string;
    clientContact?: Contact;
}
export interface ContractView {
    contract?: ContractParams;
    sealed: boolean;
    inheritedFrom?: WorkId;
    version: bigint;
    updatedByName: string;
    updatedAt?: bigint;
    notes?: string;
    workId: WorkId;
    clientContact?: Contact;
}
export type Day = bigint;
export interface Decision {
    at: bigint;
    by: PersonId;
    note: string;
    accepted: boolean;
}
export interface DocKindInput {
    key: string;
    order: bigint;
    name: string;
    rule: string;
    oaVisible: boolean;
    deliverer: string;
    confidential: boolean;
    archived: boolean;
}
export interface DocKindView {
    key: string;
    order: bigint;
    name: string;
    rule: string;
    oaVisible: boolean;
    deliverer: string;
    confidential: boolean;
    archived: boolean;
}
export interface Document {
    id: bigint;
    status: DocStatus;
    title: string;
    kind: string;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    dueDay?: Day;
    confidential: boolean;
    ownerOrgId?: OrgId;
    workId: WorkId;
    validUntil?: Day;
    archivedAt?: bigint;
    fileIds: Array<bigint>;
}
export interface DocumentInput {
    id?: bigint;
    title: string;
    kind: string;
    note: string;
    dueDay?: Day;
    ownerOrgId?: OrgId;
    validUntil?: Day;
}
export interface DocumentView {
    id: bigint;
    files: Array<FileView>;
    status: DocStatus;
    title: string;
    kind: string;
    note: string;
    kindLabel: string;
    updatedByName: string;
    updatedAt: bigint;
    dueDay?: Day;
    confidential: boolean;
    canDeliver: boolean;
    ownerOrgId?: OrgId;
    workId: WorkId;
    validUntil?: Day;
}
export interface DossierView {
    canManage: boolean;
    documents: Array<DocumentView>;
    checklist: Array<ChecklistLine>;
    workId: WorkId;
    deliverKinds: Array<DocKindView>;
}
export interface ExportConfidential {
    at: bigint;
    files: Array<FileView>;
    orgs: Array<[OrgId, ContactConfidentialView]>;
    workConfidentialHistory: Array<WorkConfidentialVersion>;
    persons: Array<[PersonId, ContactConfidentialView]>;
    workConfidential: Array<WorkConfidential>;
}
export interface ExportIntern {
    at: bigint;
    files: Array<FileView>;
    documents: Array<Document>;
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
    workInfo: Array<WorkInfo>;
}
export type Extra = Array<[string, string]>;
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
export type InvoicingRhythm = {
    __kind__: "other";
    other: string;
} | {
    __kind__: "perPhase";
    perPhase: null;
} | {
    __kind__: "perProgress";
    perProgress: null;
} | {
    __kind__: "monthly";
    monthly: null;
};
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
    archived: boolean;
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
export type PriceRevision = {
    __kind__: "none";
    none: null;
} | {
    __kind__: "formula";
    formula: string;
};
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
    ok: WorkView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_1 = {
    __kind__: "ok";
    ok: PersonView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_10 = {
    __kind__: "ok";
    ok: NewCode;
} | {
    __kind__: "err";
    err: string;
};
export type Result_11 = {
    __kind__: "ok";
    ok: NewTicket;
} | {
    __kind__: "err";
    err: string;
};
export type Result_12 = {
    __kind__: "ok";
    ok: TicketInfo;
} | {
    __kind__: "err";
    err: string;
};
export type Result_2 = {
    __kind__: "ok";
    ok: OrgView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_3 = {
    __kind__: "ok";
    ok: bigint;
} | {
    __kind__: "err";
    err: string;
};
export type Result_4 = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: string;
};
export type Result_5 = {
    __kind__: "ok";
    ok: MeView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_6 = {
    __kind__: "ok";
    ok: ContactConfidentialView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_7 = {
    __kind__: "ok";
    ok: Array<ContractVersionView>;
} | {
    __kind__: "err";
    err: string;
};
export type Result_8 = {
    __kind__: "ok";
    ok: ContractView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_9 = {
    __kind__: "ok";
    ok: FileView;
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
export interface Sealed {
    ct: Uint8Array;
    iv: Uint8Array;
    alg: string;
    keyId: string;
}
export interface SettingsView {
    threshold30bisCents: bigint;
    inviteDays: bigint;
    werfleiderZietAlles: boolean;
    thresholdCheckinatworkCents: bigint;
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
export interface WorkCaps {
    manageMembers: boolean;
    contract: boolean;
    edit: boolean;
    upload: boolean;
    setLeader: boolean;
}
export interface WorkConfidential {
    contract: Confidential_1;
    extra: Extra;
    version: bigint;
    updatedAt: bigint;
    updatedBy: PersonId;
    notes: Confidential_2;
    workId: WorkId;
    clientContact: Confidential;
}
export interface WorkConfidentialVersion {
    at: bigint;
    by: PersonId;
    id: bigint;
    contract: Confidential_1;
    version: bigint;
    notes: Confidential_2;
    workId: WorkId;
    clientContact: Confidential;
}
export interface WorkFacts {
    art30bis?: boolean;
    checkinatwork?: boolean;
    inheritedFrom?: WorkId;
    guarantee?: boolean;
    contractKnown: boolean;
    priceRevision?: boolean;
}
export type WorkId = bigint;
export interface WorkInfo {
    analyticCode?: string;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    workId: WorkId;
    vatNote: string;
}
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
export interface WorkUpdate {
    plannedEnd?: Day;
    leaderPersonId?: PersonId;
    clientOrgId?: OrgId;
    analyticCode?: string;
    vatBp: bigint;
    code: string;
    name: string;
    address: Address;
    plannedStart?: Day;
    parentId?: WorkId;
    architectOrgId?: OrgId;
    vatNote: string;
}
export interface WorkView {
    id: WorkId;
    status: WorkStatus;
    plannedEnd?: Day;
    leaderPersonId?: PersonId;
    clientOrgId?: OrgId;
    analyticCode?: string;
    vatBp: bigint;
    checklistOpen?: bigint;
    caps: WorkCaps;
    code: string;
    name: string;
    createdAt: bigint;
    createdBy: PersonId;
    address: Address;
    plannedStart?: Day;
    parentId?: WorkId;
    architectOrgId?: OrgId;
    vatNote: string;
    facts?: WorkFacts;
    archivedAt?: bigint;
}
export enum Applies {
    no = "no",
    yes = "yes",
    unknown = "unknown"
}
export enum CodeKind {
    invite = "invite",
    recovery = "recovery"
}
export enum DocStatus {
    requested = "requested",
    expired = "expired",
    missing = "missing",
    approved = "approved",
    notApplicable = "notApplicable",
    received = "received"
}
export enum Grant {
    readReports = "readReports",
    confirmHours = "confirmHours",
    confirmPlanning = "confirmPlanning",
    readSellPrices = "readSellPrices",
    readProgress = "readProgress",
    uploadDocs = "uploadDocs"
}
export enum GuaranteeKind {
    none = "none",
    retention = "retention",
    bankGuarantee = "bankGuarantee"
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
    addFile(name: string, mime: string, size: bigint, blob: ExternalBlob, workId: bigint | null, confidential: boolean): Promise<Result_3>;
    addMembership(workId: bigint, personId: bigint | null, orgId: bigint | null, role: Role, grants: Array<Grant>): Promise<Result_3>;
    addRobot(principal: Principal, name: string, kinds: Array<string>): Promise<Result_4>;
    archiveDocument(docId: bigint): Promise<Result_4>;
    archiveFile(id: bigint): Promise<Result_4>;
    archiveOrg(id: bigint): Promise<Result_4>;
    archivePerson(id: bigint): Promise<Result_4>;
    attachDocumentFile(workId: bigint, kindKey: string, docId: bigint | null, fileId: bigint): Promise<Result_3>;
    auditCount(): Promise<bigint>;
    auditLog(from: bigint, limit: bigint): Promise<Array<AuditEntry>>;
    checkTicket(ticket: string): Promise<Result_12>;
    claimBootstrap(code: string, name: string): Promise<Result_1>;
    confirmLink(p: Principal): Promise<Result_4>;
    createOrg(input: OrgInput): Promise<Result_2>;
    createRecoveryCode(personId: bigint, validDays: bigint, tag: string): Promise<Result_10>;
    createTicket(task: string, workId: bigint | null): Promise<Result_11>;
    createWork(i: WorkInput): Promise<Result>;
    decideProposal(id: bigint, accepted: boolean, note: string): Promise<Result_4>;
    endMembership(id: bigint): Promise<Result_4>;
    exportConfidential(): Promise<ExportConfidential>;
    exportIntern(): Promise<ExportIntern>;
    getDossier(workId: bigint): Promise<DossierView>;
    getSettings(): Promise<SettingsView>;
    getWork(id: bigint): Promise<WorkView>;
    invitePerson(req: InviteRequest): Promise<Result_10>;
    listDocKinds(withArchived: boolean): Promise<Array<DocKindView>>;
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
    readConfidentialFile(id: bigint): Promise<Result_9>;
    readContract(workId: bigint): Promise<Result_8>;
    readContractHistory(workId: bigint): Promise<Result_7>;
    readOrgConfidential(id: bigint): Promise<Result_6>;
    redeemCode(code: string): Promise<Result_5>;
    restorePerson(id: bigint): Promise<Result_4>;
    revokeInvite(inviteId: bigint): Promise<Result_4>;
    revokeLink(p: Principal): Promise<Result_4>;
    revokeRobot(principal: Principal): Promise<Result_4>;
    saveDocument(workId: bigint, i: DocumentInput): Promise<Result_3>;
    setContract(workId: bigint, i: ContractInput, expectedVersion: bigint): Promise<Result_3>;
    setDocKind(k: DocKindInput): Promise<Result_4>;
    setDocumentStatus(docId: bigint, status: DocStatus, note: string): Promise<Result_4>;
    setLinkLabel(p: Principal, tag: string): Promise<Result_4>;
    setOrgConfidential(id: bigint, contact: Contact | null, notes: string): Promise<Result_3>;
    setSettings(s: SettingsView): Promise<Result_4>;
    setWorkStatus(id: bigint, status: WorkStatus): Promise<Result_4>;
    submitProposal(ticketId: bigint, kind: string, content: string): Promise<Result_3>;
    updateOrg(id: bigint, input: OrgInput): Promise<Result_2>;
    updatePerson(id: bigint, u: PersonUpdate): Promise<Result_1>;
    updateWork(id: bigint, u: WorkUpdate): Promise<Result>;
}
