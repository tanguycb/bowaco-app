// BOWACO werfbeheer: de vormen van de opgeslagen gegevens (stap 0.6, architectuur 0.4 §2).
// Regels: alleen toevoegen (D1/D2), ids uit tellers (D3), tijd in ns (D4), vertrouwelijk apart (D6),
// opgeslagen vorm ≠ API-vorm (D7, zie types/views.mo), `extra` op elk hoofdrecord (D8).
// Elk type in een Map is invariant voor de upgradecontrole: een veld of tag erbij = een migratie.
// Elk type draagt zijn dataklasse (architectuur §3) als commentaar.
import List "mo:core/List";
import Map "mo:core/Map";

module {
  public type PersonId = Nat;
  public type OrgId = Nat;
  public type WorkId = Nat;
  public type Extra = [(Text, Text)];

  // ── Vertrouwelijk (D6): #plain nu, #sealed in fase 2 zonder schemawijziging ──
  public type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  public type Confidential<T> = { #plain : T; #sealed : Sealed };

  public type Address = { street : Text; number : Text; zip : Text; city : Text; country : Text };
  public type Contact = { name : Text; phone : ?Text; email : ?Text; address : ?Address };

  // ── Personen en toegang (§2.3) ──────────────────────────────────────────
  // Interne rollen (admin, werfleider, calculator) gelden voor alle werven; externe rollen
  // alleen via een Membership per werf. Welke rol wat mag, staat ALLEEN in lib/Rights.mo.
  public type Role = {
    #admin;
    #werfleider;
    #calculator;
    #architect;
    #onderaannemer;
    #klant;
    #veiligheidscoordinator;
  };

  // klasse: intern
  public type Person = {
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

  public type LinkStatus = { #active; #pending; #revoked };

  // klasse: technisch. Principal → persoon; een persoon kan meerdere principals hebben.
  public type Link = {
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
  public type LinkHistory = {
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

  public type CodeKind = { #invite; #recovery };
  public type CodeState = {
    #open;
    #used : { by : Principal; at : Int };
    #revoked : { by : PersonId; at : Int };
    #expired : { at : Int };
  };

  // klasse: geheim, gehasht. Alleen de hash, nooit de code.
  public type Invite = {
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
  public type Attempts = { var windowStart : Int; var count : Nat; var blockedUntil : Int };

  // Globale remming op foute codes over alle principals (0.2 open punt 4).
  public type Throttle = {
    var windowStart : Int;
    var failures : Nat;
    var alertedWindow : Int; // venster waarvoor de admin al een melding kreeg
    var lockedUntil : Int; // > nu: alle codepogingen tijdelijk dicht
  };

  // klasse: vertrouwelijk (alleen voor klant-personen)
  public type PersonConfidential = { personId : PersonId; var contact : Confidential<Contact>; var version : Nat };

  public type AccessState = {
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
  public type OrgKind = { #bowaco; #subcontractor; #architect; #client; #supplier; #authority; #other };

  // klasse: intern (adres van een klant hoort in OrgConfidential)
  public type Org = {
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
  public type OrgConfidential = {
    orgId : OrgId;
    var contact : Confidential<Contact>;
    var notes : Confidential<Text>;
    var version : Nat;
  };

  // klasse: intern
  public type Vehicle = { id : Nat; plate : Text; name : Text; createdAt : Int; var archivedAt : ?Int; extra : Extra };

  public type OrgState = {
    orgs : Map.Map<OrgId, Org>;
    orgConfidential : Map.Map<OrgId, OrgConfidential>;
    vehicles : Map.Map<Nat, Vehicle>;
  };

  // ── Werven en lidmaatschappen (§2.4, §2.3) ──────────────────────────────
  public type WorkStatus = { #request; #quoting; #planned; #running; #delivered; #aftercare; #cancelled };

  // klasse: intern. Wijzigen = het record vervangen + een auditregel per veld (D2).
  public type Work = {
    id : WorkId;
    code : Text; // "2026-231" of "W-0042"
    name : Text;
    address : Address;
    parentId : ?WorkId; // deelwerf (één niveau diep, VOORLOPIG tot A9)
    clientOrgId : ?OrgId;
    architectOrgId : ?OrgId;
    leaderPersonId : ?PersonId;
    var status : WorkStatus;
    vatBp : Nat; // 600 of 2100
    plannedStart : ?Nat; // Day
    plannedEnd : ?Nat;
    // verouderd sinds 1.1: de geraamde aanneemsom is vertrouwelijk (ContractParams); blijft null.
    estimatedAmountCents : ?Int;
    // verouderd sinds 1.1: de veiligheidscoördinator is een lidmaatschap van de werf; blijft null.
    safetyCoordinatorOrgId : ?OrgId;
    createdAt : Int;
    createdBy : PersonId;
    var archivedAt : ?Int;
    extra : Extra;
  };

  public type Grant = { #readReports; #readSellPrices; #readProgress; #uploadDocs; #confirmHours; #confirmPlanning };

  // klasse: intern. Rol per werf: een persoon of een hele organisatie.
  public type Membership = {
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

  public type WorksState = {
    works : Map.Map<WorkId, Work>;
    memberships : Map.Map<Nat, Membership>;
  };

  // ── Bestanden (§2.7) ────────────────────────────────────────────────────
  // klasse: intern; met confidential = true: vertrouwelijk (verwijzing alleen via update-call + logregel)
  public type FileRef = {
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

  public type FileState = { files : Map.Map<Nat, FileRef> };

  // ── Werfdossier (stap 1.1, architectuur §2.4 en §2.7) ──────────────────
  // Eén nieuw domein in plaats van Work en FileState te verbreden (D1b): zo vraagt 1.1 één kleine
  // migratie in deelvorm met OldActor = {} (migrations/20261023_*).
  public type Day = Nat; // dagen sinds 1970-01-01 (Belgische kalenderdatum, D4)

  public type PriceRevision = { #none; #formula : Text };
  public type GuaranteeKind = { #none; #retention; #bankGuarantee }; // geen · inhouding op facturen · bankwaarborg
  public type InvoicingRhythm = { #monthly; #perPhase; #perProgress; #other : Text };

  // klasse: vertrouwelijk (de inhoud van Confidential<ContractParams>)
  public type ContractParams = {
    estimatedAmountCents : ?Int; // geraamde aanneemsom excl. btw (30bis, Checkinatwork)
    priceRevision : PriceRevision;
    guarantee : GuaranteeKind;
    guaranteeBp : Nat; // 500 = 5 %
    paymentTermDays : Nat;
    invoicingRhythm : InvoicingRhythm;
    signedQuoteVersionId : ?Nat; // fase 2
    note : Text;
  };

  // klasse: vertrouwelijk. Lezen alleen via een update-call met auditregel (R23, R27).
  public type WorkConfidential = {
    workId : WorkId;
    contract : Confidential<ContractParams>;
    clientContact : Confidential<Contact>; // contactpersoon van de klant voor deze werf
    notes : Confidential<Text>; // commerciële notities
    version : Nat;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  // klasse: vertrouwelijk. Elke versie blijft bewaard (D2, append-only).
  public type WorkConfidentialVersion = {
    id : Nat;
    workId : WorkId;
    version : Nat;
    contract : Confidential<ContractParams>;
    clientContact : Confidential<Contact>;
    notes : Confidential<Text>;
    at : Int;
    by : PersonId;
  };

  // klasse: intern. Administratieve gegevens van de werffiche die Work zelf niet heeft.
  public type WorkInfo = {
    workId : WorkId;
    analyticCode : ?Text; // analytische code boekhouding; null = de werfcode
    vatNote : Text; // grond voor het btw-tarief ("woning ouder dan 10 jaar")
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  public type DocStatus = { #missing; #requested; #received; #approved; #expired; #notApplicable };

  // klasse: intern; met confidential = true vertrouwelijk (de bestanden zijn dan ook vertrouwelijk).
  // Soort = sleutel uit settings.lookups ("docKind:…") of uit Config.defaultDocKinds (D9).
  public type Document = {
    id : Nat;
    workId : WorkId;
    kind : Text;
    title : Text;
    fileIds : [Nat]; // versies, de laatste is de actuele
    status : DocStatus;
    dueDay : ?Day;
    validUntil : ?Day; // keuring, verzekering: daarna "verlopen"
    note : Text;
    ownerOrgId : ?OrgId; // wie levert (firma van de veiligheidscoördinator, de OA …)
    confidential : Bool;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  public type DossierState = {
    info : Map.Map<WorkId, WorkInfo>;
    confidential : Map.Map<WorkId, WorkConfidential>;
    confidentialHistory : Map.Map<Nat, WorkConfidentialVersion>;
    documents : Map.Map<Nat, Document>;
  };

  // ── Robot: tickets en voorstellen (§2.10, §6) ───────────────────────────
  public type TicketState = { #open; #used : Int; #expired };

  // klasse: geheim, gehasht (128 bit)
  public type Ticket = {
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

  public type Decision = { by : PersonId; at : Int; accepted : Bool; note : Text };

  // klasse: intern
  public type Proposal = {
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
  public type Robot = {
    principal : Principal;
    name : Text;
    kinds : [Text];
    addedAt : Int;
    addedBy : PersonId;
    var revokedAt : ?Int;
    var revokedBy : ?PersonId;
  };

  public type RobotState = {
    tickets : Map.Map<Nat, Ticket>;
    ticketIndex : Map.Map<Blob, Nat>;
    proposals : Map.Map<Nat, Proposal>;
    proposalByTicket : Map.Map<Nat, Nat>;
    robots : Map.Map<Principal, Robot>;
  };

  // ── Audit en meldingen (§2.10) ──────────────────────────────────────────
  // klasse: intern. Nooit een volledige code, nooit een opslag-URL.
  public type AuditEntry = {
    at : Int;
    who : Principal;
    personId : ?PersonId;
    workId : ?WorkId;
    action : Text;
    detail : Text;
  };

  public type Notification = {
    id : Nat;
    personId : PersonId;
    kind : Text;
    text : Text;
    workId : ?WorkId;
    ref : ?(Text, Nat);
    createdAt : Int;
    var readAt : ?Int;
  };

  public type AuditState = {
    log : List.List<AuditEntry>;
    notifications : Map.Map<Nat, Notification>;
  };

  // ── Instellingen (§2.11) ────────────────────────────────────────────────
  // klasse: intern. Keuzelijsten in data (D9): sleutel "lijst:key".
  public type Lookup = {
    list : Text;
    key : Text;
    tag : Text;
    order : Nat;
    var archivedAt : ?Int;
    extra : Extra;
  };

  public type SettingsState = {
    var werfleiderZietAlles : Bool;
    var inviteDays : Nat;
    lookups : Map.Map<Text, Lookup>;
    sequences : Map.Map<Text, Nat>;
    values : Map.Map<Text, Text>; // kleine vlaggen zonder migratie (D8)
  };

  // Tellers per collectie (D3): sleutel = naam van de collectie, waarde = laatst uitgegeven id.
  // Een Map in plaats van een record: een nieuwe collectie vraagt dan geen migratie van de tellers.
  public type Counters = Map.Map<Text, Nat>;
};
