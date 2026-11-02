// Verkoopfacturen (stap 2c.6, ontwerp 2c §4.6 en §7; ⚖1, ⚖6, ⚖7; AC-4, AC-6, AC-20, AC-21, AC-22, AC-27): de regels zonder
// toestand-wijzigingen, zodat de API (mixins/SalesApi.mo), de min-meerstaat (lib/MinMeer.mo: reeds gefactureerd) en de testen dezelfde
// regels gebruiken. Geen rechten hier (lib/Rights.mo). Rekenen: lib/SalesCalc.mo (= sales/calc.ts).
//   • Facturatieschema per werf: schijven in % op de aanneemsom van de getekende offerte (Progress.baseVersion), per hoofdstuk een
//     ander % mag; de korting op het totaal zit in de schijven (naar verhouding over de hoofdstukken); de laatste schijf neemt de rest.
//   • Een factuur komt uit een schijf, een vorderingsstaat (2.10, "klaar voor factuur"), een min-meerversie (slot: offerte + saldo −
//     reeds gefactureerd) of is vrij; een creditnota verwijst naar een uitgereikte factuur.
//   • Wat de boekhouder en de wet vragen (afzender, vermeldingen, btw-teksten, betaaltermijn, startnummer per reeks) staat in
//     settings.values "sales.*" (Beheer → Opmeting & facturatie → Facturen), nooit hard in de code: de standaardteksten hieronder zijn
//     VOORLOPIG (na te kijken door de boekhouder) en worden enkel gebruikt zolang de beheerder niets invulde.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import SV "../types/salesviews";
import Codes "Codes";
import Library "Library";
import Plan "Plan";
import Progress "Progress";
import QuoteDocs "QuoteDocs";
import Quotes "Quotes";
import SalesCalc "SalesCalc";
import Sha256 "mo:sha2/Sha256";

