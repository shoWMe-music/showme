# shoWMe — rebuild (2026)

Live-events **booking + settlement** SaaS. This repo is a **from-scratch rebuild** of the prior Firebase/Firestore
app, built as a **monorepo**. **Status:** scaffolded and substantially built, with the API and web app deployed.

**START HERE: [docs/handoff-2026-09-28-urgent-board.md](./docs/handoff-2026-09-28-urgent-board.md)** —
the most recent state (2026-09-27 → 28). 86 commits working the urgent board through
`docs/clickup-urgent-audit-2026-09-27.md`, four QA sweeps folded back in, and **seven open
decisions in `decisions.md` §25.6 that only Ran or Daniel can make** — the seventh deliberately
without a recommendation. Nothing deployed; nothing written to ClickUp. It also carries the
lessons this file does not yet: two ways a *mutation* check lies, a test that pinned a false
belief and hid a major, and a fixture whose absolute date made it fail at midnight.

**Then: [docs/handoff-2026-09-21-sse-costs-and-settlement.md](./docs/handoff-2026-09-21-sse-costs-and-settlement.md)** —
the state of the DEPLOYED app, which the urgent-board stretch above did not change (it deployed
nothing). Realtime (SSE) is LIVE for the first time and the app is served from
`api.showme.music`; `main` is clean and fully deployed. It carries the one thing to pick up
first (**Ran's 2026-09-21 spec: the budget fee must appear from the DRAFT deal, before
confirmation — not built**), a correction to this file's own advice about the load balancer,
and the running-cost model. **Ignore any older doc telling you to tear the load balancer
down: it serves `api.showme.music` and always did.**

**Going to work on settlements? Start with
[docs/handoff-2026-09-15-settlement-built.md](./docs/handoff-2026-09-15-settlement-built.md)** —
the surface was built from Ran's design on 2026-09-15, **two rules were reversed in
doing it** (decisions.md **#24**: the waterfall, and an operator's power to open the
books), and production still holds **zero** settlement lines. Then
**[docs/design-settlement-2026-09-10.md](./docs/design-settlement-2026-09-10.md)** for the
design itself and where it disagrees with itself, and
[docs/plan-settlement-2026-09-15.md](./docs/plan-settlement-2026-09-15.md) for what is
still open. `docs/handoff-2026-09-14-settlement-surface.md` is the snapshot from the day
before and is now largely superseded.

**[docs/handoff-2026-08-27-ran-list-state.md](./docs/handoff-2026-08-27-ran-list-state.md)** is an older snapshot —
superseded by the 2026-09-21 handoff above on anything they disagree about, but still the fullest record of: what is deployed versus merely committed, the three pending migrations (one of
which drops a table, guarded), the ClickUp writes owed, and the findings that are recorded nowhere else.
Then **[docs/deployment-status.md](./docs/deployment-status.md)** (what is live).
`docs/handoff-2026-08-25-remaining-work.md` and **[docs/STATUS.md](./docs/STATUS.md)** are older snapshots,
now partly stale. The *why* still lives in decisions.md / story.md.

**A handoff doc is a snapshot of a moment, not a statement about the present.** Four of them here describe a
working tree that has since been committed, deployed or fixed, and trusting one cost a full session on
2026-08-27: it said the Budget Planner "never writes", which had been false since `e64e438`, and the claim
was repeated into a scoping doc, a commit message and a ticket before anyone checked the code. Check the
code before you scope from prose.

