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

**Committed as `1fdecf2`.**

---

## 2. Run 13 MINOR (292) — the approval badge's denominator moves, 0/4 → 1/5

> The host's roster reads **0/4** with *"Not required"* on Astra Booking Agency. The agency signs
> its own line (`POST …/confirm` → 200). The host re-reads: **1/5**, the agency now *"Signed off"*.
> And before the signature, **4/4 read as "everyone has signed"** while a party that can and may
> sign had not.

**This is my own incomplete fix from `2e77e65`.** Not a regression on somebody else's code.

### Which file settles it

`apps/api/src/routes/settlement.ts:2126` — the one line that derives the expectation:

```ts
floorMaySign.set(row.id, baselineCapabilities(row.role as EventRole).includes("settlement.confirm"));
…
signatureExpected: (floorMaySign.get(participantId) ?? false) || approved,
```

### The verdict — the FLOOR is the wrong question, and `|| approved` was covering for that

`signatureExpected`'s own docstring already admits the gap and then patches it instead of closing
it:

> *"`settlement.confirm` IS grantable to crew (`isGrantable` — it is not a pool capability), so an
> operator can hand it to one crew member through a permission set, **which the floor cannot see**.
> Counting an existing signature as its own proof absorbs that case."*

Absorbing it is what makes the number move: the answer becomes **retroactive**, deciding itself
from the party's own action rather than from a standing fact. **One field answering two
questions** — "is this line waiting on somebody" and "has somebody already proved they could sign
it" — and the second silently rewrites the first.

**Measured in the seed, and the floor is wrong about the agency for exactly that reason:**

```
role       party                  preset                        grants settlement.confirm
host       The Lantern Hall       Operator — full               t
co_host    Northlight Presents    Operator — full               t
performer  Marlo Vance            Performer — own slice         t
performer  Neon Tide              Performer — own slice         t
crew       Priya Sound            Crew — schedule only          f
agent      Astra Booking Agency   Agent — represents performer  t   ← the floor cannot see this
```

