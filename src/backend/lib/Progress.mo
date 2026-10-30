// Vorderingsstaten (stap 2.10, bouwplan §9 rij 2.10, §5.1 en §7): de regels zonder toestand-wijzigingen, zodat de API
// (mixins/ProgressApi.mo) en de testen dezelfde regels gebruiken. Geen rechten hier (lib/Rights.mo).
//   • De posten = die van de getekende offerte zoals de opmeting ze kent (Measure.posts: de laatst aanvaarde versie van elke
//     offerte van de werf, met de aanvaarde opties); de sleutel is de lijn van de eerste versie (`root`).
//   • Sectie: regie (contractvorm regie) · aanneming (de post staat in de getekende versie van het contract, 2.8) · minderwerk
//     (een negatieve post erbuiten) · meerwerk (de rest: posten van een latere versie of een andere offerte, aanvaarde opties).
//   • Basis: vaste prijs → % uitgevoerd; regie → regie-uren; de rest (VH, raming, budget, bijlage) → hoeveelheid.
//   • Voorstel per post (als niemand iets invulde): % = max(vorige staat, de taak in de planning); hoeveelheid = de vaste stand
//     van de laatste afgesloten opmeting tot het einde van de periode (2.9), anders de vorige staat; uren = de regie-uren van de
//     werfverslagen tot het einde van de periode (1.6) zonder de betwiste (1.7), anders de vorige staat.
//   • Eenheidsprijs = de verkoopprijs van die lijn in de offerte (QuoteCalc.unitSell met de marge van die versie). NOOIT een
//     aankoopprijs of marge naar buiten: enkel de verkoopprijs, en die enkel voor admin en calculator.
import Array "mo:core/Array";
import Int "mo:core/Int";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Sha256 "mo:sha2/Sha256";
import Types "../types";
import PV "../types/progressviews";
import Access "Access";
import Codes "Codes";
import Config "Config";
import Dossier "Dossier";
import Library "Library";
import Measure "Measure";
import ProgressCalc "ProgressCalc";
import QuoteCalc "QuoteCalc";
import QuoteDocs "QuoteDocs";
import Quotes "Quotes";
import WorkStart "WorkStart";

