# The overnight small-tasks run — 2026-09-15

**What this is:** one unattended session working ClickUp tickets end to end, with the brief
*"find all the small tasks you can finish… always connect a change with a task in ClickUp, always test
and verify visually."* Thirteen commits, eleven tickets, `8a50185..9f2465a`.

**No ClickUp statuses were changed.** That was the instruction, so every ticket below is still sitting
in whatever state it was in. This file is the record of what actually moved, so somebody can flip the
statuses in one pass — and so the findings do not evaporate.

**State at the end:** `biome check .` clean over 679 files; all fourteen packages typecheck; API 1155,
web 210, shared 264, jobs 36 unit tests green; **Playwright 112/112 on a freshly seeded database**,
which per CLAUDE.md had not been true since 2026-09-05.

---

## The ledger — every change, and the ticket it belongs to

| Commit | Ticket | What moved |
|---|---|---|
| `8a50185` | `123qy9rngbp` | A search box on Events and Settlements, answered by the server so it searches the whole list rather than the page on screen |
| `e8697b2` | `123qy9rnk29` | `tasks.priority` — urgent / high / normal / low, migration 0041 |
| `14e113b` | `123qy9rnk27` | The Dashboard's tasks section, ranked by that priority |
| `6caf060` | `123qy9rnfa4` | A performer's calendar shows the room, not their own name |
| `d07f2c1` | `123qy9rng4z` | Show day: the status, the glow, the bell and the auto-conclude |
| `348823c` | `86cbcgq5f` | A notification opens the tab it is about, and scrolls to it |
| `14d9582` | `123qy9rnfz3` | The sidebar in the order Ran gave |
| `5686bcc` | `123qy9rnk3k` | Being handed a task reaches you — bell and email — and notifications make a noise |
| `d9eb255` | `86cbcbh28` | A Pro performer's offer ceiling is 300, not unlimited |
| `71bf5db` | `123qy9rnjap` | The availability share link finally has a test |
| `bca4535` | *(needed for the above)* | The whole browser suite green, and the e2e fixture re-seeds again |
| `37f26b2` | `123qy9rnfab` | Which country a show is in, on the list, the calendar and the workspace |
| `9f2465a` | `123qy9rnfab` | A venue or performer name you can act on |

---

## What each ticket got, and what it did not

### `123qy9rng4z` — show-day status · **urgent, mostly done**

Ran: *"show-day status missing — with its glowing animation and show-day notification. Show day is not
just a status but also marks the 24h of the event date and after it the event moves to concluded."*

Nothing existed: zero references to show day anywhere in the tree.

**The decision worth knowing:** show day is **not stored**. Ran's own sentence gives it away — it marks
the 24h of a date, so it is true at local midnight and false at the next one with nobody pressing
anything. A seventh `event_status` member would need a job to keep it honest and would be wrong in
between. It is derived where it is drawn (`apps/web/src/lib/status.ts`) and promotes `confirmed` and
nothing else: a cancelled show does not become a show day because its date arrived.

What a job **is** needed for is the two edges, and those are in `apps/jobs/src/show-days.ts`:
`ringStartedShowDays` announces the day to everyone on the bill (the performer included — it is their
night), `concludeFinishedShowDays` moves the show to `concluded` once its local day is over. Both
measure the day in the **event's** zone via `AT TIME ZONE`, so a Sydney date starts when Sydney gets
there. The bell runs before the conclusion: both read `status = 'confirmed'`, and concluding first
would eat the announcement of any show whose whole day passed between two sweeps.

Migration **0042** adds only `events.show_day_notified_at` — the twin of `tasks.reminded_at`, stamped
inside the same UPDATE whose WHERE requires it null, which is what makes the bell at-most-once.

**The colour was measured, not chosen.** The first pick was the brand's own glow hue (`#FF7A68`);
rendered into the real calendar legend beside `cancelled` (`#EE5746`) the two dots were
indistinguishable — the one confusion this status cannot afford, a show that is ON reading as a show
that is OFF. Five candidates went into that legend; gold collided with `hold` and `note`, teal with the
calendar's task cyan, violet with `suggested`. Neon marquee pink (`#FF4FA3`) is unambiguous against
every existing dot.

**Still open:** the concluded sub-states he describes — *concluded + not settled \ concluded + settled \
concluded + finalized (payment made and reports sent)*. Not built. They are derivable from the
settlement's own state rather than new columns, but which of them is a status and which is a badge is a
product call, not a code one.

### `123qy9rnfab` — address and country missing · **done, all four boxes**

`venueLocation` is read through `venue_profile_id` from the venue profile's **primary** location rather
than stored on the event: a room's address is a permanent fact about the room, and copying it onto every
show there is the denormalization this rebuild exists to delete. Null for a free-text venue — showing
the *host's* country instead would be worse than showing none, since operators book abroad.

