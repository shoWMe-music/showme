# API container for Cloud Run. Lives at the repo ROOT so the build context is the
# whole workspace (the esbuild bundle pulls in the @showme/* TS source). Deploy with:
#   gcloud run deploy showme-api --source .            (Cloud Build uses this Dockerfile)
# or build locally:  docker build -t showme-api .
# One self-contained dist/server.mjs; runtime is just Node + that file.
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
