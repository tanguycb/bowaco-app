// Stap 1.4 (weekbord per OA): afwezigheden per firma, hun geschiedenis en de regels voor een dubbele boeking
// als NIEUW stabiel veld `board` (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}.
// Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze
// migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];

  type AbsenceKind = { #verlof; #ziekte; #andere };
  type AbsenceSource = { #intern; #oa };

  type Absence = {
    id : Nat;
    orgId : OrgId;
    personId : ?PersonId;
    kind : AbsenceKind;
    from : Day;
    to : Day;
    note : Text;
    source : AbsenceSource;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type AbsenceChange = {
    id : Nat;
    absenceId : Nat;
    orgId : OrgId;
    at : Int;
    by : PersonId;
    what : Text;
    detail : Text;
  };

  type CapacityRule = {
    key : Text;
    maxWorks : Nat;
    note : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type BoardState = {
    absences : Map.Map<Nat, Absence>;
    absenceChanges : Map.Map<Nat, AbsenceChange>;
    capacity : Map.Map<Text, CapacityRule>;
  };

  type OldActor = {};
  type NewActor = { board : BoardState };

  public func migration(_ : OldActor) : NewActor {
    {
      board = {
        absences = Map.empty();
        absenceChanges = Map.empty();
        capacity = Map.empty();
      };
    };
  };
};
