// Aankoopfacturen zoals ze binnenkomen (stap 2c.7, ontwerp 2c §4.7, §8 R44; zonder AI; VOORLOPIG: AC-23, AC-24, vragen voor Alexis
// en de boekhouder). Kantoor (admin, calculator) registreert een factuur van een OA of een leverancier met de regels per werf (of
// algemene kost) en kostensoort, de uren per dag, de betaalkorting en de vorderingsstaat van de OA als tweede bijlage. Bij een OA
// wordt elke werf een werfdeel (een OA-factuur van 2.11) met zijn eigen controle (lib/OaInvoice.mo); de aankoop is goedgekeurd als
// alle delen goedgekeurd zijn. Een leverancier wordt hier zelf goedgekeurd (geen OA-controle).
//   • Rechten (Rights.purchaseScope, R44): kantoor alles, bedragen enkel via update-calls met auditregel; de werfleider van de werf
//     bevestigt de uren per dag (HourClaimView, GEEN bedrag); de OA ziet de stand van zijn eigen facturen (bestaande schakelaar).
//   • Voor 2c.5: Purchase.passOnCosts (de doorrekenbare kosten van een werf); hier purchaseCosts voor het scherm.
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
import PV "../types/purchaseviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import OaDeals "../lib/OaDeals";
import OaInvoice "../lib/OaInvoice";
import Plan "../lib/Plan";
import Progress "../lib/Progress";
import Purchase "../lib/Purchase";
import QuoteCalc "../lib/QuoteCalc";
import Quotes "../lib/Quotes";
import Rights "../lib/Rights";

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
  oaInvoices : Types.OaInvoiceState,
  oaDeals : Types.OaDealState,
  purchases : Types.PurchaseState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Instellingen ─────────────────────────────────────────────────────────
  public query ({ caller }) func purchaseSettings() : async PV.PurchaseSettings {
    let p = Access.requireActive(access, caller);
    if (not Rights.internal(p)) { Runtime.trap("Geen toegang") };
    { askHours = Purchase.askMode(settings); passOn = Purchase.passOnDefault(settings) };
  };

  public shared ({ caller }) func savePurchaseSettings(i : PV.PurchaseSettings) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (i.askHours != "verschil" and i.askHours != "altijd") { return #err("Uren vragen: verschil of altijd") };
    settings.values.add("purchase.askHours", i.askHours);
    settings.values.add("purchase.passOn", if (i.passOn) "ja" else "nee");
    Access.audit(audit, caller, ?p.id, null, "aankoop-instellingen", "uren vragen: " # i.askHours # ", doorrekenen standaard: " # (if (i.passOn) "ja" else "nee"));
    #ok;
  };

  // ── Lezen zonder bedragen (kantoor) ─────────────────────────────────────
  public query ({ caller }) func listPurchases(workId : ?Nat, status : ?Types.PurchaseStatus) : async [PV.PurchaseBrief] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editPurchases, null);
    let src = switch workId { case (?w) Purchase.purchasesOf(purchases, w); case null purchases.purchases.values().toArray() };
    let out = src.filter(func(x : Types.Purchase) : Bool = switch status { case (?s) x.status == s; case null x.status != #withdrawn }).map(puBrief);
    out.sort(func(a, b) = if (a.invoiceDay != b.invoiceDay) Nat.compare(b.invoiceDay, a.invoiceDay) else Nat.compare(b.id, a.id));
  };

  // ── Met bedragen (admin, calculator; update-call met auditregel) ────────
  public shared ({ caller }) func readPurchase(id : Nat) : async Result.Result<PV.PurchaseFullView, Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editPurchases, null)) { return #err("Geen toegang") };
    let x = switch (purchases.purchases.get(id)) { case (?y) y; case null return #err("Geen toegang") };
    Access.audit(audit, caller, ?p.id, puFirstWork(x), "bekeek:aankoop", puOrgName(x.orgId) # " " # x.number);
    #ok(puFull(x));
  };

  // Te betalen: goedgekeurd en nog niet betaald, eerst wat korting geeft (kortingsdag nog niet voorbij), dan de vervaldag.
  // 2c.8+ B: een goedgekeurde creditnota gaat af van haar factuur (bedrag, korting en inhouding na de creditnota); is de factuur al
  // betaald, dan staat de creditnota apart (negatief: te verrekenen of terug te krijgen). Ook de goedgekeurde OA-facturen van 2.11 die
  // geen werfdeel van een aankoop zijn, met hun vervaldag en de inhouding uit hun beslissing.
  public shared ({ caller }) func listPurchasesToPay() : async Result.Result<[PV.PayRow], Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editPurchases, null)) { return #err("Geen toegang") };
    let today = Dossier.today();
    let rows = List.empty<(Nat, Nat, Nat, PV.PayRow)>();
    let whText = func(wh : Int, soc : Int, fis : Int) : Text = if (wh > 0) " · inhouding " # Progress.euro(wh) # " door te storten (RSZ " # Progress.euro(soc) # ", FOD Financiën " # Progress.euro(fis) # ")" else "";
    let ix = Purchase.creditIndex(purchases);
    for (x in purchases.purchases.values()) {
      let a = puAmounts(x);
      if (x.status == #approved) {
        switch (x.creditOf) {
          case (?oid) {
            let paidOrig = switch (purchases.purchases.get(oid)) { case (?o) o.paidDay != null; case null false };
            if (paidOrig and x.paidDay == null) {
              rows.add((1, 0, x.id, { brief = ?puBrief(x); oaInvoice = null; netCents = -a.netCents; totalCents = -a.totalCents; discountBp = null; discountCents = null; withholdCents = 0; creditCents = 0; credits = []; payCents = -a.totalCents; dueDay = x.dueDay; paidDay = x.paidDay; withheldDay = null; text = "creditnota op " # puNumber(oid) # " (al betaald): te verrekenen of terug te krijgen"; warnings = ["creditnota"] }));
            };
          };
          case null {
            let cs = Purchase.creditsIn(ix, x.id);
            let (soc, fis) = puWithholdIn(x, cs);
            let wh = soc + fis;
            // Ook betaald maar de inhouding nog niet doorgestort (review H2).
            if (x.paidDay == null or (wh > 0 and x.withheldDay == null)) {
              // Review M2: enkel de creditnota's die van deze factuur afgaan (betaald: die met de betaling verrekend zijn).
              let ded = cs.filter(func(c : Types.Purchase) : Bool = Purchase.deducts(x, c));
              let (cn, ct) = Purchase.sumCredits(purchases, ded);
              let nums = ded.map(func(c : Types.Purchase) : Text = c.number);
              let disc : ?Int = switch (x.discountUntil, a.discountBp) { case (?u, ?bp) { if (u >= today) ?QuoteCalc.roundDiv((a.netCents - cn) * bp, 10_000) else null }; case _ null };
              let pay = a.totalCents - ct - (switch disc { case (?d) d; case null 0 }) - wh;
              let base = switch (disc, x.discountUntil, a.discountBp) {
                case (?d, ?u, ?bp) "betaal uiterlijk op " # Plan.fmtDay(u) # " voor " # puPct(bp) # " (" # Progress.euro(d) # ")";
                case _ { switch (x.dueDay) { case (?dd) "vervalt op " # Plan.fmtDay(dd); case null "geen vervaldag" } };
              };
              let credText = if (ct != 0) " · creditnota " # Text.join(nums.values(), ", ") # " −" # Progress.euro(ct) else "";
              let text = (if (x.paidDay == null) base else "betaald op " # (switch (x.paidDay) { case (?d) Plan.fmtDay(d); case null "" })) # credText # whText(wh, soc, fis);
              let warnings = List.empty<Text>();
              if (x.parts.size() > 0 and Purchase.partsNet(oaInvoices, x) != a.netCents) { warnings.add("som-werfdelen") };
              if (wh > 0 and x.withheldDay == null) { warnings.add("inhouding") };
              if (cs.any(func(c : Types.Purchase) : Bool = c.status != #approved)) { warnings.add("creditnota-open") };
              let k1 = switch disc { case (?_) 0; case null 1 };
              let k2 = switch (disc, x.discountUntil, x.dueDay) { case (?_, ?u, _) u; case (_, _, ?dd) dd; case _ 999_999 };
              rows.add((k1, k2, x.id, { brief = ?puBrief(x); oaInvoice = null; netCents = a.netCents - cn; totalCents = a.totalCents - ct; discountBp = a.discountBp; discountCents = disc; withholdCents = wh; creditCents = ct; credits = nums; payCents = pay; dueDay = x.dueDay; paidDay = x.paidDay; withheldDay = x.withheldDay; text; warnings = warnings.toArray() }));
            };
          };
        };
      };
    };
    // De OA-facturen van 2.11 (geen werfdeel): betaald en doorgestort staan in hun extra ("betaald", "doorgestort").
    for (i in oaInvoices.invoices.values()) {
      if (i.status == #approved and not purchases.partOf.containsKey(i.id)) {
        let paid = puExtraDay(i.extra, "betaald");
        let withheld = puExtraDay(i.extra, "doorgestort");
        let (soc, fis) = puOaWithhold(i);
        let wh = soc + fis;
        if (paid == null or (wh > 0 and withheld == null)) {
          let am = switch (OaInvoice.amountsOf(oaInvoices, i.id)) { case (?y) y; case null { { invoiceId = i.id; netCents = 0; vatCents = 0; totalCents = 0; lines = []; extra = [] } } };
          let base = switch (i.dueDay) { case (?dd) "vervalt op " # Plan.fmtDay(dd); case null "geen vervaldag" };
          let text = (switch paid { case (?d) "betaald op " # Plan.fmtDay(d); case null base }) # whText(wh, soc, fis);
          let k2 = switch (i.dueDay) { case (?dd) dd; case null 999_999 };
          rows.add((1, k2, 1_000_000_000 + i.id, { brief = null; oaInvoice = ?puOaBrief(i); netCents = am.netCents; totalCents = am.totalCents; discountBp = null; discountCents = null; withholdCents = wh; creditCents = 0; credits = []; payCents = am.totalCents - wh; dueDay = i.dueDay; paidDay = paid; withheldDay = withheld; text; warnings = if (wh > 0 and withheld == null) ["inhouding"] else [] }));
        };
      };
    };
    Access.audit(audit, caller, ?p.id, null, "bekeek:te-betalen", rows.size().toText() # " facturen");
    let sorted = rows.toArray().sort(func(a, b) = if (a.0 != b.0) Nat.compare(a.0, b.0) else if (a.1 != b.1) Nat.compare(a.1, b.1) else Nat.compare(a.2, b.2));
    #ok(sorted.map(func(r : (Nat, Nat, Nat, PV.PayRow)) : PV.PayRow = r.3));
  };

  // 2c.8+ B: een goedgekeurde OA-factuur van 2.11 (geen werfdeel) betaald markeren; null = niet meer betaald. withheldDay: de inhouding
  // (uit de beslissing bij het goedkeuren) is doorgestort. Bewaard in OaInvoice.extra ("betaald", "doorgestort"): geen nieuw veld (G2).
  public shared ({ caller }) func markOaInvoicePaid(id : Nat, rev : Nat, day : ?Nat, withheldDay : ?Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editPurchases, null)) { return #err("Geen toegang") };
    let i = switch (oaInvoices.invoices.get(id)) { case (?y) y; case null return #err("Geen toegang") };
    if (Rights.purchaseScope({ works; settings }, p, i.workId) != #full) { return #err("Geen toegang") };
    if (purchases.partOf.containsKey(id)) { return #err("Dit is een werfdeel van een aankoopfactuur: markeer de aankoopfactuur als betaald") };
    if (i.status != #approved) { return #err("Enkel een goedgekeurde factuur kan betaald gemarkeerd worden") };
    if (rev != i.rev) { return #err("Iemand anders wijzigde deze factuur intussen; laad opnieuw") };
    for (dd in [day, withheldDay].values()) { switch dd { case (?d) { if (d < i.invoiceDay or d > Dossier.today() + 1) { return #err("Betaaldag: na de factuurdatum, niet in de toekomst") } }; case null {} } };
    let (soc, fis) = puOaWithhold(i);
    if (withheldDay != null and soc + fis == 0) { return #err("Deze factuur heeft geen inhouding") };
    var extra = i.extra.filter(func((k, _) : (Text, Text)) : Bool = k != "betaald" and k != "doorgestort");
    switch day { case (?d) { extra := OaDeals.extraSet(extra, "betaald", d.toText()) }; case null {} };
    switch withheldDay { case (?d) { extra := OaDeals.extraSet(extra, "doorgestort", d.toText()) }; case null {} };
    let now = Time.now();
    oaInvoices.invoices.add(id, { i with extra; rev = i.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?i.workId, "oa-factuur-betaald", puOrgName(i.orgId) # " " # i.number # ": " # (switch day { case (?d) "betaald op " # Plan.fmtDay(d); case null "niet betaald" }) # (if (soc + fis > 0) (switch withheldDay { case (?d) ", inhouding doorgestort op " # Plan.fmtDay(d); case null ", inhouding nog niet doorgestort" }) else ""));
    #ok;
  };

  // De kosten van een werf die aan de klant doorgerekend worden (alle aankopen die meetellen; de min-meerstaat van 2c.5 leest
  // dezelfde regels met Purchase.passOnCosts).
  public shared ({ caller }) func purchaseCosts(workId : Nat) : async Result.Result<[PV.PurchaseCostView], Text> {
    let p = Access.requireActive(access, caller);
    if (Rights.purchaseScope({ works; settings }, p, workId) != #full) { return #err("Geen toegang") };
    let xs = Purchase.passOnCosts(purchases, oaInvoices, workId, null, null, false);
    Access.audit(audit, caller, ?p.id, ?workId, "bekeek:doorrekenen", xs.size().toText() # " kostenregels");
    #ok(xs.map(func(c : Purchase.PassOnCost) : PV.PurchaseCostView = { key = c.key; purchaseId = c.purchaseId; lineId = c.lineId; number = c.number; orgName = puOrgName(c.orgId); day = c.day; kind = c.kindKey; kindName = Purchase.costName(c.kind); description = c.description; unit = c.unit; qtyMilli = c.qtyMilli; costCents = c.costCents; status = c.status }));
  };

  // ── Registreren of verbeteren ───────────────────────────────────────────
  // Registreren (id = null) of verbeteren zolang de aankoop geregistreerd is en geen werfdeel beslist is. Een firma + nummer bestaat
  // maar één keer (ook tegenover de OA-facturen van 2.11). Bij een OA ontstaat per werf een werfdeel (OA-factuur van 2.11).
  public shared ({ caller }) func savePurchase(x : PV.PurchaseInput, rev : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #editPurchases, null)) { return #err("Geen toegang") };
    for (l in x.lines.values()) { switch (l.workId) { case (?w) { if (Rights.purchaseScope(ctx, p, w) != #full) { return #err("Geen toegang") } }; case null {} } };
    let o = switch (org.orgs.get(x.orgId)) { case (?y) y; case null return #err("Onbekende firma") };
    if (o.archivedAt != null) { return #err("Deze firma is gearchiveerd") };
    switch (x.kind, o.kind) {
      case (#oa, #subcontractor) {};
      case (#oa, _) { return #err("Een OA-factuur is van een onderaannemer") };
      case (#supplier, #supplier) {};
      case (#supplier, _) { return #err("Een leveranciersfactuur is van een leverancier") };
      case (#other, #subcontractor) { return #err("Een factuur van een onderaannemer is een OA-factuur (met de inhoudingsplicht)") };
      case (#other, #supplier or #other or #authority) {};
      case (#other, _) { return #err("Kies een onderaannemer, leverancier of andere firma") };
    };
    let nr = x.number.trim(#char ' ');
    if (nr.size() == 0 or nr.size() > Config.maxName) { return #err("Factuurnummer: 1 tot " # Config.maxName.toText() # " tekens") };
    let today = Dossier.today();
    if (x.invoiceDay > today + 1 or x.invoiceDay + 730 < today) { return #err("Factuurdatum: vandaag of de voorbije twee jaar") };
    switch (x.dueDay) { case (?d) { if (d < x.invoiceDay or d > x.invoiceDay + 365) { return #err("Vervaldag: na de factuurdatum, hoogstens een jaar later") } }; case null {} };
    switch (x.discountUntil, x.discountBp) {
      case (?d, ?bp) {
        if (d < x.invoiceDay or d > x.invoiceDay + 365) { return #err("Kortingsdag: na de factuurdatum, hoogstens een jaar later") };
        if (bp == 0 or bp > 1_000) { return #err("Betaalkorting: meer dan 0 en hoogstens 10 %") };
      };
      case (null, null) {};
      case _ { return #err("Betaalkorting: geef de uiterste dag én het percentage") };
    };
    switch (x.periodFrom, x.periodTo) { case (?f, ?t) { if (t < f) { return #err("Periode: het einde ligt vóór het begin") } }; case _ {} };
    switch (x.vatRegime) { case (#normal bp) { if (bp != 600 and bp != 2100 and bp != 1200 and bp != 0) { return #err("Btw-tarief: 0, 6, 12 of 21 %") } }; case (#reverse) {} };
    if (x.note.size() > Config.maxNote or x.oaStatementRef.size() > Config.maxName) { return #err("Notitie of verwijzing te lang") };
    if (x.lines.size() == 0) { return #err("Geef minstens één regel") };
    if (x.lines.size() > Config.maxOaInvoiceLines) { return #err("Hoogstens " # Config.maxOaInvoiceLines.toText() # " regels") };
    for (v in [x.netCents, x.vatCents, x.totalCents].values()) { if (Int.abs(v) > Int.abs(Config.maxAmountCents)) { return #err("Bedrag te groot") } };
    // De regels nakijken (soort, werf, post, uren per dag).
    let parsed = List.empty<(PV.PurchaseLineInput, Types.CostKind)>();
    for (l in x.lines.values()) {
      let k = switch (Purchase.costFromKey(l.kind)) { case (?y) y; case null return #err("Onbekende kostensoort: " # l.kind) };
      switch (puCheckLine(x, l, k, today)) { case (?e) return #err(e); case null {} };
      parsed.add((l, k));
    };
    let workIds = List.empty<Nat>();
    for (l in x.lines.values()) { switch (l.workId) { case (?w) { if (workIds.find(func y = y == w) == null) { workIds.add(w) } }; case null {} } };
    if (x.kind == #oa and workIds.size() == 0) { return #err("Een OA-factuur heeft minstens één regel op een werf") };
    for (w in x.finalWorkIds.values()) { if (workIds.find(func y = y == w) == null) { return #err("'Laatste factuur' geldt enkel voor een werf op deze factuur") } };
    for (fid in [x.fileId, x.oaStatementFileId].values()) {
      switch fid {
        case (?f) {
          let fr = switch (files.files.get(f)) { case (?y) y; case null return #err("Onbekend bestand") };
          let onWork = switch (fr.workId) { case (?w) workIds.find(func y = y == w) != null; case null true };
          if (not fr.confidential or not onWork or fr.archivedAt != null) { return #err("Een bijlage is een vertrouwelijk bestand van een werf op deze factuur (of zonder werf)") };
          if (fr.mime != "application/pdf" and fr.mime != "image/jpeg" and fr.mime != "image/png") { return #err("Bijlage: PDF, JPEG of PNG") };
        };
        case null {};
      };
    };
    let key = Purchase.keyOf(x.orgId, nr);
    // Dubbele registratie: dezelfde firma en hetzelfde nummer als een andere aankoop of een OA-factuur van 2.11.
    switch (purchases.keys.get(key)) { case (?other) { if (?other != x.id) { switch (purchases.purchases.get(other)) { case (?q) { if (q.status != #withdrawn) { return #err("Factuur " # nr # " van " # o.name # " is al geregistreerd") } }; case null {} } } }; case null {} };
    switch (oaInvoices.keys.get(OaInvoice.keyOf(x.orgId, nr))) { case (?other) { switch (oaInvoices.invoices.get(other)) { case (?oi) { if (oi.status != #withdrawn and purchases.partOf.get(other) == null) { return #err("Factuur " # nr # " van " # o.name # " is al geregistreerd (OA-facturen)") } }; case null {} } }; case null {} };
    let now = Time.now();
    let old : ?Types.Purchase = switch (x.id) {
      case null null;
      case (?id) {
        let q = switch (purchases.purchases.get(id)) { case (?y) y; case null return #err("Geen toegang") };
        for (w in puWorksOf(q).values()) { if (Rights.purchaseScope(ctx, p, w) != #full) { return #err("Geen toegang") } };
        // Review L9: ook een betwiste factuur (na verbeteren terug geregistreerd, nieuwe controle); nooit met een goedgekeurd deel.
        if (Purchase.creditsOf(purchases, q.id).size() > 0) { return #err("Op deze factuur staat een creditnota: verbeteren kan niet meer (trek eerst de creditnota in)") };
        if (q.status != #registered and q.status != #disputed) { return #err("Enkel een geregistreerde of betwiste factuur kan verbeterd worden (deze is " # Purchase.statusKey(q.status) # ")") };
        if (rev != q.rev) { return #err("Iemand anders bewaarde deze factuur intussen; laad opnieuw") };
        for (pid in q.parts.values()) { switch (oaInvoices.invoices.get(pid)) { case (?i) { if (i.status == #approved) { return #err("Een werfdeel is al goedgekeurd: verbeteren kan niet meer") } }; case null {} } };
        ?q;
      };
    };
    // 2c.8+ B: een creditnota (creditOf) en de aankoop zelf (niet verbeteren zodra er een creditnota op staat).
    let creditOf : ?Nat = switch old { case (?q) { if (x.creditOf != q.creditOf) { return #err("Een factuur wordt geen creditnota (en omgekeerd): registreer een nieuwe") }; q.creditOf }; case null x.creditOf };
    switch creditOf {
      case (?oid) { switch (puCheckCredit(x, oid, switch old { case (?q) ?q.id; case null null })) { case (?e) return #err(e); case null {} } };
      case null {};
    };
    let id = switch old { case (?q) q.id; case null Ids.next(ctr, "purchase") };
    // De uren per dag: een dag die niet veranderde, houdt zijn id en de bevestiging van de werfleider.
    let oldClaims = Map.empty<Text, Types.HourClaim>();
    switch old { case (?q) { for (c in Purchase.claimsOf(purchases, q.id).values()) { oldClaims.add(puClaimSig(c.workId, c.day, c.persons, c.slots, c.pauseMin), c); puDropClaim(c) } }; case null {} };
    // Vaste regel-id's (review M2): een bestaande regel houdt zijn id (het formulier stuurt hem mee), een nieuwe krijgt de volgende uit
    // de teller van de aankoop (Purchase.extra "regels").
    let oldIds = Map.empty<Nat, ()>();
    switch old { case (?q) { for (l in puAmounts(q).lines.values()) { oldIds.add(l.lineId, ()) } }; case null {} };
    var seq : Nat = switch old { case (?q) { switch (Nat.fromText(OaDeals.extraGet(q.extra, "regels"))) { case (?n) n; case null 0 } }; case null 0 };
    let used = Map.empty<Nat, ()>();
    let lines = parsed.toArray().map(
      func((l, k) : (PV.PurchaseLineInput, Types.CostKind)) : Types.PurchaseLine {
        let lineId = switch (creditOf, l.lineId) {
          case (?_, ?lid) lid; // creditnota: de id van de gecrediteerde regel (puCheckCredit: bestaat en uniek)
          case (_, ?lid) { if (oldIds.containsKey(lid) and not used.containsKey(lid)) { used.add(lid, ()); lid } else { seq += 1; seq } };
          case (_, null) { seq += 1; seq };
        };
        let ids = l.days.map(
          func(d : PV.HourDayInput) : Nat {
            let w = switch (l.workId) { case (?y) y; case null 0 };
            let sig = puClaimSig(w, d.day, d.persons, d.slots, d.pauseMin);
            let (cid, review, extra) = switch (oldClaims.get(sig)) { case (?c) { oldClaims.remove(sig); (c.id, c.review, c.extra) }; case null (Ids.next(ctr, "hourClaim"), null, []) };
            purchases.claims.add(cid, { id = cid; purchaseId = id; workId = w; orgId = x.orgId; day = d.day; persons = d.persons; slots = d.slots; pauseMin = d.pauseMin; hoursMilli = Purchase.claimHours(d.persons, d.slots, d.pauseMin); review; extra });
            Quotes.addIndex(purchases.claimsByWork, w, cid);
            cid;
          }
        );
        let pass = switch (creditOf) { case (?oid) puOrigLine(oid, lineId).passOn; case null l.passOn and l.workId != null and Purchase.isCost(k) };
        { workId = l.workId; kind = k; root = l.root; description = l.description.trim(#char ' '); persons = l.persons; qtyMilli = l.qtyMilli; unit = l.unit.trim(#char ' '); unitCents = l.unitCents; amountCents = l.amountCents; passOn = pass; claimIds = ids; lineId; extra = [] };
      }
    );
    let amounts : Types.PurchaseAmounts = { purchaseId = id; netCents = x.netCents; vatCents = x.vatCents; totalCents = x.totalCents; discountBp = x.discountBp; lines; extra = [] };
    var extra : Types.Extra = switch old { case (?q) q.extra.filter(func((k, _) : (Text, Text)) : Bool = not k.startsWith(#text "slot:")); case null [] };
    for (w in x.finalWorkIds.values()) { extra := OaDeals.extraSet(extra, "slot:" # w.toText(), "ja") };
    extra := OaDeals.extraSet(extra, "regels", seq.toText());
    let base : Types.Purchase = switch old {
      case (?q) { { q with orgId = x.orgId; kind = x.kind; number = nr; invoiceDay = x.invoiceDay; dueDay = x.dueDay; discountUntil = x.discountUntil; periodFrom = x.periodFrom; periodTo = x.periodTo; vatRegime = x.vatRegime; reverseMention = x.reverseMention; fileId = x.fileId; oaStatementFileId = x.oaStatementFileId; oaStatementRef = x.oaStatementRef.trim(#char ' '); note = x.note.trim(#char ' '); status = #registered; rev = q.rev + 1; updatedAt = now; updatedBy = p.id; extra } };
      case null { { id; orgId = x.orgId; kind = x.kind; number = nr; invoiceDay = x.invoiceDay; dueDay = x.dueDay; discountUntil = x.discountUntil; periodFrom = x.periodFrom; periodTo = x.periodTo; vatRegime = x.vatRegime; reverseMention = x.reverseMention; fileId = x.fileId; oaStatementFileId = x.oaStatementFileId; oaStatementRef = x.oaStatementRef.trim(#char ' '); status = #registered; parts = []; decision = null; creditOf; paidDay = null; withheldDay = null; note = x.note.trim(#char ' '); source = "hand"; externalRef = ""; rev = 0; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; extra } };
    };
    // Indexen: oude sleutel en werven weg, nieuwe erbij.
    let oldWorks = switch old { case (?q) puWorksOf(q); case null [] };
    switch old {
      case (?q) {
        if (purchases.keys.get(Purchase.keyOf(q.orgId, q.number)) == ?q.id) { purchases.keys.remove(Purchase.keyOf(q.orgId, q.number)) };
        for (w in oldWorks.values()) { purchases.byWork.add(w, Quotes.ids(purchases.byWork, w).filter(func y = y != q.id)) };
      };
      case null {};
    };
    purchases.amounts.add(id, #plain(amounts));
    purchases.keys.add(key, id);
    for (w in workIds.values()) { Quotes.addIndex(purchases.byWork, w, id) };
    // Werfdelen (enkel bij een OA): één OA-factuur van 2.11 per werf.
    // Een creditnota heeft geen werfdelen (ze wordt in de aankoop zelf goedgekeurd).
    let parts = if (x.kind == #oa and creditOf == null) puSyncParts(base, amounts, workIds.toArray(), now, p.id) else { puEndParts(base, now, p.id, "geen OA-factuur meer"); [] };
    purchases.purchases.add(id, { base with parts });
    let touched = List.empty<(Nat, Nat)>();
    for (w in workIds.values()) { touched.add((w, x.orgId)) };
    switch old { case (?q) { for (w in oldWorks.values()) { touched.add((w, q.orgId)) } }; case null {} };
    for ((w, oid) in touched.values()) { Purchase.syncAdvances(purchases, oaDeals, oaInvoices, w, oid) };
    Access.audit(audit, caller, ?p.id, workIds.get(0), if (old == null) (if (creditOf != null) "aankoop-creditnota" else "aankoop-geregistreerd") else "aankoop-verbeterd", o.name # " " # nr # " (" # Purchase.kindKey(x.kind) # ", " # lines.size().toText() # " regels, " # workIds.size().toText() # " werven" # (switch creditOf { case (?oid) ", creditnota op " # puNumber(oid); case null "" }) # ")");
    #ok(id);
  };

  // ── Beslissen (zonder werfdelen: leverancier, andere), intrekken, betaald ─
  // Een aankoop met werfdelen beslist per werfdeel (approveOaInvoice, met de inhoudingsplicht); deze functies gelden voor een aankoop
  // zonder werfdelen. Met markeringen vraagt goedkeuren een reden.
  public shared ({ caller }) func approvePurchase(id : Nat, rev : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editPurchases, null)) { return #err("Geen toegang") };
    let x = switch (purchases.purchases.get(id)) { case (?y) y; case null return #err("Geen toegang") };
    if (x.parts.size() > 0) { return #err("Deze factuur heeft werfdelen: keur elk werfdeel goed (OA-facturen)") };
    if (x.status != #registered and x.status != #disputed) { return #err("Deze factuur is " # Purchase.statusKey(x.status)) };
    if (rev != x.rev) { return #err("Iemand anders wijzigde deze factuur intussen; laad opnieuw") };
    let why = reason.trim(#char ' ');
    if (why.size() > Config.maxQuoteReason) { return #err("Reden: hoogstens " # Config.maxQuoteReason.toText() # " tekens") };
    let flags = puFull(x).flagCount;
    if (flags > 0 and why.size() < Config.minQuoteReason) { return #err(flags.toText() # " markering(en): geef een reden om toch goed te keuren") };
    let now = Time.now();
    purchases.purchases.add(id, { x with status = #approved; decision = ?{ at = now; by = p.id; approved = true; reason = why; flags }; rev = x.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, puFirstWork(x), "aankoop-goedgekeurd", puOrgName(x.orgId) # " " # x.number # (if (flags > 0) ": " # flags.toText() # " markering(en), reden: " # why else ""));
    #ok;
  };

  public shared ({ caller }) func disputePurchase(id : Nat, rev : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editPurchases, null)) { return #err("Geen toegang") };
    let x = switch (purchases.purchases.get(id)) { case (?y) y; case null return #err("Geen toegang") };
    if (x.parts.size() > 0) { return #err("Deze factuur heeft werfdelen: betwist het werfdeel (OA-facturen)") };
    // Review M3: niet zolang er een creditnota op staat (eerst: ook bij een goedgekeurde factuur is dit de reden).
    if (Purchase.creditsOf(purchases, x.id).size() > 0) { return #err("Op deze factuur staat een creditnota: trek eerst de creditnota in") };
    if (x.status != #registered) { return #err("Enkel een geregistreerde factuur kan betwist worden (deze is " # Purchase.statusKey(x.status) # ")") };
    if (rev != x.rev) { return #err("Iemand anders wijzigde deze factuur intussen; laad opnieuw") };
    let why = reason.trim(#char ' ');
    if (why.size() < Config.minQuoteReason or why.size() > Config.maxQuoteReason) { return #err("Geef een reden (5 tot 300 tekens)") };
    let now = Time.now();
    purchases.purchases.add(id, { x with status = #disputed; decision = ?{ at = now; by = p.id; approved = false; reason = why; flags = puFull(x).flagCount }; rev = x.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, puFirstWork(x), "aankoop-betwist", puOrgName(x.orgId) # " " # x.number # ": " # why);
    #ok;
  };

  // Intrekken (fout geregistreerd): ook de werfdelen; niet als er al een deel goedgekeurd is.
  public shared ({ caller }) func withdrawPurchase(id : Nat, rev : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editPurchases, null)) { return #err("Geen toegang") };
    let x = switch (purchases.purchases.get(id)) { case (?y) y; case null return #err("Geen toegang") };
    if (Purchase.creditsOf(purchases, x.id).size() > 0) { return #err("Op deze factuur staat een creditnota: trek eerst de creditnota in") };
    // Review M3: een goedgekeurde creditnota mag ingetrokken worden zolang ze niet verrekend is (met de betaling of apart).
    let openCredit = x.creditOf != null and x.status == #approved and x.paidDay == null and not Purchase.settled(x);
    if ((x.status == #approved and not openCredit) or x.status == #withdrawn or x.status == #checking) { return #err(if (x.creditOf != null and x.status == #approved) "Deze creditnota is al verrekend: intrekken kan niet meer" else "Deze factuur is " # Purchase.statusKey(x.status)) };
    // Review M1: ook een betwiste aankoop met een goedgekeurd werfdeel niet.
    for (pid in x.parts.values()) { switch (oaInvoices.invoices.get(pid)) { case (?i) { if (i.status == #approved) { return #err("Een werfdeel is al goedgekeurd: intrekken kan niet meer") } }; case null {} } };
    if (rev != x.rev) { return #err("Iemand anders wijzigde deze factuur intussen; laad opnieuw") };
    let why = reason.trim(#char ' ');
    if (why.size() < Config.minQuoteReason or why.size() > Config.maxQuoteReason) { return #err("Geef een reden (5 tot 300 tekens)") };
    let now = Time.now();
    puEndParts(x, now, p.id, "ingetrokken: " # why);
    if (purchases.keys.get(Purchase.keyOf(x.orgId, x.number)) == ?x.id) { purchases.keys.remove(Purchase.keyOf(x.orgId, x.number)) };
    purchases.purchases.add(id, { x with status = #withdrawn; note = (if (x.note == "") "" else x.note # "\n") # "Ingetrokken: " # why; rev = x.rev + 1; updatedAt = now; updatedBy = p.id });
    for (w in puWorksOf(x).values()) { Purchase.syncAdvances(purchases, oaDeals, oaInvoices, w, x.orgId) };
    Access.audit(audit, caller, ?p.id, puFirstWork(x), "aankoop-ingetrokken", puOrgName(x.orgId) # " " # x.number # ": " # why);
    #ok;
  };

  // Betaald markeren (de betaling zelf gebeurt in de bank, AC-23); null = niet meer betaald.
  // withheldDay: de dag waarop de inhouding (inhoudingsplicht) doorgestort is aan RSZ/FOD (review H2); null = nog niet.
  public shared ({ caller }) func markPurchasePaid(id : Nat, rev : Nat, day : ?Nat, withheldDay : ?Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editPurchases, null)) { return #err("Geen toegang") };
    let x = switch (purchases.purchases.get(id)) { case (?y) y; case null return #err("Geen toegang") };
    if (x.status != #approved) { return #err("Enkel een goedgekeurde factuur kan betaald gemarkeerd worden") };
    if (rev != x.rev) { return #err("Iemand anders wijzigde deze factuur intussen; laad opnieuw") };
    for (dd in [day, withheldDay].values()) { switch dd { case (?d) { if (d < x.invoiceDay or d > Dossier.today() + 1) { return #err("Betaaldag: na de factuurdatum, niet in de toekomst") } }; case null {} } };
    let (soc, fis) = puWithhold(x);
    if (withheldDay != null and soc + fis == 0) { return #err("Deze factuur heeft geen inhouding") };
    // 2c.8+ B: een creditnota apart markeren kan enkel als haar factuur al betaald was (anders gaat ze af bij die betaling).
    switch (x.creditOf) {
      case (?oid) {
        switch (purchases.purchases.get(oid)) {
          case (?o) {
            if (Purchase.settled(x)) { return #err("Deze creditnota is verrekend met de betaling van factuur " # o.number # ": ze volgt die betaling") };
            if (o.paidDay == null and day != null) { return #err("Deze creditnota gaat af van factuur " # o.number # ": markeer die factuur als betaald") };
          };
          case null {};
        };
      };
      case null {};
    };
    let now = Time.now();
    // Review M2: de creditnota's die nog van de factuur afgingen, zijn met deze betaling verrekend (en terug open als de betaling
    // wegvalt; een creditnota die apart verrekend werd, blijft apart). De inhouding ligt vast op het moment van de betaling.
    if (x.creditOf == null) {
      for (c in Purchase.creditsOf(purchases, x.id).values()) {
        switch (x.paidDay, day) {
          case (null, ?d) { if (Purchase.deducts(x, c)) { purchases.purchases.add(c.id, { c with paidDay = ?d; extra = OaDeals.extraSet(c.extra, "verrekend", "ja"); rev = c.rev + 1; updatedAt = now; updatedBy = p.id }) } };
          case (?_, ?d) { if (Purchase.settled(c) and c.paidDay != ?d) { purchases.purchases.add(c.id, { c with paidDay = ?d; rev = c.rev + 1; updatedAt = now; updatedBy = p.id }) } };
          case (?_, null) { if (Purchase.settled(c)) { purchases.purchases.add(c.id, { c with paidDay = null; extra = c.extra.filter(func((k, _) : (Text, Text)) : Bool = k != "verrekend"); rev = c.rev + 1; updatedAt = now; updatedBy = p.id }) } };
          case (null, null) {};
        };
      };
      switch (x.paidDay, day) {
        case (null, ?_) { puFreezeWithhold(x, ?(soc, fis)) };
        case (?_, null) { puFreezeWithhold(x, null) };
        case _ {};
      };
    };
    purchases.purchases.add(id, { x with paidDay = day; withheldDay; rev = x.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, puFirstWork(x), "aankoop-betaald", puOrgName(x.orgId) # " " # x.number # ": " # (switch day { case (?d) "betaald op " # Plan.fmtDay(d); case null "niet betaald" }) # (if (soc + fis > 0) (switch withheldDay { case (?d) ", inhouding doorgestort op " # Plan.fmtDay(d); case null ", inhouding nog niet doorgestort" }) else ""));
    #ok;
  };

  // ── Uren bevestigen (werfleider van de werf; GEEN bedrag) ───────────────
  // De dagen met uren op OA-facturen die als vraag naar de werfleider gaan (instelling: enkel bij een verschil met het werfverslag,
  // of altijd), van de werven waar hij dat mag; ook al beantwoorde dagen zolang het werfdeel open is.
  public query ({ caller }) func listHourClaims(workId : ?Nat) : async [PV.HourClaimView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    switch workId { case (?w) Rights.require(ctx, p, #confirmHourClaims, ?w); case null { if (not Rights.caps(ctx, p).hourClaims) { Runtime.trap("Geen toegang") } } };
    let ids = switch workId { case (?w) Quotes.ids(purchases.claimsByWork, w); case null purchases.claims.keys().toArray() };
    let out = List.empty<PV.HourClaimView>();
    for (cid in ids.values()) {
      switch (purchases.claims.get(cid)) {
        case (?c) {
          if (Rights.may(ctx, p, #confirmHourClaims, ?c.workId) and puClaimOpen(c)) {
            let st = Purchase.claimState(settings, reports, c);
            if (st != "geen-vraag") { out.add(puClaimView(c, st, p)) };
          };
        };
        case null {};
      };
    };
    out.toArray().sort(func(a, b) = if (a.day != b.day) Nat.compare(b.day, a.day) else Nat.compare(a.id, b.id));
  };

  public shared ({ caller }) func reviewHourClaim(id : Nat, ok : Bool, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let c = switch (purchases.claims.get(id)) { case (?y) y; case null return #err("Geen toegang") };
    if (not Rights.may({ works; settings }, p, #confirmHourClaims, ?c.workId)) { return #err("Geen toegang") };
    if (not puClaimOpen(c)) { return #err("Deze factuur is al beslist of ingetrokken") };
    let why = note.trim(#char ' ');
    if (why.size() > Config.maxQuoteReason) { return #err("Reden: hoogstens " # Config.maxQuoteReason.toText() # " tekens") };
    if (not ok and why.size() < Config.minQuoteReason) { return #err("Klopt niet: geef een reden (5 tot 300 tekens)") };
    purchases.claims.add(id, { c with review = ?{ by = p.id; at = Time.now(); ok; note = why } });
    let what = puOrgName(c.orgId) # " " # Plan.fmtDay(c.day) # ": " # c.persons.toText() # " pers., " # puHours(c.hoursMilli) # " u";
    Access.audit(audit, caller, ?p.id, ?c.workId, if ok "uren-klopt" else "uren-klopt-niet", what # (if ok "" else " — " # why));
    if (not ok) { OaDeals.notifyOffice(access, audit, ctr, "Uren op factuur " # puNumber(c.purchaseId) # " kloppen niet volgens de werfleider (" # what # "): " # why, ?c.workId) };
    #ok;
  };

  // ── De OA: de stand van zijn eigen facturen (per factuur, niet per werfdeel) ─
  public query ({ caller }) func myPurchases() : async [PV.MyPurchaseView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #ownOaInvoices, null);
    let own = switch (p.orgId) { case (?o) o; case null Runtime.trap("Geen toegang") };
    let notice = OaInvoice.disputeNotice(settings);
    let out = List.empty<PV.MyPurchaseView>();
    for (x in purchases.purchases.values()) {
      if (x.orgId == own and x.kind == #oa and x.status != #withdrawn) {
        let reason = switch (x.status) {
          case (#disputed) { if (notice == "uit") "" else { var r = ""; for (pid in x.parts.values()) { switch (oaInvoices.invoices.get(pid)) { case (?i) { switch (i.status, i.decision) { case (#disputed, ?d) { r := d.reason }; case _ {} } }; case null {} } }; r } };
          case _ "";
        };
        // Review M5: de dagen die niet kloppen pas als het werfdeel van die werf betwist is, en de notitie enkel als de instelling dat toelaat.
        let partDisputed = func(w : Nat) : Bool = x.parts.any(func(pid : Nat) : Bool = switch (oaInvoices.invoices.get(pid)) { case (?i) i.workId == w and i.status == #disputed; case null false });
        let disputed = if (notice == "uit") [] else Purchase.claimsOf(purchases, x.id).filterMap(func(c : Types.HourClaim) : ?PV.MyDisputedDay = switch (c.review) { case (?r) { if (r.ok or not partDisputed(c.workId)) null else ?{ day = c.day; persons = c.persons; hoursMilli = c.hoursMilli; note = r.note } }; case null null });
        var decided : ?Int = null;
        for (pid in x.parts.values()) { switch (oaInvoices.invoices.get(pid)) { case (?i) { switch (i.decision) { case (?d) { decided := ?d.at }; case null {} } }; case null {} } };
        out.add({ number = x.number; invoiceDay = x.invoiceDay; status = x.status; works = puWorksOf(x).map(puWorkName); decidedAt = decided; reason; disputedDays = disputed });
      };
    };
    out.toArray().sort(func(a, b) = Nat.compare(b.invoiceDay, a.invoiceDay));
  };

  // ── Hulp ───────────────────────────────────────────────────────────────
  func puCtx() : OaInvoice.Ctx { { settings; access; org; works; plan; reports; qs = quotes; starts = workStarts; ss = surveys; oi = oaInvoices; deals = oaDeals; pur = purchases } };
  func puOrgName(o : Nat) : Text { switch (org.orgs.get(o)) { case (?x) x.name; case null "#" # o.toText() } };
  func puWorkName(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.name; case null "" } };
  func puWorkCode(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.code; case null "" } };
  func puNumber(id : Nat) : Text { switch (purchases.purchases.get(id)) { case (?x) x.number; case null "#" # id.toText() } };
  func puAmounts(x : Types.Purchase) : Types.PurchaseAmounts {
    switch (Purchase.amountsOf(purchases, x.id)) { case (?a) a; case null { { purchaseId = x.id; netCents = 0; vatCents = 0; totalCents = 0; discountBp = null; lines = []; extra = [] } } };
  };
  func puWorksOf(x : Types.Purchase) : [Nat] { Purchase.worksOf(puAmounts(x)) };
  func puFirstWork(x : Types.Purchase) : ?Nat { let ws = puWorksOf(x); if (ws.size() > 0) ?ws[0] else null };
  func puHours(m : Int) : Text {
    let a = Int.abs(m);
    let frac = a % 1000;
    (if (m < 0) "-" else "") # (a / 1000).toText() # (if (frac == 0) "" else "," # Text.fromIter((1000 + frac).toText().chars().drop(1)).trimEnd(#char '0'));
  };
  func puPct(bp : Nat) : Text { let f = bp % 100; (bp / 100).toText() # (if (f == 0) "" else "," # Text.fromIter((100 + f).toText().chars().drop(1)).trimEnd(#char '0')) # " %" };
  func puDiscount(x : Types.Purchase, a : Types.PurchaseAmounts, today : Nat) : ?Int {
    switch (x.discountUntil, a.discountBp) { case (?u, ?bp) { if (u >= today) ?QuoteCalc.roundDiv(a.netCents * bp, 10_000) else null }; case _ null };
  };
  // De inhouding van een aankoop (review H2): het zwaarste resultaat bij de goedgekeurde werfdelen op Σ werfdelen excl. btw.
  // 2c.8+ B: op het bedrag na de goedgekeurde creditnota's (nooit negatief).
  // Review M2: bij de betaling bevroren (PurchaseAmounts.extra "inhouding" = "<RSZ>/<FOD>", vertrouwelijk); daarna verandert een
  // latere creditnota de inhouding niet meer. Niet betaald: op het bedrag na de creditnota's die ervan afgaan.
  func puWithhold(x : Types.Purchase) : (Int, Int) { puWithholdIn(x, Purchase.creditsOf(purchases, x.id)) };
  func puWithholdIn(x : Types.Purchase, cs : [Types.Purchase]) : (Int, Int) {
    if (x.paidDay != null) { switch (puFrozenWithhold(x)) { case (?w) { return w }; case null {} } };
    let (cn, _) = Purchase.sumCredits(purchases, cs.filter(func(c : Types.Purchase) : Bool = Purchase.deducts(x, c)));
    let b = Purchase.partsNet(oaInvoices, x) - cn;
    switch (Purchase.withholdingResult(oaInvoices, x)) { case (?r) OaInvoice.withholdingCents(r, if (b > 0) b else 0); case null (0, 0) };
  };
  func puFrozenWithhold(x : Types.Purchase) : ?(Int, Int) {
    let v = OaDeals.extraGet(puAmounts(x).extra, "inhouding");
    if (v == "") { return null };
    let parts = v.split(#char '/').toArray();
    if (parts.size() != 2) { return null };
    switch (Nat.fromText(parts[0]), Nat.fromText(parts[1])) { case (?a, ?b) ?(a, b); case _ null };
  };
  func puFreezeWithhold(x : Types.Purchase, w : ?(Int, Int)) {
    switch (Purchase.amountsOf(purchases, x.id)) {
      case (?a) {
        let rest = a.extra.filter(func((k, _) : (Text, Text)) : Bool = k != "inhouding");
        let extra = switch w { case (?(s, f)) rest.concat([("inhouding", Int.abs(s).toText() # "/" # Int.abs(f).toText())]); case null rest };
        purchases.amounts.add(x.id, #plain({ a with extra }));
      };
      case null {};
    };
  };

  // De korte vorm van een OA-factuur van 2.11 (zoals oiBrief in OaInvoiceApi) voor Te betalen.
  func puOaBrief(i : Types.OaInvoice) : OV.OaInvoiceBrief {
    let w = works.works.get(i.workId);
    {
      id = i.id;
      orgId = i.orgId;
      orgName = puOrgName(i.orgId);
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
      purchaseId = purchases.partOf.get(i.id);
    };
  };  func puExtraDay(x : Types.Extra, k : Text) : ?Nat { Nat.fromText(OaDeals.extraGet(x, k)) };
  // De inhouding van een OA-factuur van 2.11: het resultaat van de raadpleging bij het goedkeuren, op het bedrag excl. btw.
  func puOaWithhold(i : Types.OaInvoice) : (Int, Int) {
    let net = switch (OaInvoice.amountsOf(oaInvoices, i.id)) { case (?a) a.netCents; case null 0 };
    switch (i.decision) { case (?d) { switch (d.withholding) { case (?#check c) OaInvoice.withholdingCents(c.result, net); case _ (0, 0) } }; case null (0, 0) };
  };
  func puClaimSig(w : Nat, day : Nat, persons : Nat, slots : [Types.TimeSlot], pause : Nat) : Text {
    var s = w.toText() # "|" # day.toText() # "|" # persons.toText() # "|" # pause.toText();
    for (t in slots.values()) { s := s # "|" # t.fromMin.toText() # "-" # t.toMin.toText() };
    s;
  };
  func puDropClaim(c : Types.HourClaim) {
    purchases.claims.remove(c.id);
    purchases.claimsByWork.add(c.workId, Quotes.ids(purchases.claimsByWork, c.workId).filter(func y = y != c.id));
  };
  // Een dag is open zolang de aankoop meetelt (niet ingetrokken) en het werfdeel van die werf nog niet goedgekeurd is.
  func puClaimOpen(c : Types.HourClaim) : Bool {
    let x = switch (purchases.purchases.get(c.purchaseId)) { case (?y) y; case null return false };
    if (x.status == #withdrawn or x.status == #approved) { return false };
    for (pid in x.parts.values()) { switch (oaInvoices.invoices.get(pid)) { case (?i) { if (i.workId == c.workId and (i.status == #approved or i.status == #withdrawn)) { return false } }; case null {} } };
    true;
  };
  func puClaimView(c : Types.HourClaim, st : Text, p : Types.Person) : PV.HourClaimView {
    let (rn, rh) = Purchase.reportHours(reports, c.workId, c.orgId, c.day);
    let x = purchases.purchases.get(c.purchaseId);
    {
      id = c.id;
      workId = c.workId;
      workCode = puWorkCode(c.workId);
      workName = puWorkName(c.workId);
      orgName = puOrgName(c.orgId);
      number = switch x { case (?y) y.number; case null "" };
      invoiceDay = switch x { case (?y) y.invoiceDay; case null 0 };
      day = c.day;
      persons = c.persons;
      slots = c.slots;
      pauseMin = c.pauseMin;
      hoursMilli = c.hoursMilli;
      reportPersons = rn;
      reportMilli = rh;
      diffMilli = c.hoursMilli - rh;
      state = st;
      reviewNote = switch (c.review) { case (?r) r.note; case null "" };
      reviewByName = switch (c.review) { case (?r) Access.personName(access, r.by); case null "" };
      reviewedAt = switch (c.review) { case (?r) ?r.at; case null null };
      canReview = puClaimOpen(c) and Rights.may({ works; settings }, p, #confirmHourClaims, ?c.workId);
    };
  };

  // De werfdelen van een OA-aankoop gelijkzetten: per werf één OA-factuur van 2.11 (bijwerken of nieuw), een werf die wegviel →
  // ingetrokken. Geeft alle delen (ook de vroeger ingetrokken).
  func puSyncParts(x : Types.Purchase, a : Types.PurchaseAmounts, workIds : [Nat], now : Int, by : Nat) : [Nat] {
    let live = Map.empty<Nat, Types.OaInvoice>();
    let out = List.empty<Nat>();
    for (pid in x.parts.values()) {
      switch (oaInvoices.invoices.get(pid)) {
        case (?i) { if (i.status != #withdrawn and live.get(i.workId) == null) { live.add(i.workId, i) } else { out.add(pid) } };
        case null {};
      };
    };
    // Review L4: btw per deel afgerond, het laatste deel krijgt de rest, zodat Σ delen = de btw van de factuur.
    var vatLeft : Int = a.vatCents;
    var n = 0;
    for (w in workIds.values()) {
      n += 1;
      let pls = Purchase.linesOfWork(a, w);
      let ls = pls.map(Purchase.partLine);
      var net : Int = 0;
      for (l in ls.values()) { net += l.amountCents };
      let vat = switch (x.vatRegime) { case (#reverse) 0; case (#normal bp) { if (n == workIds.size()) vatLeft else QuoteCalc.roundDiv(net * bp, 10_000) } };
      vatLeft -= vat;
      var minD : ?Nat = null;
      var maxD : ?Nat = null;
      for (l in pls.values()) { for (cid in l.claimIds.values()) { switch (purchases.claims.get(cid)) { case (?c) { minD := ?(switch minD { case (?m) Nat.min(m, c.day); case null c.day }); maxD := ?(switch maxD { case (?m) Nat.max(m, c.day); case null c.day }) }; case null {} } } };
      let pf = switch (x.periodFrom) { case (?f) ?f; case null minD };
      let pt = switch (x.periodTo) { case (?t) ?t; case null maxD };
      let pid = switch (live.get(w)) {
        case (?i) {
          for (k in [OaInvoice.keyOf(i.orgId, i.number), Purchase.partKey(i.orgId, i.number, i.workId)].values()) { if (oaInvoices.keys.get(k) == ?i.id) { oaInvoices.keys.remove(k) } };
          oaInvoices.invoices.add(i.id, { i with orgId = x.orgId; number = x.number; invoiceDay = x.invoiceDay; dueDay = x.dueDay; periodFrom = pf; periodTo = pt; vatRegime = x.vatRegime; reverseMention = x.reverseMention; fileId = x.fileId; note = x.note; status = if (i.status == #disputed) #registered else i.status; rev = i.rev + 1; updatedAt = now; updatedBy = by });
          live.remove(w);
          i.id;
        };
        case null {
          let nid = Ids.next(ctr, "oaInvoice");
          oaInvoices.invoices.add(nid, { id = nid; orgId = x.orgId; workId = w; number = x.number; invoiceDay = x.invoiceDay; dueDay = x.dueDay; periodFrom = pf; periodTo = pt; vatRegime = x.vatRegime; reverseMention = x.reverseMention; fileId = x.fileId; status = #registered; decision = null; note = x.note; source = "aankoop"; externalRef = ""; rev = 0; createdAt = now; createdBy = by; updatedAt = now; updatedBy = by; extra = [("aankoop", x.id.toText())] });
          Quotes.addIndex(oaInvoices.byWork, w, nid);
          purchases.partOf.add(nid, x.id);
          nid;
        };
      };
      oaInvoices.keys.add(Purchase.partKey(x.orgId, x.number, w), pid);
      oaInvoices.amounts.add(pid, #plain({ invoiceId = pid; netCents = net; vatCents = vat; totalCents = net + vat; lines = ls; extra = [] }));
      out.add(pid);
    };
    // Een werf die niet meer op de factuur staat: het werfdeel wordt ingetrokken.
    for (i in live.values()) { puWithdrawPart(i, now, by, "werf niet meer op de factuur"); out.add(i.id) };
    out.toArray();
  };

  func puWithdrawPart(i : Types.OaInvoice, now : Int, by : Nat, why : Text) {
    for (k in [OaInvoice.keyOf(i.orgId, i.number), Purchase.partKey(i.orgId, i.number, i.workId)].values()) { if (oaInvoices.keys.get(k) == ?i.id) { oaInvoices.keys.remove(k) } };
    oaInvoices.invoices.add(i.id, { i with status = #withdrawn; note = (if (i.note == "") "" else i.note # "\n") # "Ingetrokken: " # why; rev = i.rev + 1; updatedAt = now; updatedBy = by });
  };

  func puEndParts(x : Types.Purchase, now : Int, by : Nat, why : Text) {
    for (pid in x.parts.values()) { switch (oaInvoices.invoices.get(pid)) { case (?i) { if (i.status != #withdrawn) { puWithdrawPart(i, now, by, why) } }; case null {} } };
  };

  func puCheckLine(x : PV.PurchaseInput, l : PV.PurchaseLineInput, k : Types.CostKind, today : Nat) : ?Text {
    if (l.description.size() > Config.maxName * 3) { return ?("Omschrijving van een regel: hoogstens " # (Config.maxName * 3).toText() # " tekens") };
    if (l.unit.size() > 20) { return ?"Eenheid: hoogstens 20 tekens" };
    if (Int.abs(l.qtyMilli) > Int.abs(Config.maxProgressQtyMilli) or Int.abs(l.unitCents) > Int.abs(Config.maxAmountCents) or Int.abs(l.amountCents) > Int.abs(Config.maxAmountCents)) { return ?"Regel: waarde te groot" };
    let oaOnly = switch k { case (#post or #regie or #crew or #advance or #advanceDeduct) true; case _ false };
    if (oaOnly and x.kind != #oa) { return ?("«" # Purchase.costName(k) # "» staat enkel op een OA-factuur") };
    let w = switch (l.workId) {
      case (?w) w;
      case null {
        // Review H1: bij een OA hoort elke regel bij een werf (een werfdeel), zodat de controle en de inhoudingsplicht ze dekken.
        if (x.kind == #oa) { return ?"Bij een OA-factuur hoort elke regel bij een werf (kies de werf, ook voor een algemene kost)" };
        if (not Purchase.isCost(k)) { return ?("Een regel «" # Purchase.costName(k) # "» hoort bij een werf") };
        if (l.root != null or l.days.size() > 0) { return ?"Een algemene kost hangt aan geen post en heeft geen uren per dag" };
        return null;
      };
    };
    switch (works.works.get(w)) { case (?y) { if (y.archivedAt != null) { return ?"Een regel staat op een gearchiveerde werf" } }; case null { return ?"Onbekende werf" } };
    let ps = OaInvoice.posts(puCtx(), w);
    switch (k, l.root) {
      case (#post, ?r) { if (not ps.containsKey(r)) { return ?"Een regel verwijst naar een post die niet in de getekende offerte van die werf staat" } };
      case (#post, null) { return ?"Een regel van soort post vraagt een post" };
      case (#regie or #crew, ?r) { switch (ps.get(r)) { case (?pp) { if (pp.form != #regie) { return ?"Een regieregel hoort bij een regiepost" } }; case null { return ?"Onbekende regiepost" } } };
      case (#regie or #crew, null) {};
      case (_, ?_) { return ?("Een regel «" # Purchase.costName(k) # "» hangt aan geen post") };
      case (_, null) {};
    };
    switch (k, l.persons) {
      case (#crew, ?n) { if (n == 0 or n > 50) { return ?"Ploeguren: 1 tot 50 personen" } };
      case (#crew, null) { return ?"Ploeguren: geef het aantal personen" };
      case _ {};
    };
    if (k == #advance or k == #advanceDeduct) {
      if (OaDeals.agreementOf(oaDeals, w, x.orgId) == null) { return ?"Een voorschot hoort bij een afspraak met deze OA op die werf (Wie werkt mee)" };
      if (k == #advance and l.amountCents <= 0) { return ?"Voorschot: een positief bedrag" };
      if (k == #advanceDeduct and l.amountCents >= 0) { return ?"Aftrek voorschot: een negatief bedrag" };
    };
    if (l.days.size() > 0 and not Purchase.isHours(k)) { return ?"Uren per dag enkel bij regie of ploeguren" };
    if (l.days.size() > 62) { return ?"Hoogstens 62 dagen per regel" };
    let seen = Map.empty<Nat, ()>();
    for (d in l.days.values()) {
      if (d.day > today or d.day + 730 < today) { return ?"Een dag met uren: vandaag of de voorbije twee jaar" };
      if (seen.containsKey(d.day)) { return ?("De dag " # Plan.fmtDay(d.day) # " staat twee keer op dezelfde regel") };
      seen.add(d.day, ());
      if (d.persons == 0 or d.persons > 50) { return ?"Een dag met uren: 1 tot 50 personen" };
      switch (Purchase.slotsError(d.slots, d.pauseMin)) { case (?e) { return ?(Plan.fmtDay(d.day) # ": " # e) }; case null {} };
    };
    null;
  };

  // 2c.8+ B: een creditnota nakijken tegenover de gecrediteerde aankoop (self = de creditnota zelf bij verbeteren).
  func puCheckCredit(x : PV.PurchaseInput, oid : Nat, self : ?Nat) : ?Text {
    let o = switch (purchases.purchases.get(oid)) { case (?y) y; case null return ?"Onbekende factuur om te crediteren" };
    if (o.creditOf != null) { return ?"Een creditnota crediteer je niet" };
    // Review M3: enkel op een goedgekeurde factuur (anders blijft die vast: niet te betwisten, niet te verbeteren).
    if (o.status != #approved) { return ?("Een creditnota hoort bij een goedgekeurde factuur (deze is " # Purchase.statusKey(o.status) # ")") };
    if (o.orgId != x.orgId or o.kind != x.kind) { return ?"Een creditnota is van dezelfde firma en soort als de factuur" };
    if (x.discountUntil != null or x.discountBp != null or x.finalWorkIds.size() > 0) { return ?"Een creditnota heeft geen betaalkorting en is geen laatste factuur" };
    if (x.netCents <= 0 or x.totalCents <= 0 or x.vatCents < 0) { return ?"Een creditnota: positieve bedragen zoals op het document (het teken volgt uit de creditnota)" };
    let oa = puAmounts(o);
    let cs = Purchase.creditsOf(purchases, oid);
    let seen = Map.empty<Nat, ()>();
    for (l in x.lines.values()) {
      let lid = switch (l.lineId) { case (?y) y; case null return ?"Elke regel van een creditnota crediteert een regel van de factuur" };
      if (seen.containsKey(lid)) { return ?"Een regel van de factuur staat twee keer op de creditnota" };
      seen.add(lid, ());
      let ol = switch (oa.lines.find(func(y : Types.PurchaseLine) : Bool = y.lineId == lid)) { case (?y) y; case null return ?"Een regel van de creditnota verwijst naar een regel die niet op de factuur staat" };
      if (l.workId != ol.workId or l.kind != Purchase.costKey(ol.kind) or l.root != ol.root or l.persons != ol.persons) { return ?"Een regel van de creditnota volgt werf, soort en post van de gecrediteerde regel" };
      if (ol.kind == #advanceDeduct) { return ?"Een aftrek van een voorschot crediteer je niet: verbeter de volgende factuur" };
      if (l.days.size() > 0) { return ?"Een creditnota heeft geen uren per dag" };
      if (l.qtyMilli < 0 or l.unitCents < 0 or l.amountCents <= 0) { return ?"Een regel van een creditnota: positieve hoeveelheid, prijs en bedrag (het teken volgt uit de creditnota)" };
      // Review L1: een regel van 0 of minder (korting, aftrek) crediteer je niet.
      if (ol.amountCents <= 0) { return ?("Regel «" # ol.description # "» heeft geen positief bedrag: die crediteer je niet") };
      let rest = ol.amountCents - Purchase.creditedLineIn(purchases, cs, lid, self);
      if (l.amountCents > rest) { return ?("Regel «" # ol.description # "»: hoogstens " # Progress.euro(rest) # " te crediteren") };
      // Review L2: een voorschot hoogstens tot wat er nog niet van afgetrokken is.
      if (ol.kind == #advance) {
        switch (ol.workId, puAdvanceRoom(oid, ol.workId, lid, self)) {
          case (?_, ?room) { if (l.amountCents > room) { return ?("Voorschot «" # ol.description # "»: hoogstens " # Progress.euro(if (room > 0) room else 0) # " te crediteren (de rest is al afgetrokken)") } };
          case _ {};
        };
      };
    };
    let (cn, _) = Purchase.sumCredits(purchases, cs.filter(func(c : Types.Purchase) : Bool = ?c.id != self and Purchase.counts(c.status)));
    if (x.netCents > oa.netCents - cn) { return ?("De creditnota is meer dan wat van de factuur overblijft (" # Progress.euro(oa.netCents - cn) # " excl. btw)") };
    null;
  };
  // Wat van het voorschot van aankoop `oid` op die werf nog niet afgetrokken is (de creditnota `self` zelf terug erbij).
  func puAdvanceRoom(oid : Nat, workId : ?Nat, lid : Nat, self : ?Nat) : ?Int {
    let w = switch workId { case (?x) x; case null return null };
    for ((k, c) in purchases.advances.entries()) {
      switch (Purchase.plain(c)) {
        case (?a) {
          if (a.purchaseId == oid and (switch (oaInvoices.invoices.get(k)) { case (?i) i.workId == w; case null false })) {
            var used : Int = 0;
            for ((_, x) in a.deducted.values()) { used += x };
            var mine : Int = 0;
            switch self {
              case (?sid) { switch (Purchase.amountsOf(purchases, sid)) { case (?sa) { for (l in sa.lines.values()) { if (l.lineId == lid and l.workId == ?w) { mine += l.amountCents } } }; case null {} } };
              case null {};
            };
            return ?(a.cents + mine - used);
          };
        };
        case null {};
      };
    };
    null;
  };
  func puOrigLine(oid : Nat, lid : Nat) : Types.PurchaseLine {
    let o = switch (purchases.purchases.get(oid)) { case (?y) y; case null Runtime.trap("Onbekende factuur") };
    switch (puAmounts(o).lines.find(func(y : Types.PurchaseLine) : Bool = y.lineId == lid)) { case (?y) y; case null Runtime.trap("Onbekende regel") };
  };

  func puBrief(x : Types.Purchase) : PV.PurchaseBrief {
    let a = puAmounts(x);
    let ws = Purchase.worksOf(a);
    let refs = ws.map(
      func(w : Nat) : PV.PurchaseWorkRef {
        var part : ?Types.OaInvoice = null;
        for (pid in x.parts.values()) { switch (oaInvoices.invoices.get(pid)) { case (?i) { if (i.workId == w and i.status != #withdrawn) { part := ?i } }; case null {} } };
        { workId = w; workCode = puWorkCode(w); workName = puWorkName(w); partId = switch part { case (?i) ?i.id; case null null }; partStatus = switch part { case (?i) ?i.status; case null null } };
      }
    );
    var open = 0;
    if (Purchase.counts(x.status)) { for (c in Purchase.claimsOf(purchases, x.id).values()) { if (puClaimOpen(c) and Purchase.claimState(settings, reports, c) == "te-bevestigen") { open += 1 } } };
    {
      id = x.id;
      orgId = x.orgId;
      orgName = puOrgName(x.orgId);
      kind = x.kind;
      number = x.number;
      invoiceDay = x.invoiceDay;
      dueDay = x.dueDay;
      discountUntil = x.discountUntil;
      status = x.status;
      works = refs;
      general = a.lines.any(func(l : Types.PurchaseLine) : Bool = l.workId == null);
      lineCount = a.lines.size();
      hasFile = x.fileId != null;
      hasStatement = x.oaStatementFileId != null;
      paidDay = x.paidDay;
      withheldDay = x.withheldDay;
      creditOf = x.creditOf;
      creditOfNumber = switch (x.creditOf) { case (?o) puNumber(o); case null "" };
      openClaims = open;
      updatedAt = x.updatedAt;
      rev = x.rev;
    };
  };

  func puFlag(f : Text) : OV.OaFlag { { key = f; text = OaInvoice.flagText(f) } };

  func puFull(x : Types.Purchase) : PV.PurchaseFullView {
    let a = puAmounts(x);
    let today = Dossier.today();
    // Review M4: de creditnota's van deze aankoop één keer opzoeken.
    let cs = if (x.creditOf == null) Purchase.creditsOf(purchases, x.id) else [];
    // De controle van elk werfdeel (2.11 + 2c.7), één keer per werf.
    let controls = Map.empty<Nat, OaInvoice.Control>();
    for (pid in x.parts.values()) {
      switch (oaInvoices.invoices.get(pid), OaInvoice.amountsOf(oaInvoices, pid)) {
        case (?i, ?pa) { if (i.status != #withdrawn) { controls.add(i.workId, OaInvoice.control(puCtx(), i, pa)) } };
        case _ {};
      };
    };
    let postsBy = Map.empty<Nat, Map.Map<Nat, OaInvoice.PostInfo>>();
    let seenOnWork = Map.empty<Nat, Nat>();
    var lineFlags = 0;
    var k = 0;
    let lines = List.empty<PV.PurchaseLineView>();
    for (l in a.lines.values()) {
      let (qf, mf, agreed) : ([Text], [Text], ?Int) = switch (l.workId) {
        case (?w) {
          let j = switch (seenOnWork.get(w)) { case (?n) n; case null 0 };
          seenOnWork.add(w, j + 1);
          switch (controls.get(w)) {
            case (?c) { if (j < c.lines.size()) (c.lines[j].qtyFlags, c.lines[j].moneyFlags, c.lines[j].agreedCents) else ([], [], null) };
            case null { (puOwnFlags(l), [], null) };
          };
        };
        case null { (puOwnFlags(l), [], null) };
      };
      if (controls.size() == 0 or l.workId == null) { lineFlags += qf.size() + mf.size() };
      let postTitle = switch (l.workId, l.root) {
        case (?w, ?r) {
          let ps = switch (postsBy.get(w)) { case (?m) m; case null { let m = OaInvoice.posts(puCtx(), w); postsBy.add(w, m); m } };
          switch (ps.get(r)) { case (?pp) pp.title; case null "" };
        };
        case _ "";
      };
      let cls = l.claimIds.filterMap(func(id : Nat) : ?Types.HourClaim = purchases.claims.get(id));
      let (calc, dayTotal) = switch (l.workId) { case (?w) Purchase.dayCalc(oaDeals, l, cls, w, x.orgId); case null ([], null) };
      let days = Array.tabulate<PV.PurchaseDayView>(
        cls.size(),
        func(i) {
          let c = cls[i];
          let (rn, rh) = Purchase.reportHours(reports, c.workId, c.orgId, c.day);
          let dc = calc[i];
          { claimId = c.id; day = c.day; persons = c.persons; slots = c.slots; pauseMin = c.pauseMin; hoursMilli = c.hoursMilli; reportPersons = rn; reportMilli = rh; diffMilli = c.hoursMilli - rh; state = Purchase.claimState(settings, reports, c); reviewNote = switch (c.review) { case (?r) r.note; case null "" }; reviewByName = switch (c.review) { case (?r) Access.personName(access, r.by); case null "" }; rateCents = dc.rateCents; rateFrom = dc.rateFrom; cents = dc.cents };
        },
      );
      lines.add({ index = k; lineId = l.lineId; workId = l.workId; workCode = switch (l.workId) { case (?w) puWorkCode(w); case null "" }; kind = Purchase.costKey(l.kind); kindName = Purchase.costName(l.kind); root = l.root; postTitle; description = l.description; persons = l.persons; qtyMilli = l.qtyMilli; unit = l.unit; unitCents = l.unitCents; amountCents = l.amountCents; passOn = l.passOn; days; dayCents = dayTotal; agreedCents = agreed; qtyFlags = qf.map(puFlag); moneyFlags = mf.map(puFlag); creditedCents = if (x.creditOf == null) Purchase.creditedLineIn(purchases, cs, l.lineId, null) else 0 });
      k += 1;
    };
    // De aankoop zelf: som, btw, totaal, bijlage (de werfdelen rekenen hun deel uit de regels).
    let (hf0, sum, expVat) = Purchase.headerFlags(x, a, org);
    let pnet = Purchase.partsNet(oaInvoices, x);
    let hf = if (x.parts.size() > 0 and pnet != a.netCents) hf0.concat(["som-werfdelen"]) else hf0;
    let (wSoc, wFis) = puWithholdIn(x, cs);
    let final = func(w : Nat) : Bool = OaDeals.extraGet(x.extra, "slot:" # w.toText()) == "ja";
    let advances = if (x.kind != #oa) [] else Purchase.worksOf(a).filterMap(
      func(w : Nat) : ?PV.PurchaseAdvanceView {
        let allowed = Purchase.allowedAdvance(oaDeals, w, x.orgId);
        let (adv, ded) = Purchase.advanceSums(purchases, w, x.orgId, null, null);
        if (allowed == null and adv == 0 and ded == 0) null else ?{ workId = w; workCode = puWorkCode(w); allowedCents = allowed; advancedCents = adv; deductedCents = ded; restCents = adv - ded; final = final(w) };
      }
    );
    let decision = switch (x.decision) { case (?d) ?{ at = d.at; byName = Access.personName(access, d.by); approved = d.approved; reason = d.reason; flags = d.flags }; case null null };
    let allRegistered = x.parts.all(func(pid : Nat) : Bool = switch (oaInvoices.invoices.get(pid)) { case (?i) i.status != #approved; case null true });
    {
      brief = puBrief(x);
      note = x.note;
      periodFrom = x.periodFrom;
      periodTo = x.periodTo;
      vatRegime = x.vatRegime;
      reverseMention = x.reverseMention;
      oaStatementRef = x.oaStatementRef;
      netCents = a.netCents;
      vatCents = a.vatCents;
      totalCents = a.totalCents;
      discountBp = a.discountBp;
      discountCents = switch (a.discountBp) { case (?bp) ?QuoteCalc.roundDiv(a.netCents * bp, 10_000); case null null };
      partsNetCents = pnet;
      withholdSocialCents = wSoc;
      withholdFiscalCents = wFis;
      sumLinesCents = sum;
      expectedVatCents = expVat;
      headerFlags = hf.map(puFlag);
      flagCount = hf.size() + lineFlags;
      lines = lines.toArray();
      credits = cs.map(func(c : Types.Purchase) : PV.PurchaseCreditRef { let ca = puAmounts(c); { id = c.id; number = c.number; invoiceDay = c.invoiceDay; status = c.status; netCents = ca.netCents; totalCents = ca.totalCents } });
      advances;
      file = puFile(x.fileId);
      statement = puFile(x.oaStatementFileId);
      decision;
      attestWarnings = if (x.kind == #oa) OaDeals.attestWarnings(oaDeals, settings, org, x.orgId, today) else [];
      finalWorkIds = Purchase.worksOf(a).filter(final);
      canEdit = (x.status == #registered or x.status == #disputed) and allRegistered and cs.size() == 0;
      canDecide = x.parts.size() == 0 and (x.status == #registered or x.status == #disputed);
      canPay = x.status == #approved;
    };
  };

  // Een regel zonder werfdeel (leverancier, algemene kost): enkel de rekenfout (hoeveelheid × eenheidsprijs).
  func puOwnFlags(l : Types.PurchaseLine) : [Text] {
    if (l.qtyMilli != 0 and Int.abs(l.amountCents - QuoteCalc.roundDiv(l.qtyMilli * l.unitCents, 1000)) > 1) ["rekenfout"] else [];
  };

  func puFile(f : ?Nat) : ?Views.FileView {
    switch f { case (?fid) { switch (files.files.get(fid)) { case (?x) ?{ Dossier.fileView(x) with blob = null }; case null null } }; case null null };
  };

};
