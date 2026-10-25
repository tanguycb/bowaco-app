// Stap 2.8 (offerte → werf): per aanvaarde offerteversie de start van de werf (of het afgewezen voorstel), met de taken,
// afhankelijkheden en vergunningsvoorstellen die eruit kwamen en de lijnen die al een taak kregen (voor het verschil bij
// meerwerk). Alles komt als NIEUW stabiel veld `workStarts` (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}.
// Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie op een canister
// staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];

  type WorkStartStatus = { #started; #dismissed };

  type WorkStart = {
    versionId : Nat;
    quoteId : Nat;
    sourceWorkId : WorkId;
    workId : WorkId;
    status : WorkStartStatus;
    newWork : Bool;
    baseVersionIds : [Nat];
    startDay : Day;
    templateKey : Text;
    lineIds : [Nat];
    roots : [Nat];
    taskIds : [Nat];
    linkedTaskIds : [Nat];
    depIds : [Nat];
    permitIds : [Nat];
    declaration : Text;
    note : Text;
    at : Int;
    by : PersonId;
    extra : Extra;
  };

  type WorkStartState = { starts : Map.Map<Nat, WorkStart> };

  type OldActor = {};
  type NewActor = { workStarts : WorkStartState };

  public func migration(_ : OldActor) : NewActor {
    { workStarts = { starts = Map.empty() } };
  };
};
