// OA-facturen (stap 2.11, bouwplan §9 rij 2.11 en §5.1; zonder AI): de controle zonder toestand-wijzigingen, zodat de API
// (mixins/OaInvoiceApi.mo) en de testen dezelfde regels gebruiken. Geen rechten hier (lib/Rights.mo).
// De controle legt elke regel van de factuur naast:
//   • de afspraak: de aankoopprijs van die post in de getekende offerte (QuoteLinePrice.cost, met de OA van die prijs) en de
//     contractvorm van de post;
//   • wat er gemeten of gepresteerd is: VH volgens de opmeting (2.9, alle geldige regels), vaste prijs tot de VH, regie volgens
//     de regie-uren van DEZE OA uit de werfverslagen (1.6) zonder de betwiste uren (1.7);
//   • wat al gefactureerd is: de andere facturen van dezelfde OA op dezelfde werf (geregistreerd of goedgekeurd).
// Een afwijking wordt gemarkeerd boven de drempel (instelbaar: een percentage én een minimumbedrag voor prijzen). De controle
// wordt telkens gerekend, nooit bewaard. Hoeveelheidsmarkeringen gebruiken enkel het percentage: de werfleider ziet ze zonder
// dat ze iets over bedragen verraden.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import Config "Config";
import Library "Library";
import Measure "Measure";
import OaDeals "OaDeals";
import Purchase "Purchase";
import Progress "Progress";
import QuoteCalc "QuoteCalc";
import Quotes "Quotes";
import WorkStart "WorkStart";

