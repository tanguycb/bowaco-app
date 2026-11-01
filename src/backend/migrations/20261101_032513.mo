// Stap 2c.7 (OA-facturen zoals ze binnenkomen, ontwerp 2c §4.7 en §9 migratie 6): aankoopfacturen van OA's en leveranciers over
// één of meer werven (intern, zonder bedragen), hun regels en bedragen (VERTROUWELIJK), de uren per dag als vraag aan de werfleider
// (zonder bedrag) en de OA-voorschotten met hun aftrekken (VERTROUWELIJK). Alles komt als NIEUW stabiel veld `purchases`
// (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {} (een werfdeel is een gewone OA-factuur van 2.11). Zelfstandig (M4):
// de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie op een canister staat die blijft bestaan
// (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };
  type OaVatRegime = { #reverse; #normal : Nat };
  type TimeSlot = { fromMin : Nat; toMin : Nat };

  type CostKind = { #post; #regie; #crew; #transportHour; #dieselKm; #kmLevy; #material; #containerTon; #machineHire; #advance; #advanceDeduct; #other : Text };
  type PurchaseStatus = { #registered; #checking; #approved; #disputed; #withdrawn };
  type PurchaseKind = { #oa; #supplier; #other };
  type PurchaseDecision = { at : Int; by : PersonId; approved : Bool; reason : Text; flags : Nat };

  type Purchase = {
    id : Nat;
    orgId : OrgId;
    kind : PurchaseKind;
    number : Text; // het factuurnummer van de firma
    invoiceDay : Day;
    dueDay : ?Day;
    discountUntil : ?Day; // uiterste betaaldag voor de betaalkorting (het percentage staat bij de bedragen)
    periodFrom : ?Day; // de periode van de prestaties (voor de werfdelen)
    periodTo : ?Day;
    vatRegime : OaVatRegime;
    reverseMention : Bool;
    fileId : ?Nat; // de factuur (vertrouwelijk bestand)
    oaStatementFileId : ?Nat; // de vorderingsstaat van de OA als tweede bijlage (vertrouwelijk bestand)
    oaStatementRef : Text;
    status : PurchaseStatus;
    parts : [Nat]; // de werfdelen (OA-facturen van 2.11), één per werf
    decision : ?PurchaseDecision;
    creditOf : ?Nat; // een creditnota op deze aankoop (later)
    paidDay : ?Day;
    note : Text; // intern
    source : Text; // "hand" · later "peppol" (fase 3)
    externalRef : Text;
    rev : Nat;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra; // "slot:<werf>" = "ja": de laatste factuur van deze OA op die werf (restvoorschot)
  };

  type PurchaseLine = {
    workId : ?WorkId;
    kind : CostKind;
    root : ?Nat;
    description : Text;
    persons : ?Nat;
    qtyMilli : Int;
    unit : Text;
    unitCents : Int;
    amountCents : Int;
    passOn : Bool; // doorrekenen aan de klant (min-meerstaat, 2c.5)
    claimIds : [Nat]; // de dagen met uren (HourClaim)
  };
  type PurchaseAmounts = { purchaseId : Nat; netCents : Int; vatCents : Int; totalCents : Int; discountBp : ?Nat; lines : [PurchaseLine]; extra : Extra };

  type HourClaimReview = { by : PersonId; at : Int; ok : Bool; note : Text };
  type HourClaim = {
    id : Nat;
    purchaseId : Nat;
    workId : WorkId;
    orgId : OrgId;
    day : Day;
    persons : Nat;
    slots : [TimeSlot];
    pauseMin : Nat; // pauze per persoon
    hoursMilli : Int; // personen × (som van de tijdvakken − pauze)
    review : ?HourClaimReview;
    extra : Extra;
  };

  type OaAdvance = { agreementId : Nat; purchaseId : Nat; cents : Int; deducted : [(Nat, Int)] };

  type PurchaseState = {
    purchases : Map.Map<Nat, Purchase>;
    amounts : Map.Map<Nat, Confidential<PurchaseAmounts>>; // vertrouwelijk; sleutel = aankoop
    claims : Map.Map<Nat, HourClaim>;
    advances : Map.Map<Nat, Confidential<OaAdvance>>; // vertrouwelijk; sleutel = het werfdeel van het voorschot (index, herrekend)
    keys : Map.Map<Text, Nat>; // "<firma>:<NUMMER>" → aankoop (index)
    byWork : Map.Map<Nat, [Nat]>; // werf → aankopen (index)
    claimsByWork : Map.Map<Nat, [Nat]>; // werf → uren (index)
    partOf : Map.Map<Nat, Nat>; // werfdeel (OA-factuur) → aankoop (index)
  };

  type OldActor = {};
  type NewActor = { purchases : PurchaseState };

  public func migration(_ : OldActor) : NewActor {
    {
      purchases = {
        purchases = Map.empty();
        amounts = Map.empty();
        claims = Map.empty();
        advances = Map.empty();
        keys = Map.empty();
        byWork = Map.empty();
        claimsByWork = Map.empty();
        partOf = Map.empty();
      };
    };
  };
};
