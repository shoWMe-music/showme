# The urgent board, read against the code — 2026-09-27

Every `urgent` ticket in Tech → General that is **not** `shipped`, read and checked
against the code per `ticket-to-commit`. 46 such tickets. **36 assessed, 10 not yet
read** — the ClickUp MCP hit its 100-call daily limit; the ten are named at the end.

**Nothing was written to ClickUp.** This file is the finding; the board is untouched.

> ## ⚠️ READ THIS FIRST — the audit has been worked through (added 2026-09-27, late)
>
> **This file is the assessment as it stood when it was written, and it has since been
> ACTED on.** It is kept unedited below because it is the record of what was found; it is
> no longer a statement about the present. Per this repo's own lesson — *"a handoff doc is
> a snapshot of a moment, not a statement about the present"* — check the code, or the
> loop docs, before scoping anything from the tables below.
>
> What has happened since:
>
> - **§2 and §5 are closed.** Every unblocked small fix in them is built, proven on the
>   running stack and committed naming its ticket.
> - **§7's "not yet read" list is read.** The ClickUp daily cap reset; all eight remaining
>   tickets have verdicts, in `docs/urgent-board-loop-2026-09-27-part4.md`.
> - **Items 1, 2 and 3 of the day's plan are built** (the venue+room request chain and the
>   token share link; the outbound invite chain's missing rungs; the bonus ladder and its
>   entry UI).
> - **Two full QA sweeps ran against the app**, and every actionable major from the first
>   is fixed. Reports: `docs/qa-sweep-2026-09-27-run4.md` (and run 5).
>
> **The day's record, in order:** `docs/urgent-board-loop-2026-09-27.md` and its
> `-part2` … `-part7` continuations. Each entry carries the verdict, the file that settled
> the ticket, the decision it hid, and how it was proven. **The summary of where things
> now stand is `docs/handoff-2026-09-27-urgent-board.md`.**

The headline, which is the same finding as 2026-09-04: **the board's count is not the
work's size.** Of 36 urgent tickets assessed, **13 are already done or nearly**, four
more are a mechanism that exists with one caller, and the biggest single item is **one
flow described five times**.

---

## 1. Already done — verify and close (13)

