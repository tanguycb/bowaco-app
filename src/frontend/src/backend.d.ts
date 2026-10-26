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
    myQuotes: boolean;
    inviteExternal: boolean;
    readContracts: boolean;
    manageMunicipalities: boolean;
    importOa: boolean;
    manageOa: boolean;
    measure: boolean;
    home: string;
    libraryPrices: boolean;
    wadm: boolean;
    measureRead: boolean;
    importPlan: boolean;
    managePermitKinds: boolean;
    readOrgPlanning: boolean;
    manageBoardRules: boolean;
    createWork: boolean;
    manageSettings: boolean;
    editLibrary: boolean;
    writeReports: boolean;
    quotePrices: boolean;
    readTeam: boolean;
    permits: boolean;
    manageTemplates: boolean;
    progress: boolean;
    upload: boolean;
    readLibrary: boolean;
    editQuotes: boolean;
    readMunicipalities: boolean;
    manageOrgs: boolean;
    manageCompanyCalendar: boolean;
    manageRobots: boolean;
    reportOwnAbsence: boolean;
    export: boolean;
    quotes: boolean;
    manageAbsences: boolean;
    readTrips: boolean;
    manageVehicles: boolean;
    readConfidentialContact: boolean;
    workStarts: boolean;
    myProgress: boolean;
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
    plain: bigint;
};
export type Confidential_1 = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: string;
};
export type Confidential_10 = {
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
    plain: LibSellRule;
};
export type Confidential_3 = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: bigint | null;
};
export type Confidential_4 = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: ProgressFrozen;
};
export type Confidential_5 = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: RevisionModel;
};
export type Confidential_6 = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: bigint | null;
};
export type Confidential_7 = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: LibSellRule | null;
};
export type Confidential_8 = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: bigint;
};
export type Confidential_9 = {
    __kind__: "sealed";
    sealed: Sealed;
} | {
    __kind__: "plain";
    plain: Contact;
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
    libCosts: Array<LibCost>;
    orgs: Array<[OrgId, ContactConfidentialView]>;
    libSellVersions: Array<LibSellVersion>;
    libSells: Array<LibSell>;
    quotePrices: Array<QuoteLinePrice>;
    workConfidentialHistory: Array<WorkConfidentialVersion>;
    persons: Array<[PersonId, ContactConfidentialView]>;
    workConfidential: Array<WorkConfidential>;
    progressConf: Array<ProgressConf>;
    quoteVersionConf: Array<QuoteVersionConf>;
    progressFrozen: Array<[bigint, Confidential_4]>;
    progressRevisions: Array<ProgressRevision>;
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
    measureOps: Array<SurveyOpRecord>;
    progressStatements: Array<ProgressStatement>;
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
    progressAnswers: Array<ProgressAnswer>;
    quoteLines: Array<QuoteLine>;
    calendarBlocks: Array<CalendarBlock>;
    hoursConfirmations: Array<HoursConfirmation>;
    orgContacts: Array<OrgContact>;
    surveys: Array<Survey>;
    libChapters: Array<LibChapter>;
    links: Array<LinkView>;
    reportKeys: Array<[string, bigint]>;
    municipalities: Array<Municipality>;
    quoteChecks: Array<QuoteCheckDone>;
    version: string;
    issues: Array<Issue>;
    permits: Array<Permit>;
    quoteChapters: Array<QuoteChapter>;
    persons: Array<PersonView>;
    taskChanges: Array<TaskChange>;
    settings: SettingsView;
    dayReports: Array<DayReport>;
    counters: Array<[string, bigint]>;
    appointments: Array<Appointment>;
    materials: Array<MaterialNote>;
    progressInputs: Array<[bigint, Array<ProgressInput>]>;
    dependencies: Array<Dependency>;
    surveyKeys: Array<[string, bigint]>;
    libItems: Array<LibItem>;
    quoteSendInfos: Array<QuoteSendInfo>;
    robots: Array<RobotView>;
    permitChanges: Array<PermitChange>;
    quoteVersions: Array<QuoteVersion>;
    capacity: Array<CapacityRule>;
    importBatches: Array<ImportBatch>;
    proposals: Array<ProposalView>;
    quoteStdPosts: Array<QuoteStdPost>;
    permitAlerts: Array<[string, bigint]>;
    works: Array<WorkView>;
    quoteRules: Array<QuoteRuleCfg>;
    quotes: Array<Quote>;
    measureEntries: Array<MeasureEntry>;
    personContacts: Array<PersonContact>;
    sequences: Array<[string, bigint]>;
    quoteAcceptances: Array<QuoteAcceptance>;
    auditCount: bigint;
    libItemVersions: Array<LibItemVersion>;
    declarations: Array<Declaration>;
    memberships: Array<MembershipView>;
    workStarts: Array<WorkStart>;
    quoteTerms: Array<QuoteTerms>;
    photos: Array<Photo>;
    linkHistory: Array<LinkHistory>;
    measureSnapshots: Array<[bigint, Array<SurveyPostSnap>]>;
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
export interface LibChapter {
    id: bigint;
    title: string;
    order: bigint;
    code: string;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    archivedAt?: bigint;
}
export interface LibChapterInput {
    id?: bigint;
    title: string;
    order: bigint;
    code: string;
    note: string;
}
export interface LibChapterView {
    id: bigint;
    title: string;
    order: bigint;
    code: string;
    note: string;
    items: bigint;
    archived: boolean;
}
export interface LibCost {
    id: bigint;
    day: Day;
    ref: string;
    itemId: bigint;
    archiveReason: string;
    source: string;
    orgId?: OrgId;
    cost: Confidential;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    extra: Extra;
    archivedAt?: bigint;
    archivedBy?: PersonId;
}
export interface LibCostInput {
    day: Day;
    ref: string;
    source: string;
    orgId?: OrgId;
    costCents: bigint;
    note: string;
}
export interface LibCostView {
    at: bigint;
    id: bigint;
    day: Day;
    ref: string;
    itemId: bigint;
    byName: string;
    orgName: string;
    archiveReason: string;
    source: string;
    orgId?: OrgId;
    costCents?: bigint;
    note: string;
    archived: boolean;
}
export interface LibFilter {
    trade?: string;
    orgId?: OrgId;
    form?: ContractForm;
    text: string;
    unit?: string;
    offset: bigint;
    chapterId?: bigint;
    limit: bigint;
    includeArchived: boolean;
}
export interface LibItem {
    id: bigint;
    durationDays?: bigint;
    title: string;
    trade?: string;
    perDayMilli?: bigint;
    archiveReason: string;
    orgId?: OrgId;
    code: string;
    form: ContractForm;
    createdAt: bigint;
    createdBy: PersonId;
    text: string;
    unit: string;
    planStepKey?: string;
    importKey?: string;
    chapterId: bigint;
    extra: Extra;
    version: bigint;
    keywords: Array<string>;
    updatedAt: bigint;
    updatedBy: PersonId;
    archivedAt?: bigint;
    archivedBy?: PersonId;
}
export interface LibItemInput {
    id?: bigint;
    durationDays?: bigint;
    title: string;
    trade?: string;
    perDayMilli?: bigint;
    orgId?: OrgId;
    code: string;
    form: ContractForm;
    text: string;
    unit: string;
    planStepKey?: string;
    importKey?: string;
    chapterId: bigint;
    keywords: Array<string>;
}
export interface LibItemVersion {
    at: bigint;
    by: PersonId;
    id: bigint;
    itemId: bigint;
    item: LibItem;
    version: bigint;
    fields: string;
}
export interface LibItemVersionView {
    at: bigint;
    byName: string;
    item: LibItemView;
    version: bigint;
    fields: string;
}
export interface LibItemView {
    id: bigint;
    durationDays?: bigint;
    title: string;
    trade?: string;
    perDayMilli?: bigint;
    orgName: string;
    archiveReason: string;
    orgId?: OrgId;
    code: string;
    form: ContractForm;
    text: string;
    unit: string;
    planStepKey?: string;
    importKey?: string;
    chapterId: bigint;
    chapterTitle: string;
    version: bigint;
    updatedByName: string;
    keywords: Array<string>;
    updatedAt: bigint;
    archived: boolean;
    chapterCode: string;
    unitName: string;
}
export interface LibPage {
    total: bigint;
    items: Array<LibItemView>;
}
export interface LibPriceHistory {
    costs: Array<LibCostView>;
    sells: Array<LibSellVersionView>;
}
export interface LibPriceView {
    itemId: bigint;
    sellVersion: bigint;
    perOrg: Array<LibCostView>;
    cost?: LibCostView;
    marginBp?: bigint;
    rule?: LibSellRule;
    costCount: bigint;
    deviates: boolean;
    sellCents?: bigint;
    reason: string;
}
export interface LibPrices {
    standardMarginBp: bigint;
    prices: Array<LibPriceView>;
}
export interface LibSell {
    itemId: bigint;
    rule?: Confidential_2;
    extra: Extra;
    version: bigint;
    updatedAt: bigint;
    updatedBy: PersonId;
    reason: Confidential_1;
}
export interface LibSellInput {
    rule?: LibSellRule;
    reason: string;
}
export type LibSellRule = {
    __kind__: "margin";
    margin: bigint;
} | {
    __kind__: "price";
    price: bigint;
};
export interface LibSellVersion {
    at: bigint;
    by: PersonId;
    id: bigint;
    itemId: bigint;
    rule?: Confidential_2;
    version: bigint;
    reason: Confidential_1;
}
export interface LibSellVersionView {
    at: bigint;
    byName: string;
    rule?: LibSellRule;
    version: bigint;
    reason: string;
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
export interface MeasureEntry {
    id: bigint;
    day: Day;
    files: Array<MeasureFile>;
    review?: MeasureReview;
    versionId: bigint;
    qtyMilli: bigint;
    blockKey: string;
    proposedOrgId?: OrgId;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    root: bigint;
    extra: Extra;
    surveyId: bigint;
    complete: boolean;
    corrects?: bigint;
    workId: WorkId;
    lineId: bigint;
    reason: string;
    archivedAt?: bigint;
    archivedBy?: PersonId;
}
export interface MeasureEntryView {
    id: bigint;
    day: bigint;
    files: Array<MeasureFileView>;
    status: string;
    byName: string;
    canCorrect: boolean;
    qtyMilli: bigint;
    blockKey: string;
    contributionMilli: bigint;
    superseded: boolean;
    note: string;
    createdAt: bigint;
    root: bigint;
    canRemove: boolean;
    surveyNumber: bigint;
    reviewedByName: string;
    reviewNote: string;
    reviewedAt?: bigint;
    surveyId: bigint;
    complete: boolean;
    corrects?: bigint;
    proposedByOrg: string;
    surveyClosed: boolean;
    lineId: bigint;
    archived: boolean;
    reason: string;
}
export interface MeasureFile {
    role: MeasureFileRole;
    fileId: bigint;
    caption: string;
    thumbFileId?: bigint;
}
export interface MeasureFileIn {
    thumb?: FileIn;
    file: FileIn;
    role: MeasureFileRole;
    caption: string;
}
export interface MeasureFileView {
    thumb?: FileView;
    file: FileView;
    role: MeasureFileRole;
    caption: string;
}
export type MeasureOp = {
    __kind__: "remove";
    remove: {
        entryId: bigint;
    };
} | {
    __kind__: "review";
    review: {
        ok: boolean;
        note: string;
        entryId: bigint;
    };
} | {
    __kind__: "close";
    close: {
        note: string;
    };
} | {
    __kind__: "open";
    open: {
        workId: bigint;
    };
} | {
    __kind__: "entry";
    entry: {
        day: bigint;
        files: Array<MeasureFileIn>;
        qtyMilli: bigint;
        note: string;
        complete: boolean;
        corrects?: bigint;
        lineId: bigint;
        reason: string;
    };
};
export interface MeasureOpInput {
    op: MeasureOp;
    opId: string;
    clientKey: string;
}
export interface MeasureOpResult {
    repeated: boolean;
    opId: string;
    outcome: MeasureOutcome;
}
export type MeasureOutcome = {
    __kind__: "err";
    err: string;
} | {
    __kind__: "done";
    done: {
        note: string;
        surveyId: bigint;
        entityId?: bigint;
    };
};
export interface MeasurePostDetail {
    post: MeasurePostView;
    text: string;
    entries: Array<MeasureEntryView>;
}
export interface MeasurePostView {
    pendingCount: bigint;
    versionId: bigint;
    versionNo: bigint;
    title: string;
    closedMilli: bigint;
    option: boolean;
    entryCount: bigint;
    code: string;
    flag: MeasureFlag;
    form: ContractForm;
    root: bigint;
    unit: string;
    vhMilli: bigint;
    quoteNumber: string;
    chapterTitle: string;
    complete: boolean;
    diffBp?: bigint;
    measuredMilli: bigint;
    pendingMilli: bigint;
    inOffer: boolean;
    diffMilli: bigint;
    lastDay?: bigint;
    lineId: bigint;
    chapterCode: string;
}
export interface MeasureReview {
    at: bigint;
    by: PersonId;
    ok: boolean;
    note: string;
}
export interface MeasureSettingsView {
    externalRead: boolean;
    thresholdBp: bigint;
    oaPropose: boolean;
}
export interface MeasureSummaryView {
    workName: string;
    orgName: string;
    canWrite: boolean;
    note: string;
    canReview: boolean;
    surveys: Array<SurveyBrief>;
    thresholdBp: bigint;
    scope: string;
    totals: MeasureTotals;
    canPropose: boolean;
    openSurveyId?: bigint;
    posts: Array<MeasurePostView>;
    workId: bigint;
    quotes: Array<string>;
    workCode: string;
}
export interface MeasureTotals {
    lessCount: bigint;
    moreCount: bigint;
    measuredPosts: bigint;
    completePosts: bigint;
    posts: bigint;
    openProposals: bigint;
}
export interface MeasureWorkBrief {
    lessCount: bigint;
    pending: bigint;
    code: string;
    name: string;
    moreCount: bigint;
    openSurveyNumber?: bigint;
    measuredPosts: bigint;
    scope: string;
    address: Address;
    closedSurveys: bigint;
    posts: bigint;
    workId: bigint;
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
export interface MyAcceptanceView {
    hash: string;
    signed?: MySignedView;
    digital?: QuoteDigitalView;
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
export interface MyProgressBrief {
    id: bigint;
    workName: string;
    periodFrom: bigint;
    creditedBy: boolean;
    code: string;
    kind: ProgressKind;
    answered?: boolean;
    sentAt: bigint;
    periodTo: bigint;
}
export interface MyProgressRead {
    id: bigint;
    doc: ProgressDocInfo;
    periodFrom: bigint;
    creditedByCode: string;
    clientMode: string;
    code: string;
    hash: string;
    kind: ProgressKind;
    note: string;
    answer?: ProgressAnswerView;
    sentAt: bigint;
    lines: Array<ProgressLineFrozen>;
    totals: ProgressTotals;
    intact: boolean;
    canAnswer: boolean;
    periodTo: bigint;
    creditsCode: string;
}
export interface MyQuoteAnswered {
    at: bigint;
    status: QuoteStatus;
    hash: string;
}
export interface MyQuoteBrief {
    workName: string;
    status: QuoteStatus;
    versionId: bigint;
    title: string;
    expired: boolean;
    newerExists: boolean;
    quoteId: bigint;
    sentAt: bigint;
    version: bigint;
    number: string;
    decidedAt?: bigint;
    validUntil: bigint;
}
export interface MyQuoteChapter {
    id: bigint;
    title: string;
    code: string;
    sellCents: bigint;
}
export interface MyQuoteLine {
    id: bigint;
    title: string;
    qtyMilli: bigint;
    lineSellCents: bigint;
    code: string;
    form: ContractForm;
    kind: QuoteLineKind;
    text: string;
    unit: string;
    chapterId: bigint;
    unitSellCents?: bigint;
    specRef: string;
    unitName: string;
}
export interface MyQuoteRead {
    doc: QuoteDocInfo;
    subtotalCents: bigint;
    status: QuoteStatus;
    versionId: bigint;
    title: string;
    decisionNote: string;
    expired: boolean;
    vatBp: bigint;
    hash: string;
    totalCents: bigint;
    newerExists: boolean;
    vatCents: bigint;
    quoteId: bigint;
    sentAt: bigint;
    optionsMinusCents: bigint;
    lines: Array<MyQuoteLine>;
    version: bigint;
    optionsPlusCents: bigint;
    chapters: Array<MyQuoteChapter>;
    intact: boolean;
    number: string;
    canAnswer: boolean;
    intro: string;
    acceptance?: MyAcceptanceView;
}
export interface MySignedView {
    at: bigint;
    byName: string;
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
    liveMail: boolean;
    robots: Array<RobotSeen>;
    reminders: boolean;
    optedOut: Array<OrgId>;
    queued: bigint;
    reminderDay: bigint;
    cyclesBalance: bigint;
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
export interface ProgressAnswer {
    at: bigint;
    ok: boolean;
    principal: Principal;
    hash: string;
    note: string;
    statementId: bigint;
    extra: Extra;
    personId: PersonId;
}
export interface ProgressAnswerView {
    at: bigint;
    ok: boolean;
    byName: string;
    note: string;
}
export type ProgressBilling = {
    __kind__: "open";
    open: null;
} | {
    __kind__: "invoiced";
    invoiced: {
        at: bigint;
        by?: PersonId;
        ref: string;
    };
} | {
    __kind__: "ready";
    ready: {
        at: bigint;
        by: PersonId;
    };
};
export interface ProgressBrief {
    id: bigint;
    rev: bigint;
    workName: string;
    periodFrom: bigint;
    status: ProgressStatus;
    credits?: bigint;
    creditedByCode: string;
    creditedBy?: bigint;
    code: string;
    kind: ProgressKind;
    billing: string;
    answer?: {
        at: bigint;
        ok: boolean;
    };
    preparedByName: string;
    sentAt?: bigint;
    updatedByName: string;
    updatedAt: bigint;
    number: bigint;
    prepared: boolean;
    periodTo: bigint;
    workId: bigint;
    creditsCode: string;
    workCode: string;
}
export interface ProgressConf {
    statementId: bigint;
    sIndex: Confidential_3;
    iIndex: Confidential_3;
    extra: Extra;
    reason: Confidential_1;
}
export interface ProgressDocInfo {
    workName: string;
    quoteRefs: Array<string>;
    analyticCode: string;
    clientName: string;
    clientAddress?: Address;
    guarantee: GuaranteeKind;
    issuer: string;
    retentionOnIncl: boolean;
    workAddress: Address;
    dueDay: bigint;
    paymentDays: bigint;
    sendDay: bigint;
    clientVat?: string;
    revision?: ProgressRevisionFrozen;
    vatNote: string;
    workCode: string;
}
export interface ProgressExpect {
    payableCents: bigint;
    totalCents: bigint;
    vatCents: bigint;
    revisionCents: bigint;
    periodCents: bigint;
}
export interface ProgressFinding {
    key: string;
    count: bigint;
    text: string;
    block: boolean;
}
export interface ProgressFrozen {
    workName: string;
    quoteRefs: Array<string>;
    analyticCode: string;
    clientName: string;
    statementId: bigint;
    clientAddress?: Address;
    lines: Array<ProgressLineFrozen>;
    extra: Extra;
    guarantee: GuaranteeKind;
    issuer: string;
    retentionOnIncl: boolean;
    workAddress: Address;
    totals: ProgressTotals;
    dueDay: Day;
    paymentDays: bigint;
    sendDay: Day;
    clientVat?: string;
    revision?: ProgressRevisionFrozen;
    vatNote: string;
    workCode: string;
}
export interface ProgressFullView {
    doc?: ProgressDocInfo;
    canCancel: boolean;
    clientMode: string;
    clientNote: string;
    hash: string;
    note: string;
    canReady: boolean;
    canEdit: boolean;
    canSend: boolean;
    answer?: ProgressAnswerView;
    lines: Array<ProgressLineView>;
    totals: ProgressTotals;
    intact: boolean;
    findings: Array<ProgressFinding>;
    frozen: boolean;
    brief: ProgressBrief;
    unassignedRegieMilli: bigint;
    canCredit: boolean;
    openSurvey?: bigint;
    reason: string;
    header: ProgressHeader;
}
export interface ProgressHeader {
    model?: RevisionModel;
    vatBp: bigint;
    sIndex?: bigint;
    iIndex?: bigint;
    retentionBp: bigint;
    guarantee: GuaranteeKind;
    retentionOnIncl: boolean;
    signedVersion: string;
    contractFound: boolean;
    paymentDays: bigint;
    originalContractCents?: bigint;
    formula: string;
    vatNote: string;
}
export interface ProgressHints {
    hoursOpenMilli: bigint;
    planPctBp?: bigint;
    measuredSurvey?: bigint;
    measuredMilli?: bigint;
    hoursMilli?: bigint;
    hoursDisputedMilli: bigint;
}
export interface ProgressInput {
    at: bigint;
    by: PersonId;
    cumPctBp?: bigint;
    note: string;
    root: bigint;
    cumQtyMilli?: bigint;
}
export interface ProgressInputOp {
    cumPctBp?: bigint;
    clear: boolean;
    note: string;
    root: bigint;
    cumQtyMilli?: bigint;
}
export interface ProgressInvoiceData {
    periodFrom: bigint;
    buyerAddress?: Address;
    payableCents: bigint;
    documentType: string;
    lineTotalCents: bigint;
    vatBp: bigint;
    hash: string;
    totalCents: bigint;
    chargeCents: bigint;
    vatCents: bigint;
    taxableCents: bigint;
    billing: string;
    retentionCents: bigint;
    contractRef: string;
    billingRef: string;
    seller: string;
    lines: Array<ProgressInvoiceLine>;
    currency: string;
    dueDay: bigint;
    number: string;
    paymentDays: bigint;
    taxCategory: string;
    buyerVat?: string;
    issueDay: bigint;
    periodTo: bigint;
    projectRef: string;
    buyerName: string;
    taxNote: string;
}
export interface ProgressInvoiceLine {
    id: string;
    quantityMilli: bigint;
    section: string;
    description: string;
    amountCents: bigint;
    priceCents: bigint;
    unitCode: string;
}
export interface ProgressLineFrozen {
    cumPctBp: bigint;
    offerCents: bigint;
    versionId: bigint;
    title: string;
    unitPriceCents: bigint;
    prevQtyMilli: bigint;
    prevCents: bigint;
    code: string;
    note: string;
    root: bigint;
    unit: string;
    section: ProgressSection;
    quoteNumber: string;
    cumQtyMilli: bigint;
    periodCents: bigint;
    offerQtyMilli: bigint;
    cumCents: bigint;
    prevPctBp: bigint;
    basis: ProgressBasis;
    chapter: string;
    lineId: bigint;
}
export interface ProgressLineView {
    m: ProgressMoney;
    q: ProgressQtyLine;
}
export interface ProgressMoney {
    offerCents: bigint;
    unitPriceCents: bigint;
    prevCents: bigint;
    restCents: bigint;
    periodCents: bigint;
    cumCents: bigint;
    overVhCents: bigint;
    noPrice: boolean;
}
export interface ProgressQtyLine {
    flags: Array<string>;
    cumPctBp: bigint;
    versionId: bigint;
    title: string;
    hints: ProgressHints;
    prevQtyMilli: bigint;
    code: string;
    form: ContractForm;
    note: string;
    hasInput: boolean;
    root: bigint;
    unit: string;
    section: ProgressSection;
    quoteNumber: string;
    cumQtyMilli: bigint;
    offerQtyMilli: bigint;
    prevPctBp: bigint;
    basis: ProgressBasis;
    inOffer: boolean;
    chapter: string;
    lineId: bigint;
}
export interface ProgressQtyView {
    note: string;
    canEdit: boolean;
    lines: Array<ProgressQtyLine>;
    scope: string;
    brief: ProgressBrief;
    unassignedRegieMilli: bigint;
    canPrepare: boolean;
    openSurvey?: bigint;
}
export interface ProgressRevision {
    at: bigint;
    by: PersonId;
    model: Confidential_5;
    extra: Extra;
    version: bigint;
    workId: WorkId;
}
export interface ProgressRevisionFrozen {
    aBp: bigint;
    bBp: bigint;
    cBp: bigint;
    sIndex: bigint;
    iIndex: bigint;
    sBase: bigint;
    iBase: bigint;
    formula: string;
    sLabel: string;
    iLabel: string;
}
export interface ProgressSaveInput {
    setIndexes: boolean;
    note?: string;
    sIndex?: bigint;
    iIndex?: bigint;
    lines: Array<ProgressInputOp>;
    periodTo?: bigint;
    expect?: ProgressExpect;
}
export interface ProgressSaved {
    rev: bigint;
}
export interface ProgressSectionTotals {
    offerCents: bigint;
    prevCents: bigint;
    section: ProgressSection;
    periodCents: bigint;
    cumCents: bigint;
}
export interface ProgressSettings {
    client: string;
    retentionOnIncl: boolean;
}
export interface ProgressStatement {
    id: bigint;
    rev: bigint;
    periodFrom: Day;
    status: ProgressStatus;
    credits?: bigint;
    calcVersion: bigint;
    creditedBy?: bigint;
    code: string;
    hash: string;
    kind: ProgressKind;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    billing: ProgressBilling;
    sentAt?: bigint;
    sentBy?: PersonId;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    number: bigint;
    prepared?: {
        at: bigint;
        by: PersonId;
    };
    periodTo: Day;
    cancelReason: string;
    workId: WorkId;
}
export interface ProgressTotals {
    subtotalCents: bigint;
    offerCents: bigint;
    payableCents: bigint;
    revisionBaseCents: bigint;
    prevCents: bigint;
    vatBp: bigint;
    totalCents: bigint;
    vatCents: bigint;
    revisionCents: bigint;
    retentionCents: bigint;
    retentionBp: bigint;
    restCents: bigint;
    periodCents: bigint;
    cumCents: bigint;
    overVhCents: bigint;
    sections: Array<ProgressSectionTotals>;
}
export interface ProgressWorkBrief {
    code: string;
    name: string;
    sent: bigint;
    lastTo?: bigint;
    scope: string;
    posts: bigint;
    workId: bigint;
    lastCode: string;
    ready: bigint;
    draftId?: bigint;
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
export interface Quote {
    id: bigint;
    title: string;
    archiveReason: string;
    createdAt: bigint;
    createdBy: PersonId;
    extra: Extra;
    updatedAt: bigint;
    updatedBy: PersonId;
    number: string;
    workId: WorkId;
    archivedAt?: bigint;
    archivedBy?: PersonId;
}
export interface QuoteAcceptance {
    versionId: bigint;
    hash: string;
    extra: Extra;
    signed?: QuoteSignedProof;
    digital?: QuoteDigitalAccept;
}
export interface QuoteAcceptanceView {
    hash: string;
    signed?: QuoteSignedView;
    digital?: QuoteDigitalView;
}
export interface QuoteChapter {
    id: bigint;
    versionId: bigint;
    title: string;
    order: bigint;
    libChapterId?: bigint;
    code: string;
    extra: Extra;
    archivedAt?: bigint;
}
export interface QuoteChapterMargin {
    costCents: bigint;
    chapterId: bigint;
    sellWithCostCents: bigint;
}
export interface QuoteChapterOp {
    id?: bigint;
    ref: string;
    remove: boolean;
    title: string;
    order: bigint;
    libChapterId?: bigint;
    code: string;
}
export type QuoteChapterRef = {
    __kind__: "id";
    id: bigint;
} | {
    __kind__: "ref";
    ref: string;
};
export interface QuoteChapterTotal {
    chapterId: bigint;
    noPrice: bigint;
    sellCents: bigint;
}
export interface QuoteChapterView {
    id: bigint;
    title: string;
    order: bigint;
    libChapterId?: bigint;
    code: string;
}
export interface QuoteCheckDone {
    at: bigint;
    by: PersonId;
    versionId: bigint;
    warned: Array<[string, bigint]>;
    reason: string;
}
export interface QuoteCheckView {
    at: bigint;
    byName: string;
    warned: Array<QuoteWarned>;
    reason: string;
}
export interface QuoteCostLine {
    orgName: string;
    source: string;
    orgId?: OrgId;
    marginBp?: bigint;
    costCents?: bigint;
    rule?: LibSellRule;
    negative: boolean;
    libCostId?: bigint;
    lineCostCents?: bigint;
    noPrice: boolean;
    deviates: boolean;
    lineId: bigint;
    reason: string;
}
export interface QuoteCreated {
    versionId: bigint;
    quoteId: bigint;
    number: string;
}
export interface QuoteDecision {
    at: bigint;
    by: PersonId;
    note: string;
}
export interface QuoteDigitalAccept {
    at: bigint;
    principal: Principal;
    personId: PersonId;
}
export interface QuoteDigitalView {
    at: bigint;
    byName: string;
}
export interface QuoteDocInfo {
    workName: string;
    termsVersion: bigint;
    termsTitle: string;
    clientName: string;
    clientAddress?: Address;
    termsProvisional: boolean;
    issuer: string;
    workAddress: Address;
    paymentDays: bigint;
    termsText: string;
    frozen: boolean;
    clientVat?: string;
    vatNote: string;
    validUntil: bigint;
    workCode: string;
}
export interface QuoteDocSettings {
    terms: Array<QuoteTermsView>;
    issuer: string;
    paymentDays: bigint;
    current: QuoteTermsView;
}
export interface QuoteDocSettingsInput {
    issuer: string;
    paymentDays: bigint;
}
export interface QuoteDocView {
    info: QuoteDocInfo;
    mailed?: bigint;
    acceptance?: QuoteAcceptanceView;
}
export interface QuoteExpect {
    subtotalCents: bigint;
    costCents: bigint;
    totalCents: bigint;
    vatCents: bigint;
    optionsMinusCents: bigint;
    optionsPlusCents: bigint;
    marginCents: bigint;
    chapters: Array<QuoteExpectChapter>;
}
export interface QuoteExpectChapter {
    chapter: QuoteChapterRef;
    sellCents: bigint;
}
export interface QuoteFinding {
    lineIds: Array<bigint>;
    name: string;
    count: bigint;
    rule: string;
    severity: QuoteSeverity;
    chapterIds: Array<bigint>;
}
export interface QuoteHeaderInput {
    title: string;
    clientOrgId?: OrgId;
    validDays: bigint;
    vatBp: bigint;
    note: string;
    standardMarginBp: bigint;
    intro: string;
}
export interface QuoteLine {
    id: bigint;
    versionId: bigint;
    copiedFrom?: bigint;
    title: string;
    qtyMilli: bigint;
    order: bigint;
    code: string;
    form: ContractForm;
    kind: QuoteLineKind;
    text: string;
    unit: string;
    chapterId: bigint;
    extra: Extra;
    libItemId?: bigint;
    libItemVersion?: bigint;
    specRef: string;
    archivedAt?: bigint;
}
export interface QuoteLineOp {
    id?: bigint;
    ref: string;
    remove: boolean;
    title: string;
    qtyMilli: bigint;
    order: bigint;
    code: string;
    form: ContractForm;
    kind: QuoteLineKind;
    text: string;
    unit: string;
    libItemId?: bigint;
    libItemVersion?: bigint;
    price: QuotePriceInput;
    chapter: QuoteChapterRef;
    specRef: string;
}
export interface QuoteLinePrice {
    versionId: bigint;
    source: string;
    orgId?: OrgId;
    cost: Confidential_6;
    rule: Confidential_7;
    libCostId?: bigint;
    extra: Extra;
    lineId: bigint;
    reason: Confidential_1;
}
export interface QuoteLineView {
    id: bigint;
    copiedFrom?: bigint;
    title: string;
    qtyMilli: bigint;
    order: bigint;
    code: string;
    form: ContractForm;
    kind: QuoteLineKind;
    text: string;
    unit: string;
    chapterId: bigint;
    libItemId?: bigint;
    libItemVersion?: bigint;
    specRef: string;
    unitName: string;
}
export interface QuoteMarginTotals {
    deviating: bigint;
    marginBp?: bigint;
    costCents: bigint;
    negative: bigint;
    standardMarginBp: bigint;
    sellWithCostCents: bigint;
    marginCents: bigint;
    chapters: Array<QuoteChapterMargin>;
    sellWithoutCostCents: bigint;
    noReason: bigint;
}
export interface QuoteNew {
    title: string;
    number: string;
    workId: WorkId;
}
export interface QuotePriceInput {
    source: string;
    orgId?: OrgId;
    costCents?: bigint;
    rule?: LibSellRule;
    libCostId?: bigint;
    reason: string;
}
export interface QuoteRead {
    doc?: QuoteDocView;
    check?: QuoteCheckView;
    costs: Array<QuoteCostLine>;
    sell: Array<QuoteSellLine>;
    quote: QuoteSummary;
    margins?: QuoteMarginTotals;
    lines: Array<QuoteLineView>;
    scope: QuoteScope;
    version: QuoteVersionView;
    chapters: Array<QuoteChapterView>;
    totals: QuoteTotalsView;
    vatNote: string;
}
export interface QuoteRuleCfg {
    key: string;
    thresholdBp?: bigint;
    enabled: boolean;
    updatedAt: bigint;
    updatedBy: PersonId;
    severity: QuoteSeverity;
}
export interface QuoteRuleInput {
    key: string;
    thresholdBp?: bigint;
    enabled: boolean;
    severity: QuoteSeverity;
}
export interface QuoteRuleView {
    key: string;
    fixed: boolean;
    name: string;
    thresholdBp?: bigint;
    enabled: boolean;
    severity: QuoteSeverity;
    hasThreshold: boolean;
}
export interface QuoteRulesView {
    stdPosts: Array<QuoteStdPostView>;
    rules: Array<QuoteRuleView>;
}
export interface QuoteSaveResult {
    rev: bigint;
    refs: Array<[string, bigint]>;
    margins: QuoteMarginTotals;
    totals: QuoteTotalsView;
}
export interface QuoteSellLine {
    lineSellCents: bigint;
    unitSellCents?: bigint;
    lineId: bigint;
}
export interface QuoteSendInfo {
    workName: string;
    versionId: bigint;
    termsVersion: bigint;
    termsId: bigint;
    termsTitle: string;
    clientName: string;
    clientAddress?: Address;
    extra: Extra;
    termsProvisional: boolean;
    issuer: string;
    workAddress: Address;
    paymentDays: bigint;
    termsText: string;
    clientVat?: string;
    vatNote: string;
    validUntil: Day;
    workCode: string;
}
export interface QuoteSent {
    at: bigint;
    by: PersonId;
    subtotalCents: bigint;
    hash: string;
    totalCents: bigint;
    vatCents: bigint;
    optionsMinusCents: bigint;
    optionsPlusCents: bigint;
}
export interface QuoteSignedProof {
    at: bigint;
    by: PersonId;
    note: string;
    fileId: bigint;
}
export interface QuoteSignedView {
    at: bigint;
    byName: string;
    note: string;
    fileId: bigint;
}
export interface QuoteStdPost {
    key: string;
    order: bigint;
    name: string;
    enabled: boolean;
    keywords: Array<string>;
    updatedAt: bigint;
    updatedBy: PersonId;
    severity: QuoteSeverity;
    archivedAt?: bigint;
}
export interface QuoteStdPostInput {
    key: string;
    order: bigint;
    name: string;
    enabled: boolean;
    keywords: Array<string>;
    severity: QuoteSeverity;
    archived: boolean;
}
export interface QuoteStdPostView {
    key: string;
    order: bigint;
    name: string;
    enabled: boolean;
    keywords: Array<string>;
    severity: QuoteSeverity;
    archived: boolean;
}
export interface QuoteSummary {
    id: bigint;
    workName: string;
    title: string;
    archiveReason: string;
    clientName: string;
    updatedAt: bigint;
    number: string;
    workId: WorkId;
    versions: Array<QuoteVersionBrief>;
    archived: boolean;
    workCode: string;
}
export interface QuoteTerms {
    id: bigint;
    title: string;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    text: string;
    extra: Extra;
    version: bigint;
    provisional: boolean;
    archivedAt?: bigint;
}
export interface QuoteTermsInput {
    title: string;
    note: string;
    text: string;
    provisional: boolean;
}
export interface QuoteTermsView {
    id: bigint;
    byName: string;
    title: string;
    note: string;
    createdAt: bigint;
    text: string;
    version: bigint;
    provisional: boolean;
}
export interface QuoteTotalsView {
    subtotalCents: bigint;
    calcVersion: bigint;
    vatBp: bigint;
    totalCents: bigint;
    vatCents: bigint;
    optionsMinusCents: bigint;
    optionsPlusCents: bigint;
    chapters: Array<QuoteChapterTotal>;
    noPrice: bigint;
}
export interface QuoteVersion {
    id: bigint;
    rev: bigint;
    status: QuoteStatus;
    title: string;
    clientOrgId?: OrgId;
    decision?: QuoteDecision;
    calcVersion: bigint;
    validDays: bigint;
    vatBp: bigint;
    basedOnId?: bigint;
    note: string;
    createdAt: bigint;
    createdBy: PersonId;
    sent?: QuoteSent;
    quoteId: bigint;
    extra: Extra;
    version: bigint;
    updatedAt: bigint;
    updatedBy: PersonId;
    intro: string;
}
export interface QuoteVersionBrief {
    id: bigint;
    status: QuoteStatus;
    createdAt: bigint;
    sentAt?: bigint;
    lines: bigint;
    version: bigint;
    updatedAt: bigint;
    createdByName: string;
}
export interface QuoteVersionConf {
    versionId: bigint;
    standardMarginBp: Confidential_8;
    extra: Extra;
}
export interface QuoteVersionView {
    id: bigint;
    rev: bigint;
    status: QuoteStatus;
    title: string;
    clientOrgId?: OrgId;
    decisionNote: string;
    calcVersion: bigint;
    validDays: bigint;
    vatBp: bigint;
    clientName: string;
    hash: string;
    sentByName: string;
    note: string;
    createdAt: bigint;
    quoteId: bigint;
    decidedByName: string;
    basedOnVersion?: bigint;
    sentAt?: bigint;
    version: bigint;
    updatedByName: string;
    updatedAt: bigint;
    createdByName: string;
    intact: boolean;
    intro: string;
    editable: boolean;
    decidedAt?: bigint;
    workVatBp: bigint;
}
export interface QuoteWarned {
    name: string;
    count: bigint;
    rule: string;
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
    __kind__: "measureOps";
    measureOps: Array<SurveyOpRecord>;
} | {
    __kind__: "audit";
    audit: Array<AuditEntry>;
} | {
    __kind__: "progressStatements";
    progressStatements: Array<ProgressStatement>;
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
    __kind__: "libCosts";
    libCosts: Array<LibCost>;
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
    __kind__: "progressAnswers";
    progressAnswers: Array<ProgressAnswer>;
} | {
    __kind__: "quoteLines";
    quoteLines: Array<QuoteLine>;
} | {
    __kind__: "libSellVersions";
    libSellVersions: Array<LibSellVersion>;
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
    __kind__: "surveys";
    surveys: Array<Survey>;
} | {
    __kind__: "libSells";
    libSells: Array<LibSell>;
} | {
    __kind__: "libChapters";
    libChapters: Array<LibChapter>;
} | {
    __kind__: "quotePrices";
    quotePrices: Array<QuoteLinePrice>;
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
    __kind__: "quoteChecks";
    quoteChecks: Array<QuoteCheckDone>;
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
    __kind__: "quoteChapters";
    quoteChapters: Array<QuoteChapter>;
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
    __kind__: "progressInputs";
    progressInputs: Array<[bigint, Array<ProgressInput>]>;
} | {
    __kind__: "progressConf";
    progressConf: Array<ProgressConf>;
} | {
    __kind__: "dependencies";
    dependencies: Array<Dependency>;
} | {
    __kind__: "surveyKeys";
    surveyKeys: Array<[string, bigint]>;
} | {
    __kind__: "libItems";
    libItems: Array<LibItem>;
} | {
    __kind__: "quoteSendInfos";
    quoteSendInfos: Array<QuoteSendInfo>;
} | {
    __kind__: "quoteVersionConf";
    quoteVersionConf: Array<QuoteVersionConf>;
} | {
    __kind__: "progressFrozen";
    progressFrozen: Array<[bigint, Confidential_4]>;
} | {
    __kind__: "robots";
    robots: Array<RobotView>;
} | {
    __kind__: "permitChanges";
    permitChanges: Array<PermitChange>;
} | {
    __kind__: "quoteVersions";
    quoteVersions: Array<QuoteVersion>;
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
    __kind__: "quoteStdPosts";
    quoteStdPosts: Array<QuoteStdPost>;
} | {
    __kind__: "permitAlerts";
    permitAlerts: Array<[string, bigint]>;
} | {
    __kind__: "works";
    works: Array<WorkView>;
} | {
    __kind__: "quoteRules";
    quoteRules: Array<QuoteRuleCfg>;
} | {
    __kind__: "orgConfidential";
    orgConfidential: Array<[OrgId, ContactConfidentialView]>;
} | {
    __kind__: "quotes";
    quotes: Array<Quote>;
} | {
    __kind__: "measureEntries";
    measureEntries: Array<MeasureEntry>;
} | {
    __kind__: "personContacts";
    personContacts: Array<PersonContact>;
} | {
    __kind__: "sequences";
    sequences: Array<[string, bigint]>;
} | {
    __kind__: "quoteAcceptances";
    quoteAcceptances: Array<QuoteAcceptance>;
} | {
    __kind__: "libItemVersions";
    libItemVersions: Array<LibItemVersion>;
} | {
    __kind__: "declarations";
    declarations: Array<Declaration>;
} | {
    __kind__: "memberships";
    memberships: Array<MembershipView>;
} | {
    __kind__: "workStarts";
    workStarts: Array<WorkStart>;
} | {
    __kind__: "quoteTerms";
    quoteTerms: Array<QuoteTerms>;
} | {
    __kind__: "photos";
    photos: Array<Photo>;
} | {
    __kind__: "progressRevisions";
    progressRevisions: Array<ProgressRevision>;
} | {
    __kind__: "linkHistory";
    linkHistory: Array<LinkHistory>;
} | {
    __kind__: "measureSnapshots";
    measureSnapshots: Array<[bigint, Array<SurveyPostSnap>]>;
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
    ok: WorkStartPreview;
} | {
    __kind__: "err";
    err: string;
};
export type Result_1 = {
    __kind__: "ok";
    ok: WorkView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_10 = {
    __kind__: "ok";
    ok: PlanResult;
} | {
    __kind__: "err";
    err: string;
};
export type Result_11 = {
    __kind__: "ok";
    ok: QuoteSaveResult;
} | {
    __kind__: "err";
    err: string;
};
export type Result_12 = {
    __kind__: "ok";
    ok: ProgressSaved;
} | {
    __kind__: "err";
    err: string;
};
export type Result_13 = {
    __kind__: "ok";
    ok: MunicipalityView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_14 = {
    __kind__: "ok";
    ok: PermitView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_15 = {
    __kind__: "ok";
    ok: OrgContactView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_16 = {
    __kind__: "ok";
    ok: OaPersonView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_17 = {
    __kind__: "ok";
    ok: LibItemView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_18 = {
    __kind__: "ok";
    ok: DeclarationView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_19 = {
    __kind__: "ok";
    ok: RollbackReport;
} | {
    __kind__: "err";
    err: string;
};
export type Result_2 = {
    __kind__: "ok";
    ok: PersonView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_20 = {
    __kind__: "ok";
    ok: RestoreSummary;
} | {
    __kind__: "err";
    err: string;
};
export type Result_21 = {
    __kind__: "ok";
    ok: MeView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_22 = {
    __kind__: "ok";
    ok: OaWithholding;
} | {
    __kind__: "err";
    err: string;
};
export type Result_23 = {
    __kind__: "ok";
    ok: QuoteRead;
} | {
    __kind__: "err";
    err: string;
};
export type Result_24 = {
    __kind__: "ok";
    ok: ProgressFullView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_25 = {
    __kind__: "ok";
    ok: RevisionModel | null;
} | {
    __kind__: "err";
    err: string;
};
export type Result_26 = {
    __kind__: "ok";
    ok: ContactConfidentialView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_27 = {
    __kind__: "ok";
    ok: MyQuoteRead;
} | {
    __kind__: "err";
    err: string;
};
export type Result_28 = {
    __kind__: "ok";
    ok: MyProgressRead;
} | {
    __kind__: "err";
    err: string;
};
export type Result_29 = {
    __kind__: "ok";
    ok: LibPrices;
} | {
    __kind__: "err";
    err: string;
};
export type Result_3 = {
    __kind__: "ok";
    ok: OrgView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_30 = {
    __kind__: "ok";
    ok: LibPriceHistory;
} | {
    __kind__: "err";
    err: string;
};
export type Result_31 = {
    __kind__: "ok";
    ok: Array<ContractVersionView>;
} | {
    __kind__: "err";
    err: string;
};
export type Result_32 = {
    __kind__: "ok";
    ok: ContractView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_33 = {
    __kind__: "ok";
    ok: FileView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_34 = {
    __kind__: "ok";
    ok: ProgressInvoiceData;
} | {
    __kind__: "err";
    err: string;
};
export type Result_35 = {
    __kind__: "ok";
    ok: PlanPreview;
} | {
    __kind__: "err";
    err: string;
};
export type Result_36 = {
    __kind__: "ok";
    ok: MailOut;
} | {
    __kind__: "err";
    err: string;
};
export type Result_37 = {
    __kind__: "ok";
    ok: MailPreview;
} | {
    __kind__: "err";
    err: string;
};
export type Result_38 = {
    __kind__: "ok";
    ok: FineResult;
} | {
    __kind__: "err";
    err: string;
};
export type Result_39 = {
    __kind__: "ok";
    ok: Array<LibItemVersionView>;
} | {
    __kind__: "err";
    err: string;
};
export type Result_4 = {
    __kind__: "ok";
    ok: bigint;
} | {
    __kind__: "err";
    err: string;
};
export type Result_40 = {
    __kind__: "ok";
    ok: NewCode;
} | {
    __kind__: "err";
    err: string;
};
export type Result_41 = {
    __kind__: "ok";
    ok: PlanImportReport;
} | {
    __kind__: "err";
    err: string;
};
export type Result_42 = {
    __kind__: "ok";
    ok: ImportReport;
} | {
    __kind__: "err";
    err: string;
};
export type Result_43 = {
    __kind__: "ok";
    ok: OaView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_44 = {
    __kind__: "ok";
    ok: RestorePart;
} | {
    __kind__: "err";
    err: string;
};
export type Result_45 = {
    __kind__: "ok";
    ok: MyQuoteAnswered;
} | {
    __kind__: "err";
    err: string;
};
export type Result_46 = {
    __kind__: "ok";
    ok: DeclarationDraft;
} | {
    __kind__: "err";
    err: string;
};
export type Result_47 = {
    __kind__: "ok";
    ok: NewTicket;
} | {
    __kind__: "err";
    err: string;
};
export type Result_48 = {
    __kind__: "ok";
    ok: QuoteCreated;
} | {
    __kind__: "err";
    err: string;
};
export type Result_49 = {
    __kind__: "ok";
    ok: CiawExport;
} | {
    __kind__: "err";
    err: string;
};
export type Result_5 = {
    __kind__: "ok";
    ok: WorkStartDone;
} | {
    __kind__: "err";
    err: string;
};
export type Result_50 = {
    __kind__: "ok";
    ok: TicketInfo;
} | {
    __kind__: "err";
    err: string;
};
export type Result_51 = {
    __kind__: "ok";
    ok: Array<QuoteFinding>;
} | {
    __kind__: "err";
    err: string;
};
export type Result_6 = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: string;
};
export type Result_7 = {
    __kind__: "ok";
    ok: PostSettingsView;
} | {
    __kind__: "err";
    err: string;
};
export type Result_8 = {
    __kind__: "ok";
    ok: string;
} | {
    __kind__: "err";
    err: string;
};
export type Result_9 = {
    __kind__: "ok";
    ok: MailRound;
} | {
    __kind__: "err";
    err: string;
};
export interface RevisionModel {
    aBp: bigint;
    bBp: bigint;
    cBp: bigint;
    note: string;
    sBase: bigint;
    iBase: bigint;
    sLabel: string;
    iLabel: string;
}
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
export interface Survey {
    id: bigint;
    status: SurveyStatus;
    extra: Extra;
    number: bigint;
    clientKey: string;
    workId: WorkId;
    openedAt: bigint;
    openedBy: PersonId;
}
export interface SurveyBrief {
    id: bigint;
    pendingCount: bigint;
    closeNote: string;
    entryCount: bigint;
    open: boolean;
    openedByName: string;
    thresholdBp?: bigint;
    closedAt?: bigint;
    number: bigint;
    openedAt: bigint;
    closedByName: string;
}
export interface SurveyDetail {
    snapshot: Array<SurveyPostSnapView>;
    entries: Array<MeasureEntryView>;
    survey: SurveyBrief;
}
export interface SurveyOpRecord {
    at: bigint;
    by: PersonId;
    seq: bigint;
    kind: string;
    note: string;
    opId: string;
    surveyId: bigint;
    entityId?: bigint;
}
export interface SurveyPostSnap {
    versionId: bigint;
    root: bigint;
    unit: string;
    vhMilli: bigint;
    complete: boolean;
    deltaMilli: bigint;
    measuredMilli: bigint;
    lineId: bigint;
}
export interface SurveyPostSnapView {
    title: string;
    code: string;
    flag: MeasureFlag;
    root: bigint;
    unit: string;
    vhMilli: bigint;
    quoteNumber: string;
    complete: boolean;
    deltaMilli: bigint;
    diffBp?: bigint;
    measuredMilli: bigint;
    diffMilli: bigint;
    lineId: bigint;
    chapterCode: string;
}
export type SurveyStatus = {
    __kind__: "closed";
    closed: {
        at: bigint;
        by: PersonId;
        note: string;
        thresholdBp: bigint;
    };
} | {
    __kind__: "open";
    open: null;
};
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
    quoteLineIds: Array<bigint>;
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
export interface UnitView {
    key: string;
    order: bigint;
    name: string;
    archived: boolean;
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
    contract: Confidential_10;
    extra: Extra;
    version: bigint;
    updatedAt: bigint;
    updatedBy: PersonId;
    notes: Confidential_1;
    workId: WorkId;
    clientContact: Confidential_9;
}
export interface WorkConfidentialVersion {
    at: bigint;
    by: PersonId;
    id: bigint;
    contract: Confidential_10;
    version: bigint;
    notes: Confidential_1;
    workId: WorkId;
    clientContact: Confidential_9;
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
export interface WorkStart {
    at: bigint;
    by: PersonId;
    status: WorkStartStatus;
    versionId: bigint;
    taskIds: Array<bigint>;
    lineIds: Array<bigint>;
    startDay: Day;
    note: string;
    quoteId: bigint;
    declaration: string;
    depIds: Array<bigint>;
    extra: Extra;
    templateKey: string;
    baseVersionIds: Array<bigint>;
    linkedTaskIds: Array<bigint>;
    permitIds: Array<bigint>;
    sourceWorkId: WorkId;
    workId: WorkId;
    roots: Array<bigint>;
    newWork: boolean;
}
export interface WorkStartCaps {
    start: boolean;
    setLeader: boolean;
    newWork: boolean;
}
export interface WorkStartDone {
    at: bigint;
    status: string;
    versionId: bigint;
    tasks: bigint;
    byName: string;
    note: string;
    declaration: string;
    permits: bigint;
    dependencies: bigint;
    workId: bigint;
    already: boolean;
    linked: bigint;
    workCode: string;
    newWork: boolean;
}
export interface WorkStartExisting {
    id: bigint;
    end: bigint;
    title: string;
    kind: TaskKind;
    start: bigint;
}
export interface WorkStartGroup {
    end: bigint;
    key: string;
    existingTaskId?: bigint;
    title: string;
    workdays: bigint;
    leadDays: bigint;
    trade?: string;
    after: Array<string>;
    orgName: string;
    lineIds: Array<bigint>;
    tradeName: string;
    orgId?: bigint;
    kind: TaskKind;
    stepKey?: string;
    extraOrgs: Array<string>;
    start: bigint;
    daysFrom: string;
    companion: boolean;
}
export interface WorkStartInput {
    leaderPersonId?: bigint;
    skipPermits: Array<string>;
    startDay: bigint;
    declaration: boolean;
    templateKey: string;
    target: WorkStartTarget;
    lineSteps: Array<[bigint, string]>;
    groupDays: Array<[string, bigint]>;
    options: Array<bigint>;
}
export interface WorkStartLine {
    how: string;
    title: string;
    qtyMilli: bigint;
    orgName: string;
    tradeName: string;
    option: boolean;
    code: string;
    days?: bigint;
    unit: string;
    group: string;
    chapter: string;
    lineId: bigint;
}
export interface WorkStartNote {
    why: string;
    title: string;
    code: string;
    lineId: bigint;
}
export interface WorkStartPending {
    workName: string;
    versionId: bigint;
    title: string;
    meerwerk: boolean;
    acceptedHow: string;
    quoteId: bigint;
    quoteNumber: string;
    version: bigint;
    workId: bigint;
    acceptedAt: bigint;
    workCode: string;
}
export interface WorkStartPermit {
    to?: bigint;
    leadDays: bigint;
    groups: Array<string>;
    municipality: string;
    skipped: boolean;
    from?: bigint;
    kind: string;
    deadline?: bigint;
    kindName: string;
    exists: boolean;
    reason: string;
}
export interface WorkStartPreview {
    end?: bigint;
    workName: string;
    versionId: bigint;
    art30bis?: boolean;
    leaderPersonId?: bigint;
    templates: Array<[string, string]>;
    groups: Array<WorkStartGroup>;
    templateProvisional: boolean;
    vatBp: bigint;
    clientName: string;
    skipped: Array<WorkStartNote>;
    caps: WorkStartCaps;
    done?: WorkStartDone;
    startDay: bigint;
    checkinatwork?: boolean;
    declarationExists: boolean;
    planVersion: bigint;
    acceptedHow: string;
    quoteId: bigint;
    quoteNumber: string;
    sourceCode: string;
    templateName: string;
    art30bisReason: string;
    sourceName: string;
    lines: Array<WorkStartLine>;
    templateKey: string;
    leaderName: string;
    version: bigint;
    permits: Array<WorkStartPermit>;
    steps: Array<[string, string]>;
    warnings: Array<string>;
    existingCount: bigint;
    existing: Array<WorkStartExisting>;
    address: Address;
    bases: Array<string>;
    oaCount: bigint;
    sourceWorkId: bigint;
    workId?: bigint;
    changed: Array<WorkStartNote>;
    workStatus: WorkStatus;
    vatNote: string;
    removed: Array<WorkStartNote>;
    quoteTitle: string;
    workCode: string;
}
export type WorkStartTarget = {
    __kind__: "existing";
    existing: null;
} | {
    __kind__: "newWork";
    newWork: {
        asSub: boolean;
        code: string;
        name: string;
    };
};
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
export enum ContractForm {
    vh = "vh",
    fixed = "fixed",
    estimate = "estimate",
    perAttachment = "perAttachment",
    budget = "budget",
    regie = "regie"
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
export enum MeasureFileRole {
    photo = "photo",
    sketch = "sketch"
}
export enum MeasureFlag {
    less = "less",
    more = "more",
    none = "none",
    open = "open"
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
export enum ProgressBasis {
    hours = "hours",
    percent = "percent",
    quantity = "quantity"
}
export enum ProgressKind {
    statement = "statement",
    credit = "credit"
}
export enum ProgressSection {
    contract = "contract",
    less = "less",
    extra = "extra",
    regie = "regie"
}
export enum ProgressStatus {
    cancelled = "cancelled",
    sent = "sent",
    draft = "draft"
}
export enum QuoteLineKind {
    option = "option",
    item = "item",
    text = "text"
}
export enum QuoteScope {
    full = "full",
    sell = "sell",
    totals = "totals"
}
export enum QuoteSeverity {
    warn = "warn",
    block = "block"
}
export enum QuoteStatus {
    superseded = "superseded",
    sent = "sent",
    rejected = "rejected",
    accepted = "accepted",
    withdrawn = "withdrawn",
    draft = "draft"
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
export enum WorkStartStatus {
    started = "started",
    dismissed = "dismissed"
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
    acceptMyQuote(versionId: bigint, hash: string): Promise<Result_45>;
    accessStats(): Promise<AccessStats>;
    addDependency(workId: bigint, i: DependencyInput, expectedVersion: bigint): Promise<Result_10>;
    addFile(name: string, mime: string, size: bigint, blob: ExternalBlob, workId: bigint | null, confidential: boolean): Promise<Result_4>;
    addLibraryCost(itemId: bigint, i: LibCostInput): Promise<Result_4>;
    addMembership(workId: bigint, personId: bigint | null, orgId: bigint | null, role: Role, grants: Array<Grant>): Promise<Result_4>;
    addQuoteTerms(i: QuoteTermsInput): Promise<Result_4>;
    addRobot(principal: Principal, name: string, kinds: Array<string>): Promise<Result_6>;
    answerMyProgress(id: bigint, hash: string, ok: boolean, note: string): Promise<Result_6>;
    applyPlan(workId: bigint, change: PlanChange, expectedVersion: bigint, reason: string): Promise<Result_10>;
    applyTemplate(workId: bigint, key: string, startDay: bigint, append: boolean, expectedVersion: bigint): Promise<Result_10>;
    archiveAbsence(id: bigint): Promise<Result_6>;
    archiveAssignment(workId: bigint, assignmentId: bigint, expectedVersion: bigint): Promise<Result_4>;
    archiveCalendarBlock(id: bigint): Promise<Result_6>;
    archiveDocument(docId: bigint): Promise<Result_6>;
    archiveFile(id: bigint): Promise<Result_6>;
    archiveLibraryCost(costId: bigint, reason: string): Promise<Result_6>;
    archiveOrg(id: bigint): Promise<Result_6>;
    archivePermit(permitId: bigint, reason: string): Promise<Result_6>;
    archivePerson(id: bigint): Promise<Result_6>;
    archiveTask(workId: bigint, taskId: bigint, expectedVersion: bigint): Promise<Result_4>;
    attachDocumentFile(workId: bigint, kindKey: string, docId: bigint | null, fileId: bigint): Promise<Result_4>;
    attachPermitFile(permitId: bigint, fileId: bigint): Promise<Result_14>;
    auditCount(): Promise<bigint>;
    auditLog(from: bigint, limit: bigint): Promise<Array<AuditEntry>>;
    boardConflicts(fromDay: bigint, weeks: bigint, limit: bigint): Promise<ConflictList>;
    boardRules(): Promise<BoardRulesView>;
    cancelJob(id: bigint): Promise<Result_6>;
    cancelProgressDraft(id: bigint, reason: string): Promise<Result_6>;
    checkQuoteVersion(versionId: bigint): Promise<Result_51>;
    checkTicket(ticket: string): Promise<Result_50>;
    checkinatworkExport(workId: bigint, from: bigint, to: bigint): Promise<Result_49>;
    claimBootstrap(code: string, name: string): Promise<Result_2>;
    completeJob(id: bigint, attempt: bigint, result: string): Promise<Result_6>;
    confirmAssignment(assignmentId: bigint, accept: boolean, reason: string): Promise<Result_6>;
    confirmHours(attendanceId: bigint, ok: boolean, remark: string): Promise<Result_6>;
    confirmLink(p: Principal): Promise<Result_6>;
    createOrg(input: OrgInput): Promise<Result_3>;
    createQuote(i: QuoteNew): Promise<Result_48>;
    createRecoveryCode(personId: bigint, validDays: bigint, tag: string): Promise<Result_40>;
    createTicket(task: string, workId: bigint | null): Promise<Result_47>;
    createWork(i: WorkInput): Promise<Result_1>;
    creditProgress(id: bigint, reason: string): Promise<Result_4>;
    dashboard(day: bigint): Promise<DashboardView>;
    decideProposal(id: bigint, accepted: boolean, note: string): Promise<Result_6>;
    decideQuoteVersion(versionId: bigint, accepted: boolean, note: string): Promise<Result_6>;
    declarationDraft(workId: bigint): Promise<Result_46>;
    declineMyQuote(versionId: bigint, hash: string, note: string): Promise<Result_45>;
    dismissWorkStart(versionId: bigint, reason: string): Promise<Result_5>;
    endMembership(id: bigint): Promise<Result_6>;
    exportChunk(kind: string, from: bigint, limit: bigint): Promise<Result_44>;
    exportConfidential(): Promise<ExportConfidential>;
    exportIntern(): Promise<ExportIntern>;
    failJob(id: bigint, attempt: bigint, why: string, retry: boolean): Promise<Result_6>;
    getDossier(workId: bigint): Promise<DossierView>;
    getLibraryItem(id: bigint): Promise<Result_17>;
    getMeasureSurvey(surveyId: bigint): Promise<SurveyDetail>;
    getOa(id: bigint): Promise<Result_43>;
    getPlan(workId: bigint): Promise<PlanView>;
    getQuoteDocSettings(): Promise<QuoteDocSettings>;
    getQuoteRules(): Promise<QuoteRulesView>;
    getReport(reportId: bigint): Promise<ReportView>;
    getReportDay(workId: bigint, day: bigint): Promise<Array<ReportView>>;
    getSettings(): Promise<SettingsView>;
    getWork(id: bigint): Promise<WorkView>;
    handleIssue(issueId: bigint, note: string): Promise<Result_6>;
    importOrgs(dryRun: boolean, rows: Array<ImportRow>): Promise<Result_42>;
    importPlanning(dryRun: boolean, batchId: string, title: string, knownBlocks: Array<string>, block: ImportBlock): Promise<Result_41>;
    inviteExistingPerson(i: ExistingInvite): Promise<Result_40>;
    invitePerson(req: InviteRequest): Promise<Result_40>;
    leaseJobs(max: bigint): Promise<Array<JobLease>>;
    libraryChapters(includeArchived: boolean): Promise<Array<LibChapterView>>;
    libraryItemHistory(id: bigint): Promise<Result_39>;
    libraryUnits(includeArchived: boolean): Promise<Array<UnitView>>;
    listAbsences(orgId: bigint | null, fromDay: bigint, toDay: bigint): Promise<Array<AbsenceView>>;
    listAppointments(workId: bigint): Promise<Array<Appointment>>;
    listCalendarBlocks(workId: bigint | null): Promise<Array<BlockView>>;
    listDocKinds(withArchived: boolean): Promise<Array<DocKindView>>;
    listFiles(workId: bigint | null): Promise<Array<FileView>>;
    listImportBatches(): Promise<Array<ImportBatch>>;
    listInvites(from: bigint, limit: bigint): Promise<Array<InviteView>>;
    listIssues(workId: bigint | null, openOnly: boolean, limit: bigint): Promise<Array<IssueView>>;
    listJobs(filter: string, from: bigint, limit: bigint): Promise<Array<JobView>>;
    listLibrary(f: LibFilter): Promise<LibPage>;
    listLinks(): Promise<Array<LinkView>>;
    listMailLog(from: bigint, limit: bigint): Promise<Array<MailLogView>>;
    listMeasureWorks(): Promise<Array<MeasureWorkBrief>>;
    listMembers(workId: bigint): Promise<Array<MembershipView>>;
    listMunicipalities(withArchived: boolean): Promise<Array<MunicipalityView>>;
    listMyProgress(): Promise<Array<MyProgressBrief>>;
    listMyQuotes(): Promise<Array<MyQuoteBrief>>;
    listOas(f: OaFilter): Promise<Array<OaView>>;
    listOrgs(includeArchived: boolean): Promise<Array<OrgView>>;
    listPermitKinds(withArchived: boolean): Promise<Array<PermitKindView>>;
    listPermits(filter: string, workId: bigint | null): Promise<Array<PermitView>>;
    listPersons(includeArchived: boolean): Promise<Array<PersonView>>;
    listProgress(workId: bigint): Promise<Array<ProgressBrief>>;
    listQuotes(workId: bigint | null, includeArchived: boolean): Promise<Array<QuoteSummary>>;
    listReports(workId: bigint, offset: bigint, limit: bigint): Promise<Array<ReportSummary>>;
    listRobots(): Promise<Array<RobotView>>;
    listTemplates(): Promise<Array<TemplateView>>;
    listTrades(withArchived: boolean): Promise<Array<TradeView>>;
    listTrips(fromDay: bigint, toDay: bigint): Promise<Array<TripView>>;
    listVehicles(withArchived: boolean): Promise<Array<VehicleView>>;
    listWorks(): Promise<Array<WorkView>>;
    loadLibraryStartChapters(): Promise<Result_4>;
    lookupFine(q: FineQuery): Promise<Result_38>;
    mailPreview(kind: string, orgId: bigint | null, monday: bigint): Promise<Result_37>;
    mailQuoteToClient(versionId: bigint): Promise<Result_6>;
    markNotificationsRead(ids: Array<bigint>): Promise<void>;
    markProgressPrepared(id: bigint): Promise<Result_6>;
    me(): Promise<MeView>;
    measurePost(workId: bigint, root: bigint): Promise<MeasurePostDetail>;
    measureSettings(): Promise<MeasureSettingsView>;
    measureSummary(workId: bigint): Promise<MeasureSummaryView>;
    measureSync(ops: Array<MeasureOpInput>): Promise<Array<MeasureOpResult>>;
    myBoard(fromDay: bigint, weeks: bigint): Promise<MyBoardView>;
    myDay(day: bigint, all: boolean): Promise<MyDayView>;
    myHours(fromDay: bigint, toDay: bigint): Promise<Array<HoursLine>>;
    myNotifications(unreadOnly: boolean): Promise<Array<NotificationView>>;
    myProposals(): Promise<Array<ProposalView>>;
    myWorks(): Promise<Array<ExternalWork>>;
    newProgress(workId: bigint): Promise<Result_4>;
    newQuoteVersion(quoteId: bigint, fromVersionId: bigint | null): Promise<Result_4>;
    orgAssignments(orgId: bigint | null, from: bigint, to: bigint): Promise<Array<OrgAssignmentView>>;
    pendingWorkStarts(workId: bigint | null): Promise<Array<WorkStartPending>>;
    permitHistory(permitId: bigint): Promise<Array<PermitChangeView>>;
    permitRules(): Promise<{
        expiryDays: bigint;
        warnDays: bigint;
    }>;
    permitsOnSite(day: bigint): Promise<Array<PermitView>>;
    postSettings(): Promise<PostSettingsView>;
    previewDependency(workId: bigint, i: DependencyInput): Promise<Result_35>;
    previewMail(kind: string, orgId: bigint | null, monday: bigint): Promise<Result_36>;
    previewPlan(workId: bigint, change: PlanChange): Promise<Result_35>;
    progressInvoiceData(id: bigint): Promise<Result_34>;
    progressQty(id: bigint): Promise<ProgressQtyView>;
    progressSettings(): Promise<ProgressSettings>;
    progressWorks(): Promise<Array<ProgressWorkBrief>>;
    queueReminders(monday: bigint): Promise<Result_4>;
    queueTestMail(email: string): Promise<Result_4>;
    queueWeekMails(monday: bigint, orgId: bigint | null): Promise<Result_4>;
    quoteSequence(year: bigint): Promise<bigint>;
    readConfidentialFile(id: bigint): Promise<Result_33>;
    readContract(workId: bigint): Promise<Result_32>;
    readContractHistory(workId: bigint): Promise<Result_31>;
    readLibraryPriceHistory(itemId: bigint): Promise<Result_30>;
    readLibraryPrices(ids: Array<bigint>): Promise<Result_29>;
    readMyProgress(id: bigint): Promise<Result_28>;
    readMyQuote(versionId: bigint): Promise<Result_27>;
    readOrgConfidential(id: bigint): Promise<Result_26>;
    readProgressRevision(workId: bigint): Promise<Result_25>;
    readProgressStatement(id: bigint): Promise<Result_24>;
    readQuoteVersion(versionId: bigint): Promise<Result_23>;
    recordWithholdingCheck(orgId: bigint, x: WithholdingInput): Promise<Result_22>;
    redeemCode(code: string): Promise<Result_21>;
    registerSignedQuote(versionId: bigint, fileId: bigint, note: string): Promise<Result_6>;
    removeDependency(workId: bigint, depId: bigint, expectedVersion: bigint): Promise<Result_4>;
    reportSync(ops: Array<ReportOpInput>): Promise<Array<OpResult>>;
    restoreBegin(code: string): Promise<Result_6>;
    restoreChunk(code: string, part: RestorePart): Promise<Result_4>;
    restoreFinish(code: string): Promise<Result_20>;
    restorePerson(id: bigint): Promise<Result_6>;
    retryJob(id: bigint): Promise<Result_6>;
    revokeInvite(inviteId: bigint): Promise<Result_6>;
    revokeLink(p: Principal): Promise<Result_6>;
    revokeRobot(principal: Principal): Promise<Result_6>;
    rollbackImport(batchId: string, dryRun: boolean): Promise<Result_19>;
    saveAbsence(i: AbsenceInput): Promise<Result_4>;
    saveAssignment(workId: bigint, i: AssignmentInput, expectedVersion: bigint): Promise<Result_4>;
    saveCalendarBlock(i: BlockInput): Promise<Result_4>;
    saveDeclaration(workId: bigint, x: DeclarationInput): Promise<Result_18>;
    saveDocument(workId: bigint, i: DocumentInput): Promise<Result_4>;
    saveLibraryChapter(i: LibChapterInput): Promise<Result_4>;
    saveLibraryItem(i: LibItemInput, expectedVersion: bigint): Promise<Result_17>;
    saveMeasureSettings(i: MeasureSettingsView): Promise<Result_6>;
    saveMunicipality(m: MunicipalityInput): Promise<Result_13>;
    saveOaPerson(orgId: bigint, i: OaPersonInput): Promise<Result_16>;
    saveOrgContact(orgId: bigint, i: OrgContactInput): Promise<Result_15>;
    savePermit(workId: bigint, x: PermitInput): Promise<Result_14>;
    saveProcedure(x: ProcedureInput): Promise<Result_13>;
    saveProgressDraft(id: bigint, rev: bigint, i: ProgressSaveInput): Promise<Result_12>;
    saveProgressRevision(workId: bigint, m: RevisionModel): Promise<Result_6>;
    saveProgressSettings(i: ProgressSettings): Promise<Result_6>;
    saveQuoteDraft(versionId: bigint, rev: bigint, header: QuoteHeaderInput | null, chapterOps: Array<QuoteChapterOp>, lineOps: Array<QuoteLineOp>, expect: QuoteExpect): Promise<Result_11>;
    saveTask(workId: bigint, i: TaskInput, expectedVersion: bigint): Promise<Result_10>;
    saveTemplate(i: TemplateInput): Promise<Result_6>;
    saveVehicle(i: VehicleInput): Promise<Result_4>;
    scanPermits(): Promise<bigint>;
    sendMailNow(): Promise<Result_9>;
    sendProgress(id: bigint, rev: bigint, expectTotalCents: bigint, reason: string): Promise<Result_8>;
    sendQuoteVersion(versionId: bigint, rev: bigint, expectTotalCents: bigint, reason: string): Promise<Result_8>;
    setBoardRules(i: BoardRulesInput): Promise<Result_6>;
    setCapacity(key: string, maxWorks: bigint | null, note: string): Promise<Result_6>;
    setContract(workId: bigint, i: ContractInput, expectedVersion: bigint): Promise<Result_4>;
    setDocKind(k: DocKindInput): Promise<Result_6>;
    setDocumentStatus(docId: bigint, status: DocStatus, note: string): Promise<Result_6>;
    setLibraryChapterArchived(id: bigint, archived: boolean): Promise<Result_6>;
    setLibraryItemArchived(id: bigint, archived: boolean, reason: string): Promise<Result_6>;
    setLibraryMargin(bp: bigint): Promise<Result_6>;
    setLibrarySell(itemId: bigint, i: LibSellInput, expectedVersion: bigint): Promise<Result_4>;
    setLibraryUnit(u: UnitView): Promise<Result_6>;
    setLinkLabel(p: Principal, tag: string): Promise<Result_6>;
    setMailTest(on: boolean, address: string): Promise<Result_7>;
    setMemberGrants(membershipId: bigint, grants: Array<Grant>): Promise<Result_6>;
    setOrgConfidential(id: bigint, contact: Contact | null, notes: string): Promise<Result_4>;
    setOrgMail(orgId: bigint, on: boolean): Promise<Result_6>;
    setOrgMailLang(orgId: bigint, lang: string): Promise<Result_6>;
    setPermitKind(k: PermitKindView): Promise<Result_6>;
    setPermitRules(r: {
        expiryDays: bigint;
        warnDays: bigint;
    }): Promise<Result_6>;
    setPostSettings(x: PostSettingsInput): Promise<Result_7>;
    setProgressReady(id: bigint): Promise<Result_6>;
    setQuoteArchived(quoteId: bigint, archived: boolean, reason: string): Promise<Result_6>;
    setQuoteDocSettings(i: QuoteDocSettingsInput): Promise<Result_6>;
    setQuoteRule(i: QuoteRuleInput): Promise<Result_6>;
    setQuoteSequence(year: bigint, last: bigint): Promise<Result_6>;
    setQuoteStdPost(i: QuoteStdPostInput): Promise<Result_6>;
    setSettings(s: SettingsView): Promise<Result_6>;
    setTaskOrder(workId: bigint, taskIds: Array<bigint>, expectedVersion: bigint): Promise<Result_4>;
    setTrade(t: TradeInput): Promise<Result_6>;
    setWadmRules(r: WadmRules): Promise<Result_6>;
    setWorkStatus(id: bigint, status: WorkStatus): Promise<Result_6>;
    startWorkFromQuote(versionId: bigint, i: WorkStartInput, expectedPlanVersion: bigint): Promise<Result_5>;
    submitProposal(ticketId: bigint, kind: string, content: string): Promise<Result_4>;
    taskHistory(workId: bigint, taskId: bigint | null, from: bigint, limit: bigint): Promise<Array<TaskChangeView>>;
    updateOrg(id: bigint, input: OrgInput): Promise<Result_3>;
    updatePerson(id: bigint, u: PersonUpdate): Promise<Result_2>;
    updateWork(id: bigint, u: WorkUpdate): Promise<Result_1>;
    wadmOverview(): Promise<WadmOverview>;
    wadmRules(): Promise<WadmRules>;
    weekBoard(q: BoardQuery): Promise<BoardView>;
    withholdingHistory(orgId: bigint): Promise<Array<WithholdingCheckView>>;
    workAdmin(workId: bigint): Promise<WorkAdminView>;
    workConflicts(workId: bigint, fromDay: bigint, weeks: bigint): Promise<ConflictList>;
    workPermits(workId: bigint): Promise<WorkPermitsView>;
    workStartPreview(versionId: bigint, i: WorkStartInput): Promise<Result>;
}
