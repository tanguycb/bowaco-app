// Werven en lidmaatschappen (R2, R3, R15, R31) en de werffiche van 1.1: fiche wijzigen (R4),
// deelwerven (A9, VOORLOPIG) en de contractparameters als vertrouwelijke velden (R23, R27).
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
import Dossier "../lib/Dossier";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  dossier : Types.DossierState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // Alleen de werven die de beller mag zien (R3); een externe ziet nooit een andere werf.
  public query ({ caller }) func listWorks() : async [Views.WorkView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    works.works.values().filter(func w = Rights.may(ctx, p, #readWork, ?w.id)).map(func w = Dossier.workView(ctx, dossier, p, w)).toArray();
  };

  public query ({ caller }) func getWork(id : Nat) : async Views.WorkView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readWork, ?id);
    switch (works.works.get(id)) { case (?w) Dossier.workView(ctx, dossier, p, w); case null Runtime.trap("Geen toegang") };
  };

  public shared ({ caller }) func createWork(i : Views.WorkInput) : async Result.Result<Views.WorkView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #createWork, null);
    let name = Access.cleanText(i.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    let code = Access.cleanText(i.code, Config.maxShort) ?? return #err("Code: 1 tot " # Config.maxShort.toText() # " tekens");
    if (works.works.values().any(func w = w.code == code)) { return #err("Code bestaat al") };
    if (i.vatBp != 600 and i.vatBp != 2100) { return #err("Btw-tarief: 6 of 21 %") };
    switch (Access.addressError(i.address)) { case (?e) return #err(e); case null {} };
    for (o in [i.clientOrgId, i.architectOrgId].values()) {
      switch o { case (?x) { if (not org.orgs.containsKey(x)) { return #err("Onbekende organisatie") } }; case null {} };
    };
    switch (parentError(i.parentId, null)) { case (?e) return #err(e); case null {} };
    switch (leaderError(i.leaderPersonId)) { case (?e) return #err(e); case null {} };
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
    Access.audit(audit, caller, ?p.id, ?id, "werf-gemaakt", code # " " # name # (switch (i.parentId) { case (?x) " (deelwerf van " # workCode(x) # ")"; case null "" }));
    #ok(Dossier.workView({ works; settings }, dossier, p, w));
  };

  // Werffiche wijzigen (R4): het record wordt vervangen, de auditregel toont per veld oud → nieuw (D2).
  // De werfleider aanduiden of wisselen is een interne toewijzing (admin), zoals een werfleider-lidmaatschap.
  public shared ({ caller }) func updateWork(id : Nat, u : Views.WorkUpdate) : async Result.Result<Views.WorkView, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editWork, ?id);
    let old = works.works.get(id) ?? return #err("Onbekende werf");
    let name = Access.cleanText(u.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    let code = Access.cleanText(u.code, Config.maxShort) ?? return #err("Code: 1 tot " # Config.maxShort.toText() # " tekens");
    if (code != old.code and works.works.values().any(func w = w.code == code)) { return #err("Code bestaat al") };
    if (u.vatBp != 600 and u.vatBp != 2100) { return #err("Btw-tarief: 6 of 21 %") };
    switch (Access.addressError(u.address)) { case (?e) return #err(e); case null {} };
    for (o in [u.clientOrgId, u.architectOrgId].values()) {
      switch o { case (?x) { if (not org.orgs.containsKey(x)) { return #err("Onbekende organisatie") } }; case null {} };
    };
    switch (u.plannedStart, u.plannedEnd) {
      case (?a, ?b) { if (b < a) { return #err("Het einde ligt vóór de start") } };
      case _ {};
    };
    if (u.parentId != old.parentId) {
      switch (parentError(u.parentId, ?id)) { case (?e) return #err(e); case null {} };
      switch (u.parentId) { case (?x) Rights.require(ctx, p, #editWork, ?x); case null {} };
    };
    if (u.leaderPersonId != old.leaderPersonId) {
      if (not Rights.may(ctx, p, #setLeader, ?id)) { return #err("Geen toegang: enkel een beheerder duidt de werfleider aan") };
      switch (leaderError(u.leaderPersonId)) { case (?e) return #err(e); case null {} };
    };
    let analytic = Access.optText(u.analyticCode, Config.maxShort * 2);
    if (u.vatNote.size() > Config.maxText) { return #err("Btw-grond te lang") };
    let w : Types.Work = {
      id;
      code;
      name;
      address = u.address;
      parentId = u.parentId;
      clientOrgId = u.clientOrgId;
      architectOrgId = u.architectOrgId;
      leaderPersonId = u.leaderPersonId;
      var status = old.status;
      vatBp = u.vatBp;
      plannedStart = u.plannedStart;
      plannedEnd = u.plannedEnd;
      estimatedAmountCents = old.estimatedAmountCents;
      safetyCoordinatorOrgId = old.safetyCoordinatorOrgId;
      createdAt = old.createdAt;
      createdBy = old.createdBy;
      var archivedAt = old.archivedAt;
      extra = old.extra;
    };
    let oldInfo = dossier.info.get(id);
    let oldAnalytic = switch oldInfo { case (?i) i.analyticCode; case null null };
    let oldVatNote = switch oldInfo { case (?i) i.vatNote; case null "" };
    var diff = "";
    let add = func(t : Text) { diff #= (if (diff == "") "" else "; ") # t };
    if (old.code != code) add("code " # old.code # " → " # code);
    if (old.name != name) add("naam " # old.name # " → " # name);
    if (old.address != u.address) add("adres → " # addressText(u.address));
    if (old.vatBp != u.vatBp) add("btw " # pct(old.vatBp) # " → " # pct(u.vatBp));
    if (oldVatNote != u.vatNote) add("btw-grond gewijzigd");
    if (old.parentId != u.parentId) add("hoofdwerf " # optWork(old.parentId) # " → " # optWork(u.parentId));
    if (old.clientOrgId != u.clientOrgId) add("klant " # optOrg(old.clientOrgId) # " → " # optOrg(u.clientOrgId));
    if (old.architectOrgId != u.architectOrgId) add("architect " # optOrg(old.architectOrgId) # " → " # optOrg(u.architectOrgId));
    if (old.leaderPersonId != u.leaderPersonId) add("werfleider " # optPerson(old.leaderPersonId) # " → " # optPerson(u.leaderPersonId));
    if (old.plannedStart != u.plannedStart or old.plannedEnd != u.plannedEnd) add("periode gewijzigd");
    if (oldAnalytic != analytic) add("analytische code " # (oldAnalytic ?? "–") # " → " # (analytic ?? "–"));
    if (diff == "") { return #ok(Dossier.workView(ctx, dossier, p, old)) }; // niets veranderd: niets loggen
    works.works.add(id, w);
    if (oldAnalytic != analytic or oldVatNote != u.vatNote) {
      dossier.info.add(id, { workId = id; analyticCode = analytic; vatNote = u.vatNote; updatedAt = Time.now(); updatedBy = p.id; extra = switch oldInfo { case (?i) i.extra; case null [] } });
    };
    // Nieuwe werfleider: ook lid van de werf (zo ziet hij ze ook als "werfleider ziet alles" uit staat).
    switch (u.leaderPersonId) {
      case (?lp) {
        if (lp != (old.leaderPersonId ?? 0) and not works.memberships.values().any(func m = m.workId == id and m.endedAt == null and m.personId == ?lp and m.role == #werfleider)) {
          let mid = addMember(id, ?lp, null, #werfleider, [], p.id);
          Access.audit(audit, caller, ?p.id, ?id, "lid-toegevoegd", "werfleider #" # mid.toText() # " (werfleider van de fiche)");
        };
      };
      case null {};
    };
    Access.audit(audit, caller, ?p.id, ?id, "werf-gewijzigd", code # ": " # diff);
    #ok(Dossier.workView(ctx, dossier, p, w));
  };

  // ── Contractparameters (vertrouwelijk, R23, R27) ────────────────────────
  // Lezen = update-call met auditregel "bekeek". Een deelwerf zonder eigen contract toont dat van de
  // hoofdwerf (VOORLOPIG, A9).
  public shared ({ caller }) func readContract(workId : Nat) : async Result.Result<Views.ContractView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readContract, ?workId);
    Access.audit(audit, caller, ?p.id, ?workId, "bekeek:contract", workCode(workId));
    switch (Dossier.effectiveConfidential(works, dossier, workId)) {
      case null #ok({ workId; version = 0; contract = null; clientContact = null; notes = null; sealed = false; inheritedFrom = null; updatedAt = null; updatedByName = "" });
      case (?(c, from)) {
        // Een overgenomen contract leest ook rechten op de hoofdwerf.
        switch from { case (?x) Rights.require({ works; settings }, p, #readContract, ?x); case null {} };
        #ok({
          workId;
          version = c.version;
          contract = Dossier.plainOf(c.contract);
          clientContact = Dossier.plainOf(c.clientContact);
          notes = Dossier.plainOf(c.notes);
          sealed = Dossier.isSealed(c.contract) or Dossier.isSealed(c.clientContact) or Dossier.isSealed(c.notes);
          inheritedFrom = from;
          updatedAt = ?c.updatedAt;
          updatedByName = Access.personName(access, c.updatedBy);
        });
      };
    };
  };

  // Bewaren met de versie die de beller las (0 = nog geen eigen contract): wie intussen door iemand
  // anders overschreven werd, krijgt een fout in plaats van stil te overschrijven. Elke versie blijft.
  public shared ({ caller }) func setContract(workId : Nat, i : Views.ContractInput, expectedVersion : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editContract, ?workId);
    let k = i.contract;
    switch (k.estimatedAmountCents) {
      case (?a) { if (a < 0 or a > Config.maxAmountCents) { return #err("Aanneemsom: tussen 0 en € 1 miljard") } };
      case null {};
    };
    switch (k.priceRevision) {
      case (#formula f) { if (f.trim(#char ' ').size() == 0 or f.size() > Config.maxFormula) { return #err("Formule prijsherziening: 1 tot " # Config.maxFormula.toText() # " tekens") } };
      case (#none) {};
    };
    if (k.guaranteeBp > Config.maxGuaranteeBp) { return #err("Waarborg: hoogstens 20 %") };
    if (k.guarantee == #none and k.guaranteeBp != 0) { return #err("Waarborg: geen soort gekozen") };
    if (k.guarantee != #none and k.guaranteeBp == 0) { return #err("Waarborg: geef een percentage") };
    if (k.paymentTermDays > Config.maxPaymentTermDays) { return #err("Betaaltermijn: hoogstens 365 dagen") };
    switch (k.invoicingRhythm) { case (#other t) { if (t.size() == 0 or t.size() > Config.maxName) { return #err("Facturatieritme: omschrijving 1 tot 80 tekens") } }; case _ {} };
    if (k.note.size() > Config.maxText or i.notes.size() > Config.maxText) { return #err("Tekst te lang") };
    if (k.signedQuoteVersionId != null) { return #err("Getekende offerteversie: komt in fase 2") };
    let contact : Types.Contact = switch (i.clientContact) {
      case (?c) {
        switch (Access.contactError(c)) { case (?e) return #err(e); case null {} };
        c;
      };
      case null { { name = ""; phone = null; email = null; address = null } };
    };
    let old = dossier.confidential.get(workId);
    let current = switch old { case (?c) c.version; case null 0 };
    if (expectedVersion != current) { return #err("Iemand anders wijzigde dit intussen (versie " # current.toText() # "); laad opnieuw") };
    switch old { case (?c) { if (Dossier.isSealed(c.contract)) { return #err("Versleuteld: wijzigen kan enkel in de browser met de werfsleutel (fase 2)") } }; case null {} };
    let now = Time.now();
    let rec : Types.WorkConfidential = {
      workId;
      contract = #plain(k);
      clientContact = #plain(contact);
      notes = #plain(i.notes);
      version = current + 1;
      updatedAt = now;
      updatedBy = p.id;
      extra = switch old { case (?c) c.extra; case null [] };
    };
    let fields = Dossier.changedFields(old, rec);
    if (fields == "niets gewijzigd") { return #ok(current) };
    dossier.confidential.add(workId, rec);
    let hid = Ids.next(ctr, "workConfidentialVersion");
    dossier.confidentialHistory.add(hid, { id = hid; workId; version = rec.version; contract = rec.contract; clientContact = rec.clientContact; notes = rec.notes; at = now; by = p.id });
    // Enkel de NAMEN van de velden: de waarden zijn vertrouwelijk, de auditlog is intern.
    Access.audit(audit, caller, ?p.id, ?workId, "vertrouwelijk-gewijzigd", "contract " # workCode(workId) # " v" # rec.version.toText() # ": " # fields);
    #ok(rec.version);
  };

  public shared ({ caller }) func readContractHistory(workId : Nat) : async Result.Result<[Views.ContractVersionView], Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readContract, ?workId);
    Access.audit(audit, caller, ?p.id, ?workId, "bekeek:contract-historiek", workCode(workId));
    #ok(
      dossier.confidentialHistory.values().filter(func h = h.workId == workId).map(
        func(h : Types.WorkConfidentialVersion) : Views.ContractVersionView {
          {
            version = h.version;
            at = h.at;
            byName = Access.personName(access, h.by);
            contract = Dossier.plainOf(h.contract);
            clientContact = Dossier.plainOf(h.clientContact);
            notes = Dossier.plainOf(h.notes);
            sealed = Dossier.isSealed(h.contract);
          };
        }
      ).toArray()
    );
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

  // Wie hoort bij deze werf: namen en rollen (intern; R3 "team"). 1.9: een externe (OA, architect, klant, VC) ziet
  // enkel het kantoor (interne rollen) en zijn eigen firma; nooit de klant of de andere firma's (register P2/P3).
  public query ({ caller }) func listMembers(workId : Nat) : async [Views.MembershipView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readWork, ?workId);
    let internal = Rights.internal(p);
    works.memberships.values().filter(func m = m.workId == workId and m.endedAt == null and (internal or memberVisibleTo(p, m))).map(membershipView).toArray();
  };

  func memberVisibleTo(p : Types.Person, m : Types.Membership) : Bool {
    if (Rights.isInternalRole(m.role)) { return true };
    if (m.personId == ?p.id) { return true };
    if (p.orgId == null) { return false };
    if (m.orgId != null and m.orgId == p.orgId) { return true };
    switch (m.personId) {
      case (?x) { switch (access.persons.get(x)) { case (?q) q.orgId == p.orgId; case null false } };
      case null false;
    };
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
    // 1.9: enkel rechten die bij de rol passen (zoals setMemberGrants), ook bij het toevoegen.
    let allowedG = Rights.allowedGrants(role);
    if (grants.any(func g = not allowedG.any(func x = x == g))) { return #err("Een van de rechten past niet bij de rol " # Rights.roleKey(role)) };
    let id = addMember(workId, personId, orgId, role, grants, p.id);
    Access.audit(audit, caller, ?p.id, ?workId, "lid-toegevoegd", Rights.roleKey(role) # " #" # id.toText());
    #ok(id);
  };

  // R31: einde van een lidmaatschap werkt meteen; de historiek blijft.
  public shared ({ caller }) func endMembership(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    // Onbekend of niet van jou: hetzelfde antwoord (geen id-orakel voor externen, 1.9).
    let m = works.memberships.get(id) ?? return #err("Geen toegang");
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

  // Deelwerf (A9, VOORLOPIG): één niveau diep, de hoofdwerf bestaat en is zelf geen deelwerf, en een
  // werf met deelwerven kan zelf geen deelwerf worden.
  func parentError(parentId : ?Nat, self : ?Nat) : ?Text {
    let x = parentId ?? return null;
    if (?x == self) { return ?"Een werf kan niet haar eigen hoofdwerf zijn" };
    let parent = works.works.get(x) ?? return ?"Onbekende hoofdwerf";
    if (parent.archivedAt != null) { return ?"De hoofdwerf is gearchiveerd" };
    if (parent.parentId != null) { return ?"Een deelwerf kan zelf geen deelwerven hebben" };
    switch self {
      case (?me) { if (works.works.values().any(func w = w.parentId == ?me)) { return ?"Deze werf heeft zelf deelwerven" } };
      case null {};
    };
    null;
  };

  func leaderError(leader : ?Nat) : ?Text {
    let x = leader ?? return null;
    let person = access.persons.get(x) ?? return ?"Onbekende werfleider";
    if (not Rights.canLead(person)) { return ?"Deze persoon heeft geen rol werfleider" };
    null;
  };

  func addressText(a : Types.Address) : Text { a.street # " " # a.number # ", " # a.zip # " " # a.city };
  func pct(bp : Nat) : Text { (bp / 100).toText() # " %" };
  func workCode(id : Nat) : Text { switch (works.works.get(id)) { case (?w) w.code; case null "#" # id.toText() } };
  func optWork(id : ?Nat) : Text { switch id { case (?x) workCode(x); case null "–" } };
  func optOrg(id : ?Nat) : Text { switch id { case (?x) { switch (org.orgs.get(x)) { case (?o) o.name; case null "#" # x.toText() } }; case null "–" } };
  func optPerson(id : ?Nat) : Text { switch id { case (?x) Access.personName(access, x); case null "–" } };

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
      endedBy = m.endedBy;
    };
  };
};
