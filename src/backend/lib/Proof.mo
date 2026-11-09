// Proefbank (stap 3.5, bouwplan §6 "Autonomie per taak"; ontwerp: BOWACO_verslag_3.5.md §1).
// - Taken met een proefbank (tasks): de echte tool van de bot, de AI-fiche van Caffeine en de antwoordvelden met hun vergelijking.
// - Testset uit de historiek: wat een INTERNE persoon al koppelde en zo bleef (nooit wat een bot deed: bot-merk = geen waarheid).
// - Een geval toont enkel de invoer (bv. naam, type, grootte van een bestand), NOOIT de verwijzing (id), de werf of het antwoord.
// - Score: alle velden gelijk = juist; geen antwoord = fout; een intussen onbruikbaar geval = vervallen (niet in de noemer).
// - Drempel (gate): de LAATSTE gesloten ronde van dat onderwerp voor die taak, met dezelfde labels als nu, ≥ proofMinPct % op
//   ≥ proofMinCases gevallen. De proefmodus voert nooit iets uit: hier staat geen enkele schrijfactie op werfgegevens.
import Array "mo:core/Array";
import VarArray "mo:core/VarArray";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Text "mo:core/Text";
import Json "mo:jayson/Json";
import Types "../types";
import Config "Config";
import Dossier "Dossier";
import Rights "Rights";

