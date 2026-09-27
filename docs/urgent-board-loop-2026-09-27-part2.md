# Urgent board — the build loop, part 2 (2026-09-27)

Continues `docs/urgent-board-loop-2026-09-27.md`, which closed **item 1**
(`123qy9rpqp0` + `123qy9rpqn0`) in seven commits, `4fa6136` → `b4ba17d`. Same rules: plan
here before building, prove on the running stack, biome + web + API + e2e, commit naming
the ticket, no deploy, no ClickUp writes.

This file carries **item 2** (the outbound invite chain) onward.

---

## Item 2 — the outbound invite chain · `123qy9rnf87` · `86cbcehmp` · `86cbcftg3`

**Verdict: mostly ALREADY BUILT — the 2026-09-04 analysis is stale, and one rung is
missing on both paths a user actually takes.**

`docs/bug-analysis-2026-09-04.md` D1 calls this *"the largest item on the board"* and
scopes it as an epic of six steps. It was right on the day it was written. Since then
`86cbcehmp` has been largely built, and reading the code against the six steps gives:

| Step, in Ran's order | State today | Where |
|---|---|---|
| 1. Inviting a performer moves `draft` → `suggested`, **from the wizard and from Invite Collaborator** | **THE GAP.** The rung exists and fires on a path the web app never calls | `lib/event-status-ladder.ts` · `routes/participants.ts:339` |
| 2. A suggested event arrives as an incoming request, and shows on the performer's calendar | **Built** — `GET /me/event-invitations`, surfaced on Requests, Events and Calendar, with `requestStatus` deciding the tab | `useEventInvitations.ts`, `Requests.tsx:262`, `Calendar.tsx:559` |
| 3. Accept → event becomes `pending` | **Built** — rung 2 fires inside `answerInvitation` | `routes/participants.ts:864` |
| 4. Deal confirmed by all sides → `confirmed` | **Built** | `lib/deal-confirmation.ts:262` |
| 5. Decline → operator notified, **with a note**, and can edit the date to re-issue | **Built, both halves.** The note rides the notification and the activity row; a date change on a `suggested` event puts a `declined` participation back to `invited` and re-notifies | `routes/participants.ts:867-907`, `lib/event-change-requests.ts:430-476` |
| 6. `86cbcftg3` — a change on an agreed night raises a change request | **Substantially built** (`NEGOTIATED_FIELDS` = date · venue · room, with a confirm/decline banner). The audit §5 already records the remaining gap: the same UI in the messages box, and always saying where a change happened and by whom | `lib/event-change-requests.ts` |

**So the epic is one small fix plus a known §5 tail.** This is the audit's own headline
one level down: the board's count is not the work's size.

### The gap, precisely

`advanceEventStatus` has exactly four call sites (checked exhaustively, not by a
truncated grep — the first pass at this missed one to `head` and nearly produced a wrong
plan):

- `routes/participants.ts:339` — `POST /events/:id/participants`
- `routes/participants.ts:483` — `POST /events/:id/participants/off-platform`
- `routes/participants.ts:864` — `answerInvitation` (rung 2)
- `lib/deal-confirmation.ts:262` — rung 3

**Neither path the product actually uses is in that list:**

1. **The wizard.** `POST /events` writes its performers through `joinParticipants`
   (`routes/events.ts:303`) with `status: "invited"` and no ladder call.
2. **Invite Collaborator.** The modal posts `POST /invitations` with a `targetEventId`
   (`useEventCollaboratorInvite.ts:1`, and its own header says so), and that route never
   touches the ladder.

`POST /events/:id/participants` — the one path that DOES fire rung 1 — has **no caller in
`apps/web`** at all.

So, live: an operator invites an act → the event stays **`draft`** → the act accepts →
rung 2 moves it `draft → pending`. The `suggested` state, which is the whole of step 1,
is skipped on every path a person can take.

**The ladder already carries the scar.** `nextLadderStatus` accepts `draft` for
`invitation_accepted` and explains it as legacy: *"every event invited BEFORE this
shipped is sitting at `draft` with live invitations on it (30 of them in production)"*.
That is true, and it is also the symptom — nothing was moving them to `suggested` in the
first place. Fixing rung 1 upstream is what makes that branch a genuine backstop for old
rows instead of the normal case.

### Scope

