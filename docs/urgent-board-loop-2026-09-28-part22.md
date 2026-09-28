# Urgent board — sweep run 9 (2026-09-28, part 22)

Run 9 verified **ten of ten** of the previous tick's fixes, plus run 8's three number fixes and run 7's
eleven. It then found **19 new items** — 4 MAJOR, 10 MINOR, 2 COSMETIC, 3 NOTE — and three of the
"holds" carry a residual it filed separately rather than calling a regression, which is the right
call: QA9-8 and QA9-14 are both leftovers of my own fixes, one card below where I stopped.

Order here: **QA9-1 first, because it is a leak and not a wrong number.** Then QA9-2, then the two
residuals of this loop's own work, then the rest.

---

## QA9-1 — the host's all-time revenue includes the CO-HOST's private book

**Which file settles it:** `apps/api/src/routes/insights.ts:74-79`.

**Verdict: real, and it is a cross-party leak rather than an arithmetic error.** That is what moves
it to the front of the queue. `/projections` shows the host:

```
PROJECTED REVENUE  SEK 216,000     4 events budgeted
Every figure here comes from the event's shared ledger.
…
All time, as host — ignoring the filter above: budgeted revenue SEK 238,345 across 5 events you hosted.
```

The SEK 22,345 difference is the two private books on one co-promoted event — and **SEK 12,345 of it
is Northlight's**, a figure the host is not entitled to see at all. The sweep proved it by moving
one: before the co-host typed anything the footnote read SEK 226,000; after, SEK 238,345.

The query filters on `events.hostProfileId` and `budgetLines.kind` and **nothing else** — there is no
`budgets.scope` predicate. `PLAN.md:215` is explicit that a private book is *"the extra an operator
MAY ALSO keep, existing only once there is a co-host to keep it from"*, and the **detail** route
already enforces it (`visibleBudgetFilter`, verified both directions by the sweep). So the aggregate
contradicts the detail route it sits above, and the screen's own sentence is true of the panel and
false of the line three below it.

**Scope:** one `where` clause. The route has exactly one consumer, so one screen leaks; the
`…/summary` beside it counts events and is unaffected; and the sweep confirmed **the settlement does
not leak** — recomputed with both private books present, `ladder.revenue` stayed `8300000` and
`Σ net = 0`.

*Why `shared` only, and not "shared plus my own":* the figure sits under *"Every figure here comes
from the event's shared ledger"* and beside a panel that `projectFromBudgets` already filters to
`scope === "shared"`. Including the reader's own private book would make the footnote disagree with
the panel in the other direction and keep the sentence false. One definition, and it is the panel's.

*The decision it hides:* none. PLAN.md:215 settles what a private book is, and the detail route
already implements it — this is the aggregate catching up.

### Built, and proven on the running stack

One predicate. Proven by reproducing the sweep's own setup — a co-host private book with a
**SEK 12,345** revenue line, created as `co.host@` through the API — and then reading the host's
figures:

