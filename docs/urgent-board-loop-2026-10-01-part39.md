# Urgent board loop — part 39 (2026-10-01)

Part 38 ends with run 14 closed in full and the whole pass green (biome 757 · shared 349 · auth 41 ·
settlement 82 · db 25 · web 649 · **API 65 files / 1497 tests / 0 skipped** · **e2e 118**). QA sweep
**run 15** is walking the app now; this part holds the two named follow-ups, planned while it runs.

**Nothing in this part is built yet, deliberately.** A sweep is reading the running stack, and every
edit here would reach it — Vite hot-reloads the web on a `packages/shared` change, and the API needs a
restart it must not get mid-walk. The plans are written first because the standing instruction asks
for that anyway; the building waits for run 15's report.

---

## 1. The ticket-tier merge rule — one function, three callers

**Named in part 29 §1** as *"a task and not a wish"*, and left for a session that could do it
deliberately rather than as the tail of a cosmetics pass. Reading the two implementations, that was
the right call and the shape is now precise.

### What is actually duplicated

The rule is *"a tier on Event Details becomes revenue only if no budget line already states it"*, and
it has three cases. Both copies implement all three; they are just split differently:

| case | web — `mergeTicketTierSeeds` (`useBudgetEditor.ts:183`) | API — `copyBudgetOnce` + `seedTicketTiersIntoBudget` (`settlement-lines.ts:138`, `:229`) |
|---|---|---|
| the sheet states its own door | `serverTiers.some(tier => tier.hasBreakdown === false)` → return `serverTiers`, seed nothing | `ticketRows.some(row => details.basis !== "ticket_tier")` → skip the seed entirely (in the CALLER, one level up) |
| matched by tier id | event tier's `originTierId` ∈ written rows' `originTierId`s | `alreadyStated.has('id:' + tier.id)`, built from `details.tierId` |
| matched by name | trimmed, lowercased `name` | `alreadyStated.has('name:' + label.trim().toLowerCase())`, with `|| "ticket tier"` for a nameless tier |

Each side carries a comment saying it must agree with the other. They do agree today. The third
case exists because getting it wrong **showed SEK 57,000 on a SEK 25,000 night**, and matching by
name alone once settled SEK 6,300 as SEK 7,800 — so the cost of a third copy is already measured, and
Projections is the money screen that would be writing it.

### The shape to extract

The two callers disagree about what a "stated row" IS — a planner draft on one side, a `budget_lines`
row on the other — so the shared function must take the rule's own vocabulary and let each caller
translate into it:

```ts
// packages/shared/src/ticket-tiers.ts
export interface StatedTicketRow {
  /** `details.tierId` / the draft's `originTierId` — the tier this row was written FROM, if any. */
  tierId?: string | null;
  /** The row's label, as stored. Matched trimmed and lowercased. */
  label: string;
  /** False for a door row somebody typed themselves, which suppresses every tier. */
  fromTier: boolean;
}

export interface TierIdentity {
  id?: string | null;
  name?: string | null;
}

/**
 * Which of an event's tiers the budget does NOT already state. Empty when the sheet states its own
 * door — see the SEK 57,000 measurement.
 */
export function unstatedTicketTiers<T extends TierIdentity>(
  stated: readonly StatedTicketRow[],
  tiers: readonly T[],
): T[];
```

Then:
- `mergeTicketTierSeeds` becomes `[...serverTiers, ...unstatedTicketTiers(stated, eventTiers).filter(notDismissed)]`, keeping `dismissed` on the web where it belongs — a per-sheet-session removal is a UI fact, not a money rule.
- `seedTicketTiersIntoBudget` loses `alreadyStated` and takes the tiers it should write; its caller's `statesItsOwnDoor` block collapses into the one call.
- Projections asks the same function, which is the whole point.

Tests belong on the shared function, per case, plus the two measurements that made the cases exist as
named regressions (the door suppression at SEK 57,000, the rename double-count at SEK 7,800). The two
existing call-site tests stay: they are the only assertion that each caller translates correctly.

