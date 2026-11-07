// De API-vormen van de AI-connector (stap 3.1, ontwerp 3.1 §2.9, D7: zonder `var`). Nooit inhoud: het logboek kent enkel
// hashes, tellers en een opgeschoonde foutmelding (die laatste enkel voor #readAiLog). De budgetcijfers van een fiche ziet
// enkel #manageAi.
import Types "../types";

module {
  type PersonId = Types.PersonId;
  type WorkId = Types.WorkId;

  // Invoer van askAi. refs = ids van app-objecten die de opsteller mag lezen (offerte-id, prijsvraag-id, bestand-id);
  // nooit een opslag-URL. forceRoute = de browser vraagt de andere weg (enkel als de fiche terugval toestaat, §2.6).
  public type AiInput = { text : Text; refs : [Text]; forceRoute : ?Types.AiRoute };

  public type AiTicket = { callId : Nat; ticketId : Nat; ticket : Text; expiresAt : Int; gatewayUrl : Text };
  // #proposal = de caffeine-weg schreef het voorstel; #ticket = de browser gaat verder bij de gateway (§2.2.2).
  public type AiAnswer = { #proposal : { callId : Nat; proposalId : Nat }; #ticket : AiTicket };

  // Wat de gateway meldt na een taak (reportAiUsage, robot "ai"). Kost in eurocent (naar boven afgerond).
  public type AiUsage = {
    model : Text;
    promptTokens : Nat;
    completionTokens : Nat;
    cachedTokens : Nat;
    costCents : Nat;
    durationMs : Nat;
    outputSha256 : ?Text;
  };

  public type AiWorkerInput = {
    key : Text;
    name : Text;
    route : Types.AiRoute;
    modelAlias : Text;
    fallback : Bool;
    fallbackModel : ?Text;
    budgetMonthCents : Nat;
    maxCallCents : Nat;
    clientData : Bool;
    autonomy : Types.AiAutonomy;
    instructionVersion : Nat;
    enabled : Bool;
    rev : Nat; // de rev die de browser las (0 = nieuwe fiche)
  };

  // Budget enkel voor #manageAi (anders null).
  public type AiBudgetView = { budgetMonthCents : Nat; maxCallCents : Nat; spentCents : Nat; reservedCents : Nat; month : Text };
  public type AiWorkerView = {
    key : Text;
    name : Text;
    route : Types.AiRoute;
    modelAlias : Text;
    fallback : Bool;
    fallbackModel : ?Text;
    clientData : Bool;
    autonomy : Types.AiAutonomy;
    instructionVersion : Nat;
    versions : [Nat];
    enabled : Bool;
    configured : Bool; // false = de sleutel bestaat maar er is nog geen fiche (standaardwaarden)
    rev : Nat;
    updatedAt : Int;
    budget : ?AiBudgetView;
  };

  public type AiCallView = {
    id : Nat;
    workerKey : Text;
    route : Types.AiRoute;
    origin : Types.AiOrigin;
    personId : ?PersonId;
    workId : ?WorkId;
    ticketId : ?Nat;
    proposalId : ?Nat;
    model : Text;
    instructionVersion : Nat;
    inputSha256 : ?Text; // enkel #readAiLog
    outputSha256 : ?Text;
    inputBytes : Nat;
    promptTokens : Nat;
    completionTokens : Nat;
    cachedTokens : Nat;
    reservedCents : Nat;
    costCents : Nat;
    cycles : Nat;
    startedAt : Int;
    endedAt : ?Int;
    state : Types.AiCallState; // de foutmelding in de staat is al opgeschoond (geen adres, geen sleutel, geen URL)
    fellBack : Bool;
    extra : Types.Extra; // enkel #readAiLog (anders leeg)
  };

  public type AiWorkerStats = { key : Text; name : Text; enabled : Bool; route : Types.AiRoute; budgetMonthCents : Nat; spentCents : Nat; reservedCents : Nat; lastCallAt : ?Int; calls : Nat; errors : Nat };
  public type AiOverview = {
    month : Text;
    workers : [AiWorkerStats];
    cyclesBalance : Nat;
    cyclesFloor : Nat;
    models : [Types.AiModel];
    modelsSeenAt : ?Int;
    live : Bool; // deze canister belt echt (Config.aiLiveBackends of de testbouw)
    draft : Bool;
    running : Nat;
    usdEurMilli : Nat;
    gatewayUrl : ?Text;
  };

  // Export en herstel (AdminApi.exportChunk "aiLog", RestoreApi): het volledige record zonder `var`.
  public type AiCallExport = {
    id : Nat;
    workerKey : Text;
    route : Types.AiRoute;
    origin : Types.AiOrigin;
    personId : ?PersonId;
    workId : ?WorkId;
    ticketId : ?Nat;
    proposalId : ?Nat;
    model : Text;
    instructionVersion : Nat;
    inputSha256 : Text;
    outputSha256 : ?Text;
    inputBytes : Nat;
    promptTokens : Nat;
    completionTokens : Nat;
    cachedTokens : Nat;
    reservedCents : Nat;
    costCents : Nat;
    cycles : Nat;
    startedAt : Int;
    endedAt : ?Int;
    state : Types.AiCallState;
    fellBack : Bool;
    extra : Types.Extra;
  };
};
