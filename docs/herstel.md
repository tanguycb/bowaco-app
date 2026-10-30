# Draaiboek: back-up en herstel van de BOWACO-app

*Stap 1.9 (securityreview 0.7/1.9), 24-10-2026; bijgewerkt in stap 2.2 (25-10-2026: postenbibliotheek, back-up in stukken vanuit de app, instructie voor de eigenaar §7) en in stap 2.4 (25-10-2026: offertes; stap 2.6: controleregels; draftwissel naar 5vwqk en `tools/draft-opbouw.mjs` in §8); nagekeken in de securityreview 2.12 (26-10-2026: de tellers als laatste in de export, het vangnet van de tellers ook voor de volgnummers per werf en de voorwaardenversies, §4 volledig). Hoort bij architectuur §7 (M9) en dreiging T16. Bijwerken bij elke stap die een collectie toevoegt (de export, `tests/herstel.mjs` en `mixins/RestoreApi.mo` moeten ze alle drie kennen).*

## 1. Wat een back-up is

Drie JSON-bestanden, gemaakt door een **beheerder** van de app (update-calls, dus elke export staat in de auditlog):

| Bestand | Backend-functie | Inhoud |
|---|---|---|
| `intern.json` | `exportIntern()` | personen, logins (principals), codes (enkel de hint), organisaties, werven, team, documenten, OA-database, planning, weekbord, import, verslagen, voertuigen, robots, voorstellen, meldingen, keuzelijsten, vlaggen, **tellers** (de laatst uitgegeven ids), planversies, toestelsleutels, offline-opdrachten; **sinds 1b.1** vergunningen, hun wijzigingen, de kennisbank per gemeente (gemeenten, procedures) en de al verstuurde vergunningsmeldingen (zodat niemand na een herstel opnieuw gemeld wordt); **sinds 1b.3** de werkwachtrij van de postbode (opdrachten met hun idempotentiesleutel: een herstelde app zet geen weekmail opnieuw klaar die al verstuurd was; een geleasete opdracht komt terug in de wachtrij); **sinds 1b.4** de raadplegingen van de inhoudingsplicht en de aangiftes van werken; **sinds 2.2** de postenbibliotheek (hoofdstukken, posten en al hun versies; **zonder** prijzen); **sinds 2.4** de offertes (offertes, versies met status, hash en totalen van het versturen, hoofdstukken en lijnen met tekst en hoeveelheid; **zonder** aankoopprijs of marge); **sinds 2.7** de algemene voorwaarden met versies, de vastgelegde velden van elke verzonden offerte en de akkoorden (`quoteTerms`, `quoteSendInfos`, `quoteAcceptances`; het akkoord bevat de principal van de klant en het tijdstip); **sinds 2.6** de instellingen van de controleregels (regels, standaardposten) en de doorgezette waarschuwingen met hun reden (`quoteRules`, `quoteStdPosts`, `quoteChecks`); **sinds 2.8** de werfstarts uit aanvaarde offertes (`workStarts`: per offerteversie de werf, de taken, afhankelijkheden en vergunningsvoorstellen die eruit kwamen, de lijnen die een taak kregen en hun oorsprong, de status van de aangifte of de reden van een afwijzing; **zonder** bedrag: de aanneemsom staat in het contract, vertrouwelijk). Zonder dit record zou een herstelde app een al gestarte offerte opnieuw als voorstel tonen; **sinds 2.9** de opmeting ter plaatse (`surveys` de opmetingen per werf, `surveyKeys` de sleutel van elk toestel, `measureEntries` de regels met hoeveelheid, datum, wie mat, notitie, verwijzingen naar foto's en schets, correcties met reden en de beslissing over een voorstel van een OA, `measureSnapshots` de stand per post bij het afsluiten van een opmeting, `measureOps` de offline-opdrachten met hun opId; **zonder** prijs: het gaat over hoeveelheden). Zonder de opdrachten zou een tweede poging van een gsm na een herstel dubbele regels maken, zonder de stand bij het afsluiten kon een vorderingsstaat (2.10) niet meer herrekend worden; **sinds 2.10** de vorderingsstaten zonder bedragen (`progressStatements`: per staat de werf, soort (staat of creditnota), nummer en code, periode, status, facturatiestatus, wie voorbereidde en verstuurde, de hash; `progressInputs` de invoer per post (% en hoeveelheden met notitie); `progressAnswers` het akkoord of de opmerking van de klant met zijn principal en de hash). Zonder de staten zou een herstelde app een volgende staat niet op de vorige laten verder tellen; **sinds 2.11** de OA-facturen zonder bedragen (`oaInvoices`: firma, werf, nummer, data, btw-regime, bijlage-id, status en de beslissing met de inhoudingsplicht of de uitzondering); de indexen (firma + nummer, per werf) worden bij het herstel herrekend; **sinds 2.12** leest het script de **tellers als allerlaatste** (na alle collecties), zodat een staat die tijdens de export verstuurd wordt nooit een nummer krijgt dat de teller nog niet kent; **sinds 2c.1** de vorm van de offertes zonder bedragen (`quoteFormInfos` soort, verzekeraar en dossiernummer per offerte; `quoteVersionForms` wat de klant ziet per versie; `quoteSubgroups` subgroepen per hoofdstuk; `quoteLineForms` subgroep en "toon toch" per post; `textBlocks` de tekstblokken met versie; `quoteSentExtras` bruto, korting en de tekstblokken zoals verstuurd); de index van de subgroepen wordt herrekend; de browserback-up (Beheer) leest sindsdien ook de collecties van 2.6–2.11 en de tellers als allerlaatste |
| `vertrouwelijk.json` | `exportConfidential()` | klantcontacten (organisaties en personen), contractparameters met hun historiek, de **opslag-URL's van vertrouwelijke bestanden**; **sinds 2.2** de aankoopprijzen per OA (ook de gearchiveerde) en de verkoopregels van de posten met hun versies (enkel voor wie ook de prijzen mag zien: `#readCosts`); **sinds 2.4** de prijs per offertelijn (aankoopprijs, OA, verkoopregel, reden) en de standaardmarge per versie (`quotePrices`, `quoteVersionConf`; ook `#readCosts`); **sinds 2.10** per vorderingsstaat de indexwaarden van de prijsherziening en de reden om waarschuwingen door te zetten (`progressConf`), de **vastgelegde inhoud van elke verzonden staat** met alle bedragen (`progressFrozen`: daarop rust de hash; na een herstel geeft `readProgressStatement` weer "intact") en het rekenmodel van de prijsherziening per werf (`progressRevisions`); **sinds 2.11** de bedragen en regels van elke OA-factuur (`oaInvoiceAmounts`); **sinds 2c.1** de margeklassen, hun standaardklasse per bibliotheekhoofdstuk of firma en per versie de marges, het regietarief en de korting (`marginClasses`, `marginClassLinks`, `quoteVersionTerms`); ook `#readCosts` |
| `audit.json` | `auditLog(from, 500)` in stukken | alle auditregels, chronologisch |

De bestanden bevatten persoonsgegevens en opslag-URL's die **openbaar zijn voor wie ze kent** (meetverslag 0.2c). Behandel ze als vertrouwelijk: op een versleutelde schijf of in de kluis van de eigenaar, nooit in git, e-mail of chat (`docs/privacy.md` §4).

De **bestanden zelf** (foto's, plannen, contracten) staan in de opslag van Caffeine onder het project en zitten **niet** in de back-up; de back-up bevat hun verwijzingen (`!caf!sha256:…`). Zie §5 voor wat dat betekent bij een herstel op een ander project.

## 2. Wanneer

- **Na elke fase** (M9) en vóór elke livegang of grote migratie: een volledige export + een proefherstel op een lege lokale canister (§3).
- **Maandelijks** op live (door de eigenaar, met zijn eigen II-login via *Auditlog → Back-up intern / vertrouwelijk / auditlog*, of met het script als testbeheerder op een draft). **Sinds 2.2** haalt de knop in de app alles in stukken op (`exportChunk`, zoals het script: geen grens van ± 60–80 werven meer) en schrijft hij **dezelfde bestanden** (`intern-….json`, `vertrouwelijk-….json`, `audit-….json`, zelfde JSON-vorm): hernoem ze naar `intern.json`, `vertrouwelijk.json` en `audit.json` in één map, dan leest `tests/herstel.mjs herstel` ze rechtstreeks (V-02 van de review 0.7/1.9).
- Vóór een echte import (OA's, planning) en vóór het terugdraaien van een importbatch.

## 3. Proefherstel op een lege lokale canister (de hersteltest)

Alles op het **eigen** testnet (nooit het gedeelde `:8000`, nooit een draft); het herstel vraagt een canister die **nog nooit geclaimd** is en geen gegevens heeft.

```bash
cd ~/Desktop/Split/bowaco-app
# 1. Export van de bron (een draft) als testbeheerder, buiten git
node tests/herstel.mjs export 45zqo-tiaaa-aaaam-qefla-cai ~/.bowaco/herstel/$(date +%Y%m%d)

# 2. Een lege lokale canister met het programma van dezelfde (of een nieuwere) versie, gebouwd met de TEST-opstartcode
#    (tests/lokaal.sh doet dat; daarna de canister leegmaken)
BOWACO_PORT=8044 BOWACO_NET=~/.bowaco/net-19 zsh tests/lokaal.sh         # bouwt en test; laat het net draaien
( cd ~/.bowaco/net-19 && WASM=$PWD/../../Desktop/Split/bowaco-app/src/backend/dist/backend.wasm icp deploy backend --mode reinstall -y )
cid=$(python3 -c "import json;print(json.load(open('$HOME/.bowaco/net-19/.icp/cache/mappings/local.ids.json'))['backend'])")

# 3. Herstel (opstartcode = de TEST-code uit ~/.bowaco/test-opstartcode.txt) en vergelijking
ICP_HOST=http://localhost:8044 node tests/herstel.mjs herstel  $cid ~/.bowaco/herstel/$(date +%Y%m%d)
ICP_HOST=http://localhost:8044 node tests/herstel.mjs vergelijk ~/.bowaco/herstel/$(date +%Y%m%d) $cid
```

`vergelijk` exporteert de herstelde canister opnieuw en toont per collectie een hash van de gesorteerde inhoud: alles moet **gelijk** zijn, behalve wat bewust anders is (§4). De uitslag van 24-10 staat in BOWACO_securityreview_0.7_1.9.md §4.

## 4. Hoe het herstel werkt (en wat bewust anders terugkomt)

`RestoreApi.mo` heeft drie functies die enkel werken op een **lege** canister (de opstartcode nog nooit geclaimd; geen personen, logins, organisaties, werven, bestanden, taken, verslagen of robots, en sinds fase 1b/2 ook geen vergunningen, gemeenten, mailopdrachten, logboek, werfadministratie, bibliotheek, offertes, werfstarts, opmetingen, vorderingsstaten of OA-facturen) en enkel met de **opstartcode**:

1. `restoreBegin(code)` — controleert leegte en code, en onthoudt welke login herstelt;
2. `restoreChunk(code, deel)` — één collectie per oproep, in stukken (≤ 2 MB per bericht); hetzelfde stuk nog eens sturen overschrijft dezelfde ids (herhaalbaar);
3. `restoreFinish(code)` — herrekent de afgeleide indexen (verslagen per dag, blokken per verslag, bestanden van een verslag, volgorde van de offline-opdrachten; sinds fase 2 ook de importsleutels en prijzen per post van de bibliotheek, de offertenummers en de lijsten per werf/offerte/versie, de opmetingen per werf, regels per opmeting, foto-eigenaars en opId-volgorde, de staten per werf en de sleutels en lijsten van de OA-facturen) en zet de **tellers nooit lager dan het hoogste herstelde id** (sinds 2.12 ook de volgnummers per werf van de verzonden vorderingsstaten en creditnota's, en de voorwaardenversies); daarna is herstel definitief dicht. Een verzonden offerteversie of vorderingsstaat komt letterlijk terug (inhoud én hash); het herstel rekent de hash niet na — wie de back-up kan wijzigen, kan dus ook een andere inhoud onder dezelfde hash terugzetten. Daarom: de back-up in de kluis (§1) en na een herstel "intact" nakijken bij een verzonden versie of staat (§6).

Op een canister die **niet** leeg is, antwoordt elke stap "Geen toegang" zonder naar de code te kijken: de opstartcode kan via het herstel niet geraden worden. Een foute code telt mee in de pogingenlimiet en de globale remming. Anoniem en robots worden geweigerd.

Bewust anders na een herstel:

| Wat | Waarom | Wat te doen |
|---|---|---|
| **Open uitnodigings- en herstelcodes** komen als *vervallen* terug | de export bevat enkel de hint, nooit de hash | nieuwe codes maken |
| **De opstartcode is opnieuw claimbaar** (`bootstrapUsed = false`) | op een ander adres (live na draft, een nieuw project) hebben alle personen een andere principal; de eigenaar claimt dan één keer opnieuw en maakt herstelcodes | op hetzelfde adres: gewoon inloggen (de logins zijn mee hersteld); daarna eventueel een nieuwe opstartcode (nieuwe hash in `Config.mo`) |
| Tickets (10 min) en de pogingentellers | tijdelijk | – |
| Versleutelde velden (`#sealed`) | bestaan niet: de eigenaar besliste op 24-10 geen versleuteling (2.1 vervalt); alles is `#plain` | – |
| `inviteId` van een login, `revokedBy` van een robot, `endedBy` van een lidmaatschap van vóór 1.9, `createdAt` van een voertuig | niet in de export | – (historiek in de auditlog) |
| Twee auditregels erbij: `herstel-begonnen`, `herstel-klaar` | het herstel zelf is een handeling | – |

## 5. Herstel op een ANDER Caffeine-project (nieuwe lege canister op live)

Dezelfde stappen als §3, met de **echte** opstartcode (`BOWACO_CODE=… node tests/herstel.mjs herstel …`, enkel in de Terminal van de eigenaar) en de backend-canister van het nieuwe project. Twee verschillen:

1. **Principals.** Iedereen krijgt op een nieuw adres een nieuwe principal: de eigenaar claimt de opstartcode opnieuw, maakt voor elke persoon een herstelcode en trekt de oude logins in (Team).
2. **Bestanden.** De verwijzingen wijzen naar de opslag van het **oude** project (`owner_id` = de oude canister, meetverslag 0.2c). Op het nieuwe project moeten de bestanden opnieuw opgeladen worden: per verwijzing het bestand ophalen via de oude URL en opladen via de opslagpoort van het nieuwe project, en de nieuwe verwijzing bewaren. Dat script (`tools/herstel-bestanden.mjs`) bestaat nog niet; het is een open punt van 1.9 (zie de review §6). Zolang het oude project bestaat, blijven de oude URL's werken.

Nooit herstellen op project `01a16859…` (de draft die in gebruik is), en nooit een project wissen.

## 6. Controlelijst na een herstel

- [ ] `vergelijk` toont alle collecties gelijk (behalve §4).
- [ ] Inloggen als beheerder lukt; *Team*, *Werven*, *Onderaannemers*, *Weekbord*, *Vandaag* en een werfverslag openen.
- [ ] Een nieuwe werf maken krijgt een **nieuw id** (de tellers staan goed) en een nieuwe code.
- [ ] Een foto in een hersteld verslag opent (zelfde project) of is opnieuw opgeladen (ander project).
- [ ] De auditlog eindigt met `herstel-klaar`.
- [ ] Een verzonden offerteversie en een verzonden vorderingsstaat openen: beide zeggen **intact** (de hash van de teruggezette inhoud klopt nog); een nieuwe vorderingsstaat op die werf krijgt het volgende nummer (2.12).
- [ ] Open codes van vóór het herstel opnieuw maken; de export van ná het herstel bewaren.

## 7. Kort, voor de eigenaar: wat je na een herstel moet weten (V-09)

1. **Open codes zijn weg.** Elke uitnodigings- of herstelcode die nog open stond, komt terug als *vervallen* (de app bewaart enkel de hash, en die zit niet in de back-up). Maak in *Codes* nieuwe codes voor wie nog moest koppelen.
2. **De opstartcode werkt opnieuw**, één keer. Dat is bewust: op een ander adres (een nieuw project, live na een draft) heeft iedereen een andere login en moet jij eerst opnieuw beheerder worden. Op hetzelfde adres hoef je ze niet te gebruiken (je login is mee hersteld): maak dan zo snel mogelijk een **nieuwe opstartcode** (`node tools/opstartcode.mjs` in je eigen Terminal, nieuwe hash in `Config.mo`, nieuwe draft), zodat wie de oude code kent ze niet kan gebruiken.
3. **Bestanden op een ander project**: de foto's en documenten blijven op het oude project staan; zie §5.
4. Bewaar meteen een **nieuwe back-up** van na het herstel, en kijk de controlelijst van §6 na.

## 8. Na een draftwissel (de draft verliep: nieuwe, lege canister)

*Stap 2.4, 25-10-2026.* Een draft kan zonder aankondiging verlopen (w5pbr verliep binnen ± 2,5 dag; Caffeine publiceert geen levensduur, zie bouwplan M11). Caffeine zet de volgende draft dan op een **nieuwe, lege canister** (nu `5vwqk-vqaaa-aaaab-aadwq-cai`) met hetzelfde project en adres. Alles staat in git en in de proefscripts; niets bestaat enkel op de draft. Zo bouw je de draft opnieuw op:

1. **Code**: de nieuwe canister-id in `Config.draftBackends` (de testmodus voor mail staat er dan hard aan), `tests/review.mjs` (D1), `tools/browser-sessie.mjs`, dit draaiboek en `gateway/deploy/postbode.env.voorbeeld`; `Config.mailLiveBackends` blijft leeg. Daarna een draft pushen (`tools/push.sh`).
2. **Eigenaar** (enkel hij heeft de opstartcode): draft openen → inloggen met zijn eigen II → *Opstartcode*; dan *Team → Persoon uitnodigen* → "Testbeheerder", rol Beheerder → code kopiëren → in zijn eigen Terminal `node tools/proef-admin-koppelen.mjs <canister>` (vraagt de code onzichtbaar) → de wachtende koppeling bevestigen.
3. **Claude**: `node tools/draft-opbouw.mjs <canister>`: de rollentest in de modus `GECLAIMD` (proefpersonen, proefwerven P-A/P-B, proeffirma's; **geen claim, geen mail**, geen proef op "de laatste beheerder"), daarna alle draftproeven en de review; logs in `~/.bowaco/opbouw-<canister>/`. Dan alleen de lektest (`node tests/lek.mjs <canister>`, ± 30 min).
4. Generale repetitie op het eigen net: `ICP_HOST=http://localhost:<poort> ZONDER_KLOK=1 node tools/draft-opbouw.mjs --proef <canister>` (een eigen sleutel "proef-eigenaar" claimt met de TEST-opstartcode en koppelt de testbeheerder zoals de eigenaar). *2.10:* zonder `ZONDER_KLOK=1` verzetten de review en de mailproef de klok van het net, waarna `icp deploy` weigert (ingress expiry); upgraden kan dan nog met `ICP_HOST=… node tools/upgrade-lokaal.mjs <canister>` (de agent synchroniseert de tijd, upload in stukken, geheugen behouden).

Op de draft staan daarna enkel testgegevens ("Proef …"); de 13 echte firma's van E-0, de echte planning en de echte offerte staan er niet meer op (de oude canister is weg).
