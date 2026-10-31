// Afspraken met de gekozen OA (stap 2c.4, ontwerp 2c §4.4; VOORLOPIG: AC-15, AC-16, AC-17). Rekenen en zoeken zonder rechten
// (lib/Rights.mo beslist wie wat ziet): tarieven met datum, de afspraak per werf en firma, de tarieven die op een dag gelden,
// de stand van de attesten van een firma, het contract uit het sjabloon onder een controlecode en de meldingen over attesten.
//   - Een afspraak neemt bij de werfstart de tarieven die op haar startdag golden en HOUDT ze (⚖9): een nieuw tarief van de firma
//     raakt een lopende werf niet. Kantoor zet op de werf een nieuw tarief vanaf een datum (AgreedRate.validFrom).
//   - Het tarief van een werf op een dag = het AgreedRate met die soort en de grootste validFrom ≤ die dag.
//   - Attesten tellen pas na de goedkeuring door kantoor (⚖11); vervallen = geldig tot < vandaag.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Sha256 "mo:sha2/Sha256";
import Types "../types";
import Codes "Codes";
import Access "Access";
import Config "Config";
import Ids "Ids";
import Measure "Measure";
import Plan "Plan";
import QuoteCalc "QuoteCalc";
import Quotes "Quotes";
import Rights "Rights";

