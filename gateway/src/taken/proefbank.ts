// Taak "proefbank" (ontwerp §3.9): geen leverancier. De invoer is de SAMENVATTING van een proefbankrun (cijfers, geen
// documenten); de gateway controleert het schema en schrijft ze als voorstel `kind = "proefbank"` in de app.
import type { TaakDef } from "./taak.ts";

export const proefbankSchema = {
  type: "object",
  additionalProperties: false,
  required: ["workerKey", "model", "versie", "gevallen", "score", "kostCent", "duurMs"],
  properties: {
    workerKey: { type: "string", maxLength: 40 },
    model: { type: "string", maxLength: 60 },
    versie: { type: "integer", minimum: 1 },
    gevallen: { type: "integer", minimum: 0 },
    score: { type: "number", minimum: 0, maximum: 1 },
    kostCent: { type: "integer", minimum: 0 },
    duurMs: { type: "integer", minimum: 0 },
    perGeval: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["geval", "score"],
        properties: { geval: { type: "string", maxLength: 40 }, score: { type: "number", minimum: 0, maximum: 1 }, uitkomst: { type: "string", maxLength: 20 } },
      },
    },
  },
};

export const proefbank: TaakDef = {
  key: "proefbank",
  actief: true,
  kind: "proefbank",
  zonderLeverancier: true,
  bestanden: { max: 0, soorten: [] },
  modellen: [],
  standaardModel: "",
  terugval: false,
  instructies: { 1: { schemaVersie: 1, maxUit: 0, systeem: "", schema: proefbankSchema } },
  voorbeeld: { workerKey: "routering", model: "nep/echo", versie: 1, gevallen: 3, score: 1, kostCent: 0, duurMs: 3 },
};
