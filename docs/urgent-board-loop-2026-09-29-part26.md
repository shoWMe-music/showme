# Urgent board loop — 2026-09-29, part 26

Part 25 closed QA10-6/QA9-7, QA10-7, QA9-12's render half and QA9-10, and reached 373 lines. **Run 9
is now fully closed.** What is left of run 10 is two cosmetics, one MINOR about realtime, and one
NOTE that turns out to be about a ruling rather than a screen:

| Finding | Sev | One line |
|---|---|---|
| QA10-8 | MINOR | A settlement recompute does not reach a second operator's open screen |
| QA10-16 | COSMETIC | *"You have 1 thing that need attention today."* |
| QA10-17 | COSMETIC | REVENUE / GUEST and COST / GUEST print the totals when no tickets are planned |
| QA10-21 | NOTE | The wizard's deal auto-sends, so §25.7.2's Delete-draft branch is unreachable from the primary path |

---

## 1. QA10-16 and QA10-17 — the plan, before building

**Which files settle them:** `apps/web/src/routes/Dashboard.tsx:330` and
`packages/shared/src/budget-planning.ts:536`.

### QA10-16 — one verb

`{n} {n === 1 ? "thing" : "things"}` and then, outside the ternary, a flat `that need attention
today`. The noun agrees and the verb does not. One-line fix, nothing hidden in it.

### QA10-17 — a per-guest figure with no guests

**The verdict: this is not a formatting problem on the band, it is a wrong number in the engine.**

```ts
const guests = attendees > 0n ? attendees : 1n;
…
revenuePerGuest: totalRevenue / guests,
```

The `: 1n` is a divide-by-zero guard, and a guard that returns a plausible wrong answer is worse than
the throw it prevents: with no tickets planned, "revenue per guest" comes back as **the entire
revenue**, which is what the sweep read (`TICKETS PLANNED 0 · REVENUE / GUEST SEK 100,000`). Fixing
it on the band would leave the same wrong figure for the next reader — and there already IS a next
reader: `budget-csv.ts:143` exports both, so the sheet somebody opens in Excel carries the same
number with no band to contradict it.

So the figures become `bigint | null`, null meaning *"nobody is coming, so there is no per-head
anything"*, and both readers print `—`. That is the ruling the same band already made about
`PROFIT MARGIN` for the same reason (QA7-26: *"a margin of nothing is not 0.0%"* — `—` is what the
app says everywhere else for "nothing to show").

**And the CSV never got QA7-26.** `budget-csv.ts:139` still writes
`Profit margin ${marginPercent.toFixed(1)}%` unconditionally, so an empty sheet exports **0.0%** —
the exact figure the band stopped printing two sweeps ago. Same shape as QA9-12's invoice modal,
which kept the null-means-dash rule on two sibling fields and not on the third: **a rule enforced at
one reader is enforced at one reader.** Fixed here, because the export is the copy that leaves the
building.

**The decision it hides: does `—` in a CSV cell break a consumer?** No: the column already carries
prose in the same rows (`Break-even tickets` writes `No break-even` through `plainRow`), so a
non-numeric Results cell is established, and every one of these rows is a human-readable export
rather than a machine feed.

## 2. What landed

### QA10-16 · QA10-17 — the verb, and a guard that answered

**QA10-17, read on the running stack** as `operator@` on Winter Gala's empty sheet:

```
TOTAL REVENUE SEK 0 · PROFIT MARGIN — · TICKETS PLANNED 0 · REVENUE / GUEST — · COST / GUEST —
```

The three dashes now agree; before this, the two per-guest cells printed the totals beside a
`PROFIT MARGIN —` that had already made exactly this call.

**The test that had to change is the interesting part.** `budget-planning.test.ts` asserted
`revenuePerGuest` was `0n` under the name *"does not divide by zero when capacity is unset"* — and
it passed because that fixture has **no revenue either**, so `revenue / 1` happens to be zero. It
was accidentally right in precisely the way QA10-6's caption was accidentally right at a 50/50
split, and it would have passed over the defect it was named for. It now asserts null, and a second
test puts money on a sheet with nobody coming — the shape the sweep actually read.

**And the export never got QA7-26.** `budget-csv.ts` still wrote `Profit margin 0.0%` on a sheet
with no revenue, two sweeps after the band stopped. Same shape as QA9-12's invoice modal keeping the
rule on two sibling fields and not the third: **a rule enforced at one reader is enforced at one
reader**, and the CSV is the copy that leaves the building.