### The payload half

Projections has no input today — `ticketTiers` is not served on the events list. `GET /events` must
carry it. Whether it carries the tiers or a per-event minor-unit **total** is a real choice:

- **the tiers** — Projections runs the same function as everybody else, which is what makes a third
  copy unnecessary. Costs payload on a list read.
- **a precomputed total** — smaller, but the merge has to happen server-side against the budget the
  list query does not join, so it is a fourth place the rule lives. Rejected for that reason.

So: the tiers, on the events list, serialized minor-unit-safe. Changing the response schema means
`pnpm --filter @showme/api-client run sync-spec` then `… run generate`.

### The decision this does NOT take

Part 29 recorded it and it stays recorded: **should a tier on Event Details write a budget line the
moment it is typed?** That would make all three agree at the source, and it is a product call, not a
refactor — it would have Event Details writing into the planner's ledger, which is the coupling
`mergeTicketTierSeeds` exists to avoid.

---

## 2. The hand-rolled pluralisations — and why the count is not 38

Part 28 left **38** `n === 1 ? … : …` sites as a named follow-up, reasoning that *"converting
thirty-eight strings inside a cosmetic fix is a large mechanical diff over COPY, where a regression is
invisible to every suite."* Both halves of that need updating.

**The count is now 43**, which is the argument for doing it: the shape is still being written.

**But they are not all pluralisations.** Two of the first eight are not plural rules at all —
`useMarkUnavailable.ts:203` picks a single day out of a list, and `InvoiceDetailModal.tsx:166` chooses
between two whole labels. A blind sweep of the pattern would "fix" both into nonsense. And the real
plural sites come in at least four shapes:

```
{n} {n === 1 ? "song" : "songs"}          a whole word
member{n === 1 ? "" : "s"}                a suffix
entr${n === 1 ? "y" : "ies"}              an irregular stem
hiddenDealCount === 1 ? "it" : "them"     pronoun agreement, not a plural at all
```

So the task is a helper plus a **read** of every site, not a regex. `pluralise(count, singular,
plural?)` covers the first three (defaulting `plural` to `singular + "s"`); the fourth is a different
rule and stays where it is.

**How to convert without a blind diff.** A copy regression is invisible to the suites, so the
conversion is only safe where the rendered string is already asserted. The order is therefore:

1. `pluralise` in `@showme/shared`, with tests including 0, 1, 2, an irregular plural and a negative
   (which nothing produces today but a count can go negative through a bug, and "−1 tickets" is the
   right answer rather than "−1 ticket").
2. Convert the sites whose output an existing test already pins — `budgetPlannerView.ts` is the
   largest of these and has per-branch tests including *"the singular"*.
3. Convert the rest in small commits grouped by screen, each read rather than pattern-matched, with
   the before-and-after string quoted in the commit for anything not under test.
4. Record in `docs/codebase-reuse-audit.md` what was deliberately left — the pronoun case, and any
   site where a hand-written pair reads better than a helper call.

That is a real improvement rather than a mechanical one, and it is the only version of this task that
cannot silently change what a screen says.

---

## 3. The third follow-up, for completeness

`docs/codebase-reuse-audit.md` also holds **nine copies of `initials()`** and **three unread `users`
columns**. Neither is urgent and neither is copy: the `initials()` dedup is the review gate's own
example of real repetition, and the unread columns are a question about whether anything should read
them before they are dropped. Sequenced after the two above.

---

# Run 15 — NOT CLEAN: 1 MAJOR, 6 MINOR, 5 COSMETIC, 5 NOTE

`docs/qa-sweep-2026-10-01-run15.md`, 838 lines. Seven of the eight requested re-checks pass; the
eighth is the MAJOR. Folding them in in severity order.

## MAJOR — three settlement stage rows carry a `target_id` that is not a settlement

### Which file settles it

`apps/api/src/routes/settlement.ts` — the `writeActivity` calls at `:2949` (the status route) and
`:2705` (the comment route). Verified against the live database before touching anything:

