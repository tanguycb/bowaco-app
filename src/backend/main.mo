// BOWACO werfbeheer — compositiewortel (architectuur §10.1). De toestand staat hier, de API zit in
// de mixins; elke mixin krijgt hele domeinrecords (M12). Beginwaarden komen uit migrations/.
// GEEN publieke functies hier, en nooit een `let`/`var` op het hoogste niveau van een mixin.
import Time "mo:core/Time";
import Timer "mo:core/Timer";
import Map "mo:core/Map";
import Types "types";
import Config "lib/Config";
import Housekeeping "lib/Housekeeping";
import Tasks "lib/Tasks";
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
import LibraryApi "mixins/LibraryApi";
import QuotesApi "mixins/QuotesApi";
import QuoteDocsApi "mixins/QuoteDocsApi";
import QuoteClientApi "mixins/QuoteClientApi";
import WorkStartApi "mixins/WorkStartApi";
import MeasureApi "mixins/MeasureApi";
import ProgressApi "mixins/ProgressApi";
import OaInvoiceApi "mixins/OaInvoiceApi";
import StageApi "mixins/StageApi";
import StartApi "mixins/StartApi";
import ReviewApi "mixins/ReviewApi";
import QuoteFormsApi "mixins/QuoteFormsApi";
import TendersApi "mixins/TendersApi";
import OaQuotesApi "mixins/OaQuotesApi";
import OaDealsApi "mixins/OaDealsApi";
import PurchaseApi "mixins/PurchaseApi";
import MinMeerApi "mixins/MinMeerApi";
import SiteAdminApi "mixins/SiteAdminApi";
import SiteAdmin "lib/SiteAdmin";
import MeetApi "mixins/MeetApi";
import SalesApi "mixins/SalesApi";
import OaDeals "lib/OaDeals";
import Post "lib/Post";
import Mail "lib/Mail";
import AiConnector "lib/ai/Connector";
import AiApi "mixins/AiApi";
import McpApi "mixins/McpApi";
import Bots "lib/Bots";
import Proof "lib/Proof";
import ProofApi "mixins/ProofApi";
import OaReadApi "mixins/OaReadApi";
import OaRead "lib/OaRead";
import InvCheckApi "mixins/InvCheckApi";
import NacalcApi "mixins/NacalcApi";
import BriefingApi "mixins/BriefingApi";
import InvCheck "lib/InvCheck";
import TodoApi "mixins/TodoApi";
import TasksApi "mixins/TasksApi";
import AiCheckApi "mixins/AiCheckApi";
import AiCheck "lib/AiCheck";
import OAuth "mo:caffeineai-mcp-server/OAuth";
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
  let library : Types.LibraryState; // 2.2: postenbibliotheek (intern) + aankoopprijzen en verkoopregels (vertrouwelijk)
  let quotes : Types.QuotesState; // 2.4: offertes, versies, hoofdstukken, lijnen (intern) + prijs per lijn (vertrouwelijk)
  let quoteChecks : Types.QuoteChecksState; // 2.6: instellingen van de controleregels en doorgezette waarschuwingen
  let quoteDocs : Types.QuoteDocsState; // 2.7: voorwaarden met versies, vastgelegde velden van een verzonden offerte, akkoorden
  let workStarts : Types.WorkStartState; // 2.8: aanvaarde offerte → werf (start of afgewezen voorstel per offerteversie)
  let surveys : Types.SurveyState; // 2.9: opmetingen ter plaatse (rondes per werf, regels per post, stand bij het afsluiten)
  let progress : Types.ProgressState; // 2.10: vorderingsstaten (ontwerp → verzonden onder een hash, creditnota, klantakkoord)
  let oaInvoices : Types.OaInvoiceState; // 2.11: facturen van onderaannemers (intern) + bedragen en regels (vertrouwelijk)
  let quoteForms : Types.QuoteFormState; // 2c.1: offertesoort, subgroepen, tekstblokken (intern) + klassen, marges, regie, korting (vertrouwelijk)
  let oaDeals : Types.OaDealState; // 2c.4: tarieven met datum, afspraken per werf en firma, contractsjablonen en -versies, attesten (bedragen vertrouwelijk)
  let purchases : Types.PurchaseState; // 2c.7: aankoopfacturen over één of meer werven (intern) + regels en bedragen, voorschotten (vertrouwelijk), uren per dag (zonder bedrag)
  let siteAdmin : Types.SiteAdminState; // 2c.8: verzekeringen per werf, werfvergaderingen, opleveringen, technische fiches (werfwaarde en premie vertrouwelijk)
  let tenders : Types.TenderState; // 2c.2: prijsvragen, posten, gevraagde firma's, OA-offertes (intern) + bedragen, ontwerpen van de OA, keuzes (vertrouwelijk)
  let sales : Types.SalesState; // 2c.6: verkoopfacturen per werf (schema, facturen en creditnota's, herinneringen; regels, vastgelegde inhoud en betalingen vertrouwelijk)
  let minMeer : Types.MinMeerState; // 2c.5: min-meerstaat per werf (regels, voorstellen, uitsluitingen, versies, akkoorden; prijzen, regietarief en vastgelegde inhoud vertrouwelijk)
  let robot : Types.RobotState;
  let bots : Types.BotState; // 3.4 + 3.13: bots via MCP (fiches, acties met ongedaan maken, logboek zonder inhoud, OAuth van caffeineai-mcp-server)
  let proof : Types.ProofState; // 3.5: proefbank (testsets uit de historiek, proefrondes per bot of AI-fiche, antwoorden, score)
  let oaRead : Types.OaReadState; // 3.8: inleesopdrachten van OA-offertes (voorstel met bedragen vertrouwelijk, inhoud tot afsluiten)
  let aiCheck : Types.AiCheckState; // 3.9 + 3.11: nakijkopdrachten (OA-offertes vergelijken per prijsvraag, offerte nalezen vóór verzending)
  let invCheck : Types.InvCheckState; // 3.10: controleopdrachten van OA-facturen (resultaat met bevindingen vertrouwelijk, inhoud tot afsluiten)
  let todo : Types.TodoState; // 4b.1: Te doen (enkel wat iemand uitstelde; de lijst zelf wordt berekend)
  let tasks : Types.TaskStore; // 4b.5: één model voor taak en voorstel (de dossiers blijven in oaRead, aiCheck, invCheck en bots)
  let ai : Types.AiState; // 3.1: AI-connector (fiches, catalogus, logboek zonder inhoud, budget per maand, Postvak in later)
  let audit : Types.AuditState;
  let ctr : Types.Counters;

  // mail-caffeine: één verstuurronde tegelijk (klokjob hieronder en de knop "Nu versturen" in PostApi). Transient.
  transient let mailLock = Mail.newLock();
  // De draftcanister van dit project: daar blijft de testmodus altijd aan (Config.draftBackends).
  func isDraft() : Bool { Mail.isDraft(Principal.fromActor(Self)) };
  // 1b.5: enkel de livecanister (Config.mailLiveBackends) kan echte mail sturen; elders blijft de testmodus aan.
  func isLive() : Bool { Mail.isLive(Principal.fromActor(Self)) };
  // 3.1: enkel de livecanister (Config.aiLiveBackends; de testbouw: elke canister) belt de inferentiedienst echt.
  func isAiLive() : Bool { AiConnector.isLive(Principal.fromActor(Self), isDraft()) };

  include StorageGate(settings, access, works, tenders, oaDeals);

  // 4b.5: het model van taak en voorstel gelijkzetten met de dossiers (lib/Tasks.mo). Na elke wijziging aan een opdracht of een
  // voorstel (de mixins krijgen deze functie mee), in de klokronde (vangnet, met opruimen) en hieronder bij elke installatie en
  // upgrade: zo komen de opdrachten van vóór 4b.5 in het model zonder dat de migratie de oude velden hoeft te lezen.
  func syncTasks() { ignore Tasks.sync(tasks, { oaRead; aiCheck; invCheck; bots; tenders }, Time.now(), false) };
  transient let _taskSync : Nat = Tasks.sync(tasks, { oaRead; aiCheck; invCheck; bots; tenders }, Time.now(), false);
  include AccessApi(settings, access, works, robot, audit, ctr, org, oaDeals, bots);
  include PeopleApi(settings, access, org, works, audit, ctr);
  include WorksApi(settings, access, org, works, dossier, plan, wadm, audit, ctr);
  include AdminApi(settings, access, org, works, files, dossier, oa, plan, board, imp, reports, permits, post, mail, wadm, library, quotes, quoteChecks, quoteDocs, workStarts, surveys, progress, oaInvoices, quoteForms, tenders, oaDeals, purchases, minMeer, siteAdmin, sales, robot, ai, audit, ctr, bots);
  include FilesApi(settings, access, works, files, dossier, reports, permits, surveys, tenders, oaDeals, purchases, siteAdmin, audit, ctr);
  include DossierApi(settings, access, org, works, files, dossier, plan, wadm, audit, ctr);
  include OaApi(settings, access, org, works, oa, audit, ctr);
  include PlanApi(settings, access, org, works, plan, audit, ctr);
  include BoardApi(settings, access, org, works, plan, board, audit, ctr);
  include ImportApi(settings, access, org, works, plan, imp, audit, ctr);
  include ReportsApi(settings, access, org, works, files, plan, imp, reports, audit, ctr);
  include ExternApi(settings, access, org, works, reports, audit, ctr);
  include DashboardApi(settings, access, org, works, plan, reports, permits);
  include TicketsApi(settings, access, works, robot, ai, audit, ctr);
  // 1.9: herstel uit een export op een LEGE canister met de opstartcode (M9, T16).
  include RestoreApi(settings, access, org, works, files, dossier, oa, plan, board, imp, reports, permits, post, mail, wadm, library, quotes, quoteChecks, quoteDocs, workStarts, surveys, progress, oaInvoices, quoteForms, tenders, oaDeals, purchases, minMeer, siteAdmin, sales, robot, ai, audit, ctr);
  // 1b.1: vergunningenregister (R13), kennisbank per gemeente.
  include PermitsApi(settings, access, works, files, plan, permits, audit, ctr);
  // 1b.2: boete-opzoeking op de ritten van het werfverslag (R14) met de vergunningen van die dag.
  include FinesApi(settings, access, org, works, plan, reports, permits, audit);
  // mail-caffeine (E-11): de app verstuurt zelf via de maildienst van Caffeine (testmodus, logboek); geen robot meer.
  include PostApi(settings, access, org, oa, works, plan, reports, robot, post, mail, audit, ctr, mailLock, isDraft, isLive);
  // 1b.4: werfadministratie (30bis, Checkinatwork-export, inhoudingsplicht per OA).
  include WadmApi(settings, access, org, works, dossier, plan, reports, permits, wadm, audit, ctr);
  // 2.2: postenbibliotheek (hoofdstukken, posten, versies; prijzen per OA en verkoopregel vertrouwelijk, R20–R23).
  include LibraryApi(settings, access, org, works, plan, library, audit, ctr);
  // 2.4: offerte-editor (versies, hoofdstukken, lijnen; prijs per lijn vertrouwelijk; rekenen in de browser + controle hier).
  include QuotesApi(settings, access, org, works, dossier, library, quotes, quoteChecks, quoteDocs, quoteForms, audit, ctr);
  // 2.7: voorwaarden met versies, getekend bewijs en mail naar de klant (kantoor) en de offerte voor de klant (akkoord).
  include QuoteDocsApi(settings, access, works, dossier, files, quotes, quoteDocs, post, audit, ctr);
  include QuoteClientApi(settings, access, org, works, quotes, quoteDocs, quoteForms, audit, ctr);
  // 2.8: een aanvaarde offerte → voorstel "Werf starten" (werf, taken uit de posten, vergunningsvoorstellen, 30bis).
  include WorkStartApi(settings, access, org, works, dossier, files, plan, permits, wadm, library, quotes, quoteDocs, workStarts, quoteForms, tenders, oaDeals, audit, ctr);

  // 2.9: opmeting ter plaatse (hoeveelheid per post, foto of schets, verschil met de VH; offline via de wachtrij van 1.6).
  include MeasureApi(settings, access, org, works, files, plan, library, quotes, workStarts, surveys, audit, ctr);

  // 2.10: vorderingsstaten (cumulatief per werf en periode, contractparameters, PDF, onwijzigbaar na verzending, klantakkoord).
  include ProgressApi(settings, access, org, works, dossier, plan, reports, quotes, quoteForms, workStarts, surveys, progress, audit, ctr);

  // 2.11: OA-facturen registreren en controleren (afspraken, regie-uren, opmeting, al gefactureerd; inhoudingsplicht bij goedkeuring).
  include OaInvoiceApi(settings, access, org, works, files, plan, reports, quotes, workStarts, surveys, wadm, oaInvoices, oaDeals, purchases, audit, ctr);

  // 2c.7: aankoopfacturen zoals ze binnenkomen (meerdere werven = werfdelen van 2.11, ploeguren, uren per dag naar de werfleider,
  // kostensoorten, voorschotten en aftrek, betaalkorting, leveranciersfacturen, doorrekenen naar de min-meerstaat).
  include PurchaseApi(settings, access, org, works, files, plan, reports, quotes, workStarts, surveys, oaInvoices, oaDeals, purchases, audit, ctr);

  // 2c.8: werfadministratie en oplevering (verzekering per werf met aangifte binnen 15 dagen, werfvergadering met actiepunten, oplevering met
  // restpunten, technische fiches voor het PID, werfcode P.nnn); actie- en restpunten zijn gewone taken. Meldingen in de uurlijkse ronde.
  include SiteAdminApi(settings, access, org, works, files, dossier, plan, siteAdmin, audit, ctr);

  // 2b.3: de stand van de werf (stappenbalk en volgende stap); enkel lezen, de fase rekent de browser.
  include StageApi(settings, access, org, works, plan, reports, quotes, quoteForms, quoteDocs, workStarts, surveys, progress, tenders, oaDeals, oaInvoices, purchases, siteAdmin, sales);

  // 2b.4: het startpunt (Aan de slag, Zo werkt het voor jou); bewaard in settings.values, geen migratie.
  include StartApi(settings, access, works, audit);

  // 2b.6: "nog na te kijken" per werf (voorlopige keuzes van de inrichting); settings.values, geen migratie.
  include ReviewApi(settings, access, works, audit);

  // 2c.1: de offerte zoals Alexis ze maakt (margeklassen, tekstblokken, schadedossier, subgroepen, regietarief, korting).
  include QuoteFormsApi(settings, access, org, works, library, quotes, quoteForms, oaDeals, audit, ctr);

  // 2c.2: prijsvraag naar onderaannemers (posten kopiëren, firma's, deadline, PDF + Excel in de browser, toegang voor de OA zonder
  // werf, Mijn prijsvragen van de OA, eigen PDF opladen); herinnering en "geen antwoord" in Post.tick.
  include TendersApi(settings, access, org, oa, works, files, plan, library, quotes, quoteForms, tenders, post, dossier, reports, permits, surveys, oaDeals, purchases, siteAdmin, audit, ctr);

  include OaQuotesApi(settings, access, org, oa, works, files, library, quotes, tenders, oaDeals, bots, aiCheck, audit, ctr, syncTasks);

  // 2c.4: afspraken met de gekozen OA (tarieven met datum, afspraak per werf, contract uit het sjabloon, attesten; meldingen in de
  // uurlijkse ronde hieronder).
  include OaDealsApi(settings, access, org, oa, works, files, plan, quotes, workStarts, tenders, oaDeals, audit, ctr);

  // 2c.5: de min-meerstaat per werf (levend overzicht uit offerte, opmeting, werfverslag, OA-facturen en meerwerkoffertes; versies onder
  // een controlecode, delen met de klant) en de meerwerkofferte (een gewone offerte van de soort meerwerk bij de getekende offerte).
  include MinMeerApi(settings, access, org, works, dossier, plan, reports, quotes, quoteDocs, quoteForms, workStarts, surveys, progress, oaInvoices, oaDeals, purchases, minMeer, sales, audit, ctr);

  // 2c.6: verkoopfacturen (facturatieschema in schijven, factuur uit een schijf, vorderingsstaat of min-meerversie, nummer zonder gaten
  // bij het uitreiken, creditnota in een eigen reeks, betalingen, herinnering, kwartaallijst; de UBL maakt de browser).
  include SalesApi(settings, access, org, works, dossier, plan, reports, quotes, quoteDocs, quoteForms, workStarts, surveys, progress, oaInvoices, oaDeals, purchases, minMeer, sales, post, audit, ctr);

  // 3.1: AI-connector (ontwerp 3.1 §2.9): askAi (caffeine-weg in deze update-call, gateway-weg via een ticket), de proeftaak,
  // het logboek zonder inhoud, fiches en catalogus (admin), en reportAiUsage/failAiTicket voor de robot "ai" van de gateway.
  include AiApi(settings, access, works, robot, ai, audit, ctr, isDraft, isAiLive);

  // 3.4 + 3.13: de MCP-server (caffeineai-mcp-server: OAuth 2.1 + Internet Identity, /mcp) met de tools van lib/Bots.mo, en het
  // beheer van de bots (enkel #manageBots). Een bot is geen persoon; elke tool-oproep gaat door Rights.mayBot en de fiche.
  include McpApi(settings, access, org, works, files, dossier, tenders, oaInvoices, robot, bots, proof, oa, quotes, oaDeals, oaRead, plan, reports, workStarts, surveys, purchases, invCheck, permits, siteAdmin, minMeer, library, quoteForms, aiCheck, audit, ctr, syncTasks);
  // 3.5: de proefbank (enkel #manageBots): testsets, proefrondes voor een bot (proeftools op /mcp) of voor Caffeine AI, score per geval.
  include ProofApi(settings, access, works, files, dossier, org, tenders, oaRead, oaInvoices, quotes, robot, ai, bots, proof, audit, ctr, isAiLive);
  // 3.8: OA-offerte inlezen (PDF of foto via een bot, tekst via Caffeine AI) → een voorstel dat kantoor in het formulier overneemt.
  include OaReadApi(settings, access, org, oa, works, files, quotes, tenders, robot, ai, bots, oaRead, audit, ctr, isAiLive, syncTasks);
  // 3.10: OA-factuurcontrole (PDF, foto of Peppol-UBL via een bot, tekst via Caffeine AI) → een voorstel (goedkeuren · navragen ·
  // weigeren) met bevindingen; een mens beslist met de gewone knoppen van de factuur.
  // 3.9 + 3.11: nakijkopdrachten (een bot via MCP of Caffeine AI op het dossier van de app) → een voorstel per post (3.9; overnemen met
  // één klik = applyTenderCheck in OaQuotesApi) of opmerkingen bij het versturen van een offerte (3.11; nooit wijzigen of versturen).
  include AiCheckApi(settings, access, org, works, library, quotes, quoteForms, tenders, oaDeals, surveys, robot, ai, bots, aiCheck, audit, ctr, isAiLive, syncTasks);
  include InvCheckApi(settings, access, org, works, plan, reports, quotes, workStarts, surveys, oaInvoices, oaDeals, purchases, tenders, robot, ai, bots, invCheck, audit, ctr, isAiLive, syncTasks);
  // 4.6: nacalculatie (gepland tegenover werkelijk, enkel admin en calculator; de browser rekent).
  include NacalcApi(settings, access, org, works, dossier, plan, reports, quotes, quoteDocs, quoteForms, workStarts, surveys, progress, oaInvoices, oaDeals, purchases, minMeer, sales, audit);
  // 4.4: maandagbriefing (enkel lezen, zonder bedragen; voor de zaakvoerder).
  include BriefingApi(settings, access, org, works, plan, reports, dossier, permits, siteAdmin, quotes, minMeer, oaRead, aiCheck, invCheck, purchases);

  // 4b.1: Te doen (één lijst per persoon, de handeling als knop, uitstellen; geen bedragen).
  include TodoApi(settings, access, org, works, plan, board, reports, permits, quotes, quoteDocs, workStarts, minMeer, oaInvoices, purchases, oaDeals, siteAdmin, tenders, oaRead, aiCheck, invCheck, bots, audit, todo, tasks);
  // 4b.5: het model van taak en voorstel lezen (enkel #manageBots in deze stap).
  include TasksApi(settings, access, works, tasks, tenders, oaInvoices, quotes, proof, audit);

  // Timers overleven geen upgrade; deze regel zet hem bij elke installatie en upgrade opnieuw.
  // Elke 10 min klein werk: verlopen tickets en codes afsluiten, oude opId's van de gsm opruimen (begrensd, T17).
  // 1b.1: hoogstens eens per uur de vergunningen nakijken en melden wat aandacht vraagt (één keer per ding). Het
  // tijdstip van de laatste ronde is bewust niet stabiel: na een upgrade kijkt de eerste tik meteen na.
  transient var permitScanAt : Int = 0;
  // 2d.1: de delen van de klokronde als eigen functies, zodat de meetfunctie (MeetApi, enkel in de testbouw) exact dezelfde code meet.
  func tickSmall() {
    Housekeeping.tick(access, robot, reports, surveys);
    // 3.1: AI-oproepen zonder afloop na 15 min (onzeker, nooit vanzelf opnieuw) en het logboek na 400 dagen.
    ignore AiConnector.idle({ settings; access; robot; ai; audit; ctr }, Time.now());
    // 3.13: logboek van de bots na 400 dagen, oude dagtellers, onbesliste voorstellen na 30 dagen; verlopen OAuth-codes en koppelingen.
    Bots.idle(bots, Time.now());
    OAuth.prune(bots.oauth, Time.now());
    // 3.5: een open proefronde na 14 dagen sluiten (geen antwoord = fout).
    Proof.idle({ settings; access; works; files; dossier; proof; tenders; org; oaRead; oaInvoices; quotes }, Time.now());
    AiCheck.idle(aiCheck, tenders, quotes, bots, Time.now());
    OaRead.idle(oaRead, Time.now());
    InvCheck.idle(invCheck, oaInvoices, bots, Time.now());
    // 4b.5: wat de klok hierboven sloot of liet vervallen, ook in het model (en taken zonder dossier na 400 dagen weg).
    ignore Tasks.sync(tasks, { oaRead; aiCheck; invCheck; bots; tenders }, Time.now(), true);
    // 1b.3: verlopen leases terug in de wachtrij; op het ingestelde moment de weekmails en herinneringen klaarzetten.
    Post.tick({ settings; access; org; oa; works; plan; reports }, post, audit, ctr, tenders);
  };
  func klokVergunningen() { ignore Permits.scan({ settings; access; works; plan; ps = permits; audit; ctr }) };
  func klokAfspraken() { ignore OaDeals.scan(oaDeals, settings, access, org, audit, ctr, Post.local(Time.now()).day) };
  func klokWerfadmin() { ignore SiteAdmin.scan({ settings; access; org; works; plan; audit; ctr }, siteAdmin, Post.local(Time.now()).day) };
  func mailRound() : async* () {
    // 2d.2: een lege wachtrij = niets doen (geen slot, geen sleutels).
    if (Map.isEmpty(post.open)) return;
    ignore await* Mail.drain<system>({ c = { settings; access; org; oa; works; plan; reports }; ps = post; ms = mail; audit; ctr; lock = mailLock; live = isLive() }, Config.mailPerRound, null);
  };
  func measureRound(which : Text) : async* Bool {
    switch which {
      case "tick" tickSmall();
      case "vergunningen" klokVergunningen();
      case "vergunningen-lijst" ignore Permits.scanParts({ settings; access; works; plan; ps = permits; audit; ctr }, true, false);
      case "vergunningen-plan" ignore Permits.scanParts({ settings; access; works; plan; ps = permits; audit; ctr }, false, true);
      case "afspraken" klokAfspraken();
      case "werfadmin" klokWerfadmin();
      case "mail" await* mailRound();
      case _ return false;
    };
    true;
  };
  include MeetApi(access, works, settings, measureRound);

  transient let _tick = Timer.recurringTimer<system>(
    #seconds(Config.timerSeconds),
    func() : async () {
      tickSmall();
      if (Time.now() - permitScanAt >= Config.permitScanEvery) {
        permitScanAt := Time.now();
        klokVergunningen();
        klokAfspraken();
        klokWerfadmin();
        // 3.1: de modelcatalogus van Caffeine hoogstens eens per dag, en enkel op een canister die echt belt (nooit op een draft).
        if (isAiLive() and AiConnector.modelsOld(ai, Time.now())) { ignore await* AiConnector.refresh<system>(ai, Time.now()) };
      };
    },
  );

  // mail-caffeine: EIGEN klokjob voor het versturen (eigen slot, les MAIL2): een trage maildienst houdt het kleine werk
  // hierboven niet op, en een tweede ronde (de klok weer, of "Nu versturen") stopt meteen zolang deze loopt.
  transient let _mail = Timer.recurringTimer<system>(
    #seconds(Config.mailTimerSeconds),
    func() : async () { await* mailRound() },
  );
};
