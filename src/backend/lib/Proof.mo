// Proefbank (stap 3.5, bouwplan §6 "Autonomie per taak"; ontwerp: BOWACO_verslag_3.5.md §1).
// - Taken met een proefbank (tasks): de echte tool van de bot, de AI-fiche van Caffeine en de antwoordvelden met hun vergelijking.
// - Testset uit de historiek: wat een INTERNE persoon al koppelde en zo bleef (nooit wat een bot deed: bot-merk = geen waarheid).
// - Een geval toont enkel de invoer (bv. naam, type, grootte van een bestand), NOOIT de verwijzing (id), de werf of het antwoord.
// - Score: alle velden gelijk = juist; geen antwoord = fout; een intussen onbruikbaar geval = vervallen (niet in de noemer).
// - Drempel (gate): de LAATSTE gesloten ronde van dat onderwerp voor die taak, met dezelfde labels als nu, ≥ proofMinPct % op
//   ≥ proofMinCases gevallen. De proefmodus voert nooit iets uit: hier staat geen enkele schrijfactie op werfgegevens.
import Array "mo:core/Array";
import VarArray "mo:core/VarArray";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Text "mo:core/Text";
import Json "mo:jayson/Json";
import Types "../types";
import Config "Config";
import Dossier "Dossier";
import Rights "Rights";
import OaQuotes "OaQuotes";
import Tenders "Tenders";
import Sha256 "mo:sha2/Sha256";
import Time "mo:core/Time";
import Blob "mo:core/Blob";

