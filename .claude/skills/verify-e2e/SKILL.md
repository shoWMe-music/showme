---
name: verify-e2e
description: How to PROVE a change works before saying it does — drive the running stack as the real seeded users, through every route into the rule, and check the state as well as the response. Use before reporting any feature or fix as done, when asked "did you actually test it", or whenever a green test suite is the only evidence. Pairs with app-walkthrough (the browser half) and ui-testing (authoring specs).
---

# Verifying end to end

A passing suite is evidence that the code does what the test says. It is not evidence that the
feature works. Every serious defect in the 2026-08-23 audit lived in the gap between those two
sentences — the settlement engine was green while paying a 60/40 deal 50/50, and the budget suite
was green while writing rows that bricked settlement.

**The standard: a feature is done when the running stack, driven as the account that would really
do it, accepts or refuses FOR THE STATED REASON on every route that reaches the rule.** Anything
less gets reported as "tested in the suite", not as "works".

## Boot, and reseed when data changes

`pnpm dev` brings up Docker Postgres → migrate → seed → Firebase Auth emulator → API (:8080) → web
(:5180). Accounts and the browser half are in the **app-walkthrough** skill.

Probes mutate. Reseed (Ctrl-C, `pnpm dev` again — it drops and recreates the container) **before**
a verification run you intend to quote, and again before a browser pass. A mutating probe re-run
against its own leftovers is not the same probe: an event-cap script that passes from a clean seed
reads completely differently on its second run, and the second reading is meaningless.

## Drive it as a real user

`api-as.mjs` in this folder mints a genuine emulator ID token and calls the API with it:

```bash
node .claude/skills/verify-e2e/api-as.mjs agent POST /offers '{"targetProfileId":"…"}'
```

Import `call(account, method, path, body, actingProfileId)` for a scripted battery. Two things it
exists to get right: the **`x-profile-id` header** (routes that resolve an acting profile answer
"Select a profile…" without it), and **no `content-type` on a bodyless request** (Fastify rejects
an empty body that claims JSON — a 400 that looks like your feature refusing).

## Many ways — the coverage checklist

For each rule, before claiming it:

- **Every route into it.** A rule enforced at one call site is enforced nowhere. The event cap is
  reachable from the events PATCH *and* hold-confirm; granting admin from participants, invitation
  create, invitation redemption, and group assignment (override *and* stored member defaults). Grep
  for the writers (`update(schema.events)`, every route that attaches a `permissionSetId`) and drive
  each one.
- **Both sides.** A negative with no positive control proves nothing — the 400 may be your body
  shape. Always pair "custom is refused" with "performance is accepted, same body".
- **The state, not just the response.** Assert in Postgres: the event stayed `on_hold`, the
  invitation is still `pending`, zero rows were written, the stored `region` is `["DE"]`.
- **Before the sweep.** Anything a cron job reconciles must be correct without it. Move the clock by
  hand (`update … set terminated_effective_at = now() - interval '1 minute'`), leave the reaper
  unrun, and check reads. Then run the reaper and check convergence separately.
- **Each actor who is affected**, not only the one who is blocked. When an agent loses standing, the
  performer must *gain* it back in the same instant.
- **The UI where it exists.** Surfaces without UI (representations, setlists, public pages today)
  are API-verified — say so rather than implying a screen was seen.

## Probes that lie

All of these came out of one session. Two were **false passes** — a green line where the rule under
test was never exercised — and those are the dangerous ones, because a false failure gets
investigated and a false pass gets shipped. The other three lie in the opposite direction, or in the
suite rather than the probe.

**False passes — green, and proving nothing:**

1. **Right status, wrong reason.** A hold-confirm 403 was recorded as the event cap biting. It was
   `Missing capability: agreement.confirm` — the performer had been auto-delegated to her agent, so
   the agent is the party who confirms, and the cap was never reached at all. Re-run as the agent it
   answered "Free plan event limit reached", and 200 once a slot freed. **Assert the message or
   error code, never the bare status.**
2. **A vacuous success.** A group assignment returned 200 where 403 was expected, and the 200 was
   correct: the member-add behind it had 500'd on a mistyped `userId`, so the group held no
   admin-grade member to gate. The assertion was true and meaningless. **Check every setup call's
   status, not just the one you are testing.**

**And three that mislead the other way:**

3. **A fixture describing an impossible state (a green *suite*).** Tests stamped
   `delegatedToAgentProfileId` with no `representations` row behind it — a state the app cannot
   produce — so they asserted against fiction and passed for years. When a fix breaks a test, ask
   whether the fixture was ever real before "repairing" it.
4. **State left by an earlier probe (a false failure).** An agent offering for a performer it does
   not represent returned 201 instead of 400 — because a probe three scripts earlier had accepted a
   representation between exactly those two. The code was right; the database had moved. Reseed
   before a run you intend to quote, and re-check a surprise against the current rows before
   believing it.
5. **Your own typo (a false failure worth believing).** That mistyped `userId` came back as a bare
   500 with an empty body (`logger: false`). Fumbling the input found a real defect — filed and
   fixed as A-41 — but assuming the fumble *was* the feature would have buried it. Chase the red
   line to its cause before dismissing it as your own fault.

Behind #1 and most false failures sits the same question: **who may actually do this?** Delegation,
floors and ceilings move it. Read the route's `requireEventCapability` before choosing an account.

## Failures vs flakes

Running many Testcontainers suites at once starves Docker and produces failures that vanish on a
single-file re-run (`pnpm --filter @showme/api exec vitest run src/x.test.ts`). Re-run alone before
believing a failure — and before dismissing one. `packages/db/src/testing.ts` opens the pool with
`max: 1`, so a `harness.db` call nested inside a `harness.db.transaction` deadlocks rather than
failing; a test that hangs is usually that.

## After schema or route changes

Regenerate the typed client or the web app compiles against a contract the API no longer serves:

```bash
pnpm --filter @showme/api-client sync-spec && pnpm --filter @showme/api-client generate
pnpm typecheck
```

## Reporting

Say which findings were driven live, which are covered only by tests, and which have no UI. If a
probe lied, say what it was and what the re-run showed — that is the most useful line in the report,
because it is the one that says the rest of the results were checked rather than assumed.
