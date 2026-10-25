// Views van stap 2.9 (opmeting ter plaatse). Gedeelde vormen zonder `var` (D7). Het gaat over HOEVEELHEDEN: geen enkel
// type hier heeft een veld voor een prijs, een aankoopprijs, een marge of het contract (tests/review.mjs J1 controleert het
// in de .did). Hoeveelheden staan in duizendsten (qtyMilli), verschillen in duizendsten en basispunten (100 bp = 1 %).
import Types "../types";
import Views "views";

module {
  // Wat aan de post hangt: #more = meer dan de VH boven de drempel (meerwerk), #less = minder boven de drempel en de post is
  // volledig opgemeten (minderwerk), #open = minder maar de post is nog niet volledig opgemeten (geen oordeel).
  public type MeasureFlag = { #none; #more; #less; #open };

  public type MeasurePostView = {
    root : Nat; // de sleutel van de post over de versies heen (de lijn van de eerste versie)
    lineId : Nat; // de lijn van de huidige getekende versie (of van de laatste, als de post er niet meer in staat)
    versionId : Nat;
    quoteNumber : Text; // "2026/231"
    versionNo : Nat;
    chapterCode : Text;
    chapterTitle : Text;
    code : Text;
    title : Text;
    unit : Text;
    form : Types.ContractForm;
    option : Bool; // een aanvaarde optie
    inOffer : Bool; // false = de post staat niet meer in de getekende versie (maar er is wel gemeten)
    vhMilli : Int;
    measuredMilli : Int; // alle geldige regels samen (ook de open opmeting)
    closedMilli : Int; // enkel de afgesloten opmetingen
    diffMilli : Int; // gemeten − VH
    diffBp : ?Int; // verschil in % (basispunten) van de VH; null bij een post pro memorie (VH 0)
    flag : MeasureFlag;
    complete : Bool; // de laatste geldige regel zegt "volledig opgemeten"
    entryCount : Nat;
    pendingCount : Nat; // voorstellen van een OA die nog beslist moeten worden
    lastDay : ?Nat;
  };

  public type SurveyBrief = {
    id : Nat;
    number : Nat;
    open : Bool;
    openedAt : Int;
    openedByName : Text;
    closedAt : ?Int;
    closedByName : Text;
    closeNote : Text;
    thresholdBp : ?Nat; // de drempel die bij het afsluiten gold
    entryCount : Nat;
    pendingCount : Nat;
  };

  public type MeasureTotals = { posts : Nat; measuredPosts : Nat; completePosts : Nat; moreCount : Nat; lessCount : Nat; openProposals : Nat };

  // scope: "full" (admin, werfleider, calculator) · "firm" (onderaannemer: enkel de posten van zijn firma) · "closed" (architect of
  // klant met leesrecht: enkel de afgesloten opmetingen, zonder regels, notities of foto's).
  public type MeasureSummaryView = {
    workId : Nat;
    workCode : Text;
    workName : Text;
    scope : Text;
    canWrite : Bool; // regels toevoegen (of voorstellen, zie canPropose)
    canPropose : Bool; // een OA: zijn regels zijn voorstellen ter bevestiging
    canReview : Bool; // voorstellen bevestigen of afwijzen, een opmeting afsluiten, een regel weghalen
    thresholdBp : Nat;
    orgName : Text; // bij "firm": de firma
    posts : [MeasurePostView];
    surveys : [SurveyBrief];
    openSurveyId : ?Nat;
    totals : MeasureTotals;
    quotes : [Text]; // de getekende offerteversies waarop de posten rusten ("2026/231 v2")
    note : Text; // "" · "geen getekende offerte" · "geen posten voor jouw firma"
  };

  // De lijst voor het scherm "Opmeting": de werven waar de beller kan meten of lezen, met de stand.
  public type MeasureWorkBrief = {
    workId : Nat;
    code : Text;
    name : Text;
    address : Types.Address;
    scope : Text;
    posts : Nat;
    measuredPosts : Nat;
    moreCount : Nat;
    lessCount : Nat;
    pending : Nat;
    openSurveyNumber : ?Nat;
    closedSurveys : Nat;
  };

  public type MeasureFileView = { role : Types.MeasureFileRole; file : Views.FileView; thumb : ?Views.FileView; caption : Text };

  public type MeasureEntryView = {
    id : Nat;
    surveyId : Nat;
    surveyNumber : Nat;
    surveyClosed : Bool;
    root : Nat;
    lineId : Nat;
    qtyMilli : Int;
    contributionMilli : Int; // wat deze regel aan het totaal toevoegt (bij een correctie: nieuw − oud)
    day : Nat;
    complete : Bool;
    note : Text;
    files : [MeasureFileView];
    corrects : ?Nat;
    reason : Text;
    status : Text; // "geldig" · "voorstel" · "afgewezen"
    proposedByOrg : Text;
    reviewedByName : Text;
    reviewedAt : ?Int;
    reviewNote : Text;
    byName : Text;
    createdAt : Int;
    blockKey : Text;
    superseded : Bool; // een latere (geldige) correctie vervangt deze waarde
    archived : Bool;
    canRemove : Bool;
    canCorrect : Bool;
  };

  public type MeasurePostDetail = { post : MeasurePostView; text : Text; entries : [MeasureEntryView] };

  // De stand van een afgesloten opmeting: wat 2.10 (vorderingsstaten) gebruikt.
  public type SurveyPostSnapView = {
    root : Nat;
    lineId : Nat;
    quoteNumber : Text;
    chapterCode : Text;
    code : Text;
    title : Text;
    unit : Text;
    vhMilli : Int;
    measuredMilli : Int; // tot en met deze opmeting
    deltaMilli : Int; // enkel in deze opmeting (correcties tellen als nieuw − oud)
    diffMilli : Int;
    diffBp : ?Int;
    flag : MeasureFlag;
    complete : Bool;
  };

  public type SurveyDetail = { survey : SurveyBrief; snapshot : [SurveyPostSnapView]; entries : [MeasureEntryView] };

  public type MeasureSettingsView = { thresholdBp : Nat; oaPropose : Bool; externalRead : Bool };

  // ── Schrijven: offline-opdrachten (de wachtrij van de gsm) ──
  public type MeasureFileIn = { role : Types.MeasureFileRole; file : Views.FileIn; thumb : ?Views.FileIn; caption : Text };
  public type MeasureOp = {
    #open : { workId : Nat }; // de open opmeting van de werf openen (of samenvoegen, of een nieuwe beginnen)
    #entry : { lineId : Nat; qtyMilli : Int; day : Nat; complete : Bool; note : Text; files : [MeasureFileIn]; corrects : ?Nat; reason : Text };
    #review : { entryId : Nat; ok : Bool; note : Text }; // een voorstel van een OA bevestigen of afwijzen
    #remove : { entryId : Nat }; // een regel van een OPEN opmeting weghalen (gearchiveerd, blijft in de geschiedenis)
    #close : { note : Text };
  };
  public type MeasureOpInput = { opId : Text; clientKey : Text; op : MeasureOp };
  // note: "nieuw" · "samengevoegd" (tweede toestel) · "volgende opmeting" (de opmeting was al afgesloten) · "voorstel" (OA)
  public type MeasureOutcome = { #done : { surveyId : Nat; entityId : ?Nat; note : Text }; #err : Text };
  public type MeasureOpResult = { opId : Text; outcome : MeasureOutcome; repeated : Bool };
};
