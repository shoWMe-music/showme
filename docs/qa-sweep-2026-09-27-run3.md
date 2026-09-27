# QA sweep — 2026-09-27 (run 3)

**Stack under test:** `main` @ `b4ba17d` ("marketing,web: the shared page says which rooms are
free, and the ask names one"), clean tree apart from this report and its screenshots.
Local stack via `pnpm dev` (web 5180, API 8080, stream 8081, auth emulator 9099, Postgres 55432)
plus `apps/marketing` on 5173.

**Two seats, both real browsers, neither logging the other out:**

- **Seat 1 — Playwright MCP.** The signed-in app on `127.0.0.1:5180`.
- **Seat 2 — Chrome DevTools MCP.** The public marketing site on `localhost:5173`, and a second
  signed-in account when a delivery had to be watched.

Where a rule (not a delivery) was the question, `.claude/skills/verify-e2e/api-as.mjs` was used and
is named as such in the finding. Those two are not interchangeable evidence.

---

## Summary

**0 BLOCKER · 8 MAJOR · 12 MINOR · 4 NOTE.** No screen failed to render and the API answered **no
5xx** all run. Today's four changes all work; the damage is elsewhere.

**The three that matter most**

1. **A solo operator is still given a private book nothing reads.** Event creation
   (`routes/events.ts:1096`) still opens a `private` budget for the host, which is the exact shape
   `f996c14` and migration `0046` removed yesterday and which `ensureEventBudgets` is careful not to
   create. Every cost typed into "My budget" on a single-operator night is absent from the
   settlement — SEK 5,000 typed, Deductions SEK 0 settled.
2. **Financial Projections omits every deal entitlement.** The same night the Budget Planner calls a
   SEK 1,245 **loss**, Projections calls a SEK 50,000 **profit at 60 % margin** — because it never
   subtracts what the performers are owed. Both operators are shown the same wrong figure.
3. **A booking request for a room already sold creates a second event in that room, silently.** The
   venue/room columns landed today so this check could run; `GET /events/date-conflicts` already
   answers `roomIsBusy: true`, the New Event wizard already warns — and the Requests inbox and the
   "Create Draft" dialog ask nothing. Two events now sit in Main Room on 2026-10-14.

**Ugly rather than wrong, kept separate:** the four surviving "pool" strings, the `Rooms −1` filter
badge, the truncated placeholders in narrow phone fields, and the two `NOTE`s about unbuilt
decisions (RSVP consent, date/time format). None of those change a number or cross a boundary.

---

## What was driven

| account | seat | screens |
|---|---|---|
| `operator` | 1 (Playwright), whole run | every sidebar destination; event creation (wizard + hold); the full event workspace and every tab; Budget Planner in both scopes; the settlement workspace end to end on two events; Calendar incl. filters, mark-unavailable, ICS export, share modal; Requests incl. Create Draft; Tasks; Contacts export; Settings; Projections; mobile at 390 px |
| `performerB` (Neon Tide) | 2 (Chrome DevTools) | every destination; invitation accept; deal line confirm; own settlement; share modal ("One schedule"); `/reports` + `/projections` boundary screens |
| `performerA` (Marlo Vance) | 2 | every destination; the represented act's read-only Deals tab; Setlists; Settlements |
| `agent` (Astra Booking) | 2 | every destination; own commission on the Settlements list and on the event settlement; the reopenable deal |
| `teamAndCrew` (Priya Sound) | 2 | every destination; own settlement line; task-budget boundary |
| `coHost` (Northlight Presents) | 2, **in a browser** | Projections; the Album Release workspace, Deals tab, Budget Planner in both scopes, the operator cost-split control; the new event after accepting a UI invitation |
| anonymous | 2 | the shared availability page via **both** doors (token and legacy fragment), the public venue profile, the public event page, the share viewer |

API-only (rules, not delivery), via `.claude/skills/verify-e2e/api-as.mjs` and `curl`: the three
`placeOfRequest` guards on both doors, task-budget visibility across all six accounts, the co-host's
rename / re-date / delete powers, budget-scope isolation, `GET /settlements` for the agent, and the
public availability token's lifecycle.

---

## Findings

### [MAJOR] Money — a solo operator is still given a private book nothing reads, and every cost typed in it vanishes from the settlement

**As:** operator (`operator@e2e.showme.test`), seat 1.

**Steps:**
1. Events → **New event**. Artist "QA Regression Act", venue The Lantern Hall, room Main Room,
   date 2026-11-20, link performer profile **Neon Tide**, deal guarantee-vs-door SEK 30,000 / 70 %.
   → event `c3c599b8-f36d-4797-beaa-105849dd6b51`.
2. Event Details → Ticket Information → one tier `General`, price 250, max 400, est 300.
3. Budget Planner. The scope chooser at the top of the planner offers **My budget / Shared ledger**
   even though this event has exactly one operator and no co-host.
4. Click **My budget**, add a **Production cost** of 5 000, Tab out.
5. Confirm both deal lines, then Settlement workspace → **Run the settlement**.

**Expected:** PLAN.md:215 as restated by migration `0046_a_night_run_alone_still_has_one_book.sql`
and by `ensureEventBudgets` (`apps/api/src/lib/budget-provisioning.ts:111-121`):
*"Co-hosting is what calls a PRIVATE book into being … with nobody to keep it from it would only be
a second book to choose between — and choosing wrong is what put a night's costs outside its own
settlement."* A solo event should have **one** budget (`shared`) and **no** scope chooser, and the
SEK 5 000 must reach the settlement.

**Actual:** the event is born with both books, and the cost lands in the private one, which the
settlement never reads. The settlement prints **Deductions − SEK 0**.

```
$ psql … -c "select b.scope,b.owner_profile_id,l.kind,l.label,l.amount
             from budgets b left join budget_lines l on l.budget_id=b.id
             where b.event_id='c3c599b8-…'"
  scope  |           owner_profile_id           |  kind   |      label      | amount
---------+--------------------------------------+---------+-----------------+---------
 shared  |                                      | revenue | General         | 7500000
 private | e2e00000-0000-4000-8000-0000000000a1 | cost    | Production cost |  500000

$ … -c "select kind,label,amount from settlement_lines where event_id='c3c599b8-…'"
  kind   |  label  | amount
---------+---------+---------
 revenue | General | 7500000     ← the cost is not there
```

**The cause, which is one line and not a mystery.** `ensureEventBudgets` is correct — it only
provisions a private book when `operatingProfileIds.size > 1`. But **event creation never went
through it**: `apps/api/src/routes/events.ts:1093-1098` still does

```ts
// The host's own budget, opened with the event.
await tx.insert(schema.budgets)
  .values({ eventId: event.id, scope: "private", ownerProfileId: actingProfileId })
  .onConflictDoNothing();
```

so every event created since `f996c14` is born with exactly the shape that commit and migration
`0046` existed to remove — and `0046` cannot heal it, because its guard is *"the event has no
shared ledger yet"* and `ensureEventBudgets` adds one on first open.

**Scope:** reproduces on every new event created by an operator (checked on two: `QA Regression
Act` and the draft made from a booking request). Seeded events are clean because the migration
healed them. Not account-kind specific — it is the creation path.

**Evidence:** the SQL above; `docs/screenshots/qa-2026-09-27-run3/` settlement screen.

---

### [MAJOR] Booking — a booking request for a room that is already sold creates a second event in that room, with no warning at any step

**As:** anonymous sender (public form), then operator.

**Steps:**
1. `POST /booking-requests` from the marketing origin naming the venue and the **Main Room** on
   **2026-10-14** — the night `Marlo Vance — Album Release` is `confirmed` in that very room:
   ```
   curl -H 'Origin: http://localhost:5173' -d '{"source":"public_form","targetProfileId":"…a1",
     "contactName":"Clash Tester","email":"clash@probe.test","artistName":"Double Booked",
     "wantedDate":"2026-10-14","venueProfileId":"…a1","stageId":"…c1","pitch":"…"}'  → 201
   ```
2. Operator → **Requests**. The card renders correctly, ROOM cell reads "Main Room". **No clash
   warning of any kind.**
3. Press **Create Draft**. The dialog offers title / date / currency and says nothing about the
   clash. Press **Create draft**.

**Expected:** decisions.md **#25.1**: *"every incoming request must carry date + venue + room …
because the double-booking check on an incoming request has nothing to compare without them."*
The columns landed in migration `0047` today precisely so this check could run. The same check is
already built, already wired, and already correct **one door over** — the New Event wizard warns
*"Main Room already has "Marlo Vance — Album Release" and 1 more on this night. You can book it
anyway."* (`apps/web/src/hooks/useDateConflicts.ts`, consumed by `NewEventWizard.tsx:1343` and
`EventInlineInformation.tsx:167`). It warns, it never blocks — which is the right shape here too.

