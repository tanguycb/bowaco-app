// Aankoopfacturen zoals ze binnenkomen (stap 2c.7, ontwerp 2c §4.7; VOORLOPIG: AC-23, AC-24). Rekenen en zoeken zonder rechten
// (lib/Rights.mo beslist wie wat ziet; de controle van een werfdeel staat in lib/OaInvoice.mo):
//   - een aankoop over meerdere werven = één werfdeel (OA-factuur van 2.11) per werf; de regels van een werfdeel zijn de regels van
//     de aankoop op die werf, in dezelfde volgorde (regel k van het werfdeel = de k-de regel van de aankoop op die werf);
//   - uren per dag: personen × (som van de tijdvakken − pauze), in duizendsten van een uur; de vraag aan de werfleider (instelbaar:
//     enkel bij een verschil met het werfverslag, AC-24, of altijd);
//   - het tarief van de werf per dag (2c.4): bedrag = Σ uren van die dag × het tarief van die dag (een tariefwissel in de periode
//     rekent zo juist);
//   - OA-voorschotten (uit de afspraak, max. 20 %) en hun aftrek; de kosten die doorgerekend worden aan de klant (voor 2c.5).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import Config "Config";
import OaDeals "OaDeals";
import QuoteCalc "QuoteCalc";
import Quotes "Quotes";