- **Rung 1 on the wizard's path.** `joinParticipants` fires `performer_invited` once, if
  any joining participant holds a performing role — once, not per performer: the ladder
  is idempotent (forward-only, `draft` → `suggested`) but a loop that calls it per row
  reads as if a second act could move the status again.
- **Rung 1 on the invitation path.** `POST /invitations` fires it when the invitation
  targets an EVENT and its role is a performing one. A co-operator or a crew invite must
  not: the ladder is about the act's answer, which is the same rule
  `PERFORMING_EVENT_ROLES` already states at `participants.ts:338`.
- **Tests**: the rule itself is already exhaustively tabled in
  `event-status-ladder.test.ts`; what is missing is that the two routes CALL it. One test
  per path, each asserting the event's status after the call — plus the negative (a crew
  invite leaves a draft alone), which is the assertion that can actually fail on a
  copy-paste.

**The decision this hides:** whether an invitation that is later **revoked or declined**
should drop the event back to `draft`. **No** — the ladder is forward-only by design, and
Ran's step 5 is explicit that a refusal produces a notification and the operator's choice
of what to do next, not a status change. An event whose only act said no is still an
event somebody is trying to fill, and reverting it would erase that.

---

## The QA sweep after item 1 — triage

`docs/qa-sweep-2026-09-27-run3.md` (run against `b4ba17d`): **0 blocker · 8 major · 12
minor · 4 note**, no screen failed to render, no 5xx. **All four of today's changes were
driven end to end and verified** — the guards, the tokens, the two selects, the per-date
room answer and the `ROOM` cell. The damage is elsewhere, and the loop's rule is to fix it
before item 2.

| # | Major | Verdict | Where it goes |
|---|---|---|---|
| 1 | Every new event is born with a private book nothing reads; costs typed in it never reach the settlement | **Regression of `f996c14` + migration `0046`, one line.** Fixed below | done |
| 2 | Financial Projections forecasts the whole adjusted net as profit — the planner calls the same night a loss | Real, money-wrong, two screens of one event disagreeing by SEK 51,245 | next |
| 3 | A request for an already-sold room creates a second event in that room, silently | Real — and it is audit §5 `123qy9rprbx`, now reachable because today's columns exist. `GET /events/date-conflicts` already answers `roomIsBusy`; the wizard already warns; the Requests inbox and Create Draft ask nothing | next |
| 4 | Every settled figure explains itself with the DEAL's percentage instead of the PARTY's ("100 % of SEK 50,000" above a payout of SEK 30,000) | Real, and a label rather than a sum — the money is right, the sentence over it is not | next |
| 5 | A cost added after the first settlement run can never reach it; "Planned vs actual" compares the settlement with itself | Real. `copyBudgetOnce` returns early and Recalculate imports nothing | next |
| 6 | A co-host can rename the host's show with no change request and no notice | Real, and narrow: `NEGOTIATED_FIELDS` covers date/venue/room by design (§6 above), so the title is outside it — the question is whether renaming needs a notice, not a confirm | next, with a stated decision |
| 7 | A public `/shares/<token>` link discloses the booking requester's email | Real and a disclosure. The cause is "Create Draft" writing `Contact: … <email>` into `events.notes`, which the share viewer renders verbatim | next — the fix is at the write, not the render |
| 8 | Typing `50` into a pre-filled `0` tier field stores `500` | Real, 10× on a figure that reaches the settlement | next |

The minors and notes are recorded in the sweep file and folded into item 4's list rather
than repeated here.

---

## Log

**QA-1 — an event is born with one book, and it is the ledger.** `POST /events` opened a
`private` budget for the creating operator, which is the exact shape `f996c14` and
migration `0046` removed the day before — so every event created after them was born back
into it. Two books on a night with nobody to keep one from, a scope chooser that can only
be got wrong, and the settlement reading the other one: the sweep typed SEK 5,000 into "My
budget" and settled at **Deductions − SEK 0**.

The fix is the one line, but the reason it survived a suite of provisioning tests is worth
recording: **every test in `budget.test.ts` seeds its event straight into the database** as
a legacy row, so not one of them could fail on what `POST /events` itself opens. The suite
was structurally incapable of catching it — CLAUDE.md's "ask what the check CAN fail on",
exactly. So the test added registers `eventRoutes` and creates through the API, and it is
mutation-checked: putting the private insert back turns it red.

Proven live: a new event through the wizard has **one** book, `shared`, and the planner
renders **no scope chooser**. Suites: api 1307, all 62 files, no flake.

