# Urgent board loop — 2026-09-29, part 27

Part 26 reached 419 lines and closed two of qa-sweep run 11's five MAJORs: **QA11-1** (a deal's
figures sealed at the first signature, not the last) and **QA11-5** (the Issue button's missing
amount guard). Three MAJORs remain, and they are related in a way worth saying before starting:
**all three are about a co-operator, and two of them are the same seat reading a document that is
not true of it.**

| Finding | The shape of it |
|---|---|
| QA11-2 | The host's settlement omits the co-operator and still reads as a complete document |
| QA11-3 | A co-operator can be served a settlement, counted in the roster, and can never approve it |
| QA11-4 | *"Sign your line on…"* dead-ends, on both seeded deals — and the seed authored the state |

Run 11's own list, for the record: **5 MAJOR · 12 MINOR · 4 COSMETIC · 5 NOTE**, with eight of the
nine things parts 25–26 landed re-verified and passing.

---

## 1. QA11-3 — the plan, before building

**Which file settles it:** `packages/auth/src/presets.ts`, `OPERATOR_FLOOR`.

**What was measured.** The host sends the settlement for review to *Northlight Presents
(Co-operator)* with **Full settlement access** on. The co-host's own row reads **Pending**, the
Approval Status roster counts them in **0/5**, and there is no Approve control anywhere on the page.
The server agrees with the screen, which is the right half of it:

```
coHost POST /events/…/settlements/…/confirm
  → 403 {"code":"forbidden","message":"Missing capability: settlement.confirm"}
```

**The verdict: the floor is one capability short, and the asymmetry is the proof.**
`OPERATOR_FLOOR` is `event.view · schedule.view · deal.view.own · settlement.view.own ·
message.post`. `PERFORMER_FLOOR` five lines below carries `settlement.confirm`, and
`routes/settlement.ts:2550` hands the same capability to a **share-link recipient** — somebody with
no account at all. So a stranger can approve a settlement and the co-promoter named on the bill
cannot. Nothing in `story.md` or #24.2 distinguishes them; #24.2 makes send-for-review *the* way a
settlement is opened to a party, and this seat is the one party that cannot answer.

**Why the floor and not a scoped grant — the QA6-1 precedent cuts the other way here.** QA6-1 was
the same seat unable to sign a *deal*, and it was fixed with a DEAL-scoped baseline rather than a
floor entry, on the explicit ground that *"a co-host on Standard access still holds no event-scoped
confirm, so they still do not decide whether the show happens."* That reasoning does not transfer:
`agreement.confirm` on a floor would be authority over **any** agreement on the event, whereas
`POST /settlements/:sid/confirm` already refuses anything but the caller's own row —
*"You can only confirm your own settlement"*, resolved through `participantIdsOf` plus the live
representations. The capability cannot reach another party's settlement, so putting it on the floor
grants exactly what the floor already says: own slice, and the confirms that go with it.

**The scope.** One line, plus the tests that pin why. `PRESET_PERMISSION_SETS.operator_full` already
carries it, which is why the seeded Album Release co-host never hit this — the seed hands that row a
full operator set, and the defect appears the moment anybody uses the invite dialog's own default.

**The decision it hides: does this also hand a co-host the DISPUTE?** Yes, and it is worth naming
rather than discovering later. `POST /events/:id/settlement/status` maps `dispute` to
`settlement.confirm` (`REVIEW_STATUS_CAPABILITY`), and unlike confirm it is **not** scoped to the
caller's own rows — `participantIds` is optional and defaults to every party. That breadth is not
something this change creates: every performer already holds `settlement.confirm` on their own floor
and has had it all along. Raising a dispute changes no money by the route's own design and is
audited both sides. **Measured below rather than assumed**, and recorded either way.

### QA11-3 — what landed, and the hole the fix nearly widened

