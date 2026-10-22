import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import environment from "vite-plugin-environment";

// Caffeine injecteert II_URL en de backend-gegevens bij het serveren (env.json).
process.env.II_URL = process.env.II_URL || "https://id.ai/authorize";
process.env.STORAGE_GATEWAY_URL = process.env.STORAGE_GATEWAY_URL || "https://blob.caffeine.ai";

export default defineConfig({
  plugins: [
    environment("all", { prefix: "CANISTER_" }),
    environment("all", { prefix: "DFX_" }),
    environment(["II_URL"]),
    environment(["STORAGE_GATEWAY_URL"]),
    react(),
  ],
  build: { outDir: "dist", emptyOutDir: true },
  optimizeDeps: { esbuildOptions: { define: { global: "globalThis" } } },
  resolve: { dedupe: ["@icp-sdk/core"] },
});
