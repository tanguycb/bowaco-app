// Stap 2.9 (opmeting ter plaatse): de opmetingen per werf, hun regels (hoeveelheid per post, foto's of schets), de stand per
// post bij het afsluiten en de offline-opdrachten. Alles komt als NIEUW stabiel veld `surveys` (deelvorm, M4). Niets
// bestaands wordt verbreed: OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer
// wijzigen zodra deze migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];

  type SurveyStatus = { #open; #closed : { by : PersonId; at : Int; note : Text; thresholdBp : Nat } };
  type Survey = { id : Nat; workId : WorkId; number : Nat; clientKey : Text; status : SurveyStatus; openedBy : PersonId; openedAt : Int; extra : Extra };
  type MeasureFileRole = { #photo; #sketch };
  type MeasureFile = { role : MeasureFileRole; fileId : Nat; thumbFileId : ?Nat; caption : Text };
  type MeasureReview = { by : PersonId; at : Int; ok : Bool; note : Text };
  type MeasureEntry = {
    id : Nat;
    surveyId : Nat;
    workId : WorkId;
    lineId : Nat;
    versionId : Nat;
    root : Nat;
    qtyMilli : Int;
    day : Day;
    complete : Bool;
    note : Text;
    files : [MeasureFile];
    corrects : ?Nat;
    reason : Text;
    proposedOrgId : ?OrgId;
    review : ?MeasureReview;
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    extra : Extra;
  };
  type SurveyPostSnap = { root : Nat; lineId : Nat; versionId : Nat; vhMilli : Int; unit : Text; measuredMilli : Int; deltaMilli : Int; complete : Bool };
  type SurveyOpRecord = { opId : Text; seq : Nat; at : Int; by : PersonId; kind : Text; surveyId : Nat; entityId : ?Nat; note : Text };

  type SurveyState = {
    surveys : Map.Map<Nat, Survey>;
    keys : Map.Map<Text, Nat>;
    byWork : Map.Map<Nat, [Nat]>;
    entries : Map.Map<Nat, MeasureEntry>;
    bySurvey : Map.Map<Nat, [Nat]>;
    snapshots : Map.Map<Nat, [SurveyPostSnap]>;
    fileOwners : Map.Map<Nat, Nat>;
    ops : Map.Map<Text, SurveyOpRecord>;
    opOrder : Map.Map<Nat, Text>;
  };

  type OldActor = {};
  type NewActor = { surveys : SurveyState };

  public func migration(_ : OldActor) : NewActor {
    {
      surveys = {
        surveys = Map.empty();
        keys = Map.empty();
        byWork = Map.empty();
        entries = Map.empty();
        bySurvey = Map.empty();
        snapshots = Map.empty();
        fileOwners = Map.empty();
        ops = Map.empty();
        opOrder = Map.empty();
      };
    };
  };
};
