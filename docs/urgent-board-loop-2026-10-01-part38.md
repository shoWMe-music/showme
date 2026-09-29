# Urgent board loop — part 38 (2026-10-01)

Continues part 37, full at 359 lines, which closed four of run 14's six MAJORs and recorded one for
Daniel.

---

## 1. Run 14 MAJOR — a signature survives the recompute that changed the figure it signed

Five parties signed; a walk-up-sales line went SEK 18,000 → 36,000; Marlo's entitlement went
30,000 → 40,800 and her 10:54 signature still read **"Signed off"**. A regex over the whole rendered
roster for `changed since|moved since|re-?sign|stale` matched **nothing**, and `grep` confirms no path
in the API deletes a `settlement_approvals` row.

### The split, which the report drew and I agree with

**Clearing signatures is a product call.** The confirm route stores no `confirmed_snapshot` *on
purpose* — *"the numbers stay editable right up to finalize"* — and writes the figures as they stood
into `audit_log`, so the forensic record is intact. **The screen's silence is not defensible either
way**, so that is the half to build.

### I verified the suggested mechanism and it does not work

The report proposed `settlement_approvals.approved_at` versus `settlements.updated_at`, and marked it
unverified. **Taken literally it would cry wolf on almost every settlement.** Measured what moves
`updated_at`:

| Cause | A figure change? |
| --- | --- |
| compute, when `sameStoredBreakdown` says the breakdown moved | **yes** |
| manual override (`settlement.override`) | **yes** |
| a settlement line created / updated / deleted | **yes** (via the recompute) |
| the review-status route — sent for review, revised, disputed | no |
| **finalize** (`status: "finalized"`, `version + 1`, `updatedAt`) | no |
| `syncPaymentStatus` → `partly_paid` / `paid` | no |

The last three all happen **after** signatures as a matter of course, so a bare comparison would put
"the figures moved" on every finalized, paid night. `version` is no better: it bumps on finalize too.

### The precise version, and it still needs no new state

Confine the comparison to the **review window** — `pending_review`, `revised`,
`comments_received`. Inside it, every cause of an `updated_at` move is one the signer should hear
about (recomputed, overridden, a line edited, or re-issued to them), and finalize and payment are
outside it by construction, so the warning cannot fire once the night is closed.

```
figuresMovedSince = approved && status ∈ REVIEW && settlements.updated_at > approvals.approved_at
```

`settlement_approvals` has only `id, event_id, party_participant_id, approved, approved_at`, so the
alternative — recording the version or the entitlement at signature — is a migration, and **what** to
store is entangled with the clearing question. That entanglement is the reason the clearing half goes
to Daniel rather than being guessed at.

### Scope

1. `ApprovalResponse` gains `figuresMovedSince: boolean`; the roster derivation already loads both
   timestamps' owners (`approvalRosterOf` and the settlement rows), so no new query.
2. `EventSettlement.tsx`'s roster row says it beside "Signed off".
3. The clearing question goes to `decisions.md` §25.6 as its own row.

### Built

`ApprovalResponse.figuresMovedSince`, derived where the approvals are already assembled — `roster`
holds the signature, the settlement row itself holds when its figures last moved, so no new query and
no new state. `SETTLEMENT_REVIEW_WINDOW` sits beside `PAYMENT_TRACKING_STATUSES` and excludes
`dispute` for the same reason `/settlements/awaiting-signature` does: a party who objected is not
being asked to re-read the figures they objected to.

The roster row now reads **"Signed off · Figures changed since"**. Client regenerated.

### Mutations — five, all killed, and one cost a clause

| Mutation | Result |
| --- | --- |
| never say it (the reported silence) | killed |
| **drop the review-window guard — the naive comparison** | killed |
| drop the signature guard — warn on an unsigned row | killed |
| invert the comparison | killed |
| **`finalized` counts as the review window** | killed |

The second and fifth are the ones that matter: they are the report's own suggestion, and a test that
did not finalize could not tell them from the fix.

**A sixth mutation survived and cost me a clause.** I had written `approved && underReview && …`, and
dropping `approved` changed nothing — `approvedAt` **is** the signature, since the roster stores a
timestamp only when one was given and *"approved once is approved"* means nothing writes
`approved: false` beside a time. So the clause could not change the answer: a comment pretending to be
code, and the fifth instance of that shape. Deleted, with a note that it becomes load-bearing the
moment a **declined** state lands on `settlement_approvals` carrying its own timestamp — which is
exactly what the §25.6 objection row proposes.

