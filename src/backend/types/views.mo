// Wat naar buiten gaat (D7): gedeelde vormen zonder `var`. Vertrouwelijke views hebben een eigen
// naam en komen alleen uit update-calls met een auditregel (R23).
import Storage "mo:caffeineai-object-storage/Storage";
import Types "../types";

module {
  type PersonId = Types.PersonId;
  type OrgId = Types.OrgId;
  type WorkId = Types.WorkId;

  public type PersonView = {
    id : PersonId;
    name : Text;
    roles : [Types.Role];
    orgId : ?OrgId;
    shortCode : ?Text;
    lang : ?Text;
    phone : ?Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
  };

  // Wat de app mag tonen. Berekend door lib/Rights.mo: de browser kijkt nooit zelf naar rollen.
  public type Caps = {
    manageAccess : Bool; // personen, interne uitnodigingen, bevestigen, afzetten, herstelcodes
    inviteExternal : Bool;
    readTeam : Bool;
    manageOrgs : Bool;
    createWork : Bool;
    readAudit : Bool;
    export : Bool;
    manageSettings : Bool;
    manageRobots : Bool;
    readConfidentialContact : Bool;
    readContracts : Bool; // contractparameters van werven (admin, calculator)
    readOa : Bool; // onderaannemers-database lezen (1.2)
    manageOa : Bool; // OA-fiches, contactpersonen en vakgebieden aan een firma beheren
    importOa : Bool; // import van onderaannemers (enkel admin, R32)
    manageCompanyCalendar : Bool; // bouwverlof en feestdagen voor alle werven (1.3)
    manageTemplates : Bool; // planningsjablonen (1.3)
    readOrgPlanning : Bool; // toewijzingen per firma over alle werven: weekbord en conflicten (1.3/1.4)
    manageAbsences : Bool; // afwezigheden van OA's ingeven (1.4: admin, werfleider)
    reportOwnAbsence : Bool; // eigen afwezigheid melden (1.4: OA, als de admin dat toelaat)
    manageBoardRules : Bool; // regels voor een dubbele boeking (1.4: admin)
    importPlan : Bool; // import van de bestaande planning en terugdraaien van een batch (1.5: enkel admin)
    writeReports : Bool; // werfverslagen schrijven (1.6: admin, werfleider)
    manageVehicles : Bool; // voertuigen beheren (1.6: admin)
    readTrips : Bool; // ritten lezen (1.6, R14: admin alle, werfleider de zijne)
    upload : Bool;
    home : Text; // startscherm (bouwplan §8.2): "overzicht" · "vandaag" · "offertes" · "week" · "werven"
  };

  public type MeView = {
    principal : Principal;
    status : { #anonymous; #unlinked; #pending; #active };
    person : ?PersonView;
    caps : ?Caps;
    isRobot : Bool;
    blockedUntil : ?Int;
    version : Text;
  };

  public type LinkView = {
    principal : Principal;
    personId : PersonId;
    personName : Text;
    status : Types.LinkStatus;
    linkedAt : Int;
    codeHint : Text;
    tag : Text;
    confirmedBy : ?PersonId;
    confirmedAt : ?Int;
    revokedBy : ?PersonId;
    revokedAt : ?Int;
  };

  public type InviteView = {
    id : Nat;
    personId : PersonId;
    personName : Text;
    kind : Types.CodeKind;
    createdBy : PersonId;
    createdAt : Int;
    expiresAt : Int;
    hint : Text;
    tag : Text;
    workIds : [WorkId];
    state : Types.CodeState;
  };

  public type NewCode = {
    inviteId : Nat;
    personId : PersonId;
    code : Text; // enkel nu getoond; de backend bewaart alleen de hash
    expiresAt : Int;
  };

  public type InviteRequest = {
    name : Text;
    roles : [Types.Role];
    orgId : ?OrgId;
    shortCode : ?Text;
    lang : ?Text;
    phone : ?Text;
    workIds : [WorkId];
    validDays : Nat;
    tag : Text;
  };

  public type PersonUpdate = {
    name : Text;
    roles : [Types.Role];
    orgId : ?OrgId;
    shortCode : ?Text;
    lang : ?Text;
    phone : ?Text;
  };

  public type OrgView = {
    id : OrgId;
    kind : Types.OrgKind;
    name : Text;
    kbo : ?Text;
    vat : ?Text;
    aliases : [Text];
    trades : [Text];
    address : ?Types.Address;
    notes : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
  };

  public type OrgInput = {
    kind : Types.OrgKind;
    name : Text;
    kbo : ?Text;
    vat : ?Text;
    aliases : [Text];
    trades : [Text];
    address : ?Types.Address;
    notes : Text;
  };

  // vertrouwelijk: alleen uit een update-call
  public type ContactConfidentialView = { contact : ?Types.Contact; notes : ?Text; version : Nat; sealed : Bool };

  // Afgeleide feiten uit het (vertrouwelijke) contract, zonder bedragen of percentages (R27).
  // null = onbekend (geen contractparameters, of versleuteld).
  public type WorkFacts = {
    contractKnown : Bool;
    inheritedFrom : ?WorkId; // contract van de hoofdwerf
    guarantee : ?Bool; // waarborg van toepassing
    priceRevision : ?Bool;
    art30bis : ?Bool; // geraamde aanneemsom ≥ drempel aangifte van werken
    checkinatwork : ?Bool;
  };

  // Wat de beller op deze werf mag (knoppen); de backend controleert elke handeling opnieuw.
  public type WorkCaps = { edit : Bool; manageMembers : Bool; setLeader : Bool; contract : Bool; upload : Bool };

  public type WorkView = {
    id : WorkId;
    code : Text;
    name : Text;
    address : Types.Address;
    parentId : ?WorkId;
    clientOrgId : ?OrgId;
    architectOrgId : ?OrgId;
    leaderPersonId : ?PersonId;
    status : Types.WorkStatus;
    vatBp : Nat;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    // 1.1
    plannedStart : ?Types.Day;
    plannedEnd : ?Types.Day;
    analyticCode : ?Text; // null = de werfcode
    vatNote : Text;
    facts : ?WorkFacts; // enkel voor interne rollen
    checklistOpen : ?Nat; // verplichte documenten die nog ontbreken (enkel interne rollen)
    caps : WorkCaps;
  };

  public type WorkUpdate = {
    code : Text;
    name : Text;
    address : Types.Address;
    parentId : ?WorkId;
    clientOrgId : ?OrgId;
    architectOrgId : ?OrgId;
    leaderPersonId : ?PersonId;
    vatBp : Nat;
    plannedStart : ?Types.Day;
    plannedEnd : ?Types.Day;
    analyticCode : ?Text;
    vatNote : Text;
  };

  // vertrouwelijk: alleen uit een update-call (readContract)
  public type ContractView = {
    workId : WorkId;
    version : Nat; // 0 = nog niets ingevuld
    contract : ?Types.ContractParams;
    clientContact : ?Types.Contact;
    notes : ?Text;
    sealed : Bool;
    inheritedFrom : ?WorkId; // overgenomen van de hoofdwerf (deelwerf zonder eigen contract)
    updatedAt : ?Int;
    updatedByName : Text;
  };

  public type ContractInput = { contract : Types.ContractParams; clientContact : ?Types.Contact; notes : Text };

  public type ContractVersionView = {
    version : Nat;
    at : Int;
    byName : Text;
    contract : ?Types.ContractParams;
    clientContact : ?Types.Contact;
    notes : ?Text;
    sealed : Bool;
  };

  // ── Documenten en checklist (§2.7, A5) ─────────────────────────────────
  public type DocKindView = {
    key : Text;
    name : Text;
    rule : Text; // zie Config.defaultDocKinds
    deliverer : Text; // "bowaco" of een rolsleutel
    oaVisible : Bool;
    confidential : Bool;
    order : Nat;
    archived : Bool;
  };

  public type DocKindInput = DocKindView;

  public type DocumentView = {
    id : Nat;
    workId : WorkId;
    kind : Text;
    kindLabel : Text;
    title : Text;
    status : Types.DocStatus; // "verlopen" berekend uit validUntil
    dueDay : ?Types.Day;
    validUntil : ?Types.Day;
    note : Text;
    ownerOrgId : ?OrgId;
    confidential : Bool;
    files : [FileView]; // vertrouwelijk: zonder verwijzing
    updatedAt : Int;
    updatedByName : Text;
    canDeliver : Bool;
  };

  public type Applies = { #yes; #no; #unknown };

  public type ChecklistLine = {
    kind : Text;
    name : Text;
    rule : Text;
    applies : Applies; // #unknown: bv. geraamde aanneemsom of veiligheidscoördinator nog niet gekend
    deliverer : Text;
    doc : ?DocumentView;
  };

  public type DossierView = {
    workId : WorkId;
    checklist : [ChecklistLine]; // verplichte (of nog onbekende) soorten, plus elke soort met een document
    documents : [DocumentView]; // alle documenten die de beller mag zien
    deliverKinds : [DocKindView]; // soorten waaraan de beller een bestand mag hangen
    canManage : Bool; // status, titel, termijn, archiveren
  };

  public type DocumentInput = {
    id : ?Nat; // null = nieuw
    kind : Text;
    title : Text;
    dueDay : ?Types.Day;
    validUntil : ?Types.Day;
    note : Text;
    ownerOrgId : ?OrgId;
  };

  public type WorkInput = {
    code : Text;
    name : Text;
    address : Types.Address;
    parentId : ?WorkId;
    clientOrgId : ?OrgId;
    architectOrgId : ?OrgId;
    leaderPersonId : ?PersonId;
    vatBp : Nat;
  };

  public type MembershipView = {
    id : Nat;
    workId : WorkId;
    personId : ?PersonId;
    orgId : ?OrgId;
    name : Text;
    archived : Bool; // de persoon is afgezet
    role : Types.Role;
    grants : [Types.Grant];
    grantedAt : Int;
    grantedBy : PersonId;
    endedAt : ?Int;
  };

  public type FileView = {
    id : Nat;
    name : Text;
    mime : Text;
    size : Nat;
    blob : ?Storage.ExternalBlob; // null bij een vertrouwelijk bestand: ophalen met readConfidentialFile
    workId : ?WorkId;
    confidential : Bool;
    personId : PersonId;
    at : Int;
  };

  public type NewTicket = { ticketId : Nat; ticket : Text; expiresAt : Int };

  public type TicketInfo = {
    ticketId : Nat;
    personId : PersonId;
    personName : Text;
    task : Text;
    workId : ?WorkId;
    budgetCents : Nat;
    expiresAt : Int;
  };

  public type ProposalView = {
    id : Nat;
    ticketId : ?Nat;
    personId : ?PersonId;
    workId : ?WorkId;
    kind : Text;
    content : Text;
    by : Principal;
    at : Int;
    decision : ?Types.Decision;
  };

  public type RobotView = {
    principal : Principal;
    name : Text;
    kinds : [Text];
    addedAt : Int;
    addedBy : PersonId;
    revokedAt : ?Int;
  };

  public type NotificationView = {
    id : Nat;
    kind : Text;
    text : Text;
    workId : ?WorkId;
    createdAt : Int;
    readAt : ?Int;
  };

  public type SettingsView = {
    werfleiderZietAlles : Bool;
    inviteDays : Nat;
    threshold30bisCents : Nat; // 1.1, VOORLOPIG
    thresholdCheckinatworkCents : Nat;
  };

  public type AccessStats = {
    persons : Nat;
    activeLinks : Nat;
    pendingLinks : Nat;
    openInvites : Nat;
    failuresThisHour : Nat;
    codesLockedUntil : ?Int;
  };


  // ── Onderaannemers-database (1.2) ───────────────────────────────────────
  public type TradeView = { key : Text; name : Text; order : Nat; archived : Bool };
  public type TradeInput = TradeView;

  public type OrgContactView = { phone : ?Text; email : ?Text; website : ?Text; contactNote : Text; updatedAt : Int };
  public type OrgContactInput = { phone : ?Text; email : ?Text; website : ?Text; contactNote : Text };

  public type OaPersonView = {
    id : PersonId;
    orgId : OrgId;
    name : Text;
    shortCode : ?Text;
    phone : ?Text;
    email : ?Text;
    jobTitle : Text;
    note : Text;
    hasLogin : Bool; // heeft een actieve of wachtende koppeling
    archivedAt : ?Int;
  };

  public type OaPersonInput = {
    id : ?PersonId; // null = nieuwe contactpersoon
    name : Text;
    shortCode : ?Text;
    phone : ?Text;
    email : ?Text;
    jobTitle : Text;
    note : Text;
  };

  public type OaView = { org : OrgView; contact : ?OrgContactView; persons : [OaPersonView] };

  public type OaFilter = { text : ?Text; trade : ?Text; kind : ?Types.OrgKind; includeArchived : Bool };

  // Import (1.2): één rij = één firma met zijn aliassen, vakgebieden, contact en contactpersonen.
  public type ImportPerson = { name : Text; shortCode : ?Text; phone : ?Text; email : ?Text; jobTitle : Text };
  public type ImportRow = {
    key : Text; // verwijzing van de beller (bv. rijnummer in het validatierapport)
    kind : Types.OrgKind;
    name : Text;
    kbo : ?Text;
    vat : ?Text;
    aliases : [Text];
    trades : [Text];
    phone : ?Text;
    email : ?Text;
    website : ?Text;
    notes : Text;
    persons : [ImportPerson];
  };
  public type ImportOutcome = { #created; #updated; #unchanged; #conflict : Text; #invalid : Text };
  public type ImportResult = { key : Text; outcome : ImportOutcome; orgId : ?OrgId; changes : [Text] };
  public type ImportReport = {
    dryRun : Bool;
    results : [ImportResult];
    created : Nat;
    updated : Nat;
    unchanged : Nat;
    conflicts : Nat;
    invalid : Nat;
  };

  // Export (§3): intern en vertrouwelijk apart; de auditlog in stukken.
  // ── Planning per werf (1.3) ─────────────────────────────────────────────
  public type Day = Types.Day;
  public type CascadeMode = { #follow; #asNeeded };
  // #move = een taak verplaatsen en/of verlengen (Gantt); #reflow = de hele werf opnieuw laten rekenen
  // (na een nieuwe kalenderblokkering): niemand begint nog vóór zijn voorgangers klaar zijn.
  public type PlanChange = { #move : { taskId : Nat; start : Day; workdays : Nat; mode : CascadeMode }; #reflow };

  public type AssignmentView = {
    id : Nat;
    taskId : Nat;
    workId : WorkId;
    orgId : OrgId;
    orgName : Text;
    orgCode : ?Text; // eerste planningcode van de firma ("KEVIN")
    personId : ?PersonId;
    personName : ?Text;
    fromDay : ?Day;
    toDay : ?Day;
    start : Day; // berekend: het bereik binnen de taak, of de hele taak
    end : Day;
    note : Text;
    primary : Bool;
    confirmation : Types.Confirmation;
    confirmedByName : ?Text;
    inTeam : Bool; // de firma is lid van de werf (anders ziet de OA de taak niet)
  };

  public type TaskView = {
    id : Nat;
    workId : WorkId;
    title : Text;
    note : Text; // leeg voor externen
    kind : Types.TaskKind;
    templateKey : ?Text;
    trade : ?Text;
    responsibleOrgId : ?OrgId; // null voor de klant (samenvatting)
    responsibleName : Text;
    status : Types.TaskStatus;
    percent : Nat;
    actualStart : ?Day; // werkelijk begonnen / klaar (1.6, uit het werfverslag)
    actualEnd : ?Day;
    start : Day;
    end : Day; // berekend in werkdagen met de kalender van de werf
    workdays : Nat;
    leadDays : Nat;
    orderDay : ?Day;
    orderBy : ?Day; // levering zonder bestelling: uiterlijk bestellen op (start − levertermijn)
    order : Nat;
    assignments : [AssignmentView];
    warnings : [Text];
    updatedAt : Int;
    updatedByName : Text;
  };

  public type DependencyView = { id : Nat; fromTaskId : Nat; toTaskId : Nat; kind : Types.DependencyKind; lagDays : Int };

  public type BlockView = {
    id : Nat;
    scope : Types.BlockScope;
    kind : Types.BlockKind;
    from : Day;
    to : Day;
    reason : Text;
    createdByName : Text;
  };

  public type PlanCaps = { edit : Bool; confirm : Bool; history : Bool };

  public type PlanView = {
    workId : WorkId;
    version : Nat;
    scope : Text; // "full" · "external" · "ownOrg" · "summary"
    tasks : [TaskView];
    dependencies : [DependencyView];
    blocks : [BlockView];
    start : ?Day;
    end : ?Day;
    caps : PlanCaps;
  };

  public type TaskInput = {
    id : ?Nat; // null = nieuwe taak
    title : Text;
    note : Text;
    kind : Types.TaskKind;
    trade : ?Text;
    responsibleOrgId : ?OrgId;
    status : Types.TaskStatus;
    percent : Nat;
    start : Day;
    workdays : Nat;
    leadDays : Nat;
    orderDay : ?Day;
    reason : Text; // waarom (komt in de wijzigingen)
  };

  public type DependencyInput = { fromTaskId : Nat; toTaskId : Nat; kind : Types.DependencyKind; lagDays : Int };

  public type AssignmentInput = {
    id : ?Nat;
    taskId : Nat;
    orgId : OrgId;
    personId : ?PersonId;
    fromDay : ?Day;
    toDay : ?Day;
    note : Text;
  };

  public type ShiftView = {
    taskId : Nat;
    title : Text;
    fromStart : Day;
    fromEnd : Day;
    toStart : Day;
    toEnd : Day;
    workdays : Nat;
    reason : Text;
  };

  public type PlanPreview = { version : Nat; changes : [ShiftView]; reopened : Nat }; // reopened = bevestigingen die terug open gaan
  public type PlanResult = { version : Nat; changes : [ShiftView]; reopened : Nat; taskId : ?Nat };

  public type BlockInput = { id : ?Nat; scope : Types.BlockScope; kind : Types.BlockKind; from : Day; to : Day; reason : Text };

  public type TemplateView = {
    key : Text;
    name : Text;
    steps : [Types.TemplateStep];
    provisional : Bool;
    stored : Bool; // false = de standaard uit de code (nog nooit aangepast)
    archived : Bool;
    updatedAt : Int;
  };

  public type TemplateInput = { key : Text; name : Text; steps : [Types.TemplateStep]; provisional : Bool; archived : Bool };

  public type TaskChangeView = {
    id : Nat;
    taskId : Nat;
    taskTitle : Text;
    at : Int;
    by : PersonId;
    byName : Text;
    field : Text;
    from : Text;
    to : Text;
    reason : Text;
  };

  // Een toewijzing met haar werf en taak: "Mijn taken" van een OA en (1.4) het weekbord per firma.
  public type OrgAssignmentView = {
    assignment : AssignmentView;
    workCode : Text;
    workName : Text;
    taskTitle : Text;
    taskKind : Types.TaskKind;
    taskStatus : Types.TaskStatus;
    canConfirm : Bool;
  };


  // ── Weekbord per OA (1.4) ───────────────────────────────────────────────
  // Rijen = firma's, kolommen = weken (maandag), cel = de werven met de taken van die week. Alles berekend
  // uit plan.assignments met de kalender van elke werf; begrensd per weekvenster en per pagina firma's.
  public type BoardQuery = {
    from : Day; // eerste week (wordt de maandag van die week)
    weeks : Nat; // 1 tot Config.boardMaxWeeks
    offset : Nat; // paginering over de firma's
    limit : Nat; // hoogstens Config.boardMaxRows
    text : Text; // zoeken op naam of planningcode ("" = alles)
    trade : ?Text; // enkel firma's met dit vakgebied
    workId : ?WorkId; // enkel firma's die in het venster op deze werf staan
    onlyConflicts : Bool;
    withIdle : Bool; // ook onderaannemers zonder werk of afwezigheid in het venster
  };

  public type BoardTask = {
    taskId : Nat;
    assignmentId : Nat;
    title : Text; // leeg als de werf verborgen is
    kind : Types.TaskKind;
    status : Types.TaskStatus;
    days : [Day]; // werkdagen van deze toewijzing in deze week (volgens de kalender van de werf)
    start : Day; // de hele toewijzing (kan buiten de week lopen)
    end : Day;
    personName : ?Text;
    note : Text;
    confirmation : Types.Confirmation;
  };

  // Eén werf in één cel. hidden = de kijker ziet deze werf niet (werfleider zonder "ziet alles"): enkel
  // "andere werf" en de dagen, zodat hij wel weet dat de firma bezet is.
  public type BoardItem = {
    workId : ?WorkId; // null als verborgen
    workCode : Text;
    workName : Text;
    hidden : Bool;
    tasks : [BoardTask];
    clash : Bool; // deze werf zit in een dubbele boeking van die week
  };

  public type BoardCell = { week : Nat; items : [BoardItem] }; // week = index in het venster (0 = eerste)

  public type AbsenceView = {
    id : Nat;
    orgId : OrgId;
    orgName : Text;
    personId : ?PersonId;
    personName : ?Text;
    kind : Types.AbsenceKind;
    from : Day;
    to : Day;
    note : Text;
    source : Types.AbsenceSource;
    createdAt : Int;
    createdByName : Text;
    updatedAt : Int;
    updatedByName : Text;
    mine : Bool; // gemeld door de eigen firma (de OA mag ze wijzigen)
  };

  public type ConflictView = {
    kind : Text; // "dubbel" · "afwezig" · "blokkering"
    orgId : OrgId;
    orgName : Text;
    orgCode : ?Text;
    week : Day; // maandag van de week
    days : [Day];
    works : [(?WorkId, Text)]; // (werf, code); null = een werf die de kijker niet ziet ("andere werf")
    taskIds : [Nat];
    text : Text; // in gewone woorden, voor "Vraagt aandacht"
  };

  public type BoardRow = {
    orgId : OrgId;
    name : Text;
    code : ?Text;
    kind : Types.OrgKind;
    trades : [Text];
    maxWorks : Nat; // 0 = onbeperkt
    maxFrom : Text; // "firma" · "vakgebied" · "algemeen"
    cells : [BoardCell]; // enkel weken met werk
    absences : [AbsenceView];
    conflicts : [ConflictView];
  };

  public type BoardWeek = { monday : Day; blocks : [BlockView] }; // blokken van het bedrijf in die week

  public type BoardCaps = { manageAbsences : Bool; manageRules : Bool };

  public type BoardView = {
    from : Day;
    weeks : [BoardWeek];
    rows : [BoardRow];
    total : Nat; // aantal firma's dat aan de filter voldoet (voor de paginering)
    offset : Nat;
    conflictTotal : Nat; // over alle firma's van de filter, niet enkel deze pagina
    unit : Text; // "dag" · "week": wanneer twee werven "dubbel" zijn
    caps : BoardCaps;
    instructions : Nat; // meetwaarde (stresstest, Q-09): rekenwerk van deze oproep
  };

  // "Mijn week" van een OA: enkel de eigen firma, enkel werven waar hij lid is.
  public type MyBoardView = {
    from : Day;
    weeks : [BoardWeek];
    row : ?BoardRow;
    canReport : Bool;
  };

  public type ConflictList = { total : Nat; items : [ConflictView] };

  public type AbsenceInput = {
    id : ?Nat;
    orgId : OrgId;
    personId : ?PersonId;
    kind : Types.AbsenceKind;
    from : Day;
    to : Day;
    note : Text;
  };

  public type AbsenceChangeView = { id : Nat; absenceId : Nat; at : Int; byName : Text; what : Text; detail : Text };

  public type CapacityView = { key : Text; title : Text; maxWorks : Nat; note : Text; updatedAt : Int; updatedByName : Text };

  public type BoardRulesView = {
    unit : Text; // "dag" (standaard) · "week"
    defaultMax : Nat; // algemene regel: werven tegelijk per firma (0 = onbeperkt)
    oaReportsAbsence : Bool; // mag een OA zijn eigen afwezigheid melden?
    rules : [CapacityView]; // eigen regels per vakgebied en per firma
  };

  public type BoardRulesInput = { unit : Text; defaultMax : Nat; oaReportsAbsence : Bool };

  public type ExportIntern = {
    version : Text;
    schema : Nat;
    at : Int;
    persons : [PersonView];
    links : [LinkView];
    linkHistory : [Types.LinkHistory];
    invites : [InviteView]; // zonder hash
    orgs : [OrgView];
    works : [WorkView];
    memberships : [MembershipView];
    files : [FileView]; // vertrouwelijke zonder verwijzing
    workInfo : [Types.WorkInfo]; // 1.1
    documents : [Types.Document]; // 1.1 (vertrouwelijke documenten: enkel de metadata, bestanden zonder verwijzing)
    orgContacts : [Types.OrgContact]; // 1.2
    personContacts : [Types.PersonContact]; // 1.2
    trades : [TradeView]; // 1.2
    tasks : [Types.Task]; // 1.3
    assignments : [Types.Assignment];
    dependencies : [Types.Dependency];
    calendarBlocks : [Types.CalendarBlock];
    taskChanges : [Types.TaskChange];
    templates : [Types.Template]; // enkel de bewaarde (de standaard staat in de code)
    absences : [Types.Absence]; // 1.4
    absenceChanges : [Types.AbsenceChange];
    capacity : [Types.CapacityRule];
    importBatches : [Types.ImportBatch]; // 1.5
    importKeys : [Types.ImportKey];
    appointments : [Types.Appointment];
    vehicles : [VehicleView]; // 1.6
    dayReports : [Types.DayReport];
    reportChanges : [Types.ReportChange];
    attendances : [Types.Attendance];
    hoursConfirmations : [Types.HoursConfirmation];
    workDone : [Types.WorkDone];
    materials : [Types.MaterialNote];
    photos : [Types.Photo];
    issues : [Types.Issue];
    trips : [Types.Trip];
    robots : [RobotView];
    proposals : [ProposalView];
    settings : SettingsView;
    auditCount : Nat;
  };

  public type ExportConfidential = {
    at : Int;
    orgs : [(OrgId, ContactConfidentialView)];
    persons : [(PersonId, ContactConfidentialView)];
    files : [FileView];
    workConfidential : [Types.WorkConfidential]; // 1.1
    workConfidentialHistory : [Types.WorkConfidentialVersion];
  };

  // ── Import van de bestaande planning (1.5) ──────────────────────────────
  // Het script (tools/plan-import.mjs) leest de Excel en stuurt per blok een ImportBlock; de backend
  // koppelt de namen aan de OA-database (aliassen uit 1.2), controleert alles en schrijft in één oproep.
  public type ImportRun = { key : Text; name : Text; from : Day; to : Day; note : Text }; // één firma, aaneengesloten weken
  public type ImportAppt = { key : Text; day : Day; time : ?Text; text : Text; name : ?Text; weekFallback : Bool };
  public type ImportTask = {
    key : Text;
    title : Text;
    note : Text;
    responsible : ?Text; // kolom C zoals in de planning
    status : Types.TaskStatus;
    percent : Nat;
    start : Day;
    workdays : Nat;
    order : Nat;
    runs : [ImportRun];
    appointments : [ImportAppt];
    extra : [(Text, Text)];
  };
  public type ImportDecision = { #fresh; #followUp : Text; #sub : Text }; // nieuwe werf · vervolg van · deelwerf van (blokcode of werfcode)
  public type ImportBlock = {
    key : Text;
    name : Text;
    street : Text;
    number : Text;
    zip : Text;
    city : Text;
    vatBp : Nat;
    decision : ImportDecision;
    tasks : [ImportTask];
  };
  public type PlanImportReport = {
    dryRun : Bool;
    workId : ?Nat;
    workCode : Text;
    workCreated : Nat;
    workExisting : Nat;
    tasksCreated : Nat;
    tasksExisting : Nat;
    assignmentsCreated : Nat;
    assignmentsExisting : Nat;
    appointmentsCreated : Nat;
    appointmentsExisting : Nat;
    unmatched : [(Text, Nat)]; // namen zonder firma in de OA-database: nooit een nieuwe firma
    problems : [Text];
  };
  public type RollbackReport = { dryRun : Bool; works : Nat; tasks : Nat; assignments : Nat; appointments : Nat; keptWorks : [Text] };

  // ── Werfverslag (1.6) ───────────────────────────────────────────────────
  // De gsm stuurt kleine opdrachten met een opId (UUID) en de clientKey van het verslag (§8.2). Dezelfde
  // opId nog eens geeft hetzelfde resultaat (repeated = true), nooit een dubbel blok.
  public type FileIn = { blob : Storage.ExternalBlob; name : Text; mime : Text; size : Nat };
  public type ReportOp = {
    #ensure : { workId : WorkId; day : Day };
    #text : { field : Text; value : Text }; // "summary" of "weather": laatste schrijver wint
    #attendance : { orgId : ?OrgId; personId : ?PersonId; names : Text; headcount : Nat; slots : [Types.TimeSlot]; regie : Bool; taskId : ?Nat; note : Text; replaces : ?Text };
    #workDone : { taskId : ?Nat; text : Text; percent : ?Nat };
    #material : { kind : Types.MaterialKind; text : Text; quantity : Text; supplier : Text; file : ?FileIn };
    #photo : { file : FileIn; thumb : ?FileIn; taskId : ?Nat; caption : Text; takenAt : ?Int };
    #issue : { kind : Types.IssueKind; text : Text; taskIds : [Nat]; delayDays : ?Nat };
    #trip : { vehicleId : ?Nat; plate : Text; driverOutPersonId : ?PersonId; driverBackPersonId : ?PersonId; driverOutText : Text; driverBackText : Text; note : Text };
    #remove : { blockKey : Text }; // het blok dat met die opId gemaakt werd, archiveren (enkel in een open verslag)
    #finalize;
  };
  public type ReportOpInput = { opId : Text; clientKey : Text; op : ReportOp };
  // note: "nieuw" · "samengevoegd" (tweede toestel) · "correctie" (verslag was al afgesloten) · "al afgesloten"
  public type OpOutcome = { #done : { reportId : Nat; entityId : ?Nat; note : Text }; #err : Text };
  public type OpResult = { opId : Text; outcome : OpOutcome; repeated : Bool };

  public type ConfirmationView = { id : Nat; byName : Text; at : Int; ok : Bool; remark : Text };
  public type AttendanceView = {
    id : Nat;
    orgId : ?OrgId;
    orgName : Text; // "BOWACO" als orgId null is
    orgCode : Text;
    personId : ?PersonId;
    names : Text;
    headcount : Nat;
    slots : [Types.TimeSlot];
    minutesTotal : Nat;
    regie : Bool;
    taskId : ?Nat;
    note : Text;
    blockKey : Text;
    createdAt : Int;
    createdByName : Text;
    confirmations : [ConfirmationView];
  };
  public type WorkDoneView = { id : Nat; taskId : ?Nat; taskTitle : Text; text : Text; percent : ?Nat; blockKey : Text; createdAt : Int; createdByName : Text };
  public type MaterialView = { id : Nat; kind : Types.MaterialKind; text : Text; quantity : Text; supplier : Text; file : ?FileView; hasFile : Bool; blockKey : Text; createdAt : Int; createdByName : Text };
  public type PhotoView = { id : Nat; file : FileView; thumb : ?FileView; taskId : ?Nat; caption : Text; takenAt : ?Int; blockKey : Text; createdAt : Int; createdByName : Text };
  public type IssueView = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    workCode : Text;
    workName : Text;
    day : Day;
    kind : Types.IssueKind;
    text : Text;
    taskIds : [Nat];
    taskTitles : [Text];
    delayDays : ?Nat;
    status : Types.IssueStatus;
    handledByName : Text;
    blockKey : Text;
    createdAt : Int;
    createdByName : Text;
  };
  public type TripView = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    workCode : Text;
    day : Day;
    vehicleId : ?Nat;
    plate : Text;
    vehicleName : Text;
    driverOutPersonId : ?PersonId;
    driverOutName : Text;
    driverBackPersonId : ?PersonId;
    driverBackName : Text;
    note : Text;
    blockKey : Text;
    createdAt : Int;
    createdByName : Text;
  };
  public type ReportChangeView = { at : Int; byName : Text; field : Text; from : Text; to : Text };
  public type ReportView = {
    id : Nat;
    workId : WorkId;
    workCode : Text;
    workName : Text;
    day : Day;
    status : Types.ReportStatus;
    corrects : ?Nat;
    authorName : Text;
    summary : Text;
    weather : Text;
    createdAt : Int;
    updatedAt : Int;
    scope : Text; // "full" · "reader" · "summary" · "ownHours"
    attendances : [AttendanceView];
    workDone : [WorkDoneView];
    materials : [MaterialView];
    photos : [PhotoView];
    issues : [IssueView];
    trips : [TripView];
    changes : [ReportChangeView];
    totalMinutes : Nat;
    regieMinutes : Nat;
    canWrite : Bool;
    canFinalize : Bool;
  };
  public type ReportSummary = {
    id : Nat;
    workId : WorkId;
    day : Day;
    status : Types.ReportStatus;
    corrects : ?Nat;
    authorName : Text;
    attendances : Nat;
    headcount : Nat;
    totalMinutes : Nat;
    regieMinutes : Nat;
    photos : Nat;
    openIssues : Nat;
    workDone : [Text]; // de eerste drie teksten
  };

  // "Vandaag" van de werfleider (bouwplan §8.2/§8.3): de werven van de dag met taken, wie er volgens de planning
  // komt en de stand van het verslag. Ook offline te tonen (de gsm bewaart de laatste stand).
  public type DayTask = { id : Nat; title : Text; status : Types.TaskStatus; percent : Nat; kind : Types.TaskKind; start : Day; end : Day; orgCodes : [Text] };
  public type PlannedOrg = { orgId : OrgId; name : Text; code : Text; taskIds : [Nat] };
  public type DayWork = {
    id : WorkId;
    code : Text;
    name : Text;
    address : Types.Address;
    status : Types.WorkStatus;
    leaderName : Text;
    mine : Bool; // ik ben de werfleider (fiche of lidmaatschap)
    tasks : [DayTask];
    planned : [PlannedOrg];
    reports : [ReportSummary];
    openIssues : Nat;
    appointments : [(Text, Text)]; // (uur, tekst) van de dag
  };
  public type VehicleView = { id : Nat; plate : Text; name : Text; archived : Bool };
  public type PersonRef = { id : PersonId; name : Text };
  public type MyDayView = {
    day : Day;
    works : [DayWork];
    vehicles : [VehicleView];
    drivers : [PersonRef]; // interne personen (chauffeurs)
    orgs : [PlannedOrg]; // firma's om toe te voegen bij "Wie was er nog?" (OA's van de dag eerst)
    writer : Bool;
  };
  public type VehicleInput = { id : ?Nat; plate : Text; name : Text; archived : Bool };
};
