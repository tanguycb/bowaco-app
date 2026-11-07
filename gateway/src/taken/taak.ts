// Taakdefinitie per workerKey (ontwerp §3.1/§3.2): welke bestanden, welk schema, welke instructieversies, welke
// modellen. Dezelfde definities dienen voor /v2/taak en voor de proefbank. Een nieuwe instructieversie = nieuwe code;
// nooit vrije tekst uit de app.
import type { Bestand, Soort } from "../bestanden.ts";

export type Schema = Record<string, unknown>;
export type InstructieVersie = { systeem: string; schema: Schema; schemaVersie: number; maxUit: number; inspanning?: "low" | "medium" | "high" };

export type TaakDef = {
  key: string;
  actief: boolean; // stubs voor 3.6/3.8–3.11 staan uit → 422 taak
  kind?: string; // soort van het voorstel; standaard "ai:<key>"
  zonderLeverancier?: boolean; // proefbank: de invoer IS het voorstel (samenvatting), geen AI-oproep
  bestanden: { max: number; soorten: Soort[] };
  modellen: string[]; // toegelaten "<leverancier>/<model>" voor deze taak (ook voor terugval)
  standaardModel: string;
  terugval: boolean; // terugval naar een 2e leverancier binnen de gateway mag voor deze taak
  instructies: Record<number, InstructieVersie>;
  voorbeeld: unknown; // vast voorbeeld-JSON (nep-leverancier, droge runs)
  voorbewerking?: (b: Bestand[]) => Promise<string>; // haakje voor spraak (3.6)
};

// Kleine JSON-schema-controle (subset die de taken gebruiken): type, properties, required, additionalProperties:false,
// enum, items, minimum/maximum, maxLength. Uitvoer van een leverancier die niet past wordt nooit een voorstel.
export function valideer(s: Schema, v: unknown, pad = "$"): string | null {
  const types = ([] as string[]).concat((s.type as string | string[] | undefined) ?? []);
  const soort = v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
  if (types.length && !types.some((t) => t === soort || (t === "number" && soort === "integer"))) return `${pad}: ${soort} in plaats van ${types.join("|")}`;
  if (s.enum && !(s.enum as unknown[]).includes(v)) return `${pad}: waarde niet toegelaten`;
  if (typeof v === "number") {
    if (typeof s.minimum === "number" && v < s.minimum) return `${pad}: te klein`;
    if (typeof s.maximum === "number" && v > s.maximum) return `${pad}: te groot`;
  }
  if (typeof v === "string" && typeof s.maxLength === "number" && v.length > s.maxLength) return `${pad}: te lang`;
  if (soort === "array" && s.items) {
    for (const [i, x] of (v as unknown[]).entries()) {
      const f = valideer(s.items as Schema, x, `${pad}[${i}]`);
      if (f) return f;
    }
  }
  if (soort === "object") {
    const o = v as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, Schema>;
    for (const r of (s.required as string[] | undefined) ?? []) if (!(r in o)) return `${pad}.${r}: ontbreekt`;
    for (const [k, x] of Object.entries(o)) {
      if (props[k]) {
        const f = valideer(props[k], x, `${pad}.${k}`);
        if (f) return f;
      } else if (s.additionalProperties === false) return `${pad}.${k}: niet in het schema`;
    }
  }
  return null;
}
