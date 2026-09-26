# QA sweep — 2026-09-26, run 3

**Commit under test:** `e69a85a` on `main` (clean tree apart from run-2 screenshots).
**Stack:** local `pnpm dev` — web 127.0.0.1:5180, API :8080, SSE :8081, Auth emulator :9099,
Postgres :55432. Booted fresh (container dropped and recreated) at 18:28 local; **every figure
quoted below was produced against that seed unless it says otherwise.**

## The two seats, and why it matters which one saw a thing

Run 2 could not fail on "the other person's screen never updated" because it only ever had one
browser. This run had two genuinely independent browsers:

- **Seat 1 — Playwright MCP.** Signed in as **`coHost` / Northlight Presents** for the whole run
  (this is the first sweep in which that account has been in a browser at all).
- **Seat 2 — a second Chromium with its own profile and its own IndexedDB**, driven over CDP from
  `/tmp/seat2/*.mjs`, signed in as **`operator` / The Lantern Hall** (the host).
  *The role file names Chrome DevTools MCP for this. **That MCP server is not actually available in
  this session** — `.mcp.json` has `"mcpServers": {}` and `mcp__chrome-devtools__new_page` answers
  `No such tool available`. So seat 2 is a plain Playwright `launchPersistentContext` with
  `--remote-debugging-port=9333`, re-attached per step with `connectOverCDP`. Same property that
  mattered: separate profile, separate IndexedDB, neither seat logs the other out. Verified — both
  sidebars named different accounts simultaneously.*

Every finding below says which seat produced it. Where one seat plus `api-as.mjs` was enough
(a rule, not a delivery), it says that too.

## Summary — counts and the three that matter

**New this run:** **2 BLOCKER**, **12 MAJOR**, **10 MINOR**, **1 NOTE**.
**Run-2 findings re-checked:** 5 MAJORs **still reproduce** unchanged, 1 MAJOR **corrected down to MINOR**
(the inline Status field does save, behind a Save button run 2 did not press).

**The three that matter:**

1. **The co-promoter's Budget Planner says the night makes SEK 40,255 while the host's says it loses
   SEK 1,245** — same event, same shared ledger, two browsers, one minute apart. `GET /events/:id/deals`
   returns `[]` to a co-host, so their planner is the shared ledger minus every entitlement. This is the
   shared-versus-private ledger fault the `coHost` seat was added to find, and it is a working screen with
   a 48.5 % profit margin printed on it.
2. **The tier fix survived three of six attacks and lost three.** Renaming a tier now **doubles** it into
   the settlement (SEK 6,300 → SEK 7,800); a tier **cannot be removed** from the planner at all; and a
   hand-written door row leaves planner and settlement **SEK 32,000 apart**. The run-2 blocker is fixed —
   the new rule's name-matching is the new seam.
3. **`full_access` works, and every re-send silently revokes it.** Verified to the letter of #24.2 on five
   points (stored grant, per party, not `budget.view`, default off, audited both sides) — then the
   send-for-review dialog, whose toggle always reopens **off** even for a party who has the grant, sends an
   explicit `fullAccess: false` and closes the books. `SendForReviewDialog.tsx:40`.

Also new and not in the three only because they are narrower: a **JPY** event settles on screen at **1 %**
of its takings (`format.ts:11` divides by 100 for every currency), and **ticket tiers cannot be typed on
Event Details in the natural order** — naming a new row first removes its own price field from the page.

## What was driven

| Account | Seat | Reached |
|---|---|---|
| `coHost` (Northlight Presents) | **Seat 1, browser, whole run** | Dashboard, Events, event workspace on E1 (every tab) and E4, Budget Planner in **both scopes**, Settlement workspace (all tabs), invitation landing, Deals, Messages, Collaborators, Event History |
| `operator` (The Lantern Hall) | **Seat 2, browser, whole run** | Event workspace E1/E3/E4, Budget Planner, Settlement workspace incl. send-for-review and finalize, Collaborators + invite dialog |
| `performerA`, `performerB`, `agent`, `teamAndCrew` | API (`api-as.mjs`) | settlement reach, budget refusal, task disclosure |

