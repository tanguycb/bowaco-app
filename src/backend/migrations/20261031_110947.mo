// Stap 2c.4 (afspraken met de gekozen OA, ontwerp 2c §4.4 en §9 migratie 3): tarieven van een OA met datum, de afspraak per werf
// en firma (intern, zonder bedragen), de prijzen en tarieven van die afspraak en wat in een contractversie vastligt (VERTROUWELIJK),
// het sjabloon van de overeenkomst onderaanneming (versies) en de attesten van een firma met geldig-tot. Alles komt als NIEUW stabiel
// veld `oaDeals` (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk,
// alleen mo:core. NOOIT meer wijzigen zodra deze migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };
  type DocStatus = { #missing; #requested; #received; #approved; #expired; #notApplicable };

  type RateKind = { #regiePerson; #crewHour; #transportHour; #dieselKm; #kmLevy; #containerTon; #machineDay; #other : Text };
  type OaRate = {
    id : Nat;
    orgId : OrgId;
    kind : RateKind;
    unit : Text;
    cents : Int;
    validFrom : Day;
    source : Text;
    ref : Text;
    fileId : ?Nat;
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    archiveReason : Text;
    extra : Extra;
  };
  type AgreementStatus = { #draft; #toSign; #signed; #ended : { at : Int; by : PersonId; reason : Text } };
  type Agreement = {
    id : Nat;
    workId : WorkId;
    orgId : OrgId;
    oaQuoteIds : [Nat];
    roots : [Nat];
    startDay : ?Day;
    status : AgreementStatus;
    advanceBp : Nat;
    paymentDays : Nat;
    endOfMonth : Bool;
    templateVersion : ?Nat;
    contractHash : Text;
    contractVersion : Nat;
    signedFileId : ?Nat;
    rev : Nat;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };
  type AgreedRate = { kind : RateKind; unit : Text; cents : Int; validFrom : Day; fromRateId : ?Nat; note : Text };
  type AgreementTerms = { agreementId : Nat; prices : [(Nat, Int)]; rates : [AgreedRate]; amountCents : ?Int; advanceCents : ?Int; extra : Extra };
  type OaContractTemplate = {
    id : Nat;
    version : Nat;
    title : Text;
    text : Text;
    provisional : Bool;
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };
  type FrozenPost = { root : Nat; title : Text; unit : Text; qtyMilli : Int; unitCents : ?Int };
  type SignedProof = { at : Int; by : PersonId; fileId : Nat; note : Text };
  type AgreementFrozen = {
    agreementId : Nat;
    contractVersion : Nat;
    templateVersion : Nat;
    title : Text;
    text : Text;
    fields : [(Text, Text)];
    posts : [FrozenPost];
    rates : [AgreedRate];
    totalCents : ?Int;
    advanceBp : Nat;
    advanceCents : ?Int;
    hash : Text;
    at : Int;
    by : PersonId;
    signed : ?SignedProof;
    extra : Extra;
  };
  type OrgDoc = {
    id : Nat;
    orgId : OrgId;
    kind : Text;
    title : Text;
    fileId : ?Nat;
    validFrom : ?Day;
    validUntil : ?Day;
    status : DocStatus;
    deliveredBy : ?PersonId;
    checkedBy : ?PersonId;
    checkedAt : ?Int;
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };
  type OaDealState = {
    rates : Map.Map<Nat, Confidential<OaRate>>;
    ratesByOrg : Map.Map<Nat, [Nat]>;
    agreements : Map.Map<Nat, Agreement>;
    agreementKeys : Map.Map<Text, Nat>;
    agreementsByWork : Map.Map<Nat, [Nat]>;
    terms : Map.Map<Nat, Confidential<AgreementTerms>>;
    frozen : Map.Map<Nat, Confidential<AgreementFrozen>>;
    templates : Map.Map<Nat, OaContractTemplate>;
    orgDocs : Map.Map<Nat, OrgDoc>;
    docsByOrg : Map.Map<Nat, [Nat]>;
    notices : Map.Map<Text, Int>;
  };

  type OldActor = {};
  type NewActor = { oaDeals : OaDealState };

  public func migration(_ : OldActor) : NewActor {
    {
      oaDeals = {
        rates = Map.empty();
        ratesByOrg = Map.empty();
        agreements = Map.empty();
        agreementKeys = Map.empty();
        agreementsByWork = Map.empty();
        terms = Map.empty();
        frozen = Map.empty();
        templates = Map.empty();
        orgDocs = Map.empty();
        docsByOrg = Map.empty();
        notices = Map.empty();
      };
    };
  };
};
