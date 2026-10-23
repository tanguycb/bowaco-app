// Lezen met een vangnet (architectuur §8.1): online het verse antwoord (en lokaal bewaard), zonder bereik de laatste
// bewaarde stand met haar tijdstip ("stand van 07:42"). Enkel voor interne data (Vandaag, het verslag van de dag).
import { useQuery } from "@tanstack/react-query";
import { useBackend } from "../util";
import { cacheGet, cachePut } from "./db";

export type CachedResult<T> = { value: T; at: number; fromCache: boolean };

export function useCached<T>(key: (string | number | boolean)[], fn: () => Promise<T>, enabled = true) {
  const { actor, isFetching } = useBackend();
  const k = key.join("|");
  return useQuery<CachedResult<T>>({
    queryKey: key,
    enabled: enabled && !!actor && !isFetching,
    retry: 0,
    queryFn: async () => {
      try {
        const value = await fn();
        void cachePut(k, value);
        return { value, at: Date.now(), fromCache: false };
      } catch (e) {
        const c = await cacheGet<T>(k);
        if (c) return { value: c.value, at: c.at, fromCache: true };
        throw e;
      }
    },
  });
}

/** Directe URL van een opgeslagen bestand (ook als het object uit de lokale cache komt, zonder methodes). */
export function blobUrlOf(b: unknown): string | undefined {
  if (!b || typeof b !== "object") return undefined;
  const x = b as { directURL?: string; getDirectURL?: () => string };
  return x.directURL ?? x.getDirectURL?.();
}
