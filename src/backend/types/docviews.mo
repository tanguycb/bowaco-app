// Views van stap 2.7 (PDF, voorwaarden, akkoord van de klant). Gedeelde vormen zonder `var` (D7). De views voor de klant
// (My…) hebben bewust GEEN veld voor een aankoopprijs, een marge, de reden van een marge, een interne notitie, een bibliotheek-id
// of de kopie-verwijzing: wat er niet in het type staat, kan niet lekken (tests/review.mjs G1 controleert het in de .did).
import Types "../types";
import FormViews "formviews";

module {
  type Address = Types.Address;

  // Wat naast de inhoud op de offerte staat. frozen = vastgelegd bij het versturen (valt onder de hash); anders de
  // huidige instellingen (voorbeeld van een ontwerp).
  public type QuoteDocInfo = {
    frozen : Bool;
    issuer : Text;
    clientName : Text;
    clientAddress : ?Address;
    clientVat : ?Text;
    workCode : Text;
    workName : Text;
    workAddress : Address;
    vatNote : Text;
    paymentDays : Nat;
    validUntil : Nat;
    termsVersion : Nat;
    termsTitle : Text;
    termsText : Text;
    termsProvisional : Bool;
  };

  public type QuoteDigitalView = { at : Int; byName : Text };
  public type QuoteSignedView = { at : Int; byName : Text; fileId : Nat; note : Text };
  public type QuoteAcceptanceView = { hash : Text; digital : ?QuoteDigitalView; signed : ?QuoteSignedView };

  // Voor de klant: zonder de notitie en het bestand van kantoor.
  public type MySignedView = { at : Int; byName : Text };
  public type MyAcceptanceView = { hash : Text; digital : ?QuoteDigitalView; signed : ?MySignedView };

  // Voor kantoor (QuoteRead.doc): de vastgelegde of huidige velden en het akkoord.
  public type QuoteDocView = { info : QuoteDocInfo; acceptance : ?QuoteAcceptanceView; mailed : ?Int };

  public type QuoteTermsView = { id : Nat; version : Nat; title : Text; text : Text; provisional : Bool; note : Text; createdAt : Int; byName : Text };
  public type QuoteTermsInput = { title : Text; text : Text; provisional : Bool; note : Text };
  public type QuoteDocSettings = { issuer : Text; paymentDays : Nat; terms : [QuoteTermsView]; current : QuoteTermsView };
  public type QuoteDocSettingsInput = { issuer : Text; paymentDays : Nat };

  // ── Voor de klant ───────────────────────────────────────────────────────
  public type MyQuoteBrief = {
    quoteId : Nat;
    versionId : Nat;
    number : Text;
    version : Nat;
    title : Text;
    workName : Text;
    status : Types.QuoteStatus;
    sentAt : Int;
    validUntil : Nat;
    expired : Bool;
    newerExists : Bool; // er is een nieuwere verzonden versie: deze is vervangen
    decidedAt : ?Int;
  };
  public type MyQuoteChapter = { id : Nat; code : Text; title : Text; sellCents : Int };
  public type MyQuoteLine = {
    id : Nat;
    chapterId : Nat;
    kind : Types.QuoteLineKind;
    code : Text;
    title : Text;
    text : Text;
    specRef : Text;
    qtyMilli : Int;
    unit : Text;
    unitName : Text;
    form : Types.ContractForm;
    unitSellCents : ?Int;
    lineSellCents : Int;
  };
  public type MyQuoteRead = {
    quoteId : Nat;
    versionId : Nat;
    number : Text;
    version : Nat;
    status : Types.QuoteStatus;
    title : Text;
    intro : Text;
    vatBp : Nat;
    sentAt : Int;
    hash : Text;
    intact : Bool;
    expired : Bool;
    newerExists : Bool;
    canAnswer : Bool;
    doc : QuoteDocInfo;
    chapters : [MyQuoteChapter];
    lines : [MyQuoteLine];
    subtotalCents : Int;
    vatCents : Int;
    totalCents : Int;
    optionsPlusCents : Int;
    optionsMinusCents : Int;
    acceptance : ?MyAcceptanceView;
    decisionNote : Text;
    form : ?FormViews.MyQuoteForm; // 2c.1 (calcVersion 2): subgroepen, tekstblokken, korting, regietekst, soort
  };
  public type MyQuoteAnswered = { status : Types.QuoteStatus; at : Int; hash : Text };
};
