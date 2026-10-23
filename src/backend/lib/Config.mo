// Vaste waarden van de app. Hier staan alleen hashes, nooit geheimen. Robotprincipals beheert de
// admin in de app (robot.robots), niet meer hier.
module {
  public let version = "1.2-draft7";
  public let schema : Nat = 3; // 3 = met onderaannemers-database (1.2)

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

  // ── Onderaannemers-database (1.2) ───────────────────────────────────────
  public let maxEmail : Nat = 120;
  public let maxWebsite : Nat = 120;
  public let maxJobTitle : Nat = 60;
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
