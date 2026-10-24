// Boete-opzoeking (stap 1b.2, bouwplan §5.2): een boete vermeldt dag, uur, plaats en nummerplaat. De app zoekt in de
// ritten van het werfverslag (1.6) wie met welk voertuig naar welke werf reed, wanneer de ploeg van BOWACO op die
// werf was (tijdvakken uit het verslag) en welke vergunning (1b.1) er die dag gold. Lezen volgt R14: de admin alle
// ritten, een werfleider enkel de zijne. Een update-call: elke opzoeking staat in de auditlog (dag en plaat, geen
// namen), want het antwoord zegt wie er reed.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Oa "../lib/Oa";
import Permits "../lib/Permits";
import Plan "../lib/Plan";
import Reports "../lib/Reports";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  permits : Types.PermitState,
  audit : Types.AuditState,
) {

  // Nummerplaat vergelijken zonder streepjes, punten en spaties ("1-ABC-234" = "1abc234").
  func fnPlate(t : Text) : Text { Oa.fold(t) };

  // Uur "07:30" uit de `extra` van een rit (1b.2: vertrek heen en terug, optioneel in het werfverslag).
  func fnTime(x : Types.Extra, k : Text) : ?Nat {
    switch (x.find(func(p : (Text, Text)) : Bool = p.0 == k)) {
      case (?(_, v)) {
        let parts = v.split(#char ':').toArray();
        if (parts.size() != 2) { return null };
        switch (Nat.fromText(parts[0]), Nat.fromText(parts[1])) { case (?h, ?m) { if (h < 24 and m < 60) ?(h * 60 + m) else null }; case _ null };
      };
      case null null;
    };
  };

  func fnName(id : ?Nat, text : Text) : Text {
    if (text.size() > 0) { return text };
    switch id { case (?i) Access.personName(access, i); case null "" };
  };

  // Plaats: elk woord van ≥ 3 tekens (of een postcode) moet in het werfadres staan.
  func fnPlace(place : Text, a : Types.Address) : Bool {
    let words = place.split(#predicate(func c = c == ' ' or c == ',' or c == '-')).filter(func(w : Text) : Bool = w.size() >= 3 or (w.size() == 4 and w.chars().all(func c = c >= '0' and c <= '9'))).toArray();
    if (words.size() == 0) { return false };
    let hay = Oa.fold(a.street # " " # a.number # " " # a.zip # " " # a.city);
    words.all(func w = hay.contains(#text(Oa.fold(w))));
  };

  public shared ({ caller }) func lookupFine(q : Views.FineQuery) : async Result.Result<Views.FineResult, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readTrips, null);
    if (q.day < Config.minDay or q.day > Config.maxDay) { return #err("Onmogelijke datum") };
    switch (q.time) { case (?t) { if (t >= 24 * 60) { return #err("Uur klopt niet") } }; case null {} };
    if (q.plate.size() > Config.maxShort or q.place.size() > Config.maxName * 2) { return #err("Te lange tekst") };
    let plate = fnPlate(q.plate);
    let place = q.place.trim(#char ' ');
    let from : Nat = if (q.widen) q.day - 1 else q.day;
    let to : Nat = if (q.widen) q.day + 1 else q.day;
    let vehicleKnown = plate.size() > 0 and org.vehicles.values().any(func v = fnPlate(v.plate) == plate);
    let out = List.empty<Views.FineMatch>();
    label scan for ((_, t) in reports.trips.reverseEntries()) {
      if (t.archivedAt == null and t.day >= from and t.day <= to and Rights.mayReadTrip(ctx, p, t.createdBy, [t.driverOutPersonId, t.driverBackPersonId])) {
        let plateMatch = plate.size() > 0 and fnPlate(t.plate) == plate;
        // Met een plaat: enkel ritten met die plaat. Zonder plaat: alle ritten van die dag (plaats en uur rangschikken).
        if (plate.size() == 0 or plateMatch) {
          let w = works.works.get(t.workId);
          let address : Types.Address = switch w { case (?w) w.address; case null { { street = ""; number = ""; zip = ""; city = ""; country = "" } } };
          let placeMatch = place.size() > 0 and fnPlace(place, address);
          // Tijdvakken van de ploeg van BOWACO (aanwezigheden zonder firma) op die werf en die dag.
          var crewFrom : ?Nat = null;
          var crewTo : ?Nat = null;
          let crew = List.empty<Text>();
          for (id in (switch (reports.dayIndex.get(Reports.dayKey(t.workId, t.day))) { case (?xs) xs; case null [] }).values()) {
            switch (reports.blocks.get(id)) {
              case (?b) {
                for (aid in b.attendances.values()) {
                  switch (reports.attendances.get(aid)) {
                    case (?a) {
                      if (a.archivedAt == null and a.orgId == null) {
                        for (s in a.slots.values()) {
                          crewFrom := ?(switch crewFrom { case (?f) Nat.min(f, s.fromMin); case null s.fromMin });
                          crewTo := ?(switch crewTo { case (?x) Nat.max(x, s.toMin); case null s.toMin });
                        };
                        crew.add((if (a.names.size() > 0) a.names else fnName(a.personId, "")) # " " # a.slots.map(func(s : Types.TimeSlot) : Text = Reports.hhmm(s.fromMin) # "–" # Reports.hhmm(s.toMin)).values().join(", "));
                      };
                    };
                    case null {};
                  };
                };
              };
              case null {};
            };
          };
          let outT = fnTime(t.extra, "heen");
          let backT = fnTime(t.extra, "terug");
          let outName = fnName(t.driverOutPersonId, t.driverOutText);
          let backName = fnName(t.driverBackPersonId, t.driverBackText);
          // Wie reed er op dat uur? Een gissing met de reden erbij; de mens beslist.
          let (guess, timeFits) : (Text, Bool) = switch (q.time) {
            case null ("geen uur opgegeven: heen " # (if (outName == "") "?" else outName) # ", terug " # (if (backName == "") "?" else backName), false);
            case (?m) {
              switch (backT, outT, crewFrom, crewTo) {
                case (?b, _, _, _) { if (m >= b) { ("terugrit (vertrek " # Reports.hhmm(b) # "): " # backName, true) } else fnCrew(m, outT, crewFrom, crewTo, outName, backName) };
                case _ fnCrew(m, outT, crewFrom, crewTo, outName, backName);
              };
            };
          };
          let valid = permits.permits.values().filter(
            func x = x.workId == t.workId and x.archivedAt == null and x.status != #cancelled and x.status != #refused and (switch (x.validFrom, x.validTo) { case (?a, ?b) t.day >= a and t.day <= b; case (null, ?b) t.day <= b; case _ false })
          ).map(func(x : Types.Permit) : Views.FinePermit = { id = x.id; kindName = Permits.kindName(settings, x.kind); location = x.location; reference = x.reference; validFrom = x.validFrom; validTo = x.validTo }).toArray();
          out.add({
            tripId = t.id;
            reportId = t.reportId;
            day = t.day;
            workId = t.workId;
            workCode = switch w { case (?w) w.code; case null "" };
            workName = switch w { case (?w) w.name; case null "" };
            address;
            plate = t.plate;
            vehicleName = switch (t.vehicleId) { case (?v) { switch (org.vehicles.get(v)) { case (?x) x.name; case null "" } }; case null "" };
            driverOut = outName;
            driverBack = backName;
            outTime = switch outT { case (?x) ?Reports.hhmm(x); case null null };
            backTime = switch backT { case (?x) ?Reports.hhmm(x); case null null };
            crew = crew.toArray();
            permits = valid;
            plateMatch;
            placeMatch;
            sameDay = t.day == q.day;
            guess;
            score = (if plateMatch 8 else 0) + (if placeMatch 4 else 0) + (if (t.day == q.day) 2 else 0) + (if timeFits 1 else 0);
          });
          if (out.size() >= 100) { break scan };
        };
      };
    };
    let matches = out.toArray().sort(func(a : Views.FineMatch, b : Views.FineMatch) : Order.Order = if (a.score != b.score) Nat.compare(b.score, a.score) else Nat.compare(b.tripId, a.tripId));
    Access.audit(audit, caller, ?p.id, null, "boete-opgezocht", Plan.fmtDay(q.day) # (switch (q.time) { case (?m) " " # Reports.hhmm(m); case null "" }) # (if (plate.size() > 0) " plaat " # q.plate else "") # " · " # matches.size().toText() # " ritten");
    #ok({ matches; vehicleKnown; ownTripsOnly = not Rights.isAdmin(p) });
  };

  // Uur tegenover de tijdvakken van de ploeg: vóór de ploeg = heenrit, erna = terugrit, ertussen = voertuig op de werf.
  func fnCrew(m : Nat, outT : ?Nat, crewFrom : ?Nat, crewTo : ?Nat, outName : Text, backName : Text) : (Text, Bool) {
    switch (crewFrom, crewTo) {
      case (?f, ?t) {
        if (m < f) { ("heenrit (vóór de ploeg om " # Reports.hhmm(f) # " begon): " # outName, true) }
        else if (m > t) { ("terugrit (na het einde om " # Reports.hhmm(t) # "): " # backName, true) }
        else { ("tijdens de werkuren (" # Reports.hhmm(f) # "–" # Reports.hhmm(t) # "): voertuig stond waarschijnlijk aan de werf; heen reed " # outName, true) };
      };
      case _ {
        switch outT {
          case (?o) { if (m <= o + 120) ("heenrit (vertrek " # Reports.hhmm(o) # "): " # outName, true) else ("na de heenrit, geen uren van de ploeg: heen " # outName # ", terug " # backName, false) };
          case null ("geen uren in het verslag: heen " # outName # ", terug " # backName, false);
        };
      };
    };
  };
};
