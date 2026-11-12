#!/bin/zsh
# Alles lokaal op het EIGEN testnet (tests/net, poort 8041; raakt het gedeelde :8000 nooit):
# bouwen → lege canister (reinstall) + nep-maildienst → rollentest → lektestrobot → review → posten → offertes → rekentests → offerte 2c.1 → werfstart → opmeting → vorderingsstaten → OA-facturen → mailproef → OA-offertes 2c.3 → afspraken 2c.4 → aankoop 2c.7 → min-meer 2c.5 → werfadmin 2c.8 → facturen 2c.6 (jaarwissel) → prijsvraag 2c.2 (verzet de klok: als laatste) → gateway.
#   zsh tests/lokaal.sh            (start het net als het nog niet draait)
set -e
repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo"
# Lokale testbouw met de hash van de TEST-opstartcode (de echte code kent enkel de eigenaar). Config.mo
# wordt na de bouw altijd teruggezet; de upload (tools/push.sh) bouwt uit een schone kopie van git.
cfg=src/backend/lib/Config.mo
testhash=$(node -e 'const c=require("fs").readFileSync(process.env.HOME+"/.bowaco/test-opstartcode.txt","utf8").trim().toUpperCase().replace(/[\s-]/g,"");const b=c.length===19&&c.startsWith("BOW")?c.slice(3):c;console.log(require("crypto").createHash("sha256").update("bowaco-code-v1|"+b).digest("hex"))')
# 3.12 (review L): een afgebroken vorige ronde (Ctrl-C, kill) liet Config.mo met de testvlaggen staan en een losse .echt ernaast; de
# volgende ronde nam dan de vuile versie als "echt". Daarom: een bestaande .echt eerst terugzetten, en de trap ook op INT/TERM/HUP
# (zsh draait de EXIT-trap niet bij een signaal).
[[ -f "$cfg.echt" ]] && mv "$cfg.echt" "$cfg"
if grep -qE "public let (mailLiveAnyCanister|aiLiveAnyCanister|measureAnyCanister) : Bool = true" "$cfg"; then echo "Config.mo draagt een testvlag (true): zet ze eerst terug (git checkout $cfg)"; exit 1; fi
cp "$cfg" "$cfg.echt"
trap 'mv "$repo/$cfg.echt" "$repo/$cfg" 2>/dev/null || true' EXIT
trap 'mv "$repo/$cfg.echt" "$repo/$cfg" 2>/dev/null || true; exit 130' INT TERM HUP
sed -i '' -E "s/(public let bootstrapHashHex = \")[0-9a-f]{64}/\1$testhash/" "$cfg"
# 1b.5: in de testbouw telt elke canister als live (pad "testmodus uit → echte adressen" in de rollentest); de upload
# houdt false (tools/meetlat.mjs weigert anders): echte mail enkel vanaf Config.mailLiveBackends.
sed -i '' -E "s/(public let mailLiveAnyCanister : Bool = )false/\1true/" "$cfg"
# 3.1: idem voor de AI-connector: in de testbouw belt elke canister de inferentiedienst "echt" (hier de nep-inferentiedienst op
# 127.0.0.1, tests/net/nepinferentie.mjs). De upload houdt false (tools/meetlat.mjs weigert anders): drafts bellen nooit echt.
sed -i '' -E "s/(public let aiLiveAnyCanister : Bool = )false/\1true/" "$cfg"
# 2d.1: de meetfunctie meetKlok enkel in de testbouw (tools/meetlat.mjs weigert een upload met true).
sed -i '' -E "s/(public let measureAnyCanister : Bool = )false/\1true/" "$cfg"
# 4b.1: de reeks maakt intussen meer dan 20 bots (elke proef haar eigen); in de testbouw mag het er 80 zijn. De upload houdt 20.
sed -i '' -E "s/(public let maxBots : Nat = )20;/\180;/" "$cfg"
mops build --output src/backend/dist
mv "$cfg.echt" "$cfg"
# mail-caffeine: de nep-maildienst (speelt de integratiecanister van Caffeine na; enkel op dit eigen net).
moc=$(mops toolchain bin moc)
"$moc" --package core .mops/core@2.6.2/src --default-persistent-actors -o "$HOME/.bowaco/nepmail.wasm" tests/net/nepmail.mo 2>/dev/null
./node_modules/.bin/caffeine-bindgen --did-file ./src/backend/dist/backend.did --out-dir ./src/frontend/src --actor-interface-file --force >/dev/null
# Het net draait in ~/.bowaco/net (buiten iCloud: de Desktop wordt gesynchroniseerd en iCloud maakt
# kopieën als "descriptor 2.json", waarna icp-cli zijn eigen net niet meer terugvindt).
# BOWACO_PORT en BOWACO_NET: een eigen net naast dat van een andere sessie (standaard poort 8041 in ~/.bowaco/net).
port=${BOWACO_PORT:-8041}
net=${BOWACO_NET:-$HOME/.bowaco/net}
mkdir -p "$net"
sed "s/port: 8041/port: $port/" tests/net/icp.yaml > "$net/icp.yaml"
export WASM="$repo/src/backend/dist/backend.wasm"
cd "$net"
# De rollentest verzet de klok van dit net; daarom elke ronde een vers net. Alleen het EIGEN net
# (dit project, poort 8041) wordt gestopt; nooit een ander proces.
icp network stop >/dev/null 2>&1 || true
icp network start local -d >/dev/null
icp deploy >/dev/null
cid=$(python3 -c "import json;print(json.load(open('.icp/cache/mappings/local.ids.json'))['backend'])")
# Zoals Caffeine: de backend vindt de maildienst via INTEGRATIONS_CANISTER_ID (hier de nep-maildienst).
export NEPMAIL=$(python3 -c "import json;print(json.load(open('.icp/cache/mappings/local.ids.json'))['nepmail'])")
icp canister settings update backend -e local --add-environment-variable "INTEGRATIONS_CANISTER_ID=$NEPMAIL" >/dev/null
# 1b.5 (review D9): de testbeheerder wordt controller van de backend op dit EIGEN net, zodat tests/review.mjs de
# maildienst even onbereikbaar kan maken (omgevingsvariabele via de beheercanister). Nooit op een draft of live.
admin_principal=$(cd "$repo/tools" && node --input-type=module -e "const m = await import('./lib.mjs'); console.log(m.identity('proef-admin').getPrincipal().toText())")
icp canister settings update backend -e local --add-controller "$admin_principal" >/dev/null
# 3.1: de nep-inferentiedienst (EIGEN proces op een eigen poort, enkel 127.0.0.1) en, zoals Caffeine, de URL en een wegwerpsleutel
# in de omgeving van de backend. De sleutel is per ronde nieuw en komt nergens anders terecht. Enkel dit eigen proces wordt gestopt.
export NEPINF_PORT=${NEPINF_PORT:-$((port + 10000))}
export NEPINF_KEY="nep-$(node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))')"
node "$repo/tests/net/nepinferentie.mjs" "$NEPINF_PORT" "$NEPINF_KEY" > "$net/nepinferentie.log" 2>&1 &
nepinf_pid=$!
trap 'mv "$repo/$cfg.echt" "$repo/$cfg" 2>/dev/null || true; kill $nepinf_pid 2>/dev/null || true' EXIT
trap 'mv "$repo/$cfg.echt" "$repo/$cfg" 2>/dev/null || true; kill $nepinf_pid 2>/dev/null || true; exit 130' INT TERM HUP
icp canister settings update backend -e local --add-environment-variable "CAFFEINE_INFERENCE_URL=http://127.0.0.1:$NEPINF_PORT" >/dev/null
icp canister settings update backend -e local --add-environment-variable "CAFFEINE_INFERENCE_API_KEY=$NEPINF_KEY" >/dev/null
cd "$repo"
echo "canister $cid"
export ICP_HOST=http://localhost:$port
# ALLEEN_OPZET=1: enkel bouwen en een lege canister installeren (voor een losse proef op dit eigen net), geen tests.
if [[ -n "$ALLEEN_OPZET" ]]; then echo "$cid" > "$net/canister.txt"; echo "$NEPINF_PORT $NEPINF_KEY" > "$net/nepinferentie.txt"; trap - EXIT; mv "$repo/$cfg.echt" "$repo/$cfg" 2>/dev/null || true; echo "nep-inferentie pid $nepinf_pid (zelf stoppen)"; exit 0; fi
node tests/rollen.mjs "$cid"
node tests/lek.mjs "$cid"
# 1.9: de aanvallen uit de securityreview (externen, bestanden, robot, grenzen, herstelpoort, opruiming van tellers).
node tests/review.mjs "$cid"
# 2.2: de draftproef van de postenbibliotheek (verzonnen proefposten), en de ENIGE echte offerte enkel hier op het eigen
# net (als tools/posten-analyse.py ze al las): proefronde, echt, nog eens (geen dubbels). Nooit naar een draft.
node tests/posten-draft.mjs "$cid"
posten=$HOME/.bowaco/posten/posten-2026-231.json
if [[ -f "$posten" ]]; then
  node tools/posten-import.mjs --plan "$posten" --canister "$cid"
  node tools/posten-import.mjs --plan "$posten" --canister "$cid" --echt
  node tools/posten-import.mjs --plan "$posten" --canister "$cid" --echt
