// OA-facturen registreren en controleren (stap 2.11, bouwplan §9 rij 2.11 en §5.1; zonder AI; VOORLOPIG: vragen voor Alexis en
// de boekhouder). Kantoor (admin, calculator) registreert een factuur van een onderaannemer met haar bedragen, regels en bijlage
// (vertrouwelijk bestand); de controle (lib/OaInvoice.mo) legt ze naast de afspraken, de regie-uren van die OA (bevestigd of
// betwist), de opmeting en wat al gefactureerd is. Goedkeuren vraagt de raadpleging van de inhoudingsplicht van DIE dag (1b.4)
// met resultaat en referentie, of een gemotiveerde uitzondering; met markeringen ook een reden. Betwisten vraagt een reden en
// gaat (instelbaar) als melding naar de OA. Een goedgekeurde factuur verandert niet meer.
//   • Rechten (Rights.oaInvoiceScope): admin en calculator alles; de werfleider van de werf ziet de regels met hoeveelheden en
//     uren en de markeringen daarop, nooit een bedrag (oaInvoiceQty draagt geen bedragveld); een OA ziet enkel de status van zijn
//     eigen facturen als de beheerder dat aanzette; de rest niets. Bedragen lezen enkel via een update-call met een auditregel.
//   • Peppol (fase 3): `source`/`externalRef` vangen een ingelezen factuur op; hier enkel "hand".
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
import Views "../types/views";
import OV "../types/oaviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Plan "../lib/Plan";
import OaInvoice "../lib/OaInvoice";
import Quotes "../lib/Quotes";
import Rights "../lib/Rights";
import Wadm "../lib/Wadm";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  files : Types.FileState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  quotes : Types.QuotesState,
  workStarts : Types.WorkStartState,
  surveys : Types.SurveyState,
  wadm : Types.WadmState,
  oaInvoices : Types.OaInvoiceState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Instellingen (beheerder) ────────────────────────────────────────────
  public query ({ caller }) func oaInvoiceSettings() : async OV.OaInvoiceSettings {
    let p = Access.requireActive(access, caller);
    if (not Rights.internal(p)) { Runtime.trap("Geen toegang") };
    { thresholdBp = OaInvoice.thresholdBp(settings); thresholdCents = OaInvoice.thresholdCents(settings); oaView = OaInvoice.oaView(settings); disputeNotice = OaInvoice.disputeNotice(settings) };
  };

  public shared ({ caller }) func saveOaInvoiceSettings(i : OV.OaInvoiceSettings) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (i.thresholdBp > 10_000) { return #err("Drempel: 0 tot 100 %") };
    if (i.thresholdCents > 10_000_000) { return #err("Minimumbedrag: hoogstens € 100.000") };
    if (i.disputeNotice != "uit" and i.disputeNotice != "melding" and i.disputeNotice != "app") { return #err("Betwisting naar de OA: uit, melding of app") };
    settings.values.add("oaInvoice.thresholdBp", i.thresholdBp.toText());
    settings.values.add("oaInvoice.thresholdCents", i.thresholdCents.toText());
    settings.values.add("oaInvoice.oaView", if (i.oaView) "ja" else "nee");
    settings.values.add("oaInvoice.disputeNotice", i.disputeNotice);
    Access.audit(audit, caller, ?p.id, null, "oa-factuur-instellingen", "drempel " # i.thresholdBp.toText() # " bp, OA ziet status: " # (if (i.oaView) "ja" else "nee") # ", betwisting: " # i.disputeNotice);
    #ok;
  };

  // ── Lezen zonder bedragen ───────────────────────────────────────────────
  public query ({ caller }) func listOaInvoices(workId : ?Nat, status : ?Types.OaInvoiceStatus) : async [OV.OaInvoiceBrief] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #oaInvoicesAny, null);
    let out = List.empty<OV.OaInvoiceBrief>();
    for (i in oaInvoices.invoices.values()) {
      let sc = Rights.oaInvoiceScope(ctx, p, i.workId);
      let wOk = switch workId { case (?w) i.workId == w; case null true };
      let sOk = switch status { case (?s) i.status == s; case null i.status != #withdrawn };
      if ((sc == #full or sc == #qty) and wOk and sOk) { out.add(oiBrief(i)) };
    };
    Array.sort<OV.OaInvoiceBrief>(out.toArray(), func(a, b) = if (a.invoiceDay != b.invoiceDay) Nat.compare(b.invoiceDay, a.invoiceDay) else Nat.compare(b.id, a.id));
  };

  // De posten van de getekende offerte van een werf (voor de regels van het formulier); zonder prijs.
  public query ({ caller }) func oaInvoicePosts(workId : Nat) : async [OV.OaPostOption] {
    let p = Access.requireActive(access, caller);
    if (Rights.oaInvoiceScope({ works; settings }, p, workId) != #full) { Runtime.trap("Geen toegang") };
    let out = List.empty<OV.OaPostOption>();
    for (x in OaInvoice.posts(oiCtx(), workId).values()) { out.add({ root = x.root; title = x.title; unit = x.unit; form = x.form; chapter = x.chapter; vhMilli = x.vhMilli }) };
    out.toArray();
  };

  public query ({ caller }) func oaInvoiceQty(id : Nat) : async OV.OaInvoiceQtyView {
    let p = Access.requireActive(access, caller);
    let i = switch (oaInvoices.invoices.get(id)) { case (?x) x; case null Runtime.trap("Geen toegang") };
    let sc = Rights.oaInvoiceScope({ works; settings }, p, i.workId);
    if (sc != #full and sc != #qty) { Runtime.trap("Geen toegang") };
    let a = oiAmounts(i);
    let k = OaInvoice.control(oiCtx(), i, a);
    { brief = oiBrief(i); periodFrom = i.periodFrom; periodTo = i.periodTo; lines = k.lines.map(oiQty); hoursAll = oiHours(k.hoursAll); oaOnWork = k.oaOnWork; scope = if (sc == #full) "full" else "qty" };
  };

  // De OA: de status van zijn eigen facturen, als de beheerder dat aanzette.
  public query ({ caller }) func myOaInvoices() : async [OV.MyOaInvoice] {
    let p = Access.requireActive(access, caller);
    // 2.12 (M4): de poort staat in Rights.mo (schakelaar van de beheerder én nog ergens actief OA, R31); nooit zelf op een rol testen.
    Rights.require({ works; settings }, p, #ownOaInvoices, null);
    let own = switch (p.orgId) { case (?o) o; case null Runtime.trap("Geen toegang") };
    let notice = OaInvoice.disputeNotice(settings);
    let out = List.empty<OV.MyOaInvoice>();
    for (i in oaInvoices.invoices.values()) {
      if (i.orgId == own and i.status != #withdrawn) {
        let reason = switch (i.status, i.decision) { case (#disputed, ?d) { if (notice == "uit") "" else d.reason }; case _ "" };
        out.add({ id = i.id; workName = oiWorkName(i.workId); number = i.number; invoiceDay = i.invoiceDay; status = i.status; decidedAt = switch (i.decision) { case (?d) ?d.at; case null null }; reason });
      };
    };
    Array.sort<OV.MyOaInvoice>(out.toArray(), func(a, b) = Nat.compare(b.invoiceDay, a.invoiceDay));
  };

  // ── Met bedragen (admin, calculator) ────────────────────────────────────
  public shared ({ caller }) func readOaInvoice(id : Nat) : async Result.Result<OV.OaInvoiceFullView, Text> {
    let p = Access.requireActive(access, caller);
    let i = switch (oaInvoices.invoices.get(id)) { case (?x) x; case null return #err("Geen toegang") };
    if (Rights.oaInvoiceScope({ works; settings }, p, i.workId) != #full) { return #err("Geen toegang") };
    Access.audit(audit, caller, ?p.id, ?i.workId, "bekeek:oa-factuur", oiOrgName(i.orgId) # " " # i.number);
    #ok(oiFull(i));
  };

  // Registreren (id = null) of verbeteren zolang de factuur niet goedgekeurd is. De bijlage is een vertrouwelijk bestand van
  // dezelfde werf (opladen met addFile(…, vertrouwelijk)). Een firma + nummer bestaat maar één keer.
  public shared ({ caller }) func saveOaInvoice(x : OV.OaInvoiceInput, rev : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    if (Rights.oaInvoiceScope(ctx, p, x.workId) != #full) { return #err("Geen toegang") };
    let o = switch (org.orgs.get(x.orgId)) { case (?y) y; case null return #err("Onbekende firma") };
    if (o.archivedAt != null) { return #err("Deze firma is gearchiveerd") };
    if (o.kind != #subcontractor and o.kind != #supplier) { return #err("Kies een onderaannemer of leverancier") };
    let nr = x.number.trim(#char ' ');
    if (nr.size() == 0 or nr.size() > Config.maxName) { return #err("Factuurnummer: 1 tot " # Config.maxName.toText() # " tekens") };
    let today = Dossier.today();
    if (x.invoiceDay > today + 1 or x.invoiceDay + 730 < today) { return #err("Factuurdatum: vandaag of de voorbije twee jaar") };
    switch (x.dueDay) { case (?d) { if (d < x.invoiceDay or d > x.invoiceDay + 365) { return #err("Vervaldag: na de factuurdatum, hoogstens een jaar later") } }; case null {} };
    switch (x.periodFrom, x.periodTo) { case (?f, ?t) { if (t < f) { return #err("Periode: het einde ligt vóór het begin") } }; case _ {} };
    switch (x.vatRegime) { case (#normal bp) { if (bp != 600 and bp != 2100 and bp != 1200 and bp != 0) { return #err("Btw-tarief: 0, 6, 12 of 21 %") } }; case (#reverse) {} };
    if (x.note.size() > Config.maxNote) { return #err("Notitie te lang") };
    if (x.lines.size() > Config.maxOaInvoiceLines) { return #err("Hoogstens " # Config.maxOaInvoiceLines.toText() # " regels") };
    for (v in [x.netCents, x.vatCents, x.totalCents].values()) { if (Int.abs(v) > Int.abs(Config.maxAmountCents)) { return #err("Bedrag te groot") } };
    let ps = OaInvoice.posts(oiCtx(), x.workId);
    for (l in x.lines.values()) {
      if (l.description.size() > Config.maxName * 3) { return #err("Omschrijving van een regel: hoogstens " # (Config.maxName * 3).toText() # " tekens") };
      if (Int.abs(l.qtyMilli) > Int.abs(Config.maxProgressQtyMilli) or Int.abs(l.unitCents) > Int.abs(Config.maxAmountCents) or Int.abs(l.amountCents) > Int.abs(Config.maxAmountCents)) { return #err("Regel: waarde te groot") };
      switch (l.kind, l.root) {
        case (#post, ?r) { if (not ps.containsKey(r)) { return #err("Een regel verwijst naar een post die niet in de getekende offerte van deze werf staat") } };
        case (#post, null) { return #err("Een regel van soort post vraagt een post") };
        case (#regie, ?r) { switch (ps.get(r)) { case (?pp) { if (pp.form != #regie) { return #err("Een regieregel hoort bij een regiepost") } }; case null { return #err("Onbekende regiepost") } } };
        case (#other, ?_) { return #err("Een andere kost hangt aan geen post") };
        case _ {};
      };
    };
    switch (x.fileId) {
      case (?fid) {
        let f = switch (files.files.get(fid)) { case (?y) y; case null return #err("Onbekend bestand") };
        if (not f.confidential or f.workId != ?x.workId or f.archivedAt != null) { return #err("De bijlage is een vertrouwelijk bestand van deze werf") };
        if (f.mime != "application/pdf" and f.mime != "image/jpeg" and f.mime != "image/png") { return #err("Bijlage: PDF, JPEG of PNG") };
      };
      case null {};
    };
    let key = OaInvoice.keyOf(x.orgId, nr);
    let now = Time.now();
    let amounts = func(id : Nat) : Types.OaInvoiceAmounts { { invoiceId = id; netCents = x.netCents; vatCents = x.vatCents; totalCents = x.totalCents; lines = x.lines.map(func(l : Types.OaInvoiceLine) : Types.OaInvoiceLine = { l with description = l.description.trim(#char ' ') }); extra = [] } };
    switch (x.id) {
      case null {
        switch (oaInvoices.keys.get(key)) { case (?other) { switch (oaInvoices.invoices.get(other)) { case (?oi) { if (oi.status != #withdrawn) { return #err("Factuur " # nr # " van " # o.name # " is al geregistreerd") } }; case null {} } }; case null {} };
        let id = Ids.next(ctr, "oaInvoice");
        oaInvoices.invoices.add(id, { id; orgId = x.orgId; workId = x.workId; number = nr; invoiceDay = x.invoiceDay; dueDay = x.dueDay; periodFrom = x.periodFrom; periodTo = x.periodTo; vatRegime = x.vatRegime; reverseMention = x.reverseMention; fileId = x.fileId; status = #registered; decision = null; note = x.note.trim(#char ' '); source = "hand"; externalRef = ""; rev = 0; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; extra = [] });
        oaInvoices.amounts.add(id, #plain(amounts(id)));
        oaInvoices.keys.add(key, id);
        Quotes.addIndex(oaInvoices.byWork, x.workId, id);
        Access.audit(audit, caller, ?p.id, ?x.workId, "oa-factuur-geregistreerd", o.name # " " # nr # " (" # x.lines.size().toText() # " regels)");
        #ok(id);
      };
      case (?id) {
        let i = switch (oaInvoices.invoices.get(id)) { case (?y) y; case null return #err("Geen toegang") };
        if (i.workId != x.workId and Rights.oaInvoiceScope(ctx, p, i.workId) != #full) { return #err("Geen toegang") };
        if (i.status != #registered) { return #err("Enkel een geregistreerde factuur kan verbeterd worden (deze is " # OaInvoice.statusKey(i.status) # ")") };
        if (rev != i.rev) { return #err("Iemand anders bewaarde deze factuur intussen; laad opnieuw") };
        switch (oaInvoices.keys.get(key)) { case (?other) { if (other != id) { switch (oaInvoices.invoices.get(other)) { case (?oi) { if (oi.status != #withdrawn) { return #err("Factuur " # nr # " van " # o.name # " is al geregistreerd") } }; case null {} } } }; case null {} };
        oaInvoices.keys.remove(OaInvoice.keyOf(i.orgId, i.number));
        oaInvoices.keys.add(key, id);
        if (i.workId != x.workId) {
          oaInvoices.byWork.add(i.workId, (switch (oaInvoices.byWork.get(i.workId)) { case (?xs) xs; case null [] }).filter(func y = y != id));
          Quotes.addIndex(oaInvoices.byWork, x.workId, id);
        };
        oaInvoices.invoices.add(id, { i with orgId = x.orgId; workId = x.workId; number = nr; invoiceDay = x.invoiceDay; dueDay = x.dueDay; periodFrom = x.periodFrom; periodTo = x.periodTo; vatRegime = x.vatRegime; reverseMention = x.reverseMention; fileId = x.fileId; note = x.note.trim(#char ' '); rev = i.rev + 1; updatedAt = now; updatedBy = p.id });
        oaInvoices.amounts.add(id, #plain(amounts(id)));
        Access.audit(audit, caller, ?p.id, ?x.workId, "oa-factuur-verbeterd", o.name # " " # nr);
        #ok(id);
      };
    };
  };

  // Goedkeuren: de raadpleging van de inhoudingsplicht van DIE dag (met referentie) of een gemotiveerde uitzondering; met
  // markeringen ook een reden. Daarna ligt de factuur vast.
  public shared ({ caller }) func approveOaInvoice(id : Nat, rev : Nat, proof : OV.OaProofInput, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let i = switch (oaInvoices.invoices.get(id)) { case (?x) x; case null return #err("Geen toegang") };
    if (Rights.oaInvoiceScope({ works; settings }, p, i.workId) != #full) { return #err("Geen toegang") };
    if (i.status != #registered and i.status != #disputed) { return #err("Deze factuur is " # OaInvoice.statusKey(i.status)) };
    if (rev != i.rev) { return #err("Iemand anders wijzigde deze factuur intussen; laad opnieuw") };
    let today = Dossier.today();
    let why = reason.trim(#char ' ');
    if (why.size() > Config.maxQuoteReason) { return #err("Reden: hoogstens " # Config.maxQuoteReason.toText() # " tekens") };
    let w : Types.OaWithholdingProof = switch proof {
      case (#check cid) {
        let c = switch (wadm.checks.get(cid)) { case (?x) x; case null return #err("Onbekende raadpleging") };
        if (c.orgId != i.orgId) { return #err("Deze raadpleging hoort bij een andere firma") };
        if (c.consultedOn != today) { return #err("De inhoudingsplicht moet op de dag van goedkeuring geraadpleegd zijn (deze is van " # Plan.fmtDay(c.consultedOn) # ")") };
        if (c.reference.trim(#char ' ').size() == 0) { return #err("De raadpleging heeft geen referentie: leg ze opnieuw vast met de consultatiereferentie") };
        if (c.result == #unknown) { return #err("Het resultaat van de raadpleging is onbekend: raadpleeg opnieuw of geef een gemotiveerde uitzondering") };
        #check({ checkId = c.id; result = c.result; reference = c.reference; consultedOn = c.consultedOn });
      };
      case (#exception t) {
        let e = t.trim(#char ' ');
        if (e.size() < Config.minWithholdingException or e.size() > Config.maxQuoteReason) { return #err("Uitzondering op de inhoudingsplicht: motiveer in " # Config.minWithholdingException.toText() # " tot " # Config.maxQuoteReason.toText() # " tekens") };
        #exception(e);
      };
    };
    let k = OaInvoice.control(oiCtx(), i, oiAmounts(i));
    if (k.flagCount > 0 and why.size() < Config.minQuoteReason) { return #err(k.flagCount.toText() # " markering(en): geef een reden om toch goed te keuren") };
    let now = Time.now();
    oaInvoices.invoices.add(id, { i with status = #approved; decision = ?{ at = now; by = p.id; approved = true; reason = why; withholding = ?w; flags = k.flagCount }; rev = i.rev + 1; updatedAt = now; updatedBy = p.id });
    // 2.12 (M6): de motivering van een uitzondering hoort in de auditlog (het is de enige grond om zonder raadpleging goed te keuren).
    let wText = switch w { case (#check c) "inhoudingsplicht " # Wadm.resultWord(c.result) # " (" # c.reference # ")"; case (#exception e) "uitzondering op de inhoudingsplicht: " # Text.fromIter(e.chars().take(120)) };
    Access.audit(audit, caller, ?p.id, ?i.workId, "oa-factuur-goedgekeurd", oiOrgName(i.orgId) # " " # i.number # ": " # wText # (if (k.flagCount > 0) ", " # k.flagCount.toText() # " markering(en), reden: " # why else ""));
    switch w { case (#check c) { if (c.result != #clear) { Access.notifyAdmins(access, audit, ctr, "inhoudingsplicht", oiOrgName(i.orgId) # " " # i.number # ": goedgekeurd met inhoudingsplicht (" # Wadm.resultWord(c.result) # "): bij de betaling inhouden") } }; case _ {} };
    #ok;
  };

  public shared ({ caller }) func disputeOaInvoice(id : Nat, rev : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let i = switch (oaInvoices.invoices.get(id)) { case (?x) x; case null return #err("Geen toegang") };
    if (Rights.oaInvoiceScope({ works; settings }, p, i.workId) != #full) { return #err("Geen toegang") };
    if (i.status != #registered) { return #err("Enkel een geregistreerde factuur kan betwist worden (deze is " # OaInvoice.statusKey(i.status) # ")") };
    if (rev != i.rev) { return #err("Iemand anders wijzigde deze factuur intussen; laad opnieuw") };
    let why = reason.trim(#char ' ');
    if (why.size() < Config.minQuoteReason or why.size() > Config.maxQuoteReason) { return #err("Geef een reden (5 tot 300 tekens)") };
    let k = OaInvoice.control(oiCtx(), i, oiAmounts(i));
    let now = Time.now();
    oaInvoices.invoices.add(id, { i with status = #disputed; decision = ?{ at = now; by = p.id; approved = false; reason = why; withholding = null; flags = k.flagCount }; rev = i.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?i.workId, "oa-factuur-betwist", oiOrgName(i.orgId) # " " # i.number # ": " # why);
    // Naar de OA (instelbaar): een melding aan de personen van die firma op die werf, nooit een bedrag.
    if (OaInvoice.disputeNotice(settings) == "melding") {
      Access.notifyOrgOnWork(access, { works; settings }, audit, ctr, i.orgId, i.workId, null, p.id, "oa-factuur", "Uw factuur " # i.number # " (" # oiWorkName(i.workId) # ") wordt betwist: " # why);
    };
    #ok;
  };

  public shared ({ caller }) func withdrawOaInvoice(id : Nat, rev : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let i = switch (oaInvoices.invoices.get(id)) { case (?x) x; case null return #err("Geen toegang") };
    if (Rights.oaInvoiceScope({ works; settings }, p, i.workId) != #full) { return #err("Geen toegang") };
    if (i.status == #approved or i.status == #withdrawn) { return #err("Deze factuur is " # OaInvoice.statusKey(i.status)) };
    if (rev != i.rev) { return #err("Iemand anders wijzigde deze factuur intussen; laad opnieuw") };
    let why = reason.trim(#char ' ');
    if (why.size() < Config.minQuoteReason or why.size() > Config.maxQuoteReason) { return #err("Geef een reden (5 tot 300 tekens)") };
    let now = Time.now();
    oaInvoices.invoices.add(id, { i with status = #withdrawn; note = (if (i.note == "") "" else i.note # "\n") # "Ingetrokken: " # why; rev = i.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?i.workId, "oa-factuur-ingetrokken", oiOrgName(i.orgId) # " " # i.number # ": " # why);
    #ok;
  };

  // ── Hulp ───────────────────────────────────────────────────────────────
  func oiCtx() : OaInvoice.Ctx { { settings; access; org; works; plan; reports; qs = quotes; starts = workStarts; ss = surveys; oi = oaInvoices } };
  func oiOrgName(o : Nat) : Text { switch (org.orgs.get(o)) { case (?x) x.name; case null "#" # o.toText() } };
  func oiWorkName(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.name; case null "" } };
  func oiAmounts(i : Types.OaInvoice) : Types.OaInvoiceAmounts {
    switch (OaInvoice.amountsOf(oaInvoices, i.id)) { case (?a) a; case null { { invoiceId = i.id; netCents = 0; vatCents = 0; totalCents = 0; lines = []; extra = [] } } };
  };
  func oiHours(h : OaInvoice.Hours) : OV.OaHoursView { { validMilli = h.valid; openMilli = h.open; disputedMilli = h.disputed } };

  func oiBrief(i : Types.OaInvoice) : OV.OaInvoiceBrief {
    let w = works.works.get(i.workId);
    {
      id = i.id;
      orgId = i.orgId;
      orgName = oiOrgName(i.orgId);
      workId = i.workId;
      workCode = switch w { case (?x) x.code; case null "" };
      workName = switch w { case (?x) x.name; case null "" };
      number = i.number;
      invoiceDay = i.invoiceDay;
      dueDay = i.dueDay;
      status = i.status;
      reverse = i.vatRegime == #reverse;
      decidedAt = switch (i.decision) { case (?d) ?d.at; case null null };
      decidedByName = switch (i.decision) { case (?d) Access.personName(access, d.by); case null "" };
      lineCount = switch (OaInvoice.amountsOf(oaInvoices, i.id)) { case (?a) a.lines.size(); case null 0 };
      hasFile = i.fileId != null;
      source = i.source;
      updatedAt = i.updatedAt;
      rev = i.rev;
    };
  };

  func oiQty(k : OaInvoice.LineCheck) : OV.OaLineQty {
    {
      index = k.index;
      kind = k.line.kind;
      root = k.line.root;
      description = k.line.description;
      postTitle = switch (k.post) { case (?p) p.title; case null "" };
      unit = switch (k.post) { case (?p) p.unit; case null { if (k.line.kind == #regie) "u" else "" } };
      form = switch (k.post) { case (?p) ?p.form; case null null };
      qtyMilli = k.line.qtyMilli;
      expectedQtyMilli = k.expectedQtyMilli;
      expectedFrom = k.expectedFrom;
      prevQtyMilli = k.prevQtyMilli;
      hours = switch (k.hours) { case (?h) ?oiHours(h); case null null };
      flags = k.qtyFlags;
    };
  };

  func oiFull(i : Types.OaInvoice) : OV.OaInvoiceFullView {
    let a = oiAmounts(i);
    let k = OaInvoice.control(oiCtx(), i, a);
    let today = Dossier.today();
    var todayCheck : ?Types.WithholdingCheck = null;
    for (c in wadm.checks.values()) { if (c.orgId == i.orgId and c.consultedOn == today) { switch todayCheck { case (?b) { if (c.id > b.id) { todayCheck := ?c } }; case null { todayCheck := ?c } } } };
    let (soc, fis) = switch todayCheck { case (?c) OaInvoice.withholdingCents(c.result, a.netCents); case null (0, 0) };
    let prev = List.empty<OV.OaPrevious>();
    for (x in OaInvoice.invoicesOf(oaInvoices, i.workId).values()) {
      if (x.id != i.id and x.orgId == i.orgId) { prev.add({ id = x.id; number = x.number; invoiceDay = x.invoiceDay; status = x.status; netCents = switch (OaInvoice.amountsOf(oaInvoices, x.id)) { case (?y) y.netCents; case null 0 } }) };
    };
    let open = i.status == #registered or i.status == #disputed;
    {
      brief = oiBrief(i);
      note = i.note;
      periodFrom = i.periodFrom;
      periodTo = i.periodTo;
      vatRegime = i.vatRegime;
      reverseMention = i.reverseMention;
      externalRef = i.externalRef;
      netCents = a.netCents;
      vatCents = a.vatCents;
      totalCents = a.totalCents;
      sumLinesCents = k.sumLinesCents;
      expectedVatCents = k.expectedVatCents;
      lines = k.lines.map(func(l : OaInvoice.LineCheck) : OV.OaLineView = { q = oiQty(l); m = { unitCents = l.line.unitCents; amountCents = l.line.amountCents; agreedCents = l.agreedCents; agreedOrg = l.agreedOrg; prevCents = l.prevCents; flags = l.moneyFlags } });
      headerFlags = k.headerFlags.map(func(f : Text) : OV.OaFlag = { key = f; text = OaInvoice.flagText(f) });
      flagCount = k.flagCount;
      hoursAll = oiHours(k.hoursAll);
      oaOnWork = k.oaOnWork;
      withholding = Wadm.oaStatus(access, org, wadm, i.orgId, today);
      todayCheck = switch todayCheck { case (?c) ?Wadm.checkView(access, c); case null null };
      withholdSocialCents = soc;
      withholdFiscalCents = fis;
      previous = prev.toArray();
      decision = switch (i.decision) { case (?d) ?{ at = d.at; byName = Access.personName(access, d.by); approved = d.approved; reason = d.reason; withholding = d.withholding; flags = d.flags }; case null null };
      file = switch (i.fileId) { case (?fid) { switch (files.files.get(fid)) { case (?f) ?{ Dossier.fileView(f) with blob = null }; case null null } }; case null null };
      canEdit = i.status == #registered;
      canDecide = open;
      disputeNotice = OaInvoice.disputeNotice(settings);
    };
  };
};