| Ticket | Why it is done | Where |
|---|---|---|
| `123qy9rng4z` show-day status | Derived status, glowing chip, show-day notification, and the automatic move to `concluded` when the local day ends — with tests | `apps/jobs/src/show-days.ts`, `apps/web/src/lib/status.ts`, `Calendar.tsx:111` |
| `123qy9rnk27` Dashboard tasks section | Exactly the spec: top 5 by priority, "Show all" → /tasks | `Dashboard.tsx:163` + `:388` |
| `123qy9rpe3x` Notification real time | SSE delivery + a synthesised soft two-tone bell + an on/off switch in Settings, with tests | `useRealtimeStream.ts`, `lib/notificationSound.ts`, `Settings.tsx:404` |
| `123qy9rnk3k` Task notifications and sound | The same mechanism — `notificationSound.ts`'s own header cites this ticket id | as above |
| `86cbcn1d2` Event creation flow | Item 1 ticked by Ran; item 2 (wizard's deal reaching the event manager) is shipped ticket `86cbaxu52` | — |
| `123qy9rpchw` Single → multi performer | There is no single-performer event to convert: `PLAN.md` has no parent/child, and Collaborators → Invite already offers **Performer** and **Support act** | `useEventCollaboratorInvite.ts:42-53` |
| `123qy9rnfz1` (bullet 1) Edit shows existing images | Both fields seed from the stored URLs | `Profiles.tsx:508-509` |
| `123qy9rpe3q` (bullet 1) Performer public page | `loadPublicShows` lists events where the profile is a confirmed billed participant, not only the venue's | `routes/public.ts:254-290` |
| `123qy9rpdup` (the big bullet) "Deleting events is missing from the platform" | `DELETE /events/:id` exists, with a capability, an optimistic lock, an ordered tree teardown and an audit trail | `events-list.ts:564`, `lib/event-delete.ts` |
| `86cbcn1ue` (3 of its 7 open items) Collaborators / ticketing / deal type + fee in the Overview | Built and commented against this ticket; shipped as `123qy9rng5y` | `EventSettlement.tsx:348`, `:507`, `:1003` |
| `86cbcn189` (item 4) Venue filter then room sub-filter | Two selects, venue then room | `Calendar.tsx:1052-1058` |
| `123qy9rnfyx` In-house management | Call times, private notes and assigned tasks are all there — it *was* the empty placeholder of shipped `86cbaxxj9` | `EventCrewPanel.tsx:249-290` |
| `123qy9rnfa4` Event names follow the venue | **Corrected mid-audit — I first called this open.** `calendarEventLabel` labels an event by its venue name unless the reader hosts it, which is exactly the ask. I had only checked the performer/eventName/both switch and missed the helper | `apps/web/src/lib/calendarEventLabel.ts:23-30`, cited at `Calendar.tsx:545` |

`86cbcn189` item 8 ("clicking a date in a settlement jumps to the event manager") is
also already ticked as done inside `86cbcn1ue` — the same item in two urgent tickets.

---

## 2. The mechanism is built and has one caller (4)

The 2026-09-04 pattern, four more times. Each is a small job that looks like a big one.

- **`86cbcgq5f` Notifications navigation.** The receiving half is complete and
  commented *for this ticket*: `?tab=` selects the panel and scrolls the tab bar into
  view (`EventDetail.tsx:114-140`). But **all 18 notification links send a bare
  `/events/<id>`** — the deep link nothing produces. ~14 lines across 6 files.
- **`123qy9rpvfq` Templates.** `template_category` already has eight values
  (`budget, deal, rider, terms, schedule, crew, settlement_overview, settlement_deal`)
  and the API stores them; **the web app only ever writes `category: "budget"`**
  (`useBudgetToolbar.ts:107` is the only caller). Ran's schedule starting-point template
  is a seeded row on top. Decided shape: decisions #16.11 modular templates.
- **`86cbcn1je` (avatars don't link).** `ProfileFace` was written to make a face a door
  and is used in exactly one file (`EventDetail.tsx`). Every other roster draws a bare
  `Avatar`. Its own comment carries the one constraint: never inside a clickable row.
- **`123qy9rnwud` bonus thresholds.** The engine already settles a threshold bonus
  (`packages/settlement/src/entitlement.ts`, decisions #23.3); nothing can enter one.
  That is exactly ticket `123qy9rp8k3` at `high` — so the `urgent` one is a duplicate.

---

## 3. One mechanism, several urgent tickets (4 clusters, 11 tickets)

**a) The booking flow — five urgent tickets, one mechanism.**
`86cbcn1je` (requests/offers/discovery) · `86cbcehmp` (invite logic + status
progression) · `123qy9rnk1y` (performer invitation → Suggested) · `123qy9rprbx` §1
(double-booking warning on an incoming request) · `123qy9rpqp0` (every request carries
date + venue + room). They describe one chain: **request → pre-filled draft event →
invite → Suggested → deal Accept/Decline/Counter → Confirmed.** Its hinge is a product
decision Ran already wrote in `86cbcn1je`: *"Perhaps the solution is that Deals tab
should be where the offer/deal is being negotiated."* Nothing downstream can be built
until that is settled. `123qy9rpqp0` is the foundation — without venue + room on a
request, the double-booking check has nothing to compare.

**b) Event quick actions — the same four actions asked for in three places.**
`123qy9rng56` (event list row menu + a workspace three-dots) and `123qy9rnk21`
(calendar day popover) both ask for Publish/Unpublish, Print details, Invite and
Settlement. Build one menu, mount it three times. The row menu today has Archive /
Unarchive / Delete permanently (`useEventArchive.tsx`); the popover has Open event.
**Split out** "Make recurring" from `123qy9rng56` — recurring events are a feature, not
a menu entry.

**c) Accommodation — two urgent tickets, one feature.**
`86ca3p88m` (with the screenshots) and `86c9mq7q9`'s Accommodation section are the same
fields. decisions **#16.7** backs both and adds what neither says: the accommodation
appears as a card on every relevant party's calendar. Today all of it is three
free-text notes (`EventHospitalityCard.tsx`) — which is already mounted on the Event
Details tab, so `86c9mq7q9`'s *"it is wrong, it's in the Deals tab"* is stale.

**d) Availability links — two urgent tickets pulling in opposite directions.**
`123qy9rpqn0` wants the link **shorter** (700 characters reads as spam);
`123qy9rpqp0` §2 wants it to carry **more** (venue + room per date). Both resolve the
same way and only that way: store the snapshot server-side in `shares.payload` under a
token. The code deliberately does not, and says why
(`lib/availabilityShareLink.ts`): there is no route that writes a profile-availability
share, and the fragment keeps the sharer's free/busy days out of server logs and
`Referer` headers. **Moving it server-side gives up that privacy property** — worth
saying out loud before doing it.

---

## 4. Decisions — ALL FIVE TAKEN 2026-09-27

**Answered the same day the audit was written. `decisions.md` #25 is the durable
record; this section is left as the question it was, with the answer against it.**

