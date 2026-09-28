# Urgent board loop — 2026-09-28, part 10

Continues `-part9.md`, which closed run 6's four majors and three of its minors. This part is
run 6's remaining minors and cosmetics, planned before each is built. Nothing deployed, nothing
written to ClickUp.

---

## The plan, cheapest first

| | Verdict | The file that settles it | Cost |
|---|---|---|---|
| **QA6-13** | real — one modifier | `routes/budget.ts` | trivial |
| **QA6-9** | real — a pronoun that is not person-aware | `settlementDocument.ts` | small |
| **QA6-18** | real, and **wider than reported** | `@showme/shared` + three readers | small |
| **QA6-12** | real — a summary that presents the first reason as the whole one | `useEventSettlement.ts` | small |
| **QA6-15** | real — the chooser offers the sender | the review-recipient chooser | small |
| **QA6-11** | real — a made-up quantity beside a deliberately blank price | `useBudgetEditor.ts` | small |
| **QA6-8** | real — the write path never joins `profiles` | `routes/participants.ts` | small |
| **QA6-10** | real — the Events list carries no status at all | `routes/Events.tsx` | medium |
| **QA6-14 · QA6-20** | **recorded, not built** — see below | | |
| **QA6-19** | **a feature, not a fix** — see below | | |

### QA6-18 is wider than the report says

The report's finding is that the profile editor shows every seeded link's platform as *"Choose…"*,
because `ProfileLinkListField.tsx` builds its options as `{value: "Spotify"}` while the database
holds `spotify` — and its own docstring states the rule it then broke: *"the value stored is the
label"*.

Checked further: `link.platform` is rendered **verbatim** as a chip label in both
`ProfilePublicPreview.tsx` and `apps/marketing/src/profile.ts`. So the seed's data does not only
fail to select — it renders on the **public page** as a lowercase `spotify`. The editor is where it
was caught; the public chip is where it costs something.

So the fix is a canonical **slug** plus a **display label**, in `@showme/shared` beside
`amenityLabel`, `dealTypeLabel` and `profileTypeLabel` — which is the pattern this repo already
uses three times for exactly this shape — and all three readers use it. Lower-case is the canonical
form because it is what the database already holds and what the API writes; matching is
case-insensitive so a title-cased value from the current editor still selects.

*The decision it hides:* whether an unknown platform is still allowed. It is — the picker was
always *"a shortcut, not a gate"*, and a link whose platform is not in the list keeps its own
string and renders it.

### Recorded rather than built

- **QA6-14** — `GET /events/:id/permission-sets` returns one `operator_full` row per event created,
  because `POST /events` provisions a set per event. Nothing surfaces the list in a picker today.
  De-duplicating it is a data-model question (one set per profile, referenced by many events)
  rather than a display fix, and it is not urgent-board work.
- **QA6-20** — three identical `GET /events/:id/participants` per settlement load, from three hooks
  asking the same question. The fix is one shared hook, which is a refactor of the settlement
  screen's data layer; filed for `docs/codebase-reuse-audit.md` rather than done here.
- **QA6-19** — `audience_rsvps` is written by one route and read by nothing but tests. That is a
  **missing screen**, not a defect: `routes/Audience.tsx` says so in its own comment and the
  navigation gate reasons about it. Worth flagging that the public page promises the fan *"Your
  name, email and city go to the organiser of this event so they can count on you"* — a sentence
  made to a third party that is not yet true — so this belongs on the board as a feature with that
  sentence attached, not in a sweep's minor list.

---

## Built, and the two verdicts that are not the report's

### `QA6-10` — the status column is a CONFIRMED decision; the cancelled show is not

`routes/Events.tsx` carries the reason in place: *"CAP AND STATUS ARE GONE FROM THIS TABLE
(Ran, ClickUp `123qy9rpe3y`: 'No Cap Status needed'; Daniel confirmed both, 2026-09-27)"*, and the
argument holds — the chips above filter on exactly that field and the Board view **is** the status,
grouped.

It does not hold for a show that is **off**. The Board has four columns (Pending · On hold ·
Confirmed · Concluded), so a cancelled night is not drawn there as cancelled — it disappears — and
in the list it sat directly above a live show in identical styling, same venue, same *"Not
started"*. So: a badge, and **only** for `cancelled`, which is the same judgement the Requests inbox
already makes for a cancelled invitation. The column stays gone.

### `QA6-15` — the chooser is right to list the co-operator, wrong to list the reader

`SendForReviewDialog` sorted the reader's own row **last** rather than removing it, with a comment
defending its presence: *"`delivery` includes the operator's own row — a co-operator reviewing is a
real thing"*. True, and not what the sweep saw: it saw the operator being offered their own name on
their own settlement. Only the **reader** is dropped now, so on the host's screen the co-host stays
and vice versa — and an event whose only party is the reader says *"There is nobody else on this
settlement to send it to yet"* rather than showing an empty picker.

