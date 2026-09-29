# Urgent board loop — part 33 (2026-09-30)

Continues `docs/urgent-board-loop-2026-09-30-part32.md`, which closed at 474 lines.
Source of work: `docs/clickup-urgent-audit-2026-09-27.md`, `docs/decisions.md` §25, and the
findings of `docs/qa-sweep-2026-09-30-run13.md` that are still open.

**State at the cut.** `5041ab1`, tree clean. Dev stack up (API standalone on 8080, web 5180).
Seed NOT pristine — run 13 left nine deals on e1, a "QA13 Clash Night" event and extra tasks;
the e1 settlement is computed and sitting at `pending_review`.

**Closed from run 13 so far:** the BLOCKER (`13030ef`, a deal's author can reach it), the MAJOR's
half (a) (`1de85f8`, a cancelled deal discloses nothing), the bell's message row (`5041ab1`).

**Open from run 13 entering this part:** four MINORs (262, 292, 333, 353), four COSMETICs
(375, 389, 400, 414), two NOTEs (430, 447).

---

## 1. Run 13 MINOR (262) — "Confirm <show>" offered to every account kind

> Dashboard, as `performer.a@`: the attention card's only row reads *"**Confirm Nordic Synth
> Showcase** · On hold · 5 Dec 2026 · needs a decision · Review"*. The row lands on an event
> whose performer view has no status control at all, and
> `PATCH /events/<e4> {"status":"confirmed"}` answers **403 Missing capability: event.edit**.

### Which file settles it

`apps/web/src/components/attentionList.ts:168-185` — the event loop of `buildAttentionList`.
It tests `NEEDS_DECISION.has(event.status)` and **nothing else**, so every event in
`pending | suggested | on_hold` becomes a "Confirm …" row for whoever is reading, whatever
their relationship to the night.

### The verdict — a real dead affordance, and the signal to fix it is already on the wire

`NEEDS_DECISION`'s own docstring says what the set means: *"Events still waiting on an
**operator** decision."* The line above it is a claim about the reader that the loop never
checks — **a comment that states a rule is a test that never runs**, thirty-first instance.

The gate does not need a new field. `apps/api/src/serialize/event.ts:101` already serves
**`capabilities: string[]` — the caller's own effective capabilities on that specific event** —
and `apps/api/src/routes/events-list.ts:198` declares it on every list row, computed per row by
`eventCapabilities` and batched with the page. The generated client has it
(`getApiV1Events200ItemsItem.capabilities`). So this is a **web-only** fix: no route change, no
`sync-spec`, no regeneration.

That field exists for exactly this, and its docstring says so:

> *"Naming the set is what lets a button exist only when the click behind it would be allowed."*

It was added after **QA4-9**, which is the same defect one screen over: the Events list offered a
performer *"Cancel show…"* and *"Delete permanently…"* on a night they had merely played. The
attention card is the fifth instance of **a name the API DOES serve that the screen ignores**.

Which capability: `event.edit`. `apps/api/src/routes/events.ts:1419` — *"Write: authorize
`event.edit`"* — is the route behind the word "Confirm", and it is the capability the 403 in the
report names. `serialize/event.ts:151` calls it "the operator signal — performers/crew never
hold it", which is also why this cannot be gated on `AccountKind`: a co-promoting operator holds
`event.edit` on the night they co-promote and must keep the row, while an `agent` holds
`deal.edit` and `agreement.manage` on a night they may not confirm (decisions #14).

### Scope

1. `AttentionSources.events` gains `capabilities: readonly string[]`.
2. The event loop drops any row the reader cannot act on, beside the status test.
3. Tests: **a test per clause** of the two-clause guard, plus the CONTROL (an event in
   `NEEDS_DECISION` *with* `event.edit` still appears, so the empty above is the capability and
   not the status), plus the crew/agent shapes the sweep could not observe in this seed.
4. `Dashboard.tsx` passes the list through unchanged — `eventList` rows already carry the field.

### The decision it hides — and it is NOT one for Daniel

Should a performer standing on an `on_hold` night see *something* instead — "The Lantern Hall
has not confirmed this yet"? **No, and the module's own contract settles it** rather than a
product ruling: the card is *"what somebody **else** is waiting on"* (its first line). Nobody is
waiting on the performer here; the operator is. A row for it would be the reader's own *watching*,
not their work — the same distinction the docstring already draws against tasks. The two existing
reader gates in this module are precedents built the same way: `answerableByYou` on invitations
(decisions §25.7.3, the act sees and the agent acts) and `signableByYou` on settlements, which
was found in the browser after the card told a crew member to sign off something `CREW_FLOOR`
forbids. This is the third of the same shape, and it belongs beside them.

### Built — `attentionList.ts`, web only

```ts
/** THE CAPABILITY BEHIND THE WORD "CONFIRM" — `PATCH /events/:id` authorizes `event.edit`. */
const MAY_DECIDE_EVENT = "event.edit";

for (const event of sources.events) {
  if (!NEEDS_DECISION.has(event.status)) continue;
  if (!event.capabilities.includes(MAY_DECIDE_EVENT)) continue;
```

`AttentionSources.events` gained `capabilities: readonly string[]`. `Dashboard.tsx` needed no
change — it passes `events.data.items` straight through and the field was already on every row.

The test fixtures moved to a `decidable()` factory beside the existing `invitation()` and
`settlement()` ones, **because `capabilities` is a gate**: left as inline literals, every fixture
that omitted it would quietly stop qualifying and the suite would go green by all its rows
vanishing — the precise failure mode this file was written to catch.

### Proved on the running stack

`GET /events`, the on-hold Nordic Synth Showcase row, per seat:

| Seat | `event.edit` on that row |
| --- | --- |
| `operator@` | **true** |
| `performer.a@` | false |
| `agent@` | false |
| `professional@` | not on the night at all |

So the report's "structural, so it applies to `agent@` too" is confirmed at the source: the
agency's set really does lack it, which is the case `AccountKind` would have got wrong in the
other direction.

Browser, Dashboard:

- `operator@` — **unchanged**: *"You have 6 things that need attention today"*, with both
  *"Confirm QA13 Clash Night"* and *"Confirm Nordic Synth Showcase"* still on the card.
- `performer.a@` — the dead row is gone and the card is honest:
  *"You're all caught up — nothing needs your attention today."* The show is no longer named
  on the Dashboard at all. It was the card's ONLY row, so "caught up" is the true answer:
  Marlo owes nothing here; the Lantern Hall owes the decision.

### Mutations — four, all killed

| Mutation | Result |
| --- | --- |
| delete the capability clause | 2 failed |
| invert it (`includes` → keep only those who cannot) | 9 failed |
| gate on `event.view` instead of `event.edit` | 2 failed |
| delete the STATUS clause | 2 failed |

The third matters most: every non-deciding fixture holds `event.view`, so a gate on the wrong
capability is caught rather than passing for looking plausible. The fourth is the control that the
new clause did not quietly replace the old one.

### Suites

`npx biome check .` 748 files clean · web **605 passed** (up from 602) · `tsc --noEmit` clean.
No API change, so no `sync-spec`, no regeneration, no API restart.

**Committed as `TBD` — see below.**