Areas: **4b co-promotion (browser, both seats)**, **the `e69a85a` tier fix (browser, adversarial)**,
**settlement finalize / send-for-review / `full_access` (#24.2)**, plus the run-2 MAJORs asked for.

---

# Findings

## Area 4b — co-promotion, the co-host's own seat

### [BLOCKER] 4b — the co-promoter cannot be sent the settlement they are a party to, and is never asked to sign it
**As:** `operator` (host) sending; `coHost` receiving — **both seats, browser**
**Steps:**
1. E1 `Marlo Vance — Album Release` has `Northlight Presents` as a confirmed `co_host` with the
   **`Operator — full`** permission set (`settlement.view.own`, `settlement.edit`, `settlement.finalize`).
2. As `coHost`, Budget Planner → shared ledger → add a cost `Northlight van hire` SEK 5,000, carried by Northlight.
3. As `coHost`, Settlement → **Run the settlement**. The engine gives Northlight `net = +5,000` (it fronted cash).
4. As `operator`, Settlement → **Send for review** → **One by one** → open the recipient chooser.
**Expected:** every party with a settlement row on the event can be sent it — above all the co-operator
that is owed money. decisions.md #24.2 makes the send the *only* way to open a settlement to a party.
**Actual:** the recipient list holds **`Marlo Vance (Performer)`, `Neon Tide (Performer)`, `The Lantern Hall
(Operator)` — the sender itself — and nothing else.** No `Northlight Presents`, no crew, no agent.
The approval roster reads `0/3` and never names the co-host. On `Nordic Synth Showcase` (E4, where the
co-operator was invited through the UI) the same chooser offers **one** recipient: `The Lantern Hall`,
i.e. the sender may only send the settlement to themselves.
**Evidence:**
```
$ node .claude/skills/verify-e2e/api-as.mjs coHost  GET /events/…e1/settlements → 1 row  (net = 500000)
$ node .claude/skills/verify-e2e/api-as.mjs operator GET /events/…e1/settlements → 3 rows
```
`docs/screenshots/qa-2026-09-26-run3/cohost-settlement-one-party-of-three.png`
**Scope:** both co-promoted events, both permission levels, after a reseed of the probe state. It is the
delivery step that is missing, not the engine — the engine is right (see the PASS below).

### [MAJOR] 4b — two operators on one night are shown two different, unqualified totals for the same reconciliation
**As:** `coHost` and `operator` side by side, **both browser seats, same minute**
**Steps:** run the settlement on E1, then read the Settlement tab in each seat.
**Expected:** PLAN.md:215 — "Co-promoters share **one** budget (full transparency)"; decisions.md's resolved
co-operator item — "co-operators see all deals assigned to the shared budget".
**Actual:** the co-host is shown the **whole** cost-and-revenue ledger and the whole waterfall
(Gross SEK 83,000 → Adjusted net SEK 41,500) and then **one** party row —
`Northlight Presents (you) · Co-operator · SEK 0`, `Approval Status 0/1`, and a card headed
*"Total Payouts — What is payable to you on this event"* reading **SEK 5,000 / Total payable SEK 5,000**.
The host's screen, same settlement, same moment: three party rows, `Approval Status 0/3`,
*"Total payable SEK 41,500."* Neither figure is captioned as partial.
**Evidence:** `cohost-settlement-one-party-of-three.png`; the api-as counts above.
**Note — this is deliberate in the code and still wrong on the screen.** `apps/api/src/routes/settlement.ts`
`partiesVisibleTo()` carries the comment *"NOT co-operators… the residual it is owed is half of a number it
cannot see the whole of."* The rule may be intended; **printing half a settlement under the word "Total" is
not.** And the concealment protects nothing here: the co-host already sees every revenue and cost line.
**Sharper still:** a performer granted `full_access` (below) sees **6** party rows on this event — *more of
the co-promotion than the co-promoter does.*

### [MAJOR] 4b — the co-promoter's Deals tab says the show has no deal, on a show with a confirmed one
**As:** `coHost`, seat 1, browser
**Steps:** E1 → Deals.
**Expected:** at minimum, not a false statement. The event carries `Album Release — Door Split`, `confirmed`,
three parties, 100 % of the adjusted net.
**Actual:** *"Deals you are a party to. Each party sees only its own line."* then **"No deal yet — Write the
terms down and send them to the other parties. Nothing settles until they confirm."** and a **New deal**
button. The caption and the empty state contradict each other; a co-promoter acting on the empty state
would write a second deal over a signed one.
**Evidence:** `docs/screenshots/qa-2026-09-26-run3/cohost-deals-no-deal-yet.png`
**Scope:** E1 only (the only event with both a deal and a co-host). A one-line fix lives in the empty state,
not the scoping: say *"No deal you are a party to"*, which is what the caption already claims.

### [MAJOR] 4b — every non-operator party on an event can read the operator's task budgets over the API
**As:** `teamAndCrew`, `performerA`, `performerB`, `agent` — API (`api-as.mjs`); **not visible on any screen**
**Steps:** `GET /tasks?eventId=e2e00000-0000-4000-8000-0000000000e1`
**Expected:** story.md — a performer "sees **only their own slice** — never the event budget/pool or other
parties' financials"; crew "see the schedule and their own deal, never the budget" (`CREW_FLOOR` is
`event.view, schedule.view, deal.view.own, settlement.view.own`).
**Actual:** **200** for all four, each returning
`"title": "Confirm PA hire for the Album Release", "budgetType": "production", "budgetAmount": "1200000"`
— SEK 12,000 of the event's production budget, to the crew member, both performers and the agent.
**Evidence:** the four calls above; `psql … select budget_type, budget_amount from tasks` confirms the column.
**Scope:** every kind on the event; the seeded task is the only one carrying money, so one row proves it.
**Honest limit:** `grep -rn budgetAmount apps/web/src` returns **nothing** — no screen renders it today, so
this is an API/serializer disclosure, not something a user sees. It reaches anyone using the API directly,
which is the agent-native surface this codebase is deliberately building toward.

### [MAJOR] 4b — a view-only co-operator is given the Deals and Settlement tabs, and both render a blank page
**As:** `coHost` on E4 after accepting the **UI's own** invitation at *"Standard for the role"*
**Steps:** accept the invite → E4 workspace → Deals → Settlement.
**Expected:** a tab a kind cannot use is either absent or says why.
**Actual:** both tabs render **nothing at all below the tab strip** — not an empty state, not a refusal.
`GET /events/…/deals`, `/settlements` and `/settlement/comments` each answer **403** and TanStack
**retries each four times**: 20 failed requests and 20 console errors on one workspace visit.
**Evidence:** `docs/screenshots/qa-2026-09-26-run3/cooperator-settlement-tab-blank.png`; console transcript
in the report's console section.
**Scope:** reproduces on every tab whose query is refused; `Event Schedule` degrades better — it prints
*"Couldn't load the schedule."*

### [MINOR] 4b — the invite dialog promises a co-operator their schedule and their own money, and grants neither
**As:** `operator` inviting, `coHost` accepting — both seats
**Steps:** Collaborators → Invite → role **Co-operator**, access **Standard for the role**.
**Expected:** the dialog's own words: *"What the role guarantees and nothing more: the event, their schedule,
and their own money. Never anyone else's deal, never the budget."*
**Actual:** the invitation stores `permission_set_id = NULL`, so the capability set is
`baselineCapabilities("co_host")` = **`["event.view"]`** alone. Measured after acceptance:
`GET /events/…e4/schedule` → **403**; `/settlements` → **403 "Missing capability: settlement.view.own"**;
`/budgets` → **403 "Missing capability: budget.view"** (that last one is correct and matches the copy).
So two of the three things the sentence promises are refused.
**Scope:** the default path — this is what every co-operator invited through the product gets.

### [MINOR] 4b — the co-host cannot read the venue's rooms, and the event prints "Room / Stage: Assigned"
**As:** `coHost`, seat 1 vs `operator`, seat 2, same field, same event
**Actual:** co-host sees `Room / Stage — Assigned`; host sees `Room / Stage — Main Room`.
`GET /profiles/<venue>/stages` answers **404 `{"code":"not_found","message":"Profile not found"}`** to the
co-host and **200** with `Main Room` / `Back Room` to the host — a masking 404 for a venue whose name and
street address are printed two lines above on the co-host's own screen. The client retries it four times.
**Scope:** E1; both browser seats compared directly.

### [MINOR] 4b — the budget scope chooser does not survive a reload and is not in the URL
Switching to **My budget** and reloading returns to **Shared ledger**; there is no `?scope=`. On a screen
where the two books must never be confused, the one that opens is always the shared one — which is the safe
default, so this is noted rather than pressed.

### [MINOR] 4b — naming a fresh cost row before typing its amount throws the row out of the table
**Steps:** Budget Planner → *Add cost field* → **Other cost** → type a name into the row's name field.
**Actual:** the row vanishes from the cost table and reappears as a chip under *"Not budgeted"* **under its
new name**, mid-edit. Typing the amount first, then the name, keeps it. Reproduced twice, both scopes.

## What PASSED in area 4b, and it is the larger half

