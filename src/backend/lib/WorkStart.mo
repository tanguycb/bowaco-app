// Offerte → werf (stap 2.8, bouwplan §9 rij 2.8; VOORLOPIG tot Alexis bevestigt): het VOORSTEL "Werf starten" uit een
// aanvaarde offerteversie. Geen rechten hier (lib/Rights.mo) en niets bewaren: dit bestand rekent alleen, zodat het
// voorstel (query) en de bevestiging (update) exact hetzelfde uitkomen.
//   - Taken: de posten (en de opties die de klant toch aanvaardde) per stap van het sjabloon "standaardrenovatie" (1.3); de
//     stap komt uit de post in de bibliotheek (2.2), anders uit woorden in de titel of het hoofdstuk, anders uit het
//     vakgebied; zonder stap één taak per hoofdstuk. Duur en vakgebied/OA uit de bibliotheek; volgorde en afhankelijkheden
//     uit het sjabloon. Heeft de werf al een taak voor die stap, dan worden de lijnen eraan gekoppeld (geen dubbel).
//   - Vergunningen: woorden van de vergunningssoorten (1b.1) in een taak of post → voorstel met uiterste aanvraagdag.
//   - 30bis: de aanneemsom = de som van de aanvaarde versies die op deze werf gestart zijn (elk de laatste per offerte), het
//     aantal onderaannemers = de werf + de OA's van de nieuwe taken (1b.4).
//   - Meerwerk: lijnen waarvan de oorsprong (de lijn van de eerste versie) al een taak kreeg, tellen niet meer mee.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import SV "../types/startviews";
import Access "Access";
import Config "Config";
import Dossier "Dossier";
import Oa "Oa";
import Permits "Permits";
import Plan "Plan";
import QuoteRules "QuoteRules";
import Quotes "Quotes";
import Wadm "Wadm";

