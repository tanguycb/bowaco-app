# Postbode: mail via Caffeine (geen installatie meer)

*24-10-2026 (beslissing eigenaar E-11: "dit werkt uiteraard gewoon via caffeine"). Vervangt het stappenplan van 1b.3
(EU-server, Brevo, DNS). Dat staat nog in git (`git show 460bd43:docs/postbode-installatie.md`) voor wie het later nodig
heeft.*

## Wat er veranderde

- De **app verstuurt de mails zelf** via de maildienst van Caffeine (`caffeineai-email`, soort "service"): de
  weekplanning per onderaannemer en de herinneringen (planning en uren nog te bevestigen). Code: `src/backend/lib/Mail.mo`
  (versturen, testmodus, logboek), `src/backend/lib/Post.mo` (wachtrij en inhoud), `src/backend/lib/MailText.mo` (nl/fr/en).
- **Geen eigen server, geen Brevo-account, geen DNS-werk** voor mail. De afzender is het no-reply-adres van Caffeine;
  antwoorden kan niet, daarom zegt de voet van elke mail wie te bellen (en het adres van het kantoor als je dat invult).
- De **gateway** (`gateway/`) verstuurt geen mail meer: de mailcode is weg, de robot krijgt geen mailopdrachten meer
  (een robot met de oude soort "mail" leaset niets). De gateway is pas nodig in **fase 3** (AI-taken,
  eenvoudigfactureren.be); `gateway/deploy/deploy.sh` blijft daarvoor staan.

## Wat jij doet (in de app, menu *Postbode*)

1. **Testmodus** (staat standaard aan; op de draft kan ze niet uit): vul je **eigen testadres** in. Alle mail gaat dan enkel
   naar dat adres, met "[TEST]" in het onderwerp en bovenaan voor welke firma ze bedoeld was. Zonder testadres gaat er
   niets weg (droog: enkel het logboek).
2. **Voorbeeld** bekijken (zoals de mail er echt uitziet), dan **Proefmail** → **Nu versturen** → nakijken of ze aankomt
   (en niet in spam zit).
3. Adres van de app en (optioneel) het adres van het kantoor voor de voet invullen; per firma de taal (nl/fr/en) en
   aan/uit nakijken.
4. **Pas op live**, na de livegang en na de securityreview 1b.5: testmodus uit, eerst één firma (*Weekmails nu klaarzetten*
   voor die firma), dan de weekmail aanzetten.

## Vóór echte mails op live (securityreview 1b.5)

Echte mail (testmodus **uit**) kan **enkel vanaf een canister die in `Config.mailLiveBackends` staat** (`src/backend/lib/Config.mo`).
Die lijst is leeg tot de livegang: een nieuwe draftcanister, een proefproject of een herstel op een ander project kan dus
nooit een echte firma mailen, wat een beheerder ook instelt (*Postbode* zegt dan "deze canister staat niet in de lijst
van livecanisters"). De draftcanister (`Config.draftBackends`) is nooit live, ook niet als ze in de lijst zou staan.

1. Zet de app live en lees het **canister-id van de backend op live** af (in de webapp van Caffeine of met `caffeine`).
2. Zet dat id in `Config.mailLiveBackends()`, maak een nieuwe draft (`tools/push.sh`) en zet die live. Pas daarna kan de
   beheerder op live de testmodus uitzetten (de app logt dat als `postbode-testmodus: uit`).
3. Volg de stappen hierboven: eerst een testadres en een proefmail op live, dan de testmodus uit, dan één firma, dan de
   weekmail aanzetten.

Enkel de testbouw van `tests/lokaal.sh` zet de vlag `Config.mailLiveAnyCanister` aan (zoals de testhash), zodat de rollentest
het pad "testmodus uit → echte adressen" kan bewijzen; `tools/meetlat.mjs` weigert een upload met die vlag.

## Kosten

Elke mail kost cycles van de app (de maildienst rekent per mail aan; het bedrag staat per mail in het *Logboek* en
samen bovenaan in *Postbode*). Meegegeven worden hoogstens 50 miljard cycles per mail (zoals `caffeineai-email`); wat niet
aangerekend wordt, komt terug. Onder 500 miljard cycles verstuurt de app niets en krijgen de beheerders een melding.

## Als er iets misloopt

| Wat je ziet | Wat het betekent | Wat doen |
|---|---|---|
| *mislukt* meteen ("de maildienst weigert de mail") | de maildienst weigert de inhoud of een adres: zeker niet verstuurd, en opnieuw proberen zou hetzelfde geven | foutreden lezen (adressen zijn weggelaten), adres van de firma nakijken, *Opnieuw* |
| *mislukt* na 5 pogingen | de maildienst was telkens onbereikbaar (de oproep raakte er niet) | even later *Opnieuw*; blijft het: Caffeine |
| *onzeker* | de app kreeg geen antwoord binnen de tijd, de maildienst viel, of de maildienst kon zijn mailleverancier niet (goed) bereiken: de mail **kan weg zijn** | eerst navragen bij de firma; enkel als ze niets kreeg *Opnieuw* (de app doet dat nooit vanzelf, zo komt er nooit een dubbele mail) |
| melding "Mails wachten: de app heeft te weinig cycles" | de app heeft niet genoeg cycles (de stand staat in *Postbode* bij "cycles in de app") | de app opladen bij Caffeine; de mails wachten en vertrekken daarna |
| melding "Mails wachten: de maildienst vraagt … cycles per mail" | de maildienst rekent meer per mail dan de app meegeeft (`Config.mailCyclesMax`) | de grens verhogen in `Config.mo` (nieuwe draft); de mails wachten |
| *overgeslagen* | niets te sturen (geen adres, niets gepland, firma afgemeld, week voorbij) | niets |
| "al bij de maildienst: annuleren kan niet meer" | de mail is al onderweg; de uitkomst komt in het logboek | wachten op *verstuurd*, *mislukt* of *onzeker* |
