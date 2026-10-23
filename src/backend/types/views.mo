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
};
