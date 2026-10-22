// Stap 0.2 (haalbaarheidstest): de vormen van de opgeslagen gegevens en van de API.
// Opgeslagen vormen bevatten soms `var`; wat naar buiten gaat (…View) nooit.
import List "mo:core/List";
import Map "mo:core/Map";
import Storage "mo:caffeineai-object-storage/Storage";

module {
  // ── Personen en toegang (§3.3) ──────────────────────────────────────────
  public type Role = {
    #admin;
    #werfleider;
    #calculator;
    #architect;
    #onderaannemer;
    #klant;
  };

  public type Person = {
    id : Nat;
    name : Text;
    roles : [Role];
    createdAt : Int;
    createdBy : Nat; // persoon-id van de uitnodiger; 0 = opstartcode
  };

  public type LinkStatus = { #active; #pending };

  // Koppeling principal → persoon. Een persoon kan meerdere principals hebben.
  public type Link = {
    personId : Nat;
    var status : LinkStatus;
    linkedAt : Int;
    codeHint : Text; // laatste 2 tekens van de gebruikte code, voor de bevestiging
    var confirmedBy : ?Nat;
  };

  public type CodeKind = { #invite; #recovery };

  public type CodeState = {
    #open;
    #used : { by : Principal; at : Int };
    #revoked : { by : Nat; at : Int };
  };

  // Uitnodigings- of herstelcode. Alleen de hash staat hier, nooit de code.
  public type Invite = {
    id : Nat;
    hash : Blob;
    personId : Nat;
    kind : CodeKind;
    createdBy : Nat;
    createdAt : Int;
    expiresAt : Int;
    hint : Text;
    var state : CodeState;
  };

  public type Attempts = {
    var windowStart : Int;
    var count : Nat;
    var blockedUntil : Int;
  };

  public type AuditEntry = {
    at : Int;
    who : Principal;
    personId : ?Nat;
    action : Text;
    detail : Text;
  };

  // ── Bestanden (opslagdienst Caffeine) ──────────────────────────────────
  public type FileRec = {
    id : Nat;
    name : Text;
    mime : Text;
    size : Nat; // door de browser opgegeven; de backend kan het niet nameten
    blob : Storage.ExternalBlob;
    personId : Nat;
    at : Int;
  };

  // ── Ticketpatroon (§6) ─────────────────────────────────────────────────
  public type Ticket = {
    id : Nat;
    hash : Blob;
    personId : Nat;
    task : Text;
    werf : Text;
    budgetCents : Nat;
    createdAt : Int;
    expiresAt : Int;
    var used : Bool;
  };

  public type Proposal = {
    id : Nat;
    ticketId : Nat;
    personId : Nat;
    content : Text;
    by : Principal;
    at : Int;
  };

  // ── Proefnotities (migratietest op de draft) ───────────────────────────
  public type ProbeNote = {
    id : Nat;
    text : Text;
    by : Principal;
    at : Int;
  };

  // ── Toestand ───────────────────────────────────────────────────────────
  public type State = {
    persons : Map.Map<Nat, Person>;
    links : Map.Map<Principal, Link>;
    invites : Map.Map<Nat, Invite>;
    codeIndex : Map.Map<Blob, Nat>;
    attempts : Map.Map<Principal, Attempts>;
    audit : List.List<AuditEntry>;
    files : Map.Map<Nat, FileRec>;
    tickets : Map.Map<Nat, Ticket>;
    ticketIndex : Map.Map<Blob, Nat>;
    proposals : Map.Map<Nat, Proposal>;
    probe : Map.Map<Nat, ProbeNote>;
  };

  public type Counters = {
    var nextPerson : Nat;
    var nextInvite : Nat;
    var nextFile : Nat;
    var nextTicket : Nat;
    var nextProposal : Nat;
    var nextProbe : Nat;
    var bootstrapUsed : Bool;
  };

  public type TimerState = {
    var ticks : Nat;
    var lastTick : Int;
    var recent : [Int]; // laatste tijdstippen (ns), voor de regelmaat
    var expiredTickets : Nat;
  };

  public type VetkdState = {
    var lastAt : Int;
    var lastReport : Text;
  };

  // ── API-vormen ─────────────────────────────────────────────────────────
  public type PersonView = Person;

  public type MeView = {
    principal : Principal;
    status : { #anonymous; #unlinked; #pending; #active };
    person : ?Person;
    isRobot : Bool;
    blockedUntil : ?Int;
  };

  public type LinkView = {
    principal : Principal;
    personId : Nat;
    personName : Text;
    status : LinkStatus;
    linkedAt : Int;
    codeHint : Text;
    confirmedBy : ?Nat;
  };

  public type InviteView = {
    id : Nat;
    personId : Nat;
    personName : Text;
    kind : CodeKind;
    createdBy : Nat;
    createdAt : Int;
    expiresAt : Int;
    hint : Text;
    state : CodeState;
  };

  public type NewCode = {
    inviteId : Nat;
    personId : Nat;
    code : Text; // enkel nu getoond; de backend bewaart alleen de hash
    expiresAt : Int;
  };

  public type TicketInfo = {
    ticketId : Nat;
    personId : Nat;
    personName : Text;
    task : Text;
    werf : Text;
    budgetCents : Nat;
    expiresAt : Int;
  };

  public type NewTicket = {
    ticketId : Nat;
    ticket : Text;
    expiresAt : Int;
  };

  public type ProbeStatus = {
    version : Text;
    canisterTime : Int;
    timerTicks : Nat;
    timerLastTick : Int;
    timerRecent : [Int];
    expiredTickets : Nat;
    envNames : [Text];
    vetkdLastAt : Int;
    vetkdLastReport : Text;
    probeNotes : Nat;
    persons : Nat;
    files : Nat;
  };
};