- **The two books are genuinely two books.** Clicking *My budget* as `coHost` created
  `budgets(scope='private', owner_profile_id=<Northlight>)`; the line typed there
  (`Northlight private margin note`, SEK 7,777) landed in it and **nowhere else**. The host's
  `GET …/budgets` returns its own shared + its own private book and **not** the co-host's; a direct
  `PATCH` at the co-host's private budget id answers **404 "Budget not found"**. The settlement's
  deduction list on E1 holds all six shared costs and **no trace of the private 7,777**.
- **`operatorCostSplit` is correct, and this is the first run that could prove it non-vacuously.**
  On E1 the split is a no-op because the door deal takes 100 % of the adjusted net, so the residual is
  0 — a vacuous pass. Driven again on E4 with no deals at all: revenue 55,000 − costs 24,500 =
  **adjusted net 30,500**, split **70/30**, and the engine produced
  `Lantern entitlement 21,350 (= 0.70 × 30,500), net −9,150` / `Northlight entitlement 9,150, net +9,150`,
  **Σ net = 0**, with one transfer row `Lantern → Northlight 9,150`. Checked by hand.
- **The over-100 % split is caught and explained**, not silently accepted: 70 + 50 prints
  *"These add up to 120%, not 100. The shares still divide the remainder in that ratio, so the settlement
  balances — but it is probably not what you meant."* Stored as entered. That is the right call.
- **A co-host cannot wave their own date change through.** `PATCH /events/:id {"eventDate":…}` as `coHost`
  correctly became a **proposal**, not a change: the host's banner offered **Decline / Confirm**, the
  co-host's said *"Waiting on 3 people to answer"* with no buttons. The exclusion is by **user**, not by
  acting profile (`counterparts()`), and 3 is right: host + Neon Tide + the agent, with Marlo delegated out.
