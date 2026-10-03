FROM node:24-slim AS build
WORKDIR /repo
# Optional build secret "ca": an extra CA bundle for machines behind a TLS-inspecting proxy
# (docker build --secret id=ca,src=$NODE_EXTRA_CA_CERTS …). Never stored in the image; CI builds without it.
RUN --mount=type=secret,id=ca \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    npm install -g pnpm@10.28.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
RUN --mount=type=secret,id=ca \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --filter server
COPY shared shared
COPY src/lib src/lib
COPY server server
RUN pnpm --filter server build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production MIGRATIONS_DIR=/app/migrations PORT=8787
COPY --from=build /repo/server/dist ./dist
COPY server/migrations ./migrations
COPY data/projects.csv ./data/projects.csv
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
