// De API-vormen van de min-meerstaat (stap 2c.5, ontwerp 2c §4.5, D7). Drie soorten, elk met een eigen type zodat de .did-controle
// (tests/minmeer-2c5.mjs, tests/lek.mjs) mechanisch kan nakijken wat wie krijgt:
// · ZONDER bedragen: `MinMeerQtyView` (de werfleider van de werf: regels in hoeveelheden en uren, zijn voorstellen), `MmVersionBrief`,
//   `MyMinMeerBrief`. Geen enkel veld met cents, prijs of marge.
// · MET bedragen, ook kostprijzen, marges en OA-namen (admin, calculator; enkel via update-calls met auditregel, R23/G3):
//   `MinMeerFullView`, `MmVersionRead`, `MmSettingsView`.
// · De klant (en de architect met de grant vorderingsstaten): `MyMinMeerRead` = een GEDEELDE versie met verkoopbedragen, zonder
//   sleutels, kostprijzen, marges of OA-namen.
import Types "../types";

module {
  type Day = Types.Day;

  // ── Zonder bedragen ──────────────────────────────────────────────────────
  public type MmPostRef = { root : Nat; chapter : Text; title : Text; unit : Text; form : Types.ContractForm; quoteNumber : Text };
  public type MmQtyRow = {
    key : Text;
    sourceText : Text;
    chapter : Text;
    day : ?Day;
    description : Text;
    unit : Text;
    qtyMilli : Int;
    counted : Bool;
    approval : Text;
    flags : [Text];
    entryId : ?Nat;
    mine : Bool; // een voorstel van de beller zelf
  };
  public type MmVersionBrief = { id : Nat; number : Nat; day : Day; isShared : Bool; sharedAt : ?Int; answer : ?Bool; createdAt : Int; createdByName : Text; note : Text };
  public type MinMeerQtyView = {
    workId : Nat;
    scope : Text; // "full" · "qty"
    rows : [MmQtyRow];
    versions : [MmVersionBrief];
    posts : [MmPostRef];
    canPropose : Bool;
  };
  public type MyMinMeerBrief = { id : Nat; workId : Nat; workName : Text; number : Nat; day : Day; sharedAt : Int; answered : ?Bool; canAnswer : Bool };

  // ── Invoer ───────────────────────────────────────────────────────────────
  public type MmPriceInput = { unitCents : ?Int; costCents : ?Int; marginBp : ?Nat; orgId : ?Nat };
  public type MmEntryInput = {
    kind : Types.MmKind;
    chapter : Text;
    root : ?Nat;
    description : Text;
    unit : Text;
    qtyMilli : Int;
    pctBp : ?Nat;
    day : ?Day;
    approval : Types.MmApproval;
    photoFileId : ?Nat;
    note : Text;
    price : ?MmPriceInput; // enkel kantoor; null = zonder prijs (voorstel van de werfleider, of nog te prijzen)
  };
  public type MmOverrideInput = { key : Text; exclude : Bool; chapter : ?Text; passOn : Bool; reason : Text };
  public type MmRateInput = { fromDay : Day; sellCents : Int; note : Text };
  public type MmExpect = { balanceCents : Int; toInvoiceCents : Int };
  public type MmSettingsInput = { quoteFromCents : Nat; passOnBp : Nat; passOnByKind : [(Text, Nat)]; client : Text };

  // ── Met bedragen (admin, calculator) ─────────────────────────────────────
  public type MmSettingsView = { quoteFromCents : Nat; passOnBp : Nat; passOnByKind : [(Text, Nat)]; client : Text; costKinds : [(Text, Text)] };
  public type MmCol = { #offer; #less; #extra; #auto };
  public type MmRowView = {
    key : Text;
    source : Text; // "offerte" · "versie" · "opmeting" · "meerwerkofferte" · "regie" · "kost" · "kantoor" · "voorstel" · "afrekening"
    sourceText : Text;
    chapter : Text;
    chapterFrom : Text; // het hoofdstuk vóór een verplaatsing door kantoor ("" = niet verplaatst)
    day : ?Day;
    description : Text; // voor kantoor (met de naam van de OA)
    descriptionClient : Text; // zoals de klant het ziet (zonder OA-namen)
    unit : Text;
    qtyMilli : Int;
    unitCents : Int;
    pctBp : ?Nat;
    col : MmCol;
    counted : Bool;
    approval : Text;
    note : Text;
    entryId : ?Nat;
    root : ?Nat;
    orgName : Text;
    costCents : ?Int; // kostprijs per eenheid (OA-factuur, regietarief van de afspraak, aankoop)
    marginBp : ?Nat;
    excluded : Bool;
    passOn : Bool;
    inVersion : Bool; // komt in een versie (uitgesloten regels en kosten die niet doorgerekend worden: nee)
    overridable : Bool;
    flags : [Text];
    amountCents : Int;
    offerCents : Int;
    lessCents : Int;
    extraCents : Int;
  };
  public type MmDiscView = { entryId : Nat; chapter : Text; description : Text; pctBp : ?Nat; amountCents : Int; counted : Bool; lessCents : Int };
  public type MmEntryView = {
    id : Nat;
    kind : Types.MmKind;
    chapter : Text;
    root : ?Nat;
    description : Text;
    unit : Text;
    qtyMilli : Int;
    pctBp : ?Nat;
    day : ?Day;
    approval : Types.MmApproval;
    proposedByName : Text;
    photoFileId : ?Nat;
    note : Text;
    rev : Nat;
    price : ?Types.MmEntryPrice;
  };
  public type MmFinding = { key : Text; text : Text; count : Nat };
  public type MmDealRateHint = { orgName : Text; costCents : Int; sellCents : Int; fromDay : Day };
  public type MinMeerFullView = {
    workId : Nat;
    workCode : Text;
    calcVersion : Nat;
    baseQuote : Text; // "2026/412 v1" (de getekende offerte)
    baseQuoteId : ?Nat;
    rows : [MmRowView];
    discs : [MmDiscView];
    invoiced : [Types.MmInvoiced];
    entries : [MmEntryView];
    chapters : [Types.MmChapterTotal];
    totals : Types.MmTotals;
    regieRates : [Types.MmRegieRate];
    regieOffer : ?Int; // het regietarief van de getekende offerte (2c.1), als terugval
    dealRates : [MmDealRateHint]; // 2c.4: het regietarief van de afspraken op deze werf (voorstel, ÷ (1 − regiemarge))
    findings : [MmFinding];
    versions : [MmVersionBrief];
    posts : [MmPostRef];
    quoteFromCents : Nat;
    lastHash : Text; // de controlecode van de laatste versie ("" = nog geen)
  };
  public type MmChange = { kind : Text; chapter : Text; description : Text; balanceDeltaCents : Int }; // "nieuw" · "gewijzigd" · "weg"
  public type MmAnswerView = { ok : Bool; note : Text; at : Int; byName : Text };
  public type MmVersionRead = { brief : MmVersionBrief; hash : Text; intact : Bool; frozen : Types.MmFrozen; changes : [MmChange]; prevNumber : ?Nat; answer : ?MmAnswerView };
  public type MmExtraQuoteMade = { quoteId : Nat; versionId : Nat; number : Text };

  // ── De klant (en de architect met de grant) ──────────────────────────────
  public type MyMmLine = {
    chapter : Text;
    source : Text;
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
  public type MyMinMeerRead = {
    id : Nat;
    number : Nat;
    day : Day;
    hash : Text;
    intact : Bool;
    issuer : Text;
    clientName : Text;
    workCode : Text;
    workName : Text;
    workAddress : Types.Address;
    quoteRefs : [Text];
    note : Text;
    lines : [MyMmLine];
    chapters : [Types.MmChapterTotal];
    invoiced : [Types.MmInvoiced];
    totals : Types.MmTotals;
    changes : [MmChange];
    answer : ?MmAnswerView;
    canAnswer : Bool;
    clientMode : Text;
  };
};
