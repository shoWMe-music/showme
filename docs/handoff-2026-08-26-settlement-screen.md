# Handoff — the Settlement screen

**Written:** 2026-08-26, at the end of a context window.
**Branch:** `p2-audit-fixes` · **HEAD:** `949a283` · **the tree is dirty on purpose** —
see "What is uncommitted" below. Nothing here has been committed.

---

## Why this work started

The owner looked at our settlement screen and asked:

> *"In the settlement, it looked like this in the Claude design. Did you even look there at all?"*

The honest answer was **no**. The Budget Planner was built from the rendered
prototype — which is how its eight missing sections were found — and Settlement
never got the same treatment. It was built outward from the API surface instead.
`EventSettlementTab.tsx` was 257 lines: compute, a who-owes-whom board, mark-paid,
sign-off, finalize.

**This is the gap being closed.** It is not a polish pass.

## What the prototype actually shows

Rendered from `claude-prototype/claude-download-2026-07-19/Prototype/`, served on a
local port, `shoWMe All View.dc.html` → **Settlements** in the left rail → the
**Nils Frahm** row. A screenshot of the list view is committed at
`docs/screenshots/proto-settlements-list.png`.

Settlement in the prototype is **its own page**, not a tab:

- Header: a `SETTLEMENT` eyebrow, `H2` "Nils Frahm / Funkhaus", a venue · city · date
  line, a **Back to event** link, a status pill ("Pending review"), a currency
  selector, and a **Report to PRO** button.
- **Five tabs:** Overview · Deal Structure · Financials · Settlement · Payout.
- **A status rail:** Open → Pending review → Comments received → Revised →
  Finalized → Partly paid → Paid.
- **Actions:** Add revision · Mark finalized · Flag dispute.
- **Revenue & deductions**, editable, captioned *"Edit any figure — every payout
  recomputes live"*: Gross ticket revenue · Door sales · Additional revenue ·
  Ticketing fees · Tax · Refunds · Production expenses · Additional costs.
- **Totals:** Total revenue · Total deductions · **Venue rental** · **Adjusted net**.
- **Per-party rows that state the RULE, not just the number** — "70% door beats
  €50,000 gtee" → €50,750; "20% of adjusted net" → €14,500; "Venue rental €4,000 +
  10% of adjusted net €7,250" → €11,250.
- **Comments** thread with Post · **Revision history** · **Approval Status** (n/3,
  per-party Approve) · **Total Payouts** ("As operator your share is retained").

### Two things the prototype independently confirms

1. **`Adjusted net` = revenue − deductions − venue rental.** That is the
   off-the-top rental rule the owner approved, already implemented in
   `packages/settlement/src/deal-order.ts`. It is the number every percentage
   below it is a share of, and hiding it is precisely what makes a settlement
   read as arbitrary.
2. **Editable figures with live recompute** is the manual-override surface the
   meeting asks for — *"settlements must be manually editable for real-world
   variables, last-minute changes, cash on the night"* (`docs/meeting-2026-08-settlements-and-deals.md`, 00:39:19).

## What is uncommitted, and what it does

A background agent was building this and was **stopped by the owner mid-sentence**.
Its last words were *"Now fix the two test expectation sites:"* — but see the
verification section: everything is green, so either it had already fixed them or
they did not need fixing. **Do not trust that sentence over the measurements.**

The work it finished is **the engine and the API, not the screen**. 19 files
modified, 42 generated `api-client` models added.

### `packages/settlement` — the rule behind the number

- **`EntitlementBasis`** (`types.ts`) — a discriminated union naming which arm of
  `dealEntitlement()` fired, carrying the operands it compared:
  `guarantee` · `rental` · `door_split` · `guarantee_vs_door` (with `won`) · `paper`.
  Structured, **not a sentence** — the engine decides which rule fired; how that
  reads in a given language and currency is the UI's job, and a string baked into
  a framework-agnostic module would be a second money formatter.
