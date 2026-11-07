import { proefbank } from "./proefbank.ts";
import { routering } from "./routering.ts";
import { stubs } from "./stubs.ts";
import type { TaakDef } from "./taak.ts";

export type Taken = Map<string, TaakDef>;
export const standaardTaken = (): Taken => new Map([routering, proefbank, ...stubs].map((t) => [t.key, t]));
