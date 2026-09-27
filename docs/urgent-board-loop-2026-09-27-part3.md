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

---

## Item 4 — the small fixes, cheapest first

### `86cbcgq5f` — a notification lands on the panel it is about

**Verdict: ALREADY BUILT, and built the better way. Two types were missing from its map;
that is the whole of the work.**

**I started this by doing it wrong, and the file I was about to edit said so.** My plan
was to write `?tab=deals` into the links the API emits. `notificationDestination.ts`
already derives the tab from the notification's `type` at READ time, and its header
argues against exactly what I was doing, for two reasons I had not thought of:

> *"A link written at the emitter is a thing twenty-odd call sites can each forget, and
> forgetting is silent… And a stored link is already written: rows sitting in people's
> bells right now would keep their bare path forever, whereas a rule applied at READ time
> fixes the whole backlog the moment it ships."*

Worse, it would have **broken the feature**: the allow-list matches
`/^\/events\/([^/?#]+)$/`, so a link carrying `?tab=` matches nothing and the
notification becomes unclickable. I reverted all five files before running anything.

**The audit's line — "all 18 notification links send a bare `/events/<id>`" — describes
the STORAGE, and the storage is deliberate.** What was genuinely missing was two entries
in the map:

| Type | Lands on | Why |
|---|---|---|
| `event.message_posted` | `messages` | Both deliveries — the stored bell and the realtime twin — carry the same bare link, so one rule covers both |
| `event.invitation_accepted` / `_declined` | `collaborators` | Where an invited party's standing is shown. The roster on Team / Crew lists who is already standing on the event, which is a different question — and is where `event.participant_added` correctly goes |

`deal.created` / `deal.updated` / `deal.deleted` are **activity rows, not notifications**;
they never reach a bell, so they do not belong in the map. Checked rather than assumed.

Mutation-checked: removing the message mapping turns the new test red. Suites: web 330.


### `123qy9rnh3f` — a reopened agreement says why

**Verdict: real, and exactly as the audit described it.** `deals.reopen.reason` has been
stored since reopening existed and was read back by nobody: the other side saw their
confirmation vanish and the Sign button return, with no statement of what is being
renegotiated. The reason is *asked for* in the dialog and then kept from the one person it
is addressed to.

It travels two ways now, because a party may meet either first:

- **On the deal** — `reopenReason` on the serialized deal, shown on the agreement card as
  *"Reopened because …"*, and only while the agreement is unsigned: once everybody has
  signed again the renegotiation is over and the sentence would be describing a settled
  thing.
- **In the bell** — the notification body leads with it. Without a reason it reads exactly
  as before, which matters because the field is optional by design: an operator fixing
  their own typo owes nobody an explanation, and the absence has to read as a complete
  sentence rather than a missing one.

**Only the reason is exposed, not the whole `reopen` record.** `priorSnapshot` is the
terms as they stood — a second copy of the agreement, with no business on a list response
— and `reopenedBy` is a user id; the person is named by the notification and the timeline.

Mutation-checked both ways (the deal stops carrying it → red; the bell stops carrying it →
red). Suites: biome 712 · api 1311 (2 new; `contacts` and `settlement` re-run alone after
the port flake) · web 330.

### `123qy9rnf9d` — the wizard asks two questions, and now says so

**Verdict: half already built, and the half that was missing is the labels.** The
duplicate TYPING is already handled: picking a performer profile fills the name field
when it is blank, with the same "offered into a blank, never over what you typed" rule
the venue prefill uses (`addSelection`). What survived is what Ran actually saw — two
fields that read as the same question.

They are not. The first names the **show** (it becomes `events.title`: what every screen,
notification and public page calls the night); the picker links the **act** (who the deal
is with and who is on the bill). The multi-performer label has always said "Festival /
event name"; the single one said **"Artist / performer"** — the same words as the picker
beneath it, over a field holding something else.

So: it is called **"Event name"**, with one line saying how the two relate — *"What the
night is called. Linking the act below fills it in."* No behaviour changed, nothing
renamed in the data, and the act's name is still offered into the blank.

Proven live: the step reads `EVENT NAME *` over that line, and picking **Neon Tide** in
the picker fills the name field with "Neon Tide". Suites: biome 712 · web 330 · e2e 112.
