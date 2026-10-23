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

  public type SettingsView = { werfleiderZietAlles : Bool; inviteDays : Nat };

  public type AccessStats = {
    persons : Nat;
    activeLinks : Nat;
    pendingLinks : Nat;
    openInvites : Nat;
    failuresThisHour : Nat;
    codesLockedUntil : ?Int;
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
  };
};
