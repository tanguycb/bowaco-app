// Opmeting ter plaatse (stap 2.9, bouwplan rij 2.9 en §5.1): de rekenregels zonder toestand-wijzigingen, zodat de API
// (mixins/MeasureApi.mo) en de testen dezelfde regels gebruiken. Het gaat over HOEVEELHEDEN: niets hier leest of geeft een prijs.
//   • De posten van een werf = de lijnen van de laatst AANVAARDE versie van elke offerte van de werf (de getekende offerte,
//     2.7/2.8) die een post zijn (en de opties die de klant toch aanvaardde); de sleutel van een post is de lijn van de
//     eerste versie (`root`), zodat een meerwerk-versie dezelfde post blijft.
//   • Gemeten per post = de som van wat elke geldige regel toevoegt (`contribution`): een gewone regel zijn hoeveelheid, een
//     correctie nieuw − oud. Zo is het totaal altijd de laatste waarde, en per opmeting is zichtbaar wat erbij kwam.
import Array "mo:core/Array";
import Int "mo:core/Int";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import MV "../types/measureviews";
import Config "Config";
import Quotes "Quotes";
import WorkStart "WorkStart";

module {
  public type Post = {
    root : Nat;
    line : Types.QuoteLine;
    version : Types.QuoteVersion;
    quote : Types.Quote;
    chapter : ?Types.QuoteChapter;
    option : Bool;
  };

  // ── Instellingen (settings.values, zonder migratie) ──────────────────────
  public func thresholdBp(s : Types.SettingsState) : Nat {
    switch (s.values.get("measure.thresholdBp")) {
      case (?t) { switch (Nat.fromText(t)) { case (?n) { if (n <= Config.measureThresholdBpMax) n else Config.measureThresholdBpDefault }; case null Config.measureThresholdBpDefault } };
      case null Config.measureThresholdBpDefault;
    };
  };
  public func oaPropose(s : Types.SettingsState) : Bool { s.values.get("measure.oaPropose") == ?"ja" };
  public func externalRead(s : Types.SettingsState) : Bool { s.values.get("measure.externalRead") == ?"ja" };

  // ── De posten van de getekende offerte ───────────────────────────────────
  public func posts(qs : Types.QuotesState, starts : Types.WorkStartState, workId : Nat) : [Post] {
    let out = List.empty<Post>();
    let qids = Quotes.ids(qs.byWork, workId);
    for (qid in qids.values()) {
      switch (qs.quotes.get(qid)) {
        case (?q) {
          if (q.archivedAt == null) {
            let vs = Quotes.versionsOf(qs, qid); // nieuwste eerst
            switch (vs.find(func v = v.status == #accepted)) {
              case (?v) {
                // Aanvaarde opties: de roots van de lijnen die een start (2.8) meenam.
                let optRoots = Map.empty<Nat, Bool>();
                for (x in vs.values()) {
                  switch (starts.starts.get(x.id)) {
                    case (?s) { if (s.status == #started) { for (r in s.roots.values()) { optRoots.add(r, true) } } };
                    case null {};
                  };
                };
                let chapters = Quotes.chaptersOf(qs, v.id);
                for (l in Quotes.linesOf(qs, v.id, chapters).values()) {
                  let r = WorkStart.root(qs, l.id);
                  let isOpt = l.kind == #option;
                  if (l.kind == #item or (isOpt and optRoots.containsKey(r))) {
                    out.add({ root = r; line = l; version = v; quote = q; chapter = chapters.find(func c = c.id == l.chapterId); option = isOpt });
                  };
                };
              };
              case null {};
            };
          };
        };
        case null {};
      };
    };
    out.toArray();
  };

  // ── Regels ───────────────────────────────────────────────────────────────
  public func surveysOf(ss : Types.SurveyState, workId : Nat) : [Types.Survey] {
    let ids = switch (ss.byWork.get(workId)) { case (?x) x; case null [] };
    ids.filterMap<Nat, Types.Survey>(func id = ss.surveys.get(id));
  };

  public func entriesOf(ss : Types.SurveyState, surveyId : Nat) : [Types.MeasureEntry] {
    let ids = switch (ss.bySurvey.get(surveyId)) { case (?x) x; case null [] };
    ids.filterMap<Nat, Types.MeasureEntry>(func id = ss.entries.get(id));
  };

  public func isOpen(s : Types.Survey) : Bool { switch (s.status) { case (#open) true; case _ false } };

  public func openSurvey(ss : Types.SurveyState, workId : Nat) : ?Types.Survey {
    surveysOf(ss, workId).find(isOpen);
  };

  // Een regel telt mee: niet weggehaald, en geen voorstel dat nog wacht of afgewezen werd.
  public func isValid(e : Types.MeasureEntry) : Bool {
    e.archivedAt == null and (switch (e.proposedOrgId) { case null true; case (?_) { switch (e.review) { case (?r) r.ok; case null false } } });
  };
  public func isPending(e : Types.MeasureEntry) : Bool { e.archivedAt == null and e.proposedOrgId != null and e.review == null };

  public func contribution(ss : Types.SurveyState, e : Types.MeasureEntry) : Int {
    switch (e.corrects) {
      case (?t) { switch (ss.entries.get(t)) { case (?x) e.qtyMilli - x.qtyMilli; case null e.qtyMilli } };
      case null e.qtyMilli;
    };
  };

  // Is er een geldige (of nog wachtende, als pending = true) regel die deze corrigeert?
  public func correctedBy(ss : Types.SurveyState, workId : Nat, entryId : Nat, includePending : Bool) : ?Types.MeasureEntry {
    for (s in surveysOf(ss, workId).values()) {
      for (e in entriesOf(ss, s.id).values()) {
        if (e.corrects == ?entryId and e.archivedAt == null and (isValid(e) or (includePending and isPending(e)))) { return ?e };
      };
    };
    null;
  };

  public type Agg = {
    measured : Int;
    closed : Int;
    count : Nat;
    pending : Nat;
    lastDay : ?Nat;
    complete : Bool;
    lastId : Nat;
  };

  func emptyAgg() : Agg { { measured = 0; closed = 0; count = 0; pending = 0; lastDay = null; complete = false; lastId = 0 } };

  // Over alle opmetingen van de werf (of tot en met `upto` = het volgnummer van een opmeting) per post.
  public func aggregate(ss : Types.SurveyState, workId : Nat, upto : ?Nat) : Map.Map<Nat, Agg> {
    let m = Map.empty<Nat, Agg>();
    for (s in surveysOf(ss, workId).values()) {
      let inRange = switch upto { case (?n) s.number <= n; case null true };
      if (inRange) {
        let closed = not isOpen(s);
        for (e in entriesOf(ss, s.id).values()) {
          let a = switch (m.get(e.root)) { case (?x) x; case null emptyAgg() };
          if (isPending(e)) {
            m.add(e.root, { a with pending = a.pending + 1 });
          } else if (isValid(e)) {
            let c = contribution(ss, e);
            let last = e.id > a.lastId;
            m.add(
              e.root,
              {
                measured = a.measured + c;
                closed = if closed (a.closed + c) else a.closed;
                count = a.count + 1;
                pending = a.pending;
                lastDay = switch (a.lastDay) { case (?d) { if (e.day > d) ?e.day else ?d }; case null ?e.day };
                complete = if last e.complete else a.complete;
                lastId = if last e.id else a.lastId;
              },
            );
          };
        };
      };
    };
    m;
  };

  public func absInt(x : Int) : Int { if (x < 0) -x else x };

  // Verschil met de VH, in % (basispunten) en de markering. thr in basispunten.
  public func compare(vh : Int, measured : Int, count : Nat, complete : Bool, thr : Nat) : (Int, ?Int, MV.MeasureFlag) {
    let diff = measured - vh;
    let bp : ?Int = if (vh == 0) null else ?(diff * 10_000 / absInt(vh));
    if (count == 0) { return (diff, bp, #none) };
    let exceeds = switch bp { case null diff != 0; case (?b) absInt(b) > thr };
    let flag : MV.MeasureFlag = if (not exceeds) #none else if (diff > 0) #more else if (complete) #less else #open;
    (diff, bp, flag);
  };

  // Op welke firma's de post rust: de uitvoerders van de taken waaraan ze hangt (2.8), de verantwoordelijke van die taken
  // en de standaard-OA van de post in de bibliotheek. Per post (root) de lijst van firma's.
  public func orgsByRoot(qs : Types.QuotesState, plan : Types.PlanState, lib : Types.LibraryState, workId : Nat, ps : [Post]) : Map.Map<Nat, [Nat]> {
    let m = Map.empty<Nat, List.List<Nat>>();
    func add(r : Nat, o : Nat) {
      let l = switch (m.get(r)) { case (?l) l; case null { let l = List.empty<Nat>(); m.add(r, l); l } };
      if (not l.contains(Nat.equal, o)) { l.add(o) };
    };
    let byTask = Map.empty<Nat, List.List<Nat>>();
    for (a in plan.assignments.values()) {
      if (a.workId == workId and a.archivedAt == null) {
        let l = switch (byTask.get(a.taskId)) { case (?l) l; case null { let l = List.empty<Nat>(); byTask.add(a.taskId, l); l } };
        l.add(a.orgId);
      };
    };
    for (t in plan.tasks.values()) {
      if (t.workId == workId and t.archivedAt == null and t.quoteLineIds.size() > 0) {
        let orgs = List.empty<Nat>();
        switch (t.responsibleOrgId) { case (?o) orgs.add(o); case null {} };
        switch (byTask.get(t.id)) { case (?l) { for (o in l.values()) { orgs.add(o) } }; case null {} };
        for (lid in t.quoteLineIds.values()) {
          let r = WorkStart.root(qs, lid);
          for (o in orgs.values()) { add(r, o) };
        };
      };
    };
    for (p in ps.values()) {
      switch (p.line.libItemId) {
        case (?li) { switch (lib.items.get(li)) { case (?it) { switch (it.orgId) { case (?o) add(p.root, o); case null {} } }; case null {} } };
        case null {};
      };
    };
    let out = Map.empty<Nat, [Nat]>();
    for ((r, l) in m.entries()) { out.add(r, l.toArray()) };
    out;
  };

  public func hasOrg(m : Map.Map<Nat, [Nat]>, root : Nat, orgId : Nat) : Bool {
    switch (m.get(root)) { case (?xs) xs.find(func x = x == orgId) != null; case null false };
  };

  public func entriesPerPost(ss : Types.SurveyState, workId : Nat, root : Nat) : Nat {
    var n = 0;
    for (s in surveysOf(ss, workId).values()) { for (e in entriesOf(ss, s.id).values()) { if (e.root == root and e.archivedAt == null) { n += 1 } } };
    n;
  };

  public func versionLabel(p : Post) : Text { p.quote.number # " v" # p.version.version.toText() };
};
