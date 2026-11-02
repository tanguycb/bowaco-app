// De vaste teksten van de mails in de taal van de ontvanger (les uit SuiteAccess): Nederlands (standaard), Frans,
// Engels. De taal hoort bij de firma (instelling `post.taal:<firma>` in Postbode), anders bij haar contactpersonen
// (`Person.lang`), anders Nederlands. Wat de mensen zelf invullen (werfnamen, taaktitels) blijft zoals het is.
// De namen van de schermen ("Mijn week", "Mijn uren") blijven Nederlands: zo heten ze in de app.
import Nat "mo:core/Nat";

module {
  public type T = {
    lang : Text;
    days : [Text]; // ma … zo
    leader : Text;
    toConfirm : Text;
    declined : Text;
    weekSubject : (week : Text, from : Text, to : Text) -> Text;
    weekPre : Text;
    weekHeading : (week : Text) -> Text;
    weekIntro : (name : Text, from : Text, to : Text) -> Text;
    weekOutro : Text;
    remPlanSubject : Text;
    remPlanPre : Text;
    remPlanHeading : Text;
    remPlanIntro : (name : Text) -> Text;
    remPlanOutro : Text;
    remHoursSubject : Text;
    remHoursPre : Text;
    remHoursHeading : Text;
    remHoursIntro : (name : Text) -> Text;
    remHoursOutro : Text;
    testSubject : Text;
    testPre : Text;
    testHeading : Text;
    testIntro : (job : Text) -> Text;
    testOutro : Text;
    quoteSubject : (nr : Text) -> Text;
    quotePre : Text;
    quoteHeading : Text;
    quoteIntro : (name : Text, nr : Text, work : Text) -> Text;
    quoteOutro : Text;
    // 2c.3 (AC-13): de firma werd niet gekozen; nooit een prijs, nooit de gekozen firma.
    thanksSubject : (code : Text) -> Text;
    thanksPre : Text;
    thanksHeading : Text;
    thanksIntro : (name : Text, code : Text, title : Text) -> Text;
    thanksOutro : Text;
    // 2c.6b (AC-21): herinnering bij een vervallen factuur; enkel de link naar de app, nooit een bedrag.
    remindSubject : (nr : Text) -> Text;
    remindPre : Text;
    remindHeading : Text;
    remindIntro : (name : Text, nr : Text, due : Text, work : Text) -> Text;
    remindOutro : Text;
    button : Text;
    footer : (contact : Text) -> Text;
    stop : Text;
    testNote : (org : Text, n : Nat) -> Text;
  };

  public func langs() : [Text] { ["nl", "fr", "en"] };

  public func of(lang : Text) : T {
    switch lang {
      case "fr" fr;
      case "en" en;
      case _ nl;
    };
  };

  func n1(n : Nat, one : Text, more : Text) : Text { n.toText() # " " # (if (n == 1) one else more) };

  let nl : T = {
    lang = "nl";
    days = ["ma", "di", "wo", "do", "vr", "za", "zo"];
    leader = "werfleider";
    toConfirm = "nog te bevestigen";
    declined = "jullie meldden: kan niet";
    weekSubject = func(w, a, b) = "BOWACO planning " # w # " (" # a # " – " # b # ")";
    weekPre = "Jullie werven en taken bij BOWACO volgende week.";
    weekHeading = func(w) = "Planning week " # w;
    weekIntro = func(name, a, b) = "Hallo " # name # ", dit is jullie planning bij BOWACO voor " # a # " – " # b # ".";
    weekOutro = "Klopt iets niet of kan het niet doorgaan? Bevestig of meld het in de app, of bel de werfleider.";
    remPlanSubject = "BOWACO: planning nog te bevestigen";
    remPlanPre = "Enkele taken wachten op jullie bevestiging.";
    remPlanHeading = "Nog te bevestigen";
    remPlanIntro = func(name) = "Hallo " # name # ", deze taken in de komende twee weken wachten nog op jullie bevestiging.";
    remPlanOutro = "Bevestigen of \"kan niet\" melden gaat in de app, onder Mijn week.";
    remHoursSubject = "BOWACO: uren nog te bevestigen";
    remHoursPre = "Uren uit de werfverslagen wachten op jullie bevestiging.";
    remHoursHeading = "Uren nog te bevestigen";
    remHoursIntro = func(name) = "Hallo " # name # ", deze uren uit de werfverslagen wachten nog op jullie bevestiging.";
    remHoursOutro = "Bevestigen of betwisten gaat in de app, onder Mijn uren.";
    testSubject = "BOWACO werven: proefmail";
    testPre = "Proef: de mail van de app werkt.";
    testHeading = "Proefmail";
    testIntro = func(j) = "Deze mail komt van de BOWACO-app (opdracht #" # j # "). Ze bevat geen gegevens van werven.";
    testOutro = "Komt deze mail aan? Dan werkt het versturen via de maildienst van Caffeine.";
    quoteSubject = func(nr) = "Uw offerte " # nr # " van BOWACO";
    quotePre = "Uw offerte staat klaar in de app.";
    quoteHeading = "Uw offerte staat klaar";
    quoteIntro = func(name, nr, work) = (if (name == "") "Goedendag" else "Goedendag " # name) # ", BOWACO stuurde u offerte " # nr # " voor " # work # ". U bekijkt ze, downloadt de PDF en geeft uw akkoord in de app, na het inloggen.";
    quoteOutro = "In deze mail staan bewust geen bedragen. Heeft u een vraag, neem dan contact op met BOWACO.";
    thanksSubject = func(code) = "Prijsvraag " # code # ": bedankt voor uw offerte";
    thanksPre = "Uw offerte werd deze keer niet gekozen.";
    thanksHeading = "Bedankt voor uw offerte";
    thanksIntro = func(name, code, title) = (if (name == "") "Goedendag" else "Goedendag " # name) # ", bedankt voor uw offerte op prijsvraag " # code # " (" # title # "). Deze keer werd uw offerte niet gekozen. We vragen u graag opnieuw bij een volgende werf.";
    thanksOutro = "In deze mail staan bewust geen bedragen.";
    remindSubject = func(nr) = "Herinnering: factuur " # nr # " van BOWACO";
    remindPre = "Een factuur van BOWACO staat nog open.";
    remindHeading = "Herinnering betaling";
    remindIntro = func(name, nr, due, work) = (if (name == "") "Goedendag" else "Goedendag " # name) # ", factuur " # nr # " voor " # work # " was te betalen op " # due # " en staat volgens onze gegevens nog open. U vindt de factuur en de herinnering in de app, na het inloggen.";
    remindOutro = "Is de betaling intussen gebeurd, dan mag u deze mail als niet verstuurd beschouwen. In deze mail staan bewust geen bedragen.";
    button = "Open de app";
    footer = func(c) = "Deze mail werd automatisch verstuurd door de BOWACO-app. Antwoorden op deze mail komen niet aan: bel je werfleider" # (if (c.size() > 0) " of mail naar " # c else "") # ". Je logt zelf in; deze mail bevat nooit een toegangscode.";
    stop = "Geen mails meer van de planning? Laat het BOWACO weten.";
    testNote = func(o, n) = "Testmodus: deze mail was bedoeld voor " # o # " (" # n1(n, "adres", "adressen") # "). Ze ging enkel naar het testadres.";
  };

  let fr : T = {
    lang = "fr";
    days = ["lu", "ma", "me", "je", "ve", "sa", "di"];
    leader = "chef de chantier";
    toConfirm = "à confirmer";
    declined = "vous avez signalé : impossible";
    weekSubject = func(w, a, b) = "BOWACO planning " # w # " (" # a # " – " # b # ")";
    weekPre = "Vos chantiers et tâches chez BOWACO la semaine prochaine.";
    weekHeading = func(w) = "Planning semaine " # w;
    weekIntro = func(name, a, b) = "Bonjour " # name # ", voici votre planning chez BOWACO du " # a # " au " # b # ".";
    weekOutro = "Quelque chose ne va pas ou ne peut pas avoir lieu ? Confirmez ou signalez-le dans l'app, ou appelez le chef de chantier.";
    remPlanSubject = "BOWACO : planning à confirmer";
    remPlanPre = "Quelques tâches attendent votre confirmation.";
    remPlanHeading = "À confirmer";
    remPlanIntro = func(name) = "Bonjour " # name # ", ces tâches des deux prochaines semaines attendent encore votre confirmation.";
    remPlanOutro = "Confirmer ou signaler « impossible » se fait dans l'app, sous « Mijn week ».";
    remHoursSubject = "BOWACO : heures à confirmer";
    remHoursPre = "Des heures des rapports de chantier attendent votre confirmation.";
    remHoursHeading = "Heures à confirmer";
    remHoursIntro = func(name) = "Bonjour " # name # ", ces heures des rapports de chantier attendent encore votre confirmation.";
    remHoursOutro = "Confirmer ou contester se fait dans l'app, sous « Mijn uren ».";
    testSubject = "BOWACO chantiers : e-mail de test";
    testPre = "Test : l'e-mail de l'app fonctionne.";
    testHeading = "E-mail de test";
    testIntro = func(j) = "Cet e-mail vient de l'app BOWACO (tâche n° " # j # "). Il ne contient aucune donnée de chantier.";
    testOutro = "Vous recevez cet e-mail ? Alors l'envoi via le service e-mail de Caffeine fonctionne.";
    quoteSubject = func(nr) = "Votre offre " # nr # " de BOWACO";
    quotePre = "Votre offre est disponible dans l'application.";
    quoteHeading = "Votre offre est disponible";
    quoteIntro = func(name, nr, work) = (if (name == "") "Bonjour" else "Bonjour " # name) # ", BOWACO vous a envoyé l'offre " # nr # " pour " # work # ". Vous pouvez la consulter, télécharger le PDF et donner votre accord dans l'application, après connexion.";
    quoteOutro = "Cet e-mail ne contient volontairement aucun montant. Pour toute question, contactez BOWACO.";
    thanksSubject = func(code) = "Demande de prix " # code # " : merci pour votre offre";
    thanksPre = "Votre offre n'a pas été retenue cette fois.";
    thanksHeading = "Merci pour votre offre";
    thanksIntro = func(name, code, title) = (if (name == "") "Bonjour" else "Bonjour " # name) # ", merci pour votre offre pour la demande de prix " # code # " (" # title # "). Cette fois, votre offre n'a pas été retenue. Nous vous consulterons volontiers pour un prochain chantier.";
    thanksOutro = "Cet e-mail ne contient volontairement aucun montant.";
    remindSubject = func(nr) = "Rappel : facture " # nr # " de BOWACO";
    remindPre = "Une facture de BOWACO est encore ouverte.";
    remindHeading = "Rappel de paiement";
    remindIntro = func(name, nr, due, work) = (if (name == "") "Bonjour" else "Bonjour " # name) # ", la facture " # nr # " pour " # work # " était payable le " # due # " et reste ouverte selon nos données. Vous trouvez la facture et le rappel dans l'application, après connexion.";
    remindOutro = "Si le paiement a entre-temps été effectué, veuillez ignorer ce message. Ce message ne contient volontairement aucun montant.";
    button = "Ouvrir l'app";
    footer = func(c) = "Cet e-mail a été envoyé automatiquement par l'app BOWACO. Les réponses à cet e-mail n'arrivent pas : appelez votre chef de chantier" # (if (c.size() > 0) " ou écrivez à " # c else "") # ". Vous vous connectez vous-même ; cet e-mail ne contient jamais de code d'accès.";
    stop = "Vous ne souhaitez plus recevoir ces e-mails de planning ? Faites-le savoir à BOWACO.";
    testNote = func(o, n) = "Mode test : cet e-mail était destiné à " # o # " (" # n1(n, "adresse", "adresses") # "). Il n'a été envoyé qu'à l'adresse de test.";
  };

  let en : T = {
    lang = "en";
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    leader = "site manager";
    toConfirm = "to be confirmed";
    declined = "you reported: not possible";
    weekSubject = func(w, a, b) = "BOWACO schedule " # w # " (" # a # " – " # b # ")";
    weekPre = "Your sites and tasks at BOWACO next week.";
    weekHeading = func(w) = "Schedule week " # w;
    weekIntro = func(name, a, b) = "Hello " # name # ", this is your schedule at BOWACO for " # a # " – " # b # ".";
    weekOutro = "Something wrong, or can it not go ahead? Confirm or report it in the app, or call the site manager.";
    remPlanSubject = "BOWACO: schedule still to confirm";
    remPlanPre = "Some tasks are waiting for your confirmation.";
    remPlanHeading = "Still to confirm";
    remPlanIntro = func(name) = "Hello " # name # ", these tasks in the next two weeks are still waiting for your confirmation.";
    remPlanOutro = "Confirm or report \"not possible\" in the app, under \"Mijn week\".";
    remHoursSubject = "BOWACO: hours still to confirm";
    remHoursPre = "Hours from the site reports are waiting for your confirmation.";
    remHoursHeading = "Hours still to confirm";
    remHoursIntro = func(name) = "Hello " # name # ", these hours from the site reports are still waiting for your confirmation.";
    remHoursOutro = "Confirm or dispute them in the app, under \"Mijn uren\".";
    testSubject = "BOWACO sites: test e-mail";
    testPre = "Test: e-mail from the app works.";
    testHeading = "Test e-mail";
    testIntro = func(j) = "This e-mail comes from the BOWACO app (job #" # j # "). It contains no site data.";
    testOutro = "Did this arrive? Then sending through Caffeine's e-mail service works.";
    quoteSubject = func(nr) = "Your quote " # nr # " from BOWACO";
    quotePre = "Your quote is ready in the app.";
    quoteHeading = "Your quote is ready";
    quoteIntro = func(name, nr, work) = (if (name == "") "Hello" else "Hello " # name) # ", BOWACO sent you quote " # nr # " for " # work # ". You can view it, download the PDF and give your approval in the app after signing in.";
    quoteOutro = "This e-mail deliberately contains no amounts. If you have a question, please contact BOWACO.";
    thanksSubject = func(code) = "Request for quotation " # code # ": thank you for your quote";
    thanksPre = "Your quote was not selected this time.";
    thanksHeading = "Thank you for your quote";
    thanksIntro = func(name, code, title) = (if (name == "") "Hello" else "Hello " # name) # ", thank you for your quote for request " # code # " (" # title # "). This time your quote was not selected. We will gladly ask you again for a next site.";
    thanksOutro = "This e-mail deliberately contains no amounts.";
    remindSubject = func(nr) = "Reminder: invoice " # nr # " from BOWACO";
    remindPre = "An invoice from BOWACO is still open.";
    remindHeading = "Payment reminder";
    remindIntro = func(name, nr, due, work) = (if (name == "") "Hello" else "Hello " # name) # ", invoice " # nr # " for " # work # " was due on " # due # " and is still open according to our records. You will find the invoice and the reminder in the app after signing in.";
    remindOutro = "If you have already paid, please disregard this message. This message deliberately contains no amounts.";
    button = "Open the app";
    footer = func(c) = "This e-mail was sent automatically by the BOWACO app. Replies to this e-mail do not arrive: call your site manager" # (if (c.size() > 0) " or write to " # c else "") # ". You sign in yourself; this e-mail never contains an access code.";
    stop = "No more schedule e-mails? Let BOWACO know.";
    testNote = func(o, n) = "Test mode: this e-mail was meant for " # o # " (" # n1(n, "address", "addresses") # "). It only went to the test address.";
  };
};
