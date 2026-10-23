# BOWACO werfbeheer — register van persoonsgegevens (GDPR)

*Stap 0.6, 23-10-2026. Opgesteld door Claude als werkdocument; **geen juridisch advies**. Te laten nakijken door de eigenaar (en, als hij dat wil, door een jurist) vóór live. Wordt bijgewerkt bij elke stap die een nieuw persoonsgegeven toevoegt (planning 1.3, verslagen 1.6, offertes fase 2 …).*

Verwerkingsverantwoordelijke: **BOWACO** (zaakvoerder Alexis). Beheerder van de app: Tanguy. Platform: Caffeine (Internet Computer). Login: Internet Identity zonder e-mailadres (`withAttributes={false}`).

## 1. Wat de app in 0.6 bewaart

| # | Wie | Gegevens | Waar (backend) | Klasse | Grondslag | Bewaartermijn | Wie ziet het |
|---|---|---|---|---|---|---|---|
| P1 | Medewerkers BOWACO (admin, werfleider, calculator) | naam, rol(len), planningcode, gsm (optioneel), taal | `access.persons` | intern | uitvoering arbeidsovereenkomst / gerechtvaardigd belang (werforganisatie) | zolang in dienst; daarna **afgezet** (gearchiveerd), niet gewist: verslagen en audit verwijzen ernaar (bewijs, 10 jaar na oplevering) | interne rollen (team) |
| P2 | Personen van onderaannemers, architecten, veiligheidscoördinatoren | naam, rol, organisatie, planningcode, gsm (optioneel) | `access.persons`, `works.memberships` | intern | gerechtvaardigd belang (uitvoering aanneming, wettelijke werfadministratie) | zolang de samenwerking loopt; daarna afgezet; lidmaatschap per werf beëindigd (R31) | interne rollen; de persoon zelf |
| P3 | Klanten (particulieren) | naam (als persoon of als organisatie) | `access.persons` / `org.orgs` | intern | uitvoering overeenkomst (aanneming) | 10 jaar na oplevering (aansprakelijkheid) | interne rollen |
| P4 | Klanten: contactgegevens | contactpersoon, gsm, e-mail, adres, commerciële notities | `org.orgConfidential` / `access.personConfidential` (`Confidential<T>`) | **vertrouwelijk** | uitvoering overeenkomst | idem P3 | admin en calculator; elk bekijken staat in de auditlog (R23, R27) |
| P5 | Iedereen met een login | **principal** (pseudoniem van Internet Identity per adres), tijdstip van koppelen, laatste 2 tekens van de gebruikte code, toestelnaam (optioneel, door de admin) | `access.links`, `access.linkHistory` | technisch | gerechtvaardigd belang (beveiliging, toegangsbeheer) | zolang de persoon bestaat; ingetrokken koppelingen blijven (historiek) | admin |
| P6 | Iedereen die een code probeert | principal, aantal foute pogingen, blokkering | `access.attempts`, `access.throttle` | technisch | gerechtvaardigd belang (beveiliging) | wordt overschreven (venster van 1 uur, blokkering 24 uur) | admin (auditlog) |
| P7 | Iedereen die iets doet | auditregel: tijdstip, principal, persoon-id, werf-id, handeling, korte omschrijving (nooit een code of bestandsadres) | `audit.log` | intern | gerechtvaardigd belang + bewijs | 10 jaar (bewijs bij aansprakelijkheid); geen wissen (D2) | admin; ieder zijn eigen regels |
| P8 | Ontvangers van meldingen | melding met naam van wie zich koppelde | `audit.notifications` | intern | gerechtvaardigd belang | tot gelezen + bewaard als historiek | de ontvanger |
| P9 | Wie een bestand oplaadt; wie op een foto staat | bestandsnaam, tijdstip, uploader; de foto zelf in de opslag van Caffeine | `files.files` + opslagdienst Caffeine | intern (vertrouwelijk als `confidential`) | gerechtvaardigd belang (werfopvolging, bewijs) | **permanent** (beslist 22-10): bewijs bij aansprakelijkheid | wie de werf mag zien (R12); de URL is openbaar-voor-wie-hem-kent (zie §3) |
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

## 4. Open punten (eigenaar)

| # | Punt |
|---|---|
| PR1 | Wissen versus bewijs: anonimiseren als standaardantwoord op een wisverzoek? (zie §3) |
| PR2 | Verwerkersovereenkomst met Caffeine opvragen; vermelden dat Caffeine zelf platformsleutels in de canister plaatst (meetverslag 0.2) |
| PR3 | Privacyverklaring voor OA's en klanten (foto's van personeel op de werf: beslist "geen bezwaar", maar informeren blijft nodig) |
| PR4 | Bewaartermijn van auditregels en uitnodigingen na het einde van de samenwerking: 10 jaar voor alles, of korter voor P5/P6/P10? |
| PR5 | Dit register nakijken bij 1.3 (planning), 1.6 (verslagen, aanwezigheden = uren per persoon) en fase 2 (prijzen) |