**Actual:** no warning on the request card, none in the Create Draft dialog, and two events now sit
in Main Room on 2026-10-14:

```
$ … -c "select title,event_date,status,stage_id from events where event_date='2026-10-14'"
 Marlo Vance — Album Release | 2026-10-14 | confirmed | …c1
 Double Booked               | 2026-10-14 | draft     | …c1
```

The API already answers the question the screens never ask:

```
$ node .claude/skills/verify-e2e/api-as.mjs operator GET \
    "/events/date-conflicts?venueProfileId=…a1&date=2026-10-14&stageId=…c1"
200  { "roomIsBusy": true, "events": [ … "Marlo Vance — Album Release" … ] }
```

**Scope:** reproduces for a request sent from the shared availability page too (the page hides a
booked room, but only against the **snapshot** it was minted from — a night sold after the link was
made is still offered, which is the same hole through a different door). `Requests.tsx` never calls
`useDateConflicts`.

---

### [MAJOR] Event Details — a ticket figure typed into a tier can silently become ten times what was typed

**As:** operator.

**Steps:**
1. Event Details → Ticket Information → **+ Add ticket type**. The three numeric cells (PRICE, MAX,
   EST. SALES) are pre-filled with `0`.
2. **Click** into MAX (it reads `0`) and type `50`.

**Expected:** the field reads `50`.

**Actual:** it reads **`500`** — the caret lands before the pre-filled zero, so the typed digits are
prefixed to it. Tab out and that is what is stored:

```
$ … -c "select extras->'ticketTiers' from events where id='c3c599b8-…'"
 [{"id":"tier-…","est":0,"max":500,"name":"VIP","price":500}]     ← 50 was typed
```

The same trap caught PRICE earlier in the session: clicking in and typing `250` produced `0250`.
**Tabbing** into the field selects its contents and behaves correctly, so the defect only bites the
user who reaches for the mouse — which is most of them.

