// Planning per werf (stap 1.3): kalender in werkdagen, het meeschuiven van opvolgers, sjablonen en views.
// Geen rechten hier: wie wat mag, beslist lib/Rights.mo; dit bestand rekent alleen. Alle lussen over de
// kalender zijn begrensd (Config.maxScanDays, T17).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Types "../types";
import Views "../types/views";
import Config "Config";

module {
  type Day = Types.Day;
  type Task = Types.Task;
  type Dependency = Types.Dependency;

  // ── Kalender ─────────────────────────────────────────────────────────────
  // Een kalender = de geblokkeerde periodes die voor een werf gelden (bedrijf + werf + hoofdwerf).
  public type Cal = { blocks : [(Day, Day)] };

  // 1970-01-01 was een donderdag: 0 = maandag … 6 = zondag.
  public func weekday(d : Day) : Nat { (d + 3) % 7 };

  func blocked(cal : Cal, d : Day) : Bool {
    for ((f, t) in cal.blocks.values()) { if (d >= f and d <= t) { return true } };
    false;
  };

  public func isWorkday(cal : Cal, d : Day) : Bool { weekday(d) < 5 and not blocked(cal, d) };

  // De eerste werkdag op of na d.
  public func nextWorkday(cal : Cal, d : Day) : Day {
    var x = d;
    var i = 0;
    while (not isWorkday(cal, x) and i < Config.maxScanDays) { x += 1; i += 1 };
    x;
  };

  // n werkdagen na (n > 0) of vóór (n < 0) de werkdag op of na d.
  public func addWorkdays(cal : Cal, d : Day, n : Int) : Day {
    var x = nextWorkday(cal, d);
    var k = Int.abs(n);
    var i = 0;
    if (n >= 0) {
      while (k > 0 and i < Config.maxScanDays) {
        x += 1;
        i += 1;
        if (isWorkday(cal, x)) { k -= 1 };
      };
    } else {
      while (k > 0 and x > 0 and i < Config.maxScanDays) {
        x -= 1;
        i += 1;
        if (isWorkday(cal, x)) { k -= 1 };
      };
    };
    x;
  };

  // Laatste werkdag van een taak (een mijlpaal: zijn eigen dag).
  public func endDay(cal : Cal, start : Day, workdays : Nat) : Day {
    if (workdays == 0) start else addWorkdays(cal, start, workdays - 1);
  };

  // De eerste dag waarop een opvolger (einde → begin, zonder wachttijd) mag beginnen.
  public func freeFrom(cal : Cal, start : Day, workdays : Nat) : Day {
    if (workdays == 0) nextWorkday(cal, start) else addWorkdays(cal, start, workdays);
  };

  // Aantal werkdagen van a naar b (negatief als b vóór a ligt); a en b eerst naar een werkdag.
  public func workdayDiff(cal : Cal, a : Day, b : Day) : Int {
    let x = nextWorkday(cal, a);
    let y = nextWorkday(cal, b);
    if (x == y) { return 0 };
    let (lo, hi, sign) = if (x < y) (x, y, 1) else (y, x, -1);
    var n = 0;
    var d = lo;
    var i = 0;
    while (d < hi and i < Config.maxScanDays) {
      d += 1;
      i += 1;
      if (isWorkday(cal, d)) { n += 1 };
    };
    sign * n;
  };

  // Blokken die gelden voor een werf: bedrijf, de werf zelf en (bij een deelwerf) de hoofdwerf.
  public func calFor(plan : Types.PlanState, works : Types.WorksState, workId : Nat) : Cal {
    let parent = switch (works.works.get(workId)) { case (?w) w.parentId; case null null };
    let bs = plan.calendarBlocks.values().filter(
      func b {
        b.archivedAt == null and (switch (b.scope) {
          case (#company) true;
          case (#work w) w == workId or ?w == parent;
          case (#org _) false; // verlof van een OA: conflict op het weekbord (1.4), schuift de werf niet
        });
      }
    ).map(func b = (b.from, b.to)).toArray();
    { blocks = bs };
  };

  public func blocksFor(plan : Types.PlanState, works : Types.WorksState, workId : Nat) : [Types.CalendarBlock] {
    let parent = switch (works.works.get(workId)) { case (?w) w.parentId; case null null };
    plan.calendarBlocks.values().filter(
      func b {
        b.archivedAt == null and (switch (b.scope) { case (#company) true; case (#work w) w == workId or ?w == parent; case (#org _) false });
      }
    ).toArray();
  };

  // ── Datum als tekst (dd.mm.jjjj) voor de wijzigingen en de auditlog ────────
  func pad2(n : Nat) : Text { if (n < 10) "0" # n.toText() else n.toText() };

  public func fmtDay(d : Day) : Text {
    // Burgerlijke datum uit een dagnummer (algoritme van H. Hinnant), alles ≥ 0.
    let z = d + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let dd = doy - (153 * mp + 2) / 5 + 1;
    let m = if (mp < 10) mp + 3 else mp - 9;
    let y = yoe + era * 400 + (if (m <= 2) 1 else 0);
    pad2(dd) # "." # pad2(m) # "." # y.toText();
  };

  // ── Taken en afhankelijkheden van één werf ──────────────────────────────
  public func tasksOf(plan : Types.PlanState, workId : Nat) : [Task] {
    let ts = plan.tasks.values().filter(func t = t.workId == workId and t.archivedAt == null).toArray();
    Array.sort<Task>(ts, func(a, b) = if (a.order == b.order) Nat.compare(a.id, b.id) else Nat.compare(a.order, b.order));
  };

  public func depsOf(plan : Types.PlanState, workId : Nat) : [Dependency] {
    plan.dependencies.values().filter(func d = d.workId == workId and d.archivedAt == null).toArray();
  };

  // Vroegste start volgens de voorgangers (en de levertermijn), met de taak die het bepaalt.
  public type Pos = { start : Day; workdays : Nat };

  public func earliest(cal : Cal, t : Task, incoming : [Dependency], pos : Map.Map<Nat, Pos>) : (Day, ?Nat) {
    var e : Day = 0;
    var by : ?Nat = null;
    for (d in incoming.values()) {
      switch (pos.get(d.fromTaskId)) {
        case (?p) {
          let base = switch (d.kind) {
            case (#finishToStart) freeFrom(cal, p.start, p.workdays);
            case (#startToStart) nextWorkday(cal, p.start);
          };
          let x = addWorkdays(cal, base, d.lagDays);
          if (x > e) { e := x; by := ?d.fromTaskId };
        };
        case null {};
      };
    };
    switch (t.kind, t.orderDay) {
      case (#delivery, ?o) {
        let x = nextWorkday(cal, o + t.leadDays);
        if (x > e) { e := x; by := null };
      };
      case _ {};
    };
    (e, by);
  };

  // Kahn: taken in een volgorde waarin elke voorganger vóór zijn opvolger komt. null = er is een kring.
  func topo(tasks : [Task], deps : [Dependency]) : ?[Nat] {
    let indeg = Map.empty<Nat, Nat>();
    let next = Map.empty<Nat, List.List<Nat>>();
    for (t in tasks.values()) { indeg.add(t.id, 0); next.add(t.id, List.empty<Nat>()) };
    for (d in deps.values()) {
      switch (indeg.get(d.toTaskId), next.get(d.fromTaskId)) {
        case (?n, ?l) { indeg.add(d.toTaskId, n + 1); l.add(d.toTaskId) };
        case _ {};
      };
    };
    let queue = List.empty<Nat>();
    for (t in tasks.values()) { if (indeg.get(t.id) == ?0) { queue.add(t.id) } };
    var i = 0;
    while (i < queue.size()) {
      let id = queue.at(i);
      i += 1;
      switch (next.get(id)) {
        case (?l) {
          for (s in l.values()) {
            switch (indeg.get(s)) {
              case (?n) { indeg.add(s, n - 1); if (n == 1) { queue.add(s) } };
              case null {};
            };
          };
        };
        case null {};
      };
    };
    if (queue.size() == tasks.size()) ?queue.toArray() else null;
  };

  // Zou een afhankelijkheid van `from` naar `to` een kring maken? (to bereikt from al)
  public func wouldCycle(deps : [Dependency], from : Nat, to : Nat) : Bool {
    if (from == to) { return true };
    let seen = Map.empty<Nat, ()>();
    let stack = List.singleton<Nat>(to);
    while (stack.size() > 0) {
      let x = switch (stack.removeLast()) { case (?v) v; case null 0 };
      if (x == from) { return true };
      if (not seen.containsKey(x)) {
        seen.add(x, ());
        for (d in deps.values()) { if (d.fromTaskId == x) { stack.add(d.toTaskId) } };
      };
    };
    false;
  };

  public type Shift = { taskId : Nat; fromStart : Day; fromWorkdays : Nat; toStart : Day; toWorkdays : Nat; reason : Text };

  // Een taak die al klaar of bezig is, schuift niet mee met een ander (enkel als je ze zelf verplaatst).
  public func fixed(t : Task) : Bool { t.status == #done or t.status == #busy };

  // Het hart van de Gantt: wat verandert er als je een taak verplaatst of verlengt (#move), of als je
  // de hele planning opnieuw laat rekenen na een nieuwe kalenderblokkering (#reflow)?
  //   #follow   = opvolgers (alle stappen verder in de keten) schuiven evenveel werkdagen mee als het einde van
  //               de taak, in beide richtingen (verplaatsen én verlengen)
  //   #asNeeded = opvolgers schuiven enkel als ze anders te vroeg zouden beginnen
  // Daarna geldt altijd: niemand begint vóór zijn voorgangers klaar zijn (+ wachttijd) of vóór de levering.
  // `movable` beperkt wie er mag schuiven (sjabloon toepassen: enkel de nieuwe taken).
  public func schedule(cal : Cal, tasks : [Task], deps : [Dependency], change : Views.PlanChange, movable : Task -> Bool) : Result.Result<[Shift], Text> {
    let byId = Map.empty<Nat, Task>();
    let pos = Map.empty<Nat, Pos>();
    let reason = Map.empty<Nat, Text>();
    let incoming = Map.empty<Nat, List.List<Dependency>>();
    for (t in tasks.values()) {
      byId.add(t.id, t);
      pos.add(t.id, { start = t.start; workdays = t.workdays });
      incoming.add(t.id, List.empty<Dependency>());
    };
    for (d in deps.values()) {
      if (byId.containsKey(d.fromTaskId)) {
        switch (incoming.get(d.toTaskId)) { case (?l) l.add(d); case null {} };
      };
    };
    let title = func(id : Nat) : Text { switch (byId.get(id)) { case (?t) "«" # t.title # "»"; case null "#" # id.toText() } };
    var moved : ?Nat = null;
    switch change {
      case (#reflow) {};
      case (#move m) {
        let t = byId.get(m.taskId) ?? return #err("Onbekende taak");
        if (m.workdays > Config.maxWorkdays) { return #err("Duur: hoogstens " # Config.maxWorkdays.toText() # " werkdagen") };
        if (t.kind != #work and m.workdays != 0) { return #err("Een mijlpaal of levering duurt 0 dagen") };
        if (t.kind == #work and m.workdays == 0) { return #err("Een taak duurt minstens 1 werkdag") };
        let newStart = nextWorkday(cal, m.start);
        pos.add(t.id, { start = newStart; workdays = m.workdays });
        reason.add(t.id, if (newStart != t.start) "verplaatst" else "duur gewijzigd");
        moved := ?t.id;
        if (m.mode == #follow) {
          // Opvolgers volgen het EINDE van de taak: bij verplaatsen = de verschuiving van de start,
          // bij verlengen of inkorten = de verlenging (C1, testlijst 1.3).
          let delta = workdayDiff(cal, freeFrom(cal, t.start, t.workdays), freeFrom(cal, newStart, m.workdays));
          if (delta != 0) {
            // Alle stappen verder in de keten (breedte eerst), elk één keer.
            let seen = Map.singleton<Nat, ()>(t.id, ());
            let queue = List.singleton<Nat>(t.id);
            var i = 0;
            while (i < queue.size()) {
              let x = queue.at(i);
              i += 1;
              for (d in deps.values()) {
                if (d.fromTaskId == x and not seen.containsKey(d.toTaskId)) {
                  seen.add(d.toTaskId, ());
                  queue.add(d.toTaskId);
                  switch (byId.get(d.toTaskId)) {
                    case (?s) {
                      if (movable(s) and not fixed(s)) {
                        pos.add(s.id, { start = addWorkdays(cal, s.start, delta); workdays = s.workdays });
                        reason.add(s.id, "volgt " # title(t.id));
                      };
                    };
                    case null {};
                  };
                };
              };
            };
          };
        };
      };
    };
    let order = topo(tasks, deps) ?? return #err("De afhankelijkheden vormen een kring");
    for (id in order.values()) {
      switch (byId.get(id), pos.get(id)) {
        case (?t, ?p) {
          let mayMove = moved == ?id or (movable(t) and not fixed(t));
          if (mayMove) {
            let inc = switch (incoming.get(id)) { case (?l) l.toArray(); case null [] };
            let (e, by) = earliest(cal, t, inc, pos);
            let s0 = nextWorkday(cal, p.start);
            if (s0 < e) {
              pos.add(id, { p with start = e });
              reason.add(id, switch by { case (?b) "wacht op " # title(b); case null "wacht op de levering" });
            } else if (s0 != p.start) {
              pos.add(id, { p with start = s0 });
            };
          };
        };
        case _ {};
      };
    };
    let out = List.empty<Shift>();
    for (t in tasks.values()) {
      switch (pos.get(t.id)) {
        case (?p) {
          if (p.start != t.start or p.workdays != t.workdays) {
            out.add({ taskId = t.id; fromStart = t.start; fromWorkdays = t.workdays; toStart = p.start; toWorkdays = p.workdays; reason = switch (reason.get(t.id)) { case (?r) r; case null "naar een werkdag" } });
          };
        };
        case null {};
      };
    };
    #ok(out.toArray());
  };

  // ── Waarschuwingen bij een taak (structureel; "te laat bestellen" rekent de browser met vandaag) ──
  public func warnings(cal : Cal, t : Task, incoming : [Dependency], byId : Map.Map<Nat, Task>) : [Text] {
    let w = List.empty<Text>();
    if (not isWorkday(cal, t.start) and weekday(t.start) < 5) {
      w.add("Begint in een blokkering (bouwverlof, feestdag of STOP): herschikken");
    };
    for (d in incoming.values()) {
      switch (byId.get(d.fromTaskId)) {
        case (?p) {
          let base = switch (d.kind) {
            case (#finishToStart) freeFrom(cal, p.start, p.workdays);
            case (#startToStart) nextWorkday(cal, p.start);
          };
          let e = addWorkdays(cal, base, d.lagDays);
          if (t.start < e) {
            w.add(
              switch (d.kind) {
                case (#finishToStart) "Begint vóór «" # p.title # "» klaar is (vroegst " # fmtDay(e) # ")";
                case (#startToStart) "Begint te vroeg na de start van «" # p.title # "» (vroegst " # fmtDay(e) # ")";
              }
            );
          };
        };
        case null {};
      };
    };
    switch (t.kind, t.orderDay) {
      case (#delivery, ?o) {
        let e = nextWorkday(cal, o + t.leadDays);
        if (t.start < e) { w.add("Levering pas op " # fmtDay(e) # " (besteld " # fmtDay(o) # ")") };
      };
      case _ {};
    };
    w.toArray();
  };

  // ── Sjablonen (D9: data, niet code) ─────────────────────────────────────
  public func kindFromText(k : Text) : Types.TaskKind {
    switch k { case "milestone" #milestone; case "delivery" #delivery; case _ #work };
  };

  public func defaultTemplate() : Types.Template {
    {
      key = Config.defaultTemplateKey;
      name = "Standaardrenovatie";
      steps = Config.defaultTemplate().map<(Text, Text, ?Text, Text, Nat, Nat, [Text], Nat, Text), Types.TemplateStep>(
        func((key, title, trade, kind, workdays, leadDays, after, lagDays, note)) = { key; title; trade; kind = kindFromText(kind); workdays; leadDays; after; lagDays; note }
      );
      provisional = true;
      updatedAt = 0;
      updatedBy = 0;
      archivedAt = null;
      extra = [];
    };
  };

  // Alle sjablonen: de bewaarde, plus de standaard zolang die niet bewaard (aangepast) is.
  public func templates(plan : Types.PlanState) : [Types.Template] {
    let own = plan.templates.values().toArray();
    if (plan.templates.containsKey(Config.defaultTemplateKey)) own else Array.concat([defaultTemplate()], own);
  };

  public func template(plan : Types.PlanState, key : Text) : ?Types.Template {
    switch (plan.templates.get(key)) {
      case (?t) ?t;
      case null { if (key == Config.defaultTemplateKey) ?defaultTemplate() else null };
    };
  };

  // Een sjabloon nakijken: unieke sleutels, bestaande voorgangers die eerder in de lijst staan (dus geen
  // kring), soort en duur die bij elkaar passen, grenzen.
  public func templateError(steps : [Types.TemplateStep], tradeOk : Text -> Bool) : ?Text {
    if (steps.size() == 0) { return ?"Een sjabloon heeft minstens één stap" };
    if (steps.size() > Config.maxTemplateSteps) { return ?"Te veel stappen" };
    let seen = Map.empty<Text, ()>();
    for (s in steps.values()) {
      if (s.key.size() == 0 or s.key.size() > 40 or not s.key.chars().all(func c = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '-')) {
        return ?("Sleutel «" # s.key # "»: 1 tot 40 tekens, enkel a-z, 0-9 en -");
      };
      if (seen.containsKey(s.key)) { return ?("Sleutel «" # s.key # "» staat er twee keer in") };
      let t = s.title.trim(#char ' ');
      if (t.size() == 0 or t.size() > Config.maxName) { return ?("Stap «" # s.key # "»: titel 1 tot " # Config.maxName.toText() # " tekens") };
      if (s.kind == #work and (s.workdays == 0 or s.workdays > Config.maxWorkdays)) { return ?("Stap «" # s.key # "»: duur 1 tot " # Config.maxWorkdays.toText() # " werkdagen") };
      if (s.kind != #work and s.workdays != 0) { return ?("Stap «" # s.key # "»: een mijlpaal of levering duurt 0 dagen") };
      if (s.leadDays > Config.maxLeadDays or (s.kind != #delivery and s.leadDays != 0)) { return ?("Stap «" # s.key # "»: levertermijn enkel bij een levering, hoogstens " # Config.maxLeadDays.toText() # " dagen") };
      if (s.lagDays > Int.abs(Config.maxLag)) { return ?("Stap «" # s.key # "»: wachttijd te lang") };
      if (s.note.size() > Config.maxNote) { return ?("Stap «" # s.key # "»: notitie te lang") };
      switch (s.trade) { case (?k) { if (not tradeOk(k)) { return ?("Stap «" # s.key # "»: onbekend vakgebied «" # k # "»") } }; case null {} };
      for (a in s.after.values()) {
        if (not seen.containsKey(a)) { return ?("Stap «" # s.key # "» wacht op «" # a # "», die er niet vóór staat") };
      };
      seen.add(s.key, ());
    };
    null;
  };

  // ── Views ───────────────────────────────────────────────────────────────
  public func kindKey(k : Types.TaskKind) : Text { switch k { case (#work) "taak"; case (#milestone) "mijlpaal"; case (#delivery) "levering" } };

  public func statusKey(s : Types.TaskStatus) : Text {
    switch s { case (#planned) "gepland"; case (#busy) "bezig"; case (#delayed) "vertraagd"; case (#done) "klaar"; case (#blocked) "geblokkeerd" };
  };

  // Dagen van een toewijzing: het eigen bereik binnen de taak, of de hele taak.
  public func assignmentDays(a : Types.Assignment, start : Day, end : Day) : (Day, Day) {
    let f = switch (a.fromDay) { case (?x) Nat.max(x, start); case null start };
    let t = switch (a.toDay) { case (?x) Nat.min(x, end); case null end };
    if (t < f) (f, f) else (f, t);
  };

  public func compareDay(a : Day, b : Day) : Order.Order { Nat.compare(a, b) };
};
