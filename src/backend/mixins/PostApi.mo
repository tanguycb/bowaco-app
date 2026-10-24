// Postbode (stap 1b.3, architectuur §6.2–§6.3, R28): werkwachtrij met lease en idempotentiesleutel.
// - De app (timer of admin) maakt opdrachten: weekplanning per OA, herinneringen (planning, uren), een proefmail.
// - De gateway (een robotprincipal met de soort "mail") leaset ze (10 min), krijgt per opdracht ENKEL de mail die
//   ze moet versturen (samengesteld op dat moment), verstuurt met de idempotentiesleutel, en meldt done/fail.
// - Een verlopen lease valt terug in de wachtrij; na 5 mislukte pogingen: mislukt + melding aan de admins.
// De robot leest niets anders: geen vrije query's op personen, werven of planning (R28). Alles staat in de auditlog.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Oa "../lib/Oa";
import Plan "../lib/Plan";
import Post "../lib/Post";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  oa : Types.OaState,
  works : Types.WorksState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  robot : Types.RobotState,
  post : Types.PostState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  func pbCtx() : Post.Ctx { { settings; access; org; oa; works; plan; reports } };

  func pbAdmin(caller : Principal) : Types.Person {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageRobots, null);
    p;
  };

  // ── Robot: lease, klaar, mislukt ──────────────────────────────────────────
  // Hoogstens `max` (≤ 10) opdrachten van de soorten die deze robot mag, waarvan de wachttijd voorbij is.
  public shared ({ caller }) func leaseJobs(max : Nat) : async [Views.JobLease] {
    Access.requireRobot(robot, caller);
    let r = robot.robots.get(caller) ?? return [];
    let now = Time.now();
    post.seen.add(caller, now);
    let today = Post.local(now).day;
    let lim = if (max == 0 or max > 10) 10 else max;
    let out = List.empty<Views.JobLease>();
    // Eerst de sleutels verzamelen (nooit een Map wijzigen tijdens het doorlopen).
    let ids = post.open.keys().toArray();
    label scan for (id in ids.values()) {
      if (out.size() >= lim) { break scan };
      switch (post.jobs.get(id)) {
        case (?j) {
          let allowed = r.kinds.any(func k = k == Post.capability(j.kind));
          let free = switch (j.state) { case (#queued) j.notBefore <= now; case (#leased l) l.until < now; case _ false };
          if (allowed and free) {
            switch (Post.render(pbCtx(), j, today)) {
              case (#skip why) {
                Post.setState(post, j, #done({ at = now; result = "overgeslagen: " # why }), j.attempts, j.notBefore);
                Access.audit(audit, caller, null, j.workId, "post-overgeslagen", "#" # j.id.toText() # " " # j.kind # ": " # why);
              };
              case (#mail m) {
                let attempt = j.attempts + 1;
                let until = now + Config.jobLease;
                Post.setState(post, j, #leased({ by = caller; until; attempt }), attempt, j.notBefore);
                out.add({ id = j.id; kind = j.kind; key = j.key; attempt; leaseUntil = until; mail = m });
              };
            };
          };
        };
        case null {};
      };
    };
    if (out.size() > 0) { Access.audit(audit, caller, null, null, "post-geleaset", out.size().toText() # " opdrachten") };
    out.toArray();
  };

  func pbOwnLease(caller : Principal, id : Nat, attempt : Nat) : Result.Result<Types.Job, Text> {
    let j = post.jobs.get(id) ?? return #err("Onbekende opdracht");
    switch (j.state) {
      case (#leased l) {
        if (l.by != caller or l.attempt != attempt) { return #err("Niet jouw lease (verlopen of door een andere gateway genomen)") };
        #ok(j);
      };
      case (#done _) #err("Al klaar");
      case _ #err("Niet geleaset");
    };
  };

  public shared ({ caller }) func completeJob(id : Nat, attempt : Nat, result : Text) : async Result.Result<(), Text> {
    Access.requireRobot(robot, caller);
    let j = switch (pbOwnLease(caller, id, attempt)) { case (#ok j) j; case (#err e) return #err(e) };
    let res = Text.fromIter(result.chars().take(200));
    Post.setState(post, j, #done({ at = Time.now(); result = res }), j.attempts, j.notBefore);
    // Geen adressen in de auditlog: enkel soort, opdracht en firma.
    Access.audit(audit, caller, null, j.workId, "post-verstuurd", "#" # id.toText() # " " # j.kind # (switch (j.orgId) { case (?o) " firma " # o.toText(); case null "" }));
    #ok;
  };

  public shared ({ caller }) func failJob(id : Nat, attempt : Nat, why : Text, retry : Bool) : async Result.Result<(), Text> {
    Access.requireRobot(robot, caller);
    let j = switch (pbOwnLease(caller, id, attempt)) { case (#ok j) j; case (#err e) return #err(e) };
    let reason = Text.fromIter(why.chars().take(200));
    let now = Time.now();
    if (retry and j.attempts < Config.jobMaxAttempts) {
      Post.setState(post, j, #queued, j.attempts, now + Post.backoff(j.attempts));
      Access.audit(audit, caller, null, j.workId, "post-opnieuw", "#" # id.toText() # " poging " # j.attempts.toText() # ": " # reason);
    } else {
      Post.setState(post, j, #failed({ at = now; why = reason }), j.attempts, j.notBefore);
      Access.audit(audit, caller, null, j.workId, "post-mislukt", "#" # id.toText() # " " # j.kind # ": " # reason);
      Access.notifyAdmins(access, audit, ctr, "postbode", "Mail mislukt (" # j.kind # ", opdracht #" # id.toText() # "): " # reason);
    };
    #ok;
  };

  // ── Admin: instellingen, wachtrij, voorbeeld, proefmail ────────────────────
  public query ({ caller }) func postSettings() : async Views.PostSettingsView {
    ignore pbAdmin(caller);
    pbSettingsView();
  };

  func pbSettingsView() : Views.PostSettingsView {
    var queued = 0;
    var leased = 0;
    for (id in post.open.keys()) { switch (post.jobs.get(id)) { case (?j) { switch (j.state) { case (#queued) queued += 1; case (#leased _) leased += 1; case _ {} } }; case null {} } };
    var failed = 0;
    for ((_, j) in post.jobs.reverseEntries().take(500)) { switch (j.state) { case (#failed _) failed += 1; case _ {} } };
    {
      weekmail = Post.weekmailOn(settings);
      reminders = Post.remindersOn(settings);
      day = Post.sendDay(settings);
      hour = Post.sendHour(settings);
      reminderDay = Post.reminderDay(settings);
      appUrl = Post.appUrl(settings);
      optedOut = settings.values.entries().filter(func((k, v) : (Text, Text)) : Bool = k.startsWith(#text "post.uit:") and v == "ja").filterMap(func((k, _) : (Text, Text)) : ?Nat = Nat.fromText(Text.fromIter(k.chars().drop(9)))).toArray();
      robots = robot.robots.values().filter(func r = r.revokedAt == null).map(func(r : Types.Robot) : Views.RobotSeen = { name = r.name; kinds = r.kinds; lastSeen = post.seen.get(r.principal) }).toArray();
      queued;
      leased;
      failed;
      lastWeek = Dossier.setting(settings, "post.laatsteWeek", 0);
    };
  };

  public shared ({ caller }) func setPostSettings(x : Views.PostSettingsInput) : async Result.Result<Views.PostSettingsView, Text> {
    let p = pbAdmin(caller);
    if (x.day > 6 or x.reminderDay > 6 or x.hour > 23) { return #err("Dag 0–6 (maandag = 0), uur 0–23") };
    let url = x.appUrl.trim(#char ' ');
    if (url.size() > Config.maxUrl or (url.size() > 0 and not url.startsWith(#text "https://"))) { return #err("Adres van de app: https://… (hoogstens 300 tekens)") };
    settings.values.add("post.weekmail", if (x.weekmail) "aan" else "uit");
    settings.values.add("post.herinneringen", if (x.reminders) "aan" else "uit");
    settings.values.add("post.dag", x.day.toText());
    settings.values.add("post.uur", x.hour.toText());
    settings.values.add("post.herinneringDag", x.reminderDay.toText());
    settings.values.add("post.appUrl", url);
    Access.audit(audit, caller, ?p.id, null, "postbode-instellingen", "weekmail " # (if (x.weekmail) "aan" else "uit") # ", herinneringen " # (if (x.reminders) "aan" else "uit") # ", dag " # x.day.toText() # " " # x.hour.toText() # " u");
    #ok(pbSettingsView());
  };

  // Een firma krijgt geen mails meer (of weer wel).
  public shared ({ caller }) func setOrgMail(orgId : Nat, on : Bool) : async Result.Result<(), Text> {
    let p = pbAdmin(caller);
    if (not org.orgs.containsKey(orgId)) { return #err("Onbekende firma") };
    settings.values.add("post.uit:" # orgId.toText(), if on "nee" else "ja");
    Access.audit(audit, caller, ?p.id, null, "postbode-firma", "firma " # orgId.toText() # (if on " krijgt mails" else " krijgt geen mails"));
    #ok;
  };

  public query ({ caller }) func listJobs(filter : Text, from : Nat, limit : Nat) : async [Views.JobView] {
    ignore pbAdmin(caller);
    let xs = post.jobs.reverseEntries().map(func((_, j) : (Nat, Types.Job)) : Types.Job = j).filter(
      func j = switch filter {
        case "open" Post.isOpen(j.state);
        case "mislukt" (switch (j.state) { case (#failed _) true; case _ false });
        case _ true;
      }
    ).take(2_000).map(func j = Post.jobView(access, org, j)).toArray();
    Access.page(xs, from, limit);
  };

  // Hoe de mail er NU uitziet (niets aangemaakt, niets verstuurd). Voor een firma en een week (maandag), of een proefmail.
  public query ({ caller }) func previewMail(kind : Text, orgId : ?Nat, monday : Nat) : async Result.Result<Views.MailOut, Text> {
    ignore pbAdmin(caller);
    let now = Time.now();
    let j : Types.Job = { id = 0; kind; key = ""; orgId; personId = null; workId = null; ref = monday.toText(); notBefore = now; attempts = 0; state = #queued; createdAt = now; createdBy = null; updatedAt = now; extra = [("aan", "voorbeeld@bowaco.invalid")] };
    switch (Post.render(pbCtx(), j, Post.local(now).day)) { case (#mail m) #ok(m); case (#skip why) #err("Geen mail: " # why) };
  };

  // De weekmails voor een week nu klaarzetten (zoals de timer op vrijdag doet), voor alle firma's of voor één firma.
  // Idempotent: een tweede keer = 0 nieuw.
  public shared ({ caller }) func queueWeekMails(monday : Nat, orgId : ?Nat) : async Result.Result<Nat, Text> {
    let p = pbAdmin(caller);
    if (Plan.weekday(monday) != 0 or monday < Config.minDay or monday > Config.maxDay) { return #err("Kies een maandag") };
    switch orgId { case (?o) { if (not org.orgs.containsKey(o)) { return #err("Onbekende firma") } }; case null {} };
    let n = Post.queueWeek(pbCtx(), post, ctr, monday, orgId, ?p.id);
    Access.audit(audit, caller, ?p.id, null, "postbode-weekmails", Post.isoWeek(monday) # ": " # n.toText() # " nieuw");
    #ok(n);
  };

  public shared ({ caller }) func queueReminders(monday : Nat) : async Result.Result<Nat, Text> {
    let p = pbAdmin(caller);
    if (Plan.weekday(monday) != 0 or monday < Config.minDay or monday > Config.maxDay) { return #err("Kies een maandag") };
    let n = Post.queueReminders(pbCtx(), post, ctr, monday, ?p.id);
    Access.audit(audit, caller, ?p.id, null, "postbode-herinneringen", Post.isoWeek(monday) # ": " # n.toText() # " nieuw");
    #ok(n);
  };

  // Een proefmail naar één adres (de eigenaar zelf, na het instellen van de maildienst en de DNS).
  public shared ({ caller }) func queueTestMail(email : Text) : async Result.Result<Nat, Text> {
    let p = pbAdmin(caller);
    let e = switch (Oa.normEmail(?email)) { case (#ok (?e)) e; case (#ok null) return #err("Geef een e-mailadres"); case (#err e) return #err(e) };
    let (id, _) = Post.enqueue(post, ctr, "proef", "proef:" # Int.toText(Time.now()), null, ?p.id, null, "", ?p.id, [("aan", e)]);
    Access.audit(audit, caller, ?p.id, null, "postbode-proefmail", "#" # id.toText());
    #ok(id);
  };

  public shared ({ caller }) func cancelJob(id : Nat) : async Result.Result<(), Text> {
    let p = pbAdmin(caller);
    let j = post.jobs.get(id) ?? return #err("Onbekende opdracht");
    if (not Post.isOpen(j.state)) { return #err("Niet meer open") };
    Post.setState(post, j, #cancelled({ by = p.id; at = Time.now() }), j.attempts, j.notBefore);
    Access.audit(audit, caller, ?p.id, null, "post-geannuleerd", "#" # id.toText());
    #ok;
  };

  public shared ({ caller }) func retryJob(id : Nat) : async Result.Result<(), Text> {
    let p = pbAdmin(caller);
    let j = post.jobs.get(id) ?? return #err("Onbekende opdracht");
    switch (j.state) { case (#failed _) {}; case _ return #err("Enkel een mislukte opdracht") };
    Post.setState(post, j, #queued, 0, Time.now());
    Access.audit(audit, caller, ?p.id, null, "post-opnieuw-gezet", "#" # id.toText());
    #ok;
  };
};
