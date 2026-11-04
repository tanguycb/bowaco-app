# Inrichting met de gegevens van BOWACO (stap 2b.6)

De echte documenten van BOWACO staan in `bowaco-docs/bowaco` (nooit in git). De inrichting leest ze en zet ze in de app in
zeven stappen (BOWACO_analyse_documenten.md §4). Alles is herhaalbaar: een tweede run vindt terug wat er al staat en maakt
niets dubbel.

| Stap | Wat | Lezer (Python, enkel lezen) | In de app via |
|---|---|---|---|
| 1 | bedrijf en tellers: afzender, betaaltermijn, algemene voorwaarden (versie, "nog na te kijken"), laatste offertenummer, eenheden, hoofdstukken, standaardmarge | `tools/inrichting/lees-bedrijf.py` | `setQuoteDocSettings`, `addQuoteTerms`, `setQuoteSequence`, `setLibraryUnit`, `saveLibraryChapter`, `setLibraryMargin` |
| 2 | firma's: onderaannemers, leveranciers, overheid en nutsbedrijven (op KBO en naam/code) | `tools/inrichting/lees-firmas.py` | `importOrgs` (1.2) |
| 3 | werven uit de werfmappen + de planning (vervolg in de werf van de map) | `tools/inrichting/lees-werven.py`, `tools/plan-analyse.py` | `createWork`, `setWorkReviewNote`, `importPlanning` (1.5), `setWorkStatus` |
| 4 | postenbibliotheek uit de oude Excelofferten (vier sjabloonfamilies), aankoopprijzen met datum, marge per post | `tools/inrichting/offerte-lezer.py` | `saveLibraryItem`, `addLibraryCost`, `setLibrarySell` |
| 5 | prijslijsten van OA's (Word) als aankoopprijzen met datum | `tools/inrichting/lees-prijslijsten.py` | `saveLibraryItem`, `addLibraryCost` |
| 6 | vergunningen: nieuwe soorten, gemeenten en procedures met doorlooptijd | `tools/inrichting/lees-vergunningen.py` | `setPermitKind`, `saveMunicipality`, `saveProcedure` |
| 7 | documenten van de actieve werven: **enkel de selectie** (geen upload) | `tools/inrichting/lees-documenten.py` | — |
| 8 | **één werf volledig** (2c.9, enkel met `--werf`): werf, firma's, offerte als ontwerp, ALLE documenten | `tools/inrichting/lees-werf.py` | `setDocKind`, `setLibraryUnit`, `importOrgs`, `createOrg`, `createWork`, `createQuote`, `saveQuoteDraft`, `saveQuoteForm`, `saveDocument`, `addFile`, `attachDocumentFile` |

## Draaien

```
zsh tools/inrichting/lees-alles.sh                         # kopieert de bronnen uit iCloud, schrijft de plannen in ~/.bowaco/inrichting/plan
ICP_HOST=http://localhost:<poort> node tools/inrichting.mjs --canister <id>                 # droogloop: toont wat er zou gebeuren
ICP_HOST=http://localhost:<poort> node tools/inrichting.mjs --canister <id> --echt          # bewaren
ICP_HOST=http://localhost:<poort> node tools/inrichting.mjs --canister <id> --echt          # nog eens: alles "overgeslagen"
ICP_HOST=http://localhost:<poort> node tools/inrichting/steekproef.mjs --canister <id>      # willekeurige rijen terugzoeken
ICP_HOST=http://localhost:<poort> node tools/inrichting/lekcontrole.mjs <id>               # een onbekende login krijgt niets terug
```

