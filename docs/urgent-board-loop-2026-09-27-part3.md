# Urgent board — the build loop, part 3 (2026-09-27)

Continues `docs/urgent-board-loop-2026-09-27-part2.md` (item 2 + the QA sweep's eight
majors), which continues part 1 (item 1). Same rules: plan here before building, prove on
the running stack, biome + web + API + e2e, commit naming the ticket, no deploy, no
ClickUp writes.

This file carries **item 3** (the bonus / escalator ladder and its entry UI) onward.

---

## Item 3 — the ladder · `123qy9rnwud` (urgent) · `123qy9rp8k3` (high)

**Verdict: the ENGINE ladder is already built and wired. The gap is that nothing in the
app can enter it — which is `123qy9rp8k3`, the `high` ticket, not the `urgent` one.**

### What is actually there, checked before scoping

| Ran's ask (`123qy9rnwud`) | State | Where |
|---|---|---|
| *"60/40 until 300 tickets, 70/30 from 300, 80/20 from 900"* | **Built, as escalator tiers.** The highest tier reached by ticket sales replaces the base split | `packages/settlement/src/entitlement.ts` → `splitBasisPointsForSales`, tested in `reconcile.test.ts:248` |
| Stored anywhere? | **Yes** — `deals.terms` jsonb, named "escalator tiers, bonus, commissions" since the schema was written | `packages/db/src/schema/deals.ts:69` |
| Enterable through the API? | **Yes** — `DealTermsBody` takes up to 10 tiers plus the flat bonus, and its own header says *"ClickUp 123qy9rnwud reports it as missing; it was unreachable"* | `apps/api/src/routes/deals.ts:132` |
| Reaches the engine? | **Yes** — `dealTermsForEngine` converts the stored terms into the event's base currency | `apps/api/src/routes/settlement.ts:1014` |
| Enterable from the **app**? | **NO.** The deal composer never sends `terms`: no screen writes an escalator tier or a bonus | `useEventAgreements.ts` |

### Two corrections I owe

1. **The audit's §2 line is stale.** It says *"the engine already settles a threshold
   bonus; nothing can enter one"*. The API route that enters one exists now — it was
   built after `bug-analysis-2026-09-04.md` was written, and its own comment names the
   ticket. What cannot enter one is the **web app**.
2. **My framing of decision #25.5 was wrong.** I put it to Daniel as *"the engine models
   ONE threshold — extend it, or tell Ran one is what the model supports"*, and he chose
   to extend. But Ran's example is a ladder of **splits**, and the engine has modelled
   that as N escalator tiers all along. Nothing in the engine needs extending to make
   Ran's own example work; it needs a screen.

### Scope

- **(a) Ran's numbers, as a test.** `60/40 → 70/30 at 300 → 80/20 at 900`, in his figures,
  so the claim "his case works" is executable rather than asserted. Three bands where the
  existing test has two, and the boundary is the thing to pin: at exactly 300 the new tier
  applies.
- **(b) The entry UI (`123qy9rp8k3`).** The deal composer gains the tiers and the bonus,
  writing `terms` — the one thing standing between a built engine and an operator using
  it.

### The decision this hides, and where it is left

**Does the BONUS need N bands too?** Ran's ticket is titled "bonus thresholds", and his
worked example is the split ladder above, which exists. The bonus itself is one flat
amount once GROSS revenue clears one threshold (#23.3, deliberately gross so a promoter
cannot defeat it by spending). **It stays one band** until somebody asks for several in
those words: inventing a second ladder nobody has described would put a second way of
saying the same thing into the money core. Recorded here rather than assumed either way.

---

## Log

**Item 3 — the ladder is enterable. `123qy9rp8k3` is done; `123qy9rnwud` needed no engine
change.**

**(a) Ran's own numbers are now a test.** `60/40 → 70/30 at 300 → 80/20 at 900`, in his
figures, including the boundary: a band applies **at** its threshold, not one ticket past
it, which is how a band is written in a contract. Mutation-checked — changing `>=` to `>`
turns it red.

**(b) The entry UI.** `DealDraft` carries the bands and the bonus; `createDealPayload`
emits `deals.terms` in the shape `DealTermsBody` already accepts; `DealComposerModal`
offers them **only on a deal that has a split to escalate**, because both ride on a door
share and a guarantee pays the same whatever the night does. Seven new tests on the form
rules: bands sorted on the way out (a ladder listed out of order reads as a mistake), a
half-typed band dropped rather than sent, two bands at one threshold refused (the engine
takes the highest reached, so one of them would silently never apply), a bonus refused
with one half missing.

Proven live, end to end: typed in the browser — base 60%, bands entered **out of order**
(900 then 300), bonus 50 000 / 2 500 — and the row holds
`escalators [{300, 7000}, {900, 8000}]`, `bonusThreshold "5000000"`, `bonusAmount
"250000"`. Ran's ladder, enterable from the app for the first time.

**Two mistakes of mine, both worth recording:**

1. **I chased the wrong file.** Five `app.test.ts` failures appeared and I assumed the
   ladder rung I had just added to `POST /events` caused them. Disabling it changed
   nothing — the cause was in `@showme/shared`: `dealDraftFromBody` builds a `DealDraft`
   from the wizard's body and had no bands, so the new validation read `.filter` off
   `undefined` and the route answered 500. **Isolating before theorising cost one run and
   would have cost an hour of reading.**
2. **I typechecked the wrong package.** After changing `packages/shared` I ran the WEB
   typecheck and moved on; the API's would have named the missing fields exactly, which is
   what it did the moment I ran it. A change in `shared` needs every consumer checked —
   there are six, and `for pkg in ...; tsc --noEmit` takes under a minute.

Suites: biome 712 · shared 288 (7 new) · settlement 65 (1 new) · web 328 · api 1310 · e2e
112.
