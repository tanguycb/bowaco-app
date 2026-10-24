// Postbode (stap 1b.3, architectuur §6.2–§6.3): de werkwachtrij van de mails. De app maakt opdrachten (jobs) met een
// idempotentiesleutel. Sinds mail-caffeine (E-11) verstuurt de APP ze zelf via de maildienst van Caffeine (lib/Mail.mo);
// de gateway krijgt geen mailopdrachten meer. De inhoud van een mail wordt pas bij het versturen samengesteld uit de
// gegevens van dat moment (een verschoven taak staat er dus juist in), in de taal van de firma. Geen rechten hier; dit
// bestand rekent alleen.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "Access";
import Config "Config";
import Dossier "Dossier";
import MailText "MailText";
import Ids "Ids";
import Plan "Plan";
import Reports "Reports";
import Rights "Rights";

module {
  type Day = Types.Day;

  // ── Belgische tijd (zomeruur: laatste zondag van maart tot laatste zondag van oktober, 01:00 UTC) ──
  func daysFromCivil(y0 : Nat, m : Nat, d : Nat) : Nat {
    let y = if (m <= 2) y0 - 1 else y0;
    let era = y / 400;
    let yoe = y - era * 400;
    let mp = if (m > 2) m - 3 else m + 9;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468;
  };

  func yearOf(day : Nat) : Nat {
    let z = day + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if (mp < 10) mp + 3 else mp - 9;
    yoe + era * 400 + (if (m <= 2) 1 else 0);
  };

  // Laatste zondag van een maand met 31 dagen (maart, oktober).
  func lastSunday(y : Nat, m : Nat) : Nat {
    let d31 = daysFromCivil(y, m, 31);
    let wd = Plan.weekday(d31); // 0 = maandag … 6 = zondag
    d31 - ((wd + 1) % 7);
  };

  public type Local = { day : Day; minute : Nat; weekday : Nat };

  public func local(now : Int) : Local {
    let sec = Int.abs(now) / 1_000_000_000;
    let utcDay = sec / 86_400;
    let y = yearOf(utcDay);
    let start = lastSunday(y, 3) * 86_400 + 3_600;
    let end = lastSunday(y, 10) * 86_400 + 3_600;
    let off = if (sec >= start and sec < end) 7_200 else 3_600;
    let l = sec + off;
    let day = l / 86_400;
    { day; minute = (l % 86_400) / 60; weekday = Plan.weekday(day) };
  };

  public func isoWeek(day : Day) : Text {
    // ISO-week: de donderdag van de week bepaalt het jaar.
    let thu = day - Plan.weekday(day) + 3;
    let y = yearOf(thu);
    let jan1 = daysFromCivil(y, 1, 1);
    let w = (thu - jan1) / 7 + 1;
    y.toText() # "-W" # (if (w < 10) "0" else "") # w.toText();
  };

  // ── Instellingen (settings.values, D8: geen migratie) ────────────────────
  func flag(s : Types.SettingsState, k : Text) : Bool { s.values.get(k) == ?"aan" };
  public func weekmailOn(s : Types.SettingsState) : Bool { flag(s, "post.weekmail") };
  public func remindersOn(s : Types.SettingsState) : Bool { flag(s, "post.herinneringen") };
  public func sendDay(s : Types.SettingsState) : Nat { Dossier.setting(s, "post.dag", 4) }; // vrijdag
  public func sendHour(s : Types.SettingsState) : Nat { Dossier.setting(s, "post.uur", 14) };
  public func reminderDay(s : Types.SettingsState) : Nat { Dossier.setting(s, "post.herinneringDag", 2) }; // woensdag
  public func appUrl(s : Types.SettingsState) : Text { switch (s.values.get("post.appUrl")) { case (?u) u; case null "" } };
  public func optedOut(s : Types.SettingsState, orgId : Nat) : Bool { s.values.get("post.uit:" # orgId.toText()) == ?"ja" };
  // Het adres van het kantoor in de voet van elke mail (antwoorden op de mail kan niet bij Caffeine).
  public func contact(s : Types.SettingsState) : Text { switch (s.values.get("post.contact")) { case (?c) c; case null "" } };

  // De mails verstuurt de app zelf (lib/Mail.mo); geen robot mag ze leasen.
  public func isMail(kind : Text) : Bool {
    kind == "weekplanning" or kind == "herinnering-planning" or kind == "herinnering-uren" or kind == "proef";
  };

  // Welke robotsoort mag een opdracht leasen. Mail: "app" (die soort kan geen robot krijgen, Config.robotKinds).
  public func capability(kind : Text) : Text { if (isMail(kind)) "app" else kind };

  // De taal van de mail aan een firma: de instelling in Postbode, anders de taal van haar eerste contactpersoon met een
  // taal, anders Nederlands. Een proefmail (geen firma) is Nederlands.
  public func lang(c : Ctx, orgId : ?Nat) : Text {
    let o = orgId ?? return "nl";
    switch (c.settings.values.get("post.taal:" # o.toText())) { case (?l) return l; case null {} };
    for (p in c.access.persons.values()) {
      if (p.orgId == ?o and p.archivedAt == null) {
        switch (p.lang) { case (?l) { if (MailText.langs().any(func x = x == l)) return l }; case null {} };
      };
    };
    "nl";
  };

  public func isOpen(st : Types.JobState) : Bool { switch st { case (#queued or #leased _) true; case _ false } };

  // ── Opdrachten maken (idempotent: dezelfde sleutel = dezelfde opdracht) ──
  public func enqueue(ps : Types.PostState, ctr : Types.Counters, kind : Text, key : Text, orgId : ?Nat, personId : ?Nat, workId : ?Nat, ref : Text, createdBy : ?Nat, extra : Types.Extra) : (Nat, Bool) {
    switch (ps.keys.get(key)) { case (?id) return (id, false); case null {} };
    let id = Ids.next(ctr, "job");
    let now = Time.now();
    ps.jobs.add(id, { id; kind; key; orgId; personId; workId; ref; notBefore = now; attempts = 0; state = #queued; createdAt = now; createdBy; updatedAt = now; extra });
    ps.keys.add(key, id);
    ps.open.add(id, ());
    (id, true);
  };

  public func setState(ps : Types.PostState, j : Types.Job, st : Types.JobState, attempts : Nat, notBefore : Int) {
    ps.jobs.add(j.id, { j with state = st; attempts; notBefore; updatedAt = Time.now() });
    if (isOpen(st)) { ps.open.add(j.id, ()) } else { ps.open.remove(j.id) };
  };

  // Wachten na een mislukte poging: 5 min, 10, 20 … hoogstens 6 uur.
  public func backoff(attempt : Nat) : Int {
    var m : Int = 5;
    var i = 1;
    while (i < attempt and m < 360) { m *= 2; i += 1 };
    (if (m > 360) 360 else m) * Config.minute;
  };

  // ── Ontvangers ─────────────────────────────────────────────────────────────
  // Het algemene adres van de firma; anders de adressen van haar contactpersonen (hoogstens 3). Nooit een klant.
  public func orgRecipients(access : Types.AccessState, org : Types.OrgState, oa : Types.OaState, orgId : Nat) : [Views.MailTo] {
    let o = org.orgs.get(orgId) ?? return [];
    if (o.archivedAt != null or o.kind == #client) { return [] };
    switch (oa.orgContacts.get(orgId)) {
      case (?c) { switch (c.email) { case (?e) return [{ name = o.name; email = e }]; case null {} } };
      case null {};
    };
    let out = List.empty<Views.MailTo>();
    for (p in access.persons.values()) {
      if (out.size() < 3 and p.orgId == ?orgId and p.archivedAt == null) {
        switch (oa.personContacts.get(p.id)) {
          case (?pc) { switch (pc.email) { case (?e) out.add({ name = p.name; email = e }); case null {} } };
          case null {};
        };
      };
    };
    out.toArray();
  };

  // ── Inhoud ─────────────────────────────────────────────────────────────────
  public type Ctx = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    org : Types.OrgState;
    oa : Types.OaState;
    works : Types.WorksState;
    plan : Types.PlanState;
    reports : Types.ReportState;
  };

  func dayShort(tx : MailText.T, d : Day) : Text { tx.days[Plan.weekday(d)] # " " # Text.fromIter(Plan.fmtDay(d).chars().take(5)) };

  func workLine(c : Ctx, tx : MailText.T, w : Types.Work) : (Text, Text) {
    let a = w.address;
    let addr = (a.street # " " # a.number).trim(#char ' ') # (if (a.city.size() > 0) ", " # a.city else "");
    let leader = switch (w.leaderPersonId) {
      case (?id) { switch (c.access.persons.get(id)) { case (?p) { tx.leader # " " # p.name # (switch (p.phone) { case (?ph) " (" # ph # ")"; case null "" }) }; case null "" } };
      case null "";
    };
    (w.code # " · " # w.name, addr # (if (leader.size() > 0) " · " # leader else ""));
  };

  func link(c : Ctx, path : Text) : ?Text {
    let u = appUrl(c.settings);
    if (u.size() == 0) null else ?(u # path);
  };

  // De taken van een firma in een periode, per werf (enkel werven die bestaan en niet geannuleerd zijn).
  func orgWeek(c : Ctx, tx : MailText.T, orgId : Nat, from : Day, to : Day, onlyOpen : Bool) : [Views.MailSection] {
    let byWork = Map.empty<Nat, List.List<(Day, Text)>>();
    let cals = Map.empty<Nat, Plan.Cal>();
    for (a in c.plan.assignments.values()) {
      if (a.orgId == orgId and a.archivedAt == null and (not onlyOpen or a.confirmation == #open)) {
        switch (c.plan.tasks.get(a.taskId), c.works.works.get(a.workId)) {
          case (?t, ?w) {
            if (t.archivedAt == null and w.archivedAt == null and w.status != #cancelled and t.status != #done and t.kind != #milestone) {
              let cal = switch (cals.get(w.id)) { case (?x) x; case null { let x = Plan.calFor(c.plan, c.works, w.id); cals.add(w.id, x); x } };
              let end = Plan.endDay(cal, t.start, t.workdays);
              let (s, e) = Plan.assignmentDays(a, t.start, end);
              if (s <= to and e >= from) {
                let l = switch (byWork.get(w.id)) { case (?l) l; case null { let l = List.empty<(Day, Text)>(); byWork.add(w.id, l); l } };
                let open = if (a.confirmation == #open) " · " # tx.toConfirm else switch (a.confirmation) { case (#declined _) " · " # tx.declined; case _ "" };
                l.add((s, dayShort(tx, s) # (if (e != s) " – " # dayShort(tx, e) else "") # " · " # t.title # open));
              };
            };
          };
          case _ {};
        };
      };
    };
    let out = List.empty<Views.MailSection>();
    for ((wid, l) in byWork.entries()) {
      switch (c.works.works.get(wid)) {
        case (?w) {
          let (title, subtitle) = workLine(c, tx, w);
          let lines = l.toArray().sort(func(a : (Day, Text), b : (Day, Text)) : Order.Order = Nat.compare(a.0, b.0)).map(func(x : (Day, Text)) : Text = x.1);
          out.add({ title; subtitle; lines });
        };
        case null {};
      };
    };
    out.toArray();
  };

  // Niet-bevestigde uren van een firma uit afgesloten verslagen, ouder dan 2 dagen, de laatste 60 dagen.
  func openHours(c : Ctx, tx : MailText.T, orgId : Nat, today : Day) : [Views.MailSection] {
    let byWork = Map.empty<Nat, List.List<Text>>();
    let ctx = { works = c.works; settings = c.settings };
    for (a in c.reports.attendances.values()) {
      if (a.orgId == ?orgId and a.archivedAt == null and a.replacedBy == null and a.day + 2 <= today and a.day + 60 >= today and not c.reports.confirmations.containsKey(a.id)) {
        switch (c.reports.reports.get(a.reportId)) {
          case (?r) {
            // Enkel waar de firma uren mag bevestigen (R9): een persoon van die firma met de grant op die werf.
            let canConfirm = c.access.persons.values().any(func p = p.archivedAt == null and p.orgId == ?orgId and Rights.grant(ctx, p, a.workId, #confirmHours));
            if (Reports.isFinal(r) and canConfirm) {
              let l = switch (byWork.get(a.workId)) { case (?l) l; case null { let l = List.empty<Text>(); byWork.add(a.workId, l); l } };
              l.add(dayShort(tx, a.day) # " · " # (if (a.names.size() > 0) a.names # " · " else "") # Reports.duration(a.minutesTotal));
            };
          };
          case null {};
        };
      };
    };
    let out = List.empty<Views.MailSection>();
    for ((wid, l) in byWork.entries()) {
      switch (c.works.works.get(wid)) { case (?w) { let (title, subtitle) = workLine(c, tx, w); out.add({ title; subtitle; lines = l.toArray() }) }; case null {} };
    };
    out.toArray();
  };

  // De mail van een opdracht, zoals ze NU verstuurd zou worden, in de taal van de firma. #skip = niets te versturen
  // (geen adres, niets gepland, firma afgemeld): de opdracht wordt dan afgesloten zonder mail.
  public func render(c : Ctx, j : Types.Job, today : Day) : { #mail : Views.MailOut; #skip : Text } {
    let tx = MailText.of(lang(c, if (j.kind == "proef") null else j.orgId));
    if (j.kind == "proef") {
      let to = switch (j.extra.find(func(x : (Text, Text)) : Bool = x.0 == "aan")) { case (?(_, e)) e; case null return #skip("geen adres") };
      return #mail({
        to = [{ name = ""; email = to }];
        subject = tx.testSubject;
        preheader = tx.testPre;
        heading = tx.testHeading;
        intro = tx.testIntro(j.id.toText());
        sections = [];
        outro = tx.testOutro;
        link = link(c, "");
        tag = "proef";
      });
    };
    let orgId = j.orgId ?? return #skip("geen firma");
    if (optedOut(c.settings, orgId)) { return #skip("firma ontvangt geen mails") };
    let to = orgRecipients(c.access, c.org, c.oa, orgId);
    if (to.size() == 0) { return #skip("geen e-mailadres bij de firma") };
    let name = switch (c.org.orgs.get(orgId)) { case (?o) o.name; case null "" };
    let monday = Nat.fromText(j.ref) ?? return #skip("geen week");
    // Nooit een verouderde mail (na een lange onderbreking of een herstel): de week is voorbij of de herinnering te oud.
    if (j.kind == "weekplanning" and monday + 5 <= today) { return #skip("de week is voorbij") };
    if (j.kind != "weekplanning" and monday + 7 <= today) { return #skip("herinnering van een vorige week") };
    switch (j.kind) {
      case "weekplanning" {
        let secs = orgWeek(c, tx, orgId, monday, monday + 4, false);
        if (secs.size() == 0) { return #skip("niets gepland in die week") };
        #mail({
          to;
          subject = tx.weekSubject(isoWeek(monday), Text.fromIter(Plan.fmtDay(monday).chars().take(5)), Plan.fmtDay(monday + 4));
          preheader = tx.weekPre;
          heading = tx.weekHeading(isoWeek(monday));
          intro = tx.weekIntro(name, Plan.fmtDay(monday), Plan.fmtDay(monday + 4));
          sections = secs;
          outro = tx.weekOutro;
          link = link(c, "#/week");
          tag = "weekplanning";
        });
      };
      case "herinnering-planning" {
        let secs = orgWeek(c, tx, orgId, today, today + 14, true);
        if (secs.size() == 0) { return #skip("niets meer te bevestigen") };
        #mail({
          to;
          subject = tx.remPlanSubject;
          preheader = tx.remPlanPre;
          heading = tx.remPlanHeading;
          intro = tx.remPlanIntro(name);
          sections = secs;
          outro = tx.remPlanOutro;
          link = link(c, "#/week");
          tag = "herinnering";
        });
      };
      case "herinnering-uren" {
        let secs = openHours(c, tx, orgId, today);
        if (secs.size() == 0) { return #skip("geen uren meer te bevestigen") };
        #mail({
          to;
          subject = tx.remHoursSubject;
          preheader = tx.remHoursPre;
          heading = tx.remHoursHeading;
          intro = tx.remHoursIntro(name);
          sections = secs;
          outro = tx.remHoursOutro;
          link = link(c, "#/uren");
          tag = "herinnering";
        });
      };
      case _ #skip("onbekende soort");
    };
  };

  // ── Wie krijgt een weekmail of herinnering? ───────────────────────────────
  // Firma's met een (niet-gearchiveerde) toewijzing in die periode op een werf die niet geannuleerd is.
  public func orgsWithWork(c : Ctx, from : Day, to : Day, onlyOpen : Bool) : [Nat] {
    let seen = Map.empty<Nat, ()>();
    let cals = Map.empty<Nat, Plan.Cal>();
    for (a in c.plan.assignments.values()) {
      if (a.archivedAt == null and not seen.containsKey(a.orgId) and (not onlyOpen or a.confirmation == #open)) {
        switch (c.plan.tasks.get(a.taskId), c.works.works.get(a.workId)) {
          case (?t, ?w) {
            if (t.archivedAt == null and w.archivedAt == null and w.status != #cancelled and t.status != #done and t.start <= to and t.start + 600 >= from) {
              let cal = switch (cals.get(w.id)) { case (?x) x; case null { let x = Plan.calFor(c.plan, c.works, w.id); cals.add(w.id, x); x } };
              let (s, e) = Plan.assignmentDays(a, t.start, Plan.endDay(cal, t.start, t.workdays));
              if (s <= to and e >= from) { seen.add(a.orgId, ()) };
            };
          };
          case _ {};
        };
      };
    };
    seen.keys().toArray();
  };

  public func orgsWithOpenHours(c : Ctx) : [Nat] {
    let seen = Map.empty<Nat, ()>();
    for (a in c.reports.attendances.values()) {
      switch (a.orgId) { case (?o) { if (a.archivedAt == null and not c.reports.confirmations.containsKey(a.id)) { seen.add(o, ()) } }; case null {} };
    };
    seen.keys().toArray();
  };

  public func jobView(access : Types.AccessState, org : Types.OrgState, j : Types.Job) : Views.JobView {
    {
      id = j.id;
      kind = j.kind;
      key = j.key;
      orgId = j.orgId;
      orgName = switch (j.orgId) { case (?o) { switch (org.orgs.get(o)) { case (?x) x.name; case null "" } }; case null "" };
      ref = j.ref;
      state = j.state;
      attempts = j.attempts;
      notBefore = j.notBefore;
      createdAt = j.createdAt;
      createdByName = switch (j.createdBy) { case (?p) Access.personName(access, p); case null "timer" };
      updatedAt = j.updatedAt;
    };
  };

  // ── Klaarzetten (admin en timer) ───────────────────────────────────────────
  public func queueWeek(c : Ctx, ps : Types.PostState, ctr : Types.Counters, monday : Nat, only : ?Nat, by : ?Nat) : Nat {
    var n = 0;
    for (o in orgsWithWork(c, monday, monday + 4, false).values()) {
      if (not optedOut(c.settings, o) and (only == null or only == ?o)) {
        let (_, fresh) = enqueue(ps, ctr, "weekplanning", "weekplanning:org" # o.toText() # ":" # isoWeek(monday), ?o, null, null, monday.toText(), by, []);
        if fresh { n += 1 };
      };
    };
    n;
  };

  public func queueReminders(c : Ctx, ps : Types.PostState, ctr : Types.Counters, monday : Nat, by : ?Nat) : Nat {
    var n = 0;
    let today = local(Time.now()).day;
    for (o in orgsWithWork(c, today, today + 14, true).values()) {
      if (not optedOut(c.settings, o)) {
        let (_, fresh) = enqueue(ps, ctr, "herinnering-planning", "herinnering-planning:org" # o.toText() # ":" # isoWeek(monday), ?o, null, null, monday.toText(), by, []);
        if fresh { n += 1 };
      };
    };
    for (o in orgsWithOpenHours(c).values()) {
      if (not optedOut(c.settings, o)) {
        let (_, fresh) = enqueue(ps, ctr, "herinnering-uren", "herinnering-uren:org" # o.toText() # ":" # isoWeek(monday), ?o, null, null, monday.toText(), by, []);
        if fresh { n += 1 };
      };
    };
    n;
  };

  // Timer (main.mo, elke 10 min): verlopen leases terug (een lease van de app zelf: "onzeker"), en op het ingestelde moment de weekmails (planning van
  // VOLGENDE week) en de herinneringen (één keer per week). Begrensd: enkel de open opdrachten.
  public func tick(c : Ctx, ps : Types.PostState, audit : Types.AuditState, ctr : Types.Counters) {
    let now = Time.now();
    let l = local(now);
    let ids = ps.open.keys().toArray();
    for (id in ids.values()) {
      switch (ps.jobs.get(id)) {
        case (?j) {
          switch (j.state) {
            case (#leased le) {
              if (le.until < now and le.by == Principal.fromText(Config.appSender)) {
                // De app gaf de mail aan de maildienst en kreeg binnen het uur geen antwoord (bv. een val na het
                // versturen): misschien is ze weg. Nooit vanzelf opnieuw (geen dubbele mail); de admin kijkt na.
                setState(ps, j, #failed({ at = now; why = "onzeker: geen antwoord van de maildienst; misschien verstuurd" }), j.attempts, j.notBefore);
                Access.notifyAdmins(c.access, audit, ctr, "postbode", "Mail misschien verstuurd (" # j.kind # ", opdracht #" # id.toText() # "): de maildienst antwoordde niet. Kijk na voor je ze opnieuw zet.");
              } else if (le.until < now) {
                if (j.attempts >= Config.jobMaxAttempts) {
                  setState(ps, j, #failed({ at = now; why = "lease verlopen na " # j.attempts.toText() # " pogingen" }), j.attempts, j.notBefore);
                  Access.notifyAdmins(c.access, audit, ctr, "postbode", "Mail mislukt (" # j.kind # ", opdracht #" # id.toText() # "): de gateway bevestigde niet");
                } else { setState(ps, j, #queued, j.attempts, now) };
              };
            };
            case _ {};
          };
        };
        case null {};
      };
    };
    let monday : Nat = l.day - l.weekday;
    let after = func(wd : Nat) : Bool { l.weekday > wd or (l.weekday == wd and l.minute >= sendHour(c.settings) * 60) };
    if (weekmailOn(c.settings) and after(sendDay(c.settings))) {
      let next = monday + 7;
      if (Dossier.setting(c.settings, "post.laatsteWeek", 0) < next) {
        c.settings.values.add("post.laatsteWeek", next.toText());
        let n = queueWeek(c, ps, ctr, next, null, null);
        Access.audit(audit, Principal.anonymous(), null, null, "postbode-weekmails", isoWeek(next) # ": " # n.toText() # " nieuw (timer)");
      };
    };
    if (remindersOn(c.settings) and after(reminderDay(c.settings))) {
      if (Dossier.setting(c.settings, "post.laatsteHerinnering", 0) < monday) {
        c.settings.values.add("post.laatsteHerinnering", monday.toText());
        let n = queueReminders(c, ps, ctr, monday, null);
        Access.audit(audit, Principal.anonymous(), null, null, "postbode-herinneringen", isoWeek(monday) # ": " # n.toText() # " nieuw (timer)");
      };
    };
  };
};