- `--stap 1,2` beperkt tot enkele stappen; de volgorde 1 → 7 telt (eenheden en hoofdstukken vóór de posten, firma's vóór de planning).
- Elke run schrijft een verslag (`~/.bowaco/inrichting/verslag/run-<tijd>.md` en `.csv`): per rij aangemaakt, bijgewerkt,
  overgeslagen, conflict of fout, met de reden. Het bevat echte namen: niet in git.
- Een droogloop telt mee wat een vorige stap zou aanmaken. Hij kent wel niet wat een vorig stuk van 40 firma's zou
  aanmaken: een conflict tussen twee stukken verschijnt pas in de echte run.

## De grens

- Een plan is echt tenzij het uitdrukkelijk `"bron": "test"` draagt (dat label geeft `lees-alles.sh` enkel aan een map met
  het merkbestand `VERZONNEN-PROEFMAP` van `tests/inrichting-fixtures.py`). Een echt plan gaat **enkel naar een lokaal net** (`ICP_HOST=http://localhost:…`), ook
  als droogloop: een droogloop stuurt de gegevens immers ook naar de canister. Een draft of live krijgt ze pas na het
  uitdrukkelijke "ja" van de eigenaar (bouwplan PB-01); dan `JA_EIGENAAR=1`.
- Stap 7 laadt nooit iets op: de opslag van bestanden ligt buiten het lokale net. Na de beslissing van de eigenaar
  (welke soorten, welke werven) gebeurt het met de uploadfunctie van de app per werf.
- Nooit in de app: wachtwoorden, personeelszaken, lonen, rijksregisternummers, identiteitskaarten, medische gegevens,
  rekeningnummers van personen, de boekhouding. De lezers openen die mappen niet.

## Op live (na het "ja" van de eigenaar, D44–D45)

Nooit een test op live: de rollentest, lektest, review, woordentest en `tests/lokaal.sh` maken testwerven en testpersonen
aan. `tools/lib.mjs` weigert daarom elke canister uit `tools/live-canisters.json` voor elke testsleutel, anoniem en elke
wegwerpidentiteit (`tests/live-grens.mjs`); enkel de inrichtingsidentiteit (`~/.bowaco/inrichting-live.json`, niet de
testsleutel) en de alleen-lezen lekcontrole mogen er.

1. Een nieuwe draft met deze code; daar (met de testbeheerder, na de claim van de eigenaar) de volledige draftproeven en de
   review. De draft verloopt 8 uur na de upload: review en publicatie naar live in dat blok.
2. De eigenaar zet live in Caffeine en claimt live met zijn eigen opstartcode (de code komt nooit in een sessie).
3. Het live-id in `tools/live-canisters.json` (commit) **vóór** iets anders. Niet in `Config.mailLiveBackends`: zolang die
   lijst leeg is, blijft de mail op live in de testmodus (geen mail naar de echte firma's). Echte mail = een apart "ja".
4. De eigenaar: Team → Persoon uitnodigen → Beheerder "Inrichting" → `node tools/inrichting/koppelen.mjs <live-id>` in zijn
   eigen Terminal → de koppeling bevestigen.
5. `zsh tools/inrichting/lees-alles.sh`, dan `JA_EIGENAAR=1 node tools/inrichting.mjs --canister <live-id> --stap <de bevestigde
   stappen> --gelijktijdig 3` (droogloop), met `--echt`, nog eens met `--echt` (niets nieuw), `steekproef.mjs`,
   `lekcontrole.mjs`. Beide kiezen op live vanzelf de inrichtingsidentiteit.
6. **Laatste stap, de eigenaar:** Team → Logins → de toegang van "Inrichting" intrekken.

## Eén werf voor de demo (2c.9)

Stap 8 zet ÉÉN werf volledig in de app, zodat de zaakvoerder ze in de demo van offerte tot oplevering kan naspelen.

**Wat de lezer doet** (`tools/inrichting/lees-werf.py`, enkel lezen in de documentenmap; kopieën in
`~/.bowaco/inrichting/werf/<code>/`, plan `stap8-werf-<code>.json`):

- de werf uit de werf-index (code, adres uit de mapnaam, btw 6 % voorlopig, status **aanvraag**);
- de firma's die in de documenten van de werf voorkomen: de aankoopfacturen van de werf, de firma's van de firma-index
  waarvan de naam in een pad staat, en een map `Offerte OA/<vak>/<firma>` (onderaannemer). Geen personen. De klant heeft
  geen naam in de indexen (privacy): een plaatshouder "Opdrachtgever <code>" met het werfadres, nog na te kijken;
- de offerte(s) van de werf (de laatste Excel, geen variant zoals "raming") met de offerte-lezer van stap 4: hoofdstukken,
  subgroepen, lijnen, aankoopprijs en marge (`X/0,8`), vaste prijzen. In de app als **ontwerp (versie 1)**: prijsvraag,
  OA-offertes, overnemen, versturen en aanvaarden gebeuren in de demo zelf;
- **alle** rijen van de documenten-index met die werf: de werfmap, de dubbels en oudere versies in "99" (een eigen document
  "(dubbel of oudere versie)"), en de facturen en offertes die de index aan de werf koppelt;
- documentsoort per categorie: foto → `fotos` (nieuw), plan → `plannen`, min-meer → `min-meer`, offerte OA → `oa-offerte`
  (vertrouwelijk), factuur aan de klant → `factuur-klant` (nieuw, vertrouwelijk), aankoopfactuur → `oa-factuur`
  (vertrouwelijk), oplevering → `pv-voorlopige-oplevering`, een map "postinterventiedossier" → `pid`, de rest → `andere`.
  Een document per (soort, map), hoogstens 50 bestanden (daarboven "(deel 2)");
- foto's (HEIC, JPEG, PNG) zoals de app ze oplaadt: JPEG ≤ 1600 px, 82 %, **zonder EXIF** (geen GPS);
- **geweerd** (nooit in de app, apart geteld in het verslag): gevoelig volgens de index, een pad dat op personeelszaken,
  lonen, rijksregister-, identiteits- of medische gegevens wijst, of een Word/Excel/Outlook met een rijksregisternummer;
- niet opgeladen (met de reden): groter dan 25 MB (`Config.maxFileBytes`) of een soort die de app niet kent.
  `addFile` aanvaardt sinds 2c.9 ook Excel, Word, PowerPoint, Outlook (.msg) en DWG (`Config.allowedWorkFileMime`).

**Herhaalbaar:** werf op code, firma's op KBO/naam, klant op naam, offerte op nummer, document op (soort, titel), bestand op
(document, naam, grootte) en, waar zichtbaar, op de hash van de opslag. Een tweede run maakt niets.

**Lokaal** (geen opslagdienst): de droogloop schrijft het manifest (per bestand soort, grootte, sha256, hash van de opslag,
doel in de app) naast het verslag (`…-manifest.csv`). De echte run doet alles behalve de blob: elk bestand wordt
geregistreerd met exact de verwijzing die live krijgt (de hash van de opslag wordt zonder upload berekend, zoals
`StorageClient.putFile`); openen kan lokaal niet.

```
python3 -I tools/inrichting/lees-werf.py --docs ~/Desktop/Split/bowaco-docs/bowaco --werf W-091
ICP_HOST=http://localhost:<poort> node tools/inrichting.mjs --canister <id> --werf W-091              # droogloop + manifest
ICP_HOST=http://localhost:<poort> node tools/inrichting.mjs --canister <id> --werf W-091 --echt       # bewaren (zonder blob)
ICP_HOST=http://localhost:<poort> node tools/inrichting.mjs --canister <id> --werf W-091 --echt       # nog eens: niets nieuw
ICP_HOST=http://localhost:<poort> node tools/inrichting/steekproef.mjs --canister <id> --werf W-091
ICP_HOST=http://localhost:<poort> node tools/inrichting/lekcontrole.mjs <id>
```

**Op live** (na het ja van de eigenaar; live-id in `tools/live-canisters.json`; de eigenaar koppelde "Inrichting" met
`tools/inrichting/koppelen.mjs`; het project-id staat als `project_id` in `https://<live-adres>/env.json`):

```
python3 -I tools/inrichting/lees-werf.py --docs ~/Desktop/Split/bowaco-docs/bowaco --werf W-091
JA_EIGENAAR=1 node tools/inrichting.mjs --canister <live-id> --werf W-091 --project <project-id>                 # droogloop
JA_EIGENAAR=1 node tools/inrichting.mjs --canister <live-id> --werf W-091 --project <project-id> --echt          # opladen
JA_EIGENAAR=1 node tools/inrichting.mjs --canister <live-id> --werf W-091 --project <project-id> --echt          # niets nieuw
JA_EIGENAAR=1 node tools/inrichting/steekproef.mjs --canister <live-id> --werf W-091
node tools/inrichting/lekcontrole.mjs <live-id>
```

- Op live kiezen beide vanzelf de inrichtingsidentiteit; enkel zij mag opladen (`storageClientInrichting`). Een draft
  krijgt nooit een echt bestand (de stap weigert het).
- Hoogstens 3 uploads tegelijk (`--uploads 2` kan). Een logboek per canister
  (`~/.bowaco/inrichting/werf/<code>/upload-<canister>.json`) onthoudt wat al in de opslag staat: na een fout of een
  onderbreking gewoon dezelfde opdracht opnieuw; hij laadt niet opnieuw op en registreert enkel wat ontbreekt.
- Daarna, de eigenaar: Team → Logins → de toegang van "Inrichting" intrekken. De testlogins (OA en klant) koppelt hij zelf
  via "Toegang geven".

## "Nog na te kijken"

Elke voorlopige keuze staat in de app: bij een werf als label met de reden (`setWorkReviewNote`; de beheerder wist het met
"Nagekeken"), bij een firma in de notitie, bij een post in de reden van de verkoopregel of in de notitie van de prijs,
bij de voorwaarden als voorlopige versie, bij een hoofdstuk en een vergunningsprocedure in de notitie.

## Test

`tests/inrichting.mjs` draait alles op een **verzonnen** documentenmap (`tests/inrichting-fixtures.py`): lezers, grens,
droogloop, echt, nog eens, en de controles in de app; sinds 2c.9 ook stap 8 op een verzonnen werfmap (W-903: foto's met
EXIF, dubbels, te groot, onbekende soort, geweerde bestanden, 52 foto's in één map, Outlook, PID, factuur, offerte),
met steekproef en lekcontrole. Het hoort bij `tests/lokaal.sh`, net als `tests/live-grens.mjs` (de
weigering van live in het gereedschap, zonder netwerk).
