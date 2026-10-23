// Weekbord per OA (stap 1.4): wie staat wanneer waar, en wat botst. Geen rechten hier: wie wat ziet, beslist
// lib/Rights.mo en geeft de API mee als `see` (per werf: null = overslaan, ?true = tonen, ?false = enkel
// "andere werf"). Dit bestand rekent alleen, altijd binnen één begrensd weekvenster (T17, D10).
//
// Drie soorten conflicten (bouwplan rij 1.4, architectuur §2.5):
//   "dubbel"     = een firma staat op meer werven tegelijk dan haar regel toelaat (per dag of per week);
//                  enkel gewone taken tellen (een levering of mijlpaal bezet niemand)
//   "afwezig"    = een taak valt in een afwezigheid van de firma (of van de persoon die uitvoert)
//   "blokkering" = een taak begint of eindigt in bouwverlof, een feestdag of een STOP van de werf
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Text "mo:core/Text";
import Types "../types";
import Views "../types/views";
import Config "Config";
import Oa "Oa";
import Plan "Plan";

module {
  type Day = Types.Day;

  public func monday(d : Day) : Day { d - Plan.weekday(d) };

  // ── Regels (settings.values: kleine vlaggen zonder migratie, D8) ─────────
  public func unit(s : Types.SettingsState) : Text {
    switch (s.values.get("board.unit")) { case (?"week") "week"; case _ "dag" };
  };

  public func defaultMax(s : Types.SettingsState) : Nat {
    switch (s.values.get("board.max")) { case (?v) { Nat.fromText(v) ?? Config.boardDefaultMax }; case null Config.boardDefaultMax };
  };

  public func oaReportsAbsence(s : Types.SettingsState) : Bool { s.values.get("board.oaMeldt") != ?"nee" };

  // 0 = onbeperkt: dat is altijd de ruimste.
  func wider(a : Nat, b : Nat) : Nat { if (a == 0 or b == 0) 0 else Nat.max(a, b) };

  // Hoeveel werven tegelijk: de regel van de firma, anders de ruimste regel van haar vakgebieden, anders de
  // algemene regel.
  public func capacityOf(board : Types.BoardState, s : Types.SettingsState, o : Types.Org) : (Nat, Text) {
    switch (board.capacity.get("org:" # o.id.toText())) {
      case (?r) { if (r.archivedAt == null) { return (r.maxWorks, "firma") } };
      case null {};
    };
    var best : ?Nat = null;
    for (t in o.trades.values()) {
      switch (board.capacity.get("trade:" # t)) {
        case (?r) {
          if (r.archivedAt == null) { best := ?(switch best { case (?b) wider(b, r.maxWorks); case null r.maxWorks }) };
        };
        case null {};
      };
    };
    switch best { case (?b) (b, "vakgebied"); case null (defaultMax(s), "algemeen") };
  };

  public func kindWord(k : Types.AbsenceKind) : Text {
    switch k { case (#verlof) "verlof"; case (#ziekte) "ziekte"; case (#andere) "afwezig" };
  };

  func blockWord(k : Types.BlockKind) : Text {
    switch k { case (#bouwverlof) "bouwverlof"; case (#feestdag) "een feestdag"; case (#stop) "een STOP"; case (#verlof) "verlof"; case (#other) "een blokkering" };
  };

  // ── Bezetting: één toewijzing binnen het venster ────────────────────────
  public type Occ = {
    a : Types.Assignment;
    t : Types.Task;
    w : Types.Work;
    s : Day; // begin en einde van de toewijzing (kan buiten het venster liggen)
    e : Day;
    days : [Day]; // werkdagen van de werf binnen het venster
    visible : Bool;
    blockedAt : ?(Day, Types.CalendarBlock); // begint of eindigt in een blokkering (binnen het venster)
  };

  public type Src = {
    plan : Types.PlanState;
    works : Types.WorksState;
    board : Types.BoardState;
    settings : Types.SettingsState;
  };

  func dayIn(cal : Plan.Cal, d : Day) : Bool { cal.blocks.any(func((f, t)) = d >= f and d <= t) };

  func blockAt(bs : [Types.CalendarBlock], d : Day) : ?Types.CalendarBlock {
    if (Plan.weekday(d) >= 5) { return null };
    bs.find(func b = d >= b.from and d <= b.to);
  };

  // Alle toewijzingen in [from, to] van de firma's waarvoor keepOrg ja zegt, per firma. Elke werf wordt
  // één keer opgezocht (kalender, zichtbaarheid), elke taak één keer gerekend (einde).
  public func collect(src : Src, from : Day, to : Day, keepOrg : Nat -> Bool, see : Types.Work -> ?Bool) : Map.Map<Nat, List.List<Occ>> {
    let out = Map.empty<Nat, List.List<Occ>>();
    let workInfo = Map.empty<Nat, ?(Types.Work, Plan.Cal, [Types.CalendarBlock], Bool)>();
    let ends = Map.empty<Nat, Day>();
    for (a in src.plan.assignments.values()) {
      if (a.archivedAt == null and keepOrg(a.orgId)) {
        switch (src.plan.tasks.get(a.taskId)) {
          case (?t) {
            if (t.archivedAt == null and t.start <= to) {
              let info = switch (workInfo.get(a.workId)) {
                case (?i) i;
                case null {
                  let i = switch (src.works.works.get(a.workId)) {
                    case (?w) {
                      if (w.archivedAt != null) null else switch (see(w)) {
                        case (?v) {
                          let bs = Plan.blocksFor(src.plan, src.works, w.id);
                          ?(w, { blocks = bs.map(func b = (b.from, b.to)) }, bs, v);
                        };
                        case null null;
                      };
                    };
                    case null null;
                  };
                  workInfo.add(a.workId, i);
                  i;
                };
              };
              switch info {
                case (?(w, cal, bs, visible)) {
                  let end = switch (ends.get(t.id)) {
                    case (?x) x;
                    case null { let x = Plan.endDay(cal, t.start, t.workdays); ends.add(t.id, x); x };
                  };
                  let (s, e) = Plan.assignmentDays(a, t.start, end);
                  if (e >= from and s <= to) {
                    let days = List.empty<Day>();
                    var d = Nat.max(s, from);
                    let last = Nat.min(e, to);
                    while (d <= last) {
                      if (Plan.weekday(d) < 5 and not dayIn(cal, d)) { days.add(d) };
                      d += 1;
                    };
                    // Begint (of, bij een eigen bereik, eindigt) de toewijzing in een blokkering? Enkel binnen het venster.
                    let blockedAt = switch (if (s >= from) blockAt(bs, s) else null) {
                      case (?b) ?(s, b);
                      case null { if (e != s and e <= to) { switch (blockAt(bs, e)) { case (?b) ?(e, b); case null null } } else null };
                    };
                    let occ : Occ = { a; t; w; s; e; days = days.toArray(); visible; blockedAt };
                    switch (out.get(a.orgId)) {
                      case (?l) l.add(occ);
                      case null out.add(a.orgId, List.singleton<Occ>(occ));
                    };
                  };
                };
                case null {};
              };
            };
          };
          case null {};
        };
      };
    };
    out;
  };

  // Afwezigheden die het venster raken, per firma.
  public func absencesIn(board : Types.BoardState, from : Day, to : Day, keepOrg : Nat -> Bool) : Map.Map<Nat, List.List<Types.Absence>> {
    let out = Map.empty<Nat, List.List<Types.Absence>>();
    for (x in board.absences.values()) {
      if (x.archivedAt == null and x.to >= from and x.from <= to and keepOrg(x.orgId)) {
        switch (out.get(x.orgId)) { case (?l) l.add(x); case null out.add(x.orgId, List.singleton<Types.Absence>(x)) };
      };
    };
    out;
  };

  // ── Conflicten van één firma ────────────────────────────────────────────
  func workRef(o : Occ) : (?Nat, Text) { if (o.visible) (?o.w.id, o.w.code) else (null, "andere werf") };

  func addUnique(l : List.List<Day>, d : Day) { if (not l.contains(Nat.equal, d)) { l.add(d) } };

  func refsOf(occs : [Occ]) : [(?Nat, Text)] {
    let seen = Map.empty<Nat, ()>();
    let out = List.empty<(?Nat, Text)>();
    for (o in occs.values()) {
      if (not seen.containsKey(o.w.id)) { seen.add(o.w.id, ()); out.add(workRef(o)) };
    };
    out.toArray();
  };

  func taskIdsOf(occs : [Occ]) : [Nat] {
    let out = List.empty<Nat>();
    for (o in occs.values()) { if (o.visible and not out.contains(Nat.equal, o.t.id)) { out.add(o.t.id) } };
    out.toArray();
  };

  func codes(refs : [(?Nat, Text)]) : Text { refs.map(func((_, c)) = c).values().join(", ") };

  // "19.10–23.10, 26.10" : opeenvolgende werkdagen (over een weekend heen) als één reeks; dag.maand
  // volstaat, de week staat bij het conflict.
  func dm(d : Day) : Text { Text.fromIter(Plan.fmtDay(d).chars().take(5)) };

  func dayList(ds : [Day]) : Text {
    let parts = List.empty<Text>();
    var i = 0;
    while (i < ds.size()) {
      var j = i;
      while (j + 1 < ds.size() and (ds[j + 1] == ds[j] + 1 or (Plan.weekday(ds[j]) == 4 and ds[j + 1] == ds[j] + 3))) { j += 1 };
      parts.add(if (j == i) dm(ds[i]) else dm(ds[i]) # "–" # dm(ds[j]));
      i := j + 1;
    };
    parts.values().join(", ");
  };

  public type OrgFacts = { org : Types.Org; code : ?Text; maxWorks : Nat; maxFrom : Text };

  // Eén firma op het weekbord, vóór de weergave: haar bezetting, afwezigheden en conflicten.
  public type Row = { facts : OrgFacts; occs : [Occ]; absences : [Types.Absence]; conflicts : [Views.ConflictView]; clash : Map.Map<Text, ()> };

  // De conflicten van één firma in het venster, en de (week, werf)-paren die in een dubbele boeking zitten.
  public func conflicts(f : OrgFacts, occs : [Occ], absences : [Types.Absence], unitText : Text, from : Day, weeks : Nat) : ([Views.ConflictView], Map.Map<Text, ()>) {
    let out = List.empty<Views.ConflictView>();
    let clashKeys = Map.empty<Text, ()>();
    let name = f.org.name;
    let who = switch (f.code) { case (?c) c; case null name };
    let base = func(kind : Text, week : Day, days : [Day], inv : [Occ], text : Text) : Views.ConflictView {
      { kind; orgId = f.org.id; orgName = name; orgCode = f.code; week; days; works = refsOf(inv); taskIds = taskIdsOf(inv); text };
    };
    // 1. Dubbel: per week de werven per dag (enkel gewone taken).
    if (f.maxWorks > 0) {
      var i = 0;
      while (i < weeks) {
        let m = from + 7 * i;
        let inWeek = occs.filter(func o = o.t.kind == #work and o.days.any(func d = d >= m and d < m + 7));
        let worksOf = func(pred : Day -> Bool) : [Occ] { inWeek.filter(func o = o.days.any(pred)) };
        let distinct = func(xs : [Occ]) : Nat { refsOf(xs).size() };
        let clashDays = List.empty<Day>();
        let involved = List.empty<Occ>();
        if (unitText == "week") {
          if (distinct(inWeek) > f.maxWorks) {
            for (o in inWeek.values()) { involved.add(o); for (d in o.days.values()) { if (d >= m and d < m + 7) { addUnique(clashDays, d) } } };
          };
        } else {
          var d = m;
          while (d < m + 5) {
            let on = worksOf(func x = x == d);
            if (distinct(on) > f.maxWorks) {
              clashDays.add(d);
              for (o in on.values()) { if (not involved.any(func y = y.a.id == o.a.id)) { involved.add(o) } };
            };
            d += 1;
          };
        };
        if (clashDays.size() > 0) {
          let inv = involved.toArray();
          for (o in inv.values()) { clashKeys.add(i.toText() # ":" # o.w.id.toText(), ()) };
          let ds = Array.sort<Day>(clashDays.toArray(), Nat.compare);
          let refs = refsOf(inv);
          out.add(base("dubbel", m, ds, inv, who # " staat op " # refs.size().toText() # " werven tegelijk (" # (if (unitText == "week") "week" else dayList(ds)) # "): " # codes(refs) # " · regel: hoogstens " # f.maxWorks.toText()));
        };
        i += 1;
      };
    };
    // 2. Afwezig: een taak (geen mijlpaal) op een dag waarop de firma of de uitvoerder afwezig is.
    for (x in absences.values()) {
      var i = 0;
      while (i < weeks) {
        let m = from + 7 * i;
        let hit = List.empty<Occ>();
        let ds = List.empty<Day>();
        for (o in occs.values()) {
          let applies = o.t.kind != #milestone and (switch (x.personId) { case null true; case (?pid) o.a.personId == ?pid });
          if (applies) {
            var any = false;
            for (d in o.days.values()) {
              if (d >= m and d < m + 7 and d >= x.from and d <= x.to) { addUnique(ds, d); any := true };
            };
            if (any) { hit.add(o) };
          };
        };
        if (hit.size() > 0) {
          let inv = hit.toArray();
          let sorted = Array.sort<Day>(ds.toArray(), Nat.compare);
          out.add(base("afwezig", m, sorted, inv, who # " is afwezig (" # kindWord(x.kind) # ", " # Plan.fmtDay(x.from) # " – " # Plan.fmtDay(x.to) # ") maar staat ingepland: " # codes(refsOf(inv)) # " · " # dayList(sorted)));
        };
        i += 1;
      };
    };
    // 3. Blokkering: begint of eindigt in bouwverlof, een feestdag of een STOP (enkel zichtbare werven).
    for (o in occs.values()) {
      switch (o.blockedAt) {
        case (?(d, b)) {
          if (o.visible) {
            out.add(base("blokkering", monday(d), [d], [o], "«" # o.t.title # "» (" # o.w.code # ", " # who # ") " # (if (d == o.s) "begint" else "eindigt") # " in " # blockWord(b.kind) # " (" # b.reason # ") op " # Plan.fmtDay(d)));
          };
        };
        case null {};
      };
    };
    (out.toArray(), clashKeys);
  };

  // ── Weergave ────────────────────────────────────────────────────────────
  public func cells(occs : [Occ], from : Day, weeks : Nat, clashKeys : Map.Map<Text, ()>, personName : Nat -> Text) : [Views.BoardCell] {
    let out = List.empty<Views.BoardCell>();
    var i = 0;
    while (i < weeks) {
      let m = from + 7 * i;
      let inWeek = occs.filter(
        func o = o.days.any(func d = d >= m and d < m + 7) or (switch (o.blockedAt) { case (?(d, _)) d >= m and d < m + 7; case null false })
      );
      if (inWeek.size() > 0) {
        let order = List.empty<Nat>();
        for (o in inWeek.values()) { if (not order.contains(Nat.equal, o.w.id)) { order.add(o.w.id) } };
        let items = order.toArray().map<Nat, Views.BoardItem>(
          func(wid) {
            let mine = inWeek.filter(func o = o.w.id == wid);
            let first = mine[0];
            let hidden = not first.visible;
            let tasks = mine.map<Occ, Views.BoardTask>(
              func o = {
                taskId = if hidden 0 else o.t.id;
                assignmentId = if hidden 0 else o.a.id;
                title = if hidden "" else o.t.title;
                kind = o.t.kind;
                status = if hidden #planned else o.t.status;
                days = o.days.filter(func d = d >= m and d < m + 7);
                start = o.s;
                end = o.e;
                personName = if hidden null else switch (o.a.personId) { case (?x) ?personName(x); case null null };
                note = if hidden "" else o.a.note;
                confirmation = if hidden #open else o.a.confirmation;
              }
            );
            {
              workId = if hidden null else ?wid;
              workCode = if hidden "" else first.w.code;
              workName = if hidden "" else first.w.name;
              hidden;
              tasks;
              clash = clashKeys.containsKey(i.toText() # ":" # wid.toText());
            };
          }
        );
        out.add({ week = i; items });
      };
      i += 1;
    };
    out.toArray();
  };

  public func orgCode(o : Types.Org) : ?Text { if (o.aliases.size() > 0) ?o.aliases[0] else null };

  // Sorteren op planningcode, anders op naam (zoals Alexis ze in de Excel kent).
  public func sortKey(o : Types.Org) : Text { Oa.fold(switch (orgCode(o)) { case (?c) c; case null o.name }) };

  public func compareOrg(a : Types.Org, b : Types.Org) : Order.Order {
    switch (Text.compare(sortKey(a), sortKey(b))) { case (#equal) Nat.compare(a.id, b.id); case o o };
  };

  public func matchesText(o : Types.Org, q : Text) : Bool {
    let f = Oa.fold(q);
    if (f == "") { return true };
    Oa.fold(o.name).contains(#text f) or o.aliases.any(func x = Oa.fold(x).contains(#text f));
  };

  public func sortConflicts(xs : [Views.ConflictView]) : [Views.ConflictView] {
    Array.sort<Views.ConflictView>(
      xs,
      func(a, b) = switch (Nat.compare(a.week, b.week)) {
        case (#equal) Text.compare(a.orgName, b.orgName);
        case o o;
      },
    );
  };

};
