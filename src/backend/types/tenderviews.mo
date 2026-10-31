// De API-vormen van de prijsvragen (stap 2c.2, ontwerp 2c §4.2, D7). Drie soorten, elk met zijn eigen type zodat de .did-controle
// (tests/prijsvraag-2c2.mjs) mechanisch kan nakijken wat wie krijgt:
// · `TenderStatusView` (werfleider van de werf en de lijsten): welke firma's, de status, de deadline. GEEN bedrag, geen notitie.
// · `TenderView` (admin, calculator): de prijsvraag met posten, firma's, bijlagen, notitie, sleutel van de Excel. Zonder bedragen:
//   de bedragen van een OA-offerte komen enkel uit `readOaQuote` (update-call met auditregel, R38).
// · `MyTenderView` (de OA, enkel zijn eigen uitnodiging, R37): posten zonder prijs, werfadres volgens addressMode, contact van
//   BOWACO, deadline, bijlagen, zijn eigen status en uitkomst. Nooit de klant, een andere firma of hun aantal, een prijs van BOWACO.
//   Zijn eigen ontwerp en zijn eigen ingediende prijzen enkel via `readMyTenderAnswer` (update-call met auditregel).
import Storage "mo:caffeineai-object-storage/Storage";
import Types "../types";

module {
  type Day = Types.Day;

  // ── Zonder bedragen ──────────────────────────────────────────────────────
  public type TenderInviteStatusView = {
    id : Nat;
    orgId : Nat;
    orgName : Text;
    contactName : Text;
    status : Types.TenderInviteStatus;
    outcome : Types.TenderOutcome;
    askedDay : ?Day;
    remindedDay : ?Day;
    deadlineDay : Day; // de eigen deadline van de firma, anders die van de prijsvraag
    answeredAt : ?Int;
    channels : [Text];
  };
  public type TenderStatusView = {
    id : Nat;
    workId : Nat;
    workCode : Text;
    workName : Text;
    quoteId : Nat;
    quoteNumber : Text;
    code : Text;
    title : Text;
    status : Types.TenderStatus;
    deadlineDay : Day;
    items : Nat;
    invites : [TenderInviteStatusView];
    createdAt : Int;
  };

  public type TenderItemView = {
    id : Nat;
    pos : Nat; // positie binnen de prijsvraag (1, 2 …): zo spreken de OA en de Excel een post aan
    root : Nat;
    lineId : Nat;
    chapter : Text;
    subgroup : Text;
    code : Text;
    title : Text;
    text : Text;
    unit : Text;
    qtyMilli : Int;
    form : Types.ContractForm;
    order : Nat;
    key : Text;
  };
  public type TenderFileView = { id : Nat; name : Text; mime : Text; size : Nat };
  public type TenderContactView = { name : Text; phone : Text; email : Text };
  public type OaQuoteBrief = {
    id : Nat;
    orgId : Nat;
    orgName : Text;
    tenderId : ?Nat;
    inviteId : ?Nat;
    number : Text;
    quoteDay : Day;
    validUntil : ?Day;
    fileId : ?Nat;
    source : Types.OaQuoteSource;
    version : Nat;
    supersedes : ?Nat;
    current : Bool; // de laatste indiening van die firma op die prijsvraag
    status : Types.OaQuoteStatus;
    vatRegime : Types.OaVatRegime;
    createdAt : Int;
  };
  public type TenderPersonRef = { id : Nat; name : Text; linked : Bool; hasEmail : Bool };
  public type TenderInviteView = {
    id : Nat;
    orgId : Nat;
    orgName : Text;
    contactPersonId : ?Nat;
    contactName : Text;
    contacts : [TenderPersonRef]; // de personen van de firma met de rol onderaannemer (om een contact te kiezen)
    status : Types.TenderInviteStatus;
    outcome : Types.TenderOutcome;
    askedDay : ?Day;
    remindedDay : ?Day;
    ownDeadline : ?Day;
    deadlineDay : Day;
    answeredAt : ?Int;
    declineReason : Text;
    channels : [Text];
    accessCodeId : ?Nat;
    accessState : Text; // "" (geen code) · "open" · "gebruikt" · "ingetrokken" · "verlopen"
    linked : Bool; // de contactpersoon heeft al een actieve login: geen code nodig
    sheetKey : Text;
    ref : Text;
    oaQuotes : [OaQuoteBrief];
    createdAt : Int;
  };
  public type TenderView = {
    id : Nat;
    workId : Nat;
    workCode : Text;
    workName : Text;
    workAddress : Types.Address;
    quoteId : Nat;
    quoteNumber : Text;
    versionId : Nat;
    versionNo : Nat;
    number : Nat;
    code : Text;
    title : Text;
    noteForOa : Text;
    internalNote : Text;
    deadlineDay : Day;
    remindDays : Nat;
    status : Types.TenderStatus;
    files : [TenderFileView];
    addressMode : Types.TenderAddressMode;
    sentHash : Text;
    rev : Nat;
    contact : TenderContactView;
    items : [TenderItemView];
    invites : [TenderInviteView];
    createdAt : Int;
    createdByName : Text;
    updatedAt : Int;
  };

  // Een firma voorstellen (vakgebied, standaard-OA van de posten, eerdere offertes): zonder bedrag.
  public type TenderSuggestion = {
    orgId : Nat;
    orgName : Text;
    kind : Types.OrgKind;
    trades : [Text];
    reasons : [Text]; // "vakgebied" · "standaard-OA" · "eerdere offerte"
    quotes : Nat; // OA-offertes van die firma (alle werven)
    chosen : Nat; // keer gekozen
    lastQuoteDay : ?Day;
    contacts : [TenderPersonRef];
  };

  // ── Invoer (kantoor) ─────────────────────────────────────────────────────
  public type TenderFirmInput = { orgId : Nat; contactPersonId : ?Nat };
  public type TenderInput = {
    versionId : Nat;
    lineIds : [Nat];
    title : Text;
    noteForOa : Text;
    internalNote : Text;
    deadlineDay : Day;
    remindDays : Nat;
    fileIds : [Nat];
    addressMode : Types.TenderAddressMode;
    firms : [TenderFirmInput];
  };
  public type TenderOp = {
    #extend : Day; // de deadline van de hele prijsvraag later zetten
    #cancel : Text; // reden
    #close : [Nat]; // uitnodigingen die gekozen zijn (de rest: bedankt); de keuze per post volgt in 2c.3
    #internalNote : Text;
  };
  public type TenderInviteOp = {
    #markSent : [Text]; // kanalen: "pdf" · "excel" · "app" · "mail"
    #extend : ?Day; // eigen deadline (null = weer die van de prijsvraag)
    #declined : Text; // de firma zei (telefonisch, per mail) "geen interesse"
    #contact : ?Nat;
  };
  public type TenderAccessResult = { code : ?Text; expiresAt : ?Int; alreadyLinked : Bool; personName : Text };

  // ── De OA (zijn eigen uitnodiging) ───────────────────────────────────────
  // Nergens een globaal id of volgnummer (R37 "ook niet hoeveel"): de uitnodiging heet `ref` (willekeurig), een post `pos`
  // (positie binnen de prijsvraag), een bijlage `pos`, een ingediende offerte haar versienummer bij deze uitnodiging.
  public type MyTenderItem = { pos : Nat; chapter : Text; subgroup : Text; code : Text; title : Text; text : Text; unit : Text; qtyMilli : Int; form : Types.ContractForm };
  public type MyTenderAddress = { street : Text; number : Text; zip : Text; city : Text }; // straat en nummer leeg bij "enkel de gemeente"
  public type MyTenderBrief = {
    ref : Text;
    code : Text;
    title : Text;
    place : Text;
    deadlineDay : Day;
    items : Nat;
    status : Types.TenderInviteStatus;
    outcome : Types.TenderOutcome;
    open : Bool; // de prijsvraag loopt nog (niet afgesloten)
    canAnswer : Bool; // nu indienen kan (open en vóór de deadline)
    versions : Nat; // zijn ingediende versies
  };
  public type MyTenderAttachment = { pos : Nat; name : Text; mime : Text; size : Nat };
  public type MyTenderFile = { name : Text; size : Nat };
  public type MyTenderFileOpen = { name : Text; mime : Text; size : Nat; blob : Storage.ExternalBlob };
  public type MyTenderView = {
    ref : Text;
    code : Text;
    title : Text;
    orgName : Text; // zijn eigen firma
    address : MyTenderAddress;
    contact : TenderContactView;
    noteForOa : Text;
    deadlineDay : Day;
    status : Types.TenderInviteStatus;
    outcome : Types.TenderOutcome;
    open : Bool;
    canAnswer : Bool;
    files : [MyTenderAttachment];
    items : [MyTenderItem];
    versions : Nat;
    hasDraft : Bool;
    sentHash : Text;
  };

  // Met bedragen (update-calls met auditregel).
  public type OaLineInput = { pos : ?Nat; description : Text; unit : Text; qtyMilli : Int; unitCents : ?Int; included : Types.OaIncluded; remark : Text };
  public type OaDraftInput = { number : Text; quoteDay : ?Day; validUntil : ?Day; discountBp : ?Nat; reverse : Bool; lines : [OaLineInput]; remark : Text };
  public type MyOaLine = { pos : ?Nat; description : Text; unit : Text; qtyMilli : Int; unitCents : ?Int; amountCents : ?Int; included : Types.OaIncluded; remark : Text; changed : [Text] };
  public type OaDraftView = {
    number : Text;
    quoteDay : ?Day;
    validUntil : ?Day;
    discountBp : ?Nat;
    reverse : Bool;
    lines : [MyOaLine];
    file : ?MyTenderFile;
    remark : Text;
    updatedAt : Int;
    netCents : Int;
  };
  public type MyOaQuoteView = {
    version : Nat;
    current : Bool;
    number : Text;
    quoteDay : Day;
    validUntil : ?Day;
    source : Types.OaQuoteSource;
    status : Types.OaQuoteStatus;
    vatRegime : Types.OaVatRegime;
    createdAt : Int;
    netCents : Int;
    discountBp : ?Nat;
    lines : [MyOaLine];
    chapterTotals : [(Text, Int)];
    remark : Text;
    file : ?MyTenderFile;
  };
  // Kantoor (readOaQuote): met de interne verwijzingen.
  public type OaQuoteFull = { quote : OaQuoteBrief; netCents : Int; discountBp : ?Nat; lines : [Types.OaQuoteLine]; chapterTotals : [(Text, Int)]; remark : Text; file : ?MyTenderFile; fileId : ?Nat };
  public type MyTenderAnswer = { draft : ?OaDraftView; versions : [MyOaQuoteView]; calcVersion : Nat };
  public type MyTenderSaved = { netCents : Int; version : ?Nat };
};
