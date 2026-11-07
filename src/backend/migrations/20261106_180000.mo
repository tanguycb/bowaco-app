// Stap 3.1 (AI-connector, ontwerp 3.1 §2.8 en §2.10): de fiches (AI-medewerkers), de modelcatalogus van Caffeine, het logboek
// van de oproepen ZONDER inhoud (hashes en tellers), de koppeling ticket/voorstel → oproep, de maandtellers van het budget
// (verbruikt en gereserveerd), de lopende oproep per persoon en een lege plaats voor het latere Postvak in (§4).
// Alles komt als NIEUW stabiel veld `ai` (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}; Ticket en Proposal
// blijven ongewijzigd. AiAutonomy staat meteen met drie tags (M0170: een tag erbij in een Map-record vraagt anders een
// migratie). Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie op
// een canister staat die blijft bestaan (M2).
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type WorkId = Nat;
  type Extra = [(Text, Text)];
  type AiRoute = { #caffeine; #gateway };
  type AiAutonomy = { #proposal; #autoNotify; #auto };
  type AiWorker = {
    key : Text;
    name : Text;
    route : AiRoute;
    modelAlias : Text;
    fallback : Bool;
    fallbackModel : ?Text;
    budgetMonthCents : Nat;
    maxCallCents : Nat;
    clientData : Bool;
    autonomy : AiAutonomy;
    instructionVersion : Nat;
    enabled : Bool;
    rev : Nat;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };
  type AiModel = { alias : Text; promptPer1e10 : Nat; completionPer1e10 : Nat; cacheReadPer1e10 : Nat; cacheWritePer1e10 : Nat; seenAt : Int };
  type AiOrigin = { #user : PersonId; #job : Nat };
  type AiCallState = { #running; #done; #invalid : Text; #refused; #unsure : Text; #failed : Text; #dropped; #dryRun };
  type AiCall = {
    id : Nat;
    workerKey : Text;
    route : AiRoute;
    origin : AiOrigin;
    personId : ?PersonId;
    workId : ?WorkId;
    ticketId : ?Nat;
    var proposalId : ?Nat;
    model : Text;
    instructionVersion : Nat;
    inputSha256 : Text;
    var outputSha256 : ?Text;
    inputBytes : Nat;
    var promptTokens : Nat;
    var completionTokens : Nat;
    var cachedTokens : Nat;
    reservedCents : Nat;
    var costCents : Nat;
    var cycles : Nat;
    startedAt : Int;
    var endedAt : ?Int;
    var state : AiCallState;
    fellBack : Bool;
    var extra : Extra;
  };
  type AiInboundState = { #new; #classified : Nat; #rejected : Text; #applied : Nat };
  type AiInbound = {
    id : Nat;
    receivedAt : Int;
    fromHash : Text;
    subjectHash : Text;
    attachments : Nat;
    bytes : Nat;
    dkim : Bool;
    spf : Bool;
    dmarc : Bool;
    var state : AiInboundState;
    extra : Extra;
  };
  type AiState = {
    workers : Map.Map<Text, AiWorker>;
    models : Map.Map<Text, AiModel>;
    log : Map.Map<Nat, AiCall>;
    callByTicket : Map.Map<Nat, Nat>;
    callByProposal : Map.Map<Nat, Nat>;
    spent : Map.Map<Text, Nat>;
    reserved : Map.Map<Text, Nat>;
    runningByPerson : Map.Map<PersonId, Nat>;
    inbound : Map.Map<Nat, AiInbound>;
  };
  type OldActor = {};
  type NewActor = { ai : AiState };

  public func migration(_ : OldActor) : NewActor {
    {
      ai = {
        workers = Map.empty();
        models = Map.empty();
        log = Map.empty();
        callByTicket = Map.empty();
        callByProposal = Map.empty();
        spent = Map.empty();
        reserved = Map.empty();
        runningByPerson = Map.empty();
        inbound = Map.empty();
      };
    };
  };
};
