// De API-vormen van de vorderingsstaten (stap 2.10, D7: opgeslagen vorm ≠ API-vorm). Twee soorten lijnen: `ProgressQtyLine`
// (hoeveelheden en %, GEEN bedrag: wat de werfleider ziet) en `ProgressLineView` (dezelfde lijn met de bedragen erbij in een apart
// record, enkel voor admin en calculator, enkel via een update-call met een auditregel). De klant krijgt enkel de vastgelegde
// lijnen van zijn VERZONDEN staten (verkoopprijzen; een aankoopprijs of marge bestaat in dit domein niet).
import Types "../types";

module {
  public type ProgressHints = {
    measuredMilli : ?Int; // de vaste stand van de laatste afgesloten opmeting tot en met het einde van de periode (2.9)
    measuredSurvey : ?Nat; // het nummer van die opmeting
    hoursMilli : ?Int; // regie-uren tot en met het einde van de periode (1.6), zonder betwiste uren, in duizendsten van een uur
    hoursOpenMilli : Int; // waarvan nog niet bevestigd door de OA (1.7)
    hoursDisputedMilli : Int; // betwist door de OA (niet meegeteld)
    planPctBp : ?Nat; // het % van de taak in de planning (werfverslag)
  };

  public type ProgressQtyLine = {
    root : Nat;
    lineId : Nat;
    versionId : Nat;
    quoteNumber : Text;
    section : Types.ProgressSection;
    basis : Types.ProgressBasis;
    form : Types.ContractForm;
    chapter : Text;
    code : Text;
    title : Text;
    unit : Text;
    inOffer : Bool; // false = de post staat niet meer in de getekende offerte (wel in een vorige staat)
    offerQtyMilli : Int;
    prevPctBp : Nat;
    prevQtyMilli : Int;
    cumPctBp : Nat; // wat geldt: de invoer, of het voorstel
    cumQtyMilli : Int;
    hasInput : Bool; // false = volgt het voorstel
    note : Text;
    hints : ProgressHints;
    flags : [Text]; // "afwijking-opmeting" · "boven-vh" · "lager-dan-vorige" · "uren-betwist" · "uren-open" · "geen-prijs"
  };

  public type ProgressMoney = { unitPriceCents : Int; noPrice : Bool; offerCents : Int; prevCents : Int; cumCents : Int; periodCents : Int; restCents : Int; overVhCents : Int };
  public type ProgressLineView = { q : ProgressQtyLine; m : ProgressMoney };

  public type ProgressFinding = { key : Text; text : Text; block : Bool; count : Nat };

  public type ProgressBrief = {
    id : Nat;
    workId : Nat;
    workCode : Text;
    workName : Text;
    kind : Types.ProgressKind;
    code : Text;
    number : Nat;
    periodFrom : Nat;
    periodTo : Nat;
    status : Types.ProgressStatus;
    billing : Text; // "open" · "klaar" · "gefactureerd"
    prepared : Bool;
    preparedByName : Text;
    sentAt : ?Int;
    credits : ?Nat;
    creditsCode : Text;
    creditedBy : ?Nat;
    creditedByCode : Text;
    answer : ?{ ok : Bool; at : Int };
    updatedAt : Int;
    updatedByName : Text;
    rev : Nat; // bewerkteller: meegeven bij bewaren en versturen (geen stil overschrijven)
  };

  public type ProgressWorkBrief = {
    workId : Nat;
    code : Text;
    name : Text;
    scope : Text; // "full" · "prepare"
    posts : Nat;
    sent : Nat;
    draftId : ?Nat;
    ready : Nat; // klaar voor factuur
    lastCode : Text;
    lastTo : ?Nat;
  };

  // Wat de werfleider ziet (en wat iedereen met de staat ziet zonder bedragen).
  public type ProgressQtyView = {
    brief : ProgressBrief;
    lines : [ProgressQtyLine];
    openSurvey : ?Nat; // er loopt een opmeting die nog niet afgesloten is
    unassignedRegieMilli : Int; // regie-uren op de werf die aan geen regiepost hangen
    scope : Text;
    canEdit : Bool;
    canPrepare : Bool;
    note : Text; // "geen getekende offerte" als er geen posten zijn
  };

  public type ProgressHeader = {
    vatBp : Nat;
    vatNote : Text;
    guarantee : Types.GuaranteeKind;
    retentionBp : Nat; // 0 zonder inhouding
    retentionOnIncl : Bool;
    paymentDays : Nat;
    formula : Text; // de formule als tekst uit het contract ("" = geen prijsherziening)
    model : ?Types.RevisionModel;
    sIndex : ?Nat;
    iIndex : ?Nat;
    contractFound : Bool;
    signedVersion : Text; // "2026/231 v2" of ""
    originalContractCents : ?Int; // het subtotaal van de getekende versie
  };

  public type ProgressDocInfo = {
    issuer : Text;
    clientName : Text;
    clientAddress : ?Types.Address;
    clientVat : ?Text;
    workCode : Text;
    workName : Text;
    workAddress : Types.Address;
    analyticCode : Text;
    vatNote : Text;
    quoteRefs : [Text];
    sendDay : Nat;
    dueDay : Nat;
    paymentDays : Nat;
    guarantee : Types.GuaranteeKind;
    retentionOnIncl : Bool;
    revision : ?Types.ProgressRevisionFrozen;
  };

  public type ProgressAnswerView = { ok : Bool; note : Text; at : Int; byName : Text };

  // Admin en calculator (update-call, auditregel "bekeek:vorderingsstaat").
  public type ProgressFullView = {
    brief : ProgressBrief;
    header : ProgressHeader;
    lines : [ProgressLineView];
    totals : Types.ProgressTotals;
    findings : [ProgressFinding];
    frozen : Bool; // verzonden: alles hieronder komt uit de vastgelegde staat
    intact : Bool; // de vastgelegde inhoud geeft nog dezelfde hash
    hash : Text;
    doc : ?ProgressDocInfo;
    answer : ?ProgressAnswerView;
    reason : Text; // waarom waarschuwingen doorgezet werden
    openSurvey : ?Nat;
    unassignedRegieMilli : Int;
    canEdit : Bool;
    canSend : Bool;
    canCancel : Bool;
    canCredit : Bool;
    canReady : Bool;
    clientMode : Text; // "uit" · "mogelijk" · "vereist"
    clientNote : Text; // de notitie voor de klant (op de PDF)
    note : Text;
  };

  public type ProgressInputOp = { root : Nat; cumPctBp : ?Nat; cumQtyMilli : ?Int; note : Text; clear : Bool };
  public type ProgressExpect = { periodCents : Int; revisionCents : Int; vatCents : Int; totalCents : Int; payableCents : Int };
  // Werfleider: enkel periodTo en lines, nooit expect. Admin en calculator: expect verplicht (de browser rekende mee).
  public type ProgressSaveInput = { periodTo : ?Nat; note : ?Text; setIndexes : Bool; sIndex : ?Nat; iIndex : ?Nat; lines : [ProgressInputOp]; expect : ?ProgressExpect };
  public type ProgressSaved = { rev : Nat };

  public type ProgressSettings = { client : Text; retentionOnIncl : Bool };

  // De klant: zijn verzonden staten (zonder bedragen in de lijst; lezen met een auditregel).
  public type MyProgressBrief = { id : Nat; code : Text; kind : Types.ProgressKind; workName : Text; periodFrom : Nat; periodTo : Nat; sentAt : Int; answered : ?Bool; creditedBy : Bool };
  public type MyProgressRead = {
    id : Nat;
    code : Text;
    kind : Types.ProgressKind;
    creditsCode : Text;
    creditedByCode : Text;
    periodFrom : Nat;
    periodTo : Nat;
    note : Text;
    sentAt : Int;
    hash : Text;
    intact : Bool;
    doc : ProgressDocInfo;
    lines : [Types.ProgressLineFrozen];
    totals : Types.ProgressTotals;
    answer : ?ProgressAnswerView;
    canAnswer : Bool;
    clientMode : Text;
  };

  // De haak naar de facturatie (fase 3, bouwplan §7): wat UBL/Peppol BIS straks nodig heeft. VOORLOPIG; de koppeling zelf
  // (pakket, Peppol) is fase 3.
  public type ProgressInvoiceLine = { id : Text; description : Text; quantityMilli : Int; unitCode : Text; priceCents : Int; amountCents : Int; section : Text };
  public type ProgressInvoiceData = {
    documentType : Text; // "380" factuur · "381" creditnota (UNCL1001)
    number : Text;
    issueDay : Nat;
    dueDay : Nat;
    currency : Text;
    seller : Text;
    buyerName : Text;
    buyerAddress : ?Types.Address;
    buyerVat : ?Text;
    projectRef : Text; // analytische code van de werf
    contractRef : Text; // de getekende offerte(s)
    billingRef : Text; // creditnota: de gecrediteerde staat
    periodFrom : Nat;
    periodTo : Nat;
    taxCategory : Text; // "S" (UNCL5305, standaardtarief, ook 6 %)
    vatBp : Nat;
    taxNote : Text; // de grond voor 6 %
    lines : [ProgressInvoiceLine];
    lineTotalCents : Int;
    chargeCents : Int; // prijsherziening als toeslag (AllowanceCharge)
    taxableCents : Int;
    vatCents : Int;
    totalCents : Int;
    retentionCents : Int;
    payableCents : Int;
    paymentDays : Nat;
    hash : Text;
    billing : Text;
  };
};