`countryFlag` sits beside the ISO register in `@showme/shared` and is **computed**: a flag emoji IS its
country code, two regional indicators at `U+1F1E6` plus the letter offset. It validates against the
register rather than by shape, because two letters that are not a country still form a well-shaped pair
that renders as two blank boxes — a plausible flag for a place that does not exist. The **code is shown
as well as the flag** everywhere: Windows draws no flag emoji at all.

The name menus open on **click, not hover**, which is a reading of the ticket rather than half of it. A
hover menu does not exist on a touch screen, and on a desktop it fires while the reader is on their way
somewhere else. They are built on the existing `usePickerPopover`, so Escape, outside-click, viewport
clamping and Tab containment are the ones already in use. The map is a **search query** leading with the
venue's name, not the stored lat/lng: a pin is only as good as whatever geocoded it, and a wrong pin
sends somebody to the wrong building with no way to tell.

The menus are deliberately **not** on the Events list rows — each row there is one stretched click
target whose whole job is to open the event, and a link inside a link is not a thing.

### `123qy9rnk3k` — task notifications and sound · **done, with a finding**

**The finding:** Ran asked for task notifications to *"also"* be an email, and there was no task
notification of any kind to add an email to. `POST /tasks` and `PATCH /tasks/:id` wrote an audit row and
an event-history line and told the assignee nothing — a crew member learned they owed work by opening
the app and looking. `task.assigned` is now both halves at once.

Only a **new** assignee rings; re-saving a task that was already theirs does not, and an unassign tells
nobody. It reaches the assignee's profile and nobody else — a to-do is one party's slice of the show,
and broadcasting "chase the rider" to the bill would tell a performer what the promoter is behind on.

The `tasks` category's `emailDefault` flips to **true**, replacing a paragraph arguing for false. That
argument was about *reminders* — a nudge you set for yourself — and the category stopped being only
reminders. The reminder half rides along, which is the honest trade: one switch per category is the
design, and Ran has named which of the two possible errors matters.

The sound is two synthesised sine tones (no audio asset to license, host or cache-bust) and the mute
lives in `localStorage`, **per device** — every other notification preference is a server row because
"tell me about deals" is a fact about the person; this one is about the room you are sitting in.

### `86cbcgq5f` — notifications navigation · **done**

Almost every event notification stored the same link, a bare `/events/<uuid>`, whatever it was about.
The tab is now derived from the notification `type` at **read** time rather than written by the emitter:
a link written at the emitter is something twenty-odd call sites can each forget, and a stored link is
already written — rows sitting in people's bells right now would keep their bare path forever, where a
read-time rule fixes the whole backlog on deploy.

`settlement.finalized` is the notable entry: its three siblings already pointed at the settlement
workspace and it alone stored a bare event path, so the message that the money is final was landing on
the event's description.

### `123qy9rnfz3` — rearrange nav bar · **done**

Ran named twelve; the sidebar holds fifteen. `Setlists` sits immediately after `Performance Reports`
because their `kinds` sets are **disjoint** — no account is offered both — so sharing one slot means
every kind's sidebar reads as exactly his list. `My Profiles` and `Settings` stay last: account
furniture, and he was listing the work. Verified for all six e2e accounts.

### `86cbcbh28` — offer quota · **done, question still open**

Both ceilings now sit in one table keyed by tier and share the same rolling-month count, so they cannot
drift into being measured differently. A tier **absent** from the table is genuinely unmetered, which is
the two operator tiers — an operator sends no offers, and a zero would read as a cap of zero.

**A correction worth carrying:** the ticket says the existing UI will now report "247 of 300 this
month". It will not. `entitlementRequired` puts only `reason` on the wire; `used` and `limit` are
returned to the caller and never reach the client. The message therefore stays one true sentence for
both tiers rather than two, one of which would lie to a Pro performer. Wiring the counts through is a
separate piece of work nobody has ticketed.

**Still open, unchanged from the ticket:** the spec's PRO column says "when PRO launches" and the row
beside it says "TBD higher", so 300 may be a placeholder. It is one line in one table.

### `123qy9rnjap` — verify a shared link · **six of seven were already covered**

Checked the seven against the suite before writing anything. Six were already covered by the
**forty-eight** tests behind the off-platform settlement share: the recipient's own slice and no other
party's, expiry answered on READ rather than by the sweep, immediate revocation, the five-try OTP burn
with the three-an-hour window a fresh code cannot reset, the forwarded-email case from both sides, and
`PUBLIC_APP_BASE_URL` resolving. All 102 tests across those four files pass.

