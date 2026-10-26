// BOWACO werfbeheer: de vormen van de opgeslagen gegevens (stap 0.6, architectuur 0.4 §2).
// Regels: alleen toevoegen (D1/D2), ids uit tellers (D3), tijd in ns (D4), vertrouwelijk apart (D6),
// opgeslagen vorm ≠ API-vorm (D7, zie types/views.mo), `extra` op elk hoofdrecord (D8).
// Elk type in een Map is invariant voor de upgradecontrole: een veld of tag erbij = een migratie.
// Elk type draagt zijn dataklasse (architectuur §3) als commentaar.
import List "mo:core/List";
import Map "mo:core/Map";

module {
  public type PersonId = Nat;
  public type OrgId = Nat;
  public type WorkId = Nat;
  public type Extra = [(Text, Text)];

  // ── Vertrouwelijk (D6): #plain nu, #sealed in fase 2 zonder schemawijziging ──
  public type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  public type Confidential<T> = { #plain : T; #sealed : Sealed };

  public type Address = { street : Text; number : Text; zip : Text; city : Text; country : Text };
  public type Contact = { name : Text; phone : ?Text; email : ?Text; address : ?Address };

  // ── Personen en toegang (§2.3) ──────────────────────────────────────────
  // Interne rollen (admin, werfleider, calculator) gelden voor alle werven; externe rollen
  // alleen via een Membership per werf. Welke rol wat mag, staat ALLEEN in lib/Rights.mo.
  public type Role = {
    #admin;
    #werfleider;
    #calculator;
    #architect;
    #onderaannemer;
    #klant;
    #veiligheidscoordinator;
  };

  // klasse: intern
  public type Person = {
    id : PersonId;
    name : Text;
    roles : [Role];
    orgId : ?OrgId; // null = BOWACO zelf
    shortCode : ?Text; // planningcode ("KEVIN")
    lang : ?Text; // "nl" standaard
    phone : ?Text; // communicatiekanaal, nooit een login
    createdAt : Int;
    createdBy : PersonId; // 0 = opstartcode
    var archivedAt : ?Int; // afzetten = archiveren, nooit wissen
    extra : Extra;
  };

  public type LinkStatus = { #active; #pending; #revoked };

  // klasse: technisch. Principal → persoon; een persoon kan meerdere principals hebben.
  public type Link = {
    personId : PersonId;
    var status : LinkStatus;
    linkedAt : Int;
    codeHint : Text; // laatste 2 tekens van de gebruikte code
    inviteId : Nat; // 0 = opstartcode
    var tag : Text; // "iPhone Alexis"
    var confirmedBy : ?PersonId;
    var confirmedAt : ?Int;
    var revokedBy : ?PersonId;
    var revokedAt : ?Int;
  };

  // Een ingetrokken koppeling die plaats maakt voor een nieuwe koppeling van dezelfde principal.
  public type LinkHistory = {
    id : Nat;
    principal : Principal;
    personId : PersonId;
    linkedAt : Int;
    codeHint : Text;
    tag : Text;
    revokedAt : ?Int;
    revokedBy : ?PersonId;
    movedAt : Int;
  };

  public type CodeKind = { #invite; #recovery };
  public type CodeState = {
    #open;
    #used : { by : Principal; at : Int };
    #revoked : { by : PersonId; at : Int };
    #expired : { at : Int };
  };

  // klasse: geheim, gehasht. Alleen de hash, nooit de code.
  public type Invite = {
    id : Nat;
    hash : Blob;
    personId : PersonId;
    kind : CodeKind;
    createdBy : PersonId;
    createdAt : Int;
    expiresAt : Int;
    hint : Text;
    tag : Text;
    workIds : [WorkId]; // externe uitnodiging: meteen lid van deze werven
    var state : CodeState;
  };

  // klasse: technisch (pogingenteller; mag overschreven worden, D2-uitzondering)
  public type Attempts = { var windowStart : Int; var count : Nat; var blockedUntil : Int };

  // Globale remming op foute codes over alle principals (0.2 open punt 4).
  public type Throttle = {
    var windowStart : Int;
    var failures : Nat;
    var alertedWindow : Int; // venster waarvoor de admin al een melding kreeg
    var lockedUntil : Int; // > nu: alle codepogingen tijdelijk dicht
  };

  // klasse: vertrouwelijk (alleen voor klant-personen)
  public type PersonConfidential = { personId : PersonId; var contact : Confidential<Contact>; var version : Nat };

  public type AccessState = {
    persons : Map.Map<PersonId, Person>;
    links : Map.Map<Principal, Link>;
    linkHistory : Map.Map<Nat, LinkHistory>;
    invites : Map.Map<Nat, Invite>;
    codeIndex : Map.Map<Blob, Nat>;
    attempts : Map.Map<Principal, Attempts>;
    throttle : Throttle;
    personConfidential : Map.Map<PersonId, PersonConfidential>;
    var bootstrapUsed : Bool;
  };

  // ── Organisaties (§2.3) ─────────────────────────────────────────────────
  // 2b.1: #safetyCoordinator = firmasoort veiligheidscoördinator (migratie 20261026_180000).
  public type OrgKind = { #bowaco; #subcontractor; #architect; #client; #supplier; #authority; #other; #safetyCoordinator };

  // klasse: intern (adres van een klant hoort in OrgConfidential)
  public type Org = {
    id : OrgId;
    kind : OrgKind;
    name : Text;
    kbo : ?Text; // 10 cijfers
    vat : ?Text;
    aliases : [Text]; // planningcodes ("KEVIN", "KDS")
    trades : [Text]; // keys uit lookups (VOORLOPIG tot 0.3)
    address : ?Address;
    notes : Text;
    createdAt : Int;
    createdBy : PersonId;
    var archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: vertrouwelijk (klant-organisaties)
  public type OrgConfidential = {
    orgId : OrgId;
    var contact : Confidential<Contact>;
    var notes : Confidential<Text>;
    var version : Nat;
  };

  // klasse: intern
  public type Vehicle = { id : Nat; plate : Text; name : Text; createdAt : Int; var archivedAt : ?Int; extra : Extra };

  public type OrgState = {
    orgs : Map.Map<OrgId, Org>;
    orgConfidential : Map.Map<OrgId, OrgConfidential>;
    vehicles : Map.Map<Nat, Vehicle>;
  };


  // ── Onderaannemers-database (stap 1.2, architectuur §2.3) ───────────────
  // Eigen domein `oa` in plaats van Org en Person te verbreden (D1b): een nieuwe Map is een kleine
  // migratie in deelvorm (OldActor = {}). Wat OA's, leveranciers, nutsbedrijven en architecten
  // betreft zijn contactgegevens intern (architectuur §3); klantcontact blijft in OrgConfidential.
  // klasse: intern
  public type OrgContact = {
    orgId : OrgId;
    phone : ?Text;
    email : ?Text;
    website : ?Text;
    contactNote : Text; // bv. "bereikbaar na 17u", "enkel via WhatsApp"
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  // klasse: intern. Contactgegevens van een persoon van een externe firma (geen klant: die zijn vertrouwelijk).
  public type PersonContact = {
    personId : PersonId;
    email : ?Text;
    jobTitle : Text; // "zaakvoerder", "ploegbaas"
    note : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  public type OaState = {
    orgContacts : Map.Map<OrgId, OrgContact>;
    personContacts : Map.Map<PersonId, PersonContact>;
  };

  // ── Werven en lidmaatschappen (§2.4, §2.3) ──────────────────────────────
  public type WorkStatus = { #request; #quoting; #planned; #running; #delivered; #aftercare; #cancelled };

  // klasse: intern. Wijzigen = het record vervangen + een auditregel per veld (D2).
  public type Work = {
    id : WorkId;
    code : Text; // "2026-231" of "W-0042"
    name : Text;
    address : Address;
    parentId : ?WorkId; // deelwerf (één niveau diep, VOORLOPIG tot A9)
    clientOrgId : ?OrgId;
    architectOrgId : ?OrgId;
    leaderPersonId : ?PersonId;
    var status : WorkStatus;
    vatBp : Nat; // 600 of 2100
    plannedStart : ?Nat; // Day
    plannedEnd : ?Nat;
    // verouderd sinds 1.1: de geraamde aanneemsom is vertrouwelijk (ContractParams); blijft null.
    estimatedAmountCents : ?Int;
    // verouderd sinds 1.1: de veiligheidscoördinator is een lidmaatschap van de werf; blijft null.
    safetyCoordinatorOrgId : ?OrgId;
    createdAt : Int;
    createdBy : PersonId;
    var archivedAt : ?Int;
    extra : Extra;
  };

  public type Grant = { #readReports; #readSellPrices; #readProgress; #uploadDocs; #confirmHours; #confirmPlanning };

  // klasse: intern. Rol per werf: een persoon of een hele organisatie.
  public type Membership = {
    id : Nat;
    workId : WorkId;
    personId : ?PersonId;
    orgId : ?OrgId;
    role : Role;
    grants : [Grant];
    grantedAt : Int;
    grantedBy : PersonId;
    var endedAt : ?Int;
    var endedBy : ?PersonId;
  };

  public type WorksState = {
    works : Map.Map<WorkId, Work>;
    memberships : Map.Map<Nat, Membership>;
  };

  // ── Bestanden (§2.7) ────────────────────────────────────────────────────
  // klasse: intern; met confidential = true: vertrouwelijk (verwijzing alleen via update-call + logregel)
  public type FileRef = {
    id : Nat;
    name : Text;
    mime : Text;
    size : Nat; // opgegeven door de browser
    blob : Blob; // ExternalBlob "!caf!sha256:…": openbaar-voor-wie-hem-kent
    workId : ?WorkId;
    confidential : Bool;
    personId : PersonId;
    at : Int;
    var archivedAt : ?Int;
  };

  public type FileState = { files : Map.Map<Nat, FileRef> };

  // ── Werfdossier (stap 1.1, architectuur §2.4 en §2.7) ──────────────────
  // Eén nieuw domein in plaats van Work en FileState te verbreden (D1b): zo vraagt 1.1 één kleine
  // migratie in deelvorm met OldActor = {} (migrations/20261023_*).
  public type Day = Nat; // dagen sinds 1970-01-01 (Belgische kalenderdatum, D4)

  public type PriceRevision = { #none; #formula : Text };
  public type GuaranteeKind = { #none; #retention; #bankGuarantee }; // geen · inhouding op facturen · bankwaarborg
  public type InvoicingRhythm = { #monthly; #perPhase; #perProgress; #other : Text };

  // klasse: vertrouwelijk (de inhoud van Confidential<ContractParams>)
  public type ContractParams = {
    estimatedAmountCents : ?Int; // geraamde aanneemsom excl. btw (30bis, Checkinatwork)
    priceRevision : PriceRevision;
    guarantee : GuaranteeKind;
    guaranteeBp : Nat; // 500 = 5 %
    paymentTermDays : Nat;
    invoicingRhythm : InvoicingRhythm;
    signedQuoteVersionId : ?Nat; // fase 2
    note : Text;
  };

  // klasse: vertrouwelijk. Lezen alleen via een update-call met auditregel (R23, R27).
  public type WorkConfidential = {
    workId : WorkId;
    contract : Confidential<ContractParams>;
    clientContact : Confidential<Contact>; // contactpersoon van de klant voor deze werf
    notes : Confidential<Text>; // commerciële notities
    version : Nat;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  // klasse: vertrouwelijk. Elke versie blijft bewaard (D2, append-only).
  public type WorkConfidentialVersion = {
    id : Nat;
    workId : WorkId;
    version : Nat;
    contract : Confidential<ContractParams>;
    clientContact : Confidential<Contact>;
    notes : Confidential<Text>;
    at : Int;
    by : PersonId;
  };

  // klasse: intern. Administratieve gegevens van de werffiche die Work zelf niet heeft.
  public type WorkInfo = {
    workId : WorkId;
    analyticCode : ?Text; // analytische code boekhouding; null = de werfcode
    vatNote : Text; // grond voor het btw-tarief ("woning ouder dan 10 jaar")
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  public type DocStatus = { #missing; #requested; #received; #approved; #expired; #notApplicable };

  // klasse: intern; met confidential = true vertrouwelijk (de bestanden zijn dan ook vertrouwelijk).
  // Soort = sleutel uit settings.lookups ("docKind:…") of uit Config.defaultDocKinds (D9).
  public type Document = {
    id : Nat;
    workId : WorkId;
    kind : Text;
    title : Text;
    fileIds : [Nat]; // versies, de laatste is de actuele
    status : DocStatus;
    dueDay : ?Day;
    validUntil : ?Day; // keuring, verzekering: daarna "verlopen"
    note : Text;
    ownerOrgId : ?OrgId; // wie levert (firma van de veiligheidscoördinator, de OA …)
    confidential : Bool;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  public type DossierState = {
    info : Map.Map<WorkId, WorkInfo>;
    confidential : Map.Map<WorkId, WorkConfidential>;
    confidentialHistory : Map.Map<Nat, WorkConfidentialVersion>;
    documents : Map.Map<Nat, Document>;
  };

  // ── Planning per werf (stap 1.3, architectuur §2.5) ──────────────────────
  // Eigen domein `plan` (nieuw stabiel veld, deelvorm, OldActor = {}). De records zijn onveranderlijk:
  // wijzigen = het record vervangen + een TaskChange per veld (D2); zo kunnen ze ook rechtstreeks naar
  // buiten (export) zonder `var`. Tijd in kalenderdagen (Day, D4); duur in WERKDAGEN (ma–vr zonder
  // kalenderblokken: bouwverlof, feestdagen, STOP). Het einde wordt altijd berekend, nooit bewaard.
  public type TaskStatus = { #planned; #busy; #delayed; #done; #blocked }; // de vijf van §8.1
  // #work = gewone taak · #milestone = mijlpaal (0 dagen) · #delivery = levering van materiaal met levertermijn
  public type TaskKind = { #work; #milestone; #delivery };

  // klasse: intern
  public type Task = {
    id : Nat;
    workId : WorkId;
    title : Text;
    note : Text; // intern: externen zien de notitie niet
    kind : TaskKind;
    templateKey : ?Text; // stap uit een sjabloon ("afbraak"); vrije taak = null
    trade : ?Text; // vakgebied (sleutel uit de vakgebieden van 1.2)
    responsibleOrgId : ?OrgId; // de verantwoordelijke (kolom C van de planning)
    status : TaskStatus;
    percent : Nat; // 0–100
    start : Day; // geplande start (een werkdag)
    workdays : Nat; // duur in werkdagen; 0 bij een mijlpaal of levering
    leadDays : Nat; // levertermijn in kalenderdagen (enkel #delivery): bestellen → leveren
    orderDay : ?Day; // besteld op (enkel #delivery); null = nog niet besteld
    actualStart : ?Day; // werkelijk begonnen (1.6)
    actualEnd : ?Day;
    order : Nat; // volgorde in de Gantt
    quoteLineIds : [Nat]; // fase 2: offerteposten (leeg tot dan)
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  public type Confirmation = {
    #open;
    #confirmed : { by : PersonId; at : Int };
    #declined : { by : PersonId; at : Int; reason : Text };
  };

  // klasse: intern. Wie voert uit (de weekcel van de planning). Zonder fromDay/toDay = de hele taak;
  // met een bereik = een deel ervan (een tweede OA voor één week). Het weekbord van 1.4 = deze records
  // per orgId, met de dagen van de taak erbij berekend.
  public type Assignment = {
    id : Nat;
    taskId : Nat;
    workId : WorkId;
    orgId : OrgId;
    personId : ?PersonId;
    fromDay : ?Day;
    toDay : ?Day;
    note : Text; // vrije tekst van de cel ("FRANK 27/01 en 28/01")
    primary : Bool; // de verantwoordelijke van de taak (volgt Task.responsibleOrgId)
    confirmation : Confirmation; // terug op #open bij elke verschuiving
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    archivedAt : ?Int;
    extra : Extra;
  };

  public type DependencyKind = { #finishToStart; #startToStart };

  // klasse: intern. lagDays = wachttijd in werkdagen (droogtijd chape); negatief = overlap.
  public type Dependency = {
    id : Nat;
    workId : WorkId;
    fromTaskId : Nat;
    toTaskId : Nat;
    kind : DependencyKind;
    lagDays : Int;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
  };

  public type BlockScope = { #company; #work : WorkId; #org : OrgId };
  public type BlockKind = { #bouwverlof; #feestdag; #stop; #verlof; #other };

  // klasse: intern. Een blokkering van de kalender (bouwverlof, feestdag, STOP op een werf; verlof van
  // een OA komt in 1.4). Werkdagen in een blok tellen niet mee.
  public type CalendarBlock = {
    id : Nat;
    scope : BlockScope;
    kind : BlockKind;
    from : Day;
    to : Day; // tot en met
    reason : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: intern, append-only (D2). Elke wijziging aan een taak: wat schoof en waarom.
  public type TaskChange = {
    id : Nat;
    taskId : Nat;
    workId : WorkId;
    at : Int;
    by : PersonId;
    field : Text;
    from : Text;
    to : Text;
    reason : Text;
  };

  // klasse: intern. Een stap van een sjabloon; `after` = sleutels van de stappen waarop ze wacht
  // (einde → begin); lagDays = wachttijd in werkdagen na de EERSTE van die stappen.
  public type TemplateStep = {
    key : Text;
    title : Text;
    trade : ?Text;
    kind : TaskKind;
    workdays : Nat;
    leadDays : Nat;
    after : [Text];
    lagDays : Nat;
    note : Text;
  };

  // klasse: intern. Sjablonen staan in het plan-domein (gestructureerd), niet in settings.lookups.
  public type Template = {
    key : Text;
    name : Text;
    steps : [TemplateStep];
    provisional : Bool; // VOORLOPIG tot 0.3 / Alexis bevestigt
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  public type PlanState = {
    tasks : Map.Map<Nat, Task>;
    assignments : Map.Map<Nat, Assignment>;
    dependencies : Map.Map<Nat, Dependency>;
    calendarBlocks : Map.Map<Nat, CalendarBlock>;
    taskChanges : Map.Map<Nat, TaskChange>;
    templates : Map.Map<Text, Template>; // leeg = de standaard uit Config (VOORLOPIG)
    versions : Map.Map<WorkId, Nat>; // planversie per werf: wie verouderd bewaart, krijgt een fout
  };

  // ── Weekbord per OA (stap 1.4, architectuur §2.5 en rij 1.4 van §11) ─────
  // Eigen domein `board` (nieuw stabiel veld, deelvorm, OldActor = {}). Het weekbord zelf wordt altijd
  // berekend uit plan.assignments; hier staan enkel de afwezigheden per firma en de regels voor "dubbel".
  // Een afwezigheid schuift geen werf (zoals de #org-blokken van 1.3 bedoeld waren): ze geeft een conflict.
  public type AbsenceKind = { #verlof; #ziekte; #andere };
  public type AbsenceSource = { #intern; #oa }; // ingegeven door kantoor, of gemeld door de OA zelf

  // klasse: intern. Ziekte = enkel het soort, nooit een reden of een medisch detail (GDPR art. 9: de
  // notitie zegt dat erbij). personId = één persoon van de firma; null = de hele firma.
  public type Absence = {
    id : Nat;
    orgId : OrgId;
    personId : ?PersonId;
    kind : AbsenceKind;
    from : Day;
    to : Day; // tot en met
    note : Text;
    source : AbsenceSource;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: intern, append-only (D2): de geschiedenis van een afwezigheid (wie, wanneer, wat).
  public type AbsenceChange = {
    id : Nat;
    absenceId : Nat;
    orgId : OrgId;
    at : Int;
    by : PersonId;
    what : Text; // "nieuw" · "gewijzigd" · "weg"
    detail : Text; // "verlof 02.11.2026 – 06.11.2026" of "tot 13.11.2026 → 20.11.2026"
  };

  // klasse: intern. Hoeveel werven een firma tegelijk mag hebben voor het weekbord "dubbel" meldt.
  // Sleutel "org:<id>" (één firma) of "trade:<vakgebied>"; maxWorks 0 = onbeperkt.
  public type CapacityRule = {
    key : Text;
    maxWorks : Nat;
    note : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int; // weg = de firma of het vakgebied volgt weer de algemene regel
    extra : Extra;
  };

  public type BoardState = {
    absences : Map.Map<Nat, Absence>;
    absenceChanges : Map.Map<Nat, AbsenceChange>;
    capacity : Map.Map<Text, CapacityRule>;
  };

  // ── Import van de bestaande planning (stap 1.5) ─────────────────────────
  // Eigen domein `imp` (nieuw stabiel veld, deelvorm, OldActor = {}). De import bewaart per blok, taak,
  // cel en afspraak een vaste importsleutel: dezelfde Excel nog eens importeren maakt geen dubbels, en een
  // batch kan als geheel teruggedraaid (gearchiveerd) worden. Een afspraak (dag + uur + tekst) is nieuw.
  public type ImportBatch = {
    id : Text;
    title : Text;
    at : Int;
    by : PersonId;
    blocks : Nat;
    works : Nat;
    tasks : Nat;
    assignments : Nat;
    appointments : Nat;
    rolledBackAt : ?Int;
    rolledBackBy : ?PersonId;
    extra : Extra;
  };

  // #link: een blok dat als vervolg in een bestaande werf is opgegaan (geen eigen werf).
  public type ImportKind = { #work; #link; #task; #assignment; #appointment };

  public type ImportKey = { key : Text; kind : ImportKind; entityId : Nat; batchId : Text };

  // klasse: intern. De vrije tekst van een weekcel met een datum ("DORMA 7u30 28/01").
  public type Appointment = {
    id : Nat;
    workId : WorkId;
    taskId : Nat;
    day : Day;
    time : ?Text;
    text : Text;
    orgId : ?OrgId;
    weekFallback : Bool; // geen datum in de tekst: de maandag van de week is een vangnet
    batchId : ?Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  public type ImportState = {
    batches : Map.Map<Text, ImportBatch>;
    keys : Map.Map<Text, ImportKey>;
    appointments : Map.Map<Nat, Appointment>;
  };

  // ── Werfverslag (stap 1.6, architectuur §2.6 en §8) ─────────────────────
  // Eigen domein `reports` (nieuw stabiel veld, deelvorm, OldActor = {}). Een dagverslag is een SET VAN
  // BLOKKEN (aanwezigen, werken, materialen, foto's, problemen, ritten): blokken worden toegevoegd of
  // gearchiveerd, nooit overschreven, zodat twee toestellen op hetzelfde verslag geen conflict geven (§8.4).
  // Elk blok komt van één offline-opdracht met een opId (UUID van het toestel); dezelfde opId nog eens =
  // hetzelfde resultaat, geen dubbel (§8.3). Records zijn onveranderlijk (vervangen, zoals in `plan`).
  public type ReportStatus = {
    #draft;
    #final : { at : Int; by : PersonId };
    #corrected : { byReportId : Nat; at : Int }; // afgesloten en later gecorrigeerd door verslag #n
  };

  // klasse: intern. Eén open verslag per werf per dag; een tweede toestel komt in hetzelfde verslag.
  // Na het afsluiten (#final) verandert het niet meer (bewijs, D2): wat later komt, gaat naar een
  // correctieverslag (corrects = het afgesloten verslag).
  public type DayReport = {
    id : Nat;
    workId : WorkId;
    day : Day;
    authorPersonId : PersonId; // wie het verslag begon
    clientKey : Text; // sleutel van het toestel dat het begon (andere toestellen: reports.keys)
    status : ReportStatus;
    corrects : ?Nat;
    summary : Text; // laatste schrijver wint (ReportChange bewaart de vorige)
    weather : Text;
    createdAt : Int;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  public type TimeSlot = { fromMin : Nat; toMin : Nat }; // minuten sinds middernacht, Belgische tijd

  // klasse: intern. "Wie was er?" = regie-uren = bewijs Checkinatwork. orgId null = BOWACO zelf.
  public type Attendance = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    day : Day;
    orgId : ?OrgId;
    personId : ?PersonId; // één persoon met een fiche; anders de namen van de ploeg
    names : Text;
    headcount : Nat;
    slots : [TimeSlot];
    minutesTotal : Nat; // headcount × som van de tijdvakken
    regie : Bool;
    taskId : ?Nat;
    note : Text;
    blockKey : Text; // opId van de opdracht die dit blok maakte
    replacedBy : ?Nat; // aangepast: het nieuwe blok
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    extra : Extra;
  };

  // klasse: intern, append-only. De OA bevestigt (of betwist) zijn uren (R9, stap 1.7).
  public type HoursConfirmation = { id : Nat; attendanceId : Nat; orgId : OrgId; by : PersonId; at : Int; ok : Bool; remark : Text };

  // klasse: intern. Uitgevoerd werk; met taskId en percent zet het ook de voortgang van de taak.
  public type WorkDone = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    taskId : ?Nat;
    text : Text;
    percent : ?Nat;
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  // De zes soorten van het papieren werfverslag + een levering: bon (aankoop) · uit magazijn of camionette ·
  // klein materiaal · materieel · afval naar magazijn · materiaal terug · geleverd op de werf.
  public type MaterialKind = { #receipt; #fromWarehouse; #smallMaterial; #equipment; #wasteToWarehouse; #returned; #delivered };

  // klasse: intern; de foto van een bon toont aankoopprijzen: die verwijzing krijgen enkel interne rollen.
  public type MaterialNote = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    kind : MaterialKind;
    text : Text;
    quantity : Text; // vrije tekst ("4 zakken"): de offerte-eenheden komen in fase 2
    supplier : Text;
    fileId : ?Nat; // foto van de bon
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: intern. Het bestand zelf is een FileRef (opslagdienst, verkleind op de gsm).
  public type Photo = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    fileId : Nat;
    thumbFileId : ?Nat;
    taskId : ?Nat;
    caption : Text;
    takenAt : ?Int;
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  public type IssueKind = { #problem; #delay; #extraWorkProposal; #safety; #other };
  public type IssueStatus = { #open; #handled : { by : PersonId; at : Int; note : Text } };

  // klasse: intern. Een vertraging zet de genoemde taken op "vertraagd"; verschuiven doet de werfleider in de
  // Gantt (met voorvertoning), nooit stil vanop de gsm.
  public type Issue = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    kind : IssueKind;
    text : Text;
    taskIds : [Nat];
    delayDays : ?Nat; // werkdagen
    status : IssueStatus;
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: intern (R14: admin alle ritten, werfleider de zijne). Voertuig uit org.vehicles of een vrije plaat.
  public type Trip = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    day : Day;
    vehicleId : ?Nat;
    plate : Text;
    driverOutPersonId : ?PersonId;
    driverBackPersonId : ?PersonId;
    driverOutText : Text;
    driverBackText : Text;
    note : Text;
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: intern, append-only: samenvatting of weer gewijzigd (laatste schrijver wint, §8.4).
  public type ReportChange = { id : Nat; reportId : Nat; at : Int; by : PersonId; field : Text; from : Text; to : Text };

  // Welke blokken bij een verslag horen (index; de blokken zelf staan in hun eigen Map).
  public type ReportBlocks = {
    attendances : [Nat];
    workDone : [Nat];
    materials : [Nat];
    photos : [Nat];
    issues : [Nat];
    trips : [Nat];
  };

  // klasse: technisch (D2-uitzondering): een uitgevoerde offline-opdracht. Na 30 dagen opgeruimd.
  public type OpRecord = { opId : Text; seq : Nat; at : Int; by : PersonId; kind : Text; reportId : Nat; entityId : ?Nat; note : Text };

  public type ReportState = {
    reports : Map.Map<Nat, DayReport>;
    keys : Map.Map<Text, Nat>; // clientKey → verslag (ook de sleutel van een tweede toestel)
    dayIndex : Map.Map<Text, [Nat]>; // "werf:dag" → verslagen van die dag (origineel + correcties)
    blocks : Map.Map<Nat, ReportBlocks>;
    changes : Map.Map<Nat, ReportChange>;
    attendances : Map.Map<Nat, Attendance>;
    confirmations : Map.Map<Nat, [HoursConfirmation]>; // per aanwezigheidsregel, in volgorde (append-only)
    workDone : Map.Map<Nat, WorkDone>;
    materials : Map.Map<Nat, MaterialNote>;
    photos : Map.Map<Nat, Photo>;
    issues : Map.Map<Nat, Issue>;
    trips : Map.Map<Nat, Trip>;
    fileOwners : Map.Map<Nat, Nat>; // bestand → verslag: foto's en bonnen tonen enkel via het verslag (R8, R12)
    ops : Map.Map<Text, OpRecord>; // opId → resultaat (§8.3)
    opOrder : Map.Map<Nat, Text>; // volgorde, voor de opruiming na 30 dagen
  };

  // ── Robot: tickets en voorstellen (§2.10, §6) ───────────────────────────
  public type TicketState = { #open; #used : Int; #expired };

  // klasse: geheim, gehasht (128 bit)
  public type Ticket = {
    id : Nat;
    hash : Blob;
    personId : PersonId;
    task : Text; // sleutel uit Config.ticketTasks
    workId : ?WorkId;
    payloadRef : ?Text;
    budgetCents : Nat;
    createdAt : Int;
    expiresAt : Int;
    var state : TicketState;
  };

  public type Decision = { by : PersonId; at : Int; accepted : Bool; note : Text };

  // klasse: intern
  public type Proposal = {
    id : Nat;
    ticketId : ?Nat;
    jobId : ?Nat;
    personId : ?PersonId;
    workId : ?WorkId;
    kind : Text;
    content : Text;
    by : Principal;
    at : Int;
    var decision : ?Decision;
  };

  // Robotprincipal: geen persoon, gaat nooit door Rights.may (R28). Beheerd door de admin.
  public type Robot = {
    principal : Principal;
    name : Text;
    kinds : [Text];
    addedAt : Int;
    addedBy : PersonId;
    var revokedAt : ?Int;
    var revokedBy : ?PersonId;
  };

  public type RobotState = {
    tickets : Map.Map<Nat, Ticket>;
    ticketIndex : Map.Map<Blob, Nat>;
    proposals : Map.Map<Nat, Proposal>;
    proposalByTicket : Map.Map<Nat, Nat>;
    robots : Map.Map<Principal, Robot>;
  };

  // ── Audit en meldingen (§2.10) ──────────────────────────────────────────
  // klasse: intern. Nooit een volledige code, nooit een opslag-URL.
  public type AuditEntry = {
    at : Int;
    who : Principal;
    personId : ?PersonId;
    workId : ?WorkId;
    action : Text;
    detail : Text;
  };

  public type Notification = {
    id : Nat;
    personId : PersonId;
    kind : Text;
    text : Text;
    workId : ?WorkId;
    ref : ?(Text, Nat);
    createdAt : Int;
    var readAt : ?Int;
  };

  public type AuditState = {
    log : List.List<AuditEntry>;
    notifications : Map.Map<Nat, Notification>;
  };

  // ── Instellingen (§2.11) ────────────────────────────────────────────────
  // klasse: intern. Keuzelijsten in data (D9): sleutel "lijst:key".
  public type Lookup = {
    list : Text;
    key : Text;
    tag : Text;
    order : Nat;
    var archivedAt : ?Int;
    extra : Extra;
  };

  public type SettingsState = {
    var werfleiderZietAlles : Bool;
    var inviteDays : Nat;
    lookups : Map.Map<Text, Lookup>;
    sequences : Map.Map<Text, Nat>;
    values : Map.Map<Text, Text>; // kleine vlaggen zonder migratie (D8)
  };

  // ── Vergunningen (stap 1b.1, architectuur §2.8, bouwplan §5.3) ───────────
  // Eigen domein `permits` (nieuw stabiel veld, deelvorm, OldActor = {}). Soorten zijn keuzelijsten (D9:
  // settings.lookups "permitKind:<sleutel>"); de kennisbank per gemeente en de procedures per soort staan hier.
  // Records zijn onveranderlijk: wijzigen = vervangen + een PermitChange per veld (D2). "Verlopen" wordt
  // berekend (geldig tot < vandaag), nooit bewaard.
  public type PermitStatus = { #needed; #requested; #granted; #refused; #expired; #extended; #cancelled };

  // klasse: intern (de kost is een kost van BOWACO, geen aankoopprijs van een OA: intern, externen zien ze niet)
  public type Permit = {
    id : Nat;
    workId : WorkId;
    kind : Text; // sleutel uit de vergunningssoorten
    title : Text; // "Container voor de deur"
    municipalityId : ?Nat;
    status : PermitStatus;
    location : Text; // "voor nr. 10, 2 parkeerplaatsen"
    taskIds : [Nat]; // taken in de planning die de vergunning vragen (deadline = start − doorlooptijd)
    neededFrom : ?Day; // zonder taken: de periode met de hand
    neededTo : ?Day;
    leadDays : Nat; // doorlooptijd in kalenderdagen (uit de kennisbank, aanpasbaar)
    requestedOn : ?Day;
    validFrom : ?Day;
    validTo : ?Day;
    reference : Text; // dossiernummer van de gemeente
    costCents : ?Int;
    fileIds : [Nat]; // de vergunning zelf (PDF of foto), de laatste is de actuele: bewijs bij controle
    note : Text; // intern
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: intern, append-only (D2): wat er aan een vergunning veranderde.
  public type PermitChange = { id : Nat; permitId : Nat; workId : WorkId; at : Int; by : PersonId; field : Text; from : Text; to : Text };

  // klasse: intern. De kennisbank: één fiche per gemeente (algemene gegevens), de procedures per soort apart.
  public type Municipality = {
    id : Nat;
    name : Text;
    zips : [Text]; // postcodes van de gemeente (deelgemeenten): zo vindt een werf zijn gemeente
    portal : ?Text; // algemeen loket of portaal (URL)
    email : ?Text;
    phone : ?Text;
    contact : Text; // dienst of persoon
    notes : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: intern. Sleutel "<gemeente-id>:<soort>". Groeit met elke aanvraag.
  public type PermitProcedure = {
    municipalityId : Nat;
    kind : Text;
    how : Text; // "portaal" · "e-mail" · "loket" · "andere"
    portal : ?Text;
    email : ?Text;
    leadDays : Nat; // doorlooptijd in kalenderdagen
    cost : Text; // "€ 25 + € 2/m²/dag" (vrije tekst: elke gemeente rekent anders)
    attachments : [Text]; // "situatieschets", "signalisatieplan", …
    contact : Text;
    notes : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  public type PermitState = {
    permits : Map.Map<Nat, Permit>;
    changes : Map.Map<Nat, PermitChange>;
    municipalities : Map.Map<Nat, Municipality>;
    procedures : Map.Map<Text, PermitProcedure>;
    // Meldingen die al verstuurd zijn (sleutel = vergunning/taak + soort + dag): de timer meldt elk ding één keer.
    alerts : Map.Map<Text, Int>;
  };

  // ── Postbode: werkwachtrij (stap 1b.3, architectuur §6.2) ────────────────
  // Eigen domein `post` (nieuw stabiel veld, deelvorm, OldActor = {}). Een opdracht (job) heeft een idempotentiesleutel
  // (`key`, uniek: "weekplanning:org42:2026-W45"); de gateway leaset ze (10 min), verstuurt en meldt klaar of mislukt.
  // De inhoud van de mail wordt bij de lease samengesteld, niet bewaard. Records onveranderlijk (vervangen).
  public type JobState = {
    #queued;
    #leased : { by : Principal; until : Int; attempt : Nat };
    #done : { at : Int; result : Text };
    #failed : { at : Int; why : Text };
    #cancelled : { by : PersonId; at : Int };
  };

  // klasse: intern (enkel ids, de week en de soort; geen adressen behalve het adres van een proefmail in `extra`)
  public type Job = {
    id : Nat;
    kind : Text; // "weekplanning" · "herinnering-planning" · "herinnering-uren" · "proef"
    key : Text;
    orgId : ?OrgId;
    personId : ?PersonId;
    workId : ?WorkId;
    ref : Text; // de maandag van de week (dagnummer) als tekst
    notBefore : Int;
    attempts : Nat;
    state : JobState;
    createdAt : Int;
    createdBy : ?PersonId; // null = de timer
    updatedAt : Int;
    extra : Extra;
  };

  public type PostState = {
    jobs : Map.Map<Nat, Job>;
    keys : Map.Map<Text, Nat>; // idempotentiesleutel → opdracht
    open : Map.Map<Nat, ()>; // index: opdrachten in de wachtrij of geleaset (de rest wordt nooit meer doorlopen)
    seen : Map.Map<Principal, Int>; // laatste lease per robot ("laatst gezien")
  };

  // ── Mail via de maildienst van Caffeine (stap mail-caffeine, E-11) ────────
  // Eigen domein `mail` (nieuw stabiel veld, deelvorm, OldActor = {}): het logboek van elke verstuurpoging. Nooit een
  // e-mailadres of de inhoud van de mail: enkel de opdracht, de soort, de firma, het aantal adressen, de uitkomst en wat
  // de maildienst aanrekende. Records onveranderlijk (append-only).
  public type MailOutcome = {
    #sent; // de maildienst aanvaardde de mail
    #dryRun; // testmodus zonder testadres: niets verstuurd
    #failed : Text; // geweigerd of niet bereikt (opnieuw met wachttijd, of definitief na 5 pogingen)
    #unsure : Text; // geen antwoord binnen de tijd: misschien verstuurd, nooit vanzelf opnieuw
  };

  // klasse: technisch (geen persoonsgegevens behalve de firma-id)
  public type MailLog = {
    id : Nat;
    jobId : Nat;
    key : Text; // idempotentiesleutel van de opdracht ("weekplanning:org42:2026-W45")
    kind : Text;
    orgId : ?OrgId;
    attempt : Nat;
    at : Int;
    recipients : Nat; // aantal adressen waarvoor de mail bedoeld was
    test : Bool; // testmodus: omgeleid naar het testadres (of droog)
    lang : Text; // "nl" · "fr" · "en"
    outcome : MailOutcome;
    cycles : Nat; // aangerekend door de maildienst (cycles_charged)
    extra : Extra;
  };

  public type MailState = {
    log : Map.Map<Nat, MailLog>;
  };

  // ── Werfadministratie (stap 1b.4, bouwplan §5.4) ─────────────────────────
  // Eigen domein `wadm` (nieuw stabiel veld, deelvorm, OldActor = {}): de raadplegingen van de inhoudingsplicht per OA
  // (append-only historiek) en per werf de aangifte van werken (30bis). Het bedrag van de werf blijft in het contract
  // (vertrouwelijk); hier staat het nooit.
  public type WithholdingResult = { #clear; #social; #fiscal; #both; #unknown }; // geen · sociale · fiscale · beide · onbekend

  // klasse: intern. Eén raadpleging van checkinhoudingsplicht.be (met de hand) of later door de robot (webservice).
  public type WithholdingCheck = {
    id : Nat;
    orgId : OrgId;
    kbo : Text; // het nummer zoals geraadpleegd
    result : WithholdingResult;
    consultedOn : Day;
    reference : Text; // consultatiereferentie (sociaal luik)
    note : Text;
    source : Text; // "hand" · "robot"
    workId : ?WorkId; // naar aanleiding van welke werf (contract, betaling)
    fileId : ?Nat; // schermafdruk of attest (optioneel)
    at : Int;
    by : ?PersonId; // null = de robot
    extra : Extra;
  };

  public type DeclarationStatus = { #todo; #done : { on : Day; number : Text }; #notNeeded : { reason : Text } };

  // klasse: intern. Aangifte van werken per werf: de status, de aard en asbest (bepaalt mee of ze nodig is).
  public type Declaration = {
    workId : WorkId;
    status : DeclarationStatus;
    nature : Text; // "eenmalig" · "doorlopend"
    asbestos : Bool;
    note : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  public type WadmState = {
    checks : Map.Map<Nat, WithholdingCheck>;
    declarations : Map.Map<WorkId, Declaration>;
  };

  // ── Postenbibliotheek (stap 2.2, architectuur §2.9; VOORLOPIG tot 0.3) ────
  // Eigen domein `library` (nieuw stabiel veld, deelvorm, OldActor = {}). Hoofdstukken en posten zijn INTERN (tekst,
  // eenheid, contractvorm, standaard-OA, duur); de aankoopprijzen per OA en de verkoopregel (marge of vaste prijs) zijn
  // VERTROUWELIJK en staan in eigen Maps (D6): enkel admin en calculator, lezen via update-calls met een auditregel (R20,
  // R21, R23). Beslissing eigenaar 24-10: geen versleuteling (2.1 vervalt); de waarden blijven `#plain`.
  // Records zijn onveranderlijk: wijzigen = vervangen + een versie bewaren (D2); "weg" = archiveren, nooit wissen.
  // vaste prijs · regie · vermoedelijke hoeveelheid (VH) · raming/richtprijs · budget/stelpost · volgens bijlage (B3, VOORLOPIG).
  // Volledig vanaf het begin (D1a): een tag erbij is later een migratie. "Optie" is een lijnsoort van de offerte (2.4).
  public type ContractForm = { #fixed; #regie; #vh; #estimate; #budget; #perAttachment };

  // klasse: intern. De code is een groep ("09") en mag herhalen (09 Technieken – Elektriciteit, 09 Technieken – Sanitair);
  // de titel is het hoofdstuk (B1). De volgorde is een getal (10, 20 …), zodat invoegen geen hernummering vraagt.
  public type LibChapter = {
    id : Nat;
    code : Text;
    title : Text;
    order : Nat;
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: intern (GEEN prijzen: die staan in LibCost en LibSell). Een post; de offerte-editor (2.4) neemt tekst, eenheid
  // en contractvorm over, samen met het id en de versie (zo weet een offertelijn uit welke versie ze kwam).
  public type LibItem = {
    id : Nat;
    chapterId : Nat;
    code : Text; // "7.06" (leeg = geen); vrij, voor de volgorde en het zoeken
    title : Text; // korte titel
    text : Text; // lastenboektekst (meerdere regels)
    unit : Text; // sleutel uit de eenheden (D9: settings.lookups "unit:<sleutel>")
    form : ContractForm;
    trade : ?Text; // vakgebied (sleutel uit 1.2)
    orgId : ?OrgId; // standaard-OA of leverancier
    durationDays : ?Nat; // standaardduur in werkdagen voor de planning (2.8)
    perDayMilli : ?Int; // of: hoeveelheid per werkdag in duizendsten (duur = hoeveelheid / dit), VOORLOPIG (B13)
    planStepKey : ?Text; // stap van het planningsjabloon (1.3) waar deze post bij hoort
    keywords : [Text]; // extra zoekwoorden
    importKey : ?Text; // idempotentie van een import (2.3): uniek over de bibliotheek
    version : Nat;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    archiveReason : Text;
    extra : Extra;
  };

  // klasse: intern, append-only (D2): elke versie van een post, ook versie 1; `fields` = de namen van wat veranderde.
  public type LibItemVersion = { id : Nat; itemId : Nat; version : Nat; item : LibItem; at : Int; by : PersonId; fields : Text };

  // klasse: vertrouwelijk. Eén aankoopprijs per eenheid voor een post, van één OA of leverancier (of zonder: eigen raming),
  // op een datum (de offerte of factuur van de OA). Append-only: een fout wordt gearchiveerd met een reden en blijft in de
  // historiek; nooit gewist of overschreven.
  public type LibCost = {
    id : Nat;
    itemId : Nat;
    orgId : ?OrgId;
    day : Day;
    cost : Confidential<Int>; // eurocent per eenheid
    source : Text; // "oa-offerte" · "factuur" · "offerte" · "eigen" · "import" (Config.libCostSources)
    ref : Text; // "OA-offerte 2026-045", "offerte 2026/231"
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    archiveReason : Text;
    extra : Extra;
  };

  // Marge in basispunten op de VERKOOPprijs (2000 = 20 %: verkoop = aankoop / 0,8, zoals `/0.8` in offerte 2026/231, B5),
  // of een vaste verkoopprijs per eenheid in eurocent (eigen prestatie, verzekering, budget).
  public type LibSellRule = { #margin : Nat; #price : Int };

  // klasse: vertrouwelijk. De verkoopregel van één post; zonder record of met `rule = null` geldt de standaardmarge
  // (instelbaar, 20 %). Terug naar de standaard = een nieuwe versie met null, nooit het record weghalen.
  public type LibSell = {
    itemId : Nat;
    rule : ?Confidential<LibSellRule>;
    reason : Confidential<Text>; // waarom niet de standaardmarge (controle vóór verzending, 2.6)
    version : Nat;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  // klasse: vertrouwelijk, append-only: elke versie van de verkoopregel (rule = null: terug naar de standaardmarge).
  public type LibSellVersion = { id : Nat; itemId : Nat; version : Nat; rule : ?Confidential<LibSellRule>; reason : Confidential<Text>; at : Int; by : PersonId };

  public type LibraryState = {
    chapters : Map.Map<Nat, LibChapter>;
    items : Map.Map<Nat, LibItem>;
    itemVersions : Map.Map<Nat, LibItemVersion>;
    importKeys : Map.Map<Text, Nat>; // importsleutel → post (herrekend bij een herstel)
    costs : Map.Map<Nat, LibCost>; // vertrouwelijk
    costsByItem : Map.Map<Nat, [Nat]>; // post → aankoopprijzen (index, herrekend bij een herstel)
    sells : Map.Map<Nat, LibSell>; // vertrouwelijk; sleutel = post
    sellVersions : Map.Map<Nat, LibSellVersion>; // vertrouwelijk
  };

  // ── Offertes (stap 2.4, architectuur §2.9, bouwplan §8.5; VOORLOPIG tot 0.3) ────────
  // Eigen domein `quotes` (nieuw stabiel veld, deelvorm, OldActor = {}). Offerte → versies → hoofdstukken → lijnen zijn
  // INTERN (tekst, hoeveelheid, eenheid, contractvorm: zonder bedrag); de aankoopprijs, de verkoopregel (marge of vaste
  // prijs) en de reden per lijn, en de standaardmarge per versie zijn VERTROUWELIJK en staan in eigen Maps (D6): enkel
  // admin en calculator (R20–R22), lezen via een update-call met een auditregel (R23). De bedragen worden NOOIT bewaard of
  // getypt: lib/QuoteCalc.mo rekent ze uit de invoer (dezelfde regels als de browser). Een verzonden of aanvaarde versie
  // is onwijzigbaar (hash + vaste rekenversie): verder werken = een nieuwe versie (bouwplan §4).
  // Volledig vanaf het begin (D1a): een tag erbij is later een migratie.
  public type QuoteStatus = { #draft; #sent; #accepted; #rejected; #superseded; #withdrawn };
  // post (telt mee) · tekstregel (zonder bedrag) · optie (meer- of minprijs, telt NIET mee in het totaal)
  public type QuoteLineKind = { #item; #text; #option };

  // klasse: intern
  public type Quote = {
    id : Nat;
    workId : WorkId;
    number : Text; // "2026/231" (uniek; standaard volgnummer per jaar, B12 VOORLOPIG)
    title : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    archiveReason : Text;
    extra : Extra;
  };

  // klasse: intern. Wat bij het versturen vastligt: de hash van de inhoud (zoals de klant ze kreeg) en de totalen.
  public type QuoteSent = { at : Int; by : PersonId; hash : Text; subtotalCents : Int; vatCents : Int; totalCents : Int; optionsPlusCents : Int; optionsMinusCents : Int };
  public type QuoteDecision = { at : Int; by : PersonId; note : Text };

  // klasse: intern (zonder bedragen). Enkel #draft is te bewerken; `rev` = bewerkteller (geen stil overschrijven).
  public type QuoteVersion = {
    id : Nat;
    quoteId : Nat;
    version : Nat; // 1, 2 …
    status : QuoteStatus;
    title : Text;
    vatBp : Nat; // 600 of 2100: van de werf bij het aanmaken
    clientOrgId : ?OrgId; // de klant: van de werf bij het aanmaken
    validDays : Nat;
    intro : Text;
    note : Text;
    basedOnId : ?Nat; // de versie waarvan deze een kopie is
    rev : Nat;
    calcVersion : Nat; // de rekenregels waarmee deze versie rekent (QuoteCalc.version); een verzonden versie houdt de hare
    sent : ?QuoteSent;
    decision : ?QuoteDecision;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  // klasse: intern. De code is een groep en mag herhalen (B1), zoals in de bibliotheek.
  public type QuoteChapter = { id : Nat; versionId : Nat; code : Text; title : Text; order : Nat; libChapterId : ?Nat; archivedAt : ?Int; extra : Extra };

  // klasse: intern (GEEN prijs: die staat in QuoteLinePrice). qtyMilli = de (vermoedelijke) hoeveelheid in duizendsten;
  // negatief = minwerk of minprijs, 0 = pro memorie.
  public type QuoteLine = {
    id : Nat;
    versionId : Nat;
    chapterId : Nat;
    order : Nat;
    kind : QuoteLineKind;
    code : Text;
    title : Text;
    text : Text; // lastenboektekst
    specRef : Text; // "OA code 6.3": verwijzing naar het lastenboek van de architect (geen onderaannemer)
    qtyMilli : Int;
    unit : Text;
    form : ContractForm;
    libItemId : ?Nat; // uit de postenbibliotheek (2.2), met de versie van de post
    libItemVersion : ?Nat;
    copiedFrom : ?Nat; // de lijn van de vorige versie
    archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: vertrouwelijk. Aankoopprijs per eenheid (null = geen: eigen prestatie, budget), de verkoopregel (null = de
  // standaardmarge van de versie; anders eigen marge of vaste verkoopprijs per eenheid) en waarom (controle 2.6).
  public type QuoteLinePrice = {
    lineId : Nat;
    versionId : Nat;
    cost : Confidential<?Int>;
    rule : Confidential<?LibSellRule>;
    reason : Confidential<Text>;
    orgId : ?OrgId; // de OA of leverancier van de aankoopprijs
    source : Text; // "bibliotheek" · "oa-offerte" · "eigen" · "handmatig" (Config.quoteCostSources)
    libCostId : ?Nat; // de prijs uit de bibliotheek waarvan ze kwam
    extra : Extra;
  };

  // klasse: vertrouwelijk. De standaardmarge van een versie (bij het aanmaken die van de bibliotheek, 20 %).
  public type QuoteVersionConf = { versionId : Nat; standardMarginBp : Confidential<Nat>; extra : Extra };

  public type QuotesState = {
    quotes : Map.Map<Nat, Quote>;
    versions : Map.Map<Nat, QuoteVersion>;
    chapters : Map.Map<Nat, QuoteChapter>;
    lines : Map.Map<Nat, QuoteLine>;
    prices : Map.Map<Nat, QuoteLinePrice>; // vertrouwelijk; sleutel = lijn
    versionConf : Map.Map<Nat, QuoteVersionConf>; // vertrouwelijk; sleutel = versie
    // Indexen (herrekend bij een herstel)
    numbers : Map.Map<Text, Nat>; // offertenummer → offerte
    byWork : Map.Map<Nat, [Nat]>; // werf → offertes
    byQuote : Map.Map<Nat, [Nat]>; // offerte → versies
    chaptersByVersion : Map.Map<Nat, [Nat]>;
    linesByVersion : Map.Map<Nat, [Nat]>;
  };

  // ── Controleregels vóór verzending (stap 2.6, bouwplan §9 rij 2.6; VOORLOPIG: vragen voor Alexis) ────
  // Eigen stabiel veld `quoteChecks` (deelvorm, OldActor = {}). De regels zelf staan in lib/QuoteRules.mo (de browser heeft
  // dezelfde in quote/rules.ts); hier staat wat de beheerder instelt en wat er bij een verzending gebeurde. Elke regel is een
  // waarschuwing of een blokkering. Een blokkering houdt de verzending tegen; doorzetten ondanks een waarschuwing vraagt een
  // reden, die in de auditlog en bij de versie komt. Volledig vanaf het begin (D1a).
  public type QuoteSeverity = { #warn; #block };

  // klasse: intern. Geen record voor een regel = de standaard uit Config.quoteRuleDefaults.
  public type QuoteRuleCfg = { key : Text; enabled : Bool; severity : QuoteSeverity; thresholdBp : ?Nat; updatedAt : Int; updatedBy : PersonId };

  // klasse: intern. Een standaardpost die in elke offerte hoort (vergunning, EPB, PID, opkuis): gevonden op woorden in
  // de titel, de code of het hoofdstuk van een post.
  public type QuoteStdPost = { key : Text; name : Text; keywords : [Text]; enabled : Bool; severity : QuoteSeverity; order : Nat; updatedAt : Int; updatedBy : PersonId; archivedAt : ?Int };

  // klasse: intern. Een verzending waarbij waarschuwingen doorgezet werden: wie, wanneer, waarom en welke regels.
  public type QuoteCheckDone = { versionId : Nat; at : Int; by : PersonId; reason : Text; warned : [(Text, Nat)] };

  public type QuoteChecksState = {
    rules : Map.Map<Text, QuoteRuleCfg>;
    stdPosts : Map.Map<Text, QuoteStdPost>;
    done : Map.Map<Nat, QuoteCheckDone>; // sleutel = versie
  };

  // ── PDF, voorwaarden en digitaal akkoord (stap 2.7, bouwplan §9 rij 2.7 ⚖; VOORLOPIG: vragen voor Alexis en de jurist) ────
  // Eigen stabiel veld `quoteDocs` (deelvorm, OldActor = {}). De algemene voorwaarden hebben versies (append-only, de admin
  // zet een nieuwe versie); bij het versturen wordt vastgelegd wat de klant te zien krijgt (afzender, klant, werf, btw-grond,
  // betaaltermijn, geldigheid en de TEKST van de voorwaarden) en dat valt onder de hash: een akkoord geldt dus voor exact die
  // inhoud. Het akkoord zelf: de klant (Internet Identity, klantrol op de werf) klikt "Akkoord" op de verzonden versie, of
  // kantoor registreert een getekende PDF als bewijs. Volledig vanaf het begin (D1a).
  public type QuoteTerms = {
    id : Nat;
    version : Nat; // 1, 2 … (0 = de ingebouwde voorlopige tekst, nooit bewaard)
    title : Text;
    text : Text;
    provisional : Bool; // VOORLOPIG: nog niet gevalideerd door BOWACO en een jurist
    note : Text; // wat er veranderde
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  // klasse: intern. Wat bij het versturen vastligt naast de inhoud van de offerte (valt onder de hash).
  public type QuoteSendInfo = {
    versionId : Nat;
    issuer : Text; // wie de offerte geeft: vrije tekst van de beheerder (naam, adres, ondernemingsnummer, btw)
    clientName : Text;
    clientAddress : ?Address;
    clientVat : ?Text;
    workCode : Text;
    workName : Text;
    workAddress : Address;
    vatNote : Text; // de grond voor het btw-tarief (bij 6 %)
    paymentDays : Nat;
    validUntil : Day; // dag van verzending + geldigheid
    termsId : Nat;
    termsVersion : Nat;
    termsTitle : Text;
    termsText : Text;
    termsProvisional : Bool;
    extra : Extra;
  };

  // klasse: intern (persoonsgegevens: wie klikte, met welke Internet Identity). Zie docs/privacy.md.
  public type QuoteDigitalAccept = { at : Int; personId : PersonId; principal : Principal };
  public type QuoteSignedProof = { at : Int; by : PersonId; fileId : Nat; note : Text };
  public type QuoteAcceptance = { versionId : Nat; hash : Text; digital : ?QuoteDigitalAccept; signed : ?QuoteSignedProof; extra : Extra };

  public type QuoteDocsState = {
    terms : Map.Map<Nat, QuoteTerms>;
    sendInfo : Map.Map<Nat, QuoteSendInfo>; // sleutel = versie
    acceptances : Map.Map<Nat, QuoteAcceptance>; // sleutel = versie
  };

  // ── Offerte → werf (stap 2.8, bouwplan §9 rij 2.8; VOORLOPIG: vragen voor Alexis) ────
  // Eigen stabiel veld `workStarts` (deelvorm, OldActor = {}). Een aanvaarde offerteversie geeft een VOORSTEL "Werf starten"
  // (werf, planningstaken uit de posten, vergunningsvoorstellen, 30bis); de werfleider of admin past het aan en bevestigt.
  // De sleutel is de offerteversie: één start per versie, dus twee keer bevestigen maakt niets dubbel. Een nieuwe aanvaarde
  // versie (meerwerk) rekent het verschil tegen de lijnen die al een taak kregen (`roots`: de lijn van de eerste versie
  // waarvan ze een kopie is). Afwijzen ("geen werfstart nodig") legt ook een record vast, met een reden. Volledig vanaf het
  // begin (D1a).
  public type WorkStartStatus = { #started; #dismissed };

  // klasse: intern (ids, data en tellingen; nooit een bedrag: het bedrag voor 30bis staat in het contract, vertrouwelijk).
  public type WorkStart = {
    versionId : Nat; // sleutel
    quoteId : Nat;
    sourceWorkId : WorkId; // de werf van de offerte
    workId : WorkId; // de werf die gestart of aangevuld werd (dezelfde, of een nieuwe)
    status : WorkStartStatus;
    newWork : Bool;
    baseVersionIds : [Nat]; // eerdere starts op die werf waartegen het verschil berekend werd (meerwerk)
    startDay : Day;
    templateKey : Text;
    lineIds : [Nat]; // de offertelijnen die een taak kregen (nieuw of gekoppeld aan een bestaande)
    roots : [Nat]; // hun oorsprong (eerste versie): zo weet een volgende versie wat al gepland is
    taskIds : [Nat]; // nieuwe taken
    linkedTaskIds : [Nat]; // bestaande taken waaraan lijnen gekoppeld werden
    depIds : [Nat];
    permitIds : [Nat];
    declaration : Text; // "klaargezet" · "bestond al" · "niet nodig" · "onbekend" · "niet gevraagd"
    note : Text; // reden bij afwijzen
    at : Int;
    by : PersonId;
    extra : Extra;
  };

  public type WorkStartState = { starts : Map.Map<Nat, WorkStart> };

  // ── Opmeting ter plaatse (stap 2.9, bouwplan §9 rij 2.9 en §5.1; VOORLOPIG: vragen voor Alexis) ────
  // Eigen stabiel veld `surveys` (deelvorm, OldActor = {}). Een opmeting is een ronde per werf (één open tegelijk); daarin
  // staan REGELS per post van de getekende offerte: de gemeten hoeveelheid van die keer (deelopmetingen tellen op), datum,
  // wie mat, een notitie, foto's of een schets. Het gaat over HOEVEELHEDEN: geen veld in dit domein draagt een prijs (de
  // views evenmin; tests/review.mjs J1 controleert het in de .did). Een regel wordt nooit overschreven: in een open opmeting
  // kan ze weggehaald (gearchiveerd) worden; in een AFGESLOTEN opmeting enkel met een nieuwe regel (`corrects`) en een reden.
  // Bij het afsluiten ligt de stand per post vast (`snapshots`): daarop rekent 2.10 (vorderingsstaten).
  // Een onderaannemer mag (instelbaar) zijn eigen posten VOORSTELLEN (`proposedOrgId`); de werfleider of calculator bevestigt of
  // wijst af (`review`). Enkel bevestigde regels tellen mee.
  public type SurveyStatus = { #open; #closed : { by : PersonId; at : Int; note : Text; thresholdBp : Nat } };

  // klasse: intern. `number` = volgnummer per werf (opmeting 1, 2 …). `clientKey` = de sleutel van het toestel dat ze opende.
  public type Survey = { id : Nat; workId : WorkId; number : Nat; clientKey : Text; status : SurveyStatus; openedBy : PersonId; openedAt : Int; extra : Extra };

  public type MeasureFileRole = { #photo; #sketch };
  public type MeasureFile = { role : MeasureFileRole; fileId : Nat; thumbFileId : ?Nat; caption : Text };
  public type MeasureReview = { by : PersonId; at : Int; ok : Bool; note : Text };

  // klasse: intern (hoeveelheden, geen prijs). qtyMilli = de gemeten hoeveelheid van deze keer in duizendsten (bij een
  // correctie: de nieuwe waarde van de gecorrigeerde regel). lineId = de lijn van de offerteversie op het moment van meten;
  // root = de lijn van de eerste versie (blijft gelijk bij meerwerk-versies). `complete` = post volledig opgemeten.
  public type MeasureEntry = {
    id : Nat;
    surveyId : Nat;
    workId : WorkId;
    lineId : Nat;
    versionId : Nat;
    root : Nat;
    qtyMilli : Int;
    day : Day;
    complete : Bool;
    note : Text;
    files : [MeasureFile];
    corrects : ?Nat;
    reason : Text;
    proposedOrgId : ?OrgId;
    review : ?MeasureReview;
    blockKey : Text; // opId van de opdracht die deze regel maakte
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    extra : Extra;
  };

  // klasse: intern. De stand van een post bij het afsluiten van een opmeting (VH op dat moment, opgemeten tot en met deze opmeting).
  public type SurveyPostSnap = { root : Nat; lineId : Nat; versionId : Nat; vhMilli : Int; unit : Text; measuredMilli : Int; deltaMilli : Int; complete : Bool };

  // klasse: technisch (D2-uitzondering): een uitgevoerde offline-opdracht. Na 30 dagen opgeruimd.
  public type SurveyOpRecord = { opId : Text; seq : Nat; at : Int; by : PersonId; kind : Text; surveyId : Nat; entityId : ?Nat; note : Text };

  public type SurveyState = {
    surveys : Map.Map<Nat, Survey>;
    keys : Map.Map<Text, Nat>; // clientKey → opmeting (ook de sleutel van een tweede toestel)
    byWork : Map.Map<Nat, [Nat]>; // werf → opmetingen
    entries : Map.Map<Nat, MeasureEntry>;
    bySurvey : Map.Map<Nat, [Nat]>; // opmeting → regels
    snapshots : Map.Map<Nat, [SurveyPostSnap]>; // opmeting → stand per post bij het afsluiten
    fileOwners : Map.Map<Nat, Nat>; // bestand → regel: foto's en schetsen tonen enkel via de opmeting
    ops : Map.Map<Text, SurveyOpRecord>;
    opOrder : Map.Map<Nat, Text>;
  };

  // ── Vorderingsstaten (stap 2.10, bouwplan §9 rij 2.10, §5.1 en §7; VOORLOPIG: vragen voor Alexis en de boekhouder) ────
  // Eigen stabiel veld `progress` (deelvorm, OldActor = {}). Een vorderingsstaat rekent per werf en per periode wat uitgevoerd of
  // opgemeten is tegen de posten van de getekende offerte (2.8): vaste prijs per % uitgevoerd, VH volgens de opmeting (2.9), regie
  // volgens de regie-uren van de werfverslagen (1.6), meer- en minderwerk apart, CUMULATIEF (vorige staten, deze periode, totaal,
  // rest). De contractparameters (1.1) gelden vanzelf: prijsherziening (rekenmodel hieronder, indexwaarden met de hand), waarborg,
  // betaaltermijn en vervaldag, het btw-tarief van de werf. Een totaal wordt NOOIT bewaard of getypt zolang de staat een ontwerp is:
  // enkel de invoer (% en hoeveelheden); bij het versturen ligt alles vast (`frozen`, onder een hash) en verandert de staat nooit
  // meer: verbeteren = een creditnota of een volgende staat. Volledig vanaf het begin (D1a): een tag erbij is later een migratie.
  public type ProgressKind = { #statement; #credit }; // vorderingsstaat · creditnota (van een verzonden staat)
  public type ProgressStatus = { #draft; #sent; #cancelled }; // ontwerp · verzonden (vast) · ontwerp weggedaan
  // De haak naar de facturatie (fase 3): open · klaar voor factuur · gefactureerd (door het pakket; ref = factuurnummer daar).
  public type ProgressBilling = { #open; #ready : { at : Int; by : PersonId }; #invoiced : { at : Int; by : ?PersonId; ref : Text } };
  // aanneming (getekende offerte) · meerwerk · minderwerk · regie
  public type ProgressSection = { #contract; #extra; #less; #regie };
  // vaste prijs per % uitgevoerd · hoeveelheid (VH volgens opmeting) · regie-uren
  public type ProgressBasis = { #percent; #quantity; #hours };

  // klasse: intern (hoeveelheden en %, geen bedrag). De invoer van één post, CUMULATIEF tot en met deze staat. null = de
  // voorstelwaarde volgen (opmeting, regie-uren, planning of de vorige staat).
  public type ProgressInput = { root : Nat; cumPctBp : ?Nat; cumQtyMilli : ?Int; note : Text; at : Int; by : PersonId };

  // klasse: intern (zonder bedragen). Enkel #draft is te bewerken; `rev` = bewerkteller (geen stil overschrijven).
  public type ProgressStatement = {
    id : Nat;
    workId : WorkId;
    kind : ProgressKind;
    number : Nat; // volgnummer per werf en soort, gegeven bij het versturen (0 = ontwerp)
    code : Text; // "VS P-A/1" of "CN P-A/1" bij het versturen; "" = ontwerp
    credits : ?Nat; // creditnota: de staat die ze crediteert
    creditedBy : ?Nat; // een verzonden staat die gecrediteerd werd (telt dan niet meer mee als vorige staat)
    periodFrom : Day;
    periodTo : Day;
    status : ProgressStatus;
    billing : ProgressBilling;
    prepared : ?{ by : PersonId; at : Int }; // de werfleider meldde "voorbereid"
    note : Text; // voor de klant (komt op de PDF)
    rev : Nat;
    calcVersion : Nat; // ProgressCalc.version bij het aanmaken; een verzonden staat houdt de hare
    sentAt : ?Int;
    sentBy : ?PersonId;
    hash : Text; // "" tot het versturen
    cancelReason : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  // klasse: vertrouwelijk. Per staat: de indexwaarden van de prijsherziening (duizendsten) en de reden om waarschuwingen door te zetten.
  public type ProgressConf = { statementId : Nat; sIndex : Confidential<?Nat>; iIndex : Confidential<?Nat>; reason : Confidential<Text>; extra : Extra };

  // klasse: vertrouwelijk. Het rekenmodel van de prijsherziening van een werf: p = P × (a·s/S + b·i/I + c), a + b + c = 100 %
  // (basispunten); S en I = de indexwaarden van de basismaand (duizendsten); de formule als tekst staat in het contract (1.1).
  public type RevisionModel = { aBp : Nat; bBp : Nat; cBp : Nat; sBase : Nat; iBase : Nat; sLabel : Text; iLabel : Text; note : Text };
  public type ProgressRevision = { workId : WorkId; model : Confidential<RevisionModel>; version : Nat; at : Int; by : PersonId; extra : Extra };

  // klasse: vertrouwelijk (bedragen). Wat bij het versturen vastligt, per post.
  public type ProgressLineFrozen = {
    root : Nat;
    lineId : Nat;
    versionId : Nat;
    quoteNumber : Text;
    section : ProgressSection;
    basis : ProgressBasis;
    chapter : Text;
    code : Text;
    title : Text;
    unit : Text;
    offerQtyMilli : Int;
    unitPriceCents : Int;
    offerCents : Int;
    prevPctBp : Nat;
    prevQtyMilli : Int;
    prevCents : Int;
    cumPctBp : Nat;
    cumQtyMilli : Int;
    cumCents : Int;
    periodCents : Int;
    note : Text;
  };
  public type ProgressSectionTotals = { section : ProgressSection; offerCents : Int; prevCents : Int; cumCents : Int; periodCents : Int };
  public type ProgressTotals = {
    sections : [ProgressSectionTotals];
    offerCents : Int;
    prevCents : Int;
    cumCents : Int;
    periodCents : Int; // deze periode, excl. prijsherziening en btw
    restCents : Int; // offerte − totaal tot nu
    overVhCents : Int; // waarvan boven de VH (meerhoeveelheden)
    revisionBaseCents : Int;
    revisionCents : Int;
    subtotalCents : Int; // deze periode + prijsherziening, excl. btw
    vatBp : Nat;
    vatCents : Int;
    totalCents : Int; // incl. btw
    retentionBp : Nat;
    retentionCents : Int; // inhouding waarborg
    payableCents : Int; // te betalen = totaal − inhouding
  };
  public type ProgressRevisionFrozen = { formula : Text; aBp : Nat; bBp : Nat; cBp : Nat; sBase : Nat; iBase : Nat; sIndex : Nat; iIndex : Nat; sLabel : Text; iLabel : Text };
  public type ProgressFrozen = {
    statementId : Nat;
    issuer : Text;
    clientName : Text;
    clientAddress : ?Address;
    clientVat : ?Text;
    workCode : Text;
    workName : Text;
    workAddress : Address;
    analyticCode : Text;
    vatNote : Text;
    quoteRefs : [Text]; // "2026/231 v2"
    sendDay : Day;
    dueDay : Day;
    paymentDays : Nat;
    guarantee : GuaranteeKind;
    retentionOnIncl : Bool; // inhouding op het bedrag incl. btw (anders excl.)
    revision : ?ProgressRevisionFrozen;
    lines : [ProgressLineFrozen];
    totals : ProgressTotals;
    extra : Extra;
  };

  // klasse: intern (persoonsgegevens: wie antwoordde, met welke Internet Identity). Het akkoord of de opmerking van de klant op
  // de exacte verzonden staat (hash). Zie docs/privacy.md.
  public type ProgressAnswer = { statementId : Nat; hash : Text; ok : Bool; note : Text; at : Int; personId : PersonId; principal : Principal; extra : Extra };

  public type ProgressState = {
    statements : Map.Map<Nat, ProgressStatement>;
    byWork : Map.Map<Nat, [Nat]>; // werf → staten (index, herrekend bij een herstel)
    inputs : Map.Map<Nat, [ProgressInput]>; // staat → invoer per post
    conf : Map.Map<Nat, ProgressConf>; // vertrouwelijk; sleutel = staat
    frozen : Map.Map<Nat, Confidential<ProgressFrozen>>; // vertrouwelijk; sleutel = staat
    revisions : Map.Map<Nat, ProgressRevision>; // vertrouwelijk; sleutel = werf
    answers : Map.Map<Nat, ProgressAnswer>; // sleutel = staat
  };

  // ── OA-facturen registreren en controleren (stap 2.11, bouwplan §9 rij 2.11 en §5.1; zonder AI; VOORLOPIG: vragen voor
  //    Alexis en de boekhouder) ────
  // Eigen stabiel veld `oaInvoices` (deelvorm, OldActor = {}). Kantoor registreert een factuur van een onderaannemer (firma, werf,
  // nummer, datum, bedragen, btw-regime, bijlage in de afgeschermde opslag, regels); de controle legt ze naast de afspraken
  // (aankoopprijs per post uit de offerte, contractvorm), de regie-uren van die OA uit de werfverslagen (bevestigd of betwist,
  // 1.7), de opgemeten hoeveelheden (2.9) en wat al gefactureerd is, en markeert afwijkingen per regel boven een drempel. De
  // controle wordt telkens gerekend, nooit bewaard. Goedkeuren vraagt de inhoudingsplicht-raadpleging van die dag (1b.4) of een
  // gemotiveerde uitzondering. Een goedgekeurde factuur verandert niet meer. De bedragen zijn vertrouwelijk en staan apart.
  // Peppol (fase 3): `source` en `externalRef` vangen een ingelezen factuur op; inlezen zelf is fase 3. Volledig vanaf het begin (D1a).
  public type OaVatRegime = { #reverse; #normal : Nat }; // btw verlegd (medecontractant, 0 %) · normaal tarief in basispunten
  public type OaInvoiceStatus = { #registered; #approved; #disputed; #withdrawn }; // geregistreerd · goedgekeurd · betwist · ingetrokken
  public type OaInvoiceLineKind = { #post; #regie; #other }; // een post van de offerte · regie-uren · iets anders
  // Het bewijs bij goedkeuring: de raadpleging van de inhoudingsplicht (1b.4) van die dag, of een gemotiveerde uitzondering.
  public type OaWithholdingProof = { #check : { checkId : Nat; result : WithholdingResult; reference : Text; consultedOn : Day }; #exception : Text };
  public type OaInvoiceDecision = { at : Int; by : PersonId; approved : Bool; reason : Text; withholding : ?OaWithholdingProof; flags : Nat };

  // klasse: intern (zonder bedragen)
  public type OaInvoice = {
    id : Nat;
    orgId : OrgId;
    workId : WorkId;
    number : Text; // het factuurnummer van de OA
    invoiceDay : Day;
    dueDay : ?Day;
    periodFrom : ?Day; // de periode van de prestaties (voor de regie-uren)
    periodTo : ?Day;
    vatRegime : OaVatRegime;
    reverseMention : Bool; // de vermelding "btw verlegd" (medecontractant) staat op de factuur
    fileId : ?Nat; // de bijlage (vertrouwelijk bestand)
    status : OaInvoiceStatus;
    decision : ?OaInvoiceDecision; // goedkeuring of betwisting (de laatste)
    note : Text; // intern
    source : Text; // "hand" · later "peppol" (fase 3)
    externalRef : Text; // het documentnummer van de Peppol-factuur (fase 3)
    rev : Nat;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  // klasse: vertrouwelijk. Eén regel van de factuur zoals de OA ze schreef (hoeveelheid in duizendsten, eenheidsprijs, bedrag).
  public type OaInvoiceLine = { kind : OaInvoiceLineKind; root : ?Nat; description : Text; qtyMilli : Int; unitCents : Int; amountCents : Int };
  // klasse: vertrouwelijk. De bedragen van de factuur zoals ze erop staan (excl. btw, btw, incl. btw) en de regels.
  public type OaInvoiceAmounts = { invoiceId : Nat; netCents : Int; vatCents : Int; totalCents : Int; lines : [OaInvoiceLine]; extra : Extra };

  public type OaInvoiceState = {
    invoices : Map.Map<Nat, OaInvoice>;
    amounts : Map.Map<Nat, Confidential<OaInvoiceAmounts>>; // vertrouwelijk; sleutel = factuur
    keys : Map.Map<Text, Nat>; // "<firma>:<nummer>" → factuur (geen dubbele registratie; index, herrekend bij een herstel)
    byWork : Map.Map<Nat, [Nat]>; // werf → facturen (index)
  };

  // Tellers per collectie (D3): sleutel = naam van de collectie, waarde = laatst uitgegeven id.
  // Een Map in plaats van een record: een nieuwe collectie vraagt dan geen migratie van de tellers.
  public type Counters = Map.Map<Text, Nat>;
};
