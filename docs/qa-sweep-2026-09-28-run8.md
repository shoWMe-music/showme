# QA sweep — run 8 (2026-09-28)

**Commit under test:** `060cce3` · branch `main`, clean working tree apart from this report and its
screenshots. The stack was booted from that commit with `pnpm dev` and **freshly seeded** (the
container is dropped and recreated on boot), so every figure below was measured against a seed this
run created. The API does not hot-reload; it was never restarted mid-run, and no application code was
edited, so `060cce3` is the whole story.

**Stack:** web `:5180`, API `:8080`, stream `:8081`, Firebase Auth emulator `:9099`, Postgres
`:55432` (`showme-e2e-postgres`).

**Screenshots:** `docs/screenshots/qa-2026-09-28-run8/`.

## 1. What was driven

The Playwright MCP server is not present in this session, so **every browser step used
chrome-devtools MCP**, with a separate `isolatedContext` per account — genuinely independent
profiles and IndexedDB, not tabs. Verified independent: signing `professional@` into one context
left the `operator@` and `co.host@` sessions untouched in theirs.

| Seat | Account | Context | Depth |
|---|---|---|---|
| 55 | `operator@` — The Lantern Hall | default | full |
| 56 | `performer.a@` — Marlo Vance | `perfA` | full |
| 57 | `co.host@` — Northlight Presents | `cohost` | event workspace, planner, settlement, projections |
| 58 | `professional@` — Priya Sound (crew) | `crew` | all 15 destinations + the whole settlement workspace; closed after |
| 59 | `agent@` — Astra Booking Agency | `agentseat` | see §5 |
| 60 | `performer.b@` — Neon Tide | `perfB` | see §5 |

API probes used `node .claude/skills/verify-e2e/api-as.mjs`. Every figure quoted was read back out
of Postgres with `docker exec -i showme-e2e-postgres psql -U postgres -d showme`.

---

## 2. Verification — run 7's eleven fixes

**All eleven hold.** One (QA7-15) is partly source-verified rather than driven; that is stated below.

| # | Run-7 finding | Verdict | Evidence |
|---|---|---|---|
| 1 | **QA7-9** split card's closing sentence | **HOLDS** | Reopened deal `…d1` (3 parties), signed exactly one as `agent`. Planner reads *"100% of the door. **1 of 3 parties have signed, so they can still move.**"* with a `PROPOSED` badge. `deal_parties` at that moment: Marlo Vance `2026-09-28 11:33:42+00`, The Lantern Hall null, Neon Tide null. `qa8-v1-split-card-1-of-3-signed.png` |
| 2 | **QA7-10** advance on the party card | **HOLDS** | `advanceAmount: "500000"` set on `…d1`, all three parties signed, recomputed. Marlo's card: `SEK 30,000` over *"100% of the adjusted net SEK 50,000 — Marlo Vance's 60% of the deal's SEK 50,000 · SEK 30,000"* then, below a rule, *"**Paid in advance by The Lantern Hall** − SEK 3,000"*. Neon Tide's the same at −SEK 2,000. The operator's carries the mirror: *"**Paid in advance to Marlo Vance and Neon Tide** -SEK 5,000"* |
| 3 | **QA7-28** headline is the reader's net, labelled by sign | **HOLDS, both directions** | `operator@` on `/events/…e1?tab=settlement`: **`SEK 45,000` · "You owe"** (`qa8-v3-operator-you-owe-45000.png`). `performer.a@`, same route: **`SEK 27,000` · "Your payout"** over a card reading 30,000 less the 3,000 advance (`qa8-v3-performer-your-payout-27000.png`). Engine agrees: operator `net -4500000`, Marlo `net 2700000`, Neon `net 1800000`, **Σ = 0**. `/settlements` column header reads **YOUR SHARE** for `operator@` and for `performer.a@` |
| 4 | **QA7-13** a draft is not money | **HOLDS** | Created `QA8 Draft Vendor` SEK 7,777 `received/draft`, then set `due_date = 2026-01-15` (**past**) and reloaded. Tiles unmoved: `OUTSTANDING (PAYABLE) SEK 9,000`, **`OVERDUE SEK 9,000`**, `RECEIVABLE (SENT) SEK 50,000`. Also created `QA8 Draft Customer` SEK 4,321 `issued/draft` — RECEIVABLE stayed 50,000. Both rows still render, badged **Draft** with an **Issue** button |
| 5 | **QA7-19** a zero has units | **HOLDS** | `performer.a@` `/invoices`: `OUTSTANDING (PAYABLE) SEK 0` · `OVERDUE SEK 0` · `RECEIVABLE (SENT) SEK 0`. `professional@` the same |
| 6 | **QA7-14** the issued tab's first column | **HOLDS** | Sent tab header **"Bill to"**; Received tab header **"Vendor"**. Read off the rendered header cells, both tabs, same page load |
| 7 | **QA7-8** no page overflow at 390px | **HOLDS** | iframe at 390px (`innerWidth 386`), settlement workspace → **Settlement** tab: **`scrollWidth 376` vs `clientWidth 376`**. The party chooser now measures `width 298 · height 69` (two rows) with `flex-wrap: wrap`, right edge 337. At 1280px the chips still sit beside the title: title top 628 / chip top 628, chip left 1069 > title right 777 |
| 8 | **QA7-12** the room that is not a room | **HOLDS, all three states** | Create New Event, The Lantern Hall, **2026-10-15**. "No specific room" → *"Already on this night: "Marlo Vance — Album Release" in Main Room."* and **no** "still free". Main Room → *"Main Room already has "Marlo Vance — Album Release" on this night. You can book it anyway."* Back Room → *"… This room is still free."* |
| 9 | **QA7-16** the projections footnote | **HOLDS** | `co.host@` `/projections`: the all-time line is **absent entirely**. `operator@`: *"All time, **as host** — ignoring the filter above: budgeted revenue **SEK 216,000** across 5 events you hosted."*, agreeing with the panel's `PROJECTED REVENUE SEK 216,000` |
| 10 | **QA7-15** the team invite dialog | **HOLDS** (edit dialog source-verified) | ROLE pre-fills **Viewer** with *"Reads the account's events and their details. Changes nothing."* Options in order **Viewer, Crew, Editor, Admin**. Choosing Editor prints *"… **This role uses one of the account's seats.**"* **before** submit. Submitting Editor is refused with *"**Editor and Admin each consume one of the account's seats. Viewer and Crew are included on every plan — pick one of those, or upgrade this account's plan.**"* `qa8-team-invite-default-role.png` |
| 11 | *(QA7-15, second half)* | **HOLDS by construction, not driven** | The member-edit dialog could not be opened on an account-role member: the only such member on the seed is the owner, and every other row is `Group only` (*"They are only on a group roster, so there is no account role to change."*). Both dialogs read the one catalogue in `apps/web/src/hooks/useTeamAccess.ts:125`, and the old sentence claiming Editor is free appears nowhere in `apps/web/src` outside a comment describing the bug |

