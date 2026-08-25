# Handoff — what is left (2026-08-25)

Written at the end of the P3-audit session, for whoever picks this up next (likely a
fresh Claude session with no memory of it). Everything here was checked against the
repo or the running system on the day; where something is uncertain it says so.

The *why* still lives in `PLAN.md`, `docs/decisions.md` and `docs/story.md`. The
per-finding detail lives in `docs/audit-2026-08-23.md`. What is deployed where lives
in `docs/deployment-status.md`. This file is only the **to-do list**.

---

## Start here

**The branch is not pushed.** `p2-audit-fixes` is 25 commits ahead of `main` with no
upstream and no PR. Nothing is lost — it is all committed locally — but it exists on
one machine only. Pushing it is the first thing to do.

**What is live** (see `deployment-status.md` for the full table):

| | |
|---|---|
| API | Cloud Run `showme-api` rev `00007-b4k`, `prod-showme`, europe-north2 |
| Web app | `showme-app.web.app`, bundle `index-scfLaoqh.js` from `eef8b1a` |
| Database | Cloud SQL `showme-production-db`, schema at migration `0006` |
| Production data | 1 user, 1 profile, 1 draft event — Daniel's own account |
| Marketing | `www.showme.music`, deployed from the **gmail** account, untouched by this session |

**What was done in this session**: all ten P3 audit findings (A-15…A-24) fixed and
verified end-to-end, plus A-41; the realtime service and the scheduled jobs made
reachable locally; list screens moved onto the server's filter/pagination contract;
a per-kind sidebar; and a `verify-e2e` skill that writes down how any of this gets
proven. 419 API tests, 34 web e2e, typecheck 15/15 at the time of writing.

---

## Do these first

1. **Push the branch and open the PR.** One command away, and everything below
   assumes it.
2. **Turn the API's logs on.** `apps/api/src/app.ts:137` — `Fastify({ logger: false })`.
   Every production 500 currently arrives as an empty body with nothing in Cloud
   Logging behind it. This cost real diagnosis time twice in two days, and it is a
   one-line change plus whatever redaction the audit log deserves.
3. **Add CI.** `.github/workflows/` does not exist. Nothing runs the suite but a human
   on a laptop. `docs/cicd-plan.md` has the intended shape.
4. **Schedule the jobs in production.** `pnpm jobs:run` works locally (Cloud Scheduler
   → Cloud Run job was left out of scope). Until it exists, **no reaper runs in
   production**: expired offers and shares never expire, and — new this week — an
   agreed-future representation termination never converges. Reads are correct
   without it by design (`isRepresentationActiveAt`), so this is stored-state drift,
   not a correctness hole, but it is drift that accumulates.
5. **Decide `apps/site`.** Evidence says it is an abandoned two-week-old spike:
   `firebase.json` deploys `apps/marketing/dist`, the live bundle hash matches
   marketing, `apps/site` has one commit ever, 2 pages against marketing's 6, no
   contact form and no cookie consent. It also **makes root `pnpm test` red** (a
   `test` script with no Playwright config → "No tests found") and owns three
   repo-wide `@tanstack/*` version pins in `pnpm-workspace.yaml`. Before deleting,
   check those pins are not load-bearing for `apps/web`, which also uses TanStack.

---

## Waiting on a product decision

Neither of these is a coding question, which is why they are still open.

- **A-36 — is a split member's signed guarantee a floor?** `share.guaranteeAmount` is
  stored, validated and displayed as the signed per-line figure, and the engine never
  reads it. Either it is a genuine floor — `max(share-of-pool, guarantee)`, which
  breaks "split members take 100% of the pool" and can push the operator's residual
  negative — or it is illustrative at the projected pool, in which case showing it as
  a signed figure is the thing to change. Detail in `audit-2026-08-23.md`.
