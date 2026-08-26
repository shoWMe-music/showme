# shoWMe — rebuild (2026)

Live-events **booking + settlement** SaaS. This repo is a **from-scratch rebuild** of the prior Firebase/Firestore
app, built as a **monorepo**. **Status:** scaffolded and substantially built, with the API and web app deployed. Start with
**[docs/handoff-2026-08-25-remaining-work.md](./docs/handoff-2026-08-25-remaining-work.md)** (what is
left), then **[docs/deployment-status.md](./docs/deployment-status.md)** (what is live) and
**[docs/STATUS.md](./docs/STATUS.md)** (the 2026-08-02 build snapshot, now partly stale). The *why*
still lives in decisions.md / story.md.

## The blueprint
The complete architecture, data model, engines, and API surface live in **[PLAN.md](./PLAN.md)** — the single source
of truth. Topic guides are in `.claude/skills/`: `data-model`, `authorization`, `settlement`, `api-conventions`.
**Before calling anything done, read `verify-e2e`** — how a change is proven against the running stack
(with `app-walkthrough` for the browser half and `ui-testing` for authoring specs).
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
- **Account kinds** (one per account, fixed at signup): `operator` (venue/promoter/organizer/festival), `performer`, `team_and_crew` (crew now; marketplace later), `agent` (booking agent who represents performers — see `docs/decisions.md` #14). Kind gates dashboard / features / pricing.
- **Events** are containers; profiles join as **`event_participants`** (event-role + permission set). No parent/child multi-performer.
- **Deals** are **party-scoped agreements** (`deals` + `deal_parties`, 1..N parties, kind-agnostic). Visibility scoped per `deal_party` (a shared split shows each performer only their own line).
- **Settlement** = reconciliation: budget lines (external cash, `collected_by`/`paid_by`/`payee`) + deals (entitlements) → `entitlement − cash-held → transfers`, with `Σ net = 0`. **One settlement per participant.** Manual overrides, **no escrow**.
- **Currency:** payout currency per deal (authoritative, **locked FX** at finalize) vs. display currency per user (live FX, cosmetic — never touches settled amounts).
- **Authorization:** ReBAC via joins; `permission_sets.capabilities[]` × profile role; **entitlements** (plan limits) are a separate fresh-read layer.
- **AI / assistant layer** (2026-07-24, `docs/decisions.md` #16.14–16.15): a Gemini in-app **assistant** + **agent-native** (bring-your-own-AI) surface, both built on the **`authorize(capability)` catalog exposed as tools** — build manual routes tool-shaped so it's a thin add-on. **Naming: `agent` = the booking-agent account kind ONLY; the AI is `assistant`/`ai`.** Platform is **territory-scoped** (`docs/decisions.md` #17): the boundary is **derived from location** — `country` stamp (tax/PRO/currency) + a configurable **`market`** grouping of countries — enforced softly in `authorize()`; re-drawable country→region→city without migration.

## Review gate — after every agent, before the work is accepted
An agent finishing is not the work landing. Review its diff against the bar below **before** committing it,
and fix or hand back what fails. This is cheapest at the moment of introduction, while the diff is small and
attributable to one change.
- **Reuse over repetition — but only for real repetition.** Three or more existing call sites, not a
  speculative second one. A helper with one call site is worse than the lines it replaced.
- **Components stay dumb.** Fetching, mutation and derivation belong in a `use*` hook; the component takes
  values and emits events. A component that also owns its data is the thing to split.
- **Nothing hand-rolls what the design system has.** A local `fieldStyle`, a private clipboard helper, a
  second money formatter — each is a divergence that will drift.
- **Prefer deleting.** Dead exports, dead affordances and unused branches are a bigger win than any extraction.
- **Do not overdo it.** A long file that reads top to bottom beats six files you must hold at once. Over-
  abstraction is a worse outcome than length.
Findings that are not worth acting on immediately go in `docs/codebase-reuse-audit.md`, including **what was
deliberately left alone and why** — that section is what stops the next pass re-litigating the same calls.

## Conventions
- **Naming: full words, no abbreviations.** `authorize(capability)` not `authorize(cap)`; `capabilities` not `caps`. Readability over brevity — code should be understandable immediately.
- **Business logic** (settlement math, hold ranking) = plain TS modules, framework-agnostic — the API framework never touches the math.
- **Every API route:** verify token → resolve principal → `authorize(capability)` → Zod validate → handle → `serialize(capabilities)` → audit.

## Reference source (do not copy structure)
The prior app at `../showme-settle-fast` is **reference only** — for **proven domain logic** to port verbatim
(`src/lib/settlementUtils.ts`, `functions/src/holdRankLogic.ts`). **Do not** carry over its Firestore structure or the
denormalization/fan-out — that's exactly what this rebuild deletes. The ~1,700 LOC figure is if anything conservative:
measured 2026-08-26, the `accessUids` family alone is 992 LOC, all maintained copies 2,104, and 3,208 counting
notification fan-out — plus 3,591 LOC of repair and forensic scripts, and 25 of its 40 composite indexes existing only
to serve the access arrays.

**`settlementParties.ts` was on this list and has been removed from it.** It is not domain logic: its whole job is
folding away a phantom "Promoter" card that `calculateSettlement` emits unconditionally because the old party
vocabulary was hardcoded (`promoter | venue | organizer | artist`). `deal_parties` dissolves that problem, so porting
the helper would import a workaround for a bug we do not have.

**Correction, 2026-08-26 — this file used to call the old test suites "the executable spec for edge cases: VAT,
guarantee-vs-door, hold promotion". They are not, and building on that belief wasted effort.** Measured: 55 test files,
**0** referencing `calculateSettlement`, **0** referencing guarantee-vs-door. VAT appears in 10 test files but is never
*computed* anywhere in the money core — `VatInfo` is attached to fields and read only by a text-suffix renderer.
`functions/src/holdRankLogic.test.ts` is real, but `vitest.config.ts:11` scopes `include` to `src/**`, so it and the
other four `functions/` suites have never run in that repo's CI either. The hold-promotion half of the old claim is the
only part that survives, and even it was never enforced.

Treat the old app's BEHAVIOUR as the reference, established by executing `calculateSettlement` directly — not its
tests. The findings from doing exactly that are in `docs/old-app-analysis-settlement.md`.
