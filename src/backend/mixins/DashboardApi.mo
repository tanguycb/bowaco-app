// Dashboard (stap 1.8, bouwplan rij 1.8, §8.2 en §8.4): voor kantoor één berekende stand van alle werven die de
// beller ziet: tellers (bezig · vertraagd · bevestigingen open · open problemen · verslagen die ontbreken), de werven
// als kaarten (status, werfleider, voortgang, volgende mijlpaal, waarschuwingen), de achterstanden, de taken van
// deze week en de openstaande bevestigingen van OA's. Niets bewaard; enkel lezen (query, R19).
// Rechten: interne rollen (#readOrgPlanning); een werfleider die niet alles ziet, krijgt enkel zijn werven (seesWork).
// Begrensd (T17): één doorloop per Map; lijsten ≤ 200; het rekenwerk staat in `instructions` (stresstest 1.9).
import Array "mo:core/Array";
import IC "mo:core/InternetComputer";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Plan "../lib/Plan";
import Reports "../lib/Reports";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  plan : Types.PlanState,
  reports : Types.ReportState,
) {

  public query ({ caller }) func dashboard(day : Nat) : async Views.DashboardView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readOrgPlanning, null);
    if (day < Config.minDay or day > Config.maxDay) { Runtime.trap("Onmogelijke datum") };
    let monday : Nat = day - Plan.weekday(day);
    let friday = monday + 4;
    // De vorige werkdag (voor "verslag ontbreekt"): ma → vr ervoor, za/zo → vr.
    let prevWork : Nat = switch (Plan.weekday(day)) { case 0 day - 3; case 6 day - 2; case 5 day - 1; case _ day - 1 };
    let horizon = day + 21; // bevestigingen: lopend of binnen 3 weken

    // Werven die de beller ziet (niet gearchiveerd, niet geannuleerd).
    let seen = Map.empty<Nat, Types.Work>();
    for (w in works.works.values()) {
      if (w.archivedAt == null and w.status != #cancelled and Rights.seesWork(ctx, p, w.id)) { seen.add(w.id, w) };
    };
    // Taken per werf, met hun einde (kalender van de werf).
    type T = (Types.Task, Nat);
    let tasksBy = Map.empty<Nat, List.List<T>>();
    let cals = Map.empty<Nat, Plan.Cal>();
    let ends = Map.empty<Nat, Nat>();
    for (t in plan.tasks.values()) {
      if (t.archivedAt == null and seen.containsKey(t.workId)) {
        let cal = switch (cals.get(t.workId)) { case (?c) c; case null { let c = Plan.calFor(plan, works, t.workId); cals.add(t.workId, c); c } };
        let end = Plan.endDay(cal, t.start, t.workdays);
        ends.add(t.id, end);
        let l = switch (tasksBy.get(t.workId)) { case (?l) l; case null { let l = List.empty<T>(); tasksBy.add(t.workId, l); l } };
        l.add((t, end));
      };
    };
    // Uitvoerders per taak (namen) en bevestigingen.
    let orgsOf = Map.empty<Nat, List.List<Text>>();
    let confirms = List.empty<Views.DashConfirm>();
    let confOpenBy = Map.empty<Nat, Nat>();
    let confDeclBy = Map.empty<Nat, Nat>();
    for (a in plan.assignments.values()) {
      if (a.archivedAt == null and seen.containsKey(a.workId)) {
        switch (plan.tasks.get(a.taskId), ends.get(a.taskId)) {
          case (?t, ?end) {
            if (t.archivedAt == null) {
              let name = dbOrgName(a.orgId);
              let l = switch (orgsOf.get(t.id)) { case (?l) l; case null { let l = List.empty<Text>(); orgsOf.add(t.id, l); l } };
              if (not l.contains(Text.equal, name)) { l.add(name) };
              let (s, e) = Plan.assignmentDays(a, t.start, end);
              let relevant = t.status != #done and e >= day and s <= horizon and t.kind == #work;
              switch (a.confirmation) {
                case (#open) {
                  if relevant {
                    dbInc(confOpenBy, a.workId);
                    confirms.add({ assignmentId = a.id; taskId = t.id; workId = a.workId; workCode = dbCode(a.workId); taskTitle = t.title; orgName = name; start = s; end = e; declined = false; reason = "" });
                  };
                };
                case (#declined d) {
                  if (t.status != #done and e >= day) {
                    dbInc(confDeclBy, a.workId);
                    confirms.add({ assignmentId = a.id; taskId = t.id; workId = a.workId; workCode = dbCode(a.workId); taskTitle = t.title; orgName = name; start = s; end = e; declined = true; reason = d.reason });
                  };
                };
                case (#confirmed _) {};
              };
            };
          };
          case _ {};
        };
      };
    };
    // Open problemen en laatste verslag per werf; verslagen van de vorige werkdag.
    let issuesBy = Map.empty<Nat, Nat>();
    let delayIssue = Map.empty<Nat, ()>();
    for (i in reports.issues.values()) {
      if (i.archivedAt == null and i.status == #open and seen.containsKey(i.workId)) {
        dbInc(issuesBy, i.workId);
        if (i.kind == #delay) { delayIssue.add(i.workId, ()) };
      };
    };
    let lastBy = Map.empty<Nat, Nat>();
    for (r in reports.reports.values()) {
      if (seen.containsKey(r.workId)) {
        switch (lastBy.get(r.workId)) { case (?d) { if (r.day > d) { lastBy.add(r.workId, r.day) } }; case null { lastBy.add(r.workId, r.day) } };
      };
    };

    let cards = List.empty<Views.DashWork>();
    let late = List.empty<Views.DashTask>();
    let week = List.empty<Views.DashTask>();
    var running = 0;
    var delayed = 0;
    var missing = 0;
    let leaders = Map.empty<Nat, Text>();
    for ((wid, w) in seen.entries()) {
      let ts = switch (tasksBy.get(wid)) { case (?l) l.toArray(); case null [] };
      let cal = switch (cals.get(wid)) { case (?c) c; case null Plan.calFor(plan, works, wid) };
      var first : ?Nat = null;
      var last : ?Nat = null;
      var lateN = 0;
      var delayedN = 0;
      var weekN = 0;
      var wsum = 0;
      var psum = 0;
      var next : ?(Text, Nat) = null;
      var workedPrev = false;
      for ((t, end) in ts.values()) {
        first := switch first { case (?f) ?Nat.min(f, t.start); case null ?t.start };
        last := switch last { case (?x) ?Nat.max(x, end); case null ?end };
        if (t.kind == #work) {
          wsum += t.workdays;
          psum += t.workdays * (if (t.status == #done) 100 else t.percent);
          if (t.start <= prevWork and end >= prevWork) { workedPrev := true };
        };
        if (t.status == #delayed) { delayedN += 1 };
        let orgs = switch (orgsOf.get(t.id)) { case (?l) l.toArray(); case null [] };
        // Achterstand: het geplande einde ligt vóór vandaag en de taak is niet klaar (geen levering of mijlpaal in de
        // toekomst); in werkdagen van die werf.
        if (t.status != #done and end < day and t.kind != #milestone) {
          lateN += 1;
          let gap = Plan.workdayDiff(cal, end, day);
          late.add({ taskId = t.id; workId = wid; workCode = w.code; title = t.title; status = t.status; percent = t.percent; start = t.start; end; orgNames = orgs; lateDays = if (gap > 1) Nat.sub(Int_abs(gap), 1) else 0 });
        };
        if (t.start <= friday and end >= monday and t.kind != #milestone) {
          weekN += 1;
          week.add({ taskId = t.id; workId = wid; workCode = w.code; title = t.title; status = t.status; percent = t.percent; start = t.start; end; orgNames = orgs; lateDays = 0 });
        };
        if (t.kind == #milestone and t.status != #done and t.start >= day) {
          next := switch next { case (?(_, d)) { if (t.start < d) ?(t.title, t.start) else next }; case null ?(t.title, t.start) };
        };
      };
      let open = switch (issuesBy.get(wid)) { case (?n) n; case null 0 };
      let isDelayed = lateN > 0 or delayedN > 0 or delayIssue.containsKey(wid);
      let lastRep = lastBy.get(wid);
      // Enkel werven die echt "bezig" zijn: een geplande werf (bv. uit de import) heeft nog geen werfverslag nodig.
      let missingRep : ?Nat = if (workedPrev and w.status == #running and not reports.dayIndex.containsKey(Reports.dayKey(wid, prevWork))) ?prevWork else null;
      if (w.status == #running) { running += 1 };
      if (isDelayed and w.status != #delivered and w.status != #aftercare) { delayed += 1 };
      if (missingRep != null) { missing += 1 };
      let co = switch (confOpenBy.get(wid)) { case (?n) n; case null 0 };
      let cd = switch (confDeclBy.get(wid)) { case (?n) n; case null 0 };
      let warn = List.empty<Text>();
      if (lateN > 0) { warn.add(lateN.toText() # (if (lateN == 1) " taak" else " taken") # " achter op de planning") };
      if (delayIssue.containsKey(wid)) { warn.add("vertraging gemeld") };
      if (cd > 0) { warn.add(cd.toText() # " OA kan niet") };
      switch missingRep { case (?d) { warn.add("geen werfverslag op " # Plan.fmtDay(d)) }; case null {} };
      if (w.leaderPersonId == null and not works.memberships.values().any(func m = m.workId == wid and m.endedAt == null and m.role == #werfleider)) {
        if (w.status == #running or w.status == #planned) { warn.add("geen werfleider") };
      };
      let leaderName = switch (w.leaderPersonId) { case (?l) { let n = Access.personName(access, l); leaders.add(l, n); n }; case null "" };
      cards.add({
        id = wid;
        code = w.code;
        name = w.name;
        city = w.address.city;
        status = w.status;
        leaderId = w.leaderPersonId;
        leaderName;
        parentId = w.parentId;
        start = first;
        end = last;
        percent = if (wsum == 0) 0 else psum / wsum;
        tasksTotal = ts.size();
        tasksLate = lateN;
        tasksDelayed = delayedN;
        tasksThisWeek = weekN;
        confirmOpen = co;
        confirmDeclined = cd;
        openIssues = open;
        nextMilestone = next;
        lastReport = lastRep;
        missingReport = missingRep;
        warnings = warn.toArray();
        delayed = isDelayed;
      });
    };
    var confOpenTotal = 0;
    var confDeclTotal = 0;
    var issuesTotal = 0;
    for (n in confOpenBy.values()) { confOpenTotal += n };
    for (n in confDeclBy.values()) { confDeclTotal += n };
    for (n in issuesBy.values()) { issuesTotal += n };
    let sortedCards = Array.sort<Views.DashWork>(cards.toArray(), func(a, b) = if (a.delayed != b.delayed) (if (a.delayed) #less else #greater) else Text.compare(a.code, b.code));
    let lateSorted = Array.sort<Views.DashTask>(late.toArray(), func(a, b) = Nat.compare(b.lateDays, a.lateDays));
    let weekSorted = Array.sort<Views.DashTask>(week.toArray(), func(a, b) = if (a.start == b.start) Text.compare(a.workCode, b.workCode) else Nat.compare(a.start, b.start));
    let confSorted = Array.sort<Views.DashConfirm>(confirms.toArray(), func(a, b) = if (a.declined != b.declined) (if (a.declined) #less else #greater) else Nat.compare(a.start, b.start));
    {
      day;
      monday;
      counters = { running; delayed; confirmOpen = confOpenTotal; confirmDeclined = confDeclTotal; openIssues = issuesTotal; missingReports = missing; permitsThisMonth = null };
      works = sortedCards;
      late = lateSorted.sliceToArray(0, Nat.min(200, lateSorted.size()));
      thisWeek = weekSorted.sliceToArray(0, Nat.min(200, weekSorted.size()));
      confirmations = confSorted.sliceToArray(0, Nat.min(200, confSorted.size()));
      leaders = Array.sort<Views.PersonRef>(leaders.entries().map(func((id, name) : (Nat, Text)) : Views.PersonRef = { id; name }).toArray(), func(a, b) = Text.compare(a.name, b.name));
      instructions = Nat64.toNat(IC.performanceCounter(0));
    };
  };

  func dbInc(m : Map.Map<Nat, Nat>, k : Nat) { m.add(k, (switch (m.get(k)) { case (?n) n; case null 0 }) + 1) };
  func dbCode(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.code; case null "#" # w.toText() } };
  func dbOrgName(o : Nat) : Text {
    switch (org.orgs.get(o)) { case (?x) { if (x.aliases.size() > 0) x.aliases[0] else x.name }; case null "#" # o.toText() };
  };
  func Int_abs(i : Int) : Nat { Int.abs(i) };
};
