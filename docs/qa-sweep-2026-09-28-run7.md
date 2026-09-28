# QA sweep — run 7 (2026-09-28)

**Commit under test:** `fbfdc92` · branch `main` (clean apart from this report and its screenshots).
**Stack:** the `pnpm dev` stack left running and freshly seeded — web `:5180`, API `:8080`, stream `:8081`,
marketing `:5173`, auth emulator `:9099`, Postgres `:55432`.
**Screenshots:** `docs/screenshots/qa-2026-09-28-run7/`.

## 1. What was driven

**Six genuinely independent browser seats**, not tabs. The Playwright MCP server is down, so every browser
step used **chrome-devtools MCP**; separate seats were obtained with `new_page`'s `isolatedContext`, which
gives each account its own profile and its own IndexedDB. Verified working: signing `professional@` into
one context did not disturb the `operator@` session in another, and both reacted to live SSE independently.

| Seat | Account | Context |
|---|---|---|
| 46 | `operator@` — The Lantern Hall | default |
| 47 | `professional@` — Priya Sound (crew) | `crewseat` |
| 49 | `performer.a@` — Marlo Vance | `perfA` |
| 50 | `co.host@` — Northlight Presents | `idletest` (also used for `performer.b@` in the idle-logout probe) |
| 51 | `agent@` — Astra Booking Agency | `agentseat` |
| 48 | — | marketing site, unauthenticated |

API probes used `node .claude/skills/verify-e2e/api-as.mjs`; every figure quoted was read back out of
Postgres through `docker exec -i showme-e2e-postgres psql`.


## 2. The twenty items from runs 5 and 6 — all twenty hold

Every one was re-driven on the running stack. **20/20 hold.** Detail where the evidence is
non-obvious; the rest were exactly as specified.

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | QA6-17 invoice currency | **HOLDS** | CURRENCY pre-filled `SEK`; typing `XYZ` disabled **Create invoice** and printed *"XYZ isn't a currency we know."*; the created bill is `currency=SEK, total=123400` in `invoices` |
| 2 | QA6-2 date move rings the whole bill | **HOLDS** | Exactly four `event.updated` rows (`e2e-co-host`, `e2e-performer-a`, `e2e-performer-b`, `e2e-professional`), the proposer's `event.change_confirmed`, and **none** for `e2e-agent`, who confirmed last |
| 3 | QA6-1 co-host on Standard access signs a rental | **HOLDS** | `POST /deals/68296009…/confirm` as `coHost` → **200**; `deal_parties.confirmed_at` set for both; `POST /events/…/settlement/compute` → **200** (was 409) |
| 4 | QA6-7 co-host is `accepted` at once | **HOLDS** | `POST /participants {role:"co_host"}` → `"status":"accepted"`, and `GET /events/:id` as `coHost` → 200 immediately. `performer` and `crew` still answer `"invited"` |
| 5 | QA6-3 confirmed change clears the crew banner live | **HOLDS** | Two independent browsers. Crew seat held the banner *"Date 22 Oct 2026 → 29 Oct 2026 · Waiting on 3 people"*; three API confirms later, **without a reload**, the banner was gone and the header read `29 Oct 2026`; bell 2 → 3 |
| 6 | QA6-8 participant writes answer with a name | **HOLDS** | POST and PATCH both return `name`/`publicSlug`/`genres`/`avatarUrl`; checked against a profile that has all four (Marlo Vance) and ones that legitimately have none |
| 7 | QA6-18 social platforms render | **HOLDS** | The three platform selects read `["Spotify","Bandcamp","Instagram"]`; `localhost:5173/profile/e2e-marlo-vance` prints the same three capitalised |
| 8 | QA6-10 cancelled badge | **HOLDS** | Red **Cancelled** pill on the Winter Gala row — `events-list-operator.png`. (Deliberately the only badged state; `Events.tsx` says why.) |
| 9 | QA6-11 private ledger ticket count | **HOLDS** | `?budgetScope=mine` read *"0 tickets planned across all types"* against `SEK 0`. (But see **QA7-3** — the same card has a different defect.) |
| 10 | QA6-15 recipient chooser | **HOLDS** | *One by one* offers `["Northlight Presents (Co-operator)","Neon Tide","Priya Sound","Astra Booking Agency","Marlo Vance"]` — the reader (The Lantern Hall) absent, the co-operator present |
| 11 | QA6-13 cost-split-only PATCH | **HOLDS** | `PATCH /events/:id/budgets/:bid {planningAssumptions:{operatorCostSplit:{…}}}` → **200** |
| 12 | QA6-9 / QA6-12 on the performer's screen | **HOLDS** | Full access granted to Marlo on a settlement with a SEK 5,000 off-the-top rental. Performer's Settlement tab: *"Plus the money **The Lantern Hall** collected on the night"*. Overview: *"Rental of SEK 5,000, settled off the top — **and 2 more, itemised on the Settlement tab**"* |
| 13 | QA5-7 No break-even | **HOLDS** | KPI reads **No break-even** beside the chart caption *"Revenue never passes total cost inside 400 capacity."* |
| 14 | QA5-9 `?tab=` | **HOLDS** | Four tab clicks wrote `?tab=deals/messages/collaborators/todo`; `history.length` stayed **11** throughout; reload kept To Do selected; Back left the event to `/events` |
| 15 | QA5-6 idle sign-out note | **HOLDS** | *"You were signed out after 15 minutes without activity…"* on the first load, absent on the second |
| 16 | QA5-10 audience boundary | **HOLDS** | Both `professional@` and `agent@` get *"An audience belongs to the room and to the act …"*, not the CRM |
| 17 | QA5-8 finalized settlement | **HOLDS** | Financials tab on the finalized Spring Warmup contains no *"Start from the Budget Planner"* |
| 18 | QA5-12 schedule starting point | **HOLDS** | Second load raised *"This schedule already has items … Cancel / Add to them / Replace them"*; **Replace** left `select count(*) from schedule_items` = **10** |
| 19 | QA5-13 unsaved ticket-tier hint | **HOLDS** | *"unsaved — click outside the field to save"* beside `50 max · 40 est.` while focused, gone on blur, and `events.extras.ticketTiers` then holds the row |
| 20 | QA5-14 settlements wording | **HOLDS** | `/settlements` column header **YOUR SHARE** plus *"These count the same money four ways rather than splitting it…"*; `/` shows *"Not built yet"* under **Top venues by revenue** |

