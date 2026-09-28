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
