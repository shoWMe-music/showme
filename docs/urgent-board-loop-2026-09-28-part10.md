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
