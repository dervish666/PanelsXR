/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// WebXR needs a secure context. localhost is already secure (fast desktop loop),
// but the Quest reaches this box over the LAN, which requires HTTPS. Enable a
// self-signed cert on demand with `npm run dev:quest` (HTTPS=true).
const useHttps = process.env.HTTPS === 'true'

export default defineConfig(({ mode }) => {
  // KOMGA_URL / KOMGA_API_KEY are deliberately NOT VITE_-prefixed: they are read
  // here (server-side) only and never reach the client bundle. The dev server
  // proxies /komga/* to the real server and injects the API key, so the browser
  // sees only same-origin URLs — no CORS, no credentials in client code.
  const env = loadEnv(mode, process.cwd(), '')
  const komgaUrl = env.KOMGA_URL
  const komgaKey = env.KOMGA_API_KEY

  return {
    plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
    // Smoke tests guard the pure, headset-independent logic (Komga URL 1-indexing,
    // .cbz page ordering). The on-device r3f/XR behaviour (material-recompile keying,
    // grab-Handle siblings, pose-drag) can't be unit-tested — it's guarded by CLAUDE.md
    // + the vault's webxr-r3f-patterns note and verified in-headset. `npm run build`
    // (tsc --noEmit) remains the type/compile gate.
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
    resolve: {
      // Force a single copy of three. drei's stats-gl and the xr emulator (@iwer/*)
      // pull their own older three versions, which triggers "Multiple instances of
      // Three.js" and can break instanceof checks across the r3f render graph.
      dedupe: ['three'],
    },
    server: {
      host: true, // bind all interfaces so the Quest can reach it over the LAN
      port: 5173,
      proxy: komgaUrl
        ? {
            '/komga': {
              target: komgaUrl,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/komga/, ''),
              headers: komgaKey ? { 'X-API-Key': komgaKey } : undefined,
            },
          }
        : undefined,
    },
  }
})