module {
  type D = Types.PurchaseState;
  type Day = Types.Day;

  public func plain<T>(c : Types.Confidential<T>) : ?T { switch c { case (#plain x) ?x; case (#sealed _) null } };

  // ── Instellingen (settings.values, geen migratie) ────────────────────────
  // Uren aan de werfleider vragen: "verschil" (enkel bij een verschil met het werfverslag, standaard, AC-24) · "altijd".
  public func askMode(s : Types.SettingsState) : Text { if (s.values.get("purchase.askHours") == ?"altijd") "altijd" else "verschil" };
  // Nieuwe regels van kosten (geen post, regie of voorschot) standaard doorrekenen: "ja" (standaard) · "nee".
  public func passOnDefault(s : Types.SettingsState) : Bool { s.values.get("purchase.passOn") != ?"nee" };

  // ── Sleutels en lezen ────────────────────────────────────────────────────
  public func keyOf(orgId : Nat, number : Text) : Text { orgId.toText() # ":" # Text.toUpper(number.trim(#char ' ')) };
  // De sleutel van een werfdeel in oaInvoices.keys (het formaat "<firma>:<NUMMER>" blijft voor de facturen van 2.11).
  public func partKey(orgId : Nat, number : Text, workId : Nat) : Text { keyOf(orgId, number) # "@" # workId.toText() };

  public func amountsOf(d : D, id : Nat) : ?Types.PurchaseAmounts { switch (d.amounts.get(id)) { case (?c) plain(c); case null null } };

  public func purchasesOf(d : D, workId : Nat) : [Types.Purchase] {
    Quotes.ids(d.byWork, workId).filterMap(func(id : Nat) : ?Types.Purchase = d.purchases.get(id));
  };

  public func claimsOf(d : D, purchaseId : Nat) : [Types.HourClaim] {
    let out = List.empty<Types.HourClaim>();
    switch (amountsOf(d, purchaseId)) {
      case (?a) { for (l in a.lines.values()) { for (cid in l.claimIds.values()) { switch (d.claims.get(cid)) { case (?c) out.add(c); case null {} } } } };
      case null {};
    };
    out.toArray();
  };

  // De regels van een aankoop op één werf (in volgorde): de regels van het werfdeel.
  public func linesOfWork(a : Types.PurchaseAmounts, workId : Nat) : [Types.PurchaseLine] { a.lines.filter(func(l : Types.PurchaseLine) : Bool = l.workId == ?workId) };

  // De werven van een aankoop (in volgorde van de regels).
  public func worksOf(a : Types.PurchaseAmounts) : [Nat] {
    let out = List.empty<Nat>();
    for (l in a.lines.values()) { switch (l.workId) { case (?w) { if (out.find(func x = x == w) == null) { out.add(w) } }; case null {} } };
    out.toArray();
  };

  // Telt mee (al gefactureerd, voorschot, doorrekenen): geregistreerd, in controle of goedgekeurd.
  public func counts(s : Types.PurchaseStatus) : Bool { s == #registered or s == #checking or s == #approved };

  public func statusKey(s : Types.PurchaseStatus) : Text {
    switch s { case (#registered) "geregistreerd"; case (#checking) "in-controle"; case (#approved) "goedgekeurd"; case (#disputed) "betwist"; case (#withdrawn) "ingetrokken" };
  };

  public func kindKey(k : Types.PurchaseKind) : Text { switch k { case (#oa) "oa"; case (#supplier) "leverancier"; case (#other) "andere" } };

  // De stand van een aankoop met werfdelen volgt de delen: een betwist deel = betwist; alle goedgekeurd = goedgekeurd; een deel
  // goedgekeurd = in controle; anders geregistreerd.
  public func statusFromParts(parts : [Types.OaInvoiceStatus]) : Types.PurchaseStatus {
    let live = parts.filter(func s = s != #withdrawn);
    if (live.size() == 0) { return #withdrawn };
    if (live.any(func s = s == #disputed)) { return #disputed };
    if (live.all(func s = s == #approved)) { return #approved };
    if (live.any(func s = s == #approved)) { return #checking };
    #registered;
  };

  // De stand van een aankoop met werfdelen opnieuw uit de delen (na goedkeuren of betwisten van een deel). Geeft (oud, nieuw) als
  // ze veranderde.
  public func syncStatus(d : D, oi : Types.OaInvoiceState, purchaseId : Nat, now : Int, by : Nat) : ?(Types.PurchaseStatus, Types.PurchaseStatus) {
    let p = d.purchases.get(purchaseId) ?? return null;
    if (p.parts.size() == 0 or p.status == #withdrawn) { return null };
    let st = statusFromParts(p.parts.filterMap(func(pid : Nat) : ?Types.OaInvoiceStatus = switch (oi.invoices.get(pid)) { case (?i) ?i.status; case null null }));
    if (st == p.status) { return null };
    d.purchases.add(p.id, { p with status = st; rev = p.rev + 1; updatedAt = now; updatedBy = by });
    ?(p.status, st);
  };

  // ── Kostensoorten ────────────────────────────────────────────────────────
  public func costKey(k : Types.CostKind) : Text {
    switch k {
      case (#post) "post";
      case (#regie) "regie";
      case (#crew) "ploeg";
      case (#transportHour) "transport";
      case (#dieselKm) "diesel";
      case (#kmLevy) "kmheffing";
      case (#material) "materiaal";
      case (#containerTon) "container";
      case (#machineHire) "machine";
      case (#advance) "voorschot";
      case (#advanceDeduct) "aftrek-voorschot";
      case (#other t) "andere:" # t;
    };
  };

  public func costFromKey(k : Text) : ?Types.CostKind {
    switch k {
      case "post" ?#post;
      case "regie" ?#regie;
      case "ploeg" ?#crew;
      case "transport" ?#transportHour;
      case "diesel" ?#dieselKm;
      case "kmheffing" ?#kmLevy;
      case "materiaal" ?#material;
      case "container" ?#containerTon;
      case "machine" ?#machineHire;
      case "voorschot" ?#advance;
      case "aftrek-voorschot" ?#advanceDeduct;
      case _ {
        if (k.startsWith(#text "andere:")) {
          let t = Text.fromIter(k.chars().drop(7)).trim(#char ' ');
          if (t.size() >= 1 and t.size() <= Config.maxName) ?#other(t) else null;
        } else null;
      };
    };
  };

  public func costName(k : Types.CostKind) : Text {
    switch k {
      case (#post) "Post van de offerte";
      case (#regie) "Regie (manuren)";
      case (#crew) "Ploeguren";
      case (#transportHour) "Transport per uur";
      case (#dieselKm) "Diesel per km";
      case (#kmLevy) "Kilometerheffing";
      case (#material) "Materiaal";
      case (#containerTon) "Container en afvoer per ton";
      case (#machineHire) "Machinehuur";
      case (#advance) "Voorschot";
      case (#advanceDeduct) "Aftrek voorschot";
      case (#other t) t;
    };
  };

  // Een kost (geen post, geen uren, geen voorschot): kan doorgerekend worden aan de klant.
  public func isCost(k : Types.CostKind) : Bool {
    switch k { case (#post or #regie or #crew or #advance or #advanceDeduct) false; case _ true };
  };
  public func isHours(k : Types.CostKind) : Bool { k == #regie or k == #crew };

  // Het tarief van de afspraak (2c.4) dat bij een kostensoort hoort (soort en eenheid).
  public func rateKindOf(k : Types.CostKind) : ?(Types.RateKind, Text) {
    switch k {
      case (#crew) ?(#crewHour, "uur");
      case (#transportHour) ?(#transportHour, "uur");
      case (#dieselKm) ?(#dieselKm, "km");
      case (#kmLevy) ?(#kmLevy, "km");
      case (#containerTon) ?(#containerTon, "ton");
      case (#machineHire) ?(#machineDay, "dag");
      case _ null;
    };
  };

  // Hoe de regel in het werfdeel (OA-factuur van 2.11) staat: een post blijft een post; regie en ploeguren worden regie in manuren
  // (personen × uren, tarief per persoon); de rest is een andere kost (de controle kent de soort uit de aankoop).
  public func partLine(l : Types.PurchaseLine) : Types.OaInvoiceLine {
    switch (l.kind) {
      case (#post) { { kind = #post; root = l.root; description = l.description; qtyMilli = l.qtyMilli; unitCents = l.unitCents; amountCents = l.amountCents } };
      case (#regie) { { kind = #regie; root = l.root; description = l.description; qtyMilli = l.qtyMilli; unitCents = l.unitCents; amountCents = l.amountCents } };
      case (#crew) {
        let n : Nat = switch (l.persons) { case (?p) { if (p == 0) 1 else p }; case null 1 };
        { kind = #regie; root = l.root; description = l.description; qtyMilli = l.qtyMilli * n; unitCents = QuoteCalc.roundDiv(l.unitCents, n); amountCents = l.amountCents };
      };
      case _ { { kind = #other; root = null; description = l.description; qtyMilli = l.qtyMilli; unitCents = l.unitCents; amountCents = l.amountCents } };
    };
  };

  // ── Uren ─────────────────────────────────────────────────────────────────
  // Minuten per persoon: som van de tijdvakken − pauze (nooit onder 0).
  public func minutesPerPerson(slots : [Types.TimeSlot], pauseMin : Nat) : Nat {
    var m = 0;
    for (s in slots.values()) { if (s.toMin > s.fromMin) { m += s.toMin - s.fromMin } };
    if (pauseMin >= m) 0 else m - pauseMin;
  };
  public func claimHours(persons : Nat, slots : [Types.TimeSlot], pauseMin : Nat) : Int {
    QuoteCalc.roundDiv(persons * minutesPerPerson(slots, pauseMin) * 1000, 60);
  };

  // Wat het werfverslag zegt over deze firma op die werf en die dag: personen en uren (alle geldige aanwezigheden, regie of niet).
  public func reportHours(reports : Types.ReportState, workId : Nat, orgId : Nat, day : Day) : (Nat, Int) {
    var persons = 0;
    var minutes = 0;
    for (a in reports.attendances.values()) {
      if (a.workId == workId and a.orgId == ?orgId and a.day == day and a.archivedAt == null and a.replacedBy == null) {
        persons += a.headcount;
        minutes += a.minutesTotal;
      };
    };
    (persons, QuoteCalc.roundDiv(minutes * 1000, 60));
  };

  // Gaat de dag als vraag naar de werfleider? Altijd (instelling) of enkel bij een verschil met het werfverslag (AC-24).
  public func asked(s : Types.SettingsState, reports : Types.ReportState, c : Types.HourClaim) : Bool {
    if (askMode(s) == "altijd") { return true };
    let (n, h) = reportHours(reports, c.workId, c.orgId, c.day);
    h != c.hoursMilli or n != c.persons;
  };

  // De stand van één dag: "klopt" · "klopt-niet" · "te-bevestigen" · "geen-vraag" (geen verschil, niet gevraagd).
  public func claimState(s : Types.SettingsState, reports : Types.ReportState, c : Types.HourClaim) : Text {
    switch (c.review) {
      case (?r) { if (r.ok) "klopt" else "klopt-niet" };
      case null { if (asked(s, reports, c)) "te-bevestigen" else "geen-vraag" };
    };
  };

  // ── Het tarief van de werf per dag (2c.4) ───────────────────────────────
  // Het tarief van die soort en eenheid in de afspraak van deze firma op deze werf, op die dag (een beëindigde afspraak telt tot
  // de einddag), met de dag waarop het begon.
  public func dealRateAt(deals : Types.OaDealState, workId : Nat, orgId : Nat, kind : Types.RateKind, unit : Text, day : Day) : ?(Int, Day) {
    let a = OaDeals.agreementOf(deals, workId, orgId) ?? return null;
    switch (a.status) { case (#ended e) { if (day > OaDeals.dayOf(e.at)) return null }; case _ {} };
    let t = OaDeals.termsOf(deals, a.id) ?? return null;
    switch (OaDeals.agreedRateAt(t, kind, unit, day)) { case (?r) ?(r.cents, r.validFrom); case null null };
  };

  public type DayCalc = { day : Day; hoursMilli : Int; rateCents : ?Int; rateFrom : ?Day; cents : ?Int };

  // Per dag: uren × het tarief van die dag. Regie: het regietarief per persoon op de manuren. Ploeguren: het ploegtarief van de
  // afspraak op de ploeguren (manuren / personen) als de afspraak er een heeft, anders het regietarief per persoon op de manuren.
  // Het totaal is null als een dag geen tarief heeft.
  public func dayCalc(deals : Types.OaDealState, l : Types.PurchaseLine, claims : [Types.HourClaim], workId : Nat, orgId : Nat) : ([DayCalc], ?Int) {
    var total : ?Int = ?0;
    let out = claims.map(
      func(c : Types.HourClaim) : DayCalc {
        let crew = if (l.kind == #crew) dealRateAt(deals, workId, orgId, #crewHour, "uur", c.day) else null;
        let (rate, cents) = switch crew {
          case (?(r, f)) { let n = if (c.persons == 0) 1 else c.persons; (?(r, f), QuoteCalc.roundDiv(c.hoursMilli * r, 1000 * n)) };
          case null {
            switch (dealRateAt(deals, workId, orgId, #regiePerson, "uur", c.day)) {
              case (?(r, f)) (?(r, f), QuoteCalc.roundDiv(c.hoursMilli * r, 1000));
              case null (null, 0);
            };
          };
        };
        switch (rate, total) { case (?_, ?t) { total := ?(t + cents) }; case (null, _) { total := null }; case _ {} };
        switch rate {
          case (?(r, f)) { { day = c.day; hoursMilli = c.hoursMilli; rateCents = ?r; rateFrom = ?f; cents = ?cents } };
          case null { { day = c.day; hoursMilli = c.hoursMilli; rateCents = null; rateFrom = null; cents = null } };
        };
      }
    );
    (out, if (claims.size() == 0) null else total);
  };

  // ── OA-voorschotten (afspraak 2c.4, max. 20 %) ──────────────────────────
  // Wat de afspraak als voorschot toelaat: het vaste bedrag, anders het percentage op het afgesproken totaal; null = geen afspraak.
  public func allowedAdvance(deals : Types.OaDealState, workId : Nat, orgId : Nat) : ?Int {
    let a = OaDeals.agreementOf(deals, workId, orgId) ?? return null;
    let t = OaDeals.termsOf(deals, a.id) ?? return ?0;
    switch (t.advanceCents) {
      case (?c) ?c;
      case null { switch (t.amountCents) { case (?amt) ?QuoteCalc.roundDiv(amt * a.advanceBp, 10_000); case null ?0 } };
    };
  };

  // De voorschotten en de aftrekken van deze firma op deze werf (aankopen die meetellen), zonder een aankoop.
  public func advanceSums(d : D, workId : Nat, orgId : Nat, except : ?Nat) : (Int, Int) {
    var adv : Int = 0;
    var ded : Int = 0;
    for (p in purchasesOf(d, workId).values()) {
      if (p.orgId == orgId and counts(p.status) and ?p.id != except) {
        switch (amountsOf(d, p.id)) {
          case (?a) { for (l in linesOfWork(a, workId).values()) { if (l.kind == #advance) { adv += l.amountCents } else if (l.kind == #advanceDeduct) { ded += Int.abs(l.amountCents) } } };
          case null {};
        };
      };
    };
    (adv, ded);
  };

  // De voorschotten (sleutel = het werfdeel van de voorschotfactuur) van deze firma op deze werf opnieuw uitrekenen, met de
  // aftrekken in volgorde (oudste voorschot eerst). Enkel aankopen die meetellen.
  public func syncAdvances(d : D, deals : Types.OaDealState, oi : Types.OaInvoiceState, workId : Nat, orgId : Nat) {
    let ag = switch (OaDeals.agreementOf(deals, workId, orgId)) { case (?a) a; case null return };
    let old = List.empty<Nat>();
    for ((k, c) in d.advances.entries()) { switch (plain(c)) { case (?x) { if (x.agreementId == ag.id) { old.add(k) } }; case null {} } };
    for (k in old.values()) { d.advances.remove(k) };
    let ps = purchasesOf(d, workId).filter(func(p : Types.Purchase) : Bool = p.orgId == orgId and counts(p.status)).sort(func(a, b) = if (a.invoiceDay == b.invoiceDay) Nat.compare(a.id, b.id) else Nat.compare(a.invoiceDay, b.invoiceDay));
    let advs = List.empty<(Nat, Types.OaAdvance)>();
    for (p in ps.values()) {
      let lines = switch (amountsOf(d, p.id)) { case (?a) linesOfWork(a, workId); case null [] };
      var c : Int = 0;
      for (l in lines.values()) { if (l.kind == #advance) { c += l.amountCents } };
      if (c != 0) {
        let part = p.parts.find(func(pid : Nat) : Bool = switch (oi.invoices.get(pid)) { case (?i) i.workId == workId; case null false });
        switch part { case (?pid) { advs.add((pid, { agreementId = ag.id; purchaseId = p.id; cents = c; deducted = [] })) }; case null {} };
      };
    };
    let result = Array.toVarArray<(Nat, Types.OaAdvance)>(advs.toArray());
    for (p in ps.values()) {
      let lines = switch (amountsOf(d, p.id)) { case (?a) linesOfWork(a, workId); case null [] };
      var rest : Int = 0;
      for (l in lines.values()) { if (l.kind == #advanceDeduct) { rest += Int.abs(l.amountCents) } };
      var i = 0;
      while (rest > 0 and i < result.size()) {
        let (k, a) = result[i];
        var used : Int = 0;
        for ((_, x) in a.deducted.values()) { used += x };
        let room = a.cents - used;
        if (room > 0) {
          let take = if (rest < room) rest else room;
          rest -= take;
          result[i] := (k, { a with deducted = a.deducted.concat([(p.id, take)]) });
        };
        i += 1;
      };
    };
    for ((k, a) in Array.fromVarArray(result).values()) { d.advances.add(k, #plain(a)) };
  };

  // ── Doorrekenen aan de klant (voor de min-meerstaat van 2c.5) ───────────
  // Eén kostenregel van een aankoop op een werf, die kantoor aan de klant doorrekent (PurchaseLine.passOn). De min-meerstaat rekent
  // de verkoopprijs (kostprijs / (1 − marge), standaard / 0,8) en kent de regel aan zijn sleutel "kost:<aankoop>:<regel>" (MmOverride).
  public type PassOnCost = {
    key : Text; // "kost:<aankoop>:<regel>" (regel = plaats in de aankoop, vanaf 0)
    purchaseId : Nat;
    lineIndex : Nat;
    orgId : Nat;
    orgName : Text;
    number : Text;
    day : Day; // het einde van de periode, anders de factuurdatum
    kind : Types.CostKind;
    kindKey : Text;
    description : Text;
    unit : Text;
    qtyMilli : Int;
    costCents : Int; // het bedrag van de regel (kostprijs, excl. btw)
    status : Types.PurchaseStatus;
    source : Text; // "aankoop <nummer> <firma>"
  };

  // De doorrekenbare kostenregels van één werf, in de periode (dag ≥ from, dag ≤ to) als die er is. onlyApproved: enkel goedgekeurde
  // aankopen (anders ook geregistreerd en in controle; nooit betwist of ingetrokken). Geen posten, geen uren, geen voorschotten.
  public func passOnCosts(d : D, org : Types.OrgState, workId : Nat, from : ?Day, to : ?Day, onlyApproved : Bool) : [PassOnCost] {
    let out = List.empty<PassOnCost>();
    for (p in purchasesOf(d, workId).values()) {
      let day = switch (p.periodTo) { case (?t) t; case null p.invoiceDay };
      let inPeriod = (switch from { case (?f) day >= f; case null true }) and (switch to { case (?t) day <= t; case null true });
      let st = if (onlyApproved) p.status == #approved else counts(p.status);
      if (inPeriod and st) {
        let name = switch (org.orgs.get(p.orgId)) { case (?o) o.name; case null "#" # p.orgId.toText() };
        switch (amountsOf(d, p.id)) {
          case (?a) {
            var k = 0;
            for (l in a.lines.values()) {
              if (l.workId == ?workId and l.passOn and isCost(l.kind)) {
                out.add({ key = "kost:" # p.id.toText() # ":" # k.toText(); purchaseId = p.id; lineIndex = k; orgId = p.orgId; orgName = name; number = p.number; day; kind = l.kind; kindKey = costKey(l.kind); description = l.description; unit = l.unit; qtyMilli = l.qtyMilli; costCents = l.amountCents; status = p.status; source = "aankoop " # p.number # " " # name });
              };
              k += 1;
            };
          };
          case null {};
        };
      };
    };
    out.toArray();
  };

  // ── Indexen (herstel) en bestanden ───────────────────────────────────────
  func clearText(m : Map.Map<Text, Nat>) { for (k in m.keys().toArray().values()) { m.remove(k) } };
  func clearNat<V>(m : Map.Map<Nat, V>) { for (k in m.keys().toArray().values()) { m.remove(k) } };

  // Na een herstel: de indexen uit de records zelf, en de sleutels van de werfdelen in oaInvoices.keys ("<firma>:<NUMMER>@<werf>";
  // de gewone herberekening van 2.11 zette er "<firma>:<NUMMER>" voor).
  public func rebuildIndex(d : D, oi : Types.OaInvoiceState) {
    clearText(d.keys);
    clearNat(d.byWork);
    clearNat(d.claimsByWork);
    clearNat(d.partOf);
    for (p in d.purchases.values()) {
      if (p.status != #withdrawn) { d.keys.add(keyOf(p.orgId, p.number), p.id) };
      switch (amountsOf(d, p.id)) { case (?a) { for (w in worksOf(a).values()) { Quotes.addIndex(d.byWork, w, p.id) } }; case null {} };
      for (pid in p.parts.values()) {
        d.partOf.add(pid, p.id);
        switch (oi.invoices.get(pid)) {
          case (?i) {
            let plainKey = keyOf(i.orgId, i.number);
            if (oi.keys.get(plainKey) == ?pid) { oi.keys.remove(plainKey) };
            if (i.status != #withdrawn) { oi.keys.add(partKey(i.orgId, i.number, i.workId), pid) };
          };
          case null {};
        };
      };
    };
    for (c in d.claims.values()) { Quotes.addIndex(d.claimsByWork, c.workId, c.id) };
  };

  public func ownedFiles(d : D) : Map.Map<Nat, ()> {
    let m = Map.empty<Nat, ()>();
    for (p in d.purchases.values()) {
      switch (p.fileId) { case (?f) m.add(f, ()); case null {} };
      switch (p.oaStatementFileId) { case (?f) m.add(f, ()); case null {} };
    };
    m;
  };
};
