// Stap 3.10 (OA-factuurcontrole, bouwplan §6 "Twee wegen voor AI"): controleopdrachten per OA-factuur met het resultaat (voorstel
// goedkeuren · navragen · weigeren en bevindingen) en de inhoud van het bestand of de tekst tot de opdracht afgesloten is. Alles als
// NIEUW stabiel veld `invCheck` (deelvorm, M4): niets bestaands wordt verbreed, OldActor = {}. De types staan hier letterlijk. NOOIT
// meer wijzigen zodra deze migratie op een canister staat die blijft bestaan (M2).
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type WorkId = Nat;
  type Extra = [(Text, Text)];
  type InvCheckVia = { #bot : Nat; #ai; #other : Text };
  type InvCheckStatus = { #open; #proposed; #closed : Text; #cancelled; #failed : Text; #other : Text };
  type InvCheckFinding = { kind : Text; severity : Text; text : Text; cents : ?Int; extra : Extra };
  type InvCheckResult = { verdict : Text; findings : [InvCheckFinding]; summary : Text; confidence : Nat; at : Int; extra : Extra };
  type InvCheckJob = {
    id : Nat;
    workId : WorkId;
    invoiceId : Nat;
    orgId : Nat;
    name : Text;
    mime : Text;
    size : Nat;
    via : InvCheckVia;
    createdAt : Int;
    createdBy : PersonId;
    var status : InvCheckStatus;
    var result : ?InvCheckResult;
    var decidedAt : ?Int;
    var decidedBy : ?PersonId;
    var extra : Extra;
  };
  type InvCheckState = {
    jobs : Map.Map<Nat, InvCheckJob>;
    byWork : Map.Map<Nat, [Nat]>;
    content : Map.Map<Nat, Blob>;
    extra : Map.Map<Text, Text>;
  };

  public func migration(_ : {}) : { invCheck : InvCheckState } {
    {
      invCheck = {
        jobs = Map.empty<Nat, InvCheckJob>();
        byWork = Map.empty<Nat, [Nat]>();
        content = Map.empty<Nat, Blob>();
        extra = Map.empty<Text, Text>();
      };
    };
  };
};
