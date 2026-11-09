// De API-vormen van de proefbank (stap 3.5, D7: zonder `var`). Enkel de beheerder (#manageBots) ziet ze. Geen inhoud van bestanden:
// een geval toont de verwijzing (bv. "bestand #12"), de werf en de soort, en per fout geval welke velden fout waren.
import Types "../types";

module {
  public type ProofFieldInfo = { name : Text; help : Text };
  public type ProofTaskInfo = { key : Text; tool : Text; aiKey : Text; fields : [ProofFieldInfo] };
  public type ProofInfo = { tasks : [ProofTaskInfo]; minPct : Nat; minCases : Nat; maxCases : Nat; roundDays : Nat };

  public type ProofSetView = {
    id : Nat;
    task : Text;
    name : Text;
    source : Text;
    cases : Nat;
    works : Nat;
    createdAt : Int;
    archivedAt : ?Int;
    rounds : Nat;
  };

  public type ProofCaseView = { n : Nat; ref : Text; workId : ?Nat; workCode : Text; answer : [(Text, Text)] };

  public type ProofRoundView = {
    id : Nat;
    setId : Nat;
    setName : Text;
    task : Text;
    subject : Types.ProofSubject;
    subjectName : Text;
    vendor : Text;
    model : Text;
    instruction : Text;
    cases : Nat;
    answered : Nat;
    right : Nat;
    counted : Nat;
    pct : Nat;
    passed : Bool;
    latest : Bool; // de laatste gesloten ronde van dit onderwerp voor deze taak (die telt voor Zelf doen)
    state : Types.ProofRoundState;
    startedAt : Int;
    closedAt : ?Int;
  };

  // Eén geval van een ronde: de plaats in de ronde, de verwijzing, verwacht en gegeven (waarden met een leesbaar label), de uitkomst.
  public type ProofValue = { field : Text; value : Text; shown : Text };
  public type ProofRoundCaseView = {
    pos : Nat;
    n : Nat;
    ref : Text;
    expected : [ProofValue];
    given : [ProofValue];
    outcome : ?Types.ProofOutcome; // null = nog geen antwoord (ronde open)
    at : ?Int;
  };

  public type ProofAiStep = { answered : Nat; left : Nat; closed : Bool; dry : Bool };
};