module {
  public type Ctx = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    org : Types.OrgState;
    works : Types.WorksState;
    dossier : Types.DossierState;
    plan : Types.PlanState;
    reports : Types.ReportState;
    qs : Types.QuotesState;
    qf : Types.QuoteFormState; // 2c.1: klassen en regietarief van de versie (QuoteCalc versie 2)
    starts : Types.WorkStartState;
    ss : Types.SurveyState;
    ps : Types.ProgressState;
  };

  // ── Instellingen (settings.values, D8: geen migratie) ─────────────────────
  // Klantakkoord: "uit" (geen knop), "mogelijk" (standaard: de klant kan akkoord geven of een opmerking maken), "vereist"
  // (klaar voor factuur pas na het akkoord). Inhouding van de waarborg op het bedrag incl. btw ("ja") of excl. btw (standaard).
  public func clientMode(s : Types.SettingsState) : Text {
    switch (s.values.get("progress.client")) { case (?"uit") "uit"; case (?"vereist") "vereist"; case _ "mogelijk" };
  };
  public func retentionOnIncl(s : Types.SettingsState) : Bool { s.values.get("progress.retentionIncl") == ?"ja" };

  // ── Staten ──────────────────────────────────────────────────────────────
  public func statementsOf(ps : Types.ProgressState, workId : Nat) : [Types.ProgressStatement] {
    let ids = switch (ps.byWork.get(workId)) { case (?x) x; case null [] };
    ids.filterMap<Nat, Types.ProgressStatement>(func id = ps.statements.get(id));
  };

  public func draftOf(ps : Types.ProgressState, workId : Nat) : ?Types.ProgressStatement {
    statementsOf(ps, workId).find(func s = s.status == #draft);
  };

  // De vorige staat waarop een nieuwe verder telt: de laatst verzonden vorderingsstaat die niet gecrediteerd werd.
  public func previous(ps : Types.ProgressState, workId : Nat) : ?Types.ProgressStatement {
    var best : ?Types.ProgressStatement = null;
    for (s in statementsOf(ps, workId).values()) {
      if (s.kind == #statement and s.status == #sent and s.creditedBy == null) {
        switch best { case (?b) { if (s.number > b.number) { best := ?s } }; case null { best := ?s } };
      };
    };
    best;
  };

  public func frozenOf(ps : Types.ProgressState, id : Nat) : ?Types.ProgressFrozen {
    switch (ps.frozen.get(id)) { case (?c) Library.plainOf(c); case null null };
  };

  public func confOf(ps : Types.ProgressState, id : Nat) : Types.ProgressConf {
    switch (ps.conf.get(id)) { case (?c) c; case null { { statementId = id; sIndex = #plain(null); iIndex = #plain(null); reason = #plain(""); extra = [] } } };
  };
  public func indexes(ps : Types.ProgressState, id : Nat) : (?Nat, ?Nat) {
    let c = confOf(ps, id);
    ((switch (Library.plainOf(c.sIndex)) { case (?x) x; case null null }), (switch (Library.plainOf(c.iIndex)) { case (?x) x; case null null }));
  };
  public func reasonOf(ps : Types.ProgressState, id : Nat) : Text { Library.plainOf(confOf(ps, id).reason) ?? "" };

  public func modelOf(ps : Types.ProgressState, workId : Nat) : ?Types.RevisionModel {
    switch (ps.revisions.get(workId)) { case (?r) Library.plainOf(r.model); case null null };
  };

  public func inputsOf(ps : Types.ProgressState, id : Nat) : Map.Map<Nat, Types.ProgressInput> {
    let m = Map.empty<Nat, Types.ProgressInput>();
    switch (ps.inputs.get(id)) { case (?xs) { for (x in xs.values()) { m.add(x.root, x) } }; case null {} };
    m;
  };

  public func addIndex(m : Map.Map<Nat, [Nat]>, key : Nat, id : Nat) { Quotes.addIndex(m, key, id) };

  // ── Contract (1.1) ──────────────────────────────────────────────────────
  public func contract(c : Ctx, workId : Nat) : ?Types.ContractParams {
    switch (Dossier.effectiveConfidential(c.works, c.dossier, workId)) { case (?(wc, _)) Library.plainOf(wc.contract); case null null };
  };

  public func formula(k : ?Types.ContractParams) : Text {
    switch k { case (?x) { switch (x.priceRevision) { case (#formula t) t; case (#none) "" } }; case null "" };
  };

  public func retentionBp(k : ?Types.ContractParams) : Nat {
    switch k { case (?x) { if (x.guarantee == #retention) x.guaranteeBp else 0 }; case null 0 };
  };

  public func paymentDays(c : Ctx, k : ?Types.ContractParams) : Nat {
    switch k { case (?x) { if (x.paymentTermDays > 0) x.paymentTermDays else QuoteDocs.paymentDays(c.settings) }; case null QuoteDocs.paymentDays(c.settings) };
  };

  // De versie van de aanneming: de getekende versie uit het contract (2.8) als ze bij deze werf hoort, anders de oudste aanvaarde
  // versie van de oudste offerte van de werf.
  public func baseVersion(c : Ctx, workId : Nat) : ?Types.QuoteVersion {
    switch (contract(c, workId)) {
      case (?k) {
        switch (k.signedQuoteVersionId) {
          case (?vid) {
            switch (c.qs.versions.get(vid)) {
              case (?v) { switch (c.qs.quotes.get(v.quoteId)) { case (?q) { if (q.workId == workId and v.status == #accepted) { return ?v } }; case null {} } };
              case null {};
            };
          };
          case null {};
        };
      };
      case null {};
    };
    let qids = Array.sort<Nat>(Quotes.ids(c.qs.byWork, workId), Nat.compare);
    for (qid in qids.values()) {
      switch (c.qs.quotes.get(qid)) {
        case (?q) {
          if (q.archivedAt == null) {
            let vs = Quotes.versionsOf(c.qs, qid); // nieuwste eerst
            var oldest : ?Types.QuoteVersion = null;
            for (v in vs.values()) { if (v.status == #accepted) { oldest := ?v } };
            switch oldest { case (?v) { return ?v }; case null {} };
          };
        };
        case null {};
      };
    };
    null;
  };

  public func basisOf(f : Types.ContractForm) : Types.ProgressBasis {
    switch f { case (#fixed) #percent; case (#regie) #hours; case _ #quantity };
  };

  // ── Kandidaat-posten ────────────────────────────────────────────────────
  public type Cand = {
    root : Nat;
    lineId : Nat;
    versionId : Nat;
    quoteNumber : Text;
    form : Types.ContractForm;
    chapter : Text;
    code : Text;
    title : Text;
    unit : Text;
    section : Types.ProgressSection;
    basis : Types.ProgressBasis;
    offerQtyMilli : Int;
    unitPrice : ?Int; // null = geen verkoopprijs (marge zonder aankoopprijs)
    inOffer : Bool;
  };

  public func candidates(c : Ctx, workId : Nat, prev : ?Types.ProgressFrozen) : [Cand] {
    let base = baseVersion(c, workId);
    let baseRoots = Map.empty<Nat, Bool>();
    switch base {
      case (?v) { for (l in Quotes.linesOf(c.qs, v.id, Quotes.chaptersOf(c.qs, v.id)).values()) { if (l.kind == #item) { baseRoots.add(WorkStart.root(c.qs, l.id), true) } } };
      case null {};
    };
    let fallback = Library.standardMargin(c.settings);
    let out = List.empty<Cand>();
    let seen = Map.empty<Nat, Bool>();
    for (p in Measure.posts(c.qs, c.starts, workId).values()) {
      // 2c.1: zoals de versie rekent (versie 1: de standaardmarge; versie 2: ook klasse en regietarief). De korting op het
      // totaal van een offerte telt hier (nog) niet: dat komt met de min-meerstaat en de facturen (2c.5, 2c.6).
      let u = Quotes.unitSellOf(c.qs, c.qf, p.version, p.line, fallback);
      let section : Types.ProgressSection = if (p.line.form == #regie) #regie else if (not p.option and baseRoots.containsKey(p.root)) #contract else if (p.line.qtyMilli < 0) #less else #extra;
      seen.add(p.root, true);
      out.add({
        root = p.root;
        lineId = p.line.id;
        versionId = p.version.id;
        quoteNumber = Measure.versionLabel(p);
        form = p.line.form;
        chapter = switch (p.chapter) { case (?ch) (ch.code # " " # ch.title).trim(#char ' '); case null "" };
        code = p.line.code;
        title = p.line.title;
        unit = p.line.unit;
        section;
        basis = basisOf(p.line.form);
        offerQtyMilli = p.line.qtyMilli;
        unitPrice = u;
        inOffer = true;
      });
    };
    // Een post die in een vorige staat stond maar niet meer in de offerte: blijft zichtbaar (offerte 0), zodat wat al
    // aangerekend is niet stil verdwijnt.
    switch prev {
      case (?f) {
        for (l in f.lines.values()) {
          if (not seen.containsKey(l.root)) {
            out.add({ root = l.root; lineId = l.lineId; versionId = l.versionId; quoteNumber = l.quoteNumber; form = (switch (l.basis) { case (#percent) #fixed; case (#hours) #regie; case (#quantity) #vh }); chapter = l.chapter; code = l.code; title = l.title; unit = l.unit; section = if (l.section == #regie) #regie else #less; basis = l.basis; offerQtyMilli = 0; unitPrice = ?l.unitPriceCents; inOffer = false });
          };
        };
      };
      case null {};
    };
    out.toArray();
  };

  // ── Voorstellen ─────────────────────────────────────────────────────────
  public type Hours = { valid : Int; open : Int; disputed : Int };

  public func dayOf(t : Int) : Nat { if (t <= 0) 0 else Int.abs(t) / Int.abs(Config.day) };

  // De vaste stand van de laatste afgesloten opmeting met afsluitdatum ≤ upto (2.9): per post wat tot dan gemeten was.
  public func measuredUpTo(ss : Types.SurveyState, workId : Nat, upto : Nat) : (Map.Map<Nat, Int>, ?Nat) {
    var best : ?Types.Survey = null;
    for (s in Measure.surveysOf(ss, workId).values()) {
      switch (s.status) {
        case (#closed x) {
          if (dayOf(x.at) <= upto) {
            switch best { case (?b) { if (s.number > b.number) { best := ?s } }; case null { best := ?s } };
          };
        };
        case (#open) {};
      };
    };
    let m = Map.empty<Nat, Int>();
    switch best {
      case (?s) {
        // Een post zonder meting staat ook in de vaste stand (0, niet volledig): dat is geen opmeting van 0 (zie 2.9 B3).
        switch (ss.snapshots.get(s.id)) { case (?xs) { for (x in xs.values()) { if (x.measuredMilli != 0 or x.complete) { m.add(x.root, x.measuredMilli) } } }; case null {} };
        (m, ?s.number);
      };
      case null (m, null);
    };
  };

  public func openSurvey(ss : Types.SurveyState, workId : Nat) : ?Nat {
    switch (Measure.openSurvey(ss, workId)) { case (?s) ?s.number; case null null };
  };

  // De regiepost van een taak: de eerste lijn met contractvorm regie waaraan de taak hangt (2.8).
  func regieRootOfTask(qs : Types.QuotesState, t : Types.Task) : ?Nat {
    for (lid in t.quoteLineIds.values()) {
      switch (qs.lines.get(lid)) { case (?l) { if (l.form == #regie) { return ?WorkStart.root(qs, l.id) } }; case null {} };
    };
    null;
  };

  // Hoe staat een aanwezigheidsregel: BOWACO zelf telt als bevestigd; een OA: de laatste bevestiging (1.7) of open.
  public func hoursState(reports : Types.ReportState, a : Types.Attendance) : { #ok; #open; #disputed } {
    if (a.orgId == null) { return #ok };
    switch (reports.confirmations.get(a.id)) {
      case (?cs) { if (cs.size() == 0) #open else if (cs[cs.size() - 1].ok) #ok else #disputed };
      case null #open;
    };
  };

  public func milliHours(minutes : Nat) : Int { QuoteCalc.roundDiv(minutes * 1000, 60) };

  public func validAttendance(a : Types.Attendance) : Bool { a.regie and a.archivedAt == null and a.replacedBy == null };

  // Regie-uren per regiepost tot en met upto (cumulatief), en wat aan geen regiepost hangt.
  public func regieHours(c : Ctx, workId : Nat, upto : Nat) : (Map.Map<Nat, Hours>, Int) {
    let taskRoot = Map.empty<Nat, Nat>();
    for (t in c.plan.tasks.values()) {
      if (t.workId == workId and t.archivedAt == null) { switch (regieRootOfTask(c.qs, t)) { case (?r) taskRoot.add(t.id, r); case null {} } };
    };
    let m = Map.empty<Nat, Hours>();
    var unassigned : Int = 0;
    for (a in c.reports.attendances.values()) {
      if (a.workId == workId and validAttendance(a) and a.day <= upto) {
        let h = milliHours(a.minutesTotal);
        let st = hoursState(c.reports, a);
        let root = switch (a.taskId) { case (?tid) taskRoot.get(tid); case null null };
        switch root {
          case (?r) {
            let x = switch (m.get(r)) { case (?x) x; case null { { valid = 0; open = 0; disputed = 0 } } };
            m.add(r, switch st { case (#ok) { { x with valid = x.valid + h } }; case (#open) { { x with valid = x.valid + h; open = x.open + h } }; case (#disputed) { { x with disputed = x.disputed + h } } });
          };
          case null { if (st != #disputed) { unassigned += h } };
        };
      };
    };
    (m, unassigned);
  };

  // Het % van de taken in de planning waaraan een post hangt (de hoogste), in basispunten.
  public func planPct(c : Ctx, workId : Nat) : Map.Map<Nat, Nat> {
    let m = Map.empty<Nat, Nat>();
    for (t in c.plan.tasks.values()) {
      if (t.workId == workId and t.archivedAt == null) {
        for (lid in t.quoteLineIds.values()) {
          let r = WorkStart.root(c.qs, lid);
          let p = Nat.min(t.percent, 100) * 100;
          switch (m.get(r)) { case (?x) { if (p > x) { m.add(r, p) } }; case null { m.add(r, p) } };
        };
      };
    };
    m;
  };

  // ── Rekenen ─────────────────────────────────────────────────────────────
  public type Row = {
    cand : Cand;
    prev : ?Types.ProgressLineFrozen;
    input : ?Types.ProgressInput;
    hints : PV.ProgressHints;
    cumPctBp : Nat;
    cumQtyMilli : Int;
    calc : ProgressCalc.Line;
    out : ProgressCalc.LineOut;
    flags : [Text];
  };

  public type Built = {
    rows : [Row];
    prevStatement : ?Types.ProgressStatement;
    prevFrozen : ?Types.ProgressFrozen;
    openSurvey : ?Nat;
    unassignedRegieMilli : Int;
    base : ?Types.QuoteVersion;
    contract : ?Types.ContractParams;
    vatBp : Nat;
    vatNote : Text;
    retentionBp : Nat;
    retentionOnIncl : Bool;
    formula : Text;
    model : ?Types.RevisionModel;
    sIndex : ?Nat;
    iIndex : ?Nat;
    revision : ?ProgressCalc.Revision;
    totals : ProgressCalc.Totals;
  };

  public func revisionOf(model : ?Types.RevisionModel, s : ?Nat, i : ?Nat) : ?ProgressCalc.Revision {
    switch (model, s, i) {
      case (?m, ?sx, ?ix) ?{ aBp = m.aBp; bBp = m.bBp; cBp = m.cBp; sBase = m.sBase; iBase = m.iBase; sIndex = sx; iIndex = ix };
      case _ null;
    };
  };

  // Een ontwerp (vorderingsstaat) rekenen met de invoer en de voorstellen van vandaag.
  public func build(c : Ctx, st : Types.ProgressStatement) : Built {
    let w = c.works.works.get(st.workId);
    let prevSt = switch (previous(c.ps, st.workId)) { case (?p) { if (p.id == st.id) null else ?p }; case null null };
    let prevF = switch prevSt { case (?p) frozenOf(c.ps, p.id); case null null };
    let prevLines = Map.empty<Nat, Types.ProgressLineFrozen>();
    switch prevF { case (?f) { for (l in f.lines.values()) { prevLines.add(l.root, l) } }; case null {} };
    let cands = candidates(c, st.workId, prevF);
    let inputs = inputsOf(c.ps, st.id);
    let (measured, mSurvey) = measuredUpTo(c.ss, st.workId, st.periodTo);
    let (hours, unassigned) = regieHours(c, st.workId, st.periodTo);
    let plan = planPct(c, st.workId);
    let rows = cands.map<Cand, Row>(
      func k {
        let pv = prevLines.get(k.root);
        let prevPct : Nat = switch pv { case (?x) x.cumPctBp; case null 0 };
        let prevQty : Int = switch pv { case (?x) x.cumQtyMilli; case null 0 };
        let prevCents : Int = switch pv { case (?x) x.cumCents; case null 0 };
        let inp = inputs.get(k.root);
        let h = hours.get(k.root);
        let hints : PV.ProgressHints = {
          measuredMilli = if (k.basis == #quantity) measured.get(k.root) else null;
          measuredSurvey = if (k.basis == #quantity and measured.containsKey(k.root)) mSurvey else null;
          hoursMilli = if (k.basis == #hours) { switch h { case (?x) ?x.valid; case null null } } else null;
          hoursOpenMilli = if (k.basis == #hours) { switch h { case (?x) x.open; case null 0 } } else 0;
          hoursDisputedMilli = if (k.basis == #hours) { switch h { case (?x) x.disputed; case null 0 } } else 0;
          planPctBp = if (k.basis == #percent) plan.get(k.root) else null;
        };
        let inPct = switch inp { case (?i) i.cumPctBp; case null null };
        let inQty = switch inp { case (?i) i.cumQtyMilli; case null null };
        let cumPct : Nat = switch inPct { case (?x) x; case null { switch (hints.planPctBp) { case (?p) Nat.max(p, prevPct); case null prevPct } } };
        let cumQty : Int = switch inQty {
          case (?x) x;
          case null {
            switch (k.basis) {
              case (#quantity) { switch (hints.measuredMilli) { case (?m) m; case null prevQty } };
              case (#hours) { switch (hints.hoursMilli) { case (?m) m; case null prevQty } };
              case (#percent) 0;
            };
          };
        };
        let calc : ProgressCalc.Line = { section = k.section; basis = k.basis; offerQtyMilli = k.offerQtyMilli; unitPrice = switch (k.unitPrice) { case (?u) u; case null 0 }; prevCents; cumPctBp = cumPct; cumQtyMilli = cumQty };
        let out = ProgressCalc.line(calc);
        let flags = List.empty<Text>();
        let hasNote = switch inp { case (?i) i.note.size() > 0; case null false };
        switch (k.basis, inQty, hints.measuredMilli) { case (#quantity, ?x, ?m) { if (x != m) { flags.add(if hasNote "afwijking-opmeting-uitgelegd" else "afwijking-opmeting") } }; case _ {} };
        switch (k.basis, inQty, hints.hoursMilli) { case (#hours, ?x, ?m) { if (x != m) { flags.add(if hasNote "afwijking-uren-uitgelegd" else "afwijking-uren") } }; case _ {} };
        if (k.basis != #percent and k.offerQtyMilli >= 0 and out.cumQtyMilli > k.offerQtyMilli) { flags.add("boven-vh") };
        if ((k.basis == #percent and cumPct < prevPct) or (k.basis != #percent and cumQty < prevQty)) { flags.add("lager-dan-vorige") };
        if (hints.hoursDisputedMilli > 0) { flags.add("uren-betwist") };
        if (hints.hoursOpenMilli > 0) { flags.add("uren-open") };
        if (k.unitPrice == null and (k.offerQtyMilli != 0 or cumQty != 0 or cumPct != 0)) { flags.add("geen-prijs") };
        if (not k.inOffer) { flags.add("niet-in-offerte") };
        { cand = k; prev = pv; input = inp; hints; cumPctBp = cumPct; cumQtyMilli = out.cumQtyMilli; calc; out; flags = flags.toArray() };
      }
    );
    let k = contract(c, st.workId);
    let info = c.dossier.info.get(st.workId);
    let vatBp = switch w { case (?x) x.vatBp; case null 2100 };
    let model = modelOf(c.ps, st.workId);
    let (sx, ix) = indexes(c.ps, st.id);
    let f = formula(k);
    let rev = if (f == "") null else revisionOf(model, sx, ix);
    let ret = retentionBp(k);
    let incl = retentionOnIncl(c.settings);
    {
      rows;
      prevStatement = prevSt;
      prevFrozen = prevF;
      openSurvey = openSurvey(c.ss, st.workId);
      unassignedRegieMilli = unassigned;
      base = baseVersion(c, st.workId);
      contract = k;
      vatBp;
      vatNote = switch info { case (?i) i.vatNote; case null "" };
      retentionBp = ret;
      retentionOnIncl = incl;
      formula = f;
      model;
      sIndex = sx;
      iIndex = ix;
      revision = rev;
      totals = ProgressCalc.totals(rows.map(func(r : Row) : ProgressCalc.Line = r.calc), vatBp, ret, incl, rev);
    };
  };

  public func totalsOf(t : ProgressCalc.Totals) : Types.ProgressTotals {
    {
      sections = t.sections.map(func(s : ProgressCalc.SectionOut) : Types.ProgressSectionTotals = { section = s.section; offerCents = s.offerCents; prevCents = s.prevCents; cumCents = s.cumCents; periodCents = s.periodCents });
      offerCents = t.offerCents;
      prevCents = t.prevCents;
      cumCents = t.cumCents;
      periodCents = t.periodCents;
      restCents = t.restCents;
      overVhCents = t.overVhCents;
      revisionBaseCents = t.revisionBaseCents;
      revisionCents = t.revisionCents;
      subtotalCents = t.subtotalCents;
      vatBp = t.vatBp;
      vatCents = t.vatCents;
      totalCents = t.totalCents;
      retentionBp = t.retentionBp;
      retentionCents = t.retentionCents;
      payableCents = t.payableCents;
    };
  };

  // ── Controle vóór verzending ─────────────────────────────────────────────
  public func findings(b : Built, st : Types.ProgressStatement, today : Nat) : [PV.ProgressFinding] {
    let out = List.empty<PV.ProgressFinding>();
    func add(key : Text, text : Text, block : Bool, count : Nat) { out.add({ key; text; block; count }) };
    func count(flag : Text) : Nat { b.rows.filter(func r = r.flags.find(func f = f == flag) != null).size() };
    if (b.rows.size() == 0) { add("geen-posten", "Geen posten: de werf heeft geen getekende offerte", true, 0) };
    if (st.periodTo < st.periodFrom) { add("periode", "Het einde van de periode ligt vóór het begin", true, 0) };
    if (st.periodTo > today) { add("toekomst", "Het einde van de periode ligt in de toekomst", true, 0) };
    if (b.contract == null) { add("geen-contract", "Geen contractparameters (1.1): betaaltermijn standaard, geen waarborg en geen prijsherziening", false, 0) };
    if (b.vatBp == 600 and b.vatNote.trim(#char ' ').size() == 0) { add("btw6-grond", "Btw 6 % zonder grond in de werffiche", false, 0) };
    if (b.formula != "" and b.revision == null) { add("prijsherziening", "Het contract voorziet een prijsherziening, maar het rekenmodel of de indexwaarden ontbreken: zonder die waarden geen herziening", false, 0) };
    let np = count("geen-prijs");
    if (np > 0) { add("geen-prijs", "Posten zonder verkoopprijs (tellen voor € 0)", false, np) };
    let dm = count("afwijking-opmeting");
    if (dm > 0) { add("afwijking-opmeting", "Hoeveelheid wijkt af van de afgesloten opmeting, zonder notitie", false, dm) };
    let du = count("afwijking-uren");
    if (du > 0) { add("afwijking-uren", "Regie-uren wijken af van de werfverslagen, zonder notitie", false, du) };
    let ov = count("boven-vh");
    if (ov > 0) { add("boven-vh", "Boven de vermoedelijke hoeveelheid (meerhoeveelheid)", false, ov) };
    let lo = count("lager-dan-vorige");
    if (lo > 0) { add("lager-dan-vorige", "Lager dan in de vorige staat (de periode wordt negatief voor die post)", false, lo) };
    let hd = count("uren-betwist");
    if (hd > 0) { add("uren-betwist", "Regie-uren betwist door de OA (niet meegeteld in het voorstel)", false, hd) };
    let ho = count("uren-open");
    if (ho > 0) { add("uren-open", "Regie-uren nog niet bevestigd door de OA", false, ho) };
    if (b.totals.periodCents < 0) { add("negatief", "Het bedrag van deze periode is negatief: verbeteren kan ook met een creditnota", false, 0) };
    switch (b.openSurvey) { case (?n) { add("open-opmeting", "Opmeting " # n.toText() # " is nog open (niet in deze staat)", false, 0) }; case null {} };
    if (b.unassignedRegieMilli > 0) { add("regie-zonder-post", "Regie-uren op de werf die aan geen regiepost hangen (niet in deze staat)", false, 0) };
    if (st.prepared == null) { add("niet-voorbereid", "De werfleider meldde de hoeveelheden nog niet als voorbereid", false, 0) };
    out.toArray();
  };

  public func blocks(fs : [PV.ProgressFinding]) : [PV.ProgressFinding] { fs.filter(func f = f.block) };
  public func warnings(fs : [PV.ProgressFinding]) : [PV.ProgressFinding] { fs.filter(func f = not f.block) };
  public func describe(fs : [PV.ProgressFinding]) : Text {
    Text.join(fs.map(func f = if (f.count > 0) f.text # " (" # f.count.toText() # ")" else f.text).values(), "; ");
  };

  // ── Vastleggen bij het versturen ────────────────────────────────────────
  public func frozenLines(b : Built) : [Types.ProgressLineFrozen] {
    b.rows.map(
      func(r : Row) : Types.ProgressLineFrozen = {
        root = r.cand.root;
        lineId = r.cand.lineId;
        versionId = r.cand.versionId;
        quoteNumber = r.cand.quoteNumber;
        section = r.cand.section;
        basis = r.cand.basis;
        chapter = r.cand.chapter;
        code = r.cand.code;
        title = r.cand.title;
        unit = r.cand.unit;
        offerQtyMilli = r.cand.offerQtyMilli;
        unitPriceCents = r.calc.unitPrice;
        offerCents = r.out.offerCents;
        prevPctBp = switch (r.prev) { case (?x) x.cumPctBp; case null 0 };
        prevQtyMilli = switch (r.prev) { case (?x) x.cumQtyMilli; case null 0 };
        prevCents = r.calc.prevCents;
        cumPctBp = r.cumPctBp;
        cumQtyMilli = r.out.cumQtyMilli;
        cumCents = r.out.cumCents;
        periodCents = r.out.periodCents;
        note = switch (r.input) { case (?i) i.note; case null "" };
      }
    );
  };

  public func quoteRefs(rows : [Row]) : [Text] {
    let out = List.empty<Text>();
    for (r in rows.values()) { if (r.cand.inOffer and not out.contains(Text.equal, r.cand.quoteNumber)) { out.add(r.cand.quoteNumber) } };
    out.toArray();
  };

  public func freeze(c : Ctx, st : Types.ProgressStatement, b : Built, sendDay : Nat) : Types.ProgressFrozen {
    let w = c.works.works.get(st.workId);
    let client = switch w { case (?x) { switch (x.clientOrgId) { case (?o) c.org.orgs.get(o); case null null } }; case null null };
    let info = c.dossier.info.get(st.workId);
    let days = paymentDays(c, b.contract);
    {
      statementId = st.id;
      issuer = QuoteDocs.issuer(c.settings);
      clientName = switch client { case (?o) o.name; case null "" };
      clientAddress = switch client { case (?o) o.address; case null null };
      clientVat = switch client { case (?o) o.vat; case null null };
      workCode = switch w { case (?x) x.code; case null "" };
      workName = switch w { case (?x) x.name; case null "" };
      workAddress = switch w { case (?x) x.address; case null { { street = ""; number = ""; zip = ""; city = ""; country = "" } } };
      analyticCode = switch info { case (?i) { switch (i.analyticCode) { case (?a) a; case null { switch w { case (?x) x.code; case null "" } } } }; case null { switch w { case (?x) x.code; case null "" } } };
      vatNote = b.vatNote;
      quoteRefs = quoteRefs(b.rows);
      sendDay;
      dueDay = sendDay + days;
      paymentDays = days;
      guarantee = switch (b.contract) { case (?k) k.guarantee; case null #none };
      retentionOnIncl = b.retentionOnIncl;
      revision = switch (b.revision, b.model) {
        case (?r, ?m) ?{ formula = b.formula; aBp = r.aBp; bBp = r.bBp; cBp = r.cBp; sBase = r.sBase; iBase = r.iBase; sIndex = r.sIndex; iIndex = r.iIndex; sLabel = m.sLabel; iLabel = m.iLabel };
        case _ null;
      };
      lines = frozenLines(b);
      totals = totalsOf(b.totals);
      extra = [];
    };
  };

  func negTotals(t : Types.ProgressTotals) : Types.ProgressTotals {
    {
      sections = t.sections.map(func(s : Types.ProgressSectionTotals) : Types.ProgressSectionTotals = { section = s.section; offerCents = 0; prevCents = s.cumCents; cumCents = s.prevCents; periodCents = -s.periodCents });
      offerCents = 0;
      prevCents = t.cumCents;
      cumCents = t.prevCents;
      periodCents = -t.periodCents;
      restCents = 0;
      overVhCents = 0;
      revisionBaseCents = -t.revisionBaseCents;
      revisionCents = -t.revisionCents;
      subtotalCents = -t.subtotalCents;
      vatBp = t.vatBp;
      vatCents = -t.vatCents;
      totalCents = -t.totalCents;
      retentionBp = t.retentionBp;
      retentionCents = -t.retentionCents;
      payableCents = -t.payableCents;
    };
  };

  // Een creditnota draait een verzonden staat volledig terug: per post terug naar de stand van de staat ervoor.
  public func creditFrozen(orig : Types.ProgressFrozen, id : Nat, sendDay : Nat) : Types.ProgressFrozen {
    {
      orig with
      statementId = id;
      sendDay;
      dueDay = sendDay + orig.paymentDays;
      lines = orig.lines.map(func(l : Types.ProgressLineFrozen) : Types.ProgressLineFrozen = { l with offerCents = 0; offerQtyMilli = 0; prevPctBp = l.cumPctBp; prevQtyMilli = l.cumQtyMilli; prevCents = l.cumCents; cumPctBp = l.prevPctBp; cumQtyMilli = l.prevQtyMilli; cumCents = l.prevCents; periodCents = -l.periodCents });
      totals = negTotals(orig.totals);
    };
  };

  // ── Hash (bouwplan §4: "verstuurde vorderingsstaten zijn niet meer wijzigbaar") ──
  func f(t : Text) : Text { t.size().toText() # ":" # t # ";" };
  func fi(i : Int) : Text { f(Int.toText(i)) };
  func fo(i : ?Nat) : Text { switch i { case (?x) fi(x); case null f("-") } };
  func fa(a : ?Types.Address) : Text { switch a { case (?x) f(x.street) # f(x.number) # f(x.zip) # f(x.city) # f(x.country); case null f("-") } };
  public func sectionKey(s : Types.ProgressSection) : Text { switch s { case (#contract) "aanneming"; case (#extra) "meerwerk"; case (#less) "minderwerk"; case (#regie) "regie" } };
  public func basisKey(b : Types.ProgressBasis) : Text { switch b { case (#percent) "procent"; case (#quantity) "hoeveelheid"; case (#hours) "uren" } };
  func guaranteeKey(g : Types.GuaranteeKind) : Text { switch g { case (#none) "geen"; case (#retention) "inhouding"; case (#bankGuarantee) "bankwaarborg" } };

  public func canonical(st : Types.ProgressStatement, fr : Types.ProgressFrozen) : Text {
    var out = "bowaco-vordering-v1;" # fi(st.id) # fi(st.workId) # f(switch (st.kind) { case (#statement) "staat"; case (#credit) "credit" }) # f(st.code) # fo(st.credits) # fi(st.periodFrom) # fi(st.periodTo) # f(st.note) # fi(st.calcVersion);
    out #= "I;" # f(fr.issuer) # f(fr.clientName) # fa(fr.clientAddress) # (switch (fr.clientVat) { case (?v) f(v); case null f("-") }) # f(fr.workCode) # f(fr.workName) # fa(?fr.workAddress) # f(fr.analyticCode) # f(fr.vatNote) # f(Text.join(fr.quoteRefs.values(), ",")) # fi(fr.sendDay) # fi(fr.dueDay) # fi(fr.paymentDays) # f(guaranteeKey(fr.guarantee)) # f(if (fr.retentionOnIncl) "incl" else "excl");
    switch (fr.revision) {
      case (?r) { out #= "R;" # f(r.formula) # fi(r.aBp) # fi(r.bBp) # fi(r.cBp) # fi(r.sBase) # fi(r.iBase) # fi(r.sIndex) # fi(r.iIndex) # f(r.sLabel) # f(r.iLabel) };
      case null { out #= "R;-;" };
    };
    for (l in fr.lines.values()) {
      out #= "L;" # fi(l.root) # fi(l.lineId) # f(sectionKey(l.section)) # f(basisKey(l.basis)) # f(l.quoteNumber) # f(l.chapter) # f(l.code) # f(l.title) # f(l.unit) # fi(l.offerQtyMilli) # fi(l.unitPriceCents) # fi(l.offerCents) # fi(l.prevPctBp) # fi(l.prevQtyMilli) # fi(l.prevCents) # fi(l.cumPctBp) # fi(l.cumQtyMilli) # fi(l.cumCents) # fi(l.periodCents) # f(l.note);
    };
    let t = fr.totals;
    for (s in t.sections.values()) { out #= "S;" # f(sectionKey(s.section)) # fi(s.offerCents) # fi(s.prevCents) # fi(s.cumCents) # fi(s.periodCents) };
    out # "T;" # fi(t.offerCents) # fi(t.prevCents) # fi(t.cumCents) # fi(t.periodCents) # fi(t.restCents) # fi(t.overVhCents) # fi(t.revisionBaseCents) # fi(t.revisionCents) # fi(t.subtotalCents) # fi(t.vatBp) # fi(t.vatCents) # fi(t.totalCents) # fi(t.retentionBp) # fi(t.retentionCents) # fi(t.payableCents);
  };

  public func hash(text : Text) : Text { Codes.hex(Sha256.fromBlob(#sha256, text.encodeUtf8())) };

  public func intact(ps : Types.ProgressState, st : Types.ProgressStatement) : Bool {
    if (st.status != #sent) { return true };
    switch (frozenOf(ps, st.id)) { case (?fr) hash(canonical(st, fr)) == st.hash; case null false };
  };

  // ── Views ───────────────────────────────────────────────────────────────
  public func billingKey(b : Types.ProgressBilling) : Text { switch b { case (#open) "open"; case (#ready _) "klaar"; case (#invoiced _) "gefactureerd" } };

  public func brief(c : Ctx, st : Types.ProgressStatement) : PV.ProgressBrief {
    let w = c.works.works.get(st.workId);
    let codeOf = func(id : ?Nat) : Text { switch id { case (?i) { switch (c.ps.statements.get(i)) { case (?s) s.code; case null "" } }; case null "" } };
    {
      id = st.id;
      workId = st.workId;
      workCode = switch w { case (?x) x.code; case null "" };
      workName = switch w { case (?x) x.name; case null "" };
      kind = st.kind;
      code = st.code;
      number = st.number;
      periodFrom = st.periodFrom;
      periodTo = st.periodTo;
      status = st.status;
      billing = billingKey(st.billing);
      prepared = st.prepared != null;
      preparedByName = switch (st.prepared) { case (?x) Access.personName(c.access, x.by); case null "" };
      sentAt = st.sentAt;
      credits = st.credits;
      creditsCode = codeOf(st.credits);
      creditedBy = st.creditedBy;
      creditedByCode = codeOf(st.creditedBy);
      answer = switch (c.ps.answers.get(st.id)) { case (?a) ?{ ok = a.ok; at = a.at }; case null null };
      updatedAt = st.updatedAt;
      updatedByName = Access.personName(c.access, st.updatedBy);
      rev = st.rev;
    };
  };

  public func qtyLine(r : Row) : PV.ProgressQtyLine {
    {
      root = r.cand.root;
      lineId = r.cand.lineId;
      versionId = r.cand.versionId;
      quoteNumber = r.cand.quoteNumber;
      section = r.cand.section;
      basis = r.cand.basis;
      form = r.cand.form;
      chapter = r.cand.chapter;
      code = r.cand.code;
      title = r.cand.title;
      unit = r.cand.unit;
      inOffer = r.cand.inOffer;
      offerQtyMilli = r.cand.offerQtyMilli;
      prevPctBp = switch (r.prev) { case (?x) x.cumPctBp; case null 0 };
      prevQtyMilli = switch (r.prev) { case (?x) x.cumQtyMilli; case null 0 };
      cumPctBp = r.cumPctBp;
      cumQtyMilli = r.cumQtyMilli;
      hasInput = r.input != null;
      note = switch (r.input) { case (?i) i.note; case null "" };
      hints = r.hints;
      flags = r.flags;
    };
  };

  public func money(r : Row) : PV.ProgressMoney {
    { unitPriceCents = r.calc.unitPrice; noPrice = r.cand.unitPrice == null; offerCents = r.out.offerCents; prevCents = r.calc.prevCents; cumCents = r.out.cumCents; periodCents = r.out.periodCents; restCents = r.out.restCents; overVhCents = r.out.overVhCents };
  };

  // Een vastgelegde lijn als view (verzonden staat): geen voorstellen meer, de bedragen van toen.
  public func frozenRow(l : Types.ProgressLineFrozen) : PV.ProgressLineView {
    let none : PV.ProgressHints = { measuredMilli = null; measuredSurvey = null; hoursMilli = null; hoursOpenMilli = 0; hoursDisputedMilli = 0; planPctBp = null };
    let over = if (l.basis != #percent and l.offerQtyMilli >= 0 and l.cumQtyMilli > l.offerQtyMilli) l.cumCents - l.offerCents else 0;
    {
      q = { root = l.root; lineId = l.lineId; versionId = l.versionId; quoteNumber = l.quoteNumber; section = l.section; basis = l.basis; form = (switch (l.basis) { case (#percent) #fixed; case (#hours) #regie; case (#quantity) #vh }); chapter = l.chapter; code = l.code; title = l.title; unit = l.unit; inOffer = true; offerQtyMilli = l.offerQtyMilli; prevPctBp = l.prevPctBp; prevQtyMilli = l.prevQtyMilli; cumPctBp = l.cumPctBp; cumQtyMilli = l.cumQtyMilli; hasInput = true; note = l.note; hints = none; flags = [] };
      m = { unitPriceCents = l.unitPriceCents; noPrice = false; offerCents = l.offerCents; prevCents = l.prevCents; cumCents = l.cumCents; periodCents = l.periodCents; restCents = l.offerCents - l.cumCents; overVhCents = over };
    };
  };

  public func frozenQty(l : Types.ProgressLineFrozen) : PV.ProgressQtyLine { frozenRow(l).q };

  public func docInfo(fr : Types.ProgressFrozen) : PV.ProgressDocInfo {
    {
      issuer = fr.issuer;
      clientName = fr.clientName;
      clientAddress = fr.clientAddress;
      clientVat = fr.clientVat;
      workCode = fr.workCode;
      workName = fr.workName;
      workAddress = fr.workAddress;
      analyticCode = fr.analyticCode;
      vatNote = fr.vatNote;
      quoteRefs = fr.quoteRefs;
      sendDay = fr.sendDay;
      dueDay = fr.dueDay;
      paymentDays = fr.paymentDays;
      guarantee = fr.guarantee;
      retentionOnIncl = fr.retentionOnIncl;
      revision = fr.revision;
    };
  };

  public func answerView(access : Types.AccessState, a : Types.ProgressAnswer) : PV.ProgressAnswerView {
    { ok = a.ok; note = a.note; at = a.at; byName = Access.personName(access, a.personId) };
  };

  // UNECE Rec 20 (eenheden voor UBL/Peppol). VOORLOPIG: de eenheden van de bibliotheek zijn nog niet definitief (0.3).
  public func unitCode(u : Text) : Text {
    switch (Text.toLower(u.trim(#char ' '))) {
      case ("m2" or "m²") "MTK";
      case ("m3" or "m³") "MTQ";
      case ("m" or "lm" or "mtr") "MTR";
      case ("st" or "stuk" or "stuks" or "pce") "H87";
      case ("u" or "uur" or "h") "HUR";
      case ("kg") "KGM";
      case ("t" or "ton") "TNE";
      case ("l" or "liter") "LTR";
      case ("dag" or "d") "DAY";
      case ("ff" or "forfait" or "pst" or "post" or "sog") "LS";
      case _ "C62";
    };
  };

  public func invoiceData(st : Types.ProgressStatement, fr : Types.ProgressFrozen, creditsCode : Text) : PV.ProgressInvoiceData {
    let lines = List.empty<PV.ProgressInvoiceLine>();
    for (l in fr.lines.values()) {
      if (l.periodCents != 0) {
        let qty = switch (l.basis) { case (#percent) l.cumQtyMilli - l.prevQtyMilli; case _ l.cumQtyMilli - l.prevQtyMilli };
        lines.add({ id = l.root.toText(); description = (if (l.code == "") "" else l.code # " ") # l.title # (switch (l.basis) { case (#percent) " (" # Int.toText(l.cumPctBp / 100) # " % uitgevoerd)"; case _ "" }); quantityMilli = qty; unitCode = unitCode(l.unit); priceCents = l.unitPriceCents; amountCents = l.periodCents; section = sectionKey(l.section) });
      };
    };
    let t = fr.totals;
    {
      documentType = if (st.kind == #credit) "381" else "380";
      number = st.code;
      issueDay = fr.sendDay;
      dueDay = fr.dueDay;
      currency = "EUR";
      seller = fr.issuer;
      buyerName = fr.clientName;
      buyerAddress = fr.clientAddress;
      buyerVat = fr.clientVat;
      projectRef = fr.analyticCode;
      contractRef = Text.join(fr.quoteRefs.values(), ", ");
      billingRef = creditsCode;
      periodFrom = st.periodFrom;
      periodTo = st.periodTo;
      taxCategory = "S";
      vatBp = t.vatBp;
      taxNote = fr.vatNote;
      lines = lines.toArray();
      lineTotalCents = t.periodCents;
      chargeCents = t.revisionCents;
      taxableCents = t.subtotalCents;
      vatCents = t.vatCents;
      totalCents = t.totalCents;
      retentionCents = t.retentionCents;
      payableCents = t.payableCents;
      paymentDays = fr.paymentDays;
      hash = st.hash;
      billing = billingKey(st.billing);
    };
  };

  // "€ 1234,56" (enkel voor foutmeldingen aan admin en calculator; nooit in de auditlog).
  public func euro(c : Int) : Text {
    let a = Int.abs(c);
    let cents = a % 100;
    (if (c < 0) "-€ " else "€ ") # (a / 100).toText() # "," # (if (cents < 10) "0" else "") # cents.toText();
  };

  public func modelError(m : Types.RevisionModel) : ?Text {
    if (m.aBp + m.bBp + m.cBp != 10_000) { return ?"a + b + c moet samen 100 % zijn" };
    if (m.sBase == 0 or m.iBase == 0) { return ?"De basisindexen moeten groter dan 0 zijn" };
    if (m.sBase > Config.maxRevisionIndex or m.iBase > Config.maxRevisionIndex) { return ?"Basisindex te groot" };
    if (m.sLabel.size() > Config.maxName or m.iLabel.size() > Config.maxName or m.note.size() > Config.maxNote) { return ?"Te lange tekst" };
    null;
  };
};
