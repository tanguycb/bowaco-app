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
import PostApi "mixins/PostApi";
import WadmApi "mixins/WadmApi";
import Post "lib/Post";
import Mail "lib/Mail";
import Principal "mo:core/Principal";

persistent actor Self {
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
  let post : Types.PostState; // 1b.3: werkwachtrij van de postbode
  let mail : Types.MailState; // mail-caffeine: logboek van de verstuurpogingen (geen adressen, geen inhoud)
  let wadm : Types.WadmState; // 1b.4: werfadministratie (inhoudingsplicht, aangifte van werken)
  let robot : Types.RobotState;
  let audit : Types.AuditState;
  let ctr : Types.Counters;

  // mail-caffeine: één verstuurronde tegelijk (klokjob hieronder en de knop "Nu versturen" in PostApi). Transient.
  transient let mailLock = Mail.newLock();
  // De draftcanister van dit project: daar blijft de testmodus altijd aan (Config.draftBackends).
  func isDraft() : Bool { Mail.isDraft(Principal.fromActor(Self)) };
  // 1b.5: enkel de livecanister (Config.mailLiveBackends) kan echte mail sturen; elders blijft de testmodus aan.
  func isLive() : Bool { Mail.isLive(Principal.fromActor(Self)) };

  include StorageGate(settings, access, works);
  include AccessApi(settings, access, works, robot, audit, ctr, org);
  include PeopleApi(settings, access, org, works, audit, ctr);
  include WorksApi(settings, access, org, works, dossier, plan, wadm, audit, ctr);
  include AdminApi(settings, access, org, works, files, dossier, oa, plan, board, imp, reports, permits, post, mail, wadm, robot, audit, ctr);
  include FilesApi(settings, access, works, files, dossier, reports, permits, audit, ctr);
  include DossierApi(settings, access, org, works, files, dossier, plan, wadm, audit, ctr);
  include OaApi(settings, access, org, works, oa, audit, ctr);
  include PlanApi(settings, access, org, works, plan, audit, ctr);
  include BoardApi(settings, access, org, works, plan, board, audit, ctr);
  include ImportApi(settings, access, org, works, plan, imp, audit, ctr);
  include ReportsApi(settings, access, org, works, files, plan, imp, reports, audit, ctr);
  include ExternApi(settings, access, org, works, reports, audit, ctr);
  include DashboardApi(settings, access, org, works, plan, reports, permits);
  include TicketsApi(settings, access, works, robot, audit, ctr);
  // 1.9: herstel uit een export op een LEGE canister met de opstartcode (M9, T16).
  include RestoreApi(settings, access, org, works, files, dossier, oa, plan, board, imp, reports, permits, post, mail, wadm, robot, audit, ctr);
  // 1b.1: vergunningenregister (R13), kennisbank per gemeente.
  include PermitsApi(settings, access, works, files, plan, permits, audit, ctr);
  // 1b.2: boete-opzoeking op de ritten van het werfverslag (R14) met de vergunningen van die dag.
  include FinesApi(settings, access, org, works, plan, reports, permits, audit);
  // mail-caffeine (E-11): de app verstuurt zelf via de maildienst van Caffeine (testmodus, logboek); geen robot meer.
  include PostApi(settings, access, org, oa, works, plan, reports, robot, post, mail, audit, ctr, mailLock, isDraft, isLive);
  // 1b.4: werfadministratie (30bis, Checkinatwork-export, inhoudingsplicht per OA).
  include WadmApi(settings, access, org, works, dossier, plan, reports, permits, wadm, audit, ctr);

  // Timers overleven geen upgrade; deze regel zet hem bij elke installatie en upgrade opnieuw.
  // Elke 10 min klein werk: verlopen tickets en codes afsluiten, oude opId's van de gsm opruimen (begrensd, T17).
  // 1b.1: hoogstens eens per uur de vergunningen nakijken en melden wat aandacht vraagt (één keer per ding). Het
  // tijdstip van de laatste ronde is bewust niet stabiel: na een upgrade kijkt de eerste tik meteen na.
  transient var permitScanAt : Int = 0;
  transient let _tick = Timer.recurringTimer<system>(
    #seconds(Config.timerSeconds),
    func() : async () {
      Housekeeping.tick(access, robot, reports);
      // 1b.3: verlopen leases terug in de wachtrij; op het ingestelde moment de weekmails en herinneringen klaarzetten.
      Post.tick({ settings; access; org; oa; works; plan; reports }, post, audit, ctr);
      if (Time.now() - permitScanAt >= Config.permitScanEvery) {
        permitScanAt := Time.now();
        ignore Permits.scan({ settings; access; works; plan; ps = permits; audit; ctr });
      };
    },
  );

  // mail-caffeine: EIGEN klokjob voor het versturen (eigen slot, les MAIL2): een trage maildienst houdt het kleine werk
  // hierboven niet op, en een tweede ronde (de klok weer, of "Nu versturen") stopt meteen zolang deze loopt.
  transient let _mail = Timer.recurringTimer<system>(
    #seconds(Config.mailTimerSeconds),
    func() : async () {
      ignore await* Mail.drain<system>({ c = { settings; access; org; oa; works; plan; reports }; ps = post; ms = mail; audit; ctr; lock = mailLock; live = isLive() }, Config.mailPerRound, null);
    },
  );
};