### Proved on the running stack, control first

```
e1, FINALIZED/PAID, all six signatures predating finalize:
  bb b2 b1 b3 b4 b5 — approved=True, movedSince=False      ← the naive comparison fails HERE
```

That is the control, and it is the assertion the report's suggestion would not have passed: finalize
bumps `updated_at` on every row, so a bare comparison lights up every closed night.

Then a night put back under review (Spring Warmup, restored afterwards):

```
freshly signed:            b6 approved=True  movedSince=False   ·  b7 approved=False movedSince=False
after updated_at moves:    b6 approved=True  movedSince=True    ·  b7 approved=False movedSince=False
browser:  "Approval Status 1/2 · The Lantern Hall (you) · Operator · Signed off · Figures changed since
                              · Marlo Vance · Performer · Pending"
```

**Seed restored and verified:** both Spring Warmup settlements `finalized`, zero approvals on e2.

### The clearing question is recorded, not guessed

`decisions.md` §25.6 gains it, with the disclosure explicitly noted as **already built and not
waiting on the answer**, and with the one fact that ties the two halves together: if a signature is to
clear, `settlement_approvals` wants the version or entitlement it signed against — which is also what
would let the disclosure name the **old figure** rather than only the fact. One migration, two halves,
decided together.

### Suites

`npx biome check .` 756 clean · web **630** · API `settlement-own-read` **19** + `settlement`
**145** together · `tsc` clean on api and web.

---

## 2. Run 14's MINORs — grouped, because one rule closes several

Thirteen findings remain (11 MINOR, 2 COSMETIC, 3 NOTE). Grouped by the rule they share rather than
worked one at a time:

| Group | Findings | The one rule |
| --- | --- | --- |
| **A. finalized means closed** | a finalized settlement still accepts a signature; a deal can be added to a finalized night and can never settle | a write against sealed money is refused or disclosed |
| **B. Total Payouts** | "Priya Sound payout SEK 1,250" is half her payout; the agent's "Total payable" double-counts the commission | a figure is labelled with whose it is, and a sum counts each movement once |
| **C. copy** | "Invitation accepted" names nobody; the deal card states the rule part 29 replaced; the finalize refusal talks about opening; the stepper ticks stages that never happened | a sentence is true of its reader |
| **D. holds** | a hold is born with `hold_auto_promote = false`; "Cancel show…" does not promote the queue while "Release hold" does | placing a hold joins a queue that advances |
| **E. Integrations** | a finished screen routed by nothing while Settings says it has not shipped | — |

### A1 — a finalized settlement still accepts a signature

`POST …/settlements/:sid/confirm` answers **200** on a `finalized` night and writes an approval row
plus an activity entry dated after the freeze. It checks ownership and `maySignOwnSettlement` and
**never reads `settlement.status`**.

This is not a taste question: the finalize dialog promises *"the figures freeze into an immutable
record … cannot be recomputed and cannot be un-finalized"*, and **compute already refuses with exactly
that sentence**. `assertNotFinalized` exists and is called by **seven** routes — compute, the manual
override, and the four settlement-line routes — and confirm is the one write that skipped it.

It needs its **own** sentence rather than that helper's, because the helper's message is about
recomputing (*"the figures cannot be recomputed"*), which is not what a party pressing Approve is
being told. What they need to know is that there is nothing left to agree to, and that signatures
given before the freeze still stand.

### A2 — a deal added to a finalized night

`POST /events/:id/deals` answers 201 on a sealed night, and `compute` then answers 409, so the
agreement can never reach the settlement. **The Budget Planner already has the precedent and the
words** — *"This night is settled. The settlement kept its own copy of this budget the first time it
ran, so anything changed here now revises the plan without moving the reconciliation."*

So this needs no new ruling: **follow that precedent.** Allow the record — a paper agreement signed
late is a real thing — and say on the Deals tab that the night is settled, so the reader is not left
to discover it from a 409 on a button they press next. Refusing the create outright would be a new
product rule and is not mine to make; disclosing is the half that is unambiguous.

### Group A built

**A1.** The confirm route refuses on a locked settlement, with its own sentence. Three mutations
killed — no guard (the defect), only `paid` counting as locked (so `finalized` slipped through), and
refusing **every** signature, which would have dropped the consent given before the freeze. That third
one is why the test asserts both halves: a guard that quietly discarded existing signatures would be a
worse defect than the one it closed.

