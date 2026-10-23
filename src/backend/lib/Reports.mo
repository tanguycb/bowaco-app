// Werfverslag (stap 1.6, architectuur §2.6 en §8): kleine rekenregels zonder toestand, zodat de API
// (mixins/ReportsApi.mo) en de testen dezelfde regels gebruiken. Tijdvakken in minuten sinds middernacht.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Config "Config";

module {
  // De dag van vandaag (UTC). De gsm stuurt de Belgische kalenderdatum; die ligt hoogstens één dag verder.
  public func today() : Nat {
    let t = Time.now();
    if (t <= 0) 0 else Int.abs(t) / Int.abs(Config.day);
  };

  public func dayKey(workId : Nat, day : Nat) : Text { workId.toText() # ":" # day.toText() };

  // opId en clientKey: een UUID of een andere sleutel van het toestel (8–64 tekens, letters, cijfers, - en _).
  public func validKey(k : Text) : Bool {
    let n = k.size();
    if (n < 8 or n > 64) { return false };
    for (c in k.chars()) {
      let ok = (c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or (c >= '0' and c <= '9') or c == '-' or c == '_';
      if (not ok) { return false };
    };
    true;
  };

  // Tijdvakken: 1 tot 4, elk van < tot, binnen de dag, in volgorde en zonder overlap (voormiddag/namiddag).
  public func slotsError(slots : [Types.TimeSlot]) : ?Text {
    if (slots.size() == 0 or slots.size() > Config.maxSlots) { return ?("Geef 1 tot " # Config.maxSlots.toText() # " tijdvakken") };
    var last = 0;
    var first = true;
    for (s in slots.values()) {
      if (s.fromMin >= s.toMin or s.toMin > 24 * 60) { return ?"Een tijdvak loopt van een vroeger naar een later uur" };
      if (not first and s.fromMin < last) { return ?"De tijdvakken overlappen of staan niet in volgorde" };
      last := s.toMin;
      first := false;
    };
    null;
  };

  public func slotMinutes(slots : [Types.TimeSlot]) : Nat {
    var m = 0;
    for (s in slots.values()) { m += s.toMin - s.fromMin };
    m;
  };

  public func emptyBlocks() : Types.ReportBlocks {
    { attendances = []; workDone = []; materials = []; photos = []; issues = []; trips = [] };
  };

  public func isDraft(r : Types.DayReport) : Bool { switch (r.status) { case (#draft) true; case _ false } };
  public func isFinal(r : Types.DayReport) : Bool { switch (r.status) { case (#final _) true; case _ false } };

  public func append(xs : [Nat], x : Nat) : [Nat] { Array.concat(xs, [x]) };

  public func fileError(f : Views.FileIn) : ?Text {
    let n = f.name.trim(#char ' ');
    if (n.size() == 0 or n.size() > 200) { return ?"Bestandsnaam: 1 tot 200 tekens" };
    if (not Config.photoMime(f.mime)) { return ?"Alleen foto's (JPEG, PNG of WebP)" };
    if (f.size == 0 or f.size > Config.maxPhotoBytes) { return ?"Foto te groot: de gsm verkleint ze tot ± 300 KB" };
    if (f.blob.size() == 0 or f.blob.size() > 200) { return ?"Ongeldige verwijzing naar het bestand" };
    null;
  };

  public func materialWord(k : Types.MaterialKind) : Text {
    switch k {
      case (#receipt) "bon";
      case (#fromWarehouse) "uit magazijn of camionette";
      case (#smallMaterial) "klein materiaal";
      case (#equipment) "materieel";
      case (#wasteToWarehouse) "afval naar magazijn";
      case (#returned) "materiaal terug";
      case (#delivered) "geleverd";
    };
  };

  public func issueWord(k : Types.IssueKind) : Text {
    switch k {
      case (#problem) "probleem";
      case (#delay) "vertraging";
      case (#extraWorkProposal) "voorstel meerwerk";
      case (#safety) "veiligheid";
      case (#other) "andere";
    };
  };

  // "07:30" voor 450 minuten.
  public func hhmm(m : Nat) : Text {
    let h = m / 60;
    let mm = m % 60;
    (if (h < 10) "0" else "") # h.toText() # ":" # (if (mm < 10) "0" else "") # mm.toText();
  };

  // "7 u 30" voor 450 minuten.
  public func duration(m : Nat) : Text {
    let h = m / 60;
    let mm = m % 60;
    if (mm == 0) h.toText() # " u" else h.toText() # " u " # (if (mm < 10) "0" else "") # mm.toText();
  };
};