module {
  type Json = Json.Json;

  // 3.8: #code = een nummer zonder hoofdletters en spaties; #amount = eurocent met een marge (≤ € 1 of ≤ 0,5 %).
  // 3.10: #verdict = goedkeuren tegenover niet goedkeuren (navragen en weigeren tellen als "niet goedkeuren": een mens betwistte).
  // 3.9: #picks = per post de gekozen offerte ("post=offerte;…"); juist = minstens 80 % van de posten die een mens koos, gelijk.
  public type Cmp = { #id; #key; #code; #amount; #verdict; #picks };
  // secret = een bedrag: nooit in een query-view (R38), enkel juist of fout.
  public type Field = { name : Text; cmp : Cmp; help : Text; secret : Bool };
  // scope: #docs = werf én documentsoort op de fiche; #work = enkel de werf. content = het geval heeft een bestand dat de bot leest
  // (proef_bestand) en dat de beheerder eerst in de proefbank laadt. aiKey "" = geen Caffeine-ronde (Caffeine leest geen PDF of foto).
  public type TaskDef = { key : Text; tool : Text; aiKey : Text; question : Text; fields : [Field]; scope : { #docs; #work }; content : Bool };

  // 3.5: enkel document koppelen. 3.8–3.10 voegen hier hun taak toe (oa-offerte-inlezen, factuurcontrole, oa-offertes-vergelijken),
  // met hun eigen verwijzing (#oaQuote, #oaInvoice) en velden (bv. een bedrag met een marge = een nieuwe Cmp).
  public func tasks() : [TaskDef] {
    [{
      key = "document-koppelen";
      tool = "document_koppelen";
      aiKey = "document-koppelen";
      question = "Bij welke werf en welke documentsoort hoort dit bestand? Gebruik je gewone tools (werven, mijn_fiche, werf_documenten) om te zoeken; je antwoord verandert niets in de app.";
      fields = [
        { name = "werfId"; cmp = #id; help = "Het id van de werf (uit de tool werven)."; secret = false },
        { name = "soort"; cmp = #key; help = "De sleutel van de documentsoort (uit mijn_fiche)."; secret = false },
      ];
      scope = #docs;
      content = false;
    }, {
      key = "oa-offerte-inlezen";
      tool = "voorstel_oa_offerte";
      aiKey = "";
      question = "Lees de offerte van de onderaannemer (haal het bestand met proef_bestand) en geef het offertenummer, de datum en het totaal na korting zonder btw. Je antwoord verandert niets in de app.";
      fields = [
        { name = "nummer"; cmp = #code; help = "Het offertenummer zoals op de offerte."; secret = false },
        { name = "datum"; cmp = #key; help = "De datum van de offerte (jjjj-mm-dd)."; secret = false },
        { name = "totaal"; cmp = #amount; help = "Het totaal na korting zonder btw, in eurocent (geheel getal)."; secret = true },
      ];
      scope = #work;
      content = true;
    }, {
      // 3.10: de taak heet zoals de bot-taak (factuurcontrole). Het juiste antwoord = wat een mens met de factuur deed: goedgekeurd
      // = goedkeuren, betwist = niet goedkeuren (navragen of weigeren). Het dossier komt erbij (lib/Bots.mo withDossier), zonder status.
      key = "factuurcontrole";
      tool = "voorstel_factuurcontrole";
      aiKey = "";
      question = "Controleer de factuur van de onderaannemer: haal het bestand met proef_bestand en leg het naast het dossier (registratie, regels, controle van de app, afgesproken prijs, eerdere facturen en offertes, regie-uren). Zou BOWACO ze goedkeuren, navragen of weigeren? Je antwoord verandert niets in de app.";
      fields = [{ name = "oordeel"; cmp = #verdict; help = "goedkeuren, navragen of weigeren."; secret = false }];
      scope = #work;
      content = true;
    }, {
      // 3.9: een prijsvraag die een INTERNE persoon afsloot, met de keuze per post. Het dossier (zonder de keuze) zet lib/Bots.mo erbij.
      key = "offertes-vergelijken";
      tool = "voorstel_vergelijking";
      aiKey = "";
      question = "Vergelijk de offertes van de onderaannemers in het dossier en kies per post de firma die BOWACO volgens jou neemt (offerte = het offerte-id uit het dossier). Antwoord met keuzes: een lijst van {post, offerte}. Je antwoord verandert niets in de app.";
      fields = [{ name = "keuzes"; cmp = #picks; help = "Per post de offerte: een lijst van {post, offerte}."; secret = false }];
      scope = #work;
      content = false;
    }, {
      // 3.11: een verstuurde offerteversie; de proefbank bouwt in drie van de vier gevallen één fout in (eenheidsprijs, btw, totaal)
      // en weet zo het juiste antwoord. Het dossier (met de ingebouwde fout) zet lib/Bots.mo erbij.
      key = "offerte-nalezen";
      tool = "opmerkingen_offerte";
      aiKey = "";
      question = "Lees de offerte in het dossier na. Zit er een fout in de eenheidsprijzen (een prijs die er ver naast ligt), in de btw (tarief tegenover de werf) of in het totaal (klopt niet met subtotaal + btw)? Antwoord met fout: eenheidsprijs, btw, totaal of geen. Je antwoord verandert niets in de app.";
      fields = [{ name = "fout"; cmp = #key; help = "geen, eenheidsprijs, btw of totaal: de soort van de ernstigste fout."; secret = false }];
      scope = #work;
      content = false;
    }];
  };

  public func task(key : Text) : ?TaskDef { tasks().find(func(t : TaskDef) : Bool = t.key == key) };

  public type Env = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    works : Types.WorksState;
    files : Types.FileState;
    dossier : Types.DossierState;
    proof : Types.ProofState;
    tenders : Types.TenderState; // 3.8: OA-offertes als proefgeval
    org : Types.OrgState;
    oaRead : Types.OaReadState; // 3.8: de inhoud van een proefgeval (proofContent)
    oaInvoices : Types.OaInvoiceState; // 3.10: OA-facturen als proefgeval
    quotes : Types.QuotesState; // 3.11: verstuurde offerteversies als proefgeval
  };

  public func contentKey(oaQuoteId : Nat) : Text { "q:" # oaQuoteId.toText() };

  // 3.8: een OA-offerte die een INTERNE persoon met de hand registreerde naast een PDF of foto, nog geldig, niet ingelezen door een
  // bot of de AI (dat is geen waarheid), met een nummer. Het bestand: van die werf, niet gearchiveerd.
  public func oaQuoteOk(e : Env, q : Types.OaQuote) : ?Types.FileRef {
    if (q.status != #received or q.source != #hand or q.number == "" or extraHas(q.extra, "inlezen") or not workOk(e, q.workId)) return null;
    switch (e.access.persons.get(q.createdBy)) { case (?p) { if (not Rights.internal(p)) return null }; case null return null };
    let fid = q.fileId ?? return null;
    let f = e.files.files.get(fid) ?? return null;
    if (f.archivedAt != null or f.workId != ?q.workId or (f.mime != "application/pdf" and not f.mime.startsWith(#text "image/"))) return null;
    switch (e.tenders.amounts.get(q.id)) { case (?#plain(_)) {}; case _ return null };
    ?f;
  };

  // 3.10: de inhoud van een proefgeval met een OA-factuur (zelfde opslag als 3.8, eigen voorvoegsel).
  public func invContentKey(invoiceId : Nat) : Text { "f:" # invoiceId.toText() };

  // 3.10: een OA-factuur waarover een INTERNE persoon besliste (goedgekeurd of betwist), met een bijlage (PDF of foto) van die werf.
  // Een factuur die nog loopt of ingetrokken is, is geen waarheid.
  public func invoiceOk(e : Env, inv : Types.OaInvoice) : ?Types.FileRef {
    if ((inv.status != #approved and inv.status != #disputed) or not workOk(e, inv.workId)) return null;
    let d = inv.decision ?? return null;
    switch (e.access.persons.get(d.by)) { case (?p) { if (not Rights.internal(p)) return null }; case null return null };
    let fid = inv.fileId ?? return null;
    let f = e.files.files.get(fid) ?? return null;
    if (f.archivedAt != null or f.workId != ?inv.workId or (f.mime != "application/pdf" and not f.mime.startsWith(#text "image/"))) return null;
    ?f;
  };

  func extraHas(x : Types.Extra, k : Text) : Bool { x.any(func((a, _) : (Text, Text)) : Bool = a == k) };
  public func extraGet(x : Types.Extra, k : Text) : ?Text {
    switch (x.find(func((a, _) : (Text, Text)) : Bool = a == k)) { case (?(_, v)) ?v; case null null };
  };

  func workOk(e : Env, w : Nat) : Bool {
    switch (e.works.works.get(w)) { case (?x) x.archivedAt == null; case null false };
  };

  // Een bestand dat een interne persoon van deze werf oplaadde, niet vertrouwelijk en niet gearchiveerd.
  public func fileOk(e : Env, f : Types.FileRef, workId : Nat) : Bool {
    f.workId == ?workId and f.archivedAt == null and not f.confidential and (switch (e.access.persons.get(f.personId)) { case (?p) Rights.internal(p); case null false });
  };

  // ── Testset uit de historiek ────────────────────────────────────────────
  // document-koppelen: elk bestand dat aan een document hangt dat een mens zo liet (ontvangen of goedgekeurd, geen bot-merk).
  public func buildCases(e : Env, taskKey : Text, max : Nat) : [Types.ProofCase] {
    if (taskKey == "oa-offerte-inlezen") return buildOaCases(e, max);
    if (taskKey == "factuurcontrole") return buildInvCases(e, max);
    if (taskKey == "offertes-vergelijken") return buildTenderCases(e, max);
    if (taskKey == "offerte-nalezen") return buildQuoteCases(e, max);
    if (taskKey != "document-koppelen") return [];
    let seen = Map.empty<Nat, ()>();
    let found = List.empty<(Int, Nat, Nat, Text)>(); // (moment, bestand, werf, soort)
    for (d in e.dossier.documents.values()) {
      if (d.archivedAt == null and not d.confidential and (d.status == #received or d.status == #approved) and not extraHas(d.extra, "bot") and workOk(e, d.workId)) {
        switch (Dossier.kind(e.settings, d.kind)) {
          case (?k) if (not k.confidential and not k.archived) {
            for (fid in d.fileIds.values()) {
              switch (e.files.files.get(fid)) {
                case (?f) if (fileOk(e, f, d.workId) and not seen.containsKey(fid)) { seen.add(fid, ()); found.add((f.at, fid, d.workId, k.key)) };
                case null {};
              };
            };
          };
          case null {};
        };
      };
    };
    // Nieuwste eerst, hoogstens max.
    let sorted = found.toArray().sort(func(a : (Int, Nat, Nat, Text), b : (Int, Nat, Nat, Text)) : { #less; #equal; #greater } = if (a.0 > b.0) #less else if (a.0 < b.0) #greater else Nat.compare(b.1, a.1));
    let n = Nat.min(max, sorted.size());
    Array.tabulate<Types.ProofCase>(n, func i {
      let (_, fid, w, k) = sorted[i];
      { n = i + 1; ref = #file(fid); workId = ?w; answer = [("werfId", w.toText()), ("soort", k)] };
    });
  };

  func buildOaCases(e : Env, max : Nat) : [Types.ProofCase] {
    let found = List.empty<Types.OaQuote>();
    for (q in e.tenders.oaQuotes.values()) { switch (oaQuoteOk(e, q)) { case (?_) found.add(q); case null {} } };
    let sorted = found.toArray().sort(func(a : Types.OaQuote, b : Types.OaQuote) : { #less; #equal; #greater } = if (a.createdAt > b.createdAt) #less else if (a.createdAt < b.createdAt) #greater else Nat.compare(b.id, a.id));
    let n = Nat.min(max, sorted.size());
    Array.tabulate<Types.ProofCase>(n, func i {
      let q = sorted[i];
      let net = switch (e.tenders.amounts.get(q.id)) { case (?#plain(a)) a.netCents; case _ 0 };
      { n = i + 1; ref = #oaQuote(q.id); workId = ?q.workId; answer = [("nummer", q.number), ("datum", isoDay(q.quoteDay)), ("totaal", Int.toText(net))] };
    });
  };

  func buildInvCases(e : Env, max : Nat) : [Types.ProofCase] {
    let found = List.empty<Types.OaInvoice>();
    for (inv in e.oaInvoices.invoices.values()) { switch (invoiceOk(e, inv)) { case (?_) found.add(inv); case null {} } };
    let sorted = found.toArray().sort(func(a : Types.OaInvoice, b : Types.OaInvoice) : { #less; #equal; #greater } = if (a.updatedAt > b.updatedAt) #less else if (a.updatedAt < b.updatedAt) #greater else Nat.compare(b.id, a.id));
    let n = Nat.min(max, sorted.size());
    Array.tabulate<Types.ProofCase>(n, func i {
      let inv = sorted[i];
      { n = i + 1; ref = #oaInvoice(inv.id); workId = ?inv.workId; answer = [("oordeel", if (inv.status == #approved) "goedkeuren" else "weigeren")] };
    });
  };

  // 3.9: de keuze van een mens op een afgesloten prijsvraag: "positie=offerte;…" (enkel posten met een gekozen, nog geldende offerte).
  public func tenderTruth(e : Env, t : Types.Tender) : Text {
    let items = Tenders.itemsOf(e.tenders, t.id);
    let out = List.empty<Text>();
    for ((k, x) in items.enumerate()) {
      switch (e.tenders.choices.get(x.id)) {
        case (?#plain(c)) switch (c.oaQuoteId) { case (?q) { if (OaQuotes.isCurrent(e.tenders, t, q)) out.add((k + 1).toText() # "=" # q.toText()) }; case null {} };
        case _ {};
      };
    };
    out.values().join(";");
  };
  public func tenderOk(e : Env, t : Types.Tender) : Bool {
    let by = switch (t.status) { case (#closed(x)) x.by; case _ return false };
    switch (e.access.persons.get(by)) { case (?p) { if (not Rights.internal(p)) return false }; case null return false };
    workOk(e, t.workId) and OaQuotes.current(e.tenders, t).size() > 0;
  };
  public func refId(r : Types.ProofRef, prefix : Text) : ?Nat {
    switch r { case (#other(t)) { if (t.startsWith(#text prefix)) Nat.fromText(Text.fromIter(t.chars().drop(prefix.size()))) else null }; case _ null };
  };

  func buildTenderCases(e : Env, max : Nat) : [Types.ProofCase] {
    let found = List.empty<(Types.Tender, Text)>();
    for (t in e.tenders.tenders.values()) {
      if (tenderOk(e, t)) { let truth = tenderTruth(e, t); if (truth != "") found.add((t, truth)) };
    };
    let sorted = found.toArray().sort(func(a : (Types.Tender, Text), b : (Types.Tender, Text)) : { #less; #equal; #greater } = if (a.0.updatedAt > b.0.updatedAt) #less else if (a.0.updatedAt < b.0.updatedAt) #greater else Nat.compare(b.0.id, a.0.id));
    let n = Nat.min(max, sorted.size());
    Array.tabulate<Types.ProofCase>(n, func i {
      let (t, truth) = sorted[i];
      { n = i + 1; ref = #other("prijsvraag:" # t.id.toText()); workId = ?t.workId; answer = [("keuzes", truth)] };
    });
  };

  // 3.11: een verstuurde versie die een interne persoon verstuurde, met hetzelfde btw-tarief als de werf en minstens één post met
  // een prijs. De ingebouwde fout volgt uit de plaats in de set (geen, eenheidsprijs, btw, totaal om de beurt).
  public let mutations : [Text] = ["geen", "eenheidsprijs", "btw", "totaal"];
  public func quoteOk(e : Env, v : Types.QuoteVersion) : ?Types.Quote {
    let s = v.sent ?? return null;
    if (v.status != #sent and v.status != #accepted and v.status != #superseded) return null;
    switch (e.access.persons.get(s.by)) { case (?p) { if (not Rights.internal(p)) return null }; case null return null };
    let q = e.quotes.quotes.get(v.quoteId) ?? return null;
    if (q.archivedAt != null or not workOk(e, q.workId)) return null;
    switch (e.works.works.get(q.workId)) { case (?w) { if (w.vatBp != v.vatBp) return null }; case null return null };
    if (s.subtotalCents <= 0) return null;
    ?q;
  };
  func buildQuoteCases(e : Env, max : Nat) : [Types.ProofCase] {
    let found = List.empty<(Types.QuoteVersion, Types.Quote)>();
    for (v in e.quotes.versions.values()) { switch (quoteOk(e, v)) { case (?q) found.add((v, q)); case null {} } };
    let sorted = found.toArray().sort(func(a : (Types.QuoteVersion, Types.Quote), b : (Types.QuoteVersion, Types.Quote)) : { #less; #equal; #greater } = if (a.0.updatedAt > b.0.updatedAt) #less else if (a.0.updatedAt < b.0.updatedAt) #greater else Nat.compare(b.0.id, a.0.id));
    let n = Nat.min(max, sorted.size());
    // Review 3.9 M2: de soort fout en de post volgen uit een hash van de versie en het moment van de set (niet uit de plaats).
    let seed = Int.toText(Time.now()) # "|" # e.proof.sets.size().toText();
    Array.tabulate<Types.ProofCase>(n, func i {
      let (v, q) = sorted[i];
      let h = Sha256.fromBlob(#sha256, ("bowaco-proef-3.11|" # seed # "|" # v.id.toText()).encodeUtf8()).toArray();
      let m = mutations[h[0].toNat() % mutations.size()];
      { n = i + 1; ref = #other("offerteversie:" # v.id.toText()); workId = ?q.workId; answer = [("fout", m), ("k", (h[1].toNat() * 256 + h[2].toNat()).toText())] };
    });
  };

  public func isoDay(day : Nat) : Text {
    let z = day + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if (mp < 10) mp + 3 else mp - 9;
    let y = yoe + era * 400 + (if (m <= 2) 1 else 0);
    let two = func(x : Nat) : Text { if (x < 10) "0" # x.toText() else x.toText() };
    y.toText() # "-" # two(m) # "-" # two(d);
  };

  // Mag deze bot dit geval zien (de fiche van NU)?
  public func caseInScope(ctx : Rights.Ctx, b : Types.Bot, def : TaskDef, c : Types.ProofCase) : Bool {
    let w = c.workId ?? return false;
    if (not Rights.botSeesWork(ctx, b, w)) return false;
    switch (def.scope) {
      case (#work) true;
      case (#docs) Rights.botSeesDocKind(b, norm(#key, answerOf(c.answer, "soort")), false);
    };
  };

  // 3.8: de inhoud van een proefgeval (enkel een OA-offerte), als de beheerder ze laadde.
  public func caseContent(e : Env, c : Types.ProofCase) : ?(Types.FileRef, Blob) {
    switch (c.ref) {
      case (#oaQuote(qid)) {
        let q = e.tenders.oaQuotes.get(qid) ?? return null;
        let f = oaQuoteOk(e, q) ?? return null;
        let b = e.oaRead.proofContent.get(contentKey(qid)) ?? return null;
        ?(f, b);
      };
      case (#oaInvoice(id)) {
        let inv = e.oaInvoices.invoices.get(id) ?? return null;
        let f = invoiceOk(e, inv) ?? return null;
        let b = e.oaRead.proofContent.get(invContentKey(id)) ?? return null;
        ?(f, b);
      };
      case _ null;
    };
  };

  // Kan dit geval (nog) getoond worden? De invoer voor de bot of de AI, of null (= vervallen). Nooit het id, de werf of het antwoord.
  public func caseInput(e : Env, c : Types.ProofCase) : ?Json {
    switch (c.ref) {
      case (#file(fid)) {
        let f = e.files.files.get(fid) ?? return null;
        let w = c.workId ?? return null;
        if (not fileOk(e, f, w) or not workOk(e, w)) return null;
        // Review 3.5 M1: ook de soort en het document opnieuw (intussen vertrouwelijk of gearchiveerd = vervallen).
        switch (Dossier.kind(e.settings, answerOf(c.answer, "soort"))) { case (?k) { if (k.confidential or k.archived) return null }; case null return null };
        if (not Dossier.docsOf(e.dossier, w).any(func(d : Types.Document) : Bool = not d.confidential and d.fileIds.any(func x = x == fid))) return null;
        ?#Object([("bestand", #Object([("naam", #String(f.name)), ("type", #String(f.mime)), ("grootte", #Number(#Int(f.size)))]))]);
      };
      case (#oaQuote(qid)) {
        // Enkel met geladen inhoud; nooit het nummer, de datum, een bedrag of het id.
        let (f, _) = caseContent(e, c) ?? return null;
        let q = e.tenders.oaQuotes.get(qid) ?? return null;
        let firm = switch (e.org.orgs.get(q.orgId)) { case (?o) o.name; case null "" };
        ?#Object([("bestand", #Object([("naam", #String(f.name)), ("type", #String(f.mime)), ("grootte", #Number(#Int(f.size)))])), ("firma", #String(firm)), ("inhoud", #String("haal het bestand met proef_bestand"))]);
      };
      case (#other(_)) {
        // 3.9 + 3.11: geen bestand; het dossier zet lib/Bots.mo erbij. Nooit het id, de keuze of de ingebouwde fout.
        switch (refId(c.ref, "prijsvraag:")) {
          case (?tid) { let t = e.tenders.tenders.get(tid) ?? return null; if (not tenderOk(e, t)) return null; return ?#Object([("inhoud", #String("zie het dossier"))]) };
          case null {};
        };
        switch (refId(c.ref, "offerteversie:")) {
          case (?vid) { let v = e.quotes.versions.get(vid) ?? return null; if (quoteOk(e, v) == null) return null; return ?#Object([("inhoud", #String("zie het dossier"))]) };
          case null {};
        };
        null;
      };
      case (#oaInvoice(_)) {
        // Enkel met geladen inhoud; het dossier (zonder status of beslissing) zet lib/Bots.mo erbij. Nooit het id of het antwoord.
        let (f, _) = caseContent(e, c) ?? return null;
        ?#Object([("bestand", #Object([("naam", #String(f.name)), ("type", #String(f.mime)), ("grootte", #Number(#Int(f.size)))])), ("inhoud", #String("haal het bestand met proef_bestand"))]);
      };
      case _ null;
    };
  };

  public func refText(r : Types.ProofRef) : Text {
    switch r { case (#file(x)) "bestand #" # x.toText(); case (#doc(x)) "document #" # x.toText(); case (#oaQuote(x)) "OA-offerte #" # x.toText(); case (#oaInvoice(x)) "OA-factuur #" # x.toText(); case (#other(t)) t };
  };

  // ── Vergelijken ─────────────────────────────────────────────────────────
  public func norm(cmp : Cmp, v : Text) : Text {
    let t = v.trim(#char ' ');
    switch cmp {
      case (#id) {
        // "0012" en "12" zijn hetzelfde id; iets anders dan cijfers blijft zoals het is (en is dus fout).
        switch (Nat.fromText(t)) { case (?n) n.toText(); case null t };
      };
      case (#key) t.toLower();
      case (#code) t.toLower().replace(#char ' ', "");
      case (#amount) switch (Int.fromText(t)) { case (?n) Int.toText(n); case null t };
      case (#verdict) switch (t.toLower()) { case "goedkeuren" "goedkeuren"; case ("navragen" or "weigeren") "niet"; case _ "?" # t };
      case (#picks) t;
    };
  };

  // Een bedrag met een marge: ≤ 100 cent of ≤ 0,5 % van het juiste bedrag.
  func amountClose(g : Text, truth : Text) : Bool {
    switch (Int.fromText(g.trim(#char ' ')), Int.fromText(truth)) {
      case (?a, ?b) { let d = Int.abs(a - b); d <= 100 or d * 200 <= Int.abs(b) };
      case _ false;
    };
  };

  // 3.9: "post=offerte;…" → per post de offerte; juist als ≥ 80 % van de posten van de mens dezelfde offerte kreeg.
  func pickMap(t : Text) : Map.Map<Text, Text> {
    let m = Map.empty<Text, Text>();
    for (part in t.split(#char ';')) {
      let kv = part.split(#char '=').toArray();
      if (kv.size() == 2) {
        let k = switch (Nat.fromText(kv[0].trim(#char ' '))) { case (?n) n.toText(); case null "" };
        let v = switch (Nat.fromText(kv[1].trim(#char ' '))) { case (?n) n.toText(); case null "" };
        if (k != "" and v != "" and not m.containsKey(k)) m.add(k, v);
      };
    };
    m;
  };
  func picksClose(g : Text, truth : Text) : Bool {
    let tm = pickMap(truth);
    if (tm.size() == 0) return false;
    let gm = pickMap(g);
    var same = 0;
    for ((k, v) in tm.entries()) { if (gm.get(k) == ?v) same += 1 };
    same * 100 >= 80 * tm.size();
  };

  public func answerOf(xs : [(Text, Text)], k : Text) : Text {
    switch (xs.find(func((a, _) : (Text, Text)) : Bool = a == k)) { case (?(_, v)) v; case null "" };
  };

  public func compare(def : TaskDef, truth : [(Text, Text)], given : [(Text, Text)]) : Types.ProofOutcome {
    let wrong = List.empty<Text>();
    for (f in def.fields.values()) {
      let g = answerOf(given, f.name);
      let bad = if (g == "") true else switch (f.cmp) {
        case (#amount) not amountClose(g, answerOf(truth, f.name));
        case (#picks) not picksClose(g, answerOf(truth, f.name));
        case _ norm(f.cmp, g) != norm(f.cmp, answerOf(truth, f.name));
      };
      if (bad) wrong.add(f.name);
    };
    if (wrong.isEmpty()) #right else #wrong(wrong.toArray());
  };

  // ── Rondes ──────────────────────────────────────────────────────────────
  public func answersOf(ps : Types.ProofState, roundId : Nat) : Map.Map<Nat, Types.ProofAnswer> {
    switch (ps.answers.get(roundId)) {
      case (?m) m;
      case null { let m = Map.empty<Nat, Types.ProofAnswer>(); ps.answers.add(roundId, m); m };
    };
  };

  public func caseOf(set : Types.ProofSet, n : Nat) : ?Types.ProofCase { set.cases.find(func(c : Types.ProofCase) : Bool = c.n == n) };

  public func sameSubject(a : Types.ProofSubject, b : Types.ProofSubject) : Bool {
    switch (a, b) { case (#bot(x), #bot(y)) x == y; case (#ai(x), #ai(y)) x == y; case _ false };
  };

  public func openRoundOf(ps : Types.ProofState, s : Types.ProofSubject) : ?Types.ProofRound {
    switch s {
      case (#bot(id)) switch (ps.openByBot.get(id)) { case (?r) ps.rounds.get(r); case null null };
      case _ ps.rounds.values().find(func(r : Types.ProofRound) : Bool = r.state == #open and sameSubject(r.subject, s));
    };
  };

  // Sluiten: elk geval zonder antwoord wordt "geen antwoord" (fout) of "vervallen" (intussen onbruikbaar); de score wordt vast.
  public func close(e : Env, r : Types.ProofRound, by : ?Nat, now : Int, cancel : Bool) {
    if (r.state != #open) return;
    let ans = answersOf(e.proof, r.id);
    if (not cancel) {
      switch (e.proof.sets.get(r.setId)) {
        case (?set) {
          for (n in r.cases.values()) {
            if (not ans.containsKey(n)) {
              let usable = switch (caseOf(set, n)) { case (?c) caseInput(e, c) != null; case null false };
              ans.add(n, { n; given = []; at = now; outcome = if usable #none else #void("onbruikbaar") });
            };
          };
        };
        case null {};
      };
    };
    var right = 0;
    var counted = 0;
    for (a in ans.values()) {
      switch (a.outcome) { case (#right) { right += 1; counted += 1 }; case (#wrong(_) or #none) counted += 1; case _ {} };
    };
    r.right := right;
    r.counted := counted;
    r.state := if cancel #cancelled else #closed;
    r.closedAt := ?now;
    r.closedBy := by;
    switch (r.subject) { case (#bot(id)) { if (e.proof.openByBot.get(id) == ?r.id) e.proof.openByBot.remove(id) }; case _ {} };
  };

  public func passed(r : Types.ProofRound) : Bool {
    r.state == #closed and r.counted >= Config.proofMinCases and r.right * 100 >= Config.proofMinPct * r.counted;
  };

  public func pct(r : Types.ProofRound) : Nat { if (r.counted == 0) 0 else r.right * 100 / r.counted };

  // De laatste GESLOTEN ronde (stoppen telt niet) van dit onderwerp voor deze taak.
  public func latestClosed(ps : Types.ProofState, s : Types.ProofSubject, taskKey : Text) : ?Types.ProofRound {
    var best : ?Types.ProofRound = null;
    for (r in ps.rounds.values()) {
      if (r.state == #closed and r.task == taskKey and sameSubject(r.subject, s)) {
        switch best {
          case (?b) { if ((r.closedAt ?? 0) > (b.closedAt ?? 0) or ((r.closedAt ?? 0) == (b.closedAt ?? 0) and r.id > b.id)) best := ?r };
          case null best := ?r;
        };
      };
    };
    best;
  };

  public func sameLabels(r : Types.ProofRound, vendor : Text, model : Text, instruction : Text) : Bool {
    r.vendor == vendor and r.model == model and r.instruction == instruction;
  };

  // Review 3.5 L1: de reikwijdte van de fiche bij de start (werven en soorten). Een bredere fiche dan bij de ronde = een nieuwe ronde.
  public type Scope = { allWorks : Bool; works : [Nat]; kinds : [Text] };
  public func scopeExtra(s : Scope) : Types.Extra {
    [("alleWerven", if (s.allWorks) "1" else "0"), ("werven", s.works.values().map(func(w : Nat) : Text = w.toText()).join(",")), ("soorten", s.kinds.values().join(","))];
  };
  public func scopeOk(r : Types.ProofRound, s : Scope) : Bool {
    let all = extraGet(r.extra, "alleWerven") == ?"1";
    let ws = (extraGet(r.extra, "werven") ?? "").split(#char ',').toArray();
    let ks = (extraGet(r.extra, "soorten") ?? "").split(#char ',').toArray();
    if (extraGet(r.extra, "alleWerven") == null) return true; // een ronde zonder reikwijdte (Caffeine)
    (all or (not s.allWorks and s.works.all(func w = ws.any(func x = x == w.toText())))) and s.kinds.all(func k = ks.any(func x = x == k));
  };

  // De drempel voor Zelf doen.
  public func gate(ps : Types.ProofState, s : Types.ProofSubject, taskKey : Text, vendor : Text, model : Text, instruction : Text, scope : ?Scope) : { #ok; #err : Text } {
    let need = "minstens " # Config.proofMinPct.toText() # " % juist op minstens " # Config.proofMinCases.toText() # " gevallen";
    let r = latestClosed(ps, s, taskKey) ?? return #err("Zelf doen kan pas na een geslaagde proefronde (" # need # ")");
    if (not sameLabels(r, vendor, model, instruction)) return #err("Zelf doen: het model of de instructieversie wijzigde sinds de laatste proefronde. Eerst een nieuwe proefronde (" # need # ")");
    switch scope { case (?sc) { if (not scopeOk(r, sc)) return #err("Zelf doen: de fiche ziet nu meer werven of documentsoorten dan bij de laatste proefronde. Eerst een nieuwe proefronde (" # need # ")") }; case null {} };
    if (not passed(r)) return #err("Zelf doen: de laatste proefronde haalde de drempel niet (" # r.right.toText() # " / " # r.counted.toText() # "; " # need # ")");
    #ok;
  };

  // Schudden (Fisher-Yates) met de bytes van Random.blob.
  public func shuffle(xs : [Nat], bytes : [Nat8]) : [Nat] {
    let a = xs.toVarArray<Nat>();
    if (bytes.size() == 0) return xs;
    var i = a.size();
    var k = 0;
    while (i > 1) {
      let r = (bytes[k % bytes.size()].toNat() * 256 + bytes[(k + 1) % bytes.size()].toNat() + k) % i;
      i -= 1;
      let t = a[i];
      a[i] := a[r];
      a[r] := t;
      k += 2;
    };
    VarArray.toArray(a);
  };

  // Klokronde: een open ronde na proofRoundDays sluiten (geen antwoord = fout). Begrensd.
  public func idle(e : Env, now : Int) {
    var n = 0;
    let old = List.empty<Types.ProofRound>();
    label l for (r in e.proof.rounds.values()) {
      if (n >= 20) break l;
      if (r.state == #open and now - r.startedAt > Config.proofRoundDays) { old.add(r); n += 1 };
    };
    for (r in old.values()) close(e, r, null, now, false);
  };

  // Een sleutel of id uit JSON van een bot of de AI (getal of tekst), hoogstens 80 tekens.
  public func jsonValue(j : ?Json) : Text {
    switch j {
      case (?#String(t)) Text.fromIter(t.chars().take(80));
      case (?#Number(#Int(i))) Int.toText(i);
      // 3.9: keuzes = een lijst van {post, offerte} → "post=offerte;…" (hoogstens 500 posten).
      case (?#Array(xs)) {
        let out = List.empty<Text>();
        label l for (x in xs.values()) {
          if (out.size() >= 500) break l;
          switch x {
            case (#Object(fs)) {
              let get = func(k : Text) : ?Nat { switch (fs.find(func((a, _) : (Text, Json)) : Bool = a == k)) { case (?(_, #Number(#Int(i)))) { if (i >= 0) ?Int.abs(i) else null }; case _ null } };
              switch (get("post"), get("offerte")) { case (?p, ?q) out.add(p.toText() # "=" # q.toText()); case _ {} };
            };
            case _ {};
          };
        };
        out.values().join(";");
      };
      case _ "";
    };
  };
};
