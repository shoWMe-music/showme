# Urgent board — QA7-18, the API half (2026-09-28, part 20)

Written while **sweep run 9** drives the app. The plan is part 16's and unchanged; this records
what was built and the two things the build discovered.

Only the API half is here, deliberately: the dashboard row is a web file on a screen the sweep is
walking, and `packages/api-client` has to be regenerated from the running API's spec — which means
restarting it under the sweep. **Neither is committed until both halves exist**, because a route
with no caller is the shape this loop has filed seven times and part 19 sizes two more of.

---

## What was built

**`resolveDealAuthorityForEvents`** in `lib/deal-authority.ts` — the batched sibling of the
per-event resolver, and the decision part 19 recommended. **Four queries, whatever the number of
events**, which is the standard `routes/activity.ts` sets for a cross-event read (*"Two extra
queries, whatever the number of events; no N+1"*), and three of the four are skipped entirely when
the caller reaches none of their events as an agent — which is most readers.

The per-event resolver is untouched and remains what every deal route uses. The point of batching
rather than looping is the delegation rule: both edges per performer (a participation flagged
delegated AND a live representation covering the venue's country), plus `status = 'active'` being
only a prefilter because a representation working out an agreed notice period is still active while
one whose moment has passed is dead (**A-19**). That caveat is the first thing a second copy would
lose.

**`GET /deals/awaiting-signature`** in `routes/deals.ts`, whose predicate is the confirm route's
term for term:

| term | why it is there |
|---|---|
| a line in `viewerParticipantIds` | so an agent gets the lines of the acts they represent — that is the signature that unblocks the deal |
| `confirmedAt IS NULL` | not already signed |
| `roleInDeal !== "observer"` | observers watch a deal; they do not sign it |
| `agreementStatus !== "draft"` | a draft is the reader's own unfinished work, not somebody waiting — the distinction that moved tasks off the attention card |
| `status !== "cancelled"` | nobody signs a cancelled deal |
| `maySignOwnLines` | **the one that matters most**: QA6-1 was a party who could not sign, and a row that cannot be acted on nags forever |

`maySignOwnLines` is now shared rather than copied — its first parameter widened from `Transaction`
to `Transaction | Database`, because the confirm route asks inside its write and this asks outside
one. Same question, one implementation.

## What the build discovered

**Two of my own tests were wrong about the product, and the code was right both times.**

1. *"shows each act its own deal"* asserted that the delegated act sees their own deal. It does not,
   and must not: `POST /deals/:did/confirm` answers that act's own confirm with **403** — the action
   moved to their agent (A-03) — so a dashboard row would be an instruction they cannot carry out.
   That is QA6-1's shape precisely. The test now asserts the two halves: the **undelegated** act
   sees their line, the **delegated** act sees nothing, and the test above it already shows the
   agent seeing it. Between them, the deal reaches exactly the account that can act on it.
2. *"drops an agent whose representation no longer covers the venue"* seeded the representation
   out of region, and the fixture's own `expect(assigned).toBe(true)` failed — because
   `assignAgentToEvent` refuses an out-of-region event outright, so that state is unreachable by
   that route. The real case is a region that **shrinks after** assignment, which is what #14 warns
   about and what the test does now.

Neither was caught by a failing assertion I had reasoned about in advance; both came from running
it. **A test written from the plan rather than from the code is a hypothesis.**

**And two mutations survived the first pass**, both genuine gaps rather than equivalent mutants:
no fixture had an **observer** party, and none had a representation whose territory had shrunk. Both
now have one, and all six mutations are red:

| mutation | result |
|---|---|
| already-signed lines still count | RED |
| observers are asked to sign | RED *(survived until the observer fixture existed)* |
| a draft is somebody waiting on you | RED |
| the capability check is dropped | RED |
| an agent's delegated lines are not resolved | RED |
| the territory ceiling is ignored | RED *(survived until the shrunk-region fixture existed)* |

**9 tests added, 72 in `deals.test.ts`** (up from 63).

## What is left on QA7-18

1. Restart the API, `pnpm --filter @showme/api-client sync-spec && generate` for the hook.
2. One `AttentionItem` per row on `Dashboard.tsx`, linking to that event's Deals tab, with the
   detail line reading the `signedCount` / `signatoryCount` pair — the same pair the Budget
   Planner's own sentence uses, so the two screens cannot disagree about one deal.
3. Prove it in the browser as a performer with an unsigned line, and as the delegated act's **agent**
   — the seat the API half exists for.
4. Commit both halves together.