The gap was check 5 — the **availability link**, the one share surface with no test at all and the one
where a leak would be hardest to notice: it is built in the browser and handed to somebody with no
account, so nothing on the server ever sees it. The new test is a **deny-list over the whole URL**
rather than a field-by-field check of what is present (a test reading "profile, from, to, dates are
correct" stays green when a fifth parameter appears beside them), and it pins the closed parameter set
and the fragment-not-query-string rule that keeps free days out of access logs.

The ticket's "done when" asks for each check driven against the running stack with the result written
back to it. Six of seven now run on every CI run instead, which is the stronger form; the write-up is
here rather than on the ticket, per the no-ClickUp-writes instruction.

---

## Things that were broken and are not on any ticket

### I caused one of them

The **Events page scrolled sideways on a phone**, and it was my own search box from `8a50185`: a rigid
240px box in a non-wrapping flex row measured 490px against a 350px viewport. The mobile sweep caught
it; eyeballing the page at desktop width never would. Identified by removing just that box in the live
DOM and watching `scrollWidth` fall from 490 to 350 — not by reasoning about it.

Fixing it then broke the *other* direction: `flex: 1 1 240px` let the box **grow**, pushing "New event"
onto a second line at 1440px. `0 1 240px` (shrink, never grow) plus a group that claims the row's free
space. Both widths verified.

### `grid-template-columns: 1fr` has a floor

Adding the address to the venue row made the **Event workspace** overflow, and every row of the card
measured the same 365px afterwards — which makes it look like a card-wide problem rather than one cell.
A bare `1fr` is `minmax(auto, 1fr)`, whose floor is the column's min-content, so one long value sized a
272px card. `minmax(0, 1fr)`. This is exactly the rule CLAUDE.md states; it is worth knowing the repo
still had one.

### The e2e fixture could not re-seed

Two separate stops, both leaving a half-built fixture:

- **`settlement_lines` was missing from the teardown.** It cascades with its EVENT but holds NO ACTION
  references to `deals`, `budget_lines` and `event_participants`, all deleted *before* the event. So the
  fixture re-seeded perfectly right up until somebody actually computed a settlement, then died on
  `settlement_lines_deal_id_fkey` — which reads as a corrupt database rather than a stale one, and lands
  exactly when a developer has finished the walkthrough that makes them want a clean fixture back.
- **`exchange_rate_cache` was a plain insert** into the one table the teardown does not clear. Now an
  upsert, with the same conflict target the FX job uses.

### Three e2e specs are not idempotent

`budget-cost-vocabulary` (×2) and `settlement-line-comments` pass on a fresh database and fail on a
second run against the same one. They passed on my first full run and failed on my third, which looks
exactly like a flaky suite and is not. `scripts/e2e.mjs` re-seeds first, so CI never sees it — but
anybody running Playwright directly against a long-lived dev database will, and will chase the wrong
thing.

---

## How this was verified, and the traps that bit

Everything below was hit **during this session**, not read about:

- **The API has no watch.** Hit three times. A `notify.ts` edit was invisible until the process was
  restarted; the route answered with the old catalog while the source said otherwise.
- **A restart that did not restart.** `pkill -f "tsx apps/api/src/server.ts"` matches nothing — the
  process shows as a resolved node path with a tsx preflight. The old server kept answering `/health`
  and kept rejecting the new CORS origin, which is the local form of "a post-deploy check answered by
  the revision you just replaced". Kill by PID from `lsof -ti:8080`.
- **The design system is consumed as a built `dist`.** A new status is invisible to the browser until
  `pnpm --filter @showme/design-system build`.
- **React Query caches across a full page load's mount.** The notifications panel rendered the old
  category label while the raw endpoint returned the new one. The wire is the truth; the render can lag.
- **Mutation testing, every time.** Sixteen deliberate breakages across the session — wrong timezone,
  missing bound, wrong midnight, off-by-one at 300, ringing on every PATCH, broadcasting to the whole
  event, dropping a field from a response schema — each confirmed to turn the new tests red. One test
  (the show-day zone rule) **passed against a deliberately broken implementation** and had to be
  rewritten as a pair of same-instant assertions no single reader zone can satisfy.

## What I would pick up next

1. **The concluded sub-states** on `123qy9rng4z` — the only part of an urgent ticket still open.
2. **Wire `used`/`limit` through the entitlement refusal** so the upgrade prompt can say "247 of 300".
   Currently unticketed and currently impossible.
3. **Ask Ran whether 300 is real** (`86cbcbh28`) and whether the country belongs on month-view calendar
   chips, where it costs about a quarter of the chip's width and truncates the title.
4. **Flip the statuses** for the eleven tickets above.
