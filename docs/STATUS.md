# Build status & handoff — 2026-08-02

Point-in-time snapshot of what exists in the repo, how to run it, what's verified, and
what's next. **This supersedes CLAUDE.md's "blueprint only — no code yet" line** (that
line is now stale; the monorepo is scaffolded and substantially built). Read this first
when picking the project back up; the *why* still lives in `decisions.md` / `story.md`.

---

## TL;DR

- **Monorepo is live** — pnpm + Turborepo, Node 22. `pnpm dev` boots the frontends; `pnpm build` / `pnpm test` / `pnpm typecheck` fan out through Turbo.
- **Backend (`apps/api`)** is broad: 33 route modules, an `authorize` + `serialize` layer, and a settlement engine. Has an extensive Vitest suite (Testcontainers/Postgres) — **not run this session** (needs Docker).
- **Design-system** — ~40 Storybook components on the real shoWMe brand tokens (dark, red/gold/cream). Ships a Vite **library build** (`dist/`) consumed by the app.
- **Marketing site (`apps/marketing`)** — 4 static SEO pages, GSAP + canvas scenes. ✅ **27 Playwright tests green.**
- **App (`apps/web`)** — React 19 + TanStack shell + 3 screens, on design-system components. ✅ **5 Playwright tests green.** **Uses mock data — not wired to the API yet.**
- **Biggest open seam:** `apps/web` ↔ `apps/api` are not connected. No generated api-client, no auth wiring in the app.

---

## Monorepo map

```
apps/
  api/         Fastify + Zod API. 33 routes, authorize/serialize/settlement libs. Vitest + Testcontainers.
  stream/      SSE service (Postgres LISTEN/NOTIFY). token-verifier + pubsub.
  jobs/        Cron-style jobs: exchange-rate refresh, reapers (hold/expiry sweeps).
  marketing/   Static Vite MPA landing site (SEO). GSAP + vanilla canvas. ✅ 27 e2e.
  web/         React 19 + TanStack Router/Query app. Shell + Dashboard/Events/EventDetail. ✅ 5 e2e. Mock data.
packages/
  db/          Drizzle schema (14 schema files) + client + test helpers. Source of truth for the data model.
  settlement/  Framework-agnostic settlement math: reconcile, representation, transfers, entitlement, ticketing.
  auth/        Auth helpers.
  gdpr/        GDPR helpers (consent/erasure surface).
  shared/      Cross-cutting types/utilities.
  time/        Timezone/schedule helpers.
design-system/ ~40 Storybook components (atoms/molecules/organisms) + tokens. Vite lib build → dist/.
docs/          Decisions & specs (see "Decision docs" below). docs/design/ = Organic snapshot (reference).
```

Workspace globs (`pnpm-workspace.yaml`): `apps/*`, `packages/*`, `design-system`.

---

## Status by area

| Area | State | Notes |
|---|---|---|
| Monorepo tooling | ✅ Built | Turbo tasks: build / typecheck / test / lint / **dev** (new). Biome. tsconfig.base strict. |
| `packages/db` schema | ✅ Built | 14 Drizzle schema files (identity, events, deals, settlement, authorization, monetization, comms, sharing, inbound, invitations, content, infra, enums). |
| `packages/settlement` | ✅ Built | Pure TS math with its own unit tests (`reconcile.test.ts`, `representation.test.ts`). |
| `apps/api` | ✅ Broad | 33 routes + `lib/authorize.ts` + `serialize/*` + settlement/commission. Has full `.test.ts` suite. **Tests not run this session (needs Docker/Testcontainers).** |
| `apps/stream` | ✅ Scaffolded | SSE app + pubsub + token-verifier, with tests. |
| `apps/jobs` | ✅ Scaffolded | exchange-rate + reapers, with tests. |
| `design-system` | ✅ Built | Storybook + Vite lib build. Brand tokens unified (primitives + semantic, dark default). |
| `apps/marketing` | ✅ Built + verified | 4 pages, SEO (OG/JSON-LD/sitemap/robots), GSAP reveals, canvas scenes. 27 e2e green. |
| `apps/web` | ✅ Shell + 3 screens | AppShell + Dashboard/Events/EventDetail. Theme toggle. 5 e2e green. **Mock data.** |
| web ↔ api wiring | ❌ Not started | No `packages/api-client` (orval), no fetch layer, no Firebase Auth in the app. |
| CI (GitHub Actions) | ❌ Not started | No `.github/workflows`. |
| Deploy (Cloud Run / Firebase Hosting) | ❌ Not started | Infra not provisioned. |

---

## Commands

