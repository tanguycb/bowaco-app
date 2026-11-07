// 2d.1: meetfunctie voor het rekenwerk van de klokrondes (instructies van één ronde in deze oproep). Enkel in de testbouw van
// tests/lokaal.sh (Config.measureAnyCanister = true); de upload houdt false (tools/meetlat.mjs weigert anders), dan weigert ze altijd.
// Enkel de beheerder. Geen toestand, geen migratie.
import Prim "mo:prim";
import Runtime "mo:core/Runtime";
import Types "../types";
import Access "../lib/Access";
import Config "../lib/Config";
import Rights "../lib/Rights";

mixin (
  access : Types.AccessState,
  works : Types.WorksState,
  settings : Types.SettingsState,
  measureRound : Text -> async* Bool,
) {
  public shared ({ caller }) func meetKlok(which : Text) : async Nat64 {
    if (not Config.measureAnyCanister) { Runtime.trap("niet beschikbaar") };
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageRobots, null);
    let before = Prim.performanceCounter(0);
    if (not (await* measureRound(which))) { Runtime.trap("onbekende ronde") };
    Prim.performanceCounter(0) - before;
  };
};
