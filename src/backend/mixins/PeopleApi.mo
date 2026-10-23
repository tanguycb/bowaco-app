// Personen en organisaties (§2.3). Afzetten = archiveren + alle logins intrekken, nooit wissen (D2).
// Vertrouwelijke contactgegevens (klanten) alleen via update-calls met een auditregel (R23, R27).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
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
import Ids "../lib/Ids";
import Oa "../lib/Oa";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // Interne rollen zien het team; externen zien enkel zichzelf (via me()).
  public query ({ caller }) func listPersons(includeArchived : Bool) : async [Views.PersonView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readTeam, null);
    access.persons.values().filter(func x = includeArchived or x.archivedAt == null).map(Access.personView).toArray();
  };

  public shared ({ caller }) func updatePerson(id : Nat, u : Views.PersonUpdate) : async Result.Result<Views.PersonView, Text> {
    let admin = Access.requireActive(access, caller);
    Rights.require({ works; settings }, admin, #manageAccess, null);
    let old = access.persons.get(id) ?? return #err("Onbekende persoon");
    if (old.archivedAt != null) { return #err("Persoon is afgezet") };
    let name = Access.cleanText(u.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    if (u.roles.size() == 0 or u.roles.size() > Config.maxRoles) { return #err("Kies minstens één rol") };
    if (Rights.adminRole(old.roles) and not Rights.adminRole(u.roles) and Rights.isLastActiveAdmin(Access.activeAdminIds(access), id)) {
      return #err("De laatste admin houdt zijn adminrol");
    };
    if (id == admin.id and Rights.adminRole(old.roles) and not Rights.adminRole(u.roles)) {
      return #err("Je kunt je eigen adminrol niet afnemen");
    };
    switch (u.orgId) { case (?o) { if (not org.orgs.containsKey(o)) { return #err("Onbekende organisatie") } }; case null {} };
    switch (orgRule(u.roles, u.orgId)) { case (?e) return #err(e); case null {} };
    let p : Types.Person = {
      id;
      name;
      roles = u.roles;
      orgId = u.orgId;
      shortCode = Access.optText(u.shortCode, Config.maxShort);
      lang = Access.optText(u.lang, 5);
      phone = Access.optText(u.phone, 30);
      createdAt = old.createdAt;
      createdBy = old.createdBy;
      var archivedAt = null;
      extra = old.extra;
    };
    access.persons.add(id, p);
    // Kreeg iemand een interne rol erbij, dan moet een admin zijn logins opnieuw bevestigen? Nee:
    // de admin die de rol geeft, is zelf de bevestiging. Wel staat het verschil in de auditlog.
    Access.audit(audit, caller, ?admin.id, null, "persoon-gewijzigd", diff(old, p));
    #ok(Access.personView(p));
  };

  // Afzetten: persoon gearchiveerd, alle logins ingetrokken, open codes ingetrokken. Werkt meteen.
  public shared ({ caller }) func archivePerson(id : Nat) : async Result.Result<(), Text> {
    let admin = Access.requireActive(access, caller);
    Rights.require({ works; settings }, admin, #manageAccess, null);
    if (id == admin.id) { return #err("Je kunt jezelf niet afzetten") };
    let p = access.persons.get(id) ?? return #err("Onbekende persoon");
    if (p.archivedAt != null) { return #err("Al afgezet") };
    if (Rights.isLastActiveAdmin(Access.activeAdminIds(access), id)) { return #err("De laatste admin kan niet afgezet worden") };
    let now = Time.now();
    p.archivedAt := ?now;
    for (l in access.links.values()) {
      if (l.personId == id and l.status != #revoked) {
        l.status := #revoked;
        l.revokedAt := ?now;
        l.revokedBy := ?admin.id;
      };
    };
    for (i in access.invites.values()) {
      if (i.personId == id and i.state == #open) { i.state := #revoked({ by = admin.id; at = now }) };
    };
    // Een afgezette persoon is van geen enkele werf nog lid (R31). Lidmaatschappen van zijn organisatie
    // blijven: die horen bij de firma, niet bij hem.
    var ended = 0;
    for (m in works.memberships.values()) {
      if (m.personId == ?id and m.endedAt == null) {
        m.endedAt := ?now;
        m.endedBy := ?admin.id;
        ended += 1;
        Access.audit(audit, caller, ?admin.id, ?m.workId, "lid-beeindigd", Rights.roleKey(m.role) # " #" # m.id.toText() # " (afgezet)");
      };
    };
    Access.audit(audit, caller, ?admin.id, null, "persoon-afgezet", p.name # " #" # id.toText() # (if (ended > 0) "; " # ended.toText() # " lidmaatschap(pen) beëindigd" else ""));
    #ok;
  };

  // Terugzetten maakt de persoon weer zichtbaar; inloggen vraagt een nieuwe herstelcode.
  public shared ({ caller }) func restorePerson(id : Nat) : async Result.Result<(), Text> {
    let admin = Access.requireActive(access, caller);
    Rights.require({ works; settings }, admin, #manageAccess, null);
    let p = access.persons.get(id) ?? return #err("Onbekende persoon");
    if (p.archivedAt == null) { return #err("Niet afgezet") };
    p.archivedAt := null;
    Access.audit(audit, caller, ?admin.id, null, "persoon-teruggezet", p.name # " #" # id.toText());
    #ok;
  };

  // ── Organisaties ─────────────────────────────────────────────────────────

  public query ({ caller }) func listOrgs(includeArchived : Bool) : async [Views.OrgView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readOrgs, null);
    org.orgs.values().filter(func o = includeArchived or o.archivedAt == null).map(orgView).toArray();
  };

  public shared ({ caller }) func createOrg(input : Views.OrgInput) : async Result.Result<Views.OrgView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageOrgs, null);
    switch (orgFrom(0, input, p.id, 0, [])) { case (#err e) return #err(e); case (#ok _) {} };
    let id = Ids.next(ctr, "org");
    let rec = switch (orgFrom(id, input, p.id, Time.now(), [])) { case (#ok o) o; case (#err e) return #err(e) };
    switch (Oa.clash(org, 0, rec.kbo, rec.aliases)) { case (?e) return #err(e); case null {} };
    switch (Oa.tradeError(settings, rec.trades, [])) { case (?e) return #err(e); case null {} };
    org.orgs.add(id, rec);
    Access.audit(audit, caller, ?p.id, null, "organisatie-gemaakt", rec.name # " #" # id.toText());
    #ok(orgView(rec));
  };

  public shared ({ caller }) func updateOrg(id : Nat, input : Views.OrgInput) : async Result.Result<Views.OrgView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageOrgs, null);
    let old = org.orgs.get(id) ?? return #err("Onbekende organisatie");
    if (old.archivedAt != null) { return #err("Organisatie is gearchiveerd") };
    let o = switch (orgFrom(id, input, old.createdBy, old.createdAt, old.extra)) { case (#ok o) o; case (#err e) return #err(e) };
    switch (Oa.clash(org, id, o.kbo, o.aliases)) { case (?e) return #err(e); case null {} };
    switch (Oa.tradeError(settings, o.trades, old.trades)) { case (?e) return #err(e); case null {} };
    org.orgs.add(id, o);
    Access.audit(audit, caller, ?p.id, null, "organisatie-gewijzigd", old.name # " → " # o.name # " #" # id.toText());
    #ok(orgView(o));
  };

  public shared ({ caller }) func archiveOrg(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageAccess, null);
    let o = org.orgs.get(id) ?? return #err("Onbekende organisatie");
    if (o.archivedAt != null) { return #err("Al gearchiveerd") };
    o.archivedAt := ?Time.now();
    Access.audit(audit, caller, ?p.id, null, "organisatie-gearchiveerd", o.name # " #" # id.toText());
    #ok;
  };

  // Vertrouwelijk: contact en notities van een (klant)organisatie. Elke versie telt; lezen wordt gelogd.
  public shared ({ caller }) func setOrgConfidential(id : Nat, contact : ?Types.Contact, notes : Text) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readConfidentialContact, null);
    if (not org.orgs.containsKey(id)) { return #err("Onbekende organisatie") };
    if (notes.size() > Config.maxText) { return #err("Notities te lang") };
    let c : Types.Contact = switch contact { case (?c) c; case null { { name = ""; phone = null; email = null; address = null } } };
    let version = switch (org.orgConfidential.get(id)) {
      case (?old) {
        old.contact := #plain(c);
        old.notes := #plain(notes);
        old.version += 1;
        old.version;
      };
      case null {
        let rec : Types.OrgConfidential = { orgId = id; var contact = #plain(c); var notes = #plain(notes); var version = 1 };
        org.orgConfidential.add(id, rec);
        1;
      };
    };
    Access.audit(audit, caller, ?p.id, null, "vertrouwelijk-gewijzigd", "organisatie #" # id.toText() # " v" # version.toText());
    #ok(version);
  };

  public shared ({ caller }) func readOrgConfidential(id : Nat) : async Result.Result<Views.ContactConfidentialView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readConfidentialContact, null);
    Access.audit(audit, caller, ?p.id, null, "bekeek:organisatie-vertrouwelijk", "#" # id.toText());
    switch (org.orgConfidential.get(id)) {
      case null #ok({ contact = null; notes = null; version = 0; sealed = false });
      case (?c) #ok(confidentialView(c.contact, ?c.notes, c.version));
    };
  };

  // ── intern ──────────────────────────────────────────────────────────────

  func orgRule(roles : [Types.Role], orgId : ?Nat) : ?Text {
    let kind = switch orgId { case (?o) { switch (org.orgs.get(o)) { case (?x) ?x.kind; case null null } }; case null null };
    Rights.orgRuleError(roles, kind);
  };

  func orgFrom(id : Nat, i : Views.OrgInput, createdBy : Nat, createdAt : Int, extra : Types.Extra) : Result.Result<Types.Org, Text> {
    let name = Access.cleanText(i.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    if (i.aliases.size() > Config.maxAliases or i.trades.size() > Config.maxAliases) { return #err("Te veel codes of vakgebieden") };
    if (i.notes.size() > Config.maxText) { return #err("Notities te lang") };
    let kbo = switch (Oa.normKbo(i.kbo)) { case (#ok k) k; case (#err e) return #err(e) };
    let aliases = i.aliases.filterMap(func a = Access.cleanText(Text.toUpper(a), Config.maxShort));
    #ok({
      id;
      kind = i.kind;
      name;
      kbo;
      vat = Access.optText(i.vat, 20);
      aliases;
      trades = i.trades.filterMap(func t = Access.cleanText(t, Config.maxShort * 2));
      address = i.address;
      notes = i.notes;
      createdAt;
      createdBy;
      var archivedAt = null;
      extra;
    });
  };

  func orgView(o : Types.Org) : Views.OrgView {
    {
      id = o.id;
      kind = o.kind;
      name = o.name;
      kbo = o.kbo;
      vat = o.vat;
      aliases = o.aliases;
      trades = o.trades;
      address = o.address;
      notes = o.notes;
      createdAt = o.createdAt;
      createdBy = o.createdBy;
      archivedAt = o.archivedAt;
    };
  };

  func confidentialView(c : Types.Confidential<Types.Contact>, n : ?Types.Confidential<Text>, version : Nat) : Views.ContactConfidentialView {
    let (contact, sealedC) = switch c { case (#plain x) (?x, false); case (#sealed _) (null, true) };
    let (notes, sealedN) = switch n { case (?#plain x) (?x, false); case (?#sealed _) (null, true); case null (null, false) };
    { contact; notes; version; sealed = sealedC or sealedN };
  };

  func diff(a : Types.Person, b : Types.Person) : Text {
    var t = a.name # " #" # a.id.toText();
    if (a.name != b.name) { t #= "; naam → " # b.name };
    if (a.roles != b.roles) {
      var r = "";
      for (x in b.roles.values()) { r #= (if (r == "") "" else ",") # Rights.roleKey(x) };
      t #= "; rollen → [" # r # "]";
    };
    if (a.orgId != b.orgId) { t #= "; organisatie gewijzigd" };
    if (a.shortCode != b.shortCode) { t #= "; code gewijzigd" };
    if (a.phone != b.phone) { t #= "; gsm gewijzigd" };
    if (a.lang != b.lang) { t #= "; taal gewijzigd" };
    t;
  };
};
