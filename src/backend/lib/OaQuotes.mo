// OA-offertes ontvangen, vergelijken, kiezen en overnemen (stap 2c.3, ontwerp 2c §4.3, ⚖5, AC-12, AC-13). Geen rechten hier
// (de mixin OaQuotesApi en lib/Rights.mo beslissen); bedragen enkel in wat een update-call met een auditregel teruggeeft.
// · De geldende offerte van een firma = haar laatste ontvangen versie op die uitnodiging (een tweede indiening vervangt de eerste
//   in de vergelijking; de vorige blijft in de historiek).
// · Prijsgeheugen: per post van de prijsvraag en per firma hoogstens één actieve aankoopprijs in de postenbibliotheek (bron
//   "oa-offerte"), gemarkeerd "gekozen" of "niet gekozen" (extra "keuze"). Opnieuw overnemen = dezelfde prijs blijft (idempotent);
//   een andere prijs of keuze = de oude wordt gearchiveerd (append-only, D2) en een nieuwe komt erbij. Een "niet gekozen" prijs is
//   nooit de geldende prijs van de post (Library.currentCost).
// · Afsluiten: gekozen firma's → gekozen; de rest → bedankt, met een kort bericht aan wie een offerte gaf (instelbaar: melding in de
//   app · mail via de postbode, die in testmodus staat tot de eigenaar de mail live zet · niets), zonder prijzen en zonder de naam
//   van de gekozen firma.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Text "mo:core/Text";
import Types "../types";
import TV "../types/tenderviews";
import Access "Access";
import Config "Config";
import Dossier "Dossier";
import Ids "Ids";
import Library "Library";
import Post "Post";
import Rights "Rights";
import TenderCalc "TenderCalc";
import TenderCompare "TenderCompare";
import Tenders "Tenders";

