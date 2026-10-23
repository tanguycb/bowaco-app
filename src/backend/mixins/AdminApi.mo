// Instellingen, robots, auditlog, meldingen en export (R17, R18, §3 export).
import Array "mo:core/Array";
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
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  files : Types.FileState,
  robot : Types.RobotState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Instellingen ─────────────────────────────────────────────────────────
  public query ({ caller }) func getSettings() : async Views.SettingsView {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readTeam, null);
    { werfleiderZietAlles = settings.werfleiderZietAlles; inviteDays = settings.inviteDays };
  };

  public shared ({ caller }) func setSettings(s : Views.SettingsView) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (s.inviteDays == 0 or s.inviteDays > Config.inviteDaysMax) { return #err("Geldigheid: 1 tot " # Config.inviteDaysMax.toText() # " dagen") };
    let before = (settings.werfleiderZietAlles, settings.inviteDays);
    settings.werfleiderZietAlles := s.werfleiderZietAlles;
    settings.inviteDays := s.inviteDays;
    Access.audit(audit, caller, ?p.id, null, "instellingen", "werfleider ziet alles " # debug_show (before.0) # " → " # debug_show (s.werfleiderZietAlles) # "; codes " # before.1.toText() # " → " # s.inviteDays.toText() # " dagen");
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
      works = works.works.values().map(func w = { id = w.id; code = w.code; name = w.name; address = w.address; parentId = w.parentId; clientOrgId = w.clientOrgId; architectOrgId = w.architectOrgId; leaderPersonId = w.leaderPersonId; status = w.status; vatBp = w.vatBp; createdAt = w.createdAt; createdBy = w.createdBy; archivedAt = w.archivedAt }).toArray();
      memberships = works.memberships.values().map(func m = { id = m.id; workId = m.workId; personId = m.personId; orgId = m.orgId; name = ""; archived = false; role = m.role; grants = m.grants; grantedAt = m.grantedAt; grantedBy = m.grantedBy; endedAt = m.endedAt }).toArray();
      files = files.files.values().map(func f = { id = f.id; name = f.name; mime = f.mime; size = f.size; blob = if (f.confidential) null else ?f.blob; workId = f.workId; confidential = f.confidential; personId = f.personId; at = f.at }).toArray();
      robots = robot.robots.values().map(robotView).toArray();
      proposals = robot.proposals.values().map(func x = { id = x.id; ticketId = x.ticketId; personId = x.personId; workId = x.workId; kind = x.kind; content = x.content; by = x.by; at = x.at; decision = x.decision }).toArray();
      settings = { werfleiderZietAlles = settings.werfleiderZietAlles; inviteDays = settings.inviteDays };
      auditCount = audit.log.size();
    };
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
      files = files.files.values().filter(func f = f.confidential).map(func f = { id = f.id; name = f.name; mime = f.mime; size = f.size; blob = ?f.blob; workId = f.workId; confidential = true; personId = f.personId; at = f.at }).toArray();
    };
  };

  func robotView(r : Types.Robot) : Views.RobotView {
    { principal = r.principal; name = r.name; kinds = r.kinds; addedAt = r.addedAt; addedBy = r.addedBy; revokedAt = r.revokedAt };
  };
};
