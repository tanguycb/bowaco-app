// Stap 1b.1 (vergunningenregister): vergunningen, hun wijzigingen, de kennisbank per gemeente, de procedures per
// soort en de verstuurde meldingen als NIEUW stabiel veld `permits` (deelvorm, M4). Niets bestaands wordt verbreed:
// OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze
// migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];

  type PermitStatus = { #needed; #requested; #granted; #refused; #expired; #extended; #cancelled };

  type Permit = {
    id : Nat;
    workId : WorkId;
    kind : Text;
    title : Text;
    municipalityId : ?Nat;
    status : PermitStatus;
    location : Text;
    taskIds : [Nat];
    neededFrom : ?Day;
    neededTo : ?Day;
    leadDays : Nat;
    requestedOn : ?Day;
    validFrom : ?Day;
    validTo : ?Day;
    reference : Text;
    costCents : ?Int;
    fileIds : [Nat];
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type PermitChange = { id : Nat; permitId : Nat; workId : WorkId; at : Int; by : PersonId; field : Text; from : Text; to : Text };

  type Municipality = {
    id : Nat;
    name : Text;
    zips : [Text];
    portal : ?Text;
    email : ?Text;
    phone : ?Text;
    contact : Text;
    notes : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type PermitProcedure = {
    municipalityId : Nat;
    kind : Text;
    how : Text;
    portal : ?Text;
    email : ?Text;
    leadDays : Nat;
    cost : Text;
    attachments : [Text];
    contact : Text;
    notes : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type PermitState = {
    permits : Map.Map<Nat, Permit>;
    changes : Map.Map<Nat, PermitChange>;
    municipalities : Map.Map<Nat, Municipality>;
    procedures : Map.Map<Text, PermitProcedure>;
    alerts : Map.Map<Text, Int>;
  };

  type OldActor = {};
  type NewActor = { permits : PermitState };

  public func migration(_ : OldActor) : NewActor {
    {
      permits = {
        permits = Map.empty();
        changes = Map.empty();
        municipalities = Map.empty();
        procedures = Map.empty();
        alerts = Map.empty();
      };
    };
  };
};
