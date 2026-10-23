// Vervangt @caffeineai/core-infrastructure in de UI-proef (zie vite.config.ts). Zelfde vorm als het
// echte pakket: InternetIdentityProvider, useInternetIdentity, useActor, loadConfig.
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
// @ts-expect-error: rechtstreeks uit de dist van het echte pakket (zelfde actor- en opslaglogica)
import { createActorWithConfig, loadConfig } from "../node_modules/@caffeineai/core-infrastructure/dist/config.js";

export { createActorWithConfig, loadConfig };

type Ctx = {
  identity: Ed25519KeyIdentity | undefined;
  isAuthenticated: boolean;
  isInitializing: boolean;
  isLoggingIn: boolean;
  isLoginError: boolean;
  loginError: Error | undefined;
  login: (o?: unknown) => void;
  clear: () => void;
};
const C = createContext<Ctx | null>(null);

export function InternetIdentityProvider({ children }: { children: ReactNode; withAttributes?: boolean }) {
  const als = new URLSearchParams(window.location.search).get("als");
  const [identity, setIdentity] = useState<Ed25519KeyIdentity | undefined>();
  const [init, setInit] = useState(!!als);
  useEffect(() => {
    if (!als) return;
    fetch(`/__proef/${als}`)
      .then((r) => r.text())
      .then((j) => setIdentity(Ed25519KeyIdentity.fromJSON(j)))
      .finally(() => setInit(false));
  }, [als]);
  const value: Ctx = {
    identity,
    isAuthenticated: !!identity,
    isInitializing: init,
    isLoggingIn: false,
    isLoginError: false,
    loginError: undefined,
    login: () => { window.location.search = "?als=admin"; },
    clear: () => { window.location.search = ""; },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useInternetIdentity(): Ctx {
  return useContext(C)!;
}

export function useActor<T>(createActor: unknown): { actor: T | null; isFetching: boolean } {
  const { identity } = useInternetIdentity();
  const q = useQuery({
    queryKey: ["actor", identity?.getPrincipal().toText()],
    queryFn: () => createActorWithConfig(createActor, identity ? { agentOptions: { identity } } : {}),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { actor: (q.data as T) ?? null, isFetching: q.isFetching };
}