module {
  public type Ctx = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    org : Types.OrgState;
    works : Types.WorksState;
    plan : Types.PlanState;
    reports : Types.ReportState;
    qs : Types.QuotesState;
    starts : Types.WorkStartState;
    ss : Types.SurveyState;
    oi : Types.OaInvoiceState;
    deals : Types.OaDealState; // 2c.4: het tarief van de afspraak op deze werf en die dag
    pur : Types.PurchaseState; // 2c.7: een werfdeel van een aankoop (kostensoort, ploeguren, uren per dag, voorschot)
  };

  // ── Instellingen (settings.values, D8: geen migratie) ─────────────────────
  public func thresholdBp(s : Types.SettingsState) : Nat {
    switch (s.values.get("oaInvoice.thresholdBp")) { case (?t) { switch (Nat.fromText(t)) { case (?n) { if (n <= 10_000) n else Config.oaInvoiceThresholdBpDefault }; case null Config.oaInvoiceThresholdBpDefault } }; case null Config.oaInvoiceThresholdBpDefault };
  };
  public func thresholdCents(s : Types.SettingsState) : Nat {
    switch (s.values.get("oaInvoice.thresholdCents")) { case (?t) { switch (Nat.fromText(t)) { case (?n) n; case null Config.oaInvoiceThresholdCentsDefault } }; case null Config.oaInvoiceThresholdCentsDefault };
  };
  // Ziet een OA de status van zijn eigen facturen (standaard uit)?
  public func oaView(s : Types.SettingsState) : Bool { s.values.get("oaInvoice.oaView") == ?"ja" };
  // Een betwisting naar de OA: "melding" (een melding in de app, standaard) · "app" (enkel zichtbaar bij Mijn facturen) · "uit".
  public func disputeNotice(s : Types.SettingsState) : Text {
    switch (s.values.get("oaInvoice.disputeNotice")) { case (?"uit") "uit"; case (?"app") "app"; case _ "melding" };
  };

  // ── Facturen ─────────────────────────────────────────────────────────────
  public func keyOf(orgId : Nat, number : Text) : Text { orgId.toText() # ":" # Text.toUpper(number.trim(#char ' ')) };

  public func invoicesOf(oi : Types.OaInvoiceState, workId : Nat) : [Types.OaInvoice] {
    let ids = switch (oi.byWork.get(workId)) { case (?x) x; case null [] };
    ids.filterMap<Nat, Types.OaInvoice>(func id = oi.invoices.get(id));
  };

  public func amountsOf(oi : Types.OaInvoiceState, id : Nat) : ?Types.OaInvoiceAmounts {
    switch (oi.amounts.get(id)) { case (?c) Library.plainOf(c); case null null };
  };

  // Telt mee als "al gefactureerd": geregistreerd of goedgekeurd (niet betwist, niet ingetrokken).
  public func counts(i : Types.OaInvoice) : Bool { i.status == #registered or i.status == #approved };

  public func statusKey(s : Types.OaInvoiceStatus) : Text {
    switch s { case (#registered) "geregistreerd"; case (#approved) "goedgekeurd"; case (#disputed) "betwist"; case (#withdrawn) "ingetrokken" };
  };

  // ── De posten van de werf (getekende offerte) ────────────────────────────
  public type PostInfo = { root : Nat; lineId : Nat; title : Text; unit : Text; form : Types.ContractForm; chapter : Text; vhMilli : Int; cost : ?Int; costOrgId : ?Nat };

  public func posts(c : Ctx, workId : Nat) : Map.Map<Nat, PostInfo> {
    let m = Map.empty<Nat, PostInfo>();
    for (p in Measure.posts(c.qs, c.starts, workId).values()) {
      let pr = Quotes.priceOf(c.qs, p.line.id);
      m.add(p.root, { root = p.root; lineId = p.line.id; title = p.line.title; unit = p.line.unit; form = p.line.form; chapter = switch (p.chapter) { case (?ch) (ch.code # " " # ch.title).trim(#char ' '); case null "" }; vhMilli = p.line.qtyMilli; cost = pr.cost; costOrgId = pr.orgId });
    };
    m;
  };

  // 2c.4: de dag waarop het tarief van de werf telt: het einde van de periode van de prestaties, anders de factuurdatum.
  public func rateDay(inv : Types.OaInvoice) : Nat { switch (inv.periodTo) { case (?d) d; case null inv.invoiceDay } };

  // 2c.4: eerst het regietarief van de afspraak van deze OA op deze werf op die dag (⚖9), dan de regiepost (zoals in 2.11).
  public func dealRegieRate(c : Ctx, inv : Types.OaInvoice) : ?Int {
    switch (OaDeals.dealRegieAt(c.deals, inv.workId, inv.orgId, rateDay(inv))) { case (?(cents, _)) ?cents; case null null };
  };

  // Het afgesproken uurloon voor regie van deze OA: de aankoopprijs van een regiepost met die OA (de eerste).
  public func regieRate(ps : Map.Map<Nat, PostInfo>, orgId : Nat) : ?Int {
    for (p in ps.values()) { if (p.form == #regie and p.costOrgId == ?orgId) { return p.cost } };
    null;
  };

  // ── Wat gepresteerd is ───────────────────────────────────────────────────
  public type Hours = { valid : Int; open : Int; disputed : Int };
  func zero() : Hours { { valid = 0; open = 0; disputed = 0 } };
  func addH(h : Hours, st : { #ok; #open; #disputed }, x : Int) : Hours {
    switch st { case (#ok) { { h with valid = h.valid + x } }; case (#open) { { h with valid = h.valid + x; open = h.open + x } }; case (#disputed) { { h with disputed = h.disputed + x } } };
  };

  // De regie-uren van deze OA op de werf (in duizendsten van een uur), per regiepost en samen, binnen de periode als die er is.
  public func oaHours(c : Ctx, workId : Nat, orgId : Nat, from : ?Nat, to : ?Nat) : (Map.Map<Nat, Hours>, Hours) {
    let taskRoot = Map.empty<Nat, Nat>();
    for (t in c.plan.tasks.values()) {
      if (t.workId == workId and t.archivedAt == null) {
        label first for (lid in t.quoteLineIds.values()) {
          switch (c.qs.lines.get(lid)) { case (?l) { if (l.form == #regie) { taskRoot.add(t.id, WorkStart.root(c.qs, l.id)); break first } }; case null {} };
        };
      };
    };
    let m = Map.empty<Nat, Hours>();
    var all = zero();
    for (a in c.reports.attendances.values()) {
      let inPeriod = (switch from { case (?f) a.day >= f; case null true }) and (switch to { case (?t) a.day <= t; case null true });
      if (a.workId == workId and a.orgId == ?orgId and Progress.validAttendance(a) and inPeriod) {
        let h = Progress.milliHours(a.minutesTotal);
        let st = Progress.hoursState(c.reports, a);
        all := addH(all, st, h);
        switch (a.taskId) {
          case (?tid) { switch (taskRoot.get(tid)) { case (?r) { m.add(r, addH(switch (m.get(r)) { case (?x) x; case null zero() }, st, h)) }; case null {} } };
          case null {};
        };
      };
    };
    (m, all);
  };

  // Wat al gefactureerd is door deze OA op deze werf, per post en voor regie zonder post (zonder de factuur zelf).
  public type Billed = { qtyMilli : Int; cents : Int; count : Nat };
  public func billed(oi : Types.OaInvoiceState, workId : Nat, orgId : Nat, exceptId : Nat) : (Map.Map<Nat, Billed>, Billed) {
    let m = Map.empty<Nat, Billed>();
    var regie : Billed = { qtyMilli = 0; cents = 0; count = 0 };
    for (i in invoicesOf(oi, workId).values()) {
      if (i.id != exceptId and i.orgId == orgId and counts(i)) {
        switch (amountsOf(oi, i.id)) {
          case (?a) {
            for (l in a.lines.values()) {
              switch (l.kind, l.root) {
                case (#post, ?r) { let b = switch (m.get(r)) { case (?x) x; case null { { qtyMilli = 0; cents = 0; count = 0 } } }; m.add(r, { qtyMilli = b.qtyMilli + l.qtyMilli; cents = b.cents + l.amountCents; count = b.count + 1 }) };
                case (#regie, ?r) { let b = switch (m.get(r)) { case (?x) x; case null { { qtyMilli = 0; cents = 0; count = 0 } } }; m.add(r, { qtyMilli = b.qtyMilli + l.qtyMilli; cents = b.cents + l.amountCents; count = b.count + 1 }) };
                case (#regie, null) { regie := { qtyMilli = regie.qtyMilli + l.qtyMilli; cents = regie.cents + l.amountCents; count = regie.count + 1 } };
                case _ {};
              };
            };
          };
          case null {};
        };
      };
    };
    (m, regie);
  };

  // ── De controle ──────────────────────────────────────────────────────────
  public type LineCheck = {
    index : Nat;
    line : Types.OaInvoiceLine;
    post : ?PostInfo;
    expectedQtyMilli : ?Int; // wat er maximaal aangerekend kan worden (tot nu): opmeting, VH of regie-uren
    expectedFrom : Text; // "opmeting" · "vh" · "regie-uren" · ""
    prevQtyMilli : Int;
    prevCents : Int;
    hours : ?Hours;
    agreedCents : ?Int; // de afgesproken eenheidsprijs (aankoopprijs; regie: uurloon)
    agreedOrg : Bool; // de afspraak is met deze OA
    qtyFlags : [Text]; // enkel hoeveelheden en uren (ook voor de werfleider)
    moneyFlags : [Text]; // prijs en bedrag (enkel admin en calculator)
  };

  public type Control = {
    lines : [LineCheck];
    headerFlags : [Text];
    sumLinesCents : Int;
    expectedVatCents : ?Int;
    oaOnWork : Bool;
    hoursAll : Hours; // alle regie-uren van deze OA op de werf (in de periode)
    flagCount : Nat;
  };

  func absI(x : Int) : Int { if (x < 0) -x else x };

  // Ligt `got` meer dan de drempel boven `allowed`? (percentage van allowed; bij allowed ≤ 0 is elk teveel een afwijking)
  func overBp(got : Int, allowed : Int, bp : Nat) : Bool {
    if (got <= allowed) { return false };
    if (allowed <= 0) { return true };
    (got - allowed) * 10_000 > allowed * bp;
  };

  public func oaOnWork(c : Ctx, workId : Nat, orgId : Nat) : Bool {
    c.works.memberships.values().any(func m = m.workId == workId and m.endedAt == null and m.role == #onderaannemer and m.orgId == ?orgId)
    or c.plan.assignments.values().any(func a = a.workId == workId and a.orgId == orgId and a.archivedAt == null)
    or c.plan.tasks.values().any(func t = t.workId == workId and t.responsibleOrgId == ?orgId and t.archivedAt == null)
    or c.works.memberships.values().any(func m = m.workId == workId and m.endedAt == null and m.role == #onderaannemer and (switch (m.personId) { case (?pid) { switch (c.access.persons.get(pid)) { case (?q) q.orgId == ?orgId; case null false } }; case null false }));
  };

  // 2c.7: een werfdeel van een aankoop krijgt bovenop de controle van 2.11 die van zijn aankoopregels (partControl); een factuur
  // van 2.11 (geen werfdeel) blijft precies zoals ze was.
  public func control(c : Ctx, inv : Types.OaInvoice, a : Types.OaInvoiceAmounts) : Control {
    let base = baseControl(c, inv, a);
    switch (c.pur.partOf.get(inv.id)) { case (?pid) partControl(c, inv, base, pid); case null base };
  };

  func baseControl(c : Ctx, inv : Types.OaInvoice, a : Types.OaInvoiceAmounts) : Control {
    let bp = thresholdBp(c.settings);
    let minC : Int = thresholdCents(c.settings);
    let ps = posts(c, inv.workId);
    let (hoursBy, hoursAll) = oaHours(c, inv.workId, inv.orgId, inv.periodFrom, inv.periodTo);
    let (prevBy, prevRegie) = billed(c.oi, inv.workId, inv.orgId, inv.id);
    let agg = Measure.aggregate(c.ss, inv.workId, null);
    let dealRate = dealRegieRate(c, inv);
    let rate = switch dealRate { case (?r) ?r; case null regieRate(ps, inv.orgId) };
    var flagCount = 0;
    let lines = Array.tabulate<LineCheck>(
      a.lines.size(),
      func k {
        let l = a.lines[k];
        let qf = List.empty<Text>();
        let mf = List.empty<Text>();
        let post = switch (l.root) { case (?r) ps.get(r); case null null };
        let prev = switch (l.kind, l.root) {
          case (#regie, null) prevRegie;
          case (_, ?r) { switch (prevBy.get(r)) { case (?b) b; case null { { qtyMilli = 0; cents = 0; count = 0 } } } };
          case _ { { qtyMilli = 0; cents = 0; count = 0 } };
        };
        var expected : ?Int = null;
        var from = "";
        var hours : ?Hours = null;
        var agreed : ?Int = null;
        var agreedOrg = false;
        switch (l.kind, post) {
          case (#post, ?p) {
            agreed := p.cost;
            agreedOrg := p.costOrgId == ?inv.orgId;
            switch (p.form) {
              case (#regie) {
                switch dealRate { case (?r) { agreed := ?r; agreedOrg := true }; case null {} };
                let h = switch (hoursBy.get(p.root)) { case (?x) x; case null zero() };
                hours := ?h;
                expected := ?h.valid;
                from := "regie-uren";
              };
              case (#fixed) { expected := ?p.vhMilli; from := "vh" };
              case _ {
                let m = switch (agg.get(p.root)) { case (?x) x.measured; case null 0 };
                expected := ?m;
                from := "opmeting";
              };
            };
          };
          case (#regie, _) {
            let h = switch (l.root) { case (?r) { switch (hoursBy.get(r)) { case (?x) x; case null zero() } }; case null hoursAll };
            hours := ?h;
            expected := ?h.valid;
            from := "regie-uren";
            agreed := switch (dealRate, post) { case (?r, _) ?r; case (null, ?p) p.cost; case (null, null) rate };
            agreedOrg := switch (dealRate, post) { case (?_, _) true; case (null, ?p) p.costOrgId == ?inv.orgId; case (null, null) rate != null };
          };
          case (#other, _) { qf.add("niet-gekoppeld") };
          case (#post, null) { qf.add("onbekende-post") };
        };
        switch expected {
          case (?e) {
            if (overBp(prev.qtyMilli + l.qtyMilli, e, bp)) {
              qf.add(if (from == "opmeting") "meer-dan-gemeten" else if (from == "vh") "meer-dan-vh" else "meer-dan-uren");
            };
          };
          case null {};
        };
        switch hours { case (?h) { if (h.disputed > 0) { qf.add("uren-betwist") }; if (h.open > 0) { qf.add("uren-open") } }; case null {} };
        // Prijs: afwijking boven het percentage én boven het minimumbedrag (op de gefactureerde hoeveelheid).
        switch agreed {
          case (?ag) {
            let dev = l.unitCents - ag;
            let devTotal = absI(QuoteCalc.roundDiv(dev * l.qtyMilli, 1000));
            let devPct = if (ag == 0) dev != 0 else absI(dev) * 10_000 > absI(ag) * bp;
            if (dev != 0 and devPct and devTotal > minC) { mf.add(if (dev > 0) "prijs-hoger" else "prijs-lager") };
            if (not agreedOrg) { mf.add("afspraak-andere-oa") };
          };
          case null { if (l.kind != #other) { mf.add(if (l.kind == #regie) "geen-uurloon" else "geen-afspraak") } };
        };
        if (absI(l.amountCents - QuoteCalc.roundDiv(l.qtyMilli * l.unitCents, 1000)) > 1) { mf.add("rekenfout") };
        // 2c.4 (review M3): een regietarief van de afspraak begint binnen de periode: één tarief rekent niet juist (2c.7: per dag).
        let regieLine = l.kind == #regie or (switch post { case (?p) p.form == #regie; case null false });
        if (regieLine and OaDeals.regieChangeIn(c.deals, inv.workId, inv.orgId, inv.periodFrom, inv.periodTo)) { mf.add("tariefwissel") };
        flagCount += qf.size() + mf.size();
        { index = k; line = l; post; expectedQtyMilli = expected; expectedFrom = from; prevQtyMilli = prev.qtyMilli; prevCents = prev.cents; hours; agreedCents = agreed; agreedOrg; qtyFlags = qf.toArray(); moneyFlags = mf.toArray() };
      },
    );
    let hf = List.empty<Text>();
    var sum : Int = 0;
    for (l in a.lines.values()) { sum += l.amountCents };
    if (a.lines.size() == 0) { hf.add("geen-regels") } else if (sum != a.netCents) { hf.add("som-regels") };
    if (a.netCents + a.vatCents != a.totalCents) { hf.add("totaal") };
    var expVat : ?Int = null;
    switch (inv.vatRegime) {
      case (#reverse) {
        expVat := ?0;
        if (a.vatCents != 0) { hf.add("btw-verlegd-bedrag") };
        if (not inv.reverseMention) { hf.add("btw-verlegd-vermelding") };
      };
      case (#normal bp2) {
        let e = QuoteCalc.roundDiv(a.netCents * bp2, 10_000);
        expVat := ?e;
        if (absI(a.vatCents - e) > 1) { hf.add("btw-bedrag") };
        // Werken in onroerende staat door een geregistreerde aannemer voor BOWACO: normaal geldt de verlegging (medecontractant).
        switch (c.org.orgs.get(inv.orgId)) { case (?o) { if (o.kind == #subcontractor) { hf.add("btw-normaal-bij-oa") } }; case null {} };
      };
    };
    let onWork = oaOnWork(c, inv.workId, inv.orgId);
    if (not onWork) { hf.add("oa-niet-op-werf") };
    if (inv.fileId == null) { hf.add("geen-bijlage") };
    { lines; headerFlags = hf.toArray(); sumLinesCents = sum; expectedVatCents = expVat; oaOnWork = onWork; hoursAll; flagCount = flagCount + hf.size() };
  };

  // ── 2c.7: de controle van een werfdeel (aankoop over één of meer werven) ──
  func without(xs : [Text], ks : [Text]) : [Text] { xs.filter(func x = ks.find(func k = k == x) == null) };
  func plus(xs : [Text], k : Text) : [Text] { if (xs.find(func x = x == k) == null) xs.concat([k]) else xs };

  // Een eenheidsprijs naast de afgesproken: boven het percentage én boven het minimumbedrag op de hoeveelheid (zoals 2.11).
  func priceFlag(unit : Int, ag : Int, qty : Int, bp : Nat, minC : Int) : ?Text {
    let dev = unit - ag;
    let devTotal = absI(QuoteCalc.roundDiv(dev * qty, 1000));
    let devPct = if (ag == 0) dev != 0 else absI(dev) * 10_000 > absI(ag) * bp;
    if (dev != 0 and devPct and devTotal > minC) ?(if (dev > 0) "prijs-hoger" else "prijs-lager") else null;
  };

  func partControl(c : Ctx, inv : Types.OaInvoice, base : Control, pid : Nat) : Control {
    let p = switch (c.pur.purchases.get(pid)) { case (?x) x; case null return base };
    let pa = switch (Purchase.amountsOf(c.pur, pid)) { case (?x) x; case null return base };
    let pls = Purchase.linesOfWork(pa, inv.workId);
    let bp = thresholdBp(c.settings);
    let minC : Int = thresholdCents(c.settings);
    let day = rateDay(inv);
    let w = inv.workId;
    let org = inv.orgId;
    let (advOther, dedOther) = Purchase.advanceSums(c.pur, w, org, ?pid, ?(p.invoiceDay, p.id));
    let allowed = Purchase.allowedAdvance(c.deals, w, org);
    var myAdv : Int = 0;
    var myDed : Int = 0;
    for (l in pls.values()) { if (l.kind == #advance) { myAdv += l.amountCents } else if (l.kind == #advanceDeduct) { myDed += absI(l.amountCents) } };
    var flagCount = 0;
    let lines = base.lines.map(
      func(lc : LineCheck) : LineCheck {
        if (lc.index >= pls.size()) { flagCount += lc.qtyFlags.size() + lc.moneyFlags.size(); return lc };
        let pl = pls[lc.index];
        var qf = lc.qtyFlags;
        var mf = lc.moneyFlags;
        var agreed = lc.agreedCents;
        var agreedOrg = lc.agreedOrg;
        switch (pl.kind) {
          case (#crew) {
            // Ploeguren: de rekenfout op de ploeg (uren × ploegtarief); met een ploegtarief in de afspraak de ploegprijs ernaast.
            mf := without(mf, ["rekenfout"]);
            if (absI(pl.amountCents - QuoteCalc.roundDiv(pl.qtyMilli * pl.unitCents, 1000)) > 1) { mf := plus(mf, "rekenfout") };
            switch (Purchase.dealRateAt(c.deals, w, org, #crewHour, "uur", day)) {
              case (?(r, _)) {
                mf := without(mf, ["prijs-hoger", "prijs-lager", "geen-uurloon", "afspraak-andere-oa"]);
                agreed := ?r;
                agreedOrg := true;
                switch (priceFlag(pl.unitCents, r, pl.qtyMilli, bp, minC)) { case (?f) { mf := plus(mf, f) }; case null {} };
              };
              case null {};
            };
          };
          case (#advance) {
            qf := without(qf, ["niet-gekoppeld"]);
            agreed := allowed;
            agreedOrg := allowed != null;
            switch allowed {
              case null { mf := plus(mf, "voorschot-zonder-afspraak") };
              case (?al) { if (advOther + myAdv > al) { mf := plus(mf, "voorschot-boven-afspraak") } };
            };
          };
          case (#advanceDeduct) {
            qf := without(qf, ["niet-gekoppeld"]);
            if (pl.amountCents > 0) { mf := plus(mf, "aftrek-positief") };
            if (dedOther + myDed > advOther + myAdv) { mf := plus(mf, "aftrek-boven-voorschot") };
          };
          case (#material) { qf := without(qf, ["niet-gekoppeld"]) };
          case (#transportHour or #dieselKm or #kmLevy or #containerTon or #machineHire) {
            qf := without(qf, ["niet-gekoppeld"]);
            switch (Purchase.rateKindOf(pl.kind)) {
              case (?(rk, unit)) {
                switch (Purchase.dealRateAt(c.deals, w, org, rk, unit, day)) {
                  case (?(r, _)) {
                    agreed := ?r;
                    agreedOrg := true;
                    switch (priceFlag(pl.unitCents, r, pl.qtyMilli, bp, minC)) { case (?f) { mf := plus(mf, f) }; case null {} };
                  };
                  case null { mf := plus(mf, "geen-tarief") };
                };
              };
              case null {};
            };
          };
          case _ {};
        };
        // Uren per dag: het bedrag = Σ uren × het tarief van die dag (een tariefwissel in de periode rekent zo juist); de vraag aan
        // de werfleider (te bevestigen, klopt niet) en de som van de dagen naast de uren van de regel.
        if (Purchase.isHours(pl.kind) and pl.claimIds.size() > 0) {
          let cls = pl.claimIds.filterMap(func(id : Nat) : ?Types.HourClaim = c.pur.claims.get(id));
          let (_, tot) = Purchase.dayCalc(c.deals, pl, cls, w, org);
          switch tot {
            case (?e) {
              mf := without(mf, ["tariefwissel", "prijs-hoger", "prijs-lager"]);
              let dev = pl.amountCents - e;
              let pct = if (e == 0) dev != 0 else absI(dev) * 10_000 > absI(e) * bp;
              if (dev != 0 and pct and absI(dev) > minC) { mf := plus(mf, if (dev > 0) "bedrag-per-dag-hoger" else "bedrag-per-dag-lager") };
            };
            case null {};
          };
          var sum : Int = 0;
          for (x in cls.values()) { sum += x.hoursMilli };
          if (absI(sum - lc.line.qtyMilli) > Purchase.hourTolerance * cls.size()) { qf := plus(qf, "uren-som-dagen") };
          // Ploeguren (review L5): de personen van een dag ≠ de ploeg van de regel.
          switch (pl.kind, pl.persons) { case (#crew, ?n) { if (cls.any(func(x : Types.HourClaim) : Bool = x.persons != n)) { qf := plus(qf, "ploeg-personen") } }; case _ {} };
          for (x in cls.values()) {
            switch (Purchase.claimState(c.settings, c.reports, x)) {
              case "te-bevestigen" { qf := plus(qf, "uren-niet-bevestigd") };
              case "klopt-niet" { qf := plus(qf, "uren-klopt-niet") };
              case _ {};
            };
          };
        };
        flagCount += qf.size() + mf.size();
        { lc with qtyFlags = qf; moneyFlags = mf; agreedCents = agreed; agreedOrg };
      }
    );
    var hf = base.headerFlags;
    // De laatste factuur van deze OA op deze werf trekt het restvoorschot af.
    if (OaDeals.extraGet(p.extra, "slot:" # w.toText()) == "ja" and advOther + myAdv - dedOther - myDed > 0) { hf := plus(hf, "restvoorschot") };
    { base with lines; headerFlags = hf; flagCount = flagCount + hf.size() };
  };

  // De inhouding als de raadpleging rood is (VOORLOPIG, vraag aan de boekhouder): 35 % sociaal en 15 % fiscaal op het bedrag
  // excl. btw (art. 30bis en 30ter RSZ-wet, art. 403 en 404 WIB 92).
  public func withholdingCents(result : Types.WithholdingResult, netCents : Int) : (Int, Int) {
    let social = switch result { case (#social or #both) QuoteCalc.roundDiv(netCents * 3500, 10_000); case _ 0 };
    let fiscal = switch result { case (#fiscal or #both) QuoteCalc.roundDiv(netCents * 1500, 10_000); case _ 0 };
    (social, fiscal);
  };

  public func flagText(k : Text) : Text {
    switch k {
      case "niet-gekoppeld" "niet gekoppeld aan een post of regie";
      case "onbekende-post" "post niet in de getekende offerte";
      case "meer-dan-gemeten" "meer dan opgemeten (met wat al gefactureerd is)";
      case "meer-dan-vh" "meer dan de hoeveelheid van de offerte";
      case "meer-dan-uren" "meer uren dan in de werfverslagen";
      case "uren-betwist" "uren betwist door de OA";
      case "uren-open" "uren nog niet bevestigd";
      case "prijs-hoger" "eenheidsprijs hoger dan afgesproken";
      case "prijs-lager" "eenheidsprijs lager dan afgesproken";
      case "afspraak-andere-oa" "de afgesproken prijs is van een andere firma";
      case "geen-afspraak" "geen afgesproken prijs voor deze post";
      case "geen-uurloon" "geen afgesproken uurloon voor regie";
      case "rekenfout" "bedrag ≠ hoeveelheid × eenheidsprijs";
      case "tariefwissel" "het tarief van de werf wisselt binnen de periode: bedrag per dag nakijken";
      case "geen-regels" "geen regels ingevuld";
      case "som-regels" "som van de regels ≠ bedrag excl. btw";
      case "totaal" "excl. btw + btw ≠ totaal";
      case "btw-verlegd-bedrag" "btw verlegd, maar er staat btw op";
      case "btw-verlegd-vermelding" "btw verlegd zonder de vermelding medecontractant";
      case "btw-bedrag" "btw-bedrag klopt niet met het tarief";
      case "btw-normaal-bij-oa" "normaal btw-tarief van een onderaannemer: is de verlegging niet van toepassing?";
      case "oa-niet-op-werf" "deze firma is geen OA op deze werf";
      case "geen-bijlage" "geen bijlage";
      case "geen-tarief" "geen tarief in de afspraak voor deze kostensoort";
      case "voorschot-zonder-afspraak" "voorschot zonder afspraak op deze werf";
      case "voorschot-boven-afspraak" "voorschot hoger dan de afspraak (max. 20 %)";
      case "aftrek-positief" "een aftrek van het voorschot is een negatief bedrag";
      case "aftrek-boven-voorschot" "meer afgetrokken dan het voorschot";
      case "restvoorschot" "laatste factuur: het restvoorschot is niet afgetrokken";
      case "bedrag-per-dag-hoger" "bedrag hoger dan de uren per dag × het tarief van die dag";
      case "bedrag-per-dag-lager" "bedrag lager dan de uren per dag × het tarief van die dag";
      case "uren-som-dagen" "de uren van de regel ≠ de som van de dagen";
      case "uren-niet-bevestigd" "uren nog niet bevestigd door de werfleider";
      case "uren-klopt-niet" "de werfleider zegt: de uren kloppen niet";
      case "ploeg-personen" "de personen van een dag ≠ de ploeg van de regel";
      case "som-werfdelen" "som van de werfdelen ≠ bedrag excl. btw van de factuur";
      case _ k;
    };
  };
};