## The blueprint
The complete architecture, data model, engines, and API surface live in **[PLAN.md](./PLAN.md)** — the single source
of truth. Topic guides are in `.claude/skills/`: `data-model`, `authorization`, `settlement`, `api-conventions`.
**If the work came from a ClickUp ticket — which is nearly all of it — follow `ticket-to-commit`.** It is
the standing loop, not an option: check the ticket against the code before scoping it, build, prove it,
write the finding back to the ticket, and commit naming the ticket. Measured 2026-09-04: of twenty open
bug tickets, **nine did not say what they appeared to say** — one `low` ticket was the root cause of an
`urgent` one, one urgent ticket was already ~90% shipped, and three separate urgent tickets were a single
missing mechanism. None of that is visible from the board.
**Before calling anything done, read `verify-e2e`** — how a change is proven against the running stack
(with `app-walkthrough` for the browser half and `ui-testing` for authoring specs).
**Before building any screen meant to match the design, read `claude-design`** — the prototype is
rendered, never read: it is a `<x-dc>` runtime app, `file://` is blocked, and DesignSync cannot
fetch it. Building from a written description of it has gone wrong twice.
**Later product decisions override PLAN.md and live in [docs/decisions.md](./docs/decisions.md)** — read it before
building a subsystem. **Most recent: #24 (2026-09-15), which REVERSES part of #23 and amends
story.md:44** — the two rules a settlement session is most likely to trip over.

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
- **Frontend:** **React 19 + Vite + TanStack** Router/Query (+ the incoming design).
  **`apps/ssr` DOES NOT EXIST and never has** (`docs/cicd-plan.md:49` — PLAN.md's full-SSR public
  service is unbuilt). The public profile and event pages are **`apps/marketing`**, a plain Vite
  static site that fetches `/public/*` from the **browser** after load. This line used to claim
  otherwise and cost an agent a wrong conclusion on 2026-08-31 (it reasoned about caching a
  server-rendered page that does not exist) — do not re-inherit it.
- **Monorepo:** **pnpm** workspaces + **Turborepo**. `apps/` = `api`, `stream`, `web`, `marketing`, `jobs`; `packages/` = `db`,
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

## A mutation check can lie, and a test can pin a false belief
Mutation testing is the standard here for *"can this test fail on this line"*, and it mis-answered
twice on 2026-09-28 (`docs/handoff-2026-09-28-urgent-board.md` has the detail):
- **A first-match replace can mutate the wrong occurrence.** Deleting a filter reported green
  twice; the same string sat twenty lines earlier in a sibling function, and that is where the edit
  landed. **Anchor the replacement on surrounding lines and assert the match count is 1.**
- **A mutation survives when every test happens to satisfy the clause another way.** Twelve
  survivors in one stretch, each a filter that looked covered — one venue, one room, one date in
  every fixture, or a payee that was invisible for a second reason. **A test that passes because
  the case never varies is not covering the line.** Measured again on 2026-09-28, in tests written
  the same hour as the rule they covered: a test named *"refuses an agent whose act is on ANOTHER
  event"* never put the act on that event, because the seed helper seeds the host alone — it would
  have passed over the exact defect it was written for, and only the surviving mutation said so.
- **A HARNESS THAT CANNOT MEASURE MUST FAIL LOUDLY, because absence otherwise becomes a verdict.**
  Two separate versions of this in one day, and both reported healthy code:
  - the grep for vitest's summary line did not match the ANSI-coloured output, so the result
    variable was **empty**, an empty string does not match `*failed*`, and four mutations were
    declared **survivors** off a run nobody had read;
  - `Tests 58 skipped (58)` — the suite never executed at all (Testcontainers losing a port bind
    under load) — was likewise not "failed", so three more mutations were called survivors.
  This is the `tail -3` lesson one layer down: the reporting decided the answer, not the test.
  **Assert that a run actually ran** — a summary line exists, and something in it passed — and
  error out when it did not. Also anchor the mutation on a WHOLE line: a bash here-string (`<<<`)
  appends a newline, so a part-line anchor silently matches nothing.

And the inverse of green-is-not-correct: **a test can pin a belief, and then the defect it hides is
invisible.** `authorize.test.ts` asserted a co-host gets no deal-scoped confirm *"because operators
already carry `agreement.confirm` from floor/preset"*. They never have — and that sentence hid an
unsignable agreement that froze a whole event's settlement for as long as it existed. When an
assertion carries a *reason*, the reason is a claim about the code and needs checking too.

