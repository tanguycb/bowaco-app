// De ENIGE plaats met de rechtenmatrix (architectuur §4, R1–R34). Geen API-functie en geen ander
// bestand kijkt zelf naar Person.roles; alles gaat via may/require of de hulpen hieronder.
// De robot is geen persoon en gaat hier nooit door (R28).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
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
    // 1.1: contractparameters (vertrouwelijk, R27), afgeleide feiten, werfleider aanduiden
    #readContract; #editContract; #readWorkFacts; #setLeader;
    // 1.2: onderaannemers-database
    #readOa; #manageOa; #importOa;
    // 1.3: planning per werf
    #readPlanning; #manageCompanyCalendar; #manageTemplates; #readTemplates; #readOrgPlanning;
    // 1.4: weekbord per OA, afwezigheden, regels voor een dubbele boeking
    #manageAbsences; #reportOwnAbsence; #manageBoardRules;
    // 1.5: import van de bestaande planning (admin) en afspraken lezen
    #importPlan; #readAppointments;
    // 1.6: werfverslag. #reportWriter = wie überhaupt verslagen schrijft (poort van de offline-opdrachten);
    // per werf beslist #writeReport. Voertuigen: interne rollen lezen, admin beheert. Problemen afhandelen.
    #reportWriter; #readVehicles; #manageVehicles; #handleIssues;
    // 1b.1: vergunningen over alle werven (lijst, gsm), de kennisbank per gemeente, de vergunningssoorten.
    #permitsOverview; #readMunicipalities; #manageMunicipalities; #managePermitKinds;
    // 1b.4: inhoudingsplicht raadplegen en vastleggen (interne rollen); werfadministratie over alle werven.
    #checkWithholding; #wadmOverview;
    // 2.2: postenbibliotheek. Lezen (hoofdstukken, posten, teksten, eenheden: GEEN prijzen) en bewerken; de prijzen zelf
    // volgen #readCosts (aankoopprijzen, R20) en #readSellPrices (verkoopregel, R21).
    #readLibrary; #editLibrary;
  };

  public type Ctx = { works : Types.WorksState; settings : Types.SettingsState };

  func has(p : Person, r : Role) : Bool { p.roles.find(func x = x == r) != null };

  public func isInternalRole(r : Role) : Bool { r == #admin or r == #werfleider or r == #calculator };
  public func isExternalRole(r : Role) : Bool { not isInternalRole(r) };
  // II-test: rollen waarvoor een werf bij de uitnodiging iets betekent (lid van de werf); admin en calculator zien alles.
  public func usesWorks(r : Role) : Bool { isExternalRole(r) or r == #werfleider };

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
      // R3: de planning lezen = de werf zien; wat iemand ervan ziet, beslist planScope hieronder.
      case (#readPlanning) on(func w = seesWork(ctx, p, w));
      // R6: een OA bevestigt of weigert enkel toewijzingen van zijn eigen firma, en enkel met de grant
      // #confirmPlanning op die werf (standaard bij een OA-lidmaatschap, instelbaar in 1.7).
      case (#confirmOwnAssignment) on(func w = memberAs(ctx, p, w, #onderaannemer) and p.orgId != null and grant(ctx, p, w, #confirmPlanning));
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
      // 1.2: de OA-database (contacten van OA's, leveranciers, nutsbedrijven) is intern: interne rollen
      // lezen, admin en werfleider beheren; externen zien elkaar en de database nooit. Import: R32.
      case (#readOa) internal(p);
      case (#manageOa) admin or wl;
      case (#importOa) admin;
      // 1.3: de bedrijfskalender (bouwverlof, feestdagen) en de sjablonen gelden voor alle werven: admin (R17).
      case (#manageCompanyCalendar) admin;
      case (#manageTemplates) admin;
      case (#readTemplates) internal(p);
      // 1.3/1.4: de toewijzingen van een firma over alle werven heen (weekbord): interne rollen.
      case (#readOrgPlanning) internal(p);
      // 1.4: afwezigheden van een firma ingeven: admin en werfleider (bouwplan rij 1.4). Een OA meldt enkel
      // zijn EIGEN afwezigheid, als hij actief OA is op minstens één werf en de admin dat toelaat
      // (instelling "OA meldt zelf", standaard aan). De regels voor "dubbel" gelden voor iedereen: admin (R17).
      case (#manageAbsences) admin or wl;
      case (#reportOwnAbsence) has(p, #onderaannemer) and p.orgId != null and ctx.settings.values.get("board.oaMeldt") != ?"nee" and activeOa(ctx, p);
      case (#manageBoardRules) admin;
      // 1.5: de import schrijft werven, taken en toewijzingen in bulk: alleen admin (R32, zoals de OA-import).
      // Afspraken uit de planning lezen: interne rollen, voor werven die ze zien.
      case (#importPlan) admin;
      case (#readAppointments) on(func w = internal(p) and seesWork(ctx, p, w));
      // 1.6 (R7): verslagen schrijven doen admin en werfleider; per werf #writeReport hierboven.
      case (#reportWriter) admin or wl;
      case (#readVehicles) internal(p);
      case (#manageVehicles) admin;
      // Een gemeld probleem of een vertraging afhandelen: wie de planning van die werf beheert.
      case (#handleIssues) on(func w = admin or leaderOn(ctx, p, w));
      // 1b.1 (R13): de lijst van alle vergunningen en "vergunning op de gsm" voor wie vergunningen beheert;
      // per werf beslissen #readPermits/#editPermits hierboven. De kennisbank (procedures, doorlooptijden, contacten
      // van de gemeente) is intern: interne rollen lezen, admin en werfleider vullen aan; de soorten: admin (R17).
      case (#permitsOverview) admin or wl;
      case (#readMunicipalities) internal(p);
      case (#manageMunicipalities) admin or wl;
      case (#managePermitKinds) admin;
      // 1b.4: de inhoudingsplicht nakijken doet kantoor (contract en betaling: admin, calculator) en de werfleider
      // (bij de start van een OA); het overzicht van de werfadministratie is intern. Per werf: #readWorkFacts (lezen),
      // #editWork (aangifte bijhouden, Checkinatwork-export), #readContract (bedrag en adres van de opdrachtgever).
      case (#checkWithholding) internal(p);
      case (#wadmOverview) internal(p);
      // 2.2: de bibliotheek (tekst, eenheid, contractvorm, standaard-OA, duur) is intern: interne rollen lezen (de werfleider
      // gebruikt de teksten bij de opmeting, 2.9). Bewerken doen zij die offertes maken (R22: admin, calculator). Een
      // werfleider die ook calculator is, mag het via die rol (rechten = som van rollen); de werfleiderrol zelf nooit.
      case (#readLibrary) internal(p);
      case (#editLibrary) admin or calc;
      // R27
      case (#readConfidentialContact) admin or calc;
      // R17
      case (#manageSettings) admin;
      case (#manageRobots) admin;
      case (#export) admin;
      case (#readAudit) admin;
      // R29: tickets voor actieve personen; welke taak, beslist Config.ticketTasks
      case (#useTickets) internal(p);
      // R27: contractparameters en klantcontact van een werf: admin, calculator. Een werfleider enkel
      // als hij ook calculator is (rechten = som van rollen); de werfleiderrol zelf nooit.
      case (#readContract) on(func w = (admin or calc) and seesWork(ctx, p, w));
      case (#editContract) on(func w = (admin or calc) and seesWork(ctx, p, w));
      // R27: de afgeleide feiten (waarborg ja/nee, 30bis, Checkinatwork) voor interne rollen, zonder bedragen
      case (#readWorkFacts) on(func w = internal(p) and seesWork(ctx, p, w));
      // De werfleider van een werf aanduiden is een interne toewijzing (zoals een werfleider-lidmaatschap)
      case (#setLeader) on(func w = admin);
    };
  };

  // Een OA die op minstens één bestaande werf actief lid is als onderaannemer (persoonlijk of via zijn firma).
  func activeOa(ctx : Ctx, p : Person) : Bool {
    ctx.works.memberships.values().any(
      func m = m.endedAt == null and m.role == #onderaannemer and workExists(ctx, m.workId) and (m.personId == ?p.id or (m.personId == null and m.orgId != null and m.orgId == p.orgId))
    );
  };

  // ── Afwezigheden (1.4) ──────────────────────────────────────────────────
  // Lezen: interne rollen alles (weekbord); een OA enkel die van zijn eigen firma, zolang hij actief OA is.
  public func mayReadAbsences(ctx : Ctx, p : Person, orgId : Types.OrgId) : Bool {
    if (may(ctx, p, #readOrgPlanning, null)) { return true };
    p.archivedAt == null and has(p, #onderaannemer) and p.orgId == ?orgId and activeOa(ctx, p);
  };

  // Ingeven of wijzigen: admin en werfleider elke afwezigheid; een OA enkel voor zijn eigen firma, en een
  // bestaande enkel als ze door zijn firma gemeld werd (wat kantoor ingaf, past hij niet aan).
  public func mayEditAbsence(ctx : Ctx, p : Person, orgId : Types.OrgId, existing : ?Types.AbsenceSource) : Bool {
    if (may(ctx, p, #manageAbsences, null)) { return true };
    may(ctx, p, #reportOwnAbsence, null) and p.orgId == ?orgId and (existing == null or existing == ?#oa);
  };

  public func require(ctx : Ctx, p : Person, action : Action, work : ?WorkId) {
    if (not may(ctx, p, action, work)) { Runtime.trap("Geen toegang") };
  };

  // ── Documenten (R10, R11) ───────────────────────────────────────────────
  // Wat een documentsoort zegt over wie mag lezen en leveren. deliverer null = BOWACO (interne rollen).
  public type DocAccess = { deliverer : ?Role; oaVisible : Bool; confidential : Bool; ownerOrgId : ?Types.OrgId };

  public func mayReadDoc(ctx : Ctx, p : Person, w : WorkId, d : DocAccess) : Bool {
    if (not may(ctx, p, #readDocs, ?w)) { return false };
    if (d.confidential) { return may(ctx, p, #readCosts, null) };
    if (internal(p)) { return true };
    if (memberAs(ctx, p, w, #architect)) { return true };
    if (memberAs(ctx, p, w, #veiligheidscoordinator) and (d.deliverer == ?#veiligheidscoordinator or d.oaVisible)) { return true };
    if (memberAs(ctx, p, w, #onderaannemer) and (d.oaVisible or (d.ownerOrgId != null and d.ownerOrgId == p.orgId))) { return true };
    memberAs(ctx, p, w, #klant) and d.deliverer == ?#klant;
  };

  // Een bestand aan een document hangen (en het zo "ontvangen" zetten). Interne rollen: elk document
  // dat ze mogen zien; externen enkel de soorten die hun rol levert (VC: VG-plan …), met uploadrecht.
  // De klant levert in fase 1 nog niets zelf (fase 4); BOWACO hangt zijn attest eraan.
  public func mayDeliverDoc(ctx : Ctx, p : Person, w : WorkId, d : DocAccess) : Bool {
    if (not may(ctx, p, #uploadDocs, ?w)) { return false };
    if (not mayReadDoc(ctx, p, w, d)) { return false };
    if (internal(p)) { return true };
    if (d.confidential) { return false };
    switch (d.deliverer) {
      case (?#veiligheidscoordinator) memberAs(ctx, p, w, #veiligheidscoordinator);
      case (?#architect) memberAs(ctx, p, w, #architect) and grant(ctx, p, w, #uploadDocs);
      case (?#onderaannemer) memberAs(ctx, p, w, #onderaannemer);
      case _ false;
    };
  };

  // ── Planning (1.3): wat iemand van de planning van een werf ziet ─────────
  // #full = alles (interne rollen) · #external = alles behalve interne notities (architect,
  // veiligheidscoördinator) · #ownOrg = enkel de taken met een toewijzing aan de eigen firma (OA) ·
  // #summary = taken, data en status zonder firma's en notities (klant) · #none = niets.
  public type PlanScope = { #none; #full; #external; #ownOrg; #summary };

  public func planScope(ctx : Ctx, p : Person, w : WorkId) : PlanScope {
    if (not may(ctx, p, #readPlanning, ?w)) { return #none };
    if (internal(p)) { return #full };
    if (memberAs(ctx, p, w, #architect) or memberAs(ctx, p, w, #veiligheidscoordinator)) { return #external };
    if (memberAs(ctx, p, w, #onderaannemer)) { return if (p.orgId != null) #ownOrg else #none };
    if (memberAs(ctx, p, w, #klant)) { return #summary };
    #none;
  };

  // ── Werfverslag (1.6, R8): wat iemand van de verslagen van een werf ziet ──
  // #full = alles (admin, werfleider, calculator; ritten volgen R14 apart) · #reader = architect of
  // veiligheidscoördinator met de grant #readReports: alles behalve ritten en de foto van een bon ·
  // #summary = klant: dag, uitgevoerde werken en foto's, zonder namen, uren of problemen · #ownHours = OA:
  // enkel de aanwezigheidsregels van zijn eigen firma · #none.
  public type ReportScope = { #none; #full; #reader; #summary; #ownHours };

  public func reportScope(ctx : Ctx, p : Person, w : WorkId) : ReportScope {
    if (p.archivedAt != null or not workExists(ctx, w)) { return #none };
    if (may(ctx, p, #readReports, ?w)) { return if (internal(p)) #full else #reader };
    if (memberAs(ctx, p, w, #onderaannemer)) { return if (p.orgId != null) #ownHours else #none };
    if (memberAs(ctx, p, w, #klant)) { return #summary };
    #none;
  };

  // R7: afsluiten mag de persoon die het verslag begon, de werfleider van de werf (fiche) of een admin.
  public func mayFinalizeReport(ctx : Ctx, p : Person, w : WorkId, authorId : Nat, leaderId : ?Nat) : Bool {
    may(ctx, p, #writeReport, ?w) and (has(p, #admin) or authorId == p.id or leaderId == ?p.id);
  };

  // R14: een rit lezen. Admin alle; een werfleider de ritten waarop hij chauffeur is of die hij ingaf.
  public func mayReadTrip(ctx : Ctx, p : Person, createdBy : Nat, drivers : [?Nat]) : Bool {
    if (not may(ctx, p, #readTrips, null)) { return false };
    has(p, #admin) or createdBy == p.id or drivers.any(func d = d == ?p.id);
  };

  // Kan deze persoon werfleider zijn van een werf? (fiche: rol werfleider, niet afgezet)
  public func canLead(p : Person) : Bool { p.archivedAt == null and has(p, #werfleider) };

  public func roleFromKey(k : Text) : ?Role {
    switch k {
      case "admin" ?#admin;
      case "werfleider" ?#werfleider;
      case "calculator" ?#calculator;
      case "architect" ?#architect;
      case "onderaannemer" ?#onderaannemer;
      case "klant" ?#klant;
      case "veiligheidscoordinator" ?#veiligheidscoordinator;
      case _ null;
    };
  };

  // Wat de beller op één werf mag (voor de knoppen van de werfpagina; de backend controleert opnieuw).
  public func workCaps(ctx : Ctx, p : Person, w : WorkId) : Views.WorkCaps {
    {
      edit = may(ctx, p, #editWork, ?w);
      manageMembers = may(ctx, p, #manageMembers, ?w);
      setLeader = may(ctx, p, #setLeader, ?w);
      contract = may(ctx, p, #readContract, ?w);
      upload = may(ctx, p, #uploadDocs, ?w);
    };
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

  // 1.7: welke rechten (grants) bij een externe rol passen (instelbaar per lidmaatschap).
  public func allowedGrants(r : Role) : [Types.Grant] {
    switch r {
      case (#architect) [#readReports, #uploadDocs, #readSellPrices, #readProgress];
      case (#onderaannemer) [#confirmPlanning, #confirmHours];
      case (#veiligheidscoordinator) [#uploadDocs, #readReports];
      case (#klant) [#readProgress];
      case _ [];
    };
  };

  public func grantKey(g : Types.Grant) : Text {
    switch g {
      case (#readReports) "verslagen lezen";
      case (#readSellPrices) "verkoopprijzen";
      case (#readProgress) "vorderingsstaten";
      case (#uploadDocs) "documenten opladen";
      case (#confirmHours) "uren bevestigen";
      case (#confirmPlanning) "planning bevestigen";
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

  // Een persoon met enkel externe rollen hoort bij een externe organisatie (OA-firma, bureau, klant);
  // een interne rol hoort bij BOWACO zelf (geen organisatie of een organisatie van soort #bowaco).
  public func orgRuleError(roles : [Role], orgKind : ?Types.OrgKind) : ?Text {
    let externalOnly = roles.size() > 0 and roles.all(isExternalRole);
    switch orgKind {
      case null { if (externalOnly) ?"Kies de organisatie van deze persoon (onderaannemer, bureau of klant)" else null };
      case (?#bowaco) { if (externalOnly) ?"Een externe rol hoort bij een externe organisatie, niet bij BOWACO" else null };
      case (?_) { if (not externalOnly) ?"Een interne rol hoort bij BOWACO zelf, niet bij een externe organisatie" else null };
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
      readContracts = may(ctx, p, #readCosts, null);
      readOa = may(ctx, p, #readOa, null);
      manageOa = may(ctx, p, #manageOa, null);
      importOa = may(ctx, p, #importOa, null);
      manageCompanyCalendar = may(ctx, p, #manageCompanyCalendar, null);
      manageTemplates = may(ctx, p, #manageTemplates, null);
      readOrgPlanning = may(ctx, p, #readOrgPlanning, null);
      manageAbsences = may(ctx, p, #manageAbsences, null);
      reportOwnAbsence = may(ctx, p, #reportOwnAbsence, null);
      manageBoardRules = may(ctx, p, #manageBoardRules, null);
      importPlan = may(ctx, p, #importPlan, null);
      writeReports = may(ctx, p, #reportWriter, null);
      manageVehicles = may(ctx, p, #manageVehicles, null);
      readTrips = may(ctx, p, #readTrips, null);
      permits = may(ctx, p, #permitsOverview, null);
      readMunicipalities = may(ctx, p, #readMunicipalities, null);
      manageMunicipalities = may(ctx, p, #manageMunicipalities, null);
      managePermitKinds = may(ctx, p, #managePermitKinds, null);
      wadm = may(ctx, p, #wadmOverview, null);
      readLibrary = may(ctx, p, #readLibrary, null);
      editLibrary = may(ctx, p, #editLibrary, null);
      libraryPrices = may(ctx, p, #readCosts, null) and may(ctx, p, #readSellPrices, null);
      upload = may(ctx, p, #upload, null);
      home = home(p);
    };
  };
};
