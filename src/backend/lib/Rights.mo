// De ENIGE plaats met de rechtenmatrix (architectuur §4, R1–R34). Geen API-functie en geen ander
// bestand kijkt zelf naar Person.roles; alles gaat via may/require of de hulpen hieronder.
// De robot is geen persoon en gaat hier nooit door (R28).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Runtime "mo:core/Runtime";
import Types "../types";
import Views "../types/views";

module {
  type Person = Types.Person;
  type Role = Types.Role;
  type WorkId = Types.WorkId;

  public type Action = {
    #readWork; #editWork; #createWork; #manageMembers; #editPlanning; #confirmOwnAssignment;
    #writeReport; #readReports; #confirmOwnHours; #editMeasurement;
    #readDocs; #uploadDocs; #upload; #readPermits; #editPermits;
    #readTrips; #writeOwnTrip;
    #readSellPrices; #readCosts; #editQuote; #sendQuote;
    #readProgress; #editProgress;
    #proposeExtraWork; #approveExtraWork;
    #inviteExternal; #inviteInternal; #confirmLinks; #manageAccess; #readTeam;
    #readOrgs; #manageOrgs; #readConfidentialContact;
    #manageSettings; #manageRobots; #export; #readAudit; #useTickets;
  };

  public type Ctx = { works : Types.WorksState; settings : Types.SettingsState };

  func has(p : Person, r : Role) : Bool { p.roles.find(func x = x == r) != null };

  public func isInternalRole(r : Role) : Bool { r == #admin or r == #werfleider or r == #calculator };
  public func isExternalRole(r : Role) : Bool { not isInternalRole(r) };

  public func internal(p : Person) : Bool { p.roles.find(isInternalRole) != null };
  public func isAdmin(p : Person) : Bool { has(p, #admin) };

  // Interne rollen wachten op bevestiging door een admin (§3.3.4); externen zijn meteen actief.
  public func needsConfirmation(roles : [Role]) : Bool { roles.find(isInternalRole) != null };

  // Actieve lidmaatschappen van p op werf w (persoonlijk of via zijn organisatie).
  public func memberships(ctx : Ctx, p : Person, w : WorkId) : [Types.Membership] {
    ctx.works.memberships.values().filter(
      func m {
        m.workId == w and m.endedAt == null and (
          m.personId == ?p.id or (m.personId == null and m.orgId != null and m.orgId == p.orgId)
        );
      }
    ).toArray();
  };

  public func member(ctx : Ctx, p : Person, w : WorkId, role : ?Role) : Bool {
    memberships(ctx, p, w).any(func m = switch role { case null true; case (?r) m.role == r });
  };

  // Lid met een externe rol die de persoon ook op zijn fiche draagt (R2: fiche = "mag die rol krijgen").
  func memberAs(ctx : Ctx, p : Person, w : WorkId, r : Role) : Bool {
    has(p, r) and member(ctx, p, w, ?r);
  };

  public func grant(ctx : Ctx, p : Person, w : WorkId, g : Types.Grant) : Bool {
    memberships(ctx, p, w).any(func m = m.grants.any(func x = x == g));
  };

  func workExists(ctx : Ctx, w : WorkId) : Bool {
    switch (ctx.works.works.get(w)) { case (?x) x.archivedAt == null; case null false };
  };

  public func seesWork(ctx : Ctx, p : Person, w : WorkId) : Bool {
    if (not workExists(ctx, w)) { return false };
    if (has(p, #admin) or has(p, #calculator)) { return true };
    if (has(p, #werfleider) and (ctx.settings.werfleiderZietAlles or member(ctx, p, w, ?#werfleider))) {
      return true;
    };
    memberAs(ctx, p, w, #architect) or memberAs(ctx, p, w, #onderaannemer) or memberAs(ctx, p, w, #klant) or memberAs(ctx, p, w, #veiligheidscoordinator);
  };

  func leaderOn(ctx : Ctx, p : Person, w : WorkId) : Bool {
    has(p, #werfleider) and seesWork(ctx, p, w);
  };

  public func may(ctx : Ctx, p : Person, action : Action, work : ?WorkId) : Bool {
    if (p.archivedAt != null) { return false };
    let admin = has(p, #admin);
    let calc = has(p, #calculator);
    let wl = has(p, #werfleider);
    // Werfgebonden handelingen zonder bestaande werf: altijd nee.
    func on(f : WorkId -> Bool) : Bool { switch work { case (?w) workExists(ctx, w) and f(w); case null false } };
    switch action {
      // R3
      case (#readWork) on(func w = seesWork(ctx, p, w));
      // R4, R5
      case (#editWork) on(func w = admin or leaderOn(ctx, p, w));
      case (#createWork) admin or wl;
      case (#manageMembers) on(func w = admin or leaderOn(ctx, p, w));
      case (#editPlanning) on(func w = admin or leaderOn(ctx, p, w));
      // R6
      case (#confirmOwnAssignment) on(func w = memberAs(ctx, p, w, #onderaannemer));
      // R7, R30
      case (#writeReport) on(func w = admin or leaderOn(ctx, p, w));
      case (#editMeasurement) on(func w = admin or leaderOn(ctx, p, w) or calc);
      // R8
      case (#readReports) on(func w = admin or calc or leaderOn(ctx, p, w) or (memberAs(ctx, p, w, #architect) and grant(ctx, p, w, #readReports)) or (memberAs(ctx, p, w, #veiligheidscoordinator) and grant(ctx, p, w, #readReports)));
      // R9
      case (#confirmOwnHours) on(func w = memberAs(ctx, p, w, #onderaannemer) and grant(ctx, p, w, #confirmHours));
      // R10 (verdere filtering per documentsoort in 1.1)
      case (#readDocs) on(func w = seesWork(ctx, p, w));
      // R11
      case (#uploadDocs) on(func w = admin or calc or leaderOn(ctx, p, w) or (memberAs(ctx, p, w, #architect) and grant(ctx, p, w, #uploadDocs)) or memberAs(ctx, p, w, #onderaannemer) or memberAs(ctx, p, w, #veiligheidscoordinator));
      // Opslagpoort (T10): wie ergens iets mag opladen, mag een uploadcertificaat vragen.
      case (#upload) internal(p) or ctx.works.memberships.values().any(func m = m.endedAt == null and (m.personId == ?p.id or (m.personId == null and m.orgId != null and m.orgId == p.orgId)) and has(p, m.role) and m.role != #klant and (m.role != #architect or m.grants.find(func g = g == #uploadDocs) != null));
      // R13
      case (#readPermits) on(func w = admin or leaderOn(ctx, p, w) or memberAs(ctx, p, w, #architect) or memberAs(ctx, p, w, #onderaannemer) or memberAs(ctx, p, w, #veiligheidscoordinator));
      case (#editPermits) on(func w = admin or leaderOn(ctx, p, w));
      // R14 (eigen ritten filtert de functie zelf op chauffeur)
      case (#readTrips) admin or wl;
      case (#writeOwnTrip) admin or wl;
      // R20–R22, R24
      case (#readCosts) admin or calc;
      case (#readSellPrices) switch work { case null admin or calc; case (?w) admin or calc or (memberAs(ctx, p, w, #architect) and grant(ctx, p, w, #readSellPrices)) };
      case (#editQuote) admin or calc;
      case (#sendQuote) admin or calc;
      case (#readProgress) switch work { case null admin or calc; case (?w) admin or calc or (memberAs(ctx, p, w, #architect) and grant(ctx, p, w, #readProgress)) };
      case (#editProgress) admin or calc;
      // R26
      case (#proposeExtraWork) on(func w = admin or calc or leaderOn(ctx, p, w));
      case (#approveExtraWork) admin;
      // R15: werfleider nodigt externen uit, voor werven die hij ziet (of zonder werf)
      case (#inviteExternal) switch work { case null admin or wl; case (?w) workExists(ctx, w) and (admin or leaderOn(ctx, p, w)) };
      case (#inviteInternal) admin;
      case (#confirmLinks) admin;
      case (#manageAccess) admin;
      case (#readTeam) internal(p);
      // Organisaties: interne rollen lezen; admin en werfleider beheren (OA-fiches)
      case (#readOrgs) internal(p);
      case (#manageOrgs) admin or wl;
      // R27
      case (#readConfidentialContact) admin or calc;
      // R17
      case (#manageSettings) admin;
      case (#manageRobots) admin;
      case (#export) admin;
      case (#readAudit) admin;
      // R29: tickets voor actieve personen; welke taak, beslist Config.ticketTasks
      case (#useTickets) internal(p);
    };
  };

  public func require(ctx : Ctx, p : Person, action : Action, work : ?WorkId) {
    if (not may(ctx, p, action, work)) { Runtime.trap("Geen toegang") };
  };

  // Mag p deze persoon met deze rollen uitnodigen voor deze werven? (R15)
  public func mayInvite(ctx : Ctx, p : Person, roles : [Role], workIds : [WorkId]) : Bool {
    if (roles.size() == 0) { return false };
    if (needsConfirmation(roles)) { return may(ctx, p, #inviteInternal, null) };
    if (workIds.size() == 0) { return may(ctx, p, #inviteExternal, null) };
    workIds.all(func w = may(ctx, p, #inviteExternal, ?w));
  };

  // Mag p dit lidmaatschap toekennen? Een werfleider-lidmaatschap is een interne toewijzing (admin).
  public func mayAddMember(ctx : Ctx, p : Person, w : WorkId, role : Role) : Bool {
    if (isInternalRole(role)) { return role == #werfleider and may(ctx, p, #inviteInternal, null) and workExists(ctx, w) };
    may(ctx, p, #manageMembers, ?w);
  };

  // R16: de laatste actieve admin kan niet afgezet of van zijn adminrol ontdaan worden.
  public func isLastActiveAdmin(activeAdminIds : [Nat], personId : Nat) : Bool {
    activeAdminIds.size() <= 1 and activeAdminIds.find(func i = i == personId) != null;
  };

  // Standaardrechten van een nieuw extern lidmaatschap (instelbaar per externe in 1.7).
  public func defaultGrants(r : Role) : [Types.Grant] {
    switch r {
      case (#architect) [#readReports];
      case (#onderaannemer) [#confirmPlanning, #confirmHours];
      case (#veiligheidscoordinator) [#uploadDocs];
      case _ [];
    };
  };

  public func roleKey(r : Role) : Text {
    switch r {
      case (#admin) "admin";
      case (#werfleider) "werfleider";
      case (#calculator) "calculator";
      case (#architect) "architect";
      case (#onderaannemer) "onderaannemer";
      case (#klant) "klant";
      case (#veiligheidscoordinator) "veiligheidscoordinator";
    };
  };

  public func adminRole(roles : [Role]) : Bool { roles.find(func r = r == #admin) != null };

  // Startscherm per rol (bouwplan §8.2).
  public func home(p : Person) : Text {
    if (has(p, #admin)) "overzicht"
    else if (has(p, #werfleider)) "vandaag"
    else if (has(p, #calculator)) "offertes"
    else if (has(p, #onderaannemer)) "week"
    else "werven";
  };

  public func caps(ctx : Ctx, p : Person) : Views.Caps {
    {
      manageAccess = may(ctx, p, #manageAccess, null);
      inviteExternal = may(ctx, p, #inviteExternal, null);
      readTeam = may(ctx, p, #readTeam, null);
      manageOrgs = may(ctx, p, #manageOrgs, null);
      createWork = may(ctx, p, #createWork, null);
      readAudit = may(ctx, p, #readAudit, null);
      export = may(ctx, p, #export, null);
      manageSettings = may(ctx, p, #manageSettings, null);
      manageRobots = may(ctx, p, #manageRobots, null);
      readConfidentialContact = may(ctx, p, #readConfidentialContact, null);
      upload = may(ctx, p, #upload, null);
      home = home(p);
    };
  };
};
