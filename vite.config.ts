import { defineConfig } from "vite";

export default defineConfig({
  base: "/strategic-notebook/",
  build: { rollupOptions: { input: ["index.html", "legacy/index.html"] } },
});
