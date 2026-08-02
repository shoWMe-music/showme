# shoWMe — rebuild (2026)

Live-events **booking + settlement** SaaS. This repo is a **from-scratch rebuild** of the prior Firebase/Firestore
app, built as a **monorepo**. **Status:** scaffolded and substantially built — see **[docs/STATUS.md](./docs/STATUS.md)** for the current build snapshot (what exists, how to run it, what's verified, what's next). Read STATUS.md first; the *why* still lives in decisions.md / story.md.

## The blueprint
The complete architecture, data model, engines, and API surface live in **[PLAN.md](./PLAN.md)** — the single source
of truth. Topic guides are in `.claude/skills/`: `data-model`, `authorization`, `settlement`, `api-conventions`.
**Later product decisions override PLAN.md and live in [docs/decisions.md](./docs/decisions.md)** — read it before
building a subsystem (most recent: the **2026-07-24 session, folded in as #16**).

**The *why* layer — [docs/story.md](./docs/story.md):** the purpose, role, and **boundary** of every actor (what each
account kind is *for* and, crucially, what it is *not*). PLAN.md says *how*; story.md says *what it's for*. When a
product rule isn't written down, **infer it from story.md's purpose/boundary**, not from industry convention.

## Stack (all GCP, covered by Google-for-Startups credits)
- **DB:** Cloud SQL for **PostgreSQL** (europe-north2 / Stockholm) — source of truth. **Drizzle** ORM.
- **API:** **Fastify + Zod** on **Cloud Run** (stateless, scales to zero). `fastify-type-provider-zod`, `drizzle-zod`.
- **Auth:** **Firebase Auth** — token carries only `uid`; verified in a `preHandler`, principal resolved from Postgres per request. **No custom claims.**
- **Realtime:** one **SSE** stream per user (POST to send / SSE to receive) via Postgres **`LISTEN/NOTIFY`**, on a dedicated Cloud Run service.
- **Hosting:** **Firebase Hosting** (SPA + public SSR rewrites → Cloud Run). API on `api.` subdomain; SSE on `stream.` (bypasses the CDN).
- **Files:** **Firebase Storage** (GCS); access via **API-issued signed URLs**; metadata in a `files` table.
- **Email:** **Brevo.** **FX:** exchangerate-api (display only).
- **Frontend:** **React 19 + Vite + TanStack** Router/Query (+ the incoming design). Public pages **full-SSR**'d by a
  separate Vite SSR service (`apps/ssr`) on Cloud Run.
- **Monorepo:** **pnpm** workspaces + **Turborepo**. `apps/` = `api`, `stream`, `web`, `ssr`; `packages/` = `db`,
  `shared`, `auth`, `settlement`, `ui`, `api-client`.
- **Types across the stack:** drizzle-zod → Fastify OpenAPI → **orval**-generated TanStack Query hooks (`packages/api-client`).
- **Tooling:** **Node 22**, **Biome** (lint/format), **Vitest** + **Testcontainers** + **Playwright**, **drizzle-kit**
  migrations, **GitHub Actions** → Cloud Run, **Secret Manager**.

## Core architecture (the through-line)
1. **Relational joins replace document denormalization** — no `accessUids` fan-out, no drift bugs.
2. **One authorization module** (`authorize` + field-level `serialize`) replaces Firestore rules + callable checks + client-side hiding.
3. **Postgres does both** — normalized tables for the queried-across spine; `jsonb` for read-with-parent leaves.
4. **Keep Firebase Auth; Postgres is the brain.**

## Key decisions (detail in PLAN.md)
- **Account kinds** (one per account, fixed at signup): `operator` (venue/promoter/organizer/festival), `performer`, `professional` (crew now; marketplace later), `agent` (booking agent who represents performers — see `docs/decisions.md` #14). Kind gates dashboard / features / pricing.
- **Events** are containers; profiles join as **`event_participants`** (event-role + permission set). No parent/child multi-performer.
- **Deals** are **party-scoped agreements** (`deals` + `deal_parties`, 1..N parties, kind-agnostic). Visibility scoped per `deal_party` (a shared split shows each performer only their own line).
- **Settlement** = reconciliation: budget lines (external cash, `collected_by`/`paid_by`/`payee`) + deals (entitlements) → `entitlement − cash-held → transfers`, with `Σ net = 0`. **One settlement per participant.** Manual overrides, **no escrow**.
- **Currency:** payout currency per deal (authoritative, **locked FX** at finalize) vs. display currency per user (live FX, cosmetic — never touches settled amounts).
- **Authorization:** ReBAC via joins; `permission_sets.capabilities[]` × profile role; **entitlements** (plan limits) are a separate fresh-read layer.
- **AI / assistant layer** (2026-07-24, `docs/decisions.md` #16.14–16.15): a Gemini in-app **assistant** + **agent-native** (bring-your-own-AI) surface, both built on the **`authorize(capability)` catalog exposed as tools** — build manual routes tool-shaped so it's a thin add-on. **Naming: `agent` = the booking-agent account kind ONLY; the AI is `assistant`/`ai`.** Platform is **territory-scoped** (`docs/decisions.md` #17): the boundary is **derived from location** — `country` stamp (tax/PRO/currency) + a configurable **`market`** grouping of countries — enforced softly in `authorize()`; re-drawable country→region→city without migration.

## Conventions
- **Naming: full words, no abbreviations.** `authorize(capability)` not `authorize(cap)`; `capabilities` not `caps`. Readability over brevity — code should be understandable immediately.
- **Business logic** (settlement math, hold ranking) = plain TS modules, framework-agnostic — the API framework never touches the math.
- **Every API route:** verify token → resolve principal → `authorize(capability)` → Zod validate → handle → `serialize(capabilities)` → audit.

## Reference source (do not copy structure)
The prior app at `../showme-settle-fast` is **reference only** — for **proven domain logic** to port verbatim
(`src/lib/settlementParties.ts`, `src/lib/settlementUtils.ts`, `functions/src/holdRankLogic.ts`) and its **test suites**
(the executable spec for edge cases: VAT, guarantee-vs-door, hold promotion). **Do not** carry over its Firestore
structure or the ~1,700 LOC of denormalization/fan-out — that's exactly what this rebuild deletes.