module {
  public type Ctx = {
    settings : Types.SettingsState;
    org : Types.OrgState;
    works : Types.WorksState;
    pc : Progress.Ctx;
    mm : Types.MinMeerState;
    sales : Types.SalesState;
  };

  // ── Instellingen (settings.values, D8: geen migratie) ─────────────────────
  public let vat6Default = "Btw-tarief: bij gebrek aan schriftelijke betwisting binnen een termijn van één maand vanaf de ontvangst van de factuur, wordt de klant geacht te erkennen dat (1) de werken worden verricht aan een woning waarvan de eerste ingebruikneming heeft plaatsgevonden in een kalenderjaar dat ten minste tien jaar voorafgaat aan de datum van de eerste factuur met betrekking tot die werken, (2) de woning, na uitvoering van die werken, uitsluitend of hoofdzakelijk als privéwoning wordt gebruikt en (3) de werken worden verstrekt en gefactureerd aan een eindverbruiker. Wanneer minstens één van die voorwaarden niet is voldaan, zal het normale btw-tarief van 21 % van toepassing zijn en is de afnemer ten aanzien van die voorwaarden aansprakelijk voor de betaling van de verschuldigde belasting, interesten en geldboeten.";
  public let reverseDefault = "Verlegging van heffing. Bij gebrek aan schriftelijke betwisting binnen een termijn van één maand vanaf de ontvangst van de factuur, wordt de afnemer geacht te erkennen dat hij een belastingplichtige is gehouden tot de indiening van periodieke aangiften. Indien die voorwaarde niet vervuld is, is de afnemer ten aanzien van die voorwaarde aansprakelijk voor de betaling van de verschuldigde belasting, interesten en geldboeten.";
  public let paymentDefault = "Gelieve bij de betaling de gestructureerde mededeling te gebruiken.";
  // Review M1: bij een creditnota aan een btw-plichtige (KB nr. 1 art. 4 §1); VOORLOPIG, na te kijken door de boekhouder.
  public let creditDefault = "Btw terug te storten aan de Staat in de mate waarin ze oorspronkelijk in aftrek werd gebracht.";
  public let reminderDefault = "Wij stellen vast dat deze factuur nog niet (volledig) betaald is. Wij vragen u vriendelijk het openstaande bedrag binnen 14 dagen te betalen. Deze herinnering is kosteloos. Is de betaling intussen gebeurd, dan mag u deze herinnering als niet verstuurd beschouwen.";

  public func text(s : Types.SettingsState, key : Text, dflt : Text) : Text {
    switch (s.values.get(key)) { case (?t) { if (t.trim(#char ' ').size() > 0) t else dflt }; case null dflt };
  };
  public func raw(s : Types.SettingsState, key : Text) : Text { switch (s.values.get(key)) { case (?t) t; case null "" } };
  public func natSetting(s : Types.SettingsState, key : Text, dflt : Nat, max : Nat) : Nat {
    switch (s.values.get(key)) { case (?t) { switch (Nat.fromText(t)) { case (?n) { if (n <= max) n else dflt }; case null dflt } }; case null dflt };
  };

  public let issuerKeys : [Text] = ["name", "legalForm", "street", "number", "zip", "city", "country", "vat", "kbo", "rpr", "email", "phone", "website", "iban", "bic"];

  public func issuer(s : Types.SettingsState) : Types.SalesIssuer {
    let g = func(k : Text) : Text = raw(s, "sales.issuer." # k).trim(#char ' ');
    {
      name = if (g("name") == "") QuoteDocs.issuer(s) else g("name");
      legalForm = g("legalForm");
      address = { street = g("street"); number = g("number"); zip = g("zip"); city = g("city"); country = if (g("country") == "") "BE" else g("country") };
      vat = g("vat");
      kbo = g("kbo");
      rpr = g("rpr");
      email = g("email");
      phone = g("phone");
      website = g("website");
      iban = g("iban");
      bic = g("bic");
    };
  };

  // Betaaltermijn in dagen (D4: standaard 15).
  public func paymentDays(s : Types.SettingsState) : Nat { natSetting(s, "sales.paymentDays", 15, 365) };
  public func vat6Text(s : Types.SettingsState) : Text { text(s, "sales.text.vat6", vat6Default) };
  public func reverseText(s : Types.SettingsState) : Text { text(s, "sales.text.reverse", reverseDefault) };
  public func paymentText(s : Types.SettingsState) : Text { text(s, "sales.text.payment", paymentDefault) };
  public func footerText(s : Types.SettingsState) : Text { raw(s, "sales.text.footer") };
  public func reminderText(s : Types.SettingsState) : Text { text(s, "sales.text.reminder", reminderDefault) };
  public func creditText(s : Types.SettingsState) : Text { text(s, "sales.text.credit", creditDefault) };
  // Een herinnering kan vanaf zoveel dagen na de vervaldag (standaard 0: de dag na de vervaldag).
  public func reminderDays(s : Types.SettingsState) : Nat { natSetting(s, "sales.reminderDays", 0, 365) };
  // ⚖6: "enkel de beheerder reikt uit" (standaard uit: beheerder en calculator).
  public func issuerOnly(s : Types.SettingsState) : Bool { s.values.get("sales.issuerOnly") == ?"ja" };
  // §7.1.4 (D18): de reeks van een nieuw jaar begint bij dit nummer als de beheerder geen laatste nummer zette.
  public func firstSeq(s : Types.SettingsState, series : Text) : Nat { natSetting(s, "sales.firstSeq." # series, if (series == "CN") 1 else 100, 99_999) };
  // Peppol: schema van het ondernemingsnummer (0208 = Belgisch KBO-nummer).
  public func peppolScheme(s : Types.SettingsState) : Text { text(s, "sales.peppolScheme", "0208") };

  // Het standaardschema (AC-4): "5000/2400/2600" = voorschot 50 % vóór de start · tussentijds 24 % · slot 26 % + saldo min-meer.
  public func planDefault(s : Types.SettingsState) : [Nat] {
    let parts = raw(s, "sales.plan").split(#char '/').toArray();
    let xs = parts.filterMap(func(t : Text) : ?Nat = Nat.fromText(t.trim(#char ' ')));
    var sum = 0;
    for (x in xs.values()) { sum += x };
    if (xs.size() == 3 and sum == 10_000) xs else [5_000, 2_400, 2_600];
  };

  public func seqKey(series : Text, year : Nat) : Text { "factuur:" # series # ":" # year.toText() };
  public func numberKey(series : Text, number : Text) : Text { series # ":" # number };
  public func seriesYear(series : Text, year : Nat) : Text { series # ":" # year.toText() };

  // ── Lezen ────────────────────────────────────────────────────────────────
  public func plain<T>(c : Types.Confidential<T>) : ?T { switch c { case (#plain x) ?x; case (#sealed _) null } };
  public func ids(m : Map.Map<Nat, [Nat]>, k : Nat) : [Nat] { switch (m.get(k)) { case (?x) x; case null [] } };
  public func addIdx(m : Map.Map<Nat, [Nat]>, k : Nat, id : Nat) { Quotes.addIndex(m, k, id) };
  public func hash(t : Text) : Text { Codes.hex(Sha256.fromBlob(#sha256, t.encodeUtf8())) };
  public func day(d : Nat) : Text { Plan.fmtDay(d) };
  public func euro(c : Int) : Text { Progress.euro(c) };

  public func invoicesOf(s : Types.SalesState, workId : Nat) : [Types.SalesInvoice] {
    ids(s.byWork, workId).filterMap(func(id : Nat) : ?Types.SalesInvoice = s.invoices.get(id));
  };
  public func frozenOf(s : Types.SalesState, id : Nat) : ?Types.SalesFrozen { switch (s.frozen.get(id)) { case (?c) plain(c); case null null } };
  public func draftLines(s : Types.SalesState, id : Nat) : [Types.SalesLine] { switch (s.drafts.get(id)) { case (?c) (plain(c) ?? []); case null [] } };
  // De regels van een factuur: vastgelegd (uitgereikt) of het ontwerp.
  public func linesOf(s : Types.SalesState, inv : Types.SalesInvoice) : [Types.SalesLine] {
    switch (frozenOf(s, inv.id)) { case (?f) f.lines; case null draftLines(s, inv.id) };
  };
  public func paymentsOf(s : Types.SalesState, id : Nat) : [Types.SalesPayment] {
    ids(s.paymentsByInvoice, id).filterMap(func(pid : Nat) : ?Types.SalesPayment = switch (s.payments.get(pid)) { case (?c) plain(c); case null null });
  };
  public func isIssued(i : Types.SalesInvoice) : Bool { i.status == #issued };
  public func isDraft(i : Types.SalesInvoice) : Bool { i.status == #draft };
  public func isCancelled(i : Types.SalesInvoice) : Bool { switch (i.status) { case (#draftCancelled _) true; case _ false } };
  public func creditOfId(i : Types.SalesInvoice) : ?Nat { switch (i.kind) { case (#credit x) ?x; case _ null } };
  public func creditsOf(s : Types.SalesState, inv : Types.SalesInvoice) : [Types.SalesInvoice] {
    invoicesOf(s, inv.workId).filter(func(x : Types.SalesInvoice) : Bool = creditOfId(x) == ?inv.id and not isCancelled(x));
  };

  // Bedragen van een uitgereikte factuur: totaal, gecrediteerd (uitgereikte creditnota's, positief), betaald, open.
  // Review M4: een inhouding als waarborg (uit de vorderingsstaat) blijft buiten "open": de factuur staat op het volle bedrag, maar
  // de inhouding is nog niet te betalen (geen vervallen bedrag, geen herinnering). dueCents = alles wat nog niet betaald is (incl. de
  // inhouding), openCents = wat nu te betalen is.
  public type Money = { totalCents : Int; creditedCents : Int; paidCents : Int; retentionCents : Int; dueCents : Int; openCents : Int };
  public func money(s : Types.SalesState, inv : Types.SalesInvoice) : Money {
    let total = switch (frozenOf(s, inv.id)) { case (?f) f.totalCents; case null 0 };
    let retention = switch (frozenOf(s, inv.id)) { case (?f) f.retentionCents; case null 0 };
    var credited : Int = 0;
    for (cn in creditsOf(s, inv).values()) { if (isIssued(cn)) { switch (frozenOf(s, cn.id)) { case (?f) credited -= f.totalCents; case null {} } } };
    var paid : Int = 0;
    for (p in paymentsOf(s, inv.id).values()) { if (p.archivedAt == null) { paid += p.cents } };
    let due = total - credited - paid;
    let held = if (due <= 0) 0 else if (retention < due) retention else due;
    { totalCents = total; creditedCents = credited; paidCents = paid; retentionCents = retention; dueCents = due; openCents = due - held };
  };
  // Betaalstatus: een creditnota vraagt geen betaling (#paid); een factuur is betaald als niets meer openstaat.
  public func payOf(s : Types.SalesState, inv : Types.SalesInvoice) : Types.SalesPay {
    if (creditOfId(inv) != null) { return #paid };
    let m = money(s, inv);
    if (m.dueCents <= 0) #paid else if (m.paidCents != 0 or m.creditedCents != 0 or m.openCents <= 0) #partial else #open;
  };
  // Volledig gecrediteerd: de uitgereikte creditnota's dekken het hele bedrag.
  public func fullyCredited(s : Types.SalesState, inv : Types.SalesInvoice) : Bool {
    let m = money(s, inv);
    m.totalCents != 0 and m.creditedCents == m.totalCents;
  };

  public func kindKey(k : Types.SalesKind) : Text {
    switch k { case (#advance) "voorschot"; case (#interim) "tussentijds"; case (#final) "slot"; case (#progress _) "vordering"; case (#minMeer _) "min-meer"; case (#free) "vrij"; case (#credit _) "creditnota" };
  };
  public func kindText(k : Types.SalesKind) : Text {
    switch k { case (#advance) "Voorschotfactuur"; case (#interim) "Tussentijdse factuur"; case (#final or #minMeer _) "Slotfactuur"; case (#progress _) "Factuur"; case (#free) "Factuur"; case (#credit _) "Creditnota" };
  };
  public func statusKey(s : Types.SalesStatus) : Text { switch s { case (#draft) "ontwerp"; case (#issued) "uitgereikt"; case (#draftCancelled _) "weggedaan" } };
  public func payKey(p : Types.SalesPay) : Text { switch p { case (#open) "open"; case (#partial) "deels"; case (#paid) "betaald" } };
  public func peppolKey(p : Types.SalesPeppol) : Text { switch p { case (#notNeeded) "niet-nodig"; case (#ublMade _) "ubl-gemaakt"; case (#sent _) "verstuurd" } };

  // ── De getekende offerte: hoofdstukken, korting, netto per hoofdstuk ──────
  // sentSubtotal = het subtotaal dat bij het versturen vastlag (QuoteSent); review L8: rekent de offerte nu anders, dan weigert de API.
  public type Base = { version : Types.QuoteVersion; qlabel : Text; chapters : [Text]; sells : [Int]; nets : [Int]; gross : Int; discount : Int; subtotal : Int; vatBp : Nat; sentSubtotal : ?Int };
  public func baseOk(b : Base) : Bool { switch (b.sentSubtotal) { case (?x) x == b.subtotal; case null true } };

  public func chapterText(ch : Types.QuoteChapter) : Text { (ch.code # " " # ch.title).trim(#char ' ') };

  public func base(c : Ctx, workId : Nat) : ?Base {
    let v = Progress.baseVersion(c.pc, workId) ?? return null;
    let comp = Quotes.compute(c.pc.qs, c.pc.qf, v, Library.standardMargin(c.settings));
    let t = comp.totals;
    let sells = t.chapters.map(func(x : { chapter : Nat; sell : Int; cost : Int; sellWithCost : Int; noPrice : Nat }) : Int = x.sell);
    let qlabel = switch (c.pc.qs.quotes.get(v.quoteId)) { case (?q) q.number # " v" # v.version.toText(); case null "?" };
    ?{ version = v; qlabel; chapters = comp.chapters.map(chapterText); sells; nets = SalesCalc.netChapters(sells, t.discount); gross = t.gross; discount = t.discount; subtotal = t.subtotal; vatBp = v.vatBp; sentSubtotal = switch (v.sent) { case (?x) ?x.subtotalCents; case null null } };
  };

  // ── Het facturatieschema ─────────────────────────────────────────────────
  public func defaultPlan(s : Types.SettingsState, workId : Nat) : Types.BillingPlan {
    let p = planDefault(s);
    let step = func(key : Text, title : Text, bp : Nat, w : Types.BillingWhen) : Types.BillingStep = { key; title; pctBp = bp; when = w; chapterPct = []; quoteIds = [] };
    { workId; steps = [step("voorschot", "Voorschot", p[0], #beforeStart), step("tussentijds", "Tussentijds", p[1], #byHand), step("slot", "Slot", p[2], #final)]; version = 0; updatedAt = 0; updatedBy = 0; extra = [] };
  };
  public func planOf(c : Ctx, workId : Nat) : Types.BillingPlan {
    switch (c.sales.plans.get(workId)) { case (?p) p; case null defaultPlan(c.settings, workId) };
  };
  // Het % van een schijf voor een hoofdstuk: een eigen % voor dat hoofdstuk, anders het % van de schijf.
  public func pctFor(st : Types.BillingStep, chapter : Text) : Nat {
    switch (st.chapterPct.find(func(x : Types.BillingChapterPct) : Bool = x.chapter == chapter)) { case (?x) x.pctBp; case null st.pctBp };
  };
  public func pctMatrix(p : Types.BillingPlan, chapters : [Text]) : [[Nat]] {
    p.steps.map(func(st : Types.BillingStep) : [Nat] = chapters.map(func(ch : Text) : Nat = pctFor(st, ch)));
  };
  // Fout in een schema: per hoofdstuk samen exact 100 %, sleutels uniek, hoogstens één slot en dan als laatste.
  public func planError(steps : [Types.BillingStep], chapters : [Text]) : ?Text {
    if (steps.size() == 0 or steps.size() > 8) { return ?"Een schema heeft 1 tot 8 schijven" };
    for ((i, st) in steps.enumerate()) {
      let k = st.key.trim(#char ' ');
      if (k.size() == 0 or k.size() > 30 or not k.chars().all(func(ch : Char) : Bool = (ch >= 'a' and ch <= 'z') or (ch >= '0' and ch <= '9') or ch == '-')) { return ?"Sleutel van een schijf: 1 tot 30 kleine letters, cijfers of -" };
      if (steps.filter(func(x : Types.BillingStep) : Bool = x.key == st.key).size() > 1) { return ?("Sleutel " # st.key # " staat er twee keer") };
      let t = st.title.trim(#char ' ');
      if (t.size() == 0 or t.size() > 80) { return ?"Naam van een schijf: 1 tot 80 tekens" };
      if (st.pctBp > 10_000) { return ?("Schijf " # t # ": hoogstens 100 %") };
      for (x in st.chapterPct.values()) { if (x.pctBp > 10_000) { return ?("Schijf " # t # ", " # x.chapter # ": hoogstens 100 %") } };
      if (st.when == #final and i + 1 != steps.size()) { return ?"De slotschijf is de laatste schijf" };
      switch (st.when) { case (#onDay d) { if (d == 0) { return ?"Kies een dag" } }; case _ {} };
    };
    if (steps.filter(func(x : Types.BillingStep) : Bool = x.when == #final).size() > 1) { return ?"Hoogstens één slotschijf" };
    var sum = 0;
    for (st in steps.values()) { sum += st.pctBp };
    if (sum != 10_000) { return ?("De schijven zijn samen " # pctText(sum) # " in plaats van 100 %") };
    for (ch in chapters.values()) {
      var s = 0;
      for (st in steps.values()) { s += pctFor(st, ch) };
      if (s != 10_000) { return ?("Hoofdstuk " # ch # ": de schijven zijn samen " # pctText(s) # " in plaats van 100 %") };
    };
    null;
  };
  public func pctText(bp : Nat) : Text {
    let w = bp / 100;
    let r = bp % 100;
    w.toText() # (if (r == 0) "" else "," # (if (r < 10) "0" else "") # (if (r % 10 == 0) (r / 10).toText() else r.toText())) # " %";
  };

  // De bedragen per schijf en per hoofdstuk (rij = schijf).
  public func stepAmounts(b : Base, p : Types.BillingPlan) : [[Int]] { SalesCalc.stepAmounts(b.nets, pctMatrix(p, b.chapters)) };

  public func stepKind(st : Types.BillingStep, idx : Nat) : Types.SalesKind {
    switch (st.when) { case (#beforeStart) #advance; case (#final) #final; case _ { if (idx == 0) #advance else #interim } };
  };

  // De regels van een schijf: per hoofdstuk het netto van de offerte × het % (de laatste schijf neemt de rest).
  public func stepLines(b : Base, p : Types.BillingPlan, key : Text, vatBp : Nat) : ?[Types.SalesLine] {
    var idx : ?Nat = null;
    for ((i, st) in p.steps.enumerate()) { if (st.key == key) { idx := ?i } };
    let si = idx ?? return null;
    let st = p.steps[si];
    let am = stepAmounts(b, p)[si];
    let out = List.empty<Types.SalesLine>();
    for (ci in b.chapters.keys()) {
      if (am[ci] != 0) {
        let ch = b.chapters[ci];
        let bp = pctFor(st, ch);
        let off = if (b.discount != 0) "offerte " # b.qlabel # " na korting" else "offerte " # b.qlabel;
        out.add({ kind = #work; group = ch; description = st.title # " " # pctText(bp) # " op " # off; ref = "schijf:" # st.key # ":" # ci.toText(); qtyMilli = 1000; unit = "ff"; unitCents = am[ci]; amountCents = am[ci]; vatBp; baseCents = ?b.nets[ci]; pctBp = ?bp });
      };
    };
    ?out.toArray();
  };

  // De regels uit een verzonden vorderingsstaat: het bedrag van de periode per post (werk) en de prijsherziening apart.
  public func progressLines(st : Types.ProgressStatement, fr : Types.ProgressFrozen, vatBp : Nat) : [Types.SalesLine] {
    let out = List.empty<Types.SalesLine>();
    for (l in fr.lines.values()) {
      if (l.periodCents != 0) {
        let title = (if (l.code == "") "" else l.code # " ") # l.title;
        let dq = l.cumQtyMilli - l.prevQtyMilli;
        let exact = l.basis != #percent and dq != 0 and SalesCalc.lineAmount(dq, l.unitPriceCents) == l.periodCents;
        let desc = title # (if (l.basis == #percent) " (" # pctText(l.cumPctBp) # " uitgevoerd)" else "");
        out.add({ kind = #work; group = l.chapter; description = desc; ref = "vordering:" # st.id.toText() # ":" # l.root.toText(); qtyMilli = if exact dq else 1000; unit = if exact l.unit else "ff"; unitCents = if exact l.unitPriceCents else l.periodCents; amountCents = l.periodCents; vatBp; baseCents = ?l.offerCents; pctBp = if (l.basis == #percent) ?l.cumPctBp else null });
      };
    };
    if (fr.totals.revisionCents != 0) {
      out.add({ kind = #revision; group = "Prijsherziening"; description = "Prijsherziening " # st.code; ref = "herziening:" # st.id.toText(); qtyMilli = 1000; unit = "ff"; unitCents = fr.totals.revisionCents; amountCents = fr.totals.revisionCents; vatBp; baseCents = ?fr.totals.revisionBaseCents; pctBp = null });
    };
    out.toArray();
  };

  // De slotfactuur uit een min-meerversie: per hoofdstuk offerte + minwerk + meerwerk, dan de aftrek van wat al gefactureerd is
  // (zonder prijsherziening): samen = nog te factureren van die versie.
  public func minMeerLines(v : Types.MmVersion, fr : Types.MmFrozen, vatBp : Nat) : [Types.SalesLine] {
    let out = List.empty<Types.SalesLine>();
    for ((i, ch) in fr.chapters.enumerate()) {
      let a = ch.offerCents + ch.lessCents + ch.extraCents;
      if (a != 0) {
        let g = if (ch.chapter == "") "Algemeen" else ch.chapter;
        out.add({ kind = #work; group = g; description = "Offerte " # euro(ch.offerCents) # ", minwerk " # euro(ch.lessCents) # ", meerwerk " # euro(ch.extraCents) # " (min-meerstaat versie " # fr.number.toText() # ")"; ref = "minmeer:" # v.id.toText() # ":" # i.toText(); qtyMilli = 1000; unit = "ff"; unitCents = a; amountCents = a; vatBp; baseCents = ?ch.offerCents; pctBp = null });
      };
    };
    for ((i, x) in fr.invoiced.enumerate()) {
      if (x.cents != 0) {
        out.add({ kind = #deduct; group = "Reeds gefactureerd"; description = "Reeds gefactureerd: " # x.title # " van " # day(x.day); ref = "aftrek:" # v.id.toText() # ":" # i.toText(); qtyMilli = 1000; unit = "ff"; unitCents = -x.cents; amountCents = -x.cents; vatBp; baseCents = null; pctBp = null });
      };
    };
    out.toArray();
  };

  // Een volledige creditnota: dezelfde regels met het omgekeerde teken.
  public func negate(lines : [Types.SalesLine]) : [Types.SalesLine] {
    lines.map(func(l : Types.SalesLine) : Types.SalesLine = { l with qtyMilli = -l.qtyMilli; amountCents = -l.amountCents; ref = "credit:" # l.ref });
  };

  public func reverseOf(v : Types.SalesVat) : Bool { v == #reverse };
  public func totalsOf(lines : [Types.SalesLine], vat : Types.SalesVat) : SalesCalc.Totals {
    SalesCalc.totals(lines.map(func(l : Types.SalesLine) : SalesCalc.VatIn = { amountCents = l.amountCents; vatBp = l.vatBp }), reverseOf(vat));
  };
  // De btw van een regel volgens de keuze van de factuur (#rate = elke regel dat tarief; verlegd = 0; #mixed = per regel).
  public func applyVat(lines : [Types.SalesLine], vat : Types.SalesVat) : [Types.SalesLine] {
    switch vat { case (#rate r) lines.map(func(l : Types.SalesLine) : Types.SalesLine = { l with vatBp = r }); case (#reverse) lines.map(func(l : Types.SalesLine) : Types.SalesLine = { l with vatBp = 0 }); case (#mixed) lines };
  };
  public func vatKey(v : Types.SalesVat) : Text { switch v { case (#rate r) r.toText(); case (#reverse) "verlegd"; case (#mixed) "gemengd" } };

  // ── Reeds gefactureerd voor de min-meerstaat (2c.5 sluit hier aan) ────────
  // Elke UITGEREIKTE factuur en creditnota van de werf: werk (regels #work en #deduct) en prijsherziening (#revision) apart. Een
  // vorderingsstaat waarvoor een uitgereikte factuur bestaat die niet volledig gecrediteerd is, telt via die factuur (niet dubbel).
  public func invoicedItems(s : Types.SalesState, workId : Nat) : ([Types.MmInvoiced], [Nat]) {
    let out = List.empty<Types.MmInvoiced>();
    let covered = List.empty<Nat>();
    for (inv in invoicesOf(s, workId).values()) {
      if (isIssued(inv)) {
        switch (frozenOf(s, inv.id)) {
          case (?f) {
            var w : Int = 0;
            var r : Int = 0;
            for (l in f.lines.values()) { if (l.kind == #revision) { r += l.amountCents } else { w += l.amountCents } };
            out.add({ title = (if (creditOfId(inv) != null) "creditnota " else "factuur ") # inv.number; day = f.issueDay; cents = w; revisionCents = r });
          };
          case null {};
        };
        switch (inv.kind) { case (#progress sid) { if (not fullyCredited(s, inv)) { covered.add(sid) } }; case _ {} };
      };
    };
    (out.toArray(), covered.toArray());
  };

  // ── Nummers van ondernemingen (review M3/L3) ──────────────────────────────
  public func digitsOf(t : Text) : Text { Text.fromIter(t.chars().filter(func(ch : Char) : Bool = ch >= '0' and ch <= '9')) };
  public func compact(t : Text) : Text { Text.fromIter(t.chars().filter(func(ch : Char) : Bool = ch != ' ' and ch != '.' and ch != '-')).toUpper() };
  // Belgisch ondernemingsnummer: 10 cijfers, de laatste twee = 97 − (de eerste acht mod 97).
  public func kboOk(t : Text) : Bool {
    let d = digitsOf(t);
    if (d.size() != 10) { return false };
    let n = switch (Nat.fromText(d)) { case (?x) x; case null return false };
    (97 - (n / 100) % 97 : Nat) == n % 100;
  };
  public func isBeVat(v : Text) : Bool { compact(v).startsWith(#text "BE") };
  public func beVatOk(v : Text) : Bool { let c = compact(v); c.startsWith(#text "BE") and digitsOf(c).size() == 10 and c.size() == 12 and kboOk(c) };

  // ── Wat bij het uitreiken vastligt (§7.2) ─────────────────────────────────
  public func buyerOf(c : Ctx, orgId : ?Nat) : Types.SalesBuyer {
    switch orgId {
      case (?id) {
        switch (c.org.orgs.get(id)) {
          case (?o) {
            let vat = switch (o.vat) { case (?v) { if (v.trim(#char ' ').size() > 0) ?v.trim(#char ' ') else null }; case null null };
            // Review M3: "bedrijf" (UBL, btw verlegd) enkel met een Belgisch btw-nummer; een buitenlands nummer blokkeert (findings).
            { orgId = ?id; name = o.name; address = o.address; vat; kbo = o.kbo; company = switch vat { case (?v) isBeVat(v); case null false } };
          };
          case null { { orgId = ?id; name = ""; address = null; vat = null; kbo = null; company = false } };
        };
      };
      case null { { orgId = null; name = ""; address = null; vat = null; kbo = null; company = false } };
    };
  };

  public func previousOf(s : Types.SalesState, inv : Types.SalesInvoice) : [Types.SalesPrevious] {
    let out = List.empty<Types.SalesPrevious>();
    for (x in invoicesOf(s, inv.workId).values()) {
      if (x.id != inv.id and isIssued(x)) {
        switch (frozenOf(s, x.id)) {
          case (?f) {
            var w : Int = 0;
            var r : Int = 0;
            for (l in f.lines.values()) { if (l.kind == #revision) { r += l.amountCents } else { w += l.amountCents } };
            out.add({ invoiceId = x.id; number = x.number; day = f.issueDay; cents = w; revisionCents = r });
          };
          case null {};
        };
      };
    };
    out.toArray();
  };

  public func uses6(lines : [Types.SalesLine], vat : Types.SalesVat) : Bool { vat != #reverse and lines.any(func(l : Types.SalesLine) : Bool = l.vatBp == 600) };

  public func freeze(c : Ctx, inv : Types.SalesInvoice, lines0 : [Types.SalesLine], number : Text, seq : Nat, issueDay : Nat) : Types.SalesFrozen {
    let lines = applyVat(lines0, inv.vat);
    let t = totalsOf(lines, inv.vat);
    let w = c.works.works.get(inv.workId);
    let mentions = List.empty<Text>();
    let (creditOf, creditOfDay) : (?Text, ?Nat) = switch (creditOfId(inv)) {
      case (?o) { switch (c.sales.invoices.get(o)) { case (?x) { mentions.add("Creditnota bij factuur " # x.number # (switch (x.issueDay) { case (?d) " van " # day(d); case null "" }) # "."); (?x.number, x.issueDay) }; case null (null, null) } };
      case null (null, null);
    };
    // Review L4: de koper van een creditnota is die van de vastgelegde factuur (niet de firmafiche van vandaag).
    let buyer = switch (creditOfId(inv)) { case (?o) { switch (frozenOf(c.sales, o)) { case (?of) of.buyer; case null buyerOf(c, inv.clientOrgId) } }; case null buyerOf(c, inv.clientOrgId) };
    // Review M4: de inhouding als waarborg van de vorderingsstaat: de factuur blijft op het volle bedrag (ook de btw), de vermelding
    // zegt hoeveel ingehouden wordt; "open" laat ze buiten (money).
    let retention : Int = switch (inv.kind) {
      case (#progress sid) { switch (c.pc.ps.statements.get(sid), Progress.frozenOf(c.pc.ps, sid)) { case (?st, ?pf) { if (pf.totals.retentionCents > 0) { mentions.add("Waarvan " # euro(pf.totals.retentionCents) # " ingehouden als waarborg tot de oplevering (vorderingsstaat " # st.code # "); nu te betalen " # euro(t.totalCents - pf.totals.retentionCents) # ".") }; pf.totals.retentionCents }; case _ 0 } };
      case _ 0;
    };
    if (uses6(lines, inv.vat)) { mentions.add(vat6Text(c.settings)) };
    if (reverseOf(inv.vat)) { mentions.add(reverseText(c.settings)) };
    // Review M1: bij een creditnota aan een btw-plichtige de vermelding over de btw die terug te storten is.
    if (creditOf != null and buyer.company) { mentions.add(creditText(c.settings)) };
    if (creditOf == null) { mentions.add(paymentText(c.settings)) };
    if (footerText(c.settings).trim(#char ' ').size() > 0) { mentions.add(footerText(c.settings)) };
    let quoteRefs = switch (base(c, inv.workId)) { case (?b) [b.qlabel]; case null [] };
    {
      invoiceId = inv.id;
      number;
      kindText = kindText(inv.kind);
      issueDay;
      serviceDay = inv.serviceDay;
      serviceTo = inv.serviceTo;
      dueDay = if (creditOf != null) issueDay else issueDay + inv.paymentDays;
      paymentDays = if (creditOf != null) 0 else inv.paymentDays;
      issuer = issuer(c.settings);
      buyer;
      workCode = switch w { case (?x) x.code; case null "" };
      workName = switch w { case (?x) x.name; case null "" };
      workAddress = switch w { case (?x) x.address; case null { { street = ""; number = ""; zip = ""; city = ""; country = "" } } };
      analyticCode = switch w { case (?x) x.code; case null "" };
      quoteRefs;
      title = inv.title;
      lines;
      // Review L6: geen blok "reeds gefactureerd" op een creditnota.
      previous = if (creditOf != null) [] else previousOf(c.sales, inv);
      vatLines = t.vatLines;
      netCents = t.netCents;
      vatCents = t.vatCents;
      totalCents = t.totalCents;
      retentionCents = retention;
      mentions = mentions.toArray();
      paymentRef = if (seq == 0 or creditOf != null) "" else SalesCalc.paymentRef(if (inv.series == "CN") 2 else 1, Quotes.yearOf(issueDay), seq);
      creditOf;
      creditOfDay;
      note = inv.note;
      calcVersion = SalesCalc.version;
      extra = [];
    };
  };

  // ── Controle vóór het uitreiken (§7.2 en §4.6) ───────────────────────────
  public type Finding = { key : Text; text : Text; block : Bool };
  func blank(t : Text) : Bool { t.trim(#char ' ').size() == 0 };
  func addrOk(a : ?Types.Address) : Bool { switch a { case (?x) not blank(x.street) and not blank(x.zip) and not blank(x.city); case null false } };

  public func findings(c : Ctx, inv : Types.SalesInvoice, fr : Types.SalesFrozen, today : Nat) : [Finding] {
    let out = List.empty<Finding>();
    let block = func(k : Text, t : Text) { out.add({ key = k; text = t; block = true }) };
    let warn = func(k : Text, t : Text) { out.add({ key = k; text = t; block = false }) };
    let i = fr.issuer;
    let where = " (Beheer → Opmeting & facturatie → Facturen)";
    if (blank(i.name)) block("afzender-naam", "Naam van BOWACO ontbreekt" # where);
    if (blank(i.legalForm)) block("afzender-rechtsvorm", "Rechtsvorm ontbreekt" # where);
    if (not addrOk(?i.address)) block("afzender-adres", "Adres van de zetel ontbreekt" # where);
    if (blank(i.vat)) block("afzender-btw", "Btw-nummer van BOWACO ontbreekt" # where);
    if (blank(i.kbo)) block("afzender-kbo", "Ondernemingsnummer ontbreekt" # where);
    if (blank(i.rpr)) block("afzender-rpr", "RPR en ondernemingsrechtbank ontbreken" # where);
    if (blank(i.iban)) block("afzender-rekening", "Rekeningnummer ontbreekt" # where);
    // Review L1: e-mail en website (vennootschapswetboek) zoals de andere vermeldingen; review M3/L3: nummers nagekeken (mod 97).
    if (blank(i.email)) block("afzender-email", "E-mailadres van BOWACO ontbreekt" # where);
    if (blank(i.website)) block("afzender-website", "Website van BOWACO ontbreekt" # where);
    if (not blank(i.kbo) and not kboOk(i.kbo)) block("afzender-kbo-fout", "Ondernemingsnummer van BOWACO klopt niet (10 cijfers, controlegetal)" # where);
    if (not blank(i.vat) and not beVatOk(i.vat)) block("afzender-btw-fout", "Btw-nummer van BOWACO klopt niet (BE + 10 cijfers, controlegetal)" # where);
    let b = fr.buyer;
    if (b.orgId == null) { block("klant", "De werf heeft geen klant: kies de klant op de werffiche") } else {
      if (blank(b.name)) block("klant-naam", "Naam van de klant ontbreekt");
      if (not addrOk(b.address)) block("klant-adres", "Adres van de klant ontbreekt (firmafiche: straat, postcode, gemeente)");
      // Review M3: een buitenlandse klant (btw-nummer zonder BE) valt buiten deze regels (intracommunautair, geen binnenlandse verlegging).
      switch (b.vat) {
        case (?v) {
          if (not isBeVat(v)) { block("klant-buitenland", "Buitenlandse klant: vraag de boekhouder (geen binnenlandse verlegging)") }
          else if (not beVatOk(v)) { block("klant-btw-fout", "Btw-nummer van de klant klopt niet (BE + 10 cijfers, controlegetal; firmafiche)") };
        };
        case null {};
      };
      switch (b.kbo) { case (?k) { if (not blank(k) and not kboOk(k)) block("klant-kbo-fout", "Ondernemingsnummer van de klant klopt niet (firmafiche)") }; case null {} };
    };
    switch (inv.vat) {
      case (#rate r) { if (r != 600 and r != 2100) block("btw-tarief", "Btw-tarief: 6 % of 21 %, of btw verlegd") };
      case (#reverse) { if (not b.company) block("klant-btw", "Btw verlegd vraagt het btw-nummer van de klant (firmafiche)") };
      case (#mixed) { if (fr.lines.any(func(l : Types.SalesLine) : Bool = l.vatBp != 600 and l.vatBp != 2100)) block("btw-tarief", "Elke regel 6 % of 21 %") };
    };
    if (uses6(fr.lines, inv.vat) and blank(vat6Text(c.settings))) block("btw-6-tekst", "De vermelding bij 6 % ontbreekt" # where);
    if (reverseOf(inv.vat) and blank(reverseText(c.settings))) block("btw-verlegd-tekst", "De vermelding bij btw verlegd ontbreekt" # where);
    if (creditOfId(inv) != null and b.company and blank(creditText(c.settings))) block("credit-tekst", "De vermelding bij een creditnota (terug te storten btw) ontbreekt" # where);
    if (fr.retentionCents != 0) warn("waarborg", "Inhouding waarborg " # euro(fr.retentionCents) # ": de factuur staat op het volle bedrag (ook de btw), de inhouding blijft buiten 'open' tot ze vrijkomt (nakijken)");
    if (fr.lines.size() == 0) block("regels", "De factuur heeft geen regels");
    if (fr.netCents == 0) block("nul", "Het bedrag is € 0,00");
    let credit = creditOfId(inv);
    if (credit == null and fr.netCents < 0) block("negatief", "Een factuur is niet negatief: maak een creditnota");
    if (credit != null and fr.netCents >= 0) block("credit-positief", "Een creditnota is negatief");
    if (credit == null and inv.paymentDays == 0) block("betaaltermijn", "Betaaltermijn ontbreekt");
    if (blank(fr.workCode) or not addrOk(?fr.workAddress)) block("werf", "Werfcode of werfadres ontbreekt (werffiche)");
    switch (c.sales.lastDay.get(seriesYear(inv.series, Quotes.yearOf(today)))) { case (?d) { if (d > today) block("datum", "De vorige factuur van deze reeks is van " # day(d) # ": de datum mag niet vroeger zijn") }; case null {} };
    switch (inv.planStepKey) {
      case (?k) {
        if (invoicesOf(c.sales, inv.workId).any(func(x : Types.SalesInvoice) : Bool = x.id != inv.id and x.planStepKey == ?k and isIssued(x) and creditOfId(x) == null and not fullyCredited(c.sales, x))) block("schijf-dubbel", "Voor deze schijf bestaat al een uitgereikte factuur (eerst crediteren)");
      };
      case null {};
    };
    switch (inv.kind) {
      case (#progress sid) {
        switch (c.pc.ps.statements.get(sid)) {
          case (?st) {
            if (st.status != #sent or st.kind != #statement or st.creditedBy != null) block("vordering", "De vorderingsstaat is niet (meer) verzonden of werd gecrediteerd")
            else switch (st.billing) { case (#ready _) {}; case _ block("vordering", "De vorderingsstaat staat niet op 'klaar voor factuur' of werd al gefactureerd") };
          };
          case null block("vordering", "Onbekende vorderingsstaat");
        };
      };
      case (#credit o) {
        switch (c.sales.invoices.get(o)) {
          case (?x) {
            if (not isIssued(x) or creditOfId(x) != null) { block("credit-bron", "Enkel een uitgereikte factuur wordt gecrediteerd") } else {
              let m = money(c.sales, x);
              if (m.creditedCents - fr.totalCents > m.totalCents) block("credit-te-veel", "Samen meer gecrediteerd (" # euro(m.creditedCents - fr.totalCents) # ") dan de factuur (" # euro(m.totalCents) # ")");
            };
          };
          case null block("credit-bron", "Onbekende factuur");
        };
      };
      case _ {};
    };
    switch (inv.vat, c.works.works.get(inv.workId)) {
      case (#rate r, ?w) { if (w.vatBp != r) warn("btw-werf", "Ander btw-tarief dan de werf (" # pctText(w.vatBp) # ")") };
      case _ {};
    };
    if (b.company and uses6(fr.lines, inv.vat)) warn("btw-6-bedrijf", "6 % aan een klant met btw-nummer: nakijken (schadedossier, AC-27)");
    out.toArray();
  };
  public func blocks(fs : [Finding]) : [Finding] { fs.filter(func(f : Finding) : Bool = f.block) };
  public func describe(fs : [Finding]) : Text { Text.join(fs.map(func(f : Finding) : Text = f.text).values(), "; ") };

  // ── Nummering (§7.1) ─────────────────────────────────────────────────────
  // Het laatst gebruikte nummer van een reeks in een jaar (settings.sequences); zonder teller: het startnummer − 1.
  public func lastSeq(s : Types.SettingsState, series : Text, year : Nat) : Nat {
    switch (s.sequences.get(seqKey(series, year))) { case (?n) n; case null { let f = firstSeq(s, series); if (f == 0) 0 else f - 1 } };
  };
  // Heeft de app al een nummer van deze reeks in dit jaar uitgereikt? (Dan ligt de teller vast, §7.1.4.)
  public func seriesUsed(sales : Types.SalesState, series : Text, year : Nat) : Bool { sales.lastDay.containsKey(seriesYear(series, year)) };

  // ── Controlecode (G5) ────────────────────────────────────────────────────
  func f(t : Text) : Text { t.size().toText() # ":" # t # ";" };
  func fi(i : Int) : Text { f(Int.toText(i)) };
  func fo(i : ?Nat) : Text { switch i { case (?x) fi(x); case null f("-") } };
  func ft(t : ?Text) : Text { switch t { case (?x) f(x); case null f("-") } };
  func fa(a : ?Types.Address) : Text { switch a { case (?x) f(x.street) # f(x.number) # f(x.zip) # f(x.city) # f(x.country); case null f("-") } };
  func lineKey(k : Types.SalesLineKind) : Text { switch k { case (#work) "werk"; case (#revision) "herziening"; case (#deduct) "aftrek" } };

  public func canonical(inv : Types.SalesInvoice, fr : Types.SalesFrozen) : Text {
    var out = "bowaco-factuur-v1;" # fi(inv.id) # fi(inv.workId) # f(kindKey(inv.kind)) # (switch (inv.kind) { case (#progress x or #minMeer x or #credit x) fi(x); case _ f("-") }) # f(inv.series) # fi(inv.year) # fi(inv.seq) # f(inv.number) # ft(inv.planStepKey) # f(vatKey(inv.vat)) # fo(inv.clientOrgId) # fi(inv.calcVersion);
    let i = fr.issuer;
    out #= "A;" # f(i.name) # f(i.legalForm) # fa(?i.address) # f(i.vat) # f(i.kbo) # f(i.rpr) # f(i.email) # f(i.phone) # f(i.website) # f(i.iban) # f(i.bic);
    let b = fr.buyer;
    out #= "K;" # fo(b.orgId) # f(b.name) # fa(b.address) # ft(b.vat) # ft(b.kbo) # f(if (b.company) "bedrijf" else "particulier");
    out #= "D;" # f(fr.number) # f(fr.kindText) # fi(fr.issueDay) # fo(fr.serviceDay) # fo(fr.serviceTo) # fi(fr.dueDay) # fi(fr.paymentDays) # f(fr.workCode) # f(fr.workName) # fa(?fr.workAddress) # f(fr.analyticCode) # f(Text.join(fr.quoteRefs.values(), ",")) # f(fr.title) # f(fr.paymentRef) # ft(fr.creditOf) # fo(fr.creditOfDay) # f(fr.note) # fi(fr.calcVersion);
    for (l in fr.lines.values()) {
      out #= "L;" # f(lineKey(l.kind)) # f(l.group) # f(l.description) # f(l.ref) # fi(l.qtyMilli) # f(l.unit) # fi(l.unitCents) # fi(l.amountCents) # fi(l.vatBp) # (switch (l.baseCents) { case (?x) fi(x); case null f("-") }) # fo(l.pctBp);
    };
    for (p in fr.previous.values()) { out #= "P;" # fi(p.invoiceId) # f(p.number) # fi(p.day) # fi(p.cents) # fi(p.revisionCents) };
    for (v in fr.vatLines.values()) { out #= "B;" # fi(v.vatBp) # f(if (v.reverse) "verlegd" else "-") # fi(v.baseCents) # fi(v.vatCents) };
    for (m in fr.mentions.values()) { out #= "M;" # f(m) };
    out # "T;" # fi(fr.netCents) # fi(fr.vatCents) # fi(fr.totalCents) # fi(fr.retentionCents);
  };

  public func intact(s : Types.SalesState, inv : Types.SalesInvoice) : Bool {
    if (not isIssued(inv)) { return true };
    switch (frozenOf(s, inv.id)) { case (?fr) hash(canonical(inv, fr)) == inv.hash; case null false };
  };

  // ── Views ────────────────────────────────────────────────────────────────
  public func overdue(s : Types.SalesState, inv : Types.SalesInvoice, today : Nat) : Bool {
    if (not isIssued(inv) or creditOfId(inv) != null) { return false };
    switch (inv.dueDay) { case (?d) d < today and money(s, inv).openCents > 0; case null false };
  };
  public func brief(c : Ctx, inv : Types.SalesInvoice, today : Nat) : SV.SalesBrief {
    let creditOfTxt = switch (creditOfId(inv)) { case (?o) { switch (c.sales.invoices.get(o)) { case (?x) x.number; case null "" } }; case null "" };
    {
      id = inv.id;
      workId = inv.workId;
      workCode = switch (c.works.works.get(inv.workId)) { case (?w) w.code; case null "" };
      kind = kindKey(inv.kind);
      kindTitle = kindText(inv.kind);
      title = inv.title;
      number = inv.number;
      status = statusKey(inv.status);
      pay = if (not isIssued(inv)) "" else if (creditOfId(inv) == null and fullyCredited(c.sales, inv)) "gecrediteerd" else payKey(payOf(c.sales, inv));
      issueDay = inv.issueDay;
      dueDay = inv.dueDay;
      overdue = overdue(c.sales, inv, today);
      sent = inv.sent != null;
      planStepKey = inv.planStepKey;
      creditOf = creditOfTxt;
      credits = creditsOf(c.sales, inv).filter(isIssued).map(func(x : Types.SalesInvoice) : Text = x.number);
      reminders = c.sales.reminders.values().filter(func(r : Types.SalesReminder) : Bool = r.invoiceId == inv.id).size();
      peppol = peppolKey(inv.peppol);
      company = buyerOf(c, inv.clientOrgId).company;
      rev = inv.rev;
    };
  };

  // Na een herstel: de indexen opnieuw (byWork, betalingen per factuur, nummers, laatste dag per reeks).
  // Review L7: geeft de nummers terug die meer dan één uitgereikte factuur dragen (mag nooit; de herstelde app meldt het).
  public func rebuildIndex(s : Types.SalesState) : [Text] {
    let dup = List.empty<Text>();
    for (k in s.byWork.keys().toArray().values()) { s.byWork.remove(k) };
    for (k in s.paymentsByInvoice.keys().toArray().values()) { s.paymentsByInvoice.remove(k) };
    for (k in s.numbers.keys().toArray().values()) { s.numbers.remove(k) };
    for (k in s.lastDay.keys().toArray().values()) { s.lastDay.remove(k) };
    for (inv in s.invoices.values().toArray().sort(func(a : Types.SalesInvoice, b : Types.SalesInvoice) : { #less; #equal; #greater } = Nat.compare(a.id, b.id)).values()) {
      addIdx(s.byWork, inv.workId, inv.id);
      if (isIssued(inv)) {
        if (s.numbers.containsKey(numberKey(inv.series, inv.number))) { dup.add(inv.number) };
        s.numbers.add(numberKey(inv.series, inv.number), inv.id);
        switch (inv.issueDay) {
          case (?d) { let k = seriesYear(inv.series, inv.year); switch (s.lastDay.get(k)) { case (?x) { if (d > x) s.lastDay.add(k, d) }; case null s.lastDay.add(k, d) } };
          case null {};
        };
      };
    };
    for ((pid, c) in s.payments.entries().toArray().values()) { switch (plain(c)) { case (?p) addIdx(s.paymentsByInvoice, p.invoiceId, pid); case null {} } };
    dup.toArray();
  };
};
