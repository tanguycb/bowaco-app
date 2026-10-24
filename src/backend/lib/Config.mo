// Vaste waarden van de app. Hier staan alleen hashes, nooit geheimen. Robotprincipals beheert de
// admin in de app (robot.robots), niet meer hier.
module {
  public let version = "1.8-draft19";
  public let schema : Nat = 7; // 7 = met werfverslagen (1.6); 6 = import van de planning (1.5); 5 = weekbord (1.4)

  // SHA-256("bowaco-code-v1|" # code) van de ECHTE opstartcode (16 tekens, 80 bit), gemaakt door de
  // eigenaar zelf met tools/opstartcode.mjs (A16, T21, 23-10). De code staat nergens in git of in een sessie.
  // Lokaal wisselt tests/lokaal.sh deze hash tijdelijk om naar die van de TEST-code (~/.bowaco), zodat de
  // rollentest een lege canister kan claimen; tools/meetlat.mjs weigert een upload met de testhash.
  // Een hash wisselen is geen migratie.
  public let bootstrapHashHex = "2390ba6730471a9be0a94a2390881505d15e6bf7e216bb33f478655638f3d4c1";

  public let second : Int = 1_000_000_000;
  public let minute : Int = 60_000_000_000;
  public let hour : Int = 3_600_000_000_000;
  public let day : Int = 86_400_000_000_000;

  // Codes (bouwplan §3.3)
  public let inviteDaysDefault : Nat = 7;
  public let inviteDaysMax : Nat = 30;
  public let maxAttemptsPerHour : Nat = 5;
  public let blockAfterAttempts : Int = day;
  // Globale remming: melding aan de admins vanaf zoveel fouten per uur over alle principals,
  // en alle codepogingen dicht tot het einde van het uur vanaf de tweede grens.
  public let globalAlertPerHour : Nat = 100;
  public let globalLockPerHour : Nat = 1_000;

  // Grenzen (D10)
  public let maxName : Nat = 80;
  public let maxShort : Nat = 20;
  public let maxText : Nat = 1_000;
  public let maxLabel : Nat = 60;
  public let maxListPage : Nat = 500;
  public let maxRoles : Nat = 7;
  public let maxWorkIdsPerInvite : Nat = 50;
  public let maxAliases : Nat = 20;

  // Tickets (§6)
  public let ticketTtl : Int = 600_000_000_000; // 10 min
  public let proposalGrace : Int = 3_600_000_000_000; // voorstel tot 1 uur na vervallen
  public let maxProposalBytes : Nat = 10_000;
  public func ticketTasks() : [(Text, Nat)] { [("proef", 100)] }; // (taak, budget in cent)

  // Bestanden (§2.7, R11)
  public let maxFileBytes : Nat = 25_000_000;
  public let maxFilesPerPerson : Nat = 2_000;
  public func allowedMime(mime : Text) : Bool {
    mime == "image/jpeg" or mime == "image/png" or mime == "image/webp" or mime == "application/pdf";
  };

  // Timer: elke 10 min klein werk (0.2 open punt 6)
  public let timerSeconds : Nat = 600;

  // ── Werffiche en contract (1.1) ─────────────────────────────────────────
  public let maxFormula : Nat = 500;
  public let maxGuaranteeBp : Nat = 2_000; // 20 %
  public let maxPaymentTermDays : Nat = 365;
  public let maxAmountCents : Int = 100_000_000_000; // € 1 miljard: tikfoutgrens
  // Drempels (VOORLOPIG, instelbaar in settings.values; na te kijken met de boekhouder):
  // aangifte van werken (30bis) vanaf € 30.000 excl. btw, Checkinatwork vanaf € 500.000 (bouwplan §5.4).
  public let threshold30bisCentsDefault : Nat = 3_000_000;
  public let thresholdCheckinatworkCentsDefault : Nat = 50_000_000;

  // ── Documentsoorten (A5, VOORLOPIG) ─────────────────────────────────────
  // (sleutel, naam, wanneer verplicht, wie levert, zichtbaar voor OA, vertrouwelijk)
  // verplicht: "altijd" · "btw6" (werf op 6 %) · "30bis" · "checkinatwork" (drempels hierboven) ·
  //            "vc" (de werf heeft of vraagt een veiligheidscoördinator) · "oplevering" (opgeleverd) · "optioneel"
  // levert:    "bowaco" (interne rollen) of een externe rol: architect, veiligheidscoordinator, onderaannemer, klant
  // De admin past de lijst aan in Instellingen (settings.lookups "docKind:<sleutel>"); dan geldt die lijst.
  public func defaultDocKinds() : [(Text, Text, Text, Text, Bool, Bool)] {
    [
      ("contract", "Aannemingsovereenkomst / getekende offerte", "altijd", "bowaco", false, true),
      ("btw6-attest", "Btw-attest 6 % (verklaring van de klant)", "btw6", "klant", false, false),
      ("plannen", "Plannen", "optioneel", "architect", true, false),
      ("lastenboek", "Lastenboek / meetstaat", "optioneel", "architect", true, false),
      ("omgevingsvergunning", "Omgevingsvergunning", "optioneel", "architect", true, false),
      ("vgplan", "Veiligheids- en gezondheidsplan", "vc", "veiligheidscoordinator", true, false),
      ("coordinatiedagboek", "Coördinatiedagboek", "vc", "veiligheidscoordinator", false, false),
      ("pid", "Postinterventiedossier (PID)", "vc", "veiligheidscoordinator", false, false),
      ("aangifte-30bis", "Aangifte van werken (30bis)", "30bis", "bowaco", false, false),
      ("checkinatwork", "Checkinatwork-registratie", "checkinatwork", "bowaco", false, false),
      ("asbestinventaris", "Asbestinventaris", "optioneel", "klant", true, false),
      ("plaatsbeschrijving", "Plaatsbeschrijving vóór de werken", "optioneel", "bowaco", false, false),
      ("verzekering", "Verzekering (ABR / tienjarige aansprakelijkheid)", "optioneel", "bowaco", false, false),
      ("epb", "EPB-aangifte / -verslag", "optioneel", "architect", false, false),
      ("keuring-elektriciteit", "Keuring elektriciteit (AREI)", "optioneel", "onderaannemer", true, false),
      ("keuring-verwarming", "Keuring verwarming / gas", "optioneel", "onderaannemer", true, false),
      ("pv-voorlopige-oplevering", "PV voorlopige oplevering", "oplevering", "bowaco", false, false),
      ("pv-definitieve-oplevering", "PV definitieve oplevering", "optioneel", "bowaco", false, false),
      ("oa-offerte", "Offerte onderaannemer", "optioneel", "bowaco", false, true),
      ("oa-factuur", "Factuur onderaannemer", "optioneel", "bowaco", false, true),
      ("andere", "Ander document", "optioneel", "bowaco", false, false),
    ];
  };
  public func docRules() : [Text] { ["altijd", "btw6", "30bis", "checkinatwork", "vc", "oplevering", "optioneel"] };
  public let maxDocKinds : Nat = 60;
  public let maxDocsPerWork : Nat = 500;
  public let maxFilesPerDoc : Nat = 50;

  // ── Planning per werf (1.3) ─────────────────────────────────────────────
  public let maxTasksPerWork : Nat = 300;
  public let maxDepsPerWork : Nat = 800;
  public let maxAssignPerTask : Nat = 8;
  public let maxBlocks : Nat = 400; // kalenderblokken in totaal (bedrijf + werven)
  public let maxBlockDays : Nat = 120; // één blok
  public let maxWorkdays : Nat = 400; // duur van één taak
  public let maxLeadDays : Nat = 365;
  public let maxLag : Int = 120; // wachttijd in werkdagen (± voor overlap)
  public let maxTemplates : Nat = 20;
  public let maxTemplateSteps : Nat = 80;
  public let maxNote : Nat = 1_000;
  // Rekengrens: geen planning verder dan ± 15 jaar na 1970+dag (lussen over de kalender blijven begrensd, T17).
  public let maxScanDays : Nat = 1_500;
  public let defaultTemplateKey = "standaardrenovatie";
  public let minDay : Nat = 18_000; // 14.04.2019: vroeger is een tikfout
  public let maxDay : Nat = 40_000; // 06.07.2079

  // ── Weekbord per OA (1.4) ───────────────────────────────────────────────
  // Het weekbord rekent altijd binnen één venster en per pagina firma's (D10, T17): zo blijft het werken bij
  // honderden werven en tientallen OA's (gemeten in de stresstest van 1.4).
  public let boardMaxWeeks : Nat = 12;
  public let boardMaxRows : Nat = 50;
  public let boardMaxConflicts : Nat = 200; // "Vraagt aandacht" en de werfpagina
  // Algemene regel voor "dubbel": hoeveel werven tegelijk per firma (0 = onbeperkt). De admin past ze aan
  // (algemeen, per vakgebied, per firma). Per dag (standaard) of per week (zoals de Excel).
  public let boardDefaultMax : Nat = 1;
  public let maxCapacity : Nat = 50; // hoogste getal in een regel
  public let maxCapacityRules : Nat = 300;
  public let maxAbsenceDays : Nat = 366; // één afwezigheid
  public let maxAbsencesPerOrg : Nat = 200; // niet-gearchiveerde afwezigheden per firma
  public let maxAbsenceNote : Nat = 200;

  // ── Werfverslag (1.6, architectuur §2.6 en §8; grenzen D10) ─────────────
  // Een verslag mag tot 60 dagen na de werfdag binnenkomen (een gsm die lang zonder bereik was) en niet
  // later dan morgen (tijdzone). Opdrachten van het toestel komen in pakjes van hoogstens 40.
  public let reportMaxAgeDays : Nat = 60;
  public let maxOpsPerCall : Nat = 40;
  public let opKeepDays : Int = 30; // opId-index (§8.3): daarna opgeruimd door de timer
  public let maxAttendancesPerReport : Nat = 40;
  public let maxWorkDonePerReport : Nat = 60;
  public let maxMaterialsPerReport : Nat = 60;
  public let maxPhotosPerReport : Nat = 50;
  public let maxIssuesPerReport : Nat = 30;
  public let maxTripsPerReport : Nat = 6;
  public let maxReportText : Nat = 4_000; // samenvatting
  public let maxHeadcount : Nat = 30;
  public let maxSlots : Nat = 4;
  public let maxDelayDays : Nat = 120;
  public let maxVehicles : Nat = 100;
  public let myDayMaxWorks : Nat = 60;
  // Beeld: enkel foto's (JPEG, PNG, WebP); de gsm verkleint tot ≤ 1600 px, dus ruim onder deze grens.
  public let maxPhotoBytes : Nat = 8_000_000;
  public func photoMime(mime : Text) : Bool { mime == "image/jpeg" or mime == "image/png" or mime == "image/webp" };

  // Sjabloon "standaardrenovatie" (VOORLOPIG tot 0.3 en de bevestiging van Alexis; de admin past het aan in
  // Instellingen → Sjablonen, dan geldt die versie). Volgorde uit architectuur §1.1 punt 2 (mediane positie
  // van de trefwoorden over de werven met ≥ 8 taken); de duur uit de mediaan van de weken met werk in de
  // planning van 08-05-2026, omgezet naar werkdagen. Levertermijnen en wachttijden zijn een eerste gok.
  // (sleutel, titel, vakgebied, soort "work"|"milestone"|"delivery", werkdagen, levertermijn in kalenderdagen,
  //  wacht op (sleutels), wachttijd in werkdagen, notitie)
  public func defaultTemplate() : [(Text, Text, ?Text, Text, Nat, Nat, [Text], Nat, Text)] {
    [
      ("voorbereiding", "Werfvoorbereiding en werfinrichting", ?"algemeen", "work", 3, 0, [], 0, ""),
      ("container", "Container en inname openbaar domein geregeld", null, "milestone", 0, 0, ["voorbereiding"], 0, "vergunning openbaar domein"),
      ("afplakken", "Afplakken en beschermen", ?"algemeen", "work", 2, 0, ["container"], 0, ""),
      ("afbraak", "Afbraakwerken", ?"afbraak", "work", 5, 0, ["afplakken"], 0, ""),
      ("ruwbouw", "Ruwbouw en metselwerk", ?"ruwbouw", "work", 5, 0, ["afbraak"], 0, ""),
      ("injecteren", "Injecteren (vocht)", ?"injecteren", "work", 3, 0, ["ruwbouw"], 0, ""),
      ("dak", "Dakwerken", ?"dak", "work", 5, 0, ["ruwbouw"], 0, ""),
      ("ventilatie", "Ventilatie (slijpwerk en kanalen)", ?"ventilatie", "work", 10, 0, ["ruwbouw"], 0, ""),
      ("elektriciteit", "Elektriciteit (slijpwerk en leidingen)", ?"elektriciteit", "work", 10, 0, ["ruwbouw"], 0, ""),
      ("isolatie", "Isolatie", ?"vloerisolatie", "work", 3, 0, ["dak"], 0, ""),
      ("trap", "Trap", ?"binnenschrijnwerk", "work", 5, 0, ["ruwbouw"], 0, ""),
      ("pur", "PUR-isolatie vloer", ?"vloerisolatie", "work", 2, 0, ["elektriciteit", "ventilatie", "injecteren"], 0, ""),
      ("gyproc", "Gyproc, voorzetwanden en plafonds", ?"pleister", "work", 10, 0, ["isolatie", "elektriciteit"], 0, ""),
      ("sanitair", "Sanitair en verwarming", ?"sanitair-chauffage", "work", 5, 0, ["pur"], 0, ""),
      ("pleister", "Pleisterwerken", ?"pleister", "work", 15, 0, ["gyproc"], 0, ""),
      ("chape", "Chape", ?"chape", "work", 3, 0, ["sanitair"], 0, ""),
      ("deuren", "Binnendeuren", ?"binnenschrijnwerk", "work", 5, 0, ["pleister"], 0, ""),
      ("tegels", "Tegelwerken en faïence", ?"tegels", "work", 5, 0, ["chape", "pleister"], 15, "wachttijd = droogtijd chape (voorlopig 3 weken)"),
      ("parket", "Parket", ?"parket", "work", 10, 0, ["chape"], 20, "wachttijd = droogtijd chape (voorlopig 4 weken)"),
      ("levering-keuken", "Levering keuken", ?"binnenschrijnwerk", "delivery", 0, 42, ["tegels"], 0, "levertermijn voorlopig 6 weken"),
      ("keuken", "Keuken plaatsen", ?"binnenschrijnwerk", "work", 5, 0, ["levering-keuken"], 0, ""),
      ("plinten", "Plinten en dagkanten", ?"binnenschrijnwerk", "work", 3, 0, ["parket", "tegels"], 0, ""),
      ("levering-ramen", "Levering ramen", ?"buitenschrijnwerk", "delivery", 0, 56, ["plinten"], 0, "levertermijn voorlopig 8 weken"),
      ("ramen", "Ramen plaatsen", ?"buitenschrijnwerk", "work", 5, 0, ["levering-ramen"], 0, ""),
      ("schilder", "Schilderwerken", ?"schilder", "work", 10, 0, ["ramen", "deuren", "keuken"], 0, ""),
      ("opkuis", "Opkuis", ?"algemeen", "work", 3, 0, ["schilder"], 0, ""),
      ("crepi-pid", "Crepi en PID", ?"pleister", "work", 10, 0, ["ramen"], 0, "PID = postinterventiedossier"),
      ("oplevering", "Voorlopige oplevering", null, "milestone", 0, 0, ["opkuis", "crepi-pid"], 0, ""),
    ];
  };

  // ── Onderaannemers-database (1.2) ───────────────────────────────────────
  public let maxEmail : Nat = 120;
  public let maxWebsite : Nat = 120;
  public let maxJobTitle : Nat = 60;
  public let maxImportKey : Nat = 200; // lengte van een importsleutel (1.5)
  public let maxImportRows : Nat = 40; // per oproep; het script knipt in stukken
  public let maxPersonsPerOrg : Nat = 40;
  public let maxTrades : Nat = 80;
  public let maxTradesPerOrg : Nat = 12;

  // Vakgebieden (VOORLOPIG tot 0.3: B7 uit architectuur §12.2). (sleutel, naam). De admin past de lijst aan
  // in Instellingen (settings.lookups "trade:<sleutel>"); dan geldt die lijst (D9).
  public func defaultTrades() : [(Text, Text)] {
    [
      ("afbraak", "Afbraakwerken"),
      ("grond-fundering", "Grond en fundering"),
      ("riolering", "Riolering"),
      ("ruwbouw", "Ruwbouw en metselwerk"),
      ("stabiliteit", "Stabiliteit"),
      ("dak", "Dakwerken"),
      ("buitenschrijnwerk", "Buitenschrijnwerk (ramen, deuren)"),
      ("elektriciteit", "Elektriciteit"),
      ("sanitair-chauffage", "Sanitair, verwarming en warmtepomp"),
      ("ventilatie", "Ventilatie"),
      ("pleister", "Pleisterwerken en binnenplaat"),
      ("vloerisolatie", "Vloerisolatie"),
      ("chape", "Chape"),
      ("parket", "Parket en laminaat"),
      ("tegels", "Tegelwerken en faïence"),
      ("binnenschrijnwerk", "Binnenschrijnwerk en keuken"),
      ("schilder", "Schilderwerken"),
      ("tuin", "Tuin en verharding"),
      ("injecteren", "Injecteren (vocht)"),
      ("studies", "Studies, EPB en veiligheid"),
      ("algemeen", "Algemene renovatie"),
    ];
  };
};