## A fixture pinned to an absolute date inside a window measured from `now` is a scheduled failure
`integrations.test.ts` went red at midnight on 2026-09-28 with no code change: the calendar sync
window is `now − 30 days … now + 400 days` and the fixture's third event was dated **2026-08-28** —
exactly 30 days behind the previous day and 31 behind that one. It had been one day from failing
for weeks and nothing could have said so. Dates in a fixture that a window filters must be
RELATIVE; keep absolute ones only where the date itself is the assertion (a DST boundary, say).

## Verifying a test run — a pipe hides the answer
`pnpm vitest run | tail -3` reports **exit code 0 on a failing suite**, because a pipeline's status is the
LAST command's — `tail`'s — not vitest's. Worse, a short `tail` can show only the timing lines, so a red run
looks like a quiet green one. Measured 2026-08-26: a deliberately failing test piped to `tail -3` printed no
failure and exited 0; the same run unpiped exits 1.
- **Read the summary line, never the exit code, when piping.** `grep -E "Tests |Test Files|×|FAIL"` keeps the
  counts visible; `tail -N` may not.
- **Or do not pipe** — redirect to a file and grep that, so the real status survives.
- A count is only evidence if you also know the baseline. "784 passed" means nothing without "up from 770".

## Green is not the same as correct — ask what the check CAN fail on
Four times in one week a suite was green over real breakage, always because the
assertion was structurally incapable of failing on that shape. `scrollWidth <=
clientWidth` cannot fail on anything `position: fixed` (every modal overhung
every phone), on anything an `overflow: hidden` ancestor clips (three tables
amputated their last column), or on a pseudo-element (touch overlays are
invisible to it) — and a screen the sweep never visits is not covered at all
(a 482px overflow sat on the Budget Planner for weeks). **When something passes,
ask what it is capable of failing on. Green means "the thing I measured was
fine", never "the app is fine".**

Two more ways a check lies, both measured here:
- **CI renders text ~10% wider than macOS.** A layout that fits locally with no
  headroom fails there. A test that passes with zero headroom is not passing, it
  is pending — fix by removing the floor (`minmax(0, 1fr)`, `min-width: 0`), not
  by buying pixels.
- **A post-deploy check can be answered by the revision you just replaced.** A
  warm instance serves during the traffic shift. Wait for the rollout, or
  confirm which revision answered.

**And some defects NO assertion in this repo is positioned to see.** Measured
2026-09-30: a helper moved from `apps/api` into `packages/settlement` brought
`import { isDeepStrictEqual } from "node:util"` with it. The web app reaches that
module through `@showme/settlement`, Vite externalises a Node builtin for the
browser, and **every screen rendered white** — while `tsc --noEmit` was clean on
both apps and **2,588 unit tests passed**, because vitest runs in Node. It was
caught within the hour only because a browser check was already scheduled for
something else.
- **A Node builtin in `packages/shared`, `packages/auth`, `packages/settlement`
  or `packages/ui` is a white screen, not a type error.** Those four are bundled
  for the browser. Spell the thing out in the package instead.
- The same day, twice more: a fix was right in its own unit test and wrong at the
  surface, because the defect was in *which value the caller passed* (a ledger
  currency standing in for the currency of the rows being summed) and in *a
  second copy of a rule the API already owned* (a screen gating a control on an
  event-wide capability the API had already answered per row). Mutation-testing
  the function said 4/4. **Check the surface, not the function** — and when the
  fix is a widening, load the screen as the seat it widens for.