```bash
# Frontends together (marketing :5173, web :5174). Builds design-system dist first.
pnpm dev
pnpm dev:all                      # + apps/api, apps/stream (need DB/env)

# Single target
pnpm --filter @showme/web dev
pnpm --filter @showme/marketing dev
pnpm --filter @showme/design-system storybook   # :6006

# Quality gates (Turbo, all workspaces)
pnpm build
pnpm typecheck
pnpm test
pnpm lint                          # biome

# E2E (Playwright, self-serves via build && preview)
pnpm --filter @showme/marketing test    # :4173
pnpm --filter @showme/web test          # :4174
```

---

## Verified this session

- `apps/marketing`: **27 Playwright passed / 1 skipped** (mobile-nav, hidden by design).
- `apps/web`: **5 Playwright passed** (shell renders + no JS/404 errors, sidebar→Events nav, row→EventDetail, tab switching incl. Settlement math, theme toggle).
- `design-system` + `apps/web` **typecheck clean**; both **build**.
- `pnpm dev` boots both frontends → each serves HTTP 200.

**Not run this session:** `apps/api` / `packages/*` Vitest suites (need Docker for Testcontainers/Postgres). Status there is "code + tests present, unrun by me."

---

## Known gaps & TODOs

1. **Wire `apps/web` to `apps/api`.** Currently `apps/web/src/data/mock.ts`. Plan (PLAN.md): drizzle-zod → Fastify OpenAPI → orval → `packages/api-client` TanStack Query hooks. Add Firebase Auth token flow in the app shell.
2. **Marketing lead form** posts to a stub — set `VITE_LEAD_ENDPOINT` + a server handler (ClickUp forwarding is server-side).
3. **Placeholder domain** `showme.example` in `apps/marketing` canonical/sitemap/robots — swap for the real domain.
4. **Founder photo** in `apps/marketing/about.html` reuses the Organic reference image; needs a real one.
5. **Fonts** are CDN (Google + Fontshare) — fine for SEO; self-host later if desired.
6. **CI/CD** — no GitHub Actions or Cloud Run/Firebase Hosting deploy yet.
7. **design-system in dev** is consumed as built `dist/` — editing a component during `pnpm dev` needs `pnpm --filter @showme/design-system build` to propagate (or add a src alias in web's dev config for HMR).
8. **Run the backend test suite** once Docker is available to confirm the API/settlement status.

---

## Decision docs (the source of truth for *why*)

`decisions.md` (esp. **#16** the 2026-07-24 fold-in and **#17** territory scoping) and later docs
**override** PLAN.md and the reference app. Read the relevant one before building a subsystem:

- `docs/decisions.md` — chronological product decisions (most recent wins).
- `docs/story.md` — purpose/role/**boundary** of every actor.
- `docs/design-brief.md` — visual/UX direction.
- `docs/gdpr.md` — consent model incl. per-recipient RSVP capture.
- `docs/money.md` / `docs/payments.md` — currency, FX, settlement money rules.
- `docs/story.md`, `docs/agent-representation.md`, `docs/off-platform-access.md`, `docs/timezones.md`, `docs/api-routes-plan.md`, `docs/db-build-plan.md` — subsystem specs.
- `docs/design/` — snapshot of the old **Organic** Claude Design system (reference only; the live brand is `design-system/`).

---

## Claude Design sync

The Claude Design project **"Organic"** (`96aa0fe3-e434-48db-9e8d-f90f68bd6149`) is being brought
up to date so UI work can continue there in parallel:

- **Full component re-sync** of the repo's real `design-system/` (Storybook shape) into the project — **done 2026-08-02**.
- **28 components** uploaded (14 atoms · 12 molecules · 2 organisms), all graded **match** against the storybook reference; validate clean.
- Old Organic system preserved as a **`reference/organic/`** look-book inside the same project (its `@dsCard` markers stripped so it doesn't register as buildable shoWMe cards).
- Durable sync state committed under `.design-sync/`: `config.json`, `NOTES.md`, `conventions.md`, `preview-provider.tsx`. Re-run with **`/design-sync`** (fast — anchored; unchanged components skip).

**Manual step left for you:** rename the project **Organic → shoWMe** in the Claude Design UI (the sync tool can't rename projects). Project: https://claude.ai/design/p/96aa0fe3-e434-48db-9e8d-f90f68bd6149

---

## Suggested next steps (in rough order)

1. Finish the Claude Design re-sync; rename the project to shoWMe in the UI.
2. Run the backend test suite (Docker) → record real API/settlement status here.
3. Stand up `packages/api-client` (orval from the Fastify OpenAPI) and wire `apps/web` to real data.
4. Add Firebase Auth to the app shell (token → `preHandler` principal resolution already exists API-side).
5. CI (GitHub Actions) → Cloud Run + Firebase Hosting; Secret Manager wiring.
