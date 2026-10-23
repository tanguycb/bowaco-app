// Werven en lidmaatschappen: de basis die de rechten per werf nodig hebben (R2, R3, R15, R31).
// De werfpagina, contractparameters en documenten volgen in 1.1.
import Array "mo:core/Array";
import Iter "mo:core/Iter";
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
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // Alleen de werven die de beller mag zien (R3); een externe ziet nooit een andere werf.
  public query ({ caller }) func listWorks() : async [Views.WorkView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    works.works.values().filter(func w = Rights.may(ctx, p, #readWork, ?w.id)).map(workView).toArray();
  };

  public query ({ caller }) func getWork(id : Nat) : async Views.WorkView {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readWork, ?id);
    switch (works.works.get(id)) { case (?w) workView(w); case null Runtime.trap("Geen toegang") };
  };

  public shared ({ caller }) func createWork(i : Views.WorkInput) : async Result.Result<Views.WorkView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #createWork, null);
    let name = Access.cleanText(i.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    let code = Access.cleanText(i.code, Config.maxShort) ?? return #err("Code: 1 tot " # Config.maxShort.toText() # " tekens");
    if (works.works.values().any(func w = w.code == code)) { return #err("Code bestaat al") };
    if (i.vatBp != 600 and i.vatBp != 2100) { return #err("Btw-tarief: 6 of 21 %") };
    for (o in [i.clientOrgId, i.architectOrgId].values()) {
      switch o { case (?x) { if (not org.orgs.containsKey(x)) { return #err("Onbekende organisatie") } }; case null {} };
    };
    switch (i.parentId) { case (?x) { if (not works.works.containsKey(x)) { return #err("Onbekende hoofdwerf") } }; case null {} };
    switch (i.leaderPersonId) { case (?x) { if (not access.persons.containsKey(x)) { return #err("Onbekende werfleider") } }; case null {} };
    let id = Ids.next(ctr, "work");
    let w : Types.Work = {
      id;
      code;
      name;
      address = i.address;
      parentId = i.parentId;
      clientOrgId = i.clientOrgId;
      architectOrgId = i.architectOrgId;
      leaderPersonId = i.leaderPersonId;
      var status = #planned;
      vatBp = i.vatBp;
      plannedStart = null;
      plannedEnd = null;
      estimatedAmountCents = null;
      safetyCoordinatorOrgId = null;
      createdAt = Time.now();
      createdBy = p.id;
      var archivedAt = null;
      extra = [];
    };
    works.works.add(id, w);
    switch (i.leaderPersonId) {
      case (?lp) { ignore addMember(id, ?lp, null, #werfleider, [], p.id) };
      case null {};
    };
    Access.audit(audit, caller, ?p.id, ?id, "werf-gemaakt", code # " " # name);
    #ok(workView(w));
  };

  public shared ({ caller }) func setWorkStatus(id : Nat, status : Types.WorkStatus) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editWork, ?id);
    let w = works.works.get(id) ?? return #err("Onbekende werf");
    if (w.status == status) { return #ok }; // niets veranderd: niets loggen
    let before = w.status;
    w.status := status;
    Access.audit(audit, caller, ?p.id, ?id, "werf-status", w.code # ": " # statusKey(before) # " → " # statusKey(status));
    #ok;
  };

  // Wie hoort bij deze werf: namen en rollen (intern; R3 "team").
  public query ({ caller }) func listMembers(workId : Nat) : async [Views.MembershipView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readWork, ?workId);
    works.memberships.values().filter(func m = m.workId == workId and m.endedAt == null).map(membershipView).toArray();
  };

  public shared ({ caller }) func addMembership(workId : Nat, personId : ?Nat, orgId : ?Nat, role : Types.Role, grants : [Types.Grant]) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.mayAddMember({ works; settings }, p, workId, role)) { return #err("Geen toegang") };
    switch (personId, orgId) {
      case (?x, null) { if (not access.persons.containsKey(x)) { return #err("Onbekende persoon") } };
      case (null, ?x) {
        if (not org.orgs.containsKey(x)) { return #err("Onbekende organisatie") };
        if (Rights.isInternalRole(role)) { return #err("Een interne rol hoort bij een persoon") };
      };
      case _ { return #err("Kies een persoon of een organisatie") };
    };
    if (grants.size() > 6) { return #err("Te veel rechten") };
    let id = addMember(workId, personId, orgId, role, grants, p.id);
    Access.audit(audit, caller, ?p.id, ?workId, "lid-toegevoegd", Rights.roleKey(role) # " #" # id.toText());
    #ok(id);
  };

  // R31: einde van een lidmaatschap werkt meteen; de historiek blijft.
  public shared ({ caller }) func endMembership(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let m = works.memberships.get(id) ?? return #err("Onbekend lidmaatschap");
    if (not Rights.mayAddMember({ works; settings }, p, m.workId, m.role)) { return #err("Geen toegang") };
    if (m.endedAt != null) { return #err("Al beëindigd") };
    m.endedAt := ?Time.now();
    m.endedBy := ?p.id;
    Access.audit(audit, caller, ?p.id, ?m.workId, "lid-beeindigd", Rights.roleKey(m.role) # " #" # id.toText());
    #ok;
  };

  func statusKey(s : Types.WorkStatus) : Text {
    switch s {
      case (#request) "aanvraag";
      case (#quoting) "offerte";
      case (#planned) "gepland";
      case (#running) "bezig";
      case (#delivered) "opgeleverd";
      case (#aftercare) "nazorg";
      case (#cancelled) "geannuleerd";
    };
  };

  func addMember(workId : Nat, personId : ?Nat, orgId : ?Nat, role : Types.Role, grants : [Types.Grant], by : Nat) : Nat {
    let id = Ids.next(ctr, "membership");
    let m : Types.Membership = { id; workId; personId; orgId; role; grants; grantedAt = Time.now(); grantedBy = by; var endedAt = null; var endedBy = null };
    works.memberships.add(id, m);
    id;
  };

  func workView(w : Types.Work) : Views.WorkView {
    {
      id = w.id;
      code = w.code;
      name = w.name;
      address = w.address;
      parentId = w.parentId;
      clientOrgId = w.clientOrgId;
      architectOrgId = w.architectOrgId;
      leaderPersonId = w.leaderPersonId;
      status = w.status;
      vatBp = w.vatBp;
      createdAt = w.createdAt;
      createdBy = w.createdBy;
      archivedAt = w.archivedAt;
    };
  };

  func membershipView(m : Types.Membership) : Views.MembershipView {
    let name = switch (m.personId, m.orgId) {
      case (?pid, _) Access.personName(access, pid);
      case (null, ?oid) { switch (org.orgs.get(oid)) { case (?o) o.name; case null "#" # oid.toText() } };
      case _ "";
    };
    let archived = switch (m.personId) { case (?pid) { switch (access.persons.get(pid)) { case (?x) x.archivedAt != null; case null false } }; case null false };
    {
      id = m.id;
      workId = m.workId;
      personId = m.personId;
      orgId = m.orgId;
      name;
      archived;
      role = m.role;
      grants = m.grants;
      grantedAt = m.grantedAt;
      grantedBy = m.grantedBy;
      endedAt = m.endedAt;
    };
  };
};
