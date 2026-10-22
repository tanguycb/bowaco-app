// Timer en proefmetingen van stap 0.2.
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Time "mo:core/Time";
import Types "../types";

module {
  // Elke minuut: tellen (regelmaat meten) en verlopen tickets opruimen.
  public func tick(st : Types.State, tmr : Types.TimerState) {
    let now = Time.now();
    tmr.ticks += 1;
    tmr.lastTick := now;
    let keep = if (tmr.recent.size() >= 30) { tmr.recent.sliceToArray(1, tmr.recent.size()) } else { tmr.recent };
    tmr.recent := keep.concat([now]);
    // Verlopen, ongebruikte tickets weg (een uur marge voor het voorstel van de robot).
    let old = st.tickets.entries().filter(func(_, t) = now > t.expiresAt + 3_600_000_000_000).map(func(id, t) = (id, t.hash)).toArray();
    for ((id, hash) in old.values()) {
      st.tickets.remove(id);
      st.ticketIndex.remove(hash);
    };
    tmr.expiredTickets += old.size();
  };
};