module {
  type Json = Json.Json;

  public type Cmp = { #id; #key };
  public type Field = { name : Text; cmp : Cmp; help : Text };
  public type TaskDef = { key : Text; tool : Text; aiKey : Text; question : Text; fields : [Field] };

  // 3.5: enkel document koppelen. 3.8–3.10 voegen hier hun taak toe (oa-offerte-inlezen, factuurcontrole, oa-offertes-vergelijken),
  // met hun eigen verwijzing (#oaQuote, #oaInvoice) en velden (bv. een bedrag met een marge = een nieuwe Cmp).
  public func tasks() : [TaskDef] {
    [{
      key = "document-koppelen";
      tool = "document_koppelen";
      aiKey = "document-koppelen";
      question = "Bij welke werf en welke documentsoort hoort dit bestand? Gebruik je gewone tools (werven, mijn_fiche, werf_documenten) om te zoeken; je antwoord verandert niets in de app.";
      fields = [
        { name = "werfId"; cmp = #id; help = "Het id van de werf (uit de tool werven)." },
        { name = "soort"; cmp = #key; help = "De sleutel van de documentsoort (uit mijn_fiche)." },
      ];
    }];
  };

  public func task(key : Text) : ?TaskDef { tasks().find(func(t : TaskDef) : Bool = t.key == key) };

  public type Env = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    works : Types.WorksState;
    files : Types.FileState;
    dossier : Types.DossierState;
    proof : Types.ProofState;
  };

  func extraHas(x : Types.Extra, k : Text) : Bool { x.any(func((a, _) : (Text, Text)) : Bool = a == k) };
  public func extraGet(x : Types.Extra, k : Text) : ?Text {
    switch (x.find(func((a, _) : (Text, Text)) : Bool = a == k)) { case (?(_, v)) ?v; case null null };
  };

  func workOk(e : Env, w : Nat) : Bool {
    switch (e.works.works.get(w)) { case (?x) x.archivedAt == null; case null false };
  };

  // Een bestand dat een interne persoon van deze werf oplaadde, niet vertrouwelijk en niet gearchiveerd.
  public func fileOk(e : Env, f : Types.FileRef, workId : Nat) : Bool {
    f.workId == ?workId and f.archivedAt == null and not f.confidential and (switch (e.access.persons.get(f.personId)) { case (?p) Rights.internal(p); case null false });
  };

  // ── Testset uit de historiek ────────────────────────────────────────────
  // document-koppelen: elk bestand dat aan een document hangt dat een mens zo liet (ontvangen of goedgekeurd, geen bot-merk).
  public func buildCases(e : Env, taskKey : Text, max : Nat) : [Types.ProofCase] {
    if (taskKey != "document-koppelen") return [];
    let seen = Map.empty<Nat, ()>();
    let found = List.empty<(Int, Nat, Nat, Text)>(); // (moment, bestand, werf, soort)
    for (d in e.dossier.documents.values()) {
      if (d.archivedAt == null and not d.confidential and (d.status == #received or d.status == #approved) and not extraHas(d.extra, "bot") and workOk(e, d.workId)) {
        switch (Dossier.kind(e.settings, d.kind)) {
          case (?k) if (not k.confidential and not k.archived) {
            for (fid in d.fileIds.values()) {
              switch (e.files.files.get(fid)) {
                case (?f) if (fileOk(e, f, d.workId) and not seen.containsKey(fid)) { seen.add(fid, ()); found.add((f.at, fid, d.workId, k.key)) };
                case null {};
              };
            };
          };
          case null {};
        };
      };
    };
    // Nieuwste eerst, hoogstens max.
    let sorted = found.toArray().sort(func(a : (Int, Nat, Nat, Text), b : (Int, Nat, Nat, Text)) : { #less; #equal; #greater } = if (a.0 > b.0) #less else if (a.0 < b.0) #greater else Nat.compare(b.1, a.1));
    let n = Nat.min(max, sorted.size());
    Array.tabulate<Types.ProofCase>(n, func i {
      let (_, fid, w, k) = sorted[i];
      { n = i + 1; ref = #file(fid); workId = ?w; answer = [("werfId", w.toText()), ("soort", k)] };
    });
  };

  // Kan dit geval (nog) getoond worden? De invoer voor de bot of de AI, of null (= vervallen). Nooit het id, de werf of het antwoord.
  public func caseInput(e : Env, c : Types.ProofCase) : ?Json {
    switch (c.ref) {
      case (#file(fid)) {
        let f = e.files.files.get(fid) ?? return null;
        let w = c.workId ?? return null;
        if (not fileOk(e, f, w) or not workOk(e, w)) return null;
        ?#Object([("bestand", #Object([("naam", #String(f.name)), ("type", #String(f.mime)), ("grootte", #Number(#Int(f.size)))]))]);
      };
      case _ null;
    };
  };

  public func refText(r : Types.ProofRef) : Text {
    switch r { case (#file(x)) "bestand #" # x.toText(); case (#doc(x)) "document #" # x.toText(); case (#oaQuote(x)) "OA-offerte #" # x.toText(); case (#oaInvoice(x)) "OA-factuur #" # x.toText(); case (#other(t)) t };
  };

  // ── Vergelijken ─────────────────────────────────────────────────────────
  public func norm(cmp : Cmp, v : Text) : Text {
    let t = v.trim(#char ' ');
    switch cmp {
      case (#id) {
        // "0012" en "12" zijn hetzelfde id; iets anders dan cijfers blijft zoals het is (en is dus fout).
        switch (Nat.fromText(t)) { case (?n) n.toText(); case null t };
      };
      case (#key) t.toLower();
    };
  };

  public func answerOf(xs : [(Text, Text)], k : Text) : Text {
    switch (xs.find(func((a, _) : (Text, Text)) : Bool = a == k)) { case (?(_, v)) v; case null "" };
  };

  public func compare(def : TaskDef, truth : [(Text, Text)], given : [(Text, Text)]) : Types.ProofOutcome {
    let wrong = List.empty<Text>();
    for (f in def.fields.values()) {
      let g = answerOf(given, f.name);
      if (g == "" or norm(f.cmp, g) != norm(f.cmp, answerOf(truth, f.name))) wrong.add(f.name);
    };
    if (wrong.isEmpty()) #right else #wrong(wrong.toArray());
  };

  // ── Rondes ──────────────────────────────────────────────────────────────
  public func answersOf(ps : Types.ProofState, roundId : Nat) : Map.Map<Nat, Types.ProofAnswer> {
    switch (ps.answers.get(roundId)) {
      case (?m) m;
      case null { let m = Map.empty<Nat, Types.ProofAnswer>(); ps.answers.add(roundId, m); m };
    };
  };

  public func caseOf(set : Types.ProofSet, n : Nat) : ?Types.ProofCase { set.cases.find(func(c : Types.ProofCase) : Bool = c.n == n) };

  public func sameSubject(a : Types.ProofSubject, b : Types.ProofSubject) : Bool {
    switch (a, b) { case (#bot(x), #bot(y)) x == y; case (#ai(x), #ai(y)) x == y; case _ false };
  };

  public func openRoundOf(ps : Types.ProofState, s : Types.ProofSubject) : ?Types.ProofRound {
    switch s {
      case (#bot(id)) switch (ps.openByBot.get(id)) { case (?r) ps.rounds.get(r); case null null };
      case _ ps.rounds.values().find(func(r : Types.ProofRound) : Bool = r.state == #open and sameSubject(r.subject, s));
    };
  };

  // Sluiten: elk geval zonder antwoord wordt "geen antwoord" (fout) of "vervallen" (intussen onbruikbaar); de score wordt vast.
  public func close(e : Env, r : Types.ProofRound, by : ?Nat, now : Int, cancel : Bool) {
    if (r.state != #open) return;
    let ans = answersOf(e.proof, r.id);
    if (not cancel) {
      switch (e.proof.sets.get(r.setId)) {
        case (?set) {
          for (n in r.cases.values()) {
            if (not ans.containsKey(n)) {
              let usable = switch (caseOf(set, n)) { case (?c) caseInput(e, c) != null; case null false };
              ans.add(n, { n; given = []; at = now; outcome = if usable #none else #void("onbruikbaar") });
            };
          };
        };
        case null {};
      };
    };
    var right = 0;
    var counted = 0;
    for (a in ans.values()) {
      switch (a.outcome) { case (#right) { right += 1; counted += 1 }; case (#wrong(_) or #none) counted += 1; case _ {} };
    };
    r.right := right;
    r.counted := counted;
    r.state := if cancel #cancelled else #closed;
    r.closedAt := ?now;
    r.closedBy := by;
    switch (r.subject) { case (#bot(id)) { if (e.proof.openByBot.get(id) == ?r.id) e.proof.openByBot.remove(id) }; case _ {} };
  };

  public func passed(r : Types.ProofRound) : Bool {
    r.state == #closed and r.counted >= Config.proofMinCases and r.right * 100 >= Config.proofMinPct * r.counted;
  };

  public func pct(r : Types.ProofRound) : Nat { if (r.counted == 0) 0 else r.right * 100 / r.counted };

  // De laatste GESLOTEN ronde (stoppen telt niet) van dit onderwerp voor deze taak.
  public func latestClosed(ps : Types.ProofState, s : Types.ProofSubject, taskKey : Text) : ?Types.ProofRound {
    var best : ?Types.ProofRound = null;
    for (r in ps.rounds.values()) {
      if (r.state == #closed and r.task == taskKey and sameSubject(r.subject, s)) {
        switch best {
          case (?b) { if ((r.closedAt ?? 0) > (b.closedAt ?? 0) or ((r.closedAt ?? 0) == (b.closedAt ?? 0) and r.id > b.id)) best := ?r };
          case null best := ?r;
        };
      };
    };
    best;
  };

  public func sameLabels(r : Types.ProofRound, vendor : Text, model : Text, instruction : Text) : Bool {
    r.vendor == vendor and r.model == model and r.instruction == instruction;
  };

  // De drempel voor Zelf doen.
  public func gate(ps : Types.ProofState, s : Types.ProofSubject, taskKey : Text, vendor : Text, model : Text, instruction : Text) : { #ok; #err : Text } {
    let need = "minstens " # Config.proofMinPct.toText() # " % juist op minstens " # Config.proofMinCases.toText() # " gevallen";
    let r = latestClosed(ps, s, taskKey) ?? return #err("Zelf doen kan pas na een geslaagde proefronde (" # need # ")");
    if (not sameLabels(r, vendor, model, instruction)) return #err("Zelf doen: het model of de instructieversie wijzigde sinds de laatste proefronde. Eerst een nieuwe proefronde (" # need # ")");
    if (not passed(r)) return #err("Zelf doen: de laatste proefronde haalde de drempel niet (" # r.right.toText() # " / " # r.counted.toText() # "; " # need # ")");
    #ok;
  };

  // Schudden (Fisher-Yates) met de bytes van Random.blob.
  public func shuffle(xs : [Nat], bytes : [Nat8]) : [Nat] {
    let a = xs.toVarArray<Nat>();
    if (bytes.size() == 0) return xs;
    var i = a.size();
    var k = 0;
    while (i > 1) {
      let r = (bytes[k % bytes.size()].toNat() * 256 + bytes[(k + 1) % bytes.size()].toNat() + k) % i;
      i -= 1;
      let t = a[i];
      a[i] := a[r];
      a[r] := t;
      k += 2;
    };
    VarArray.toArray(a);
  };

  // Klokronde: een open ronde na proofRoundDays sluiten (geen antwoord = fout). Begrensd.
  public func idle(e : Env, now : Int) {
    var n = 0;
    let old = List.empty<Types.ProofRound>();
    label l for (r in e.proof.rounds.values()) {
      if (n >= 20) break l;
      if (r.state == #open and now - r.startedAt > Config.proofRoundDays) { old.add(r); n += 1 };
    };
    for (r in old.values()) close(e, r, null, now, false);
  };

  // Een sleutel of id uit JSON van een bot of de AI (getal of tekst), hoogstens 80 tekens.
  public func jsonValue(j : ?Json) : Text {
    switch j {
      case (?#String(t)) Text.fromIter(t.chars().take(80));
      case (?#Number(#Int(i))) Int.toText(i);
      case _ "";
    };
  };
};
