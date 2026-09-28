# Urgent board — sweep run 8's minors and cosmetics (2026-09-28, part 18)

Part 17 closed run 8's three number defects (QA8-3, QA8-4, QA8-5) and run 7's last cosmetics.
This part takes the rest of run 8, cheapest first, and **sizes** its two remaining majors rather
than half-building them.

---

## QA8-7 — a message in an event's conversation rings no bell

**Which files settle it:** `apps/api/src/routes/messages.ts:290` (the missing call) and
`packages/db/src/notify.ts:48` (the category it needs first).

**Verdict: real, and one missing call — but not one line.** Every other interactive event route
writes a notification; `messages.ts` publishes an SSE frame and stops. So a message reaches only
a screen already open on that tab, and `select type, count(*) from notifications` has never held
a message row. The act who is not looking never learns it was said.

**The recipient set is already exactly right and must be reused, not recomputed.**
`publishMessagePosted` resolves it through `partyThreadRecipientUserIds` / `messageRecipients`
with a docstring that is the whole privacy argument: *"the payload carries ids only (never the
body), so who receives it IS the privacy boundary — over-notifying tells someone a conversation
they cannot read is happening, which is the whole thing threads are for."* A second recipient
rule for the bell is the one mistake available here.

**Why it is not one line: a bell nobody can silence.** `categoryForNotificationType` keys off the
prefix before the dot, `message` is in no category, and an uncategorised type is **delivered** by
deliberate design (*"an uncategorised notification is noisy, an uncategorised notification that is
dropped is invisible, and only one of those can be noticed and fixed"*). Correct as a failure
direction — and shipping the app's **chattiest** event that way means a busy thread fills a bell
with no switch anywhere in Settings → Notifications. So the catalog gains a seventh category,
`messages`, and `message` maps to it.

**No migration.** `notification_preferences.category` is `text` on purpose:
*"the catalog is a product decision that moves faster than an enum migration"*
(`schema/comms.ts:84`). The settings route renders from `NOTIFICATION_CATEGORIES`, so the switch
appears on its own.

**Scope:** one `notifyUsers` beside the existing publish, sharing its recipient list; one catalog
entry; one prefix mapping. Best-effort in its own try/catch like every notification in this repo —
the post is already committed and a delivery failure must not suggest otherwise.

*The decision it hides, and it is answerable from the catalog rather than from Ran:* **whether a
message should email.** No — `emailDefault: false`, which is the `events` category's own reasoning
applied to a louder case: *"it is news you get the next time you open the app, and mailing it is
how a product teaches people to filter its mail, taking the four that matter down with it."* The
four that matter are dates and money; a chat line is neither.

*A second decision, this one about content:* **the notification carries no message text.** The SSE
frame deliberately carries ids only, and a stored notification row outlives the entitlement that
justified it — thread access is computed at post time, so a preview persisted today can be read
after access is revoked tomorrow. The title names the event, `actorDisplay` names the poster (the
bell renders it beside the line), and the link opens the thread. That is enough to act on and
nothing to leak.

### Built, and proven on the running stack

One `notifyUsers` sharing the existing recipient list, one catalog entry, one prefix mapping.
Proven after restarting the API (it does not hot-reload), posting an all-visibility message as
`operator@` on the Album Release:

| | before | after |
|---|---|---|
| `select type, count(*) from notifications` | no message row, ever | **5 `message.posted` rows** |
| who got one | — | the agent, the co-host, both performers, the crew professional |
| who did not | — | **the operator who posted** |
| the performer's bell | 4 unread before, 4 after (the finding's measurement) | **1**, and the panel reads *"New message on "Marlo Vance — Album Release" · just now · by The Lantern Hall (operator)"* |
| the row's `body` | — | **empty** — no message text, by design |
| Settings → Notifications | six categories, none of them messages | **"Messages on your events — Somebody posts in a conversation you are part of."** |

The settings row appeared with no UI change, which is the catalog being the single source it
claims to be. `actorDisplay` renders as *"by The Lantern Hall (operator)"*, so the bell says who
spoke without quoting what was said.

**Four tests, five mutations red** — the bell never rings, the link drops the thread, the message
body rides along, the category mapping is dropped, messages would email by default.

**A sixth mutation survived and should not be "fixed".** Passing `null` instead of `actorUserId`
to `notifyUsers` changed nothing, because `messageRecipients` has already excluded the sender
before the list gets here. It is an equivalent mutant — the self-exclusion is belt-and-braces
across two layers — not a gap in the tests. Said plainly, because a survivor left unexplained is
indistinguishable from one left unfixed.

