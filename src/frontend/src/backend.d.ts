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
export interface Absence {
    id: bigint;
    to: Day;
    source: AbsenceSource;
    orgId: OrgId;
    from: Day;
    kind: AbsenceKind;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    personId?: PersonId;
    archivedAt?: bigint;
}
export interface AbsenceChange {
    at: bigint;
    by: PersonId;
    id: bigint;
    orgId: OrgId;
    what: string;
    detail: string;
    absenceId: bigint;
}
export interface AbsenceChangeView {
    at: bigint;
    id: bigint;
    byName: string;
    what: string;
    detail: string;
    absenceId: bigint;
}
export interface AbsenceInput {
    id?: bigint;
    to: Day;
    orgId: OrgId;
    from: Day;
    kind: AbsenceKind;
    note: string;
    personId?: PersonId;
}
export interface AbsenceView {
    id: bigint;
    to: Day;
    orgName: string;
    source: AbsenceSource;
    orgId: OrgId;
    from: Day;
    kind: AbsenceKind;
    mine: boolean;
    note: string;
    createdAt: bigint;
    personName?: string;
    updatedByName: string;
    updatedAt: bigint;
    personId?: PersonId;
    createdByName: string;
}
export interface AccessStats {
    pendingLinks: bigint;
    failuresThisHour: bigint;
    codesLockedUntil?: bigint;
    persons: bigint;
    activeLinks: bigint;
    attemptsTracked: bigint;
    openInvites: bigint;
}
export interface Address {
    zip: string;
    street: string;
    country: string;
    city: string;
    number: string;
}
export interface Appointment {
    id: bigint;
    day: Day;
    orgId?: OrgId;
    createdAt: bigint;
    createdBy: PersonId;
    text: string;
    time?: string;
    weekFallback: boolean;
    extra: Extra;
    taskId: bigint;
    batchId?: string;
    workId: WorkId;
    archivedAt?: bigint;
}
export interface Assignment {
    id: bigint;
    toDay?: Day;
    orgId: OrgId;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    fromDay?: Day;
    extra: Extra;
    updatedAt: bigint;
    primary: boolean;
    personId?: PersonId;
    taskId: bigint;
    confirmation: Confirmation;
    workId: WorkId;
    archivedAt?: bigint;
}
export interface AssignmentInput {
    id?: bigint;
    toDay?: Day;
    orgId: OrgId;
    note: string;
    fromDay?: Day;
    personId?: PersonId;
    taskId: bigint;
}
export interface AssignmentView {
    id: bigint;
    end: Day;
    toDay?: Day;
    orgCode?: string;
    orgName: string;
    orgId: OrgId;
    note: string;
    fromDay?: Day;
    personName?: string;
    primary: boolean;
    personId?: PersonId;
    start: Day;
    taskId: bigint;
    inTeam: boolean;
    confirmedByName?: string;
    confirmation: Confirmation;
    workId: WorkId;
}
export interface Attendance {
    id: bigint;
    day: Day;
    blockKey: string;
    orgId?: OrgId;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    headcount: bigint;
    extra: Extra;
    replacedBy?: bigint;
    slots: Array<TimeSlot>;
    personId?: PersonId;
    taskId?: bigint;
    names: string;
    workId: WorkId;
    minutesTotal: bigint;
    reportId: bigint;
    regie: boolean;
    archivedAt?: bigint;
    archivedBy?: PersonId;
}
export interface AttendanceView {
    id: bigint;
    confirmations: Array<ConfirmationView>;
    orgCode: string;
    blockKey: string;
    orgName: string;
    orgId?: OrgId;
    note: string;
    createdAt: bigint;
    headcount: bigint;
    slots: Array<TimeSlot>;
    personId?: PersonId;
    taskId?: bigint;
    names: string;
    createdByName: string;
    minutesTotal: bigint;
    regie: boolean;
}
export interface AuditEntry {
    at: bigint;
    who: Principal;
    action: string;
    detail: string;
    personId?: PersonId;
    workId?: WorkId;
}
export interface BlockInput {
    id?: bigint;
    to: Day;
    from: Day;
    kind: BlockKind;
    scope: BlockScope;
    reason: string;
}
export type BlockScope = {
    __kind__: "org";
    org: OrgId;
} | {
    __kind__: "work";
    work: WorkId;
} | {
    __kind__: "company";
    company: null;
};
export interface BlockView {
    id: bigint;
    to: Day;
    from: Day;
    kind: BlockKind;
    scope: BlockScope;
    createdByName: string;
    reason: string;
}
export interface BoardCaps {
    manageRules: boolean;
    manageAbsences: boolean;
}
export interface BoardCell {
    week: bigint;
    items: Array<BoardItem>;
}
export interface BoardItem {
    workName: string;
    tasks: Array<BoardTask>;
    clash: boolean;
    hidden: boolean;
    workId?: WorkId;
    workCode: string;
}
export interface BoardQuery {
    trade?: string;
    withIdle: boolean;
    from: Day;
    text: string;
    offset: bigint;
    limit: bigint;
    weeks: bigint;
    workId?: WorkId;
    onlyConflicts: boolean;
}
export interface BoardRow {
    absences: Array<AbsenceView>;
    orgId: OrgId;
    code?: string;
    cells: Array<BoardCell>;
    trades: Array<string>;
    kind: OrgKind;
    name: string;
    maxWorks: bigint;
    conflicts: Array<ConflictView>;
    maxFrom: string;
}
export interface BoardRulesInput {
    defaultMax: bigint;
    unit: string;
    oaReportsAbsence: boolean;
}
export interface BoardRulesView {
    defaultMax: bigint;
    unit: string;
    oaReportsAbsence: boolean;
    rules: Array<CapacityView>;
}
export interface BoardTask {
    end: Day;
    status: TaskStatus;
    title: string;
    days: Array<Day>;
    kind: TaskKind;
    note: string;
    personName?: string;
    start: Day;
    taskId: bigint;
    assignmentId: bigint;
    confirmation: Confirmation;
}
export interface BoardView {
    conflictTotal: bigint;
    total: bigint;
    caps: BoardCaps;
    from: Day;
    rows: Array<BoardRow>;
    unit: string;
    offset: bigint;
    instructions: bigint;
    weeks: Array<BoardWeek>;
}
export interface BoardWeek {
    blocks: Array<BlockView>;
    monday: Day;
}
export interface CalendarBlock {
    id: bigint;
    to: Day;
    from: Day;
    kind: BlockKind;
    createdAt: bigint;
    createdBy: PersonId;
    extra: Extra;
    scope: BlockScope;
    reason: string;
    archivedAt?: bigint;
}
export interface CapacityRule {
    key: string;
    note: string;
    extra: Extra;
    maxWorks: bigint;
    updatedAt: bigint;
    updatedBy: PersonId;
    archivedAt?: bigint;
}
export interface CapacityView {
    key: string;
    title: string;
    note: string;
    maxWorks: bigint;
    updatedByName: string;
    updatedAt: bigint;
}
export interface Caps {
    manageAccess: boolean;
    inviteExternal: boolean;
    readContracts: boolean;
    manageMunicipalities: boolean;
    importOa: boolean;
    manageOa: boolean;
    home: string;
    wadm: boolean;
    importPlan: boolean;
    managePermitKinds: boolean;
    readOrgPlanning: boolean;
    manageBoardRules: boolean;
    createWork: boolean;
    manageSettings: boolean;
    writeReports: boolean;
    readTeam: boolean;
    permits: boolean;
    manageTemplates: boolean;
    upload: boolean;
    readMunicipalities: boolean;
    manageOrgs: boolean;
    manageCompanyCalendar: boolean;
    manageRobots: boolean;
    reportOwnAbsence: boolean;
    export: boolean;
    manageAbsences: boolean;
    readTrips: boolean;
    manageVehicles: boolean;
    readConfidentialContact: boolean;
    readAudit: boolean;
    readOa: boolean;
}
export interface ChecklistLine {
    doc?: DocumentView;
    kind: string;
    name: string;
    rule: string;
    applies: Applies;
    deliverer: string;
}
export interface CiawExport {
    to: Day;
    workName: string;
    declarationNumber: string;
    from: Day;
    rows: Array<CiawRow>;
    address: Address;
    required?: boolean;
    workCode: string;
}
export interface CiawRow {
    day: Day;
    kbo: string;
    orgName: string;
    headcount: bigint;
    minutes: bigint;
    slots: string;
    names: string;
    regie: boolean;
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
export type Confirmation = {
    __kind__: "open";
    open: null;
} | {
    __kind__: "confirmed";
    confirmed: {
        at: bigint;
        by: PersonId;
    };
} | {
    __kind__: "declined";
    declined: {
        at: bigint;
        by: PersonId;
        reason: string;
    };
};
export interface ConfirmationView {
    at: bigint;
    id: bigint;
    ok: boolean;
    remark: string;
    byName: string;
}
export interface ConflictList {
    total: bigint;
    items: Array<ConflictView>;
}
export interface ConflictView {
    orgCode?: string;
    taskIds: Array<bigint>;
    orgName: string;
    orgId: OrgId;
    days: Array<Day>;
    kind: string;
    text: string;
    week: Day;
    works: Array<[WorkId | null, string]>;
}
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
export interface DashConfirm {
    end: Day;
    orgName: string;
    taskTitle: string;
    start: Day;
    taskId: bigint;
    assignmentId: bigint;
    workId: WorkId;
    declined: boolean;
    workCode: string;
    reason: string;
}
export interface DashCounters {
    delayed: bigint;
    confirmDeclined: bigint;
    permitsThisMonth?: bigint;
    confirmOpen: bigint;
    openIssues: bigint;
    running: bigint;
    missingReports: bigint;
}
export interface DashTask {
    end: Day;
    status: TaskStatus;
    title: string;
    percent: bigint;
    start: Day;
    taskId: bigint;
    lateDays: bigint;
    orgNames: Array<string>;
    workId: WorkId;
    workCode: string;
}
export interface DashWork {
    id: WorkId;
    end?: Day;
    status: WorkStatus;
    delayed: boolean;
    tasksLate: bigint;
    confirmDeclined: bigint;
    leaderId?: PersonId;
    confirmOpen: bigint;
    city: string;
    code: string;
    name: string;
    percent: bigint;
    leaderName: string;
    start?: Day;
    warnings: Array<string>;
    tasksThisWeek: bigint;
    tasksDelayed: bigint;
    tasksTotal: bigint;
    openIssues: bigint;
    nextMilestone?: [string, Day];
    parentId?: WorkId;
    lastReport?: Day;
    missingReport?: Day;
}
export interface DashboardView {
    day: Day;
    confirmations: Array<DashConfirm>;
    leaders: Array<PersonRef>;
    thisWeek: Array<DashTask>;
    late: Array<DashTask>;
    instructions: bigint;
    counters: DashCounters;
    monday: Day;
    works: Array<DashWork>;
}
export type Day = bigint;
export interface DayReport {
    id: bigint;
    day: Day;
    status: ReportStatus;
    createdAt: bigint;
    authorPersonId: PersonId;
    extra: Extra;
    summary: string;
    updatedAt: bigint;
    updatedBy: PersonId;
    corrects?: bigint;
    clientKey: string;
    workId: WorkId;
    weather: string;
}
export interface DayTask {
    id: bigint;
    end: Day;
    status: TaskStatus;
    title: string;
    kind: TaskKind;
    orgCodes: Array<string>;
    percent: bigint;
    start: Day;
}
export interface DayWork {
    id: WorkId;
    status: WorkStatus;
    tasks: Array<DayTask>;
    code: string;
    mine: boolean;
    name: string;
    leaderName: string;
    planned: Array<PlannedOrg>;
    address: Address;
    appointments: Array<[string, string]>;
    reports: Array<ReportSummary>;
    openIssues: bigint;
}
export interface Decision {
    at: bigint;
    by: PersonId;
    note: string;
    accepted: boolean;
}
export interface Declaration {
    status: DeclarationStatus;
    nature: string;
    note: string;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    workId: WorkId;
    asbestos: boolean;
}
export interface DeclarationDraft {
    safetyCoordinator: string;
    end?: Day;
    oas: Array<DeclarationOa>;
    workName: string;
    client: string;
    nature: string;
    deadline?: Day;
    amountCents?: bigint;
    clientAddress?: Address;
    start?: Day;
    workAddress: Address;
    architect: string;
    regie: boolean;
    workCode: string;
    reason: string;
    asbestos: boolean;
    portal: string;
}
export interface DeclarationInput {
    status: DeclarationStatus;
    nature: string;
    note: string;
    asbestos: boolean;
}
export interface DeclarationOa {
    kbo?: string;
    vat?: string;
    name: string;
}
export type DeclarationStatus = {
    __kind__: "done";
    done: {
        on: Day;
        number: string;
    };
} | {
    __kind__: "todo";
    todo: null;
} | {
    __kind__: "notNeeded";
    notNeeded: {
        reason: string;
    };
};
export interface DeclarationView {
    status: DeclarationStatus;
    nature: string;
    note: string;
    deadline?: Day;
    updatedByName: string;
    updatedAt: bigint;
    asbestos: boolean;
}
export interface Dependency {
    id: bigint;
    kind: DependencyKind;
    createdAt: bigint;
    createdBy: PersonId;
    toTaskId: bigint;
    workId: WorkId;
    fromTaskId: bigint;
    lagDays: bigint;
    archivedAt?: bigint;
}
export interface DependencyInput {
    kind: DependencyKind;
    toTaskId: bigint;
    fromTaskId: bigint;
    lagDays: bigint;
}
export interface DependencyView {
    id: bigint;
    kind: DependencyKind;
    toTaskId: bigint;
    fromTaskId: bigint;
    lagDays: bigint;
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
export interface ExistingInvite {
    tag: string;
    validDays: bigint;
    personId: PersonId;
    workIds: Array<WorkId>;
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
    ops: Array<OpRecord>;
    files: Array<FileView>;
    absences: Array<Absence>;
    tasks: Array<Task>;
    vehicles: Array<VehicleView>;
    templates: Array<Template>;
    documents: Array<Document>;
    trips: Array<Trip>;
    attendances: Array<Attendance>;
    lookups: Array<LookupView>;
    assignments: Array<Assignment>;
    notifications: Array<NotificationExport>;
    procedures: Array<PermitProcedure>;
    reportChanges: Array<ReportChange>;
    absenceChanges: Array<AbsenceChange>;
    mailLog: Array<MailLog>;
    withholdingChecks: Array<WithholdingCheck>;
    invites: Array<InviteView>;
    schema: bigint;
    trades: Array<TradeView>;
    jobs: Array<Job>;
    orgs: Array<OrgView>;
    importKeys: Array<ImportKey>;
    values: Array<[string, string]>;
    planVersions: Array<[WorkId, bigint]>;
    calendarBlocks: Array<CalendarBlock>;
    hoursConfirmations: Array<HoursConfirmation>;
    orgContacts: Array<OrgContact>;
    links: Array<LinkView>;
    reportKeys: Array<[string, bigint]>;
    municipalities: Array<Municipality>;
    version: string;
    issues: Array<Issue>;
    permits: Array<Permit>;
    persons: Array<PersonView>;
    taskChanges: Array<TaskChange>;
    settings: SettingsView;
    dayReports: Array<DayReport>;
    counters: Array<[string, bigint]>;
    appointments: Array<Appointment>;
    materials: Array<MaterialNote>;
    dependencies: Array<Dependency>;
    robots: Array<RobotView>;
    permitChanges: Array<PermitChange>;
    capacity: Array<CapacityRule>;
    importBatches: Array<ImportBatch>;
    proposals: Array<ProposalView>;
    permitAlerts: Array<[string, bigint]>;
    works: Array<WorkView>;
    personContacts: Array<PersonContact>;
    sequences: Array<[string, bigint]>;
    auditCount: bigint;
    declarations: Array<Declaration>;
    memberships: Array<MembershipView>;
    photos: Array<Photo>;
    linkHistory: Array<LinkHistory>;
    workDone: Array<WorkDone>;
    workInfo: Array<WorkInfo>;
}
export interface ExternalWork {
    id: WorkId;
    status: WorkStatus;
    grants: Array<Grant>;
    code: string;
    name: string;
    leaderName: string;
    address: Address;
    leaderPhone?: string;
    roles: Array<Role>;
}
export type Extra = Array<[string, string]>;
export interface FileIn {
    blob: ExternalBlob;
    mime: string;
    name: string;
    size: bigint;
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
    archivedAt?: bigint;
}
export interface FineMatch {
    day: Day;
    workName: string;
    vehicleName: string;
    backTime?: string;
    crew: Array<string>;
    tripId: bigint;
    score: bigint;
    sameDay: boolean;
    permits: Array<FinePermit>;
    driverOut: string;
    plateMatch: boolean;
    guess: string;
    address: Address;
    plate: string;
    workId: WorkId;
    outTime?: string;
    placeMatch: boolean;
    reportId: bigint;
    driverBack: string;
    workCode: string;
}
export interface FinePermit {
    id: bigint;
    validFrom?: Day;
    reference: string;
    validTo?: Day;
    kindName: string;
    location: string;
}
export interface FineQuery {
    day: Day;
    time?: bigint;
    place: string;
    plate: string;
    widen: boolean;
}
export interface FineResult {
    vehicleKnown: boolean;
    matches: Array<FineMatch>;
    ownTripsOnly: boolean;
}
export interface HoursConfirmation {
    at: bigint;
    by: PersonId;
    id: bigint;
    ok: boolean;
    remark: string;
    orgId: OrgId;
    attendanceId: bigint;
}
export interface HoursLine {
    day: Day;
    workName: string;
    confirmations: Array<ConfirmationView>;
    headcount: bigint;
    slots: Array<TimeSlot>;
    names: string;
    canConfirm: boolean;
    workId: WorkId;
    reportFinal: boolean;
    minutesTotal: bigint;
    attendanceId: bigint;
    reportId: bigint;
    regie: boolean;
    workCode: string;
}
export interface ImportAppt {
    day: Day;
    key: string;
    name?: string;
    text: string;
    time?: string;
    weekFallback: boolean;
}
export interface ImportBatch {
    at: bigint;
    by: PersonId;
    id: string;
    tasks: bigint;
    title: string;
    assignments: bigint;
    extra: Extra;
    rolledBackAt?: bigint;
    rolledBackBy?: PersonId;
    appointments: bigint;
    blocks: bigint;
    works: bigint;
}
export interface ImportBlock {
    key: string;
    zip: string;
    tasks: Array<ImportTask>;
    street: string;
    decision: ImportDecision;
    vatBp: bigint;
    city: string;
    name: string;
    number: string;
}
export type ImportDecision = {
    __kind__: "sub";
    sub: string;
} | {
    __kind__: "fresh";
    fresh: null;
} | {
    __kind__: "followUp";
    followUp: string;
};
export interface ImportKey {
    key: string;
    kind: ImportKind;
    entityId: bigint;
    batchId: string;
}
export type ImportOutcome = {
    __kind__: "created";
    created: null;
} | {
    __kind__: "conflict";
    conflict: string;
} | {
    __kind__: "invalid";
    invalid: string;
} | {
    __kind__: "updated";
    updated: null;
} | {
    __kind__: "unchanged";
    unchanged: null;
};
export interface ImportPerson {
    name: string;
    email?: string;
    jobTitle: string;
    shortCode?: string;
    phone?: string;
}
export interface ImportReport {
    created: bigint;
    invalid: bigint;
    results: Array<ImportResult>;
    conflicts: bigint;
    updated: bigint;
    unchanged: bigint;
    dryRun: boolean;
}
export interface ImportResult {
    key: string;
    orgId?: OrgId;
    changes: Array<string>;
    outcome: ImportOutcome;
}
export interface ImportRow {
    kbo?: string;
    key: string;
    vat?: string;
    trades: Array<string>;
    kind: OrgKind;
    name: string;
    email?: string;
    website?: string;
    persons: Array<ImportPerson>;
    notes: string;
    aliases: Array<string>;
    phone?: string;
}
export interface ImportRun {
    to: Day;
    key: string;
    from: Day;
    name: string;
    note: string;
}
export interface ImportTask {
    key: string;
    status: TaskStatus;
    title: string;
    workdays: bigint;
    order: bigint;
    note: string;
    runs: Array<ImportRun>;
    extra: Array<[string, string]>;
    percent: bigint;
    start: Day;
    responsible?: string;
    appointments: Array<ImportAppt>;
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
export interface Issue {
    id: bigint;
    status: IssueStatus;
    blockKey: string;
    taskIds: Array<bigint>;
    delayDays?: bigint;
    kind: IssueKind;
    createdAt: bigint;
    createdBy: PersonId;
    text: string;
    extra: Extra;
    workId: WorkId;
    reportId: bigint;
    archivedAt?: bigint;
}
export type IssueStatus = {
    __kind__: "handled";
    handled: {
        at: bigint;
        by: PersonId;
        note: string;
    };
} | {
    __kind__: "open";
    open: null;
};
export interface IssueView {
    id: bigint;
    day: Day;
    workName: string;
    status: IssueStatus;
    blockKey: string;
    taskIds: Array<bigint>;
    delayDays?: bigint;
    kind: IssueKind;
    createdAt: bigint;
    text: string;
    taskTitles: Array<string>;
    createdByName: string;
    workId: WorkId;
    handledByName: string;
    reportId: bigint;
    workCode: string;
}
export interface Job {
    id: bigint;
    key: string;
    ref: string;
    notBefore: bigint;
    orgId?: OrgId;
    kind: string;
    createdAt: bigint;
    createdBy?: PersonId;
    attempts: bigint;
    extra: Extra;
    updatedAt: bigint;
    personId?: PersonId;
    state: JobState;
    workId?: WorkId;
}
export interface JobLease {
    id: bigint;
    key: string;
    attempt: bigint;
    kind: string;
    mail: MailOut;
    leaseUntil: bigint;
}
export type JobState = {
    __kind__: "cancelled";
    cancelled: {
        at: bigint;
        by: PersonId;
    };
} | {
    __kind__: "done";
    done: {
        at: bigint;
        result: string;
    };
} | {
    __kind__: "leased";
    leased: {
        by: Principal;
        attempt: bigint;
        until: bigint;
    };
} | {
    __kind__: "queued";
    queued: null;
} | {
    __kind__: "failed";
    failed: {
        at: bigint;
        why: string;
    };
};
export interface JobView {
    id: bigint;
    key: string;
    ref: string;
    notBefore: bigint;
    orgName: string;
    orgId?: OrgId;
    kind: string;
    createdAt: bigint;
    attempts: bigint;
    updatedAt: bigint;
    state: JobState;
    createdByName: string;
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
export interface LookupView {
    key: string;
    tag: string;
    order: bigint;
    list: string;
    extra: Extra;
    archivedAt?: bigint;
}
export interface MailLog {
    at: bigint;
    id: bigint;
    key: string;
    attempt: bigint;
    orgId?: OrgId;
    kind: string;
    lang: string;
    test: boolean;
    jobId: bigint;
    extra: Extra;
    cycles: bigint;
    recipients: bigint;
    outcome: MailOutcome;
}
export interface MailLogView {
    at: bigint;
    id: bigint;
    orgName: string;
    attempt: bigint;
    orgId?: OrgId;
    kind: string;
    lang: string;
    test: boolean;
    jobId: bigint;
    cycles: bigint;
    recipients: bigint;
    outcome: MailOutcome;
}
export interface MailOut {
    to: Array<MailTo>;
    tag: string;
    preheader: string;
    subject: string;
    outro: string;
    link?: string;
    heading: string;
    intro: string;
    sections: Array<MailSection>;
}
export type MailOutcome = {
    __kind__: "sent";
    sent: null;
} | {
    __kind__: "unsure";
    unsure: string;
} | {
    __kind__: "failed";
    failed: string;
} | {
    __kind__: "dryRun";
    dryRun: null;
};
export interface MailPreview {
    deliver: string;
    html: string;
    lang: string;
    mail: MailOut;
}
export interface MailRound {
    dry: bigint;
    skipped: bigint;
    busy: boolean;
    sent: bigint;
    failed: bigint;
}
export interface MailSection {
    title: string;
    lines: Array<string>;
    subtitle: string;
}
export interface MailTo {
    name: string;
    email: string;
}
export interface MaterialNote {
    id: bigint;
    blockKey: string;
    supplier: string;
    kind: MaterialKind;
    createdAt: bigint;
    createdBy: PersonId;
    text: string;
    extra: Extra;
    fileId?: bigint;
    quantity: string;
    workId: WorkId;
    reportId: bigint;
    archivedAt?: bigint;
}
export interface MaterialView {
    id: bigint;
    hasFile: boolean;
    blockKey: string;
    supplier: string;
    file?: FileView;
    kind: MaterialKind;
    createdAt: bigint;
    text: string;
    createdByName: string;
    quantity: string;
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
    endedBy?: PersonId;
    name: string;
    role: Role;
    personId?: PersonId;
    workId: WorkId;
    archived: boolean;
}
export interface Municipality {
    id: bigint;
    contact: string;
    name: string;
    createdAt: bigint;
    createdBy: PersonId;
    zips: Array<string>;
    email?: string;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    notes: string;
    phone?: string;
    portal?: string;
    archivedAt?: bigint;
}
export interface MunicipalityInput {
    id?: bigint;
    contact: string;
    name: string;
    zips: Array<string>;
    email?: string;
    notes: string;
    phone?: string;
    archived: boolean;
    portal?: string;
}
export interface MunicipalityView {
    id: bigint;
    contact: string;
    procedures: Array<PermitProcedureView>;
    name: string;
    zips: Array<string>;
    email?: string;
    updatedByName: string;
    updatedAt: bigint;
    notes: string;
    phone?: string;
    permitCount: bigint;
    archived: boolean;
    portal?: string;
}
export interface MyBoardView {
    row?: BoardRow;
    from: Day;
    canReport: boolean;
    weeks: Array<BoardWeek>;
}
export interface MyDayView {
    day: Day;
    vehicles: Array<VehicleView>;
    orgs: Array<PlannedOrg>;
    writer: boolean;
    drivers: Array<PersonRef>;
    works: Array<DayWork>;
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
export interface NotificationExport {
    id: bigint;
    kind: string;
    createdAt: bigint;
    text: string;
    personId: PersonId;
    workId?: WorkId;
    readAt?: bigint;
}
export interface NotificationView {
    id: bigint;
    kind: string;
    createdAt: bigint;
    text: string;
    workId?: WorkId;
    readAt?: bigint;
}
export interface OaFilter {
    trade?: string;
    kind?: OrgKind;
    text?: string;
    includeArchived: boolean;
}
export interface OaPersonInput {
    id?: PersonId;
    name: string;
    note: string;
    email?: string;
    jobTitle: string;
    shortCode?: string;
    phone?: string;
}
export interface OaPersonView {
    id: PersonId;
    hasLogin: boolean;
    orgId: OrgId;
    name: string;
    note: string;
    email?: string;
    jobTitle: string;
    shortCode?: string;
    phone?: string;
    archivedAt?: bigint;
}
export interface OaView {
    org: OrgView;
    contact?: OrgContactView;
    persons: Array<OaPersonView>;
}
export interface OaWithholding {
    kbo?: string;
    orgId: OrgId;
    last?: WithholdingCheckView;
    link?: string;
    name: string;
    state: string;
}
export type OpOutcome = {
    __kind__: "err";
    err: string;
} | {
    __kind__: "done";
    done: {
        note: string;
        entityId?: bigint;
        reportId: bigint;
    };
};
export interface OpRecord {
    at: bigint;
    by: PersonId;
    seq: bigint;
    kind: string;
    note: string;
    opId: string;
    entityId?: bigint;
    reportId: bigint;
}
export interface OpResult {
    repeated: boolean;
    opId: string;
    outcome: OpOutcome;
}
export interface OrgAssignmentView {
    workName: string;
    assignment: AssignmentView;
    taskTitle: string;
    taskStatus: TaskStatus;
    taskKind: TaskKind;
    canConfirm: boolean;
    workCode: string;
}
export interface OrgContact {
    contactNote: string;
    orgId: OrgId;
    email?: string;
    website?: string;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    phone?: string;
}
export interface OrgContactInput {
    contactNote: string;
    email?: string;
    website?: string;
    phone?: string;
}
export interface OrgContactView {
    contactNote: string;
    email?: string;
    website?: string;
    updatedAt: bigint;
    phone?: string;
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
export interface Permit {
    id: bigint;
    status: PermitStatus;
    title: string;
    leadDays: bigint;
    taskIds: Array<bigint>;
    validFrom?: Day;
    neededTo?: Day;
    costCents?: bigint;
    kind: string;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    reference: string;
    validTo?: Day;
    extra: Extra;
    municipalityId?: bigint;
    updatedAt: bigint;
    updatedBy: PersonId;
    workId: WorkId;
    neededFrom?: Day;
    location: string;
    requestedOn?: Day;
    archivedAt?: bigint;
    fileIds: Array<bigint>;
}
export interface PermitChange {
    at: bigint;
    by: PersonId;
    id: bigint;
    to: string;
    field: string;
    permitId: bigint;
    from: string;
    workId: WorkId;
}
export interface PermitChangeView {
    at: bigint;
    to: string;
    field: string;
    byName: string;
    from: string;
}
export interface PermitInput {
    id?: bigint;
    status: PermitStatus;
    title: string;
    leadDays?: bigint;
    taskIds: Array<bigint>;
    validFrom?: Day;
    neededTo?: Day;
    costCents?: bigint;
    kind: string;
    note: string;
    reference: string;
    validTo?: Day;
    municipalityId?: bigint;
    neededFrom?: Day;
    location: string;
    requestedOn?: Day;
}
export interface PermitKindView {
    key: string;
    leadDays: bigint;
    publicDomain: boolean;
    order: bigint;
    name: string;
    words: Array<string>;
    archived: boolean;
}
export interface PermitProcedure {
    how: string;
    leadDays: bigint;
    contact: string;
    cost: string;
    kind: string;
    email?: string;
    extra: Extra;
    municipalityId: bigint;
    updatedAt: bigint;
    updatedBy: PersonId;
    notes: string;
    attachments: Array<string>;
    portal?: string;
    archivedAt?: bigint;
}
export interface PermitProcedureView {
    how: string;
    leadDays: bigint;
    contact: string;
    cost: string;
    kind: string;
    email?: string;
    municipalityId: bigint;
    updatedByName: string;
    updatedAt: bigint;
    notes: string;
    kindName: string;
    attachments: Array<string>;
    portal?: string;
}
export interface PermitSuggestion {
    end: Day;
    leadDays: bigint;
    kind: string;
    taskTitle: string;
    deadline: Day;
    start: Day;
    taskId: bigint;
    kindName: string;
}
export interface PermitView {
    id: bigint;
    files: Array<FileView>;
    workName: string;
    status: PermitStatus;
    title: string;
    leadDays: bigint;
    taskIds: Array<bigint>;
    validFrom?: Day;
    neededTo?: Day;
    costCents?: bigint;
    kind: string;
    note: string;
    reference: string;
    canEdit: boolean;
    deadline?: Day;
    validTo?: Day;
    taskTitles: Array<string>;
    municipalityId?: bigint;
    updatedByName: string;
    updatedAt: bigint;
    warnings: Array<PermitWarning>;
    manualFrom?: Day;
    manualTo?: Day;
    kindName: string;
    workId: WorkId;
    neededFrom?: Day;
    location: string;
    municipalityName: string;
    requestedOn?: Day;
    workCode: string;
}
export type PermitWarning = {
    __kind__: "expiresSoon";
    expiresSoon: bigint;
} | {
    __kind__: "expired";
    expired: null;
} | {
    __kind__: "deadlineSoon";
    deadlineSoon: bigint;
} | {
    __kind__: "outsidePlan";
    outsidePlan: {
        neededTo: Day;
        neededFrom: Day;
    };
} | {
    __kind__: "noDocument";
    noDocument: null;
} | {
    __kind__: "deadlinePassed";
    deadlinePassed: bigint;
} | {
    __kind__: "noDates";
    noDates: null;
} | {
    __kind__: "refused";
    refused: null;
};
export interface PersonContact {
    note: string;
    email?: string;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    personId: PersonId;
    jobTitle: string;
}
export type PersonId = bigint;
export interface PersonRef {
    id: PersonId;
    name: string;
}
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
export interface Photo {
    id: bigint;
    blockKey: string;
    createdAt: bigint;
    createdBy: PersonId;
    extra: Extra;
    takenAt?: bigint;
    fileId: bigint;
    taskId?: bigint;
    caption: string;
    workId: WorkId;
    reportId: bigint;
    thumbFileId?: bigint;
    archivedAt?: bigint;
}
export interface PhotoView {
    id: bigint;
    thumb?: FileView;
    blockKey: string;
    file: FileView;
    createdAt: bigint;
    takenAt?: bigint;
    taskId?: bigint;
    createdByName: string;
    caption: string;
}
export interface PlanCaps {
    confirm: boolean;
    edit: boolean;
    history: boolean;
}
export type PlanChange = {
    __kind__: "move";
    move: {
        workdays: bigint;
        mode: CascadeMode;
        start: Day;
        taskId: bigint;
    };
} | {
    __kind__: "reflow";
    reflow: null;
};
export interface PlanImportReport {
    appointmentsExisting: bigint;
    assignmentsCreated: bigint;
    unmatched: Array<[string, bigint]>;
    appointmentsCreated: bigint;
    assignmentsExisting: bigint;
    problems: Array<string>;
    workExisting: bigint;
    tasksCreated: bigint;
    workId?: bigint;
    dryRun: boolean;
    tasksExisting: bigint;
    workCode: string;
    workCreated: bigint;
}
export interface PlanPreview {
    reopened: bigint;
    version: bigint;
    changes: Array<ShiftView>;
}
export interface PlanResult {
    reopened: bigint;
    version: bigint;
    taskId?: bigint;
    changes: Array<ShiftView>;
}
export interface PlanView {
    end?: Day;
    tasks: Array<TaskView>;
    caps: PlanCaps;
    scope: string;
    version: bigint;
    start?: Day;
    blocks: Array<BlockView>;
    dependencies: Array<DependencyView>;
    workId: WorkId;
}
export interface PlannedOrg {
    taskIds: Array<bigint>;
    orgId: OrgId;
    code: string;
    name: string;
}
export interface PostSettingsInput {
    day: bigint;
    contact?: string;
    weekmail: boolean;
    hour: bigint;
    appUrl: string;
    reminders: boolean;
    reminderDay: bigint;
}
export interface PostSettingsView {
    day: bigint;
    contact: string;
    weekmail: boolean;
    hour: bigint;
    testMode: boolean;
    sent: bigint;
    testAddress: string;
    langs: Array<[OrgId, string]>;
    cyclesSent: bigint;
    appUrl: string;
    leased: bigint;
    sending: boolean;
    robots: Array<RobotSeen>;
    reminders: boolean;
    optedOut: Array<OrgId>;
    queued: bigint;
    reminderDay: bigint;
    draft: boolean;
    lastWeek: bigint;
    failed: bigint;
}
export type PriceRevision = {
    __kind__: "none";
    none: null;
} | {
    __kind__: "formula";
    formula: string;
};
export interface ProcedureInput {
    how: string;
    leadDays: bigint;
    contact: string;
    cost: string;
    kind: string;
    email?: string;
    municipalityId: bigint;
    notes: string;
    attachments: Array<string>;
    archived: boolean;
    portal?: string;
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
export interface ReportChange {
    at: bigint;
    by: PersonId;
    id: bigint;
    to: string;
    field: string;
    from: string;
    reportId: bigint;
}
export interface ReportChangeView {
    at: bigint;
    to: string;
    field: string;
    byName: string;
    from: string;
}
export type ReportOp = {
    __kind__: "ensure";
    ensure: {
        day: Day;
        workId: WorkId;
    };
} | {
    __kind__: "remove";
    remove: {
        blockKey: string;
    };
} | {
    __kind__: "text";
    text: {
        field: string;
        value: string;
    };
} | {
    __kind__: "trip";
    trip: {
        outMin?: bigint;
        driverOutPersonId?: PersonId;
        driverBackText: string;
        note: string;
        driverOutText: string;
        driverBackPersonId?: PersonId;
        plate: string;
        vehicleId?: bigint;
        backMin?: bigint;
    };
} | {
    __kind__: "attendance";
    attendance: {
        replaces?: string;
        orgId?: OrgId;
        note: string;
        headcount: bigint;
        slots: Array<TimeSlot>;
        personId?: PersonId;
        taskId?: bigint;
        names: string;
        regie: boolean;
    };
} | {
    __kind__: "issue";
    issue: {
        taskIds: Array<bigint>;
        delayDays?: bigint;
        kind: IssueKind;
        text: string;
    };
} | {
    __kind__: "photo";
    photo: {
        thumb?: FileIn;
        file: FileIn;
        takenAt?: bigint;
        taskId?: bigint;
        caption: string;
    };
} | {
    __kind__: "material";
    material: {
        supplier: string;
        file?: FileIn;
        kind: MaterialKind;
        text: string;
        quantity: string;
    };
} | {
    __kind__: "finalize";
    finalize: null;
} | {
    __kind__: "workDone";
    workDone: {
        text: string;
        percent?: bigint;
        taskId?: bigint;
    };
};
export interface ReportOpInput {
    op: ReportOp;
    opId: string;
    clientKey: string;
}
export type ReportStatus = {
    __kind__: "final";
    final: {
        at: bigint;
        by: PersonId;
    };
} | {
    __kind__: "draft";
    draft: null;
} | {
    __kind__: "corrected";
    corrected: {
        at: bigint;
        byReportId: bigint;
    };
};
export interface ReportSummary {
    id: bigint;
    day: Day;
    status: ReportStatus;
    attendances: bigint;
    headcount: bigint;
    authorName: string;
    corrects?: bigint;
    regieMinutes: bigint;
    workId: WorkId;
    openIssues: bigint;
    photos: bigint;
    workDone: Array<string>;
    totalMinutes: bigint;
}
export interface ReportView {
    id: bigint;
    day: Day;
    workName: string;
    status: ReportStatus;
    trips: Array<TripView>;
    attendances: Array<AttendanceView>;
    canFinalize: boolean;
    canWrite: boolean;
    createdAt: bigint;
    authorName: string;
    scope: string;
    issues: Array<IssueView>;
    summary: string;
    updatedAt: bigint;
    materials: Array<MaterialView>;
    corrects?: bigint;
    regieMinutes: bigint;
    workId: WorkId;
    changes: Array<ReportChangeView>;
    weather: string;
    photos: Array<PhotoView>;
    workCode: string;
    workDone: Array<WorkDoneView>;
    totalMinutes: bigint;
}
export type RestorePart = {
    __kind__: "ops";
    ops: Array<OpRecord>;
} | {
    __kind__: "files";
    files: Array<FileView>;
} | {
    __kind__: "absences";
    absences: Array<Absence>;
} | {
    __kind__: "tasks";
    tasks: Array<Task>;
} | {
    __kind__: "vehicles";
    vehicles: Array<VehicleView>;
} | {
    __kind__: "templates";
    templates: Array<Template>;
} | {
    __kind__: "documents";
    documents: Array<Document>;
} | {
    __kind__: "trips";
    trips: Array<Trip>;
} | {
    __kind__: "attendances";
    attendances: Array<Attendance>;
} | {
    __kind__: "lookups";
    lookups: Array<LookupView>;
} | {
    __kind__: "audit";
    audit: Array<AuditEntry>;
} | {
    __kind__: "assignments";
    assignments: Array<Assignment>;
} | {
    __kind__: "notifications";
    notifications: Array<NotificationExport>;
} | {
    __kind__: "personConfidential";
    personConfidential: Array<[PersonId, ContactConfidentialView]>;
} | {
    __kind__: "procedures";
    procedures: Array<PermitProcedure>;
} | {
    __kind__: "reportChanges";
    reportChanges: Array<ReportChange>;
} | {
    __kind__: "absenceChanges";
    absenceChanges: Array<AbsenceChange>;
} | {
    __kind__: "mailLog";
    mailLog: Array<MailLog>;
} | {
    __kind__: "withholdingChecks";
    withholdingChecks: Array<WithholdingCheck>;
} | {
    __kind__: "invites";
    invites: Array<InviteView>;
} | {
    __kind__: "jobs";
    jobs: Array<Job>;
} | {
    __kind__: "orgs";
    orgs: Array<OrgView>;
} | {
    __kind__: "importKeys";
    importKeys: Array<ImportKey>;
} | {
    __kind__: "values";
    values: Array<[string, string]>;
} | {
    __kind__: "planVersions";
    planVersions: Array<[WorkId, bigint]>;
} | {
    __kind__: "calendarBlocks";
    calendarBlocks: Array<CalendarBlock>;
} | {
    __kind__: "hoursConfirmations";
    hoursConfirmations: Array<HoursConfirmation>;
} | {
    __kind__: "orgContacts";
    orgContacts: Array<OrgContact>;
} | {
    __kind__: "links";
    links: Array<LinkView>;
} | {
    __kind__: "reportKeys";
    reportKeys: Array<[string, bigint]>;
} | {
    __kind__: "municipalities";
    municipalities: Array<Municipality>;
} | {
    __kind__: "workConfidentialHistory";
    workConfidentialHistory: Array<WorkConfidentialVersion>;
} | {
    __kind__: "issues";
    issues: Array<Issue>;
} | {
    __kind__: "permits";
    permits: Array<Permit>;
} | {
    __kind__: "persons";
    persons: Array<PersonView>;
} | {
    __kind__: "workConfidential";
    workConfidential: Array<WorkConfidential>;
} | {
    __kind__: "taskChanges";
    taskChanges: Array<TaskChange>;
} | {
    __kind__: "settings";
    settings: SettingsView;
} | {
    __kind__: "dayReports";
    dayReports: Array<DayReport>;
} | {
    __kind__: "counters";
    counters: Array<[string, bigint]>;
} | {
    __kind__: "appointments";
    appointments: Array<Appointment>;
} | {
    __kind__: "materials";
    materials: Array<MaterialNote>;
} | {
    __kind__: "dependencies";
    dependencies: Array<Dependency>;
} | {
    __kind__: "robots";
    robots: Array<RobotView>;
} | {
    __kind__: "permitChanges";
    permitChanges: Array<PermitChange>;
} | {
    __kind__: "capacity";
    capacity: Array<CapacityRule>;
} | {
    __kind__: "importBatches";
    importBatches: Array<ImportBatch>;
} | {
    __kind__: "proposals";
    proposals: Array<ProposalView>;
} | {
    __kind__: "permitAlerts";
    permitAlerts: Array<[string, bigint]>;
} | {
    __kind__: "works";
    works: Array<WorkView>;
} | {
    __kind__: "orgConfidential";
    orgConfidential: Array<[OrgId, ContactConfidentialView]>;
} | {
    __kind__: "personContacts";
    personContacts: Array<PersonContact>;
} | {
    __kind__: "sequences";
    sequences: Array<[string, bigint]>;
} | {
    __kind__: "declarations";
    declarations: Array<Declaration>;
} | {
    __kind__: "memberships";
    memberships: Array<MembershipView>;
} | {
    __kind__: "photos";
    photos: Array<Photo>;
} | {
    __kind__: "linkHistory";
    linkHistory: Array<LinkHistory>;
} | {
    __kind__: "workDone";
    workDone: Array<WorkDone>;
} | {
    __kind__: "workInfo";
    workInfo: Array<WorkInfo>;
};
export interface RestoreSummary {
    files: bigint;
    tasks: bigint;
    audit: bigint;
    persons: bigint;
    counters: Array<[string, bigint]>;
    reports: bigint;
    works: bigint;
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
    ok: OrgContactView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_11 = {
    __kind__: "ok";
    ok: OaPersonView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_12 = {
    __kind__: "ok";
    ok: DeclarationView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_13 = {
    __kind__: "ok";
    ok: RollbackReport;
} | {
    __kind__: "err";
    err: string;
};
export type Result_14 = {
    __kind__: "ok";
    ok: RestoreSummary;
} | {
    __kind__: "err";
    err: string;
};
export type Result_15 = {
    __kind__: "ok";
    ok: MeView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_16 = {
    __kind__: "ok";
    ok: OaWithholding;
} | {
    __kind__: "err";
    err: string;
};
export type Result_17 = {
    __kind__: "ok";
    ok: ContactConfidentialView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_18 = {
    __kind__: "ok";
    ok: Array<ContractVersionView>;
} | {
    __kind__: "err";
    err: string;
};
export type Result_19 = {
    __kind__: "ok";
    ok: ContractView;
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
export type Result_20 = {
    __kind__: "ok";
    ok: FileView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_21 = {
    __kind__: "ok";
    ok: PlanPreview;
} | {
    __kind__: "err";
    err: string;
};
export type Result_22 = {
    __kind__: "ok";
    ok: MailOut;
} | {
    __kind__: "err";
    err: string;
};
export type Result_23 = {
    __kind__: "ok";
    ok: MailPreview;
} | {
    __kind__: "err";
    err: string;
};
export type Result_24 = {
    __kind__: "ok";
    ok: FineResult;
} | {
    __kind__: "err";
    err: string;
};
export type Result_25 = {
    __kind__: "ok";
    ok: NewCode;
} | {
    __kind__: "err";
    err: string;
};
export type Result_26 = {
    __kind__: "ok";
    ok: PlanImportReport;
} | {
    __kind__: "err";
    err: string;
};
export type Result_27 = {
    __kind__: "ok";
    ok: ImportReport;
} | {
    __kind__: "err";
    err: string;
};
export type Result_28 = {
    __kind__: "ok";
    ok: OaView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_29 = {
    __kind__: "ok";
    ok: RestorePart;
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
export type Result_30 = {
    __kind__: "ok";
    ok: DeclarationDraft;
} | {
    __kind__: "err";
    err: string;
};
export type Result_31 = {
    __kind__: "ok";
    ok: NewTicket;
} | {
    __kind__: "err";
    err: string;
};
export type Result_32 = {
    __kind__: "ok";
    ok: CiawExport;
} | {
    __kind__: "err";
    err: string;
};
export type Result_33 = {
    __kind__: "ok";
    ok: TicketInfo;
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
    ok: PostSettingsView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_6 = {
    __kind__: "ok";
    ok: MailRound;
} | {
    __kind__: "err";
    err: string;
};
export type Result_7 = {
    __kind__: "ok";
    ok: PlanResult;
} | {
    __kind__: "err";
    err: string;
};
export type Result_8 = {
    __kind__: "ok";
    ok: MunicipalityView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_9 = {
    __kind__: "ok";
    ok: PermitView;
} | {
    __kind__: "err";
    err: string;
};
export interface RobotSeen {
    name: string;
    lastSeen?: bigint;
    kinds: Array<string>;
}
export interface RobotView {
    principal: Principal;
    name: string;
    addedAt: bigint;
    addedBy: PersonId;
    kinds: Array<string>;
    revokedAt?: bigint;
}
export interface RollbackReport {
    tasks: bigint;
    assignments: bigint;
    appointments: bigint;
    keptWorks: Array<string>;
    works: bigint;
    dryRun: boolean;
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
export interface ShiftView {
    title: string;
    workdays: bigint;
    toEnd: Day;
    fromStart: Day;
    toStart: Day;
    fromEnd: Day;
    taskId: bigint;
    reason: string;
}
export interface Task {
    id: bigint;
    status: TaskStatus;
    title: string;
    workdays: bigint;
    leadDays: bigint;
    trade?: string;
    order: bigint;
    kind: TaskKind;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    quoteLineIds: Array<bigint>;
    extra: Extra;
    percent: bigint;
    templateKey?: string;
    updatedAt: bigint;
    updatedBy: PersonId;
    start: Day;
    orderDay?: Day;
    workId: WorkId;
    actualEnd?: Day;
    responsibleOrgId?: OrgId;
    actualStart?: Day;
    archivedAt?: bigint;
}
export interface TaskChange {
    at: bigint;
    by: PersonId;
    id: bigint;
    to: string;
    field: string;
    from: string;
    taskId: bigint;
    workId: WorkId;
    reason: string;
}
export interface TaskChangeView {
    at: bigint;
    by: PersonId;
    id: bigint;
    to: string;
    field: string;
    byName: string;
    from: string;
    taskTitle: string;
    taskId: bigint;
    reason: string;
}
export interface TaskInput {
    id?: bigint;
    status: TaskStatus;
    title: string;
    workdays: bigint;
    leadDays: bigint;
    trade?: string;
    kind: TaskKind;
    note: string;
    percent: bigint;
    start: Day;
    orderDay?: Day;
    responsibleOrgId?: OrgId;
    reason: string;
}
export interface TaskView {
    id: bigint;
    end: Day;
    status: TaskStatus;
    title: string;
    workdays: bigint;
    leadDays: bigint;
    trade?: string;
    assignments: Array<AssignmentView>;
    order: bigint;
    kind: TaskKind;
    note: string;
    responsibleName: string;
    orderBy?: Day;
    percent: bigint;
    templateKey?: string;
    updatedByName: string;
    updatedAt: bigint;
    start: Day;
    warnings: Array<string>;
    orderDay?: Day;
    workId: WorkId;
    actualEnd?: Day;
    responsibleOrgId?: OrgId;
    actualStart?: Day;
}
export interface Template {
    key: string;
    name: string;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    steps: Array<TemplateStep>;
    provisional: boolean;
    archivedAt?: bigint;
}
export interface TemplateInput {
    key: string;
    name: string;
    steps: Array<TemplateStep>;
    provisional: boolean;
    archived: boolean;
}
export interface TemplateStep {
    key: string;
    title: string;
    workdays: bigint;
    leadDays: bigint;
    trade?: string;
    after: Array<string>;
    kind: TaskKind;
    note: string;
    lagDays: bigint;
}
export interface TemplateView {
    key: string;
    stored: boolean;
    name: string;
    updatedAt: bigint;
    steps: Array<TemplateStep>;
    provisional: boolean;
    archived: boolean;
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
export interface TimeSlot {
    toMin: bigint;
    fromMin: bigint;
}
export interface TradeInput {
    key: string;
    order: bigint;
    name: string;
    archived: boolean;
}
export interface TradeView {
    key: string;
    order: bigint;
    name: string;
    archived: boolean;
}
export interface Trip {
    id: bigint;
    day: Day;
    driverOutPersonId?: PersonId;
    blockKey: string;
    driverBackText: string;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    driverOutText: string;
    driverBackPersonId?: PersonId;
    extra: Extra;
    plate: string;
    workId: WorkId;
    reportId: bigint;
    vehicleId?: bigint;
    archivedAt?: bigint;
}
export interface TripView {
    id: bigint;
    day: Day;
    vehicleName: string;
    backTime?: string;
    driverOutPersonId?: PersonId;
    blockKey: string;
    driverBackName: string;
    note: string;
    createdAt: bigint;
    driverOutName: string;
    driverBackPersonId?: PersonId;
    createdByName: string;
    plate: string;
    workId: WorkId;
    outTime?: string;
    reportId: bigint;
    vehicleId?: bigint;
    workCode: string;
}
export interface VehicleInput {
    id?: bigint;
    name: string;
    plate: string;
    archived: boolean;
}
export interface VehicleView {
    id: bigint;
    name: string;
    plate: string;
    archived: boolean;
}
export interface WadmDeclarationLine {
    workName: string;
    status: string;
    deadline?: Day;
    start?: Day;
    workId: WorkId;
    workCode: string;
    reason: string;
}
export interface WadmOverview {
    oas: Array<OaWithholding>;
    dbUpdated: Day;
    declarations: Array<WadmDeclarationLine>;
}
export interface WadmRules {
    threshold30bisWithOaCents: bigint;
    oaCountAlways: bigint;
    threshold30bisCents: bigint;
    thresholdCheckinatworkCents: bigint;
}
export interface WithholdingCheck {
    at: bigint;
    by?: PersonId;
    id: bigint;
    kbo: string;
    result: WithholdingResult;
    source: string;
    orgId: OrgId;
    note: string;
    reference: string;
    extra: Extra;
    fileId?: bigint;
    consultedOn: Day;
    workId?: WorkId;
}
export interface WithholdingCheckView {
    at: bigint;
    id: bigint;
    kbo: string;
    result: WithholdingResult;
    byName: string;
    source: string;
    orgId: OrgId;
    note: string;
    reference: string;
    consultedOn: Day;
    workId?: WorkId;
}
export interface WithholdingInput {
    result: WithholdingResult;
    note: string;
    reference: string;
    consultedOn: Day;
    workId?: WorkId;
}
export interface WorkAdminView {
    end?: Day;
    oas: Array<OaWithholding>;
    art30bis?: boolean;
    permitsGranted: bigint;
    checkinatwork?: boolean;
    canEdit: boolean;
    permitsAttention: bigint;
    declaration: DeclarationView;
    start?: Day;
    oaCount: bigint;
    canCheck: boolean;
    dbUpdated: Day;
    canSeeAmounts: boolean;
    workId: WorkId;
    reason: string;
    permitsTotal: bigint;
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
export interface WorkDone {
    id: bigint;
    blockKey: string;
    createdAt: bigint;
    createdBy: PersonId;
    text: string;
    extra: Extra;
    percent?: bigint;
    taskId?: bigint;
    workId: WorkId;
    reportId: bigint;
    archivedAt?: bigint;
}
export interface WorkDoneView {
    id: bigint;
    blockKey: string;
    createdAt: bigint;
    text: string;
    taskTitle: string;
    percent?: bigint;
    taskId?: bigint;
    createdByName: string;
}
export interface WorkFacts {
    art30bis?: boolean;
    checkinatwork?: boolean;
    art30bisReason: string;
    inheritedFrom?: WorkId;
    guarantee?: boolean;
    contractKnown: boolean;
    oaCount: bigint;
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
export interface WorkPermitsView {
    suggestions: Array<PermitSuggestion>;
    municipality?: MunicipalityView;
    canEdit: boolean;
    permits: Array<PermitView>;
    workId: WorkId;
    kinds: Array<PermitKindView>;
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
    extra: Extra;
    address: Address;
    plannedStart?: Day;
    parentId?: WorkId;
    architectOrgId?: OrgId;
    vatNote: string;
    facts?: WorkFacts;
    archivedAt?: bigint;
}
export enum AbsenceKind {
    andere = "andere",
    ziekte = "ziekte",
    verlof = "verlof"
}
export enum AbsenceSource {
    oa = "oa",
    intern = "intern"
}
export enum Applies {
    no = "no",
    yes = "yes",
    unknown = "unknown"
}
export enum BlockKind {
    feestdag = "feestdag",
    bouwverlof = "bouwverlof",
    other = "other",
    stop = "stop",
    verlof = "verlof"
}
export enum CascadeMode {
    asNeeded = "asNeeded",
    follow = "follow"
}
export enum CodeKind {
    invite = "invite",
    recovery = "recovery"
}
export enum DependencyKind {
    finishToStart = "finishToStart",
    startToStart = "startToStart"
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
export enum ImportKind {
    appointment = "appointment",
    assignment = "assignment",
    link = "link",
    task = "task",
    work = "work"
}
export enum IssueKind {
    safety = "safety",
    other = "other",
    extraWorkProposal = "extraWorkProposal",
    delay = "delay",
    problem = "problem"
}
export enum LinkStatus {
    active = "active",
    revoked = "revoked",
    pending = "pending"
}
export enum MaterialKind {
    smallMaterial = "smallMaterial",
    wasteToWarehouse = "wasteToWarehouse",
    receipt = "receipt",
    equipment = "equipment",
    fromWarehouse = "fromWarehouse",
    delivered = "delivered",
    returned = "returned"
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
export enum PermitStatus {
    requested = "requested",
    cancelled = "cancelled",
    expired = "expired",
    needed = "needed",
    granted = "granted",
    extended = "extended",
    refused = "refused"
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
export enum TaskKind {
    work = "work",
    delivery = "delivery",
    milestone = "milestone"
}
export enum TaskStatus {
    delayed = "delayed",
    busy = "busy",
    done = "done",
    blocked = "blocked",
    planned = "planned"
}
export enum Variant_active_pending_anonymous_unlinked {
    active = "active",
    pending = "pending",
    anonymous = "anonymous",
    unlinked = "unlinked"
}
export enum WithholdingResult {
    social = "social",
    both = "both",
    clear = "clear",
    fiscal = "fiscal",
    unknown = "unknown"
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
    absenceHistory(orgId: bigint, from: bigint, limit: bigint): Promise<Array<AbsenceChangeView>>;
    accessStats(): Promise<AccessStats>;
    addDependency(workId: bigint, i: DependencyInput, expectedVersion: bigint): Promise<Result_7>;
    addFile(name: string, mime: string, size: bigint, blob: ExternalBlob, workId: bigint | null, confidential: boolean): Promise<Result_3>;
    addMembership(workId: bigint, personId: bigint | null, orgId: bigint | null, role: Role, grants: Array<Grant>): Promise<Result_3>;
    addRobot(principal: Principal, name: string, kinds: Array<string>): Promise<Result_4>;
    applyPlan(workId: bigint, change: PlanChange, expectedVersion: bigint, reason: string): Promise<Result_7>;
    applyTemplate(workId: bigint, key: string, startDay: bigint, append: boolean, expectedVersion: bigint): Promise<Result_7>;
    archiveAbsence(id: bigint): Promise<Result_4>;
    archiveAssignment(workId: bigint, assignmentId: bigint, expectedVersion: bigint): Promise<Result_3>;
    archiveCalendarBlock(id: bigint): Promise<Result_4>;
    archiveDocument(docId: bigint): Promise<Result_4>;
    archiveFile(id: bigint): Promise<Result_4>;
    archiveOrg(id: bigint): Promise<Result_4>;
    archivePermit(permitId: bigint, reason: string): Promise<Result_4>;
    archivePerson(id: bigint): Promise<Result_4>;
    archiveTask(workId: bigint, taskId: bigint, expectedVersion: bigint): Promise<Result_3>;
    attachDocumentFile(workId: bigint, kindKey: string, docId: bigint | null, fileId: bigint): Promise<Result_3>;
    attachPermitFile(permitId: bigint, fileId: bigint): Promise<Result_9>;
    auditCount(): Promise<bigint>;
    auditLog(from: bigint, limit: bigint): Promise<Array<AuditEntry>>;
    boardConflicts(fromDay: bigint, weeks: bigint, limit: bigint): Promise<ConflictList>;
    boardRules(): Promise<BoardRulesView>;
    cancelJob(id: bigint): Promise<Result_4>;
    checkTicket(ticket: string): Promise<Result_33>;
    checkinatworkExport(workId: bigint, from: bigint, to: bigint): Promise<Result_32>;
    claimBootstrap(code: string, name: string): Promise<Result_1>;
    completeJob(id: bigint, attempt: bigint, result: string): Promise<Result_4>;
    confirmAssignment(assignmentId: bigint, accept: boolean, reason: string): Promise<Result_4>;
    confirmHours(attendanceId: bigint, ok: boolean, remark: string): Promise<Result_4>;
    confirmLink(p: Principal): Promise<Result_4>;
    createOrg(input: OrgInput): Promise<Result_2>;
    createRecoveryCode(personId: bigint, validDays: bigint, tag: string): Promise<Result_25>;
    createTicket(task: string, workId: bigint | null): Promise<Result_31>;
    createWork(i: WorkInput): Promise<Result>;
    dashboard(day: bigint): Promise<DashboardView>;
    decideProposal(id: bigint, accepted: boolean, note: string): Promise<Result_4>;
    declarationDraft(workId: bigint): Promise<Result_30>;
    endMembership(id: bigint): Promise<Result_4>;
    exportChunk(kind: string, from: bigint, limit: bigint): Promise<Result_29>;
    exportConfidential(): Promise<ExportConfidential>;
    exportIntern(): Promise<ExportIntern>;
    failJob(id: bigint, attempt: bigint, why: string, retry: boolean): Promise<Result_4>;
    getDossier(workId: bigint): Promise<DossierView>;
    getOa(id: bigint): Promise<Result_28>;
    getPlan(workId: bigint): Promise<PlanView>;
    getReport(reportId: bigint): Promise<ReportView>;
    getReportDay(workId: bigint, day: bigint): Promise<Array<ReportView>>;
    getSettings(): Promise<SettingsView>;
    getWork(id: bigint): Promise<WorkView>;
    handleIssue(issueId: bigint, note: string): Promise<Result_4>;
    importOrgs(dryRun: boolean, rows: Array<ImportRow>): Promise<Result_27>;
    importPlanning(dryRun: boolean, batchId: string, title: string, knownBlocks: Array<string>, block: ImportBlock): Promise<Result_26>;
    inviteExistingPerson(i: ExistingInvite): Promise<Result_25>;
    invitePerson(req: InviteRequest): Promise<Result_25>;
    leaseJobs(max: bigint): Promise<Array<JobLease>>;
    listAbsences(orgId: bigint | null, fromDay: bigint, toDay: bigint): Promise<Array<AbsenceView>>;
    listAppointments(workId: bigint): Promise<Array<Appointment>>;
    listCalendarBlocks(workId: bigint | null): Promise<Array<BlockView>>;
    listDocKinds(withArchived: boolean): Promise<Array<DocKindView>>;
    listFiles(workId: bigint | null): Promise<Array<FileView>>;
    listImportBatches(): Promise<Array<ImportBatch>>;
    listInvites(from: bigint, limit: bigint): Promise<Array<InviteView>>;
    listIssues(workId: bigint | null, openOnly: boolean, limit: bigint): Promise<Array<IssueView>>;
    listJobs(filter: string, from: bigint, limit: bigint): Promise<Array<JobView>>;
    listLinks(): Promise<Array<LinkView>>;
    listMailLog(from: bigint, limit: bigint): Promise<Array<MailLogView>>;
    listMembers(workId: bigint): Promise<Array<MembershipView>>;
    listMunicipalities(withArchived: boolean): Promise<Array<MunicipalityView>>;
    listOas(f: OaFilter): Promise<Array<OaView>>;
    listOrgs(includeArchived: boolean): Promise<Array<OrgView>>;
    listPermitKinds(withArchived: boolean): Promise<Array<PermitKindView>>;
    listPermits(filter: string, workId: bigint | null): Promise<Array<PermitView>>;
    listPersons(includeArchived: boolean): Promise<Array<PersonView>>;
    listReports(workId: bigint, offset: bigint, limit: bigint): Promise<Array<ReportSummary>>;
    listRobots(): Promise<Array<RobotView>>;
    listTemplates(): Promise<Array<TemplateView>>;
    listTrades(withArchived: boolean): Promise<Array<TradeView>>;
    listTrips(fromDay: bigint, toDay: bigint): Promise<Array<TripView>>;
    listVehicles(withArchived: boolean): Promise<Array<VehicleView>>;
    listWorks(): Promise<Array<WorkView>>;
    lookupFine(q: FineQuery): Promise<Result_24>;
    mailPreview(kind: string, orgId: bigint | null, monday: bigint): Promise<Result_23>;
    markNotificationsRead(ids: Array<bigint>): Promise<void>;
    me(): Promise<MeView>;
    myBoard(fromDay: bigint, weeks: bigint): Promise<MyBoardView>;
    myDay(day: bigint, all: boolean): Promise<MyDayView>;
    myHours(fromDay: bigint, toDay: bigint): Promise<Array<HoursLine>>;
    myNotifications(unreadOnly: boolean): Promise<Array<NotificationView>>;
    myProposals(): Promise<Array<ProposalView>>;
    myWorks(): Promise<Array<ExternalWork>>;
    orgAssignments(orgId: bigint | null, from: bigint, to: bigint): Promise<Array<OrgAssignmentView>>;
    permitHistory(permitId: bigint): Promise<Array<PermitChangeView>>;
    permitRules(): Promise<{
        expiryDays: bigint;
        warnDays: bigint;
    }>;
    permitsOnSite(day: bigint): Promise<Array<PermitView>>;
    postSettings(): Promise<PostSettingsView>;
    previewDependency(workId: bigint, i: DependencyInput): Promise<Result_21>;
    previewMail(kind: string, orgId: bigint | null, monday: bigint): Promise<Result_22>;
    previewPlan(workId: bigint, change: PlanChange): Promise<Result_21>;
    queueReminders(monday: bigint): Promise<Result_3>;
    queueTestMail(email: string): Promise<Result_3>;
    queueWeekMails(monday: bigint, orgId: bigint | null): Promise<Result_3>;
    readConfidentialFile(id: bigint): Promise<Result_20>;
    readContract(workId: bigint): Promise<Result_19>;
    readContractHistory(workId: bigint): Promise<Result_18>;
    readOrgConfidential(id: bigint): Promise<Result_17>;
    recordWithholdingCheck(orgId: bigint, x: WithholdingInput): Promise<Result_16>;
    redeemCode(code: string): Promise<Result_15>;
    removeDependency(workId: bigint, depId: bigint, expectedVersion: bigint): Promise<Result_3>;
    reportSync(ops: Array<ReportOpInput>): Promise<Array<OpResult>>;
    restoreBegin(code: string): Promise<Result_4>;
    restoreChunk(code: string, part: RestorePart): Promise<Result_3>;
    restoreFinish(code: string): Promise<Result_14>;
    restorePerson(id: bigint): Promise<Result_4>;
    retryJob(id: bigint): Promise<Result_4>;
    revokeInvite(inviteId: bigint): Promise<Result_4>;
    revokeLink(p: Principal): Promise<Result_4>;
    revokeRobot(principal: Principal): Promise<Result_4>;
    rollbackImport(batchId: string, dryRun: boolean): Promise<Result_13>;
    saveAbsence(i: AbsenceInput): Promise<Result_3>;
    saveAssignment(workId: bigint, i: AssignmentInput, expectedVersion: bigint): Promise<Result_3>;
    saveCalendarBlock(i: BlockInput): Promise<Result_3>;
    saveDeclaration(workId: bigint, x: DeclarationInput): Promise<Result_12>;
    saveDocument(workId: bigint, i: DocumentInput): Promise<Result_3>;
    saveMunicipality(m: MunicipalityInput): Promise<Result_8>;
    saveOaPerson(orgId: bigint, i: OaPersonInput): Promise<Result_11>;
    saveOrgContact(orgId: bigint, i: OrgContactInput): Promise<Result_10>;
    savePermit(workId: bigint, x: PermitInput): Promise<Result_9>;
    saveProcedure(x: ProcedureInput): Promise<Result_8>;
    saveTask(workId: bigint, i: TaskInput, expectedVersion: bigint): Promise<Result_7>;
    saveTemplate(i: TemplateInput): Promise<Result_4>;
    saveVehicle(i: VehicleInput): Promise<Result_3>;
    scanPermits(): Promise<bigint>;
    sendMailNow(): Promise<Result_6>;
    setBoardRules(i: BoardRulesInput): Promise<Result_4>;
    setCapacity(key: string, maxWorks: bigint | null, note: string): Promise<Result_4>;
    setContract(workId: bigint, i: ContractInput, expectedVersion: bigint): Promise<Result_3>;
    setDocKind(k: DocKindInput): Promise<Result_4>;
    setDocumentStatus(docId: bigint, status: DocStatus, note: string): Promise<Result_4>;
    setLinkLabel(p: Principal, tag: string): Promise<Result_4>;
    setMailTest(on: boolean, address: string): Promise<Result_5>;
    setMemberGrants(membershipId: bigint, grants: Array<Grant>): Promise<Result_4>;
    setOrgConfidential(id: bigint, contact: Contact | null, notes: string): Promise<Result_3>;
    setOrgMail(orgId: bigint, on: boolean): Promise<Result_4>;
    setOrgMailLang(orgId: bigint, lang: string): Promise<Result_4>;
    setPermitKind(k: PermitKindView): Promise<Result_4>;
    setPermitRules(r: {
        expiryDays: bigint;
        warnDays: bigint;
    }): Promise<Result_4>;
    setPostSettings(x: PostSettingsInput): Promise<Result_5>;
    setSettings(s: SettingsView): Promise<Result_4>;
    setTaskOrder(workId: bigint, taskIds: Array<bigint>, expectedVersion: bigint): Promise<Result_3>;
    setTrade(t: TradeInput): Promise<Result_4>;
    setWadmRules(r: WadmRules): Promise<Result_4>;
    setWorkStatus(id: bigint, status: WorkStatus): Promise<Result_4>;
    submitProposal(ticketId: bigint, kind: string, content: string): Promise<Result_3>;
    taskHistory(workId: bigint, taskId: bigint | null, from: bigint, limit: bigint): Promise<Array<TaskChangeView>>;
    updateOrg(id: bigint, input: OrgInput): Promise<Result_2>;
    updatePerson(id: bigint, u: PersonUpdate): Promise<Result_1>;
    updateWork(id: bigint, u: WorkUpdate): Promise<Result>;
    wadmOverview(): Promise<WadmOverview>;
    wadmRules(): Promise<WadmRules>;
    weekBoard(q: BoardQuery): Promise<BoardView>;
    withholdingHistory(orgId: bigint): Promise<Array<WithholdingCheckView>>;
    workAdmin(workId: bigint): Promise<WorkAdminView>;
    workConflicts(workId: bigint, fromDay: bigint, weeks: bigint): Promise<ConflictList>;
    workPermits(workId: bigint): Promise<WorkPermitsView>;
}
