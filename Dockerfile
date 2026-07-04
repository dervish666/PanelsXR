# syntax=docker/dockerfile:1

# --- stage 1: build the static WebXR app ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- stage 2: serve it. Caddy handles static files + the env-driven Komga
#     proxy in one tiny binary (reads KOMGA_URL / KOMGA_API_KEY at runtime). ---
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
# caddy:alpine's default entrypoint runs `caddy run` against /etc/caddy/Caddyfile
