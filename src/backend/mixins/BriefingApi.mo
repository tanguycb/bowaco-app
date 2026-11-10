// Maandagbriefing (stap 4.4): het wekelijkse overzicht voor de zaakvoerder (admin), door de app zelf samengesteld uit interne gegevens
// (lib/Briefing.mo): planning van de week, wat aandacht vraagt, open voorstellen van bots, vervallende attesten, vergunningen en
// verzekeringen, facturen te beslissen en klantakkoorden die wachten. Enkel lezen, GEEN bedragen (de afwijkingen uit de nacalculatie,
// 4.6, voegt de browser toe voor wie bedragen mag zien). Niets wordt gemaild: de app stuurt de briefing nergens heen.
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Time "mo:core/Time";
import Types "../types";
import BV "../types/briefingviews";
import Access "../lib/Access";
import Briefing "../lib/Briefing";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  dossier : Types.DossierState,
  permits : Types.PermitState,
  siteAdmin : Types.SiteAdminState,
  quotes : Types.QuotesState,
  minMeer : Types.MinMeerState,
  oaRead : Types.OaReadState,
  aiCheck : Types.AiCheckState,
  invCheck : Types.InvCheckState,
  purchases : Types.PurchaseState,
) {
  // Enkel de beheerder (de zaakvoerder): #manageSettings.
  public query ({ caller }) func readBriefing() : async BV.BriefingView {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    let visible = func(w : Nat) : Bool {
      switch (works.works.get(w)) { case (?x) x.archivedAt == null and x.status != #cancelled; case null false };
    };
    Briefing.build({ settings; org; works; plan; reports; dossier; permits; siteAdmin; quotes; minMeer; oaRead; aiCheck; invCheck; purchases }, visible, func(_ : Types.Document) : Bool { true }, true, Time.now());
  };
};
