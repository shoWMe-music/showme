# API container for Cloud Run. Build CONTEXT is the repo ROOT (the esbuild bundle
# pulls in the @showme/* workspace TS source), so build with:
#   docker build -f apps/api/Dockerfile -t showme-api .
# The build stage bundles everything into one self-contained dist/server.mjs; the
# runtime stage is just Node + that file — no node_modules, tiny and fast to start.
# syntax=docker/dockerfile:1

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
# Copy the whole workspace (a repo-root .dockerignore keeps node_modules, builds,
# secrets and test junk out) so pnpm can resolve the full workspace graph, then
# install just what the API needs and bundle it.
COPY . .
RUN pnpm install --frozen-lockfile --filter @showme/api...
RUN pnpm --filter @showme/api build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
# Cloud Run injects PORT (defaults to 8080); HOST defaults to 0.0.0.0 in config.ts.
WORKDIR /app
COPY --from=build /repo/apps/api/dist/server.mjs ./server.mjs
EXPOSE 8080
# Run as the non-root node user baked into the image.
USER node
CMD ["node", "server.mjs"]
