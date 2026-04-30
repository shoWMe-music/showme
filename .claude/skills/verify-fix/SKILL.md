---
name: verify-fix
description: Generate and run unit + e2e tests that prove a bug fix works. Use after implementing a fix from the ClickUp triage doc, before committing.
argument-hint: [optional fix description or commit SHA — defaults to staged changes]
---

# /verify-fix

Generates the right test layer for a fix that was just implemented, runs it, and reports pass/fail. Designed for the bug-triage swarm cadence — every fix gets a test before the wave deploys.

## Inputs

- **No args:** inspect staged changes (`git diff --cached`) and uncommitted working-tree changes; infer what was fixed.
- **One arg = a commit SHA:** `git show <sha>` to inspect the fix.
- **One arg = free text:** treat as the fix description; ask which files to look at if unclear.

## Step 1 — Decide the test layer

Pick the **smallest** layer that proves the fix. Don't write both unless both are warranted.

| Fix shape | Layer | Why |
|---|---|---|
| Pure function, util, calculation, type guard, reducer | **Unit (Vitest)** | Fast, deterministic. Co-locate `*.test.ts` next to source. |
| Component prop / render logic / conditional UI | **Unit (Vitest + RTL)** if testable; **e2e** if it depends on routing, auth, or Firestore | RTL works for isolated components; e2e for integration. |
| Firestore read/write, Cloud Function, public-share flow, auth | **e2e (Playwright + emulator)** | Mocks lie about Firestore. Real emulator catches rule and shape bugs. |
| Multi-step user flow (create event → invite → confirm) | **e2e** | Unit can't verify cross-page state. |
| Cosmetic / CSS / spacing | **No test.** State the fix is visual-only and skip. Don't invent flaky pixel tests. |

If the fix touches both pure logic and an integrated flow, prefer **one unit test for the logic + one focused e2e for the flow** — not two e2e tests.

## Step 2 — Write the test

**Unit (Vitest):**
- File next to source: `src/lib/foo.ts` → `src/lib/foo.test.ts`.
- React components: use `@testing-library/react`. Existing pattern in `src/lib/eventPermissions.test.ts` and `src/pages/EventsPage.test.tsx`.
- Don't mock Firestore — if you'd need to, that's a signal this should be e2e instead.
- One `describe` per surface, focused `it` per scenario. Name the bug: `it("does not double-count archived events (#42)")`.

**e2e (Playwright):**
- File: `e2e/<short-name>.spec.ts`. Add it to the `app` project's `testMatch` array in `playwright.config.ts`.
- Use the helpers in `e2e/helpers.ts` — `signIn(page)` handles emulator auth via REST + localStorage injection.
- Default test user: `testvenueuser1@showme.music` / `123456` (seeded by `npm run seed`).
- For Cloud Function fixes, also add a Firestore-rules-bypass admin call (see `issue-fixes-e2e.spec.ts` lines 36–60 for the `Bearer owner` pattern) to prep fixtures.
- Reuse the existing dev server (`reuseExistingServer: true` is set) — don't spawn a second one.

**Test naming:**
- Lead with the doc line or commit subject so future-you can grep it back.
- Example: `test("Settlement shared report link uploads file via callable (W3 #2)", …)`.

## Step 3 — Run it

In this order. **Stop on the first failure** and fix before continuing.

```sh
# 1. Typecheck — fast, catches obvious issues
npx tsc --noEmit

# 2. The new unit test alone — fast feedback loop
npx vitest run src/path/to/your.test.ts

# 3. Full unit suite — catches regressions
npm test

# 4. e2e (only if you wrote one) — needs emulators running
# In a separate shell that the user owns: npm run dev:local
npm run test:e2e -- e2e/your.spec.ts
```

**Important:** never start `npm run dev:local` yourself in the background — it boots emulators + Vite + seed and the user usually has it running already. Ask before starting it. If the user confirms it's not running, tell them to start it; don't background-spawn it from a Bash tool.

## Step 4 — Report

Tell the user:
- **What test got written** (file path, layer, what it asserts).
- **What it caught or confirmed** (e.g. "test passes — fix verified" or "test failed at line N, root cause is X, here's the patch").
- **What is NOT covered** (e.g. "pure-logic test only; the multi-party integration path would need an e2e — flagging for the wave verification gate").

Keep the report under ~10 lines. The user reads the diff for details.

## Anti-patterns to avoid

- **Don't write a test that just exercises the fix's diff line-by-line** — write a test that would have caught the bug *before* the fix existed. Mentally roll back the fix; the test should fail.
- **Don't mock the function under test.** If the only way to make the test pass is mocking out the thing being verified, the test is theatre.
- **Don't add `expect(true).toBe(true)` placeholders** "to be filled in later." Either write the real assertion or skip the test layer.
- **Don't bump the Playwright timeout to make a flaky test pass.** Flake = real bug. Find the missing `await` or race.
- **Don't run `npm test -- --update-snapshots` reflexively.** If a snapshot changed, ask whether the change was intentional first.

## When the test reveals the fix is incomplete

If the test you wrote fails against the supposedly-fixed code, that's the skill earning its keep. Report:
1. Which assertion failed and what was expected vs. actual.
2. Best guess at the root cause based on the fix diff.
3. Stop. Don't auto-patch — let the user decide whether to extend the fix or scope a follow-up.

## Cross-reference

- Wave cadence: see `memory/project_bug_triage_swarm.md` — verification gate runs at end-of-wave; this skill handles per-fix verification.
- Emulator setup: `npm run dev:local` boots Auth/Firestore/Functions/Storage emulators on ports 9099/8090/5001/9199 plus Vite on 5173.
- Existing helper patterns: `e2e/helpers.ts` (auth), `e2e/issue-fixes-e2e.spec.ts` (Firestore admin bypass), `src/lib/eventPermissions.test.ts` (pure logic), `src/pages/EventsPage.test.tsx` (component + RTL).
