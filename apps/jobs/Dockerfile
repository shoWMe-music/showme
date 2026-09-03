# The scheduled jobs, as a Cloud Run Job.
#
# Same shape the API uses: esbuild has already bundled `src/index.ts` and every
# dependency into one self-contained `dist/index.mjs`, so the runtime image is Node
# and that single file — no `node_modules`, no install step, no lockfile in the
# image.
#
# BUILD CONTEXT IS `apps/jobs`, not the repo root. The root `.gcloudignore` excludes
# `dist/`, so building from there would silently upload everything EXCEPT the bundle
# this image exists to carry, and the container would fail at runtime on a missing
# file rather than at build time on an obvious one.
#
#   pnpm --filter @showme/jobs build
#   gcloud builds submit apps/jobs --tag <image> --project prod-showme
#
# It exits when the work is done. That is why this is a Cloud Run *Job* and not a
# service: it serves no traffic and listens on no port, so a service would fail its
# startup probe forever.
FROM node:22-slim

WORKDIR /app

COPY dist/index.mjs ./index.mjs

# No shell form: the process IS the container, so a non-zero exit from
# `runScheduledJobs` becomes a failed execution that Cloud Run will retry once.
CMD ["node", "index.mjs"]
