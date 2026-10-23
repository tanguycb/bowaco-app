// Eerste stabiele toestand van de nieuwe keten (stap 0.6, architectuur §2.11 en §7.2 advies B).
// Zelfstandig (M4): alle types staan hier letterlijk, alleen mo:core-imports. NOOIT meer wijzigen
// zodra deze migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import List "mo:core/List";
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Extra = [(Text, Text)];

  // ── Vertrouwelijk (D6): #plain nu, #sealed in fase 2 zonder schemawijziging ──
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };

  type Address = { street : Text; number : Text; zip : Text; city : Text; country : Text };
  type Contact = { name : Text; phone : ?Text; email : ?Text; address : ?Address };

  // ── Personen en toegang (§2.3) ──────────────────────────────────────────
  // Interne rollen (admin, werfleider, calculator) gelden voor alle werven; externe rollen
  // alleen via een Membership per werf. Welke rol wat mag, staat ALLEEN in lib/Rights.mo.
  type Role = {
    #admin;
    #werfleider;
    #calculator;
    #architect;
    #onderaannemer;
    #klant;
    #veiligheidscoordinator;
  };

  // klasse: intern
  type Person = {
    id : PersonId;
    name : Text;
    roles : [Role];
    orgId : ?OrgId; // null = BOWACO zelf
    shortCode : ?Text; // planningcode ("KEVIN")
    lang : ?Text; // "nl" standaard
    phone : ?Text; // communicatiekanaal, nooit een login
    createdAt : Int;
    createdBy : PersonId; // 0 = opstartcode
    var archivedAt : ?Int; // afzetten = archiveren, nooit wissen
    extra : Extra;
  };

  type LinkStatus = { #active; #pending; #revoked };

  // klasse: technisch. Principal → persoon; een persoon kan meerdere principals hebben.
  type Link = {
    personId : PersonId;
    var status : LinkStatus;
    linkedAt : Int;
    codeHint : Text; // laatste 2 tekens van de gebruikte code
    inviteId : Nat; // 0 = opstartcode
    var tag : Text; // "iPhone Alexis"
    var confirmedBy : ?PersonId;
    var confirmedAt : ?Int;
    var revokedBy : ?PersonId;
    var revokedAt : ?Int;
  };

  // Een ingetrokken koppeling die plaats maakt voor een nieuwe koppeling van dezelfde principal.
  type LinkHistory = {
    id : Nat;
    principal : Principal;
    personId : PersonId;
    linkedAt : Int;
    codeHint : Text;
    tag : Text;
    revokedAt : ?Int;
    revokedBy : ?PersonId;
    movedAt : Int;
  };

  type CodeKind = { #invite; #recovery };
  type CodeState = {
    #open;
    #used : { by : Principal; at : Int };
    #revoked : { by : PersonId; at : Int };
    #expired : { at : Int };
  };

  // klasse: geheim, gehasht. Alleen de hash, nooit de code.
  type Invite = {
    id : Nat;
    hash : Blob;
    personId : PersonId;
    kind : CodeKind;
    createdBy : PersonId;
    createdAt : Int;
    expiresAt : Int;
    hint : Text;
    tag : Text;
    workIds : [WorkId]; // externe uitnodiging: meteen lid van deze werven
    var state : CodeState;
  };

  // klasse: technisch (pogingenteller; mag overschreven worden, D2-uitzondering)
  type Attempts = { var windowStart : Int; var count : Nat; var blockedUntil : Int };

  // Globale remming op foute codes over alle principals (0.2 open punt 4).
  type Throttle = {
    var windowStart : Int;
    var failures : Nat;
    var alertedWindow : Int; // venster waarvoor de admin al een melding kreeg
    var lockedUntil : Int; // > nu: alle codepogingen tijdelijk dicht
  };

  // klasse: vertrouwelijk (alleen voor klant-personen)
  type PersonConfidential = { personId : PersonId; var contact : Confidential<Contact>; var version : Nat };

  type AccessState = {
    persons : Map.Map<PersonId, Person>;
    links : Map.Map<Principal, Link>;
    linkHistory : Map.Map<Nat, LinkHistory>;
    invites : Map.Map<Nat, Invite>;
    codeIndex : Map.Map<Blob, Nat>;
    attempts : Map.Map<Principal, Attempts>;
    throttle : Throttle;
    personConfidential : Map.Map<PersonId, PersonConfidential>;
    var bootstrapUsed : Bool;
  };

  // ── Organisaties (§2.3) ─────────────────────────────────────────────────
  type OrgKind = { #bowaco; #subcontractor; #architect; #client; #supplier; #authority; #other };

  // klasse: intern (adres van een klant hoort in OrgConfidential)
  type Org = {
    id : OrgId;
    kind : OrgKind;
    name : Text;
    kbo : ?Text; // 10 cijfers
    vat : ?Text;
    aliases : [Text]; // planningcodes ("KEVIN", "KDS")
    trades : [Text]; // keys uit lookups (VOORLOPIG tot 0.3)
    address : ?Address;
    notes : Text;
    createdAt : Int;
    createdBy : PersonId;
    var archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: vertrouwelijk (klant-organisaties)
  type OrgConfidential = {
    orgId : OrgId;
    var contact : Confidential<Contact>;
    var notes : Confidential<Text>;
    var version : Nat;
  };

  // klasse: intern
  type Vehicle = { id : Nat; plate : Text; name : Text; createdAt : Int; var archivedAt : ?Int; extra : Extra };

  type OrgState = {
    orgs : Map.Map<OrgId, Org>;
    orgConfidential : Map.Map<OrgId, OrgConfidential>;
    vehicles : Map.Map<Nat, Vehicle>;
  };

  // ── Werven en lidmaatschappen (§2.4, §2.3) ──────────────────────────────
  type WorkStatus = { #request; #quoting; #planned; #running; #delivered; #aftercare; #cancelled };

  // klasse: intern
  type Work = {
    id : WorkId;
    code : Text; // "2026-231" of "W-0042"
    name : Text;
    address : Address;
    parentId : ?WorkId; // deelwerf
    clientOrgId : ?OrgId;
    architectOrgId : ?OrgId;
    leaderPersonId : ?PersonId;
    var status : WorkStatus;
    vatBp : Nat; // 600 of 2100
    plannedStart : ?Nat; // Day
    plannedEnd : ?Nat;
    estimatedAmountCents : ?Int; // orde van grootte (30bis, Checkinatwork)
    safetyCoordinatorOrgId : ?OrgId;
    createdAt : Int;
    createdBy : PersonId;
    var archivedAt : ?Int;
    extra : Extra;
  };

  type Grant = { #readReports; #readSellPrices; #readProgress; #uploadDocs; #confirmHours; #confirmPlanning };

  // klasse: intern. Rol per werf: een persoon of een hele organisatie.
  type Membership = {
    id : Nat;
    workId : WorkId;
    personId : ?PersonId;
    orgId : ?OrgId;
    role : Role;
    grants : [Grant];
    grantedAt : Int;
    grantedBy : PersonId;
    var endedAt : ?Int;
    var endedBy : ?PersonId;
  };

  type WorksState = {
    works : Map.Map<WorkId, Work>;
    memberships : Map.Map<Nat, Membership>;
  };

  // ── Bestanden (§2.7) ────────────────────────────────────────────────────
  // klasse: intern; met confidential = true: vertrouwelijk (verwijzing alleen via update-call + logregel)
  type FileRef = {
    id : Nat;
    name : Text;
    mime : Text;
    size : Nat; // opgegeven door de browser
    blob : Blob; // ExternalBlob "!caf!sha256:…": openbaar-voor-wie-hem-kent
    workId : ?WorkId;
    confidential : Bool;
    personId : PersonId;
    at : Int;
    var archivedAt : ?Int;
  };

  type FileState = { files : Map.Map<Nat, FileRef> };

  // ── Robot: tickets en voorstellen (§2.10, §6) ───────────────────────────
  type TicketState = { #open; #used : Int; #expired };

  // klasse: geheim, gehasht (128 bit)
  type Ticket = {
    id : Nat;
    hash : Blob;
    personId : PersonId;
    task : Text; // sleutel uit Config.ticketTasks
    workId : ?WorkId;
    payloadRef : ?Text;
    budgetCents : Nat;
    createdAt : Int;
    expiresAt : Int;
    var state : TicketState;
  };

  type Decision = { by : PersonId; at : Int; accepted : Bool; note : Text };

  // klasse: intern
  type Proposal = {
    id : Nat;
    ticketId : ?Nat;
    jobId : ?Nat;
    personId : ?PersonId;
    workId : ?WorkId;
    kind : Text;
    content : Text;
    by : Principal;
    at : Int;
    var decision : ?Decision;
  };

  // Robotprincipal: geen persoon, gaat nooit door Rights.may (R28). Beheerd door de admin.
  type Robot = {
    principal : Principal;
    name : Text;
    kinds : [Text];
    addedAt : Int;
    addedBy : PersonId;
    var revokedAt : ?Int;
    var revokedBy : ?PersonId;
  };

  type RobotState = {
    tickets : Map.Map<Nat, Ticket>;
    ticketIndex : Map.Map<Blob, Nat>;
    proposals : Map.Map<Nat, Proposal>;
    proposalByTicket : Map.Map<Nat, Nat>;
    robots : Map.Map<Principal, Robot>;
  };

  // ── Audit en meldingen (§2.10) ──────────────────────────────────────────
  // klasse: intern. Nooit een volledige code, nooit een opslag-URL.
  type AuditEntry = {
    at : Int;
    who : Principal;
    personId : ?PersonId;
    workId : ?WorkId;
    action : Text;
    detail : Text;
  };

  type Notification = {
    id : Nat;
    personId : PersonId;
    kind : Text;
    text : Text;
    workId : ?WorkId;
    ref : ?(Text, Nat);
    createdAt : Int;
    var readAt : ?Int;
  };

  type AuditState = {
    log : List.List<AuditEntry>;
    notifications : Map.Map<Nat, Notification>;
  };

  // ── Instellingen (§2.11) ────────────────────────────────────────────────
  // klasse: intern. Keuzelijsten in data (D9): sleutel "lijst:key".
  type Lookup = {
    list : Text;
    key : Text;
    tag : Text;
    order : Nat;
    var archivedAt : ?Int;
    extra : Extra;
  };

  type SettingsState = {
    var werfleiderZietAlles : Bool;
    var inviteDays : Nat;
    lookups : Map.Map<Text, Lookup>;
    sequences : Map.Map<Text, Nat>;
    values : Map.Map<Text, Text>; // kleine vlaggen zonder migratie (D8)
  };

  // Tellers per collectie (D3): sleutel = naam van de collectie, waarde = laatst uitgegeven id.
  // Een Map in plaats van een record: een nieuwe collectie vraagt dan geen migratie van de tellers.
  type Counters = Map.Map<Text, Nat>;

  type OldActor = {};
  type NewActor = {
    settings : SettingsState;
    access : AccessState;
    org : OrgState;
    works : WorksState;
    files : FileState;
    robot : RobotState;
    audit : AuditState;
    ctr : Counters;
  };

  public func migration(_ : OldActor) : NewActor {
    {
      settings = {
        var werfleiderZietAlles = true;
        var inviteDays = 7;
        lookups = Map.empty();
        sequences = Map.empty();
        values = Map.empty();
      };
      access = {
        persons = Map.empty();
        links = Map.empty();
        linkHistory = Map.empty();
        invites = Map.empty();
        codeIndex = Map.empty();
        attempts = Map.empty();
        throttle = { var windowStart = 0; var failures = 0; var alertedWindow = -1; var lockedUntil = 0 };
        personConfidential = Map.empty();
        var bootstrapUsed = false;
      };
      org = { orgs = Map.empty(); orgConfidential = Map.empty(); vehicles = Map.empty() };
      works = { works = Map.empty(); memberships = Map.empty() };
      files = { files = Map.empty() };
      robot = {
        tickets = Map.empty();
        ticketIndex = Map.empty();
        proposals = Map.empty();
        proposalByTicket = Map.empty();
        robots = Map.empty();
      };
      audit = { log = List.empty(); notifications = Map.empty() };
      ctr = Map.empty();
    };
  };
};