**A2.** The Deals tab now says it, following the Budget Planner's precedent rather than inventing a
rule — allow the record, disclose the consequence. Read from the same settlements query `EventDetail`
already runs, so TanStack serves it from cache.

### Proved on the running stack — run 14's exact probe, inverted

```
POST /events/…e2/settlements/…f3/confirm        (Spring Warmup, finalized)
run 14:  200 {"approved": true}  + an approval row and an activity entry dated after the freeze
now:     409 "These figures are already final, so there is nothing left to sign.
              Signatures given before they were finalized still stand."
         approvals on e2 after the refusal: 0
```

Deals tab on the finalized Album Release, as `operator@`:

> "Deals you are a party to. Each party sees only its own line. **This night is settled, so a deal
> added now is recorded but will not reach the settlement.**"


## Group B — Total Payouts, two findings in one panel

Both are the same shape: a row's **label** and the panel's **total** make claims the figures do not
support. Neither number is wrong. What is wrong is what the panel says they are.

### Which file settles it

`apps/web/src/components/useEventSettlement.ts` builds `payouts` (three concatenated sources) and
`totalPayable` (one `reduce` over the same three), and `apps/web/src/routes/EventSettlement.tsx:1298`
renders them. The caption is already pure and tested — `payoutsCaption` in
`apps/web/src/components/settlementDocument.ts` — and it is not the defect: it is the sentence that
makes both defects visible.

### B1 — verdict: the label is wrong, the figure is right

`withheldPayees` is documented as *"THE PARTIES THIS READER PAYS BUT CANNOT READ A SETTLEMENT FOR"*
and filters `transfer.fromParticipantId === ownParticipantId`. So the amount is **this reader's leg**
of a payout, not the payout. The row then borrows the label of the `payable` rows beside it —
`` `${name} payout` `` — and on a night whose crew fee is split between two operators the host reads
*"Priya Sound payout — SEK 1,250"* over Priya's own *"SEK 2,500"*.

The `payable` rows are the payee's whole net and `${name} payout` is true of them. Only the withheld
branch overclaims, and it overclaims by construction, not only when there happen to be two payers.

Scope: relabel the withheld rows to name the leg — **`Paid by you to ${name}`** — which is true
whether the reader is the only payer or one of several. The figure, the total and the caption stay.
`entitlementGapSentence` already says *"At least … belongs to a party whose settlement is not shared
with you; it is in Total Payouts as a transfer"* — the second surface is already honest, so this is a
one-surface fix and the "at least" there is what tipped me off that the row was the liar.

### B2 — verdict: the total is wrong, and the term cannot simply be deleted

A commission is a **representation transfer out of the act's entitlement** (`b2 → b5, 300000`).
`payable` already holds Marlo's SEK 30,000 in full, so `ownCommissionMinor + Σ payable` counts the
SEK 3,000 twice, under *"What this event pays out, including your own share."*

**Before removing it, what the term is load-bearing for.** `ownCommissionMinor`'s docstring records
QA9-8: an agent has no positive net of their own, so an agent who cannot read their client's
settlement had `payable` empty and read **SEK 0** on every screen while being owed SEK 3,581.
Deleting the term unconditionally reintroduces that. So the rule is not "drop the commission", it is:

> A commission is additional to this panel's total only when the party who pays it is **not already
> counted in it**. When the payer's figure is in the panel, the commission is inside that figure.

Membership is `payable` ∪ `withheld` by `participantId` — not "is the payer visible", because a
visible party whose net is not positive contributes nothing to this total and a commission out of them
is genuinely additional.

Scope: the commission splits into two sums. The additional part keeps the row `Your commission` and
keeps being added. The inside part gets its own row, **`Your commission, paid out of the payouts
above`**, and is not added — so the column still reconciles by eye, which is the check QA6-4 and the
entitlement reconciliation both exist to protect. `partiesWithOwnCommission`, `ownFigure` and
`includesYours` keep using the **full** `ownCommissionMinor`: the agent's own card and headline are
about what the night owes them, which is unaffected by whose total already contains it.

### The decision this hides — none, and that is worth saying

Neither half is a product call. B1 states a fact about a transfer; B2 restores `Σ rows = total`. The
one thing I am choosing is that the inside commission stays **visible** rather than being dropped from
the panel, because QA7-28 and QA9-8 were both filed for an agent reading a screen that omitted their
own money, and a row that says where the money came from is the opposite of that.

