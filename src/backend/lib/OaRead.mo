// OA-offerte inlezen (stap 3.8, bouwplan §6 "Twee wegen voor AI"): een PDF, foto of tekst van een onderaannemer → posten in het
// OA-offerteformulier van 2c.3. Twee wegen: een bot via MCP leest het bestand (inleesbestand) en stuurt een voorstel
// (voorstel_oa_offerte); Caffeine AI leest de TEKST (runOaReadAi). De uitkomst is altijd eerst een voorstel dat kantoor in het
// formulier nakijkt en zelf registreert (registerOaQuote); enkel een bot met een geslaagde proefronde (Zelf doen) laat de app de
// offerte meteen registreren, en dat is ongedaan te maken door ze in te trekken.
// Geen rechten hier (de mixin OaReadApi en lib/Bots.mo beslissen). Wat een bot of de AI schrijft is onbetrouwbare invoer: alles wordt
// begrensd en nagekeken, vrije tekst wordt enkel getoond.
import Array "mo:core/Array";
import Char "mo:core/Char";
import Float "mo:core/Float";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Json "mo:jayson/Json";
import Types "../types";
import TV "../types/tenderviews";
import Config "Config";
import Rights "Rights";
import Tenders "Tenders";

module {
  type Json = Json.Json;
  type Job = Types.OaReadJob;

  public let fileMimes : [Text] = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  public func fileMimeOk(m : Text) : Bool { fileMimes.any(func x = x == m) };

  public func statusKey(s : Types.OaReadStatus) : Text {
    switch s { case (#open) "open"; case (#proposed) "voorstel"; case (#applied _) "geregistreerd"; case (#rejected _) "afgewezen"; case (#cancelled) "geannuleerd"; case (#failed _) "mislukt"; case (#other t) t };
  };
  public func isLive(j : Job) : Bool { j.status == #open or j.status == #proposed };

  public func extraGet(x : Types.Extra, k : Text) : ?Text {
    switch (x.find(func((a, _) : (Text, Text)) : Bool = a == k)) { case (?(_, v)) ?v; case null null };
  };
  public func extraSet(x : Types.Extra, k : Text, v : Text) : Types.Extra {
    x.filter(func((a, _) : (Text, Text)) : Bool = a != k).concat([(k, v)]);
  };

  public func jobsOf(s : Types.OaReadState, workId : Nat) : [Job] {
    (s.byWork.get(workId) ?? []).filterMap(func(id : Nat) : ?Job = s.jobs.get(id));
  };
  public func addIndex(s : Types.OaReadState, workId : Nat, id : Nat) {
    s.byWork.add(workId, (s.byWork.get(workId) ?? []).concat([id]));
  };
  // Review 3.8 M2: de inhoud die nu in de canister staat (opdrachten; begrensd door het aantal open opdrachten).
  public func liveBytes(s : Types.OaReadState) : Nat { var n = 0; for (b in s.content.values()) n += b.size(); n };
  public func proofBytes(s : Types.OaReadState) : Nat { var n = 0; for (b in s.proofContent.values()) n += b.size(); n };

  // Is de persoon die de opdracht gaf nog kantoor met het volle zicht op die werf en de bedragen? (Zelf doen registreert namens hem;
  // de bot zelf leest geen bedragen uit de app.)
  public func officeOk(access : Types.AccessState, ctx : Rights.Ctx, personId : Nat, workId : Nat) : ?Types.Person {
    let p = access.persons.get(personId) ?? return null;
    if (p.archivedAt != null) return null;
    if (Rights.may(ctx, p, #editTenders, null) and Rights.may(ctx, p, #readCosts, null) and Rights.tenderScope(ctx, p, workId) == #full) ?p else null;
  };

  public func openOnWork(s : Types.OaReadState, workId : Nat) : Nat { jobsOf(s, workId).filter(isLive).size() };

  // Afsluiten: de inhoud gaat altijd weg (ze is enkel nodig zolang iemand moet lezen).
  public func close(s : Types.OaReadState, j : Job, st : Types.OaReadStatus, by : ?Nat, now : Int) {
    j.status := st;
    j.decidedAt := ?now;
    j.decidedBy := by;
    s.content.remove(j.id);
  };

  // ── Datum jjjj-mm-dd ↔ dag (dagen sinds 1970-01-01) ─────────────────────
  func daysFromCivil(y0 : Int, m : Int, d : Int) : Int {
    let y = if (m <= 2) y0 - 1 else y0;
    let era = (if (y >= 0) y else y - 399) / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468;
  };
  public func parseDay(t : Text) : ?Nat {
    let p = t.trim(#char ' ').split(#char '-').toArray();
    if (p.size() != 3 or p[0].size() != 4) return null;
    let y = Nat.fromText(p[0]) ?? return null;
    let m = Nat.fromText(p[1]) ?? return null;
    let d = Nat.fromText(p[2]) ?? return null;
    if (y < 2000 or y > 2100 or m < 1 or m > 12 or d < 1 or d > 31) return null;
    let n = daysFromCivil(y, m, d);
    if (n < 0) null else ?Int.abs(n);
  };
  public func isoDay(day : Nat) : Text {
    // Omgekeerd (Howard Hinnant).
    let z = day + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if (mp < 10) mp + 3 else mp - 9;
    let y = yoe + era * 400 + (if (m <= 2) 1 else 0);
    let two = func(n : Nat) : Text { if (n < 10) "0" # n.toText() else n.toText() };
    y.toText() # "-" # two(m) # "-" # two(d);
  };

  // ── Het voorstel uit JSON (bot of AI) ───────────────────────────────────
  func get(fs : [(Text, Json)], k : Text) : ?Json {
    switch (fs.find(func((a, _) : (Text, Json)) : Bool = a == k)) { case (?(_, v)) ?v; case null null };
  };
  // Tekst van buiten: geen stuurtekens, getrimd, begrensd.
  public func txt(t : Text, max : Nat) : Text {
    // Review 3.8 L3: ook bidi- en opmaaktekens (die een omschrijving visueel kunnen omkeren) worden een spatie.
    let bad = func(c : Char) : Bool { let n = Char.toNat32(c); n < 32 or n == 127 or (n >= 0x200B and n <= 0x200F) or (n >= 0x202A and n <= 0x202E) or (n >= 0x2066 and n <= 0x2069) or n == 0xFEFF };
    let clean = Text.fromIter(t.chars().map(func(c : Char) : Char = if (bad(c)) ' ' else c));
    Text.fromIter(clean.trim(#char ' ').chars().take(max));
  };
  func optText(j : ?Json, max : Nat) : Text { switch j { case (?#String(t)) txt(t, max); case _ "" } };
  func int(j : ?Json) : ?Int {
    switch j {
      case (?#Number(#Int(i))) ?i;
      case (?#Number(#Float(f))) { if (Float.isNaN(f) or f > 1e15 or f < -1e15) null else ?Float.toInt(Float.nearest(f)) };
      case (?#String(t)) Int.fromText(t.trim(#char ' '));
      case _ null;
    };
  };
  func milli(j : ?Json) : ?Int {
    switch j {
      case (?#Number(#Int(i))) ?(i * 1000);
      case (?#Number(#Float(f))) { if (Float.isNaN(f) or f > 1e12 or f < -1e12) null else ?Float.toInt(Float.nearest(f * 1000.0)) };
      case _ null;
    };
  };
  func pctBp(j : ?Json) : ?Int {
    switch j {
      case (?#Number(#Int(i))) ?(i * 100);
      case (?#Number(#Float(f))) { if (Float.isNaN(f) or f > 1e6 or f < -1e6) null else ?Float.toInt(Float.nearest(f * 100.0)) };
      case _ null;
    };
  };

  // items = de posten van de prijsvraag (leeg bij een losse offerte). Een postId die er niet bij hoort, wordt null (eigen regel).
  public func parse(j : Json, items : [Types.TenderItem], now : Int, extra : Types.Extra) : { #ok : Types.OaReadProposal; #err : Text } {
    let #Object(fs) = j else return #err("Het voorstel is geen object");
    let form = switch (get(fs, "vorm")) { case (?#String("hoofdstukken")) "hoofdstukken"; case (?#String("totaal")) "totaal"; case (?#String("posten") or null) "posten"; case _ return #err("vorm: posten, hoofdstukken of totaal") };
    let day = func(k : Text) : { #ok : ?Nat; #err : Text } {
      switch (get(fs, k)) {
        case (null or ?#Null) #ok(null);
        case (?#String(t)) { if (t.trim(#char ' ') == "") #ok(null) else switch (parseDay(t)) { case (?d) #ok(?d); case null #err(k # ": een datum jjjj-mm-dd") } };
        case _ #err(k # ": een datum jjjj-mm-dd");
      };
    };
    let quoteDay = switch (day("datum")) { case (#ok d) d; case (#err e) return #err(e) };
    let validUntil = switch (day("geldigTot")) { case (#ok d) d; case (#err e) return #err(e) };
    let reverse = switch (get(fs, "btwVerlegd")) { case (?#Bool(b)) ?b; case _ null };
    let discountBp : ?Nat = switch (get(fs, "kortingPct")) {
      case (null or ?#Null) null;
      case x switch (pctBp(x)) { case (?bp) { if (bp < 0 or bp > 5_000) return #err("kortingPct: 0 tot 50") else if (bp == 0) null else ?Int.abs(bp) }; case null return #err("kortingPct: een getal") };
    };
    let lines = List.empty<Types.OaReadLine>();
    let seen = Map.empty<Nat, ()>();
    switch (get(fs, "regels")) {
      case (?#Array(xs)) {
        if (xs.size() > Config.oaReadMaxLines) return #err("Hoogstens " # Config.oaReadMaxLines.toText() # " regels");
        for (x in xs.values()) {
          let #Object(l) = x else return #err("Elke regel is een object");
          var itemId : ?Nat = null;
          switch (int(get(l, "postId"))) {
            case (?id) if (id >= 0) {
              let n = Int.abs(id);
              if (items.any(func(it : Types.TenderItem) : Bool = it.id == n) and not seen.containsKey(n)) { itemId := ?n; seen.add(n, ()) };
            };
            case null {};
          };
          let q = switch (get(l, "hoeveelheid")) { case (null or ?#Null) ?1000; case v milli(v) };
          let qty = switch q { case (?v) { if (v < 0 or v > Config.maxQuoteQtyMilli) return #err("hoeveelheid buiten bereik") else v }; case null return #err("hoeveelheid: een getal") };
          let unitCents : ?Int = switch (get(l, "eenheidsprijsCent")) {
            case (null or ?#Null) null;
            case v switch (int(v)) { case (?c) { if (c < 0 or c > Config.maxAmountCents) return #err("eenheidsprijsCent buiten bereik") else ?c }; case null return #err("eenheidsprijsCent: een geheel getal") };
          };
          let remark = optText(get(l, "opmerking"), 500);
          let included : Types.OaIncluded = switch (get(l, "inbegrepen")) { case (?#String("nee")) #no; case (?#String("alternatief")) #alt(remark); case _ #yes };
          // De post van de prijsvraag geeft de omschrijving en de eenheid; een eigen regel de zijne.
          let (desc, unit) = switch itemId {
            case (?id) switch (items.find(func(it : Types.TenderItem) : Bool = it.id == id)) { case (?it) (it.title, it.unit); case null ("", "") };
            case null (optText(get(l, "omschrijving"), 160), optText(get(l, "eenheid"), 40));
          };
          if (desc == "" and itemId == null) return #err("Een eigen regel heeft een omschrijving");
          lines.add({ itemId; description = desc; unit; qtyMilli = qty; unitCents; included; remark });
        };
      };
      case (null or ?#Null) {};
      case _ return #err("regels: een lijst");
    };
    let chapters = List.empty<(Text, Int)>();
    switch (get(fs, "hoofdstukken")) {
      case (?#Array(xs)) {
        if (xs.size() > 60) return #err("Hoogstens 60 hoofdstukken");
        for (x in xs.values()) {
          let #Object(c) = x else return #err("Elk hoofdstuk is een object");
          let name = optText(get(c, "hoofdstuk"), 200);
          let v = int(get(c, "totaalCent")) ?? return #err("totaalCent van een hoofdstuk: een geheel getal");
          if (name == "" or v < 0 or v > Config.maxAmountCents) return #err("Hoofdstuk zonder naam of bedrag buiten bereik");
          chapters.add((name, v));
        };
      };
      case (null or ?#Null) {};
      case _ return #err("hoofdstukken: een lijst");
    };
    let total : ?Int = switch (get(fs, "totaalCent")) {
      case (null or ?#Null) null;
      case v switch (int(v)) { case (?c) { if (c < 0 or c > Config.maxAmountCents) return #err("totaalCent buiten bereik") else ?c }; case null return #err("totaalCent: een geheel getal") };
    };
    let remarks = List.empty<Text>();
    switch (get(fs, "opmerkingen")) {
      case (?#Array(xs)) {
        for (x in xs.values()) {
          if (remarks.size() < Config.oaReadMaxRemarks) switch x { case (#String(t)) { let c = txt(t, 500); if (c != "") remarks.add(c) }; case _ {} };
        };
      };
      case _ {};
    };
    let conf : Nat = switch (get(fs, "vertrouwen")) {
      case (?#Number(#Float(f))) { if (Float.isNaN(f) or f <= 0) 0 else if (f <= 1.0) Int.abs(Float.toInt(Float.nearest(f * 100.0))) else if (f <= 100.0) Int.abs(Float.toInt(Float.nearest(f))) else 100 };
      case (?#Number(#Int(i))) { if (i <= 0) 0 else if (i == 1) 100 else if (i <= 100) Int.abs(i) else 100 };
      case _ 0;
    };
    if (form == "posten" and lines.size() == 0 and total == null) return #err("Geen regels en geen totaal: niets om voor te stellen");
    if (form == "hoofdstukken" and chapters.size() == 0) return #err("vorm hoofdstukken zonder hoofdstukken");
    if (form == "totaal" and total == null) return #err("vorm totaal zonder totaalCent");
    #ok({
      number = optText(get(fs, "nummer"), 40);
      quoteDay;
      validUntil;
      discountBp;
      reverse;
      form;
      lines = lines.toArray();
      chapterTotals = chapters.toArray();
      totalCents = total;
      remarks = remarks.toArray();
      confidence = conf;
      at = now;
      extra;
    });
  };

  // ── Zelf doen: het voorstel als registratie (dezelfde invoer als het formulier) ──
  public func toInput(j : Job, p : Types.OaReadProposal, today : Nat) : TV.OaQuoteInput {
    let prices : TV.OaRegPrices = if (p.form == "totaal" and j.inviteId != null) #total(p.totalCents ?? 0) else if (p.form == "hoofdstukken" and j.inviteId != null) #chapters(p.chapterTotals) else #lines(p.lines.map<Types.OaReadLine, TV.OaRegLine>(func l = { itemId = if (j.inviteId == null) null else l.itemId; description = l.description; unit = l.unit; qtyMilli = l.qtyMilli; unitCents = l.unitCents; included = l.included; remark = l.remark }));
    {
      inviteId = j.inviteId;
      workId = j.workId;
      orgId = j.orgId;
      source = #hand;
      sheetKey = "";
      number = p.number;
      quoteDay = p.quoteDay ?? today;
      validUntil = p.validUntil;
      discountBp = if (p.form == "totaal" and j.inviteId != null) null else p.discountBp;
      reverse = p.reverse ?? true;
      prices;
      remark = "";
      note = "Ingelezen (opdracht #" # j.id.toText() # ")";
      file = null;
    };
  };

  // ── Voor de bot: de opdracht zonder bedragen van BOWACO of andere firma's ──
  public func botJob(j : Job, firm : Text, tenderCode : Text, items : [Types.TenderItem]) : Json {
    #Object([
      ("opdracht", #Number(#Int(j.id))),
      ("werfId", #Number(#Int(j.workId))),
      ("firma", #String(firm)),
      ("prijsvraag", if (tenderCode == "") #Null else #String(tenderCode)),
      ("bestand", #Object([("naam", #String(j.name)), ("type", #String(j.mime)), ("grootte", #Number(#Int(j.size)))])),
      ("stand", #String(statusKey(j.status))),
      ("posten", #Array(items.map<Types.TenderItem, Json>(func it = #Object([("postId", #Number(#Int(it.id))), ("hoofdstuk", #String(it.chapter)), ("code", #String(it.code)), ("omschrijving", #String(it.title)), ("eenheid", #String(it.unit)), ("hoeveelheidMilli", #Number(#Int(it.qtyMilli)))])))),
    ]);
  };

  public func itemsOf(ts : Types.TenderState, j : Job) : [Types.TenderItem] {
    switch (j.tenderId) { case (?t) Tenders.itemsOf(ts, t); case null [] };
  };

  // Klokronde: een open opdracht na 30 dagen laten vervallen (de inhoud gaat weg). Begrensd.
  public func idle(s : Types.OaReadState, now : Int) {
    var n = 0;
    // 3.12 (review L): afgesloten opdrachten na 90 dagen weg, zoals bij de factuurcontrole (review 3.10 M3). Zonder opruimen bleef de
    // grens van oaReadMaxJobs na 5.000 opdrachten voorgoed bereikt.
    let old = List.empty<Job>();
    label l for (j in s.jobs.values()) {
      if (n >= 50) break l;
      if (isLive(j)) { if (now - j.createdAt > Config.oaReadExpire) { close(s, j, #failed("vervallen na 14 dagen"), null, now); n += 1 } } else if (now - (j.decidedAt ?? j.createdAt) > Config.oaReadKeep) { old.add(j); n += 1 };
    };
    for (j in old.values()) {
      s.jobs.remove(j.id);
      s.content.remove(j.id);
      s.byWork.add(j.workId, (s.byWork.get(j.workId) ?? []).filter(func(x : Nat) : Bool = x != j.id));
    };
  };
};
