#!/bin/zsh
# Stap 2b.6: alle lezers na elkaar. Kopieert de bronnen uit de documentenmap (iCloud) naar ~/.bowaco/inrichting/bron en
# schrijft de plannen in ~/.bowaco/inrichting/plan (beide buiten git: echte namen, prijzen en adressen). Leest enkel.
#   zsh tools/inrichting/lees-alles.sh [DOCS]      (standaard ~/Desktop/Split/bowaco-docs/bowaco)
# Daarna: ICP_HOST=http://localhost:<poort> node tools/inrichting.mjs --canister <id> [--echt]
set -e
here=$(cd "$(dirname "$0")" && pwd)
docs=${1:-$HOME/Desktop/Split/bowaco-docs/bowaco}
werk=${BOWACO_INRICHTING:-$HOME/.bowaco/inrichting}
plan=$werk/plan
py=(python3 -I)
# "test" enkel voor de verzonnen documentenmap van tests/inrichting-fixtures.py (die schrijft het merkbestand); een
# vergeten BOWACO_BRON=test op de echte map maakt de plannen dus nooit "test" (de grens blijft werken).
bron=(--bron echt)
if [[ "$BOWACO_BRON" == "test" ]]; then
  [[ -f "$docs/VERZONNEN-PROEFMAP" ]] || { echo "BOWACO_BRON=test enkel voor een verzonnen proefmap (merkbestand VERZONNEN-PROEFMAP ontbreekt)"; exit 2; }
  bron=(--bron test)
fi
mkdir -p -m 700 "$plan/planning"
$py[@] "$here/kopieer-bronnen.py" --docs "$docs"
if [[ -f "$werk/bron/planning/planning.xlsx" ]]; then
  echo "── stap 3 (planning, ongewijzigd sinds 1.5)"
  $py[@] "$here/../plan-analyse.py" "$werk/bron/planning/planning.xlsx" --uit "$plan/planning" --batch inrichting-2b6-planning | tail -2
fi
echo "── stap 4 (offerte-lezer)"
$py[@] "$here/offerte-lezer.py" $bron[@] --index "$docs/BOWACO_index_offertes.csv" --bestanden "$werk/bron/offertes"
echo "── stap 1 (bedrijf en tellers)"
$py[@] "$here/lees-bedrijf.py" $bron[@] --sjabloon "$werk/bron/bedrijf/sjabloon.xlsx" --voorwaarden "$werk/bron/bedrijf/voorwaarden.docx" \
  --offertes "$docs/BOWACO_index_offertes.csv" --verkoop "$docs/BOWACO_index_verkoop.csv" --posten "$plan/stap4-posten.json"
echo "── stap 2 (firma's)"
$py[@] "$here/lees-firmas.py" $bron[@] --validatie "$docs/BOWACO_validatie_onderaannemers_1.2.csv" --firmas "$docs/BOWACO_index_firmas.csv"
echo "── stap 3 (werven)"
$py[@] "$here/lees-werven.py" $bron[@] --werven "$docs/BOWACO_index_werven.csv" --planning "$docs/BOWACO_index_planning.csv" --planplan planning/plan.json
echo "── stap 5 (prijslijsten)"
$py[@] "$here/lees-prijslijsten.py" $bron[@] --documenten "$docs/BOWACO_index_documenten.csv" --bestanden "$werk/bron/prijzen"
echo "── stap 6 (vergunningen)"
$py[@] "$here/lees-vergunningen.py" $bron[@] --kennis "$docs/BOWACO_kennisbank_vergunningen_2b6.json" --documenten "$docs/BOWACO_index_documenten.csv" --werven "$docs/BOWACO_index_werven.csv"
echo "── stap 7 (documenten van de actieve werven: enkel de selectie)"
$py[@] "$here/lees-documenten.py" $bron[@] --documenten "$docs/BOWACO_index_documenten.csv" --werven "$plan/stap3-werven.json"
