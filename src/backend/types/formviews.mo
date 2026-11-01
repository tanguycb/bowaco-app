// De API-vormen van de offerte zoals Alexis ze maakt (stap 2c.1, ontwerp 2c §4.1, D7). Twee soorten: `QuoteFormView` (intern,
// GEEN bedrag of marge: soort, subgroepen, wat de klant ziet, tekstblokken; voor elke rol die de offerte mag lezen) en
// `QuoteMarginTermsView` (marges per hoofdstuk en leverancier, klassen, regietarief, korting: enkel admin en calculator, enkel via
// een update-call met een auditregel). De klant krijgt zijn eigen vorm (`MyQuoteForm`): subgroepen, tekstblokken, de
// kortingsregel en de regietekst, nooit een post met hoeveelheid 0 (tenzij "toon toch"), nooit een klasse of marge.
import Types "../types";

module {
  public type QuoteSubgroupView = { id : Nat; chapterId : Nat; title : Text; order : Nat };
  public type QuoteLineFormView = { lineId : Nat; subgroupId : ?Nat; showToClient : ?Bool; shown : Bool };
  public type QuoteBlockView = { key : Text; title : Text; text : Text; place : Types.TextBlockPlace };

  // Intern, zonder bedragen.
  public type QuoteFormView = {
    kind : Types.QuoteKind;
    baseNumber : Text; // 2c.5: een meerwerkofferte: het nummer van de getekende offerte ("bij offerte 2026/412")
    insurerOrgId : ?Nat;
    insurerName : Text;
    claimRef : Text;
    hideZeroLines : Bool;
    regieText : Bool;
    textBlockKeys : [Text];
    blocks : [QuoteBlockView]; // ontwerp: de huidige tekst uit de bibliotheek; verzonden: zoals de klant ze kreeg
    subgroups : [QuoteSubgroupView];
    lineForms : [QuoteLineFormView];
  };

  // Vertrouwelijk (admin, calculator).
  public type MarginClassView = { id : Nat; name : Text; marginBp : Nat; note : Text; archived : Bool; updatedAt : Int };
  public type MarginLinkView = { key : Text; classId : Nat; className : Text; marginBp : Nat };
  public type QuoteMarginView = { id : Nat; classId : ?Nat; className : Text; marginBp : Nat; fixed : Bool }; // fixed = in de versie vastgelegd
  public type QuoteLineBaseView = { lineId : Nat; marginBp : Nat; source : Text }; // "leverancier" · "hoofdstuk" · "standaard" · "eigen" · "regie"
  public type QuoteRegieView = { orgId : ?Nat; orgName : Text; costCents : Int; sellCents : Int; fromRateId : ?Nat }; // 2c.4: het tarief van de OA dat het volgt
  public type QuoteMarginTermsView = {
    chapterMargins : [QuoteMarginView]; // id = hoofdstuk van de versie
    orgMargins : [QuoteMarginView]; // id = firma
    lineBases : [QuoteLineBaseView];
    regie : ?QuoteRegieView;
    regieMarginBp : Nat;
    discount : ?Types.QuoteDiscount;
    discountText : Text;
    classes : [MarginClassView];
    links : [MarginLinkView];
  };

  public type MarginClassesView = { classes : [MarginClassView]; links : [MarginLinkView] };

  public type TextBlockView = { key : Text; title : Text; text : Text; defaultOn : Bool; place : Types.TextBlockPlace; order : Nat; version : Nat; archived : Bool; updatedAt : Int };

  // ── Invoer ──────────────────────────────────────────────────────────────
  public type MarginClassInput = { id : ?Nat; name : Text; marginBp : Nat; note : Text; archived : Bool };
  public type TextBlockInput = { key : Text; title : Text; text : Text; defaultOn : Bool; place : Types.TextBlockPlace; order : Nat; archived : Bool };
  public type QuoteInfoInput = { kind : Types.QuoteKind; insurerOrgId : ?Nat; claimRef : Text };
  public type SubgroupRef = { #id : Nat; #ref : Text };
  public type SubgroupOp = { id : ?Nat; ref : Text; chapterId : Nat; title : Text; order : Nat; remove : Bool };
  public type LineFormOp = { lineId : Nat; subgroup : ?SubgroupRef; showToClient : ?Bool };
  public type MarginPickInput = { id : Nat; classId : ?Nat; marginBp : Nat };
  // 2c.4: followRate = het uurloon volgt het geldende regietarief van de OA (firmafiche); costCents moet er dan aan gelijk zijn.
  public type RegieInput = { orgId : ?Nat; costCents : Int; sellCents : ?Int; followRate : Bool };
  public type QuoteFormInput = {
    hideZeroLines : Bool;
    regieText : Bool;
    textBlockKeys : [Text];
    subgroupOps : [SubgroupOp];
    lineOps : [LineFormOp];
    chapterMargins : [MarginPickInput]; // id = hoofdstuk; enkel wat de versie zelf vastlegt (anders de koppeling)
    regie : ?RegieInput;
    discount : ?Types.QuoteDiscount;
    discountText : Text;
  };
  public type QuoteFormExpect = { subtotalCents : Int; discountCents : Int; totalCents : Int };
  public type QuoteFormSaved = { rev : Nat; refs : [(Text, Nat)] };

  // ── De klant ────────────────────────────────────────────────────────────
  public type MyQuoteForm = {
    kind : Types.QuoteKind;
    baseNumber : Text; // 2c.5: meerwerkofferte bij offerte …
    insurerName : Text;
    claimRef : Text;
    blocks : [QuoteBlockView];
    subgroups : [QuoteSubgroupView];
    lineSubgroups : [(Nat, Nat)]; // lijn → subgroep (enkel de getoonde lijnen)
    grossCents : Int;
    discountCents : Int;
    discountText : Text;
    regieSellCents : ?Int; // enkel als de regietekst aan staat
  };
};