### Nearby, checked for regression (not on the list, but adjacent to the fixes)

- **QA7-3's fix holds and is clean.** `?budgetScope=mine` on the Album Release now reads
  `TOTAL REVENUE SEK 0 · TICKET REVENUE SEK 0 · TOTAL COSTS SEK 0 · PROFIT / LOSS SEK 0` and
  *"0 tickets planned across all types"* — the borrowed shared-book figures are gone. (One residue
  survives: **QA8-2** below.)
- **QA7-4's fix fires on a real request.** An offer sent in-app by `performer.a@` for **2026-10-15**
  reaches the operator's inbox carrying *"Already on this night: "Marlo Vance — Album Release" in
  Main Room."* — the true sentence for a request that names no room. `booking_requests.venue_profile_id`
  is now populated by the in-app sender.
- **QA7-5's fix is built and works.** `/requests` offers **Send an offer** to a signed-in act; the
  offer lands in the venue's Incoming tab as `source = performer_offer`, `sender_profile_id` set.
  (It also reaches a seat it arguably should not — **QA8-4**.)

## 3. The twenty items from runs 5 and 6

Re-checked at the cheap depth the brief allows. **Every one that was driven holds.** Five were not
re-driven and are named as such rather than implied.

| # | Item | Verdict | How |
|---|---|---|---|
| 1 | QA6-17 invoice currency guard | **HOLDS** | Typing `XYZ` disabled **Create invoice** and printed *"XYZ isn't a currency we know."* |
| 2 | QA6-2 date move rings the whole bill | not re-driven | needs a full multi-party date move; run 7 drove it |
| 3 | QA6-1 co-host on Standard access signs a rental | not re-driven | needs a fresh rental deal; run 7 drove it |
| 4 | QA6-7 co-host is `accepted` at once | **HOLDS** | `POST /events/…e3/participants {role:"co_host"}` → **201** `"status":"accepted"` |
| 5 | QA6-3 confirmed change clears the crew banner live | not re-driven | two-seat realtime; run 7 drove it |
| 6 | QA6-8 participant writes answer with a name | **HOLDS** | the same 201 carries `name: "Northlight Presents"`, `publicSlug`, `genres`, `avatarUrl` |
| 7 | QA6-18 social platforms render | not re-driven | marketing surface; see §6 |
| 8 | QA6-10 cancelled badge | **HOLDS** | `/events` — red **Cancelled** on Winter Gala, nothing on the other four |
| 9 | QA6-11 private ledger ticket count | **HOLDS** | *"0 tickets planned across all types"* against `SEK 0` |
| 10 | QA6-15 recipient chooser | not re-driven | share dialog; run 7 drove it |
| 11 | QA6-13 cost-split-only PATCH | **HOLDS** | `PATCH /events/…e1/budgets/…f11 {planningAssumptions:{operatorCostSplit:{…}}}` → **200** |
| 12 | QA6-9 / QA6-12 pronouns on somebody else's card | **HOLDS** | the operator's card reads *"Plus the money **you** collected"*; Marlo's reads *"Paid in advance by **The Lantern Hall**"*, never "you" |
| 13 | QA5-7 No break-even | not re-driven | no seeded event now reaches the never-breaks-even shape |
| 14 | QA5-9 `?tab=` | **HOLDS** | four tab clicks wrote `?tab=deals/messages/collaborators/todo`; `history.length` stayed **13** throughout |
| 15 | QA5-6 idle sign-out note | not re-driven | needs a 15-minute idle window |
| 16 | QA5-10 audience boundary | **HOLDS** | `professional@` `/audience` → *"An audience belongs to the room and to the act …"* |
| 17 | QA5-8 finalized settlement | **HOLDS** | Spring Warmup Financials contains no *"Start from the Budget Planner"* |
| 18 | QA5-12 schedule starting point | not re-driven | |
| 19 | QA5-13 unsaved ticket-tier hint | not re-driven | |
| 20 | QA5-14 settlements wording | **HOLDS** | `/settlements` header **YOUR SHARE** plus *"These count the same money four ways rather than splitting it…"*; `/` shows *"Not built yet"* under **Top venues by revenue** for all four kinds checked |
