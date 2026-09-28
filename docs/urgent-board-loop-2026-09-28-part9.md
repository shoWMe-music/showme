# Urgent board loop — 2026-09-28, part 9

Continues `-part8.md`, which crossed midnight. **Dated to today** rather than carrying the
27th forward again: the audit and the sweeps are the 27th's, the work below is the 28th's, and
a file that claims a date it was not written on is the thing `CLAUDE.md` warns about.

Same standing instruction; same rules. Nothing deployed, nothing written to ClickUp.

---

## QA sweep run 6 — all seven verification checks hold

Run 6 (`docs/qa-sweep-2026-09-27-run6.md`, 913 lines) re-drove everything this loop landed
since run 5 and every one of the seven passed, including both halves of QA5-2, all three
statements of QA5-1, the hold-queue rank, and the QA5-4 correction — the venue picker is
there, and the agent placed a hold **4th in a queue of three** with it. It also confirmed
QA5-1's fix on the co-host's own single-line view, where the caption correctly still reads
*"Your own line."*

New: **4 MAJOR · 10 MINOR · 2 NOTE · 4 COSMETIC**. Two are fixed below.

---

## `QA6-17` — every invoice the app writes is denominated in EUR

**Verdict: real, and the same file had already learned this lesson at a surface that only
displayed it.** The file that settles it: `apps/web/src/routes/Invoices.tsx`.

```
select issuer_ref,total,currency from invoices order by issued_at desc limit 1
→ QA6 Sound Rentals AB | 250000 | EUR
```

on an account whose Settings → General reads `BASE CURRENCY SEK` and whose every event, deal,
budget and settlement is SEK. Two lines, twenty apart: `useState("EUR")` and
`currency.trim().toUpperCase() || "EUR"`. It survived a hard reload, because the wrong
currency was never session state — it was the default.

**What makes it a major rather than a default nobody minds.** 190 lines above, the KPI strip
carries the fix for exactly this, made on 2026-09-26:

> **NO INVOICES MEANS NO CURRENCY TO NAME — not EUR.** … *Zero in the wrong currency is a
> statement about their money that happens to be false.*

The tiles were fixed and the create form was not — and unlike the tiles, the form does not
merely show the wrong symbol, it **stores** it.

### Scope, and a second fault found on the way

`invoiceAmountDraft` (pure, in `components/invoiceDocument.ts`, seven tests) owns both rules,
and both **refuse** rather than guess:

- **No currency is not EUR.** `GET /me` carries the account's chosen currency; the field seeds
  from it, and an account that has never chosen one cannot submit — the field says why.
- **An unknown code is not a currency.** `majorToMinor` asks `currencyExponent`, which throws.

The second fault, in the same three lines: `Math.round(Number(amount) * 100)` is a **float
multiplication on money**, which `docs/money.md` forbids, over a **hard-coded exponent of 2** —
so ¥2,500 would have been stored as ¥250,000. `majorToMinor` parses the decimal string and asks
the currency. `isCurrencyCode` is new in `@showme/shared`, beside `currencyExponent` as the
guard that makes it safe to call, mirroring `isCountryCode`.

*The decision it hides:* none — the KPI comment above already settled what to do about an
account with no currency. This is the form catching up with it.

`TextField` gained a `hint` prop for the refusal, copied prop-for-prop from `TagInput`, which
already has one. One caller today, which normally argues against a shared prop — but the
alternative is a hand-rolled 12px muted span in one screen, and the two sibling text atoms
disagreeing is the divergence the review gate names. It is also wired through
`aria-describedby`, so the reason reaches a screen reader rather than only a disabled button.

### Proven on the running stack

Five mutations of `invoiceAmountDraft`, **all red on the first pass** (drop the no-currency
rule, drop the unknown-currency rule, go back to `× 100`, accept any amount, stop normalising
the code). Then in the browser as `operator@`: the CURRENCY field pre-fills **SEK**, typing
`XYZ` disables **Create invoice** and shows *"XYZ isn't a currency we know."*, and the two bills
sit side by side in Postgres:

```
QA6 Sound Rentals AB     | 250000 | EUR    ← the sweep's, before
QA6-17 Sound Rentals AB  | 250000 | SEK    ← mine, after
```

---

## `QA6-2` — moving the night rang one bell, and it belonged to the person who asked

**Verdict: real, and structural rather than an oversight.** The file that settles it:
`apps/api/src/lib/event-change-requests.ts`.

