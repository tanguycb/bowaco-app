// Eén model voor taak en voorstel (stap 4b.5, bouwplan §9 fase 4b; optiedocument richting B punt 1–2).
// Elke opdracht aan een assistent is één TAAK (wie gaf ze, wie voert ze uit, de stand: wacht · bezig · voorstel klaar · klaar ·
// mislukt · geannuleerd) met hoogstens één VOORSTEL (open · aanvaard · aangepast · geweigerd · zelf gedaan · ongedaan · vervallen ·
// ingetrokken; wie besliste; ongedaan maken; de punten met hun bron) en een TIJDLIJN (wie deed wat). De vijf soorten van fase 3
// staan erachter:
//   inlezen (3.8, oaRead)            → taak "oaread:<id>",   soort oa-offerte-inlezen
//   vergelijken (3.9, aiCheck)       → taak "check:<id>",    soort offertes-vergelijken
//   nalezen (3.11, aiCheck)          → taak "check:<id>",    soort offerte-nalezen
//   factuurcontrole (3.10, invCheck) → taak "invcheck:<id>", soort factuurcontrole
//   document koppelen (3.4) en een losse factuurcontrole van een bot (bots.actions) → taak "bot:<id>"
// Het voorstel dat een bot op een opdracht doet (bots.actions met "actie" in de opdracht), hoort bij de taak van die opdracht
// (voorstel.actionId) en krijgt dus geen eigen taak.
// Het DOSSIER (bestand, regels, bedragen, bevindingen, vrije tekst) blijft in het veld van de soort, met zijn eigen rekenregels en
// rechten; dit model bewaart enkel vaste woorden, tellingen, sleutels en verwijzingen (geen bedragen, geen tekst van een bot).
// `sync` brengt het model gelijk met de dossiers. Het is idempotent en goedkoop (eerst een vergelijking van de stand), en draait
// na elke wijziging aan een dossier (de mixins), bij elke installatie en upgrade (main.mo: zo komen de opdrachten van vóór 4b.5
// erin) en in de klokronde (vangnet). Het verandert NOOIT iets aan een dossier: het gedrag van 3.4–3.11 blijft zoals het was.
// Geen rechten hier: wie wat mag zien, beslist de lezer (Te doen: het recht van het bronscherm; TasksApi: #manageBots).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Text "mo:core/Text";
import Types "../types";
import Config "Config";
import OaRead "OaRead";

