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

## "Nog na te kijken"

Elke voorlopige keuze staat in de app: bij een werf als label met de reden (`setWorkReviewNote`; de beheerder wist het met
"Nagekeken"), bij een firma in de notitie, bij een post in de reden van de verkoopregel of in de notitie van de prijs,
bij de voorwaarden als voorlopige versie, bij een hoofdstuk en een vergunningsprocedure in de notitie.

## Test

`tests/inrichting.mjs` draait alles op een **verzonnen** documentenmap (`tests/inrichting-fixtures.py`): lezers, grens,
droogloop, echt, nog eens, en de controles in de app. Het hoort bij `tests/lokaal.sh`.
