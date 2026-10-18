import { defineConfig } from "vite";

export default defineConfig({
  // относительные пути — работает и на <user>.github.io/<repo>/
  base: "./",
  define: { global: "globalThis" },
  server: { allowedHosts: true },
  build: { target: "es2022" },
});
