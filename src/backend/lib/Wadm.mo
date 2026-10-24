// Werfadministratie (stap 1b.4, bouwplan §5.4): onderaannemers per werf, de aangifte van werken (30bis), de stand van de
// inhoudingsplicht per OA, de Checkinatwork-export. Geen rechten hier: wie wat mag, beslist lib/Rights.mo. Bronnen en
// regels: bowaco-docs/bowaco/onderzoek/1b4-onderzoek-werfadministratie.md (VOORLOPIG tot de boekhouder bevestigt).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Text "mo:core/Text";
import Types "../types";
import Views "../types/views";
import Access "Access";
import Dossier "Dossier";
import Plan "Plan";
import Reports "Reports";

module {
  type Day = Types.Day;

  // ── Onderaannemers van een werf ──────────────────────────────────────────
  // Firma's van de soort onderaannemer die lid zijn van de werf (als firma) of een toewijzing hebben in haar planning.
  public func oaOrgs(org : Types.OrgState, works : Types.WorksState, plan : Types.PlanState, workId : Nat) : [Nat] {
    let seen = Map.empty<Nat, ()>();
    let isOa = func(o : Nat) : Bool { switch (org.orgs.get(o)) { case (?x) x.kind == #subcontractor and x.archivedAt == null; case null false } };
    for (m in works.memberships.values()) {
      if (m.workId == workId and m.endedAt == null and m.role == #onderaannemer) {
        switch (m.orgId) { case (?o) { if (isOa(o)) { seen.add(o, ()) } }; case null {} };
      };
    };
    for (a in plan.assignments.values()) {
      if (a.workId == workId and a.archivedAt == null and isOa(a.orgId)) {
        switch (plan.tasks.get(a.taskId)) { case (?t) { if (t.archivedAt == null) { seen.add(a.orgId, ()) } }; case null {} };
      };
    };
    seen.keys().toArray();
  };

  // Voor de feiten van het dossier (Dossier.Ext): aantal onderaannemers en asbest per werf.
  public func ext(org : Types.OrgState, works : Types.WorksState, plan : Types.PlanState, wadm : Types.WadmState) : Dossier.Ext {
    {
      oaCount = func(w : Nat) : Nat = oaOrgs(org, works, plan, w).size();
      asbestos = func(w : Nat) : Bool { switch (wadm.declarations.get(w)) { case (?d) d.asbestos; case null false } };
    };
  };

  // ── Kalender: de databank van de inhoudingsplicht wordt maandelijks bijgewerkt op de vrijdag na de laatste donderdag
  // van de maand (socialsecurity.be). Een groene raadpleging geldt tot de volgende bijwerking.
  func civil(day : Nat) : (Nat, Nat, Nat) {
    let z = day + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if (mp < 10) mp + 3 else mp - 9;
    (yoe + era * 400 + (if (m <= 2) 1 else 0), m, d);
  };

  func daysFromCivil(y0 : Nat, m : Nat, d : Nat) : Nat {
    let y = if (m <= 2) y0 - 1 else y0;
    let era = y / 400;
    let yoe = y - era * 400;
    let mp = if (m > 2) m - 3 else m + 9;
    let doy = (153 * mp + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
  };

  // Vrijdag na de laatste donderdag van maand (y, m).
  func updateDayOf(y : Nat, m : Nat) : Day {
    let next = if (m == 12) daysFromCivil(y + 1, 1, 1) else daysFromCivil(y, m + 1, 1);
    let last = next - 1;
    let wd = Plan.weekday(last); // 0 = maandag, 3 = donderdag
    let thu = last - ((wd + 7 - 3) % 7);
    thu + 1;
  };

  // De laatste bijwerking van de databank op of vóór `today`.
  public func dbUpdated(today : Day) : Day {
    let (y, m, _) = civil(today);
    let cur = updateDayOf(y, m);
    if (today >= cur) cur else { if (m == 1) updateDayOf(y - 1, 12) else updateDayOf(y, m - 1) };
  };

  public func resultWord(r : Types.WithholdingResult) : Text {
    switch r {
      case (#clear) "geen inhoudingsplicht";
      case (#social) "inhoudingsplicht: sociale schulden";
      case (#fiscal) "inhoudingsplicht: fiscale schulden";
      case (#both) "inhoudingsplicht: sociale en fiscale schulden";
      case (#unknown) "onbekend";
    };
  };

  public func link(kbo : ?Text) : ?Text {
    switch kbo { case (?k) ?("https://www.checkinhoudingsplicht.be/?identificationnumber=" # k); case null null };
  };

  public func checkView(access : Types.AccessState, c : Types.WithholdingCheck) : Views.WithholdingCheckView {
    { id = c.id; orgId = c.orgId; kbo = c.kbo; result = c.result; consultedOn = c.consultedOn; reference = c.reference; note = c.note; source = c.source; workId = c.workId; at = c.at; byName = switch (c.by) { case (?p) Access.personName(access, p); case null "robot" } };
  };

  public func lastCheck(wadm : Types.WadmState, orgId : Nat) : ?Types.WithholdingCheck {
    var best : ?Types.WithholdingCheck = null;
    for (c in wadm.checks.values()) {
      if (c.orgId == orgId) {
        switch best { case (?b) { if (c.consultedOn > b.consultedOn or (c.consultedOn == b.consultedOn and c.id > b.id)) { best := ?c } }; case null best := ?c };
      };
    };
    best;
  };

  // De stand van één OA: "ok" (groen en niet ouder dan de laatste bijwerking) · "verouderd" (groen maar van vóór de
  // laatste bijwerking: opnieuw raadplegen) · "inhoudingsplicht" (rood: geldt enkel op dat moment, vóór elke betaling
  // opnieuw) · "onbekend" · "nooit" · "geen-kbo".
  public func oaStatus(access : Types.AccessState, org : Types.OrgState, wadm : Types.WadmState, orgId : Nat, today : Day) : Views.OaWithholding {
    let o = org.orgs.get(orgId);
    let kbo = switch o { case (?x) x.kbo; case null null };
    let last = lastCheck(wadm, orgId);
    let state = switch (kbo, last) {
      case (null, _) "geen-kbo";
      case (_, null) "nooit";
      case (_, ?c) {
        switch (c.result) {
          case (#clear) { if (c.consultedOn >= dbUpdated(today)) "ok" else "verouderd" };
          case (#unknown) "onbekend";
          case _ "inhoudingsplicht";
        };
      };
    };
    { orgId; name = switch o { case (?x) x.name; case null "#" # orgId.toText() }; kbo; state; last = switch last { case (?c) ?checkView(access, c); case null null }; link = link(kbo) };
  };

  public func declarationView(access : Types.AccessState, d : ?Types.Declaration, start : ?Day) : Views.DeclarationView {
    let deadline : ?Day = switch start { case (?s) ?(if (s > 15) s - 15 else 0); case null null };
    switch d {
      case (?x) { { status = x.status; nature = x.nature; asbestos = x.asbestos; note = x.note; updatedAt = x.updatedAt; updatedByName = Access.personName(access, x.updatedBy); deadline } };
      case null { { status = #todo; nature = "eenmalig"; asbestos = false; note = ""; updatedAt = 0; updatedByName = ""; deadline } };
    };
  };

  // Begin en einde van de werf: eerste start en laatste einde van de taken, anders de geplande data van de fiche.
  public func period(plan : Types.PlanState, works : Types.WorksState, w : Types.Work) : (?Day, ?Day) {
    var from : ?Day = null;
    var to : ?Day = null;
    let ts = Plan.tasksOf(plan, w.id);
    if (ts.size() > 0) {
      let cal = Plan.calFor(plan, works, w.id);
      for (t in ts.values()) {
        let e = Plan.endDay(cal, t.start, t.workdays);
        from := ?(switch from { case (?f) Nat.min(f, t.start); case null t.start });
        to := ?(switch to { case (?x) Nat.max(x, e); case null e });
      };
    };
    (switch from { case null w.plannedStart; case f f }, switch to { case null w.plannedEnd; case x x });
  };

  public func slotsText(slots : [Types.TimeSlot]) : Text {
    slots.map(func(s : Types.TimeSlot) : Text = Reports.hhmm(s.fromMin) # "–" # Reports.hhmm(s.toMin)).values().join(", ");
  };

  public func compareDay(a : Views.CiawRow, b : Views.CiawRow) : Order.Order {
    if (a.day != b.day) Nat.compare(a.day, b.day) else Text.compare(a.orgName, b.orgName);
  };
};
