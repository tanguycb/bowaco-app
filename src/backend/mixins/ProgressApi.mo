// Vorderingsstaten (stap 2.10, bouwplan §9 rij 2.10, §5.1 en §7; VOORLOPIG: vragen voor Alexis en de boekhouder): per werf en
// per periode een staat op de posten van de getekende offerte (2.8) met wat uitgevoerd of opgemeten is (2.9), de regie-uren
// (1.6) en de contractparameters (1.1), cumulatief. Gerekend in de browser én hier met dezelfde module (lib/ProgressCalc.mo);
// een bewaring van admin of calculator geeft de totalen mee die de browser vond, en de server weigert als hij iets anders vindt.
//   • Rechten (Rights.progressScope): admin en calculator maken, zien de bedragen en versturen; de werfleider van de werf bereidt
//     voor (hoeveelheden en %, nooit een bedrag: progressQty is de enige lezing voor hem en draagt geen enkel bedragveld); de
//     klant ziet enkel zijn VERZONDEN staten (readMyProgress, met verkoopprijzen) en kan (instelbaar) akkoord geven; architect,
//     OA en veiligheidscoördinator niets. Bedragen lezen enkel via update-calls met een auditregel (R23).
//   • Versturen legt alles vast onder een hash (`frozen`, vertrouwelijk); daarna verandert de staat nooit meer. Verbeteren =
//     een creditnota (de laatste staat volledig terugdraaien) of een volgende staat.
//   • De haak naar de facturatie (fase 3): "klaar voor factuur" en progressInvoiceData (wat UBL/Peppol nodig heeft). Geen koppeling.
// Geen await in deze mixin: elke oproep is één atomische stap (R33).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import PV "../types/progressviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Library "../lib/Library";
import Measure "../lib/Measure";
import Plan "../lib/Plan";
import Progress "../lib/Progress";
import ProgressCalc "../lib/ProgressCalc";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  dossier : Types.DossierState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  quotes : Types.QuotesState,
  workStarts : Types.WorkStartState,
  surveys : Types.SurveyState,
  progress : Types.ProgressState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Instellingen (beheerder) ────────────────────────────────────────────
  public query ({ caller }) func progressSettings() : async PV.ProgressSettings {
    let p = Access.requireActive(access, caller);
    if (not Rights.internal(p)) { Runtime.trap("Geen toegang") };
    { client = Progress.clientMode(settings); retentionOnIncl = Progress.retentionOnIncl(settings) };
  };

  public shared ({ caller }) func saveProgressSettings(i : PV.ProgressSettings) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (i.client != "uit" and i.client != "mogelijk" and i.client != "vereist") { return #err("Klantakkoord: uit, mogelijk of vereist") };
    settings.values.add("progress.client", i.client);
    settings.values.add("progress.retentionIncl", if (i.retentionOnIncl) "ja" else "nee");
    Access.audit(audit, caller, ?p.id, null, "vordering-instellingen", "klantakkoord " # i.client # ", inhouding op " # (if (i.retentionOnIncl) "incl." else "excl.") # " btw");
    #ok;
  };

  // ── Lijsten (zonder bedragen) ───────────────────────────────────────────
  // De werven waar de beller een vorderingsstaat maakt of voorbereidt: met een getekende offerte of al een staat.
  public query ({ caller }) func progressWorks() : async [PV.ProgressWorkBrief] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #progressAny, null);
    let out = List.empty<PV.ProgressWorkBrief>();
    for (w in works.works.values()) {
      if (w.archivedAt == null and w.status != #cancelled) {
        let sc = Rights.progressScope(ctx, p, w.id);
        if (sc == #full or sc == #prepare) {
          let sts = Progress.statementsOf(progress, w.id);
          let posts = Measure.posts(quotes, workStarts, w.id).size();
          if (posts > 0 or sts.size() > 0) {
            var sent = 0;
            var ready = 0;
            var lastCode = "";
            var lastTo : ?Nat = null;
            var lastNo = 0;
            for (s in sts.values()) {
              if (s.status == #sent) {
                sent += 1;
                switch (s.billing) { case (#ready _) { ready += 1 }; case _ {} };
                if (s.kind == #statement and s.number > lastNo) { lastNo := s.number; lastCode := s.code; lastTo := ?s.periodTo };
              };
            };
            out.add({
              workId = w.id;
              code = w.code;
              name = w.name;
              scope = if (sc == #full) "full" else "prepare";
              posts;
              sent;
              draftId = switch (Progress.draftOf(progress, w.id)) { case (?d) ?d.id; case null null };
              ready;
              lastCode;
              lastTo;
            });
          };
        };
      };
    };
    Array.sort<PV.ProgressWorkBrief>(out.toArray(), func(a, b) = Text.compare(a.code, b.code));
  };

  public query ({ caller }) func listProgress(workId : Nat) : async [PV.ProgressBrief] {
    let p = Access.requireActive(access, caller);
    let sc = Rights.progressScope({ works; settings }, p, workId);
    if (sc != #full and sc != #prepare) { Runtime.trap("Geen toegang") };
    let c = pgCtx();
    let sts = Progress.statementsOf(progress, workId).filter(func s = s.status != #cancelled);
    Array.reverse(sts.map(func(s : Types.ProgressStatement) : PV.ProgressBrief = Progress.brief(c, s)));
  };

  // ── Nieuw ontwerp ───────────────────────────────────────────────────────
  // Admin en calculator, of de werfleider van de werf (die begint de voorbereiding). Eén ontwerp per werf tegelijk.
  public shared ({ caller }) func newProgress(workId : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let sc = Rights.progressScope({ works; settings }, p, workId);
    if (sc != #full and sc != #prepare) { return #err("Geen toegang") };
    let w = switch (works.works.get(workId)) { case (?x) x; case null return #err("Geen toegang") };
    if (w.status == #cancelled) { return #err("Deze werf is geannuleerd") };
    switch (Progress.draftOf(progress, workId)) { case (?d) { return #err("Er is al een ontwerp voor deze werf (staat #" # d.id.toText() # "): werk daarin verder") }; case null {} };
    if (Measure.posts(quotes, workStarts, workId).size() == 0) { return #err("Deze werf heeft geen getekende offerte: een vorderingsstaat rekent op de posten van de aanvaarde offerte") };
    if (Progress.statementsOf(progress, workId).size() >= Config.maxProgressPerWork) { return #err("Te veel staten voor deze werf") };
    let today = Dossier.today();
    let from : Nat = switch (Progress.previous(progress, workId)) {
      case (?prev) prev.periodTo + 1;
      case null { switch (w.plannedStart) { case (?d) Nat.min(d, today); case null today } };
    };
    let id = Ids.next(ctr, "progress");
    let now = Time.now();
    let st : Types.ProgressStatement = {
      id;
      workId;
      kind = #statement;
      number = 0;
      code = "";
      credits = null;
      creditedBy = null;
      periodFrom = Nat.min(from, today);
      periodTo = today;
      status = #draft;
      billing = #open;
      prepared = null;
      note = "";
      rev = 0;
      calcVersion = ProgressCalc.version;
      sentAt = null;
      sentBy = null;
      hash = "";
      cancelReason = "";
      createdAt = now;
      createdBy = p.id;
      updatedAt = now;
      updatedBy = p.id;
      extra = [];
    };
    progress.statements.add(id, st);
    Progress.addIndex(progress.byWork, workId, id);
    Access.audit(audit, caller, ?p.id, ?workId, "vordering-ontwerp", w.code # " staat #" # id.toText());
    #ok(id);
  };

  // ── Lezen ───────────────────────────────────────────────────────────────
  // Zonder bedragen: de werfleider (voorbereiden) en iedereen met de volle rechten. De klant leest via readMyProgress.
  public query ({ caller }) func progressQty(id : Nat) : async PV.ProgressQtyView {
    let p = Access.requireActive(access, caller);
    let st = switch (progress.statements.get(id)) { case (?s) s; case null Runtime.trap("Geen toegang") };
    let sc = Rights.progressScope({ works; settings }, p, st.workId);
    if (sc != #full and sc != #prepare) { Runtime.trap("Geen toegang") };
    let c = pgCtx();
    if (st.status == #draft and st.kind == #statement) {
      let b = Progress.build(c, st);
      {
        brief = Progress.brief(c, st);
        lines = b.rows.map(Progress.qtyLine);
        openSurvey = b.openSurvey;
        unassignedRegieMilli = b.unassignedRegieMilli;
        scope = if (sc == #full) "full" else "prepare";
        canEdit = true;
        canPrepare = st.prepared == null;
        note = if (b.rows.size() == 0) "geen getekende offerte" else "";
      };
    } else {
      let lines = switch (pgFrozenOrCredit(st)) { case (?fr) fr.lines.map(Progress.frozenQty); case null [] };
      { brief = Progress.brief(c, st); lines; openSurvey = null; unassignedRegieMilli = 0; scope = if (sc == #full) "full" else "prepare"; canEdit = false; canPrepare = false; note = "" };
    };
  };

  // Met bedragen: admin en calculator, update-call met een auditregel.
  public shared ({ caller }) func readProgressStatement(id : Nat) : async Result.Result<PV.ProgressFullView, Text> {
    let p = Access.requireActive(access, caller);
    let st = switch (progress.statements.get(id)) { case (?s) s; case null return #err("Geen toegang") };
    if (Rights.progressScope({ works; settings }, p, st.workId) != #full) { return #err("Geen toegang") };
    Access.audit(audit, caller, ?p.id, ?st.workId, "bekeek:vorderingsstaat", "staat #" # st.id.toText() # (if (st.code == "") "" else " " # st.code));
    #ok(pgFull(st));
  };

  // ── Bewaren ─────────────────────────────────────────────────────────────
  // De invoer per post (cumulatief), de periode, en (admin en calculator) de notitie en de indexwaarden. De werfleider stuurt
  // nooit bedragen of indexwaarden mee; admin en calculator geven de totalen mee die de browser vond (expect).
  public shared ({ caller }) func saveProgressDraft(id : Nat, rev : Nat, i : PV.ProgressSaveInput) : async Result.Result<PV.ProgressSaved, Text> {
    let p = Access.requireActive(access, caller);
    let st = switch (progress.statements.get(id)) { case (?s) s; case null return #err("Geen toegang") };
    let sc = Rights.progressScope({ works; settings }, p, st.workId);
    if (sc != #full and sc != #prepare) { return #err("Geen toegang") };
    if (st.status != #draft) { return #err("Deze staat is verstuurd en ligt vast: verbeteren kan met een creditnota of een volgende staat") };
    if (st.kind != #statement) { return #err("Een creditnota volgt de gecrediteerde staat: er valt niets in te vullen") };
    if (rev != st.rev) { return #err("Iemand anders bewaarde deze staat intussen; laad opnieuw") };
    if (sc == #prepare and (i.note != null or i.setIndexes or i.expect != null)) { return #err("Geen toegang: de werfleider bereidt enkel hoeveelheden en % voor") };
    if (sc == #full and i.expect == null) { return #err("De totalen van de browser ontbreken: laad opnieuw") };
    if (i.lines.size() > Config.maxProgressOps) { return #err("Te veel regels in één keer") };
    let today = Dossier.today();
    let periodTo = switch (i.periodTo) { case (?d) d; case null st.periodTo };
    if (periodTo < st.periodFrom) { return #err("Het einde van de periode ligt vóór het begin (" # pgDay(st.periodFrom) # ")") };
    if (periodTo > today) { return #err("Het einde van de periode ligt in de toekomst") };
    switch (i.note) { case (?n) { if (n.size() > Config.maxNote) { return #err("Notitie te lang") } }; case null {} };
    if (i.setIndexes) {
      for (x in [i.sIndex, i.iIndex].values()) { switch x { case (?v) { if (v == 0 or v > Config.maxRevisionIndex) { return #err("Indexwaarde: groter dan 0 en hoogstens 100.000") } }; case null {} } };
    };
    // Welke posten bestaan er (en welke basis hebben ze)?
    let c = pgCtx();
    let prevF = switch (Progress.previous(progress, st.workId)) { case (?ps) Progress.frozenOf(progress, ps.id); case null null };
    let basis = Map.empty<Nat, Types.ProgressBasis>();
    for (k in Progress.candidates(c, st.workId, prevF).values()) { basis.add(k.root, k.basis) };
    let inputs = Progress.inputsOf(progress, id);
    let now = Time.now();
    var changed = 0;
    for (op in i.lines.values()) {
      let b = switch (basis.get(op.root)) { case (?x) x; case null return #err("Onbekende post #" # op.root.toText()) };
      if (op.note.size() > Config.maxNote) { return #err("Notitie bij een post: hoogstens " # Config.maxNote.toText() # " tekens") };
      if (op.clear) {
        if (inputs.containsKey(op.root)) { inputs.remove(op.root); changed += 1 };
      } else {
        switch (b, op.cumPctBp, op.cumQtyMilli) {
          case (#percent, ?pct, null) { if (pct > Config.maxProgressPctBp) { return #err("% uitgevoerd: 0 tot 100 %") } };
          case (#percent, _, _) { return #err("Een post met vaste prijs vraagt een % uitgevoerd") };
          case (_, null, ?q) { if (Int.abs(q) > Int.abs(Config.maxProgressQtyMilli)) { return #err("Hoeveelheid te groot") } };
          case (_, _, _) { return #err("Een post volgens opmeting of regie vraagt een hoeveelheid") };
        };
        inputs.add(op.root, { root = op.root; cumPctBp = op.cumPctBp; cumQtyMilli = op.cumQtyMilli; note = op.note.trim(#char ' '); at = now; by = p.id });
        changed += 1;
      };
    };
    // Tijdelijk toepassen, narekenen, en terugzetten als de browser iets anders vond (geen await: niemand ziet de tussenstand).
    let oldInputs = progress.inputs.get(id);
    let oldConf = progress.conf.get(id);
    progress.inputs.add(id, inputs.values().toArray());
    if (i.setIndexes) {
      let cf = Progress.confOf(progress, id);
      progress.conf.add(id, { cf with sIndex = #plain(i.sIndex); iIndex = #plain(i.iIndex) });
    };
    let tentative : Types.ProgressStatement = { st with periodTo; note = switch (i.note) { case (?n) n.trim(#char ' '); case null st.note } };
    let b = Progress.build(c, tentative);
    switch (i.expect) {
      case (?e) {
        let t = b.totals;
        if (e.periodCents != t.periodCents or e.revisionCents != t.revisionCents or e.vatCents != t.vatCents or e.totalCents != t.totalCents or e.payableCents != t.payableCents) {
          switch oldInputs { case (?x) progress.inputs.add(id, x); case null progress.inputs.remove(id) };
          switch oldConf { case (?x) progress.conf.add(id, x); case null progress.conf.remove(id) };
          return #err("De browser rekende een ander totaal dan de server (" # pgEuro(e.totalCents) # " ≠ " # pgEuro(t.totalCents) # "): laad opnieuw");
        };
      };
      case null {};
    };
    progress.statements.add(id, { tentative with rev = st.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?st.workId, "vordering-bewaard", "staat #" # id.toText() # ": " # changed.toText() # " post(en)" # (if (periodTo != st.periodTo) ", periode tot " # pgDay(periodTo) else "") # (if (i.setIndexes) ", indexwaarden" else ""));
    #ok({ rev = st.rev + 1 });
  };

  // De werfleider meldt dat de hoeveelheden klaar zijn: admin en calculator krijgen een melding.
  public shared ({ caller }) func markProgressPrepared(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let st = switch (progress.statements.get(id)) { case (?s) s; case null return #err("Geen toegang") };
    let sc = Rights.progressScope({ works; settings }, p, st.workId);
    if (sc != #full and sc != #prepare) { return #err("Geen toegang") };
    if (st.status != #draft or st.kind != #statement) { return #err("Enkel een ontwerp kan voorbereid gemeld worden") };
    if (st.prepared != null) { return #ok };
    let now = Time.now();
    progress.statements.add(id, { st with prepared = ?{ by = p.id; at = now }; rev = st.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?st.workId, "vordering-voorbereid", "staat #" # id.toText());
    pgNotifyOffice("vordering", "Vorderingsstaat voorbereid door " # p.name # ": " # pgWorkCode(st.workId) # " (tot " # pgDay(st.periodTo) # ")", st.workId, p.id);
    #ok;
  };

  public shared ({ caller }) func cancelProgressDraft(id : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let st = switch (progress.statements.get(id)) { case (?s) s; case null return #err("Geen toegang") };
    if (Rights.progressScope({ works; settings }, p, st.workId) != #full) { return #err("Geen toegang") };
    if (st.status != #draft) { return #err("Enkel een ontwerp kan weg; een verzonden staat verbeter je met een creditnota") };
    let why = reason.trim(#char ' ');
    if (why.size() < Config.minQuoteReason or why.size() > Config.maxQuoteReason) { return #err("Geef een reden (5 tot 300 tekens)") };
    let now = Time.now();
    progress.statements.add(id, { st with status = #cancelled; cancelReason = why; rev = st.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?st.workId, "vordering-ontwerp-weg", "staat #" # id.toText() # ": " # why);
    #ok;
  };

  // ── Versturen ───────────────────────────────────────────────────────────
  // Legt alles vast onder een hash (vertrouwelijk) en geeft het nummer. Blokkeringen houden het tegen; waarschuwingen vragen
  // een reden (auditlog). Daarna onwijzigbaar. Een creditnota draait de gecrediteerde staat volledig terug.
  public shared ({ caller }) func sendProgress(id : Nat, rev : Nat, expectTotalCents : Int, reason : Text) : async Result.Result<Text, Text> {
    let p = Access.requireActive(access, caller);
    let st = switch (progress.statements.get(id)) { case (?s) s; case null return #err("Geen toegang") };
    if (Rights.progressScope({ works; settings }, p, st.workId) != #full) { return #err("Geen toegang") };
    if (st.status != #draft) { return #err("Deze staat is al verstuurd of weggedaan") };
    if (rev != st.rev) { return #err("Iemand anders bewaarde deze staat intussen; laad opnieuw") };
    if (st.calcVersion != ProgressCalc.version) { return #err("Dit ontwerp rekent met oude regels: maak een nieuw ontwerp") };
    let c = pgCtx();
    let today = Dossier.today();
    let why = reason.trim(#char ' ');
    if (why.size() > Config.maxQuoteReason) { return #err("Reden: hoogstens " # Config.maxQuoteReason.toText() # " tekens") };
    var warned : [PV.ProgressFinding] = [];
    let fr : Types.ProgressFrozen = switch (st.kind) {
      case (#statement) {
        let b = Progress.build(c, st);
        let fs = Progress.findings(b, st, today);
        let bl = Progress.blocks(fs);
        if (bl.size() > 0) { return #err("Niet verstuurd: " # Progress.describe(bl)) };
        warned := Progress.warnings(fs);
        if (warned.size() > 0 and why.size() < Config.minQuoteReason) { return #err("Waarschuwingen: " # Progress.describe(warned) # ". Geef een reden om toch te versturen (minstens " # Config.minQuoteReason.toText() # " tekens)") };
        if (expectTotalCents != b.totals.totalCents) { return #err("Het totaal is intussen veranderd; laad opnieuw") };
        Progress.freeze(c, st, b, today);
      };
      case (#credit) {
        let oid = switch (st.credits) { case (?x) x; case null return #err("Creditnota zonder staat") };
        let o = switch (progress.statements.get(oid)) { case (?x) x; case null return #err("Onbekende staat") };
        if (o.status != #sent or o.creditedBy != null) { return #err("De gecrediteerde staat is niet (meer) te crediteren") };
        let of = switch (Progress.frozenOf(progress, oid)) { case (?x) x; case null return #err("De gecrediteerde staat heeft geen vastgelegde inhoud") };
        let x = Progress.creditFrozen(of, id, today);
        if (expectTotalCents != x.totals.totalCents) { return #err("Het totaal is intussen veranderd; laad opnieuw") };
        x;
      };
    };
    let key = (if (st.kind == #credit) "progress:cn:" else "progress:vs:") # st.workId.toText();
    let n = Ids.next(ctr, key);
    let code = (if (st.kind == #credit) "CN " else "VS ") # pgWorkCode(st.workId) # "/" # n.toText();
    let now = Time.now();
    let base : Types.ProgressStatement = { st with number = n; code };
    let h = Progress.hash(Progress.canonical(base, fr));
    progress.frozen.add(id, #plain(fr));
    let cf = Progress.confOf(progress, id);
    progress.conf.add(id, { cf with reason = #plain(why) });
    progress.statements.add(id, { base with status = #sent; hash = h; sentAt = ?now; sentBy = ?p.id; rev = st.rev + 1; updatedAt = now; updatedBy = p.id });
    switch (st.credits) {
      case (?oid) { switch (progress.statements.get(oid)) { case (?o) { progress.statements.add(oid, { o with creditedBy = ?id; updatedAt = now; updatedBy = p.id }) }; case null {} } };
      case null {};
    };
    Access.audit(audit, caller, ?p.id, ?st.workId, "vordering-verstuurd", code # " hash " # Text.fromIter(h.chars().take(12)));
    if (warned.size() > 0) {
      // De reden staat in de auditlog; nooit een bedrag.
      Access.audit(audit, caller, ?p.id, ?st.workId, "vordering-waarschuwingen-doorgezet", code # ": " # Progress.describe(warned) # ". Reden: " # why);
    };
    pgNotifyClient(st.workId, (if (st.kind == #credit) "Creditnota " else "Vorderingsstaat ") # code # " voor " # pgWorkName(st.workId) # " staat klaar in de app (Mijn vorderingsstaten)");
    #ok(code);
  };

  // Een creditnota (ontwerp) voor de LAATSTE verzonden staat; versturen gebeurt met sendProgress.
  public shared ({ caller }) func creditProgress(id : Nat, reason : Text) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let st = switch (progress.statements.get(id)) { case (?s) s; case null return #err("Geen toegang") };
    if (Rights.progressScope({ works; settings }, p, st.workId) != #full) { return #err("Geen toegang") };
    if (st.kind != #statement or st.status != #sent) { return #err("Enkel een verzonden vorderingsstaat kan gecrediteerd worden") };
    if (st.creditedBy != null) { return #err("Deze staat is al gecrediteerd") };
    switch (Progress.previous(progress, st.workId)) { case (?l) { if (l.id != st.id) { return #err("Enkel de laatste staat (" # l.code # ") kan gecrediteerd worden: crediteer eerst de latere") } }; case null {} };
    switch (Progress.draftOf(progress, st.workId)) { case (?d) { return #err("Er is een ontwerp open op deze werf (staat #" # d.id.toText() # "): verstuur of verwijder het eerst") }; case null {} };
    let why = reason.trim(#char ' ');
    if (why.size() < Config.minQuoteReason or why.size() > Config.maxQuoteReason) { return #err("Geef een reden voor de creditnota (5 tot 300 tekens)") };
    let nid = Ids.next(ctr, "progress");
    let now = Time.now();
    progress.statements.add(nid, { st with id = nid; kind = #credit; number = 0; code = ""; credits = ?st.id; creditedBy = null; status = #draft; billing = #open; prepared = null; note = why; rev = 0; calcVersion = ProgressCalc.version; sentAt = null; sentBy = null; hash = ""; cancelReason = ""; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; extra = [] });
    Progress.addIndex(progress.byWork, st.workId, nid);
    Access.audit(audit, caller, ?p.id, ?st.workId, "vordering-creditnota-ontwerp", st.code # ": " # why);
    #ok(nid);
  };

  // ── Facturatie (haak voor fase 3) ───────────────────────────────────────
  public shared ({ caller }) func setProgressReady(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let st = switch (progress.statements.get(id)) { case (?s) s; case null return #err("Geen toegang") };
    if (Rights.progressScope({ works; settings }, p, st.workId) != #full) { return #err("Geen toegang") };
    if (st.status != #sent) { return #err("Enkel een verzonden staat kan klaar voor factuur") };
    if (st.billing != #open) { return #err("Deze staat is al klaar voor factuur") };
    if (st.kind == #statement and Progress.clientMode(settings) == "vereist") {
      switch (progress.answers.get(id)) { case (?a) { if (not a.ok) { return #err("De klant maakte een opmerking: eerst oplossen (creditnota of volgende staat)") } }; case null { return #err("Het akkoord van de klant is vereist (Instellingen → Vorderingsstaten)") } };
    };
    if (st.creditedBy != null) { return #err("Deze staat is gecrediteerd") };
    let now = Time.now();
    progress.statements.add(id, { st with billing = #ready({ at = now; by = p.id }); updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?st.workId, "vordering-klaar-voor-factuur", st.code);
    #ok;
  };

  // Wat UBL/Peppol BIS straks nodig heeft (fase 3). Update-call met een auditregel; enkel een verzonden staat.
  public shared ({ caller }) func progressInvoiceData(id : Nat) : async Result.Result<PV.ProgressInvoiceData, Text> {
    let p = Access.requireActive(access, caller);
    let st = switch (progress.statements.get(id)) { case (?s) s; case null return #err("Geen toegang") };
    if (Rights.progressScope({ works; settings }, p, st.workId) != #full) { return #err("Geen toegang") };
    if (st.status != #sent) { return #err("Enkel een verzonden staat heeft factuurgegevens") };
    let fr = switch (Progress.frozenOf(progress, id)) { case (?x) x; case null return #err("Geen vastgelegde inhoud") };
    Access.audit(audit, caller, ?p.id, ?st.workId, "bekeek:vordering-factuurgegevens", st.code);
    #ok(Progress.invoiceData(st, fr, pgCode(st.credits)));
  };

  // ── Prijsherziening: het rekenmodel per werf (vertrouwelijk) ────────────
  public shared ({ caller }) func readProgressRevision(workId : Nat) : async Result.Result<?Types.RevisionModel, Text> {
    let p = Access.requireActive(access, caller);
    if (Rights.progressScope({ works; settings }, p, workId) != #full) { return #err("Geen toegang") };
    Access.audit(audit, caller, ?p.id, ?workId, "bekeek:prijsherziening", pgWorkCode(workId));
    #ok(Progress.modelOf(progress, workId));
  };

  public shared ({ caller }) func saveProgressRevision(workId : Nat, m : Types.RevisionModel) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    if (Rights.progressScope({ works; settings }, p, workId) != #full) { return #err("Geen toegang") };
    switch (Progress.modelError(m)) { case (?e) { return #err(e) }; case null {} };
    let version = switch (progress.revisions.get(workId)) { case (?r) r.version + 1; case null 1 };
    progress.revisions.add(workId, { workId; model = #plain({ m with sLabel = m.sLabel.trim(#char ' '); iLabel = m.iLabel.trim(#char ' '); note = m.note.trim(#char ' ') }); version; at = Time.now(); by = p.id; extra = [] });
    // Enkel dát het model veranderde, nooit de waarden (de auditlog is intern).
    Access.audit(audit, caller, ?p.id, ?workId, "prijsherziening-model", pgWorkCode(workId) # " v" # version.toText());
    #ok;
  };

  // ── De klant ────────────────────────────────────────────────────────────
  public query ({ caller }) func listMyProgress() : async [PV.MyProgressBrief] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #ownQuotes, null);
    let out = List.empty<PV.MyProgressBrief>();
    for (st in progress.statements.values()) {
      if (st.status == #sent and Rights.progressScope(ctx, p, st.workId) == #client) {
        out.add({ id = st.id; code = st.code; kind = st.kind; workName = pgWorkName(st.workId); periodFrom = st.periodFrom; periodTo = st.periodTo; sentAt = switch (st.sentAt) { case (?t) t; case null 0 }; answered = switch (progress.answers.get(st.id)) { case (?a) ?a.ok; case null null }; creditedBy = st.creditedBy != null });
      };
    };
    Array.sort<PV.MyProgressBrief>(out.toArray(), func(a, b) = Int.compare(b.sentAt, a.sentAt));
  };

  public shared ({ caller }) func readMyProgress(id : Nat) : async Result.Result<PV.MyProgressRead, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #ownQuotes, null);
    let (st, fr) = switch (pgMine(p, id)) { case (?x) x; case null return #err("Onbekende staat") };
    Access.audit(audit, caller, ?p.id, ?st.workId, "bekeek:vordering-klant", "staat #" # st.id.toText());
    #ok(pgMyRead(st, fr));
  };

  // Akkoord of een opmerking, op de exacte verzonden staat (hash). Eén antwoord per staat.
  public shared ({ caller }) func answerMyProgress(id : Nat, hash : Text, ok : Bool, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #ownQuotes, null);
    let (st, _) = switch (pgMine(p, id)) { case (?x) x; case null return #err("Onbekende staat") };
    if (Progress.clientMode(settings) == "uit") { return #err("Een akkoord in de app staat uit: neem contact op met BOWACO") };
    if (st.kind != #statement) { return #err("Een creditnota vraagt geen akkoord") };
    if (st.creditedBy != null) { return #err("Deze staat is gecrediteerd") };
    if (progress.answers.get(id) != null) { return #err("U antwoordde al op deze staat") };
    if (hash != st.hash) { return #err("U ziet niet de staat die verstuurd werd: laad opnieuw") };
    if (not Progress.intact(progress, st)) { return #err("De inhoud wijkt af van wat verstuurd werd: neem contact op met BOWACO") };
    let why = note.trim(#char ' ');
    if (why.size() > Config.maxText) { return #err("Opmerking te lang") };
    if (not ok and why.size() < Config.minQuoteReason) { return #err("Schrijf wat er niet klopt") };
    progress.answers.add(id, { statementId = id; hash = st.hash; ok; note = why; at = Time.now(); personId = p.id; principal = caller; extra = [] });
    Access.audit(audit, caller, ?p.id, ?st.workId, if ok "vordering-akkoord-klant" else "vordering-opmerking-klant", st.code # " hash " # Text.fromIter(st.hash.chars().take(12)));
    pgNotifyOffice("vordering", (if ok "Akkoord van de klant op " else "Opmerking van de klant op ") # st.code # " (" # pgWorkName(st.workId) # ")" # (if ok "" else ": " # why), st.workId, p.id);
    #ok;
  };

  // ── Hulp ───────────────────────────────────────────────────────────────
  func pgCtx() : Progress.Ctx { { settings; access; org; works; dossier; plan; reports; qs = quotes; starts = workStarts; ss = surveys; ps = progress } };

  func pgDay(d : Nat) : Text { Plan.fmtDay(d) };
  func pgEuro(c : Int) : Text { Progress.euro(c) };
  func pgWorkCode(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.code; case null "?" } };
  func pgWorkName(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.name; case null "" } };
  func pgCode(id : ?Nat) : Text { switch id { case (?i) { switch (progress.statements.get(i)) { case (?s) s.code; case null "" } }; case null "" } };

  // Een verzonden staat: de vastgelegde inhoud. Een creditnota in ontwerp: wat ze zal zijn (de gecrediteerde staat terug).
  func pgFrozenOrCredit(st : Types.ProgressStatement) : ?Types.ProgressFrozen {
    if (st.status == #sent) { return Progress.frozenOf(progress, st.id) };
    switch (st.kind, st.credits) {
      case (#credit, ?oid) { switch (Progress.frozenOf(progress, oid)) { case (?of) ?Progress.creditFrozen(of, st.id, Dossier.today()); case null null } };
      case _ null;
    };
  };

  func pgMine(p : Types.Person, id : Nat) : ?(Types.ProgressStatement, Types.ProgressFrozen) {
    let st = switch (progress.statements.get(id)) { case (?s) s; case null return null };
    if (st.status != #sent or Rights.progressScope({ works; settings }, p, st.workId) != #client) { return null };
    switch (Progress.frozenOf(progress, id)) { case (?fr) ?(st, fr); case null null };
  };

  func pgMyRead(st : Types.ProgressStatement, fr : Types.ProgressFrozen) : PV.MyProgressRead {
    let mode = Progress.clientMode(settings);
    let ans = progress.answers.get(st.id);
    let intact = Progress.intact(progress, st);
    {
      id = st.id;
      code = st.code;
      kind = st.kind;
      creditsCode = pgCode(st.credits);
      creditedByCode = pgCode(st.creditedBy);
      periodFrom = st.periodFrom;
      periodTo = st.periodTo;
      note = st.note;
      sentAt = switch (st.sentAt) { case (?t) t; case null 0 };
      hash = st.hash;
      intact;
      doc = Progress.docInfo(fr);
      lines = fr.lines;
      totals = fr.totals;
      answer = switch ans { case (?a) ?Progress.answerView(access, a); case null null };
      canAnswer = mode != "uit" and st.kind == #statement and st.creditedBy == null and ans == null and intact;
      clientMode = mode;
    };
  };

  func pgFull(st : Types.ProgressStatement) : PV.ProgressFullView {
    let c = pgCtx();
    let mode = Progress.clientMode(settings);
    let ans = switch (progress.answers.get(st.id)) { case (?a) ?Progress.answerView(access, a); case null null };
    let reason = Progress.reasonOf(progress, st.id);
    if (st.status == #draft and st.kind == #statement) {
      let b = Progress.build(c, st);
      let orig : ?Int = switch (b.base) { case (?v) { switch (v.sent) { case (?s) ?s.subtotalCents; case null null } }; case null null };
      let baseLabel = switch (b.base) { case (?v) { switch (quotes.quotes.get(v.quoteId)) { case (?q) q.number # " v" # v.version.toText(); case null "" } }; case null "" };
      return {
        brief = Progress.brief(c, st);
        header = { vatBp = b.vatBp; vatNote = b.vatNote; guarantee = switch (b.contract) { case (?k) k.guarantee; case null #none }; retentionBp = b.retentionBp; retentionOnIncl = b.retentionOnIncl; paymentDays = Progress.paymentDays(c, b.contract); formula = b.formula; model = b.model; sIndex = b.sIndex; iIndex = b.iIndex; contractFound = b.contract != null; signedVersion = baseLabel; originalContractCents = orig };
        lines = b.rows.map(func(r : Progress.Row) : PV.ProgressLineView = { q = Progress.qtyLine(r); m = Progress.money(r) });
        totals = Progress.totalsOf(b.totals);
        findings = Progress.findings(b, st, Dossier.today());
        frozen = false;
        intact = true;
        hash = "";
        doc = ?Progress.docInfo(Progress.freeze(c, st, b, Dossier.today())); // voorbeeld (PDF met watermerk)
        answer = null;
        reason;
        openSurvey = b.openSurvey;
        unassignedRegieMilli = b.unassignedRegieMilli;
        canEdit = true;
        canSend = true;
        canCancel = true;
        canCredit = false;
        canReady = false;
        clientMode = mode;
        clientNote = st.note;
        note = if (b.rows.size() == 0) "geen getekende offerte" else "";
      };
    };
    let fr = pgFrozenOrCredit(st);
    let empty : Types.ProgressTotals = { sections = []; offerCents = 0; prevCents = 0; cumCents = 0; periodCents = 0; restCents = 0; overVhCents = 0; revisionBaseCents = 0; revisionCents = 0; subtotalCents = 0; vatBp = 0; vatCents = 0; totalCents = 0; retentionBp = 0; retentionCents = 0; payableCents = 0 };
    let latest = switch (Progress.previous(progress, st.workId)) { case (?l) l.id == st.id; case null false };
    let draftOpen = Progress.draftOf(progress, st.workId) != null;
    let answeredOk = switch (progress.answers.get(st.id)) { case (?a) a.ok; case null false };
    let sent = st.status == #sent;
    {
      brief = Progress.brief(c, st);
      header = switch fr {
        case (?x) {
          {
            vatBp = x.totals.vatBp;
            vatNote = x.vatNote;
            guarantee = x.guarantee;
            retentionBp = x.totals.retentionBp;
            retentionOnIncl = x.retentionOnIncl;
            paymentDays = x.paymentDays;
            formula = switch (x.revision) { case (?r) r.formula; case null "" };
            model = switch (x.revision) { case (?r) ?{ aBp = r.aBp; bBp = r.bBp; cBp = r.cBp; sBase = r.sBase; iBase = r.iBase; sLabel = r.sLabel; iLabel = r.iLabel; note = "" }; case null null };
            sIndex = switch (x.revision) { case (?r) ?r.sIndex; case null null };
            iIndex = switch (x.revision) { case (?r) ?r.iIndex; case null null };
            contractFound = true;
            signedVersion = Text.join(x.quoteRefs.values(), ", ");
            originalContractCents = null;
          };
        };
        case null { { vatBp = 0; vatNote = ""; guarantee = #none; retentionBp = 0; retentionOnIncl = false; paymentDays = 0; formula = ""; model = null; sIndex = null; iIndex = null; contractFound = false; signedVersion = ""; originalContractCents = null } };
      };
      lines = switch fr { case (?x) x.lines.map(Progress.frozenRow); case null [] };
      totals = switch fr { case (?x) x.totals; case null empty };
      findings = [];
      frozen = sent;
      intact = Progress.intact(progress, st);
      hash = st.hash;
      doc = switch fr { case (?x) ?Progress.docInfo(x); case null null };
      answer = ans;
      reason;
      openSurvey = null;
      unassignedRegieMilli = 0;
      canEdit = false;
      canSend = st.status == #draft;
      canCancel = st.status == #draft;
      canCredit = sent and st.kind == #statement and st.creditedBy == null and latest and not draftOpen;
      canReady = sent and st.billing == #open and st.creditedBy == null and (st.kind == #credit or mode != "vereist" or answeredOk);
      clientMode = mode;
      clientNote = st.note;
      note = "";
    };
  };

  // Admin en calculator krijgen een melding (niet de afzender zelf).
  func pgNotifyOffice(kind : Text, text : Text, workId : Nat, except : Nat) {
    for (q in access.persons.values()) {
      if (q.archivedAt == null and q.id != except and Access.hasActiveLink(access, q.id) and q.roles.find(func r = r == #admin or r == #calculator) != null) {
        Access.notify(audit, ctr, q.id, kind, text, ?workId);
      };
    };
  };

  // De klant(en) van de werf met een actieve login krijgen een melding (nooit een bedrag).
  func pgNotifyClient(workId : Nat, text : Text) {
    let ctx = { works; settings };
    for (q in access.persons.values()) {
      if (q.archivedAt == null and Access.hasActiveLink(access, q.id) and Rights.progressScope(ctx, q, workId) == #client) {
        Access.notify(audit, ctr, q.id, "vordering", text, ?workId);
      };
    };
  };
};
