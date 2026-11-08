// De API-vormen van de bots via MCP (stap 3.4 + 3.13, D7: zonder `var`). Enkel de beheerder (#manageBots) ziet ze.
// Nooit een token, een code-hash of de inhoud van een tool-oproep: het logboek kent enkel tool, werf, hash en uitkomst.
import Types "../types";

module {
  type WorkId = Types.WorkId;
  type PersonId = Types.PersonId;

  public type BotView = {
    id : Nat;
    name : Text;
    vendor : Text;
    model : Text;
    principal : ?Principal;
    codePending : Bool; // er loopt een koppelcode (nog niet gebruikt, niet verlopen)
    codeExpiresAt : Int;
    tools : [Text];
    allWorks : Bool;
    works : [WorkId];
    docKinds : [Text];
    callsPerDay : Nat;
    callsToday : Nat;
    tasks : [(Text, Types.BotLevel)]; // het niveau dat geldt, voor elke taak van Config.botTasks
    openActions : Nat;
    connections : Nat;
    revokedAt : ?Int;
    rev : Nat;
    createdAt : Int;
    updatedAt : Int;
  };

  public type BotInput = {
    id : ?Nat;
    rev : Nat;
    name : Text;
    vendor : Text;
    model : Text;
    tools : [Text];
    allWorks : Bool;
    works : [WorkId];
    docKinds : [Text];
    callsPerDay : Nat;
    tasks : [(Text, Types.BotLevel)];
  };

  public type NewBotCode = { code : Text; expiresAt : Int };

  public type BotToolInfo = { name : Text; task : Text; readOnly : Bool };
  public type BotTaskInfo = { key : Text; maxAuto : Bool };
  public type McpInfo = { signInOrigin : ?Text; tools : [BotToolInfo]; tasks : [BotTaskInfo]; never : [Text] };

  public type BotActionDetail = {
    #docLink : { fileId : Nat; fileName : Text; kind : Text; title : Text };
    #invoiceCheck : { invoiceId : Nat; number : Text; firm : Text; verdict : Text; remarks : [Text] };
    #other : { tool : Text };
  };

  public type BotActionView = {
    id : Nat;
    botId : Nat;
    botName : Text;
    task : Text;
    workId : ?WorkId;
    workCode : Text;
    detail : BotActionDetail;
    reason : Text;
    at : Int;
    state : Types.BotActionState;
    docId : ?Nat;
    createdDoc : Bool;
    appliedAt : ?Int;
    decidedBy : ?PersonId;
    decidedAt : ?Int;
    note : Text;
    canUndo : Bool;
  };

  public type BotCallView = { id : Nat; botId : Nat; botName : Text; tool : Text; workId : ?WorkId; argsSha256 : Text; at : Int; outcome : Types.BotCallOutcome; actionId : ?Nat };

  public type BotConnectionView = { id : Text; clientName : Text; createdAt : Int; expiresAt : Int };

  // Wat de toestemmingspagina /mcp-authorize over de ingelogde identiteit moet weten.
  public type MyBot = { #none; #bot : { name : Text; vendor : Text }; #person; #revoked };
};
