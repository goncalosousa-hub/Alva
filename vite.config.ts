import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_PORT = Number(process.env.PORT ?? 3417);

export default defineConfig({
  root: "src/client",
  publicDir: "public",
  plugins: [react()],
  resolve: {
    // Direct access to Monaco's ESM sources, for the slim editor build (src/client/monaco-slim.ts).
    alias: [{ find: /^monaco-esm\//, replacement: fileURLToPath(new URL("./node_modules/monaco-editor/esm/vs/", import.meta.url)) }],
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
  },
  worker: {
    format: "es",
    // abaplint registers its statements by class name: minification must not rename classes.
    rolldownOptions: { output: { keepNames: true } },
  },
  server: {
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${API_PORT}` },
  },
});