```
settlement.pending_review | kind=settlement | target=…0000000000e1   ← the EVENT id
settlement.commented      | kind=settlement | target=…65a06d57c478   ← the settlement_comments id
settlement.revised        | kind=settlement | target=…0000000000e1   ← the EVENT id
settlement.finalized      | kind=event      | target=…0000000000e1   ← correct
e1's actual settlement ids: …2f1960dae5f6 …ea9a0dd7a111 …37206a56b58e …7a462ef92349 …434e7021992f …
```

### The verdict: a party-scoped KIND with an event-level SUBJECT

`lib/activity.ts` states the rule the read side enforces: `settlement` is **party-scoped** — *"only
the parties to that row — resolved by joining the viewer's participants to the target"*. So
`target_kind = 'settlement' AND target_id IN (viewer's settlement ids)` can never match an event id
or a comment id, and the rows are unreachable by every non-operator. Operators read them only
because `activity.ts` lets an operator bypass the kind filter.

**This is not a fix of mine carrying its next defect — it is a pre-existing defect my fix made
visible.** The rows have been unreachable since they were written; nothing read them until the rail
started asking the feed what had happened. The report is right that the fix commit's own browser
check would have passed: I checked it as `operator@`, the one seat for which it works.

**And the correct shape is already in the file, one line away.** The status route's own per-row
`writeAudit` writes `targetKind: "settlement", targetId: row.id` inside the same loop. One rule
written twice, and the copy that feeds the screen is the wrong one — the thirty-fourth instance of
a comment stating a rule that no test runs.

The comment above the broken call is what led it astray:

> *"ONE activity row for the event, not one per party. The status is a fact about the settlement as a
> whole, and a timeline that repeated it per participant would read as three things happening
> instead of one."*

That reasoning is **falsified by its own neighbour**: `settlement.confirmed` writes one row per
signature and the seeded Album Release carries six of them, which the Revision history has rendered
as six lines all along without anybody filing it. And the reasoning is only ever true of the
OPERATOR's timeline — the feed is party-scoped, so per-settlement rows appear to each party exactly
once. The comment optimised the one reader for whom the row already worked, at the cost of every
reader for whom it did not.

### Scope — three writes, and what each one's subject actually is

1. **`POST /settlement/status`** → one row **per settlement it moved**, `targetId: row.id`, written
   inside the loop beside the audit row. Only when the status really moved: a pure grant change
   (`fullAccess` without a status move) keeps its audit row and gets no timeline row, because #24's
   *"who opened the books, and when"* is answered by the audit trail and the comment beside it
   already says so.
   The summary gains `{ from, to }`, which `activityDetailLines` renders as
   **"Pending review → Comments received"** — so the operator's N rows become distinguishable by
   their own transition, which is strictly more than the single row said. `participantId` goes in
   too; the detail renderer is a whitelist, so an id it does not know is ignored rather than printed.
2. **`settlement.commented`** → the subject is **whose remark it is**, which is exactly the rule the
   thread's own read already applies (`GET /settlement/comments`: your own party's comments plus the
   event-side ones): `targetKind: "settlement", targetId: <the author's own settlement>` when
   `asParty` is set, and `targetKind: "event"` when it is null — the operator speaking for the event,
   *"addressed to everyone it is being reviewed by"*. No new disclosure either way: the feed row says
   only that somebody commented, and it now reaches precisely the people the remark does.
3. **`comments_received` needs its own row.** The comment path moves EVERY party sitting at
   `pending_review`, not just the commenter's — so party X's rail can stand at `comments_received`
   while X can see no remark. The status move is X's own settlement's news and X is entitled to it,
   so the path writes a `settlement.comments_received` row per settlement it moved, exactly like the
   status route. `EVIDENCE_FOR_STAGE[2]` already lists both types, so the rail needs no change.

### The half that is not the API's

