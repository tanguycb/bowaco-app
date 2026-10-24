// Toegang (bouwplan §3.3): opstartcode, uitnodigings- en herstelcodes, bevestigen, intrekken.
// Elke functie: requireActive → Rights → lib → audit. Codes: alleen de hash, nooit in de auditlog.
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Codes "../lib/Codes";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  robot : Types.RobotState,
  audit : Types.AuditState,
  ctr : Types.Counters,
  org : Types.OrgState,
) {

  // Caffeine's loginpakket (@caffeineai/core-infrastructure) roept dit na elke II-login aan; het
  // hoort bij Caffeine's eigen rechtenpakket, dat BOWACO niet gebruikt. Bewust leeg en zonder
  // toestand: zonder deze functie eindigt de login als fout (0.2, test T1). Niet weghalen.
  public shared func _initialize_access_control() : async () {};

  public query ({ caller }) func me() : async Views.MeView {
    let ctx = { works; settings };
    if (caller.isAnonymous()) {
      return { principal = caller; status = #anonymous; person = null; caps = null; isRobot = false; blockedUntil = null; version = Config.version };
    };
    let blocked = Access.blockedUntil(access, caller);
    let isRobot = Access.isRobot(robot, caller);
    switch (access.links.get(caller)) {
      case (?l) {
        let person = access.persons.get(l.personId);
        let archived = switch person { case (?p) p.archivedAt != null; case null true };
        if (l.status == #revoked or archived) {
          return { principal = caller; status = #unlinked; person = null; caps = null; isRobot; blockedUntil = blocked; version = Config.version };
        };
        let active = l.status == #active;
        {
          principal = caller;
          status = if active #active else #pending;
          person = switch person { case (?p) ?Access.personView(p); case null null };
          caps = if active { switch person { case (?p) ?Rights.caps(ctx, p); case null null } } else null;
          isRobot;
          blockedUntil = blocked;
          version = Config.version;
        };
      };
      case null {
        { principal = caller; status = #unlinked; person = null; caps = null; isRobot; blockedUntil = blocked; version = Config.version };
      };
    };
  };

  // Eerste installatie: wie de opstartcode heeft, wordt de eerste admin. Daarna is de code ongeldig.
  public shared ({ caller }) func claimBootstrap(code : Text, name : Text) : async Result.Result<Views.PersonView, Text> {
    Access.requireAuthenticated(caller);
    // R28 (1.9): een robotprincipal is nooit een persoon.
    if (Access.isRobot(robot, caller)) { return #err("Geen toegang: een robot is geen persoon") };
    if (not mayStartLink(caller)) { return #err("Deze login is al gekoppeld") };
    switch (Access.blockedUntil(access, caller)) {
      case (?until) { return #err("Te veel pogingen; probeer opnieuw na " # until.toText()) };
      case null {};
    };
    let body = Codes.normalize(code);
    let ok = switch body {
      case (?b) { b.size() == Codes.bootstrapLength and Codes.hex(Codes.hash(b)) == Config.bootstrapHashHex and not access.bootstrapUsed };
      case null false;
    };
    if (not ok) {
      failure(caller, "opstartcode-fout", "");
      return #err("Code ongeldig of al gebruikt");
    };
    let cleanName = Access.cleanText(name, Config.maxName) ?? "Beheerder";
    let id = Ids.next(ctr, "person");
    let now = Time.now();
    let person : Types.Person = {
      id;
      name = cleanName;
      roles = [#admin];
      orgId = null;
      shortCode = null;
      lang = ?"nl";
      phone = null;
      createdAt = now;
      createdBy = 0;
      var archivedAt = null;
      extra = [];
    };
    access.persons.add(id, person);
    putLink(caller, id, Codes.hint(switch body { case (?b) b; case null "" }), 0, "opstartcode", #active);
    access.bootstrapUsed := true;
    Access.audit(audit, caller, ?id, null, "opstartcode-geclaimd", cleanName);
    #ok(Access.personView(person));
  };

  // Admin (alle rollen) of werfleider (externen, voor werven die hij ziet) maakt een persoon + code.
  public shared ({ caller }) func invitePerson(req : Views.InviteRequest) : async Result.Result<Views.NewCode, Text> {
    let inviter = Access.requireActive(access, caller);
    // Eerst de rechten, dan de invoer: wie niet mag, hoort niets over de invoer.
    if (not Rights.mayInvite({ works; settings }, inviter, req.roles, req.workIds)) {
      return #err("Geen toegang voor deze rol(len) of werf/werven");
    };
    let name = Access.cleanText(req.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    if (req.roles.size() > Config.maxRoles) { return #err("Te veel rollen") };
    if (req.workIds.size() > Config.maxWorkIdsPerInvite) { return #err("Te veel werven") };
    switch (req.orgId) {
      case (?o) { if (not orgExists(o)) { return #err("Onbekende organisatie") } };
      case null {};
    };
    let orgKind = switch (req.orgId) { case (?o) { switch (org.orgs.get(o)) { case (?x) ?x.kind; case null null } }; case null null };
    switch (Rights.orgRuleError(req.roles, orgKind)) { case (?e) return #err(e); case null {} };
    // II-test (R15, §4.1 seesWork): werven bij een uitnodiging gelden voor externe rollen (lid van de werf) en voor
    // een werfleider (werfleider van die werf, telt als "werfleider ziet alles" uit staat). Beheerder en calculator
    // zien alle werven: werven meegeven is dan een vergissing, geen stil genegeerde keuze.
    if (req.workIds.size() > 0) {
      if (not req.roles.any(func r = Rights.usesWorks(r))) { return #err("Werven gelden enkel voor een werfleider of een externe rol: een beheerder of calculator ziet alle werven. Laat de werven leeg.") };
      for (w in req.workIds.values()) { if (not works.works.containsKey(w)) { return #err("Onbekende werf") } };
    };
    let entropy = await Random.blob();
    // R33: na de await opnieuw nakijken; de uitnodiger kan intussen afgezet zijn.
    let again = Access.activePerson(access, caller) ?? return #err("Geen toegang meer");
    if (not Rights.mayInvite({ works; settings }, again, req.roles, req.workIds)) { return #err("Geen toegang meer") };
    let now = Time.now();
    let id = Ids.next(ctr, "person");
    let person : Types.Person = {
      id;
      name;
      roles = dedupRoles(req.roles);
      orgId = req.orgId;
      shortCode = Access.optText(req.shortCode, Config.maxShort);
      lang = Access.optText(req.lang, 5);
      phone = Access.optText(req.phone, 30);
      createdAt = now;
      createdBy = again.id;
      var archivedAt = null;
      extra = [];
    };
    access.persons.add(id, person);
    // Uitnodiging voor een werf = meteen lid (met de standaardrechten per rol): externen, en een werfleider als
    // werfleider van die werf (interne rol: telt pas na de bevestiging door een andere admin, want dan pas actief).
    for (w in req.workIds.values()) {
      for (r in person.roles.values()) {
        if (Rights.usesWorks(r)) {
          let mid = Ids.next(ctr, "membership");
          let m : Types.Membership = { id = mid; workId = w; personId = ?id; orgId = null; role = r; grants = Rights.defaultGrants(r); grantedAt = now; grantedBy = again.id; var endedAt = null; var endedBy = null };
          works.memberships.add(mid, m);
          Access.audit(audit, caller, ?again.id, ?w, "lid-toegevoegd", Rights.roleKey(r) # " #" # mid.toText() # " (uitnodiging " # name # ")");
        };
      };
    };
    let tag = Access.cleanText(req.tag, Config.maxLabel) ?? "";
    let code = newCode(id, #invite, again.id, req.validDays, tag, req.workIds, entropy);
    Access.audit(audit, caller, ?again.id, null, "uitnodiging-gemaakt", name # " " # rolesText(person.roles) # " (code …" # Codes.hint(code.body) # ")");
    // R15: nodigt een werfleider een externe uit, dan krijgen de admins een melding (bouwplan §3.2).
    acInviteNotice(again, name, person.roles, req.workIds);
    #ok({ inviteId = code.id; personId = id; code = Codes.display(code.body); expiresAt = code.expiresAt });
  };

  // 1.7: een BESTAANDE externe persoon (bv. een contactpersoon uit de OA-database, nog zonder login) uitnodigen,
  // zonder een dubbele persoon te maken. Admin, of een werfleider voor de werven die hij ziet (R15). Wie al een
  // actieve login heeft, krijgt geen code: die voeg je in het team aan de werf toe.
  public shared ({ caller }) func inviteExistingPerson(i : Views.ExistingInvite) : async Result.Result<Views.NewCode, Text> {
    let inviter = Access.requireActive(access, caller);
    let ctx = { works; settings };
    // Eerst de rechten (wie geen externen mag uitnodigen, hoort niets over de persoon), dan de invoer.
    Rights.require(ctx, inviter, #inviteExternal, null);
    let p = access.persons.get(i.personId) ?? return #err("Onbekende persoon");
    if (not Rights.mayInvite(ctx, inviter, p.roles, i.workIds)) { return #err("Geen toegang voor deze persoon of werf/werven") };
    if (p.archivedAt != null) { return #err("Persoon is afgezet") };
    if (p.roles.size() == 0 or not p.roles.all(Rights.isExternalRole)) { return #err("Enkel een externe persoon (OA, architect, …); een interne persoon krijgt een herstelcode van de admin") };
    if (p.orgId == null) { return #err("Deze persoon hoort bij geen firma") };
    if (Access.hasActiveLink(access, p.id)) { return #err("Deze persoon heeft al een login: voeg hem in het team aan de werf toe") };
    if (i.workIds.size() > Config.maxWorkIdsPerInvite) { return #err("Te veel werven") };
    let entropy = await Random.blob();
    // R33: na de await opnieuw nakijken.
    let again = Access.activePerson(access, caller) ?? return #err("Geen toegang meer");
    if (not Rights.mayInvite(ctx, again, p.roles, i.workIds)) { return #err("Geen toegang meer") };
    let now = Time.now();
    for (w in i.workIds.values()) {
      for (r in p.roles.values()) {
        let already = works.memberships.values().any(func m = m.workId == w and m.personId == ?p.id and m.role == r and m.endedAt == null);
        if (not already) {
          let mid = Ids.next(ctr, "membership");
          let m : Types.Membership = { id = mid; workId = w; personId = ?p.id; orgId = null; role = r; grants = Rights.defaultGrants(r); grantedAt = now; grantedBy = again.id; var endedAt = null; var endedBy = null };
          works.memberships.add(mid, m);
          Access.audit(audit, caller, ?again.id, ?w, "lid-toegevoegd", Rights.roleKey(r) # " #" # mid.toText() # " (uitnodiging " # p.name # ")");
        };
      };
    };
    let code = newCode(p.id, #invite, again.id, i.validDays, Access.cleanText(i.tag, Config.maxLabel) ?? "", i.workIds, entropy);
    Access.audit(audit, caller, ?again.id, null, "uitnodiging-gemaakt", p.name # " " # rolesText(p.roles) # " (bestaande persoon, code …" # Codes.hint(code.body) # ")");
    acInviteNotice(again, p.name, p.roles, i.workIds);
    #ok({ inviteId = code.id; personId = p.id; code = Codes.display(code.body); expiresAt = code.expiresAt });
  };

  func acInviteNotice(inviter : Types.Person, name : Text, roles : [Types.Role], workIds : [Nat]) {
    if (Rights.isAdmin(inviter)) { return };
    let codes = workIds.map<Nat, Text>(func w = switch (works.works.get(w)) { case (?x) x.code; case null "#" # w.toText() });
    Access.notifyAdmins(access, audit, ctr, "uitnodiging", inviter.name # " nodigde " # name # " uit als " # Text.join(roles.map<Types.Role, Text>(Rights.roleKey).values(), ", ") # (if (codes.size() > 0) " voor " # Text.join(codes.values(), ", ") else ""));
  };

  // Herstelcode: een extra principal voor een bestaande persoon (nieuw toestel, verloren passkey, live na draft).
  public shared ({ caller }) func createRecoveryCode(personId : Nat, validDays : Nat, tag : Text) : async Result.Result<Views.NewCode, Text> {
    let admin = Access.requireActive(access, caller);
    Rights.require({ works; settings }, admin, #manageAccess, null);
    let p = access.persons.get(personId) ?? return #err("Onbekende persoon");
    if (p.archivedAt != null) { return #err("Persoon is afgezet") };
    let entropy = await Random.blob();
    let again = Access.activePerson(access, caller) ?? return #err("Geen toegang meer");
    if (not Rights.may({ works; settings }, again, #manageAccess, null)) { return #err("Geen toegang meer") };
    let code = newCode(personId, #recovery, again.id, validDays, Access.cleanText(tag, Config.maxLabel) ?? "", [], entropy);
    Access.audit(audit, caller, ?again.id, null, "herstelcode-gemaakt", p.name # " (code …" # Codes.hint(code.body) # ")");
    #ok({ inviteId = code.id; personId; code = Codes.display(code.body); expiresAt = code.expiresAt });
  };

  // De persoon voert de code in na de II-login. Geen await: alles in één bericht (T12).
  public shared ({ caller }) func redeemCode(code : Text) : async Result.Result<Views.MeView, Text> {
    Access.requireAuthenticated(caller);
    // R28 (1.9): een robotprincipal is nooit een persoon, ook niet met een geldige code.
    if (Access.isRobot(robot, caller)) { return #err("Geen toegang: een robot is geen persoon") };
    if (not mayStartLink(caller)) { return #err("Deze login is al gekoppeld") };
    switch (Access.blockedUntil(access, caller)) {
      case (?until) { return #err("Te veel pogingen; probeer opnieuw na " # until.toText()) };
      case null {};
    };
    let fail = func(why : Text) : Result.Result<Views.MeView, Text> {
      failure(caller, "code-fout", why);
      #err("Code ongeldig, verlopen of al gebruikt");
    };
    let body = Codes.normalize(code) ?? return fail("vorm");
    if (body.size() != Codes.inviteLength) { return fail("vorm") };
    let id = access.codeIndex.get(Codes.hash(body)) ?? return fail("onbekend");
    let inv = access.invites.get(id) ?? return fail("onbekend");
    if (inv.state != #open) { return fail("niet open (#" # id.toText() # ")") };
    let now = Time.now();
    if (now > inv.expiresAt) {
      inv.state := #expired({ at = now });
      return fail("verlopen (#" # id.toText() # ")");
    };
    let person = access.persons.get(inv.personId) ?? return fail("persoon weg");
    if (person.archivedAt != null) { return fail("persoon afgezet (#" # id.toText() # ")") };
    inv.state := #used({ by = caller; at = now });
    let pending = Rights.needsConfirmation(person.roles);
    putLink(caller, person.id, inv.hint, inv.id, inv.tag, if pending #pending else #active);
    let what = person.name # " koppelde zich met code …" # inv.hint # (if pending " (wacht op bevestiging)" else "");
    Access.audit(audit, caller, ?person.id, null, "code-gebruikt", what);
    // T2: de uitnodiger én de admins zien wie zich koppelde.
    Access.notifyAdmins(access, audit, ctr, if pending "bevestigen" else "gekoppeld", what);
    if (Access.activeAdminIds(access).find(func a = a == inv.createdBy) == null) {
      Access.notify(audit, ctr, inv.createdBy, "gekoppeld", what, null);
    };
    let ctx = { works; settings };
    #ok({
      principal = caller;
      status = if pending #pending else #active;
      person = ?Access.personView(person);
      caps = if pending null else ?Rights.caps(ctx, person);
      isRobot = false;
      blockedUntil = null;
      version = Config.version;
    });
  };

  public shared ({ caller }) func confirmLink(p : Principal) : async Result.Result<(), Text> {
    let admin = Access.requireActive(access, caller);
    Rights.require({ works; settings }, admin, #confirmLinks, null);
    let link = access.links.get(p) ?? return #err("Onbekende koppeling");
    if (link.status != #pending) { return #err("Deze koppeling wacht niet op bevestiging") };
    if (link.personId == admin.id) { return #err("Je kunt je eigen koppeling niet bevestigen") };
    link.status := #active;
    link.confirmedBy := ?admin.id;
    link.confirmedAt := ?Time.now();
    Access.audit(audit, caller, ?admin.id, null, "koppeling-bevestigd", Access.personName(access, link.personId) # " " # p.toText());
    #ok;
  };

  // Afzetten van één principal werkt meteen: de volgende call wordt geweigerd. Nooit wissen (D2).
  public shared ({ caller }) func revokeLink(p : Principal) : async Result.Result<(), Text> {
    let admin = Access.requireActive(access, caller);
    Rights.require({ works; settings }, admin, #manageAccess, null);
    if (p == caller) { return #err("Je kunt je eigen login niet afzetten") };
    let link = access.links.get(p) ?? return #err("Onbekende koppeling");
    if (link.status == #revoked) { return #err("Al ingetrokken") };
    if (link.status == #active and Rights.isLastActiveAdmin(Access.activeAdminIds(access), link.personId) and countActiveLinks(link.personId) <= 1) {
      return #err("Dit is de laatste login van de laatste admin");
    };
    link.status := #revoked;
    link.revokedBy := ?admin.id;
    link.revokedAt := ?Time.now();
    Access.audit(audit, caller, ?admin.id, null, "koppeling-ingetrokken", Access.personName(access, link.personId) # " " # p.toText());
    #ok;
  };

  public shared ({ caller }) func setLinkLabel(p : Principal, tag : Text) : async Result.Result<(), Text> {
    let admin = Access.requireActive(access, caller);
    Rights.require({ works; settings }, admin, #manageAccess, null);
    let link = access.links.get(p) ?? return #err("Onbekende koppeling");
    link.tag := Access.cleanText(tag, Config.maxLabel) ?? "";
    Access.audit(audit, caller, ?admin.id, null, "koppeling-naam", Access.personName(access, link.personId) # ": " # link.tag);
    #ok;
  };

  public shared ({ caller }) func revokeInvite(inviteId : Nat) : async Result.Result<(), Text> {
    let who = Access.requireActive(access, caller);
    // Admin trekt elke code in; wie extern mag uitnodigen, alleen zijn eigen codes.
    let ctx = { works; settings };
    let all = Rights.may(ctx, who, #manageAccess, null);
    if (not all and not Rights.may(ctx, who, #inviteExternal, null)) { return #err("Geen toegang") };
    let inv = access.invites.get(inviteId) ?? return #err("Onbekende code");
    if (not all and inv.createdBy != who.id) { return #err("Geen toegang") };
    if (inv.state != #open) { return #err("Code is niet meer open") };
    inv.state := #revoked({ by = who.id; at = Time.now() });
    Access.audit(audit, caller, ?who.id, null, "code-ingetrokken", "#" # inviteId.toText() # " …" # inv.hint);
    #ok;
  };

  // Admin ziet alle codes; wie extern uitnodigt, enkel zijn eigen. Nieuwste eerst.
  public query ({ caller }) func listInvites(from : Nat, limit : Nat) : async [Views.InviteView] {
    let who = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let all = Rights.may(ctx, who, #manageAccess, null);
    if (not all) { Rights.require(ctx, who, #inviteExternal, null) };
    let items = access.invites.reverseEntries().map(func((_, v) : (Nat, Types.Invite)) : Types.Invite = v).filter(func i = all or i.createdBy == who.id).map(func i = Access.inviteView(access, i)).toArray();
    Access.page(items, from, limit);
  };

  public query ({ caller }) func listLinks() : async [Views.LinkView] {
    let admin = Access.requireActive(access, caller);
    Rights.require({ works; settings }, admin, #manageAccess, null);
    access.links.entries().map(func(p, l) = Access.linkView(access, p, l)).toArray();
  };

  public query ({ caller }) func accessStats() : async Views.AccessStats {
    let admin = Access.requireActive(access, caller);
    Rights.require({ works; settings }, admin, #manageAccess, null);
    let now = Time.now();
    {
      persons = access.persons.values().filter(func p = p.archivedAt == null).size();
      activeLinks = access.links.values().filter(func l = l.status == #active).size();
      pendingLinks = access.links.values().filter(func l = l.status == #pending).size();
      openInvites = access.invites.values().filter(func i = i.state == #open and i.expiresAt > now).size();
      failuresThisHour = Access.failuresThisHour(access);
      codesLockedUntil = if (access.throttle.lockedUntil > now) ?access.throttle.lockedUntil else null;
      attemptsTracked = access.attempts.size();
    };
  };

  // ── intern ──────────────────────────────────────────────────────────────

  // Een principal mag koppelen als hij nog geen koppeling heeft, of alleen een ingetrokken.
  func mayStartLink(caller : Principal) : Bool {
    switch (access.links.get(caller)) { case (?l) l.status == #revoked; case null true };
  };

  // Nieuwe koppeling; een ingetrokken koppeling van dezelfde principal gaat eerst naar de historiek.
  func putLink(caller : Principal, personId : Nat, hint : Text, inviteId : Nat, tag : Text, status : Types.LinkStatus) {
    let now = Time.now();
    switch (access.links.get(caller)) {
      case (?old) {
        let hid = Ids.next(ctr, "linkHistory");
        access.linkHistory.add(hid, { id = hid; principal = caller; personId = old.personId; linkedAt = old.linkedAt; codeHint = old.codeHint; tag = old.tag; revokedAt = old.revokedAt; revokedBy = old.revokedBy; movedAt = now });
      };
      case null {};
    };
    let link : Types.Link = {
      personId;
      var status = status;
      linkedAt = now;
      codeHint = hint;
      inviteId;
      var tag = tag;
      var confirmedBy = null;
      var confirmedAt = null;
      var revokedBy = null;
      var revokedAt = null;
    };
    access.links.add(caller, link);
  };

  func failure(caller : Principal, action : Text, why : Text) {
    let alert = Access.countFailure(access, caller);
    Access.audit(audit, caller, null, null, action, why);
    if (alert) {
      Access.notifyAdmins(access, audit, ctr, "remming", "Veel foute codes in het afgelopen uur (" # Access.failuresThisHour(access).toText() # "). Bekijk de auditlog.");
      Access.audit(audit, caller, null, null, "globale-remming", Access.failuresThisHour(access).toText() # " fouten dit uur");
    };
  };

  func countActiveLinks(personId : Nat) : Nat {
    access.links.values().filter(func l = l.personId == personId and l.status == #active).size();
  };

  func orgExists(id : Nat) : Bool {
    switch (org.orgs.get(id)) { case (?o) o.archivedAt == null; case null false };
  };

  func dedupRoles(roles : [Types.Role]) : [Types.Role] {
    var out : [Types.Role] = [];
    for (r in roles.values()) { if (out.find(func x = x == r) == null) { out := out.concat([r]) } };
    out;
  };

  func rolesText(roles : [Types.Role]) : Text {
    var t = "";
    for (r in roles.values()) { t #= (if (t == "") "" else ",") # Rights.roleKey(r) };
    "[" # t # "]";
  };

  // Maakt de code, bewaart enkel de hash en geeft de kale code één keer terug.
  func newCode(personId : Nat, kind : Types.CodeKind, by : Nat, validDays : Nat, tag : Text, workIds : [Nat], entropy : Blob) : {
    id : Nat;
    body : Text;
    expiresAt : Int;
  } {
    let body = Codes.fromEntropy(entropy, Codes.inviteLength);
    let days = if (validDays == 0 or validDays > Config.inviteDaysMax) { settings.inviteDays } else { validDays };
    let now = Time.now();
    let id = Ids.next(ctr, "invite");
    let inv : Types.Invite = {
      id;
      hash = Codes.hash(body);
      personId;
      kind;
      createdBy = by;
      createdAt = now;
      expiresAt = now + days * Config.day;
      hint = Codes.hint(body);
      tag;
      workIds;
      var state = #open;
    };
    access.invites.add(id, inv);
    access.codeIndex.add(inv.hash, id);
    { id; body; expiresAt = inv.expiresAt };
  };
};