fi
# 2.4: de draftproef van de offerte-editor (verzonnen proefofferte op P-A; gebruikt de proefpost van posten-draft).
node tests/offerte-draft.mjs "$cid"
# 2.5: de rekentests (rekenmodule zelf, de fouten van 2026/231 met verzonnen posten, browser = server op 200 willekeurige
# offertes). De ECHTE offerte enkel hier en enkel als ze er is: rapport buiten git (~/.bowaco/posten/rekentest-*.md).
node tests/rekentest.mjs "$cid"
# 2c.1: de offerte zoals Alexis ze maakt (klassen, regietarief, korting, subgroepen, tekstblokken, posten met 0, schadedossier,
# doorlopend nummer; browser = server op willekeurige offertes). Vóór tests/regels.mjs: die zet de standaardposten zelf.
node tests/offerte-2c1.mjs "$cid"
# 2.8: aanvaarde offerte → werf (voorstel, bevestigen, idempotent, meerwerk, afwijzen, nieuwe werf).
node tests/werfstart-draft.mjs "$cid"
# 2.9: opmeting ter plaatse (meten, deelopmeting, correctie met reden, tweede toestel, OA voorstel, afsluiten, rechten, geen prijzen).
node tests/opmeting-draft.mjs "$cid"
# 2.10: vorderingsstaten (cumulatief, contractparameters, versturen = vast, creditnota, klant, geen bedragen voor de werfleider),
# de rekentests (calc.ts met de hand nagerekend; browser = server op 200 willekeurige invullingen) en de PDF.
node tests/vordering-draft.mjs "$cid"
node tests/vordering-rekentest.mjs "$cid"
node tests/pdf-vordering.mjs
# 2.11: OA-facturen (registreren, controle per regel, inhoudingsplicht bij goedkeuring, betwisten, geen bedragen voor de werfleider).
node tests/oafactuur-draft.mjs "$cid"
# 2.12 (Y-08): ook de klantproef en de controleregels op het eigen net.
node tests/klant-draft.mjs "$cid"
node tests/regels.mjs "$cid"
# 2b.3: de faseregels (alle combinaties, tabbladen per rol, volgende stap) en één proefwerf door alle fases.
node tests/fase.mjs
node tests/fase-draft.mjs "$cid"
# 2b.4: Zo werkt het per persoon, Aan de slag (enkel beheerder), de bronnen van Vraagt aandacht en de bel.
node tests/start-draft.mjs "$cid"
echte=$(ls "$HOME"/Desktop/Split/bowaco-docs/bowaco/2026-231_Offerte_*.xlsx 2>/dev/null | head -1)
if [[ -n "$echte" ]]; then
  python3 -I tools/rekentest-echt.py "$echte"
  node tests/rekentest-echt.mjs "$HOME/.bowaco/posten/rekentest-2026-231.json"