- **A-37 — should a profile-level admin invite cost a paid plan?** A-21 closed every
  *event*-level path to granting admin. The profile-level sibling (`POST /invitations`
  with `targetProfileId` + `role: "admin"`) still skips the gate and never consumes a
  seat. Gating it changes team invites on free plans, so it is your call. The fix is
  the same shape as A-21: `canUseFeature(database, targetProfileId, "grant_admin")` at
  create and at accept.

---

## Open audit findings

All ten P4 findings are untouched — they are a build queue, not a bug list. Full text
in `docs/audit-2026-08-23.md`.

| | | |
|---|---|---|
| **A-25** | The web app is operator-only | *Partly done* — see below |
| **A-26** | Territory / market scoping absent (decisions #17) | Also unblocks A-39 |
| **A-27** | Crew availability never reaches event staffing | |
| **A-28** | The three per-kind `_details` tables do not exist | Crew marketplace has no queryable surface |
| **A-29** | No plan tier for `agent` or `team_and_crew` | Pairs with A-38 |
| **A-30** | The #16.4–16.8 event model is unbuilt | Several sub-items, incl. no budget snapshot at finalize |
| **A-31** | `stages` is a dead table | Event create accepts a `stageId` no route can create |
| **A-32** | `performance_reports` is a dead table | Worth more now that setlists are real |
| **A-33** | Off-platform parties can comment but never approve | Sign-off is the point of the share flow |
| **A-34** | Idempotency keys missing where money moves | Sharpest on invoice issue — it consumes a *gapless* number |

Filed while fixing P3, still open:

- **A-38** — an agent's offers are metered by nobody (`defaultTierForKind` sends every
  non-performer to `free_operator`, and only `free_artist` meters offers). Fix it
  together with A-29.
- **A-39** — an agent may offer outside its own territory. Acting on a deal applies a
  region ceiling; offering does not. Deliberately deferred to land with A-26.
- **A-40** — the disjoint-region invariant has no database guard. A-17 closed the race
  with a row lock, which covers every path through the API; nothing stops a migration
  or a future writer. A partial exclusion constraint on array overlap needs GiST, so
  the honest options are a trigger or a normalized `representation_regions` table.

---

## Built, but still not reachable

- **The rest of A-25 — the screens.** The sidebar now tells the truth per account kind
  (operator 14 items, performer 12, crew and agent 11, mapped once in
  `apps/web/src/shell/navigation.ts`). What is still missing is the substance:
  - no `/representation` screen — the agent's Roster and the performer's My Agent —
    though `apps/api/src/routes/representations.ts` is complete and verified;
  - no `/setlists` screen, though authoring and sharing are built and verified;
  - the **Dashboard is operator-shaped for everyone** (it reads `insights/summary`, so
    a performer sees "events hosted: 0");
  - **`Audience.tsx` has no endpoint at all** — it renders a hardcoded `[]`, empty for
    the operator too;
  - **no profile switcher** — `activeProfile` is always `memberships[0]`, so the nav
    follows the *account* kind rather than the acting profile.

  The agent's eleven items contain nothing agent-specific. That thinness is the honest
  picture and the argument for building Roster next. These screens need the Claude
  Design prototype as ground truth — do not invent them from a spec.
- **Realtime is off in production.** `apps/stream` now runs in the dev stack and the
  full path is verified locally (route → `publish` → `pg_notify` → SSE → the shell's
  EventSource → a badge that increments). In production `VITE_STREAM_URL` is
  deliberately blank because the service is not deployed; `docs/deploy-stream.md` has
  the runbook. Also: only **two** events publish — `event.participant_added` and
  `event.message_posted`. Deals, settlements, holds and invitations do not.
- **Filter/sort UI.** List screens now use the server's filter and keyset pagination.
  Two deliberately keep client-side narrowing over a fully-drained list (Requests and
  Tasks — their calendar rail and bucket counts describe the whole inbox); the reason
  is in the hooks. **No sort control anywhere**, because no list route accepts a sort
  parameter — adding one is an API change first. The Dashboard's stat band still
  falls back to counting page one when the insights summary is unavailable.

---

## Never built