**QA-7 — a third party's email stops travelling in free text, and the rest of that finding
was mine to get wrong.**

The sweep filed this as *"a shared event link hands a stranger the email address of whoever
sent the booking request"*, and my first fix was to strip `notes` out of the share document
altogether. **That was wrong, and I reversed it before committing.** The Share & Export
dialog says, in its own words, what the Event details section contains: *"Title, date,
venue, capacity **and the notes on the show**."* Sharing the notes is a declared feature an
operator ticks, not a column that leaked into a payload — I had read the publish panel's
promise (*"they never see … your notes"*), which is about the **public marketing page**, a
different door, and one the sweep confirmed is clean.

What is left is the real defect and it is at the write: **"Create Draft" put the sender's
email address into `events.notes`**, which the operator never typed and cannot be expected
to audit before sharing. The address is already on the request row the event links to, and
in the inbox's own Email cell, so free text bought nothing. Personal data goes in the
column that holds it.

**Two things recorded rather than changed, because they are Ran's call:**

- The dialog says *"There are no anonymous links"*, and the app is honest about it —
  `useShareExport.ts:242` always sends `access: "protected"`, which `resolveShareViewer`
  refuses without a verified recipient. But the API still accepts `access: "public"`, which
  skips that check entirely. Either the product means to offer anonymous links (and the
  dialog's sentence is wrong) or it does not (and the API should stop accepting the mode).
  The sweep's repro reads as a public share, which the UI cannot currently make.
- Whether an anonymous share, if it stays, should carry notes at all.

**QA-2 — Projections stops calling something profit that is not profit, and stops reading
a book the settlement refuses to read.**

Three changes, and one deliberate non-change.

1. **The ledger only.** It summed every budget the reader could see, so a co-operator's
   private margin book moved the figure — a book `copyBudgetOnce` never copies and the
   other operator cannot see, which means two co-hosts read two different numbers for one
   night. The night's book is the shared ledger; a view over the night reads that.
2. **A cancelled night forecasts nothing** and is out of the pipeline, under every scope —
   the same `ne(status, 'cancelled')` the settlement engine and the planner's own fee
   derivation already use. A `draft` stays: a night being planned is what a pipeline is.
3. **"Net Profit" is now "Revenue − costs", and the column is "Before deals".** The
   arithmetic was always right and the word over it was not: what the acts take is not a
   budget line, so on a door-split night where the performers take the whole adjusted net
   this printed SEK 50,000 profit at a 60 % margin for a night the planner called a
   SEK 1,245 loss and the settlement left the operator nothing from. One line under the
   KPIs now says why the two screens differ, which is the thing a reader with two numbers
   actually needs.

**The non-change, and it is the bigger half.** Projections still does not subtract what
the deals pay. Doing it properly is not a label: a percentage deal's fee is derived from
the door forecast (`useBudgetSeed.performerFeeOf` → `computeBudgetProjection`), scoped per
reader, and caveated as a floor when a deal is hidden from the reader
(`costsIncompleteNoteFor`). Reproducing that in a second React screen would put a **third**
opinion about the same money in the codebase, which is the failure mode this repo keeps
recording. **The recommendation is that this belongs in the API** — one projection
endpoint over the same engine the settlement uses, server-side where the deals and budgets
already are, with the screen rendering it. That is its own piece of work, not a fix, and
it is written down here rather than half-built.

Proven live: the KPI reads *"REVENUE − COSTS · SEK 147,700 · 68% of revenue, before
deals"*, the column reads **BEFORE DEALS**, and the cancelled `Winter Gala` has left the
table and every total. Suites: biome 712 · web 326 (6 new, mutation-checked both ways) ·
e2e 112.

**QA-3 — the double-booking check now runs on the door that creates events from
requests.** The mechanism was built, correct, and had two callers; the Requests inbox was
not one of them. `GET /events/date-conflicts` already answered `roomIsBusy: true` for the
exact case the sweep drove, and `useDateConflicts` already composed the sentence the New
Event wizard shows. This asks it in the two places the decision is actually made:

- **On the card**, for every PENDING request that names a venue and a night — triage
  happens on the list, and *"Main Room already has …"* is what makes one request different
  from the four beside it. Asked over the whole inbox rather than the filtered view, so
  switching tabs re-asks nothing.
- **In the Create Draft dialog**, keyed to the DIALOG's date rather than the request's —
  so choosing one of the sender's alternate nights re-asks the question instead of warning
  about a night nobody is drafting.

**It warns and never blocks**, in amber and not red, because that is the rule the wizard
already states and the reason is Ran's: a promoter may deliberately run two shows on one
night, and a warning that cannot be overridden is a refusal wearing a softer word.

Proven live, both doors and the thing that makes the second one worth having: a public
request for Main Room on 2026-10-14 (the night `Marlo Vance — Album Release` is confirmed
in that room) shows *"Main Room already has "Marlo Vance — Album Release" on this night.
You can book it anyway."* on the card and again in the dialog — and **moving the dialog's
date to the 20th clears it**. Suites: biome 712 · web 326 · e2e 112.

**Coverage, stated honestly:** the sentence is already unit-tested (`useDateConflicts`) and
what was missing was a caller, so the new code is wiring. Its failure mode is "nobody
asks", which a unit test of the same wiring cannot catch any better than the live walk
above; the durable guard would be an e2e spec, and that needs seeded data with a clash
that the seed does not currently carry.

**QA-8 — a clicked numeric cell selects what is in it, so a typed 50 is 50.**
The three ticket-tier cells start at `0` — a figure the system put there, not one anybody
typed — and a caret landing before it turned a typed "50" into "500" and a typed "250"
into "0250". Tabbing in was always fine, because a tab selects the contents; so the defect
only ever bit the reader who reached for the mouse, and it bit silently, on a number that
feeds `seedTicketTiersIntoBudget` and reaches the settlement.

The fix is in `NumericField`, which is every numeric cell on that tab (the tiers and the
guest-list limits), so a click now behaves exactly as a tab already did. The `mouseup`
default is prevented alongside it, because Chrome collapses a focus-time selection when
the button comes back up — which would have undone the fix for the one input method it
exists for. **The trade, stated:** a click no longer places a caret mid-number. For a
figure of a few digits retyping is the cheaper of the two.

Proven live with real key presses, not a programmatic fill: clicking into MAX on a fresh
tier and typing `50` reads **50**, clicking into PRICE and typing `250` reads **250**, and
the row stores `{"max":50,"price":250}` where the sweep measured `{"max":500}`. Suites:
biome 712 · web 326 · e2e 112.

**QA-4 — a settled figure explains itself with the PARTY's percentage, not the deal's.**
The money was never wrong: Σ = 50,000, Σ net = 0, Marlo 30,000 and Neon Tide 20,000. The
sentence over each was. Every payee's line carried `settled.basis` verbatim — which
describes the DEAL's rule, *"100% of the adjusted net SEK 50,000"* — so a 60/40 bill told
both acts they were getting 100% of the same figure.

The fix is to carry what the line was always missing rather than to reword around it:
`EntitlementLine.partyBasisPoints`, computed in `reconcile` **from the same weights
`allocate()` divided by**, so the percentage can never describe a different split from the
one that paid. Absent on a single-payee deal, where the party and the deal are the same
thing. It threads through four layers — engine type, `snapshot`, the API's
`EntitlementLineResponse` (declared, or Fastify strips it), and the sentence.

**A settlement finalized before today says "your share of" as it always did** — true and
vague rather than precise and wrong. A finalized settlement is a legal record and is not
rewritten to gain a field.

Proven live on the seeded 60/40: *"100% of the adjusted net SEK 50,000 — **your 60%** of
the deal's SEK 50,000"* over SEK 30,000, and **your 40%** over SEK 20,000.

**One e2e spec caught the change and was right to** — `settlement-overview.spec.ts` pinned
the literal words "your share of". It now asserts `/your \d+% of the deal's/`, which is the
property worth pinning: the sentence names A PERCENTAGE THAT IS THE PARTY'S, and it fails
if that regresses to the deal's. Suites: biome 712 · settlement 64 (2 new) · web 328
(2 new) · api 1307 (`profiles.test.ts` re-run alone after the port flake) · e2e 112.

**Left as an open question rather than silently skipped:** events created *during the
regression window* (between `f996c14` and this commit) still carry both books, and
migration `0046` cannot heal them — its guard is "the event has no shared ledger yet". If
that window reached production, those events need a heal that MOVES the private book's
lines into the ledger rather than relabelling it; if the window only ever existed on
laptops, nothing needs healing. That depends on whether `f996c14` was deployed, which is
not something this loop may find out by deploying.
