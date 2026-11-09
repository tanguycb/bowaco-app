// Stap 3.5 (proefbank, bouwplan §6 "Autonomie per taak"): testsets met verwijzingen en het juiste antwoord, proefrondes per bot of
// AI-fiche, de antwoorden per ronde en de open ronde per bot. Alles als NIEUW stabiel veld `proof` (deelvorm, M4): niets bestaands
// wordt verbreed, OldActor = {}. De types staan hier letterlijk. NOOIT meer wijzigen zodra deze migratie op een canister staat die
// blijft bestaan (M2).
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type WorkId = Nat;
  type Extra = [(Text, Text)];
  type ProofSubject = { #bot : Nat; #ai : Text; #other : Text };
  type ProofRef = { #file : Nat; #doc : Nat; #oaQuote : Nat; #oaInvoice : Nat; #other : Text };
  type ProofCase = { n : Nat; ref : ProofRef; workId : ?WorkId; answer : [(Text, Text)] };
  type ProofSet = {
    id : Nat;
    task : Text;
    name : Text;
    source : Text;
    cases : [ProofCase];
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };
  type ProofOutcome = { #right; #wrong : [Text]; #none; #void : Text; #other : Text };
  type ProofAnswer = { n : Nat; given : [(Text, Text)]; at : Int; outcome : ProofOutcome };
  type ProofRoundState = { #open; #closed; #cancelled; #other : Text };
  type ProofRound = {
    id : Nat;
    setId : Nat;
    task : Text;
    subject : ProofSubject;
    vendor : Text;
    model : Text;
    instruction : Text;
    cases : [Nat];
    startedAt : Int;
    startedBy : PersonId;
    var state : ProofRoundState;
    var closedAt : ?Int;
    var closedBy : ?PersonId;
    var right : Nat;
    var counted : Nat;
    var extra : Extra;
  };
  type ProofState = {
    sets : Map.Map<Nat, ProofSet>;
    rounds : Map.Map<Nat, ProofRound>;
    answers : Map.Map<Nat, Map.Map<Nat, ProofAnswer>>;
    openByBot : Map.Map<Nat, Nat>;
  };

  public func migration(_ : {}) : { proof : ProofState } {
    {
      proof = {
        sets = Map.empty<Nat, ProofSet>();
        rounds = Map.empty<Nat, ProofRound>();
        answers = Map.empty<Nat, Map.Map<Nat, ProofAnswer>>();
        openByBot = Map.empty<Nat, Nat>();
      };
    };
  };
};
