import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  // Packaged Electron loads dist/index.html over file://, so asset URLs must
  // stay relative. This also works unchanged under Vite's dev server.
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { port: 4790 },
  // Local-only app: xterm + React in one chunk is fine.
  build: { chunkSizeWarningLimit: 1000 },
  // The contracts package ships raw TypeScript sources; keep it out of the
  // dependency pre-bundler so Vite compiles it through the normal pipeline.
  optimizeDeps: { exclude: ["@hangar/contracts"] },
})