module {
  type D = Types.OaDealState;
  type Day = Types.Day;

  public func plain<T>(c : Types.Confidential<T>) : ?T { switch c { case (#plain x) ?x; case (#sealed _) null } };

  public func addIdx(m : Map.Map<Nat, [Nat]>, k : Nat, id : Nat) {
    let cur = switch (m.get(k)) { case (?x) x; case null [] };
    if (cur.find(func x = x == id) == null) { m.add(k, cur.concat([id])) };
  };

  public func hash(text : Text) : Text { Codes.hex(Sha256.fromBlob(#sha256, text.encodeUtf8())) };

  // ── Soorten tarief ───────────────────────────────────────────────────────
  public func kindKey(k : Types.RateKind) : Text {
    switch k {
      case (#regiePerson) "regie";
      case (#crewHour) "ploeguur";
      case (#transportHour) "transport";
      case (#dieselKm) "diesel";
      case (#kmLevy) "kmheffing";
      case (#containerTon) "container";
      case (#machineDay) "machine";
      case (#other t) "andere:" # t;
    };
  };

  public func kindFromKey(k : Text) : ?Types.RateKind {
    switch k {
      case "regie" ?#regiePerson;
      case "ploeguur" ?#crewHour;
      case "transport" ?#transportHour;
      case "diesel" ?#dieselKm;
      case "kmheffing" ?#kmLevy;
      case "container" ?#containerTon;
      case "machine" ?#machineDay;
      case _ {
        if (k.startsWith(#text "andere:")) {
          let t = Text.fromIter(k.chars().drop(7)).trim(#char ' ');
          if (t.size() >= 1 and t.size() <= Config.maxName) ?#other(t) else null;
        } else null;
      };
    };
  };

  public func kindName(k : Types.RateKind) : Text {
    switch k {
      case (#regiePerson) "Regie per persoon";
      case (#crewHour) "Ploeguur";
      case (#transportHour) "Transport per uur";
      case (#dieselKm) "Diesel per km";
      case (#kmLevy) "Kilometerheffing";
      case (#containerTon) "Container en afvoer per ton";
      case (#machineDay) "Machinehuur per dag";
      case (#other t) t;
    };
  };

  public func defaultUnit(k : Types.RateKind) : Text {
    switch k { case (#regiePerson or #crewHour or #transportHour) "uur"; case (#dieselKm or #kmLevy) "km"; case (#containerTon) "ton"; case (#machineDay) "dag"; case (#other _) "stuk" };
  };

  // ── Tarieven van een firma ───────────────────────────────────────────────
  public func rateOf(d : D, id : Nat) : ?Types.OaRate { switch (d.rates.get(id)) { case (?c) plain(c); case null null } };

  public func ratesOf(d : D, orgId : Nat, withArchived : Bool) : [Types.OaRate] {
    let ids = switch (d.ratesByOrg.get(orgId)) { case (?x) x; case null [] };
    ids.filterMap(func(id : Nat) : ?Types.OaRate = rateOf(d, id)).filter(func r = withArchived or r.archivedAt == null).sort(func(a, b) = if (a.validFrom == b.validFrom) Nat.compare(a.id, b.id) else Nat.compare(a.validFrom, b.validFrom));
  };

  // Per soort (en eenheid) het tarief dat op `day` geldt: de grootste validFrom ≤ day (bij gelijke dag het laatst ingevoerde).
  public func ratesAt(d : D, orgId : Nat, day : Day) : [Types.OaRate] {
    let best = Map.empty<Text, Types.OaRate>();
    for (r in ratesOf(d, orgId, false).values()) {
      if (r.validFrom <= day) { best.add(kindKey(r.kind) # "|" # r.unit, r) };
    };
    best.values().toArray();
  };

  public func rateAt(d : D, orgId : Nat, kind : Types.RateKind, day : Day) : ?Types.OaRate {
    var out : ?Types.OaRate = null;
    for (r in ratesOf(d, orgId, false).values()) { if (r.kind == kind and r.validFrom <= day) { out := ?r } };
    out;
  };

  // ── Afspraken ────────────────────────────────────────────────────────────
  public func keyOf(workId : Nat, orgId : Nat) : Text { workId.toText() # ":" # orgId.toText() };

  public func agreementOf(d : D, workId : Nat, orgId : Nat) : ?Types.Agreement {
    switch (d.agreementKeys.get(keyOf(workId, orgId))) { case (?id) d.agreements.get(id); case null null };
  };

  public func agreementsOf(d : D, workId : Nat) : [Types.Agreement] {
    let ids = switch (d.agreementsByWork.get(workId)) { case (?x) x; case null [] };
    ids.filterMap(func(id : Nat) : ?Types.Agreement = d.agreements.get(id));
  };

  public func agreementsOfOrg(d : D, orgId : Nat) : [Types.Agreement] {
    d.agreements.values().filter(func a = a.orgId == orgId).toArray();
  };

  public func termsOf(d : D, id : Nat) : ?Types.AgreementTerms { switch (d.terms.get(id)) { case (?c) plain(c); case null null } };

  public func frozenKey(agreementId : Nat, version : Nat) : Nat { agreementId * 1000 + version };

  public func frozenOf(d : D, agreementId : Nat, version : Nat) : ?Types.AgreementFrozen {
    switch (d.frozen.get(frozenKey(agreementId, version))) { case (?c) plain(c); case null null };
  };

  public func extraGet(x : Types.Extra, k : Text) : Text {
    switch (x.find(func((a, _) : (Text, Text)) : Bool = a == k)) { case (?(_, v)) v; case null "" };
  };
  public func extraSet(x : Types.Extra, k : Text, v : Text) : Types.Extra {
    x.filter(func((a, _) : (Text, Text)) : Bool = a != k).concat([(k, v)]);
  };

  // De verwijzing van een afspraak of attest voor de OA (willekeurig, geen teller: hij ziet niet hoeveel er zijn).
  public func refOf(x : Types.Extra) : Text { extraGet(x, "ref") };
  public func newRef(seed : Text) : Text { Text.fromIter(hash("bowaco-ref-v1|" # seed).chars().take(16)) };

  // Het tarief van deze werf op die dag (⚖9): het afgesproken tarief van die soort met de grootste validFrom ≤ day.
  public func agreedRateAt(t : Types.AgreementTerms, kind : Types.RateKind, day : Day) : ?Types.AgreedRate {
    var out : ?Types.AgreedRate = null;
    var first : ?Types.AgreedRate = null;
    for (r in t.rates.values()) {
      if (r.kind == kind) {
        if (r.validFrom <= day) { switch out { case (?o) { if (r.validFrom >= o.validFrom) { out := ?r } }; case null { out := ?r } } };
        switch first { case (?f) { if (r.validFrom < f.validFrom) { first := ?r } }; case null { first := ?r } };
      };
    };
    // Een dag vóór het eerste tarief van die soort (prestaties vóór de start): het eerste tarief van de afspraak.
    switch out { case (?o) ?o; case null first };
  };

  // Voor de controle van OA-facturen (2.11): het regietarief van de afspraak van deze firma op deze werf op die dag.
  public func dealRegieAt(d : D, workId : Nat, orgId : Nat, day : Day) : ?(Int, Day) {
    let a = agreementOf(d, workId, orgId) ?? return null;
    switch (a.status) { case (#ended _) return null; case _ {} };
    let t = termsOf(d, a.id) ?? return null;
    switch (agreedRateAt(t, #regiePerson, day)) { case (?r) ?(r.cents, r.validFrom); case null null };
  };

  // Een OA die een afspraak heeft (niet beëindigd): hij mag zijn attesten opladen (opslagpoort).
  public func hasDeal(d : D, orgId : ?Nat) : Bool {
    let o = orgId ?? return false;
    d.agreements.values().any(func a = a.orgId == o and (switch (a.status) { case (#ended _) false; case _ true }));
  };

  public func statusKey(s : Types.AgreementStatus) : Text {
    switch s { case (#draft) "ontwerp"; case (#toSign) "te tekenen"; case (#signed) "getekend"; case (#ended _) "beëindigd" };
  };

  // ── Attesten van een firma (AC-17, ⚖11) ──────────────────────────────────
  public type Kind = { key : Text; name : Text; required : Bool };

  // De soorten: de drie vaste (verplicht voor een OA met een afspraak) en wat de beheerder erbij zette (lookups "orgDoc:<sleutel>").
  public func docKinds(s : Types.SettingsState) : [Kind] {
    let base = Config.orgDocKinds().map(func((k, n) : (Text, Text)) : Kind = { key = k; name = n; required = true });
    let own = s.lookups.entries().filter(func((k, l) : (Text, Types.Lookup)) : Bool = k.startsWith(#text "orgDoc:") and l.archivedAt == null).map(func((_, l) : (Text, Types.Lookup)) : Kind = { key = l.key; name = l.tag; required = false }).toArray();
    base.concat(own.filter(func k = base.find(func b = b.key == k.key) == null));
  };

  public func kindLabel(s : Types.SettingsState, key : Text) : Text {
    switch (docKinds(s).find(func k = k.key == key)) { case (?k) k.name; case null key };
  };

  public func docsOf(d : D, orgId : Nat) : [Types.OrgDoc] {
    let ids = switch (d.docsByOrg.get(orgId)) { case (?x) x; case null [] };
    ids.filterMap(func(id : Nat) : ?Types.OrgDoc = d.orgDocs.get(id)).filter(func x = x.archivedAt == null);
  };

  // Stand van één soort: geldig · vervalt (binnen 30 dagen) · vervallen · te-keuren (opgeladen, nog niet goedgekeurd) · ontbreekt.
  public type AttestState = { kind : Text; name : Text; required : Bool; state : Text; validUntil : ?Day; docId : ?Nat };

  func later(a : ?Day, b : ?Day) : Bool { switch (a, b) { case (null, _) true; case (_, null) false; case (?x, ?y) x > y } };

  public func bestApproved(d : D, orgId : Nat, kind : Text) : ?Types.OrgDoc {
    var best : ?Types.OrgDoc = null;
    for (x in docsOf(d, orgId).values()) {
      if (x.kind == kind and x.status == #approved) {
        switch best { case (?b) { if (later(x.validUntil, b.validUntil)) { best := ?x } }; case null { best := ?x } };
      };
    };
    best;
  };

  public func attestStates(d : D, s : Types.SettingsState, orgId : Nat, today : Day) : [AttestState] {
    let docs = docsOf(d, orgId);
    docKinds(s).filterMap(
      func(k : Kind) : ?AttestState {
        let mine = docs.filter(func x = x.kind == k.key);
        if (not k.required and mine.size() == 0) { return null };
        let pending = mine.find(func x = x.status == #received);
        switch (bestApproved(d, orgId, k.key)) {
          case (?b) {
            let st = switch (b.validUntil) {
              case (?u) { if (u < today) "vervallen" else if (u <= today + Config.dealNoticeDays) "vervalt" else "geldig" };
              case null "geldig";
            };
            let st2 = if (st == "vervallen" and pending != null) "te-keuren" else st;
            ?{ kind = k.key; name = k.name; required = k.required; state = st2; validUntil = b.validUntil; docId = ?b.id };
          };
          case null {
            ?{ kind = k.key; name = k.name; required = k.required; state = if (pending != null) "te-keuren" else "ontbreekt"; validUntil = null; docId = switch pending { case (?x) ?x.id; case null null } };
          };
        };
      }
    );
  };

  public func stateText(st : Text) : Text {
    switch st { case "geldig" "geldig"; case "vervalt" "vervalt binnenkort"; case "vervallen" "vervallen"; case "te-keuren" "opgeladen, nog niet goedgekeurd"; case _ "ontbreekt" };
  };

  // Waarschuwing bij Werf starten, een nieuwe afspraak en het goedkeuren van een OA-factuur: een verplicht attest dat ontbreekt,
  // nog niet goedgekeurd of vervallen is.
  public func attestWarnings(d : D, s : Types.SettingsState, org : Types.OrgState, orgId : Nat, today : Day) : [Text] {
    let name = switch (org.orgs.get(orgId)) { case (?o) o.name; case null "#" # orgId.toText() };
    attestStates(d, s, orgId, today).filter(func a = a.required and (a.state == "ontbreekt" or a.state == "vervallen" or a.state == "te-keuren")).map(
      func(a : AttestState) : Text = name # ": attest «" # a.name # "» " # stateText(a.state)
    );
  };

  // ── Meldingen in de uurlijkse ronde (zoals de vergunningen): 30 dagen vóór het vervallen, één keer per attest ──
  // Aan kantoor (beheerders, calculators) en aan de onderaannemers van die firma (zij laden het nieuwe attest op).
  public func scan(d : D, s : Types.SettingsState, access : Types.AccessState, org : Types.OrgState, log : Types.AuditState, ctr : Types.Counters, today : Day) : Nat {
    var n = 0;
    let now = Time.now();
    for (x in d.orgDocs.values()) {
      if (x.archivedAt == null and x.status == #approved) {
        switch (x.validUntil) {
          case (?u) {
            let key = x.id.toText() # ":30";
            if (u <= today + Config.dealNoticeDays and not d.notices.containsKey(key)) {
              d.notices.add(key, now);
              let superseded = switch (bestApproved(d, x.orgId, x.kind)) { case (?b) b.id != x.id; case null false };
              if (not superseded) {
                let firm = switch (org.orgs.get(x.orgId)) { case (?o) o.name; case null "#" # x.orgId.toText() };
                let what = "Attest «" # kindLabel(s, x.kind) # "» van " # firm # (if (u < today) " is vervallen sinds " else " vervalt op ") # Plan.fmtDay(u) # ".";
                for (p in access.persons.values()) {
                  if (p.archivedAt == null) {
                    if (Rights.isOffice(p)) { Access.notify(log, ctr, p.id, "attest", what # " Vraag een nieuw attest op.", null) }
                    else if (Rights.hasRole(p, #onderaannemer) and p.orgId == ?x.orgId) { Access.notify(log, ctr, p.id, "attest", what # " Laad het nieuwe attest op bij Mijn attesten.", null) };
                  };
                };
                n += 1;
              };
            };
          };
          case null {};
        };
      };
    };
    n;
  };

  // ── De afspraak bij Werf starten (2.8) ───────────────────────────────────
  // Nieuw: de tarieven van de firma die op de startdag golden (per soort het geldende), en het regietarief van de offerte als de
  // firma voor regie nog geen tarief heeft. Bestaat ze al (meerwerk op dezelfde werf): enkel de nieuwe posten en hun prijzen
  // erbij; de tarieven blijven (⚖9). Geeft (afspraak, nieuw?).
  public type StartInput = {
    workId : Nat;
    orgId : Nat;
    roots : [Nat];
    prices : [(Nat, Int)];
    amountCents : ?Int;
    startDay : Day;
    regie : ?Types.QuoteRegie;
    oaQuoteIds : [Nat];
    by : Nat;
  };

  public func ensureForStart(d : D, ctr : Types.Counters, i : StartInput) : (Nat, Bool) {
    let now = Time.now();
    func union(a : [Nat], b : [Nat]) : [Nat] { a.concat(b.filter(func x = a.find(func y = y == x) == null)) };
    switch (agreementOf(d, i.workId, i.orgId)) {
      case (?a) {
        let t = switch (termsOf(d, a.id)) { case (?x) x; case null { { agreementId = a.id; prices = []; rates = []; amountCents = null; advanceCents = null; extra = [] } } };
        let newPrices = i.prices.filter(func((r, _) : (Nat, Int)) : Bool = t.prices.find(func((q, _) : (Nat, Int)) : Bool = q == r) == null);
        let amount : ?Int = switch (t.amountCents, i.amountCents) { case (?x, ?y) ?(x + y); case (null, y) y; case (x, null) x };
        d.terms.add(a.id, #plain({ t with prices = t.prices.concat(newPrices); amountCents = amount }));
        d.agreements.add(a.id, { a with roots = union(a.roots, i.roots); oaQuoteIds = union(a.oaQuoteIds, i.oaQuoteIds); rev = a.rev + 1; updatedAt = now; updatedBy = i.by });
        (a.id, false);
      };
      case null {
        let id = Ids.next(ctr, "agreement");
        var rates : [Types.AgreedRate] = ratesAt(d, i.orgId, i.startDay).map(
          func(r : Types.OaRate) : Types.AgreedRate = { kind = r.kind; unit = r.unit; cents = r.cents; validFrom = r.validFrom; fromRateId = ?r.id; note = "tarief van de firma op de startdag" }
        );
        switch (i.regie) {
          case (?g) {
            if (g.orgId == ?i.orgId and rates.find(func r = r.kind == #regiePerson) == null) {
              rates := rates.concat([{ kind = #regiePerson; unit = "uur"; cents = g.costCents; validFrom = i.startDay; fromRateId = g.fromRateId; note = "regietarief van de offerte" }]);
            };
          };
          case null {};
        };
        let a : Types.Agreement = {
          id;
          workId = i.workId;
          orgId = i.orgId;
          oaQuoteIds = i.oaQuoteIds;
          roots = i.roots;
          startDay = ?i.startDay;
          status = #draft;
          advanceBp = 0;
          paymentDays = Config.dealPaymentDays;
          endOfMonth = Config.dealEndOfMonth;
          templateVersion = null;
          contractHash = "";
          contractVersion = 0;
          signedFileId = null;
          rev = 0;
          createdAt = now;
          createdBy = i.by;
          updatedAt = now;
          updatedBy = i.by;
          extra = [("ref", newRef("afspraak|" # id.toText() # "|" # now.toText()))];
        };
        d.agreements.add(id, a);
        d.agreementKeys.add(keyOf(i.workId, i.orgId), id);
        addIdx(d.agreementsByWork, i.workId, id);
        d.terms.add(id, #plain({ agreementId = id; prices = i.prices; rates; amountCents = i.amountCents; advanceCents = null; extra = [] }));
        (id, true);
      };
    };
  };

  // ── Posten van een firma op een werf (getekende offertes; de firma van de aankoopprijs) ──
  // Geeft de oorsprong van de posten, de prijs per post, het totaal (Σ VH × prijs) en de OA-offertes (2c.3) waaruit de prijzen
  // kwamen (QuoteLinePrice.extra "prijsvraag" → de laatste ontvangen offerte van die firma op die prijsvraag).
  public type FirmPosts = { roots : [Nat]; prices : [(Nat, Int)]; amountCents : ?Int; oaQuoteIds : [Nat] };

  public func postsFor(qs : Types.QuotesState, starts : Types.WorkStartState, ts : Types.TenderState, workId : Nat, orgId : Nat) : FirmPosts {
    var roots : [Nat] = [];
    var prices : [(Nat, Int)] = [];
    var amount : Int = 0;
    var any = false;
    let tenderIds = Map.empty<Nat, ()>();
    for (p in Measure.posts(qs, starts, workId).values()) {
      let pr = Quotes.priceOf(qs, p.line.id);
      if (pr.orgId == ?orgId and roots.find(func r = r == p.root) == null) {
        roots := roots.concat([p.root]);
        switch (pr.cost) {
          case (?c) { prices := prices.concat([(p.root, c)]); amount += QuoteCalc.roundDiv(c * p.line.qtyMilli, 1000); any := true };
          case null {};
        };
        switch (qs.prices.get(p.line.id)) {
          case (?x) { switch (Nat.fromText(extraGet(x.extra, "prijsvraag"))) { case (?t) tenderIds.add(t, ()); case null {} } };
          case null {};
        };
      };
    };
    var oq : [Nat] = [];
    for (t in tenderIds.keys()) {
      var best : ?Types.OaQuote = null;
      for (q in ts.oaQuotes.values()) {
        if (q.tenderId == ?t and q.orgId == orgId and q.status == #received) {
          switch best { case (?b) { if (q.version > b.version) { best := ?q } }; case null { best := ?q } };
        };
      };
      switch best { case (?b) { oq := oq.concat([b.id]) }; case null {} };
    };
    { roots; prices; amountCents = if any ?amount else null; oaQuoteIds = oq };
  };

  // ── Herstel (1.9): de indexen uit de records zelf ────────────────────────
  public func rebuildIndex(d : D) {
    d.ratesByOrg.clear();
    d.agreementKeys.clear();
    d.agreementsByWork.clear();
    d.docsByOrg.clear();
    for ((id, c) in d.rates.entries()) { switch (plain(c)) { case (?r) addIdx(d.ratesByOrg, r.orgId, id); case null {} } };
    for (a in d.agreements.values()) { d.agreementKeys.add(keyOf(a.workId, a.orgId), a.id); addIdx(d.agreementsByWork, a.workId, a.id) };
    for (x in d.orgDocs.values()) { addIdx(d.docsByOrg, x.orgId, x.id) };
  };

  // Bestanden die bij een tarief, een getekend contract of een attest horen (niet los te archiveren).
  public func ownedFiles(d : D) : Map.Map<Nat, ()> {
    let m = Map.empty<Nat, ()>();
    for (c in d.rates.values()) { switch (plain(c)) { case (?r) { switch (r.fileId) { case (?f) m.add(f, ()); case null {} } }; case null {} } };
    for (c in d.frozen.values()) { switch (plain(c)) { case (?f) { switch (f.signed) { case (?s) m.add(s.fileId, ()); case null {} } }; case null {} } };
    for (x in d.orgDocs.values()) { switch (x.fileId) { case (?f) m.add(f, ()); case null {} } };
    m;
  };
};
