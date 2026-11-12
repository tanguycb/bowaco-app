// De API-vorm van het model van taak en voorstel (stap 4b.5). Enkel voor de beheerder (#manageBots) in deze stap; 4b.6
// (voorstelscherm, wie deed wat) en 4b.7 (assistenten als collega) lezen dezelfde vorm met de rechten van hun scherm.
// GEEN bedragen en geen vrije tekst van een bot: punten met secret = true hebben geen waarde (die staat in het dossier).
// who/by/givenBy/doer: "persoon:<id>", "bot:<id>", "app:caffeine", "app"; de naam erbij: de persoon, of de taak + "(assistent)".
module {
  public type AssistPointView = { key : Text; now : Text; after : Text; source : Text; secret : Bool; adjusted : Bool }; // adjusted (4b.6): anders overgenomen dan voorgesteld
  public type AssistEventView = { at : Int; who : Text; whoName : Text; what : Text };
  public type AssistProposalView = {
    id : Nat;
    by : Text;
    byName : Text;
    at : Int;
    auto : Bool;
    confidence : ?Nat;
    points : [AssistPointView];
    actionId : ?Nat;
    state : Text; // open · aanvaard · aangepast · geweigerd · zelf · ongedaan · vervallen · ingetrokken
    decidedBy : Text;
    decidedByName : Text;
    decidedAt : ?Int;
    undo : Text; // "" (kan niet) · de handeling ("intrekken", "ontkoppelen") · "gedaan"
  };
  public type AssistTaskView = {
    id : Nat;
    key : Text; // "<bron>:<id>", dezelfde sleutel als in Te doen
    kind : Text;
    name : Text; // "Factuurcontrole (assistent)"
    workId : ?Nat;
    workCode : Text;
    subject : Text; // "oa-factuur:12", "prijsvraag:3" …
    givenBy : Text;
    givenByName : Text;
    doer : Text;
    doerName : Text;
    createdAt : Int;
    state : Text; // wacht · bezig · voorstel · klaar · mislukt · geannuleerd
    updatedAt : Int;
    proposal : ?AssistProposalView;
    events : [AssistEventView];
    // 4b.7 (gewone taak aan een collega): de omschrijving, de uiterste dag en de reden bij "mislukt" — enkel in het volle zicht.
    title : Text;
    dueDay : ?Nat;
    reason : Text;
  };
  // workId = enkel die werf; openOnly = enkel wacht · bezig · voorstel; kind = enkel die taak ("" = alle); offset/limit: pagina
  // (limit 0 of > Config.taskMaxPage = de grens). Nieuwste eerst.
  public type AssistTaskQuery = { workId : ?Nat; openOnly : Bool; kind : Text; offset : Nat; limit : Nat };
  public type AssistTaskPage = { total : Nat; items : [AssistTaskView] };

  // 4b.6: het voorstelscherm en "wie deed wat" voor wie het bronscherm heeft (Rights.taskSight). full = false: enkel soort, stand,
  // wie en de tijdlijn (points = [], subject = "", confidence = null, actionId = null, undo = ""). key = één taak ("" = alle);
  // subject = enkel taken over dat stuk ("oa-factuur:12", "prijsvraag:3", "offerteversie:7"; "" = alle).
  public type AssistTaskForQuery = { workId : ?Nat; key : Text; subject : Text; openOnly : Bool; kind : Text; offset : Nat; limit : Nat };
  public type AssistTaskSeen = { task : AssistTaskView; full : Bool; subjectLabel : Text };
  public type AssistTaskSeenPage = { total : Nat; items : [AssistTaskSeen] };

  // ── 4b.7: een taak geven en de assistenten ──
  // Een gewone taak aan een collega: de omschrijving (≤ Config.taskTitleMax), de werf (mag leeg) en de uiterste dag (mag leeg).
  public type GiveTaskInput = { doerId : Nat; workId : ?Nat; title : Text; dueDay : ?Nat };
  // 4b.8 (vraag E-1 van 4b.7): een vrije taak aan een assistent (enkel de beheerder).
  public type GiveBotTaskInput = { botId : Nat; workId : ?Nat; title : Text; dueDay : ?Nat };
  // wat de uitvoerder met zijn taak doet: "bezig" · "klaar" · "kan-niet" (met reden); de gever of de beheerder: "annuleren".
  public type TaskStep = { #start; #done; #cannot; #cancel };
  // Een collega die een taak kan krijgen (intern, actief, ziet de werf als die er is).
  public type Colleague = { id : Nat; name : Text };
  // Een assistent in de woorden van het scherm: de taak + "assistent"; de score van de proefbank (laatste gesloten ronde, het beste van
  // alle koppelingen); open = taken in wacht, bezig of voorstel; failed = mislukt de laatste 30 dagen. Geen leverancier, model of fiche.
  public type AssistantCard = {
    kind : Text;
    name : Text;
    word : Text;
    score : ?Nat;
    cases : Nat;
    passed : Bool;
    open : Nat;
    failed : Nat;
  };
};
