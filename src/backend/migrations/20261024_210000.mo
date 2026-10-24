// Stap 1b.4 (werfadministratie): de raadplegingen van de inhoudingsplicht en de aangifte van werken per werf als NIEUW
// stabiel veld `wadm` (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}. Zelfstandig (M4): de types staan
// hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie op een canister staat die blijft bestaan
// (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];

  type WithholdingResult = { #clear; #social; #fiscal; #both; #unknown };

  type WithholdingCheck = {
    id : Nat;
    orgId : OrgId;
    kbo : Text;
    result : WithholdingResult;
    consultedOn : Day;
    reference : Text;
    note : Text;
    source : Text;
    workId : ?WorkId;
    fileId : ?Nat;
    at : Int;
    by : ?PersonId;
    extra : Extra;
  };

  type DeclarationStatus = { #todo; #done : { on : Day; number : Text }; #notNeeded : { reason : Text } };

  type Declaration = {
    workId : WorkId;
    status : DeclarationStatus;
    nature : Text;
    asbestos : Bool;
    note : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  type WadmState = {
    checks : Map.Map<Nat, WithholdingCheck>;
    declarations : Map.Map<WorkId, Declaration>;
  };

  type OldActor = {};
  type NewActor = { wadm : WadmState };

  public func migration(_ : OldActor) : NewActor {
    { wadm = { checks = Map.empty(); declarations = Map.empty() } };
  };
};