Changing a show's capacity wrote **five** `event.updated` notifications. Moving its date wrote
**one**, to the proposer. The negotiated fields (`eventDate`, `venueProfileId`, `stageId`) are
stripped out of the ordinary PATCH and applied by `answerChangeRequest` instead, so they never
reach the `eventChangeNotice` call in `routes/events.ts` that tells the bill about an edit —
and the only notifier on that path was a function called `notifyProposer`.

**The sweep's own correction is worth keeping:** the bill *is* told, in the Everyone thread, and
the crew member does see both messages. What was missing is the **bell**, and the finding
survives as the asymmetry — five bells for a capacity, one for the night itself.

### Scope, and who is deliberately left out

`notifyBillChangeApplied` sends the same `eventChangeNotice` the ordinary edit sends, on the
path that applies a negotiated change. Two people do not get it, both because they already hold
a better message:

| | Why |
|---|---|
| the **actor** who confirmed last | `eventParticipantRecipients` drops them, exactly as the ordinary edit drops whoever saved |
| the **proposer** | `notifyProposer` already tells them *"the date moved — everyone agreed"*; a second bell reading *"the date changed"* underneath it is noise on top of the message that mattered, which is the rule `event-change-notice.ts` already applies to a cancellation |

Only on `confirmed`. A declined proposal changed nothing, so there is nothing to announce to a
bill that never saw it — the proposer's own notice carries the no.

*The decision it hides:* whether a crew member hears about a date move at all. They do:
`event-change-requests.ts` already says they *"are still TOLD … their call time depends on the
night"* while having no vote on it, and this is the surface where that was false.

### Proven on the running stack

Three mutations, each red (drop the call site, stop excluding the proposer, announce a declined
change too). Then the real scenario — the operator proposes 29 Oct on the Album Release, and the
co-host, performer B and the agent each confirm:

```
performer.b@   event.change_requested   A change to Marlo Vance — Album Release
co.host@       event.change_requested   …
agent@         event.change_requested   …
operator@      event.change_confirmed   The date moved — Marlo Vance — Album Release
co.host@       event.updated            "…" was updated · The date changed. · by Astra Booking
performer.a@   event.updated            …
performer.b@   event.updated            …
professional@  event.updated            ←  the crew member, whose call time just moved
```

**Five people now know, each with the right message.** Before: one, the operator's own.

---

## Found on the way — a test that went red at midnight with no code change

`integrations.test.ts` → *"falls back to a full re-listing when the cursor has aged out"* was
green all evening and red this morning. Nothing in the tree moved.

The sync window is `now − 30 days … now + 400 days` (`SYNC_WINDOW_PAST_DAYS`,
`lib/calendar-sync.ts`), and the fixture's third event is dated **2026-08-28** — exactly 30 days
behind 2026-09-27 and 31 behind 2026-09-28. It fell out of the window at midnight, so the full
re-listing had two items to reconcile instead of three and `deleted` came back `1`.

`realWorldEvents()` stays absolute, because it carries the DST assertion that only means
anything on fixed dates (August at `+02:00`, November at `+01:00`, same wall clock). The window
test gets its own relative fixture and now asserts all three landed before reconciling — so it
tests the window rather than the calendar.

Worth noting for the same reason the mutation lessons are: **this test had been one day from
failing for weeks, and nothing could have told us.** A fixture pinned to an absolute date
inside a window measured from `now` is a scheduled failure.

---

## Suites

biome **730** clean · api **1368** (no flake this run) · shared **293** · web **383** ·
e2e **112** · `tsc --noEmit` clean in api, web, shared and design-system.

---

## `QA6-1` — a co-promoter invited the default way could not sign, and it froze the night's money

**Verdict: real, and the same dead end a preset comment already names — at a worse surface.**
The file that settles it: `packages/auth/src/presets.ts`.

The Collaborators modal's own default is **co-host, Standard for the role** — which means no
permission set, which means `OPERATOR_FLOOR`, which carries **no `agreement.confirm`**. So the
textbook co-promotion, a room rental written between the two operators, ran like this:

```
POST /deals              201
POST /deals/:id/send     200
POST /deals/:id/confirm   as operator → 200   agreementStatus "sent"
POST /deals/:id/confirm   as coHost   → 403   Missing capability: agreement.confirm
POST /events/:id/settlement/compute   → 409   "cannot open until every agreement … is signed"
PATCH …/participants/:pid {permissionSetId}  → 403 entitlement_required: paid plan
```

One unsignable line freezes the **whole event's settlement**, and the only in-product remedy is
a plan the seeded operator has not bought. The way out this run took was deleting the agreement.