### Where the rule goes, so a mutation can reach it

Rows and total are built in a React hook, where a surviving mutation proves nothing (the standing
lesson: export the decision and test it directly). Both move into `settlementDocument.ts` as one pure
`payoutRows()` returning the rows **and** the total from one pass over the same three sources — the
same inputs the hook already reduces twice, so this consolidates rather than abstracts. It is also the
only way to assert the invariant both findings broke: that the total equals the rows the reader can see
added up, minus exactly the ones whose labels say they are already inside another.

Also noted while reading: `TotalPayouts`' docstring says the total is *"a sum of formatted API figures,
not arithmetic on money — see `settlementTotalPayable` in the hook"*. There is no
`settlementTotalPayable`, and the sum is `BigInt` over minor units, which is the opposite of what the
sentence claims. Corrected in passing.

### Group B proved on the running stack

Run 14's own probe had to be rebuilt — e1 is sealed and the state it was measured in is gone. The
reconstruction, on `QA14 Draft Fee Night`: Priya Sound added as crew, her SEK 2,500 fee held as a deal
whose **payer is the co-host**, and the night's takings split so the greedy allocator has to use both
operators to pay her:

```
revenue: 25,670 collected by the host · 4,530 collected by Northlight  (SEK 302,000 pool)
transfers: host → Neon Tide 211,400 · host → Priya 1,250 · Northlight → Priya 1,250
the host's visible settlements: itself and Neon Tide — Priya's is withheld (no shared deal)
```

Which is the finding exactly: Priya's payout is SEK 2,500 and the host pays half of it.

| | before | after |
|---|---|---|
| host, Total Payouts | `Priya Sound payout — SEK 1,250` | `Paid by you to Priya Sound — SEK 1,250` |
| agent, Total Payouts | `Marlo Vance payout 30,000` · `Your commission 3,000` · **Total 33,000** | `Marlo Vance payout 30,000` · `Your commission, paid out of the payouts above 3,000` · **Total 30,000** |

Screenshots: `docs/screenshots/qa-2026-10-01-run14/b1-paid-by-you-to-priya.png`,
`b2-agent-total-payable-no-double-count.png`.

Two things learned in the rebuilding, worth keeping:

- **Deleting a budget line does not remove the settlement's copy of it.** The DELETE answers
  `{"deleted": true}` and the settlement carries on reading its own sealed line (0025). The cost had to
  be deleted a second time through `/settlement/lines`. Nothing is wrong here — but "I removed it and
  recomputed" is not the same statement as "the engine no longer sees it".
