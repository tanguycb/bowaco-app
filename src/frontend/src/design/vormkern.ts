// v3 (4b.3c): de zuivere kern van de Werkvorm (geen React, geen DOM): wanneer het werkblad kan, hoe breed het blad moet zijn om
// inhoud en paneel vast open te hebben, ongedaan maken/opnieuw voor lijnen die een scherm lokaal bijhoudt vóór ze bewaard worden,
// en de pauze van het vanzelf bewaren. tests/proef-4b-3c.mjs draait dezelfde code.

/** Het werkblad is voor een scherm met muis vanaf 900 px (venster); op de gsm of met de vinger blijft de huidige weergave. */
export const WERKVORM_VANAF = 900;
/** Vanaf deze breedte van het blad zelf (een tabblad van een werf is smaller dan het venster) staan inhoud en paneel vast open. */
export const WERKVORM_VAST_VANAF = 1380;
/** Vanzelf bewaren: pauze (ms) na de laatste wijziging; zelfde als het rekenblad. */
export const VANZELF_MS = 2500;

export function werkvormKan(venster: number, vinger: boolean): boolean {
  return !vinger && venster >= WERKVORM_VANAF;
}

/** Ongedaan maken: een stapel kopieën van de lijnen die het scherm lokaal bijhoudt (een Map, een lijst, …). Onveranderlijk: elke
 *  functie geeft een nieuwe Geschiedenis. `nu` is de huidige stand; wie `zet` aanroept met een gelijke stand maakt geen stap. */
export type Geschiedenis<T> = { nu: T; terug: T[]; vooruit: T[] };
export const LIMIET = 100;
export function begin<T>(nu: T): Geschiedenis<T> {
  return { nu, terug: [], vooruit: [] };
}
export function zet<T>(g: Geschiedenis<T>, nieuw: T, gelijk: (a: T, b: T) => boolean = (a, b) => a === b): Geschiedenis<T> {
  if (gelijk(g.nu, nieuw)) return g;
  return { nu: nieuw, terug: [...g.terug, g.nu].slice(-LIMIET), vooruit: [] };
}
export function ongedaan<T>(g: Geschiedenis<T>): Geschiedenis<T> {
  if (g.terug.length === 0) return g;
  return { nu: g.terug[g.terug.length - 1], terug: g.terug.slice(0, -1), vooruit: [g.nu, ...g.vooruit] };
}
export function opnieuw<T>(g: Geschiedenis<T>): Geschiedenis<T> {
  if (g.vooruit.length === 0) return g;
  return { nu: g.vooruit[0], terug: [...g.terug, g.nu], vooruit: g.vooruit.slice(1) };
}
/** Na een bewaring of een nieuwe lading van de server: de stand vervangt zich zonder stappen (de stapel blijft enkel als de
 *  nieuwe stand dezelfde is als de oude; anders is wat je ongedaan zou maken niet meer wat de server kent). */
export function leeg<T>(nu: T): Geschiedenis<T> {
  return begin(nu);
}

/** Mag het scherm vanzelf bewaren? Enkel een bewerkbaar stuk (ontwerp), met wijzigingen, zonder fout, niet al bezig en met geldige
 *  invoer. Een ingediend, goedgekeurd of gefactureerd stuk is alleen-lezen en bewaart nooit vanzelf. */
export function vanzelfKan(s: { bewerkbaar: boolean; wijzigingen: number; bezig: boolean; geldig: boolean; fout: boolean }): boolean {
  return s.bewerkbaar && s.wijzigingen > 0 && !s.bezig && s.geldig && !s.fout;
}