`DEAL_SCOPED_CONFIRM_EVENT_ROLES` was widened for exactly this shape in August, for crew, and
its comment states the rule: *"an agreement only freezes once EVERY non-observer party has
signed … Without a way for the crew side to sign, such a deal could be sent and could never
reach `confirmed`: **a dead end**."* The owner's rule reads across word for word — *"they can
confirm an agreement if it is with them"*.

### Scope, and a test that pinned a false belief

`co_host` joins the set. It stays **deal-scoped**, for the same reason crew's is: a co-host on
Standard access still holds no event-scoped `agreement.confirm`, so they still do not decide
whether the show happens (`POST /events/:id/hold/confirm` gates on that), and signing one rental
still does not open the night's book.

**`host` is deliberately not added, and that is measured rather than assumed:** `POST /events`
writes the host's own participant row with `operator_full`, which carries `agreement.confirm`
outright, so no host reaches this dead end by any path the app has.

`authorize.test.ts` had asserted the opposite — `co_host` gets nothing — *"because operators
already carry `agreement.confirm` from floor/preset"*. **They do not**, and the assertion was
pinning the belief that made the defect invisible. The replacement asserts the fact the old
comment got wrong: `operator_full` carries it, `baselineCapabilities("co_host")` does not.

*The decision it hides:* whether standing behind a party line is enough to sign, for an
operator as it is for crew. It is the same rule, and the alternative — "buy a plan or delete the
agreement" — is not a rule anybody chose.

### Proven on the running stack

Two mutations red (`co_host` out of the set; every role granted). Then the sweep's own scenario
rebuilt after a restart:

```
POST /deals/…/confirm  as coHost  → 200   agreementStatus "confirmed"
POST /events/…/settlement/compute → 200   offTheTop 500000, adjustedNet −500000
```