fi
# 2b.6: de inrichting (lezers + import, droogloop, echt, nog eens) op een VERZONNEN documentenmap; nooit echte gegevens.
node tests/inrichting.mjs "$cid"
# 2b.6 live: de weigering van de echte omgeving in het gereedschap (zonder netwerk).
node tests/live-grens.mjs
node tests/demo-draft-grens.mjs
# mail-caffeine: de app verstuurt zelf (nep-maildienst); de gateway (fase 3) enkel nog eenheidstesten.
node tests/mail-proef.mjs "$cid"
# 3.1: de AI-connector op de caffeine-weg tegen de nep-inferentiedienst (rechten per rol, fiches, budget en reservering, uitkomstklassen,
# terugval naar de gateway, robot "ai", logboek zonder inhoud, testmodus, export en herstel van de fiches). Vóór de klokproeven.
node tests/ai-3-1.mjs "$cid"
# 3.4 + 3.13: bots via MCP (caffeineai-mcp-server: OAuth + Internet Identity, /mcp via http_request_update): enkel de beheerder, fiche,
# koppelcode, bot ≠ persoon, PKCE, tools/list per fiche, buiten de fiche = 0 lekken, Voorstel / Zelf doen / ongedaan maken, factuurcontrole
# hoogstens een voorstel, daglimiet, logboek zonder inhoud, intrekken per koppeling en per bot.
node tests/mcp-3-13.mjs "$cid"
# 3.5: de proefbank (testset uit de historiek, proefronde via de proeftools van de bot, nooit uitvoeren, het antwoord zegt nooit juist of
# fout, score per geval zonder inhoud, drempel 95 % op 50 met dezelfde labels, effectiveLevel, de Caffeine-weg droog en tegen de nep-dienst).
node tests/proef-3-5.mjs "$cid"
# 3.8: OA-offerte inlezen (opdracht voor een bot of Caffeine, inleesbestand als bijlage zonder URL, voorstel altijd eerst, overnemen in het
# formulier, Caffeine-weg op tekst, proefbank met offertes die mensen ingaven en bedragen verborgen, Zelf doen = de app registreert, ongedaan).
node tests/proef-3-8.mjs "$cid"
# 3.10: OA-factuurcontrole (opdracht voor een bot of Caffeine, controlebestand als bijlage zonder URL, dossier uit de controle van 2.11/2c.7,
# altijd een voorstel, nooit goedkeuren of betalen, resultaat enkel via readInvCheck, proefbank uit facturen waarover een mens besliste).
node tests/proef-3-10.mjs "$cid"
# 3.9: OA-offertes controleren + vergelijken (opdracht per prijsvraag voor een bot of Caffeine, dossier zonder verkoopprijzen, altijd
# een voorstel per post, één klik = kiezen + overnemen in een ontwerpversie, verouderd na een nieuwe offerte, proefbank uit prijsvragen).
node tests/proef-3-9.mjs "$cid"
# 3.11: offerte nalezen vóór verzending (enkel opmerkingen, niet blokkerend, versturen sluit de opdracht, proefbank met ingebouwde fouten).
node tests/proef-3-11.mjs "$cid"
# 3.12: de securityreview van AI, bots, MCP-server en koppelingen (groottegrenzen op de HTTP-ingang zonder en met token, batch en
# dagplafond, toegelaten toepassingen bij het koppelen, intrekken en hergebruik van codes en tokens, geen opzoektools tijdens een
# proefronde, een versmalde fiche helpt niet, vrije tekst zonder stuurtekens, de afbakening op de Caffeine-weg).
node tests/proef-3-12.mjs "$cid"
# 4.4: de maandagbriefing (enkel de beheerder, zonder bedragen, enkel lezen) en de bot-tool maandagbriefing (enkel de werven van de fiche).
node tests/briefing-4-4.mjs "$cid"
# 4b.1: Te doen (per rol de juiste regels, lek per regel, uitstellen, de knop bij een regel).
node tests/proef-4b-1.mjs "$cid"
# 4b.5: één model voor taak en voorstel (document koppelen en factuurcontrole door het model, elk dossier = één taak met dezelfde stand,
# Te doen = de voorstellen van het model, enkel de beheerder leest het model, geen bedragen en geen vrije tekst van een bot).
node tests/proef-4b-5.mjs "$cid"
# 4b.6: het voorstelscherm en wie deed wat (aanvaarden, aanpassen en ongedaan maken per soort met dezelfde backendacties, de tijdlijn per
# werf en per stuk, wat de calculator en de werfleider zien, externen niets, geen bedragen en geen vrije tekst van een assistent).
node tests/proef-4b-6.mjs "$cid"
# 4b.7: assistenten als collega (een taak geven aan een collega, de standen wacht · bezig · klaar · mislukt, de score van de proefbank bij de naam
# van de assistent, de rechten per rol).
node tests/proef-4b-7.mjs "$cid"
# 4b.8: de tools herschikt en uitgebreid (taken + voorstel, te_doen, planning, werf_stand, de assistent van de zaakvoerder, vrije taak aan
# een assistent, paginering, foutmeldingen met wat wel mag, geen bedragen in de leestools). Na 4b.7 (dezelfde gegevens).
node tests/proef-4b-8.mjs "$cid"
# 4b.2: de balk (zoekindex per rol met dezelfde code als de app: geen lek, geen bedragen, alleen wat het menu en de rechten geven; het zoeken).
node tests/proef-4b-2.mjs "$cid"
node tests/proef-4b-3.mjs "$cid"
# 4b.3b: het rekenblad (kolommen per rol, plakken uit Excel, ongedaan maken ook na een bewaring, bewaren terwijl je verder werkt,
# rekenblad = klassieke editor op de server, wat niet klaar is weigert de server ook, de vorige prijs en de prijsgrens per rol).
node tests/proef-4b-3b.mjs "$cid"
# 2c.2: de prijsvraag-Excel heen en terug (zonder netwerk) en de prijsvraag door de backend (klaarzetten, toegang zonder werf,
# Mijn prijsvragen, ontwerp, indienen, bijlagen, afsluiten, werfleider zonder bedragen, .did-controle). De klokproef (herinnering,
# geen antwoord, 90 dagen na afsluiten) verzet de tijd van dit eigen net met ruim 90 dagen: daarom als LAATSTE canisterproef.
node tests/prijsvraag-excel.mjs
# 2c.3: OA-offertes ontvangen en vergelijken (Excel heen en terug via de canister, met de hand, los, vergelijking browser = server,
# kiezen, overnemen in de offerte en de bibliotheek (idempotent), tweede indiening, afsluiten met het bericht). Vóór de klokproef.
node tests/oaofferte-2c3.mjs "$cid"
# 2c.4: afspraken met de gekozen OA (tarief met datum, regietarief van de offerte volgt de OA, werfstart → afspraak, werf houdt
# haar tarief, nieuw tarief op de werf vanaf een dag, controle OA-factuur, contract onder controlecode, Mijn contracten, attesten).
node tests/afspraak-2c4.mjs "$cid"
# 2c.7: OA-facturen zoals ze binnenkomen (factuur over twee werven = werfdelen, ploeguren, tarief per dag over een tariefwissel,
# kostensoorten, uren naar de werfleider zonder bedrag, voorschot en aftrek, betaalkorting, leveranciersfactuur, doorrekenen, de OA).
node tests/aankoop-2c7.mjs "$cid"
node tests/nacalc-4-6.mjs "$cid"
# 2c.5: de min-meerstaat (offerte met korting, opmeting, regie aan het werftarief met datum, raming afgerekend, kosten / 0,8, regels met
# akkoord, meerwerkofferte vanaf € 1.000, werfleider zonder bedragen, versies onder een controlecode, klant en architect, rekentest).
node tests/minmeer-2c5.mjs "$cid"
# 4b.3c: de werkvorm (vergelijken, opmeting, vorderingsstaat, min-meerstaat, factuurcontrole): kern zonder netwerk, rekenmodules ongewijzigd,
# alleen-lezen waar het hoort en de rechten per rol (op de gegevens die de proeven hierboven achterlieten, o.a. de vorderingsstaten van 2c.5; vóór de klokproef van 2c.2).
node tests/proef-4b-3c.mjs "$cid"
# 4b.4: Eén tik, de onderbalk van de onderaannemer, de starten van klant, architect en veiligheidscoördinator, geen bedragen voor externen
# (op de gegevens van de rollentest en de proeven hierboven; geen schrijfacties die een klokproef storen).
node tests/proef-4b-4.mjs "$cid"
# 2c.8: werfadministratie en oplevering (aangifte start + 15 dagen met meldingen, premie met minimum, attest voor de klant, werfvergadering en
# oplevering met actie- en restpunten als taken, opleveringsdocument onder een controlecode, fiches, werfcode P.nnn, export). Vóór de klokproef.
node tests/werfadmin-2c8.mjs "$cid"
# 2c.6: verkoopfacturen (schema 50/24/26 met korting en per hoofdstuk, nummering zonder gaten §7.4, creditnota-reeks, btw 6/21/verlegd,
# weigering bij een ontbrekende vermelding, factuur uit een vorderingsstaat en uit de min-meerstaat zonder dubbel, betalingen, rechten,
# rekentest, UBL, kwartaallijst, herinnering). Verzet de klok van dit eigen net naar 1 januari (jaarwissel): vóór de prijsvraag-klokproef.
node tests/factuur-2c6.mjs "$cid"
# 2c open punten deel A: kaart Volgende stap per rol, Beheer (termijnen, attestsoorten), OA-offerte intrekken, PID. Ná factuur-2c6 (geeft een
# voorschotfactuur een nummer) en vóór de klokproef van prijsvraag-2c2 (verzet de klok zelf 3 dagen vooruit).
node tests/openpunten-2c8p.mjs "$cid"
# 2c open punten deel B: creditnota van een OA (Te betalen en min-meerstaat omlaag, niets dubbel), OA-facturen van 2.11 in Te betalen met de
# stand betaald, eigen schijven voor een meerwerkofferte (100 % bij het akkoord, totaalrem, slot uit de min-meerstaat zonder dubbel meerwerk).
node tests/openpunten-2c8p-b.mjs "$cid"
node tests/prijsvraag-2c2.mjs "$cid"
( cd gateway && node --test test/*.test.ts )
