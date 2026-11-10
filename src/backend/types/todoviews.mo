// De API-vormen van Te doen (stap 4b.1): één lijst per persoon met alles wat op hem wacht, de handeling als knop bij elke regel en
// "uitstellen tot". Enkel lezen (query); GEEN bedragen en geen vertrouwelijke uitkomst van een voorstel (die staan achter de bestaande
// update-calls met auditregel). Vooruit gedacht: een regel heeft een stabiele sleutel "<bron>:<id>" en een bron + nummer (`ref`), zodat
// 4b.5 (één model voor taak en voorstel) en 4b.8 (de leestool `te_doen` voor bots) op dezelfde regels kunnen bouwen.
module {
  // Een handeling als knop. `kind`: "open" (naar `to`) · "gelezen" (meldingen `refs` als gelezen) · "koppeling-bevestigen" (refText
  // = principal) · "bot-aanvaarden" / "bot-weigeren" (voorstel `refs[0]`) · "taak-bevestigen" (toewijzing `refs[0]`, de OA).
  // Nieuwe soorten komen er later bij; een onbekende soort toont de browser als "open".
  public type TodoAct = { kind : Text; text : Text; to : Text; refs : [Nat]; refText : Text };

  // Eén regel.
  // key: stabiel per ding (uitstellen gebruikt hem; een nieuw ding = een nieuwe sleutel).
  // kind: de soort (groep in de lijst), sub: de onderverdeling (bv. het soort melding of voorstel).
  // urgency: 0 nu (te laat, vervallen, geweigerd) · 1 vandaag (wacht op jouw beslissing, binnen 2 dagen) · 2 deze week · 3 later.
  // day: de dag waarop het telt (einde, deadline, vervaldag); age: dagen dat het al wacht.
  // ref: (bron, nummer) van het ding zelf (taak, voorstel, factuur …), voor 4b.5/4b.8.
  // by: wie het klaarzette, als het een assistent was ("Factuurcontrole (assistent)"); anders "".
  // snoozedUntil: enkel in de lijst van het uitgestelde.
  public type TodoItem = {
    key : Text;
    kind : Text;
    sub : Text;
    urgency : Nat;
    day : ?Nat;
    age : Nat;
    workId : ?Nat;
    workCode : Text;
    title : Text;
    detail : Text;
    to : Text;
    acts : [TodoAct];
    ref : (Text, Nat);
    by : Text;
    snoozedUntil : ?Nat;
  };

  // De vraag. day = vandaag in de browser (Config.minDay–maxDay); offset/limit: pagina (limit 0 of > Config.todoMaxPage = de grens);
  // snoozed = enkel wat uitgesteld is; kind = enkel deze soort ("" = alle).
  public type TodoQuery = { day : Nat; offset : Nat; limit : Nat; snoozed : Bool; kind : Text };

  // Het antwoord. total = regels in deze lijst (na de filter), items = de pagina; urgent = regels met urgency 0–1 (de teller in de kop);
  // snoozed = uitgestelde regels; kinds = (soort, aantal) over de hele lijst; capped = een bron had meer dan Config.todoMaxPerSource.
  public type TodoPage = { day : Nat; total : Nat; urgent : Nat; snoozed : Nat; kinds : [(Text, Nat)]; items : [TodoItem]; capped : Bool };
};
