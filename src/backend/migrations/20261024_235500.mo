// Stap 2.2 (postenbibliotheek): hoofdstukken, posten met hun versies, en apart de VERTROUWELIJKE aankoopprijzen per OA
// en de verkoopregel per post. Alles komt als NIEUW stabiel veld `library` (deelvorm, M4). Niets bestaands wordt verbreed:
// OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie
// op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };

  type ContractForm = { #fixed; #regie; #vh; #estimate; #budget; #perAttachment };

  type LibChapter = {
    id : Nat;
    code : Text;
    title : Text;
    order : Nat;
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type LibItem = {
    id : Nat;
    chapterId : Nat;
    code : Text;
    title : Text;
    text : Text;
    unit : Text;
    form : ContractForm;
    trade : ?Text;
    orgId : ?OrgId;
    durationDays : ?Nat;
    perDayMilli : ?Int;
    planStepKey : ?Text;
    keywords : [Text];
    importKey : ?Text;
    version : Nat;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    archiveReason : Text;
    extra : Extra;
  };

  type LibItemVersion = { id : Nat; itemId : Nat; version : Nat; item : LibItem; at : Int; by : PersonId; fields : Text };

  type LibCost = {
    id : Nat;
    itemId : Nat;
    orgId : ?OrgId;
    day : Day;
    cost : Confidential<Int>;
    source : Text;
    ref : Text;
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    archiveReason : Text;
    extra : Extra;
  };

  type LibSellRule = { #margin : Nat; #price : Int };

  type LibSell = {
    itemId : Nat;
    rule : ?Confidential<LibSellRule>;
    reason : Confidential<Text>;
    version : Nat;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  type LibSellVersion = { id : Nat; itemId : Nat; version : Nat; rule : ?Confidential<LibSellRule>; reason : Confidential<Text>; at : Int; by : PersonId };

  type LibraryState = {
    chapters : Map.Map<Nat, LibChapter>;
    items : Map.Map<Nat, LibItem>;
    itemVersions : Map.Map<Nat, LibItemVersion>;
    importKeys : Map.Map<Text, Nat>;
    costs : Map.Map<Nat, LibCost>;
    costsByItem : Map.Map<Nat, [Nat]>;
    sells : Map.Map<Nat, LibSell>;
    sellVersions : Map.Map<Nat, LibSellVersion>;
  };

  type OldActor = {};
  type NewActor = { library : LibraryState };

  public func migration(_ : OldActor) : NewActor {
    {
      library = {
        chapters = Map.empty();
        items = Map.empty();
        itemVersions = Map.empty();
        importKeys = Map.empty();
        costs = Map.empty();
        costsByItem = Map.empty();
        sells = Map.empty();
        sellVersions = Map.empty();
      };
    };
  };
};
