// Stap 1.5 (import van de bestaande planning): batches, importsleutels en afspraken als NIEUW stabiel
// veld `imp` (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}.
// Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze
// migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];

  type ImportBatch = {
    id : Text;
    title : Text;
    at : Int;
    by : PersonId;
    blocks : Nat;
    works : Nat;
    tasks : Nat;
    assignments : Nat;
    appointments : Nat;
    rolledBackAt : ?Int;
    rolledBackBy : ?PersonId;
    extra : Extra;
  };

  type ImportKind = { #work; #link; #task; #assignment; #appointment };

  type ImportKey = { key : Text; kind : ImportKind; entityId : Nat; batchId : Text };

  type Appointment = {
    id : Nat;
    workId : WorkId;
    taskId : Nat;
    day : Day;
    time : ?Text;
    text : Text;
    orgId : ?OrgId;
    weekFallback : Bool;
    batchId : ?Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type ImportState = {
    batches : Map.Map<Text, ImportBatch>;
    keys : Map.Map<Text, ImportKey>;
    appointments : Map.Map<Nat, Appointment>;
  };

  type OldActor = {};
  type NewActor = { imp : ImportState };

  public func migration(_ : OldActor) : NewActor {
    {
      imp = {
        batches = Map.empty();
        keys = Map.empty();
        appointments = Map.empty();
      };
    };
  };
};
