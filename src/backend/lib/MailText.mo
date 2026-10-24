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
    button = "Open de app";
    footer = func(c) = "Deze mail werd automatisch verstuurd door de BOWACO-app. Antwoorden op deze mail komen niet aan: bel je werfleider" # (if (c.size() > 0) " of mail naar " # c else "") # ". Je logt in met je eigen Internet Identity; deze mail bevat nooit een inlogcode.";
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
    button = "Ouvrir l'app";
    footer = func(c) = "Cet e-mail a été envoyé automatiquement par l'app BOWACO. Les réponses à cet e-mail n'arrivent pas : appelez votre chef de chantier" # (if (c.size() > 0) " ou écrivez à " # c else "") # ". Vous vous connectez avec votre propre Internet Identity ; cet e-mail ne contient jamais de code de connexion.";
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
    button = "Open the app";
    footer = func(c) = "This e-mail was sent automatically by the BOWACO app. Replies to this e-mail do not arrive: call your site manager" # (if (c.size() > 0) " or write to " # c else "") # ". You sign in with your own Internet Identity; this e-mail never contains a sign-in code.";
    stop = "No more schedule e-mails? Let BOWACO know.";
    testNote = func(o, n) = "Test mode: this e-mail was meant for " # o # " (" # n1(n, "address", "addresses") # "). It only went to the test address.";
  };
};