And the harness earned its keep again: one run came back `ERROR — nothing ran | Tests 30 skipped`
rather than GREEN, which is this morning's hardening catching the Testcontainers flake instead of
reporting a survivor from it. The mutation was red on a re-run.

---

## QA8-6 — a crew account could offer to play, and it was filed as a performer

**Which files settle it:** `apps/api/src/routes/inbound.ts:1343` (the write) and
`apps/web/src/routes/Requests.tsx:271` (the button).

**Verdict: real, and story.md decides it without needing Ran.** `story.md:61`: a team-and-crew
member is *"**not** talent … an arm's-length service provider paid a **fixed fee**"*, and the
marketplace it describes runs the **other way** — *"operators/performers post jobs and
team-and-crew members apply"*. Nothing about the kind offers a room a show.

The mechanism is one ternary: `senderType = kind === "agent" ? "agency" : "performer"`, so
`team_and_crew` fell into `performer`. The row then said `source: performer_offer, sender_type:
performer` about a `team_and_crew` profile, and the venue's inbox announced a sound engineer as an
act under **SOURCE: Performer offer**. The row being wrong about who sent it is worse than the
button existing.

**Refused rather than re-labelled, and that is the decision.** A crew-initiated pitch is the
**marketplace**, which is unbuilt; giving it a second vocabulary here would ship a surface nobody
has designed, on a route whose whole subject is offers to play. The API answers 400 naming the
boundary, and the web stops drawing a form whose answer is already known — the same rule QA7-15
applied to the invite dialog.

*The decision it hides, recorded rather than invented:* **how a crew member should approach a
venue at all.** story.md answers it — they apply to posted jobs — and that is the team-and-crew
marketplace, still unbuilt and already on the handoff's feature list. This closes the wrong door
without pretending to open the right one.

### Proven on the running stack

| | before | after |
|---|---|---|
| `POST /offers` as `professional@` | **201**, `source: performer_offer`, `sender_type: performer` | **400** — *"A team-and-crew profile is a service rather than an act…"*, and no row written |
| `POST /offers` as `performer.a@` | 201 | **201**, `senderType: performer` — unchanged |
| the **Send an offer** button, crew | offered | **gone** |
| the **Send an offer** button, performer | offered | **still there** |

Two tests and three mutations red — the guard never fires, it refuses performers instead, it
refuses everyone but an agent. The last two fail **thirteen** tests each, which is the evidence
that the neighbouring kinds are genuinely covered rather than merely unaffected.

---

## QA8-12, QA8-13, QA8-14 — the three cosmetics

### QA8-12 — already closed, by QA8-5

