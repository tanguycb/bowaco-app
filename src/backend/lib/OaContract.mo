// Het OA-contract (stap 2c.4, ontwerp 2c §4.4 en §6; VOORLOPIG: AC-16, nog na te kijken door BOWACO en een jurist): de
// overeenkomst onderaanneming uit het sjabloon (Beheer, met versies; versie 0 = de ingebouwde voorlopige tekst) gevuld met de
// firma, de werken (art. 1), de prijs, het voorschot en de betaling (art. 2), de planning (art. 3) en het werfadres. Bij "Klaar
// om te tekenen" ligt alles vast onder een controlecode (AgreementFrozen); de PDF maakt de browser uit wat hier vastligt. Geen
// rechten hier. Een veld {{sleutel}} in de tekst wordt vervangen; een onbekende sleutel blijft staan (zichtbaar in de PDF).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import Config "Config";
import OaDeals "OaDeals";
import Plan "Plan";
import Progress "Progress";

module {
  public func builtinTitle() : Text { "Overeenkomst van onderaanneming" };

  public func builtinText() : Text {
    "Tussen {{bowaco}}, hierna de hoofdaannemer,\n" #
    "en {{firma}}, {{firma.adres}}, ondernemingsnummer {{firma.kbo}}, btw {{firma.btw}}, vertegenwoordigd door {{vertegenwoordiger}}, hierna de onderaannemer,\n" #
    "wordt overeengekomen wat volgt.\n\n" #
    "Artikel 1 – Voorwerp. De hoofdaannemer vertrouwt de onderaannemer de volgende werken toe op de werf {{werf}}, {{werf.adres}}:\n{{werken}}\n\n" #
    "Artikel 2 – Prijs en betaling. {{prijs}} Voorschot: {{voorschot}}. Betaling: {{betaling}}. Regie en bijkomende prestaties volgens de tarieven in de bijlage. Btw verlegd (medecontractant), tenzij anders vermeld.\n\n" #
    "Artikel 3 – Planning. {{planning}} De onderaannemer volgt de planning van de hoofdaannemer en meldt elke vertraging meteen.\n\n" #
    "Artikel 4 – Uitvoering. De werken worden uitgevoerd volgens de regels van de kunst, de plannen en het lastenboek van de werf.\n\n" #
    "Artikel 5 – Veiligheid. De onderaannemer volgt het veiligheids- en gezondheidsplan en de aanwijzingen van de veiligheidscoördinator.\n\n" #
    "Artikel 6 – Verzekeringen. 6.1 De onderaannemer is verzekerd voor zijn burgerlijke aansprakelijkheid en, waar van toepassing, de tienjarige aansprakelijkheid. 6.2 Hij is verzekerd tegen arbeidsongevallen voor zijn personeel. Hij bezorgt de attesten vóór de start.\n\n" #
    "Artikel 7 – Sociale en fiscale verplichtingen. De onderaannemer is in orde met zijn sociale en fiscale verplichtingen (inhoudingsplicht) en registreert de aanwezigheden waar dat moet.\n\n" #
    "Artikel 8 – Meerwerk. Meer- of minwerk enkel na schriftelijk akkoord van de hoofdaannemer.\n\n" #
    "Artikel 9 – Oplevering. De werken worden samen met de hoofdaannemer opgeleverd; restpunten worden binnen de afgesproken termijn hersteld.\n\n" #
    "Artikel 10 – Waarborg. De onderaannemer staat in voor zijn werken zoals de hoofdaannemer tegenover de bouwheer.\n\n" #
    "Artikel 11 – Verderzetting. Verdere onderaanneming enkel met schriftelijk akkoord van de hoofdaannemer.\n\n" #
    "Artikel 12 – Beëindiging. Bij ernstige tekortkoming kan de hoofdaannemer de overeenkomst na ingebrekestelling beëindigen.\n\n" #
    "Artikel 13 – Bijlagen. De lijst van posten met eenheidsprijzen en de tarieven maken deel uit van deze overeenkomst.\n\n" #
    "Artikel 14 – Geschillen. Belgisch recht; bevoegd zijn de rechtbanken van de zetel van de hoofdaannemer.\n";
  };

  // Het sjabloon dat nu geldt: de hoogste niet-gearchiveerde versie, anders de ingebouwde (versie 0, voorlopig).
  public func current(d : Types.OaDealState) : { version : Nat; title : Text; text : Text; provisional : Bool } {
    var best : ?Types.OaContractTemplate = null;
    for (t in d.templates.values()) {
      if (t.archivedAt == null) { switch best { case (?b) { if (t.version > b.version) { best := ?t } }; case null { best := ?t } } };
    };
    switch best { case (?t) { { version = t.version; title = t.title; text = t.text; provisional = t.provisional } }; case null { { version = 0; title = builtinTitle(); text = builtinText(); provisional = true } } };
  };

  public func fill(text : Text, fields : [(Text, Text)]) : Text {
    var out = text;
    for ((k, v) in fields.values()) { out := out.replace(#text("{{" # k # "}}"), v) };
    out;
  };

  public func addressText(a : ?Types.Address) : Text {
    switch a { case (?x) { ([x.street # " " # x.number, x.zip # " " # x.city].map(func(s : Text) : Text = s.trim(#char ' ')).filter(func(s : Text) : Bool = s != "")).values().join(", ") }; case null "" };
  };

  public func payText(a : Types.Agreement) : Text {
    a.paymentDays.toText() # " dagen" # (if (a.endOfMonth) " einde maand" else "") # " na ontvangst van de factuur";
  };

  public func advanceText(a : Types.Agreement, t : ?Types.AgreementTerms) : Text {
    if (a.advanceBp == 0) { return "geen" };
    let pct = (a.advanceBp / 100).toText() # (if (a.advanceBp % 100 != 0) "," # (if (a.advanceBp % 100 < 10) "0" else "") # (a.advanceBp % 100).toText() else "") # " %";
    switch t { case (?x) { switch (x.advanceCents) { case (?c) pct # " (" # Progress.euro(c) # ")"; case null pct } }; case null pct };
  };

  // De controlecode: alles wat vastligt, in een vaste volgorde.
  public func hashOf(f : Types.AgreementFrozen) : Text {
    var s = "bowaco-oa-contract-v1|" # f.agreementId.toText() # "|" # f.contractVersion.toText() # "|" # f.templateVersion.toText() # "|" # f.title # "|" # f.text;
    for ((k, v) in f.fields.values()) { s #= "|F" # k # "=" # v };
    for (p in f.posts.values()) { s #= "|P" # p.root.toText() # ";" # p.title # ";" # p.unit # ";" # p.qtyMilli.toText() # ";" # (switch (p.unitCents) { case (?c) c.toText(); case null "-" }) };
    for (r in f.rates.values()) { s #= "|R" # OaDeals.kindKey(r.kind) # ";" # r.unit # ";" # r.cents.toText() # ";" # r.validFrom.toText() };
    s #= "|T" # (switch (f.totalCents) { case (?c) c.toText(); case null "-" }) # "|V" # f.advanceBp.toText() # ";" # (switch (f.advanceCents) { case (?c) c.toText(); case null "-" });
    OaDeals.hash(s);
  };

  public func planText(cal : Plan.Cal, tasks : [Types.Task]) : Text {
    if (tasks.size() == 0) { return "Start en duur volgens de planning van de werf (nog niet gepland)." };
    var s : Nat = tasks[0].start;
    var e : Nat = 0;
    var days = 0;
    for (t in tasks.values()) { s := Nat.min(s, t.start); e := Nat.max(e, Plan.endDay(cal, t.start, t.workdays)); days += t.workdays };
    "Start op " # Plan.fmtDay(s) # ", einde voorzien op " # Plan.fmtDay(e) # " (" # days.toText() # " werkdagen).";
  };

  public func postsText(posts : [Types.FrozenPost]) : Text {
    if (posts.size() == 0) { return "- volgens de bijlage" };
    let lines = posts.map(func(p : Types.FrozenPost) : Text = "- " # p.title # (if (p.qtyMilli != 0) " (" # qtyText(p.qtyMilli) # " " # p.unit # ")" else ""));
    Text.fromIter(lines.values().join("\n").chars().take(Config.maxContractText / 2));
  };

  public func qtyText(m : Int) : Text {
    let a = Int.abs(m);
    let frac = a % 1000;
    (if (m < 0) "-" else "") # (a / 1000).toText() # (if (frac == 0) "" else "," # trimZeros(pad3(frac)));
  };
  func pad3(n : Nat) : Text { (if (n < 10) "00" else if (n < 100) "0" else "") # n.toText() };
  func trimZeros(t : Text) : Text { t.trimEnd(#char '0') };
};