- **`payee_participant_id` on a cost line is a DEDUCTION, not a payout** (`cost-bearing.ts`: *"that
  party's entitlement drops by the whole amount"*). My first attempt paid the crew member by naming her
  the payee of a cost and gave her −SEK 2,500. A crew member is paid by a DEAL. Worth knowing before
  reading a settlement that looks upside down.

## Group C — four copy findings, four different kinds of untrue

### C1 — the notification names nobody · `apps/api/src/routes/participants.ts:1036`

**Verdict: the row is missing the one fact it exists to carry.** `notifyProfileMembers` is handed
`body: note || undefined` and no `actorDisplay`, so with no note — the common case, the note is
optional — the bell shows *"Invitation accepted — Nordic Synth Showcase"* over a blank line. On a
six-party bill the operator cannot tell which invitation was answered.

The collaborator-invitation path already answers this (`invitations.ts:1288`): the TITLE names the
person (`"<who> accepted"`), the body says what it means, and `actorDisplay` carries the *"by …"* line.
Following it rather than inventing a shape.

**Scope, and the distinction the precedent makes available.** Two different people are involved and
they are not always the same: the **profile whose invitation it was**, and the **user who pressed the
button** — which for a represented act is the agent (#14). So the title names the participant and
`actorDisplay` names the actor, and a delegated accept reads *"Marlo Vance accepted — …"* / *"by Astra
Booking"*. `resolvePendingParticipation` does not currently select a name; the participant list it
already runs gets `display_name` and a join to `profiles.name`, so this costs no extra query.

### C2 — the third copy of a rule that moved · `DealAgreementCard.tsx:347`

**Verdict: drift, not a decision.** Part 29 moved the seal to the **first** signature. The terms
editor's hint says it correctly (*"They freeze when the first party signs"*, `lib/errors.ts:83`) and so
does the 409. This card's `draftLabel` still says *"Terms live until every party signs"* — and the
commit that fixed the other two quotes this very sentence twice in its own comments as the thing that
went wrong. A rule written three times disagreed with itself, which is the shape this file keeps
finding.

Scope: one string, taking the editor's words so the product has one voice about it.

### C3 — one sentence answering two questions · `useEventSettlement.ts:1225` and `deal-confirmation.ts:383`

**Verdict: the sentence is right at one of its two call sites.** *"The settlement cannot open until
every agreement is signed"* is exactly true in `NothingSettledYet`, where nothing has been computed.
It is false beside a disabled **Finalize** on a settlement that is open and in review — which is where
run 14 read it. The rest of the sentence is good and stays: it names the deal, prints no UUID, and
offers a button.

**Both surfaces, because a ruling implemented on one of two is implemented nowhere.** The server has
the same sentence and the same two doors: `assertEveryAgreementSigned` sits inside `reconcileEvent`,
deliberately shared by compute and finalize, so the 409 says *"cannot open"* when what was refused was
a freeze. Each gains the action it is about, and the tail changes with it (*"then run the settlement
again"* → *"then finalize again"*).

This is the "one field answering two questions" shape for the seventh time, and the answer is the same
as ever: not a wider sentence, a second route through it.

### C4 — the rail ticks stops the settlement never visited · `settlementDocument.ts:98`

**Verdict: `settlementSteps` infers history from position, and position is not history.** Every index
below the current stage is marked `done`, so a settlement finalized straight out of review reads
`✓ Open · ✓ Pending review · ✓ Comments received · ✓ Revised · ● Finalized` over a Comments tab saying
*"No comments yet"* and a revision history saying *"Nothing has happened to these figures yet."*

Three of the seven stops are things something actually WRITES, and the event feed records each:
`settlement.pending_review`, `settlement.commented` (the comment path sets `comments_received`
silently, so the evidence is the remark), and `settlement.revised`. So the rail reads the same feed the
Revision History panel two cards below it already reads — which is the real argument for this fix: the
two can no longer disagree, and they did.

A stop with no evidence renders `pending`, which the stepper already draws as a dim numbered dot. No
new visual state, and an unvisited stop behind the marker reads like an unvisited stop on a transit
map. `open`, `finalized`, `partly_paid` and `paid` stay positional: the first is where a settlement is
born and the last three are derived from the transfers, so reaching one IS the evidence.

**The one degradation, stated:** the feed is party-scoped and paginated, so a reader served fewer
entries may see an unlit stop for something that did happen. That is the safe direction — it can
understate, never claim — and the Revision History beside it already has exactly this property, so the
two stay consistent with each other.

### No decision for Daniel in any of the four
C1 follows a shipped precedent, C2 and C3 make a sentence true of its reader, C4 makes a rail agree
with the history under it. Nothing here chooses a product rule.

### Group C built — and two more surfaces found in the building

**C1.** The title names the party whose invitation it was, the body never blank, `actorDisplay` the
person who pressed it. Proved live on a **delegated** accept, which is the case that argues for two
fields rather than one:

```
before:  Invitation accepted — QA14 Draft Fee Night   body=''      actor=''
after:   Marlo Vance accepted — QA14 Draft Fee Night  body='They are on the bill.'  actor='Astra Booking'
```

Five mutations, four killed. The fifth **survived and should have**: I had written
`pending.displayName ?? pending.profileName`, and nothing can reach the first term — the only writer
of `event_participants.display_name` is `stub-purge.ts`, which sets it and NULLs `profile_id` in the
same statement, so a row carrying one has no profile and can never resolve here. Deleted rather than
given a fixture: a branch nothing can reach is not a safeguard.

**C2.** `"Terms live until the first party signs"`, in the terms editor's own words. Live on
*Sent · 0 of 2 signed*.

**C3.** Both doors, at the server and on the screen, and both went one step further than the finding
asked. Compute's half says *"cannot be **run**"*, not *"cannot open"*: compute is also the
**recompute**, and a recompute of a settlement open for a week is not an opening either. The web
half names **both** disabled buttons, because the panel greys out Recalculate *and* Finalize:

```
POST …/settlement/compute   →  This settlement cannot be run until every agreement … then run the settlement again.
POST …/settlement/finalize  →  These figures cannot be finalized until every agreement … then finalize again.
screen (open, in review)    →  These figures cannot be recomputed or finalized until every agreement is signed.
```

Three server mutations and two web mutations killed, each asserting what must **survive** as well as
what must change — one sentence for both doors passes a test written for either door alone.

**C4.** The rail asks the history instead of inferring it from position. Six mutations killed. And
the first version of the fix was itself wrong, which the browser caught:

> I read the same unfiltered feed the Revision History panel reads, and the rail came back with
> **Pending review unlit on the seeded Album Release — a stage that provably happened.** The feed is
> capped at twenty rows and that page holds four transfers, three cancelled deals, a task, a share
> and a rider; `settlement.pending_review` is off the end of it. I had written the truncation into
> the docstring as an acceptable degradation. It is not acceptable when the API can be asked the
> question, and **the Revision History panel had exactly the same defect all along** — it was
> answering *"what happened to these figures"* from whatever survived the crowd.

So `GET /activity` gained `typePrefix`, and both panels ask for what they are about. A **prefix**,
not an exact type, so a caller can name a family (`settlement.`) and not carry a list that goes
stale; comma-separated rather than a repeated parameter, because this repo has no array query
parameter anywhere and how one is spelled is decided in three places that can disagree — Fastify's
parser (a lone value arrives as a string, not a one-element array), axios's serializer, and the
OpenAPI schema orval reads. One string needs no agreement. `%`, `_` and `\` are escaped, so a prefix
cannot become a wildcard.

Four mutations on the filter, all killed — including **the filter replacing the visibility WHERE
instead of being ANDed onto it**, which would pass every assertion about what comes back while
leaking everything that should not.

After it, on e1, the rail and the history agree for the first time:

```
✓ Open  ✓ Pending review  3 Comments received  4 Revised  ✓ Finalized  ✓ Partly paid  ● Paid
Revision history: … Settlement finalized … Settlement signed off ×6 … Settlement pending review
```

Screenshots: `c2-terms-live-until-first-signature.png`, `c4-rail-and-history-agree.png`.

### Two things that cost time and are not about the code

- **A test of mine failed on a false premise about its own fixture, for the third time this session.**
  I hung the scoping test's settlement on the PERFORMER's participant and then asserted the performer
  could not read it. They are a party to their own settlement; of course they can. The fixture has to
  encode the situation the assertion is about.
- **`tsc -b apps/api` emits JavaScript into `apps/api/src`.** 182 untracked `.js` files appeared
  beside their sources. The repo's own script is `pnpm --filter @showme/api run typecheck`
  (`tsc --noEmit`) — use that.
- **Docker's port allocator wedged**, and Testcontainers reported it as *"Timed out waiting for
  container ports to be bound"* — first on the reaper, then on Postgres itself, with
  `NetworkSettings.Ports` empty against a `HostPort: "0"` request. Not load, not the suite:
  restarting Docker Desktop fixed it and nothing else did (`TESTCONTAINERS_RYUK_DISABLED` moved the
  failure rather than removing it). Worth recognising, because it looks exactly like a flaky test.

## Group D — holds, two findings that are one sentence apart

Both are about a hold LEAVING a queue and the queue not closing behind it. The promotion machinery
itself is correct — run 14 proved that with a control — so neither finding is about `holds.ts`'s
arithmetic.

### D1 — verdict: nobody chose `false`, and three other places say `true`

`events.hold_auto_promote` is `boolean not null default false`, from the initial scaffold, with no
comment and no ruling behind it. Every other statement of the rule says the opposite:

- `packages/shared/src/holds.ts`: *"`holdAutoPromote` defaults to **`true`** when undefined"*, and
  `computeDeclinePromotion` reads `sibling.holdAutoPromote !== false // undefined → true`.
- the release dialog: *"Every hold below it moves up one, **unless it is frozen**"* — promotion the
  norm, freezing the exception.
- the hold panel draws a **"Frozen"** badge, which is a word for the unusual state.

Because the column is `NOT NULL`, `undefined` can never reach the shared helper from the database:
every hold the app creates arrives already frozen, and the `undefined → true` branch is dead against
real rows. So the fix is the column default, not the wizard sending a field — a wizard that has to
send `true` to get the documented behaviour is the same defect one layer out.

**And the rows already written.** `false` today means one of two things — born that way, or frozen on
purpose — and unfreezing somebody's deliberate freeze changes who gets a date. That is not a
migration's decision to take blind. But the distinction is RECOVERABLE: the only way to choose `false`
is `POST /events/:id/hold/auto-promote`, which writes an `audit_log` row with
`action = 'hold.auto_promote'`. So the backfill moves exactly the holds no such row was ever written
for, and leaves every deliberate freeze standing. No question for Daniel, because the data answers it.

### D2 — verdict: one rule, two controls, and only one of them runs it

`computeDeclinePromotion` has exactly one caller — `dropHoldAndRepack` in `routes/holds.ts`, serving
`/hold/decline` and `/hold/release`. The Events row menu's **Cancel show…** is
`PATCH { status: "cancelled" }` (`hooks/useEventRowActions.tsx:221`), and `routes/events.ts` does not
call it. So which control the operator reaches for decides whether the queue advances — and the one
that *promises* promotion in its own dialog is the one the Events list does not offer.

Scope: the repack moves into `lib/hold-queue.ts`, beside `placeHoldInQueue`, which is already that
module's job — *"which rows are the queue, and the one write"*. Both callers then run one rule.

**The constraint that shapes it.** `dropHoldAndRepack` resolves `writableHoldIds` — a per-hold
capability read — BEFORE opening its transaction, with a comment saying why: the test pool is
`max: 1`, so a query nested inside `database.transaction` deadlocks rather than failing. The events
PATCH already has an open transaction by the time it knows the status moved, so the split has to be
**plan before, apply inside**: `planHoldQueueClose(request, event)` reads the siblings, the
promotions and the writable set; `applyHoldQueueClose(tx, request, plan)` writes the ranks and the
audit and activity rows. That is also the only shape that keeps the "a promotion on somebody else's
hold gets an actor-less audit row" rule in one place rather than copied.

### No decision for Daniel in either
D1 follows three existing statements of the rule and leaves every deliberate freeze alone. D2 makes
two controls that end the same fact about a night have the same effect, which is what the release
dialog already promises.

### Group D built

**D1** — the column default is `true` (migration 0048), and the backfill moves only holds with no
`hold.auto_promote` audit row. Proved by the dev database itself: `UPDATE 0`, because the one frozen
hold on it is run 14's own control probe and it carries that audit row. The deliberate freeze stood;
a hold born frozen would have moved.

Then live, the wizard's own two calls with no flag sent anywhere:

```
POST /events {title, eventDate 2026-12-05, venueProfileId}  → created
PATCH /events/… {"status":"on_hold"}                        → rank 3
in Postgres: rank=3, hold_auto_promote=TRUE   (before this change: false)
```

`seedHoldPool` in `holds.test.ts` stopped pinning `holdAutoPromote: true` — pinning it is precisely
why thirty-three passing hold tests could not see that every hold the app created arrived frozen. A
fixture stating a value the app never writes tests the fixture.

**D2** — the repack is `planHoldQueueClose` / `applyHoldQueueClose` in `lib/hold-queue.ts`, and the
events PATCH is its second caller. Live, on the three holds above:

```
PATCH /events/…e4 {"status":"cancelled","cancellationReason":"…"}   (Cancel show… from the Events list)
before:  Nordic 1 (auto) · QA14 probe 2 (FROZEN) · D1 probe 3 (auto)
after:   Nordic cancelled · D1 probe 1 · QA14 probe 2 (kept its number)
activity: hold.promoted {"to":1,"reason":"queue_closed"} actor=e2e-operator
```

Which is the whole finding and its guard in one run: the queue advanced, the frozen hold was jumped
rather than moved, and the promotion is filed under the operator's own name because it is their hold.

Seven mutations, five killed. **Two survived, and they are one fact seen twice**: the
`before.status === "on_hold"` clause in `routes/events.ts` and the `status !== "on_hold"` early return
in `planHoldQueueClose` protect each other, so removing either changes nothing. Rather than delete a
line, both are now labelled for what they are — the rule lives in `hold-queue.ts` where the next
caller inherits it, and the call site's clause is a short-circuit that saves a query. That is the
pattern `placeHoldInQueue` in the same file already documents, in the same words, for the same reason:
*"mutating either away leaves the answer unchanged, which is the honest reason there is no test
pinning them."*

biome 756 · holds 37 (up from 33) · hold-queue + the five event suites 199, 0 skipped.