module {
  type Day = Types.Day;

  public type Ctx = {
    settings : Types.SettingsState;
    org : Types.OrgState;
    works : Types.WorksState;
    dossier : Types.DossierState;
    plan : Types.PlanState;
    permits : Types.PermitState;
    wadm : Types.WadmState;
    library : Types.LibraryState;
    quotes : Types.QuotesState;
    quoteDocs : Types.QuoteDocsState;
    starts : Types.WorkStartState;
  };

  // Een taak van het voorstel (intern; de view zet er namen bij).
  public type Group = {
    key : Text;
    title : Text;
    stepKey : ?Text;
    kind : Types.TaskKind;
    trade : ?Text;
    orgId : ?Nat;
    extraOrgs : [Nat];
    workdays : Nat;
    daysFrom : Text;
    leadDays : Nat;
    lineIds : [Nat];
    existing : ?Types.Task;
    companion : Bool;
  };

  public type DepFrom = { #group : Text; #task : Nat };
  public type Dep = { from : DepFrom; to : Text; lag : Int };

  public type PermitProposal = {
    kind : Text;
    kindName : Text;
    groups : [Text]; // groepssleutels
    reason : Text;
    from : ?Day;
    to : ?Day;
    leadDays : Nat;
    municipalityId : ?Nat;
    municipality : Text;
    exists : Bool;
    skipped : Bool;
  };

  public type Proposal = {
    template : Types.Template;
    startDay : Day;
    groups : [Group];
    deps : [Dep];
    pos : Map.Map<Text, Plan.Pos>; // groep → start en duur na het rekenen
    lines : [SV.WorkStartLine];
    skipped : [SV.WorkStartNote];
    changed : [SV.WorkStartNote];
    removed : [SV.WorkStartNote];
    permits : [PermitProposal];
    bases : [Types.WorkStart];
    oaCount : Nat;
    amount : ?Int; // vertrouwelijk: enkel voor het contract, nooit in een view
    art30bis : ?Bool;
    art30bisReason : Text;
    checkinatwork : ?Bool;
    end : ?Day;
    warnings : [Text];
    error : ?Text;
  };

  // Werfgegevens die het voorstel nodig heeft (bestaande werf of de nieuwe die er zou komen).
  public type Target = { workId : ?Nat; address : Types.Address; plannedStart : ?Day; cal : Plan.Cal };

  // Neppe ids voor taken en afhankelijkheden die nog niet bestaan (enkel om te rekenen met Plan.schedule).
  let fake : Nat = 3_000_000_000_000;

  public func today() : Day { let t = Time.now(); if (t <= 0) 0 else Int.abs(t) / Int.abs(Config.day) };

  // ── Kleine hulp ──────────────────────────────────────────────────────────
  // De lijn van de eerste versie waarvan deze lijn een kopie is (begrensd: hoogstens maxQuoteVersions stappen terug).
  public func root(qs : Types.QuotesState, lineId : Nat) : Nat {
    var id = lineId;
    var n = 0;
    label up while (n < 200) {
      switch (qs.lines.get(id)) {
        case (?l) { switch (l.copiedFrom) { case (?p) { id := p }; case null break up } };
        case null break up;
      };
      n += 1;
    };
    id;
  };

  // Woorden van een tekst: kleine letters, zonder accenten, enkel a-z en 0-9 (zoals de controleregels van 2.6).
  public func words(t : Text) : [Text] {
    QuoteRules.norm(t).split(#char ' ').map(func(w : Text) : Text = Oa.fold(w)).filter(func(w : Text) : Bool = w.size() > 0).toArray();
  };

  // Een woord van minder dan 4 tekens moet een heel woord zijn; een langer woord mag het begin zijn ("afbraak" vindt
  // "afbraakwerken", "pur" vindt "PUR-isolatie" maar niet "puree"). Zelfde regel als de standaardposten van 2.6.
  public func hit(ws : [Text], kw : Text) : Bool {
    let k = Oa.fold(kw);
    if (k.size() == 0) { return false };
    if (k.size() < 4) ws.any(func w = w == k) else ws.any(func w = w.startsWith(#text k));
  };

  // Woorden van een stap waarop een post gevonden wordt: de sleutel en de langere woorden van de titel, zonder de woorden
  // die bij veel stappen passen.
  let stop : [Text] = ["levering", "plaatsen", "werken", "geregeld", "inname", "openbaar", "domein", "beschermen", "slijpwerk", "leidingen", "kanalen", "dagkanten", "voorlopige", "werfinrichting", "werfvoorbereiding"];
  func keyWords(s : Types.TemplateStep) : [Text] {
    s.key.split(#char '-').map(func(w : Text) : Text = Oa.fold(w)).filter(func(w : Text) : Bool = w.size() >= 3).toArray();
  };
  func titleWords(s : Types.TemplateStep) : [Text] {
    words(s.title).filter(func w = w.size() >= 5 and stop.find(func x = x == w) == null);
  };

  // Ook een stam: een woord van de post (≥ 6 tekens) waarmee een woord van de stap begint ("schilderwerk" → "schilderwerken").
  func hitStem(ws : [Text], kw : Text) : Bool {
    hit(ws, kw) or ws.any(func w = w.size() >= 6 and kw.startsWith(#text w));
  };

  // De beste stap voor deze woorden: een treffer op de sleutel van de stap telt dubbel (de sleutel is het meest eigen woord),
  // een woord van de titel enkel; bij gelijke stand de eerste in het sjabloon. Enkel werkstappen en mijlpalen (een levering
  // komt mee met de stap die erop wacht).
  func bestStep(steps : [Types.TemplateStep], ws : [Text]) : ?Types.TemplateStep {
    var best : ?Types.TemplateStep = null;
    var score = 0;
    for (s in steps.values()) {
      if (s.kind != #delivery) {
        let n = 2 * keyWords(s).filter(func k = hitStem(ws, k)).size() + titleWords(s).filter(func k = hitStem(ws, k)).size();
        if (n > score) { best := ?s; score := n };
      };
    };
    best;
  };

  public func optText(t : ?Text) : Text { switch t { case (?x) x; case null "" } };

  public func tradeName(s : Types.SettingsState, key : ?Text) : Text {
    switch key {
      case (?k) { switch (Oa.trades(s, true).find(func t = t.key == k)) { case (?t) t.name; case null k } };
      case null "";
    };
  };

  public func orgName(org : Types.OrgState, id : ?Nat) : Text {
    switch id { case (?o) { switch (org.orgs.get(o)) { case (?x) x.name; case null "#" # o.toText() } }; case null "" };
  };

  // De bedrijfskalender (bouwverlof, feestdagen) zonder blokken van een werf: voor een werf die nog niet bestaat.
  public func companyCal(plan : Types.PlanState) : Plan.Cal {
    { blocks = plan.calendarBlocks.values().filter(func b = b.archivedAt == null and b.scope == #company).map(func b = (b.from, b.to)).toArray() };
  };

  // ── Starts, voorstellen en akkoord ───────────────────────────────────────
  public func startsOn(st : Types.WorkStartState, workId : Nat) : [Types.WorkStart] {
    st.starts.values().filter(func s = s.workId == workId and s.status == #started).toArray().sort(func(a, b) = Int.compare(a.at, b.at));
  };

  public func acceptedHow(qd : Types.QuoteDocsState, v : Types.QuoteVersion) : Text {
    switch (qd.acceptances.get(v.id)) {
      case (?a) { if (a.digital != null) "digitaal akkoord van de klant" else if (a.signed != null) "getekende offerte" else "geregistreerd door kantoor" };
      case null "geregistreerd door kantoor";
    };
  };

  public func acceptedAt(qd : Types.QuoteDocsState, v : Types.QuoteVersion) : Int {
    switch (qd.acceptances.get(v.id)) {
      case (?a) {
        switch (a.digital, a.signed) { case (?d, _) d.at; case (null, ?s) s.at; case _ { switch (v.decision) { case (?d) d.at; case null v.updatedAt } } };
      };
      case null { switch (v.decision) { case (?d) d.at; case null v.updatedAt } };
    };
  };

  // Een aanvaarde versie vraagt een voorstel als ze geen start of afwijzing heeft en er geen latere versie van dezelfde
  // offerte gestart of afgewezen werd (dan is deze voorbij).
  public func isPending(c : Ctx, v : Types.QuoteVersion) : Bool {
    if (v.status != #accepted or c.starts.starts.containsKey(v.id)) { return false };
    not Quotes.versionsOf(c.quotes, v.quoteId).any(func x = x.version > v.version and c.starts.starts.containsKey(x.id));
  };

  // ── Het voorstel ─────────────────────────────────────────────────────────
  public func templateOf(plan : Types.PlanState, key : Text) : ?Types.Template {
    let k = if (key == "") Config.defaultTemplateKey else key;
    switch (Plan.template(plan, k)) { case (?t) { if (t.archivedAt == null) ?t else null }; case null null };
  };

  // Standaard startdatum (VOORLOPIG, vraag aan Alexis): de geplande start van de werf als die nog komt, anders over 4 weken
  // (eerste start: tijd voor de vergunningen) of over 1 week (meerwerk op een lopende werf).
  public func defaultStart(t : Target, meerwerk : Bool) : Day {
    let now = today();
    let base = switch (t.plannedStart) { case (?d) { if (d > now) d else 0 }; case null 0 };
    Plan.nextWorkday(t.cal, if (base > 0) base else now + (if meerwerk 7 else Config.workStartLeadDaysDefault));
  };

  public func propose(c : Ctx, q : Types.Quote, v : Types.QuoteVersion, t : Target, i : SV.WorkStartInput) : Proposal {
    let tpl = switch (templateOf(c.plan, i.templateKey)) { case (?x) x; case null Plan.defaultTemplate() };
    let steps = tpl.steps;
    let stepOf = func(k : Text) : ?Types.TemplateStep { steps.find(func s = s.key == k) };
    let warnings = List.empty<Text>();
    let bases : [Types.WorkStart] = switch (t.workId) { case (?w) startsOn(c.starts, w); case null [] };
    let meerwerk = bases.size() > 0;
    let startDay = if (i.startDay == 0) defaultStart(t, meerwerk) else Plan.nextWorkday(t.cal, i.startDay);
    let existingTasks : [Types.Task] = switch (t.workId) { case (?w) Plan.tasksOf(c.plan, w); case null [] };
    let existingDeps : [Types.Dependency] = switch (t.workId) { case (?w) Plan.depsOf(c.plan, w); case null [] };

    // Wat al gepland is: de oorsprong van de lijnen van eerdere starts op deze werf, met hun hoeveelheid.
    let covered = Map.empty<Nat, Int>();
    let coveredQuote = Map.empty<Nat, Nat>(); // oorsprong → offerte (voor "vervallen in deze versie")
    for (b in bases.values()) {
      for ((k, lid) in b.lineIds.enumerate()) {
        let r = if (k < b.roots.size()) b.roots[k] else root(c.quotes, lid);
        switch (c.quotes.lines.get(lid)) { case (?l) { covered.add(r, l.qtyMilli) }; case null { covered.add(r, 0) } };
        coveredQuote.add(r, b.quoteId);
      };
    };

    let chapters = Quotes.chaptersOf(c.quotes, v.id);
    let chTitle = Map.empty<Nat, Text>();
    for (ch in chapters.values()) { chTitle.add(ch.id, [ch.code, ch.title].filter(func(x : Text) : Bool = x != "").values().join(" ")) };
    let lines = Quotes.linesOf(c.quotes, v.id, chapters);
    let override = Map.empty<Nat, Text>();
    for ((lid, s) in i.lineSteps.values()) { override.add(lid, s) };
    let optionsOk = Map.empty<Nat, ()>();
    for (o in i.options.values()) { optionsOk.add(o, ()) };

    let outLines = List.empty<SV.WorkStartLine>();
    let skipped = List.empty<SV.WorkStartNote>();
    let changed = List.empty<SV.WorkStartNote>();
    let present = Map.empty<Nat, ()>(); // oorsprong van de lijnen van deze versie
    // groep → (lijnen, dagen, bekende dagen?, vakgebieden, OA's met dagen)
    type Acc = { var lines : [Nat]; var days : Nat; var known : Bool; trades : Map.Map<Text, Nat>; orgs : Map.Map<Nat, Nat>; var firstPos : Nat };
    let acc = Map.empty<Text, Acc>();
    let groupOrder = List.empty<Text>();
    var pos = 0;
    let note = func(l : Types.QuoteLine, why : Text) : SV.WorkStartNote { { lineId = l.id; code = l.code; title = l.title; why } };
    for (l in lines.values()) {
      pos += 1;
      if (l.kind != #text) {
        let r = root(c.quotes, l.id);
        present.add(r, ());
        let ov = override.get(l.id);
        let isOption = l.kind == #option;
        let chosen = switch ov { case (?s) s != "skip"; case null false };
        if (ov == ?"skip") { skipped.add(note(l, "geen taak (gekozen)")) }
        else if (covered.containsKey(r)) {
          switch (covered.get(r)) { case (?q0) { if (q0 != l.qtyMilli) { changed.add(note(l, "hoeveelheid gewijzigd (de taak bestaat al)")) } }; case null {} };
        }
        else if (isOption and not optionsOk.containsKey(l.id)) { skipped.add(note(l, "optie niet aanvaard")) }
        else if (l.qtyMilli < 0 and not chosen) { skipped.add(note(l, "minwerk")) }
        else if (l.qtyMilli == 0 and not chosen) { skipped.add(note(l, "pro memorie (hoeveelheid 0)")) }
        else {
          let item : ?Types.LibItem = switch (l.libItemId) { case (?id) c.library.items.get(id); case null null };
          let lws = words(l.title);
          let chws = words(switch (chTitle.get(l.chapterId)) { case (?x) x; case null "" });
          // De stap: gekozen > bibliotheek > titel > hoofdstuk > vakgebied (enkel als één stap dat vakgebied heeft) > geen.
          let (stepKey, how) : (?Text, Text) = switch ov {
            case (?s) {
              if (s.startsWith(#text "step:")) {
                let k = Text.fromIter(s.chars().drop(5));
                if (stepOf(k) != null) (?k, "gekozen") else (null, "eigen hoofdstuk");
              } else (null, "gekozen");
            };
            case null {
              let fromLib : ?Text = switch item { case (?it) { switch (it.planStepKey) { case (?k) { if (stepOf(k) != null) ?k else null }; case null null } }; case null null };
              switch fromLib {
                case (?k) (?k, "bibliotheek");
                case null {
                  switch (bestStep(steps, lws)) {
                    case (?s) (?s.key, "titel");
                    case null {
                      switch (bestStep(steps, chws)) {
                        case (?s) (?s.key, "hoofdstuk");
                        case null {
                          let tr = switch item { case (?it) it.trade; case null null };
                          let same = switch tr { case (?x) steps.filter(func s = s.trade == ?x and s.kind == #work); case null [] };
                          if (same.size() == 1) (?same[0].key, "vakgebied") else (null, "eigen hoofdstuk");
                        };
                      };
                    };
                  };
                };
              };
            };
          };
          let gkey = switch stepKey { case (?k) "step:" # k; case null "ch:" # l.chapterId.toText() };
          // Duur van de post: standaardduur, anders hoeveelheid per werkdag (naar boven afgerond).
          let days : ?Nat = switch item {
            case (?it) {
              switch (it.durationDays, it.perDayMilli) {
                case (?d, _) ?d;
                case (null, ?pd) { if (pd > 0 and l.qtyMilli > 0) ?((Int.abs(l.qtyMilli) + Int.abs(pd) - 1) / Int.abs(pd)) else null };
                case _ null;
              };
            };
            case null null;
          };
          let a = switch (acc.get(gkey)) {
            case (?x) x;
            case null {
              let x : Acc = { var lines = []; var days = 0; var known = false; trades = Map.empty(); orgs = Map.empty(); var firstPos = pos };
              acc.add(gkey, x);
              groupOrder.add(gkey);
              x;
            };
          };
          a.lines := a.lines.concat([l.id]);
          switch days { case (?d) { a.days += d; a.known := true }; case null {} };
          let weight = switch days { case (?d) Nat.max(d, 1); case null 1 };
          switch item {
            case (?it) {
              switch (it.trade) { case (?tr) { a.trades.add(tr, (switch (a.trades.get(tr)) { case (?n) n; case null 0 }) + weight) }; case null {} };
              switch (it.orgId) { case (?o) { a.orgs.add(o, (switch (a.orgs.get(o)) { case (?n) n; case null 0 }) + weight) }; case null {} };
            };
            case null {};
          };
          outLines.add({
            lineId = l.id;
            code = l.code;
            title = l.title;
            chapter = switch (chTitle.get(l.chapterId)) { case (?x) x; case null "" };
            option = isOption;
            qtyMilli = l.qtyMilli;
            unit = l.unit;
            group = gkey;
            how;
            days;
            orgName = switch item { case (?it) orgName(c.org, it.orgId); case null "" };
            tradeName = switch item { case (?it) tradeName(c.settings, it.trade); case null "" };
          });
        };
      };
    };
    // Meerwerk: lijnen van dezelfde offerte die al gepland waren en in deze versie niet meer staan.
    let removed = List.empty<SV.WorkStartNote>();
    for ((r, qid) in coveredQuote.entries()) {
      if (qid == q.id and not present.containsKey(r)) {
        switch (c.quotes.lines.get(r)) { case (?l) removed.add({ lineId = l.id; code = l.code; title = l.title; why = "staat niet meer in deze versie (de taak blijft; pas ze aan in de planning)" }); case null {} };
      };
    };

    // ── Groepen ──
    func bestOf<K>(m : Map.Map<K, Nat>) : ?K {
      var best : ?K = null;
      var most = 0;
      for ((k, x) in m.entries()) { if (x > most) { best := ?k; most := x } };
      best;
    };
    let dayOverride = Map.empty<Text, Nat>();
    for ((k, d) in i.groupDays.values()) { dayOverride.add(k, d) };
    let existingByStep = func(k : Text) : ?Types.Task {
      existingTasks.find(func x = x.templateKey == ?k and x.status != #done);
    };
    let anyExistingStep = func(k : Text) : Bool { existingTasks.any(func x = x.templateKey == ?k) };
    let groups = List.empty<Group>();
    let byKey = Map.empty<Text, Group>();
    let addGroup = func(g : Group) { groups.add(g); byKey.add(g.key, g) };
    // In de volgorde van het sjabloon, daarna de hoofdstukken in de volgorde van de offerte.
    let stepGroups = List.empty<Text>();
    for (s in steps.values()) { if (acc.containsKey("step:" # s.key)) { stepGroups.add("step:" # s.key) } };
    let chGroups = groupOrder.toArray().filter(func k = k.startsWith(#text "ch:"));
    for (gkey in stepGroups.toArray().concat(chGroups).values()) {
      switch (acc.get(gkey)) {
        case (?a) {
          let step : ?Types.TemplateStep = if (gkey.startsWith(#text "step:")) stepOf(Text.fromIter(gkey.chars().drop(5))) else null;
          let kind = switch step { case (?s) s.kind; case null #work };
          let trade : ?Text = switch (bestOf<Text>(a.trades)) { case (?x) ?x; case null { switch step { case (?s) s.trade; case null null } } };
          let orgId = bestOf<Nat>(a.orgs);
          let extra = a.orgs.keys().filter(func o = ?o != orgId).toArray();
          let existing : ?Types.Task = switch step { case (?s) existingByStep(s.key); case null null };
          let (wd, from) : (Nat, Text) = switch existing {
            case (?e) (e.workdays, "bestaande taak");
            case null {
              if (kind != #work) (0, "sjabloon")
              else switch (dayOverride.get(gkey)) {
                case (?d) (Nat.max(1, Nat.min(d, Config.maxWorkdays)), "gekozen");
                case null {
                  if (a.known) (Nat.max(1, Nat.min(a.days, Config.maxWorkdays)), "bibliotheek")
                  else switch step { case (?s) (Nat.max(1, s.workdays), "sjabloon"); case null (Config.workStartDefaultDays, "geschat") };
                };
              };
            };
          };
          let title = switch (existing, step) {
            case (?e, _) e.title;
            case (null, ?s) s.title;
            case (null, null) { switch (chTitle.get(Nat.fromText(Text.fromIter(gkey.chars().drop(3))) ?? 0)) { case (?x) x; case null "Hoofdstuk" } };
          };
          let title2 = if (meerwerk and existing == null) title # " (meerwerk " # q.number # " v" # v.version.toText() # ")" else title;
          addGroup({ key = gkey; title = Text.fromIter(title2.chars().take(Config.maxName)); stepKey = switch step { case (?s) ?s.key; case null null }; kind; trade; orgId; extraOrgs = extra; workdays = wd; daysFrom = from; leadDays = switch step { case (?s) s.leadDays; case null 0 }; lineIds = a.lines; existing; companion = false });
        };
        case null {};
      };
    };
    // Leveringen die meekomen met de stap die erop wacht, en de laatste mijlpaal (oplevering), als de werf ze nog niet heeft.
    for (s in steps.values()) {
      let gk = "step:" # s.key;
      if (not byKey.containsKey(gk) and not anyExistingStep(s.key)) {
        let waitedBy = steps.filter(func x = x.after.find(func a = a == s.key) != null);
        let needed = switch (s.kind) {
          case (#delivery) waitedBy.any(func x = switch (byKey.get("step:" # x.key)) { case (?g) g.existing == null; case null false });
          case (#milestone) waitedBy.size() == 0 and groups.size() > 0 and not meerwerk;
          case (#work) false;
        };
        if needed {
          addGroup({ key = gk; title = s.title; stepKey = ?s.key; kind = s.kind; trade = s.trade; orgId = null; extraOrgs = []; workdays = 0; daysFrom = "sjabloon"; leadDays = s.leadDays; lineIds = []; existing = null; companion = true });
        };
      };
    };

    // ── Afhankelijkheden (enkel naar nieuwe taken) ──
    let deps = List.empty<Dep>();
    let depSeen = Map.empty<Text, ()>();
    let addDep = func(from : DepFrom, to : Text, lag : Int) {
      let k = (switch from { case (#group g) g; case (#task id) "t" # id.toText() }) # ">" # to;
      if (not depSeen.containsKey(k)) { depSeen.add(k, ()); deps.add({ from; to; lag }) };
    };
    // Voorgangers van een stap die er zijn (nieuwe groep of bestaande taak); anders verder terug in het sjabloon.
    func resolve(k : Text, visited : Map.Map<Text, ()>) : [DepFrom] {
      if (visited.containsKey(k)) { return [] };
      visited.add(k, ());
      switch (byKey.get("step:" # k)) {
        case (?g) { switch (g.existing) { case (?e) [#task(e.id)]; case null [#group(g.key)] } };
        case null {
          switch (existingTasks.find(func x = x.templateKey == ?k)) {
            case (?e) [#task(e.id)];
            case null {
              switch (stepOf(k)) {
                case (?s) { s.after.values().map(func(a : Text) : [DepFrom] = resolve(a, visited)).foldLeft([], func(acc0 : [DepFrom], xs : [DepFrom]) : [DepFrom] = acc0.concat(xs)) };
                case null [];
              };
            };
          };
        };
      };
    };
    var prevGroup : ?Text = null;
    let isFinal = func(g : Group) : Bool { g.companion and g.kind == #milestone };
    for (g in groups.values()) {
      if (g.existing == null and not isFinal(g)) {
        switch (g.stepKey) {
          case (?k) {
            switch (stepOf(k)) {
              case (?s) {
                var first = true;
                for (a in s.after.values()) {
                  // De wachttijd hoort bij de EERSTE voorganger (droogtijd chape) en geldt enkel als die stap er echt is
                  // (nieuw of al op de werf); wie verder terug in het sjabloon wacht, wacht zonder die droogtijd.
                  let direct = byKey.containsKey("step:" # a) or existingTasks.any(func x = x.templateKey == ?a);
                  let lag : Int = if (first and direct) s.lagDays else 0;
                  first := false;
                  for (f in resolve(a, Map.empty()).values()) { addDep(f, g.key, lag) };
                };
              };
              case null {};
            };
          };
          case null {
            // Een hoofdstuk zonder stap wacht op de groep ervoor (in de volgorde van de offerte).
            switch prevGroup { case (?pg) { switch (byKey.get(pg)) { case (?p) { switch (p.existing) { case (?e) addDep(#task(e.id), g.key, 0); case null addDep(#group(pg), g.key, 0) } }; case null {} } }; case null {} };
          };
        };
      };
      if (not g.companion) { prevGroup := ?g.key };
    };
    // De laatste mijlpaal (oplevering) wacht op elke taak waar niets anders op wacht (ook de hoofdstukken zonder stap).
    for (g in groups.values()) {
      if (isFinal(g)) {
        for (x in groups.values()) {
          if (x.key != g.key and not isFinal(x) and not deps.values().any(func(d : Dep) : Bool = d.from == #group(x.key) or (switch (x.existing) { case (?e) d.from == #task(e.id); case null false }))) {
            switch (x.existing) { case (?e) addDep(#task(e.id), g.key, 0); case null addDep(#group(x.key), g.key, 0) };
          };
        };
      };
    };
    // Overbodige afhankelijkheden weg: wacht een taak op A én op B, en wacht B (verder in de keten) al op A, dan volstaat B.
    let all = deps.toArray();
    func reaches(from : Text, target : Text, seen : Map.Map<Text, ()>) : Bool {
      if (from == target) { return true };
      if (seen.containsKey(from)) { return false };
      seen.add(from, ());
      all.any(func(d : Dep) : Bool = d.from == #group(from) and reaches(d.to, target, seen));
    };
    let depList = all.filter(
      func(d : Dep) : Bool {
        switch (d.from) {
          case (#group a) {
            not all.any(func(o : Dep) : Bool = o.to == d.to and (switch (o.from) { case (#group b) b != a and reaches(a, b, Map.empty()); case (#task _) false }));
          };
          case (#task _) true;
        };
      }
    );

    // ── Rekenen met de kalender: neppe taken voor de nieuwe groepen, de bestaande taken staan vast ──
    let gs = groups.toArray();
    let fakeId = Map.empty<Text, Nat>();
    var n = 0;
    let fakeTasks = List.empty<Types.Task>();
    for (g in gs.values()) {
      switch (g.existing) {
        case (?e) { fakeId.add(g.key, e.id) };
        case null {
          let id = fake + n;
          n += 1;
          fakeId.add(g.key, id);
          fakeTasks.add({ id; workId = 0; title = g.title; note = ""; kind = g.kind; templateKey = g.stepKey; trade = g.trade; responsibleOrgId = g.orgId; status = #planned; percent = 0; start = startDay; workdays = g.workdays; leadDays = g.leadDays; orderDay = null; actualStart = null; actualEnd = null; order = 0; quoteLineIds = []; createdAt = 0; createdBy = 0; updatedAt = 0; updatedBy = 0; archivedAt = null; extra = [] });
        };
      };
    };
    var dn = 0;
    let fakeDeps = depList.map(
      func(d : Dep) : Types.Dependency {
        dn += 1;
        let from = switch (d.from) { case (#task id) id; case (#group k) switch (fakeId.get(k)) { case (?x) x; case null 0 } };
        let to = switch (fakeId.get(d.to)) { case (?x) x; case null 0 };
        { id = fake + dn; workId = 0; fromTaskId = from; toTaskId = to; kind = #finishToStart; lagDays = d.lag; createdAt = 0; createdBy = 0; archivedAt = null };
      }
    );
    let posMap = Map.empty<Text, Plan.Pos>();
    var error : ?Text = null;
    switch (Plan.schedule(t.cal, existingTasks.concat(fakeTasks.toArray()), existingDeps.concat(fakeDeps), #reflow, func x = x.id >= fake)) {
      case (#ok shifts) {
        for (g in gs.values()) {
          switch (g.existing) {
            case (?e) { posMap.add(g.key, { start = e.start; workdays = e.workdays }) };
            case null {
              let id = switch (fakeId.get(g.key)) { case (?x) x; case null 0 };
              switch (shifts.find(func s = s.taskId == id)) {
                case (?s) { posMap.add(g.key, { start = s.toStart; workdays = s.toWorkdays }) };
                case null { posMap.add(g.key, { start = Plan.nextWorkday(t.cal, startDay); workdays = g.workdays }) };
              };
            };
          };
        };
      };
      case (#err e) { error := ?e };
    };
    var end : ?Day = null;
    for (g in gs.values()) {
      switch (posMap.get(g.key)) {
        case (?p) { let e = Plan.endDay(t.cal, p.start, p.workdays); end := ?(switch end { case (?x) Nat.max(x, e); case null e }) };
        case null {};
      };
    };

    // ── Vergunningen: woorden van een soort in de taak of in een post ervan ──
    let muni = Permits.municipalityFor(c.permits, t.address);
    let muniId : ?Nat = switch muni { case (?m) ?m.id; case null null };
    let skipKinds = Map.empty<Text, ()>();
    for (k in i.skipPermits.values()) { skipKinds.add(k, ()) };
    let permitsOut = List.empty<PermitProposal>();
    for (k in Permits.kinds(c.settings, false).values()) {
      if (k.words.size() > 0) {
        var hits : [Text] = [];
        var reason = "";
        for (g in gs.values()) {
          let taskWs = words(g.title # " " # optText(g.stepKey));
          var found = k.words.any(func w = hit(taskWs, w));
          var why = if found "taak «" # g.title # "»" else "";
          if (not found) {
            for (lid in g.lineIds.values()) {
              if (not found) {
                switch (c.quotes.lines.get(lid)) {
                  case (?l) { if (k.words.any(func w = hit(words(l.title), w))) { found := true; why := "post «" # l.title # "»" } };
                  case null {};
                };
              };
            };
          };
          if found {
            hits := hits.concat([g.key]);
            if (reason == "") { reason := why };
          };
        };
        if (hits.size() > 0) {
          var from : ?Day = null;
          var to : ?Day = null;
          for (gk in hits.values()) {
            switch (posMap.get(gk)) {
              case (?p) {
                let e = Plan.endDay(t.cal, p.start, p.workdays);
                from := ?(switch from { case (?x) Nat.min(x, p.start); case null p.start });
                to := ?(switch to { case (?x) Nat.max(x, e); case null e });
              };
              case null {};
            };
          };
          let exists = switch (t.workId) {
            case (?w) c.permits.permits.values().any(func x = x.workId == w and x.kind == k.key and x.archivedAt == null and x.status != #cancelled);
            case null false;
          };
          permitsOut.add({ kind = k.key; kindName = k.name; groups = hits; reason; from; to; leadDays = Permits.defaultLead(c.settings, c.permits, muniId, k.key); municipalityId = muniId; municipality = switch muni { case (?m) m.name; case null "" }; exists; skipped = skipKinds.containsKey(k.key) });
        };
      };
    };

    // ── 30bis en Checkinatwork (1b.4) ──
    let oaSet = Map.empty<Nat, ()>();
    switch (t.workId) { case (?w) { for (o in Wadm.oaOrgs(c.org, c.works, c.plan, w).values()) { oaSet.add(o, ()) } }; case null {} };
    let isOa = func(o : Nat) : Bool { switch (c.org.orgs.get(o)) { case (?x) x.kind == #subcontractor and x.archivedAt == null; case null false } };
    for (g in gs.values()) {
      switch (g.orgId) { case (?o) { if (isOa(o)) { oaSet.add(o, ()) } }; case null {} };
      for (o in g.extraOrgs.values()) { if (isOa(o)) { oaSet.add(o, ()) } };
    };
    // Aanneemsom (excl. btw): per offerte de laatste gestarte versie, met deze versie in de plaats van een vorige van dezelfde offerte.
    let perQuote = Map.empty<Nat, (Nat, Int)>(); // offerte → (versie, subtotaal)
    for (b in bases.values()) {
      switch (c.quotes.versions.get(b.versionId)) {
        case (?bv) {
          switch (bv.sent) {
            case (?s) {
              let keep = switch (perQuote.get(b.quoteId)) { case (?(nr, _)) nr < bv.version; case null true };
              if keep { perQuote.add(b.quoteId, (bv.version, s.subtotalCents)) };
            };
            case null {};
          };
        };
        case null {};
      };
    };
    switch (v.sent) { case (?s) { perQuote.add(q.id, (v.version, s.subtotalCents)) }; case null {} };
    var amount : Int = 0;
    for ((_, (_, s)) in perQuote.entries()) { amount += s };
    let asb = switch (t.workId) { case (?w) { switch (c.wadm.declarations.get(w)) { case (?d) d.asbestos; case null false } }; case null false };
    let (a30, r30) = Dossier.art30bis(c.settings, ?amount, oaSet.size(), asb);
    let ciaw : ?Bool = ?(amount >= Dossier.thresholdCheckinatwork(c.settings));

    // ── Waarschuwingen ──
    if (tpl.provisional) { warnings.add("Het sjabloon «" # tpl.name # "» is VOORLOPIG (volgorde en duur nog niet bevestigd door Alexis)") };
    let own = gs.filter(func g = g.stepKey == null).size();
    if (own > 0) { warnings.add(own.toText() # " hoofdstuk(ken) zonder stap in het sjabloon: elk een eigen taak na de taak ervoor; kies per post een stap als dat beter past") };
    let guessed = gs.filter(func g = g.daysFrom == "geschat").size();
    if (guessed > 0) { warnings.add(guessed.toText() # " taak/taken zonder duur in de bibliotheek of het sjabloon: geschat op " # Config.workStartDefaultDays.toText() # " werkdagen") };
    let now = today();
    if (startDay < now) { warnings.add("De startdatum ligt in het verleden") };
    for (p in permitsOut.values()) {
      if (not p.exists and not p.skipped) {
        switch (p.from) {
          case (?f) { if (f < now + p.leadDays) { warnings.add("Vergunning «" # p.kindName # "»: de uiterste aanvraagdag ligt in het verleden of vandaag (doorlooptijd " # p.leadDays.toText() # " dagen)") } };
          case null {};
        };
      };
    };
    if (gs.size() == 0 and outLines.size() == 0) { warnings.add(if meerwerk "Geen nieuwe posten tegenover wat al gepland is: er komen geen taken bij" else "Geen posten die een taak worden") };
    switch error { case (?e) { warnings.add("Rekenen lukt niet: " # e) }; case null {} };

    {
      template = tpl;
      startDay;
      groups = gs;
      deps = depList;
      pos = posMap;
      lines = outLines.toArray();
      skipped = skipped.toArray();
      changed = changed.toArray();
      removed = removed.toArray();
      permits = permitsOut.toArray();
      bases;
      oaCount = oaSet.size();
      amount = ?amount;
      art30bis = a30;
      art30bisReason = r30;
      checkinatwork = ciaw;
      end;
      warnings = warnings.toArray();
      error;
    };
  };

  // Melding bij een aanvaarding (2.7 → 2.8): de werfleider van de werf en (met `admins`) de beheerders, nooit wie het zelf deed.
  public func notifyAccepted(access : Types.AccessState, works : Types.WorksState, log : Types.AuditState, ctr : Types.Counters, q : Types.Quote, v : Types.QuoteVersion, except : ?Nat, admins : Bool) {
    let w = works.works.get(q.workId) ?? return;
    let text = "Offerte " # q.number # " v" # v.version.toText() # " aanvaard: het voorstel «Werf starten» voor " # w.code # " staat klaar.";
    let sent = Map.empty<Nat, ()>();
    let send = func(id : Nat) {
      let active = switch (access.persons.get(id)) { case (?x) x.archivedAt == null; case null false };
      if (active and ?id != except and not sent.containsKey(id)) { sent.add(id, ()); Access.notify(log, ctr, id, "werfstart", text, ?w.id) };
    };
    switch (w.leaderPersonId) { case (?x) send(x); case null {} };
    if admins { for (id in Access.activeAdminIds(access).values()) { send(id) } };
  };

  // Een kort tekstje bij de taak: uit welke offerte en welke posten (intern; zonder bedragen).
  public func taskNote(qs : Types.QuotesState, q : Types.Quote, v : Types.QuoteVersion, lineIds : [Nat]) : Text {
    let names = lineIds.filterMap(func(id : Nat) : ?Text { switch (qs.lines.get(id)) { case (?l) ?(if (l.code != "") l.code # " " # l.title else l.title); case null null } });
    let head = "Uit offerte " # q.number # " v" # v.version.toText() # (if (names.size() > 0) ": " else "");
    let body = names.values().join("; ");
    Text.fromIter((head # body).chars().take(Config.maxNote));
  };
};