- **`EntitlementLine`** — one deal's contribution to one party: `dealId`,
  `dealTotal` (what the whole agreement pays), `amount` (this party's portion after
  `allocate()`), `basis`, optional `bonus` / `escalatorApplied` / `commissionCharged`.
  Keeping both totals is what lets a performer on a 60/40 split see that the deal
  paid 10 000 and 6 000 of it is theirs.
- **`PoolLadder`** — `revenue → costs → pool → offTheTop → splitPool`, where
  `splitPool` **is** adjusted net (the reference app called it `adjustedNet`,
  `../showme-settle-fast/src/lib/models.ts:368`). `costs` counts only the share
  nobody was charged for; costs borne by a named party never touch the pool, they
  come off that party's entitlement as a deductible.
- **`PartyBreakdown`** gained `lines`, `commissionEarned`, `deductibles`,
  `residual` — and they add up exactly:
  `entitlement = Σ lines.amount + commissionEarned + residual − deductibles`.
- `dealEntitlementDetailed()` alongside `dealEntitlement()`; `serializeLadder`,
  `storeBreakdown`, `SerializedEntitlementLine`, `StoredBreakdown` exported.

### `apps/api` — and the visibility rule that matters

- `serializeSummary` now carries `ladder`.
- **`serializeSettlement` STRIPS the ladder from a party row, unconditionally.**
  A party row is exactly the payload that goes to a performer; the ladder is the
  operator's view of the whole night. Whoever may see it gets it from `ladderOf()`
  at the **top level** of the response, where the route has just decided they may:
  `ladder: capabilities.has("budget.view") ? ladderOf(visibleSettlements) : null`.
  **Preserve this split.** It is the ceiling from `packages/auth`, not a template
  choice, and the prototype renders an operator's view — do not reproduce it for
  an arm's-length party.
- `approvalRosterOf()` replaces `approvedParticipantIdsOf()` and now returns the
  **whole roster** with `approved` + `approvedAt`, not just the caller's own.
  `settlement_approvals` has always been written and was only ever read back for
  the caller; the prototype's "Approval Status n/3" is what needs the rest.
- `settlement_comments` and `settlement_approvals` **already exist** in the schema
  (`packages/db/src/schema/settlement.ts:192` and `:218`). No migration needed for
  the comments thread or the approvals roster.

### `apps/web` — barely started

Only `apps/web/src/components/settlementDocument.ts`: `describeBasis()` turns an
`EntitlementBasis` into the sentence a person checks against their contract
("70% of the adjusted net beats the €50,000 guarantee"), plus re-exported types.
**It formats and compares; it never computes** — `won` in particular is the
engine's answer, not a comparison redone against display-rounded figures.

**No screen was built.** `EventSettlementTab.tsx` and `routes/Settlements.tsx` are
untouched.

## Verification, measured just now

| gate | result |
|---|---|
| `pnpm turbo run typecheck` | **14/14 successful** |
| `pnpm biome check apps packages` | **clean** — 6 files were formatting-dirty, fixed with `--write`, safe fixes only |
| `packages/settlement` vitest | **34 passed** (30 in `reconcile.test.ts`) |
| `apps/api` `settlement.test.ts` + `settlement-seed.test.ts` | **55 passed** |
| full `apps/api` suite | **RE-RUN 2026-08-26, and it was RED** — 793 passed, **1 failed**. The failure was NOT this work: `shares.test.ts` asserted `operator_full` does *not* carry `rider.view`, which commit `e5928ec` had deliberately made false while leaving the guard behind (`riders.test.ts:660` already pins the new truth). Stale guard removed; the suite is **794 passed / 49 files**, and **795** with the pool-ceiling test added below. |

Remember: **a piped test run reports exit 0 on failure.** Read the summary line.
That is not hypothetical here — the run that hid this failure exited 0 through a pipe.

## The structural question — ANSWERED, by the prototype itself