`eventHistory.ts`'s `ACTIVITY_TITLE` has no entry for `settlement.pending_review`,
`settlement.revised`, `settlement.comments_received`, `settlement.dispute` or
`settlement.commented`, so all five fall through `humanize` — which is the API's identifier with a
capital letter on it. Nobody noticed because no party could see the rows. They get real titles now
that a performer reads them, which is run 13's own lesson in this file: *"THE READER'S WORD FOR A
FIELD THAT MOVED — never the API's identifier."*

### No decision for Daniel

Every choice above is settled by a rule already written down: the kind map says `settlement` is
party-scoped, the thread's read rule says whose a comment is, and #24 says the grant lives in the
audit trail.

### MAJOR built and proved

Six mutations, all killed — including **both disclosure directions** on the remark, which is the pair
a one-sided test would have missed: scoping it back to the comment id (nobody sees it) and widening it
to event-level (everybody does).

Proved on a fresh probe event, because both seeded settlements are finalized and a status move is
refused there — `QA15 stage-feed probe`, host plus Marlo Vance and Neon Tide on one split guarantee,
driven through all four stages with **Neon Tide** posting the only remark:

```
GET /activity?eventId=<probe>&typePrefix=settlement.,transfer.
  performer.a (did not comment)  pending_review 1 · comments_received 1
  performer.b (commented)        pending_review 1 · comments_received 1 · commented 1
  operator                       pending_review 3 · comments_received 3 · commented 1

…and on e1, whose rows were written BEFORE this fix, performer.a still sees:
  settlement.finalized 1            ← run 15's exact symptom, side by side with the fix
```

Marlo sees that the figures came back commented without seeing the remark she is not shown — which is
precisely the thread's own rule, and the reason `comments_received` needed a row of its own rather
than borrowing the remark's.

In the browser, as `performer.a@` on the probe:

```
before:  ✓ Open · ² Pending review · ³ Comments received · ⁴ Revised · ● Finalized
after:   ✓ Open · ✓ Pending review · ✓ Comments received · ✓ Revised · ● Finalized

Revision history: "Settlement finalized — figures locked" · "Figures re-issued after review"
                  "Comments came back on these figures" · "Figures sent out for review"
```

The last line is the other half: those four titles were `humanize`d identifiers until now, because no
party could see the rows to notice. Screenshot:
`docs/screenshots/qa-2026-10-01-run15/fixed-performer-sees-all-four-stages.png`.

biome 757 · settlement + activity + shares 198 passed, 0 failures.

## The six MINORs — verdict and scope each

### M1 · a finalized settlement still draws Approve — MY OWN HALF-FIX

`apps/api/src/routes/settlement.ts`. `ca08a8e` built the refusal (`LOCKED_SETTLEMENT_STATUSES` → 409
*"These figures are already final…"*) and left `signableByYou` answering `true`, so the roster draws a
control that can only 409. Run 14 reported the mirror image of this — the button existed and the API
said 200 — and I fixed the API surface and not the screen's. **A ruling implemented on one of its two
surfaces, ninth instance, and this time both surfaces were in one commit of mine.**

