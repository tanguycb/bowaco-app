// Stap 2c.1 (de offerte zoals Alexis ze maakt, ontwerp 2c §4.1 en §9 migratie 1): offertesoort, wat de klant ziet,
// subgroepen per hoofdstuk, lijnvorm en tekstblokken (intern), en apart VERTROUWELIJK de margeklassen, hun koppeling aan een
// bibliotheekhoofdstuk of een firma en per versie de marges, het regietarief en de korting; bij het versturen bruto, korting
// en de tekstblokken. Alles komt als NIEUW stabiel veld `quoteForms` (deelvorm, M4). Niets bestaands wordt verbreed:
// OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie op
// een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };

  type QuoteKind = { #standard; #damage; #extraWork; #regie };
  type QuoteFormInfo = { quoteId : Nat; kind : QuoteKind; baseQuoteId : ?Nat; insurerOrgId : ?OrgId; claimRef : Text; updatedAt : Int; updatedBy : PersonId; extra : Extra };
  type QuoteVersionForm = { versionId : Nat; hideZeroLines : Bool; regieText : Bool; textBlockKeys : [Text]; extra : Extra };
  type QuoteSubgroup = { id : Nat; versionId : Nat; chapterId : Nat; title : Text; order : Nat; copiedFrom : ?Nat; archivedAt : ?Int };
  type QuoteLineForm = { lineId : Nat; subgroupId : ?Nat; showToClient : ?Bool; textBlockKey : ?Text };
  type TextBlockPlace = { #top; #end; #chapter : Text };
  type TextBlock = { key : Text; title : Text; text : Text; defaultOn : Bool; place : TextBlockPlace; order : Nat; version : Nat; updatedAt : Int; updatedBy : PersonId; archivedAt : ?Int; extra : Extra };
  type MarginClass = { id : Nat; name : Text; marginBp : Nat; note : Text; createdAt : Int; createdBy : PersonId; updatedAt : Int; updatedBy : PersonId; archivedAt : ?Int; extra : Extra };
  type MarginClassLink = { key : Text; classId : Nat; at : Int; by : PersonId };
  type QuoteMarginPick = { classId : ?Nat; marginBp : Nat };
  type QuoteRegie = { orgId : ?OrgId; costCents : Int; sellCents : Int; fromRateId : ?Nat };
  type QuoteDiscount = { #amount : Int; #percent : Nat };
  type QuoteVersionTerms = {
    versionId : Nat;
    chapterMargins : [(Nat, QuoteMarginPick)];
    orgMargins : [(OrgId, QuoteMarginPick)];
    regie : ?QuoteRegie;
    discount : ?QuoteDiscount;
    discountText : Text;
    extra : Extra;
  };
  type QuoteSentBlock = { key : Text; title : Text; text : Text; place : TextBlockPlace };
  type QuoteSentExtra = { versionId : Nat; grossCents : Int; discountCents : Int; blocks : [QuoteSentBlock]; extra : Extra };
  type QuoteFormState = {
    info : Map.Map<Nat, QuoteFormInfo>;
    versionForms : Map.Map<Nat, QuoteVersionForm>;
    subgroups : Map.Map<Nat, QuoteSubgroup>;
    subgroupsByVersion : Map.Map<Nat, [Nat]>;
    lineForms : Map.Map<Nat, QuoteLineForm>;
    textBlocks : Map.Map<Text, TextBlock>;
    classes : Map.Map<Nat, Confidential<MarginClass>>;
    classLinks : Map.Map<Text, Confidential<MarginClassLink>>;
    versionTerms : Map.Map<Nat, Confidential<QuoteVersionTerms>>;
    sentExtra : Map.Map<Nat, QuoteSentExtra>;
  };

  type OldActor = {};
  type NewActor = { quoteForms : QuoteFormState };

  public func migration(_ : OldActor) : NewActor {
    {
      quoteForms = {
        info = Map.empty();
        versionForms = Map.empty();
        subgroups = Map.empty();
        subgroupsByVersion = Map.empty();
        lineForms = Map.empty();
        textBlocks = Map.empty();
        classes = Map.empty();
        classLinks = Map.empty();
        versionTerms = Map.empty();
        sentExtra = Map.empty();
      };
    };
  };
};