The agency's preset grants `settlement.confirm` — that is **how an agency signs for its act**
(decisions #14, §25.7.3), and a permission set is attached to a PARTICIPATION, so it inevitably
also reaches the agency's own line. So `/settlements/awaiting-signature` offers that line
correctly (it asks `effectiveEventCapabilitiesForEvents`, which unions floor and band), the
confirm route accepts it correctly, and only the roster — asking the floor alone — calls it
"Not required". **Three surfaces, two different questions.** Fifth instance of *a ruling
implemented on one of its two surfaces*.

### The scope — ask the band as well as the floor, so the answer is a STANDING fact

`packages/auth/src/authorize.ts:144-158` is the algebra to mirror:

```
effective = floor(role, delegated) ∪ { c ∈ roleFilter(granted, profileRole) : isGrantable(c, role) }
```

The roster cannot ask `roleFilter`, and its docstring is right about why: `profileRole` belongs to
a MEMBER, so a party with three members has no single answer. But the **upper bound** is well
defined and is the right question here — `roleFilter` returns the full set for `owner` and
`admin` (`presets.ts:216`), and **every profile has an owner**. So "could a signature arrive from
this party at all" is:

```ts
baselineCapabilities(role).includes("settlement.confirm") ||
  (granted.includes("settlement.confirm") && isGrantable("settlement.confirm", role))
```

`delegated` stays out of `baselineCapabilities`, unchanged and for its recorded reason: delegation
moves WHO signs, not WHETHER a signature is expected.

Under this, the seeded night reads **0/5 → 1/5**. The denominator never moves, and 4/4 can no
longer claim everyone has signed while the agency has not.

### `|| approved` stays, and its ROLE INVERTS

It stops being the patch that causes the movement and becomes the stabiliser against the one case
the union genuinely cannot predict: an operator **revoking** the grant after a signature, which
would otherwise drop the denominator below the numerator. That case is reachable, so it gets a
test of its own rather than a comment — a branch nothing can reach is not a safeguard.

### The decision it hides — recorded, NOT a new §25.6 row

Should an `agent`'s own participation line be offered for signature at all, given #14 says its own
line is entitled to nothing? It is a zero line and signing it harms nobody, the offer is a
consequence of a preset that exists for a different and correct reason, and narrowing it would be
a product change on a shipped surface. Noted for Daniel in passing; not raised as a sixth open row,
because the reported defect is fixed either way and a row nobody needs dilutes the five that are live.

### Built

`apps/api/src/routes/settlement.ts` — the derivation now left-joins the participation's permission
set and asks both halves:

```ts
const maySign = new Map<string, boolean>();
for (const row of participantRoles) {
  const role = row.role as EventRole;
  const granted = (row.granted ?? []) as Capability[];
  maySign.set(
    row.id,
    baselineCapabilities(role).includes("settlement.confirm") ||
      (granted.includes("settlement.confirm") && isGrantable("settlement.confirm", role)),
  );
}
```

`signatureExpected` keeps its name, type and schema, so **no `sync-spec` and no regeneration**.

**Three comments were stating the superseded rule and are corrected**, since a comment that states
a rule is a test that never runs and this fix falsified all three at once:

- `settlement.ts`'s own paragraph *"So the expectation follows the ROLE alone. An `agent`
  participation is still not expected…"* — true about the floor, false about the agency.
- `EventSettlement.tsx`'s badge note *"Derived from each party's floor … this reads 5/5 today"*.
- `useEventSettlement.ts`'s *"`signatureExpected` already absorbs a party who has signed"*.

### Proved on the running stack — at exactly the reported moment

The agency's approval row was deleted, the host's roster read, the agency re-signed through the
API, the roster read again. API restarted first (it does not hot-reload).

| | Badge | Astra Booking Agency | Priya Sound |
| --- | --- | --- | --- |
| before the signature | **0/5** | Pending | Not required |
| after the signature | **1/5** | Signed off | Not required |

Previously this was **0/4 → 1/5**. The denominator is now the same number on both sides, and
`4/4` can no longer claim everyone has signed while the agency has not. Priya keeps "Not required"
— the run 12 fix is intact, because her crew preset genuinely does not grant it.

Read the same way in the browser, on the Settlement sub-tab the report screenshotted:

```
Approval Status  0/5
The Lantern Hall (you)   Operator      Pending   [Approve]
Marlo Vance              Performer     Pending
Neon Tide                Performer     Pending
Priya Sound              Crew          Not required
Northlight Presents      Co-operator   Pending
Astra Booking Agency     Agent         Pending        ← was "Not required"
```

The seed is back to the state run 13 left it in (the agency signed).

### Mutations — five, four killed, and the survivor is the interesting one

| Mutation | Result |
| --- | --- |
| floor only — drop the band (the original defect) | 2 failed |
| band only — drop the floor | 1 failed |
| **drop the `isGrantable` ceiling** | **SURVIVED** |
| drop `|| approved` (the revocation stabiliser) | 1 failed |
| always expected | 2 failed |

**The survivor is REDUNDANCY, not a gap — and this time the line stays.** `settlement.confirm` is
in none of the three ceiling sets (`POOL_CAPABILITIES`, the performer-authored set, the
operator-filing set), so `isGrantable("settlement.confirm", role)` is constant `true` for every
role and nothing can currently distinguish its presence.

The four previous survivors of this shape were deleted. This one is kept, because it is the second
copy of `effectiveEventCapabilities`'s union and keeping the two copies *identical* is what stops
them disagreeing — dropping the ceiling here would have the roster claim a signature from a party
who could never be granted one, the moment that set changes.

What makes keeping it honest rather than decorative: the assumption is now **executable**, in
`packages/auth/src/authorize.test.ts` —

```
settlement.confirm sits under no ceiling — which a second reader relies on
  ✓ is grantable to EVERY event role, so a preset can carry it to any party
```

Verified it can fail: adding `settlement.confirm` to `POOL_CAPABILITIES` fails **that test and
only that test** (1 failed | 36 passed), and its body names the roster as the second place to
look. Restored.

### Tests

`settlement-own-read.test.ts` 15 → **17**:

- the granted-party test was retitled and **reads the roster BEFORE the signature**, which is the
  whole defect — the old version read it only afterwards and so could not tell "counted because
  they CAN" from "counted because they DID". It now asserts the denominator is the same number on
  both sides, and that before the signature `approved < expected` (the thing "4/4" claimed).
- **the agency case, with its control**: an `agent` participation whose preset grants the
  capability is expected; one with no grant is not. Neither has signed, so nothing there can be
  `|| approved` answering for the band.
- **the revocation case**, for `|| approved` — a branch nothing can reach is not a safeguard.

`authorize.test.ts` 36 → 37.

### Suites

`npx biome check .` 748 clean · web **605** · API `settlement-own-read` + `settlement` **141
passed** · auth **37** · `tsc --noEmit` clean on api and web.

