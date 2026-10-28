// Planning per werf (stap 1.3, architectuur §2.5): taken, afhankelijkheden, levertermijnen, uitvoerders,
// bevestiging door de OA, kalenderblokken (bouwverlof, feestdagen, STOP) en sjablonen.
// Rechten (Rights.mo): de werfleider en de admin plannen (R5), interne rollen lezen alles, architect en
// veiligheidscoördinator lezen zonder interne notities, de OA ziet enkel de taken van zijn firma en bevestigt
// met de grant #confirmPlanning (R6), de klant ziet een samenvatting zonder firma's (planScope).
// Elke wijziging: een TaskChange per veld (wat schoof en waarom) + een auditregel, en de planversie van de
// werf gaat omhoog (wie met een verouderde planning bewaart, krijgt een fout in plaats van stil verlies).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
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
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Lezen ───────────────────────────────────────────────────────────────
  public query ({ caller }) func getPlan(workId : Nat) : async Views.PlanView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let scope = Rights.planScope(ctx, p, workId);
    if (scope == #none) { Runtime.trap("Geen toegang") };
    let cal = Plan.calFor(plan, works, workId);
    let all = Plan.tasksOf(plan, workId);
    let assigns = plAssignmentsOf(workId);
    let visible = switch scope {
      case (#ownOrg) all.filter(func t = plOwnTask(t, assigns, p.orgId));
      case _ all;
    };
    let ids = Map.empty<Nat, Types.Task>();
    for (t in all.values()) { ids.add(t.id, t) };
    let shown = Map.empty<Nat, ()>();
    for (t in visible.values()) { shown.add(t.id, ()) };
    let deps = Plan.depsOf(plan, workId);
    let tasks = visible.map(func t = plTaskView(cal, t, scope, p.orgId, assigns, deps, ids));
    var first : ?Nat = null;
    var last : ?Nat = null;
    for (t in tasks.values()) {
      first := ?(switch first { case (?f) Nat.min(f, t.start); case null t.start });
      last := ?(switch last { case (?l) Nat.max(l, t.end); case null t.end });
    };
    {
      workId;
      version = plVersion(workId);
      scope = switch scope { case (#full) "full"; case (#external) "external"; case (#ownOrg) "ownOrg"; case _ "summary" };
      tasks;
      dependencies = if (scope == #summary) [] else deps.filter(func d = shown.containsKey(d.fromTaskId) and shown.containsKey(d.toTaskId)).map(
        func d = { id = d.id; fromTaskId = d.fromTaskId; toTaskId = d.toTaskId; kind = d.kind; lagDays = d.lagDays }
      );
      blocks = Plan.blocksFor(plan, works, workId).map(func b = plBlockView(b, scope == #full));
      start = first;
      end = last;
      caps = {
        edit = Rights.may(ctx, p, #editPlanning, ?workId);
        confirm = Rights.may(ctx, p, #confirmOwnAssignment, ?workId);
        history = scope == #full;
      };
    };
  };

  // Wat er gebeurt als je een taak verplaatst of verlengt, vóór je bevestigt (de voorvertoning van de Gantt).
  public query ({ caller }) func previewPlan(workId : Nat, change : Views.PlanChange) : async Result.Result<Views.PlanPreview, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    let cal = Plan.calFor(plan, works, workId);
    let shifts = switch (Plan.schedule(cal, Plan.tasksOf(plan, workId), Plan.depsOf(plan, workId), change, func _ = true)) {
      case (#ok s) s;
      case (#err e) return #err(e);
    };
    #ok({ version = plVersion(workId); changes = shifts.map(func s = plShiftView(cal, s)); reopened = plReopenCount(shifts) });
  };

  public shared ({ caller }) func applyPlan(workId : Nat, change : Views.PlanChange, expectedVersion : Nat, reason : Text) : async Result.Result<Views.PlanResult, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    switch (plStale(workId, expectedVersion)) { case (?e) return #err(e); case null {} };
    if (reason.size() > Config.maxText) { return #err("Reden te lang") };
    let cal = Plan.calFor(plan, works, workId);
    let shifts = switch (Plan.schedule(cal, Plan.tasksOf(plan, workId), Plan.depsOf(plan, workId), change, func _ = true)) {
      case (#ok s) s;
      case (#err e) return #err(e);
    };
    let reopened = plApplyShifts(p, cal, shifts, reason);
    let v = plBump(workId);
    let what = switch change { case (#move m) "verschoven: " # plTitle(m.taskId); case (#reflow) "herschikt" };
    if (shifts.size() > 0) {
      Access.audit(audit, caller, ?p.id, ?workId, "planning-geschoven", plWorkCode(workId) # ": " # what # " (" # shifts.size().toText() # " taken" # (if (reopened > 0) ", " # reopened.toText() # " bevestigingen terug open" else "") # ")");
    };
    #ok({ version = v; changes = shifts.map(func s = plShiftView(cal, s)); reopened; taskId = null });
  };

  // ── Taken ───────────────────────────────────────────────────────────────
  // Een nieuwe taak, of een bestaande wijzigen. Verandert de start of de duur, dan schuiven de opvolgers
  // enkel waar nodig (#asNeeded); de Gantt gebruikt previewPlan/applyPlan voor de keuze "mee verschuiven".
  public shared ({ caller }) func saveTask(workId : Nat, i : Views.TaskInput, expectedVersion : Nat) : async Result.Result<Views.PlanResult, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    switch (plStale(workId, expectedVersion)) { case (?e) return #err(e); case null {} };
    let title = Access.cleanText(i.title, Config.maxName) ?? return #err("Titel: 1 tot " # Config.maxName.toText() # " tekens");
    switch (plInputError(i)) { case (?e) return #err(e); case null {} };
    if (i.reason.size() > Config.maxText) { return #err("Reden te lang") };
    let cal = Plan.calFor(plan, works, workId);
    let now = Time.now();
    switch (i.id) {
      case null {
        let current = Plan.tasksOf(plan, workId);
        if (current.size() >= Config.maxTasksPerWork) { return #err("Te veel taken op deze werf") };
        let id = Ids.next(ctr, "task");
        let order = current.foldLeft(0, func(m : Nat, t : Types.Task) : Nat = Nat.max(m, t.order)) + 1;
        let t : Types.Task = {
          id;
          workId;
          title;
          note = i.note;
          kind = i.kind;
          templateKey = null;
          trade = i.trade;
          responsibleOrgId = i.responsibleOrgId;
          status = i.status;
          percent = i.percent;
          start = Plan.nextWorkday(cal, i.start);
          workdays = i.workdays;
          leadDays = i.leadDays;
          orderDay = i.orderDay;
          actualStart = null;
          actualEnd = null;
          order;
          quoteLineIds = [];
          createdAt = now;
          createdBy = p.id;
          updatedAt = now;
          updatedBy = p.id;
          archivedAt = null;
          extra = [];
        };
        plan.tasks.add(id, t);
        plChange(t, p.id, "taak", "", title, i.reason);
        plSyncPrimary(t, null, p.id);
        let v = plBump(workId);
        Access.audit(audit, caller, ?p.id, ?workId, "planning-taak", plWorkCode(workId) # ": nieuw " # Plan.kindKey(i.kind) # " «" # title # "» " # Plan.fmtDay(t.start) # ", " # i.workdays.toText() # " werkdagen");
        #ok({ version = v; changes = []; reopened = 0; taskId = ?id });
      };
      case (?id) {
        let old = plan.tasks.get(id) ?? return #err("Onbekende taak");
        if (old.workId != workId or old.archivedAt != null) { return #err("Onbekende taak") };
        let next : Types.Task = {
          old with
          title;
          note = i.note;
          kind = i.kind;
          trade = i.trade;
          responsibleOrgId = i.responsibleOrgId;
          status = i.status;
          percent = i.percent;
          leadDays = i.leadDays;
          orderDay = i.orderDay;
          updatedAt = now;
          updatedBy = p.id;
        };
        // Eerst rekenen met de nieuwe inhoud (soort, levering) en de gevraagde start en duur; pas als dat
        // lukt, wordt alles bewaard.
        let tasks = Plan.tasksOf(plan, workId).map(func t = if (t.id == id) next else t);
        let shifts = switch (Plan.schedule(cal, tasks, Plan.depsOf(plan, workId), #move({ taskId = id; start = i.start; workdays = i.workdays; mode = #asNeeded }), func _ = true)) {
          case (#ok s) s;
          case (#err e) return #err(e);
        };
        plan.tasks.add(id, next);
        // Inhoud: een wijziging per veld (de dagen volgen hieronder via de verschuivingen).
        plChange(old, p.id, "titel", old.title, title, i.reason);
        if (old.note != i.note) { plChange(old, p.id, "notitie", "", "gewijzigd", i.reason) };
        plChange(old, p.id, "soort", Plan.kindKey(old.kind), Plan.kindKey(i.kind), i.reason);
        plChange(old, p.id, "vakgebied", plOptText(old.trade), plOptText(i.trade), i.reason);
        plChange(old, p.id, "verantwoordelijke", plOrgText(old.responsibleOrgId), plOrgText(i.responsibleOrgId), i.reason);
        plChange(old, p.id, "status", Plan.statusKey(old.status), Plan.statusKey(i.status), i.reason);
        plChange(old, p.id, "voortgang", old.percent.toText() # " %", i.percent.toText() # " %", i.reason);
        plChange(old, p.id, "levertermijn", old.leadDays.toText() # " d", i.leadDays.toText() # " d", i.reason);
        plChange(old, p.id, "besteld op", plOptDay(old.orderDay), plOptDay(i.orderDay), i.reason);
        let reopened = plApplyShifts(p, cal, shifts, i.reason);
        plSyncPrimary(next, old.responsibleOrgId, p.id);
        let v = plBump(workId);
        Access.audit(audit, caller, ?p.id, ?workId, "planning-taak", plWorkCode(workId) # ": «" # title # "» gewijzigd" # (if (shifts.size() > 1) " (" # (shifts.size() - 1 : Nat).toText() # " opvolgers geschoven)" else ""));
        #ok({ version = v; changes = shifts.map(func s = plShiftView(cal, s)); reopened; taskId = ?id });
      };
    };
  };

  public shared ({ caller }) func archiveTask(workId : Nat, taskId : Nat, expectedVersion : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    switch (plStale(workId, expectedVersion)) { case (?e) return #err(e); case null {} };
    let t = plan.tasks.get(taskId) ?? return #err("Onbekende taak");
    if (t.workId != workId or t.archivedAt != null) { return #err("Onbekende taak") };
    let now = Time.now();
    plan.tasks.add(taskId, { t with archivedAt = ?now; updatedAt = now; updatedBy = p.id });
    for (d in plan.dependencies.values()) {
      if (d.archivedAt == null and (d.fromTaskId == taskId or d.toTaskId == taskId)) { plan.dependencies.add(d.id, { d with archivedAt = ?now }) };
    };
    for (a in plan.assignments.values()) {
      if (a.taskId == taskId and a.archivedAt == null) { plan.assignments.add(a.id, { a with archivedAt = ?now; updatedAt = now }) };
    };
    plChange(t, p.id, "taak", t.title, "gearchiveerd", "");
    Access.audit(audit, caller, ?p.id, ?workId, "planning-taak", plWorkCode(workId) # ": «" # t.title # "» gearchiveerd");
    #ok(plBump(workId));
  };

  // Volgorde in de Gantt: alle actieve taken van de werf, in de nieuwe volgorde.
  public shared ({ caller }) func setTaskOrder(workId : Nat, taskIds : [Nat], expectedVersion : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    switch (plStale(workId, expectedVersion)) { case (?e) return #err(e); case null {} };
    let current = Plan.tasksOf(plan, workId);
    if (taskIds.size() != current.size()) { return #err("Geef alle taken van de werf") };
    let seen = Map.empty<Nat, ()>();
    for (id in taskIds.values()) {
      if (seen.containsKey(id) or not current.any(func t = t.id == id)) { return #err("Onbekende of dubbele taak") };
      seen.add(id, ());
    };
    var n = 0;
    for (id in taskIds.values()) {
      n += 1;
      switch (plan.tasks.get(id)) { case (?t) { if (t.order != n) { plan.tasks.add(id, { t with order = n }) } }; case null {} };
    };
    Access.audit(audit, caller, ?p.id, ?workId, "planning-volgorde", plWorkCode(workId));
    #ok(plBump(workId));
  };

  // ── Afhankelijkheden ────────────────────────────────────────────────────
  // Bij een nieuwe afhankelijkheid schuiven de opvolger en zijn keten enkel waar nodig.
  public shared ({ caller }) func addDependency(workId : Nat, i : Views.DependencyInput, expectedVersion : Nat) : async Result.Result<Views.PlanResult, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    switch (plStale(workId, expectedVersion)) { case (?e) return #err(e); case null {} };
    switch (plDepError(workId, i)) { case (?e) return #err(e); case null {} };
    let tasks = Plan.tasksOf(plan, workId);
    let deps = Plan.depsOf(plan, workId);
    let id = Ids.next(ctr, "dependency");
    let d : Types.Dependency = { id; workId; fromTaskId = i.fromTaskId; toTaskId = i.toTaskId; kind = i.kind; lagDays = i.lagDays; createdAt = Time.now(); createdBy = p.id; archivedAt = null };
    plan.dependencies.add(id, d);
    // Enkel de opvolger en wat erna komt mag schuiven; de rest van de planning blijft staan.
    let cal = Plan.calFor(plan, works, workId);
    let chain = plChainFrom(Array.concat(deps, [d]), i.toTaskId);
    let shifts = switch (Plan.schedule(cal, tasks, Array.concat(deps, [d]), #reflow, func t = chain.containsKey(t.id))) {
      case (#ok s) s;
      case (#err e) { plan.dependencies.add(id, { d with archivedAt = ?Time.now() }); return #err(e) };
    };
    let reason = "wacht op " # plTitle(i.fromTaskId);
    plChange2(i.toTaskId, p.id, "afhankelijkheid", "", plTitle(i.fromTaskId) # (switch (i.kind) { case (#finishToStart) " (einde → begin"; case (#startToStart) " (begin → begin" }) # (if (i.lagDays != 0) ", wachttijd " # i.lagDays.toText() # " d)" else ")"), "");
    let reopened = plApplyShifts(p, cal, shifts, reason);
    let v = plBump(workId);
    Access.audit(audit, caller, ?p.id, ?workId, "planning-afhankelijkheid", plWorkCode(workId) # ": " # plTitle(i.toTaskId) # " " # reason # (if (shifts.size() > 0) " (" # shifts.size().toText() # " taken geschoven)" else ""));
    #ok({ version = v; changes = shifts.map(func s = plShiftView(cal, s)); reopened; taskId = null });
  };

  // Wat er zou schuiven als deze afhankelijkheid erbij komt (de voorvertoning in de taakfiche, C2).
  public query ({ caller }) func previewDependency(workId : Nat, i : Views.DependencyInput) : async Result.Result<Views.PlanPreview, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    switch (plDepError(workId, i)) { case (?e) return #err(e); case null {} };
    let d : Types.Dependency = { id = 0; workId; fromTaskId = i.fromTaskId; toTaskId = i.toTaskId; kind = i.kind; lagDays = i.lagDays; createdAt = 0; createdBy = p.id; archivedAt = null };
    let all = Array.concat(Plan.depsOf(plan, workId), [d]);
    let chain = plChainFrom(all, i.toTaskId);
    let cal = Plan.calFor(plan, works, workId);
    switch (Plan.schedule(cal, Plan.tasksOf(plan, workId), all, #reflow, func t = chain.containsKey(t.id))) {
      case (#ok shifts) #ok({ version = plVersion(workId); changes = shifts.map(func s = plShiftView(cal, s)); reopened = plReopenCount(shifts) });
      case (#err e) #err(e);
    };
  };

  public shared ({ caller }) func removeDependency(workId : Nat, depId : Nat, expectedVersion : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    switch (plStale(workId, expectedVersion)) { case (?e) return #err(e); case null {} };
    let d = plan.dependencies.get(depId) ?? return #err("Onbekende afhankelijkheid");
    if (d.workId != workId or d.archivedAt != null) { return #err("Onbekende afhankelijkheid") };
    plan.dependencies.add(depId, { d with archivedAt = ?Time.now() });
    plChange2(d.toTaskId, p.id, "afhankelijkheid", plTitle(d.fromTaskId), "weg", "");
    Access.audit(audit, caller, ?p.id, ?workId, "planning-afhankelijkheid", plWorkCode(workId) # ": " # plTitle(d.toTaskId) # " wacht niet meer op " # plTitle(d.fromTaskId));
    #ok(plBump(workId));
  };

  // ── Uitvoerders (de weekcel) en bevestiging door de OA ────────────────────
  // De verantwoordelijke van een taak is altijd de eerste uitvoerder (primary, via saveTask). Hier: een
  // tweede firma of een persoon, eventueel voor een deel van de taak.
  public shared ({ caller }) func saveAssignment(workId : Nat, i : Views.AssignmentInput, expectedVersion : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    switch (plStale(workId, expectedVersion)) { case (?e) return #err(e); case null {} };
    let t = plan.tasks.get(i.taskId) ?? return #err("Onbekende taak");
    if (t.workId != workId or t.archivedAt != null) { return #err("Onbekende taak") };
    switch (plOrgError(?i.orgId)) { case (?e) return #err(e); case null {} };
    switch (i.personId) {
      case (?x) {
        let person = access.persons.get(x) ?? return #err("Onbekende persoon");
        if (person.orgId != ?i.orgId or person.archivedAt != null) { return #err("Deze persoon hoort niet bij die firma") };
      };
      case null {};
    };
    switch (i.fromDay, i.toDay) {
      case (?f, ?u) { if (u < f) { return #err("Het einde ligt vóór het begin") } };
      case _ {};
    };
    if (i.note.size() > Config.maxText) { return #err("Notitie te lang") };
    let now = Time.now();
    switch (i.id) {
      case null {
        if (plAssignmentsOf(workId).filter(func a = a.taskId == i.taskId).size() >= Config.maxAssignPerTask) { return #err("Te veel uitvoerders voor deze taak") };
        let id = Ids.next(ctr, "assignment");
        plan.assignments.add(id, { id; taskId = i.taskId; workId; orgId = i.orgId; personId = i.personId; fromDay = i.fromDay; toDay = i.toDay; note = i.note; primary = false; confirmation = #open; createdAt = now; createdBy = p.id; updatedAt = now; archivedAt = null; extra = [] });
        plChange(t, p.id, "uitvoerder", "", plOrgText(?i.orgId), "");
        Access.audit(audit, caller, ?p.id, ?workId, "planning-uitvoerder", plWorkCode(workId) # ": " # plOrgText(?i.orgId) # " bij «" # t.title # "»");
        plNotifyNew(p.id, i.orgId, t);
        ignore plBump(workId);
        #ok(id);
      };
      case (?id) {
        let a = plan.assignments.get(id) ?? return #err("Onbekende uitvoerder");
        if (a.workId != workId or a.taskId != i.taskId or a.archivedAt != null) { return #err("Onbekende uitvoerder") };
        if (a.primary and a.orgId != i.orgId) { return #err("De verantwoordelijke wijzig je bij de taak zelf") };
        let moved = a.orgId != i.orgId or a.personId != i.personId or a.fromDay != i.fromDay or a.toDay != i.toDay;
        plan.assignments.add(id, { a with orgId = i.orgId; personId = i.personId; fromDay = i.fromDay; toDay = i.toDay; note = i.note; updatedAt = now; confirmation = if (moved) #open else a.confirmation });
        if (moved) { plChange(t, p.id, "uitvoerder", plOrgText(?a.orgId), plOrgText(?i.orgId), "gewijzigd: bevestiging terug open") };
        Access.audit(audit, caller, ?p.id, ?workId, "planning-uitvoerder", plWorkCode(workId) # ": " # plOrgText(?i.orgId) # " bij «" # t.title # "» gewijzigd");
        ignore plBump(workId);
        #ok(id);
      };
    };
  };

  public shared ({ caller }) func archiveAssignment(workId : Nat, assignmentId : Nat, expectedVersion : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    switch (plStale(workId, expectedVersion)) { case (?e) return #err(e); case null {} };
    let a = plan.assignments.get(assignmentId) ?? return #err("Onbekende uitvoerder");
    if (a.workId != workId or a.archivedAt != null) { return #err("Onbekende uitvoerder") };
    if (a.primary) { return #err("De verantwoordelijke wijzig je bij de taak zelf") };
    let now = Time.now();
    plan.assignments.add(assignmentId, { a with archivedAt = ?now; updatedAt = now });
    plChange2(a.taskId, p.id, "uitvoerder", plOrgText(?a.orgId), "weg", "");
    Access.audit(audit, caller, ?p.id, ?workId, "planning-uitvoerder", plWorkCode(workId) # ": " # plOrgText(?a.orgId) # " weg bij " # plTitle(a.taskId));
    #ok(plBump(workId));
  };

  // R6: de OA bevestigt (of weigert, met een reden) een toewijzing van zijn eigen firma; hij kan niets anders
  // wijzigen. Een weigering gaat als melding naar de werfleider(s) van de werf.
  public shared ({ caller }) func confirmAssignment(assignmentId : Nat, accept : Bool, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let a = plan.assignments.get(assignmentId) ?? Runtime.trap("Geen toegang");
    Rights.require({ works; settings }, p, #confirmOwnAssignment, ?a.workId);
    if (p.orgId != ?a.orgId) { Runtime.trap("Geen toegang: niet jouw toewijzing") };
    if (a.archivedAt != null) { return #err("Deze toewijzing bestaat niet meer") };
    let t = plan.tasks.get(a.taskId) ?? return #err("Onbekende taak");
    if (t.archivedAt != null) { return #err("Deze taak bestaat niet meer") };
    let now = Time.now();
    let why = reason.trim(#char ' ');
    if (not accept and (why.size() == 0 or why.size() > Config.maxText)) { return #err("Geef een reden (1 tot " # Config.maxText.toText() # " tekens)") };
    let conf : Types.Confirmation = if accept #confirmed({ by = p.id; at = now }) else #declined({ by = p.id; at = now; reason = why });
    plan.assignments.add(assignmentId, { a with confirmation = conf; updatedAt = now });
    plChange(t, p.id, "bevestiging", plConfText(a.confirmation), plConfText(conf), if accept "" else why);
    Access.audit(audit, caller, ?p.id, ?a.workId, if accept "planning-bevestigd" else "planning-geweigerd", plWorkCode(a.workId) # ": «" # t.title # "» door " # p.name);
    if (not accept) {
      for (wl in plLeaders(a.workId).values()) {
        Access.notify(audit, ctr, wl, "planning-geweigerd", p.name # " kan niet voor «" # t.title # "» (" # plWorkCode(a.workId) # "): " # why, ?a.workId);
      };
    };
    #ok;
  };

  // De toewijzingen van één firma over alle werven (null = de eigen firma): "Mijn taken" van een OA en de
  // bouwsteen van het weekbord (1.4). Een externe ziet enkel werven waar hij lid is.
  public query ({ caller }) func orgAssignments(orgId : ?Nat, from : Nat, to : Nat) : async [Views.OrgAssignmentView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let target = switch orgId {
      case null { switch (p.orgId) { case (?o) o; case null return [] } };
      case (?o) {
        if (?o != p.orgId) { Rights.require(ctx, p, #readOrgPlanning, null) };
        o;
      };
    };
    if (to < from or to - from > 400) { Runtime.trap("Periode: hoogstens 400 dagen") };
    let cals = Map.empty<Nat, Plan.Cal>();
    let out = List.empty<Views.OrgAssignmentView>();
    for (a in plan.assignments.values()) {
      if (a.orgId == target and a.archivedAt == null) {
        let scope = Rights.planScope(ctx, p, a.workId);
        let allowed = switch scope { case (#full) true; case (#ownOrg) ?a.orgId == p.orgId; case _ false };
        switch (plan.tasks.get(a.taskId), works.works.get(a.workId)) {
          case (?t, ?w) {
            if (allowed and t.archivedAt == null) {
              let cal = switch (cals.get(a.workId)) { case (?c) c; case null { let c = Plan.calFor(plan, works, a.workId); cals.add(a.workId, c); c } };
              let end = Plan.endDay(cal, t.start, t.workdays);
              let (s, e) = Plan.assignmentDays(a, t.start, end);
              if (e >= from and s <= to) {
                out.add({
                  assignment = plAssignmentView(a, s, e, ?a.workId);
                  workCode = w.code;
                  workName = w.name;
                  taskTitle = t.title;
                  taskKind = t.kind;
                  taskStatus = t.status;
                  canConfirm = p.orgId == ?a.orgId and Rights.may(ctx, p, #confirmOwnAssignment, ?a.workId);
                });
              };
            };
          };
          case _ {};
        };
      };
    };
    Array.sort<Views.OrgAssignmentView>(out.toArray(), func(x, y) = Nat.compare(x.assignment.start, y.assignment.start));
  };

  // ── Kalenderblokken: bouwverlof, feestdagen (bedrijf) en STOP (werf) ─────
  public query ({ caller }) func listCalendarBlocks(workId : ?Nat) : async [Views.BlockView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    switch workId {
      case null {
        Rights.require(ctx, p, #readOrgPlanning, null);
        plan.calendarBlocks.values().filter(func b = b.archivedAt == null and b.scope == #company).map(func b = plBlockView(b, true)).toArray();
      };
      case (?w) {
        Rights.require(ctx, p, #readPlanning, ?w);
        let full = Rights.planScope(ctx, p, w) == #full;
        Plan.blocksFor(plan, works, w).map(func b = plBlockView(b, full));
      };
    };
  };

  public shared ({ caller }) func saveCalendarBlock(i : Views.BlockInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    plBlockRight(p, i.scope);
    let reason = Access.cleanText(i.reason, Config.maxLabel) ?? return #err("Omschrijving: 1 tot " # Config.maxLabel.toText() # " tekens");
    if (i.to < i.from) { return #err("Het einde ligt vóór het begin") };
    if (i.to - i.from + 1 > Config.maxBlockDays) { return #err("Eén blok: hoogstens " # Config.maxBlockDays.toText() # " dagen") };
    if (i.from < Config.minDay or i.to > Config.maxDay) { return #err("Onmogelijke datum") };
    let now = Time.now();
    let id = switch (i.id) {
      case null {
        if (plan.calendarBlocks.values().filter(func b = b.archivedAt == null).size() >= Config.maxBlocks) { return #err("Te veel kalenderblokken") };
        let id = Ids.next(ctr, "calendarBlock");
        plan.calendarBlocks.add(id, { id; scope = i.scope; kind = i.kind; from = i.from; to = i.to; reason; createdAt = now; createdBy = p.id; archivedAt = null; extra = [] });
        id;
      };
      case (?id) {
        let b = plan.calendarBlocks.get(id) ?? return #err("Onbekend blok");
        if (b.archivedAt != null or b.scope != i.scope) { return #err("Onbekend blok") };
        plan.calendarBlocks.add(id, { b with kind = i.kind; from = i.from; to = i.to; reason });
        id;
      };
    };
    plBlockBump(i.scope);
    Access.audit(audit, caller, ?p.id, plScopeWork(i.scope), "kalender", plScopeText(i.scope) # ": " # reason # " " # Plan.fmtDay(i.from) # " – " # Plan.fmtDay(i.to));
    #ok(id);
  };

  public shared ({ caller }) func archiveCalendarBlock(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let b = plan.calendarBlocks.get(id) ?? Runtime.trap("Geen toegang");
    plBlockRight(p, b.scope);
    if (b.archivedAt != null) { return #err("Onbekend blok") };
    plan.calendarBlocks.add(id, { b with archivedAt = ?Time.now() });
    plBlockBump(b.scope);
    Access.audit(audit, caller, ?p.id, plScopeWork(b.scope), "kalender", plScopeText(b.scope) # ": " # b.reason # " weg");
    #ok;
  };

  // ── Sjablonen ───────────────────────────────────────────────────────────
  public query ({ caller }) func listTemplates() : async [Views.TemplateView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readTemplates, null);
    Plan.templates(plan).map(
      func(t : Types.Template) : Views.TemplateView = { key = t.key; name = t.name; steps = t.steps; provisional = t.provisional; stored = plan.templates.containsKey(t.key); archived = t.archivedAt != null; updatedAt = t.updatedAt }
    );
  };

  public shared ({ caller }) func saveTemplate(i : Views.TemplateInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageTemplates, null);
    let key = Text.toLower(i.key.trim(#char ' '));
    if (key.size() == 0 or key.size() > 40 or not key.chars().all(func c = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '-')) {
      return #err("Code: 1 tot 40 tekens, enkel a-z, 0-9 en -");
    };
    let name = Access.cleanText(i.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    let known = Oa.trades(settings, false);
    switch (Plan.templateError(i.steps, func k = known.any(func x = x.key == k))) { case (?e) return #err(e); case null {} };
    let old = plan.templates.get(key);
    if (old == null and key != Config.defaultTemplateKey and plan.templates.size() >= Config.maxTemplates) { return #err("Te veel sjablonen") };
    let now = Time.now();
    let steps = i.steps.map(func(s : Types.TemplateStep) : Types.TemplateStep = { s with title = s.title.trim(#char ' ') });
    plan.templates.add(key, { key; name; steps; provisional = i.provisional; updatedAt = now; updatedBy = p.id; archivedAt = if (i.archived) ?now else null; extra = switch old { case (?o) o.extra; case null [] } });
    Access.audit(audit, caller, ?p.id, null, "sjabloon", key # ": " # steps.size().toText() # " stappen" # (if (i.archived) ", gearchiveerd" else ""));
    #ok;
  };

  // Een sjabloon op een werf zetten vanaf een startdatum: taken, afhankelijkheden en data volgens de kalender.
  // Heeft de werf al taken, dan enkel met append = true (de nieuwe komen erachter).
  public shared ({ caller }) func applyTemplate(workId : Nat, key : Text, startDay : Nat, append : Bool, expectedVersion : Nat) : async Result.Result<Views.PlanResult, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPlanning, ?workId);
    switch (plStale(workId, expectedVersion)) { case (?e) return #err(e); case null {} };
    let tpl = Plan.template(plan, key) ?? return #err("Onbekend sjabloon");
    if (tpl.archivedAt != null) { return #err("Dit sjabloon is gearchiveerd") };
    if (startDay < Config.minDay or startDay > Config.maxDay) { return #err("Onmogelijke startdatum") };
    let current = Plan.tasksOf(plan, workId);
    if (current.size() > 0 and not append) { return #err("Deze werf heeft al taken: kies \"toevoegen achteraan\"") };
    if (current.size() + tpl.steps.size() > Config.maxTasksPerWork) { return #err("Te veel taken op deze werf") };
    let known = Oa.trades(settings, false);
    let cal = Plan.calFor(plan, works, workId);
    let start = Plan.nextWorkday(cal, startDay);
    let now = Time.now();
    var order = current.foldLeft(0, func(m : Nat, t : Types.Task) : Nat = Nat.max(m, t.order));
    let byKey = Map.empty<Text, Nat>();
    let created = Map.empty<Nat, ()>();
    for (s in tpl.steps.values()) {
      let id = Ids.next(ctr, "task");
      order += 1;
      // Een vakgebied dat intussen gearchiveerd is, valt weg (de admin ziet het in het sjabloon).
      let trade = switch (s.trade) { case (?k) { if (known.any(func x = x.key == k)) ?k else null }; case null null };
      plan.tasks.add(id, { id; workId; title = s.title; note = s.note; kind = s.kind; templateKey = ?s.key; trade; responsibleOrgId = null; status = #planned; percent = 0; start; workdays = s.workdays; leadDays = s.leadDays; orderDay = null; actualStart = null; actualEnd = null; order; quoteLineIds = []; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [] });
      byKey.add(s.key, id);
      created.add(id, ());
    };
    var nDeps = 0;
    for (s in tpl.steps.values()) {
      switch (byKey.get(s.key)) {
        case (?to) {
          // De wachttijd geldt na de EERSTE stap in "wacht op" (droogtijd chape), niet na de andere.
          var first = true;
          for (a in s.after.values()) {
            let lag = if first s.lagDays else 0;
            first := false;
            switch (byKey.get(a)) {
              case (?from) {
                let id = Ids.next(ctr, "dependency");
                plan.dependencies.add(id, { id; workId; fromTaskId = from; toTaskId = to; kind = #finishToStart; lagDays = lag; createdAt = now; createdBy = p.id; archivedAt = null });
                nDeps += 1;
              };
              case null {};
            };
          };
        };
        case null {};
      };
    };
    // Data volgens de afhankelijkheden en de kalender; enkel de nieuwe taken schuiven.
    switch (Plan.schedule(cal, Plan.tasksOf(plan, workId), Plan.depsOf(plan, workId), #reflow, func t = created.containsKey(t.id))) {
      case (#ok shifts) {
        for (s in shifts.values()) {
          switch (plan.tasks.get(s.taskId)) { case (?t) { plan.tasks.add(t.id, { t with start = s.toStart; workdays = s.toWorkdays }) }; case null {} };
        };
      };
      case (#err e) { Runtime.trap(e) }; // kan niet: het sjabloon is kringvrij nagekeken
    };
    for (id in created.keys()) {
      switch (plan.tasks.get(id)) { case (?t) plChange(t, p.id, "taak", "", t.title, "uit sjabloon «" # tpl.name # "»"); case null {} };
    };
    let v = plBump(workId);
    Access.audit(audit, caller, ?p.id, ?workId, "planning-sjabloon", plWorkCode(workId) # ": «" # tpl.name # "» vanaf " # Plan.fmtDay(start) # ", " # tpl.steps.size().toText() # " taken, " # nDeps.toText() # " afhankelijkheden");
    #ok({ version = v; changes = []; reopened = 0; taskId = null });
  };

  // ── Wat schoof en waarom (interne rollen) ────────────────────────────────
  public query ({ caller }) func taskHistory(workId : Nat, taskId : ?Nat, from : Nat, limit : Nat) : async [Views.TaskChangeView] {
    let p = Access.requireActive(access, caller);
    if (Rights.planScope({ works; settings }, p, workId) != #full) { Runtime.trap("Geen toegang") };
    let all = plan.taskChanges.values().filter(func c = c.workId == workId and (switch taskId { case (?x) c.taskId == x; case null true })).toArray();
    let newest = Array.reverse(all); // ids stijgen met de tijd
    Access.page(newest, from, limit).map(
      func(c : Types.TaskChange) : Views.TaskChangeView = { id = c.id; taskId = c.taskId; taskTitle = plTitleRaw(c.taskId); at = c.at; by = c.by; byName = Access.personName(access, c.by); field = c.field; from = c.from; to = c.to; reason = c.reason }
    );
  };

  // ── Hulp (namen met pl-voorvoegsel: de mixins delen één naamruimte) ──────
  func plVersion(w : Nat) : Nat { switch (plan.versions.get(w)) { case (?v) v; case null 0 } };

  func plStale(w : Nat, expected : Nat) : ?Text {
    if (plVersion(w) != expected) ?"De planning is intussen gewijzigd: vernieuw en probeer opnieuw" else null;
  };

  func plBump(w : Nat) : Nat {
    let v = plVersion(w) + 1;
    plan.versions.add(w, v);
    v;
  };

  func plWorkCode(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.code; case null "#" # w.toText() } };

  func plTitleRaw(id : Nat) : Text { switch (plan.tasks.get(id)) { case (?t) t.title; case null "#" # id.toText() } };
  func plTitle(id : Nat) : Text { "«" # plTitleRaw(id) # "»" };

  func plOrgName(id : Nat) : Text { switch (org.orgs.get(id)) { case (?o) o.name; case null "#" # id.toText() } };
  func plOrgCode(id : Nat) : ?Text { switch (org.orgs.get(id)) { case (?o) { if (o.aliases.size() > 0) ?o.aliases[0] else null }; case null null } };
  func plOrgText(o : ?Nat) : Text { switch o { case (?x) plOrgName(x); case null "" } };
  func plOptText(t : ?Text) : Text { switch t { case (?x) x; case null "" } };
  func plOptDay(d : ?Nat) : Text { switch d { case (?x) Plan.fmtDay(x); case null "" } };

  func plConfText(c : Types.Confirmation) : Text {
    switch c {
      case (#open) "open";
      case (#confirmed x) "bevestigd door " # Access.personName(access, x.by);
      case (#declined x) "geweigerd door " # Access.personName(access, x.by);
    };
  };

  // Een TaskChange (append-only); enkel als er echt iets veranderde.
  func plChange(t : Types.Task, by : Nat, field : Text, from : Text, to : Text, reason : Text) {
    if (from == to) { return };
    let id = Ids.next(ctr, "taskChange");
    plan.taskChanges.add(id, { id; taskId = t.id; workId = t.workId; at = Time.now(); by; field; from; to; reason });
  };

  func plChange2(taskId : Nat, by : Nat, field : Text, from : Text, to : Text, reason : Text) {
    switch (plan.tasks.get(taskId)) { case (?t) plChange(t, by, field, from, to, reason); case null {} };
  };

  func plDepError(workId : Nat, i : Views.DependencyInput) : ?Text {
    let tasks = Plan.tasksOf(plan, workId);
    if (not tasks.any(func t = t.id == i.fromTaskId) or not tasks.any(func t = t.id == i.toTaskId)) { return ?"Onbekende taak" };
    if (Int.abs(i.lagDays) > Int.abs(Config.maxLag)) { return ?("Wachttijd: hoogstens " # Config.maxLag.toText() # " werkdagen") };
    let deps = Plan.depsOf(plan, workId);
    if (deps.size() >= Config.maxDepsPerWork) { return ?"Te veel afhankelijkheden op deze werf" };
    if (deps.any(func d = d.fromTaskId == i.fromTaskId and d.toTaskId == i.toTaskId)) { return ?"Deze afhankelijkheid bestaat al" };
    if (Plan.wouldCycle(deps, i.fromTaskId, i.toTaskId)) { return ?"Dat maakt een kring: de taak wacht dan op zichzelf" };
    null;
  };

  func plInputError(i : Views.TaskInput) : ?Text {
    if (i.note.size() > Config.maxNote) { return ?"Notitie te lang" };
    if (i.percent > 100) { return ?"Voortgang: 0 tot 100 %" };
    if (i.kind == #work and (i.workdays == 0 or i.workdays > Config.maxWorkdays)) { return ?("Duur: 1 tot " # Config.maxWorkdays.toText() # " werkdagen") };
    if (i.kind != #work and i.workdays != 0) { return ?"Een mijlpaal of levering duurt 0 dagen" };
    if (i.kind != #delivery and (i.leadDays != 0 or i.orderDay != null)) { return ?"Levertermijn en besteldatum horen bij een levering" };
    if (i.leadDays > Config.maxLeadDays) { return ?("Levertermijn: hoogstens " # Config.maxLeadDays.toText() # " dagen") };
    if (i.start < Config.minDay or i.start > Config.maxDay) { return ?"Onmogelijke startdatum" };
    switch (i.orderDay) { case (?o) { if (o < Config.minDay or o > Config.maxDay) { return ?"Onmogelijke besteldatum" } }; case null {} };
    switch (i.trade) {
      case (?k) { if (not Oa.trades(settings, false).any(func x = x.key == k)) { return ?"Onbekend vakgebied" } };
      case null {};
    };
    plOrgError(i.responsibleOrgId);
  };

  // Een uitvoerder is een bestaande, niet-gearchiveerde organisatie (OA, leverancier, BOWACO zelf, …).
  func plOrgError(o : ?Nat) : ?Text {
    switch o {
      case (?x) {
        let rec = org.orgs.get(x) ?? return ?"Onbekende firma";
        if (rec.archivedAt != null) { return ?"Deze firma is gearchiveerd" };
        null;
      };
      case null null;
    };
  };

  func plAssignmentsOf(workId : Nat) : [Types.Assignment] {
    plan.assignments.values().filter(func a = a.workId == workId and a.archivedAt == null).toArray();
  };

  func plOwnTask(t : Types.Task, assigns : [Types.Assignment], myOrg : ?Nat) : Bool {
    switch myOrg {
      case (?o) t.responsibleOrgId == ?o or assigns.any(func a = a.taskId == t.id and a.orgId == o);
      case null false;
    };
  };

  // De verantwoordelijke van een taak = de eerste uitvoerder. Andere firma → de oude toewijzing gaat weg
  // (gearchiveerd) en de nieuwe begint open.
  func plSyncPrimary(t : Types.Task, before : ?Nat, by : Nat) {
    let now = Time.now();
    let current = plAssignmentsOf(t.workId).filter(func a = a.taskId == t.id and a.primary);
    for (a in current.values()) {
      if (?a.orgId != t.responsibleOrgId) { plan.assignments.add(a.id, { a with archivedAt = ?now; updatedAt = now }) };
    };
    switch (t.responsibleOrgId) {
      case (?o) {
        if (not current.any(func a = a.orgId == o)) {
          let id = Ids.next(ctr, "assignment");
          plan.assignments.add(id, { id; taskId = t.id; workId = t.workId; orgId = o; personId = null; fromDay = null; toDay = null; note = ""; primary = true; confirmation = #open; createdAt = now; createdBy = by; updatedAt = now; archivedAt = null; extra = [] });
          plNotifyNew(by, o, t);
        };
      };
      case null {};
    };
    ignore before;
  };

  // Hoeveel bevestigingen (of weigeringen) gaan terug open door deze verschuivingen?
  func plReopenCount(shifts : [Plan.Shift]) : Nat {
    var n = 0;
    for (s in shifts.values()) {
      for (a in plan.assignments.values()) {
        if (a.taskId == s.taskId and a.archivedAt == null and a.confirmation != #open) { n += 1 };
      };
    };
    n;
  };

  // Verschuivingen bewaren: nieuwe dagen, een TaskChange per veld, eigen bereiken van uitvoerders mee,
  // bevestigingen terug open (een verschoven taak moet de OA opnieuw bevestigen).
  func plApplyShifts(p : Types.Person, cal : Plan.Cal, shifts : [Plan.Shift], reason : Text) : Nat {
    let now = Time.now();
    var reopened = 0;
    // 1.7: wat schoof per firma (voor één melding per firma en werf, niet per taak).
    let moved = Map.empty<Text, (Nat, Nat, List.List<Text>)>();
    for (s in shifts.values()) {
      switch (plan.tasks.get(s.taskId)) {
        case (?t) {
          plan.tasks.add(t.id, { t with start = s.toStart; workdays = s.toWorkdays; updatedAt = now; updatedBy = p.id });
          let why = if (reason == "") s.reason else s.reason # " · " # reason;
          plChange(t, p.id, "start", Plan.fmtDay(s.fromStart), Plan.fmtDay(s.toStart), why);
          plChange(t, p.id, "duur", s.fromWorkdays.toText() # " d", s.toWorkdays.toText() # " d", why);
          let delta : Int = s.toStart - s.fromStart;
          for (a in plan.assignments.values()) {
            if (a.taskId == t.id and a.archivedAt == null) {
              let shift = func(d : ?Nat) : ?Nat { switch d { case (?x) ?Int.abs(Int.max(0, x + delta)); case null null } };
              let reopen = a.confirmation != #open;
              if (reopen) {
                reopened += 1;
                plChange(t, p.id, "bevestiging", plConfText(a.confirmation), "open", "verschoven");
              };
              plan.assignments.add(a.id, { a with fromDay = shift(a.fromDay); toDay = shift(a.toDay); confirmation = #open; updatedAt = now });
              let key = a.orgId.toText() # ":" # t.workId.toText();
              let l = switch (moved.get(key)) { case (?(_, _, l)) l; case null { let l = List.empty<Text>(); moved.add(key, (a.orgId, t.workId, l)); l } };
              let line = "«" # t.title # "» → " # Plan.fmtDay(s.toStart);
              if (not l.contains(Text.equal, line)) { l.add(line) };
            };
          };
        };
        case null {};
      };
    };
    for ((_, (o, w, l)) in moved.entries()) {
      let first = l.sliceToArray(0, Nat.min(3, l.size()));
      let more = if (l.size() > 3) " (+" # (l.size() - 3 : Nat).toText() # ")" else "";
      Access.notifyOrgOnWork(access, { works; settings }, audit, ctr, o, w, ?#confirmPlanning, p.id, "planning-verschoven", "De planning van " # plWorkCode(w) # " schoof: " # Text.join(first.values(), " · ") # more # ". Bevestig opnieuw in Mijn week.");
    };
    ignore cal;
    reopened;
  };

  // 1.7: een firma krijgt een (nieuwe) taak op een werf: melding aan haar OA-personen op die werf.
  func plNotifyNew(by : Nat, orgId : Nat, t : Types.Task) {
    Access.notifyOrgOnWork(access, { works; settings }, audit, ctr, orgId, t.workId, null, by, "planning-nieuw", "Nieuwe taak voor jou op " # plWorkCode(t.workId) # ": «" # t.title # "» vanaf " # Plan.fmtDay(t.start) # ".");
  };

  // Alle taken die (rechtstreeks of verder in de keten) op `start` wachten, `start` inbegrepen.
  func plChainFrom(deps : [Types.Dependency], start : Nat) : Map.Map<Nat, ()> {
    let seen = Map.singleton<Nat, ()>(start, ());
    let queue = List.singleton<Nat>(start);
    var i = 0;
    while (i < queue.size()) {
      let x = queue.at(i);
      i += 1;
      for (d in deps.values()) {
        if (d.fromTaskId == x and not seen.containsKey(d.toTaskId)) { seen.add(d.toTaskId, ()); queue.add(d.toTaskId) };
      };
    };
    seen;
  };

  func plLeaders(workId : Nat) : [Nat] {
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

  // Is de firma lid van de werf (als firma, of via een persoon van die firma)? Anders ziet de OA niets.
  func plInTeam(orgId : Nat, workId : Nat) : Bool {
    works.memberships.values().any(
      func m {
        m.workId == workId and m.endedAt == null and m.role == #onderaannemer and (
          m.orgId == ?orgId or (switch (m.personId) { case (?x) { switch (access.persons.get(x)) { case (?q) q.orgId == ?orgId; case null false } }; case null false })
        );
      }
    );
  };

  func plAssignmentView(a : Types.Assignment, start : Nat, end : Nat, teamOf : ?Nat) : Views.AssignmentView {
    {
      id = a.id;
      taskId = a.taskId;
      workId = a.workId;
      orgId = a.orgId;
      orgName = plOrgName(a.orgId);
      orgCode = plOrgCode(a.orgId);
      personId = a.personId;
      personName = switch (a.personId) { case (?x) ?Access.personName(access, x); case null null };
      fromDay = a.fromDay;
      toDay = a.toDay;
      start;
      end;
      note = a.note;
      primary = a.primary;
      confirmation = a.confirmation;
      confirmedByName = switch (a.confirmation) {
        case (#confirmed x) ?Access.personName(access, x.by);
        case (#declined x) ?Access.personName(access, x.by);
        case (#open) null;
      };
      inTeam = switch teamOf { case (?w) plInTeam(a.orgId, w); case null true };
    };
  };

  func plTaskView(cal : Plan.Cal, t : Types.Task, scope : Rights.PlanScope, myOrg : ?Nat, assigns : [Types.Assignment], deps : [Types.Dependency], byId : Map.Map<Nat, Types.Task>) : Views.TaskView {
    let end = Plan.endDay(cal, t.start, t.workdays);
    let mine = assigns.filter(func a = a.taskId == t.id and (switch scope { case (#ownOrg) ?a.orgId == myOrg; case (#summary) false; case _ true }));
    let showResp = switch scope { case (#full or #external) true; case (#ownOrg) t.responsibleOrgId == myOrg; case _ false };
    let internal = scope == #full;
    {
      id = t.id;
      workId = t.workId;
      title = t.title;
      note = if internal t.note else "";
      kind = t.kind;
      templateKey = t.templateKey;
      trade = t.trade;
      responsibleOrgId = if showResp t.responsibleOrgId else null;
      responsibleName = if showResp plOrgText(t.responsibleOrgId) else "";
      status = t.status;
      percent = t.percent;
      actualStart = t.actualStart; // 1.6: uit het werfverslag
      actualEnd = t.actualEnd;
      start = t.start;
      end;
      workdays = t.workdays;
      leadDays = t.leadDays;
      orderDay = t.orderDay;
      orderBy = switch (t.kind, t.orderDay) {
        case (#delivery, null) { if (t.start >= t.leadDays) ?(t.start - t.leadDays : Nat) else ?0 };
        case _ null;
      };
      order = t.order;
      assignments = mine.map(func a { let (s, e) = Plan.assignmentDays(a, t.start, end); plAssignmentView(a, s, e, if internal ?t.workId else null) });
      warnings = if (scope == #summary or scope == #ownOrg) [] else Plan.warnings(cal, t, deps.filter(func d = d.toTaskId == t.id), byId);
      updatedAt = t.updatedAt;
      updatedByName = if internal Access.personName(access, t.updatedBy) else "";
      quoteLineIds = if internal t.quoteLineIds else [];
    };
  };

  func plShiftView(cal : Plan.Cal, s : Plan.Shift) : Views.ShiftView {
    {
      taskId = s.taskId;
      title = plTitleRaw(s.taskId);
      fromStart = s.fromStart;
      fromEnd = Plan.endDay(cal, s.fromStart, s.fromWorkdays);
      toStart = s.toStart;
      toEnd = Plan.endDay(cal, s.toStart, s.toWorkdays);
      workdays = s.toWorkdays;
      reason = s.reason;
    };
  };

  // 1.9: een externe (architect, OA, klant, VC) ziet van een blok de periode en het soort; de reden van een STOP op
  // een werf ("wacht op betaling") en wie hem zette, zijn kantoorgegevens. Bedrijfsblokken (bouwverlof) tonen hun reden.
  func plBlockView(b : Types.CalendarBlock, full : Bool) : Views.BlockView {
    let open = full or b.scope == #company;
    { id = b.id; scope = b.scope; kind = b.kind; from = b.from; to = b.to; reason = if open b.reason else ""; createdByName = if full Access.personName(access, b.createdBy) else "" };
  };

  func plBlockRight(p : Types.Person, scope : Types.BlockScope) {
    let ctx = { works; settings };
    switch scope {
      case (#company) Rights.require(ctx, p, #manageCompanyCalendar, null);
      case (#work w) Rights.require(ctx, p, #editPlanning, ?w);
      case (#org _) Runtime.trap("Geen toegang: verlof van een firma is een afwezigheid: zet ze op het weekbord");
    };
  };

  func plBlockBump(scope : Types.BlockScope) {
    switch scope { case (#work w) { ignore plBump(w) }; case _ {} };
  };

  func plScopeWork(scope : Types.BlockScope) : ?Nat { switch scope { case (#work w) ?w; case _ null } };

  func plScopeText(scope : Types.BlockScope) : Text {
    switch scope { case (#company) "bedrijf"; case (#work w) plWorkCode(w); case (#org o) plOrgName(o) };
  };
};