module {
  type TS = Types.TenderState;

  public let thanksDefault : Text = "melding";
  public let deviationBpDefault : Nat = 1_500; // 15 % (ontwerp 2c §4.3)
  public let maxChapterTotals : Nat = 60;

  public func thanksMode(s : Types.SettingsState) : Text {
    switch (s.values.get("tender.thanksMode")) { case (?"mail") "mail"; case (?"niets") "niets"; case _ thanksDefault };
  };
  public func deviationBp(s : Types.SettingsState) : Nat { Dossier.setting(s, "tender.deviationBp", deviationBpDefault) };

  public func extraOf(x : Types.Extra, k : Text) : Text {
    switch (x.find(func((a, _) : (Text, Text)) : Bool = a == k)) { case (?(_, v)) v; case null "" };
  };
  // "posten" · "hoofdstukken" · "totaal" (2c.2 kent enkel posten).
  public func formOf(a : Types.OaQuoteAmounts) : Text {
    let f = extraOf(a.extra, "vorm");
    if (f == "hoofdstukken" or f == "totaal") f else "posten";
  };

  // Het volgende versienummer op een uitnodiging (hoogste + 1).
  public func nextVersion(ts : TS, i : Types.TenderInvite, workId : Nat) : (Nat, ?Nat) {
    var max = 0;
    var last : ?Nat = null;
    for (q in Tenders.oaQuotesOfInvite(ts, i, workId).values()) { if (q.version >= max) { max := q.version; last := ?q.id } };
    (max + 1, last);
  };

  // De geldende offerte per uitnodiging (laatste ontvangen versie), in de volgorde van de uitnodigingen.
  public func current(ts : TS, t : Types.Tender) : [Types.OaQuote] {
    var out : [Types.OaQuote] = [];
    for (i in Tenders.invitesOf(ts, t.id).values()) {
      // De laatste indiening geldt; trok kantoor die in (open punt 2c.3), dan heeft de firma geen geldende offerte meer
      // (een oudere versie komt niet terug: ze is door de firma zelf vervangen).
      let qs = Tenders.oaQuotesOfInvite(ts, i, t.workId);
      if (qs.size() > 0) {
        let last = qs[qs.size() - 1];
        if (last.status == #received) { out := out.concat([last]) };
      };
    };
    out;
  };

  public func isCurrent(ts : TS, t : Types.Tender, oaQuoteId : Nat) : Bool {
    current(ts, t).find(func(q : Types.OaQuote) : Bool = q.id == oaQuoteId) != null;
  };

  func plain<T>(c : Types.Confidential<T>) : ?T { switch c { case (#plain x) ?x; case (#sealed _) null } };

  public func choicesOf(ts : TS, t : Types.Tender) : [Types.TenderChoice] {
    Tenders.itemsOf(ts, t.id).filterMap(func(x : Types.TenderItem) : ?Types.TenderChoice = switch (ts.choices.get(x.id)) { case (?c) plain(c); case null null });
  };

  // ── Regels van een geregistreerde offerte (Excel of met de hand) ──────────
  func normUnit(u : Text) : Text {
    var s = u.trim(#char ' ').toLower();
    s := s.replace(#text "²", "2");
    s := s.replace(#text "³", "3");
    s := s.replace(#char ' ', "");
    s := s.replace(#char '.', "");
    s;
  };

  public func sameUnit(s : Types.SettingsState, key : Text, given : Text) : Bool {
    let g = normUnit(given);
    g == "" or g == normUnit(key) or g == normUnit(Library.unitName(s, key));
  };

  // Posten van de prijsvraag: de VH en eenheid van de OA (gewijzigd = markering "vh"/"eenheid"); eigen posten van de OA (itemId null).
  public func regLines(s : Types.SettingsState, ts : TS, tenderId : ?Nat, input : [TV.OaRegLine], maxOwn : Nat) : { #ok : [Types.OaQuoteLine]; #err : Text } {
    let seen = Map.empty<Nat, Bool>();
    var own = 0;
    var out : [Types.OaQuoteLine] = [];
    for (l in input.values()) {
      // Grenzen zoals het inlezen van de Excel en het antwoord in de app (2c.2): omschrijving 160, eenheid 40, opmerking 500.
      if (l.description.size() > 160) { return #err("Omschrijving: hoogstens 160 tekens") };
      if (l.unit.size() > 40) { return #err("Eenheid: hoogstens 40 tekens") };
      if (l.remark.size() > 500) { return #err("Opmerking: hoogstens 500 tekens per regel") };
      switch (l.included) { case (#alt a) { if (a.size() > 500) { return #err("Alternatief: hoogstens 500 tekens") } }; case _ {} };
      switch (l.unitCents) { case (?u) { if (u < 0 or u > Config.maxAmountCents) { return #err("Eenheidsprijs: 0 tot € 1 miljard") } }; case null {} };
      if (l.qtyMilli < 0 or l.qtyMilli > Config.maxQuoteQtyMilli) { return #err("Hoeveelheid: 0 tot 1 miljard") };
      switch (l.itemId, tenderId) {
        case (?id, ?tid) {
          let x = ts.items.get(id) ?? return #err("Deze post hoort niet bij de prijsvraag");
          if (x.tenderId != tid) { return #err("Deze post hoort niet bij de prijsvraag") };
          if (seen.containsKey(id)) { return #err("Een post staat twee keer in de offerte") };
          seen.add(id, true);
          let unit = l.unit.trim(#char ' ');
          let unitChanged = not sameUnit(s, x.unit, unit);
          let qty = l.qtyMilli;
          var changed : [Text] = [];
          if (qty != x.qtyMilli) { changed := changed.concat(["vh"]) };
          if (unitChanged) { changed := changed.concat(["eenheid"]) };
          out := out.concat([{ itemId = ?id; description = x.title; unit = if (unitChanged) unit else x.unit; qtyMilli = qty; unitCents = l.unitCents; amountCents = TenderCalc.lineAmount(l.unitCents, qty, l.included); included = l.included; remark = l.remark.trim(#char ' '); changed }]);
        };
        case (?_, null) { return #err("Een losse OA-offerte heeft geen posten van een prijsvraag") };
        case (null, _) {
          own += 1;
          if (own > maxOwn) { return #err("Hoogstens " # maxOwn.toText() # " eigen regels") };
          let d = l.description.trim(#char ' ');
          if (d.size() == 0) { return #err("Een eigen regel heeft een omschrijving") };
          out := out.concat([{ itemId = null; description = d; unit = l.unit.trim(#char ' '); qtyMilli = l.qtyMilli; unitCents = l.unitCents; amountCents = TenderCalc.lineAmount(l.unitCents, l.qtyMilli, l.included); included = l.included; remark = l.remark.trim(#char ' '); changed = [] }]);
        };
      };
    };
    #ok(out);
  };

  // ── De vergelijking ─────────────────────────────────────────────────────
  public func libItemOf(qs : Types.QuotesState, x : Types.TenderItem) : ?Nat {
    switch (qs.lines.get(x.lineId)) { case (?l) l.libItemId; case null null };
  };

  func fromThisTender(c : Types.LibCost, tenderId : Nat) : Bool { extraOf(c.extra, "prijsvraag") == tenderId.toText() };

  public func compareInput(s : Types.SettingsState, lib : Types.LibraryState, qs : Types.QuotesState, ts : TS, t : Types.Tender, today : Types.Day) : TV.CmpInput {
    let items = Tenders.itemsOf(ts, t.id);
    let cur = current(ts, t);
    let cmpItems = items.map(func(x : Types.TenderItem) : TV.CmpItem = { id = x.id; chapter = x.chapter; qtyMilli = x.qtyMilli; unit = x.unit; libItemId = libItemOf(qs, x) });
    let cmpQuotes = cur.map(func(q : Types.OaQuote) : TV.CmpQuote {
      switch (Tenders.amountsOf(ts, q.id)) {
        case (?a) { { id = q.id; orgId = q.orgId; form = formOf(a); discountBp = a.discountBp; netCents = a.netCents; lines = a.lines; chapterTotals = a.chapterTotals } };
        case null { { id = q.id; orgId = q.orgId; form = "totaal"; discountBp = null; netCents = 0; lines = []; chapterTotals = [] } };
      };
    });
    var hist : [TV.CmpHistory] = [];
    for (x in cmpItems.values()) {
      switch (x.libItemId) {
        case (?li) {
          let cs = Library.costsOf(lib, li).filter(func(c : Types.LibCost) : Bool = c.archivedAt == null and not fromThisTender(c, t.id));
          let last = Library.latestPerOrg(cs).filterMap(func(c : Types.LibCost) : ?(Nat, Int) = switch (c.orgId, plain(c.cost)) { case (?o, ?v) ?(o, v); case _ null });
          let recent = cs.filterMap(func(c : Types.LibCost) : ?Int = if (c.day + 365 >= today) plain(c.cost) else null);
          if (last.size() > 0 or recent.size() > 0) { hist := hist.concat([{ itemId = x.id; lastByOrg = last; recent }]) };
        };
        case null {};
      };
    };
    let picks = choicesOf(ts, t).filterMap(func(c : Types.TenderChoice) : ?TV.CmpPick = switch (c.oaQuoteId) { case (?q) ?{ itemId = c.itemId; oaQuoteId = q }; case null null });
    { items = cmpItems; quotes = cmpQuotes; history = hist; thresholdBp = deviationBp(s); picks };
  };

  public func compare(s : Types.SettingsState, lib : Types.LibraryState, qs : Types.QuotesState, ts : TS, t : Types.Tender, today : Types.Day) : (TV.CmpInput, TV.CmpResult) {
    let i = compareInput(s, lib, qs, ts, t, today);
    (i, TenderCompare.compare(i));
  };

  // Een post die een firma kan krijgen: een prijs per post, inbegrepen (of alternatief), in de eenheid van BOWACO.
  public func priceFor(ts : TS, q : Types.OaQuote, itemId : Nat) : { #ok : Int; #err : Text } {
    let a = Tenders.amountsOf(ts, q.id) ?? return #err("Deze offerte heeft geen bedragen");
    if (formOf(a) != "posten") { return #err("Deze offerte heeft enkel " # (if (formOf(a) == "totaal") "een totaal" else "hoofdstuktotalen") # ": vul de prijzen per post in (met de hand) om per post te kiezen") };
    let l = a.lines.find(func(x : Types.OaQuoteLine) : Bool = x.itemId == ?itemId) ?? return #err("Deze firma gaf geen prijs voor die post");
    if (l.included == #no) { return #err("Deze post is bij die firma niet inbegrepen") };
    if (l.changed.find(func(c : Text) : Bool = c == "eenheid") != null) { return #err("Deze firma rekende de post in een andere eenheid: neem de prijs met de hand over") };
    switch (l.unitCents) { case (?u) #ok(u); case null #err("Deze firma gaf geen prijs voor die post") };
  };

  // Een alternatief (#alt) is geen prijs van de post van BOWACO: nooit in het prijsgeheugen (review L2).
  public func isAlt(ts : TS, q : Types.OaQuote, itemId : Nat) : Bool {
    switch (Tenders.amountsOf(ts, q.id)) {
      case (?a) { switch (a.lines.find(func(x : Types.OaQuoteLine) : Bool = x.itemId == ?itemId)) { case (?l) { switch (l.included) { case (#alt _) true; case _ false } }; case null false } };
      case null false;
    };
  };

  // Keuzes op een offerte die intussen vervangen is (een nieuwe versie van die firma).
  public func staleChoices(ts : TS, t : Types.Tender) : Nat {
    choicesOf(ts, t).filter(func(c : Types.TenderChoice) : Bool = switch (c.oaQuoteId) { case (?q) not isCurrent(ts, t, q); case null false }).size();
  };

  // Een firma die enkel via het vinkje bij het afsluiten gekozen werd (geen keuze per post): haar prijzen zijn niet "niet gekozen";
  // ze gaan niet in het prijsgeheugen (review L1; het ontwerp zegt niets over gekozen zonder keuze per post).
  func checkboxOnly(ts : TS, t : Types.Tender, q : Types.OaQuote) : Bool {
    let chosen = switch (q.inviteId) { case (?iid) { switch (ts.invites.get(iid)) { case (?i) i.outcome == #chosen; case null false } }; case null false };
    chosen and choicesOf(ts, t).find(func(c : Types.TenderChoice) : Bool = c.oaQuoteId == ?q.id) == null;
  };

  public func choiceView(access : Types.AccessState, org : Types.OrgState, ts : TS, t : Types.Tender, c : Types.TenderChoice) : TV.TenderChoiceView {
    let q = switch (c.oaQuoteId) { case (?id) ts.oaQuotes.get(id); case null null };
    {
      itemId = c.itemId;
      oaQuoteId = c.oaQuoteId;
      orgId = switch q { case (?x) ?x.orgId; case null null };
      orgName = switch q { case (?x) { switch (org.orgs.get(x.orgId)) { case (?o) o.name; case null "" } }; case null "" };
      unitCents = c.unitCents;
      reason = c.reason;
      appliedVersionId = c.appliedVersionId;
      libCostId = c.libCostId;
      at = c.at;
      byName = Access.personName(access, c.by);
      stale = switch (c.oaQuoteId) { case (?id) not isCurrent(ts, t, id); case null false };
    };
  };

  // ── Prijsgeheugen in de postenbibliotheek (⚖5) ──────────────────────────
  public type Memory = { chosen : Map.Map<Nat, Nat>; added : Nat; kept : Nat; archived : Nat; skipped : Nat };

  public func remember(org : Types.OrgState, lib : Types.LibraryState, qs : Types.QuotesState, ts : TS, ctr : Types.Counters, t : Types.Tender, by : Nat, now : Int) : Memory {
    let chosenIds = Map.empty<Nat, Nat>();
    var added = 0;
    var kept = 0;
    var archived = 0;
    var skipped = 0;
    let cur = current(ts, t);
    for (x in Tenders.itemsOf(ts, t.id).values()) {
      switch (libItemOf(qs, x)) {
        case (?li) {
          switch (lib.items.get(li)) {
            case (?it) {
              if (it.archivedAt == null) {
                let pick = switch (ts.choices.get(x.id)) { case (?c) { switch (plain(c)) { case (?ch) ch.oaQuoteId; case null null } }; case null null };
                let mine = Library.costsOf(lib, li).filter(func(c : Types.LibCost) : Bool = c.archivedAt == null and fromThisTender(c, t.id) and extraOf(c.extra, "post") == x.id.toText());
                let used = Map.empty<Nat, Bool>();
                for (q in cur.values()) {
                  switch (if (isAlt(ts, q, x.id) or checkboxOnly(ts, t, q)) #err("") else priceFor(ts, q, x.id)) {
                    case (#ok u) {
                      let keuze = if (pick == ?q.id) "gekozen" else "niet gekozen";
                      let same = mine.find(func(c : Types.LibCost) : Bool = c.orgId == ?q.orgId and plain(c.cost) == ?u and c.day == q.quoteDay and extraOf(c.extra, "oaOfferte") == q.id.toText() and extraOf(c.extra, "keuze") == keuze);
                      switch same {
                        case (?c) { used.add(c.id, true); kept += 1; if (keuze == "gekozen") { chosenIds.add(x.id, c.id) } };
                        case null {
                          if (Library.costsOf(lib, li).size() >= Config.maxLibCostsPerItem) { skipped += 1 } else {
                            let id = Ids.next(ctr, "libCost");
                            let firm = switch (org.orgs.get(q.orgId)) { case (?o) o.name; case null "" };
                            let ref = "OA-offerte " # (if (q.number != "") q.number else t.code # " " # firm);
                            lib.costs.add(id, { id; itemId = li; orgId = ?q.orgId; day = q.quoteDay; cost = #plain(u); source = "oa-offerte"; ref = Text.fromIter(ref.chars().take(Config.maxName)); note = t.code # " · " # keuze; createdAt = now; createdBy = by; archivedAt = null; archivedBy = null; archiveReason = ""; extra = [("prijsvraag", t.id.toText()), ("post", x.id.toText()), ("oaOfferte", q.id.toText()), ("keuze", keuze)] });
                            Library.addCostIndex(lib, li, id);
                            used.add(id, true);
                            added += 1;
                            if (keuze == "gekozen") { chosenIds.add(x.id, id) };
                          };
                        };
                      };
                    };
                    case (#err _) {};
                  };
                };
                for (c in mine.values()) {
                  if (not used.containsKey(c.id)) {
                    lib.costs.add(c.id, { c with archivedAt = ?now; archivedBy = ?by; archiveReason = "vervangen: prijsvraag " # t.code # " opnieuw overgenomen" });
                    archived += 1;
                  };
                };
              };
            };
            case null {};
          };
        };
        case null {};
      };
      // De keuze onthoudt de prijs in de bibliotheek.
      switch (ts.choices.get(x.id)) {
        case (?c) { switch (plain(c)) { case (?ch) { ts.choices.add(x.id, #plain({ ch with libCostId = chosenIds.get(x.id) })) }; case null {} } };
        case null {};
      };
    };
    { chosen = chosenIds; added; kept; archived; skipped };
  };

  // ── Afsluiten: gekozen en bedankt, met het bericht (AC-13) ──────────────
  public type CloseCtx = { settings : Types.SettingsState; access : Types.AccessState; org : Types.OrgState; oa : Types.OaState; post : Types.PostState; audit : Types.AuditState; ctr : Types.Counters };

  // De gekozen uitnodigingen: wat kantoor aanvinkte + de firma's van de keuzes per post.
  public func chosenInvites(ts : TS, t : Types.Tender, explicit : [Nat]) : [Nat] {
    var out = explicit;
    for (c in choicesOf(ts, t).values()) {
      switch (c.oaQuoteId) {
        case (?qid) { switch (ts.oaQuotes.get(qid)) { case (?q) { switch (q.inviteId) { case (?iid) { if (out.find(func(x : Nat) : Bool = x == iid) == null) { out := out.concat([iid]) } }; case null {} } }; case null {} } };
        case null {};
      };
    };
    out;
  };

  public func thanksText(t : Types.Tender) : Text {
    "Prijsvraag " # t.code # " · " # t.title # ": uw offerte werd deze keer niet gekozen. Bedankt voor uw tijd en uw prijs.";
  };

  // Het bericht aan één niet-gekozen firma die een offerte gaf. true = er ging een bericht weg (melding of mail in de wachtrij).
  public func thank(c : CloseCtx, t : Types.Tender, i : Types.TenderInvite, by : Nat) : Bool {
    let mode = thanksMode(c.settings);
    if (mode == "niets") { return false };
    var sent = false;
    // Melding in de app: de personen van die firma met de rol onderaannemer en een actieve login (nooit een andere firma).
    for (p in c.access.persons.values()) {
      if (p.archivedAt == null and p.orgId == ?i.orgId and Rights.hasRole(p, #onderaannemer) and Access.hasActiveLink(c.access, p.id)) {
        Access.notify(c.audit, c.ctr, p.id, "prijsvraag-bedankt", thanksText(t), null);
        sent := true;
      };
    };
    if (mode == "mail") {
      let (email, name) = switch (i.contactPersonId) {
        case (?pid) {
          let e = switch (c.oa.personContacts.get(pid)) { case (?x) { switch (x.email) { case (?m) m.trim(#char ' '); case null "" } }; case null "" };
          (e, Access.personName(c.access, pid));
        };
        case null ("", "");
      };
      let (_, fresh) = Post.enqueue(c.post, c.ctr, "prijsvraag-bedankt", "prijsvraag-bedankt:" # i.id.toText(), ?i.orgId, i.contactPersonId, null, t.code, ?by, [("aan", email), ("naam", name), ("code", t.code), ("titel", t.title)]);
      if (fresh) { sent := true };
    };
    sent;
  };

  // Uitkomst per uitnodiging; het bericht enkel aan wie een offerte gaf en niet gekozen is. Geeft (gekozen, bedankt, berichten).
  public func close(c : CloseCtx, ts : TS, t : Types.Tender, chosen : [Nat], by : Nat, now : Int) : (Nat, Nat, Nat) {
    var nChosen = 0;
    var nThanked = 0;
    var nMsg = 0;
    for (i in Tenders.invitesOf(ts, t.id).values()) {
      if (chosen.find(func(x : Nat) : Bool = x == i.id) != null) {
        ts.invites.add(i.id, { i with outcome = #chosen });
        nChosen += 1;
      } else {
        let msg = i.status == #received and thank(c, t, i, by);
        if msg { nMsg += 1 };
        ts.invites.add(i.id, { i with outcome = #thanked({ at = now; notified = msg }) });
        nThanked += 1;
      };
    };
    (nChosen, nThanked, nMsg);
  };

  public func sortBriefs(xs : [TV.OaQuoteBrief]) : [TV.OaQuoteBrief] {
    xs.sort(func(a : TV.OaQuoteBrief, b : TV.OaQuoteBrief) : Order.Order = Nat.compare(b.id, a.id));
  };
};
