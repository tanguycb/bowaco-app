# Postbode installeren (stap 1b.3): stappenplan voor de eigenaar

*24-10-2026. De postbode is de kleine EU-dienst die de mails van de app verstuurt: de **weekplanning per onderaannemer** en
de **herinneringen** (planning en uren nog te bevestigen). Ze leest elke 2 minuten de werkwachtrij van de app met haar eigen
robotsleutel, verstuurt via **Brevo** (maildienst in de EU) en meldt het resultaat terug. De app belt de postbode nooit;
de postbode belt de app (architectuur §6).*

**Wat jij doet** (Claude maakt geen accounts en betaalt niets): (1) een server huren in de EU, (2) een Brevo-account,
(3) de DNS van bowaco.eu aanvullen. **Wat er al klaar ligt**: de code (`gateway/`), het deploy-script
(`gateway/deploy/deploy.sh`) en de schermen in de app (*Postbode* in het menu van de beheerder).

**Geheimen** (de API-sleutel van Brevo, de sleutel van de robot) staan **enkel op de server** in `/etc/bowaco-postbode/`.
Nooit in git, mail, WhatsApp of een Claude-sessie. Typ ze zelf, in je eigen Terminal.

Duur: ± 1 uur. Kost: server ± € 4–6 per maand; Brevo gratis tot 300 mails per dag (ruim genoeg: ± 50 OA's per week).

---

## Stap 1 — Server huren (Hetzner, EU)

1. Maak een account op **hetzner.com** → *Cloud* (facturatie op naam van BOWACO).
2. Maak een **SSH-sleutel** op je Mac (als je er nog geen hebt), in je eigen Terminal:
   ```bash
   ssh-keygen -t ed25519 -C "bowaco-postbode"
   ```
   en kopieer de publieke sleutel: `cat ~/.ssh/id_ed25519.pub`.
3. *Cloud Console* → nieuw project **BOWACO** → *Add server*:
   - **Location**: Falkenstein (DE) of Nuremberg (DE) — EU (beslist in 0.2);
   - **Image**: Ubuntu 24.04;
   - **Type**: kleinste gedeelde x86 (bv. CX22, 2 vCPU, 4 GB) — ruim voldoende;
   - **Networking**: publiek IPv4 + IPv6;
   - **SSH keys**: plak je publieke sleutel (dan is er geen root-wachtwoord);
   - **Backups**: niet nodig (de server bewaart geen gegevens van de app);
   - naam: `bowaco-postbode`.
4. Noteer het **IPv4-adres** (en IPv6). Probeer: `ssh root@<IPv4>` (eerste keer "yes").

## Stap 2 — DNS: een naam voor de postbode

Bij de beheerder van de DNS van **bowaco.eu** (registrar/hosting):

| Type | Naam | Waarde |
|---|---|---|
| A | `postbode` | het IPv4-adres van de server |
| AAAA | `postbode` | het IPv6-adres (mag ontbreken) |

Na een paar minuten: `ping postbode.bowaco.eu` toont het IP. (Een andere naam mag; gebruik dan die in stap 4.)

## Stap 3 — Brevo (maildienst, EU) en de DNS voor e-mail

1. Account op **brevo.com** (gratis plan) op naam van BOWACO. Aanvaard de **verwerkersovereenkomst** (DPA) in het account
   (*Settings → Data protection / DPA*): Brevo verwerkt namen en e-mailadressen van OA's (privacyregister P18).
2. *Senders, Domains & Dedicated IPs* → **Domains** → *Add a domain* → `bowaco.eu` → kies "Authenticate the domain yourself".
   Brevo toont dan de records die je bij je DNS-beheerder moet zetten. Typisch:

   | Wat | Type | Naam | Waarde |
   |---|---|---|---|
   | Brevo-code (eigendom) | TXT | `bowaco.eu` (of `@`) | `brevo-code:…` (van het scherm) |
   | **DKIM** (handtekening) | CNAME (2×) of TXT | `brevo1._domainkey`, `brevo2._domainkey` | wat Brevo toont |
   | **DMARC** (beleid) | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` |
   | **SPF** | TXT | `bowaco.eu` | **niet nodig voor Brevo** (gedeelde servers: DMARC slaagt via DKIM). **Er mag maar één SPF-record zijn**: staat er al een (bv. voor jullie gewone mail), laat het staan; wil je toch, voeg dan `include:spf.brevo.com` toe *in* dat record, vóór de `~all` of `-all` |

   Neem de waarden **letterlijk van het Brevo-scherm** (ze zijn per account anders). Klik daarna *Authenticate*; groen = klaar
   (kan tot een uur duren). Bestaat er al een `_dmarc`-record: niet dubbel maken, enkel `rua` toevoegen als je dat wil.
3. *Senders* → afzender **`planning@bowaco.eu`** (naam "BOWACO werven") toevoegen. Een echte mailbox is niet nodig om te
   versturen; antwoorden gaan naar het antwoordadres (stap 5, bv. `info@bowaco.eu`).
4. *SMTP & API* → **API keys** → *Generate a new API key* → naam `postbode`. **Kopieer de sleutel één keer** en plak ze in
   stap 5 rechtstreeks op de server. Niet bewaren in een document of mail; verloren = een nieuwe maken en de oude wissen.
5. Na een maand: DMARC van `p=none` naar `p=quarantine` zetten als de rapporten in orde zijn (optioneel).

## Stap 4 — Installeren (één opdracht vanop je Mac)

In je eigen Terminal, in de map van de app:
```bash
cd ~/Desktop/Split/bowaco-app
zsh gateway/deploy/deploy.sh eerste-keer root@<IPv4> postbode.bowaco.eu
```
Het script: werkt Ubuntu bij, installeert **Caddy** (HTTPS met Let's Encrypt), de **firewall** (enkel SSH, 80, 443), **Node**
(officiële release, controlesom nagekeken), maakt de gebruiker `postbode` en de mappen, kopieert de code, maakt de
**robotsleutel** op de server en toont de **robotprincipal** (bv. `abcde-…-cai`). **Noteer die principal** (stap 6).
De sleutel zelf verlaat de server niet (offline kopie: zie *Onderhoud*).

## Stap 5 — De omgeving invullen (op de server)

```bash
ssh root@<IPv4>
nano /etc/bowaco-postbode/postbode.env
```
- `BOWACO_CANISTER`: eerst de **draft** (`w5pbr-raaaa-aaaal-qs3aq-cai`) om te proeven; bij de livegang het id van live.
- `BREVO_API_KEY`: de sleutel van stap 3.4.
- `BREVO_SANDBOX=1` laten staan (testmodus: Brevo verstuurt niets).
- `MAIL_FROM=BOWACO werven <planning@bowaco.eu>`, `MAIL_REPLY_TO=info@bowaco.eu` (of het kantooradres).

Opslaan (Ctrl-O, Enter, Ctrl-X). Rechten blijven `root:postbode 0640`.

## Stap 6 — De robot toevoegen in de app

In de app als beheerder: **Postbode** (menu) → *Robots* → **Robot toevoegen**: principal van stap 4, naam `Postbode`,
soort **mail**. (Ook later te intrekken met één klik: dan kan de postbode niets meer.)

Dan op je Mac: `zsh gateway/deploy/deploy.sh update root@<IPv4>` — het script herstart de dienst en toont `/health`
(`"status":"ok"`, de robotprincipal, `"testmodus":true`). Ook vanaf het internet: `https://postbode.bowaco.eu/health`.

## Stap 7 — Proeven

1. **Testmodus** (`BREVO_SANDBOX=1`): in de app *Postbode* → **Proefmail** naar je eigen adres. Binnen 2 minuten staat de
   opdracht op *klaar* (met een `messageId` van Brevo) — er komt **geen** mail (testmodus). `deploy.sh status` toont
   "verstuurd".
2. **Echt, enkel naar jezelf**: zet op de server `BREVO_SANDBOX=0`, `systemctl restart bowaco-postbode`, en stuur opnieuw een
   **Proefmail naar je eigen adres**. Kijk in je mailbox: aangekomen (niet in spam)? In Gmail *Origineel tonen*:
   `DKIM: PASS`, `DMARC: PASS`. Zo niet: stap 3.2 nakijken.
3. **Weekmail bekijken zonder te versturen**: *Postbode* → *Voorbeeld* → kies een firma en een week. Klopt de inhoud?
4. **Pas daarna** de weekmail aanzetten (stap 8). Op de draft staan proeffirma's en geanonimiseerde firma's met
   verzonnen adressen (`…@proef.invalid` kan niet afgeleverd worden); stuur vanaf de draft **geen** weekmails naar echte
   OA's.

## Stap 8 — Weekmail en herinneringen aanzetten (op live, na de livegang)

*Postbode* → *Instellingen*:
- **Adres van de app** (komt als knop "Open de app" in de mail), bv. `https://app.bowaco.eu` (eindadres, E-1);
- **Weekmail** aan, **dag en uur** (standaard vrijdag 14 u: de planning van volgende week);
- **Herinneringen** aan (standaard woensdag: planning en uren die nog te bevestigen zijn);
- per firma kan je de mails uitzetten (*Postbode* → *Firma's*).

Ontvangers: het algemene e-mailadres van de firma (fiche *Onderaannemers*), anders de adressen van haar contactpersonen
(hoogstens 3). Een mail bevat **nooit** een inlogcode of een bestand; enkel werven, data, taken en een link naar de app.

---

## Onderhoud

| Wat | Hoe |
|---|---|
| Nieuwe versie van de postbode | `zsh gateway/deploy/deploy.sh update root@<IPv4>` |
| Kijken of alles loopt | `zsh gateway/deploy/deploy.sh status root@<IPv4>` (dienst, laatste 20 logregels, `/health`); in de app *Postbode*: "laatst gezien" per robot, open en mislukte opdrachten |
| Mislukte mail | de app meldt het aan de beheerders (bel); *Postbode* → *Mislukt* → *Opnieuw* |
| **Offline kopie van de robotsleutel** | `scp root@<IPv4>:/etc/bowaco-postbode/robot.json ~/Desktop/robot-postbode.json` → naar je kluis/versleutelde USB → bestand op de Mac wissen. Verloren server = nieuwe server + deze sleutel terugzetten (zelfde principal), of een nieuwe sleutel + de robot opnieuw toevoegen in de app en de oude intrekken |
| Sleutel vernieuwen (jaarlijks of bij twijfel) | op de server `rm /etc/bowaco-postbode/robot.json` + `deploy.sh eerste-keer …` (maakt een nieuwe, toont de principal) → in de app de nieuwe robot toevoegen en de oude **intrekken** |
| Brevo-sleutel vernieuwen | nieuwe sleutel in Brevo → `postbode.env` → `systemctl restart bowaco-postbode` → oude sleutel in Brevo wissen |
| Updates van Ubuntu | automatisch (unattended-upgrades); af en toe `ssh root@<IPv4> reboot` |
| Logboek | `/var/lib/bowaco-postbode/journaal.jsonl`: enkel sleutels van opdrachten en het antwoord van Brevo, geen adressen of inhoud |

## Wat de postbode mag (en niet)

- Ze is een **robot**, geen persoon: ze kan niet inloggen, geen schermen zien en niets lezen buiten de mail die ze op dat
  moment moet versturen (`leaseJobs`). Ze kan opdrachten als klaar of mislukt melden, en tickets controleren (`checkTicket`,
  enkel de proeftaak tot fase 3). Intrekken in de app = meteen alles dicht.
- Een gekraakte server kan hoogstens foute mails versturen tot de robot ingetrokken wordt (T13); ze kan geen gegevens in
  de app wijzigen, geen bedragen of contracten lezen, geen codes maken.
- Twee postbodes tegelijk kan (reserve): de lease (10 min) en de idempotentiesleutel voorkomen dubbele mails.

## Problemen

| Symptoom | Oorzaak / oplossing |
|---|---|
| `/health` antwoordt niet | `deploy.sh status`; firewall (`ufw status`), Caddy (`journalctl -u caddy`), DNS (stap 2) |
| Logregel "alleen een robot" | de robot is niet (meer) toegevoegd in de app, of `BOWACO_CANISTER` wijst naar een andere app (draft vs live) |
| Opdracht "mislukt: http 401" | verkeerde of gewiste Brevo-sleutel |
| Opdracht "overgeslagen: geen e-mailadres bij de firma" | vul het algemene adres van de firma in (*Onderaannemers* → fiche) |
| Mail komt in spam | DKIM/DMARC nakijken (stap 3.2), afzender geverifieerd (3.3) |
