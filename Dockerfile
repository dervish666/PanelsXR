# syntax=docker/dockerfile:1

# --- stage 1: build the static WebXR app ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- stage 2: serve it. Caddy handles static files + the env-driven Komga
#     proxy + optional basic auth, all read at runtime. ---
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
COPY docker-entrypoint.sh /usr/local/bin/panel-entrypoint.sh
RUN chmod +x /usr/local/bin/panel-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/panel-entrypoint.sh"]
