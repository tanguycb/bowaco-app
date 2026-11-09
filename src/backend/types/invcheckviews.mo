// De API-vormen van de OA-factuurcontrole (stap 3.10, D7: zonder `var`). Enkel kantoor met het volle zicht op de OA-facturen van die
// werf (Rights.oaInvoiceScope #full: beheerder en calculator). De lijst heeft geen bedragen (query); het resultaat met de bevindingen
// (die bedragen kunnen noemen) komt enkel uit readInvCheck (update-call met auditregel, R38).
import Types "../types";

module {
  public type InvCheckWay = { #bot : Nat; #ai };
  public type InvCheckStart = {
    invoiceId : Nat;
    way : InvCheckWay;
    name : Text;
    mime : Text; // PDF, foto of Peppol-UBL (XML) voor een bot, "text/plain" voor Caffeine AI
    content : Blob; // de bytes van het bestand of de tekst (UTF-8), tijdelijk tot de opdracht afgesloten is
  };
  public type InvCheckBrief = {
    id : Nat;
    invoiceId : Nat;
    workId : Nat;
    name : Text;
    mime : Text;
    size : Nat;
    way : Text; // "bot" · "caffeine"
    botId : ?Nat;
    botName : Text;
    status : Text; // open · voorstel · afgesloten · geannuleerd · mislukt
    reason : Text; // bij afgesloten (goedgekeurd, ingetrokken, gezien) of mislukt
    verdict : Text; // goedkeuren · navragen · weigeren · "" (nog geen voorstel)
    findings : Nat;
    createdAt : Int;
    createdByName : Text;
  };
  public type InvCheckFull = { brief : InvCheckBrief; result : ?Types.InvCheckResult };
  public type InvCheckBot = { id : Nat; name : Text };
  public type InvCheckOutcome = { #seen; #cancelled };
  public type InvCheckAiStep = { status : Text; dry : Bool };
};
