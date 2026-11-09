// De API-vormen van de nakijkopdrachten (3.9 OA-offertes controleren + vergelijken, 3.11 offerte nalezen vóór verzending; D7: zonder
// `var`). Enkel kantoor met de prijzen (beheerder en calculator). De lijst heeft geen bedragen (query); het resultaat (keuzes,
// opmerkingen met bedragen) komt enkel uit readAiCheck (update-call met auditregel, R38).
module {
  public type AiCheckTargetIn = { #tender : Nat; #quote : Nat }; // prijsvraag · ontwerpversie van een offerte
  public type AiCheckWay = { #bot : Nat; #ai };
  public type AiCheckStart = { target : AiCheckTargetIn; way : AiCheckWay };
  public type AiCheckBrief = {
    id : Nat;
    workId : Nat;
    kind : Text; // "vergelijking" · "nalezen"
    targetId : Nat;
    way : Text; // "bot" · "caffeine"
    botId : ?Nat;
    botName : Text;
    status : Text; // open · voorstel · afgesloten · geannuleerd · mislukt
    reason : Text;
    verdict : Text; // keuze · geen-keuze · in_orde · opmerkingen · ""
    findings : Nat;
    picks : Nat;
    stale : Bool; // de stand veranderde sinds het voorstel (nieuwe offerte, versie bewaard)
    createdAt : Int;
    createdByName : Text;
  };
  public type AiCheckPickView = { itemId : Nat; pos : Nat; oaQuoteId : ?Nat; orgName : Text; reason : Text };
  public type AiCheckFindingView = { kind : Text; severity : Text; text : Text; pos : ?Nat; cents : ?Int };
  public type AiCheckFull = { brief : AiCheckBrief; summary : Text; confidence : Nat; dry : Bool; picks : [AiCheckPickView]; findings : [AiCheckFindingView] };
  public type AiCheckBot = { id : Nat; name : Text };
  public type AiCheckOutcome = { #seen; #cancelled };
  public type AiCheckAiStep = { status : Text; dry : Bool };
};
