// Stap 2.4 (offerte-editor): offertes, versies, hoofdstukken en lijnen (intern), en apart de VERTROUWELIJKE prijs per lijn
// (aankoopprijs, verkoopregel, reden) en de standaardmarge per versie. Alles komt als NIEUW stabiel veld `quotes`
// (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen
// mo:core. NOOIT meer wijzigen zodra deze migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };

  type ContractForm = { #fixed; #regie; #vh; #estimate; #budget; #perAttachment };
  type LibSellRule = { #margin : Nat; #price : Int };

  type QuoteStatus = { #draft; #sent; #accepted; #rejected; #superseded; #withdrawn };
  type QuoteLineKind = { #item; #text; #option };

  type Quote = {
    id : Nat;
    workId : WorkId;
    number : Text;
    title : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    archiveReason : Text;
    extra : Extra;
  };

  type QuoteSent = { at : Int; by : PersonId; hash : Text; subtotalCents : Int; vatCents : Int; totalCents : Int; optionsPlusCents : Int; optionsMinusCents : Int };
  type QuoteDecision = { at : Int; by : PersonId; note : Text };

  type QuoteVersion = {
    id : Nat;
    quoteId : Nat;
    version : Nat;
    status : QuoteStatus;
    title : Text;
    vatBp : Nat;
    clientOrgId : ?OrgId;
    validDays : Nat;
    intro : Text;
    note : Text;
    basedOnId : ?Nat;
    rev : Nat;
    calcVersion : Nat;
    sent : ?QuoteSent;
    decision : ?QuoteDecision;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  type QuoteChapter = { id : Nat; versionId : Nat; code : Text; title : Text; order : Nat; libChapterId : ?Nat; archivedAt : ?Int; extra : Extra };

  type QuoteLine = {
    id : Nat;
    versionId : Nat;
    chapterId : Nat;
    order : Nat;
    kind : QuoteLineKind;
    code : Text;
    title : Text;
    text : Text;
    specRef : Text;
    qtyMilli : Int;
    unit : Text;
    form : ContractForm;
    libItemId : ?Nat;
    libItemVersion : ?Nat;
    copiedFrom : ?Nat;
    archivedAt : ?Int;
    extra : Extra;
  };

  type QuoteLinePrice = {
    lineId : Nat;
    versionId : Nat;
    cost : Confidential<?Int>;
    rule : Confidential<?LibSellRule>;
    reason : Confidential<Text>;
    orgId : ?OrgId;
    source : Text;
    libCostId : ?Nat;
    extra : Extra;
  };

  type QuoteVersionConf = { versionId : Nat; standardMarginBp : Confidential<Nat>; extra : Extra };

  type QuotesState = {
    quotes : Map.Map<Nat, Quote>;
    versions : Map.Map<Nat, QuoteVersion>;
    chapters : Map.Map<Nat, QuoteChapter>;
    lines : Map.Map<Nat, QuoteLine>;
    prices : Map.Map<Nat, QuoteLinePrice>;
    versionConf : Map.Map<Nat, QuoteVersionConf>;
    numbers : Map.Map<Text, Nat>;
    byWork : Map.Map<Nat, [Nat]>;
    byQuote : Map.Map<Nat, [Nat]>;
    chaptersByVersion : Map.Map<Nat, [Nat]>;
    linesByVersion : Map.Map<Nat, [Nat]>;
  };

  type OldActor = {};
  type NewActor = { quotes : QuotesState };

  public func migration(_ : OldActor) : NewActor {
    {
      quotes = {
        quotes = Map.empty();
        versions = Map.empty();
        chapters = Map.empty();
        lines = Map.empty();
        prices = Map.empty();
        versionConf = Map.empty();
        numbers = Map.empty();
        byWork = Map.empty();
        byQuote = Map.empty();
        chaptersByVersion = Map.empty();
        linesByVersion = Map.empty();
      };
    };
  };
};