- **Per-row budget writes survive a concurrent editor.** With the co-host's planner deliberately stale
  (it had never seen the host's new `Lantern extra rigging`), editing `Sound & production` from the stale
  page wrote only that row; the host's row was untouched. No last-write-wins wipe.
- **E1's settlement arithmetic, checked by hand on four rows.** Gross 83,000 = 65,000 + 18,000;
  deductions 41,500 = 12,500 + 9,000 + 8,500 + 3,500 + 5,000 + 3,000; Marlo 60 % = 24,900; Neon 40 % =
  16,600; Lantern net −46,500 (= 0 − (83,000 − 36,500)); Northlight +5,000; **Σ net = 0** exactly.
- **The poster respects the host.** *"Only the profile operating this show can change its poster"* with a
  genuinely disabled control, on both co-promoted events.
- **Curation (#24.3) opens closed.** The co-host's curation panel starts at
  *"Nothing yet — this party sees no figures at all"* for every collaborator. Right polarity.

---

## Settlement delivery — `full_access` (decisions #24.2), verified for the first time

### [MAJOR] Every re-send silently revokes the full-access grant, and the toggle shows the opposite of the truth
**As:** `operator`, seat 2, browser
**Steps:**
1. E1 → Settlement → **Send for review** → **One by one** → recipient `Marlo Vance` → toggle
   **Full settlement access** on → **Send for review**.
2. Confirm it worked (it does — see the PASS below).
3. Reload, open **Send for review** again for the same recipient. Read the toggle. Press **Send for review**
   again, as anyone chasing an unanswered settlement would.
**Expected:** decisions.md **#24.2**, verbatim: *"**A re-send without the flag does not revoke it.** Silence
about access is silence, not withdrawal; withdrawing is an explicit `fullAccess: false`."*
**Actual:**
- On reopening, the toggle reads **off** for a party whose `settlements.full_access` is **`true`**. The one
  surface that displays the grant states its opposite.
- The second send **revoked** it. `full_access` went `t → f`; the audit row is
  `{"after":{"status":"pending_review","fullAccess":false},"before":{"status":"pending_review","fullAccess":true}}`.
  `performerA`'s settlement reach dropped from **6 rows back to 1** on the same API call.
**Evidence:**
```
after grant : psql → Marlo Vance | pending_review | t   ; api-as performerA GET …/settlements → 6 rows
after resend: psql → Marlo Vance | pending_review | f   ; api-as performerA GET …/settlements → 1 row
```
**Where it is:** `apps/web/src/components/SendForReviewDialog.tsx:40` — `useState(false)`, never seeded from
the recipient's stored grant, and line 47 always passes the boolean, so the API always receives an explicit
`false`. **The API is obeying #24.2 correctly; the dialog is the defect.** The fix is to seed the toggle from
the recipient's stored `fullAccess` (and to send `undefined` when the operator never touched it).
**Scope:** every send after the first, to any recipient, on any event. Reproduced twice.

### What PASSED — `full_access` does exactly what #24.2 says, on every other point
Driven end to end for the first time in three sweeps:
- **A stored grant, not a request flag.** `settlements.full_access` on the recipient's own row went `f → t`
  on the send.
- **Per party, per settlement.** Granting Marlo Vance changed nothing for Neon Tide: `performerB`'s
  `GET /events/…e1/settlements` stayed at **1 row** while `performerA`'s went to **6**;
  `GET …/settlement/lines` returned the full line list to Marlo and **`[]`** to Neon Tide.
- **Not `budget.view`.** With the grant live, `performerA GET /events/…e1/budgets` still answers
  **403 `"Missing capability: budget.view"`**. The forecast stays shut, as the decision requires.
- **Default off.** The toggle ships off and the first send without touching it leaves `full_access = f`.
- **Audited, both sides.** `audit_log` holds `settlement.pending_review` with
  `before {status: open, fullAccess: false}` / `after {status: pending_review, fullAccess: true}`,
  beside the send that made it.

---

## The `e69a85a` tier fix — did it survive being attacked? **Partly. Three of six attacks landed.**

I did not re-run the happy path that was already proved (`Open Mic`, Advance 25→30, SEK 6,600). I went at
the new rule's seams. The seam is that the two halves ask **different questions**: the API asks
*"does this sheet state its own door?"* first and only then matches tier names (`statesItsOwnDoor` →
`statedTierNames`); the planner (`mergeTicketTierSeeds`) only ever matches names. Every finding below is
that asymmetry, or the name-as-identity choice, coming back.

### [MAJOR] Renaming a ticket tier in the planner counts it twice — SEK 6,300 of door settles as SEK 7,800
**As:** `operator`, seat 2, browser — after a fresh boot, `Open Mic Wednesdays` (E3), no prior budget
**Steps:**
1. E3 → Budget Planner. The two event tiers seed correctly: `Door entry` 80 × 60, `Advance` 60 × 25 = SEK 6,300.
2. Rename the `Advance` row to `Early bird`. Nothing else. Blur.
3. Settlement → **Run the settlement**.
**Expected:** SEK 6,300 and two ticket rows. The night sold two tiers; renaming one on the forecast does not
sell a third.
**Actual:** the planner immediately shows **three** rows — `Early bird` 60 × 25 (written), `Door entry`
80 × 60 (seed), and **`Advance` 60 × 25 again** (seed, because the written row no longer answers to that
name) — *"110 tickets planned across all types · SEK 7,800"* in an **80-capacity** room. The settlement then
reads **Gross revenue SEK 7,800** with three revenue lines, and `copyBudgetOnce` **writes the phantom back
into the shared budget**, so it is now permanent:
```
psql> select label, amount from budget_lines where budget_id='6d34d372…';
 Advance    | 150000      ← materialised by the settlement
 Door entry | 480000
 Early bird | 150000      ← the rename
```
**Evidence:** `docs/screenshots/qa-2026-09-26-run3/tier-rename-doubles-the-door-7800.png`
**Expected-why:** this is the exact inverse of the run-2 BLOCKER. That one *lost* SEK 4,800 on one blur;
this one *invents* SEK 1,500 on one blur. Both are single-keystroke, no-warning changes to what the night
took. `useBudgetEditor.ts:160` calls the reappearance *"the honest answer rather than a miss"* — it is
honest about the tier list and silent about the money, and the money is what the settlement copies.
**Scope:** reproduces on the seeded two-tier event; the mechanism is name-matching, so it applies to any
rename on any event with `events.extras.ticketTiers`.

### [MAJOR] A ticket tier cannot be removed from the Budget Planner — Remove deletes the row and nothing changes
**As:** `operator`, seat 2, browser, same event, straight after the above
**Steps:** Budget Planner → the ticket row's **Remove Advance** button → read the total → reload → recalculate
the settlement.
**Expected:** removing a ticket type removes its money.
**Actual:** the `budget_lines` row is genuinely deleted (3 rows → 2) and the screen **does not change at all**:
still *"110 tickets planned across all types · SEK 7,800"*, because deleting the written row frees its name
and the event's `Advance` tier instantly returns as an unwritten suggestion. Survives a reload. The
settlement keeps its `Advance` line as well, so the figure the operator tried to delete is still the figure
the night settles at. **Pressing Remove appears to do nothing, twice over.**
**Evidence:** the `select label, amount from budget_lines` before/after above; the unchanged screen text.
**The one-line honest fix** for the report, not applied: removing a tier has to be recorded somewhere the
seed can read — either delete the tier from `events.extras.ticketTiers` too, or keep a withdrawn-seed set.
Matching on the label alone cannot express "I do not want this one".

### [MAJOR] A hand-written door row and the event's tiers disagree by SEK 32,000 between planner and settlement
**As:** `operator` — event built through the API (`api-as.mjs`), read in the browser, seat 2
**Steps:**
1. Create an event with `extras.ticketTiers = [General 200 × 90, Balcony 350 × 40]` (= SEK 32,000).
2. Add **one** budget revenue line by hand: `Door, as actually counted`, SEK 25,000, `details = null`
   (exactly the shape the commit message names).
3. Compute the settlement. Then open the Budget Planner on the same event.
**Expected:** the commit's own rule — *"one unstructured ticket row and the sheet is stating its own door in
its own terms, untouched"*. Both surfaces should say SEK 25,000.
**Actual:** the **settlement is right** — one line, `Door, as actually counted | 2500000`, and the tiers are
correctly *not* added on top. The **planner is wrong**: it shows the hand row **plus both event tiers** —
SEK 25,000 + 18,000 + 14,000 = **SEK 57,000**, *"131 tickets planned"* in a 150-cap room — because
`mergeTicketTierSeeds` has no equivalent of `statesItsOwnDoor` and matches names only.
**Evidence:** event `954faa79-eb2a-4008-9468-83b2cc5c7980`; the probe script's output above;
`INPUTS: Door, as actually counted price=25000 qty=1 | General 200 × 90 | Balcony 350 × 40`.
**Scope:** any event whose budget holds an unstructured ticket-revenue row — which is the shape the **seed
itself** uses on `Nordic Synth Showcase` and `Spring Warmup`, so it is not an exotic state.

### [MAJOR] A JPY event settles at 1 % of its takings on screen — the waterfall divides by 100 whatever the currency
**As:** `operator`, seat 2, browser — event created through the **UI** in **JPY** (the picker offers it)
**Steps:** new event, currency **JPY**, capacity 200, three tiers `Advance ¥3,000 × 80`,
`Regular ¥4,000 × 60`, `VIP ¥10,000 × 20` → Budget Planner → Settlement → Run.
**Expected:** ¥680,000. JPY has **no** minor unit, so the stored `240000` *is* ¥240,000.
**Actual:** the planner is right — **JP¥680,000**, three rows at 240,000 / 240,000 / 200,000, processing
1.5 % = JP¥10,200. The settlement's line items are right — **JP¥240,000 / JP¥240,000 / JP¥200,000**. And
immediately underneath, **Gross revenue JP¥6,800**, Net JP¥6,800, Adjusted net JP¥6,800, operator
entitlement JP¥6,800. Two cards on one screen render the same stored numbers 100× apart.
**The engine is correct** — `settlements.computed` holds
`entitlement 680000`, `ladder {revenue: "680000", adjustedNet: "680000"}` — so this is display only, and it
is display of the number the operator pays on.
**Root cause, named:** `apps/web/src/lib/format.ts:11` — `const major = minor / 100`, with no per-currency
exponent, in both `formatMoney` and `formatMoneyExact`. The event-creation picker offers **JPY** (0 decimals,
prints 1/100 of the truth) and **KWD** (3 decimals, would print 10× the truth) alongside six 2-decimal
currencies.
**Evidence:** `docs/screenshots/qa-2026-09-26-run3/jpy-680000-settles-as-6800.png` and
`jpy-planner-correct-680000.png`; event `307b3b8c-5afd-4485-8611-01c45d3e1454`.
**Scope:** every JPY and KWD event, every screen using `formatMoney`. SEK/EUR/NOK/DKK/GBP/USD unaffected.

### [MAJOR] Ticket tiers cannot be entered on Event Details in the natural order, and lose a field when they can
**As:** `operator`, seat 2, browser, on a brand-new event
**Steps:** Event Details → Ticket Information → **+ Add ticket type** → type the tier's **name** first.
**Expected:** a four-field row you can fill in any order.
**Actual:**
- Typing the **name** first **removes the row's Price / Max / Est. sales inputs from the DOM** — the
  `aria-label` set collapses from four (`Ticket type name`, `Price for this ticket type`, `Maximum…`,
  `Estimated sales…`) to one (`Ticket type name (Advance)`), the table body renders no fields, and
  `Total inventory` stays `0 max · 0 est.` The name is **not saved** either: `extras.ticketTiers` still holds
  `{"name": "", "price": 0}`. Only a reload brings the row back — empty.
- Filling **price → max → est → name** does persist the tier, but drops a sibling: across three tiers the
  **Max never persisted once** (`"max": 0` for all three, `Total inventory` reads `0 max · 160 est.`), and on
  a fourth tier added later it was **Est. sales** that was dropped instead (`"est": 0`).
- **+ Add ticket type** writes an empty tier to `events.extras.ticketTiers` immediately —
  `{"est":0,"max":0,"name":"","price":0}` — which then lives in the event's tier list.
**Evidence:** the aria-label transcripts above; `select jsonb_pretty(extras->'ticketTiers')` on
`307b3b8c-…` and `…e3`.
**Scope:** every new event. The seeded tiers came from the Postgres seed, which is why two sweeps never hit
this — **no tier in this repo's demo data was ever typed through this screen.**

### What PASSED in the tier machinery
- **Materialising per tier, from the event, with no budget rows at all.** `General 200 × 90` +
  `Balcony 350 × 40` → settlement lines SEK 18,000 and SEK 14,000. Checked by hand. This is the half of
  `e69a85a` that works, and it is the common case.
- **Three tiers, seeded and summed correctly**, including in a zero-decimal currency: 3,000 × 80 +
  4,000 × 60 + 10,000 × 20 = ¥680,000 in the planner and in `settlements.computed`.
- **A hand-written door row still suppresses the tiers at the settlement.** The double-count the old
  all-or-nothing rule existed to prevent is still prevented — on the API side.
- **`extras.ticketTiers.price` is still read as MAJOR units.** ¥3,000 → `unitAmount "3000"` in JPY;
  SEK 80 → `unitAmount "8000"` in öre. The trap named in the brief did not fire.
- **`copyBudgetOnce` is genuinely once.** A second **Recalculate** on E3 did not re-materialise or duplicate
  anything; `budget_lines` stayed at two rows.
- **A tier added on Event Details after the budget exists does reach the planner** (a 4th row appeared) —
  the merge direction works; only its quantity was lost, to the Event Details bug above.

---

## The headline, and it needed the co-host seat to find

### [BLOCKER] The same "shared ledger" tells the two co-promoters profits SEK 41,500 apart — and the co-host is shown the profitable one
**As:** `operator` (seat 2) and `coHost` (seat 1), the **same event, the same budget, the same minute**
**Steps:**
1. E1 `Marlo Vance — Album Release`: one deal, `Album Release — Door Split`, **100 % of the pool**,
   Marlo 60 / Neon Tide 40. Shared budget: SEK 83,000 door, SEK 41,500 of costs.
2. Open **Budget Planner** as the host. Then open **Budget Planner** as the co-host.
**Expected:** one shared ledger, one set of figures. PLAN.md:215 — *"Co-promoters share **one** budget (full
transparency)."*
**Actual:**

| | host (The Lantern Hall) | co-host (Northlight Presents) |
|---|---|---|
| TOTAL REVENUE | SEK 83,000 | SEK 83,000 |
| TOTAL COSTS | **SEK 84,245** | **SEK 42,745** |
| PROFIT / LOSS | **−SEK 1,245** | **+SEK 40,255** (margin "48.5 %") |
| Performer fee row | `SEK 41,500` — *"Read from the deal … 100 % of the adjusted net"* | **absent**, and listed under *"Not budgeted"* |
| "HOW TICKET REVENUE SPLITS" card | present, Marlo 60 % / Neon Tide 40 % | **absent** |

**Why:** `GET /events/:id/deals` returns `[]` to a co-host (the `deal.view.own` scoping behind the
"No deal yet" finding above), and `useBudgetSeed` derives both the performer-fee row and the split card
**from that list**. So the co-promoter's planner is the shared ledger **minus every entitlement**, and the
number it prints largest is the one number that is most wrong.
**Evidence:** `docs/screenshots/qa-2026-09-26-run3/host-planner-loss-1245.png` and
`cohost-planner-profit-40255.png` (and `cohost-shared-ledger.png`, `jpy-planner-correct-680000.png`) — captured from two independent browsers within the same minute.
**Scope:** any co-promoted event with a deal. **This is the shared-versus-private ledger fault the co-host
seat was opened to find**, and it does not throw, log or warn: it is a working screen with a 48.5 % profit
margin on a night that loses money.
**Severity note:** filed BLOCKER rather than MAJOR because a co-promoter's whole reason to be on the
event — deciding whether the show is worth doing — is answered by this figure, and the answer inverts.

### What PASSED — Ran's 2026-09-21 spec, re-confirmed on the host's side and on a *reopened* deal
The derived fee is there, correct, and honest about its status. After reopening the confirmed deal
(status → `draft`) the planner's cost row read:
> **Performer fee — SEK 41,500.** *"Read from the deal 'Album Release — Door Split · 100% of the adjusted
> net' — still an offer, nobody has confirmed it. Nothing is stored on the budget: change the terms and this
> moves with it."*
SEK 41,500 = the adjusted net (83,000 − 41,500 = 41,500), which is what `reconcile()` pays. The split card
is chipped **`DOOR SPLIT · PROPOSED`** with *"Nobody has confirmed these terms yet, so they can still
move."* Nothing is stored on the budget. That is the spec, met.

---

## Realtime, with two live browsers — the first run that could fail on delivery

### What PASSED — a message posted in one browser lands in the other, unprompted
**Seats:** `operator` (seat 2) posts, `coHost` (seat 1) watches, neither reloaded.
1. Both seats open E1 → Messages → the **Everyone** thread. Co-host's last line recorded.
2. Seat 2 types `QA seat-2 realtime probe at 19:03:35` → **Send**.
3. Seat 1's DOM, read ~2.5 s later without any navigation: the message is there, attributed
   **`TL / The Lantern Hall / 21:03`**.
`event.message_posted` → SSE → message/thread invalidation works end to end. **This is the claim two
previous sweeps structurally could not test**, and it holds.

### [MAJOR] A deal confirmation reaches the bell and leaves the sentence next to it false
**As:** `operator` watching (seat 2, browser, Budget Planner open); `performerB` confirming (`api-as.mjs`)
**Steps:**
1. Seat 2 sits on E1's Budget Planner. It reads: **Performer fee SEK 41,500 — *"still an offer, nobody has
   confirmed it"***, and the split card is chipped **`DOOR SPLIT · PROPOSED`**. Bell: *2 unread*.
2. `POST /deals/…d1/confirm` as `performerB`. **200.**
3. Read seat 2's DOM 3 s later, **no reload.**
**Expected:** the role file's own definition of a finding here — *"a frame that arrives and changes nothing
it should"*.
**Actual:** the bell moves to **3 unread** on that same page, so the SSE frame arrived and was acted on —
and the planner one scroll below still says **"still an offer, nobody has confirmed it"** and still shows
the `PROPOSED` chip, indefinitely. The notifications query is invalidated;
`apps/web/src/hooks/useRealtimeStream.ts` invalidates nothing for deals, budgets or settlements.
**Scope:** the known gap, now with a live observer instead of a code reading. Filed MAJOR rather than NOTE
because the stale copy is not merely absent — it **asserts** the opposite of what just happened, on the
screen the operator is using to decide.

### [MAJOR] An accepted invitation does not clear "Invite pending" on the inviter's open screen
**As:** `operator` watching (seat 2, Collaborators tab of E4); `coHost` accepting (seat 1, real UI)
**Steps:** host opens E4 → Collaborators (reads *"co.host@e2e.showme.test · Co-operator · **Invite
pending** · Invited 26 Sept 2026 — nothing is granted until they accept."*) → co-host opens the invitation
link in the other browser and presses **Accept** → read the host's DOM 4 s later, no reload.
**Actual:** the bell moves (`Notifications (2 unread)`, and `notifications` holds a fresh
`invitation.accepted` row for `e2e-operator`), and the collaborator row is **unchanged** — still
*"Invite pending … nothing is granted until they accept"*, while the participant row is `accepted` in
Postgres and the co-host can already open the event.
**Scope:** `event.participant_added` is one of the two types that **does** publish, which is what makes
this a finding and not the known gap.

### [NOTE] A posted message creates no notification at all
`select * from notifications` after the message above: **zero new rows**. A message is delivered live to
whoever already has the thread open and to nobody else — no bell, no email, no trace. Said plainly as an
unbuilt gap, not inflated: it is consistent, and it is the reason the co-host's bell did not move for it.

---

## Priority 4 — the rest of the unreached bucket

### What PASSED — curation beyond the default (decisions #24.3)
Driven on E1 as the host. Clicking `Sound & production` in *"Curate what each collaborator sees"* moved it
to **IN THEIR SETTLEMENT** for `Marlo Vance` and stored
`settlement_lines.visible_to = ["e2e00000-0000-4000-8000-0000000000b2"]` — an **allow-list**, NULL for every
other line. Measured immediately after:

| | `performerA` (disclosed to) | `performerB` (not) |
|---|---|---|
| `GET …/settlement/lines` | **1 row** — `cost Sound & production 1250000` | **0 rows** |
| `computed.ladder` | **null** | **null** |

Per **participant**, not per role; nothing but the named line crossed; and **the derived totals did not
leak** — which is precisely the leak the design's own prototype has and #24.3 forbids.

### What PASSED — revenue shares (#23.2), checked by hand
Fresh event, SEK 50,000 door collected by the host, one revenue share of **2000 bp** to the performer, no
deal at all. Computed:
```
host      ent 4000000  held 5000000  net -1000000
performer ent 1000000  held       0  net  1000000      Σ net = 0
transfer  host → performer  1000000
```
SEK 10,000 = 20 % of 50,000 ✓, and it is a **share, not a deduction** — the host's *entitlement* fell by it
rather than the pool being cut first, which is exactly the #23.2/#23.3 distinction.

### What PASSED — deal reopen
`Reopen` on the confirmed deal demands a reason (the button is `disabled` until the WHY field is filled),
warns *"Every confirmation … is cleared and the frozen terms are released"*, and then does it:
`status confirmed → draft`, `agreement_status → sent`, **all three `deal_parties.confirmed_at` cleared**,
`0 of 3 signed`, and `deals.reopen` records
`{"reason": "QA probe …", "reopenedAt": "…", "reopenedBy": "e2e-operator"}`. The planner's fee row correctly
went back to *"still an offer"*.

### What PASSED — finalize → paid
On E4: **Finalize** warns honestly (*"cannot be recomputed and cannot be un-finalized — not from this
screen and not from the API. Transfers can still be marked paid."*) → both settlements `finalized` →
**Payout tab** lists `The Lantern Hall → Northlight Presents SEK 9,150 · Owed` with **Mark as paid** →
pressing it sets `settlement_transfers.state = paid`, both settlements to **`paid`**, and the header badge
to **Paid**. The whole tail of the journey completes.
**Correction to my own BLOCKER above, made after driving this:** the SEK 9,150 is *not* invisible — it is on
the **Payout** tab after finalize. What is true is narrower and still wrong: the **Settlement** tab never
shows it, prints the host's SEK 21,350 under *"What is left after every other party is paid"* when
SEK 9,150 of it is not, and asks **`0/1`** approvals for a two-party settlement. The BLOCKER stands on the
send-for-review recipient list, which genuinely cannot reach the co-operator.

### [MINOR] Nobody is told a transfer was paid
`Mark as paid` writes no notification row. The party receiving SEK 9,150 got `settlement.finalized` and then
silence.

### [MINOR] The agent is not told when the agreement it must sign is reopened or confirmed
`deal.reopened` notified `e2e-performer-a` and `e2e-performer-b`; `deal.confirmed` notified `e2e-operator`
and `e2e-performer-a`. **`e2e-agent` got neither**, on a deal where Marlo Vance is delegated — the same
delegation that makes `counterparts()` exclude Marlo from answering a date move and hands the agent
`agreement.confirm`. The party that has to act is the one not told.

### [MINOR] `revenueShares` is accepted and silently dropped on line CREATE
`POST /events/:id/budgets/:bid/lines` with a valid `revenueShares` array answers **201** and returns
`"revenueShares": null`; the column is NULL in Postgres. The identical array on **PATCH** stores correctly.
The web client only ever writes shares by PATCH (`useBudgetEditor.ts:2018 writeShares`), so nothing in the
product loses data today — but the create body declares the field (`budget.ts:150`) and then ignores it,
which is the same silent-strip shape CLAUDE.md records for `details.perGuest`.

### [MINOR] A revenue share pays a participant who has not accepted the booking
The performer in the probe above was `status = invited`, never accepted, and still received a
SEK 10,000 entitlement and a transfer. Elsewhere the codebase insists on **standing** (`counterparts()`
takes only `accepted`/`confirmed`). Worth a decision either way; recorded, not pressed.

---

## Priority 5 — the run-2 MAJORs, re-checked. One moved; the rest stand.

### CORRECTED — "The inline Status field never saves, silently" is **not** what happens
**Run 2 filed this as MAJOR.** Driven again on a fresh event: opening `Status`, choosing **Pending**, and
walking away leaves Postgres at `draft` — which is what run 2 saw. But the field is **not** auto-commit: it
leaves a **Cancel / Save** pair open, and pressing **Save** writes it (`select status → pending`).
**The real defect is smaller:** the field paints the new value in place *before* it is committed, so the
screen reads "Pending" while the row is still `draft` and the Save button is easy to miss. **MINOR**, not
MAJOR. Run 2's probe lied by stopping one click early; this is recorded in *Probes that lied* too.

### STILL REPRODUCES — two holds on one night both read "1st"
Two `on_hold` events on **2027-02-02**, same venue profile, same stage (`Main Room`). Each event's Hold
panel says **"2 HOLDS ON THIS DATE"** and then lists **`1st QA Hold A`** and **`1st QA Hold B`**, both
"Frozen", and each event's own summary says **"1st hold"** beside an enabled **Promote to 1st**.
`events.hold_rank` is **NULL** for both and the UI renders NULL as 1st. Run 2 reached this through the
wizard; it reproduces through the API too, so the fault is in the ranking, not in one entry path.

### STILL REPRODUCES — an agent's own money is SEK 0 on every screen they can open
`agent GET /settlements` → one item, `"entitlement": "0", "net": "0"` on the Album Release. The commission
exists and is computed: the event's representation settlement holds
`{"commission": "249000", "performerEntitlement": "2490000"}` — **SEK 2,490** the agent has earned and
cannot see anywhere in their own money screens.

### STILL REPRODUCES — the ticket-split card pays the gross door while the fee row pays the adjusted net
On the host's planner, one screen, one moment: the card **`DOOR SPLIT · PROPOSED`** shows
`Marlo Vance 60% — SEK 49,800` and `Neon Tide 40% — SEK 33,200` (sum **SEK 83,000**, the whole gross door,
captioned *"100% of the door"*), while the cost row beneath reads **Performer fee SEK 41,500** — *"100% of
the adjusted net"* — which is what `reconcile()` actually pays. **The operator's own row is still absent
from the card.** Two figures, SEK 41,500 apart, for one deal, four inches apart.

### STILL REPRODUCES — the derived performer fee is treated as a fixed cost by break-even
With the derived SEK 41,500 fee in place, the planner reports **BREAK-EVEN TICKETS 325** and
*"Revenue passes total cost at 325 tickets of 400 capacity"* — 84,245 ÷ 259 per ticket. But that fee is
**100 % of the adjusted net**: it moves with every ticket sold, so this night never breaks even and the
curve is not a line crossing a constant. Drawn as if it were.

### STILL REPRODUCES — a confirmed event with no *standing* counterpart can never be re-dated
Event `QA Revenue Share 2`, status `confirmed`, one other participant whose status is `invited` (never
accepted). `PATCH /events/:id {"eventDate": "2026-12-11"}` → **200**, and
`GET /events/:id/change-request` → `{"required": 0, "confirmed": 0, "declined": 0, "answerable": false}`
with `events.event_date` still **2026-12-10**. The date is now permanently unmovable: the proposal needs
0 answers and applies at 0, and nobody — including the operator who asked — is offered a button.

### NOT re-driven
Run 2's remaining MAJOR — *"the act's own settlement card contradicts itself and quotes an agent commission
SEK 500 higher than the one actually owed"* — was not re-driven. It needs a `performerA` browser seat, and
both of this run's two seats were committed to the co-promotion and host roles for the whole session
(signing one out is what the second browser exists to avoid). The commission figure itself is visible in the
row quoted above (`commission 249000` against `performerEntitlement 2490000` = exactly 10 %), so the stored
side is at least self-consistent on this seed.

---

## Area 0 — smoke, the `coHost` seat (first time in a browser)

All fifteen sidebar destinations were visited as `coHost`. **None is blank, none errors, all render real
data or a real empty state.** The nav offered is identical to the host operator's, which is right: `coHost`
is an `operator` account, and co-hosting is a per-event role. Specifics worth recording:

| Destination | What the co-host actually sees |
|---|---|
| Dashboard | *"You have 1 thing that need attention today"* (grammar), and it names the **on_hold** E4 as a **"Pending event"** — run 2's minor, reproducing for a second kind |
| Calendar | renders; September 2026, filters, ICS import/export all present |
| Events | the one co-promoted event, correctly |
| Performance Reports | **the act's setlist-derived filing** — `Marlo Vance — Album Release · Works 4 · Runtime 16 min`. Intended (`performance_report.file` is grantable to `co_host`), recorded because it is the co-host reading the act's artistic content |
| Setlists | correct stub: *"A setlist belongs to the act… Open an event to see the setlists on it."* |
| Settlements | **TOTAL SETTLED SEK 9,150** — see the finding immediately below |
| Bills & Invoices | totals in **€** on an operator whose every event is SEK — run 2's minor, second kind |
| Team / Contacts / Audience / Projections / Requests / Tasks / Profiles / Settings | all render, real empty states |

### [MINOR] Two routes disagree about whether a party may read their own settlement
```
coHost GET /settlements                      → 200, entitlement 915000, status paid   (Nordic Synth)
coHost GET /events/…e4/settlements           → 403 "Missing capability: settlement.view.own"
```
Same party, same settlement, same money. The global list is the correct answer — it is their own SEK 9,150,
already paid — and the event-scoped refusal is what leaves the **Settlement tab blank** for the party that
was paid. Worth fixing from the 403 side, not the 200 side.

### Console and network across the whole run (seat 1, 247 recorded errors)
De-duplicated by URL:
- **81 × `ERR_CONNECTION_REFUSED`**, of which 61 are Vite's own HMR websocket and 10 are
  `localhost:5173/seed/*.svg` — the seeded image host that does not exist locally. **Stack artifacts**, as
  run 2 concluded; re-confirmed rather than re-filed.
- **8 × `ERR_CONNECTION_REFUSED` + 2 × CORS on `localhost:8081/stream`** — boot-window only. Re-probed live
  at the end of the run: `fetch('http://localhost:8081/stream')` from the page returns **401**, not a CORS
  block, so the stream is up and cross-origin-clean. **Not a finding.**
- **26 × 403** — all of them the view-only co-operator's doomed queries on E4
  (`/deals`, `/settlements`, `/settlement/comments`, `/schedule`), each retried **four** times.
- **16 × 404** — 12 are the co-host's `/profiles/<venue>/stages` (filed above), 4 are `favicon.ico`.
- **2 × React hydration error**, `<button>` nested inside `<button>` on the Venue row of the event
  workspace — run 2's minor, still reproducing, now confirmed on the co-host's seat as well.

---

## What passed — the short list, because it is half the result

- **Two independent browser seats work**, and neither logged the other out for the whole session.
- **SSE delivers a message to a watching stranger's screen** (first proof in three runs).
- **`full_access` (#24.2)** does everything the decision says on five of six points; the sixth is the
  dialog, not the API.
- **Curation (#24.3)** discloses per participant, allow-list polarity, and **leaks no totals**.
- **Revenue shares (#23.2)** compute, transfer, and keep Σ net = 0 — hand-checked.
- **`operatorCostSplit`** divides a real residual 70/30 with Σ net = 0 and one transfer — hand-checked,
  non-vacuously, for the first time.
- **The two books are two books.** A private budget is invisible to the other operator on list and on
  direct id, and the settlement never touched it.
- **Deal reopen** clears every confirmation, demands and records a reason.
- **Finalize → mark paid → `paid`** completes, with an honest irreversibility warning.
- **A co-host cannot wave their own date change through**; exclusion is by user, not by acting profile.
- **Per-row budget writes survive a stale concurrent editor.**
- **Ran's 2026-09-21 spec** holds: the derived fee reaches the planner from a **draft** deal, labelled as an
  offer, stored nowhere.
- **`extras.ticketTiers.price` is read as major units**, including in a zero-decimal currency.
- **`copyBudgetOnce` really is once** — a second Recalculate duplicated nothing.
- **Mobile 390px** on the Budget Planner and the Settlement workspace: `scrollWidth == clientWidth == 380`,
  and looked at, not only measured — only the tab rail overflows, which is a horizontal scroller by design.
  `docs/screenshots/qa-2026-09-26-run3/mobile-390-cohost-settlement.png`.
- **The event-creation flow** completes end to end, including a non-default currency, with a
  discard-guard that offers **Save draft**.

## Not reached, and why

- **`performerA`, `performerB`, `teamAndCrew`, `agent` in a browser.** Driven by `api-as.mjs` only. Both
  browser seats were committed for the whole session to the two operators, which is the point of the
  co-promotion priority — signing one out is exactly what the second browser exists to prevent. Every
  finding attributed to those four above says "API" and means it.
- **Run 2's MAJOR about the act's own settlement card** — needs that performer seat. Named above.
- **The marketing site / public event pages**, **share links and the share viewer**, **Google OAuth
  callback**, **contacts and audience import/export**, **calendar ICS import/export**, **setlist
  authoring**, **rider upload**, **crew staffing against availability**, and the **Settings** tabs beyond
  their headings. Untouched this run; run 2 covered most of them and this run's priorities were elsewhere.
- **Hold *promotion*** (as opposed to hold ranking). I reproduced the "two 1st holds" fault but did not
  drive Promote/Release to a resolution.
- **Display-currency switching against a finalized settlement.** The finalize happened on E4 late in the
  run and I did not re-open it in another display currency, so "a display-currency change must never move a
  settled amount" is **unverified this run** (run 2 checked the pre-finalize half).
- **The back button through the multi-step event creation**, and refresh-survival beyond the individual
  reloads quoted in each finding.

## Probes that lied, and what the re-run showed

1. **"The co-host can rename and re-date somebody else's confirmed show."** My first probe
   (`api-as coHost PATCH /events/:id`) returned **200** on title, capacity and published, which looks like a
   missing boundary. Re-checked against the data before filing: the seed gives `coHost` the
   **`Operator — full`** permission set (23 capabilities including `event.delete`), so the 200s are the
   permission set doing exactly what it says. **Not filed as a hole.** What I filed instead is what the
   *product's own* invite flow grants, which is `event.view` alone — and which refuses all three with the
   right message. Right status, wrong reason, caught.
2. **`event_change_requests.proposed_by_profile_id` was NULL** on my probe's proposal, which looked like
   "a proposal with no author". It was my own call omitting `X-Profile-Id`; `proposed_by_user_id` was
   `e2e-co-host` throughout, and `counterparts()` excludes **by user** on purpose. **Not a finding.**
3. **`operatorCostSplit` "does nothing".** On E1 the 70/30 split produced SEK 0 for the co-host, which
   reads like a dead setting. It is a **vacuous pass**: the door deal takes 100 % of the adjusted net, so
   the residual being divided is 0. Re-driven on an event with no deals, where the residual is the whole
   profit — and it divides correctly. A green line that could not have failed.
4. **Run 2's "the inline Status field never saves, silently."** Re-driven: it saves, behind an explicit
   **Save** button that run 2 appears not to have pressed. Downgraded to MINOR here, with the real defect
   (the value paints before it commits) stated instead.
5. **8 × `ERR_CONNECTION_REFUSED` and 2 × CORS errors on `localhost:8081/stream`**, which would be a
   BLOCKER for realtime if they were live. Re-probed at the end of the run from the page itself:
   `fetch('http://localhost:8081/stream')` → **401**, no CORS block. Boot-window noise. **Not filed** — and
   the message test proves the stream works regardless.
6. **The "SEK 9,150 the co-host is owed is invisible."** True on the Settlement tab, false overall: it is on
   the **Payout** tab after finalize, and on the co-host's own global **Settlements** screen. I had written
   the stronger claim before driving finalize; the correction is in the text above rather than deleted,
   because the narrower version is still a real defect.

## State of the seed after this run — do not quote figures off it

Mutated and **not** reseeded: E1's shared budget gained `Northlight van hire` (5,000) and
`Lantern extra rigging` (3,000), `Sound & production` moved 12,000 → 12,500, a 70/30 `operatorCostSplit`
was set, its settlement was computed, one line was curated to Marlo Vance, and its deal was **reopened and
partly re-confirmed** (Neon Tide only). Northlight holds a private budget with a 7,777 line. E3 carries a
renamed tier and a duplicated `Advance`. E4 is **finalized and paid**. Five throwaway events were created:
`QA Tier Probe Act` (JPY), `QA Handwritten Door`, `QA Handwritten Door 2`, `QA Revenue Share`,
`QA Revenue Share 2`, `QA Hold A`, `QA Hold B`. **Reseed before the next run.**

---

## One more, found in passing while creating an event

### [MINOR] Pressing Escape to dismiss the venue autocomplete offers to throw the whole event away
**As:** `operator`, seat 2, browser
**Steps:** Events → **New event** → type a venue name → the suggestion panel opens **over the Continue
button** and swallows clicks on it → press **Escape** to close the panel.
**Actual:** Escape does not close the panel. It opens
*"**Leave without creating this event?** Everything you have filled in will be lost."* on a form holding an
artist, a venue, a city, a date, a capacity and a currency. The panel is still open behind it, so the only
way forward is **Keep editing** → then find and press the panel's own close control.
**Expected:** the innermost dismissible thing takes the Escape. It is a modal-stack ordering bug, and the
discard guard itself is good — it offers **Save draft**, which is the right third option.
**Evidence:** Playwright's own message — *"`<button aria-label="Close venue search">` … intercepts pointer
events"* on the Continue click, then *"`<p>Everything you have filled in will be lost…`" from
`<div aria-modal="true" role="alertdialog">` intercepts pointer events"* on the next.
