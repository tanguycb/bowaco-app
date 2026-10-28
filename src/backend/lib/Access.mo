// Wie belt er? Elke API-functie begint hier (R1: anoniem altijd geweigerd), daarna Rights.require.
// Plus: pogingenlimiet per principal, globale remming, auditlog, meldingen en de views.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Config "Config";
import Ids "Ids";
import Rights "Rights";

module {
  type AccessState = Types.AccessState;
  type Person = Types.Person;

  public func requireAuthenticated(caller : Principal) {
    if (caller.isAnonymous()) { Runtime.trap("Je bent niet ingelogd") };
  };

  // Actieve persoon achter deze principal: actieve koppeling en niet gearchiveerd. Anders null.
  public func activePerson(access : AccessState, caller : Principal) : ?Person {
    if (caller.isAnonymous()) { return null };
    let link = access.links.get(caller) ?? return null;
    if (link.status != #active) { return null };
    let p = access.persons.get(link.personId) ?? return null;
    if (p.archivedAt != null) { return null };
    ?p;
  };

  public func requireActive(access : AccessState, caller : Principal) : Person {
    requireAuthenticated(caller);
    activePerson(access, caller) ?? Runtime.trap("Geen toegang: je toegang is nog niet bevestigd of is stopgezet");
  };

  // ── Robot (R28): een principal in robot.robots, nooit een persoon ───────
  public func isRobot(robot : Types.RobotState, caller : Principal) : Bool {
    switch (robot.robots.get(caller)) { case (?r) r.revokedAt == null; case null false };
  };

  public func requireRobot(robot : Types.RobotState, caller : Principal) {
    if (not isRobot(robot, caller)) { Runtime.trap("Geen toegang") };
  };

  // ── Personen ────────────────────────────────────────────────────────────
  public func personName(access : AccessState, id : Nat) : Text {
    switch (access.persons.get(id)) { case (?p) p.name; case null "#" # id.toText() };
  };

  public func hasActiveLink(access : AccessState, personId : Nat) : Bool {
    access.links.values().any(func l = l.personId == personId and l.status == #active);
  };

  // Admins die nu echt kunnen inloggen (R16).
  public func activeAdminIds(access : AccessState) : [Nat] {
    access.persons.values().filter(
      func p = p.archivedAt == null and Rights.isAdmin(p) and hasActiveLink(access, p.id)
    ).map(func p = p.id).toArray();
  };

  // ── Pogingenlimiet per principal (§3.3.3): 5 per uur, dan 24 uur dicht ──
  public func blockedUntil(access : AccessState, caller : Principal) : ?Int {
    let now = Time.now();
    let a = access.attempts.get(caller);
    let own = switch a { case (?a) if (a.blockedUntil > now) ?a.blockedUntil else null; case null null };
    if (own != null) { return own };
    if (access.throttle.lockedUntil > now) { ?access.throttle.lockedUntil } else { null };
  };

  // Telt een foute poging, per principal én globaal. Geeft true als de admins nu een melding krijgen.
  public func countFailure(access : AccessState, caller : Principal) : Bool {
    let now = Time.now();
    let a = switch (access.attempts.get(caller)) {
      case (?a) a;
      case null {
        let fresh : Types.Attempts = { var windowStart = now; var count = 0; var blockedUntil = 0 };
        access.attempts.add(caller, fresh);
        fresh;
      };
    };
    if (now - a.windowStart > Config.hour) {
      a.windowStart := now;
      a.count := 0;
    };
    a.count += 1;
    if (a.count >= Config.maxAttemptsPerHour) {
      a.blockedUntil := now + Config.blockAfterAttempts;
      a.count := 0;
    };
    // Globaal: een vast venster van een uur over alle principals (T4: principals zijn gratis).
    let t = access.throttle;
    if (now - t.windowStart > Config.hour) {
      t.windowStart := now;
      t.failures := 0;
    };
    t.failures += 1;
    if (t.failures >= Config.globalLockPerHour) { t.lockedUntil := t.windowStart + Config.hour };
    if (t.failures >= Config.globalAlertPerHour and t.alertedWindow != t.windowStart) {
      t.alertedWindow := t.windowStart;
      return true;
    };
    false;
  };

  public func failuresThisHour(access : AccessState) : Nat {
    if (Time.now() - access.throttle.windowStart > Config.hour) 0 else access.throttle.failures;
  };

  // 1.9 (T11): tellers opruimen van principals die niet (meer) geblokkeerd zijn en waarvan het uurvenster voorbij is.
  // Eerst de sleutels verzamelen, dan schrappen (nooit schrappen tijdens het doorlopen); begrensd per tik.
  public func pruneAttempts(access : AccessState, max : Nat) : Nat {
    let now = Time.now();
    let gone = List.empty<Principal>();
    label scan for ((p, a) in access.attempts.entries()) {
      if (gone.size() >= max) { break scan };
      if (a.blockedUntil <= now and now - a.windowStart > Config.hour) { gone.add(p) };
    };
    for (p in gone.values()) { access.attempts.remove(p) };
    gone.size();
  };

  // ── Audit en meldingen ──────────────────────────────────────────────────
  public func audit(log : Types.AuditState, who : Principal, personId : ?Nat, workId : ?Nat, action : Text, detail : Text) {
    log.log.add({ at = Time.now(); who; personId; workId; action; detail });
  };

  public func notify(log : Types.AuditState, ctr : Types.Counters, personId : Nat, kind : Text, text : Text, workId : ?Nat) {
    let id = Ids.next(ctr, "notification");
    let n : Types.Notification = { id; personId; kind; text; workId; ref = null; createdAt = Time.now(); var readAt = null };
    log.notifications.add(id, n);
  };

  public func notifyAdmins(access : AccessState, log : Types.AuditState, ctr : Types.Counters, kind : Text, text : Text) {
    for (id in activeAdminIds(access).values()) { notify(log, ctr, id, kind, text, null) };
  };

  // 1.7: melding aan de personen van een OA-firma die op deze werf lid zijn (persoonlijk of via hun firma) en een
  // actieve login hebben; met `grant` enkel wie dat recht op de werf heeft. Nooit aan `except` (de auteur zelf).
  public func notifyOrgOnWork(access : AccessState, ctx : Rights.Ctx, log : Types.AuditState, ctr : Types.Counters, orgId : Nat, workId : Nat, grant : ?Types.Grant, except : Nat, kind : Text, text : Text) {
    for (q in access.persons.values()) {
      if (q.archivedAt == null and q.orgId == ?orgId and q.id != except and hasActiveLink(access, q.id) and Rights.member(ctx, q, workId, ?#onderaannemer)) {
        let allowed = switch grant { case (?g) Rights.grant(ctx, q, workId, g); case null true };
        if allowed { notify(log, ctr, q.id, kind, text, ?workId) };
      };
    };
  };

  // ── Views ───────────────────────────────────────────────────────────────
  public func personView(p : Person) : Views.PersonView {
    {
      id = p.id;
      name = p.name;
      roles = p.roles;
      orgId = p.orgId;
      shortCode = p.shortCode;
      lang = p.lang;
      phone = p.phone;
      createdAt = p.createdAt;
      createdBy = p.createdBy;
      archivedAt = p.archivedAt;
    };
  };

  public func linkView(access : AccessState, principal : Principal, l : Types.Link) : Views.LinkView {
    {
      principal;
      personId = l.personId;
      personName = personName(access, l.personId);
      status = l.status;
      linkedAt = l.linkedAt;
      codeHint = l.codeHint;
      tag = l.tag;
      confirmedBy = l.confirmedBy;
      confirmedAt = l.confirmedAt;
      revokedBy = l.revokedBy;
      revokedAt = l.revokedAt;
    };
  };

  public func inviteView(access : AccessState, i : Types.Invite) : Views.InviteView {
    {
      id = i.id;
      personId = i.personId;
      personName = personName(access, i.personId);
      kind = i.kind;
      createdBy = i.createdBy;
      createdAt = i.createdAt;
      expiresAt = i.expiresAt;
      hint = i.hint;
      tag = i.tag;
      workIds = i.workIds;
      state = i.state;
    };
  };

  // ── Hulp ────────────────────────────────────────────────────────────────
  public func cleanText(t : Text, max : Nat) : ?Text {
    let s = t.trim(#char ' ');
    if (s.size() == 0 or s.size() > max) null else ?s;
  };

  public func optText(t : ?Text, max : Nat) : ?Text {
    switch t { case null null; case (?x) cleanText(x, max) };
  };

  // 1.9 (D10): grenzen op een adres en een contactpersoon, overal dezelfde (werf, firma, klantcontact).
  public func addressError(a : Types.Address) : ?Text {
    if (a.street.size() > Config.maxName or a.number.size() > Config.maxShort or a.zip.size() > Config.maxShort or a.city.size() > Config.maxName or a.country.size() > 5) {
      return ?"Adres: een veld is te lang";
    };
    null;
  };

  public func contactError(c : Types.Contact) : ?Text {
    if (c.name.size() > Config.maxName) { return ?"Naam contactpersoon te lang" };
    if ((c.phone ?? "").size() > 30 or (c.email ?? "").size() > Config.maxEmail) { return ?"Gsm of e-mail te lang" };
    switch (c.address) { case (?a) addressError(a); case null null };
  };

  // Een `extra`-lijst (D8) van buiten: begrensd in aantal en lengte.
  public func extraError(x : Types.Extra) : ?Text {
    if (x.size() > Config.maxExtraPairs) { return ?"Te veel extra velden" };
    for ((k, v) in x.values()) { if (k.size() > Config.maxExtraText or v.size() > Config.maxExtraText) { return ?"Extra veld te lang" } };
    null;
  };

  public func page<T>(items : [T], from : Nat, limit : Nat) : [T] {
    let n = items.size();
    if (from >= n) { return [] };
    let lim = if (limit == 0 or limit > Config.maxListPage) Config.maxListPage else limit;
    let to = if (from + lim > n) n else from + lim;
    items.sliceToArray(from, to);
  };

  public func lastN<T>(l : List.List<T>, n : Nat) : [T] {
    let size = l.size();
    let from : Nat = if (size > n) { Nat.sub(size, n) } else { 0 };
    l.sliceToArray(from, size);
  };
};
