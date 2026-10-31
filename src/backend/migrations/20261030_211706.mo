// Stap 2c.2 (prijsvraag naar onderaannemers, ontwerp 2c §4.2 en §9 migratie 2; ook voor 2c.3, dat geen migratie heeft):
// prijsvragen, de kopie van hun posten, de gevraagde firma's en de OA-offertes (intern), en apart VERTROUWELIJK de bedragen van
// de OA-offertes, het ontwerp van een OA in de app en de keuze per post (2c.3). Alles komt als NIEUW stabiel veld `tenders`
// (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core.
// NOOIT meer wijzigen zodra deze migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };
  type ContractForm = { #fixed; #regie; #vh; #estimate; #budget; #perAttachment };
  type OaVatRegime = { #reverse; #normal : Nat };

  type TenderStatus = { #draft; #open; #closed : { at : Int; by : PersonId }; #cancelled : { at : Int; by : PersonId; reason : Text } };
  type TenderInviteStatus = { #ready; #asked; #reminded; #received; #declined; #noAnswer };
  type TenderOutcome = { #open; #chosen; #thanked : { at : Int; notified : Bool } };
  type TenderAddressMode = { #full; #city };
  type Tender = {
    id : Nat;
    workId : WorkId;
    quoteId : Nat;
    versionId : Nat;
    number : Nat;
    code : Text;
    title : Text;
    noteForOa : Text;
    internalNote : Text;
    deadlineDay : Day;
    remindDays : Nat;
    status : TenderStatus;
    fileIds : [Nat];
    addressMode : TenderAddressMode;
    sentHash : Text;
    rev : Nat;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };
  type TenderItem = {
    id : Nat;
    tenderId : Nat;
    root : Nat;
    lineId : Nat;
    chapter : Text;
    subgroup : Text;
    code : Text;
    title : Text;
    text : Text;
    unit : Text;
    qtyMilli : Int;
    form : ContractForm;
    order : Nat;
    key : Text;
  };
  type TenderInvite = {
    id : Nat;
    tenderId : Nat;
    orgId : OrgId;
    contactPersonId : ?PersonId;
    status : TenderInviteStatus;
    outcome : TenderOutcome;
    askedDay : ?Day;
    remindedDay : ?Day;
    ownDeadline : ?Day;
    answeredAt : ?Int;
    declineReason : Text;
    channels : [Text];
    accessCodeId : ?Nat;
    sheetKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    extra : Extra;
  };
  type OaQuoteSource = { #sheet; #app; #hand };
  type OaQuoteStatus = { #received; #withdrawn : Text };
  type OaQuote = {
    id : Nat;
    workId : WorkId;
    orgId : OrgId;
    tenderId : ?Nat;
    inviteId : ?Nat;
    number : Text;
    quoteDay : Day;
    validUntil : ?Day;
    fileId : ?Nat;
    source : OaQuoteSource;
    version : Nat;
    supersedes : ?Nat;
    status : OaQuoteStatus;
    vatRegime : OaVatRegime;
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    extra : Extra;
  };
  type OaIncluded = { #yes; #no; #alt : Text };
  type OaQuoteLine = {
    itemId : ?Nat;
    description : Text;
    unit : Text;
    qtyMilli : Int;
    unitCents : ?Int;
    amountCents : ?Int;
    included : OaIncluded;
    remark : Text;
    changed : [Text];
  };
  type OaQuoteAmounts = { oaQuoteId : Nat; netCents : Int; discountBp : ?Nat; lines : [OaQuoteLine]; chapterTotals : [(Text, Int)]; remark : Text; extra : Extra };
  type OaQuoteDraft = {
    inviteId : Nat;
    number : Text;
    quoteDay : ?Day;
    validUntil : ?Day;
    discountBp : ?Nat;
    reverse : Bool;
    lines : [OaQuoteLine];
    fileId : ?Nat;
    remark : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };
  type TenderChoice = { itemId : Nat; tenderId : Nat; oaQuoteId : ?Nat; unitCents : ?Int; reason : Text; appliedVersionId : ?Nat; libCostId : ?Nat; at : Int; by : PersonId };
  type TenderState = {
    tenders : Map.Map<Nat, Tender>;
    items : Map.Map<Nat, TenderItem>;
    invites : Map.Map<Nat, TenderInvite>;
    oaQuotes : Map.Map<Nat, OaQuote>;
    amounts : Map.Map<Nat, Confidential<OaQuoteAmounts>>;
    drafts : Map.Map<Nat, Confidential<OaQuoteDraft>>;
    choices : Map.Map<Nat, Confidential<TenderChoice>>;
    byWork : Map.Map<Nat, [Nat]>;
    itemsByTender : Map.Map<Nat, [Nat]>;
    invitesByTender : Map.Map<Nat, [Nat]>;
    invitesByOrg : Map.Map<Nat, [Nat]>;
    oaQuotesByWork : Map.Map<Nat, [Nat]>;
    sheetKeys : Map.Map<Text, Nat>;
  };

  type OldActor = {};
  type NewActor = { tenders : TenderState };

  public func migration(_ : OldActor) : NewActor {
    {
      tenders = {
        tenders = Map.empty();
        items = Map.empty();
        invites = Map.empty();
        oaQuotes = Map.empty();
        amounts = Map.empty();
        drafts = Map.empty();
        choices = Map.empty();
        byWork = Map.empty();
        itemsByTender = Map.empty();
        invitesByTender = Map.empty();
        invitesByOrg = Map.empty();
        oaQuotesByWork = Map.empty();
        sheetKeys = Map.empty();
      };
    };
  };
};