| Question | Answer |
|---|---|
| Where is a deal negotiated? | **The Deals tab.** "Accept request" → pre-filled draft event + invite; Accept / Decline / Counter on the Deals tab. Unblocks five urgent tickets; `123qy9rpqp0` becomes the first piece of work, not the last |
| Agent commission base | **Already decided — gross.** #14 says it twice and the code matches; `86cba8wtb` and W0 Q1 close with no code change. `commissionable_basis` is designed and unwired → its own ticket |
| Deleting events | **The line is money, not status.** No settlement and no invoice → Ran's cancel-then-delete ladder, with notification. A settlement or invoice → permanently archive-only |
| Availability links | **A token.** Snapshot to `shares.payload`, share `showme.music/a/<token>` — fixes both tickets, and is better on the privacy measure the old comment defended |
| Bonus thresholds | **A ladder.** N ordered bands, settled against actual attendance. Money-core change, mutation-tested per band; `123qy9rp8k3` builds against the ladder |

Also settled from the QA sweep's parked list: a co-promoter does **not** see the act's
fee automatically — the host is **prompted to share the deal** (#4's observer mechanism);
and a revenue share **does** pay a participant who has not accepted.

**Still waiting on an input rather than a decision:** V2's exact settlement labels, which
Daniel is sending. Until then no label moves — `PAYS IT` / `CARRIES IT` included.

## 4a. The original questions, as put

1. **Agent commission base** — `123qy9rng5m` W0 Q1 = `86cba8wtb` (`re-do`). Live:
   `entitlement + deductibles` (the gross). 15% of 10 000 = 1 500, where the other
   reading pays 1 350. Still unanswered; still moving real money.
2. **Currency selector: re-denominate or preview?** — `123qy9rng5m` W0 Q2. Preview by
   design (`docs/money.md` locks FX at finalize). **Partly resolved since it was
   written:** the FX-key ticket `123qy9rng47` is now shipped, so the *"No live rate for
   SEK → EUR"* message that made it look broken should be gone.
3. **Deleting events** — `123qy9rpdup` asks for cancel-then-delete at any status,
   including Confirmed. `lib/event-delete.ts` refuses deletion of anything with another
   party on it, a confirmed agreement, a settlement or an invoice, with stated
   reasoning: it would take the performer's record of a night they played and were
   paid for, with no undo and no notification. **Direct conflict — Ran's call.**
4. **Bonus: one threshold or a ladder?** — `123qy9rnwud` asks for 60/40 → 70/30 at 300
   → 80/20 at 900. The engine models **one** threshold. Extend it, or tell Ran one is
   what the model supports.
5. **"Born by" vs "Paid by", and the terminology session** — `86cbcn1ue`'s last two
   items and `123qy9rng6d` (W5). Deliberately untouched; needs the working session.

---

## 5. Real, open, and the file that settles it

| Ticket | What is actually wrong | File |
|---|---|---|
| `123qy9rpdum` | Both really are `#B8A99B` — but **deliberately**: `Calendar.tsx:76-81` says imported entries take the muted `concluded` tint because *"the palette is fixed by the design system and every hue is already spoken for, so the tint is shared and the WORD does the telling apart."* Ran's ask overrides that, which makes it a new `Status` member plus a hue picked the way `showday`'s was — rendered into the real legend and compared against all ten dots (`design-system/src/lib/status.ts:38-60`). Small, with a defined method; not the one-liner it looks like | `Calendar.tsx:113` vs `:138` |
| `123qy9rnh3f` | The reopen reason IS stored (`deals.reopen.reason`) but is in neither the deal payload nor the notification body, so the other side cannot see it | `routes/deals.ts:1036-1040` |
| `123qy9rnf9d` | Two fields, "Artist / performer" and "Performer profile" — confirmed live in the wizard | `NewEventWizard.tsx` |
| `123qy9rprbx` §2 | `useDateConflicts` is only asked **while the date field is open**, so an event at rest shows no clash | `EventInlineInformation.tsx:159-166` |
| `123qy9rpe3y` | The list orders by **created-at**, and the keyset cursor is built on it — show-date order is an API change, not a UI tweak. No per-column sort exists | `events-list.ts:335-353` |
| `123qy9rnk3m` | Auto logout: nothing exists. (Duplicated on the old board as `86c9mhqu6`) | — |
| `86cbcf6gr` | Genres exist on the profile and are not shown on the event (small). Mood/Style does not exist at all, and the coloured-pill taxonomy with de-duplication is its own feature | `Profiles.tsx:108`, event details |
| `123qy9rpdup` | The **Cancelled** and **Confirmed** filter chips are genuinely missing, and there is no cancel-with-reason | `useEventList.ts:29-37` |
| `123qy9rpe3q` | Bullets 2–3: a performer cannot publish (`event.publish` is operator-only), and publishing notifies nobody | `presets.ts:23` |
| `86c9mq7q9` | The structured logistics spec (travel party size, parking, catering chips, custom fields) against today's three free-text notes | `EventHospitalityCard.tsx` |
| `86cbcn189` | Remaining: drop the side-panel cards, calendar view-only, archive out of the day box, no modal after marking unavailable | `Calendar.tsx` |
| `123qy9rnk21` | The day popover shows 3 of the 9 things asked for | `CalendarEntryPreview.tsx:150` |
| `86cbcftg3` | Substantially built — `NEGOTIATED_FIELDS` is date/venue/room, exactly the three Ran named, with a Confirm/Decline banner. The gap is the rest of his sentence: the same UI in the messages box, and always saying where a change happened and by whom | `lib/event-change-requests.ts:37`, `EventChangeRequestBanner.tsx` |

---

## 6. An epic already decomposed — it should not count as one urgent unit

`86cbadt7d` **Performer ↔ Venue invitation & offer system** is a full spec whose parts
are separate tickets, most of them shipped: the claim flow (`86cbcbgbe`), the
claimed-by notice (`86cbcbgmu`), collaboration credits (`86cbcbgx2`), the GDPR reaper
(`86cbcbhar`), the Outgoing Requests page (`86cb6305n`). What remains of it lives at
`high`/`normal`/`low`: the profile-completeness gate, dedup by name+city, territory,
offer telemetry, the offer email template, the PRO quota. As an `urgent` line on the
board it double-counts work that is either done or deliberately deprioritised.

---

## 6a. A prior analysis of this board exists, and it covers three of the ten

`docs/bug-analysis-2026-09-04.md` — twenty tickets tagged `bug`/`needs fixing`, read
against the code three weeks ago. It is the measurement CLAUDE.md quotes. Two things
follow:

- **It covers `86cbcn1q4` (Performer profile & media) and `86cbcn1rr` (Venue profile)**
  — two of the ten I could not read today. Its verdict on both: *design work, blocked on
  rendering the prototype*, with two performer items already done (all performer types
  are offered; image preview + crop exists and is wired), one already true server-side
  (setups are not emitted publicly), and two that are decisions — the missing map (the
  public page makes zero third-party requests **by design**) and the Assets page (a new
  feature that should leave the ticket, overlapping `123qy9rnfbe`).
- **It found the same booking cluster** and named the gap more precisely than I did:
  `booking_requests` models the **inbound** direction (someone approaches an operator);
  Ran is describing the **outbound** one (an operator invites, and the performer must
  answer before anything is granted). Same shape, opposite direction.

**And it is stale in two places, both in our favour** — `123qy9rng4z` (*"no showday
anywhere… nothing ever moves a confirmed event to concluded"*) and `123qy9rnfz1`'s first
half have both been built since. Its step 6 (date-change requests) is now
`lib/event-change-requests.ts`. So of that epic's six steps, **4 and 6 are done** and the
remaining hole is precisely steps 1, 2, 3 and 5: invite moves the event to `suggested`,
it arrives as a request, accept moves it to `pending`, decline takes a note.

## 7. Not yet read — the MCP daily limit (10)

`86cbcn1f8` Deals · `86cbcn1rr` Venue profile (public + edit) · `86cbcn1q4` Performer
profile & media · `123qy9rng8p` Setlists page + event manager · `123qy9rnk3h` Team &
Crew issues · `123qy9rnge6` Team and Crew account + admin role · `123qy9rngc8` Contacts
UI/UX · `123qy9rnk1u` Uploading files — riders and documents · `123qy9rnfbe` Poster →
Promo material + Assets · `123qy9rng6d` W5 terminology session.

**Two of those ten are answered by §6a above** (`86cbcn1q4`, `86cbcn1rr`), so eight
genuinely remain unread.

Four of those (`86cbcn1f8`, `86cbcn1rr`, `86cbcn1q4`, plus the shipped `86cbcn1g5`)
belong to the same `86cbcn1*` family as the ones read here — a section-by-section
walkthrough of the app rather than units of work, each a checklist where Ran's own ticks
are behind what the code does.

## 8. The old board

**"General (old)"** holds ~25 more urgent tickets frozen at `in development`. It is the
pre-rebuild board (`CLAUDE.md`: OLD pre-new-product), and at least these are
cross-board duplicates of live tickets: `86c9mhqu6` Auto Logout, `86c9m2d8x` Templates
Save/Load, `86c9m2d5r` Save Template Budget Planner, `86c9nrhj5` Re-open agreement,
`86c9n1uwm` Shared deal split, `86ca4pww0` Budget planner and Settlement not working.
They inflate every count on the board and none of them is a unit of work.