**Why it matters rather than being ugly:** this cell feeds the Budget Planner's ticket revenue and
`seedTicketTiersIntoBudget`, so it reaches the settlement. A price of 2 500 instead of 250 is a
tenfold settlement error with nothing on screen to question it. (One mitigation is present and
works: total inventory over venue capacity prints *"Total ticket inventory exceeds venue capacity
(400). This is allowed, but double-check your allocations."*)

**Evidence:** `docs/screenshots/qa-2026-09-27-run3/ticket-tier-typed-50-reads-500.png`, and the SQL
above.

---

### [MAJOR] Financial Projections forecasts the whole adjusted net as the operator's profit — the same night the Budget Planner calls a loss

**As:** operator, and the co-host sees the same number.

**Steps:** Financial Projections → the row for `Marlo Vance — Album Release`. Then the same event's
Budget Planner (shared ledger).

| screen | revenue | costs | profit |
|---|---|---|---|
| Financial Projections | SEK 83,000 | SEK 33,000 | **SEK 50,000 (60 % margin)** |
| Budget Planner (same event, same shared ledger) | SEK 83,000 | SEK 84,245 | **−SEK 1,245** |
| Settlement (run, reconciled) | SEK 83,000 | — | operator residual **SEK 0** |

**Expected:** decisions.md — *Financial Projections = "a view over budget (projected income) +
settlements (realised income)"*. Whatever it shows, it must not contradict the Budget Planner over
the same budget; and "NET PROFIT / Profit per show" must be the operator's, not the adjusted net
that is wholly paid away.

**Actual:** the projection omits every **deal entitlement**. On this door-split night the performers
take 100 % of the adjusted net (SEK 30,000 + SEK 20,000), so the operator's real residual is SEK 0
and Projections calls it SEK 50,000 profit at 60 % margin. The Budget Planner does count the fee —
its own cost breakdown lists *"Performer fee SEK 50,000, 59 %"* — so the two screens read the same
budget and disagree by SEK 51,245 on one night.

Same on my own new event: Projections says `QA Regression Act` — revenue SEK 75,000, **profit
SEK 70,000, 93 % margin**; the planner says profit SEK 21,375 and the settlement leaves the
operator SEK 22,500. (The SEK 70,000 is 75,000 − 5,000, i.e. it has deducted the operator's
**private** book — the one the settlement refuses to read — and ignored the SEK 52,500 fee. Two
books, wrong in both directions, on one line.)

**Also on that screen:** the pipeline counts `cancelled` (`Winter Gala`) and stray draft events, and
the co-host's copy prints *"…budgeted revenue SEK 0 across 0 events you operated"* directly under a
table listing one event.

**Evidence:** `docs/screenshots/qa-2026-09-27-run3/projections-says-profit-50000.png`,
`…/planner-says-loss-1245.png`.

---

### [MAJOR] Every settled figure explains itself with the wrong percentage — "100 % of the adjusted net SEK 50,000" above a payout of SEK 30,000

**As:** operator; reproduces for performerA and for the agent on their own screens.

**Steps:** `Marlo Vance — Album Release` → Settlement → **Run the settlement** → Settlement tab.

**Expected:** the sentence under a party's figure explains *that party's* entitlement. `deal_parties`
holds Marlo at 6000 bp and Neon Tide at 4000 bp of a deal whose own `split_basis_points` is 10000.

**Actual:** both rows print the DEAL's percentage:

```
Marlo Vance   Performer  SEK 30,000
              100% of the adjusted net SEK 50,000 — your share of the deal's SEK 50,000
Neon Tide     Performer  SEK 20,000
              100% of the adjusted net SEK 50,000 — your share of the deal's SEK 50,000
```

Two parties, both told they get 100 % of SEK 50,000, paid SEK 30,000 and SEK 20,000. The figures are
right (Σ = 50,000, Σ net = 0); the sentence beside each is wrong, and on the agent's own screen it
is accompanied by a percentage column reading **100.0 %**.

**Scope:** confirmed on the operator's Settlement tab, on the agent's `ENTITLEMENT BY PARTY` card,
and on `performerA`'s Deals tab (`Share of the adjusted net 100 %` over a `YOUR LINE … 60 %`).

**Evidence:** `docs/screenshots/qa-2026-09-27-run3/settlement-says-100-percent-pays-60.png`,
`…/agent-own-commission-shows-zero.png`, and the SQL:
```
$ … -c "select pr.name, dp.share from deal_parties dp join event_participants ep … "
 Marlo Vance | {"splitBasisPoints": 6000, …}
 Neon Tide   | {"splitBasisPoints": 4000, …}
```

---

### [MAJOR] A cost added to the shared ledger after the first settlement run never reaches it, and "Planned vs actual" compares the settlement with itself

**As:** coHost (Northlight Presents) in a browser, seat 2; operator in seat 1.

**Steps:**
1. Operator runs the settlement on `Marlo Vance — Album Release`.
2. As **coHost**, Budget Planner → **Shared ledger** → add cost `Northlight van hire` SEK 10,000.
   It persists to the shared budget with `paid_by` = Northlight, and the planner's
   TOTAL COSTS (PARTIAL) moves 34,245 → **44,245**.
3. Operator → Settlement → **Recalculate**.

**Expected:** the reconciliation reflects the ledger, or the screen says plainly that it no longer
does.

**Actual:** Deductions stay at **SEK 33,000** and `Northlight van hire` is absent from
`settlement_lines`:

```
$ … -c "select kind,label,amount from settlement_lines where event_id='…e1'"
 revenue | Advance ticket sales …      | 6500000
 revenue | Walk-up ticket sales …      | 1800000
 cost    | Door & security staffing    |  850000
 cost    | Green-room catering         |  350000
 cost    | Marketing & print           |  900000
 cost    | Sound & production          | 1200000        ← no van hire
```

`copyBudgetOnce` (`apps/api/src/lib/settlement-lines.ts:62-67`) returns
`{ copied: 0, alreadyHad: true }` the moment any settlement line exists, so **Recalculate can never
import a later budget line** — and nothing says so. The planner stays fully editable and keeps
counting the row.

**The sharpest part** is the Financials tab's *"Planned vs actual — what this night was budgeted to
make, against what it actually did"*: it reads **Costs planned SEK 33,000 / actual SEK 33,000 /
+ SEK 0**. The budget's planned costs are SEK 43,000. The panel is comparing the settlement's frozen
copy with itself, so it is structurally incapable of ever reporting a variance against the budget it
names.

**Scope:** the co-host is the sharpest case because their money goes in the shared ledger by
construction, but it reproduces for the host too — any budget edit after the first run.

---

### [MAJOR] A co-host can rename the host's show, with no change request and no notice

**As:** coHost (`co.host@e2e.showme.test`), acting profile Northlight Presents.

**Steps / evidence:**
```
$ node .claude/skills/verify-e2e/api-as.mjs coHost PATCH /events/…e1 \
      '{"title":"Co-host renamed this"}' e2e00000-…-a6
200  { "title": "Co-host renamed this", … }
$ … -c "select title,version from events where id='…e1'"
 Co-host renamed this | 3
```

**Expected:** the two neighbouring powers are both handled properly, which is what makes this one
stand out —
* re-dating correctly goes through consent: `PATCH … {"eventDate":"2026-10-21"}` writes a **pending
  `event_change_requests` row** and leaves `event_date` alone; the co-host's own workspace then shows
  *"A change to this booking is waiting on an answer … Waiting on 3 people to answer."*
* deleting is correctly refused: **403** *"Only the profile operating this show can delete it.
  Switch to it (X-Profile-Id) — or, if the show is not yours, archive it instead…"*

The title is the one identifying fact of somebody else's night — it is on the performers' screens,
the public page and every notification — and it changes with no consent step, no change request, and
no notification to the host.

**Actual:** 200, applied immediately, `version` 1 → 3.

**Scope:** API-verified. The title reached the host's own screens on reload. Restored to
`Marlo Vance — Album Release` afterwards.

---

### [MAJOR] A shared event link hands a stranger the email address of whoever sent the booking request

**As:** operator creating the share; anonymous link-holder reading it.

**Steps:**
1. Requests → a public-form request → **Create Draft**. The API writes the sender's contact into
   `events.notes`:
   ```
   From a booking request for 2026-10-15.
   Contact: Ida Frost <ida@frostwave.test>
   Act: Frostwave

   QA run3 — asking for the Main Room on the 15th.
   ```
2. On that event, **Share & Export** → a public share with `event.view` only.
3. Open `/shares/<token>` **signed out**.

**Expected:** a guest with `event.view` sees the show — date, venue, doors, capacity. A third
party's email address is personal data that neither the operator typed nor the sender agreed to
publish, and nothing on the share dialog warns that "notes" contains it.

**Actual:** the viewer renders `notes` verbatim, so the page reads:

> Frostwave · 15 Oct 2026 · The Lantern Hall
> *From a booking request for 2026-10-15. Contact: Ida Frost &lt;ida@frostwave.test&gt; Act:
> Frostwave QA run3 — asking for the Main Room on the 15th.*

**Scope:** every event created by "Create Draft" from a public-form request or an offer, which is
the flow the new `booking_requests` venue/room work is built around. The marketing public pages are
**clean** — `GET /public/events/:id` returns no notes field at all, and an unpublished event 404s
there — so the exposure is the authenticated share viewer only.

**Evidence:** share token `b921abff…`, rendered in a second browser with no session; the notes text
above is quoted from that page.

---

### [MINOR] Marketing — the shared availability page's Privacy, Terms and home links all lead back to the availability page

**As:** an anonymous recipient of a shared link, seat 2.

**Steps:** open `http://localhost:5173/a/<token>` → click **Privacy** in the footer (or the shoWMe
wordmark, or **Terms**).

**Expected:** the privacy policy.

**Actual:** the availability page again. The links are relative (`availability.html:16,42,43`:
`href="index.html"`, `href="privacy.html"`, `href="terms.html"`), so from `/a/<token>` they resolve
to `/a/privacy.html` — and both the dev rewrite (`apps/marketing/vite.config.ts`, `^\/a\/[^/]+$`)
and production (`firebase.json:28`, `"source": "/a/**"`) answer that with `availability.html`:

```
$ curl -s http://localhost:5173/a/privacy.html | grep -o '<title>[^<]*</title>'
<title>Shared availability · shoWMe</title>
$ curl -s http://localhost:5173/privacy.html   | grep -o '<title>[^<]*</title>'
<title>shoWMe: Privacy Policy</title>
```

The in-form privacy link (`uid 2_18`, beneath "Your name, email and message are sent to…") has the
same href, so the one legal link a stranger is most likely to follow before handing over their email
is the broken one. **Fix:** root-relative hrefs (`/index.html`, `/privacy.html`, `/terms.html`).

**Scope:** `event.html:17,45,46` has the identical pattern under the `/event/**` rewrite;
`profile.html:25` likewise.

---

### [MINOR] Marketing — an empty "Room" dropdown renders on a legacy fragment link, and on any sharer with no rooms

**As:** an anonymous recipient, seat 2.

**Steps:** open the OLD fragment form of the link —
`http://localhost:5173/availability#profile=e2e-the-lantern-hall&from=2026-11-01&to=2026-11-10&dates=2026-11-02,2026-11-03,2026-11-05&unavailable=confirmed&generated=2026-09-20&room=Back%20Room`
— and click a date.

**Expected:** no room control at all. `parseSnapshot` sets `rooms: []` for a fragment link ("A
fragment link predates rooms and can never carry them"), and `applyRooms` duly sets
`roomGroup.hidden = true` (`apps/marketing/src/availability-request.ts:580-583`).

**Actual:** a **ROOM** label with an empty `<select>` under it, 706×70 px of it:

```js
getComputedStyle(document.querySelector('.request__room')).display   // "grid"
document.querySelector('.request__room').getBoundingClientRect()     // 706 × 70.27
document.querySelector('.request__room').hidden                      // true
```

The author `.field { display: grid }` (`styles/request.css:90`) beats the UA sheet's
`[hidden] { display: none }`. `request.css:54-60` already carries a comment about exactly this trap
and an override for `.request__form`, `.request__done`, `.request__dates` and `.request__add-date` —
`.request__room` was added later and never got its line. **Fix:** one rule,
`.request__room[hidden] { display: none; }`.

**Scope:** every legacy fragment link, and every token link minted by a **performer** (no rooms at
all). It does not bite the venue token links, which always carry at least one room.

**Evidence:** `docs/screenshots/qa-2026-09-27-run3/legacy-fragment-empty-room-select.png`.

---

### [MINOR] Events list — a cancelled show is indistinguishable from a live one, and cannot be filtered to

**As:** operator.

**Steps:** Events → **All**. `Winter Gala` (status `cancelled`) renders identically to
`Marlo Vance — Album Release` (`confirmed`): event name, venue, date, settlement state. Switch to
**Board**: the columns are Pending 0 / On hold 1 / Confirmed 1 / Concluded 1 — `Winter Gala` and the
three drafts are in none of them.

**Expected:** a cancelled night is findable. Commit `2242fc4` removed the Status column on Ran's
instruction (`123qy9rpe3y` *"No Cap Status needed"*) and justified it with *"the chips above the
table filter on status, the Board view IS status grouped"* — but the chips are All / Pending /
On hold / Concluded / Draft / Archived (no **Cancelled**, no **Confirmed**) and the Board has no
Cancelled column, so with the column gone there is now **no route to a cancelled show at all**
except knowing its name.

**Actual / Scope:** 7 events in the list, 2 of them (`Winter Gala` cancelled, and the drafts) absent
from the Board. decisions.md **#25.3** already names "Cancelled + Confirmed filter chips" as
outstanding work, so this is half-known — it is filed because the column was removed *before* the
chips arrived, which is the order that leaves a gap.

**Evidence:** `docs/screenshots/qa-2026-09-27-run3/events-list-operator.png`.

---

### [MINOR] Requests — "Create Draft" stamps the room but drops its capacity

**As:** operator.

**Steps:** Requests → the `Frostwave` card (15 Oct, ROOM = Main Room) → **Create Draft** → Create
draft.

**Expected:** the drafted event inherits the room's capacity the same way the New Event wizard does
— pick "Main Room · 400 cap" there and the Capacity field fills with 400.

**Actual:**

```
$ node .claude/skills/verify-e2e/api-as.mjs operator GET /events/1ab63486-…
200  { …, "capacity": null, "stageId": "…c1", "stageName": "Main Room" }
```

Every seeded event whose `stage_id` is set carries that room's capacity; this one does not. The
Budget Planner's break-even and per-guest figures are keyed off capacity, so the drafted event opens
its planner without a house size.

---

### [MINOR] Copy — "pool" survives in four user-visible strings, one commit after "the last pool leaves the settlement"

**As:** operator.

**Steps:** Events → New event → Continue to step 2 with a performer profile linked. The field label
reads **"Neon Tide's share of the pool"**, and its help text *"Of revenue less the costs paid to
outside suppliers."*

**Expected:** Ran, `123qy9rng3q`: *"Don't use the term Pool"*. Commit `2242fc4` today is titled
*"the last "pool" leaves the settlement"* and changed one subtitle on the Financials tab.

**Actual:** four rendered strings remain —
`apps/web/src/components/NewEventWizard.tsx:1742` ("…'s share of the pool", confirmed on screen),
`apps/web/src/components/BudgetLineAttribution.tsx:396` ("Comes off the pool, so every share is
smaller by it."), `:444` ("A real cost reported under it — still lowers the pool."), and
`apps/web/src/components/DealCostAccountabilityCard.tsx:139`
(`caption="Real costs reported under it — these lower the settlement pool"`). The commit's claim is
true of the settlement screen and not of the product.

---

### [MINOR] Budget Planner — the payment-processing fee drives the headline profit and break-even, and is stored nowhere

**As:** operator.

**Steps:** open the Budget Planner on a brand-new event. "Payment processing fees" is pre-filled at
**1.5 %** and TOTAL COSTS / PROFIT / LOSS / BREAK-EVEN TICKETS all include it (SEK 1,125 on
SEK 75,000). Then:

```
$ … -c "select scope, planning_assumptions from budgets where event_id='c3c599b8-…'"
 private |
 shared  |          ← both null
```

**Expected:** either the figure is a real assumption and is persisted (and reaches the settlement as
a deduction), or it is not counted in the headline profit. The planner's own copy two rows above is
explicit about the distinction: *"Not budgeted. Nothing is stored for these and the settlement never
sees them."*

**Actual:** it is counted, it is not stored, and the settlement's Deductions line reads SEK 0. The
planner says the operator clears SEK 21,375; the settlement says the operator's residual is
SEK 22,500. Nothing on either screen explains the SEK 1,125.

---

### [MINOR] The co-host's planner promises to leave break-even out, then prints one — on a night that never breaks even

**As:** coHost, Budget Planner, shared ledger.

**Actual:** the Results card correctly withholds profit and margin and explains why —
*"One of this event's deals is not shown to you, so what the night costs is higher than the total
above. Profit, margin and break-even are left out rather than calculated without it."* — and the
**next element on the page** is BREAK-EVEN ANALYSIS with a chart and the sentence *"Revenue passes
total cost at 130 tickets of 400 capacity."*

The host's own planner, which can see the withheld fee, says *"Revenue never passes total cost inside
400 capacity"* — so 130 is not merely disclosed, it is wrong, and it is the more optimistic of the
two numbers being shown to the party that knows less.

**Evidence:** `docs/screenshots/qa-2026-09-27-run3/cohost-breakeven-contradiction.png`.

---

### [MINOR] Break-even reads "0 tickets" on an event that never breaks even

**As:** operator, `Marlo Vance — Album Release` → Budget Planner.

The KPI tile prints **BREAK-EVEN TICKETS 0** while the chart eight rows below prints *"Revenue never
passes total cost inside 400 capacity."* Zero reads as "profitable from the first ticket"; the truth
is the opposite. Same screen, two answers.

---

### [MINOR] The operators' cost-split field cannot be cleared to retype — emptying it writes 1 %

**As:** coHost (or host), Budget Planner → Costs → **Production costs split**.

**Steps:** turn the split on (defaults 50/50), select the contents of one box and delete them.

**Expected:** an empty box you can type into.

**Actual:** the box snaps to **1** and 1 % is written to the shared ledger immediately —
`BudgetPlanner.tsx:1381-1385`:
```ts
const parsed = Number(event.target.value);          // Number("") === 0
if (!Number.isFinite(parsed)) return;
const points = Math.max(1, Math.min(100, Math.round(parsed))) * 100;   // 0 → 1 → 100 bp
```
```
$ … -c "select planning_assumptions from budgets where event_id='…e1' and scope='shared'"
 {"operatorCostSplit": {"…b1": 100, "…bb": 3000}, …}     ← 1 % / 30 %
```
The write is deliberately immediate ("it is a toggle and a handful of percentages, not a field
somebody types into character by character" — `useBudgetEditor.ts`), so there is nothing to undo.
The mitigation is real and works: the planner then prints *"These add up to 31 %, not 100. The shares
still divide the remainder in that ratio, so the settlement balances — but it is probably not what
you meant."*

**UNCONFIRMED, same control:** two rapid programmatic edits left the split at **100 % / 100 %** and
it survived a reload. I could not reproduce it with one-at-a-time edits (70/30 persisted correctly
every time), so it may be an artefact of the driver rather than a defect. Recorded, not upgraded.

---

### [MINOR] Clicking an event-workspace tab does not change the URL, so the back button and a reload both lose it

**As:** operator (any kind).

**Steps:** open `/events/<id>?tab=details` → click the **Deals** tab → reload.

**Expected:** the router's own comment says why — *"`?tab=` names ONE PANEL of the event workspace,
so a panel can be linked to from outside it"* (`apps/web/src/router.tsx:44-52`).

**Actual:** the URL stays `?tab=details` with the **Deals** panel selected; reload returns to Event
Details; the back button steps out of the event entirely rather than back a tab; and copying the
address to a colleague sends them to the wrong panel.

```js
// after clicking Deals
{ url: ".../events/c3c599b8-…?tab=details", selectedTab: "Deals" }
// after reload
{ url: ".../events/c3c599b8-…?tab=details", selected: "Event Details" }
```

The neighbouring control already does it right — clicking **My budget** writes
`?tab=budget&budgetScope=mine` (which is how run 3's `budgetScope` finding was fixed). `tab` is read
on entry and never written.

---

### [MINOR] A co-promoter invited through the product cannot see the shared ledger at all

**As:** operator inviting; coHost accepting.

**Steps:** event → **Invite Collaborator** → role **Co-operator**, access **Standard for the role** →
accept the invitation as coHost → open the event.

**Expected:** PLAN.md:215 — *"Co-promoters share **one** budget (full transparency)"* — and
decisions.md's own resolution, *"a **shared-budget rule** (co-operators see all deals assigned to the
shared budget) for the blanket co-operator tier"*.

**Actual:** the grant is exactly four capabilities and no budget:

```
$ node .claude/skills/verify-e2e/api-as.mjs coHost GET /events/c3c599b8-…
['deal.view.own', 'event.view', 'schedule.view', 'settlement.view.own']
```

The **Budget Planner tab does not render** for them, and `?tab=budget` silently falls back to Event
Details. The only other access level is **"Full control — paid plans only"**, which is refused on the
free plan with *"Granting admin requires a paid plan · Included in shoWMe Pro"*. So on the free tier
there is no setting that produces the co-promotion PLAN.md describes.

The invite dialog is at least honest about what it grants — *"the event, their schedule, and their
own money. Never anyone else's deal, never the budget"* — and `f70c519` delivers exactly that, which
is why this is filed as a product gap rather than a broken promise. The seeded `coHost` on
`Marlo Vance — Album Release` has a richer permission set and does see the shared ledger, so the two
co-promotions in the app behave completely differently.

---

### [MINOR] A co-promoter's calendar and ICS export are titled with the venue, not the show

**As:** coHost (Northlight Presents).

Calendar → October 2026, label mode **Event Name**. The 14 Oct chip reads **"The Lantern Hall"**, not
`Marlo Vance — Album Release`. Export ICS carries the same:
`SUMMARY:The Lantern Hall`, `DESCRIPTION:Event: The Lantern Hall\nPerformer: Marlo Vance + Neon Tide`.

`apps/web/src/lib/calendarEventLabel.ts:27-29` decides on `hostProfileId` alone, and its own docblock
gives the reason: Ran asked that a **performer** not get "a calendar full of their name". A co-host
is not a performer — they are co-producing the night — and a promoter who co-hosts five shows at one
venue now gets a calendar full of *the venue's* name, which is the same failure one role over. The
rule wants `co_host` on the "it's your show" side of the test.

---

### [NOTE] Accessibility — the budget scope chooser signals the selected book by colour only

`My budget` / `Shared ledger` are two `<button>`s that differ by CSS class (`_ghost_` vs
`_primary_`) with **no** `aria-pressed`, `aria-selected` or `role="tab"`. A screen reader is told
there are two buttons and not which book is open — on the one control in the app where being in the
wrong book costs money.

---

### [NOTE] `/audience` renders for kinds that are not offered it, where `/reports`, `/projections` and `/setlists` explain the boundary

`teamAndCrew` and `agent` have no **Audience** nav entry, but typing `/audience` renders the full CRM
screen. The other three kind-gated routes answer properly — e.g. `/projections` for a performer:
*"Projections belong to the venue's books — a projection rolls up the event budget, which only the
operator running the event can see."* Nothing is disclosed (the list is the caller's own and empty),
so this is consistency rather than a leak.

---

### [NOTE] The RSVP form has no per-recipient consent, and `audience_rsvps` has no consent columns

decisions.md resolves this (*"RSVP consent granularity (GDPR) — RESOLVED: SEPARATE per-recipient
consent … one per recipient … no pre-checked boxes … the privacy notice names each recipient +
purpose + retention"*). The public event page collects name / email / city with a prose sentence and
no checkbox, and the table is `(id, event_id, name, email, city, created_at)` — no consent record,
no retention field. Reported as unbuilt, not as a defect.

---

### [NOTE] `users.date_format` and `users.time_format` exist and no screen can set them

Settings → General offers Organization name, Contact email, **Base currency**, **Timezone**;
Appearance offers the theme and nothing else. Both format columns stay NULL. Also: the currency
control is labelled **BASE CURRENCY**, which is the name `events.base_currency` uses for the
authoritative payout currency — the user-level one is the *display* currency and the settlement
screen calls it that correctly (*"Preview only … the settlement is denominated in SEK"*). One word,
two meanings, on the money surface.

---

## What passed — named, because it is the larger half of the result

### Today's four changes, driven end to end

**1. Booking requests carry a venue and a room.** All three `placeOfRequest` guards hold on **both**
doors, with the exact messages, not just the status:

| probe | `POST /offers` (authenticated) | `POST /booking-requests` (public form, `Origin: localhost:5173`) |
|---|---|---|
| room with no venue | 400 *"A room needs the venue it is in — send venueProfileId with stageId"* | same |
| venue that is not the target | 400 *"A request can only name the venue it is being sent to"* | same |
| room not in that venue | 400 *"That room is not in this venue"* | same |
| venue + a room of it | 201, `venue_profile_id` + `stage_id` stored | 201, both stored |

"Create Draft" stamps the room on the drafted event (`stage_id = …c1`, `stageName: "Main Room"`) —
see the separate MINOR about its capacity. The Requests **card** view prints a `ROOM` cell naming
the room; the **List** view has no room column at all (`RequestCard.tsx:343` is the only render
site), which may or may not be intended.

**2. Availability share links are short tokens, and both doors work.**
`POST /profiles/:id/availability-share` mints `http://localhost:5173/a/<12-char token>`, and the
payload in `shares.payload` is correct per room — Main Room's `availableDates` omits 2026-10-14
while Back Room's includes it. The **legacy fragment** link
(`/availability#profile=…&dates=…&room=Back%20Room`) still renders in full, with its own copy
("Pick a date to ask about it" instead of "…to see which rooms are free that night"). The link
**empties itself** on every form change I tried — a weekday pill, a checkbox, the room select — and
has to be re-minted. Token hygiene is right too: a bogus token 404s; an **event**-share token on
`/public/availability/:token` 404s (*"Share not found"*, so it is not a back door onto another
share's payload); and the link dies the moment the profile unpublishes and revives when it is
published again.

**3. The share modal's two selects.** Calendar (the venue/profile) then Room / stage, with
All rooms / Back Room / Main Room. Picking **Main Room** correctly drops 2026-10-14 from the
available list while **All rooms** keeps it. A performer's room select is **disabled** and reads
**"One schedule"** (`disabled: true`, verified in the DOM).

**4. The shared page answers per date.** 14 Oct (one room free) → *"Back Room (80 cap) is the only
room free on this date."*, no select. 15 Oct (both free) → a `ROOM` select defaulting to
**"Any room — they'll decide"** with both rooms and their capacities. Main Room never appears on the
14th. Sending with Main Room picked on the 15th landed in the operator's inbox with a **ROOM: Main
Room** cell and the row stamped correctly in Postgres.

### Ran's 2026-09-21 spec, re-confirmed and pushed harder

On a brand-new event with one tier (250 × 300) and a **DRAFT** guarantee-vs-door deal
(SEK 30,000 / 70 %), the Budget Planner showed the fee **before any confirmation**, with the reason
written out: *"The door beats the guarantee — 70 % of the door is more than the guarantee, so the
split governs. Nobody has confirmed these terms yet, so they can still move."* Confirming both lines
removed the `· PROPOSED` chip and that last sentence, and the fee kept tracking quantity. Checked by
hand at two attendances:

| tickets | gross | 70 % of gross | fee shown | split card | operators |
|---|---|---|---|---|---|
| 300 | 75,000 | 52,500 | **52,500** | 70 % / 30 % | 22,500 |
| 150 | 37,500 | 26,250 | **30,000** (guarantee floor) | **80 % / 20 %** | 7,500 |

At 150 the card relabels itself and explains: *"The guarantee beats the door — 70 % of the door falls
short of it, so the guarantee is paid."* Break-even 122 is right by hand
(250n = 30,000 + 3.75n → n = 121.8), and it is solved against the **live** formula, not a frozen fee —
a fixed SEK 52,500 would give 213. Totals all reconcile: costs 53,625, profit 21,375, margin 28.5 %,
revenue/guest 250, cost/guest 179.

### Money, checked by hand on more than three rows

`Marlo Vance — Album Release`: advance 260 × 250 = 65,000 ✓, walk-up 60 × 300 = 18,000 ✓, gross
83,000 ✓, deductions 12,000 + 9,000 + 8,500 + 3,500 = 33,000 ✓, net 50,000 ✓, Marlo 60 % = 30,000 ✓,
Neon Tide 40 % = 20,000 ✓, operator residual 0 ✓, **Σ net = 0** ✓, total payable 50,000 ✓. Ticket
tier prices are read as **major** units throughout — a SEK 250 ticket settles at SEK 250, not SEK 2.50.

**Currency.** Switching the user's display currency to EUR converted every figure to `≈ €…` and
printed the banner *"Preview only. These figures are converted from SEK at a live rate for reading —
the settlement is denominated in SEK, and that is what is owed, recorded and paid."*, with
`SETTLES IN SEK` beside it. 83,000 → €7,163, 50,000 → €4,315, 30,000 → €2,589, 20,000 → €1,726 — one
consistent rate, and **no settled amount moved**.

**Party scoping.** A performer's settlement shows only their own entitlement and the sentence *"The
night's takings and costs are the operator's view of this event"*; crew sees only their own SEK 0;
the default curation state is *"Nothing yet — this party sees no figures at all"* (decisions #24.3's
NULL-means-nobody polarity, intact). On the Deals tab a performer sees **YOUR LINE** and *"The other
parties' lines on this deal aren't shared with you."*

### Realtime — with two genuinely independent browsers, and it delivers

Two browsers, two profiles, two IndexedDBs; signing out of one left the other signed in (verified).
Both of run 3's realtime MAJORs are **fixed**, and I watched each land:

- performerB **accepts an invitation** in seat 2 → seat 1's Event Details performers card moved
  `Invited` → `Connected` inside 4 s with no interaction.
- performerB **confirms their deal line** in seat 2 → seat 1's Deals tab moved
  `Sent — awaiting confirmations · 1 of 2 signed` → `Confirmed — terms frozen · 2 of 2 signed ·
  Reopen` inside 6 s.

`apps/web/src/hooks/useRealtimeStream.ts` now invalidates the event, deals, budgets, settlements,
settlement-lines, participants and invitations queries off any event-scoped frame — the gap this
sweep was told to confirm has been closed.

### Run-3 findings re-checked — four fixed, one narrowed, one still open by decision

| run 3 finding | now |
|---|---|
| Two holds on one night both read "1st" | **FIXED.** The Place-a-Hold dialog reads *"2nd hold — 1 hold is already competing for this date. Taking a rank pushes the ones at or below it down one."*, and Postgres shows ranks 1 and 2. It also warns *"Already on this night: 'Nordic Synth Showcase'. This room is still free."* |
| An agent's own money is SEK 0 on every screen | **FIXED on the Settlements list** — SEK 3,000 outstanding, matching the `settlement_transfers` row — **but still SEK 0 on the event settlement screen** (below). Precondition: the operator must have run the event settlement; before that the agent's list is empty although the commission row already exists. |
| Every non-operator party can read the operator's task budgets | **FIXED.** `budgetType`/`budgetAmount` are `null` for performerA, performerB, agent and teamAndCrew and `production` / `1200000` for the operator and the co-host. Non-vacuous: the row really does carry SEK 12,000. |
| The co-promoter's Deals tab says the show has no deal | **FIXED.** It now says *"Not your deal to see — This event has a deal, and you are not a party to it. Ask the host to add you to it if you need its terms."* |
| Two operators shown two different unqualified totals | **FIXED.** The co-host's tile reads **TOTAL COSTS (PARTIAL)** and profit/margin are withheld with a reason. (The break-even chart underneath is not — see the MINOR.) |
| The budget scope chooser is not in the URL | **FIXED.** `?tab=budget&budgetScope=mine`, survives reload. |
| A deal confirmation leaves the sentence next to it false | **FIXED** (see Realtime). |
| An accepted invitation does not clear "Invite pending" | **FIXED** (see Realtime). |
| Confirming a hold runs no cascade | **STILL TRUE, and decisions.md already owns it** as an open product call (*"Two ways to reach `confirmed` … `PATCH /events/:id` sets the status with no pool cascade and no notification, where `/hold/confirm` runs the whole queue"*). Measured: setting the 1st hold to Confirmed from the inline Status field left the competing 2nd hold `on_hold`, untouched and unnotified. Worth knowing that the **operator has no other route** — `confirmDate()` → `POST /hold/confirm` is gated on `canDecide`, which is the act's, so the cascading door is not reachable from an operator's screen at all. |

### Everything else that was driven and behaved

- **Smoke, all six accounts, every sidebar destination.** No blank screens, no stubs presented as
  real, no 5xx anywhere in the run (`grep '"statusCode":5' /tmp/qa-stack.log` → 0). Nav sets differ
  correctly by kind, and three kind-gated routes explain themselves rather than erroring —
  `/reports`: *"The filing belongs to the operator"*, `/projections`: *"Projections belong to the
  venue's books"*, `/setlists` for crew: *"A setlist belongs to the act"*.
- **Event creation.** Both wizard steps, venue autocomplete, room select with capacities, venue
  carry-over ("copied once, and yours to edit"), capacity inherited from the picked room (400), the
  deal composed on step 2, Back preserving step 1's state.
- **Double-booking warning in the wizard.** *"Main Room already has 'Marlo Vance — Album Release' and
  1 more on this night. You can book it anyway."* — warns, never blocks, exactly as documented.
- **Ticket tiers.** Add, name, price, max, est. sales, remove — all persist to `events.extras` and
  survive reload; the over-capacity warning fires (*"Total ticket inventory exceeds venue capacity
  (400)"*); tiers seed the planner and reach `settlement_lines` at the right magnitude.
- **Calendar.** Month navigation, `?date=` from a link elsewhere, venue filter, room filter (enabled
  only once a venue is picked — correct), tasks on the grid, mark-unavailable and unmark round-trips
  to `profile_unavailability` **scoped to the filtered room** (`stage_id = Back Room`), ICS export
  produces a real `VCALENDAR` and says *"Nothing to export — September 2026 is empty"* when there is
  nothing.
- **Tasks.** Create with a due date → row in Postgres → appears on the calendar grid on that day.
- **Notifications.** Six arrived over the run with correct copy, and clicking one navigated to the
  right screen (`/requests`).
- **Collaborators.** Invite → the invitation landing page renders the inviter, event, role and
  recipient → **Accept** → *"You are in … The Lantern Hall (operator) has been told you accepted"* →
  the participant row appears on the host's list. Edit and Remove are both offered with honest
  descriptions; raising a co-operator to Full control is refused by the entitlement layer with the
  Pro paywall.
- **Co-host boundaries.** Deleting someone else's show: **403** with a useful message. Re-dating it:
  a **pending `event_change_requests` row** and the banner *"A change to this booking is waiting on
  an answer … Waiting on 3 people to answer. Nothing moves until everyone agrees."* Private books
  stay private both ways — each operator's `GET /events/:id/budgets` returns the shared ledger plus
  **their own** private book and never the other's.
- **A co-host's cost goes in the shared ledger.** Typed as Northlight, stored with
  `paid_by = Northlight` on the `shared` budget (the settlement then ignores it — separate MAJOR).
- **Public surfaces.** The venue profile page renders the room, capacity, curfew, sound system and
  travel notes, and correctly withholds the private load-in note behind *"House tech spec, patch list
  and load-in notes are shared with signed-in artists and crew — never on the open web."* The public
  event page renders and offers RSVP. `GET /public/events/:id` 404s for an unpublished event.
- **Share viewer.** `/shares/<token>` with `event.view` shows the show and no money.
- **Contacts.** CSV export produces a correct header row and all six contacts with IBAN/VAT.
- **Mobile, ~390 px, looked at rather than measured.** Dashboard, Events, Requests, Calendar,
  Settlements, Tasks, Contacts, Settings, Projections, Invoices, Team, Profiles: **zero**
  non-scrollable overhangs. The event tab strip overhangs and is `overflow-x: auto`, which is the
  intended behaviour. Modals were opened and *looked at*, not just measured: **Place a Hold** and
  **Check & Share Availability** both fit inside 380 px with their two selects side by side, and the
  public shared-availability page renders cleanly at 390 with its date chips in two columns. The
  mobile nav drawer sits at `left: -300` but carries `visibility: hidden`, so it is out of the tab
  order.

---

## Not reached, and why

- **Google OAuth callback** (`/oauth/google/callback`) and calendar **Import** — the stack starts
  with *"unconfigured: Google Calendar integration, Google Calendar push notifications"*, so there is
  nothing to drive.
- **Email delivery** — *"unconfigured: Email delivery, Email links"*. Invitations were accepted from
  the token URL read out of Postgres, not from an inbox. The `emailed: []` on share creation is the
  same gap.
- **File upload** — *"unconfigured: File storage"*. Posters, riders and documents were seen as
  empty states and their upload buttons were not exercised.
- **Scheduled jobs** — expired offers, venue handoffs, due representation terminations, FX refresh.
  Nothing time-based was aged and `pnpm jobs:run` was not run, so `expired` requests, auto-promotion
  on expiry and the handoff flow are unverified this pass.
- **Audience import/export** — the screen is empty on every account (no RSVPs seeded) so the
  importer had nothing to round-trip. Contacts CSV export was exercised; **Import CSV** was not.
- **Setlist authoring and the Setlist Report** — the screens were opened on performerA (4 songs on
  the Album Release) and the report screen exists, but no setlist was written or filed.
- **Messages** — the tab renders on every account; a message was not posted this run. Run 3 verified
  delivery between two live browsers and I did not re-drive it.
- **Deal ladders / bonus bands** (decisions #25.5) — not built yet, so not tested.
- **Finalize → paid, send-for-review and the `full_access` grant** — run 3 covered these in depth;
  this pass stopped at `open` settlements and did not re-drive the whole lifecycle.
- **Week and Day calendar views** — Month only.
- **Second reseed.** Everything below "Findings" was measured on a single seed that my own probes
  mutated as the run went on. Where a figure is quoted, the SQL that produced it is quoted beside it.

---

## Probes that lied, and what the re-run showed

1. **"Ticket tier numbers do not save."** Setting price / max / est. with synthetic `input` events
   and calling `blur()` left `{"price":0,"max":0,"est":0}` in `events.extras`. Re-driven with a real
   click and a real **Tab**, all three persisted (`{"est":300,"max":400,"price":250}`). The save is
   on a genuine blur; my first probe never produced one. The **separate** defect it was masking —
   click-then-type giving `500` for `50` — is real and reproduced with real keystrokes twice.

2. **"Export ICS blanks the app."** Clicking it in Playwright left the page at `about:blank` and the
   MCP call errored. Re-driven in the second browser: the download fires correctly
   (`showme-calendar-2026-10-01-to-2026-10-31.ics`, a valid `VCALENDAR`) and the page never moves.
   `downloadIcsFile` is the ordinary object-URL + anchor pattern. Playwright's download interception,
   not the app.

3. **"The operators' cost split writes 100 % / 100 %."** Two `fill_form` edits in one call left
   1 % / 1 %… then 100 % / 100 %, and it survived a reload. One-at-a-time edits gave 70/30 every
   time. Filed as **UNCONFIRMED** and not upgraded. The neighbouring defect it led me to — an empty
   box writing 1 % — is reproducible and is filed on its own.

4. **"`placeOfRequest` refuses everything."** All four `POST /offers` probes came back 400
   *"Select a profile to send the offer from"* — the acting-profile header, not the rule. Re-run with
   `actingProfileId` and each refusal named its own reason. Exactly the trap `api-as.mjs`'s own
   docblock warns about.

5. **"`POST /booking-requests` is 403 for everyone."** *"Origin not allowed"* — the public form route
   is CORS-gated and `api-as.mjs` sends no `Origin`. Re-run with `curl -H 'Origin:
   http://localhost:5173'` and all three guards answered properly.

6. **"The API's `/health` is behind auth."** `GET /health` → 401, 1,428 times in the log. The API's
   own probe is `/api/v1/health`, which answers `{"status":"ok"}` 200; the bare path has no route and
   the auth preHandler answers before the 404. Something outside the stack is polling it. Environment
   noise, not a defect — and the reason the "no 5xx in the whole run" count is trustworthy while the
   401 count is not.

7. **A vacuous pass I checked rather than accepted.** Crew reading `budgetAmount: null` proves
   nothing unless the row has a budget. `tasks.budget_amount = 1200000` on that row, and the operator
   sees it. Same for the task-budget check on all five other accounts.

---

## State of the seed after this run — do not quote figures off it

`pnpm dev` was **not** restarted mid-run, so the database below is the seed plus everything this
sweep did. Reseed before quoting any number from it.

- **New events:** `QA Regression Act` (2026-11-20, Main Room, confirmed, deal confirmed, settlement
  run), `Frostwave` (2026-10-15, Main Room, draft), `Double Booked` (2026-10-14, Main Room, draft —
  a deliberate double-booking), `Hold Rank Probe` (2026-12-03, 2nd hold).
- **`Nordic Synth Showcase` is now `confirmed`** (it was `on_hold`), and its competing hold was left
  in place.
- **`Marlo Vance — Album Release`** has a run settlement (7 rows), an extra shared-ledger cost
  (`Northlight van hire`, SEK 10,000), `operatorCostSplit` 70/30, and a pending
  `event_change_requests` row proposing 2026-10-21. Its title was renamed by the co-host and
  **restored**.
- **New booking requests:** from `Ida Frost`, `Clash Tester`, `Marlo Vance` (2026-11-08, Back Room),
  plus three 400-ed probes that wrote nothing.
- **New shares:** three availability tokens on The Lantern Hall, one on Neon Tide, two event shares.
- The operator's display currency was set to EUR and **restored to SEK**.
