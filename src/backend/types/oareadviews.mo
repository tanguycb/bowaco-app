// De API-vormen van OA-offerte inlezen (stap 3.8, D7: zonder `var`). Enkel kantoor met de bedragen (#editTenders + #readCosts op die
// werf). De lijst heeft geen bedragen (query); het voorstel met de bedragen komt enkel uit readOaRead (update-call met auditregel, R38).
import Storage "mo:caffeineai-object-storage/Storage";
import Types "../types";

module {
  public type OaReadWay = { #bot : Nat; #ai };
  public type OaReadStart = {
    workId : Nat;
    orgId : Nat;
    inviteId : ?Nat; // op een prijsvraag (de firma van de uitnodiging) of null = los
    way : OaReadWay;
    name : Text;
    mime : Text; // PDF of foto voor een bot, "text/plain" voor Caffeine AI
    content : Blob; // de bytes van het bestand of de tekst (UTF-8), tijdelijk tot de opdracht afgesloten is
    blob : ?Storage.ExternalBlob; // het bestand ook in de opslag (vertrouwelijk aan de werf), om het straks bij de offerte te hangen
  };
  public type OaReadBrief = {
    id : Nat;
    workId : Nat;
    orgId : Nat;
    orgName : Text;
    tenderId : ?Nat;
    tenderCode : Text;
    inviteId : ?Nat;
    name : Text;
    mime : Text;
    size : Nat;
    way : Text; // "bot" · "caffeine"
    botId : ?Nat;
    botName : Text;
    status : Text; // open · voorstel · geregistreerd · afgewezen · geannuleerd · mislukt
    reason : Text; // bij afgewezen of mislukt
    oaQuoteId : ?Nat;
    fileId : ?Nat;
    auto : Bool; // door de bot zelf geregistreerd (Zelf doen)
    createdAt : Int;
    createdByName : Text;
    hasProposal : Bool;
  };
  public type OaReadFull = { brief : OaReadBrief; proposal : ?Types.OaReadProposal };
  public type OaReadBot = { id : Nat; name : Text };
  public type OaReadOutcome = { #applied : Nat; #rejected : Text; #cancelled };
  public type OaReadAiStep = { status : Text; dry : Bool };
  public type ProofContentNeed = { n : Nat; oaQuoteId : Nat; fileId : Nat; name : Text; mime : Text; size : Nat; loaded : Bool };
};
