// De API-vormen van de aankoopfacturen (stap 2c.7, ontwerp 2c §4.7, D7). Kantoor (admin, calculator) ziet de aankoop met bedragen
// enkel via een update-call met een auditregel (PurchaseFullView, PayRow, PurchaseCostView). De werfleider ziet ENKEL de uren per dag
// van zijn werven (HourClaimView: datum, personen, van–tot, pauze, uren op de factuur, uren volgens het werfverslag, verschil; GEEN
// veld met een bedrag, ook niet in de .did). De OA ziet de stand van zijn eigen facturen per factuur (MyPurchaseView, zonder bedrag).
import Types "../types";
import Views "views";
import OV "oaviews";

module {
  public type HourDayInput = { day : Nat; persons : Nat; slots : [Types.TimeSlot]; pauseMin : Nat };
  public type PurchaseLineInput = {
    workId : ?Nat; // null = algemene kost (geen werf)
    kind : Text; // "post" · "regie" · "ploeg" · "transport" · "diesel" · "kmheffing" · "materiaal" · "container" · "machine" · "voorschot" · "aftrek-voorschot" · "andere:<tekst>"
    root : ?Nat;
    description : Text;
    persons : ?Nat; // ploeguren: de ploeg
    qtyMilli : Int;
    unit : Text;
    unitCents : Int;
    amountCents : Int;
    passOn : Bool;
    days : [HourDayInput]; // bij uren: per dag zoals op de factuur
    lineId : ?Nat; // bij verbeteren: de vaste id van de regel (review M2); null = nieuwe regel
  };
  public type PurchaseInput = {
    id : ?Nat; // null = nieuw
    orgId : Nat;
    kind : Types.PurchaseKind;
    number : Text;
    invoiceDay : Nat;
    dueDay : ?Nat;
    discountUntil : ?Nat;
    discountBp : ?Nat;
    periodFrom : ?Nat;
    periodTo : ?Nat;
    vatRegime : Types.OaVatRegime;
    reverseMention : Bool;
    fileId : ?Nat;
    oaStatementFileId : ?Nat;
    oaStatementRef : Text;
    note : Text;
    netCents : Int;
    vatCents : Int;
    totalCents : Int;
    lines : [PurchaseLineInput];
    finalWorkIds : [Nat]; // de laatste factuur van deze OA op die werven (het restvoorschot moet eraf)
  };

  // Zonder bedragen (query): de lijst van kantoor.
  public type PurchaseWorkRef = { workId : Nat; workCode : Text; workName : Text; partId : ?Nat; partStatus : ?Types.OaInvoiceStatus };
  public type PurchaseBrief = {
    id : Nat;
    orgId : Nat;
    orgName : Text;
    kind : Types.PurchaseKind;
    number : Text;
    invoiceDay : Nat;
    dueDay : ?Nat;
    discountUntil : ?Nat;
    status : Types.PurchaseStatus;
    works : [PurchaseWorkRef];
    general : Bool; // regels zonder werf (algemene kost)
    lineCount : Nat;
    hasFile : Bool;
    hasStatement : Bool;
    paidDay : ?Nat;
    withheldDay : ?Nat; // de inhouding is doorgestort
    openClaims : Nat; // dagen met uren die de werfleider nog moet bevestigen
    updatedAt : Int;
    rev : Nat;
  };

  // Met bedragen (update-call, auditregel "bekeek:aankoop").
  public type PurchaseDayView = {
    claimId : Nat;
    day : Nat;
    persons : Nat;
    slots : [Types.TimeSlot];
    pauseMin : Nat;
    hoursMilli : Int;
    reportPersons : Nat;
    reportMilli : Int;
    diffMilli : Int;
    state : Text; // "klopt" · "klopt-niet" · "te-bevestigen" · "geen-vraag"
    reviewNote : Text;
    reviewByName : Text;
    rateCents : ?Int; // het tarief van de werf op die dag
    rateFrom : ?Nat;
    cents : ?Int; // uren × tarief van die dag
  };
  public type PurchaseLineView = {
    index : Nat;
    lineId : Nat;
    workId : ?Nat;
    workCode : Text;
    kind : Text;
    kindName : Text;
    root : ?Nat;
    postTitle : Text;
    description : Text;
    persons : ?Nat;
    qtyMilli : Int;
    unit : Text;
    unitCents : Int;
    amountCents : Int;
    passOn : Bool;
    days : [PurchaseDayView];
    dayCents : ?Int; // Σ per dag (null = geen dagen of een dag zonder tarief)
    agreedCents : ?Int;
    qtyFlags : [OV.OaFlag];
    moneyFlags : [OV.OaFlag];
  };
  public type PurchaseAdvanceView = { workId : Nat; workCode : Text; allowedCents : ?Int; advancedCents : Int; deductedCents : Int; restCents : Int; final : Bool };
  public type PurchaseDecisionView = { at : Int; byName : Text; approved : Bool; reason : Text; flags : Nat };
  public type PurchaseFullView = {
    brief : PurchaseBrief;
    note : Text;
    periodFrom : ?Nat;
    periodTo : ?Nat;
    vatRegime : Types.OaVatRegime;
    reverseMention : Bool;
    oaStatementRef : Text;
    netCents : Int;
    vatCents : Int;
    totalCents : Int;
    discountBp : ?Nat;
    discountCents : ?Int; // korting op het bedrag excl. btw bij betaling vóór de kortingsdag (VOORLOPIG)
    partsNetCents : Int; // Σ excl. btw van de werfdelen (0 zonder werfdelen)
    withholdSocialCents : Int; // inhouding op Σ werfdelen volgens de raadplegingen bij het goedkeuren (review H2)
    withholdFiscalCents : Int;
    sumLinesCents : Int;
    expectedVatCents : ?Int;
    headerFlags : [OV.OaFlag];
    flagCount : Nat; // markeringen van de aankoop zelf (de werfdelen hebben hun eigen controle)
    lines : [PurchaseLineView];
    advances : [PurchaseAdvanceView];
    file : ?Views.FileView;
    statement : ?Views.FileView;
    decision : ?PurchaseDecisionView;
    attestWarnings : [Text];
    finalWorkIds : [Nat];
    canEdit : Bool;
    canDecide : Bool; // zonder werfdelen: goedkeuren of betwisten hier; met werfdelen: per werfdeel (OA-factuur)
    canPay : Bool;
  };

  // Te betalen (update-call, auditregel "bekeek:te-betalen"): eerst wat korting geeft, dan de vervaldag (AC-23).
  // payCents = totaal − korting − inhouding (aan de OA); de inhouding staat apart (door te storten aan RSZ/FOD). warnings: "som-werfdelen"
  // (Σ werfdelen ≠ excl. btw), "inhouding" (nog niet doorgestort).
  public type PayRow = { brief : PurchaseBrief; netCents : Int; totalCents : Int; discountBp : ?Nat; discountCents : ?Int; withholdCents : Int; payCents : Int; text : Text; warnings : [Text] };

  // De kosten van een werf die doorgerekend worden aan de klant (update-call, auditregel "bekeek:doorrekenen"; voedt 2c.5).
  public type PurchaseCostView = { key : Text; purchaseId : Nat; lineId : Nat; number : Text; orgName : Text; day : Nat; kind : Text; kindName : Text; description : Text; unit : Text; qtyMilli : Int; costCents : Int; status : Types.PurchaseStatus };

  // De werfleider: een dag met uren op een factuur van een OA, GEEN bedrag.
  public type HourClaimView = {
    id : Nat;
    workId : Nat;
    workCode : Text;
    workName : Text;
    orgName : Text;
    number : Text;
    invoiceDay : Nat;
    day : Nat;
    persons : Nat;
    slots : [Types.TimeSlot];
    pauseMin : Nat;
    hoursMilli : Int; // op de factuur
    reportPersons : Nat; // volgens het werfverslag
    reportMilli : Int;
    diffMilli : Int; // factuur − werfverslag
    state : Text;
    reviewNote : Text;
    reviewByName : Text;
    reviewedAt : ?Int;
    canReview : Bool;
  };

  // De OA: de stand per factuur (niet per werfdeel) en de dagen waarvan de werfleider zegt dat de uren niet kloppen.
  public type MyDisputedDay = { day : Nat; persons : Nat; hoursMilli : Int; note : Text };
  public type MyPurchaseView = { number : Text; invoiceDay : Nat; status : Types.PurchaseStatus; works : [Text]; decidedAt : ?Int; reason : Text; disputedDays : [MyDisputedDay] };

  public type PurchaseSettings = { askHours : Text; passOn : Bool };
};
