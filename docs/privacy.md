# BOWACO werfbeheer — register van persoonsgegevens (GDPR)

*Stap 0.6, 23-10-2026. Opgesteld door Claude als werkdocument; **geen juridisch advies**. Te laten nakijken door de eigenaar (en, als hij dat wil, door een jurist) vóór live. Wordt bijgewerkt bij elke stap die een nieuw persoonsgegeven toevoegt (planning 1.3, verslagen 1.6, offertes fase 2 …).*

Verwerkingsverantwoordelijke: **BOWACO** (zaakvoerder Alexis). Beheerder van de app: Tanguy. Platform: Caffeine (Internet Computer). Login: Internet Identity zonder e-mailadres (`withAttributes={false}`).

## 1. Wat de app in 0.6 bewaart

| # | Wie | Gegevens | Waar (backend) | Klasse | Grondslag | Bewaartermijn | Wie ziet het |
|---|---|---|---|---|---|---|---|
| P1 | Medewerkers BOWACO (admin, werfleider, calculator) | naam, rol(len), planningcode, gsm (optioneel), taal | `access.persons` | intern | uitvoering arbeidsovereenkomst / gerechtvaardigd belang (werforganisatie) | zolang in dienst; daarna **afgezet** (gearchiveerd), niet gewist: verslagen en audit verwijzen ernaar (bewijs, 10 jaar na oplevering) | interne rollen (team); **sinds 1.7 ziet een externe van zijn werf de naam en de gsm van de werfleider** (*Mijn werven*, om te bellen) en in het team de namen van de interne rollen (1.9) |
| P2 | Personen van onderaannemers, architecten, veiligheidscoördinatoren | naam, rol, organisatie, planningcode, gsm (optioneel) | `access.persons`, `works.memberships` | intern | gerechtvaardigd belang (uitvoering aanneming, wettelijke werfadministratie) | zolang de samenwerking loopt; daarna afgezet; lidmaatschap per werf beëindigd (R31) | interne rollen; de persoon zelf en zijn eigen firma; **sinds 1.9 ziet een andere externe op dezelfde werf hen niet meer in het team** (vóór 1.9 wel: hersteld in de securityreview); de architect/VC ziet wel de firma's en namen van uitvoerders in de planning (R3) |
| P3 | Klanten (particulieren) | naam (als persoon of als organisatie) | `access.persons` / `org.orgs` | intern | uitvoering overeenkomst (aanneming) | 10 jaar na oplevering (aansprakelijkheid) | interne rollen |
| P4 | Klanten: contactgegevens | contactpersoon, gsm, e-mail, adres, commerciële notities | `org.orgConfidential` / `access.personConfidential` (`Confidential<T>`) | **vertrouwelijk** | uitvoering overeenkomst | idem P3 | admin en calculator; elk bekijken staat in de auditlog (R23, R27) |
| P5 | Iedereen met een login | **principal** (pseudoniem van Internet Identity per adres), tijdstip van koppelen, laatste 2 tekens van de gebruikte code, toestelnaam (optioneel, door de admin) | `access.links`, `access.linkHistory` | technisch | gerechtvaardigd belang (beveiliging, toegangsbeheer) | zolang de persoon bestaat; ingetrokken koppelingen blijven (historiek) | admin |
| P6 | Iedereen die een code probeert | principal, aantal foute pogingen, blokkering | `access.attempts`, `access.throttle` | technisch | gerechtvaardigd belang (beveiliging) | wordt overschreven (venster van 1 uur, blokkering 24 uur); **sinds 1.9 ruimt de timer verlopen tellers op** (niet geblokkeerd en venster voorbij) | admin (auditlog, *accessStats*) |
| P7 | Iedereen die iets doet | auditregel: tijdstip, principal, persoon-id, werf-id, handeling, korte omschrijving (nooit een code of bestandsadres) | `audit.log` | intern | gerechtvaardigd belang + bewijs | 10 jaar (bewijs bij aansprakelijkheid); geen wissen (D2) | admin; ieder zijn eigen regels |
| P8 | Ontvangers van meldingen | melding met naam van wie zich koppelde | `audit.notifications` | intern | gerechtvaardigd belang | tot gelezen + bewaard als historiek | de ontvanger |
| P9 | Wie een bestand oplaadt; wie op een foto staat | bestandsnaam, tijdstip, uploader; de foto zelf in de opslag van Caffeine | `files.files` + opslagdienst Caffeine | intern (vertrouwelijk als `confidential`) | gerechtvaardigd belang (werfopvolging, bewijs) | **permanent** (beslist 22-10): bewijs bij aansprakelijkheid | wie de werf mag zien (R12); de URL is openbaar-voor-wie-hem-kent (zie §3) |
| P11 | Klanten: contactpersoon per werf (1.1) | naam, gsm, e-mail van de contactpersoon voor één werf (bv. bewoner), commerciële notities bij de werf | `dossier.confidential` + elke versie in `dossier.confidentialHistory` (`Confidential<T>`) | **vertrouwelijk** | uitvoering overeenkomst | idem P3 | admin en calculator; elk bekijken staat in de auditlog ("bekeek:contract"), een wijziging logt enkel de veldnamen |
| P12 | Wie een werfdocument levert (1.1) | soort, titel, status, termijnen, wie het laatst wijzigde, leverende organisatie; de bestanden zelf zoals P9 | `dossier.documents` | intern (vertrouwelijk bij een vertrouwelijke soort, bv. contract) | gerechtvaardigd belang + wettelijke werfadministratie (VG-plan, 30bis …) | permanent zoals P9 | volgens de documentsoort (R10): interne rollen; externen enkel de soorten die hen aanbelangen |
| P13 | Onderaannemers, leveranciers, nutsbedrijven, architecten (1.2): de firma | firmanaam, KBO- en btw-nummer, planningcodes (aliassen), vakgebieden, telefoon, e-mail, website, opmerking bij het contact | `org.orgs`, `oa.orgContacts` | intern | gerechtvaardigd belang (uitvoering aanneming, werforganisatie) | zolang de samenwerking duurt; daarna **gearchiveerd**, niet gewist (D2) | interne rollen lezen; admin en werfleider beheren; externen nooit |
| P14 | Contactpersonen van die firma's (1.2), ook zonder login | naam, planningcode, functie, gsm, e-mail, notitie | `access.persons`, `oa.personContacts` | intern (voor klanten: P4, vertrouwelijk) | idem P13 | idem P2; afzetten via Team | idem P13 |
| P15 | Planning per werf (1.3): wie wanneer waar werkt | taak, data, firma (en eventueel persoon) als uitvoerder, bevestiging of weigering met **reden** en wie/wanneer, wijzigingen per veld met wie/wanneer/waarom | `plan.tasks`, `plan.assignments`, `plan.taskChanges`, `plan.calendarBlocks` | intern (de interne notitie bij een taak ziet enkel BOWACO) | gerechtvaardigd belang (werforganisatie, uitvoering aanneming) | permanent zoals de werf (bewijs bij aansprakelijkheid, D2) | interne rollen alles; architect en veiligheidscoördinator zonder interne notities; OA enkel de taken van zijn eigen firma; klant een samenvatting zonder firma's |
| P16 | Afwezigheden van OA's (1.4) | firma, eventueel één persoon, soort (**verlof · ziekte · andere**), van–tot, korte notitie (≤ 200 tekens), wie ingaf (kantoor of de OA zelf) en de geschiedenis (wie/wanneer/wat, zonder notitie) | `board.absences`, `board.absenceChanges` | intern; **"ziekte" is een gezondheidsgegeven (GDPR art. 9)**: enkel het soort, nooit een reden of attest; de notitie vraagt uitdrukkelijk geen medische details; de auditlog bevat nooit de notitie | gerechtvaardigd belang (werforganisatie); voor "ziekte" van een natuurlijke persoon: na te kijken (zie PR9) | zolang de samenwerking duurt; archiveren = weg van het weekbord, blijft in de geschiedenis (D2) — bewaartermijn na te kijken (PR9) | interne rollen lezen; admin en werfleider geven in; de OA ziet en meldt enkel die van zijn eigen firma (als de admin dat toelaat) |
| P10 | Uitnodigingen | naam en rollen van de genodigde, maker, vervaltijd, hint (2 tekens); de code zelf alleen als hash | `access.invites` | geheim gehasht / intern | gerechtvaardigd belang | blijft als historiek (eindtoestand gebruikt / ingetrokken / verlopen) | admin; de maker zijn eigen codes |

