// De API-vormen van de OA-facturen (stap 2.11, D7). Twee soorten lijnen: `OaLineQty` (hoeveelheden, uren en de markeringen
// daarop, GEEN bedrag: wat de werfleider ziet) en `OaLineView` (dezelfde regel met de bedragen en de prijsmarkeringen in een
// apart record, enkel admin en calculator, enkel via een update-call met een auditregel). De OA ziet enkel de status van zijn
// eigen facturen (MyOaInvoice), als de beheerder dat aanzette.
import Types "../types";
import Views "views";

module {
  public type OaHoursView = { validMilli : Int; openMilli : Int; disputedMilli : Int };

  public type OaInvoiceBrief = {
    id : Nat;
    orgId : Nat;
    orgName : Text;
    workId : Nat;
    workCode : Text;
    workName : Text;
    number : Text;
    invoiceDay : Nat;
    dueDay : ?Nat;
    status : Types.OaInvoiceStatus;
    reverse : Bool; // btw verlegd
    decidedAt : ?Int;
    decidedByName : Text;
    lineCount : Nat;
    hasFile : Bool;
    source : Text;
    updatedAt : Int;
    rev : Nat;
  };

  public type OaLineQty = {
    index : Nat;
    kind : Types.OaInvoiceLineKind;
    root : ?Nat;
    description : Text;
    postTitle : Text;
    unit : Text;
    form : ?Types.ContractForm;
    qtyMilli : Int;
    expectedQtyMilli : ?Int;
    expectedFrom : Text; // "opmeting" · "vh" · "regie-uren" · ""
    prevQtyMilli : Int; // al gefactureerd door deze OA (andere facturen)
    hours : ?OaHoursView;
    flags : [Text]; // enkel hoeveelheden en uren
  };
  public type OaLineMoney = { unitCents : Int; amountCents : Int; agreedCents : ?Int; agreedOrg : Bool; prevCents : Int; flags : [Text] };
  public type OaLineView = { q : OaLineQty; m : OaLineMoney };
  public type OaFlag = { key : Text; text : Text };

  // De werfleider (en wie de factuur ziet zonder bedragen).
  public type OaInvoiceQtyView = { brief : OaInvoiceBrief; periodFrom : ?Nat; periodTo : ?Nat; lines : [OaLineQty]; hoursAll : OaHoursView; oaOnWork : Bool; scope : Text };

  public type OaDecisionView = { at : Int; byName : Text; approved : Bool; reason : Text; withholding : ?Types.OaWithholdingProof; flags : Nat };

  // Admin en calculator (update-call, auditregel "bekeek:oa-factuur").
  public type OaInvoiceFullView = {
    brief : OaInvoiceBrief;
    note : Text;
    periodFrom : ?Nat;
    periodTo : ?Nat;
    vatRegime : Types.OaVatRegime;
    reverseMention : Bool;
    externalRef : Text;
    netCents : Int;
    vatCents : Int;
    totalCents : Int;
    sumLinesCents : Int;
    expectedVatCents : ?Int;
    lines : [OaLineView];
    headerFlags : [OaFlag];
    flagCount : Nat;
    hoursAll : OaHoursView;
    oaOnWork : Bool;
    withholding : Views.OaWithholding; // de stand van de inhoudingsplicht van deze firma (1b.4)
    todayCheck : ?Views.WithholdingCheckView; // een raadpleging van vandaag (verplicht bij goedkeuring, of een uitzondering)
    withholdSocialCents : Int; // in te houden als de raadpleging van vandaag rood is (VOORLOPIG)
    withholdFiscalCents : Int;
    previous : [OaPrevious]; // de andere facturen van deze OA op deze werf
    decision : ?OaDecisionView;
    file : ?Views.FileView;
    canEdit : Bool;
    canDecide : Bool;
    disputeNotice : Text;
  };
  public type OaPrevious = { id : Nat; number : Text; invoiceDay : Nat; status : Types.OaInvoiceStatus; netCents : Int };

  public type OaInvoiceInput = {
    id : ?Nat; // null = nieuw
    orgId : Nat;
    workId : Nat;
    number : Text;
    invoiceDay : Nat;
    dueDay : ?Nat;
    periodFrom : ?Nat;
    periodTo : ?Nat;
    vatRegime : Types.OaVatRegime;
    reverseMention : Bool;
    fileId : ?Nat;
    note : Text;
    netCents : Int;
    vatCents : Int;
    totalCents : Int;
    lines : [Types.OaInvoiceLine];
  };
  public type OaProofInput = { #check : Nat; #exception : Text };

  public type OaPostOption = { root : Nat; title : Text; unit : Text; form : Types.ContractForm; chapter : Text; vhMilli : Int };

  public type OaInvoiceSettings = { thresholdBp : Nat; thresholdCents : Nat; oaView : Bool; disputeNotice : Text };

  // De OA: enkel de status van zijn eigen facturen (en de reden van een betwisting als de beheerder dat zo instelde).
  public type MyOaInvoice = { id : Nat; workName : Text; number : Text; invoiceDay : Nat; status : Types.OaInvoiceStatus; decidedAt : ?Int; reason : Text };
};