The rental signs, the agreement freezes, and the settlement opens with the room charged off the
top exactly as the waterfall says (#24.1).

---

## `QA6-7` — a co-promoter added straight through the API was stranded, and it blocked the probe above

Found while proving QA6-1: `POST /events/:id/participants {role:"co_host"}` answered 201 with
`status: "invited"`, and then

```
POST /events/:id/participation/accept  as coHost → 404 "Event not found"
GET  /events/:id                       as coHost → 404 "Event not found"
GET  /me/event-invitations             as coHost → []
```

`invited` grants no capabilities, and the inbox **deliberately** excludes `co_host` — this very
file says why: *"The host and a co-host are running it — nobody invited them to it"*. So
`resolvePendingParticipation` filters to `INVITABLE_ROLES`, cannot find the row, and 404s. The
co-promoter could neither see the night nor answer for it.

**The status now follows the rule the inbox already states.** A `host` or `co_host` added through
this route is created `accepted`: this route RECORDS an arrangement, and being *asked* is the
token-invitation path (`POST /invitations`), which has its own accept. `accepted` rather than
`confirmed`, because `confirmed` is what the booking ladder writes about the night, not about
who is on the bill. A performer and a crew member still land `invited` — they have an inbox, an
accept and a decline, and the whole ladder is their answer.

Two mutations red, including "accept every role on add", which turns 28 tests red — the
distinction is load-bearing.

`seedEvent` in `deals.test.ts` also gained a nullable `permissionSetId`: "no permission set" is
the modal's default and the helper could not express it, so **no test could seed the shape
QA6-1 found**.

## Suites, after the two

biome **730** clean · api **1374** (2 files to the Testcontainers flake, both green alone) ·
auth **31** · shared **293** · web **383** · db **25** · e2e **112** · `tsc --noEmit` clean.

---

## `QA6-3` — a frame arrives and changes nothing

**Verdict: real, and it had TWO causes — one of which QA6-2's fix already closed.** The file
that settles the other: `apps/web/src/hooks/useRealtimeStream.ts`.

The sweep watched a crew seat sit on *"Waiting on 2 people to answer. Nothing moves until
everyone agrees."* and `Date 15 Oct 2026` **minutes after** the night had moved to 22 October.

1. **No frame reached that seat.** The stream publishes per user off their notifications, and
   per QA6-2 a date move notified only the proposer — so the crew member's page was never told
   anything was stale. Fixed above.
2. **Even with a frame, the banner's query was not invalidated.** The hook lists **seven** query
   keys by hand; the generated client exposes **twenty-four** for an event, and the missing one
   that mattered is `/events/:id/change-request`.

### The list was itself the forgotten line

The hook's own comment argues the principle and then breaks it:

> **INVALIDATED BY THE EVENT, NOT BY THE TYPE.** … Keying on the type would need a new line here
> for every new notification, and **the line that is forgotten is exactly the stale screen this
> exists to prevent.**

A hand-maintained list of a growing set is the same failure one level up. So the list is gone:
`isEventQueryKey` (pure, `hooks/realtimeInvalidation.ts`, eight tests) tests whether a cached key
lies under `/api/v1/events/<id>`, and the hook invalidates by predicate. That covers all
twenty-four, every nested read (`/budgets/:bid/lines` — which no single hand-written line could
express), and every route added later with no line anywhere. TanStack still only refetches
*mounted* queries, so the cost argument the comment makes is unchanged.

*The decision it hides:* none. It is the comment's own rule, applied.

Four mutations, three red (match a mere prefix; drop the id from the needle; stop matching the
event's own read). The fourth — the `typeof part === "string"` guard — is a type necessity with
no observable behaviour, and says so in a comment rather than getting an invented test.

### Proven on the running stack, without a reload

Crew seat (`professional@`) open on the Album Release and never reloaded, while the three
counterparties confirm through the API:

```
after the proposal was raised   "Waiting on 3 people to answer…"   Date 15 Oct 2026 → 14 Nov 2026
co-host, performer B, agent confirm  (status: confirmed)
5 seconds later, no reload      (no banner — cleared)               Date 14 Nov 2026
```

Screenshot: `docs/screenshots/qa-2026-09-27-run6/qa6-3-crew-seat-live-update.png`.

### What is deliberately still not sent, and why

The sweep also noted the **proposal** notice reaches the agent, the co-host and performer B but
not the crew member or the delegated performer. Both are boundaries rather than gaps:

- A pending proposal is a **question for the counterparties**. The crew have no vote on the date
  (`event-change-requests.ts` is explicit), and telling them a question is open invites them to
  act on something that may not happen. What they need is the **answer**, which now reaches them.
- The delegated performer's notice went to their **agent**, which is the delegation working
  (decisions #14) — and the applied change now reaches both.

---

## Three of run 6's minors are defects in THIS loop's own work

Fixed rather than filed, because they are mine.

### `QA6-4` — the entitlement-gap sentence, wrong again in the other branch

QA5-1 fixed the **withheld-party** branch of `entitlementReconciliation` and left the fallback
asserting a cause unconditionally. Run 6 caught it on an off-the-top rental: gross 100,000 −
15,000 deductions − **5,000 venue rental off the top** = 80,000 adjusted net against entitlements
of 85,000 — and with full access granted there was nothing withheld to name, so the screen said
*"each line also carries the cash that party collected and the deductions taken off them"* over
`deductibles: 0, 0, 0` and no collections.

**The sentence has now been wrong twice, both times the same way**, so it left the hook:
`entitlementGapSentence` is pure, in `settlementDocument.ts`, with eight tests, and asks the causes
**in the order they explain the gap**:

| | |
|---|---|
| a **withheld** party | the most specific, and the one figure this reader cannot see |
| money **off the top**, when the entitlements EXCEED the net | the only thing that can push them above the pool they divide — and deliberately not named when they fall short, which would be the same error again |
| collections or deductions | only when the rows actually carry them |
| none of the above | **state the difference and stop.** A reader sent looking for cash nobody took is worse off than one told only that two numbers differ. |

### `QA6-5` — the PATCH answered with the rank it had a moment ago

`placeHoldInQueue` writes with its own `UPDATE`, so the `after` object the route serializes still
held the old value: the response said `"holdRank": null` on a hold Postgres had just made 2nd, and
a client rendering the mutation response drew *"1st hold"* on a second hold. It now echoes the rank
it wrote — and the cleared one, which took a second fix: `reread?.holdRank ?? after.holdRank` reads
the NULL it is meant to report as "nothing came back" and keeps the stale number. **The same bug,
one line further on.**

### `QA6-6` — a rank is a position in ONE queue

`placeHoldInQueue` short-circuited on "already has a rank", so a hold sitting 2nd on 4 December,
moved to 11 December, carried its 2 into a queue that already had one — two holds reading 2nd.

A hold that changes **date, venue or room** has left its queue, so it re-joins the new one at the
back; a hold that stays put keeps the number somebody gave it. `status` is deliberately not one of
those fields: coming *into* `on_hold` is arriving in a queue, not moving between them, and a rank
that exists at that moment was set for this same night. And a hold that lands in an **empty** queue
gets its `NULL` back — the lone hold's own state — rather than keeping a number describing a night
it has left.

Six mutations, five red. The sixth is a no-op-write guard (`rank === event.holdRank`) that changes
no answer, and says so.

## Suites, after all seven of run 6's items

biome **732** clean · api **1377** (3 files to the Testcontainers flake, each green alone) ·
web **398** · auth **31** · shared **293** · db **25** · e2e **112** · `tsc --noEmit` clean.
