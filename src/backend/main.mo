// BOWACO werfbeheer — compositiewortel (architectuur §10.1). De toestand staat hier, de API zit in
// de mixins; elke mixin krijgt hele domeinrecords (M12). Beginwaarden komen uit migrations/.
// GEEN publieke functies hier, en nooit een `let`/`var` op het hoogste niveau van een mixin.
import Time "mo:core/Time";
import Timer "mo:core/Timer";
import Types "types";
import Config "lib/Config";
import Housekeeping "lib/Housekeeping";
import Permits "lib/Permits";
import StorageGate "mixins/StorageGate";
import AccessApi "mixins/AccessApi";
import PeopleApi "mixins/PeopleApi";
import WorksApi "mixins/WorksApi";
import AdminApi "mixins/AdminApi";
import FilesApi "mixins/FilesApi";
import TicketsApi "mixins/TicketsApi";
import DossierApi "mixins/DossierApi";
import OaApi "mixins/OaApi";
import PlanApi "mixins/PlanApi";
import BoardApi "mixins/BoardApi";
import ImportApi "mixins/ImportApi";
import ReportsApi "mixins/ReportsApi";
import ExternApi "mixins/ExternApi";
import DashboardApi "mixins/DashboardApi";
import RestoreApi "mixins/RestoreApi";
import PermitsApi "mixins/PermitsApi";
import FinesApi "mixins/FinesApi";

persistent actor {
  let settings : Types.SettingsState;
  let access : Types.AccessState;
  let org : Types.OrgState;
  let works : Types.WorksState;
  let files : Types.FileState;
  let dossier : Types.DossierState; // 1.1: werffiche, contract (vertrouwelijk), documenten
  let oa : Types.OaState; // 1.2: contactgegevens van OA's en hun personen
  let plan : Types.PlanState; // 1.3: planning per werf (taken, uitvoerders, afhankelijkheden, kalender, sjablonen)
  let board : Types.BoardState; // 1.4: afwezigheden per firma en de regels voor een dubbele boeking (weekbord)
  let imp : Types.ImportState; // 1.5: importbatches, importsleutels en afspraken uit de planning
  let reports : Types.ReportState; // 1.6: werfverslagen (blokken), offline-opdrachten (opId)
  let permits : Types.PermitState; // 1b.1: vergunningen, kennisbank per gemeente, verstuurde meldingen
  let robot : Types.RobotState;
  let audit : Types.AuditState;
  let ctr : Types.Counters;

  include StorageGate(settings, access, works);
  include AccessApi(settings, access, works, robot, audit, ctr, org);
  include PeopleApi(settings, access, org, works, audit, ctr);
  include WorksApi(settings, access, org, works, dossier, audit, ctr);
  include AdminApi(settings, access, org, works, files, dossier, oa, plan, board, imp, reports, permits, robot, audit, ctr);
  include FilesApi(settings, access, works, files, dossier, reports, permits, audit, ctr);
  include DossierApi(settings, access, works, files, dossier, audit, ctr);
  include OaApi(settings, access, org, works, oa, audit, ctr);
  include PlanApi(settings, access, org, works, plan, audit, ctr);
  include BoardApi(settings, access, org, works, plan, board, audit, ctr);
  include ImportApi(settings, access, org, works, plan, imp, audit, ctr);
  include ReportsApi(settings, access, org, works, files, plan, imp, reports, audit, ctr);
  include ExternApi(settings, access, org, works, reports, audit, ctr);
  include DashboardApi(settings, access, org, works, plan, reports, permits);
  include TicketsApi(settings, access, works, robot, audit, ctr);
  // 1.9: herstel uit een export op een LEGE canister met de opstartcode (M9, T16).
  include RestoreApi(settings, access, org, works, files, dossier, oa, plan, board, imp, reports, permits, robot, audit, ctr);
  // 1b.1: vergunningenregister (R13), kennisbank per gemeente.
  include PermitsApi(settings, access, works, files, plan, permits, audit, ctr);
  // 1b.2: boete-opzoeking op de ritten van het werfverslag (R14) met de vergunningen van die dag.
  include FinesApi(settings, access, org, works, plan, reports, permits, audit);

  // Timers overleven geen upgrade; deze regel zet hem bij elke installatie en upgrade opnieuw.
  // Elke 10 min klein werk: verlopen tickets en codes afsluiten, oude opId's van de gsm opruimen (begrensd, T17).
  // 1b.1: hoogstens eens per uur de vergunningen nakijken en melden wat aandacht vraagt (één keer per ding). Het
  // tijdstip van de laatste ronde is bewust niet stabiel: na een upgrade kijkt de eerste tik meteen na.
  transient var permitScanAt : Int = 0;
  transient let _tick = Timer.recurringTimer<system>(
    #seconds(Config.timerSeconds),
    func() : async () {
      Housekeeping.tick(access, robot, reports);
      if (Time.now() - permitScanAt >= Config.permitScanEvery) {
        permitScanAt := Time.now();
        ignore Permits.scan({ settings; access; works; plan; ps = permits; audit; ctr });
      };
    },
  );
};
