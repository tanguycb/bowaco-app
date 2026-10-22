// Prototype 0.5: los van de app-build (Caffeine bouwt alleen src/). Bouwen: zie tools/bouw-prototype.mjs.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react()],
  build: {
    outDir: process.env.PROTO_OUT || "../dist-prototype",
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100000,
    rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: "proto.js", assetFileNames: "proto.[ext]" } },
  },
});
