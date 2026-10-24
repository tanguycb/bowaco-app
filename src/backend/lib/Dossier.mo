// Werfdossier (stap 1.1): afgeleide feiten uit het contract, documentsoorten, checklist en views.
// Geen rechten hier: wie wat mag, beslist lib/Rights.mo; dit bestand rekent alleen.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "Access";
import Config "Config";
import Rights "Rights";

module {
  type Ctx = Rights.Ctx;

  // ── Contract ─────────────────────────────────────────────────────────────
  // Het geldende contract van een werf: het eigen, of dat van de hoofdwerf (deelwerf zonder eigen, A9).
  public func effectiveConfidential(works : Types.WorksState, d : Types.DossierState, workId : Nat) : ?(Types.WorkConfidential, ?Nat) {
    switch (d.confidential.get(workId)) {
      case (?c) ?(c, null);
      case null {
        let w = works.works.get(workId) ?? return null;
        let parent = w.parentId ?? return null;
        switch (d.confidential.get(parent)) { case (?c) ?(c, ?parent); case null null };
      };
    };
  };

  public func setting(s : Types.SettingsState, key : Text, default : Nat) : Nat {
    switch (s.values.get(key)) { case (?v) { Nat.fromText(v) ?? default }; case null default };
  };

  public func threshold30bis(s : Types.SettingsState) : Nat { setting(s, "drempel30bis", Config.threshold30bisCentsDefault) };
  public func thresholdCheckinatwork(s : Types.SettingsState) : Nat { setting(s, "drempelCheckinatwork", Config.thresholdCheckinatworkCentsDefault) };

  // 1b.4: wat de app over een werf weet buiten het dossier (berekend door lib/Wadm.mo, om geen kringverwijzing te
  // maken): het aantal onderaannemers (lidmaatschap of planning) en of er asbest verwijderd wordt.
  public type Ext = { oaCount : Nat -> Nat; asbestos : Nat -> Bool };
  public let noExt : Ext = { oaCount = func(_ : Nat) : Nat = 0; asbestos = func(_ : Nat) : Bool = false };

  public func threshold30bisWithOa(s : Types.SettingsState) : Nat { setting(s, "drempel30bisMetOa", Config.threshold30bisWithOaCentsDefault) };
  public func oaCountAlways30bis(s : Types.SettingsState) : Nat { setting(s, "30bis.aantalOa", Config.oaCountAlways30bisDefault) };

  // Aangifte van werken (art. 30bis, VOORLOPIG tot de boekhouder bevestigt; regels sinds 1-1-2014 volgens
  // socialsecurity.be): verplicht bij asbest, bij meer dan één onderaannemer (ongeacht het bedrag), vanaf € 5.000
  // met minstens één onderaannemer, en vanaf € 30.000 (met of zonder). null = nog niet te bepalen (geen bedrag).
  public func art30bis(s : Types.SettingsState, amount : ?Int, oaCount : Nat, asbestos : Bool) : (?Bool, Text) {
    if asbestos { return (?true, "werken met asbest") };
    if (oaCount >= oaCountAlways30bis(s)) { return (?true, oaCount.toText() # " onderaannemers (ongeacht het bedrag)") };
    switch amount {
      case (?a) {
        if (a >= threshold30bis(s)) { (?true, "geraamde aanneemsom ≥ drempel") }
        else if (oaCount >= 1 and a >= threshold30bisWithOa(s)) { (?true, "onderaannemer en aanneemsom ≥ drempel met onderaannemer") }
        else { (?false, if (oaCount == 0) "onder de drempel, geen onderaannemer" else "onder de drempel met onderaannemer") };
      };
      case null { (null, if (oaCount == 0) "geraamde aanneemsom ontbreekt" else "1 onderaannemer: aanneemsom nodig om te beslissen") };
    };
  };

  public func facts(s : Types.SettingsState, works : Types.WorksState, d : Types.DossierState, ext : Ext, workId : Nat) : Views.WorkFacts {
    let n = ext.oaCount(workId);
    let asb = ext.asbestos(workId);
    let (a0, r0) = art30bis(s, null, n, asb);
    let none : Views.WorkFacts = { contractKnown = false; inheritedFrom = null; guarantee = null; priceRevision = null; art30bis = a0; checkinatwork = null; art30bisReason = r0; oaCount = n };
    let (c, from) = effectiveConfidential(works, d, workId) ?? return none;
    switch (c.contract) {
      case (#sealed _) { { none with contractKnown = true; inheritedFrom = from } };
      case (#plain k) {
        let over = func(limit : Nat) : ?Bool {
          switch (k.estimatedAmountCents) { case (?a) ?(a >= limit); case null null };
        };
        let (a, r) = art30bis(s, k.estimatedAmountCents, n, asb);
        {
          contractKnown = true;
          inheritedFrom = from;
          guarantee = ?(k.guarantee != #none and k.guaranteeBp > 0);
          priceRevision = ?(k.priceRevision != #none);
          art30bis = a;
          checkinatwork = over(thresholdCheckinatwork(s));
          art30bisReason = r;
          oaCount = n;
        };
      };
    };
  };

  // Welke velden van het contract veranderden (enkel namen: de waarden zijn vertrouwelijk en horen
  // nooit in de auditlog, die intern is).
  public func changedFields(old : ?Types.WorkConfidential, n : Types.WorkConfidential) : Text {
    let o = switch old { case (?x) x; case null return "nieuw" };
    var t = "";
    let add = func(name : Text) { t #= (if (t == "") "" else ", ") # name };
    switch (o.contract, n.contract) {
      case (#plain a, #plain b) {
        if (a.estimatedAmountCents != b.estimatedAmountCents) add("aanneemsom");
        if (a.priceRevision != b.priceRevision) add("prijsherziening");
        if (a.guarantee != b.guarantee or a.guaranteeBp != b.guaranteeBp) add("waarborg");
        if (a.paymentTermDays != b.paymentTermDays) add("betaaltermijn");
        if (a.invoicingRhythm != b.invoicingRhythm) add("facturatieritme");
        if (a.note != b.note) add("opmerking");
      };
      case _ add("contract");
    };
    if (o.clientContact != n.clientContact) add("contact klant");
    if (o.notes != n.notes) add("notities");
    if (t == "") "niets gewijzigd" else t;
  };

  public func plainOf<T>(c : Types.Confidential<T>) : ?T {
    switch c { case (#plain x) ?x; case (#sealed _) null };
  };

  public func isSealed<T>(c : Types.Confidential<T>) : Bool {
    switch c { case (#plain _) false; case (#sealed _) true };
  };

  // ── Documentsoorten (D9: data, niet code) ────────────────────────────────
  public func kindFromLookup(l : Types.Lookup) : Views.DocKindView {
    let get = func(k : Text, d : Text) : Text {
      switch (l.extra.find(func(x : (Text, Text)) : Bool = x.0 == k)) { case (?(_, v)) v; case null d };
    };
    {
      key = l.key;
      name = l.tag;
      rule = get("verplicht", "optioneel");
      deliverer = get("levert", "bowaco");
      oaVisible = get("oa", "nee") == "ja";
      confidential = get("vertrouwelijk", "nee") == "ja";
      order = l.order;
      archived = l.archivedAt != null;
    };
  };

  public func lookupFromKind(k : Views.DocKindView, archivedAt : ?Int) : Types.Lookup {
    {
      list = "docKind";
      key = k.key;
      tag = k.name;
      order = k.order;
      var archivedAt = archivedAt;
      extra = [("verplicht", k.rule), ("levert", k.deliverer), ("oa", if (k.oaVisible) "ja" else "nee"), ("vertrouwelijk", if (k.confidential) "ja" else "nee")];
    };
  };

  public func defaultKinds() : [Views.DocKindView] {
    var i = 0;
    Config.defaultDocKinds().map(
      func((key, name, rule, deliverer, oa, conf) : (Text, Text, Text, Text, Bool, Bool)) : Views.DocKindView {
        i += 1;
        { key; name; rule; deliverer; oaVisible = oa; confidential = conf; order = i * 10; archived = false };
      }
    );
  };

  func isKindKey(k : Text) : Bool { k.startsWith(#text "docKind:") };

  // De geldende lijst: wat de admin instelde, anders de standaardlijst (VOORLOPIG, A5). Gesorteerd.
  public func kinds(s : Types.SettingsState, withArchived : Bool) : [Views.DocKindView] {
    let own = s.lookups.entries().filter(func((k, _) : (Text, Types.Lookup)) : Bool = isKindKey(k)).map(func((_, l) : (Text, Types.Lookup)) : Views.DocKindView = kindFromLookup(l)).toArray();
    let all = if (own.size() == 0) defaultKinds() else own;
    all.filter(func k = withArchived or not k.archived).sort(func(a, b) = Nat.compare(a.order, b.order));
  };

  // Zet de standaardlijst in de keuzelijsten, zodat de admin ze daarna kan aanpassen.
  public func materialize(s : Types.SettingsState) {
    if (s.lookups.keys().any(isKindKey)) { return };
    for (k in defaultKinds().values()) { s.lookups.add("docKind:" # k.key, lookupFromKind(k, null)) };
  };

  public func kind(s : Types.SettingsState, key : Text) : ?Views.DocKindView {
    kinds(s, true).find(func k = k.key == key);
  };

  public func access(k : Views.DocKindView, ownerOrgId : ?Nat) : Rights.DocAccess {
    { deliverer = if (k.deliverer == "bowaco") null else Rights.roleFromKey(k.deliverer); oaVisible = k.oaVisible; confidential = k.confidential; ownerOrgId };
  };

  // Een document van een soort die intussen verdween (archief): alles intern en zo streng mogelijk.
  public func unknownKind(key : Text, confidential : Bool) : Views.DocKindView {
    { key; name = key; rule = "optioneel"; deliverer = "bowaco"; oaVisible = false; confidential; order = 9_999; archived = true };
  };

  public func docAccess(s : Types.SettingsState, doc : Types.Document) : Rights.DocAccess {
    let k = kind(s, doc.kind) ?? unknownKind(doc.kind, doc.confidential);
    // Een document blijft vertrouwelijk als het zo gemaakt werd, ook als de soort later wijzigt.
    { access(k, doc.ownerOrgId) with confidential = doc.confidential or k.confidential };
  };

  // ── Checklist ────────────────────────────────────────────────────────────
  public func today() : Nat { Int.abs(Time.now() / Config.day) };

  public func applies(s : Types.SettingsState, works : Types.WorksState, d : Types.DossierState, ext : Ext, w : Types.Work, rule : Text) : Views.Applies {
    func yn(b : Bool) : Views.Applies { if b #yes else #no };
    func opt(b : ?Bool) : Views.Applies { switch b { case (?x) yn(x); case null #unknown } };
    switch rule {
      case "altijd" #yes;
      case "btw6" yn(w.vatBp == 600);
      case "30bis" opt(facts(s, works, d, ext, w.id).art30bis);
      case "checkinatwork" opt(facts(s, works, d, ext, w.id).checkinatwork);
      case "vc" {
        let hasVc = works.memberships.values().any(func m = m.workId == w.id and m.endedAt == null and m.role == #veiligheidscoordinator);
        if hasVc #yes else #unknown;
      };
      case "oplevering" yn(w.status == #delivered or w.status == #aftercare);
      case _ #no;
    };
  };

  // Status zoals getoond: een ontvangen of goedgekeurd document met een verstreken geldigheid is verlopen.
  public func effectiveStatus(doc : Types.Document) : Types.DocStatus {
    switch (doc.validUntil, doc.status) {
      case (?until, #received or #approved) { if (until < today()) #expired else doc.status };
      case _ doc.status;
    };
  };

  func done(st : Types.DocStatus) : Bool {
    st == #received or st == #approved or st == #notApplicable;
  };

  public func docsOf(d : Types.DossierState, workId : Nat) : [Types.Document] {
    d.documents.values().filter(func x = x.workId == workId and x.archivedAt == null).toArray();
  };

  // Aantal verplichte soorten zonder ontvangen/goedgekeurd/n.v.t.-document (voor lijsten, intern).
  public func openCount(s : Types.SettingsState, works : Types.WorksState, d : Types.DossierState, ext : Ext, w : Types.Work) : Nat {
    let docs = docsOf(d, w.id);
    var n = 0;
    for (k in kinds(s, false).values()) {
      if (applies(s, works, d, ext, w, k.rule) == #yes) {
        let ok = docs.any(func x = x.kind == k.key and done(effectiveStatus(x)));
        if (not ok) { n += 1 };
      };
    };
    n;
  };

  // ── Views ────────────────────────────────────────────────────────────────
  public func workView(ctx : Ctx, d : Types.DossierState, ext : Ext, p : Types.Person, w : Types.Work) : Views.WorkView {
    let info = d.info.get(w.id);
    let internalFacts = Rights.may(ctx, p, #readWorkFacts, ?w.id);
    {
      id = w.id;
      code = w.code;
      name = w.name;
      address = w.address;
      parentId = w.parentId;
      clientOrgId = w.clientOrgId;
      architectOrgId = w.architectOrgId;
      leaderPersonId = w.leaderPersonId;
      status = w.status;
      vatBp = w.vatBp;
      createdAt = w.createdAt;
      createdBy = w.createdBy;
      archivedAt = w.archivedAt;
      plannedStart = w.plannedStart;
      plannedEnd = w.plannedEnd;
      // 1.9: de analytische code (boekhouding) en de btw-grond zijn kantoorgegevens: enkel interne rollen.
      analyticCode = if internalFacts (switch info { case (?i) i.analyticCode; case null null }) else null;
      vatNote = if internalFacts (switch info { case (?i) i.vatNote; case null "" }) else "";
      facts = if internalFacts ?facts(ctx.settings, ctx.works, d, ext, w.id) else null;
      checklistOpen = if internalFacts ?openCount(ctx.settings, ctx.works, d, ext, w) else null;
      caps = Rights.workCaps(ctx, p, w.id);
      extra = w.extra;
    };
  };

  public func fileView(f : Types.FileRef) : Views.FileView {
    {
      id = f.id;
      name = f.name;
      mime = f.mime;
      size = f.size;
      blob = if (f.confidential) null else ?f.blob;
      workId = f.workId;
      confidential = f.confidential;
      personId = f.personId;
      at = f.at;
      archivedAt = f.archivedAt;
    };
  };

  public func docView(ctx : Ctx, access : Types.AccessState, files : Types.FileState, p : Types.Person, doc : Types.Document) : Views.DocumentView {
    let k = kind(ctx.settings, doc.kind) ?? unknownKind(doc.kind, doc.confidential);
    {
      id = doc.id;
      workId = doc.workId;
      kind = doc.kind;
      kindLabel = k.name;
      title = doc.title;
      status = effectiveStatus(doc);
      dueDay = doc.dueDay;
      validUntil = doc.validUntil;
      note = doc.note;
      ownerOrgId = doc.ownerOrgId;
      confidential = doc.confidential;
      files = doc.fileIds.filterMap(func(id : Nat) : ?Views.FileView { switch (files.files.get(id)) { case (?f) { if (f.archivedAt == null) ?fileView(f) else null }; case null null } });
      updatedAt = doc.updatedAt;
      updatedByName = Access.personName(access, doc.updatedBy);
      canDeliver = Rights.mayDeliverDoc(ctx, p, doc.workId, docAccess(ctx.settings, doc));
    };
  };

  // Bestanden die aan een document hangen dat de beller niet mag zien (voor listFiles, R12).
  public func hiddenFileIds(ctx : Ctx, d : Types.DossierState, p : Types.Person, workId : Nat) : [Nat] {
    var out : [Nat] = [];
    for (doc in d.documents.values()) {
      if (doc.workId == workId and not Rights.mayReadDoc(ctx, p, workId, docAccess(ctx.settings, doc))) {
        out := out.concat(doc.fileIds);
      };
    };
    out;
  };
};
