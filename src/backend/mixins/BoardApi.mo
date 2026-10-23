// Weekbord per OA (stap 1.4, bouwplan rij 1.4 en §8.4, architectuur §2.5): rijen = firma's, kolommen = weken,
// cel = de werven met de taken van die week; conflicten (dubbel, afwezig, blokkering) en afwezigheden per firma.
// Rechten (Rights.mo): het weekbord en de conflicten zijn intern (#readOrgPlanning); een werfleider die niet alle
// werven ziet, krijgt de werven buiten zijn bereik enkel als "andere werf" (zonder code, naam of taak). Afwezigheden
// geven admin en werfleider in (#manageAbsences); een OA meldt enkel zijn eigen (#reportOwnAbsence) en ziet in
// "Mijn week" enkel zijn eigen firma op de werven waar hij lid is. Elke afwezigheid: geschiedenis + auditregel.
// Alles is begrensd: één weekvenster (≤ 12 weken), ≤ 50 firma's per pagina, ≤ 200 conflicten per lijst.
import Array "mo:core/Array";
import IC "mo:core/InternetComputer";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Board "../lib/Board";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Oa "../lib/Oa";
import Plan "../lib/Plan";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  plan : Types.PlanState,
  board : Types.BoardState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Het weekbord (kantoor) ──────────────────────────────────────────────
  public query ({ caller }) func weekBoard(q : Views.BoardQuery) : async Views.BoardView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readOrgPlanning, null);
    let (from, weeks, to) = bdWindow(q.from, q.weeks);
    let limit = if (q.limit == 0 or q.limit > Config.boardMaxRows) Config.boardMaxRows else q.limit;
    let all = bdCompute(p, from, weeks, to, func _ = true, bdInternalSee(p));
    // Filter: zoeken, vakgebied, werf, enkel conflicten; daarna sorteren op code en een pagina nemen.
    let kept = all.filter(
      func(x) {
        let o = x.facts.org;
        Board.matchesText(o, q.text) and (switch (q.trade) { case (?k) o.trades.any(func y = y == k); case null true }) and (switch (q.workId) { case (?w) x.occs.any(func oc = oc.visible and oc.w.id == w); case null true }) and (not q.onlyConflicts or x.conflicts.size() > 0) and (q.withIdle or x.occs.size() > 0 or x.absences.size() > 0);
      }
    );
    let sorted = Array.sort<Board.Row>(kept, func(a, b) = Board.compareOrg(a.facts.org, b.facts.org));
    var conflictTotal = 0;
    for (x in sorted.values()) { conflictTotal += x.conflicts.size() };
    let page = Access.page(sorted, q.offset, limit);
    {
      from;
      weeks = bdWeeks(from, weeks);
      rows = page.map(func x = bdRowView(p, x, from, weeks));
      total = sorted.size();
      offset = q.offset;
      conflictTotal;
      unit = Board.unit(settings);
      caps = { manageAbsences = Rights.may(ctx, p, #manageAbsences, null); manageRules = Rights.may(ctx, p, #manageBoardRules, null) };
      instructions = Nat64.toNat(IC.performanceCounter(0));
    };
  };

  // Alle conflicten van alle firma's in een venster: "Vraagt aandacht" op het overzicht.
  public query ({ caller }) func boardConflicts(fromDay : Nat, weeks : Nat, limit : Nat) : async Views.ConflictList {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readOrgPlanning, null);
    let (from, n, to) = bdWindow(fromDay, weeks);
    let rows = bdCompute(p, from, n, to, func _ = true, bdInternalSee(p));
    bdConflictList(rows, func _ = true, limit);
  };

  // De conflicten waarin deze werf zit (de werfpagina): enkel de firma's die in het venster op de werf staan.
  public query ({ caller }) func workConflicts(workId : Nat, fromDay : Nat, weeks : Nat) : async Views.ConflictList {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readOrgPlanning, null);
    Rights.require(ctx, p, #readPlanning, ?workId);
    let (from, n, to) = bdWindow(fromDay, weeks);
    let onWork = Map.empty<Nat, ()>();
    for (a in plan.assignments.values()) { if (a.workId == workId and a.archivedAt == null) { onWork.add(a.orgId, ()) } };
    let rows = bdCompute(p, from, n, to, func o = onWork.containsKey(o), bdInternalSee(p));
    bdConflictList(rows, func c = c.works.any(func((w, _)) = w == ?workId), Config.boardMaxConflicts);
  };

  // "Mijn week" van een OA: enkel de eigen firma, enkel de werven waar hij lid is (planScope). Wie geen firma
  // heeft (BOWACO zelf) of geen actieve OA is, krijgt een lege rij.
  public query ({ caller }) func myBoard(fromDay : Nat, weeks : Nat) : async Views.MyBoardView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let (from, n, to) = bdWindow(fromDay, weeks);
    let canReport = Rights.may(ctx, p, #reportOwnAbsence, null);
    let empty = { from; weeks = bdWeeks(from, n); row = null; canReport };
    let own = switch (p.orgId) { case (?o) o; case null return empty };
    if (not Rights.mayReadAbsences(ctx, p, own)) { return empty };
    let see = func(w : Types.Work) : ?Bool {
      switch (Rights.planScope(ctx, p, w.id)) { case (#ownOrg or #full) ?true; case _ null };
    };
    let rows = bdCompute(p, from, n, to, func o = o == own, see);
    let row = switch (rows.find(func x = x.facts.org.id == own)) {
      case (?x) ?bdRowView(p, x, from, n);
      case null {
        switch (org.orgs.get(own)) {
          case (?o) { let (m, src) = Board.capacityOf(board, settings, o); ?{ orgId = o.id; name = o.name; code = Board.orgCode(o); kind = o.kind; trades = o.trades; maxWorks = m; maxFrom = src; cells = []; absences = []; conflicts = [] } };
          case null null;
        };
      };
    };
    { from; weeks = bdWeeks(from, n); row; canReport };
  };

  // ── Afwezigheden ────────────────────────────────────────────────────────
  // orgId null = alle firma's (interne rollen, hoogstens maxListPage); een OA enkel zijn eigen firma.
  public query ({ caller }) func listAbsences(orgId : ?Nat, fromDay : Nat, toDay : Nat) : async [Views.AbsenceView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    if (toDay < fromDay or toDay - fromDay > 800) { Runtime.trap("Periode: hoogstens 800 dagen") };
    switch orgId {
      case null Rights.require(ctx, p, #readOrgPlanning, null);
      case (?o) { if (not Rights.mayReadAbsences(ctx, p, o)) { Runtime.trap("Geen toegang") } };
    };
    let out = List.empty<Views.AbsenceView>();
    label scan for (x in board.absences.values()) {
      if (x.archivedAt == null and x.to >= fromDay and x.from <= toDay and (switch orgId { case (?o) x.orgId == o; case null true })) {
        out.add(bdAbsenceView(p, x));
        if (out.size() >= Config.maxListPage) { break scan };
      };
    };
    Array.sort<Views.AbsenceView>(out.toArray(), func(a, b) = Nat.compare(a.from, b.from));
  };

  public shared ({ caller }) func saveAbsence(i : Views.AbsenceInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let existing = switch (i.id) {
      case (?id) {
        let x = board.absences.get(id) ?? Runtime.trap("Geen toegang");
        if (x.orgId != i.orgId) { Runtime.trap("Geen toegang") };
        ?x;
      };
      case null null;
    };
    let src = switch existing { case (?x) ?x.source; case null null };
    if (not Rights.mayEditAbsence(ctx, p, i.orgId, src)) { Runtime.trap("Geen toegang") };
    switch existing { case (?x) { if (x.archivedAt != null) { return #err("Deze afwezigheid bestaat niet meer") } }; case null {} };
    let o = org.orgs.get(i.orgId) ?? return #err("Onbekende firma");
    if (o.archivedAt != null) { return #err("Deze firma is gearchiveerd") };
    switch (i.personId) {
      case (?x) {
        let q = access.persons.get(x) ?? return #err("Onbekende persoon");
        if (q.orgId != ?i.orgId or q.archivedAt != null) { return #err("Deze persoon hoort niet bij die firma") };
      };
      case null {};
    };
    if (i.to < i.from) { return #err("Het einde ligt vóór het begin") };
    if (i.from < Config.minDay or i.to > Config.maxDay) { return #err("Onmogelijke datum") };
    if (i.to - i.from + 1 > Config.maxAbsenceDays) { return #err("Eén afwezigheid: hoogstens " # Config.maxAbsenceDays.toText() # " dagen") };
    let note = i.note.trim(#char ' ');
    if (note.size() > Config.maxAbsenceNote) { return #err("Notitie: hoogstens " # Config.maxAbsenceNote.toText() # " tekens") };
    let now = Time.now();
    let mine = not Rights.may(ctx, p, #manageAbsences, null); // een OA die zelf meldt
    let id = switch existing {
      case null {
        let active = board.absences.values().filter(func x = x.orgId == i.orgId and x.archivedAt == null).size();
        if (active >= Config.maxAbsencesPerOrg) { return #err("Te veel afwezigheden voor deze firma: archiveer eerst oude") };
        let id = Ids.next(ctr, "absence");
        board.absences.add(id, { id; orgId = i.orgId; personId = i.personId; kind = i.kind; from = i.from; to = i.to; note; source = if mine #oa else #intern; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [] });
        bdChange(id, i.orgId, p.id, "nieuw", bdAbsenceText(i.kind, i.personId, i.from, i.to) # (if mine " · gemeld door de OA" else ""));
        id;
      };
      case (?x) {
        board.absences.add(x.id, { x with personId = i.personId; kind = i.kind; from = i.from; to = i.to; note; updatedAt = now; updatedBy = p.id });
        let before = bdAbsenceText(x.kind, x.personId, x.from, x.to);
        let after = bdAbsenceText(i.kind, i.personId, i.from, i.to);
        bdChange(x.id, i.orgId, p.id, "gewijzigd", if (before == after) (if (x.note != note) "notitie" else "niets") else before # " → " # after);
        x.id;
      };
    };
    // Geen notitie in de auditlog (ze kan persoonlijk zijn); enkel firma, soort en periode.
    Access.audit(audit, caller, ?p.id, null, "afwezigheid", o.name # ": " # (if (existing == null) "nieuw " else "gewijzigd ") # bdAbsenceText(i.kind, i.personId, i.from, i.to) # (if mine " (gemeld door de OA)" else ""));
    bdNotify(p, o, i.kind, i.personId, i.from, i.to, mine);
    #ok(id);
  };

  public shared ({ caller }) func archiveAbsence(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let x = board.absences.get(id) ?? Runtime.trap("Geen toegang");
    if (not Rights.mayEditAbsence({ works; settings }, p, x.orgId, ?x.source)) { Runtime.trap("Geen toegang") };
    if (x.archivedAt != null) { return #err("Deze afwezigheid bestaat niet meer") };
    let now = Time.now();
    board.absences.add(id, { x with archivedAt = ?now; updatedAt = now; updatedBy = p.id });
    bdChange(id, x.orgId, p.id, "weg", bdAbsenceText(x.kind, x.personId, x.from, x.to));
    Access.audit(audit, caller, ?p.id, null, "afwezigheid", bdOrgName(x.orgId) # ": weg " # bdAbsenceText(x.kind, x.personId, x.from, x.to));
    #ok;
  };

  // Geschiedenis van de afwezigheden van één firma, nieuwste eerst (wie, wanneer, wat).
  public query ({ caller }) func absenceHistory(orgId : Nat, from : Nat, limit : Nat) : async [Views.AbsenceChangeView] {
    let p = Access.requireActive(access, caller);
    if (not Rights.mayReadAbsences({ works; settings }, p, orgId)) { Runtime.trap("Geen toegang") };
    let all = Array.reverse(board.absenceChanges.values().filter(func c = c.orgId == orgId).toArray());
    Access.page(all, from, limit).map(
      func(c : Types.AbsenceChange) : Views.AbsenceChangeView = { id = c.id; absenceId = c.absenceId; at = c.at; byName = Access.personName(access, c.by); what = c.what; detail = c.detail }
    );
  };

  // ── Regels voor een dubbele boeking (admin) ─────────────────────────────
  public query ({ caller }) func boardRules() : async Views.BoardRulesView {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readOrgPlanning, null);
    let trades = Oa.trades(settings, true);
    let rules = board.capacity.values().filter(func r = r.archivedAt == null).map(
      func(r : Types.CapacityRule) : Views.CapacityView {
        let title = if (r.key.startsWith(#text "org:")) {
          switch (Nat.fromText(r.key.trimStart(#text "org:"))) { case (?id) bdOrgName(id); case null r.key };
        } else {
          let k = r.key.trimStart(#text "trade:");
          switch (trades.find(func t = t.key == k)) { case (?t) t.name; case null k };
        };
        { key = r.key; title; maxWorks = r.maxWorks; note = r.note; updatedAt = r.updatedAt; updatedByName = Access.personName(access, r.updatedBy) };
      }
    ).toArray();
    { unit = Board.unit(settings); defaultMax = Board.defaultMax(settings); oaReportsAbsence = Board.oaReportsAbsence(settings); rules };
  };

  public shared ({ caller }) func setBoardRules(i : Views.BoardRulesInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageBoardRules, null);
    if (i.unit != "dag" and i.unit != "week") { return #err("Eenheid: \"dag\" of \"week\"") };
    if (i.defaultMax > Config.maxCapacity) { return #err("Hoogstens " # Config.maxCapacity.toText() # " werven tegelijk (0 = onbeperkt)") };
    let before = Board.unit(settings) # ", " # Board.defaultMax(settings).toText() # ", OA meldt " # (if (Board.oaReportsAbsence(settings)) "ja" else "nee");
    settings.values.add("board.unit", i.unit);
    settings.values.add("board.max", i.defaultMax.toText());
    settings.values.add("board.oaMeldt", if (i.oaReportsAbsence) "ja" else "nee");
    Access.audit(audit, caller, ?p.id, null, "weekbord-regels", before # " → " # i.unit # ", " # i.defaultMax.toText() # ", OA meldt " # (if (i.oaReportsAbsence) "ja" else "nee"));
    #ok;
  };

  // Eigen regel voor een vakgebied ("trade:<sleutel>") of een firma ("org:<id>"); null = weg (volgt weer de
  // algemene regel).
  public shared ({ caller }) func setCapacity(key : Text, maxWorks : ?Nat, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageBoardRules, null);
    let title = if (key.startsWith(#text "org:")) {
      let id = Nat.fromText(key.trimStart(#text "org:")) ?? return #err("Onbekende firma");
      let o = org.orgs.get(id) ?? return #err("Onbekende firma");
      if (key != "org:" # id.toText()) { return #err("Onbekende firma") };
      o.name;
    } else if (key.startsWith(#text "trade:")) {
      let k = key.trimStart(#text "trade:");
      let t = Oa.trades(settings, false).find(func x = x.key == k) ?? return #err("Onbekend vakgebied");
      t.name;
    } else { return #err("Sleutel: org:<id> of trade:<vakgebied>") };
    if (note.size() > Config.maxLabel) { return #err("Notitie: hoogstens " # Config.maxLabel.toText() # " tekens") };
    let now = Time.now();
    switch maxWorks {
      case null {
        switch (board.capacity.get(key)) {
          case (?r) { if (r.archivedAt == null) { board.capacity.add(key, { r with archivedAt = ?now; updatedAt = now; updatedBy = p.id }) } };
          case null {};
        };
        Access.audit(audit, caller, ?p.id, null, "weekbord-regel", title # ": eigen regel weg");
      };
      case (?m) {
        if (m > Config.maxCapacity) { return #err("Hoogstens " # Config.maxCapacity.toText() # " werven tegelijk (0 = onbeperkt)") };
        let old = board.capacity.get(key);
        if (old == null and board.capacity.size() >= Config.maxCapacityRules) { return #err("Te veel eigen regels") };
        board.capacity.add(key, { key; maxWorks = m; note = note.trim(#char ' '); updatedAt = now; updatedBy = p.id; archivedAt = null; extra = switch old { case (?r) r.extra; case null [] } });
        Access.audit(audit, caller, ?p.id, null, "weekbord-regel", title # ": hoogstens " # (if (m == 0) "onbeperkt" else m.toText()) # " werven tegelijk");
      };
    };
    #ok;
  };

  // ── Hulp (namen met bd-voorvoegsel: de mixins delen één naamruimte) ──────
  // Venster: van de maandag van `from`, `weeks` weken (1 tot boardMaxWeeks).
  func bdWindow(fromDay : Nat, weeks : Nat) : (Nat, Nat, Nat) {
    if (weeks == 0 or weeks > Config.boardMaxWeeks) { Runtime.trap("Weken: 1 tot " # Config.boardMaxWeeks.toText()) };
    if (fromDay < Config.minDay or fromDay > Config.maxDay) { Runtime.trap("Onmogelijke datum") };
    let from = Board.monday(fromDay);
    (from, weeks, from + 7 * weeks - 1);
  };

  // Wat een interne kijker ziet: de werven die hij mag zien volledig, de andere als "andere werf".
  func bdInternalSee(p : Types.Person) : Types.Work -> ?Bool {
    let ctx = { works; settings };
    func(w : Types.Work) : ?Bool { ?(Rights.planScope(ctx, p, w.id) == #full) };
  };

  func bdCompute(p : Types.Person, from : Nat, weeks : Nat, to : Nat, keepOrg : Nat -> Bool, see : Types.Work -> ?Bool) : [Board.Row] {
    let src = { plan; works; board; settings };
    let occByOrg = Board.collect(src, from, to, keepOrg, see);
    let absByOrg = Board.absencesIn(board, from, to, keepOrg);
    let unit = Board.unit(settings);
    let ids = Map.empty<Nat, ()>();
    for (k in occByOrg.keys()) { ids.add(k, ()) };
    for (k in absByOrg.keys()) { ids.add(k, ()) };
    // Ook de onderaannemers zonder werk in het venster (keuze "ook zonder werk" op het weekbord).
    for (o in org.orgs.values()) { if (o.kind == #subcontractor and o.archivedAt == null and keepOrg(o.id)) { ids.add(o.id, ()) } };
    let out = List.empty<Board.Row>();
    for (id in ids.keys()) {
      switch (org.orgs.get(id)) {
        case (?o) {
          let occs = switch (occByOrg.get(id)) { case (?l) l.toArray(); case null [] };
          let abs = switch (absByOrg.get(id)) { case (?l) l.toArray(); case null [] };
          let (m, srcText) = Board.capacityOf(board, settings, o);
          let facts : Board.OrgFacts = { org = o; code = Board.orgCode(o); maxWorks = m; maxFrom = srcText };
          let (cs, clash) = Board.conflicts(facts, occs, abs, unit, from, weeks);
          out.add({ facts; occs; absences = abs; conflicts = cs; clash });
        };
        case null {};
      };
    };
    ignore p;
    out.toArray();
  };

  func bdConflictList(rows : [Board.Row], keep : Views.ConflictView -> Bool, limit : Nat) : Views.ConflictList {
    let all = List.empty<Views.ConflictView>();
    for (x in rows.values()) { for (c in x.conflicts.values()) { if (keep(c)) { all.add(c) } } };
    let sorted = Board.sortConflicts(all.toArray());
    let lim = if (limit == 0 or limit > Config.boardMaxConflicts) Config.boardMaxConflicts else limit;
    { total = sorted.size(); items = Access.page(sorted, 0, lim) };
  };

  func bdRowView(p : Types.Person, x : Board.Row, from : Nat, weeks : Nat) : Views.BoardRow {
    let o = x.facts.org;
    {
      orgId = o.id;
      name = o.name;
      code = x.facts.code;
      kind = o.kind;
      trades = o.trades;
      maxWorks = x.facts.maxWorks;
      maxFrom = x.facts.maxFrom;
      cells = Board.cells(x.occs, from, weeks, x.clash, func id = Access.personName(access, id));
      absences = Array.sort<Types.Absence>(x.absences, func(a, b) = Nat.compare(a.from, b.from)).map(func a = bdAbsenceView(p, a));
      conflicts = x.conflicts;
    };
  };

  func bdWeeks(from : Nat, weeks : Nat) : [Views.BoardWeek] {
    let company = plan.calendarBlocks.values().filter(func b = b.archivedAt == null and b.scope == #company).toArray();
    Array.tabulate<Views.BoardWeek>(
      weeks,
      func i {
        let m = from + 7 * i;
        {
          monday = m;
          blocks = company.filter(func b = b.to >= m and b.from <= m + 6).map(
            func(b : Types.CalendarBlock) : Views.BlockView = { id = b.id; scope = b.scope; kind = b.kind; from = b.from; to = b.to; reason = b.reason; createdByName = Access.personName(access, b.createdBy) }
          );
        };
      },
    );
  };

  func bdOrgName(id : Nat) : Text { switch (org.orgs.get(id)) { case (?o) o.name; case null "#" # id.toText() } };

  func bdAbsenceText(kind : Types.AbsenceKind, personId : ?Nat, from : Nat, to : Nat) : Text {
    Board.kindWord(kind) # (switch personId { case (?x) " (" # Access.personName(access, x) # ")"; case null "" }) # " " # Plan.fmtDay(from) # " – " # Plan.fmtDay(to);
  };

  func bdAbsenceView(p : Types.Person, x : Types.Absence) : Views.AbsenceView {
    {
      id = x.id;
      orgId = x.orgId;
      orgName = bdOrgName(x.orgId);
      personId = x.personId;
      personName = switch (x.personId) { case (?q) ?Access.personName(access, q); case null null };
      kind = x.kind;
      from = x.from;
      to = x.to;
      note = x.note;
      source = x.source;
      createdAt = x.createdAt;
      createdByName = Access.personName(access, x.createdBy);
      updatedAt = x.updatedAt;
      updatedByName = Access.personName(access, x.updatedBy);
      mine = p.orgId == ?x.orgId and x.source == #oa;
    };
  };

  func bdChange(absenceId : Nat, orgId : Nat, by : Nat, what : Text, detail : Text) {
    let id = Ids.next(ctr, "absenceChange");
    board.absenceChanges.add(id, { id; absenceId; orgId; at = Time.now(); by; what; detail });
  };

  // Wie moet het weten? De werfleiders van de werven met een taak in de afwezigheid (zonder de auteur zelf);
  // meldt een OA zelf en raakt het geen enkele taak, dan de admins (kantoor weet het zo toch). Begrensd.
  func bdNotify(p : Types.Person, o : Types.Org, kind : Types.AbsenceKind, personId : ?Nat, from : Nat, to : Nat, byOa : Bool) {
    let src = { plan; works; board; settings };
    let occs = switch (Board.collect(src, from, to, func x = x == o.id, func _ = ?true).get(o.id)) { case (?l) l.toArray(); case null [] };
    let perWork = Map.empty<Nat, Nat>();
    for (oc in occs.values()) {
      let applies = oc.t.kind != #milestone and oc.days.size() > 0 and (switch personId { case null true; case (?x) oc.a.personId == ?x });
      if (applies) { perWork.add(oc.w.id, (switch (perWork.get(oc.w.id)) { case (?n) n; case null 0 }) + 1) };
    };
    let what = o.name # " is afwezig (" # Board.kindWord(kind) # ", " # Plan.fmtDay(from) # " – " # Plan.fmtDay(to) # ")";
    var sent = 0;
    if (perWork.size() == 0) {
      if (byOa) {
        for (a in Access.activeAdminIds(access).values()) { if (a != p.id and sent < 20) { Access.notify(audit, ctr, a, "afwezigheid", what # ": gemeld door " # p.name, null); sent += 1 } };
      };
      return;
    };
    // Eén melding per persoon, met alle werven die hem aanbelangen (niet één per werf).
    let perPerson = Map.empty<Nat, List.List<(Text, Nat, Nat)>>();
    for ((w, n) in perWork.entries()) {
      let code = switch (works.works.get(w)) { case (?x) x.code; case null "#" # w.toText() };
      for (l in bdLeaders(w).values()) {
        if (l != p.id) {
          switch (perPerson.get(l)) { case (?xs) xs.add((code, n, w)); case null perPerson.add(l, List.singleton<(Text, Nat, Nat)>((code, n, w))) };
        };
      };
    };
    for ((l, xs) in perPerson.entries()) {
      if (sent < 20) {
        let total = xs.values().foldLeft(0, func(a : Nat, (_, n, _) : (Text, Nat, Nat)) : Nat = a + n);
        let codes = xs.values().map(func((c, _, _) : (Text, Nat, Nat)) : Text = c).join(", ");
        let onlyWork = if (xs.size() == 1) ?xs.at(0).2 else null;
        Access.notify(audit, ctr, l, "afwezigheid", what # (if byOa " (gemeld door " # p.name # ")" else "") # ": " # total.toText() # (if (total == 1) " taak" else " taken") # " op " # codes # " " # (if (total == 1) "valt" else "vallen") # " erin", onlyWork);
        sent += 1;
      };
    };
  };

  func bdLeaders(workId : Nat) : [Nat] {
    let ids = List.empty<Nat>();
    switch (works.works.get(workId)) { case (?w) { switch (w.leaderPersonId) { case (?x) ids.add(x); case null {} } }; case null {} };
    for (m in works.memberships.values()) {
      if (m.workId == workId and m.endedAt == null and m.role == #werfleider) {
        switch (m.personId) { case (?x) { if (not ids.contains(Nat.equal, x)) { ids.add(x) } }; case null {} };
      };
    };
    if (ids.size() == 0) { return Access.activeAdminIds(access) };
    ids.toArray();
  };

};