### An e2e test was asserting the QA6-9 defect

`settlement-overview.spec.ts` asserted `/your \d+% of the deal's/` and **passed** — on the
OPERATOR's Overview, in front of the PERFORMER's card. That is exactly QA6-9: the captions were
written for the reader's own card and were not person-aware. The assertion now reads
`Marlo Vance's \d+% of the deal's`, which is the sentence that is true, and the caption is
`entitlementRules(…, { isYours, name })` with three unit tests on the pronoun.

### And a dead constant went with a fix

`SEEDED_TICKET_SHARE` (0.8) had exactly one reader — the seed row that guessed a head count. With
the guess gone the constant is gone too, its reasoning kept where the decision now lives. A number
waiting to be used again is the thing `CLAUDE.md`'s review gate says to delete.

## Proven on the running stack

| | Before | After |
|---|---|---|
| **QA6-8** | `POST /participants` → `"name": null` | `"name": "Marlo Vance"`, `publicSlug`, genres and a signed avatar, and the list agrees |
| **QA6-13** | `PATCH /budgets/:bid {operatorCostSplit}` → **400** *paymentProcessing Required* | **200**, `paymentProcessing: null` |
| **QA6-18** | three selects reading *"Choose…"*; public chips `spotify` | **Spotify · Bandcamp · Instagram** in the editor and on the public page at `:5173` |
| **QA6-10** | *"Winter Gala \| Marlo Vance \| The Lantern Hall"* | *"Winter Gala \| **Cancelled** \| Marlo Vance \| …"* |
| **QA6-11** | private ledger `TICKETS PLANNED 328` beside the shared book's 320 | `TICKETS PLANNED 0 · TICKET REVENUE SEK 0` |
| **QA6-15** | chooser listed `The Lantern Hall (Operator)` to the operator | Marlo Vance · Neon Tide · Priya Sound · Northlight Presents · Astra Booking Agency — the co-operator kept, the reader gone |

Screenshot: `docs/screenshots/qa-2026-09-27-run6/qa6-15-recipient-chooser-without-the-sender.png`.

**QA6-9 and QA6-12 are unit-proven, not browser-proven** — both need a co-promotion with an
off-the-top rental and a full-access grant to become visible, which is the scenario the next sweep
drives anyway. Said plainly rather than implied: the pronoun has three tests and the
multiple-reasons caption has none of its own beyond the 401-test web suite.

## Suites

biome **732** clean · api **1379** (4 files to the Testcontainers flake, each green alone) ·
shared **299** · web **401** · e2e **112** · `tsc --noEmit` clean in shared, api, web and marketing.

---

## Run 5's five small minors, built from the plan in `-part8.md`

### `QA5-7` — the engine had already committed to the wording; the screen hadn't

`computeBudgetProjection`'s docstrings say twice that `0` means *"no break-even"* and that
*"the screen renders that as 'no break-even', never as 'none needed'"*. It rendered **`0`**,
directly above a chart captioned *"Revenue never passes total cost inside 420 capacity."*

`0` is two answers and the number cannot tell them apart, so `breakEvenReachable` now travels with
it: **false** when the contribution per head is non-positive or the attendance scan found no
crossing, **true** when there was nothing left to cover (the honest zero — the standing revenue
already pays the entered costs, so none are needed). Three mutations, three red.

### `QA5-9` — `replace: true` keeps the decision and drops its only cost

Not writing `?tab=` is stated in `EventDetail.tsx` as a decision, and the sweep's second symptom —
`history.back()` leaving the event — is what it buys. `replace: true` keeps every bit of that and
removes the cost. **Measured in the browser:**

```
click Deals   → …/e2e…e1?tab=deals      history.length 3
click Budget  → …/e2e…e1?tab=budget     history.length 3   ← no entry pushed
reload        → Budget Planner selected                     ← was Event Details
history.back()→ /login                                      ← still leaves the event
```

The default panel writes no parameter, so a bare `/events/:id` stays bare.

### `QA5-6`, `QA5-10`, `QA5-8`

- **QA5-6** — `useIdleLogout` leaves a one-shot note (`localStorage`, beside the two
  `showme.security.*` keys the feature already owns) and `AuthScreen` reads and **clears** it in a
  lazy `useState` initialiser. Proven by stamping the activity three hours back with a 15-minute
  limit: *"You were signed out after 15 minutes without activity. Change or switch off that timeout
  in Settings → Security once you are back in."* Four tests, including four junk values that must
  render nothing and still clear the key.
- **QA5-10** — `/audience` is the **fourth** instance of the boundary wrapper `/setlists`,
  `/reports` and `/projections` use. As `professional@`: *"An audience belongs to the room and to the
  act"*, and the CRM no longer renders.
