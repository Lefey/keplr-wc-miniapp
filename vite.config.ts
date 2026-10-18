import { execSync } from "node:child_process";
import { defineConfig } from "vite";

const sha = (process.env.GITHUB_SHA ?? execSync("git rev-parse HEAD").toString()).trim().slice(0, 7);
const BUILD = `${sha} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;

export default defineConfig({
  // относительные пути — работает и на <user>.github.io/<repo>/
  base: "./",
  define: { global: "globalThis", __BUILD__: JSON.stringify(BUILD) },
  server: { allowedHosts: true },
  build: { target: "es2022" },
});
