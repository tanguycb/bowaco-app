// De API-vormen van de maandagbriefing (stap 4.4): een overzicht voor de zaakvoerder dat de app zelf samenstelt uit interne gegevens.
// Enkel lezen. GEEN bedragen en geen vertrouwelijke prijzen: de afwijkingen uit de nacalculatie (4.6, met bedragen) worden in de browser
// bij gevoegd (enkel admin en calculator). Dezelfde onderdelen gaan, zonder bedragen, naar een bot (MCP-tool maandagbriefing).
import Types "../types";

module {
  // Eén punt: de werf, een korte titel, een detailregel, een dag (deadline, verval of start) en dagen (tot de dag; negatief = voorbij;
  // bij een voorstel of akkoord: hoe lang het al wacht).
  public type BrItem = { workId : ?Nat; workCode : Text; title : Text; detail : Text; day : ?Nat; days : ?Int };
  // Een onderdeel: `total` telt alles, `items` de eerste (Config.brMaxItems), het dringendste eerst.
  public type BrSection = { key : Text; title : Text; total : Nat; items : [BrItem] };
  public type BriefingView = { day : Nat; monday : Nat; sunday : Nat; sections : [BrSection] };
  public type BrSettings = { aiAmounts : Bool };
  // Wat de zaakvoerder vrijgeeft voor een AI-leverancier (4.4): standaard geen bedragen.
  public type BrAiSettings = { amounts : Bool };
};
