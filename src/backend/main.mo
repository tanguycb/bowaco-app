// BOWACO werfbeheer — stap 0.2 (haalbaarheidstest, draft 1).
// Compositiewortel: de toestand staat hier, de API zit in de mixins. Beginwaarden komen uit migrations/.
import Timer "mo:core/Timer";
import MixinObjectStorage "mo:caffeineai-object-storage/Mixin";
import Types "types";
import Config "lib/Config";
import Probe "lib/Probe";
import AccessApi "mixins/AccessApi";
import FilesApi "mixins/FilesApi";
import TicketsApi "mixins/TicketsApi";
import ProbeApi "mixins/ProbeApi";

persistent actor {
  let st : Types.State;
  let ctr : Types.Counters;
  let tmr : Types.TimerState;
  let vk : Types.VetkdState;

  include MixinObjectStorage();
  include AccessApi(st, ctr);
  include FilesApi(st, ctr);
  include TicketsApi(st, ctr);
  include ProbeApi(st, ctr, tmr, vk);

  // (g) Timers overleven geen upgrade; deze regel zet hem bij elke installatie en upgrade opnieuw.
  transient let _tick = Timer.recurringTimer<system>(
    #seconds(Config.timerSeconds),
    func() : async () { Probe.tick(st, tmr) },
  );
};