- **Payments, entirely.** `docs/payments.md` is explicitly the *target* design:
  "v1 processes no money". Stripe Connect (account decided), Pay All, invoice/receipt,
  multi-pay without escrow, and the agent-commission collection leg.
- **Ticketing provider integrations.** Manual today; the seam exists
  (`budget_lines.source`).
- **CSV/PDF export.** `packages/shared/src/csv.ts` is built and tested and **nothing
  consumes it** — no route, no screen.
- **The AI/assistant layer** (decisions #16.14–16.15), deferred until manual flows work.
- **Spotify performer verification**, **GDPR retention schedule** (erase and export
  exist; retention does not), the **nested-entitlement pass** for %-of-cut sub-hire,
  and **escalators / bonuses / VAT** — the audit could not even test those last three
  because no fields exist to set them.

---

## Engineering and platform

- **No CI** (above).
- **No logs** (above).
- **Terraform covers the load balancer only.** `infra/` is real — `modules/api-load-balancer`
  and `envs/prod` — but the Cloud Run service, the Cloud SQL instance, the secrets and
  Firebase Hosting were all created by hand and are not in code. (An earlier note in
  this session said "no Terraform in the repo"; that was wrong.)
- **The HTTPS load balancer is provisioned with no DNS record** — carrying zero traffic
  and still billing. Either wire `api.showme.music` to it or tear it down.
- **No error tracking, metrics or alerting.**
- **Rate limiting is per-instance and in-memory** — Cloud Run scales out, so the real
  guard belongs at the edge (Cloud Armor).
- **Test coverage**: the web app has 34 Playwright specs now (per-kind sidebar,
  create-event modal, collaborators layout, two-user), but none of the money flows
  fixed in P1–P3 has a UI test, and there is no accessibility or mobile pass on the app
  (the marketing site has both).

---

## How to work on this

```bash
pnpm dev          # docker postgres → migrate → seed → auth emulator → API → stream → web (:5180)
pnpm test:e2e     # the same stack, headless, 34 specs
pnpm jobs:run     # the reapers, against the dev stack's database
```

**Read `.claude/skills/verify-e2e/SKILL.md` before calling anything done.** It is the
standard the P3 work was held to — drive the running stack as the account that would
really do it, through every route into the rule, and check the state as well as the
response. `api-as.mjs` beside it mints a real emulator token per seeded account.
`app-walkthrough` is its browser half.

Seeded accounts (`packages/shared/src/e2e-accounts.ts`), password `Test123!pass`:
operator / performer.a / performer.b / professional (crew) / agent, all
`@e2e.showme.test`.

---

## Facts that will bite you

- **Reseed before any run you intend to quote.** Probes mutate; a mutating script
  re-run against its own leftovers reads completely differently the second time. This
  produced a false failure during the audit.
- **A refusal is only evidence when it refuses for the stated reason.** A 403 recorded
  as "the entitlement cap bit" was actually a missing capability, and the cap was never
  reached. Assert the message, never the bare status.
- **Testcontainer contention** makes suites fail spuriously when several run at once.
  Re-run a single file before believing *or* dismissing a failure.
- **`packages/db/src/testing.ts` opens the pool with `max: 1`** — a `harness.db` call
  nested inside a `harness.db.transaction` deadlocks rather than failing. A hanging
  test is usually that.
- **Deleting a Firebase Auth user from the CLI** needs
  `GOOGLE_CLOUD_QUOTA_PROJECT=music-showme`, or it fails citing an API disabled on
  `prod-showme`. See `deployment-status.md`.
- **Two docs contradict each other and should be reconciled**:
  `handoff-2026-08-23-marketing-and-hosting.md` says `www.showme.music` is still the
  old build, while `deployment-status.md` (written later, and matching the deploy
  cache) says the fixes shipped. And `deployment-status.md` contradicts itself on
  whether the root cache-header gap is fixed — line ~97 says yes, ~170 says no;
  `firebase.json` says yes.