- **QA5-8** — the chooser asked *"are there lines?"* where it means *"is this still open?"*. Both
  conditions gained `isFinalized`, so `Spring Warmup` (finalized, zero `settlement_lines`) shows
  **Finalized** instead of offering *Start from the Budget Planner*.

Screenshot: `docs/screenshots/qa-2026-09-27-run5/qa5-6-idle-logout-says-why.png`.

## Suites

biome **732** clean · api **1379** (4 files to the Testcontainers flake, each green alone) ·
shared **302** · web **405** · e2e **112** · `tsc --noEmit` clean.

**Still open from run 5:** `QA5-11` (a decision — whether #14's view floor lets a represented act
see the request its agent sent in its name), `QA5-12` (the schedule template appends with no way to
replace), `QA5-13` (a ticket-tier summary drawn from local state), `QA5-14` (three faults on the
Settlements dashboard).

---

## Run 5's last four — three built, one recorded as a decision

### `QA5-12` — the schedule is asked, not appended to

`applyDrafts` appended unconditionally, so a second **Load starting point** on a schedule that
already held the ten-row starting point produced **twenty** rows, every label duplicated, no
warning, and ten clicks to undo. Both answers are real — two templates making one bill is a thing
people do, and so is starting over — so the choice is raised rather than assumed:

> **This schedule already has items.** The schedule holds 10 items, and the starting point would
> bring 10 more. Adding keeps both sets; replacing clears the 10 that are there first.
> `Cancel · Add to them · Replace them`

An empty schedule still applies straight away: there is nothing to ask about.

`removeMany` is new on the editor and mirrors `addMany` exactly — a loop of `mutateAsync`, awaited,
because there is **no bulk delete on the API** and inventing one for a button would be a
migration-scale answer to a usability trap. Cleared FIRST and awaited, so a failure half-way leaves
*fewer* rows rather than the doubled schedule this exists to prevent.

**Proven:** first apply, 10 rows, no dialog. Second apply, the dialog. Pressing **Replace them** →
`select count(*) from schedule_items where event_id=…e3` → **10**, where the defect produced 20.

### `QA5-13` — a live total that read like a saved one

The blur-save is an ordinary pattern; what made it a finding is that the summary band was computed
from the DRAFT, so *"50 max · 40 est."* sat on screen while `events.extras.ticketTiers` held
`est: 0`, and a reload took the screen back to zero. Both are worth keeping — a live total while you
type, and the truth about what the record holds — so the band now says which it is.
`hasUnwrittenChanges` uses the same reference-identity test the editor's retire effect already uses:
`change` builds a new object per keystroke, so a draft that is still the object the last write
carried has had nothing typed into it since.

**Proven:** `120 max · 85 est.` → type 77 into Door entry's estimate → `120 max · 102 est. ·
unsaved — click outside the field to save` with the field still focused → blur → the marker goes and
the figure stays.

### `QA5-14` — three faults, three answers, and one of them is "say it is not built"

| | |
|---|---|
| `OUTSTANDING 20,700` beside `FINALIZED 20,700` with nothing saying they overlap | The overlap is deliberate and its reasoning is at `settlementTotals` — so it is now **stated** under the strip: *"These count the same money four ways rather than splitting it: Outstanding is everything not yet paid, so anything Finalized or In review is inside it too."* Four disjoint buckets would be the wrong fix; the figures were each correct and the strip read as arithmetic that did not add up. |
| **YOUR PAYOUT** over the operator's retained residual | The settlement screen already says *"As operator your share is retained"*; this column had borrowed the wrong half of it. The header is **Your share** for an operator. Proven: `EVENT · DATE · EVENT STATUS · SETTLEMENT · YOUR SHARE`. |
| *"Top venues by revenue — No revenue yet … once your events start settling"* beside a finalized settlement | **There is no data source.** `GET /insights/profiles/:id/revenue` returns one total and no per-venue roll-up exists, so the copy blamed the reader's data for a missing feature and told them to wait for something that would never arrive. It now says *"Not built yet — Revenue is totalled per event today, not per venue. This panel is waiting on that roll-up rather than on your settlements."* |

### `QA5-11` — recorded in `decisions.md` §25.6, deliberately without a recommendation

`GET /booking-requests?direction=outgoing` answers off `sender_profile_id`, and an agent pitching on
behalf of their act **is** the sender — so the seed's offer *"Marlo Vance, 9 Dec, at The Lantern
Hall"* is visible to the agency and invisible to Marlo. #14 moves the business ACTIONS to the agent
and leaves the act a view floor; whether an offer carrying the act's own name and a fee range sits
inside that floor, or inside the agency's private pipeline, is a product call with a real cost either
way. `on_behalf_of_profile_id` is already on the row, so either answer is a `where` clause.

**§25.6 now carries seven rows, and the seventh is the first with no recommendation attached.**

## Suites

biome **732** clean · web **405** · e2e **112** · `tsc --noEmit` clean.