**Verdict: no build.** The two glyphs were a formatted negative rendered raw (`-SEK 5,000`,
U+002D, no space — the payer's advance) beside the card's `negative` renderer (`− SEK 3,000`,
U+2212, one space). QA8-5's rewrite removed the first case entirely: `payoutAdjustments` strips
the sign off a payer's advance and marks it `reducesPayout: false`, so it renders as a plain
positive, and every reduction goes through the one renderer.

Measured rather than assumed — the codepoints, read off the same screen with the advance restored:

```
"− SEK 83,000"  [8722, 32]     the money collected
"− SEK 3,000"   [8722, 32]     Marlo's advance
"− SEK 2,000"   [8722, 32]     Neon Tide's advance
"SEK 5,000"     no sign at all the operator's advance, which INCREASES what they are owed
```

One glyph, one spacing, and the payer's row now reads like its neighbour (*"Plus the costs you
paid on the night SEK 33,000"*) because it means the same thing. The headline checks too:
`0 − 83,000 + 33,000 + 5,000 = −45,000` under **SEK 45,000 · You owe**.

### QA8-13 — "private to you and your agent", on the agent's own screen

**Which file settles it:** `apps/web/src/components/useEventSettlement.ts` (build the sentence),
`EventSettlement.tsx:852` (render it).

**Verdict: real, and the third instance of QA6-9's class.** The eyebrow was fixed text, true on
the performer's copy and nonsense on the agent's — the agent IS the agent. A commission is private
to exactly two parties (#14), so the sentence names **the other one**, and it is built in the hook
where the names already are.

| reader | before | after |
|---|---|---|
| `agent@` | AGENT COMMISSION — PRIVATE TO YOU AND YOUR AGENT | **PRIVATE TO YOU AND MARLO VANCE** |
| `performer.a@` | the same | **PRIVATE TO YOU AND YOUR AGENT** — unchanged, and right |
| `operator@` | — | no commission card at all, which is #14 holding |

### QA8-14 — "Edit them there", pointed at a tab that refuses the reader

**Which file settles it:** `useEventSettlement.ts:69` (`canEditFinancials` on the authority) and
`EventSettlement.tsx:810`.

**Verdict: real.** The revenue preview's subtitle instructed every reader to *"Edit them there"*,
and the Financials tab answers a party without `budget.view` with *"The plan is the operator's
view"*. The instruction and the refusal were one click apart. The authority gains `budget.edit`
alongside its three existing questions, and the subtitle drops the instruction for anyone it does
not apply to — the card's body already says whose figures these are.

| reader | subtitle |
|---|---|
| `operator@` | *"…entered on Financials. **Edit them there.**"* |
| `agent@`, `performer.a@` | *"Read-only preview of the figures entered on Financials."* |

*The decision each hides:* none. Both are the same rule this stretch has now applied five times —
a sentence that names a person or an action must be true of the person reading it.

---

## QA8-9, QA8-10, QA8-11 — three promises the product does not keep, and one write that lost money's destination

Grouped because they are one rule: **a screen may not name an action nobody can take, or an
outcome nothing produces.**

### QA8-9 — the RSVP promised an email

`apps/marketing/src/event-rsvp.ts:346` answered *"The organiser … knows to expect you. **Keep an
eye on your inbox.**"* and nothing sends anything — no send, no queue, no template, not a stub.
The sharper half of the finding, as the sweep says, because a member of the public has no way to
discover it is false; they simply wait.

**The first sentence stays and the second goes.** The row IS written — verified after the probe,
`audience_rsvps` holds `QA8-9 Fan / qa89fan@e2e.showme.test / Stockholm` — so the organiser knowing
is true today, and the Audience screen catching up to it is the audience read endpoint already on
the handoff's ticket list. Promise the email back when something sends one.

The form's own data notice (*"…so they can count on you and tell you about it"*) is left alone
deliberately: it describes what the ORGANISER may do with the data, and the sweep already carries it
as that ticket's acceptance text.

### QA8-10 — Billing told the reader to add a bank account, with no Add

Two halves, and only one is copy.

**The copy:** the panel now says what the Payout tab already says — *"Paying out through shoWMe is
not connected yet, so there is nothing to add here. Mark each transfer on a settlement as you pay
it."* One unbuilt thing, one sentence about it.

**The write, which is the real one.** `identifier` was `z.string().optional()`, so the sweep's
`{"type":"iban","label":"QA8 bank","iban":"SE45…"}` was **201** with `identifier: null` — an IBAN
payout account with no IBAN, stored and returned as created. Look at what the caller had actually
sent: the number, under the key `iban`, which Zod stripped. Every ingredient of a silent data loss
— an optional field, a plausible wrong key, and a success response — on the one table whose entire
purpose is to say where money goes.

It is `z.string().trim().min(1)` now. **Closing it while the route has no caller is the point:**
the first caller will be written against whatever this accepts. Proven after an API restart — the
sweep's exact payload answers **400** where it answered 201. Three tests, two mutations red
(optional again, whitespace counts).

*A test-only finding on the way:* `inbound.test.ts` declared its own
`type AccountKind = "operator" | "performer" | "agent"` — omitting `team_and_crew`, the one kind
QA8-6's test is about. Vitest runs through esbuild and does not typecheck, so the test passed and
only `tsc` objected. It reads `schema.accountKind.enumValues` now, so a fifth kind cannot go
missing here again.

### QA8-11 — "Ask the host to add you to it", an errand that dead-ends

There is no control for adding a party to an existing deal. `decisions.md` resolved co-operator
transparency as **BOTH** an `observer` party for targeted sharing **and** a blanket shared-budget
rule; the observer role exists in the **new** deal composer, the blanket rule is unbuilt, and
neither reaches a deal that already exists.

So the sentence states the fact and stops giving instructions: *"This event has a deal, and its
terms are not yours to read. A deal is only visible to the parties named on it."* Proven as
`co.host@`. The missing half — sharing an existing deal with a co-operator — is QA8-1's family and
is sized below.

*The decision each hides:* none of the three. Each is a sentence outrunning the build, and the build
is what the handoff's feature list is for.

---

## QA8-8 — a book with no door printed a division of one

**Which file settles it:** `apps/web/src/components/useBudgetEditor.ts:2460` — one seed, gated on
the `isPrivateBook` flag QA7-3 already introduced.

**Verdict: real, and QA7-3's own docstring is what licensed it.** The private ledger's KPIs read
`TOTAL REVENUE SEK 0` and its ticket table *"0 tickets planned"*, and two cards below it drew
`Marlo Vance 60% SEK 55,800 / Neon Tide 40% SEK 37,200` — the **shared** book's door — with the
sentence that says which door that is absent here, so the card offered no clue.

QA7-3 removed the event's ticket tiers from a private book because *"both are facts about the
NIGHT, and the night's book is the shared one"*, and then **exempted this card in the same
paragraph**, arguing from #23.2. That argument is about the **fee** — a fee must not be re-derived
from whichever slice of revenue a reader is looking at — and it does not reach a card about the
**door**. `PLAN.md:215` settles it: a private book is *"the extra an operator MAY ALSO keep"*, and
an extra has no door to divide. The exemption is now corrected in place, next to the fix, because
the exemption is what would restore the defect.

*Scope:* the seed only. `ticketSplitOf` is unchanged and still returns an empty split for a zero
door, which is why passing the empty seed is all this takes — no new branch in the pure rule.

### Proven on the running stack, from the right seat

The first reading of this was taken as **`co.host@`** by accident — a session left over from
QA8-11 — and showed no split card on either book, which looks like the fix working and is
actually the co-host legitimately not being a party to the deal (their costs read `TOTAL COSTS
(PARTIAL)`, which is the tell). Re-driven as `operator@`:

| book, as `operator@` | TOTAL REVENUE | split card |
|---|---|---|
| Shared ledger | SEK 83,000 | **intact** — *60% Marlo Vance / 40% Neon Tide · DOOR SPLIT · SEK 49,800 / SEK 33,200 · "100% of the door." · "Box office only, before costs and rental — after them the deal pays SEK 50,000."* |
| My budget | SEK 0 | **gone**, and none of 49,800 / 33,200 / 83,000 appears anywhere on the page |

Worth keeping as a method note: *an absent element is the weakest possible evidence*, because
everything from a wrong account to a failed render produces it. It only counts beside the positive
case on the same screen, which is what the two rows above are.

---

## QA7-24 — one sentence comparing two currencies

**Which file settles it:** `apps/web/src/components/settlementDocument.ts` — `describeBasis`, plus
the deal total that shares its sentence.

**Verdict: real, and the cause is which formatter the sentence used.** Every amount on a card
previewed in another currency goes through the CONVERTING formatter and carries `≈`;
`describeBasis` called `formatMoney(x, currency)` directly, the deal's payout currency. So a card
in EUR read *"The 70% door share beats the **SEK 18,000** guarantee"* beside `≈ €6,731` and
`≈ €4,013` — inviting a comparison across two currencies, in one breath.

**Both figures, payout currency first.** Keeping the contract's own number is right — it is the
number in the agreement, and `docs/money.md` makes a live rate cosmetic, never settling anything.
Dropping it for the conversion would be worse than the bug. So the sentence carries
`SEK 18,000 (≈ €1,553)`, and the deal total in the same sentence gets the same treatment, because
treating one and not the other only moves the mismatch.

Nothing changes on a card in its own currency: `contract()` compares the two renderings and returns
the bare one when they match, which is every caller that passes `formatAmount`'s default. A
**redacted** base (story.md:44 — a party who may not read the takings) has no figure, and gains no
parenthetical.

### Proven on the running stack

Spring Warmup as `operator@`, the same card in both currencies:

| preview | the sentence |
|---|---|
| SEK | *"The 70% door share beats the SEK 18,000 guarantee"* — unchanged, no parenthetical |
| EUR | *"The 70% door share beats the **SEK 18,000 (≈ €1,553)** guarantee"*, beside `≈ €4,013` |

Five tests, four mutations red (never converted · only the converted figure · a parenthetical
repeating an identical rendering · a redacted base gaining one).

**Two test-writing notes from this, both worth more than the fix.** `Intl.NumberFormat` puts a
**non-breaking space** (U+00A0) between a currency code and its number, so `formatMoney` returns
`"SEK 18,000"` and a comparison against a typed `"SEK 18,000"` fails while printing two
identical-looking values. And the assertion for *"no parenthetical when nothing is converted"*
first used a hand-rolled lookalike formatter with a plain space — which differed from the real one
by that invisible character, so the parenthetical appeared and the test failed over the very thing
it was written to prove absent. It compares against `formatMoney` itself now. **A test that fakes
the function under comparison is testing the fake.**
