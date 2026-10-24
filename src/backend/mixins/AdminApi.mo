// Instellingen, robots, auditlog, meldingen en export (R17, R18, §3 export).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Rights "../lib/Rights";
import Dossier "../lib/Dossier";
import Oa "../lib/Oa";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  files : Types.FileState,
  dossier : Types.DossierState,
  oa : Types.OaState,
  plan : Types.PlanState,
  board : Types.BoardState,
  imp : Types.ImportState,
  reports : Types.ReportState,
  permits : Types.PermitState,
  post : Types.PostState,
  robot : Types.RobotState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Instellingen ─────────────────────────────────────────────────────────
  public query ({ caller }) func getSettings() : async Views.SettingsView {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readTeam, null);
    settingsView();
  };

  func settingsView() : Views.SettingsView {
    {
      werfleiderZietAlles = settings.werfleiderZietAlles;
      inviteDays = settings.inviteDays;
      threshold30bisCents = Dossier.threshold30bis(settings);
      thresholdCheckinatworkCents = Dossier.thresholdCheckinatwork(settings);
    };
  };

  public shared ({ caller }) func setSettings(s : Views.SettingsView) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (s.inviteDays == 0 or s.inviteDays > Config.inviteDaysMax) { return #err("Geldigheid: 1 tot " # Config.inviteDaysMax.toText() # " dagen") };
    if (s.threshold30bisCents == 0 or s.thresholdCheckinatworkCents == 0 or s.threshold30bisCents > 10_000_000_000 or s.thresholdCheckinatworkCents > 10_000_000_000) {
      return #err("Drempels: tussen € 0,01 en € 100 miljoen");
    };
    let before = settingsView();
    settings.werfleiderZietAlles := s.werfleiderZietAlles;
    settings.inviteDays := s.inviteDays;
    settings.values.add("drempel30bis", s.threshold30bisCents.toText());
    settings.values.add("drempelCheckinatwork", s.thresholdCheckinatworkCents.toText());
    Access.audit(audit, caller, ?p.id, null, "instellingen", "werfleider ziet alles " # debug_show (before.werfleiderZietAlles) # " → " # debug_show (s.werfleiderZietAlles) # "; codes " # before.inviteDays.toText() # " → " # s.inviteDays.toText() # " dagen" # (if (before.threshold30bisCents != s.threshold30bisCents or before.thresholdCheckinatworkCents != s.thresholdCheckinatworkCents) "; drempels 30bis/Checkinatwork gewijzigd" else ""));
    #ok;
  };

  // ── Robots (R28; 0.2 open punt 5): de admin beheert de robotprincipals ───
  public query ({ caller }) func listRobots() : async [Views.RobotView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageRobots, null);
    robot.robots.values().map(robotView).toArray();
  };

  public shared ({ caller }) func addRobot(principal : Principal, name : Text, kinds : [Text]) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageRobots, null);
    if (principal.isAnonymous()) { return #err("Ongeldige principal") };
    if (access.links.containsKey(principal)) { return #err("Deze principal is een persoon") };
    let n = Access.cleanText(name, Config.maxName) ?? return #err("Naam ontbreekt");
    if (kinds.size() > 10) { return #err("Te veel soorten") };
    // 1b.3: enkel gekende soorten (R28: een robot krijgt nooit meer dan nodig).
    if (not kinds.all(func k = Config.robotKinds().any(func x = x == k))) { return #err("Onbekende soort: kies uit " # Config.robotKinds().values().join(", ")) };
    switch (robot.robots.get(principal)) {
      case (?r) { if (r.revokedAt == null) { return #err("Robot bestaat al") } };
      case null {};
    };
    let r : Types.Robot = { principal; name = n; kinds; addedAt = Time.now(); addedBy = p.id; var revokedAt = null; var revokedBy = null };
    robot.robots.add(principal, r);
    Access.audit(audit, caller, ?p.id, null, "robot-toegevoegd", n # " " # principal.toText());
    #ok;
  };

  public shared ({ caller }) func revokeRobot(principal : Principal) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageRobots, null);
    let r = robot.robots.get(principal) ?? return #err("Onbekende robot");
    if (r.revokedAt != null) { return #err("Al ingetrokken") };
    r.revokedAt := ?Time.now();
    r.revokedBy := ?p.id;
    Access.audit(audit, caller, ?p.id, null, "robot-ingetrokken", r.name # " " # principal.toText());
    #ok;
  };

  // ── Auditlog ─────────────────────────────────────────────────────────────
  // Nieuwste eerst. Admin ziet alles; anderen enkel hun eigen regels (R17).
  public query ({ caller }) func auditLog(from : Nat, limit : Nat) : async [Types.AuditEntry] {
    let p = Access.requireActive(access, caller);
    let all = Rights.may({ works; settings }, p, #readAudit, null);
    let lim = if (limit == 0 or limit > Config.maxListPage) Config.maxListPage else limit;
    let out = List.empty<Types.AuditEntry>();
    var skipped = 0;
    label scan for (e in audit.log.reverseValues()) {
      if (all or e.personId == ?p.id) {
        if (skipped < from) { skipped += 1 } else {
          out.add(e);
          if (out.size() >= lim) { break scan };
        };
      };
    };
    out.toArray();
  };

  public query ({ caller }) func auditCount() : async Nat {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readAudit, null);
    audit.log.size();
  };

  // ── Meldingen (R18: iedereen leest alleen zijn eigen) ───────────────────
  public query ({ caller }) func myNotifications(unreadOnly : Bool) : async [Views.NotificationView] {
    let p = Access.requireActive(access, caller);
    let out = List.empty<Views.NotificationView>();
    label scan for ((_, n) in audit.notifications.reverseEntries()) {
      if (n.personId == p.id and (not unreadOnly or n.readAt == null)) {
        out.add({ id = n.id; kind = n.kind; text = n.text; workId = n.workId; createdAt = n.createdAt; readAt = n.readAt });
        if (out.size() >= 200) { break scan };
      };
    };
    out.toArray();
  };

  public shared ({ caller }) func markNotificationsRead(ids : [Nat]) : async () {
    let p = Access.requireActive(access, caller);
    if (ids.size() > Config.maxNotificationIds) { Runtime.trap("Hoogstens " # Config.maxNotificationIds.toText() # " meldingen per keer") };
    let now = Time.now();
    for (id in ids.values()) {
      switch (audit.notifications.get(id)) {
        case (?n) { if (n.personId == p.id and n.readAt == null) { n.readAt := ?now } };
        case null {};
      };
    };
  };

  // ── Export (back-up): intern en vertrouwelijk apart; de auditlog via auditLog in stukken ──
  // Update-call: zo staat elke export in de auditlog.
  public shared ({ caller }) func exportIntern() : async Views.ExportIntern {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #export, null);
    Access.audit(audit, caller, ?p.id, null, "export-intern", "");
    {
      version = Config.version;
      schema = Config.schema;
      at = Time.now();
      persons = access.persons.values().map(Access.personView).toArray();
      links = access.links.entries().map(func(pr, l) = Access.linkView(access, pr, l)).toArray();
      linkHistory = access.linkHistory.values().toArray();
      invites = access.invites.values().map(func i = Access.inviteView(access, i)).toArray();
      orgs = org.orgs.values().map(func o = { id = o.id; kind = o.kind; name = o.name; kbo = o.kbo; vat = o.vat; aliases = o.aliases; trades = o.trades; address = o.address; notes = o.notes; createdAt = o.createdAt; createdBy = o.createdBy; archivedAt = o.archivedAt }).toArray();
      works = works.works.values().map(func w = Dossier.workView({ works; settings }, dossier, p, w)).toArray();
      memberships = works.memberships.values().map(func m = { id = m.id; workId = m.workId; personId = m.personId; orgId = m.orgId; name = ""; archived = false; role = m.role; grants = m.grants; grantedAt = m.grantedAt; grantedBy = m.grantedBy; endedAt = m.endedAt; endedBy = m.endedBy }).toArray();
      files = files.files.values().map(Dossier.fileView).toArray();
      workInfo = dossier.info.values().toArray();
      documents = dossier.documents.values().toArray();
      orgContacts = oa.orgContacts.values().toArray();
      personContacts = oa.personContacts.values().toArray();
      trades = Oa.trades(settings, true);
      tasks = plan.tasks.values().toArray();
      assignments = plan.assignments.values().toArray();
      dependencies = plan.dependencies.values().toArray();
      calendarBlocks = plan.calendarBlocks.values().toArray();
      taskChanges = plan.taskChanges.values().toArray();
      templates = plan.templates.values().toArray();
      absences = board.absences.values().toArray();
      absenceChanges = board.absenceChanges.values().toArray();
      capacity = board.capacity.values().toArray();
      importBatches = imp.batches.values().toArray();
      importKeys = imp.keys.values().toArray();
      appointments = imp.appointments.values().toArray();
      vehicles = org.vehicles.values().map(func(v : Types.Vehicle) : Views.VehicleView = { id = v.id; plate = v.plate; name = v.name; archived = v.archivedAt != null }).toArray();
      dayReports = reports.reports.values().toArray();
      reportChanges = reports.changes.values().toArray();
      attendances = reports.attendances.values().toArray();
      hoursConfirmations = reports.confirmations.values().flatMap(func(cs : [Types.HoursConfirmation]) : Iter.Iter<Types.HoursConfirmation> = cs.values()).toArray();
      workDone = reports.workDone.values().toArray();
      materials = reports.materials.values().toArray();
      photos = reports.photos.values().toArray();
      issues = reports.issues.values().toArray();
      trips = reports.trips.values().toArray();
      robots = robot.robots.values().map(robotView).toArray();
      proposals = robot.proposals.values().map(func x = { id = x.id; ticketId = x.ticketId; personId = x.personId; workId = x.workId; kind = x.kind; content = x.content; by = x.by; at = x.at; decision = x.decision }).toArray();
      settings = settingsView();
      auditCount = audit.log.size();
      // 1.9 (hersteltest M9)
      notifications = audit.notifications.values().map(func(n : Types.Notification) : Views.NotificationExport = { id = n.id; personId = n.personId; kind = n.kind; text = n.text; workId = n.workId; createdAt = n.createdAt; readAt = n.readAt }).toArray();
      lookups = settings.lookups.values().map(func(l : Types.Lookup) : Views.LookupView = { list = l.list; key = l.key; tag = l.tag; order = l.order; archivedAt = l.archivedAt; extra = l.extra }).toArray();
      values = settings.values.entries().toArray();
      sequences = settings.sequences.entries().toArray();
      counters = ctr.entries().toArray();
      planVersions = plan.versions.entries().toArray();
      reportKeys = reports.keys.entries().toArray();
      ops = reports.ops.values().toArray();
      permits = permits.permits.values().toArray();
      permitChanges = permits.changes.values().toArray();
      municipalities = permits.municipalities.values().toArray();
      procedures = permits.procedures.values().toArray();
      permitAlerts = permits.alerts.entries().toArray();
      jobs = post.jobs.values().toArray();
    };
  };

  // 1.9 (O-11): dezelfde export in stukken, per collectie, zodat de back-up (tests/herstel.mjs) nooit op de
  // berichtgrens van het IC botst (één exportIntern wordt bij ± 100 werven groter dan 2 MiB). Zelfde rechten:
  // admin; de vertrouwelijke collecties vragen ook #readConfidentialContact en worden als "bekeek" gelogd.
  // Eén auditregel per collectie (bij het eerste stuk), niet per stuk.
  public shared ({ caller }) func exportChunk(kind : Text, from : Nat, limit : Nat) : async Result.Result<Views.RestorePart, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #export, null);
    let confidentialKind = kind == "orgConfidential" or kind == "personConfidential" or kind == "confidentialFiles" or kind == "workConfidential" or kind == "workConfidentialHistory";
    if (confidentialKind) { Rights.require(ctx, p, #readConfidentialContact, null) };
    if (from == 0) { Access.audit(audit, caller, ?p.id, null, if confidentialKind "bekeek:export-vertrouwelijk-deel" else "export-deel", kind) };
    func pg<T>(xs : [T]) : [T] { Access.page(xs, from, limit) };
    let view = func(c : Types.Confidential<Types.Contact>, n : ?Types.Confidential<Text>, v : Nat) : Views.ContactConfidentialView {
      let contact = switch c { case (#plain x) ?x; case (#sealed _) null };
      let notes = switch n { case (?#plain x) ?x; case _ null };
      let sealed = (switch c { case (#sealed _) true; case _ false }) or (switch n { case (?#sealed _) true; case _ false });
      { contact; notes; version = v; sealed };
    };
    let part : ?Views.RestorePart = switch kind {
      case "persons" ?#persons(pg(access.persons.values().map(Access.personView).toArray()));
      case "links" ?#links(pg(access.links.entries().map(func(pr, l) = Access.linkView(access, pr, l)).toArray()));
      case "linkHistory" ?#linkHistory(pg(access.linkHistory.values().toArray()));
      case "invites" ?#invites(pg(access.invites.values().map(func i = Access.inviteView(access, i)).toArray()));
      case "orgs" ?#orgs(pg(org.orgs.values().map(Oa.orgView).toArray()));
      case "works" ?#works(pg(works.works.values().map(func w = Dossier.workView(ctx, dossier, p, w)).toArray()));
      case "memberships" ?#memberships(pg(works.memberships.values().map(func m = { id = m.id; workId = m.workId; personId = m.personId; orgId = m.orgId; name = ""; archived = false; role = m.role; grants = m.grants; grantedAt = m.grantedAt; grantedBy = m.grantedBy; endedAt = m.endedAt; endedBy = m.endedBy }).toArray()));
      case "files" ?#files(pg(files.files.values().map(Dossier.fileView).toArray()));
      case "confidentialFiles" ?#files(pg(files.files.values().filter(func f = f.confidential).map(func f = { Dossier.fileView(f) with blob = ?f.blob }).toArray()));
      case "workInfo" ?#workInfo(pg(dossier.info.values().toArray()));
      case "documents" ?#documents(pg(dossier.documents.values().toArray()));
      case "orgContacts" ?#orgContacts(pg(oa.orgContacts.values().toArray()));
      case "personContacts" ?#personContacts(pg(oa.personContacts.values().toArray()));
      case "lookups" ?#lookups(pg(settings.lookups.values().map(func(l : Types.Lookup) : Views.LookupView = { list = l.list; key = l.key; tag = l.tag; order = l.order; archivedAt = l.archivedAt; extra = l.extra }).toArray()));
      case "values" ?#values(pg(settings.values.entries().toArray()));
      case "sequences" ?#sequences(pg(settings.sequences.entries().toArray()));
      case "settings" ?#settings(settingsView());
      case "tasks" ?#tasks(pg(plan.tasks.values().toArray()));
      case "assignments" ?#assignments(pg(plan.assignments.values().toArray()));
      case "dependencies" ?#dependencies(pg(plan.dependencies.values().toArray()));
      case "calendarBlocks" ?#calendarBlocks(pg(plan.calendarBlocks.values().toArray()));
      case "taskChanges" ?#taskChanges(pg(plan.taskChanges.values().toArray()));
      case "templates" ?#templates(pg(plan.templates.values().toArray()));
      case "planVersions" ?#planVersions(pg(plan.versions.entries().toArray()));
      case "absences" ?#absences(pg(board.absences.values().toArray()));
      case "absenceChanges" ?#absenceChanges(pg(board.absenceChanges.values().toArray()));
      case "capacity" ?#capacity(pg(board.capacity.values().toArray()));
      case "importBatches" ?#importBatches(pg(imp.batches.values().toArray()));
      case "importKeys" ?#importKeys(pg(imp.keys.values().toArray()));
      case "appointments" ?#appointments(pg(imp.appointments.values().toArray()));
      case "vehicles" ?#vehicles(pg(org.vehicles.values().map(func(v : Types.Vehicle) : Views.VehicleView = { id = v.id; plate = v.plate; name = v.name; archived = v.archivedAt != null }).toArray()));
      case "dayReports" ?#dayReports(pg(reports.reports.values().toArray()));
      case "reportKeys" ?#reportKeys(pg(reports.keys.entries().toArray()));
      case "reportChanges" ?#reportChanges(pg(reports.changes.values().toArray()));
      case "attendances" ?#attendances(pg(reports.attendances.values().toArray()));
      case "hoursConfirmations" ?#hoursConfirmations(pg(reports.confirmations.values().flatMap(func(cs : [Types.HoursConfirmation]) : Iter.Iter<Types.HoursConfirmation> = cs.values()).toArray()));
      case "workDone" ?#workDone(pg(reports.workDone.values().toArray()));
      case "materials" ?#materials(pg(reports.materials.values().toArray()));
      case "photos" ?#photos(pg(reports.photos.values().toArray()));
      case "issues" ?#issues(pg(reports.issues.values().toArray()));
      case "trips" ?#trips(pg(reports.trips.values().toArray()));
      case "ops" ?#ops(pg(reports.ops.values().toArray()));
      case "robots" ?#robots(pg(robot.robots.values().map(robotView).toArray()));
      case "proposals" ?#proposals(pg(robot.proposals.values().map(func x = { id = x.id; ticketId = x.ticketId; personId = x.personId; workId = x.workId; kind = x.kind; content = x.content; by = x.by; at = x.at; decision = x.decision }).toArray()));
      case "notifications" ?#notifications(pg(audit.notifications.values().map(func(n : Types.Notification) : Views.NotificationExport = { id = n.id; personId = n.personId; kind = n.kind; text = n.text; workId = n.workId; createdAt = n.createdAt; readAt = n.readAt }).toArray()));
      case "counters" ?#counters(pg(ctr.entries().toArray()));
      case "orgConfidential" ?#orgConfidential(pg(org.orgConfidential.values().map(func c = (c.orgId, view(c.contact, ?c.notes, c.version))).toArray()));
      case "personConfidential" ?#personConfidential(pg(access.personConfidential.values().map(func c = (c.personId, view(c.contact, null, c.version))).toArray()));
      case "workConfidential" ?#workConfidential(pg(dossier.confidential.values().toArray()));
      case "workConfidentialHistory" ?#workConfidentialHistory(pg(dossier.confidentialHistory.values().toArray()));
      case "permits" ?#permits(pg(permits.permits.values().toArray()));
      case "permitChanges" ?#permitChanges(pg(permits.changes.values().toArray()));
      case "municipalities" ?#municipalities(pg(permits.municipalities.values().toArray()));
      case "procedures" ?#procedures(pg(permits.procedures.values().toArray()));
      case "permitAlerts" ?#permitAlerts(pg(permits.alerts.entries().toArray()));
      case "jobs" ?#jobs(pg(post.jobs.values().toArray()));
      case _ null;
    };
    switch part { case (?x) #ok(x); case null #err("Onbekende collectie: " # kind) };
  };

  public shared ({ caller }) func exportConfidential() : async Views.ExportConfidential {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #export, null);
    Rights.require({ works; settings }, p, #readConfidentialContact, null);
    Access.audit(audit, caller, ?p.id, null, "bekeek:export-vertrouwelijk", "");
    let view = func(c : Types.Confidential<Types.Contact>, n : ?Types.Confidential<Text>, v : Nat) : Views.ContactConfidentialView {
      let contact = switch c { case (#plain x) ?x; case (#sealed _) null };
      let notes = switch n { case (?#plain x) ?x; case _ null };
      let sealed = (switch c { case (#sealed _) true; case _ false }) or (switch n { case (?#sealed _) true; case _ false });
      { contact; notes; version = v; sealed };
    };
    {
      at = Time.now();
      orgs = org.orgConfidential.values().map(func c = (c.orgId, view(c.contact, ?c.notes, c.version))).toArray();
      persons = access.personConfidential.values().map(func c = (c.personId, view(c.contact, null, c.version))).toArray();
      files = files.files.values().filter(func f = f.confidential).map(func f = { id = f.id; name = f.name; mime = f.mime; size = f.size; blob = ?f.blob; workId = f.workId; confidential = true; personId = f.personId; at = f.at; archivedAt = f.archivedAt }).toArray();
      workConfidential = dossier.confidential.values().toArray();
      workConfidentialHistory = dossier.confidentialHistory.values().toArray();
    };
  };

  func robotView(r : Types.Robot) : Views.RobotView {
    { principal = r.principal; name = r.name; kinds = r.kinds; addedAt = r.addedAt; addedBy = r.addedBy; revokedAt = r.revokedAt };
  };
};
