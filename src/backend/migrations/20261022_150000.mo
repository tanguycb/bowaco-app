// Eerste stabiele toestand (draft 1). Zelfstandig: alle types staan hier, geen projectimports.
import List "mo:core/List";
import Map "mo:core/Map";

module {
  type Role = { #admin; #werfleider; #calculator; #architect; #onderaannemer; #klant };
  type Person = { id : Nat; name : Text; roles : [Role]; createdAt : Int; createdBy : Nat };
  type LinkStatus = { #active; #pending };
  type Link = { personId : Nat; var status : LinkStatus; linkedAt : Int; codeHint : Text; var confirmedBy : ?Nat };
  type CodeKind = { #invite; #recovery };
  type CodeState = { #open; #used : { by : Principal; at : Int }; #revoked : { by : Nat; at : Int } };
  type Invite = {
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
  type Attempts = { var windowStart : Int; var count : Nat; var blockedUntil : Int };
  type AuditEntry = { at : Int; who : Principal; personId : ?Nat; action : Text; detail : Text };
  type FileRec = { id : Nat; name : Text; mime : Text; size : Nat; blob : Blob; personId : Nat; at : Int };
  type Ticket = {
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
  type Proposal = { id : Nat; ticketId : Nat; personId : Nat; content : Text; by : Principal; at : Int };
  type ProbeNote = { id : Nat; text : Text; by : Principal; at : Int };
  type State = {
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
  type Counters = {
    var nextPerson : Nat;
    var nextInvite : Nat;
    var nextFile : Nat;
    var nextTicket : Nat;
    var nextProposal : Nat;
    var nextProbe : Nat;
    var bootstrapUsed : Bool;
  };
  type TimerState = { var ticks : Nat; var lastTick : Int; var recent : [Int]; var expiredTickets : Nat };
  type VetkdState = { var lastAt : Int; var lastReport : Text };

  type OldActor = {};
  type NewActor = { st : State; ctr : Counters; tmr : TimerState; vk : VetkdState };

  public func migration(_ : OldActor) : NewActor {
    {
      st = {
        persons = Map.empty();
        links = Map.empty();
        invites = Map.empty();
        codeIndex = Map.empty();
        attempts = Map.empty();
        audit = List.empty();
        files = Map.empty();
        tickets = Map.empty();
        ticketIndex = Map.empty();
        proposals = Map.empty();
        probe = Map.empty();
      };
      ctr = {
        var nextPerson = 0;
        var nextInvite = 0;
        var nextFile = 0;
        var nextTicket = 0;
        var nextProposal = 0;
        var nextProbe = 0;
        var bootstrapUsed = false;
      };
      tmr = { var ticks = 0; var lastTick = 0; var recent = []; var expiredTickets = 0 };
      vk = { var lastAt = 0; var lastReport = "" };
    };
  };
};
