// BOWACO werfbeheer — compositiewortel (architectuur §10.1). De toestand staat hier, de API zit in
// de mixins; elke mixin krijgt hele domeinrecords (M12). Beginwaarden komen uit migrations/.
// GEEN publieke functies hier, en nooit een `let`/`var` op het hoogste niveau van een mixin.
import Timer "mo:core/Timer";
import Types "types";
import Config "lib/Config";
import Housekeeping "lib/Housekeeping";
import StorageGate "mixins/StorageGate";
import AccessApi "mixins/AccessApi";
import PeopleApi "mixins/PeopleApi";
import WorksApi "mixins/WorksApi";
import AdminApi "mixins/AdminApi";
import FilesApi "mixins/FilesApi";
import TicketsApi "mixins/TicketsApi";
import DossierApi "mixins/DossierApi";

persistent actor {
  let settings : Types.SettingsState;
  let access : Types.AccessState;
  let org : Types.OrgState;
  let works : Types.WorksState;
  let files : Types.FileState;
  let dossier : Types.DossierState; // 1.1: werffiche, contract (vertrouwelijk), documenten
  let robot : Types.RobotState;
  let audit : Types.AuditState;
  let ctr : Types.Counters;

  include StorageGate(settings, access, works);
  include AccessApi(settings, access, works, robot, audit, ctr, org);
  include PeopleApi(settings, access, org, works, audit, ctr);
  include WorksApi(settings, access, org, works, dossier, audit, ctr);
  include AdminApi(settings, access, org, works, files, dossier, robot, audit, ctr);
  include FilesApi(settings, access, works, files, dossier, audit, ctr);
  include DossierApi(settings, access, works, files, dossier, audit, ctr);
  include TicketsApi(settings, access, works, robot, audit, ctr);

  // Timers overleven geen upgrade; deze regel zet hem bij elke installatie en upgrade opnieuw.
  // Elke 10 min klein werk: verlopen tickets en codes afsluiten (begrensd, T17).
  transient let _tick = Timer.recurringTimer<system>(
    #seconds(Config.timerSeconds),
    func() : async () { Housekeeping.tick(access, robot) },
  );
};