*This section previously said the tab-vs-page choice was undecided. It is decided,
and the answer was in the prototype the whole time: **both**.*

`shoWMe All View.dc.html:2551-2557` — the event workspace keeps a **mini** Settlement
tab that renders only the headline payout, the status, and a single button,
**"Open full settlement workspace"**. That calls `openSettlement(id)`
(`:4747`), which routes to `route:'settlement'` — the flagship page at `:2564-2810`
with its own "Back to event" link and five sub-tabs.

So the event tab stays (thin), and the workspace is its own route. The objection
that a page "needs to answer whose settlement in its URL" still stands and is the
one thing left to decide: the prototype is single-performer throughout, so it never
had to.

## What to build next

In order of value, and **depth beats breadth** — a correct Overview with honest
empty states is worth more than five shallow tabs:

0. **Read "The pool ceiling" below first.** A performer's line is redacted of the
   pool, so the Overview and the party cards cannot assume those operands exist.

1. **The pool ladder rendered** — revenue, deductions, venue rental, adjusted net.
   The API serves it now; nothing displays it. Operator only — `ladder` is `null`
   for everyone else, and that is not an empty state to paper over.
2. **Per-party rows showing `describeBasis()`** next to the amount. The engine and
   the formatter both exist; no component calls them.
3. **The approvals roster** — "n/3" with per-party state. `approvalRosterOf()`
   serves it.
4. **The comments thread.** Table exists, no route reads or writes it yet — check
   before assuming.
5. **Editable revenue & deductions with live recompute.** Check what
   `manual_overrides` and the compute route already support before designing a new
   mechanism.
6. **Revision history** — check whether anything versions a settlement today
   beyond `settlements.version`.

## The pool ceiling — a hole this work opened, and how it was closed

**2026-08-26, after the handoff above was written.** The engine/API work served the
pool to arm's-length parties through a second door, and shipped that way for a while
in the working tree.

`serializeSettlement` strips `ladder` from every party row, and the route re-adds it
only behind `budget.view`. But the same figure rode out inside every percentage
line: `basis.pool` **is** `ladder.splitPool`, and on a `guarantee_vs_door` line
`door / basisPoints` reconstructs it a second way. One was gated and the other was
not, so the ceiling only looked closed. Before this work `computed` held six scalars
and no basis at all, so the exposure was new.

story.md:44 does not allow for the difference — a performer sees "only their own
slice — **never the event budget/pool** … even if an operator *wanted* to show them
(an inviolable ceiling)" — and `POOL_CAPABILITIES` (`packages/auth/src/presets.ts`)
is that sentence as code. **The owner chose to honour the ceiling.**

What changed:
- `redactPool()` in `apps/api/src/serialize/settlement.ts` removes `pool` and `door`
  from a line's basis. `serializeSettlement(row, { includePool })` **defaults to
  false**, so a caller that never thinks about this leaks nothing.
- The four callers that legitimately keep full fidelity now say so explicitly: the
  operator's `GET` (gated on `budget.view`), the `PATCH` (already required
  `settlement.edit`), the audit row, and the finalize snapshot. The snapshot also
  had a latent `.map(serializeSettlement)` — `map`'s index would have arrived in the
  options slot and silently redacted the frozen legal record.
- `SerializedBasis` marks `pool`/`door` optional. As *written* they are always
  present; optional is the truth on the *wire*, and it forces every reader to cope.
- `describeBasis()` drops the base from the sentence rather than printing a hole.

**It is not arithmetically airtight and must not be described as if it were.** A sole
payee told she took 70% and that the deal paid 4 830 000 can divide. Closing that
would mean withholding her own percentage — a term she signed, and the one number
that makes her line checkable. What the redaction genuinely removes is the night's
takings and costs, and any pool figure for a party whose deal does not already imply
one (a guarantee, a rental, a shared split). The full reasoning is in the
`redactPool` doc comment; do not "simplify" it away.

