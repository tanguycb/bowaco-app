// Werfverslag op de gsm (stap 1.6, bouwplan rij 1.6 en §8.3, architectuur §2.6 en §8): het verslag is een set
// blokken (wie was er, wat is er gedaan, foto's, materialen en bonnen, problemen en vertraging, ritten). De gsm
// stuurt kleine opdrachten met een opId en de clientKey van het verslag, ook na uren zonder bereik:
//   • dezelfde opId nog eens = hetzelfde resultaat, nooit een dubbel blok (§8.3);
//   • een tweede toestel op dezelfde werf en dag komt in HETZELFDE verslag (blokken, geen overschrijven, §8.4);
//   • een afgesloten verslag verandert niet meer: wat later binnenkomt, gaat naar een correctieverslag (§8.4).
// Rechten (Rights.mo): schrijven admin en werfleider per werf (R7, #writeReport); afsluiten de auteur, de werfleider
// van de werf of een admin; lezen per rol via reportScope (R8); ritten R14; voertuigen beheert de admin.
// Geen await in deze mixin: elke oproep is één atomische stap (R33 vanzelf voldaan).
import Array "mo:core/Array";
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
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Plan "../lib/Plan";
import Reports "../lib/Reports";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  files : Types.FileState,
  plan : Types.PlanState,
  imp : Types.ImportState,
  reports : Types.ReportState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Schrijven: offline-opdrachten (de wachtrij van de gsm) ──────────────
  // De poort: enkel wie verslagen schrijft (admin, werfleider). Per opdracht de werf (#writeReport); een fout
  // in één opdracht houdt de andere niet tegen (§8.4: de gsm toont ze met de reden en "opnieuw").
  public shared ({ caller }) func reportSync(ops : [Views.ReportOpInput]) : async [Views.OpResult] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #reportWriter, null);
    if (ops.size() > Config.maxOpsPerCall) { Runtime.trap("Hoogstens " # Config.maxOpsPerCall.toText() # " opdrachten per keer") };
    ops.map<Views.ReportOpInput, Views.OpResult>(func i = rpRun(caller, p, i));
  };

  // ── Lezen ───────────────────────────────────────────────────────────────
  // De verslagen van één werf en dag (het origineel en eventuele correcties), naar wat de beller mag zien (R8).
  public query ({ caller }) func getReportDay(workId : Nat, day : Nat) : async [Views.ReportView] {
    let p = Access.requireActive(access, caller);
    let scope = Rights.reportScope({ works; settings }, p, workId);
    if (scope == #none) { Runtime.trap("Geen toegang") };
    let ids = switch (reports.dayIndex.get(Reports.dayKey(workId, day))) { case (?x) x; case null [] };
    ids.filterMap<Nat, Views.ReportView>(func id = switch (reports.reports.get(id)) { case (?r) ?rpView(p, scope, r); case null null });
  };

  public query ({ caller }) func getReport(reportId : Nat) : async Views.ReportView {
    let p = Access.requireActive(access, caller);
    let r = reports.reports.get(reportId) ?? Runtime.trap("Geen toegang");
    let scope = Rights.reportScope({ works; settings }, p, r.workId);
    if (scope == #none) { Runtime.trap("Geen toegang") };
    rpView(p, scope, r);
  };

  // De verslagen van een werf, nieuwste eerst (tijdlijn op de werfpagina). Een OA leest enkel zijn eigen uren
  // (Mijn uren, 1.7), niet de lijst; de klant krijgt de samenvatting.
  public query ({ caller }) func listReports(workId : Nat, offset : Nat, limit : Nat) : async [Views.ReportSummary] {
    let p = Access.requireActive(access, caller);
    let scope = Rights.reportScope({ works; settings }, p, workId);
    if (scope == #none or scope == #ownHours) { Runtime.trap("Geen toegang") };
    let all = List.empty<Types.DayReport>();
    for ((_, r) in reports.reports.reverseEntries()) { if (r.workId == workId) { all.add(r) } };
    let sorted = Array.sort<Types.DayReport>(all.toArray(), func(a, b) = if (a.day == b.day) Nat.compare(b.id, a.id) else Nat.compare(b.day, a.day));
    Access.page(sorted, offset, limit).map<Types.DayReport, Views.ReportSummary>(func r = rpSummary(r, scope));
  };

  // "Vandaag" van de werfleider (bouwplan §8.2/§8.3): de werven met werk vandaag, wie er volgens de planning komt,
  // de taken van de dag en de stand van het verslag. all = false: enkel de werven waar ik werfleider ben.
  public query ({ caller }) func myDay(day : Nat, all : Bool) : async Views.MyDayView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #reportWriter, null);
    if (day < Config.minDay or day > Config.maxDay) { Runtime.trap("Onmogelijke datum") };
    // Eén keer over de taken, toewijzingen, problemen en afspraken (begrensd door de gegevens zelf, T17).
    let tasksBy = Map.empty<Nat, List.List<Types.Task>>();
    for (t in plan.tasks.values()) {
      if (t.archivedAt == null and t.start <= day) {
        let l = switch (tasksBy.get(t.workId)) { case (?l) l; case null { let l = List.empty<Types.Task>(); tasksBy.add(t.workId, l); l } };
        l.add(t);
      };
    };
    let issuesBy = Map.empty<Nat, Nat>();
    for (i in reports.issues.values()) {
      if (i.archivedAt == null and i.status == #open) { issuesBy.add(i.workId, (switch (issuesBy.get(i.workId)) { case (?n) n; case null 0 }) + 1) };
    };
    let apptBy = Map.empty<Nat, List.List<(Text, Text)>>();
    for (a in imp.appointments.values()) {
      if (a.archivedAt == null and a.day == day) {
        let l = switch (apptBy.get(a.workId)) { case (?l) l; case null { let l = List.empty<(Text, Text)>(); apptBy.add(a.workId, l); l } };
        l.add((switch (a.time) { case (?t) t; case null "" }, a.text));
      };
    };
    let out = List.empty<Views.DayWork>();
    let todayTasks = Map.empty<Nat, Types.Task>();
    let shown = List.empty<(Types.Work, Bool, [Views.DayTask])>();
    for (w in works.works.values()) {
      if (w.archivedAt == null and w.status != #cancelled and Rights.may(ctx, p, #writeReport, ?w.id)) {
        let mine = w.leaderPersonId == ?p.id or Rights.member(ctx, p, w.id, ?#werfleider);
        if (all or mine) {
          let cal = Plan.calFor(plan, works, w.id);
          let ts = List.empty<Views.DayTask>();
          switch (tasksBy.get(w.id)) {
            case (?l) {
              for (t in l.values()) {
                let end = Plan.endDay(cal, t.start, t.workdays);
                let covers = switch (t.kind) { case (#delivery) t.start == day; case _ end >= day };
                if (covers) {
                  todayTasks.add(t.id, t);
                  ts.add({ id = t.id; title = t.title; status = t.status; percent = t.percent; kind = t.kind; start = t.start; end; orgCodes = [] });
                };
              };
            };
            case null {};
          };
          let hasReport = reports.dayIndex.containsKey(Reports.dayKey(w.id, day));
          if (ts.size() > 0 or hasReport or (mine and w.status == #running)) {
            shown.add((w, mine, Array.sort<Views.DayTask>(ts.toArray(), func(a, b) = Nat.compare(a.start, b.start))));
          };
        };
      };
    };
    // Wie komt er volgens de planning: de toewijzingen van de taken van vandaag (met hun eigen bereik).
    let plannedBy = Map.empty<Nat, Map.Map<Nat, List.List<Nat>>>();
    let codesBy = Map.empty<Nat, List.List<Text>>();
    for (a in plan.assignments.values()) {
      if (a.archivedAt == null) {
        switch (todayTasks.get(a.taskId)) {
          case (?t) {
            let cal = Plan.calFor(plan, works, t.workId);
            let (s, e) = Plan.assignmentDays(a, t.start, Plan.endDay(cal, t.start, t.workdays));
            if (s <= day and e >= day) {
              let m = switch (plannedBy.get(t.workId)) { case (?m) m; case null { let m = Map.empty<Nat, List.List<Nat>>(); plannedBy.add(t.workId, m); m } };
              let l = switch (m.get(a.orgId)) { case (?l) l; case null { let l = List.empty<Nat>(); m.add(a.orgId, l); l } };
              if (not l.contains(Nat.equal, t.id)) { l.add(t.id) };
              let c = switch (codesBy.get(t.id)) { case (?c) c; case null { let c = List.empty<Text>(); codesBy.add(t.id, c); c } };
              let code = rpOrgCode(?a.orgId);
              if (not c.contains(Text.equal, code)) { c.add(code) };
            };
          };
          case null {};
        };
      };
    };
    let sortedWorks = Array.sort<(Types.Work, Bool, [Views.DayTask])>(
      shown.toArray(),
      func(a, b) = if (a.1 != b.1) (if (a.1) #less else #greater) else Text.compare(a.0.code, b.0.code),
    );
    for ((w, mine, ts) in sortedWorks.values()) {
      if (out.size() < Config.myDayMaxWorks) {
        let planned = switch (plannedBy.get(w.id)) {
          case (?m) m.entries().map<(Nat, List.List<Nat>), Views.PlannedOrg>(func(o, l) = { orgId = o; name = rpOrgName(?o); code = rpOrgCode(?o); taskIds = l.toArray() }).toArray();
          case null [];
        };
        let reps = switch (reports.dayIndex.get(Reports.dayKey(w.id, day))) {
          case (?ids) ids.filterMap<Nat, Views.ReportSummary>(func id = switch (reports.reports.get(id)) { case (?r) ?rpSummary(r, #full); case null null });
          case null [];
        };
        out.add({
          id = w.id;
          code = w.code;
          name = w.name;
          address = w.address;
          status = w.status;
          leaderName = switch (w.leaderPersonId) { case (?x) Access.personName(access, x); case null "" };
          mine;
          tasks = ts.map<Views.DayTask, Views.DayTask>(func t = { t with orgCodes = switch (codesBy.get(t.id)) { case (?c) c.toArray(); case null [] } });
          planned;
          reports = reps;
          openIssues = switch (issuesBy.get(w.id)) { case (?n) n; case null 0 };
          appointments = switch (apptBy.get(w.id)) { case (?l) l.toArray(); case null [] };
        });
      };
    };
    let orgs = Array.sort<Views.PlannedOrg>(
      org.orgs.values().filter(func o = o.archivedAt == null and (o.kind == #subcontractor or o.kind == #supplier)).map(func(o : Types.Org) : Views.PlannedOrg = { orgId = o.id; name = o.name; code = rpOrgCode(?o.id); taskIds = [] }).toArray(),
      func(a, b) = Text.compare(a.code, b.code),
    );
    {
      day;
      works = out.toArray();
      vehicles = rpVehicles(false);
      drivers = access.persons.values().filter(func q = q.archivedAt == null and q.orgId == null and Rights.internal(q)).map(func(q : Types.Person) : Views.PersonRef = { id = q.id; name = q.name }).toArray();
      orgs;
      writer = true;
    };
  };

  // ── Problemen en vertragingen (Vraagt aandacht, werfpagina) ─────────────
  public query ({ caller }) func listIssues(workId : ?Nat, openOnly : Bool, limit : Nat) : async [Views.IssueView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    switch workId {
      case (?w) Rights.require(ctx, p, #readReports, ?w);
      case null Rights.require(ctx, p, #readTeam, null);
    };
    let lim = if (limit == 0 or limit > Config.maxListPage) Config.maxListPage else limit;
    let out = List.empty<Views.IssueView>();
    label scan for ((_, i) in reports.issues.reverseEntries()) {
      if (i.archivedAt == null and (not openOnly or i.status == #open) and (switch workId { case (?w) i.workId == w; case null true }) and Rights.may(ctx, p, #readReports, ?i.workId)) {
        out.add(rpIssueView(i));
        if (out.size() >= lim) { break scan };
      };
    };
    out.toArray();
  };

  public shared ({ caller }) func handleIssue(issueId : Nat, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let i = reports.issues.get(issueId) ?? Runtime.trap("Geen toegang");
    Rights.require({ works; settings }, p, #handleIssues, ?i.workId);
    if (i.archivedAt != null) { return #err("Dit probleem bestaat niet meer") };
    if (i.status != #open) { return #err("Dit probleem is al afgehandeld") };
    let n = note.trim(#char ' ');
    if (n.size() > Config.maxNote) { return #err("Notitie: hoogstens " # Config.maxNote.toText() # " tekens") };
    reports.issues.add(issueId, { i with status = #handled({ by = p.id; at = Time.now(); note = n }) });
    Access.audit(audit, caller, ?p.id, ?i.workId, "probleem-afgehandeld", rpWorkCode(i.workId) # ": " # Reports.issueWord(i.kind) # " #" # issueId.toText());
    if (i.createdBy != p.id) {
      Access.notify(audit, ctr, i.createdBy, "probleem-afgehandeld", p.name # " handelde je melding af (" # Reports.issueWord(i.kind) # ", " # rpWorkCode(i.workId) # ")" # (if (n.size() > 0) ": " # n else ""), ?i.workId);
    };
    #ok;
  };

  // ── Ritten (R14) en voertuigen ──────────────────────────────────────────
  public query ({ caller }) func listTrips(fromDay : Nat, toDay : Nat) : async [Views.TripView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readTrips, null);
    if (toDay < fromDay or toDay - fromDay > 400) { Runtime.trap("Periode: hoogstens 400 dagen") };
    let out = List.empty<Views.TripView>();
    label scan for ((_, t) in reports.trips.reverseEntries()) {
      if (t.archivedAt == null and t.day >= fromDay and t.day <= toDay and Rights.mayReadTrip(ctx, p, t.createdBy, [t.driverOutPersonId, t.driverBackPersonId])) {
        out.add(rpTripView(t));
        if (out.size() >= Config.maxListPage) { break scan };
      };
    };
    out.toArray();
  };

  public query ({ caller }) func listVehicles(withArchived : Bool) : async [Views.VehicleView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readVehicles, null);
    rpVehicles(withArchived);
  };

  public shared ({ caller }) func saveVehicle(i : Views.VehicleInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageVehicles, null);
    let plate = Text.toUpper(i.plate.trim(#char ' '));
    if (plate.size() == 0 or plate.size() > Config.maxShort) { return #err("Nummerplaat: 1 tot " # Config.maxShort.toText() # " tekens") };
    let name = i.name.trim(#char ' ');
    if (name.size() > Config.maxLabel) { return #err("Naam: hoogstens " # Config.maxLabel.toText() # " tekens") };
    let selfId = switch (i.id) { case (?x) x; case null 0 };
    if (not i.archived and org.vehicles.values().any(func v = v.id != selfId and v.archivedAt == null and v.plate == plate)) {
      return #err("Nummerplaat " # plate # " bestaat al");
    };
    let now = Time.now();
    switch (i.id) {
      case (?id) {
        let v = org.vehicles.get(id) ?? return #err("Onbekend voertuig");
        let nv : Types.Vehicle = { id; plate; name; createdAt = v.createdAt; var archivedAt = if (i.archived) (if (v.archivedAt == null) ?now else v.archivedAt) else null; extra = v.extra };
        org.vehicles.add(id, nv);
        Access.audit(audit, caller, ?p.id, null, "voertuig", plate # (if (i.archived) " gearchiveerd" else " gewijzigd"));
        #ok(id);
      };
      case null {
        if (org.vehicles.values().filter(func v = v.archivedAt == null).size() >= Config.maxVehicles) { return #err("Te veel voertuigen") };
        let id = Ids.next(ctr, "vehicle");
        let v : Types.Vehicle = { id; plate; name; createdAt = now; var archivedAt = null; extra = [] };
        org.vehicles.add(id, v);
        Access.audit(audit, caller, ?p.id, null, "voertuig", plate # " nieuw");
        #ok(id);
      };
    };
  };

  // ── Uitvoeren van één opdracht ──────────────────────────────────────────
  type RpOk = (Nat, ?Nat, Text); // (verslag, blok, opmerking)

  func rpRun(caller : Principal, p : Types.Person, i : Views.ReportOpInput) : Views.OpResult {
    if (not Reports.validKey(i.opId)) { return { opId = i.opId; outcome = #err("Ongeldige opId"); repeated = false } };
    switch (reports.ops.get(i.opId)) {
      case (?r) {
        // Herhaling (de gsm miste het antwoord): hetzelfde resultaat, niets opnieuw uitgevoerd.
        if (r.by != p.id) { return { opId = i.opId; outcome = #err("Geen toegang: deze opId is van iemand anders"); repeated = false } };
        return { opId = i.opId; outcome = #done({ reportId = r.reportId; entityId = r.entityId; note = r.note }); repeated = true };
      };
      case null {};
    };
    if (not Reports.validKey(i.clientKey)) { return { opId = i.opId; outcome = #err("Ongeldige sleutel van het verslag"); repeated = false } };
    let (kind, res) : (Text, Result.Result<RpOk, Text>) = switch (i.op) {
      case (#ensure x) ("ensure", rpEnsure(caller, p, i.clientKey, x.workId, x.day));
      case (#text x) ("text", rpText(p, i.clientKey, x.field, x.value));
      case (#attendance x) ("attendance", rpAttendance(p, i.clientKey, i.opId, x));
      case (#workDone x) ("workDone", rpWorkDone(p, i.clientKey, i.opId, x));
      case (#material x) ("material", rpMaterial(p, i.clientKey, i.opId, x));
      case (#photo x) ("photo", rpPhoto(p, i.clientKey, i.opId, x));
      case (#issue x) ("issue", rpIssue(p, i.clientKey, i.opId, x));
      case (#trip x) ("trip", rpTrip(p, i.clientKey, i.opId, x));
      case (#remove x) ("remove", rpRemove(p, i.clientKey, x.blockKey));
      case (#finalize) ("finalize", rpFinalize(caller, p, i.clientKey));
    };
    switch res {
      case (#ok((reportId, entityId, note))) {
        let seq = Ids.next(ctr, "op");
        reports.ops.add(i.opId, { opId = i.opId; seq; at = Time.now(); by = p.id; kind; reportId; entityId; note });
        reports.opOrder.add(seq, i.opId);
        { opId = i.opId; outcome = #done({ reportId; entityId; note }); repeated = false };
      };
      // Een fout wordt niet onthouden: na een correctie (rechten, invoer) mag dezelfde opId opnieuw.
      case (#err e) { { opId = i.opId; outcome = #err(e); repeated = false } };
    };
  };

  // Het verslag van (werf, dag) openen. Bestaat er al een open verslag (ander toestel), dan komt deze sleutel erbij;
  // is het al afgesloten, dan begint een correctie.
  func rpEnsure(caller : Principal, p : Types.Person, clientKey : Text, workId : Nat, day : Nat) : Result.Result<RpOk, Text> {
    let ctx = { works; settings };
    switch (reports.keys.get(clientKey)) {
      case (?id) {
        let r = reports.reports.get(id) ?? return #err("Onbekend verslag");
        if (r.workId != workId or r.day != day) { return #err("Deze sleutel hoort bij een ander verslag") };
        if (not Rights.may(ctx, p, #writeReport, ?r.workId)) { return #err("Geen toegang tot deze werf") };
        return #ok((id, null, "bestaat"));
      };
      case null {};
    };
    if (not Rights.may(ctx, p, #writeReport, ?workId)) { return #err("Geen toegang tot deze werf") };
    let today = Reports.today();
    if (day > today + 1 or day + Config.reportMaxAgeDays < today) {
      return #err("Een verslag kan voor vandaag of de voorbije " # Config.reportMaxAgeDays.toText() # " dagen");
    };
    let key = Reports.dayKey(workId, day);
    let ids = switch (reports.dayIndex.get(key)) { case (?x) x; case null [] };
    for (id in ids.values()) {
      switch (reports.reports.get(id)) {
        case (?r) {
          if (Reports.isDraft(r)) {
            reports.keys.add(clientKey, id);
            return #ok((id, null, "samengevoegd"));
          };
        };
        case null {};
      };
    };
    let corrects = rpLastFinal(ids);
    let id = rpNewReport(p, workId, day, clientKey, corrects);
    Access.audit(audit, caller, ?p.id, ?workId, "verslag-nieuw", rpWorkCode(workId) # " " # Plan.fmtDay(day) # (switch corrects { case (?c) " (correctie van #" # c.toText() # ")"; case null "" }));
    #ok((id, null, if (corrects == null) "nieuw" else "correctie"));
  };

  func rpLastFinal(ids : [Nat]) : ?Nat {
    var last : ?Nat = null;
    for (id in ids.values()) {
      switch (reports.reports.get(id)) { case (?r) { if (not Reports.isDraft(r)) { last := ?id } }; case null {} };
    };
    last;
  };

  func rpNewReport(p : Types.Person, workId : Nat, day : Nat, clientKey : Text, corrects : ?Nat) : Nat {
    let id = Ids.next(ctr, "report");
    let now = Time.now();
    reports.reports.add(id, { id; workId; day; authorPersonId = p.id; clientKey; status = #draft; corrects; summary = ""; weather = ""; createdAt = now; updatedAt = now; updatedBy = p.id; extra = [] });
    reports.keys.add(clientKey, id);
    let key = Reports.dayKey(workId, day);
    reports.dayIndex.add(key, Reports.append(switch (reports.dayIndex.get(key)) { case (?x) x; case null [] }, id));
    reports.blocks.add(id, Reports.emptyBlocks());
    id;
  };

  // Het verslag waarin een blok komt: het verslag van de sleutel, of, als dat al afgesloten is, de open correctie
  // van die dag (zo nodig nieuw). Bool = doorgestuurd naar een correctie.
  func rpTarget(p : Types.Person, clientKey : Text) : Result.Result<(Types.DayReport, Bool), Text> {
    let id = reports.keys.get(clientKey) ?? return #err("Onbekend verslag: eerst openen");
    let r = reports.reports.get(id) ?? return #err("Onbekend verslag");
    if (not Rights.may({ works; settings }, p, #writeReport, ?r.workId)) { return #err("Geen toegang tot deze werf") };
    if (Reports.isDraft(r)) { return #ok((r, false)) };
    let ids = switch (reports.dayIndex.get(Reports.dayKey(r.workId, r.day))) { case (?x) x; case null [] };
    for (x in ids.values()) {
      switch (reports.reports.get(x)) { case (?c) { if (Reports.isDraft(c)) { return #ok((c, true)) } }; case null {} };
    };
    let cid = rpNewReport(p, r.workId, r.day, "corr-" # (Ids.current(ctr, "report") + 1).toText() # "-" # clientKey, rpLastFinal(ids));
    let c = reports.reports.get(cid) ?? return #err("Onbekend verslag");
    #ok((c, true));
  };

  func rpNote(moved : Bool) : Text { if moved "correctie" else "" };

  func rpBlocks(id : Nat) : Types.ReportBlocks { switch (reports.blocks.get(id)) { case (?b) b; case null Reports.emptyBlocks() } };

  func rpTouch(r : Types.DayReport, p : Types.Person) {
    reports.reports.add(r.id, { r with updatedAt = Time.now(); updatedBy = p.id });
  };

  func rpText(p : Types.Person, clientKey : Text, field : Text, value : Text) : Result.Result<RpOk, Text> {
    let (r, moved) = switch (rpTarget(p, clientKey)) { case (#ok x) x; case (#err e) return #err(e) };
    let v = value.trim(#char ' ');
    let (old, max) = switch field {
      case "summary" (r.summary, Config.maxReportText);
      case "weather" (r.weather, Config.maxLabel);
      case _ return #err("Onbekend veld");
    };
    if (v.size() > max) { return #err("Te lang: hoogstens " # max.toText() # " tekens") };
    if (v == old) { return #ok((r.id, null, rpNote(moved))) };
    let now = Time.now();
    let cid = Ids.next(ctr, "reportChange");
    reports.changes.add(cid, { id = cid; reportId = r.id; at = now; by = p.id; field; from = old; to = v });
    reports.reports.add(r.id, if (field == "summary") { { r with summary = v; updatedAt = now; updatedBy = p.id } } else { { r with weather = v; updatedAt = now; updatedBy = p.id } });
    #ok((r.id, null, rpNote(moved)));
  };

  func rpTaskOf(r : Types.DayReport, taskId : ?Nat) : Result.Result<?Types.Task, Text> {
    switch taskId {
      case null #ok(null);
      case (?t) {
        let x = plan.tasks.get(t) ?? return #err("Onbekende taak");
        if (x.workId != r.workId or x.archivedAt != null) { return #err("Deze taak hoort niet bij deze werf") };
        #ok(?x);
      };
    };
  };

  func rpAttendance(p : Types.Person, clientKey : Text, opId : Text, x : { orgId : ?Nat; personId : ?Nat; names : Text; headcount : Nat; slots : [Types.TimeSlot]; regie : Bool; taskId : ?Nat; note : Text; replaces : ?Text }) : Result.Result<RpOk, Text> {
    let (r, moved) = switch (rpTarget(p, clientKey)) { case (#ok y) y; case (#err e) return #err(e) };
    switch (x.orgId) {
      case (?o) {
        let f = org.orgs.get(o) ?? return #err("Onbekende firma");
        if (f.archivedAt != null) { return #err("Deze firma is gearchiveerd") };
        if (f.kind == #client) { return #err("Een klant staat niet bij de aanwezigen") };
      };
      case null {};
    };
    switch (x.personId) {
      case (?id) {
        let q = access.persons.get(id) ?? return #err("Onbekende persoon");
        if (q.orgId != x.orgId) { return #err("Deze persoon hoort niet bij die firma") };
      };
      case null {};
    };
    let names = x.names.trim(#char ' ');
    if (names.size() > 200) { return #err("Namen: hoogstens 200 tekens") };
    let note = x.note.trim(#char ' ');
    if (note.size() > Config.maxNote) { return #err("Notitie te lang") };
    if (x.headcount == 0 or x.headcount > Config.maxHeadcount) { return #err("Aantal personen: 1 tot " # Config.maxHeadcount.toText()) };
    switch (Reports.slotsError(x.slots)) { case (?e) return #err(e); case null {} };
    let task = switch (rpTaskOf(r, x.taskId)) { case (#ok t) t; case (#err e) return #err(e) };
    let b = rpBlocks(r.id);
    if (b.attendances.size() >= Config.maxAttendancesPerReport) { return #err("Te veel regels in dit verslag") };
    let now = Time.now();
    let id = Ids.next(ctr, "attendance");
    // Aanpassen = het oude blok archiveren en een nieuw maken (append-only); enkel in een open verslag.
    var note2 = rpNote(moved);
    switch (x.replaces) {
      case (?bk) {
        switch (rpBlockOf(bk, "attendance")) {
          case (?old) {
            switch (reports.attendances.get(old)) {
              case (?a) {
                let open = switch (reports.reports.get(a.reportId)) { case (?rr) Reports.isDraft(rr); case null false };
                if (open and a.archivedAt == null) {
                  reports.attendances.add(a.id, { a with archivedAt = ?now; archivedBy = ?p.id; replacedBy = ?id });
                } else if (a.archivedAt == null) { note2 := "correctie" };
              };
              case null {};
            };
          };
          case null {};
        };
      };
      case null {};
    };
    let minutes = x.headcount * Reports.slotMinutes(x.slots);
    reports.attendances.add(id, { id; reportId = r.id; workId = r.workId; day = r.day; orgId = x.orgId; personId = x.personId; names; headcount = x.headcount; slots = x.slots; minutesTotal = minutes; regie = x.regie; taskId = switch task { case (?t) ?t.id; case null null }; note; blockKey = opId; replacedBy = null; createdAt = now; createdBy = p.id; archivedAt = null; archivedBy = null; extra = [] });
    reports.blocks.add(r.id, { b with attendances = Reports.append(b.attendances, id) });
    rpTouch(r, p);
    #ok((r.id, ?id, note2));
  };

  // Het blok (id) dat met deze opId gemaakt werd, als het van deze soort is.
  func rpBlockOf(blockKey : Text, kind : Text) : ?Nat {
    switch (reports.ops.get(blockKey)) { case (?o) { if (o.kind == kind) o.entityId else null }; case null null };
  };

  func rpWorkDone(p : Types.Person, clientKey : Text, opId : Text, x : { taskId : ?Nat; text : Text; percent : ?Nat }) : Result.Result<RpOk, Text> {
    let (r, moved) = switch (rpTarget(p, clientKey)) { case (#ok y) y; case (#err e) return #err(e) };
    let text = x.text.trim(#char ' ');
    if (text.size() > Config.maxNote) { return #err("Tekst: hoogstens " # Config.maxNote.toText() # " tekens") };
    let task = switch (rpTaskOf(r, x.taskId)) { case (#ok t) t; case (#err e) return #err(e) };
    if (text.size() == 0 and task == null) { return #err("Schrijf wat er gedaan is of kies een taak") };
    switch (x.percent) { case (?v) { if (v > 100) { return #err("Voortgang: 0 tot 100 %") } }; case null {} };
    let b = rpBlocks(r.id);
    if (b.workDone.size() >= Config.maxWorkDonePerReport) { return #err("Te veel regels in dit verslag") };
    let id = Ids.next(ctr, "workDone");
    reports.workDone.add(id, { id; reportId = r.id; workId = r.workId; taskId = switch task { case (?t) ?t.id; case null null }; text; percent = x.percent; blockKey = opId; createdAt = Time.now(); createdBy = p.id; archivedAt = null; extra = [] });
    reports.blocks.add(r.id, { b with workDone = Reports.append(b.workDone, id) });
    // Q-05 (1.3): de voortgang op de werf zet de taak (percent, status, werkelijk begin en einde). Laatste schrijver
    // wint; beide waarden staan in de wijzigingen van de planning ("nooit stil verlies", §8.4).
    switch (task, x.percent) { case (?t, ?pct) rpProgress(t, pct, r.day, p); case _ {} };
    rpTouch(r, p);
    #ok((r.id, ?id, rpNote(moved)));
  };

  func rpProgress(t : Types.Task, pct : Nat, day : Nat, p : Types.Person) {
    let status : Types.TaskStatus = if (pct == 100) #done else if (pct == 0) (if (t.status == #done) #busy else t.status) else (switch (t.status) { case (#delayed or #blocked) t.status; case _ #busy });
    let actualStart = if (t.actualStart == null and pct > 0) ?day else t.actualStart;
    let actualEnd = if (pct == 100) (if (t.actualEnd == null) ?day else t.actualEnd) else null;
    if (status == t.status and pct == t.percent and actualStart == t.actualStart and actualEnd == t.actualEnd) { return };
    let now = Time.now();
    plan.tasks.add(t.id, { t with percent = pct; status; actualStart; actualEnd; updatedAt = now; updatedBy = p.id });
    let why = "werfverslag " # Plan.fmtDay(day);
    rpTaskChange(t, p.id, "voortgang", t.percent.toText() # " %", pct.toText() # " %", why);
    rpTaskChange(t, p.id, "status", Plan.statusKey(t.status), Plan.statusKey(status), why);
    rpTaskChange(t, p.id, "begonnen", rpOptDay(t.actualStart), rpOptDay(actualStart), why);
    rpTaskChange(t, p.id, "klaar", rpOptDay(t.actualEnd), rpOptDay(actualEnd), why);
    plan.versions.add(t.workId, (switch (plan.versions.get(t.workId)) { case (?v) v; case null 0 }) + 1);
  };

  func rpTaskChange(t : Types.Task, by : Nat, field : Text, from : Text, to : Text, reason : Text) {
    if (from == to) { return };
    let id = Ids.next(ctr, "taskChange");
    plan.taskChanges.add(id, { id; taskId = t.id; workId = t.workId; at = Time.now(); by; field; from; to; reason });
  };

  func rpOptDay(d : ?Nat) : Text { switch d { case (?x) Plan.fmtDay(x); case null "" } };

  // Een bestand van de gsm (foto, foto van een bon) als verwijzing; het hoort bij het verslag (R8, R12).
  func rpFile(p : Types.Person, r : Types.DayReport, f : Views.FileIn) : Result.Result<Nat, Text> {
    switch (Reports.fileError(f)) { case (?e) return #err(e); case null {} };
    let id = Ids.next(ctr, "file");
    let ref : Types.FileRef = { id; name = f.name.trim(#char ' '); mime = f.mime; size = f.size; blob = f.blob; workId = ?r.workId; confidential = false; personId = p.id; at = Time.now(); var archivedAt = null };
    files.files.add(id, ref);
    reports.fileOwners.add(id, r.id);
    #ok(id);
  };

  func rpMaterial(p : Types.Person, clientKey : Text, opId : Text, x : { kind : Types.MaterialKind; text : Text; quantity : Text; supplier : Text; file : ?Views.FileIn }) : Result.Result<RpOk, Text> {
    let (r, moved) = switch (rpTarget(p, clientKey)) { case (#ok y) y; case (#err e) return #err(e) };
    let text = x.text.trim(#char ' ');
    let quantity = x.quantity.trim(#char ' ');
    let supplier = x.supplier.trim(#char ' ');
    if (text.size() > 200 or quantity.size() > Config.maxLabel or supplier.size() > Config.maxName) { return #err("Te lange tekst") };
    if (text.size() == 0 and x.file == null) { return #err("Schrijf wat het is, of neem een foto van de bon") };
    let b = rpBlocks(r.id);
    if (b.materials.size() >= Config.maxMaterialsPerReport) { return #err("Te veel regels in dit verslag") };
    let fileId = switch (x.file) {
      case (?f) { switch (rpFile(p, r, f)) { case (#ok id) ?id; case (#err e) return #err(e) } };
      case null null;
    };
    let id = Ids.next(ctr, "material");
    reports.materials.add(id, { id; reportId = r.id; workId = r.workId; kind = x.kind; text; quantity; supplier; fileId; blockKey = opId; createdAt = Time.now(); createdBy = p.id; archivedAt = null; extra = [] });
    reports.blocks.add(r.id, { b with materials = Reports.append(b.materials, id) });
    rpTouch(r, p);
    #ok((r.id, ?id, rpNote(moved)));
  };

  func rpPhoto(p : Types.Person, clientKey : Text, opId : Text, x : { file : Views.FileIn; thumb : ?Views.FileIn; taskId : ?Nat; caption : Text; takenAt : ?Int }) : Result.Result<RpOk, Text> {
    let (r, moved) = switch (rpTarget(p, clientKey)) { case (#ok y) y; case (#err e) return #err(e) };
    let caption = x.caption.trim(#char ' ');
    if (caption.size() > 200) { return #err("Bijschrift: hoogstens 200 tekens") };
    let task = switch (rpTaskOf(r, x.taskId)) { case (#ok t) t; case (#err e) return #err(e) };
    let b = rpBlocks(r.id);
    if (b.photos.size() >= Config.maxPhotosPerReport) { return #err("Hoogstens " # Config.maxPhotosPerReport.toText() # " foto's per verslag") };
    switch (Reports.fileError(x.file)) { case (?e) return #err(e); case null {} };
    switch (x.thumb) { case (?t) { switch (Reports.fileError(t)) { case (?e) return #err("Miniatuur: " # e); case null {} } }; case null {} };
    let fileId = switch (rpFile(p, r, x.file)) { case (#ok id) id; case (#err e) return #err(e) };
    let thumbFileId = switch (x.thumb) { case (?t) { switch (rpFile(p, r, t)) { case (#ok id) ?id; case (#err _) null } }; case null null };
    let id = Ids.next(ctr, "photo");
    reports.photos.add(id, { id; reportId = r.id; workId = r.workId; fileId; thumbFileId; taskId = switch task { case (?t) ?t.id; case null null }; caption; takenAt = x.takenAt; blockKey = opId; createdAt = Time.now(); createdBy = p.id; archivedAt = null; extra = [] });
    reports.blocks.add(r.id, { b with photos = Reports.append(b.photos, id) });
    rpTouch(r, p);
    #ok((r.id, ?id, rpNote(moved)));
  };

  func rpIssue(p : Types.Person, clientKey : Text, opId : Text, x : { kind : Types.IssueKind; text : Text; taskIds : [Nat]; delayDays : ?Nat }) : Result.Result<RpOk, Text> {
    let (r, moved) = switch (rpTarget(p, clientKey)) { case (#ok y) y; case (#err e) return #err(e) };
    let text = x.text.trim(#char ' ');
    if (text.size() == 0 or text.size() > Config.maxNote) { return #err("Beschrijf het probleem (1 tot " # Config.maxNote.toText() # " tekens)") };
    if (x.taskIds.size() > 20) { return #err("Hoogstens 20 taken") };
    let tasks = List.empty<Types.Task>();
    for (t in x.taskIds.values()) {
      switch (rpTaskOf(r, ?t)) { case (#ok(?task)) { if (not tasks.any(func y = y.id == task.id)) { tasks.add(task) } }; case (#ok null) {}; case (#err e) return #err(e) };
    };
    switch (x.delayDays) { case (?d) { if (d == 0 or d > Config.maxDelayDays) { return #err("Vertraging: 1 tot " # Config.maxDelayDays.toText() # " werkdagen") } }; case null {} };
    let b = rpBlocks(r.id);
    if (b.issues.size() >= Config.maxIssuesPerReport) { return #err("Te veel meldingen in dit verslag") };
    let id = Ids.next(ctr, "issue");
    reports.issues.add(id, { id; reportId = r.id; workId = r.workId; kind = x.kind; text; taskIds = tasks.map<Types.Task, Nat>(func t = t.id).toArray(); delayDays = if (x.kind == #delay) x.delayDays else null; status = #open; blockKey = opId; createdAt = Time.now(); createdBy = p.id; archivedAt = null; extra = [] });
    reports.blocks.add(r.id, { b with issues = Reports.append(b.issues, id) });
    // Een vertraging zet de genoemde taken op "vertraagd"; verschuiven doet de werfleider in de Gantt (voorvertoning).
    if (x.kind == #delay) {
      var bumped = false;
      for (t in tasks.values()) {
        if (t.status != #done and t.status != #delayed) {
          plan.tasks.add(t.id, { t with status = #delayed; updatedAt = Time.now(); updatedBy = p.id });
          rpTaskChange(t, p.id, "status", Plan.statusKey(t.status), "vertraagd", "vertraging gemeld in het werfverslag " # Plan.fmtDay(r.day) # ": " # text);
          bumped := true;
        };
      };
      if bumped { plan.versions.add(r.workId, (switch (plan.versions.get(r.workId)) { case (?v) v; case null 0 }) + 1) };
    };
    // Vertraging en veiligheid: meteen een melding aan de admins en de werfleiders van de werf (behalve de melder).
    if (x.kind == #delay or x.kind == #safety) {
      let to = List.empty<Nat>();
      for (a in Access.activeAdminIds(access).values()) { if (not to.contains(Nat.equal, a)) { to.add(a) } };
      switch (works.works.get(r.workId)) { case (?w) { switch (w.leaderPersonId) { case (?l) { if (not to.contains(Nat.equal, l)) { to.add(l) } }; case null {} } }; case null {} };
      for (who in to.values()) {
        if (who != p.id) {
          Access.notify(audit, ctr, who, "verslag-" # Reports.issueWord(x.kind), p.name # " meldt " # Reports.issueWord(x.kind) # " op " # rpWorkCode(r.workId) # (switch (x.delayDays) { case (?d) " (+" # d.toText() # " wd)"; case null "" }) # ": " # text, ?r.workId);
        };
      };
    };
    rpTouch(r, p);
    #ok((r.id, ?id, rpNote(moved)));
  };

  func rpTrip(p : Types.Person, clientKey : Text, opId : Text, x : { vehicleId : ?Nat; plate : Text; driverOutPersonId : ?Nat; driverBackPersonId : ?Nat; driverOutText : Text; driverBackText : Text; note : Text; outMin : ?Nat; backMin : ?Nat }) : Result.Result<RpOk, Text> {
    let (r, moved) = switch (rpTarget(p, clientKey)) { case (#ok y) y; case (#err e) return #err(e) };
    let plate = switch (x.vehicleId) {
      case (?v) {
        let veh = org.vehicles.get(v) ?? return #err("Onbekend voertuig");
        if (veh.archivedAt != null) { return #err("Dit voertuig is gearchiveerd") };
        veh.plate;
      };
      case null Text.toUpper(x.plate.trim(#char ' '));
    };
    if (plate.size() == 0 or plate.size() > Config.maxShort) { return #err("Kies een voertuig of geef de nummerplaat") };
    for (d in [x.driverOutPersonId, x.driverBackPersonId].values()) {
      switch d {
        case (?id) {
          let q = access.persons.get(id) ?? return #err("Onbekende chauffeur");
          if (q.orgId != null or q.archivedAt != null) { return #err("Een chauffeur is iemand van BOWACO") };
        };
        case null {};
      };
    };
    let outT = x.driverOutText.trim(#char ' ');
    let backT = x.driverBackText.trim(#char ' ');
    let note = x.note.trim(#char ' ');
    if (outT.size() > Config.maxName or backT.size() > Config.maxName or note.size() > Config.maxNote) { return #err("Te lange tekst") };
    // 1b.2: uren van vertrek (optioneel) in `extra` (D8: geen migratie): "heen" en "terug" als "07:15".
    var times : Types.Extra = [];
    for ((k, m) in [("heen", x.outMin), ("terug", x.backMin)].values()) {
      switch m { case (?v) { if (v >= 24 * 60) { return #err("Uur klopt niet") }; times := times.concat([(k, Reports.hhmm(v))]) }; case null {} };
    };
    let b = rpBlocks(r.id);
    if (b.trips.size() >= Config.maxTripsPerReport) { return #err("Te veel ritten in dit verslag") };
    let id = Ids.next(ctr, "trip");
    reports.trips.add(id, { id; reportId = r.id; workId = r.workId; day = r.day; vehicleId = x.vehicleId; plate; driverOutPersonId = x.driverOutPersonId; driverBackPersonId = x.driverBackPersonId; driverOutText = outT; driverBackText = backT; note; blockKey = opId; createdAt = Time.now(); createdBy = p.id; archivedAt = null; extra = times });
    reports.blocks.add(r.id, { b with trips = Reports.append(b.trips, id) });
    rpTouch(r, p);
    #ok((r.id, ?id, rpNote(moved)));
  };

  // Een blok weghalen (archiveren) dat met een eerdere opdracht gemaakt werd. Enkel in een open verslag: een
  // afgesloten verslag is bewijs en verandert niet meer.
  func rpRemove(p : Types.Person, clientKey : Text, blockKey : Text) : Result.Result<RpOk, Text> {
    let op = reports.ops.get(blockKey) ?? return #err("Onbekend blok");
    let eid = op.entityId ?? return #err("Dit is geen blok");
    let r = reports.reports.get(op.reportId) ?? return #err("Onbekend verslag");
    if (not Rights.may({ works; settings }, p, #writeReport, ?r.workId)) { return #err("Geen toegang tot deze werf") };
    switch (reports.keys.get(clientKey)) {
      case (?k) {
        let kr = reports.reports.get(k) ?? return #err("Onbekend verslag");
        if (kr.workId != r.workId or kr.day != r.day) { return #err("Dit blok hoort bij een ander verslag") };
      };
      case null return #err("Onbekend verslag");
    };
    if (not Reports.isDraft(r)) { return #err("Het verslag is afgesloten: weghalen kan niet meer (maak een correctie)") };
    let now = Time.now();
    switch (op.kind) {
      case "attendance" { switch (reports.attendances.get(eid)) { case (?x) { if (x.archivedAt == null) { reports.attendances.add(eid, { x with archivedAt = ?now; archivedBy = ?p.id }) } }; case null {} } };
      case "workDone" { switch (reports.workDone.get(eid)) { case (?x) { if (x.archivedAt == null) { reports.workDone.add(eid, { x with archivedAt = ?now }) } }; case null {} } };
      case "material" { switch (reports.materials.get(eid)) { case (?x) { if (x.archivedAt == null) { reports.materials.add(eid, { x with archivedAt = ?now }) } }; case null {} } };
      case "photo" { switch (reports.photos.get(eid)) { case (?x) { if (x.archivedAt == null) { reports.photos.add(eid, { x with archivedAt = ?now }) } }; case null {} } };
      case "issue" { switch (reports.issues.get(eid)) { case (?x) { if (x.archivedAt == null) { reports.issues.add(eid, { x with archivedAt = ?now }) } }; case null {} } };
      case "trip" { switch (reports.trips.get(eid)) { case (?x) { if (x.archivedAt == null) { reports.trips.add(eid, { x with archivedAt = ?now }) } }; case null {} } };
      case _ return #err("Dit blok kan niet weg");
    };
    rpTouch(r, p);
    #ok((r.id, ?eid, "weg"));
  };

  func rpHasContent(r : Types.DayReport) : Bool {
    if (r.summary.size() > 0) { return true };
    let b = rpBlocks(r.id);
    b.attendances.any(func id = switch (reports.attendances.get(id)) { case (?x) x.archivedAt == null; case null false })
    or b.workDone.any(func id = switch (reports.workDone.get(id)) { case (?x) x.archivedAt == null; case null false })
    or b.materials.any(func id = switch (reports.materials.get(id)) { case (?x) x.archivedAt == null; case null false })
    or b.photos.any(func id = switch (reports.photos.get(id)) { case (?x) x.archivedAt == null; case null false })
    or b.issues.any(func id = switch (reports.issues.get(id)) { case (?x) x.archivedAt == null; case null false })
    or b.trips.any(func id = switch (reports.trips.get(id)) { case (?x) x.archivedAt == null; case null false });
  };

  // Afsluiten (R7). Al afgesloten = ok (idempotent, §8.4); staat er van die dag nog een open correctie met
  // inhoud (blokken die na het afsluiten binnenkwamen), dan wordt die mee afgesloten.
  func rpFinalize(caller : Principal, p : Types.Person, clientKey : Text) : Result.Result<RpOk, Text> {
    let ctx = { works; settings };
    let id = reports.keys.get(clientKey) ?? return #err("Onbekend verslag: eerst openen");
    let r0 = reports.reports.get(id) ?? return #err("Onbekend verslag");
    if (not Rights.may(ctx, p, #writeReport, ?r0.workId)) { return #err("Geen toegang tot deze werf") };
    let target = if (Reports.isDraft(r0)) r0 else {
      let ids = switch (reports.dayIndex.get(Reports.dayKey(r0.workId, r0.day))) { case (?x) x; case null [] };
      var open : ?Types.DayReport = null;
      for (x in ids.values()) { switch (reports.reports.get(x)) { case (?c) { if (Reports.isDraft(c) and rpHasContent(c)) { open := ?c } }; case null {} } };
      switch open { case (?c) c; case null return #ok((r0.id, null, "al afgesloten")) };
    };
    let leader = switch (works.works.get(target.workId)) { case (?w) w.leaderPersonId; case null null };
    if (not Rights.mayFinalizeReport(ctx, p, target.workId, target.authorPersonId, leader)) {
      return #err("Afsluiten: enkel wie het verslag begon, de werfleider van de werf of een admin");
    };
    if (not rpHasContent(target)) { return #err("Het verslag is nog leeg") };
    let now = Time.now();
    reports.reports.add(target.id, { target with status = #final({ at = now; by = p.id }); updatedAt = now; updatedBy = p.id });
    switch (target.corrects) {
      case (?old) {
        switch (reports.reports.get(old)) {
          case (?o) { reports.reports.add(old, { o with status = #corrected({ byReportId = target.id; at = now }) }) };
          case null {};
        };
      };
      case null {};
    };
    // 1.7: de OA's van wie er uren in staan, kunnen ze nu bevestigen (R9).
    let orgsIn = List.empty<Nat>();
    for (aid in rpBlocks(target.id).attendances.values()) {
      switch (reports.attendances.get(aid)) {
        case (?a) { switch (a.orgId) { case (?o) { if (a.archivedAt == null and not orgsIn.contains(Nat.equal, o)) { orgsIn.add(o) } }; case null {} } };
        case null {};
      };
    };
    for (o in orgsIn.values()) {
      Access.notifyOrgOnWork(access, ctx, audit, ctr, o, target.workId, ?#confirmHours, p.id, "uren-bevestigen", "Je uren van " # Plan.fmtDay(target.day) # " op " # rpWorkCode(target.workId) # " staan klaar om te bevestigen (Mijn uren).");
    };
    Access.audit(audit, caller, ?p.id, ?target.workId, "verslag-afgesloten", rpWorkCode(target.workId) # " " # Plan.fmtDay(target.day) # " #" # target.id.toText() # (switch (target.corrects) { case (?c) " (correctie van #" # c.toText() # ")"; case null "" }));
    #ok((target.id, null, if (target.id == r0.id) "afgesloten" else "correctie afgesloten"));
  };

  // ── Views ───────────────────────────────────────────────────────────────
  func rpWorkCode(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.code; case null "#" # w.toText() } };
  func rpWorkName(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.name; case null "" } };
  func rpOrgName(o : ?Nat) : Text { switch o { case (?x) { switch (org.orgs.get(x)) { case (?y) y.name; case null "#" # x.toText() } }; case null "BOWACO" } };
  func rpOrgCode(o : ?Nat) : Text {
    switch o {
      case (?x) { switch (org.orgs.get(x)) { case (?y) { if (y.aliases.size() > 0) y.aliases[0] else y.name }; case null "#" # x.toText() } };
      case null "BOWACO";
    };
  };
  func rpTaskTitle(t : ?Nat) : Text { switch t { case (?x) { switch (plan.tasks.get(x)) { case (?y) y.title; case null "" } }; case null "" } };
  func rpName(id : Nat) : Text { Access.personName(access, id) };
  func rpOptName(id : ?Nat) : Text { switch id { case (?x) rpName(x); case null "" } };

  func rpFileView(id : Nat) : ?Views.FileView {
    switch (files.files.get(id)) { case (?f) ?Dossier.fileView(f); case null null };
  };

  func rpVehicles(withArchived : Bool) : [Views.VehicleView] {
    let vs = org.vehicles.values().filter(func v = withArchived or v.archivedAt == null).map(func(v : Types.Vehicle) : Views.VehicleView = { id = v.id; plate = v.plate; name = v.name; archived = v.archivedAt != null }).toArray();
    Array.sort<Views.VehicleView>(vs, func(a, b) = Text.compare(a.plate, b.plate));
  };

  func rpIssueView(i : Types.Issue) : Views.IssueView {
    {
      id = i.id;
      reportId = i.reportId;
      workId = i.workId;
      workCode = rpWorkCode(i.workId);
      workName = rpWorkName(i.workId);
      day = switch (reports.reports.get(i.reportId)) { case (?r) r.day; case null 0 };
      kind = i.kind;
      text = i.text;
      taskIds = i.taskIds;
      taskTitles = i.taskIds.map<Nat, Text>(func t = rpTaskTitle(?t));
      delayDays = i.delayDays;
      status = i.status;
      handledByName = switch (i.status) { case (#handled h) rpName(h.by); case (#open) "" };
      blockKey = i.blockKey;
      createdAt = i.createdAt;
      createdByName = rpName(i.createdBy);
    };
  };

  func rpExtra(x : Types.Extra, k : Text) : ?Text {
    switch (x.find(func(p : (Text, Text)) : Bool = p.0 == k)) { case (?(_, v)) ?v; case null null };
  };

  func rpTripView(t : Types.Trip) : Views.TripView {
    {
      id = t.id;
      reportId = t.reportId;
      workId = t.workId;
      workCode = rpWorkCode(t.workId);
      day = t.day;
      vehicleId = t.vehicleId;
      plate = t.plate;
      vehicleName = switch (t.vehicleId) { case (?v) { switch (org.vehicles.get(v)) { case (?x) x.name; case null "" } }; case null "" };
      driverOutPersonId = t.driverOutPersonId;
      driverOutName = if (t.driverOutText.size() > 0) t.driverOutText else rpOptName(t.driverOutPersonId);
      driverBackPersonId = t.driverBackPersonId;
      driverBackName = if (t.driverBackText.size() > 0) t.driverBackText else rpOptName(t.driverBackPersonId);
      note = t.note;
      outTime = rpExtra(t.extra, "heen");
      backTime = rpExtra(t.extra, "terug");
      blockKey = t.blockKey;
      createdAt = t.createdAt;
      createdByName = rpName(t.createdBy);
    };
  };

  func rpAttendanceView(a : Types.Attendance) : Views.AttendanceView {
    let confs = switch (reports.confirmations.get(a.id)) { case (?cs) cs; case null [] };
    {
      id = a.id;
      orgId = a.orgId;
      orgName = rpOrgName(a.orgId);
      orgCode = rpOrgCode(a.orgId);
      personId = a.personId;
      names = a.names;
      headcount = a.headcount;
      slots = a.slots;
      minutesTotal = a.minutesTotal;
      regie = a.regie;
      taskId = a.taskId;
      note = a.note;
      blockKey = a.blockKey;
      createdAt = a.createdAt;
      createdByName = rpName(a.createdBy);
      confirmations = confs.map<Types.HoursConfirmation, Views.ConfirmationView>(func c = { id = c.id; byName = rpName(c.by); at = c.at; ok = c.ok; remark = c.remark });
    };
  };

  func rpActive<T>(ids : [Nat], m : Map.Map<Nat, T>, live : T -> Bool) : [T] {
    ids.filterMap<Nat, T>(func id = switch (m.get(id)) { case (?x) { if (live(x)) ?x else null }; case null null });
  };

  func rpView(p : Types.Person, scope : Rights.ReportScope, r : Types.DayReport) : Views.ReportView {
    let ctx = { works; settings };
    let b = rpBlocks(r.id);
    let full = scope == #full;
    let reader = scope == #full or scope == #reader;
    let atts = rpActive<Types.Attendance>(b.attendances, reports.attendances, func x = x.archivedAt == null).filter(
      func a = reader or (scope == #ownHours and a.orgId != null and a.orgId == p.orgId)
    );
    var total = 0;
    var regie = 0;
    for (a in atts.values()) { total += a.minutesTotal; if (a.regie) { regie += a.minutesTotal } };
    let leader = switch (works.works.get(r.workId)) { case (?w) w.leaderPersonId; case null null };
    let writable = Reports.isDraft(r) and Rights.may(ctx, p, #writeReport, ?r.workId);
    {
      id = r.id;
      workId = r.workId;
      workCode = rpWorkCode(r.workId);
      workName = rpWorkName(r.workId);
      day = r.day;
      status = r.status;
      corrects = r.corrects;
      authorName = if (scope == #summary) "" else rpName(r.authorPersonId);
      summary = if reader r.summary else "";
      weather = if (reader or scope == #summary) r.weather else "";
      createdAt = r.createdAt;
      updatedAt = r.updatedAt;
      scope = switch scope { case (#full) "full"; case (#reader) "reader"; case (#summary) "summary"; case (#ownHours) "ownHours"; case (#none) "none" };
      attendances = atts.map(rpAttendanceView);
      workDone = if (reader or scope == #summary) rpActive<Types.WorkDone>(b.workDone, reports.workDone, func x = x.archivedAt == null).map<Types.WorkDone, Views.WorkDoneView>(
        func w = { id = w.id; taskId = w.taskId; taskTitle = rpTaskTitle(w.taskId); text = w.text; percent = w.percent; blockKey = w.blockKey; createdAt = w.createdAt; createdByName = if (scope == #summary) "" else rpName(w.createdBy) }
      ) else [];
      materials = if reader rpActive<Types.MaterialNote>(b.materials, reports.materials, func x = x.archivedAt == null).map<Types.MaterialNote, Views.MaterialView>(
        // De foto van een bon toont aankoopprijzen: enkel interne rollen krijgen de verwijzing.
        func m = { id = m.id; kind = m.kind; text = m.text; quantity = m.quantity; supplier = m.supplier; file = if full (switch (m.fileId) { case (?f) rpFileView(f); case null null }) else null; hasFile = m.fileId != null; blockKey = m.blockKey; createdAt = m.createdAt; createdByName = rpName(m.createdBy) }
      ) else [];
      photos = if (reader or scope == #summary) rpActive<Types.Photo>(b.photos, reports.photos, func x = x.archivedAt == null).filterMap<Types.Photo, Views.PhotoView>(
        func ph = switch (rpFileView(ph.fileId)) {
          case (?f) ?{ id = ph.id; file = f; thumb = switch (ph.thumbFileId) { case (?t) rpFileView(t); case null null }; taskId = ph.taskId; caption = ph.caption; takenAt = ph.takenAt; blockKey = ph.blockKey; createdAt = ph.createdAt; createdByName = if (scope == #summary) "" else rpName(ph.createdBy) };
          case null null;
        }
      ) else [];
      issues = if reader rpActive<Types.Issue>(b.issues, reports.issues, func x = x.archivedAt == null).map(rpIssueView) else [];
      trips = if full rpActive<Types.Trip>(b.trips, reports.trips, func x = x.archivedAt == null).filter(func t = Rights.mayReadTrip(ctx, p, t.createdBy, [t.driverOutPersonId, t.driverBackPersonId])).map(rpTripView) else [];
      changes = if reader reports.changes.values().filter(func c = c.reportId == r.id).map(func(c : Types.ReportChange) : Views.ReportChangeView = { at = c.at; byName = rpName(c.by); field = c.field; from = c.from; to = c.to }).toArray() else [];
      totalMinutes = total;
      regieMinutes = regie;
      canWrite = writable;
      canFinalize = writable and Rights.mayFinalizeReport(ctx, p, r.workId, r.authorPersonId, leader);
    };
  };

  func rpSummary(r : Types.DayReport, scope : Rights.ReportScope) : Views.ReportSummary {
    let b = rpBlocks(r.id);
    let reader = scope == #full or scope == #reader;
    let atts = rpActive<Types.Attendance>(b.attendances, reports.attendances, func x = x.archivedAt == null);
    var total = 0;
    var regie = 0;
    var heads = 0;
    for (a in atts.values()) { total += a.minutesTotal; heads += a.headcount; if (a.regie) { regie += a.minutesTotal } };
    let done = rpActive<Types.WorkDone>(b.workDone, reports.workDone, func x = x.archivedAt == null);
    let texts = List.empty<Text>();
    for (w in done.values()) {
      if (texts.size() < 3) { texts.add(if (w.text.size() > 0) w.text else rpTaskTitle(w.taskId) # (switch (w.percent) { case (?v) " " # v.toText() # " %"; case null "" })) };
    };
    {
      id = r.id;
      workId = r.workId;
      day = r.day;
      status = r.status;
      corrects = r.corrects;
      authorName = if reader rpName(r.authorPersonId) else "";
      attendances = if reader atts.size() else 0;
      headcount = if reader heads else 0;
      totalMinutes = if reader total else 0;
      regieMinutes = if reader regie else 0;
      photos = rpActive<Types.Photo>(b.photos, reports.photos, func x = x.archivedAt == null).size();
      openIssues = if reader rpActive<Types.Issue>(b.issues, reports.issues, func x = x.archivedAt == null and x.status == #open).size() else 0;
      workDone = texts.toArray();
    };
  };
};
