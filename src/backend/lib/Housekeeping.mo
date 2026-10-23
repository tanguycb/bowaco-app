// Werk van de timer (elke 10 min). Begrensd (T17): alleen de recentste records, nooit alles.
// Tickets leven 10 min en codes hoogstens 30 dagen, dus van achter (nieuwste) naar voor lopen
// en stoppen zodra de records ouder zijn dan dat.
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Config "Config";

module {
  public func tick(access : Types.AccessState, robot : Types.RobotState, reports : Types.ReportState) {
    let now = Time.now();
    // opId's van de gsm (§8.3): na 30 dagen weg, de oudste eerst, hoogstens 1.000 per keer (D2-uitzondering).
    var n = 0;
    label ops for ((seq, opId) in reports.opOrder.entries()) {
      if (n >= 1_000) { break ops };
      switch (reports.ops.get(opId)) {
        case (?o) { if (o.at >= now - Config.opKeepDays * Config.day) { break ops }; reports.ops.remove(opId) };
        case null {};
      };
      reports.opOrder.remove(seq);
      n += 1;
    };
    label tickets for ((_, t) in robot.tickets.reverseEntries()) {
      if (t.createdAt < now - 2 * Config.hour) { break tickets };
      if (t.state == #open and now > t.expiresAt) { t.state := #expired };
    };
    label invites for ((_, i) in access.invites.reverseEntries()) {
      if (i.createdAt < now - (Config.inviteDaysMax + 1) * Config.day) { break invites };
      if (i.state == #open and now > i.expiresAt) { i.state := #expired({ at = i.expiresAt }) };
    };
  };
};
