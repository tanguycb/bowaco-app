// Stap 1b.3 (postbode): de werkwachtrij van de gateway als NIEUW stabiel veld `post` (deelvorm, M4). Niets bestaands
// wordt verbreed: OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen
// zodra deze migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Extra = [(Text, Text)];

  type JobState = {
    #queued;
    #leased : { by : Principal; until : Int; attempt : Nat };
    #done : { at : Int; result : Text };
    #failed : { at : Int; why : Text };
    #cancelled : { by : PersonId; at : Int };
  };

  type Job = {
    id : Nat;
    kind : Text;
    key : Text;
    orgId : ?OrgId;
    personId : ?PersonId;
    workId : ?WorkId;
    ref : Text;
    notBefore : Int;
    attempts : Nat;
    state : JobState;
    createdAt : Int;
    createdBy : ?PersonId;
    updatedAt : Int;
    extra : Extra;
  };

  type PostState = {
    jobs : Map.Map<Nat, Job>;
    keys : Map.Map<Text, Nat>;
    open : Map.Map<Nat, ()>;
    seen : Map.Map<Principal, Int>;
  };

  type OldActor = {};
  type NewActor = { post : PostState };

  public func migration(_ : OldActor) : NewActor {
    { post = { jobs = Map.empty(); keys = Map.empty(); open = Map.empty(); seen = Map.empty() } };
  };
};
