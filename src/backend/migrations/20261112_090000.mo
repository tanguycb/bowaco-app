// Stappen 3.9 (OA-offertes controleren + vergelijken) en 3.11 (nalezen van de klantofferte vóór verzending), bouwplan §6 "Twee
// wegen voor AI": nakijkopdrachten per prijsvraag of per ontwerpversie van een offerte, met het resultaat (keuze per post,
// opmerkingen). Alles als NIEUW stabiel veld `aiCheck` (deelvorm, M4): niets bestaands wordt verbreed, OldActor = {}. De types staan
// hier letterlijk. NOOIT meer wijzigen zodra deze migratie op een canister staat die blijft bestaan (M2).
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type WorkId = Nat;
  type Extra = [(Text, Text)];
  type InvCheckVia = { #bot : Nat; #ai; #other : Text };
  type InvCheckStatus = { #open; #proposed; #closed : Text; #cancelled; #failed : Text; #other : Text };
  type AiCheckTarget = { #tender : Nat; #quote : Nat; #other : Text };
  type AiCheckFinding = { kind : Text; severity : Text; text : Text; ref : ?Nat; cents : ?Int; extra : Extra };
  type AiCheckPick = { itemId : Nat; oaQuoteId : ?Nat; reason : Text };
  type AiCheckResult = { verdict : Text; picks : [AiCheckPick]; findings : [AiCheckFinding]; summary : Text; confidence : Nat; at : Int; extra : Extra };
  type AiCheckJob = {
    id : Nat;
    workId : WorkId;
    target : AiCheckTarget;
    via : InvCheckVia;
    basis : Text;
    createdAt : Int;
    createdBy : PersonId;
    var status : InvCheckStatus;
    var result : ?AiCheckResult;
    var decidedAt : ?Int;
    var decidedBy : ?PersonId;
    var extra : Extra;
  };
  type AiCheckState = {
    jobs : Map.Map<Nat, AiCheckJob>;
    byWork : Map.Map<Nat, [Nat]>;
    extra : Map.Map<Text, Text>;
  };

  public func migration(_ : {}) : { aiCheck : AiCheckState } {
    {
      aiCheck = {
        jobs = Map.empty<Nat, AiCheckJob>();
        byWork = Map.empty<Nat, [Nat]>();
        extra = Map.empty<Text, Text>();
      };
    };
  };
};