`settlement.confirm` on `OPERATOR_FLOOR`, and an end-to-end test that drives the whole journey
through the routes: compute → send for review to the co-host with Full settlement access → the
co-host signs off → one `settlement_approvals` row. Plus its negative: the same seat is still
refused another party's settlement, *"You can only confirm your own settlement"*, which is the reason
this belongs on a floor at all. Three mutations killed (the floor entry, twice — unit and end to
end — and the route's own-row check).

**THE DECISION THE PLAN NAMED WAS A REAL DEFECT, and measuring it is what settled it.** The plan
asked whether this also hands a co-host the DISPUTE, and said it would be measured rather than
assumed. Measured, on the running stack, before the fix:

```
performerB POST /events/…e1/settlement/status {"status":"dispute"}     200
  host The Lantern Hall     dispute      ← naming NOBODY moved all six
  co_host Northlight        dispute
  performer Marlo Vance     dispute
  performer Neon Tide       dispute      ← the only row that is theirs
  crew Priya Sound          dispute
  agent Astra Booking       dispute
```

One performer flagged the whole night's settlements, the host's included. Not a hole this change
opened — `PERFORMER_FLOOR` has carried `settlement.confirm` all along — but one it would have
**widened**, so it is fixed in the same breath. `participantIds` defaults to every party, which is
right for the two operator transitions (sending a settlement out is a fan-out by nature) and wrong
for the one an arm's-length party can make. The route's own comment already drew the line: *"DISPUTE
is the party's … a performer who may say 'these figures match my books' must be able to say the
opposite."* **Their** books. After:

```
  performer Neon Tide       dispute      ← and every other row still `open`
```

The caller's own rows are resolved exactly as the confirm route resolves them, live representations
included, so an agent can still dispute for the act it signs for. Mutation killed.

**And the test I wrote was wrong about the refusal.** I expected 403 for a stranger and the route
answers **404** — `requireEventCapability` refuses `event.view` first, because an event you are on
no participant row for does not exist to you. The test pins 404 with that reason, so the next reader
does not go hunting for the scoping in the wrong place.

---

## 2. QA11-2 — the plan, before building

**Which file settles it:** `apps/web/src/components/settlementDocument.ts`, and **no API change at
all** — which is the finding's real shape.

**What was measured.** A co-promotion at 25/75. Postgres holds six settlement rows summing to zero;
`GET /events/:id/settlements` as the **host** returns two. The host reads:

> ENTITLEMENT BY PARTY — *"The entitlements below come to SEK 85,000, more than the adjusted net:
> each line also carries the cash that party collected and the deductions taken off them."*
> Marlo Vance — SEK 90,000 · The Lantern Hall (you) — −SEK 5,000 — *"Your 25% of what is left…"*

Northlight's −SEK 15,000 is nowhere: no card, no line, no note. The co-host with Full access reads
the complete, balanced document.

**The verdict: the withholding is right, the sentence is wrong, and the data to fix it is already in
the payload.** `partiesVisibleTo` excluding a co-operator is deliberate (#4, and QA10-2 is what
loosening it costs) — the FIGURES stay scoped. But the same response already carries **`approvals`**,
built from `addressableSettlements`, which is *every* party on the night; it is what the roster
reads `0/5` from. The route's own comment already settles the principle: *"Addressing somebody is not
reading their money."* So the screen has always known a fifth party exists and simply never asked.

**And the mechanism for saying so already exists, one case too narrow.** `entitlementGapSentence`
branch 1 says *"At least X of it belongs to a party whose settlement is not shared with you"* — but
it fires on `withheldPayees`, parties this reader **pays** by transfer. A co-operator with a negative
net is a payer, not a payee, so it finds nothing and the sentence falls through to branch 3, which
blames cash and deductions for a gap they do not explain. **The rule was right and its trigger only
covered one direction** — the same shape as QA10-2's *"direction is not the protection"*, one screen
along.

**The scope.** A pure `withheldPartyCount` derived from `approvals` minus the visible settlements, a
new branch in `entitlementGapSentence` placed **before** the cash-and-deductions one (a structurally
incomplete list dominates any arithmetic explanation of the same gap), and the wiring. No new field,
no widened disclosure: a COUNT of parties, from a list the reader is already served.

**The decision it hides: does naming a count leak anything?** No, and the route already decided it —
`approvals` names those participants by id to every caller with `settlement.edit`, and the roster
prints them. What stays withheld is every figure, which is what #4 protects. **Not taken:** the
sweep's other suggestion, letting `partiesVisibleTo` admit the co-operator's NET to the host. It is
defensible — the host can already derive it from the pool they may read — but it is a disclosure
rule, and disclosure rules on this screen have gone wrong twice (QA10-2, QA5-1). A count is not a
figure, and it closes the finding.

### QA11-2 — what landed

No API change. `withheldPartyCount(approvals, visibleParticipantIds)` reads the roster the response
already serves, and `entitlementGapSentence` gains a branch for it — placed after the two that name
an AMOUNT and before the one that blames arithmetic. Read live as the host, on a co-promotion where
the co-operator's net is negative (so the old payee branch cannot fire):

```
ENTITLEMENT BY PARTY
The entitlements below come to SEK 59,000, less than the adjusted net. The list leaves out
3 parties on this night whose settlements are not shared with you, so it does not sum to the
pool. The percentages are shares of the entitlements shown.
```

Three of six parties on screen, and the sentence now names why instead of blaming cash and
deductions. Three mutations killed: the branch never firing, the count ignoring what the reader can
see, and the more specific payee sentence losing its place in the order.

**The trigger covered one direction, not the rule.** Branch 1 has said *"a party whose settlement is
not shared with you"* since QA5-1 — but it is derived from `withheldPayees`, parties this reader
**pays**, and a co-operator with a negative net pays IN. Same shape as QA10-2's *"direction is not
the protection"*, one screen along: a correct rule reached through a predicate that only sees one
end of the relationship.

**What was NOT taken:** the sweep's other suggestion, admitting the co-operator's NET to the host.
Defensible — the host can derive it from a pool they may read — but it is a disclosure rule, and
disclosure rules on this screen have gone wrong twice (QA5-1, QA10-2). A count is not a figure, the
route already publishes the roster on the ground that *"addressing somebody is not reading their
money"*, and it closes the finding without touching #4.

---

## 3. QA11-4 — the plan, before building

**Which files settle it:** `packages/db/src/seed-e2e.ts` and `apps/api/src/routes/deals.ts` — the
fixture and the filter. Not `dealActionsFor`, which is right as it stands.

**What was measured.** The Dashboard card *"Sign your line on Spring Warmup — Marlo Vance —
Guarantee vs Door · 1 of 2 signed"* → **Open** → a Deals tab whose only controls are Reopen, Cancel
agreement and Share & Export. Same on the Album Release. `Dashboard.tsx` states in its own words what
is supposed to happen: *"the event's Deals tab offers **Confirm your line**, and this card — the one
that exists to route them there — used to say 'You're all caught up'."*

**The verdict, and it is TWO defects wearing one symptom.**

1. **The seed authored a state the engine cannot produce.** Both seeded deals are written
   `agreement_status: confirmed` / `signed` while the **payer's** row — the operator's own line —
   carries no `confirmedAt` at all; every other party's does. `confirmDealIfComplete` only reaches
   `confirmed` when every non-observer signatory has stamped, and `deal-confirmation.ts:48-50`
   asserts exactly that: *"`confirmed` and `signed` pass: on those, every signatory line already
   carries a `confirmed_at`."* **An assertion carrying a reason, and the reason is untrue of the
   shipped fixture** — which is how the sweep's `POST /confirm` answered 200 and actually stamped
   something, on a deal the route believes is finished. The seed is what is wrong here: these two
   are a settled night and a concluded one, so they should be fully signed.

2. **The two screens disagree about what "awaiting signature" means, and the disagreement survives a
   fixed seed.** `GET /deals/awaiting-signature` excludes `draft` and `cancelled`, so it lists a
   `confirmed` or `signed` deal that still has an unsigned line; `dealActionsFor` requires
   `agreementStatus === "sent"` exactly, so the tab offers nothing. **This is reachable without a bad
   fixture:** `signed` means *"the same agreement once it has been countersigned off-platform"*, a
   state whose party rows may legitimately carry no `confirmedAt` — so the dead end would come back
   on the first off-platform countersignature. The list is the half that is wrong: nobody is waiting
   on your signature for an agreement that is already an agreement.

**The scope.** The seed's two payer rows gain the signature they should always have had; the route's
filter becomes `agreementStatus = 'sent'`, matching the card's own promise and `dealActionsFor`
exactly. A seed change reaches every fixture, so the **full** API suite runs behind it rather than
`deals.test.ts` alone.

**The decision it hides: should the seed keep a deal that IS waiting on the operator?** It would be a
useful fixture — nothing else exercises Confirm from the operator's seat — but the honest shape for
it is a deal at `sent` with the payer unsigned, not a `confirmed` one with a hole in it. Adding a
third seeded deal is a fixture feature and a separate change; **what is not acceptable is keeping an
impossible state to stand in for a missing one.**

### QA11-4 — what landed, and run 11's MAJORs are closed

Both halves, plus a guard so the first one cannot come back:

- **The seed's two payer rows now carry the signature they always should have.** Read back:
  `Marlo Vance — Guarantee vs Door | signed | 0 unsigned` and
  `Album Release — Door Split | confirmed | 0 unsigned`.
- **`GET /deals/awaiting-signature` lists only `sent` deals**, which is what `dealActionsFor`
  requires and what the Dashboard card promises. The load-bearing case is not the fixture but
  `signed` — countersigned off-platform, party rows legitimately blank — which would have rebuilt
  the dead end on the first one of those.
- **`assertSignedDealsAreFullySigned` runs inside the seed**, before the insert, and throws:
  `Seed error: deal "Album Release — Door Split" is confirmed with 1 unsigned signatory line(s).`
  Proven by removing the signature again and watching the seed refuse. **In the seed rather than in
  a test on purpose** — a test mirroring these rows would only assert that the mirror agrees with
  itself, which is exactly how the original went unnoticed.

Live, as `operator@`: `GET /deals/awaiting-signature` → `{"items": []}`, and the Dashboard reads
**"You have 4 things that need attention today"** — the two cards that led nowhere are gone and all
four that remain route somewhere real.

**The full API suite behind the seed change: 65 files, 1451 passed, zero failures and zero
port-bind flakes** — the first entirely clean full run this session.

> **qa-sweep run 11's five MAJORs are closed.** QA11-1 `657cb70` · QA11-5 `3994c01` ·
> QA11-3 `2ec770d` · QA11-2 `14deb99` · QA11-4 here.

---

## 4. Run 11's MINOR rows — the first cluster

### QA11-6 — the possessive, and why it was still wrong

**Which file settles it:** `apps/web/src/lib/format.ts` — a new home, because the old one is the
whole problem.

**What was measured.** `45d39ac` fixed *"Northlight Presents's 75%"* eight hours ago, and the sweep
found two live captions still reading it:

- `BudgetPlanner.tsx:1437` — `aria-label="Northlight Presents's share of what the event carries"`,
  read aloud by a screen reader on a co-promotion's only money-splitting control.
- `BudgetLineAttribution.tsx:401` — *"Deducted from Northlight Presents's settlement."*

Plus two the sweep did not reach on screen and named anyway: `BudgetLineAttribution.tsx:585` and
`SettlementCurationCard.tsx:52`.

**The verdict: this is my own fix, not generalised — the twenty-third instance of the shape, and the
third in two days.** `possessiveOf` is correct and **private to `settlementDocument.ts`**, so the
settlement card is right and every other screen that writes a party's name is not. The same failure
as QA9-12's render half, the budget CSV never getting QA7-26, and the invoice modal keeping a rule on
two sibling fields and not the third: **a rule enforced at one reader is enforced at one reader.**

**The scope.** `possessiveOf` moves to `lib/format.ts`, where the web's other text rules live and
where five call sites can reach it, and every hand-written `${name}'s` for a PARTY goes through it.
Not every apostrophe in the app — the ones about a *party's* name, which is the set that can end in
s because a profile name is somebody's trading name.

**What landed.** `possessiveOf` now lives in `lib/format.ts` with five call sites through it. Read
live off the DOM, both controls on one screen — the positive and negative control together:

```
aria-label="The Lantern Hall's share of what the event carries"
aria-label="Northlight Presents' share of what the event carries"
```

**And the test I wrote first was wrong.** It asserted `possessiveOf("NORTHLIGHT PRESENTS")` →
`"NORTHLIGHT PRESENTS's"` and called that deliberate — it is the same mistake shouting, and the only
reason the code did it was `endsWith("s")` being case-sensitive. The implementation now tests
`/s$/i` and the test says what it is for. **An assertion carrying a reason is a claim about the
code, and this one was wrong before the code was.**

The attribution menu's copy goes through the same helper and compiles, but its chooser would not
open under a synthetic click, so it is covered by the unit test and the shared call rather than by a
second live read. Said plainly rather than implied.

### QA11-7 — BREAK-EVEN 407 in a 400-capacity room

**Which file settles it:** `packages/shared/src/break-even-chart.ts` — and the finding is that the
answer was already written there.

**The verdict: two definitions of "reachable" on one screen, and the chart's own comment had warned
about the one the KPI used.** The band asked `breakEvenReachable`, which is
`breakEvenTickets > 0 || uncovered <= 0`, and the scan producing those tickets runs to **four times
capacity** so the figure exists at all. The chart asks a three-way question — `on_chart`,
`covered_before_doors`, `beyond_this_room` — and its comment says, in as many words:

> `breakEvenReachable` … is ALSO true when the crossing lies beyond the room: reading it alone would
> describe a night needing 500 tickets in a 400-seat house as "already covered".

One screen-inch above, the band was doing exactly that. **Instance twenty-four, and the first where
the comment warns about a mistake the NEIGHBOURING surface is already making.**

`breakEvenCoverage` is exported now, the chart uses it, and the band reads the chart's own computed
answer rather than calling it again — recomputing would give the two a way to part a second time,
which is the whole defect. The wide scan stays: the figure is real and the CSV exports it; only
this predicate decides whether it is a number anybody in this room can sell.

**Two mutations killed and one deliberately left standing.** The predicate forgetting the room, and
the tile ignoring the coverage, both fail tests. The remaining one — deleting the call from the tile
— survives, and `budgetPlannerView.test.ts`'s own header is the reason: *"standing up a fake editor
to re-assert somebody else's maths is not worth it."* Its proof is the live read, where the tile and
the caption now move together (`BREAK-EVEN TICKETS 169` over *"Revenue passes total cost at 169
tickets of 400 capacity"*), driven by one value. Recorded as standing, the way QA9-5's was.

**What I could not do:** reproduce a beyond-the-room crossing in the browser. The seeded sheets
cross early, and the cost lines I added to push it out produced a per-head contribution I could not
account for — so I removed them rather than build a conclusion on a fixture I did not understand.
The unit tests carry that case (a real 440-ticket crossing in a 400-seat room, and the exactly-400
boundary); the browser carries the agreement.