## The dev stack does NOT reload the API — the browser can be a day behind the code
`pnpm dev` spawns the API with plain `tsx`, **no `watch`** (`scripts/stack.mjs:320`),
while the web runs under Vite with HMR. So an API change — a Zod schema, a route, a
serializer — is invisible to the browser until the process is restarted, and the
browser is the thing you are checking. Measured 2026-09-14: a new `details.perGuest`
field was added, the client regenerated, the control wired; the API accepted the write,
answered **200**, and stored the row **without the field**, because Zod strips unknown
keys and the running server had been up since 08:45. It reads exactly like a frontend
bug, and the request that proves otherwise (the response echoes the field back) needs
the server restarted to be true.
- **Restart the API before believing any browser check of an API change.** Its env is
  readable from the running process (`ps eww -p <pid>`) if you need to relaunch it alone.
- A green **vitest** run says nothing about this: API tests spin up their own app.

## Two tools that lie about the code, and one that lies about Docker
Measured 2026-09-29, each costing time that looked like a code problem:
- **`npx tsc -b apps/api` EMITS JavaScript into `apps/api/src`.** 182 untracked `.js`
  files appeared beside their sources and one `git add -A` away from being committed.
  The repo's own script is `pnpm --filter @showme/api run typecheck` (`tsc --noEmit`),
  same for `@showme/web`. Use it; `-b` is for building, and nothing here builds that way.
- **A querystring ARRAY is spelled three different ways and nothing in this repo uses
  one.** Fastify's parser gives a lone value as a *string*, not a one-element array;
  axios serializes `name[]=`; orval reads the OpenAPI schema. A comma-separated string
  needs no agreement between the three — that is why `GET /activity`'s `typePrefix` is
  one. Before adding an array query parameter, check whether any exists yet.
- **Docker's port allocator can wedge, and Testcontainers reports it as a test failure.**
  *"Timed out after 10000ms while waiting for container ports to be bound to the host"* —
  first on the ryuk reaper, then on Postgres itself, with `NetworkSettings.Ports` empty
  against a `HostPort: "0"` request. Not load and not the suite: restarting Docker Desktop
  fixed it and nothing else did (`TESTCONTAINERS_RYUK_DISABLED=true` moved the failure to
  the next container rather than removing it). Recognise it by the ports being unbound in
  `docker inspect`, and do not go looking for a flaky test.

## A mutation harness that asserts "the run happened" must not mean "something passed"
The `Tests 58 skipped (58)` lesson below has an inverse, measured 2026-09-29: under a
`-t` filter that selects ONE test, a successfully killed mutation reports
`1 failed | 86 skipped` with nothing passing — and a guard reading "nothing passed, so
the suite never executed" throws away a correct KILLED result. Ask whether any test
**executed** (passed + failed > 0), require green only of the BASELINE, and pin the
number executed so a filter that stops matching errors instead of reporting survivors.

## Run the whole check, not the part you touched
Two lint/test scopes bit in one session. `npx biome check apps/web/src` passes while
CI runs `biome check .` over 658 files; `pnpm --filter @showme/web exec vitest run`
passes while the Playwright suite — the only thing that renders two numbers side by
side — is red. Measured 2026-09-14: three e2e specs had been failing for several
commits, and one of them was catching a **real** bug (a deduction computed off
capacity while the row above it computed off attendance). `main` had been red since
2026-09-05 and nothing gated on it.

**Update 2026-09-15: `pnpm test:e2e` is GREEN — 112 passed, exit 0.** Do not
inherit the sentence above as the current state; it is the lesson, not the status.
The settlement rebuild that day broke two specs and the suite caught both (a
control that moved behind a chooser, and a tab that stopped existing), which is
the whole argument for running it. **Run it, and expect green** — a failure now is
yours.

## An error at the end of a tunnel may belong to the tunnel
`cloud-sql-proxy` authenticates with **Application Default Credentials**, which
`gcloud auth login` does NOT refresh. A stale ADC surfaces as
`password authentication failed for user "postgres"` — indistinguishable from a
wrong password, and it nearly cost a rotation of a working production one. Four
credentials expire independently: `gcloud auth login`, `gcloud auth
application-default login`, and `firebase login` **per account** (use
`firebase login:add` for a second account — `--reauth` REPLACES the first).

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