Scope: both `signableByYou` sites (`:1937` on the list read, `:2250`'s per-event one) gain the same
`LOCKED_SETTLEMENT_STATUSES` clause the confirm route already applies. §25.7.2's own standing rule,
quoted in `useEventAgreements.ts`: *"the UI must not offer a delete the API will refuse"* — a
signature is the same. Both halves asserted: a locked line is not signable, an open one still is.

### M4 · `POST /hold/rank` will rank an event that is not a hold

`apps/api/src/routes/holds.ts:196`. `holdSiblingsOf` defines the queue as `status = 'on_hold'`, and
`rankForHoldJoiningQueue` short-circuits on it — this route is the only one that does not ask. A draft
took 2nd place on 5 Dec and demoted a genuine 2nd hold to 3rd, permanently: cancelling the draft does
not clear its rank.

Verdict: refuse, 409, because the caller may edit this event — it is the event's state that has no
position to take, the same reasoning `assertNotFinalized` uses. The report's two extra consequences
both close at the root with it: the response can only omit the ranked row when the row is not in the
queue it reads, and a rank the route refuses to write cannot be left behind by a cancellation.

Scope: API-only today (the rank control only exists on an `on_hold` event's panel, and the wizard
PATCHes `status` before it ranks), which is why it is a MINOR — but an unguarded route that rewrites
other operators' numbers is worth the four lines.

### M6 · posting a comment does not refresh the Revision history beside it

`apps/web/src/components/useEventSettlement.ts`. `postComment` invalidates the comments query and not
`GET /activity`, so the two halves of one tab disagree until something else refetches. It matters more
after the MAJOR above: a party's comment now HAS a row in that panel, and the reader who wrote it is
the one who sees the stale version.

Scope: one `invalidateQueries` beside the one already there, keyed as `SettlementRail` and
`RevisionHistory` key it.

### M3 · an invitation to a cancelled night says "You are in"

`apps/api/src/routes/invitations.ts` and the Requests inbox. Nothing on the landing page, the
Dashboard card or the inbox says the show is off; accepting answers *"You are in — Nordic Synth
Showcase is on your shoWMe account now."*

**Two halves, and only one is mine.** DISCLOSING it is unambiguous — `inboxStatusFor` already crosses
a participation's state with the **event's** status for exactly this reason, and the Events list
badges `cancelled` *"because in this list it sat directly above a live show in identical styling"*. So
the invitation surfaces say it, in the vocabulary those two already use.

REFUSING the accept is a product call and is **not** taken: a cancelled night can be reinstated, and
an acceptance standing against it is arguably what the operator wants when it is. Recorded as a
§25.6 row rather than guessed.

### M2 · the Budget Planner's silence about a deal payable by the operator — PRODUCT QUESTION

The report says so itself and gives the two defensible answers. It is right that this is the
**un-contingent** half of §25.6's open payer row in one sense — on either ruling the money lands on
the host — but **not** in the sense that matters to the planner: the two rulings differ on HOW MUCH
(the whole fee as a transfer, or a share of it through the pool), and a planner row has to print a
figure. So (a) *"show every deal whose payee is a party and whose payer is an operator"* still needs
the ruling.

(b) is available now and forecloses nothing: **the planner says what it does not include**, which is
what this codebase already does three times for exactly this class of gap — Projections carries the
mirror sentence about the planner. Built; (a) recorded as the contingent half on the existing §25.6
payer row rather than as a tenth row.

### M5 · the reason a draft cannot be deleted is still not true of it

`packages/shared`'s `dealDeletability`, via `routes/deals.ts:512` and `:1519`. `hasSettlement` is
`Boolean(any settlements row on the event)` — an event-level fact making a per-deal claim: *"…so
\"QA15 unsigned probe\" is part of what has already been computed and read"*, about a deal the engine
has never seen and, at that moment, is refusing to run because of.

**Two halves again.** The SENTENCE is unambiguously false and is fixed: it says what is actually true
— this night has a settlement, so its deals are kept rather than erased — without claiming the engine
read this one.

WIDENING the permission is the product half, and a delete is irreversible, so it goes to Daniel with
the invariant that makes it safe already established: **a `draft` deal cannot have been reconciled.**
Compute refuses to run while any deal with a signatory is unsigned, and a deal with only observers
entitles nobody — so on both branches a draft deal has no `settlement_lines` row and no entitlement,
which is precisely what §25.7.2's rationale protects. That is a recommendation, not a decision taken.

### The six MINORs and five COSMETICs built — and one deliberately not

**M1** (`signableByYou` on locked figures) — both reads gained the clause the confirm route already
applies. Three mutations killed, including *"nothing is ever signable"*, which is how this closes
badly. Live on the probe once finalized: `signableByYou = False` where run 15 measured `True`.

**M4** (`/hold/rank` on a non-hold) — 409 with its own sentence. Two mutations killed, the second
being *"refuse every event"*, which would have taken the operator's only queue control with it. Live:
the draft is refused and its `hold_rank` stays NULL.

**M6** (the stale Revision history) — the event feed is now invalidated with the other three
settlement queries in `refresh()`, not just on the comment path, because every action there writes to
it. Matched on `eventId` by predicate rather than by a key prefix, because the rail and the history
mount different `typePrefix` values and a prefix match cannot know which. Live, with **no reload**:
the remark appears in the thread and *"A remark was added to the review"* appears at the top of the
history beside it.

**M3** (an invitation to a called-off night) — `targetEventStatus` on the landing read and
`eventStatus` on the inbox list, and the Requests row badges `Cancelled`. The ANSWER stays offered:
recorded as a §25.6 row, since a cancelled night can be reinstated and refusing would also stop the
act from DECLINING it. Live: *"Event · Nordic Synth Showcase — this show has been called off"*.

> And the browser corrected the first version of the fix, for the fifth time this stretch: I put the
> notice inside the "Do you accept?" panel, and the page renders **five** branches — the reader who
> arrives on the wrong account saw nothing at all. It is on the summary now, which is the one part
> every branch shows.

**M2** (the planner's silence) — `dealsPayingOffTheBill` counts the deals it can read and cannot
place, and `feeOffTheBillNoteFor` says so under the total. Deliberately a SEPARATE sentence from the
hidden-deal one: that one says the cost is higher because a deal is *"not shown to you"*, which is
untrue here — these are in plain sight on the Deals tab. Three mutations killed. §25.6's payer row
amended: the disclosure is built, the ROW still waits on the ruling.

**M5** (the untrue delete reason) — the sentence states the rule now instead of inventing a history
for the deal. The widening is a §25.6 row with the invariant that would make it safe: **a `draft` deal
cannot have been reconciled**, because compute refuses to run while a deal with a signatory is unsigned
and a deal with only observers entitles nobody.

**C1** (raw times with seconds) — `formatClockTime` in `@showme/shared`, and the two PRIVATE copies in
`apps/marketing` (`clockTime` in `profile.ts`, `formatTime` in `event.ts`) now delegate to it. Three
call sites for one rule, which is the review gate's own threshold — and the rule is *slice, never
parse*: these are offset-free wall clocks (#10), so a `Date` round-trip moves a Stockholm door time for
a reader in London. Six tests including the zone property. Live: *"Doors 19:00 · Show 20:00"*, no
seconds anywhere on the page.

**C2** (the Collaborators caption) — it named the adjusted net; `shares` divides the sum of the
positive entitlements the reader can see, and its own comment says that is *"the only honest
denominator"*. The caption says what the percentages do.

**C3** (a cancelled show inviting a setlist) — badged, and said in words beside the date, because a
badge is the label and *"this show is off"* is the consequence a performer about to spend ten minutes
needs.

**C4** (a raw email in the bell) — the accepting profile's name, resolved after the commit for the
same reason the whole notify block is a try/catch. The invited name still wins where the operator typed
one; the address is the last resort it always was.

**C5** (the settlement sub-tab is not in the URL) — **tried and reverted**, with the reason left in
the code so the next attempt is cheaper. Copying the event workspace's `?tab=` is four lines, but with
a THIRD search-bearing route in the tree TanStack's `useSearch({ from })` stops narrowing and resolves
to a union of every route's search type — so `Calendar.tsx`'s `.date` and `EventDetail.tsx`'s `.tab`
and `.budgetScope`, all untouched, stop compiling. It is the route TREE's typing: the `child()` helper
produces routes whose search is unmodelled, and mixing them with typed ones tips the inference over.
The proper fix exports typed route objects and reads `route.useSearch()`, inverting the import
direction `router.tsx` is built on — a router refactor, not a cosmetic fix, so it is not bought inside
one.

### The five NOTEs — one recorded onto an open row, four deliberately not acted on

**The payer question's sharper form** is now on §25.6's payer row rather than in a sweep report only.
Run 14's version had the pool absorbing a fee its named payer escaped; run 15's has **a co-promoter
carrying half of a contract it is not a party to** — The Lantern Hall's SEK 1,000 guarantee to Priya
Sound comes out `Priya +100,000 · Lantern −50,000 · Northlight −50,000`, and Northlight's own
Dashboard reads *"In review −SEK 500"*. That figure is what any ruling should be checked against.

The other four are unbuilt or already decided, each honestly labelled where it is, and **none is a
defect to fix**:

- **"Make Offer" leaves nothing the sender can read** — the route's own docstring says exactly this:
  *"a MESSAGE on the request … There is no threaded reply model for booking requests … inventing one
  is a schema + product decision, not something to smuggle into a button."* The terms reach
  `audit_log` and nowhere a user can see, and there is no Outgoing tab that could show them. A thread
  is a feature, not a fix, and the route said so before anybody pressed the button.
- **Audience stores RSVPs and cannot show them** — `routes/Audience.tsx` states it in as many words:
  *"There is no operator audience/RSVP read endpoint yet … NO mock contacts."* Unbuilt and saying so
  is the correct state; the other half of that brief item (Contacts import/export) run 15 verified
  works, CSV and all.
- **Back skips the tabs inside an event workspace** — this is the decision `EventDetail.tsx` already
  records: `replace: true` so *"the workspace still behaves as one screen rather than pushing a
  history entry per tab"*, and its stated benefit is precisely that *"Back still leaves the
  workspace"*. Run 15 calls it defensible; it is also already argued in the file. Not re-litigated.
- **`apps/marketing` is not running on :5173** — an environment fact about the dev stack, and the
  source of every console error seen all run. Nothing in the app is wrong. Worth knowing for the next
  sweep: `pnpm dev` does not start it, so seeded avatar URLs and the *"— public profile"* links
  refuse to connect.

## The full pass, after run 15 closed completely

```
biome check .                       757 files, no fixes
@showme/shared                      23 files ·  354 tests   (up from 349)
@showme/auth                         1 file  ·   41 tests
@showme/settlement                   4 files ·   82 tests
@showme/db                           2 files ·   25 tests
@showme/web (unit)                  43 files ·  658 tests   (up from 649)
@showme/api (full)                  65 files · 1507 tests · 0 skipped, 0 todo  (up from 1497)
pnpm test:e2e                       118 passed
```

**The first attempt at the API suite was NOT this**, and the difference is the lesson already in
CLAUDE.md earning its place: five suites reported `FAIL` with *"Timed out after 10000ms while waiting
for container ports to be bound"* and 45 tests counted as **skipped** — the Docker port allocator
wedged again, in the same session that recorded it. Restarting Docker Desktop produced the run above
with zero skipped. Recognising it cost a minute instead of an hour; without the note it reads exactly
like five broken suites.

`✓ src/` lines counted (65) against `Test Files 65`, and `skipped|todo` grepped to zero — the two
checks that keep a green shape over a suite that never executed from being read as a pass.

**Run 15 is closed in full:** the MAJOR, all six MINORs, four of five COSMETICs built and the fifth
reverted with its reason left in the code, and all five NOTEs dispositioned.

## Is a run 16 warranted — yes

Run 15's MAJOR is the argument. It was **not a regression** — those rows had been unreachable since
they were written — but nothing could see it until the previous tick put a widget on that feed, and
then it was visible in four of six seats at once. That is the third sweep in a row where the thing
most worth finding was only findable *because of* what shipped just before it, and this tick shipped:

- three activity writers re-targeted, one of them changing **who can read a row**;
- two `signableByYou` gates and a hold-route refusal, all three of them **withdrawing** something;
- two new fields on invitation payloads, with two screens reading them;
- a shared clock formatter that **replaced two private copies in a second app**;
- a query invalidation matched by predicate across two widgets' different keys.

Withdrawing a control and changing who may read a row are the two shapes whose failure mode is silent
and seat-specific — exactly what a browser check in one seat misses, which is how run 15's MAJOR
survived my own verification. The sweeps are converging (six MAJORs → one), which is a reason to
expect a shorter report, not a reason to skip it.
