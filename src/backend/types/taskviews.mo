// De API-vorm van het model van taak en voorstel (stap 4b.5). Enkel voor de beheerder (#manageBots) in deze stap; 4b.6
// (voorstelscherm, wie deed wat) en 4b.7 (assistenten als collega) lezen dezelfde vorm met de rechten van hun scherm.
// GEEN bedragen en geen vrije tekst van een bot: punten met secret = true hebben geen waarde (die staat in het dossier).
// who/by/givenBy/doer: "persoon:<id>", "bot:<id>", "app:caffeine", "app"; de naam erbij: de persoon, of de taak + "(assistent)".
module {
  public type AssistPointView = { key : Text; now : Text; after : Text; source : Text; secret : Bool };
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
  };
  // workId = enkel die werf; openOnly = enkel wacht · bezig · voorstel; kind = enkel die taak ("" = alle); offset/limit: pagina
  // (limit 0 of > Config.taskMaxPage = de grens). Nieuwste eerst.
  public type AssistTaskQuery = { workId : ?Nat; openOnly : Bool; kind : Text; offset : Nat; limit : Nat };
  public type AssistTaskPage = { total : Nat; items : [AssistTaskView] };
};
