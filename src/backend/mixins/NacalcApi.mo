// Nacalculatie (stap 4.6): gepland (getekende offerte) tegenover werkelijk (min-meerstaat, aankoopfacturen, gefactureerd), per werf en
// over alle werven. De backend geeft enkel FEITEN (lib/Nacalc.mo); de browser rekent (frontend/src/nacalc/calc.ts). Bedragen,
// kostprijzen en marges: enkel admin en calculator (R20/R21, Rights.purchaseScope #full), enkel via update-calls met een auditregel,
// nooit voor werfleider, OA of klant. De drempel voor een afwijking staat in settings.values (geen migratie). Geen await: één atomaire stap.
import Array "mo:core/Array";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Iter "mo:core/Iter";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "../types";
import NV "../types/nacalcviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Nacalc "../lib/Nacalc";
import MinMeer "../lib/MinMeer";
import Post "../lib/Post";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  dossier : Types.DossierState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  quotes : Types.QuotesState,
  quoteDocs : Types.QuoteDocsState,
  quoteForms : Types.QuoteFormState,
  workStarts : Types.WorkStartState,
  surveys : Types.SurveyState,
  progress : Types.ProgressState,
  oaInvoices : Types.OaInvoiceState,
  oaDeals : Types.OaDealState,
  purchases : Types.PurchaseState,
  minMeer : Types.MinMeerState,
  sales : Types.SalesState,
  audit : Types.AuditState,
) {
  func ncCtx() : MinMeer.Ctx { { settings; access; org; works; dossier; plan; reports; qs = quotes; qf = quoteForms; qd = quoteDocs; starts = workStarts; ss = surveys; ps = progress; oi = oaInvoices; deals = oaDeals; pu = purchases; sales; mm = minMeer } };
  func ncToday() : Nat { Post.local(Time.now()).day };
  // Kantoor met de bedragen: admin of calculator (zoals purchaseScope #full en minMeerScope #full).
  func ncOffice(p : Types.Person, w : ?Nat) : Bool {
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #readCosts, null)) { return false };
    switch w { case (?id) { Rights.purchaseScope(ctx, p, id) == #full }; case null true };
  };

  // De drempel (zonder bedragen van een werf): alle interne personen mogen hem kennen, maar enkel kantoor heeft er iets aan.
  public query ({ caller }) func nacalcSettings() : async NV.NcSettings {
    let p = Access.requireActive(access, caller);
    if (not ncOffice(p, null)) { Runtime.trap("Geen toegang") };
    Nacalc.settingsOf(settings);
  };

  public shared ({ caller }) func saveNacalcSettings(i : NV.NcSettings) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (i.pctBp > 100_000) { return #err("Percentage: hoogstens 1000 %") };
    if (i.minCents > 1_000_000_000) { return #err("Bedrag: hoogstens € 10.000.000") };
    settings.values.add("nacalc.pctBp", i.pctBp.toText());
    settings.values.add("nacalc.minCents", i.minCents.toText());
    Access.audit(audit, caller, ?p.id, null, "nacalculatie-drempel", (i.pctBp / 100).toText() # " % en " # (i.minCents / 100).toText() # " euro");
    #ok;
  };

  // Eén werf. #err = geen toegang, onbekende werf of nog geen getekende offerte (null → "nog geen getekende offerte").
  public shared ({ caller }) func readNacalc(workId : Nat) : async Result.Result<?NV.NcFacts, Text> {
    let p = Access.requireActive(access, caller);
    if (not ncOffice(p, ?workId)) { return #err("Geen toegang") };
    let r = Nacalc.facts(ncCtx(), workId, ncToday());
    Access.audit(audit, caller, ?p.id, ?workId, "bekeek:nacalculatie", switch (works.works.get(workId)) { case (?w) w.code; case null "" });
    #ok(r);
  };

  // Alle werven met een getekende offerte (niet gearchiveerd, niet geannuleerd), hoogstens Config.ncMaxWorks.
  public shared ({ caller }) func nacalcOverview() : async Result.Result<NV.NcOverview, Text> {
    let p = Access.requireActive(access, caller);
    if (not ncOffice(p, null)) { return #err("Geen toegang") };
    let c = ncCtx();
    let today = ncToday();
    // De grens geldt vóór het rekenen (één update-call, geen await): de eerste Config.ncMaxWorks werven op id; de rest telt als "skipped".
    let all = works.works.values().filter(func(w : Types.Work) : Bool = w.archivedAt == null and w.status != #cancelled).toArray();
    let n = Nat.min(all.size(), Config.ncMaxWorks);
    let skipped : Nat = all.size() - n;
    let out = Array.tabulate<Types.Work>(n, func i = all[i]).filterMap(func(w : Types.Work) : ?NV.NcBrief { Nacalc.brief(c, w.id, today) });
    Access.audit(audit, caller, ?p.id, null, "bekeek:nacalculatie-overzicht", out.size().toText() # " werven");
    #ok({ rows = out; settings = Nacalc.settingsOf(settings); skipped });
  };
};