Niet bewaard: e-mailadres voor de login, wachtwoorden, IP-adressen (het IC geeft er geen), locatie van foto's (EXIF wordt bij het verkleinen in de browser verwijderd).

## 2. Ontvangers en verwerkers

| Verwerker | Wat | Waar | Overeenkomst |
|---|---|---|---|
| Caffeine (caffeine.ai) | hosting van de app en de opslag van bestanden | Internet Computer (wereldwijd verspreide nodes) + `blob.caffeine.ai` | **open**: verwerkersovereenkomst opvragen (zie §4) |
| DFINITY / Internet Identity | login (passkey of Google via II) | Internet Computer | II deelt enkel een pseudonieme principal per app-adres |
| Node-operators van het IC-subnet | kunnen in principe het geheugen lezen (architectuur T8) | — | aanvaard voor interne data; vertrouwelijk: beslissing 2.1 (vetKeys) |
| Gateway (Hetzner, vanaf fase 1b) | postbode, AI | Duitsland | nog niet in gebruik |

## 3. Rechten van betrokkenen en hoe de app ze ondersteunt

| Recht | In 0.6 |
|---|---|
| Inzage | admin: **export intern** (JSON) en **export vertrouwelijk** (apart); per persoon filteren gebeurt nu met de hand in de export |
| Rectificatie | admin wijzigt de persoonsfiche; elke wijziging staat in de auditlog (oud → nieuw in de omschrijving) |
| Wissen | **spanning met D2 (nooit wissen)**: afzetten verbergt de persoon en sluit elke toegang meteen af, maar naam en historiek blijven (bewijs). Voorstel: bij een gegrond verzoek de naam vervangen door "verwijderd #id" en de gsm leegmaken (anonimiseren), auditregel en verslagen blijven. Te beslissen door de eigenaar (open punt PR1) |
| Beperking / bezwaar | afzetten of lidmaatschap beëindigen |
| Overdraagbaarheid | export (JSON) |

