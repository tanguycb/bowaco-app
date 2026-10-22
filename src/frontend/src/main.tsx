import { InternetIdentityProvider } from "@caffeineai/core-infrastructure";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

declare global {
  interface BigInt {
    toJSON(): string;
  }
}
BigInt.prototype.toJSON = function () {
  return this.toString();
};

const queryClient = new QueryClient();

// withAttributes={false}: geen e-mail of naam uit II opvragen (§1: login zonder e-mailadres).
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <InternetIdentityProvider withAttributes={false}>
      <App />
    </InternetIdentityProvider>
  </QueryClientProvider>,
);
