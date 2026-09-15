# Handoff — 2026-09-15, the settlement surface built from Ran's design

**A snapshot of this moment, not a statement about the present** (CLAUDE.md's
standing warning, and four files in this folder have already earned it). Check the
code before you scope from this.

The plan, the two decisions behind it and what is still open are in
[plan-settlement-2026-09-15.md](./plan-settlement-2026-09-15.md). The design
itself, and the three places it disagrees with itself or with us, are in
[design-settlement-2026-09-10.md](./design-settlement-2026-09-10.md). This file is
only the part a next session would otherwise reconstruct from seven commit
messages.

---

## 1. The design existed all along, on the ticket

`Settlement.html` — 1.1 MB, the whole settlement screen — was attached to ClickUp
`123qy9rnwud` in the same comment as the two files that reached `~/Downloads`,
along with two screenshots of the send-for-review modal. Nobody had downloaded it,
so a check of `~/Downloads` and of the repo both came back empty and **two handoff
docs wrote that absence down as a fact**: *"there is no `Settlement.html`."*

It is now in `claude-prototype/ran-2026-09-10/`, with a full-page screenshot of
every tab under `renders/`. The lesson is one line: **a ticket's attachment list is
part of the ticket.**

## 2. Two rules were reversed, and both are the owner's

Recorded in [decisions.md](./decisions.md) **#24**, which is the file to read
before touching either.

**#24.1 — the waterfall.** `gross − deductions = net − rental (off the top) =
adjusted net`, and every percentage divides the adjusted net. This reverses #23.1
and un-retires off-the-top rentals, **two days** after they were settled. #23.2 and
#23.3 stand.

The consequence to know before anyone reads a figure and thinks it is wrong: **on a
night that lost money, a pure door-split act is now paid nothing.** 50% of a
negative adjusted net is negative, and the floor takes it to zero. The seeded
reference performer has now been 54 600 → 48 300 → 52 800 → **46 500** across three
rule changes; the same 6 300.00 SEK has moved twice, both times out of the
performer's share.

**#24.2 — an operator may open the books.** `story.md:44` said a performer never
sees the pool "even if an operator wanted to show them" and called it inviolable.
The send-for-review modal's **Full settlement access** toggle is exactly that, and
the owner's answer is that they may. story.md is amended in place and points at
#24.2.

## 3. What is now true of the screen

Seven tabs: **Overview · Deal structure · Financials · Settlement · Comments ·
Collaborators · Payout** — the design's six, plus **Comments**, which is the
product owner's call and not the design's. The prototype keeps the thread in the
Settlement tab's right rail; a remark about a FIGURE still lives on the figure
(every row of the read-only preview carries its own bubble), and the tab is the
whole conversation plus the revision history, read without scrolling a long page.
An anchored remark names its figure there, which is what
`settlement_comments.settlement_line_id` was always for.

Two mechanisms govern what a collaborator sees, and they are **different things**:

| | curation (#24.3) | full access (#24.2) |
|---|---|---|
| grants | named settlement LINES | the whole settlement |
| stored on | `settlement_lines.visible_to` (0039) | `settlements.full_access` (0040) |
| touches the totals | **never** | yes — waterfall and every party |
| default | shown to nobody | off |

The polarity of `visible_to` is the safety of the first one. Spelled
`hidden_from`, a NULL would have meant "hidden from nobody", and every cost on
every event would have become readable by every performer the day it shipped.

**"Viewing as" is answered by the server** (`GET …/settlement/preview`), running
the same filter as the party's own read, and a test asserts the two are equal. The
prototype simulates it in the browser, which cannot detect a curation the server
would apply differently.

## 4. The two traps this session hit, both already in CLAUDE.md

- **The API has no watch.** Migrations and routes were invisible to the browser
  until the process was restarted — twice, including one round where a new route
  404'd and looked like a client bug. `ps eww -p <pid>` gives you its env.
- **Run the whole check.** Two Playwright specs broke on the rebuild and both were
  right to: a control moved behind the entry-method chooser, and a tab stopped
  existing. Neither vitest suite noticed.

**`pnpm test:e2e` is now GREEN — 112 passed, exit 0.** CLAUDE.md's "main has been
red since 2026-09-05" is marked as stale there; do not inherit it as the status.

## 5. What is NOT done

1. **No real event has ever been settled.** **Corrected 2026-09-15 during the
   deploy:** production is not empty any more — 8 settlements with `computed`, 1
   settlement line, 1 transfer — but all eight sit on Ran's TEST events (`Ran Nir`
   ×4, `Ran test 3`, `asdasdasd`, `Hhhhh`, `adw`) and nothing is finalized. Every
   claim here is still proven on fixtures, the seeded e2e event and the browser,
   never on a real night. **Settling one real show is the acceptance test that has
   not been run.**

   Those eight carry the OLD ladder shape. A deploy never rewrites stored figures
   and `poolLadderOf` reads the old shape — but the waterfall changes what a
   RECOMPUTE pays, so pressing Recalculate on them moves the numbers. By design,
   and only on test data.
2. ~~**Migrations 0039 and 0040 have not been applied to production.**~~
   **Applied 2026-09-15** (39 → 41), with 0 rows curated and 0 granted after.
3. **The terminology session** (`123qy9rng6d`) is still in backlog. Ran's standing
   note — *"the language across the new design is super confusing … we need to redo
   this together"* — still stands, and vocabulary decided there overrides every
   caption this work drew.
4. **Where we deliberately differ from the design**, each with its reason in the
   code: curation is per participant rather than per role (a real bill has two
   performers); there is no separate read-only ticket-sales table (our tiers are
   edited as quantity × price, so the mismatch its warning exists to report cannot
   arise); a curated view still never shows the event's totals (the prototype's
   does, by derivation); and curation is click-only, not drag.
5. **Ticketing provider sync** is advertised by the design and does not exist.
   `packages/settlement/src/ticketing.ts` is the seam; the screen says so in words
   rather than drawing a dead button.
