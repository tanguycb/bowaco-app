// Draft 2 (migratietest, stap 0.2f): Person krijgt `phone : ?Text`, ProbeNote krijgt `version : Nat`.
// Deelvorm: alleen `st` verandert; ctr, tmr en vk gaan ongewijzigd mee.
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";

module {
  type Role = { #admin; #werfleider; #calculator; #architect; #onderaannemer; #klant };
  type OldPerson = { id : Nat; name : Text; roles : [Role]; createdAt : Int; createdBy : Nat };
  type NewPerson = { id : Nat; name : Text; roles : [Role]; createdAt : Int; createdBy : Nat; phone : ?Text };
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
  type OldProbeNote = { id : Nat; text : Text; by : Principal; at : Int };
  type NewProbeNote = { id : Nat; text : Text; by : Principal; at : Int; version : Nat };
  type OldState = {
    persons : Map.Map<Nat, OldPerson>;
    links : Map.Map<Principal, Link>;
    invites : Map.Map<Nat, Invite>;
    codeIndex : Map.Map<Blob, Nat>;
    attempts : Map.Map<Principal, Attempts>;
    audit : List.List<AuditEntry>;
    files : Map.Map<Nat, FileRec>;
    tickets : Map.Map<Nat, Ticket>;
    ticketIndex : Map.Map<Blob, Nat>;
    proposals : Map.Map<Nat, Proposal>;
    probe : Map.Map<Nat, OldProbeNote>;
  };
  type NewState = {
    persons : Map.Map<Nat, NewPerson>;
    links : Map.Map<Principal, Link>;
    invites : Map.Map<Nat, Invite>;
    codeIndex : Map.Map<Blob, Nat>;
    attempts : Map.Map<Principal, Attempts>;
    audit : List.List<AuditEntry>;
    files : Map.Map<Nat, FileRec>;
    tickets : Map.Map<Nat, Ticket>;
    ticketIndex : Map.Map<Blob, Nat>;
    proposals : Map.Map<Nat, Proposal>;
    probe : Map.Map<Nat, NewProbeNote>;
  };

  type OldActor = { st : OldState };
  type NewActor = { st : NewState };

  public func migration(old : OldActor) : NewActor {
    let persons = old.st.persons.map<Nat, OldPerson, NewPerson>(func(_, p) = { p with phone = null });
    let probe = old.st.probe.map<Nat, OldProbeNote, NewProbeNote>(func(_, n) = { n with version = 1 });
    { st = { old.st with persons; probe } };
  };
};