QA10-16 is one ternary. The plural branch is verified live (*"You have 5 things that need attention
today."*); the singular is the other arm of the same expression, and forcing a seat to exactly one
attention item was not worth the fixture.

---

## 3. QA10-8 — the plan, before building

**Which file settles it:** `apps/api/src/routes/settlement.ts`, and **not**
`apps/web/src/hooks/useRealtimeStream.ts`, which is where the report points.

**The finding.** With the co-host's Settlement tab open, the host changes the operator cost split to
25/75 and recomputes. The co-host's screen keeps the previous figures — *"the party who is owed money
watched their own figure change by SEK 7,875 and saw nothing"* — until a hard reload.

**The verdict: the client half is already fixed, and the sweep is describing the world before QA6-3.**
It says *"`useRealtimeStream.ts` invalidates only the notifications query and, for
`event.message_posted`, the message and thread queries — nothing invalidates the deal, budget or
settlement caches."* That was true; it is not now. `isEventQueryKey` replaced the hand-written
seven-key list with a predicate over the whole cache, so **any** frame carrying an `eventId`
refetches every mounted query under `/api/v1/events/:id` — the settlements read included. **Fourth
time in this stretch that a report names a real symptom over the wrong line**, and the first where
the wrong line is a quotation of a comment that was accurate when the sweep read it.

**What is actually missing is a frame.** `POST /events/:id/settlement/compute` writes an audit row
and returns. It calls neither `notifyUsers` nor `publish`, so nothing is emitted and there is
nothing for the client to act on. And it is not alone — of this plugin's twelve mutating routes,
**seven are silent**: compute, the per-settlement PATCH (manual overrides), the three settlement-line
routes, and the curation PUT. Each of them moves a figure on another operator's open screen.

**The scope: one hook at the edge, not seven `publish` calls.** A rule kept in seven handlers is a
rule the eighth handler will not keep — this file's own history is the argument (`isEventQueryKey`
exists because a hand-maintained list of twenty-four keys was missing the one that mattered). So an
`onResponse` hook on the settlement plugin publishes one frame per successful non-GET request that
names an event, to `eventParticipantRecipients` — which already drops the actor.

**The decision it hides: does a recompute deserve a BELL?** No, and saying why matters because the
client currently gives no choice: `handleEvent` rings on *every* frame and refetches the bell, on the
stated premise that *"every event this service emits is either a notification or implies one."* A
recompute breaks that premise — it is a **freshness** event, not news. An operator iterating on a
split would ring the co-host's speaker once per attempt, and the settlement milestones that ARE news
(`pending_review`, finalized, paid) already write notifications with a preference gate behind them.

So the frame carries `quiet: true`, and the client skips the sound and the bell refetch for it while
still invalidating the event. That is a new idea in this codebase, so it is stated once, in the
payload, rather than inferred from a type name — the type vocabulary is 65 strings in another
package and keying behaviour off it is the mistake `useRealtimeStream`'s own comment warns about.

## 4. Next

- **QA10-21** — the wizard's deal auto-sends, which makes §25.7.2's *delete while draft* branch
  unreachable from the primary path. A NOTE about a screen that is really about a ruling.
- Then the full pass with the stack down in ONE go, and qa-sweep run 11.

### QA10-8 — what landed

**Proven on the running stack, from the other side of the seat problem.** One browser profile
means one session, so instead of two watchers the reader was `operator@` and the *co-host* did the
computing (`api-as.mjs coHost POST …/settlement/compute`). The Settlement tab went from

```
SETTLEMENT · Not reconciled yet · This event hasn't been reconciled yet
```

to the full document — `SEK 50,000 · You owe`, the operator's card, Marlo Vance's 60% line — **with
no reload and no navigation**, and the network log names the cause rather than leaving it to
inference:

```
…/events/…e1            …/participants   …/permission-sets   …/change-request
…/settlements           …/deals          …/settlement/comments
```

one burst, immediately after the compute, and **no `/notifications` request in it**. That absence is
the `quiet` flag working: any ordinary frame refetches the bell first. A patched `AudioContext`
counted **0** oscillators over the whole exchange, and the bell stayed on its existing *1 unread*.

Four mutations killed on the hook — a frame that is not quiet, a refused request publishing anyway,
a GET publishing, and the actor being nudged about their own request. The client half (`if
(!event.quiet)`) has no automated cover: `handleEvent` is a closure inside the hook with no seam,
and the tone count above is its proof. Recorded rather than papered over.

**Two things the test itself had to learn.** The nudge is deliberately `onResponse` — *after* the
reply is sent, so a failing notify can never reach the caller — which means `inject()` resolving says
nothing about whether the frame exists yet. The first draft asserted immediately and read zero. It
polls now, and the two negative cases wait the same window before concluding nothing was published:
**an absent frame is the weakest evidence there is.**

