import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  build: {
    target: "es2022",
  },
  resolve: {
    alias: {
      "@tailscale/connect": fileURLToPath(
        new URL("./vendor/tailscale-connect", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
  server: {
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  },
})
