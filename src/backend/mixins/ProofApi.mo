// Proefbank (stap 3.5, bouwplan §6 "Autonomie per taak"; ontwerp BOWACO_verslag_3.5.md §1). Enkel de beheerder (#manageBots):
// testsets uit de historiek, proefrondes voor een bot (via zijn proeftools op /mcp, lib/Bots.mo) of voor een AI-fiche van Caffeine
// (runProofAi: één geval per oproep), sluiten, stoppen, de score en de fouten per geval (enkel verwijzingen, geen inhoud).
// De proefbank voert nooit iets uit op werfgegevens; ze leest enkel en bewaart antwoorden.
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Random "mo:core/Random";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Json "mo:jayson/Json";
import Types "../types";
import ProofViews "../types/proofviews";
import OaReadViews "../types/oareadviews";
import OaRead "../lib/OaRead";
import Access "../lib/Access";
import AiPrompts "../lib/AiPrompts";
import Bots "../lib/Bots";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Proof "../lib/Proof";
import Rights "../lib/Rights";
import Caffeine "../lib/ai/Caffeine";
import Connector "../lib/ai/Connector";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  files : Types.FileState,
  dossier : Types.DossierState,
  org : Types.OrgState,
  tenders : Types.TenderState,
  oaRead : Types.OaReadState,
  robot : Types.RobotState,
  ai : Types.AiState,
  bots : Types.BotState,
  proof : Types.ProofState,
  audit : Types.AuditState,
  ctr : Types.Counters,
  isAiLive : () -> Bool,
) {

  func proofEnv() : Proof.Env { { settings; access; works; files; dossier; proof; tenders; org; oaRead } };

  func requireProofAdmin(caller : Principal) : Types.Person {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageBots, null);
    p;
  };

  func workCodeOf(id : Nat) : Text { switch (works.works.get(id)) { case (?w) w.code; case null "#" # id.toText() } };

  func valueLabel(field : Text, v : Text) : Text {
    if (v == "") return "–";
    switch field {
      case "werfId" switch (Nat.fromText(v)) { case (?id) workCodeOf(id); case null v };
      case "soort" switch (Dossier.kind(settings, Proof.norm(#key, v))) { case (?k) k.name; case null v };
      case _ v;
    };
  };

  // 3.8 (R38): een bedragveld (secret) komt nooit in een query-view: enkel of het ingevuld is; juist of fout staat in de uitkomst.
  func values(task : Text, xs : [(Text, Text)]) : [ProofViews.ProofValue] {
    let secret = func(f : Text) : Bool { switch (Proof.task(task)) { case (?d) d.fields.any(func(x : Proof.Field) : Bool = x.name == f and x.secret); case null true } };
    xs.map<(Text, Text), ProofViews.ProofValue>(func((f, v)) {
      if (secret(f)) { { field = f; value = ""; shown = if (v == "") "–" else "bedrag (verborgen)" } } else { { field = f; value = v; shown = valueLabel(f, v) } };
    });
  };

  func subjectName(s : Types.ProofSubject) : Text {
    switch s {
      case (#bot(id)) switch (bots.bots.get(id)) { case (?b) b.name; case null "bot #" # id.toText() };
      case (#ai(k)) switch (ai.workers.get(k)) { case (?w) w.name # " (Caffeine AI)"; case null k # " (Caffeine AI)" };
      case (#other(t)) t;
    };
  };

  // ── Lezen ────────────────────────────────────────────────────────────────
  public query ({ caller }) func proofInfo() : async ProofViews.ProofInfo {
    ignore requireProofAdmin(caller);
    {
      tasks = Proof.tasks().map<Proof.TaskDef, ProofViews.ProofTaskInfo>(func d = { key = d.key; tool = d.tool; aiKey = d.aiKey; fields = d.fields.map<Proof.Field, ProofViews.ProofFieldInfo>(func f = { name = f.name; help = f.help }) });
      minPct = Config.proofMinPct;
      minCases = Config.proofMinCases;
      maxCases = Config.proofMaxCases;
      roundDays = Int.abs(Config.proofRoundDays / 86_400_000_000_000);
    };
  };

  public query ({ caller }) func listProofSets() : async [ProofViews.ProofSetView] {
    ignore requireProofAdmin(caller);
    proof.sets.reverseEntries().map(func((_, s) : (Nat, Types.ProofSet)) : ProofViews.ProofSetView {
      let ws = Map.empty<Nat, ()>();
      for (c in s.cases.values()) switch (c.workId) { case (?w) ws.add(w, ()); case null {} };
      var rounds = 0;
      for (r in proof.rounds.values()) if (r.setId == s.id) rounds += 1;
      { id = s.id; task = s.task; name = s.name; source = s.source; cases = s.cases.size(); works = ws.size(); createdAt = s.createdAt; archivedAt = s.archivedAt; rounds };
    }).toArray();
  };

  public query ({ caller }) func proofSetCases(setId : Nat) : async [ProofViews.ProofCaseView] {
    ignore requireProofAdmin(caller);
    let s = proof.sets.get(setId) ?? return [];
    s.cases.map<Types.ProofCase, ProofViews.ProofCaseView>(func c = { n = c.n; ref = Proof.refText(c.ref); workId = c.workId; workCode = switch (c.workId) { case (?w) workCodeOf(w); case null "" }; answer = c.answer.map<(Text, Text), (Text, Text)>(func((f, v)) = switch (Proof.task(s.task)) { case (?d) { if (d.fields.any(func(x : Proof.Field) : Bool = x.name == f and x.secret)) (f, "") else (f, v) }; case null (f, "") }) });
  };

  func roundView(r : Types.ProofRound) : ProofViews.ProofRoundView {
    let ans = switch (proof.answers.get(r.id)) { case (?m) m.size(); case null 0 };
    let latest = switch (Proof.latestClosed(proof, r.subject, r.task)) { case (?x) x.id == r.id; case null false };
    {
      id = r.id;
      setId = r.setId;
      setName = switch (proof.sets.get(r.setId)) { case (?s) s.name; case null "#" # r.setId.toText() };
      task = r.task;
      subject = r.subject;
      subjectName = subjectName(r.subject);
      vendor = r.vendor;
      model = r.model;
      instruction = r.instruction;
      cases = r.cases.size();
      answered = ans;
      right = r.right;
      counted = r.counted;
      pct = Proof.pct(r);
      passed = Proof.passed(r);
      latest;
      state = r.state;
      startedAt = r.startedAt;
      closedAt = r.closedAt;
    };
  };

  public query ({ caller }) func listProofRounds() : async [ProofViews.ProofRoundView] {
    ignore requireProofAdmin(caller);
    proof.rounds.reverseEntries().take(300).map(func((_, r) : (Nat, Types.ProofRound)) : ProofViews.ProofRoundView = roundView(r)).toArray();
  };

  // De gevallen van een ronde met verwacht, gegeven en de uitkomst. Geen inhoud: enkel de verwijzing en de waarden (id, sleutel).
  public query ({ caller }) func proofRoundCases(roundId : Nat) : async [ProofViews.ProofRoundCaseView] {
    ignore requireProofAdmin(caller);
    let r = proof.rounds.get(roundId) ?? return [];
    let s = proof.sets.get(r.setId) ?? return [];
    let ans = proof.answers.get(r.id);
    var pos = 0;
    r.cases.map<Nat, ProofViews.ProofRoundCaseView>(func n {
      pos += 1;
      let c = Proof.caseOf(s, n);
      let a = switch ans { case (?m) m.get(n); case null null };
      {
        pos;
        n;
        ref = switch c { case (?x) Proof.refText(x.ref); case null "?" };
        expected = switch c { case (?x) values(r.task, x.answer); case null [] };
        given = switch a { case (?x) values(r.task, x.given); case null [] };
        outcome = switch a { case (?x) ?x.outcome; case null null };
        at = switch a { case (?x) ?x.at; case null null };
      };
    });
  };

  // ── Testsets ─────────────────────────────────────────────────────────────
  // Uit de historiek: wat mensen al koppelden of goedkeurden (Proof.buildCases). Nooit wat een bot deed.
  public shared ({ caller }) func buildProofSet(task : Text, name : Text, max : Nat) : async Result.Result<Nat, Text> {
    let p = requireProofAdmin(caller);
    if (Proof.task(task) == null) return #err("Onbekende taak");
    let nm = Access.cleanText(name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    if (max == 0 or max > Config.proofMaxCases) return #err("Aantal gevallen: 1 tot " # Config.proofMaxCases.toText());
    if (proof.sets.size() >= Config.maxProofSets) return #err("Te veel testsets (hoogstens " # Config.maxProofSets.toText() # ")");
    let cases = Proof.buildCases(proofEnv(), task, max);
    if (cases.size() == 0) return #err("Geen bruikbare gevallen in de historiek voor deze taak");
    let id = Ids.next(ctr, "proofSet");
    proof.sets.add(id, { id; task; name = nm; source = "historiek"; cases; createdAt = Time.now(); createdBy = p.id; archivedAt = null; extra = [] });
    Access.audit(audit, caller, ?p.id, null, "proef-set", "set #" # id.toText() # " " # task # " " # cases.size().toText() # " gevallen");
    #ok(id);
  };

  public shared ({ caller }) func archiveProofSet(setId : Nat) : async Result.Result<(), Text> {
    let p = requireProofAdmin(caller);
    let s = proof.sets.get(setId) ?? return #err("Onbekende testset");
    if (s.archivedAt != null) return #err("Al gearchiveerd");
    if (proof.rounds.values().any(func(r : Types.ProofRound) : Bool = r.setId == setId and r.state == #open)) return #err("Er loopt nog een proefronde met deze set");
    proof.sets.add(setId, { s with archivedAt = ?Time.now() });
    proofDropContent();
    Access.audit(audit, caller, ?p.id, null, "proef-set-archief", "set #" # setId.toText());
    #ok;
  };

  // ── 3.8: de bestanden van een testset met OA-offertes laden ─────────────
  // Een bot leest het bestand van een proefgeval via proef_bestand, en dat komt uit de canister (nooit een opslag-URL). De beheerder
  // laadt daarom elk bestand één keer: de browser haalt het (readConfidentialFile) en geeft de bytes door. Weg met de laatste set.
  public query ({ caller }) func proofContentNeeds(setId : Nat) : async [OaReadViews.ProofContentNeed] {
    ignore requireProofAdmin(caller);
    let s = proof.sets.get(setId) ?? return [];
    let e = proofEnv();
    s.cases.filterMap<Types.ProofCase, OaReadViews.ProofContentNeed>(func c {
      switch (c.ref) {
        case (#oaQuote(qid)) {
          let q = tenders.oaQuotes.get(qid) ?? return null;
          let f = Proof.oaQuoteOk(e, q) ?? return null;
          ?{ n = c.n; oaQuoteId = qid; fileId = f.id; name = f.name; mime = f.mime; size = f.size; loaded = oaRead.proofContent.containsKey(Proof.contentKey(qid)) };
        };
        case _ null;
      };
    });
  };

  public shared ({ caller }) func loadProofContent(setId : Nat, n : Nat, content : Blob) : async Result.Result<(), Text> {
    let p = requireProofAdmin(caller);
    let s = proof.sets.get(setId) ?? return #err("Onbekende testset");
    if (s.archivedAt != null) return #err("Deze testset is gearchiveerd");
    let c = Proof.caseOf(s, n) ?? return #err("Onbekend geval");
    let qid = switch (c.ref) { case (#oaQuote(q)) q; case _ return #err("Dit geval heeft geen bestand om te laden") };
    let q = tenders.oaQuotes.get(qid) ?? return #err("Onbekende OA-offerte");
    let f = Proof.oaQuoteOk(proofEnv(), q) ?? return #err("Dit geval is niet meer bruikbaar");
    if (content.size() == 0 or content.size() != f.size) return #err("Het bestand klopt niet (andere grootte)");
    if (content.size() > Config.oaReadMaxBytes) return #err("Te groot om in te lezen (hoogstens 1,35 MB): dit geval doet niet mee");
    let key = Proof.contentKey(qid);
    if (not oaRead.proofContent.containsKey(key) and (oaRead.proofContent.size() >= Config.oaReadMaxProofContent or OaRead.proofBytes(oaRead) + content.size() > Config.oaReadMaxProofBytes)) return #err("Te veel geladen bestanden; archiveer eerst een oude testset");
    oaRead.proofContent.add(key, content);
    Access.audit(audit, caller, ?p.id, ?q.workId, "proef-bestand", "set #" # setId.toText() # " geval " # n.toText());
    #ok;
  };

  // De inhoud die geen enkele lopende set (niet gearchiveerd) nog nodig heeft, weg.
  func proofDropContent() {
    let keep = Map.empty<Text, ()>();
    for (s in proof.sets.values()) if (s.archivedAt == null) for (c in s.cases.values()) switch (c.ref) { case (#oaQuote(q)) keep.add(Proof.contentKey(q), ()); case _ {} };
    let drop = List.empty<Text>();
    for (k in oaRead.proofContent.keys()) if (not keep.containsKey(k)) drop.add(k);
    for (k in drop.values()) oaRead.proofContent.remove(k);
  };

  // ── Rondes ───────────────────────────────────────────────────────────────
  // Een ronde voor een bot (zijn fiche bepaalt welke gevallen meedoen) of voor de AI-fiche van de taak. De labels van NU gaan mee.
  public shared ({ caller }) func startProofRound(setId : Nat, subject : Types.ProofSubject) : async Result.Result<Nat, Text> {
    ignore requireProofAdmin(caller);
    let entropy = await Random.blob();
    // R33: na de await opnieuw nakijken.
    let p = requireProofAdmin(caller);
    let s = proof.sets.get(setId) ?? return #err("Onbekende testset");
    if (s.archivedAt != null) return #err("Deze testset is gearchiveerd");
    let def = Proof.task(s.task) ?? return #err("Onbekende taak");
    if (proof.rounds.size() >= Config.maxProofRounds) return #err("Te veel proefrondes");
    switch (Proof.openRoundOf(proof, subject)) { case (?_) return #err("Er loopt al een proefronde voor deze bot of AI-fiche"); case null {} };
    let ctx = { works; settings };
    var scope : Types.Extra = [];
    let (vendor, model, instruction, picked) : (Text, Text, Text, [Nat]) = switch subject {
      case (#bot(id)) {
        let b = bots.bots.get(id) ?? return #err("Onbekende bot");
        if (not Rights.botActive(b)) return #err("Deze bot is niet gekoppeld of ingetrokken");
        if (not b.tools.any(func t = t == def.tool)) return #err("De tool van deze taak staat niet op de fiche van de bot");
        if (Rights.botLevel(b, s.task) == #never) return #err("Deze taak staat op Nooit");
        // Enkel gevallen die de bot met zijn fiche zou mogen zien (werf, en voor document koppelen ook de documentsoort).
        // 3.8: een OA-offerte telt enkel mee als de beheerder het bestand al in de proefbank laadde (Proof.caseInput).
        let ok = s.cases.filter(func(c : Types.ProofCase) : Bool {
          let w = c.workId ?? return false;
          let kindOk = switch (def.scope) {
            case (#work) true;
            case (#docs) {
              let kind = Proof.norm(#key, Proof.answerOf(c.answer, "soort"));
              let conf = switch (Dossier.kind(settings, kind)) { case (?k) k.confidential; case null true };
              Rights.botSeesDocKind(b, kind, conf);
            };
          };
          Rights.botSeesWork(ctx, b, w) and kindOk and Proof.caseInput(proofEnv(), c) != null;
        });
        scope := Proof.scopeExtra({ allWorks = b.allWorks; works = b.works; kinds = b.docKinds });
        (b.vendor, b.model, Bots.instructionOf(b), ok.map<Types.ProofCase, Nat>(func c = c.n));
      };
      case (#ai(k)) {
        if (def.aiKey == "") return #err("Deze taak heeft geen proefronde via Caffeine AI (Caffeine leest geen PDF of foto)");
        if (k != def.aiKey) return #err("Deze AI-fiche hoort niet bij deze taak");
        let w = ai.workers.get(k) ?? return #err("Deze AI-medewerker is nog niet ingericht (AI, fiches)");
        let ok = s.cases.filter(func(c : Types.ProofCase) : Bool = Proof.caseInput(proofEnv(), c) != null);
        ("Caffeine", w.modelAlias, "v" # w.instructionVersion.toText(), ok.map<Types.ProofCase, Nat>(func c = c.n));
      };
      case (#other(_)) return #err("Onbekend onderwerp");
    };
    if (picked.size() < Config.proofMinCases) {
      return #err("Te weinig gevallen voor deze fiche: " # picked.size().toText() # " (minstens " # Config.proofMinCases.toText() # ")");
    };
    let order = Proof.shuffle(picked, entropy.toArray());
    let id = Ids.next(ctr, "proofRound");
    let now = Time.now();
    let round : Types.ProofRound = {
      id;
      setId;
      task = s.task;
      subject;
      vendor;
      model;
      instruction;
      cases = order;
      startedAt = now;
      startedBy = p.id;
      var state = #open;
      var closedAt = null;
      var closedBy = null;
      var right = 0;
      var counted = 0;
      var extra = scope;
    };
    proof.rounds.add(id, round);
    switch subject { case (#bot(b)) proof.openByBot.add(b, id); case _ {} };
    Access.audit(audit, caller, ?p.id, null, "proef-ronde", "ronde #" # id.toText() # " set #" # setId.toText() # " " # order.size().toText() # " gevallen");
    #ok(id);
  };

  public shared ({ caller }) func closeProofRound(roundId : Nat, cancel : Bool) : async Result.Result<(), Text> {
    let p = requireProofAdmin(caller);
    let r = proof.rounds.get(roundId) ?? return #err("Onbekende proefronde");
    if (r.state != #open) return #err("Deze proefronde is al gesloten");
    Proof.close(proofEnv(), r, ?p.id, Time.now(), cancel);
    Access.audit(audit, caller, ?p.id, null, if cancel "proef-ronde-gestopt" else "proef-ronde-gesloten", "ronde #" # roundId.toText() # " " # r.right.toText() # "/" # r.counted.toText());
    #ok;
  };

  // ── Caffeine AI-weg: één geval per oproep ───────────────────────────────
  // Testmodus (draft, lokaal zonder live): er vertrekt niets, het droge voorbeeld wordt het antwoord (en is dus fout).
  // Zoals aiReal in AiApi (namen van mixins botsen): enkel echt bellen als de canister live is en de testmodus niet aan staat.
  func proofAiReal() : Bool { isAiLive() and settings.values.get("ai.testmodus") != ?"aan" };

  func parseAnswer(def : Proof.TaskDef, content : Text) : [(Text, Text)] {
    let j = Json.parse(content);
    def.fields.map<Proof.Field, (Text, Text)>(func f {
      let v = switch j { case (?#Object(fs)) Proof.jsonValue(switch (fs.find(func((k, _) : (Text, Json.Json)) : Bool = k == f.name)) { case (?(_, x)) ?x; case null null }); case _ "" };
      (f.name, v);
    });
  };

  func aiContext() : Text {
    var t = "Werven (id · code · gemeente):\n";
    var n = 0;
    // Nieuwste eerst (lopende werven zijn meestal de recentste), hoogstens Config.proofAiMaxWorks.
    label l for ((_, w) in works.works.reverseEntries()) {
      if (n >= Config.proofAiMaxWorks) break l;
      if (w.archivedAt == null) { t #= w.id.toText() # " · " # w.code # " · " # w.address.city # "\n"; n += 1 };
    };
    t #= "Documentsoorten (sleutel · naam):\n";
    for (k in Dossier.kinds(settings, false).values()) { if (not k.confidential) t #= k.key # " · " # k.name # "\n" };
    t;
  };

  public shared ({ caller }) func runProofAi(roundId : Nat) : async Result.Result<ProofViews.ProofAiStep, Text> {
    let p = requireProofAdmin(caller);
    let r = proof.rounds.get(roundId) ?? return #err("Onbekende proefronde");
    if (r.state != #open) return #err("Deze proefronde is al gesloten");
    let key = switch (r.subject) { case (#ai(k)) k; case _ return #err("Dit is geen ronde voor Caffeine AI") };
    let def = Proof.task(r.task) ?? return #err("Onbekende taak");
    let s = proof.sets.get(r.setId) ?? return #err("Onbekende testset");
    let w = ai.workers.get(key) ?? return #err("Deze AI-medewerker is nog niet ingericht");
    let v = AiPrompts.version(w.key, w.instructionVersion) ?? return #err("Onbekende instructieversie");
    let ans = Proof.answersOf(proof, r.id);
    let leftNow = func() : Nat { var k = 0; for (n in r.cases.values()) if (not ans.containsKey(n)) k += 1; k };
    // Het volgende open geval (een intussen onbruikbaar geval wordt vervallen).
    var next : ?Types.ProofCase = null;
    var input : ?Json.Json = null;
    label l for (n in r.cases.values()) {
      if (not ans.containsKey(n)) {
        switch (Proof.caseOf(s, n)) {
          case (?c) switch (Proof.caseInput(proofEnv(), c)) { case (?i) { next := ?c; input := ?i; break l }; case null ans.add(n, { n; given = []; at = Time.now(); outcome = #void("onbruikbaar") }) };
          case null ans.add(n, { n; given = []; at = Time.now(); outcome = #void("onbekend") });
        };
      };
    };
    let c = switch next {
      case (?x) x;
      case null { Proof.close(proofEnv(), r, ?p.id, Time.now(), false); return #ok({ answered = ans.size(); left = 0; closed = true; dry = not proofAiReal() }) };
    };
    let item = switch input { case (?i) i.stringify(); case null "" };
    let userText = AiPrompts.proofUser(aiContext(), item);
    let live = proofAiReal();
    // Review 3.5 M2: één oproep tegelijk per ronde (anders twee betaalde oproepen voor hetzelfde geval); het merk vervalt na 5 min.
    let now0 = Time.now();
    switch (Proof.extraGet(r.extra, "bezig")) {
      case (?t) { switch (Int.fromText(t)) { case (?at) { if (now0 - at < 300_000_000_000) return #err("Deze proefronde draait al; wacht even") }; case null {} } };
      case null {};
    };
    let unmark = func() { r.extra := r.extra.filter(func((k, _) : (Text, Text)) : Bool = k != "bezig") };
    if (live) r.extra := r.extra.filter(func((k, _) : (Text, Text)) : Bool = k != "bezig").concat([("bezig", Int.toText(now0))]);
    let content : Text = if (not live) v.dryRun else {
      if (not w.enabled or w.budgetMonthCents == 0) { unmark(); return #err(w.name # " staat uit (AI, fiches)") };
      if (not ai.models.containsKey(w.modelAlias)) { unmark(); return #err("Het model van de fiche staat niet in de catalogus") };
      if (ai.runningByPerson.containsKey(p.id)) { unmark(); return #err("Je hebt al een AI-oproep lopen; wacht even") };
      if (ai.runningByPerson.size() >= Config.aiMaxConcurrent) { unmark(); return #err("AI is bezig, probeer zo meteen") };
      let e = { settings; access; robot; ai; audit; ctr };
      let now = Time.now();
      let reserve = switch (Connector.reserve(e, w, caller, ?p.id, null, now)) { case (#ok x) x; case (#err t) { unmark(); return #err(t) } };
      let call = Connector.newCall(e, w, #caffeine, #user(p.id), ?p.id, null, w.modelAlias, Connector.sha(userText), userText.size(), reserve, false, now);
      call.extra := [("proefronde", r.id.toText())];
      ai.runningByPerson.add(p.id, call.id);
      let out = await* Caffeine.chat<system>(w.modelAlias, v, userText);
      if (ai.runningByPerson.get(p.id) == ?call.id) ai.runningByPerson.remove(p.id);
      unmark();
      // R33: na de await opnieuw: nog beheerder, ronde nog open, geval nog niet beantwoord.
      let still = switch (Access.activePerson(access, caller)) { case (?q) Rights.may({ works; settings }, q, #manageBots, null); case null false };
      switch (Connector.finishProof(e, call, v, out, still and r.state == #open, caller)) { case (#ok t) t; case (#err m) return #err(m) };
    };
    if (r.state != #open or ans.containsKey(c.n)) return #err("De proefronde veranderde intussen; probeer opnieuw");
    let given = parseAnswer(def, content);
    ans.add(c.n, { n = c.n; given; at = Time.now(); outcome = Proof.compare(def, c.answer, given) });
    let left = leftNow();
    if (left == 0) Proof.close(proofEnv(), r, ?p.id, Time.now(), false);
    #ok({ answered = ans.size(); left; closed = left == 0; dry = not live });
  };
};
