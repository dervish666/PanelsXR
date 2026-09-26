/// <reference types="vite/client" />

interface ImportMetaEnv {
  // '1' only in the hosted Cloudflare Worker build — gates the BYO setup/pairing
  // flow so the Docker/Caddy container build behaves exactly as before.
  readonly VITE_BYO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
