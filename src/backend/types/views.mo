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
    permits : Bool; // 1b.1: vergunningen over alle werven (admin, werfleider)
    readMunicipalities : Bool; // 1b.1: kennisbank per gemeente lezen (interne rollen)
    manageMunicipalities : Bool; // 1b.1: kennisbank aanvullen (admin, werfleider)
    managePermitKinds : Bool; // 1b.1: vergunningssoorten (admin)
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
    extra : Types.Extra; // 1.9 (export/herstel): o.a. de importbatch
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
    endedBy : ?PersonId; // 1.9 (export/herstel)
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
    archivedAt : ?Int; // 1.9 (export/herstel): lijsten tonen enkel niet-gearchiveerde
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
    attemptsTracked : Nat; // 1.9: principals met een pogingenteller (de timer ruimt op, T11)
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
    // 1.9 (hersteltest M9): wat een herstel nog nodig heeft naast de lijsten hierboven.
    notifications : [NotificationExport];
    lookups : [LookupView]; // documentsoorten en vakgebieden zoals bewaard (leeg = de standaard uit de code)
    values : [(Text, Text)]; // kleine vlaggen: weekbordregels, drempels
    sequences : [(Text, Nat)];
    counters : [(Text, Nat)]; // laatst uitgegeven id per collectie (D3)
    planVersions : [(WorkId, Nat)];
    reportKeys : [(Text, Nat)]; // sleutel van een toestel → verslag
    ops : [Types.OpRecord]; // uitgevoerde offline-opdrachten (hoogstens 60 dagen)
    // 1b.1: vergunningen, hun wijzigingen, de kennisbank en de meldingen die al verstuurd zijn
    permits : [Types.Permit];
    permitChanges : [Types.PermitChange];
    municipalities : [Types.Municipality];
    procedures : [Types.PermitProcedure];
    permitAlerts : [(Text, Int)];
    jobs : [Types.Job]; // 1b.3: de werkwachtrij van de postbode
  };

  // 1.9: keuzelijst in ruwe vorm (export en herstel).
  public type LookupView = { list : Text; key : Text; tag : Text; order : Nat; archivedAt : ?Int; extra : Types.Extra };
  public type NotificationExport = { id : Nat; personId : PersonId; kind : Text; text : Text; workId : ?WorkId; createdAt : Int; readAt : ?Int };

  // 1.9: herstel uit een export (M9, T16), per collectie in stukken; zie mixins/RestoreApi.mo.
  public type RestorePart = {
    #persons : [PersonView];
    #links : [LinkView];
    #linkHistory : [Types.LinkHistory];
    #invites : [InviteView];
    #orgs : [OrgView];
    #orgConfidential : [(OrgId, ContactConfidentialView)];
    #personConfidential : [(PersonId, ContactConfidentialView)];
    #works : [WorkView];
    #workInfo : [Types.WorkInfo];
    #workConfidential : [Types.WorkConfidential];
    #workConfidentialHistory : [Types.WorkConfidentialVersion];
    #memberships : [MembershipView];
    #files : [FileView];
    #documents : [Types.Document];
    #orgContacts : [Types.OrgContact];
    #personContacts : [Types.PersonContact];
    #lookups : [LookupView];
    #values : [(Text, Text)];
    #sequences : [(Text, Nat)];
    #settings : SettingsView;
    #tasks : [Types.Task];
    #assignments : [Types.Assignment];
    #dependencies : [Types.Dependency];
    #calendarBlocks : [Types.CalendarBlock];
    #taskChanges : [Types.TaskChange];
    #templates : [Types.Template];
    #planVersions : [(WorkId, Nat)];
    #absences : [Types.Absence];
    #absenceChanges : [Types.AbsenceChange];
    #capacity : [Types.CapacityRule];
    #importBatches : [Types.ImportBatch];
    #importKeys : [Types.ImportKey];
    #appointments : [Types.Appointment];
    #vehicles : [VehicleView];
    #dayReports : [Types.DayReport];
    #reportKeys : [(Text, Nat)];
    #reportChanges : [Types.ReportChange];
    #attendances : [Types.Attendance];
    #hoursConfirmations : [Types.HoursConfirmation];
    #workDone : [Types.WorkDone];
    #materials : [Types.MaterialNote];
    #photos : [Types.Photo];
    #issues : [Types.Issue];
    #trips : [Types.Trip];
    #ops : [Types.OpRecord];
    #robots : [RobotView];
    #proposals : [ProposalView];
    #notifications : [NotificationExport];
    #audit : [Types.AuditEntry];
    #counters : [(Text, Nat)];
    #permits : [Types.Permit]; // 1b.1
    #permitChanges : [Types.PermitChange];
    #municipalities : [Types.Municipality];
    #procedures : [Types.PermitProcedure];
    #permitAlerts : [(Text, Int)];
    #jobs : [Types.Job]; // 1b.3
  };
  public type RestoreSummary = { persons : Nat; works : Nat; tasks : Nat; reports : Nat; files : Nat; audit : Nat; counters : [(Text, Nat)] };

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
    // 1b.2: outMin/backMin = uur van vertrek heen en terug (minuten sinds middernacht), optioneel: helpt de boete-opzoeking
    #trip : { vehicleId : ?Nat; plate : Text; driverOutPersonId : ?PersonId; driverBackPersonId : ?PersonId; driverOutText : Text; driverBackText : Text; note : Text; outMin : ?Nat; backMin : ?Nat };
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
    outTime : ?Text; // 1b.2: "07:15" (vertrek heen), uit `extra`
    backTime : ?Text;
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

  // ── Externe weergaven (1.7) ─────────────────────────────────────────────
  // Mijn uren (OA): de aanwezigheidsregels van de eigen firma uit de werfverslagen, met de bevestigingen.
  public type HoursLine = {
    attendanceId : Nat;
    reportId : Nat;
    workId : WorkId;
    workCode : Text;
    workName : Text;
    day : Day;
    names : Text;
    headcount : Nat;
    slots : [Types.TimeSlot];
    minutesTotal : Nat;
    regie : Bool;
    reportFinal : Bool; // enkel een afgesloten verslag kan bevestigd worden
    confirmations : [ConfirmationView];
    canConfirm : Bool;
  };
  // Mijn werven (externen): waar ik lid ben, met de werfleider om te bellen.
  public type ExternalWork = {
    id : WorkId;
    code : Text;
    name : Text;
    address : Types.Address;
    status : Types.WorkStatus;
    roles : [Types.Role];
    grants : [Types.Grant];
    leaderName : Text;
    leaderPhone : ?Text;
  };
  public type ExistingInvite = { personId : PersonId; workIds : [WorkId]; validDays : Nat; tag : Text };

  // ── Dashboard (1.8, bouwplan §8.2 en §8.4) ──────────────────────────────
  // Eén berekende stand voor kantoor: tellers, de werven als kaarten, achterstanden, deze week, openstaande
  // bevestigingen en ontbrekende werfverslagen. Niets bewaard: alles uit planning, verslagen en lidmaatschappen.
  public type DashTask = {
    taskId : Nat;
    workId : WorkId;
    workCode : Text;
    title : Text;
    status : Types.TaskStatus;
    percent : Nat;
    start : Day;
    end : Day;
    orgNames : [Text];
    lateDays : Nat; // werkdagen voorbij het geplande einde (achterstand)
  };
  public type DashConfirm = {
    assignmentId : Nat;
    taskId : Nat;
    workId : WorkId;
    workCode : Text;
    taskTitle : Text;
    orgName : Text;
    start : Day;
    end : Day;
    declined : Bool;
    reason : Text;
  };
  public type DashWork = {
    id : WorkId;
    code : Text;
    name : Text;
    city : Text;
    status : Types.WorkStatus;
    leaderId : ?PersonId;
    leaderName : Text;
    parentId : ?WorkId;
    start : ?Day; // eerste taak
    end : ?Day; // laatste taak
    percent : Nat; // gemiddelde voortgang van de gewone taken (gewogen naar werkdagen)
    tasksTotal : Nat;
    tasksLate : Nat;
    tasksDelayed : Nat;
    tasksThisWeek : Nat;
    confirmOpen : Nat;
    confirmDeclined : Nat;
    openIssues : Nat;
    nextMilestone : ?(Text, Day);
    lastReport : ?Day;
    missingReport : ?Day; // werkdag met werk in de planning maar zonder verslag
    warnings : [Text];
    delayed : Bool; // achterstand, vertraagde taak of open vertraging
  };
  public type DashCounters = {
    running : Nat;
    delayed : Nat;
    confirmOpen : Nat;
    confirmDeclined : Nat;
    openIssues : Nat;
    missingReports : Nat;
    permitsThisMonth : ?Nat; // 1b.1: vergunningen die aandacht vragen (deadline, verloopt, planning schoof); null = geen recht
  };
  public type DashboardView = {
    day : Day;
    monday : Day;
    counters : DashCounters;
    works : [DashWork];
    late : [DashTask];
    thisWeek : [DashTask];
    confirmations : [DashConfirm];
    leaders : [PersonRef];
    instructions : Nat;
  };

  // ── Vergunningen (1b.1) ─────────────────────────────────────────────────
  // Een soort (D9: keuzelijst, de admin past ze aan). words = woorden in een taak die de vergunning vragen
  // ("container", "kraan"); leadDays = doorlooptijd als de kennisbank niets weet; publicDomain = op de openbare weg.
  public type PermitKindView = { key : Text; name : Text; leadDays : Nat; words : [Text]; publicDomain : Bool; order : Nat; archived : Bool };

  // Waarom een vergunning aandacht vraagt (berekend, niets bewaard).
  public type PermitWarning = {
    #deadlineSoon : Int; // dagen tot de uiterste aanvraagdag
    #deadlinePassed : Int; // dagen te laat
    #noDates; // geen taken en geen periode: geen deadline te berekenen
    #refused;
    #noDocument; // toegekend maar de vergunning zelf staat er niet in (bewijs bij controle)
    #expiresSoon : Int; // dagen tot het einde, terwijl ze daarna nog nodig is
    #expired; // geldigheid voorbij terwijl ze nog nodig is
    #outsidePlan : { neededFrom : Day; neededTo : Day }; // de planning schoof buiten de geldige periode
  };

  public type PermitView = {
    id : Nat;
    workId : WorkId;
    workCode : Text;
    workName : Text;
    kind : Text;
    kindName : Text;
    title : Text;
    municipalityId : ?Nat;
    municipalityName : Text;
    status : Types.PermitStatus; // #expired = berekend (geldig tot < vandaag)
    location : Text;
    taskIds : [Nat];
    taskTitles : [Text];
    neededFrom : ?Day; // berekend uit de taken (start van de eerste, einde van de laatste) of met de hand
    neededTo : ?Day;
    manualFrom : ?Day;
    manualTo : ?Day;
    leadDays : Nat;
    deadline : ?Day; // uiterste aanvraagdag = neededFrom − doorlooptijd
    requestedOn : ?Day;
    validFrom : ?Day;
    validTo : ?Day;
    reference : Text;
    costCents : ?Int; // enkel interne rollen
    note : Text; // enkel interne rollen
    files : [FileView];
    warnings : [PermitWarning];
    updatedAt : Int;
    updatedByName : Text;
    canEdit : Bool;
  };

  public type PermitInput = {
    id : ?Nat;
    kind : Text;
    title : Text;
    municipalityId : ?Nat;
    status : Types.PermitStatus;
    location : Text;
    taskIds : [Nat];
    neededFrom : ?Day;
    neededTo : ?Day;
    leadDays : ?Nat; // null = uit de kennisbank of de soort
    requestedOn : ?Day;
    validFrom : ?Day;
    validTo : ?Day;
    reference : Text;
    costCents : ?Int;
    note : Text;
  };

  // "Uit de planning": een taak waarvan de titel een woord van een soort bevat, zonder vergunning van die soort.
  public type PermitSuggestion = { taskId : Nat; taskTitle : Text; start : Day; end : Day; kind : Text; kindName : Text; leadDays : Nat; deadline : Day };

  public type PermitProcedureView = {
    municipalityId : Nat;
    kind : Text;
    kindName : Text;
    how : Text;
    portal : ?Text;
    email : ?Text;
    leadDays : Nat;
    cost : Text;
    attachments : [Text];
    contact : Text;
    notes : Text;
    updatedAt : Int;
    updatedByName : Text;
  };

  public type MunicipalityView = {
    id : Nat;
    name : Text;
    zips : [Text];
    portal : ?Text;
    email : ?Text;
    phone : ?Text;
    contact : Text;
    notes : Text;
    procedures : [PermitProcedureView];
    permitCount : Nat; // vergunningen in de app voor deze gemeente
    updatedAt : Int;
    updatedByName : Text;
    archived : Bool;
  };

  public type MunicipalityInput = { id : ?Nat; name : Text; zips : [Text]; portal : ?Text; email : ?Text; phone : ?Text; contact : Text; notes : Text; archived : Bool };
  public type ProcedureInput = { municipalityId : Nat; kind : Text; how : Text; portal : ?Text; email : ?Text; leadDays : Nat; cost : Text; attachments : [Text]; contact : Text; notes : Text; archived : Bool };

  // De vergunningen van één werf: met de suggesties uit de planning en de gemeente die bij het werfadres past.
  public type WorkPermitsView = {
    workId : WorkId;
    permits : [PermitView];
    suggestions : [PermitSuggestion];
    municipality : ?MunicipalityView;
    kinds : [PermitKindView];
    canEdit : Bool;
  };

  public type PermitChangeView = { at : Int; byName : Text; field : Text; from : Text; to : Text };

  // ── Boete-opzoeking (1b.2) ──────────────────────────────────────────────
  // dag (+ uur) + nummerplaat en/of plaats → ritten uit het werfverslag. widen = ook de dag ervoor en erna.
  public type FineQuery = { day : Day; time : ?Nat; plate : Text; place : Text; widen : Bool };
  public type FinePermit = { id : Nat; kindName : Text; location : Text; reference : Text; validFrom : ?Day; validTo : ?Day };
  public type FineMatch = {
    tripId : Nat;
    reportId : Nat;
    day : Day;
    workId : WorkId;
    workCode : Text;
    workName : Text;
    address : Types.Address;
    plate : Text;
    vehicleName : Text;
    driverOut : Text;
    driverBack : Text;
    outTime : ?Text;
    backTime : ?Text;
    crew : [Text]; // ploeg van BOWACO op die werf die dag: "Jan 07:30–12:00, 12:30–16:00"
    permits : [FinePermit]; // vergunningen die die dag op die werf golden
    plateMatch : Bool;
    placeMatch : Bool;
    sameDay : Bool;
    guess : Text; // wie reed er waarschijnlijk op dat uur, met de reden
    score : Nat;
  };
  public type FineResult = { matches : [FineMatch]; vehicleKnown : Bool; ownTripsOnly : Bool };

  // ── Postbode (1b.3) ──────────────────────────────────────────────────────
  public type MailTo = { name : Text; email : Text };
  public type MailSection = { title : Text; subtitle : Text; lines : [Text] };
  // Een mail zoals de app ze samenstelt; de gateway zet ze enkel in een HTML-sjabloon (alles ontsnapt).
  public type MailOut = { to : [MailTo]; subject : Text; preheader : Text; heading : Text; intro : Text; sections : [MailSection]; outro : Text; link : ?Text; tag : Text };
  // Wat de robot krijgt bij een lease: de opdracht en ENKEL de mail die erbij hoort (R28).
  public type JobLease = { id : Nat; kind : Text; key : Text; attempt : Nat; leaseUntil : Int; mail : MailOut };
  public type JobView = { id : Nat; kind : Text; key : Text; orgId : ?OrgId; orgName : Text; ref : Text; state : Types.JobState; attempts : Nat; notBefore : Int; createdAt : Int; createdByName : Text; updatedAt : Int };
  public type RobotSeen = { name : Text; kinds : [Text]; lastSeen : ?Int };
  public type PostSettingsView = {
    weekmail : Bool;
    reminders : Bool;
    day : Nat; // 0 = maandag … 6 = zondag
    hour : Nat;
    reminderDay : Nat;
    appUrl : Text;
    optedOut : [OrgId];
    robots : [RobotSeen];
    queued : Nat;
    leased : Nat;
    failed : Nat;
    lastWeek : Nat; // maandag (dagnummer) van de laatst klaargezette weekmails; 0 = nog nooit
  };
  public type PostSettingsInput = { weekmail : Bool; reminders : Bool; day : Nat; hour : Nat; reminderDay : Nat; appUrl : Text };
};