Pinned by two tests: `settlement.test.ts` → "redacts the pool from a performer's
basis, not just from the ladder" (which asserts a door_split line actually exists,
so it cannot pass vacuously), and the reference-fixture expectation in
`settlement-seed.test.ts`, which previously asserted the leak.

## Still unbuilt on the API side — measured, not assumed

The screen cannot be finished without these, and the handoff above understates the
first one:

- **Status transitions do not exist.** `settlements.status` is only ever written to
  `finalized` (`routes/settlement.ts`). Six of the eight enum values —
  `pending_review`, `comments_received`, `revised`, `partly_paid`, `paid`,
  `dispute` — are written by **no route at all**. The prototype's status rail, its
  status pill and five of its six action buttons (Send for review · Add revision ·
  Record partial payment · Mark paid · Flag dispute) have no backend whatsoever.
- **Comments have no authenticated route.** `settlement_comments` is written only by
  the share-viewer path (`routes/shares.ts`), for off-platform reviewers. No
  logged-in party can list or post. (The handoff said "check before assuming" —
  checked.)
- **Revision history has no source.** Nothing versions a settlement beyond
  `settlements.version`. The nearest real feed is the activity log, which already
  writes `settlement.overridden`.
- **The budget snapshot (decisions.md #16.8) is not built.** This is what the
  prototype's editable "Revenue & deductions" actually needs: budgets are the
  *predicted* figures, the settlement holds the *real* ones, and #16.8 says snapshot
  the budget when the settlement is created/finalized so planned-vs-actual survives.
  `PATCH /settlements/:sid` takes `manualOverrides` on a *party row* and is not that
  mechanism. Needs a migration — deliberately NOT bundled into the 0012–0021 deploy.

### Rules that bind this work

- **Never mock data.** Honest empty or disabled states where the API has nothing,
  and say so in the report. This rule has been broken here before and the owner
  noticed.
- **Layout and UX from the prototype; visual design from ours.** Not its colours,
  spacing or component shapes. `design-system/STYLE-GUIDE.md` is the authority.
- **Finalize locks FX and is irreversible.** It exists and is guarded. Do not
  weaken it.
- **Report to PRO** — Performing Rights Organisations (STIM/GEMA/PRS). A
  `performance_reports` table exists and **nothing writes to it**; regional PRO
  rates landed recently. If it cannot be made real in a pass, **leave the button
  out and write down why** — STYLE-GUIDE §7, no dead affordances.

## Reading order for whoever picks this up

`CLAUDE.md` (the Review gate; the note on how a piped test run lies) ·
`design-system/STYLE-GUIDE.md` · `.claude/skills/settlement` · `docs/money.md` ·
`docs/meeting-2026-08-settlements-and-deals.md` (**binding**, later than
`decisions.md`) · `docs/old-app-analysis-settlement.md` ·
`docs/old-app-analysis-flows-invite-settle.md` ·
`docs/handoff-2026-08-25-remaining-work.md`.

Then **render the prototype before designing anything.** This project's rule
exists because a past session drifted badly building from a description.

## Also still outstanding (from the previous handoff, unchanged)

- **Brevo IP allowlist** — owner action. Invitation emails still cannot send from
  production.
- **Deploy** — 9 commits since the last web deploy. Production runs API
  `showme-api-00014-qsj` and a web bundle predating that work.
- **Verify the typed-date fix in a browser** — committed at `949a283`, its browser
  check never ran.
- Open ClickUp decisions: `86cba8wfk` (which deals settle off the top),
  `86cba8wmb` (commissions cascade or parallel), `86cba8wqn` (bonus threshold
  basis), `86cba8wtb` (reimbursed costs and commissionable income).
- Reported and unbuilt: RSVP read endpoint · share `expires_at` never written and
  no revoke route · `POST /events/:id/handoff` neither returns nor emails its
  token · no per-IP rate limiting on share routes · `input[type="date"]` measures
  42px against the 40px token · the bucket is US-EAST1 while everything else is
  europe-north2.
