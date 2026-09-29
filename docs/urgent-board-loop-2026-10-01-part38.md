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