| | before (run 9's measurement) | after |
|---|---|---|
| `GET /insights/profiles/…a1/revenue` | `23834500` | **`21600000`** |
| `/projections` panel | SEK 216,000 | SEK 216,000 |
| `/projections` footnote | **SEK 238,345** | **SEK 216,000** |
| the private line in the database | present | **still present** |

That last row is the point: the money was not deleted, it stopped being counted by somebody who is
not entitled to it. The panel and the footnote now agree, and the screen's own sentence — *"Every
figure here comes from the event's shared ledger"* — is true of both.

Two tests (the shared-only sum, seeding **both** a private book of the host's own and another
profile's, because the two are excluded for different reasons) and two mutations red: the scope
filter dropped, and inverted to private-only.

The line refused a `collectedBy`-less revenue line on the way in, which is worth noting as the
system working: *"Revenue nobody collected raises the pool while nobody holds it, and the settlement
can never balance."*

---

## QA9-2 — three classes of user are silently mute

**Which file settles it:** `packages/auth/src/presets.ts` — four floors.

**Verdict: real, and an omission rather than a rule.** `message.post` lives in three PRESETS
(`operator_full`, `performer`, `agent`) and in **no floor**. Three consequences, each with its own
cause:

1. **A represented act.** `authorize.ts:150` is explicit — `if (delegated) continue; // no band for a
   delegated performer` — so a delegated performer's effective set is **exactly**
   `DELEGATED_PERFORMER_FLOOR`, and their preset is not consulted at all. That is the sweep's airtight
   contrast: `performer.a@` 403 and `performer.b@` 201 on the same event in the same role, the only
   difference being representation.
2. **Every crew member, always.** No crew preset carries `message.post` either, so `CREW_FLOOR` being
   thin is the whole story. `story.md`'s crew boundary is about the **budget** (*"they see the
   schedule and their own deal, never the budget"*), not about telling the operator when the truck
   arrives.
3. **Anyone the app itself onboards.** Invite Collaborator does not render an ACCESS control for a
   `Performer` role — *"Only a co-operator can be granted more than their role's own access"* — and
   the accept path copies a null `permissionSetId`. So on every event the app creates, the act lands
   on the bare floor and cannot speak. Messaging works on the seeded events only because the **seed**
   attaches a set.

**The rule the floors already state settles it.** `DELEGATED_PERFORMER_FLOOR`'s own docstring: *"they
keep their VIEW floor plus artistic authorship — the BUSINESS action capabilities (confirm/approve)
move to the agent. **Delegation, not revocation**."* Posting a message is neither business authority
nor artistic content, so by that rule it never should have moved. For crew and for a default invite
there is no delegation at all, so nothing explains it.

**And the capability cannot open a door it should not — verified, not assumed.**
`resolvePostTarget` gates the operators-only thread on `access.isManagingOperator` (*"Posting into a
room you cannot read is not a feature"*) and a party thread on `readableThreadParticipantIds`, both
independent of `message.post`. So the capability means only *"you may speak where you can already
read"*, which is why adding it to a floor is safe.

**Scope:** `message.post` joins `PERFORMER_FLOOR`, `DELEGATED_PERFORMER_FLOOR`, `CREW_FLOOR` (and so
`CREW_LEAD_FLOOR`, which spreads it) and `OPERATOR_FLOOR` — the last because a **co-host** invited at
default access is mute for the same reason. The `agent` floor stays `["event.view"]`: an agent
participation is the projection of a representation and always arrives with the agent preset
attached, which carries `message.post` already.

*The decision it hides:* whether muteness was ever intended. Nothing says so — not `story.md`, not
`decisions.md` #4, and not the floors' own docstrings, which argue the opposite. Taken as an
omission, and recorded here so overruling it is a change to four named lines.

### Built, and proven on the running stack

`message.post` on four floors. Proven with the sweep's own contrast, after an API restart:

| | before | after |
|---|---|---|
| `performer.a@` (represented) posts to their party thread | **403** *Missing capability: message.post* | **201** |
| `professional@` (crew) posts to theirs | **403** | **201** |
| `performer.a@` in the browser, `?tab=messages` | no input, no Send, no sentence | **`Message Everyone…`** and a **Send** |

**And the boundary it must not cross, checked rather than assumed:**

| | result |
|---|---|
| `performer.a@` → the **operators-only** thread | **403** *Missing capability: budget.view* |
| `professional@` → the **operators-only** thread | **403** *Missing capability: budget.view* |
| `performer.a@` → **another act's** party thread | **404** *Thread not found* |

Which is exactly what `resolvePostTarget` promised: the capability grants a voice, never a room.

**Four tests and five mutations red** — the delegated act loses its voice · crew lose theirs · the
operator floor loses it · the agent floor is widened · confirms come back to a delegated act. The
last two are the guard rails: the agent floor must stay a projection, and the delegated act must gain
a voice **without** gaining business authority, which is the boundary its own docstring draws.

*The second half of the finding needs no build.* The sweep's alternative was to render the refusal
where `canPost` is false; with `message.post` on every participant floor there is no participant for
whom it is false, so the sentence would be unreachable copy. `canPost` stays on the wire and the UI
still reads it, which is what makes a future custom permission set legible rather than silent.

---

## QA9-8 and QA9-14 — the two residuals of this loop's own fixes

The sweep filed both as new findings rather than regressions, which is the right call: each is a
place the previous fix stopped one line short.

### QA9-8 — the agent's card said SEK 0 under a headline saying SEK 3,000

QA8-4 moved the headline to net + commission and left the card beneath it printing **SEK 0 with no
rows at all** — the one place on the screen telling the agent they earned nothing, two cards above a
commission card saying otherwise. Exactly the one-line-apart contradiction QA7-28 was filed for,
reintroduced by its own fix.

The card's headline is the ENTITLEMENT and an agent's is genuinely zero, so the commission goes where
the cash and the advance already are — under the divider, as the thing that explains the distance
between the entitlement and what moves. Which is what QA8-5 opened that divider for.

Decorated in the hook rather than in `toParty`, because `ownParticipantId` is derived FROM `parties`
and the commission cannot be known while they are being built.

**Proven as `agent@`:** *"Astra Booking Agency (you) · Agent · **SEK 0** · Your commission on this
night **SEK 3,000**"* — and the headline above it still reads SEK 3,000, so the column now arrives at
the figure the headline states.

### QA9-14 — two minus spacings in one card, under a comment claiming they agreed

QA8-12 unified the GLYPH (U+2212 everywhere, the hyphen gone) and left the spacing. Five call sites
each drew their own: four `− ${value}`, one `−${value}`, so one "Revenue & deductions" card printed
`−SEK 12,000` in its line items and `− SEK 33,000` in its own summary rows beneath.

**And the comment beside the odd one out claimed the opposite** — *"so the two agree about what a
negative figure looks like on this screen"*. They did not. Ninth instance this stretch of a comment
asserting a rule the code does not keep, and this one was written by this loop.

`negativeAmount(value)` is the single answer, with all five call sites pointed at it. Two tests,
asserting the codepoints (U+2212 then U+0020) because the two glyphs are a pixel apart on screen and
identical in a diff.

**Proven on the running stack:** all **eight** negatives on that card now read one way — every one
U+2212, and exactly **one** distinct second codepoint (32). The sweep's own two examples now agree:
`− SEK 12,000` and `− SEK 33,000`.