**Fixture hygiene:** the compute wrote six settlement rows onto the seeded Album Release; restored
with `seed:e2e` and verified back to one row and no settlement lines.

---

## 5. QA10-21 — a NOTE about a ruling, answered where the ruling lives

**Which file settles it:** `docs/decisions.md` §25.7.2, and no code.

The sweep filed it as *not a defect*, correctly: the New-event wizard writes its deal as a `draft`
and `useDealAutoSend` sends it once a five-second undo window closes — deliberate, documented, and
the product owner's own request. Measured by the sweep at six seconds, start to `sent`.

**Checked rather than assumed:** `useDealAutoSend` has exactly one caller, `NewEventWizard.tsx`. The
Deals tab's own *New deal* saves a draft and does not send it, so §25.7.2's Delete-draft branch is
genuinely reachable — it is the WIZARD's path, the common one, that is past the line in six seconds.

So the note belongs against the ruling, not in a code change: §25.7.2 now carries how far its delete
branch reaches, and that on the common path the remedies are the undo window, the edit (ticketed)
and `cancelled`. The next person weighing *"cancelled clutters every party's Deals tab forever"*
should weigh it knowing that `cancelled` is what the wizard's path almost always produces.

**Reversing that — letting a `sent` but unsigned deal be deleted — is Daniel's call and not mine**,
which is why nothing here moved.

## 6. Next

- The full pass with the stack down in ONE go: biome, shared, auth, settlement, web, the full API
  suite reconciled against the 1423 baseline plus this stretch's additions, then e2e including
  `motion.spec.ts`.
- Then qa-sweep run 11.

---

## 7. The full pass, stack down, one go

| Check | Result |
|---|---|
| `biome check .` | 742 files, clean |
| `@showme/shared` | **333** passed |
| `@showme/auth` | **35** passed |
| `@showme/settlement` | **74** passed |
| `@showme/web` | **507** passed |
| `@showme/api` | **1440** passed, 0 failed |
| `pnpm test:e2e` | **116** passed, exit 0 |

**The API count needs its arithmetic shown, because the raw run does not read as green.** It ended
`4 failed | 61 passed (65)` files and `1337 passed | 103 skipped (1440)` tests — **zero failed
tests**, four lines matching *"waiting for container ports"*, and four whole files lost to the
Testcontainers port-bind flake: `deals`, `exchange-rate`, `invoices`, `off-platform`. Re-run one at a
time with the ryuk container pruned between each: **77 + 6 + 15 + 5 = 103**, exactly the skipped
count, all green. So the suite is 1440 passing and the flake took nothing with it.

e2e is **116**, up from the 112 this repo's own lesson records — the four `motion.spec.ts` tests,
reduced-motion path included.

---

## 8. Where the BOARD stands, which is the loop's own stopping condition

Run 11 is sweeping, so this is the read-only question worth answering while it does: **is the
audit's open list actually closed?** `docs/clickup-urgent-audit-2026-09-27.md` §5 — *"Real, open, and
the file that settles it"* — is the audit's own list of what remained. Twelve tickets. Every one now
has at least one commit naming it, and the five with only a single commit were checked by subject
against what the audit said was wrong:

| Ticket | The audit's complaint | The commit |
|---|---|---|
| `123qy9rnh3f` | the reopen reason is stored and reaches neither payload nor bell | `6138f36` *a reopened agreement says why, on the deal and in the bell* |
| `123qy9rnf9d` | two fields, "Artist / performer" and "Performer profile" | `eabe6a1` *the wizard's first field is the event's name, and says so* |
| `123qy9rnk3m` | auto logout: nothing exists | `33de6db` *sign an unattended screen out after an hour* |
| `86cbcf6gr` | genres exist on the profile and are not shown on the event | `2632ab7` *the bill says what kind of act is on it* |
| `123qy9rpdum` | an imported entry shares the `concluded` tint | `2584982` *an imported entry gets a hue of its own* |

The other seven carry two to ten commits each. So the audit's §5 is worked through, and what is left
of "the board's urgent work" is three things, none of which is a ticket I can close by building:

1. **The three design-blocked tickets** — `86cbcn1q4`, `86cbcn1rr`, `86c9mq7q9` — waiting on
   `/design-login`, because `claude-design`'s rule is that the prototype is rendered, never read.
2. **Six open product questions in `decisions.md` §25.6**, plus §25.7.1's follow-up. Only Ran or
   Daniel can answer them, and one of them (the cross-currency tile) blocks half of QA9-10.
3. **Whatever run 11 finds.** Runs 9 and 10 between them produced thirty-odd findings against code
   that had already passed every suite, so a sweep coming back clean is a better stopping signal
   than a board with no rows left — and no sweep has come back clean yet.
