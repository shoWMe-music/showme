---
name: app-walkthrough
description: Drive the REAL web app as a logged-in user to test flows/logic/animations from the user's perspective — boot the local stack, log in as a seeded account (operator/performer/agent/crew), and walk a journey in a live browser (Playwright or Chrome DevTools MCP). Use when asked to "log in and try", "test as a user", "does this flow work end-to-end", or to verify a change in the running app rather than in unit/Playwright specs. For authoring deterministic marketing-site tests, use the ui-testing skill instead.
---

# App walkthrough (user-perspective testing)

Test the app the way a user meets it: log in, click through a real flow, watch it behave. This complements — does not replace — the automated specs. For the standard a change must MEET before you call it done — every route into the rule, as the party who would really do it, checked in the database as well as the response — see the **verify-e2e** skill; this one is its browser half. Use it to *feel* the product and catch what assertions miss (confusing states, broken flows, janky motion).

## Boot the stack

```bash
pnpm dev        # scripts/dev-emulator.mjs
```

Brings up, all seeded and cross-wired, staying up until Ctrl-C:
- **web** → **http://127.0.0.1:5180** (note: 5180, not Vite's 5173, so it coexists with the landing site)
- **API** (:8080) + the **SSE stream service** (:8081, `apps/stream` — the realtime path, wired to the web app via `VITE_STREAM_URL`) + **Firebase Auth emulator** (:9099) + a **Docker Postgres** (:55432) seeded with the accounts below and their data.

Requires **Docker running**. It prints the seeded accounts + shared password on start. Ctrl-C stops everything and removes the Docker DB.

(That's the interactive stack. `pnpm test:e2e` runs the headless Playwright suite over the same stack — see `apps/web/tests` and the `ui-testing` skill.)

## Scheduled jobs are NOT on a timer here

```bash
pnpm jobs:run     # one sweep against the dev database; prints a JSON summary
```

`apps/jobs` (expired offers / venue handoffs / shares, due representation terminations,
the exchange-rate refresh) runs from Cloud Scheduler in production. Locally nothing
triggers it, and `pnpm dev` deliberately leaves it that way — a sweep firing at boot
would move state under a walkthrough. So anything time-based you expect to have
converged, you converge yourself: age the row in Postgres, then run the command.

## Seeded accounts

Single source of truth: `packages/shared/src/e2e-accounts.ts`. All share password **`Test123!pass`**. Each is a distinct journey (data cross-wired in the Postgres seed):

| Account | Email | Kind | Is for testing… |
|---|---|---|---|
| operator | `operator@e2e.showme.test` | operator | venue/promoter: create events, participants, budget → settlement |
| performerA | `performer.a@e2e.showme.test` | performer | performer POV: incoming/outgoing offers, availability; represented by `agent` |
| performerB | `performer.b@e2e.showme.test` | performer | performer↔performer interaction |
| teamAndCrew | `professional@e2e.showme.test` | team_and_crew | crew booked on the operator's event: availability → staffing |
| agent | `agent@e2e.showme.test` | agent | booking agent acting for `performerA` |

Emulator-only demo credentials — they don't exist in any real Firebase project.

## Log in (live MCP browser)

Navigate to `http://127.0.0.1:5180/`, then (selectors mirror `apps/web/tests/support/e2e.ts › loginViaUi`):
1. fill placeholder **`you@email.com`** with the email,
2. fill placeholder **`Password`** with `Test123!pass`,
3. click the **Sign in** button,
4. the shell is ready when the sidebar **Dashboard** button is visible.

Firebase persists the session in **IndexedDB** (not cookies/localStorage) — a fresh context needs a real UI login (or restore a saved `storageState` with `indexedDB: true`).

**Two users at once** (e.g. operator sends an offer → performer receives it): open two browser contexts/tabs, log each in as a different account, and drive them in turn.

## What to walk, per kind

Infer expected behaviour from `docs/story.md` (each actor's purpose + boundary), not convention. High-value journeys:
- **operator** → create an event → add participants → budget lines → open the settlement and sanity-check the "who owes whom" math.
- **performer / agent** → offers, both **incoming and outgoing** (per Ran fix-list #6, sending is first-class), and availability holds.
- **teamAndCrew (crew)** → mark availability and confirm it surfaces against the operator's event for staffing (fix-list #8).

## Reviewing animations from the user's eye

For canvas/scroll animations, driving them live and *looking* is the honest test (a pixel diff says *changed*, never *good*). Use Playwright MCP to scroll/interact and screenshot; use **Chrome DevTools MCP** `performance_start_trace` / `performance_analyze_insight` to confirm a scene actually settles (rAF quiets, no layout thrash). For deterministic *automated* frames, see the `ui-testing` skill.

## Cleanup

Ctrl-C the `pnpm dev` process (removes the Docker DB). If a port lingers: `lsof -ti:5180 | xargs kill -9`.