Bestanden: een opslag-URL is **openbaar voor wie hem kent** (meetverslag 0.2c). De app geeft een URL enkel aan wie de werf mag zien; URL's komen nooit in de auditlog, meldingen of mails. Een foto die echt weg moet, kan alleen door de verwijzing te verwijderen (dan ruimt de gateway het bestand op) — dat strijdt met "permanent bewaren" en vraagt een beslissing per geval.

## 4. Exportbestanden en herstel

De export (beheerder: *Auditlog → Export*, of `tests/herstel.mjs export`) maakt drie JSON-bestanden: intern, vertrouwelijk en de auditlog. Sinds 1.9 is dat ook de **back-up** die met `RestoreApi` op een lege canister teruggezet kan worden (draaiboek `docs/herstel.md`); de interne export bevat daarvoor ook de meldingen van iedereen, de toestelsleutels en de offline-opdrachten (≤ 60 dagen) van de werfleiders. **Behandel alle drie als vertrouwelijk**, ook "intern":
- de interne en de vertrouwelijke export bevatten de **opslag-URL's** van de bestanden (foto's, plannen, contracten); wie het exportbestand heeft, kan die bestanden openen zonder login (§3);
- de vertrouwelijke export bevat klantcontactgegevens;
- alle drie bevatten namen, rollen en gsm-nummers.

Bewaren: niet in e-mail of chat doorsturen; op een versleutelde schijf of in een kluis van de eigenaar. Stand na de review (1.9): de interne export bevat enkel de URL's van **niet-vertrouwelijke** bestanden (foto's, plannen); de URL's van vertrouwelijke bestanden (contracten) staan alleen in de vertrouwelijke export (keuze (c) van O-19; definitief te bevestigen door de eigenaar, E-5). Voor een herstel zijn de URL's nodig: een export zonder URL's is dus geen volledige back-up.

## 5. Open punten (eigenaar)

| # | Punt |
|---|---|
| PR1 | Wissen versus bewijs: anonimiseren als standaardantwoord op een wisverzoek? (zie §3) |
| PR2 | Verwerkersovereenkomst met Caffeine opvragen; vermelden dat Caffeine zelf platformsleutels in de canister plaatst (meetverslag 0.2) |
| PR3 | Privacyverklaring voor OA's en klanten (foto's van personeel op de werf: beslist "geen bezwaar", maar informeren blijft nodig) |
| PR4 | Bewaartermijn van auditregels en uitnodigingen na het einde van de samenwerking: 10 jaar voor alles, of korter voor P5/P6/P10? |
| PR6 | Exportbestanden bevatten opslag-URL's (§4): zo laten of een export zonder URL's (beslissing 0.7) |
| PR7 | 1.1: contactpersoon per werf (P11) en werfdocumenten (P12) toegevoegd; nakijken samen met PR1 (een document van een afgezette persoon blijft) |
| PR9 | 1.4: afwezigheden (P16). Voor een eenmanszaak is "ziekte" een gezondheidsgegeven van een persoon: volstaat "afwezig" (zonder soort) of mag "ziekte" blijven? Bewaartermijn van gearchiveerde afwezigheden (bv. 1 jaar en dan het soort wissen)? Vóór live met de eigenaar/jurist beslissen |
| PR8 | 1.3: planning (P15) toegevoegd; een weigering van een OA bevat een vrije reden (geen gezondheids- of privéredenen vragen: tekst in de app zegt "waarom lukt het niet?") |
| PR5 | Dit register nakijken bij 1.6 (verslagen, aanwezigheden = uren per persoon) en fase 2 (prijzen) |
| PR10 | 1.9: een hersteld exemplaar van de app (lokaal of een nieuw project) bevat dezelfde persoonsgegevens; de exportbestanden zijn dus zelf een verwerking (bewaartermijn en plaats vastleggen: kluis van de eigenaar, hoe lang?) |
