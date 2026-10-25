// Views van stap 2.8 (offerte → werf). Gedeelde vormen zonder `var` (D7). Het voorstel heeft bewust GEEN veld voor een
// bedrag, een prijs, een aankoopprijs of een marge: de werfleider ziet het voorstel ook (R21, R27), en wat er niet in het
// type staat, kan niet lekken (tests/review.mjs H1 controleert het in de .did). 30bis staat er als ja/nee met de reden.
import Types "../types";

module {
  // De werf: die van de offerte, of een nieuwe (code en naam; asSub = deelwerf van de werf van de offerte).
  public type WorkStartTarget = { #existing; #newWork : { code : Text; name : Text; asSub : Bool } };

  // Wat de werfleider of admin aanpast. Alles is optioneel in de zin dat een lege lijst = het voorstel van de app.
  public type WorkStartInput = {
    target : WorkStartTarget;
    startDay : Nat; // 0 = standaard (de geplande start van de werf, anders de eerste werkdag na vandaag)
    templateKey : Text; // "" = standaardrenovatie
    leaderPersonId : ?Nat; // de werfleider (wisselen: enkel admin)
    lineSteps : [(Nat, Text)]; // lijn → "step:<sleutel>" · "ch" (eigen taak per hoofdstuk) · "skip" (geen taak)
    options : [Nat]; // optielijnen die de klant toch aanvaardde
    groupDays : [(Text, Nat)]; // groep → werkdagen
    skipPermits : [Text]; // vergunningssoorten die geen voorstel worden
    declaration : Bool; // de aangifte van werken klaarzetten als ze nodig is
  };

  // Een lijn van de offerte in het voorstel: in welke groep (taak) ze komt en waarom (hoe de stap gevonden werd).
  public type WorkStartLine = {
    lineId : Nat;
    code : Text;
    title : Text;
    chapter : Text;
    option : Bool;
    qtyMilli : Int;
    unit : Text;
    group : Text; // "step:<sleutel>" · "ch:<hoofdstuk>"
    how : Text; // "bibliotheek" · "titel" · "hoofdstuk" · "vakgebied" · "eigen hoofdstuk" · "gekozen"
    days : ?Nat; // duur uit de bibliotheek (standaardduur of hoeveelheid per werkdag)
    orgName : Text; // standaard-OA uit de bibliotheek
    tradeName : Text;
  };

  // Een taak van het voorstel. existingTaskId = de werf heeft al een taak voor die stap: de lijnen worden eraan gekoppeld.
  public type WorkStartGroup = {
    key : Text;
    title : Text;
    stepKey : ?Text;
    kind : Types.TaskKind;
    trade : ?Text;
    tradeName : Text;
    orgId : ?Nat;
    orgName : Text;
    extraOrgs : [Text];
    workdays : Nat;
    daysFrom : Text; // "bibliotheek" · "sjabloon" · "geschat" · "gekozen" · "bestaande taak"
    leadDays : Nat;
    start : Nat;
    end : Nat;
    after : [Text]; // titels van de voorgangers
    lineIds : [Nat];
    existingTaskId : ?Nat;
    companion : Bool; // levering of mijlpaal uit het sjabloon die meekomt (geen eigen posten)
  };

  public type WorkStartNote = { lineId : Nat; code : Text; title : Text; why : Text };

  public type WorkStartPermit = {
    kind : Text;
    kindName : Text;
    groups : [Text]; // titels van de taken die de vergunning vragen
    reason : Text; // "post «Container 10 m³»" of "taak «…»"
    from : ?Nat;
    to : ?Nat;
    leadDays : Nat;
    deadline : ?Nat; // start − doorlooptijd van de gemeente
    municipality : Text;
    exists : Bool; // de werf heeft al een vergunning van die soort: geen nieuw voorstel
    skipped : Bool;
  };

  public type WorkStartExisting = { id : Nat; title : Text; start : Nat; end : Nat; kind : Types.TaskKind };

  public type WorkStartDone = {
    versionId : Nat;
    status : Text; // "gestart" · "afgewezen"
    at : Int;
    byName : Text;
    workId : Nat;
    workCode : Text;
    newWork : Bool;
    tasks : Nat;
    linked : Nat;
    dependencies : Nat;
    permits : Nat;
    declaration : Text;
    note : Text;
    already : Bool; // dit was al gebeurd (idempotent: niets gewijzigd)
  };

  public type WorkStartCaps = { start : Bool; setLeader : Bool; newWork : Bool };

  public type WorkStartPreview = {
    versionId : Nat;
    quoteId : Nat;
    quoteNumber : Text;
    version : Nat;
    quoteTitle : Text;
    acceptedHow : Text; // "digitaal akkoord van de klant" · "getekende offerte" · "geregistreerd door kantoor"
    sourceWorkId : Nat;
    sourceCode : Text;
    sourceName : Text;
    workId : ?Nat; // de doelwerf (null = nieuw)
    workCode : Text;
    workName : Text;
    workStatus : Types.WorkStatus;
    done : ?WorkStartDone;
    bases : [Text]; // eerdere starts op die werf ("2026/234 v1"): dan is dit meerwerk en telt enkel het verschil
    clientName : Text;
    address : Types.Address;
    vatBp : Nat;
    vatNote : Text;
    leaderPersonId : ?Nat;
    leaderName : Text;
    templateKey : Text;
    templateName : Text;
    templateProvisional : Bool;
    templates : [(Text, Text)];
    steps : [(Text, Text)]; // stappen van het sjabloon (sleutel, titel) voor de keuzelijst per lijn
    startDay : Nat;
    planVersion : Nat;
    groups : [WorkStartGroup];
    existing : [WorkStartExisting];
    existingCount : Nat;
    lines : [WorkStartLine];
    skipped : [WorkStartNote];
    changed : [WorkStartNote];
    removed : [WorkStartNote];
    permits : [WorkStartPermit];
    art30bis : ?Bool;
    art30bisReason : Text;
    checkinatwork : ?Bool;
    oaCount : Nat;
    declarationExists : Bool;
    end : ?Nat;
    warnings : [Text];
    caps : WorkStartCaps;
  };

  // Een aanvaarde versie zonder start of afwijzing (het voorstel "Werf starten").
  public type WorkStartPending = {
    versionId : Nat;
    quoteId : Nat;
    quoteNumber : Text;
    version : Nat;
    title : Text;
    workId : Nat;
    workCode : Text;
    workName : Text;
    acceptedAt : Int;
    acceptedHow : Text;
    meerwerk : Bool;
  };
};
