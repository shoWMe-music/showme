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