module {
  type Task = Types.AssistTask;
  type Proposal = Types.TaskProposal;
  type Who = Types.TaskWho;

  // De dossiers die het model leest (nooit schrijft).
  public type Env = {
    oaRead : Types.OaReadState;
    aiCheck : Types.AiCheckState;
    invCheck : Types.InvCheckState;
    bots : Types.BotState;
    // 4b.6: enkel lezen of een ingelezen OA-offerte intussen ingetrokken is (ongedaan maken = intrekken).
    tenders : Types.TenderState;
  };

  // ── Woorden ─────────────────────────────────────────────────────────────
  public func stateKey(s : Types.TaskState) : Text {
    switch s { case (#waiting) "wacht"; case (#busy) "bezig"; case (#ready) "voorstel"; case (#done) "klaar"; case (#failed _) "mislukt"; case (#cancelled) "geannuleerd"; case (#other t) t };
  };
  public func proposalKey(s : Types.ProposalState) : Text {
    switch s {
      case (#open) "open";
      case (#accepted) "aanvaard";
      case (#adjusted) "aangepast";
      case (#rejected) "geweigerd";
      case (#auto) "zelf";
      case (#undone) "ongedaan";
      case (#expired) "vervallen";
      case (#withdrawn) "ingetrokken";
      case (#other t) t;
    };
  };
  public func whoKey(w : Who) : Text {
    switch w { case (#person p) "persoon:" # p.toText(); case (#bot b) "bot:" # b.toText(); case (#app a) "app:" # a; case (#clock) "app"; case (#other t) t };
  };
  public func refKey(r : Types.TaskRef) : Text {
    switch r {
      case (#file x) "bestand:" # x.toText();
      case (#doc x) "document:" # x.toText();
      case (#tender x) "prijsvraag:" # x.toText();
      case (#quote x) "offerteversie:" # x.toText();
      case (#oaQuote x) "oa-offerte:" # x.toText();
      case (#oaInvoice x) "oa-factuur:" # x.toText();
      case (#org x) "firma:" # x.toText();
      case (#none) "";
      case (#other t) t;
    };
  };
  public func srcKey(s : Types.TaskSrc) : Text {
    switch s {
      case (#oaRead id) "oaread:" # id.toText();
      case (#aiCheck id) "check:" # id.toText();
      case (#invCheck id) "invcheck:" # id.toText();
      case (#botAction id) "bot:" # id.toText();
      case (#other t) t;
    };
  };
  // De taak in de woorden van het scherm (Todo.assistantName): "inlezen", "vergelijken", "nalezen", "factuurcontrole", "documenten".
  public func kindWord(kind : Text) : Text {
    switch kind {
      case "oa-offerte-inlezen" "inlezen";
      case "offertes-vergelijken" "vergelijken";
      case "offerte-nalezen" "nalezen";
      case "factuurcontrole" "factuurcontrole";
      case "document-koppelen" "documenten";
      case k k;
    };
  };
  public func isFinal(s : Types.TaskState) : Bool {
    switch s { case (#waiting or #busy or #ready) false; case _ true };
  };

  // Een sleutelwoord uit een dossier (oordeel, soort): enkel a–z, 0–9, _ en -, hoogstens 40 tekens; anders "ander".
  func word(t : Text) : Text {
    let k = Text.fromIter(t.toLower().trim(#char ' ').chars().take(40));
    if (k == "" or not k.chars().all(func(c : Char) : Bool = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '_' or c == '-')) "ander" else k;
  };
  func extraGet(x : Types.Extra, k : Text) : ?Text {
    switch (x.find(func((a, _) : (Text, Text)) : Bool = a == k)) { case (?(_, v)) ?v; case null null };
  };
  func has(x : Types.Extra, k : Text) : Bool { extraGet(x, k) != null };
  func actionOf(x : Types.Extra) : ?Nat { switch (extraGet(x, "actie")) { case (?t) Nat.fromText(t); case null null } };
  func viaWho(v : Types.OaReadVia) : Who { switch v { case (#bot b) #bot(b); case (#ai) #app("caffeine"); case (#other _) #other("andere") } };
  func personWho(p : ?Nat) : Who { switch p { case (?x) #person(x); case null #clock } };
  func point(key : Text, after : Text, source : Types.TaskRef) : Types.TaskPoint { { key; now = ""; after; source; secret = false; extra = [] } };
  func secretPoint(key : Text, source : Types.TaskRef) : Types.TaskPoint { { key; now = ""; after = ""; source; secret = true; extra = [] } };
  // 4b.6 aanpassen vóór aanvaarden: het dossier bewaart in extra "aangepast" de sleutels van de punten die de mens anders overnam
  // (komma's; bij vergelijken het nummer van de post). Het punt krijgt dan extra ("aangepast", "1"); het voorstel staat op #adjusted.
  public func adjustedKeys(x : Types.Extra) : [Text] {
    switch (extraGet(x, "aangepast")) { case (?t) t.split(#char ',').filter(func(k : Text) : Bool = k != "").toArray(); case null [] };
  };
  func markAdjusted(ps : [Types.TaskPoint], keys : [Text]) : [Types.TaskPoint] {
    if (keys.size() == 0) return ps;
    ps.map(func(x : Types.TaskPoint) : Types.TaskPoint = if (keys.any(func(k : Text) : Bool = k == x.key or ("post:" # k) == x.key)) ({ x with extra = [("aangepast", "1")] }) else x);
  };
  public func isAdjusted(x : Types.TaskPoint) : Bool { has(x.extra, "aangepast") };
  func isoDay(day : Nat) : Text {
    let z = day + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if (mp < 10) mp + 3 else mp - 9;
    let y = yoe + era * 400 + (if (m <= 2) 1 else 0);
    let two = func(n : Nat) : Text { if (n < 10) "0" # n.toText() else n.toText() };
    y.toText() # "-" # two(m) # "-" # two(d);
  };

  // ── De vertaling van een dossier naar het model (zuiver) ────────────────
  // Wat een taak NU is volgens haar dossier. proposal = null: (nog) geen voorstel.
  public type ProposalShape = {
    by : Who;
    at : Int;
    auto : Bool;
    confidence : ?Nat;
    points : [Types.TaskPoint];
    actionId : ?Nat;
    state : Types.ProposalState;
    decidedBy : ?Who;
    decidedAt : ?Int;
    undo : Types.TaskUndo;
  };
  public type Shape = {
    src : Types.TaskSrc;
    kind : Text;
    workId : ?Nat;
    subject : Types.TaskRef;
    givenBy : Who;
    doer : Who;
    createdAt : Int;
    state : Types.TaskState;
    at : Int; // wanneer de stand laatst veranderde (zo goed als het dossier het weet)
    who : Who; // wie die stand teweegbracht
    proposal : ?ProposalShape;
  };

  // Een gesloten opdracht: met een beslist voorstel = klaar; zonder voorstel = geannuleerd.
  func closedState(hasProposal : Bool) : Types.TaskState { if hasProposal #done else #cancelled };
  func failWord(t : Text) : Text { if (t.contains(#text "vervallen")) "vervallen" else if (t.contains(#text "onbruikbaar")) "onbruikbaar" else "mislukt" };

  // 3.8 inlezen.
  // 4b.6: tenders = enkel om te zien of de geregistreerde OA-offerte intussen ingetrokken is (= ongedaan gemaakt). Ongedaan maken kan
  // zolang ze niet ingetrokken is, ook na aanvaarden door een mens (dezelfde handeling: intrekken, met de voorwaarden van 2c.3).
  public func fromOaRead(j : Types.OaReadJob, tenders : Types.TenderState) : Shape {
    let doer = viaWho(j.via);
    let auto = extraGet(j.extra, "zelf") == ?"1";
    let hasP = j.proposal != null;
    let adj = adjustedKeys(j.extra);
    var undoAt : ?Int = null;
    var undoBy : ?Who = null;
    let (state, pstate, undo) : (Types.TaskState, Types.ProposalState, Types.TaskUndo) = switch (j.status) {
      case (#open) (if (has(j.extra, "bezig")) #busy else #waiting, #open, #none);
      case (#proposed) (#ready, #open, #none);
      case (#applied qid) {
        let taken : Types.ProposalState = if auto #auto else if (adj.size() > 0) #adjusted else #accepted;
        switch (tenders.oaQuotes.get(qid)) {
          case (?q) switch (q.status) {
            case (#withdrawn _) {
              undoAt := switch (OaRead.extraGet(q.extra, "ingetrokkenOp")) { case (?x) Int.fromText(x); case null null };
              undoBy := switch (OaRead.extraGet(q.extra, "ingetrokkenDoor")) { case (?x) switch (Nat.fromText(x)) { case (?n) ?#person(n); case null null }; case null null };
              (#done, #undone, #done(undoAt ?? 0));
            };
            case (#received) (#done, taken, #possible("intrekken"));
          };
          case null (#done, taken, #none);
        };
      };
      case (#rejected why) (closedState(hasP), if (why == "bot ingetrokken") #withdrawn else #rejected, #none);
      case (#cancelled) (closedState(hasP), #rejected, #none);
      case (#failed t) (#failed(failWord(t)), #withdrawn, #none);
      case (#other t) {
        // Review 4b.6 M1: ongedaan via Beheer (undoBotAction): wie en wanneer uit het dossier (ongedaanDoor sinds 4b.6; anders BOWACO).
        if (t == "ongedaan") {
          undoAt := switch (extraGet(j.extra, "ongedaanOp")) { case (?x) Int.fromText(x); case null null };
          undoBy := switch (extraGet(j.extra, "ongedaanDoor")) { case (?x) switch (Nat.fromText(x)) { case (?n) ?#person(n); case null null }; case null null };
          (#done, #undone, #done(undoAt ?? 0));
        }
        else (#other(word(t)), #other(word(t)), #none);
      };
    };
    let subject : Types.TaskRef = switch (j.fileId, j.tenderId) { case (?f, _) #file(f); case (null, ?t) #tender(t); case (null, null) #org(j.orgId) };
    let src : Types.TaskRef = switch (j.fileId) { case (?f) #file(f); case null #other("tekst") };
    let decided = isFinal(state) and j.decidedAt != null;
    let proposal : ?ProposalShape = switch (j.proposal) {
      case (?p) ?{
        by = doer;
        at = p.at;
        auto;
        confidence = ?p.confidence;
        points = markAdjusted([
          point("regels", p.lines.size().toText(), src),
          point("datum", switch (p.quoteDay) { case (?d) isoDay(d); case null "" }, src),
          point("btw-verlegd", switch (p.reverse) { case (?true) "ja"; case (?false) "nee"; case null "" }, src),
          secretPoint("totaal", src),
        ], adj);
        actionId = actionOf(j.extra);
        state = pstate;
        // 4b.6: ingetrokken na registreren = ongedaan, door wie introk en wanneer (de aanvaarding blijft in de tijdlijn).
        decidedBy = if (undoAt != null) (if (undoBy != null) undoBy else ?#clock) else if (auto and pstate == #auto) ?doer else if decided ?personWho(j.decidedBy) else null;
        decidedAt = if (undoAt != null) undoAt else if decided j.decidedAt else null;
        undo;
      };
      case null null;
    };
    {
      src = #oaRead(j.id);
      kind = "oa-offerte-inlezen";
      workId = ?j.workId;
      subject;
      givenBy = #person(j.createdBy);
      doer;
      createdAt = j.createdAt;
      state;
      // Review 4b.6 L6: na ongedaan maken telt dat moment (updatedAt, opruimen na taskKeep).
      at = switch (undoAt, j.decidedAt, j.proposal) { case (?u, _, _) u; case (null, ?d, _) d; case (null, null, ?p) p.at; case (null, null, null) j.createdAt };
      who = if (state == #ready) doer else if (auto and pstate == #auto) doer else if (isFinal(state)) personWho(j.decidedBy) else if (state == #busy) doer else #person(j.createdBy);
      proposal;
    };
  };

  // 3.9 vergelijken en 3.11 nalezen.
  public func fromAiCheck(j : Types.AiCheckJob) : Shape {
    let doer = viaWho(j.via);
    let hasP = j.result != null;
    let (state, pstate) : (Types.TaskState, Types.ProposalState) = switch (j.status) {
      case (#open) (if (has(j.extra, "bezig") or has(j.extra, "uitgegeven")) #busy else #waiting, #open);
      case (#proposed) (#ready, #open);
      case (#closed why) {
        if (why == "overgenomen" and adjustedKeys(j.extra).size() > 0) (#done, #adjusted)
        else if (why == "gezien" or why == "overgenomen") (#done, #accepted)
        else if (why.contains(#text "vervallen")) (closedState(hasP), #expired)
        else (closedState(hasP), #withdrawn);
      };
      case (#cancelled) (closedState(hasP), #rejected);
      case (#failed t) (#failed(failWord(t)), #withdrawn);
      case (#other t) (#other(word(t)), #other(word(t)));
    };
    let (kind, subject) : (Text, Types.TaskRef) = switch (j.target) {
      case (#tender id) ("offertes-vergelijken", #tender(id));
      case (#quote id) ("offerte-nalezen", #quote(id));
      case (#other t) (word(t), #none);
    };
    let decided = isFinal(state) and j.decidedAt != null;
    let proposal : ?ProposalShape = switch (j.result) {
      case (?r) ?{
        by = doer;
        at = r.at;
        auto = false;
        confidence = ?r.confidence;
        points = markAdjusted([point("oordeel", word(r.verdict), subject), point("keuzes", r.picks.size().toText(), subject), point("bevindingen", r.findings.size().toText(), subject)].concat(
          // 4b.6: één punt per gekozen post, met de OA-offerte als bron (nooit een bedrag).
          r.picks.sliceToArray(0, Nat.min(r.picks.size(), Config.taskMaxPoints)).map(func(p : Types.AiCheckPick) : Types.TaskPoint = point("post:" # p.itemId.toText(), switch (p.oaQuoteId) { case (?q) q.toText(); case null "" }, switch (p.oaQuoteId) { case (?q) #oaQuote(q); case null subject }))
        ), adjustedKeys(j.extra));
        actionId = actionOf(j.extra);
        state = pstate;
        decidedBy = if decided ?personWho(j.decidedBy) else null;
        decidedAt = if decided j.decidedAt else null;
        undo = #none;
      };
      case null null;
    };
    {
      src = #aiCheck(j.id);
      kind;
      workId = ?j.workId;
      subject;
      givenBy = #person(j.createdBy);
      doer;
      createdAt = j.createdAt;
      state;
      at = switch (j.decidedAt, j.result) { case (?d, _) d; case (null, ?r) r.at; case (null, null) j.createdAt };
      who = if (state == #ready or state == #busy) doer else if (isFinal(state)) personWho(j.decidedBy) else #person(j.createdBy);
      proposal;
    };
  };

  // 3.10 factuurcontrole.
  public func fromInvCheck(j : Types.InvCheckJob) : Shape {
    let doer = viaWho(j.via);
    let hasP = j.result != null;
    let agreed = func(human : Text) : Bool {
      switch (j.result) { case (?r) (r.verdict == "goedkeuren") == (human == "goedgekeurd"); case null false };
    };
    let (state, pstate) : (Types.TaskState, Types.ProposalState) = switch (j.status) {
      case (#open) (if (has(j.extra, "bezig") or has(j.extra, "uitgegeven")) #busy else #waiting, #open);
      case (#proposed) (#ready, #open);
      case (#closed why) {
        if (why == "gezien") (#done, #accepted)
        else if (why == "goedgekeurd" or why == "ingetrokken" or why == "beslist") (closedState(hasP), if (agreed(why)) #accepted else #rejected)
        else if (why.contains(#text "vervallen")) (closedState(hasP), #expired)
        else (closedState(hasP), #withdrawn);
      };
      case (#cancelled) (closedState(hasP), #rejected);
      case (#failed t) (#failed(failWord(t)), #withdrawn);
      case (#other t) (#other(word(t)), #other(word(t)));
    };
    let subject : Types.TaskRef = #oaInvoice(j.invoiceId);
    let decided = isFinal(state) and j.decidedAt != null;
    let proposal : ?ProposalShape = switch (j.result) {
      case (?r) ?{
        by = doer;
        at = r.at;
        auto = false;
        confidence = ?r.confidence;
        points = [point("oordeel", word(r.verdict), subject), point("bevindingen", r.findings.size().toText(), subject)];
        actionId = actionOf(j.extra);
        state = pstate;
        decidedBy = if decided ?personWho(j.decidedBy) else null;
        decidedAt = if decided j.decidedAt else null;
        undo = #none;
      };
      case null null;
    };
    {
      src = #invCheck(j.id);
      kind = "factuurcontrole";
      workId = ?j.workId;
      subject;
      givenBy = #person(j.createdBy);
      doer;
      createdAt = j.createdAt;
      state;
      at = switch (j.decidedAt, j.result) { case (?d, _) d; case (null, ?r) r.at; case (null, null) j.createdAt };
      who = if (state == #ready or state == #busy) doer else if (isFinal(state)) personWho(j.decidedBy) else #person(j.createdBy);
      proposal;
    };
  };

  // 3.4 een voorstel van een bot uit zichzelf (document koppelen, factuurcontrole zonder opdracht).
  public func fromAction(a : Types.BotAction) : Shape {
    let doer : Who = #bot(a.botId);
    let (state, pstate) : (Types.TaskState, Types.ProposalState) = switch (a.state) {
      case (#proposed) (#ready, #open);
      case (#accepted) (#done, #accepted);
      case (#rejected) (#done, #rejected);
      case (#done) (#done, #auto);
      case (#undone) (#done, #undone);
      case (#failed _) (#failed("mislukt"), #withdrawn);
      case (#expired) (#cancelled, #expired);
    };
    let (subject, points) : (Types.TaskRef, [Types.TaskPoint]) = switch (a.action) {
      case (#docLink d) (#file(d.fileId), [point("soort", word(d.kind), #file(d.fileId))]);
      case (#invoiceCheck i) (#oaInvoice(i.invoiceId), [point("oordeel", word(i.verdict), #oaInvoice(i.invoiceId)), point("opmerkingen", i.remarks.size().toText(), #oaInvoice(i.invoiceId))]);
      case (#other o) (#none, [point("tool", word(o.tool), #none)]);
    };
    let undo : Types.TaskUndo = switch (a.state, a.action) {
      case (#done or #accepted, #docLink _) #possible("ontkoppelen");
      case (#undone, _) #done(a.decidedAt ?? a.at);
      case _ #none;
    };
    let decided = a.state != #proposed;
    {
      src = #botAction(a.id);
      kind = a.task;
      workId = a.workId;
      subject;
      givenBy = doer;
      doer;
      createdAt = a.at;
      state;
      at = switch (a.decidedAt, a.appliedAt) { case (?d, _) d; case (null, ?x) x; case (null, null) a.at };
      who = switch (a.state) { case (#proposed or #done) doer; case (#expired or #failed _) #clock; case _ personWho(a.decidedBy) };
      proposal = ?{
        by = doer;
        at = a.at;
        auto = a.state == #done;
        confidence = null;
        points;
        actionId = ?a.id;
        state = pstate;
        decidedBy = if (a.state == #done) ?doer else if (decided) (switch (a.decidedBy) { case (?p) ?#person(p); case null ?#clock }) else null;
        decidedAt = if (a.state == #done) a.appliedAt else if (decided) a.decidedAt else null;
        undo;
      };
    };
  };

  // ── Het model bijwerken ─────────────────────────────────────────────────
  func newId(s : Types.TaskStore) : Nat { s.next += 1; s.next };
  func addEvent(t : Task, e : Types.TaskEvent) {
    let all = t.events.concat([e]);
    // Begrensd: de eerste regel (de taak gegeven) blijft altijd, daarna de laatste.
    t.events := if (all.size() <= Config.taskMaxEvents) all else [all[0]].concat(all.sliceToArray(all.size() - (Config.taskMaxEvents - 1 : Nat), all.size()));
  };
  func samePoints(a : [Types.TaskPoint], b : [Types.TaskPoint]) : Bool {
    a.size() == b.size() and Array.tabulate<Bool>(a.size(), func(i) = a[i].key == b[i].key and a[i].after == b[i].after and a[i].now == b[i].now and a[i].secret == b[i].secret and isAdjusted(a[i]) == isAdjusted(b[i])).all(func(x : Bool) : Bool = x);
  };

  // Eén dossier in het model zetten of gelijkzetten. Geeft true als er iets veranderde.
  public func put(s : Types.TaskStore, sh : Shape) : Bool {
    let key = srcKey(sh.src);
    let t : Task = switch (s.byKey.get(key)) {
      case (?id) switch (s.tasks.get(id)) { case (?x) x; case null { s.byKey.remove(key); return put(s, sh) } };
      case null {
        let id = newId(s);
        let t : Task = {
          id;
          key;
          kind = sh.kind;
          src = sh.src;
          workId = sh.workId;
          subject = sh.subject;
          givenBy = sh.givenBy;
          doer = sh.doer;
          createdAt = sh.createdAt;
          var state = #waiting;
          var updatedAt = sh.createdAt;
          var proposalId = null;
          var events = [{ at = sh.createdAt; who = sh.givenBy; what = "taak:" # stateKey(#waiting); extra = [] }];
          var extra = [];
        };
        s.tasks.add(id, t);
        s.byKey.add(key, id);
        switch (sh.workId) { case (?w) s.byWork.add(w, (s.byWork.get(w) ?? []).concat([id])); case null {} };
        t;
      };
    };
    var changed = false;
    // Het voorstel eerst (de tijdlijn toont het voorstel vóór de beslissing).
    switch (sh.proposal) {
      case (?ps) {
        let p : Proposal = switch (t.proposalId) {
          case (?pid) switch (s.proposals.get(pid)) { case (?x) x; case null { t.proposalId := null; return put(s, sh) } };
          case null {
            let pid = newId(s);
            let p : Proposal = {
              id = pid;
              taskId = t.id;
              by = ps.by;
              at = ps.at;
              auto = ps.auto;
              var confidence = ps.confidence;
              var points = ps.points;
              var actionId = ps.actionId;
              var state = #open;
              var decidedBy = null;
              var decidedAt = null;
              var undo = #none;
              var extra = [];
            };
            s.proposals.add(pid, p);
            t.proposalId := ?pid;
            addEvent(t, { at = ps.at; who = ps.by; what = "voorstel:" # proposalKey(#open); extra = [] });
            changed := true;
            p;
          };
        };
        if (p.confidence != ps.confidence) { p.confidence := ps.confidence; changed := true };
        if (not samePoints(p.points, ps.points)) { p.points := ps.points; changed := true };
        if (p.actionId != ps.actionId) { p.actionId := ps.actionId; changed := true };
        if (p.state != ps.state) {
          p.state := ps.state;
          p.decidedBy := ps.decidedBy;
          p.decidedAt := ps.decidedAt;
          addEvent(t, { at = ps.decidedAt ?? sh.at; who = ps.decidedBy ?? sh.who; what = "voorstel:" # proposalKey(ps.state); extra = [] });
          changed := true;
        } else if (p.decidedBy != ps.decidedBy or p.decidedAt != ps.decidedAt) {
          p.decidedBy := ps.decidedBy;
          p.decidedAt := ps.decidedAt;
          changed := true;
        };
        if (p.undo != ps.undo) { p.undo := ps.undo; changed := true };
      };
      case null {};
    };
    if (t.state != sh.state) {
      t.state := sh.state;
      // Een voorstel dat binnenkomt is al één regel ("voorstel:open"); "taak:voorstel" zou dubbel zijn.
      if (sh.state != #ready) addEvent(t, { at = sh.at; who = sh.who; what = "taak:" # stateKey(sh.state); extra = [] });
      changed := true;
    };
    if (changed) t.updatedAt := Int.max(t.updatedAt, sh.at);
    changed;
  };

  // Alles gelijkzetten. `full` ruimt ook op (enkel in de klokronde): een taak waarvan het dossier weg is (de soort ruimt na 90 dagen
  // op) blijft staan voor de tijdlijn, en gaat pas Config.taskKeep na de laatste wijziging weg. Geeft het aantal gewijzigde taken.
  public func sync(s : Types.TaskStore, e : Env, now : Int, full : Bool) : Nat {
    var n = 0;
    let linked = Map.empty<Nat, ()>();
    for (j in e.oaRead.jobs.values()) { if (put(s, fromOaRead(j, e.tenders))) n += 1; switch (actionOf(j.extra)) { case (?a) linked.add(a, ()); case null {} } };
    for (j in e.aiCheck.jobs.values()) { if (put(s, fromAiCheck(j))) n += 1; switch (actionOf(j.extra)) { case (?a) linked.add(a, ()); case null {} } };
    for (j in e.invCheck.jobs.values()) { if (put(s, fromInvCheck(j))) n += 1; switch (actionOf(j.extra)) { case (?a) linked.add(a, ()); case null {} } };
    // Review 4b.5 M1: een opdracht wordt na 90 dagen opgeruimd, de actie van de bot niet. De koppeling staat ook in het model (het
    // voorstel van de taak van de opdracht), zodat die actie dan geen tweede, eigen taak krijgt.
    for (p in s.proposals.values()) {
      switch (p.actionId, s.tasks.get(p.taskId)) {
        case (?a, ?t) switch (t.src) { case (#botAction _) {}; case _ linked.add(a, ()) };
        case _ {};
      };
    };
    for (a in e.bots.actions.values()) {
      if (linked.get(a.id) != null) {
        // Hoort bij een opdracht: nooit een eigen taak (een eventuele losse taak van vroeger gaat weg).
        switch (s.byKey.get("bot:" # a.id.toText())) { case (?id) { drop(s, id); n += 1 }; case null {} };
      } else if (put(s, fromAction(a))) n += 1;
    };
    if (full) {
      let old = List.empty<Nat>();
      for (t in s.tasks.values()) {
        if (isFinal(t.state) and now - t.updatedAt > Config.taskKeep and not exists(e, t.src)) old.add(t.id);
      };
      for (id in old.values()) { drop(s, id); n += 1 };
    };
    n;
  };

  public func exists(e : Env, src : Types.TaskSrc) : Bool {
    switch src {
      case (#oaRead id) e.oaRead.jobs.containsKey(id);
      case (#aiCheck id) e.aiCheck.jobs.containsKey(id);
      case (#invCheck id) e.invCheck.jobs.containsKey(id);
      case (#botAction id) e.bots.actions.containsKey(id);
      case (#other _) false;
    };
  };

  func drop(s : Types.TaskStore, id : Nat) {
    let t = s.tasks.get(id) ?? return;
    switch (t.proposalId) { case (?p) s.proposals.remove(p); case null {} };
    s.byKey.remove(t.key);
    switch (t.workId) { case (?w) s.byWork.add(w, (s.byWork.get(w) ?? []).filter(func(x : Nat) : Bool = x != id)); case null {} };
    s.tasks.remove(id);
  };

  // ── Lezen ───────────────────────────────────────────────────────────────
  public func byKey(s : Types.TaskStore, key : Text) : ?Task { switch (s.byKey.get(key)) { case (?id) s.tasks.get(id); case null null } };
  public func proposalOf(s : Types.TaskStore, t : Task) : ?Proposal { switch (t.proposalId) { case (?p) s.proposals.get(p); case null null } };
  public func ofWork(s : Types.TaskStore, workId : Nat) : [Task] {
    (s.byWork.get(workId) ?? []).filterMap(func(id : Nat) : ?Task = s.tasks.get(id));
  };
  // De taken van één soort bron, in de volgorde van hun dossier (het nummer van de bron).
  public func ofSource(s : Types.TaskStore, which : Text) : [Task] {
    let out = List.empty<(Nat, Task)>();
    for (t in s.tasks.values()) {
      switch (t.src, which) {
        case (#oaRead id, "oaread") out.add((id, t));
        case (#aiCheck id, "check") out.add((id, t));
        case (#invCheck id, "invcheck") out.add((id, t));
        case (#botAction id, "bot") out.add((id, t));
        case _ {};
      };
    };
    out.toArray().sort(func(a : (Nat, Task), b : (Nat, Task)) : Order.Order = Nat.compare(a.0, b.0)).map(func((_, t) : (Nat, Task)) : Task = t);
  };
};
