import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// WebXR needs a secure context. localhost is already secure (fast desktop loop),
// but the Quest reaches this box over the LAN, which requires HTTPS. Enable a
// self-signed cert on demand with `npm run dev:quest` (HTTPS=true).
const useHttps = process.env.HTTPS === 'true'

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  resolve: {
    // Force a single copy of three. drei's stats-gl and the xr emulator (@iwer/*)
    // pull their own older three versions, which triggers "Multiple instances of
    // Three.js" and can break instanceof checks across the r3f render graph.
    dedupe: ['three'],
  },
  server: {
    host: true, // bind all interfaces so the Quest can reach it over the LAN
    port: 5173,
  },
})
