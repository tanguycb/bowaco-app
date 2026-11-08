// Stap 3.4 + 3.13 (bots via MCP, bouwplan §6, eigenaar 08-11): de fiches van de bots, hun acties (voorstel of zelf gedaan, met
// ongedaan maken), het logboek van de tool-oproepen ZONDER inhoud, de dagtellers en de OAuth-toestand van caffeineai-mcp-server.
// Alles als NIEUW stabiel veld `bots` (deelvorm, M4): niets bestaands wordt verbreed, OldActor = {}. De types staan hier letterlijk;
// enkel OAuth.State komt uit het pakket (vast op 0.1.0 in mops.toml). NOOIT meer wijzigen zodra deze migratie op een canister staat
// die blijft bestaan (M2).
import Map "mo:core/Map";
import OAuth "mo:caffeineai-mcp-server/OAuth";

module {
  type PersonId = Nat;
  type WorkId = Nat;
  type Extra = [(Text, Text)];
  type BotLevel = { #auto; #proposal; #never };
  type Bot = {
    id : Nat;
    name : Text;
    vendor : Text;
    model : Text;
    principal : ?Principal;
    codeHash : ?Blob;
    codeExpiresAt : Int;
    tools : [Text];
    allWorks : Bool;
    works : [WorkId];
    docKinds : [Text];
    callsPerDay : Nat;
    tasks : [(Text, BotLevel)];
    revokedAt : ?Int;
    revokedBy : ?PersonId;
    rev : Nat;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };
  type BotActionKind = {
    #docLink : { fileId : Nat; kind : Text; title : Text };
    #invoiceCheck : { invoiceId : Nat; verdict : Text; remarks : [Text] };
    #other : { tool : Text; data : [(Text, Text)] };
  };
  type BotActionState = { #proposed; #accepted; #rejected; #done; #undone; #failed : Text; #expired };
  type BotAction = {
    id : Nat;
    botId : Nat;
    task : Text;
    workId : ?WorkId;
    action : BotActionKind;
    reason : Text;
    at : Int;
    var state : BotActionState;
    var docId : ?Nat;
    var createdDoc : Bool;
    var appliedAt : ?Int;
    var decidedBy : ?PersonId;
    var decidedAt : ?Int;
    var note : Text;
    var extra : Extra;
  };
  type BotCallOutcome = { #ok; #refused : Text; #error : Text; #limit; #unknown };
  type BotCall = { id : Nat; botId : Nat; tool : Text; workId : ?WorkId; argsSha256 : Text; at : Int; outcome : BotCallOutcome; actionId : ?Nat };
  type BotState = {
    bots : Map.Map<Nat, Bot>;
    byPrincipal : Map.Map<Principal, Nat>;
    byCode : Map.Map<Blob, Nat>;
    actions : Map.Map<Nat, BotAction>;
    log : Map.Map<Nat, BotCall>;
    daily : Map.Map<Text, Nat>;
    oauth : OAuth.State;
  };

  public func migration(_ : {}) : { bots : BotState } {
    {
      bots = {
        bots = Map.empty<Nat, Bot>();
        byPrincipal = Map.empty<Principal, Nat>();
        byCode = Map.empty<Blob, Nat>();
        actions = Map.empty<Nat, BotAction>();
        log = Map.empty<Nat, BotCall>();
        daily = Map.empty<Text, Nat>();
        oauth = OAuth.new();
      };
    };
  };
};
