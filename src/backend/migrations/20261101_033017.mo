// Stap 2c.5 (min-meerstaat, ontwerp 2c §4.5 en §9 migratie 4): per werf de regels van kantoor en de voorstellen van de werfleider
// (intern, zonder bedragen), hun prijs (VERTROUWELIJK), wat kantoor aan een automatische regel verandert (uitsluiten, ander hoofdstuk,
// doorrekenen), het regietarief van de werf met datum (VERTROUWELIJK), de versies op datum onder een controlecode, wat erin vastligt
// (VERTROUWELIJK) en het antwoord van de klant. Alles komt als NIEUW stabiel veld `minMeer` (deelvorm, M4). Niets bestaands wordt
// verbreed: OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie op
// een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };
  type Address = { street : Text; number : Text; zip : Text; city : Text; country : Text };
  type MmKind = { #less; #extra; #regie; #cost; #discount; #settle; #invoiced };
  type MmApproval = { #notNeeded; #pending; #quote : Nat; #recorded : { how : Text; day : Day } };
  type MmEntry = {
    id : Nat;
    workId : WorkId;
    chapter : Text;
    root : ?Nat;
    kind : MmKind;
    description : Text;
    unit : Text;
    qtyMilli : Int;
    pctBp : ?Nat;
    day : ?Day;
    approval : MmApproval;
    proposedBy : ?PersonId;
    photoFileId : ?Nat;
    note : Text;
    rev : Nat;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    archiveReason : Text;
    extra : Extra;
  };
  type MmEntryPrice = { entryId : Nat; unitCents : Int; costCents : ?Int; marginBp : ?Nat; orgId : ?OrgId; at : Int; by : PersonId };
  type MmOverride = { key : Text; workId : WorkId; exclude : Bool; chapter : ?Text; passOn : Bool; reason : Text; at : Int; by : PersonId; extra : Extra };
  type MmRegieRate = { fromDay : Day; sellCents : Int; note : Text; at : Int; by : PersonId };
  type MmVersion = {
    id : Nat;
    workId : WorkId;
    number : Nat;
    day : Day;
    hash : Text;
    calcVersion : Nat;
    share : ?{ at : Int; by : PersonId };
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    extra : Extra;
  };
  type MmLineFrozen = {
    chapter : Text;
    source : Text;
    key : Text;
    day : ?Day;
    description : Text;
    unit : Text;
    qtyMilli : Int;
    unitCents : Int;
    offerCents : Int;
    lessCents : Int;
    extraCents : Int;
    counted : Bool;
    approval : Text;
    note : Text;
  };
  type MmChapterTotal = { chapter : Text; offerCents : Int; lessCents : Int; extraCents : Int; balanceCents : Int };
  type MmTotals = {
    offerCents : Int;
    lessCents : Int;
    extraCents : Int;
    balanceCents : Int;
    contractCents : Int;
    invoicedCents : Int;
    toInvoiceCents : Int;
    pendingCents : Int;
    revisionCents : Int;
    vatBp : Nat;
  };
  type MmInvoiced = { title : Text; day : Day; cents : Int; revisionCents : Int };
  type MmFrozen = {
    versionId : Nat;
    number : Nat;
    day : Day;
    issuer : Text;
    clientName : Text;
    workCode : Text;
    workName : Text;
    workAddress : Address;
    quoteRefs : [Text];
    lines : [MmLineFrozen];
    chapters : [MmChapterTotal];
    invoiced : [MmInvoiced];
    totals : MmTotals;
    note : Text;
    extra : Extra;
  };
  type MmAnswer = { versionId : Nat; hash : Text; ok : Bool; note : Text; at : Int; personId : PersonId; principal : Principal; extra : Extra };
  type MinMeerState = {
    entries : Map.Map<Nat, MmEntry>;
    prices : Map.Map<Nat, Confidential<MmEntryPrice>>;
    overrides : Map.Map<Text, MmOverride>;
    regieRates : Map.Map<Nat, Confidential<[MmRegieRate]>>;
    versions : Map.Map<Nat, MmVersion>;
    frozen : Map.Map<Nat, Confidential<MmFrozen>>;
    answers : Map.Map<Nat, MmAnswer>;
    byWork : Map.Map<Nat, [Nat]>;
    versionsByWork : Map.Map<Nat, [Nat]>;
  };

  type OldActor = {};
  type NewActor = { minMeer : MinMeerState };

  public func migration(_ : OldActor) : NewActor {
    {
      minMeer = {
        entries = Map.empty();
        prices = Map.empty();
        overrides = Map.empty();
        regieRates = Map.empty();
        versions = Map.empty();
        frozen = Map.empty();
        answers = Map.empty();
        byWork = Map.empty();
        versionsByWork = Map.empty();
      };
    };
  };
};
