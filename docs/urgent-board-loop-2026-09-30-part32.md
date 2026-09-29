# Urgent board loop — part 32 (2026-09-30)

Part 31 closed at 387 lines. Nine of run 12's eleven findings are shut — the MAJOR (`7dc1f3d`), the
deals-data pair (`76e657b`), the attention card's two (`4740791`), the Outgoing tab (`0d8723a`), the
Projections caption (`bf128f0`), the approval roster (`2e77e65`) and the awaiting-signature route
(`cfb6164`). **Two left, and they are the last two.**

## 1. [MINOR] A 409 written for an API caller, printed to a venue operator — run 12 §2 line 175

**What was measured**, as a toast on the Deals tab:

> "A party has already signed this agreement, so **agreementBodyText** cannot change — their
> signature is on the figures as they stand. Reopen it for renegotiation first, which tears every
> signature up: **POST /deals/36ff1176-1333-4f85-bdbb-383bad290d67/reopen**"

A field name and an HTTP route, to a promoter.

**Which file settles it — and NOT by changing the server string.** That message is deliberately
written for an API caller: it names the route to call next, which is exactly right for the
assistant/agent-native surface (decisions #16.14), and `routes/deals.ts:939-943` is the only place it
exists. The defect is that the browser prints it.

**And `errors.ts` already holds the answer, twice over.** It maps a 403 to
*"This part of the event isn't shared with you…"* and it does so **matched on the code, never on the
message text** — with its own docstring explaining why: *"Matching on the code — never on the message
TEXT — is what lets ONE component answer every plan gate in the app without a copy of the upgrade
sentence in each screen."* `ENTITLEMENT_REQUIRED_CODE` is that pattern's precedent: two 403s that look
identical on the wire, told apart by a code.

**THE OBVIOUS FIX IS WRONG, AND THE FILE SAYS SO.** Matching `code === "conflict"` and substituting a
sentence would destroy four good ones. Every 409 the deals route throws:

```
939  the sealed terms         ← names a field and a route. THE ONE to replace
977  "Deal was changed by someone else; reload and retry"
1047 "Only a draft agreement can be sent"
1293 "Only an agreement somebody has signed can be reopened"
1469 dealDeletability's own sentence (§25.7.2, written for a person)
```

All four of those are already plain English addressed to the reader. A blanket map would be the
"**BEFORE FOLLOWING A REPORT'S SUGGESTED FIX, CHECK WHAT THE LINE IS LOAD-BEARING FOR**" lesson for
the third time this stretch.

**So: a distinct code, exactly as the plan gate has one.** `TERMS_SEALED_CODE = "terms_sealed"` on the
API side; `errors.ts` maps it to a sentence a promoter can act on and names the control that IS on the
card. The API caller's message is untouched, and so are the other four 409s.

**The scope.** A `HttpError` code on the one throw, the constant shared the way
`ENTITLEMENT_REQUIRED_CODE` is (declared on each side with the comment pointing at the other), a
`sealedTermsRefusal` branch in `errorMessage`, and tests for both halves. **Unreachable through the UI
since `7dc1f3d`** — the editor is withdrawn at the first signature — but reachable in a race between
two tabs, which is precisely when a stranded reader most needs a sentence rather than a route.

## 2. [COSMETIC] `favicon.ico` 404s on every page load — run 12 §2 line 345

**Which file settles it:** `apps/web/index.html`, and **the asset already exists.**
`apps/marketing/public/favicon.svg` is the brand mark — 398 bytes, the dark rounded square with the
coral arch and the sand triangle — and `apps/marketing/index.html:1349` links it. The app never did,
so every load asks for the default `/favicon.ico`, gets the SPA's 404, and logs the only non-2xx in
the entire sweep that was not an expected pre-sign-in Firebase 400 or a deliberate authorization
probe. Both cold-load console errors come from it.

**The verdict: not a new asset — the same one.** A second hand-drawn mark would be a divergence
waiting to happen, and this repo already has a rule about that (*nothing hand-rolls what the design
system has*). The file is copied into `apps/web/public/` with a comment naming its source, because two
Vite apps have two `public/` roots and a symlink there is fragile in a container build.

**The scope.** The asset, one `<link rel="icon">`, and nothing else. No decision.

---

## What landed — both, and the race reproduced

The 409 still says the same thing to an API caller, and now carries a code:

```
$ api-as.mjs operator PATCH /deals/<d1> '{"agreementBodyText":"QA32 probe"}'
409 { "code": "terms_sealed",
      "message": "These terms are frozen — agreementBodyText cannot change on a confirmed
                  agreement. Reopen it for renegotiation first: POST /deals/<d1>/reopen" }
```

And the toast, read live **in the actual race** — the terms dialog open with unsaved text, a signature
landing from another seat, then Save:

```
BEFORE  "A party has already signed this agreement, so agreementBodyText cannot change — their
         signature is on the figures as they stand. Reopen it for renegotiation first, which tears
         every signature up: POST /deals/36ff1176-1333-4f85-bdbb-383bad290d67/reopen"

AFTER   "A party has already signed this agreement, so its terms are fixed. Reopen it to
         renegotiate — that clears every signature and asks the parties again."
```

`favicon.svg` serves 200 from the app's own origin.

### MY FIRST ATTEMPT AT THAT RACE REPORTED SUCCESS AND PROVED NOTHING

The toast came back **"Terms saved."** — and the database said otherwise:

```
agreement_status | terms  | version
sent             | (null) |       7      ← unchanged
```

The probe's selector was `'dialog textarea, [role="dialog"] textarea, textarea'`, and
`querySelector` returns the first match **in document order across the whole list** — not the first
match of the first selector. It filled a textarea on the page *behind* the dialog, so the PATCH
carried no changed field, the guard had nothing to refuse, and the save legitimately succeeded.

**A GREEN TOAST IS NOT EVIDENCE THE THING UNDER TEST RAN.** This is CLAUDE.md's own "green is not the
same as correct" one layer out: the check passed because it measured the wrong element, and only
reading the row behind it said so. The second attempt asserted `insideDialog: true` and the textarea's
value before touching Save — and then the 409 arrived.

### Mutations — five, all killed

| Mutation | Verdict |
|---|---|
| the mapping never fires — the defect | KILLED (2) |
| **matched on `code === "conflict"` — the blanket rewrite** | **KILLED (4)** |
| matched on the STATUS instead of the code | KILLED (2) |
| the sentence stops naming the Reopen control | KILLED (1) |
| it runs after the permission branch, so a 403 would win a 409 | KILLED (2) |

The second row is the finding's real content: the obvious fix fails **four** tests, because the deals
route's other 409s are already plain English addressed to their reader. Third time this stretch that
checking what a line is load-bearing for changed the answer.

Suites: biome 748 files · web 602 (was 597) · API `deals` 83.

---

## 3. The full pass — stack down, one go

All eleven of run 12's findings closed, so this is the reconciliation.

| Suite | Result | Against |
|---|---|---|
| `npx biome check .` | **748 files**, no errors | repo-wide, not per file |
| `@showme/shared` | **344** | 343 before this stretch (+1, the observer-signature case) |
| `@showme/auth` | **36** | unchanged |
| `@showme/settlement` | **74** | unchanged |
| `@showme/db` | **25** | unchanged |
| `apps/web` | **602** | 546 at the start of the stretch |
| `apps/api` | **1469** across 65 files, **0 failed** | 1460 before this stretch |
| `pnpm test:e2e` | **116**, including all four of `tests/motion.spec.ts` | 116 |

The API run lost **one** file to the Testcontainers port-bind flake (`settlement-own-read`, reported as
14 *skipped* with zero failures — the tell), re-run alone: 14 passed. 1455 + 14 = 1469.

The web total grew by 56 across the stretch and the API by 9; both are this stretch's new tests, and
every one of them exists because a mutation or a live probe asked for it rather than because a file
was being tidied.

### The stack afterwards

`pnpm test:e2e` removes the docker postgres on the way out, so `pnpm dev` rebuilt it — which means the
fixtures are **pristine** without needing the manual FK sweep at all. Verified rather than assumed:

```
events not e2e%              0
deals not e2e%               0
participants on e4           1        (the seeded one, not the probe's Marlo)
settlement_approvals         0
settlements                  3
Album Release — Door Split   [confirmed/confirmed] 3/3   hidden=0
/favicon.svg                 200
```

Seven orphaned postgres containers from the interleaved runs were pruned; one remains, which is the
stack's own.

---

## 4. Daniel's three rulings — recorded as §25.8 before any of them is built

Asked as an interactive list, answered in one pass, all three the way §25.6 recommended:

| Row | Ruling |
|---|---|
| The cross-currency money tile | **Refuse now, convert later** — `—` plus a reason when the rows are not one currency; a converted `≈` tile once `exchange_rate_cache` is real. **Unblocks QA9-10's second half.** |
| May crew sign their own settlement? | **Yes, settlement-scoped** — mirroring `DEAL_SIGNATORY_FLOOR`. `CREW_FLOOR` stays thin. The roster's denominator follows on its own. |
| The operator-attached rider as a HOUSE document | **Confirmed as built** |

`decisions.md` §25.6's three rows are marked `[DECIDED — §25.8.x]`, and the count above the table is
corrected: **four** unconfirmed calls of mine remain, all from 2026-09-28, none blocking.

**One question is now live and is Daniel's alone** — §25.7.1's broader reading (`decisions.md:1369`):
should a venue rental the PROMOTER signed also stop being shared by the act? He asked whether Ran had
ruled on it. **The answer is no**, and the search is worth recording so nobody re-runs it:

- **#24.1 (2026-09-15) is the nearest ruling and is his own.** It sets the waterfall with the venue
  rental off the top and every percentage dividing the adjusted net, and it **un-retired** off-the-top
  rentals — reversing #23.1 from two days earlier. So this area has already been flipped once. It is
  explicitly about *the promoter rents from the venue*, where the promoter **is** the pool.
- **ClickUp `86cba8wfk` "Settlement: which deals settle off the top?"** (high, shipped, resolved
  2026-09-02) answers *which* deals settle off the top — rental only, `deals.priority` stays unwired —
  and never who bears them.
- `86caqujbc` / `86cac14ar` *"Payments: rental-counterparty settlement via contract"* are
  backlog/in-development payments tickets; the counterparty framing was anticipated, the rule was not.

---

## 5. [BLOCKER] An operator can author a deal it cannot then see — run 13 §2

**Which file settles it:** `apps/api/src/serialize/deal.ts` and `apps/api/src/lib/deal-authority.ts`.
`packages/db/src/schema/deals.ts:76` already records the answer — `createdBy`, `notNull`, referencing
`users` — and nothing reads it for authority.

**What was measured.** New deal → payer *Neon Tide*, payee *Priya Sound* → Save draft. `201`, and the
card **disappears from its author's screen**. The host's own Budget Planner then says *"2 of this
event's deals are not shown to you"* about deals it authored, and Recalculate refuses with two raw
UUIDs and the advice to *"cancel one that is no longer happening"*. The reachability matrix:

```
seat          GET   PATCH cancelled   DELETE   POST /send
operator      404   404               404      404   ← the AUTHOR
co.host       404   404               404       —
performer.b   200   403 deal.edit     403      403 agreement.manage
professional  200   403               403      403
```

**TWO DELIBERATE RULES, EACH RIGHT, COLLIDING.** The composer offers every participant as a party and
requires nothing of the author — correct, because a venue brokering *the act pays its own engineer* is
a real agreement the settlement engine needs. And `isDealVisible` is pure party-scoping whose docstring
says exactly why: *"a performer's private sub-hire (performer↔crew) has no operator party line, so the
venue cannot see it."* Also correct. Together they are a trap.

**The verdict: the AUTHOR stands behind a deal in the most literal sense — they wrote every line of
it.** Hiding it from them afterwards protects nothing, because the confidentiality was never there.
So reachability becomes *party **or** author*, and that is a completion of the rule rather than a
widening of it.

**Why not the sweep's other candidate.** It offers *"`POST /events/:id/deals` could require the
author's own participant to be one of the parties"* — that forbids the act-pays-its-own-engineer deal
outright, removing a capability the picker offers and the engine reconciles. **And why not widen
`GET /deals/:did` to everyone holding `deal.edit`:** that is the thing decisions #4 forbids, and the
sweep says six tests pin it. `created_by` is one account, not a capability.

**The privacy rule survives, and its own test is already the control.** `deals.test.ts:2900` inserts
the sub-hire with `createdBy: "sub-perf"` — the PERFORMER — deliberately, and asserts the operator gets
404 on read and delete. Under this change that 404 stands, because the operator is not the author. The
fixture was written for this distinction before the distinction existed.

**The scope, and the third touch point is the one that would have been the next defect.**
- `DealViewer` gains `callerUserId: string | null` — null for a share-link recipient, who is a party
  and never an author. Two constructions in the codebase, both updated.
- `authoredByViewer(deal, viewer)` — the rule, once. `isDealVisible` is left exactly as documented,
  because three callers depend on it meaning *party*; the new `isDealReachable` is the union.
- `requireDealAccess` and the event deals list both ask `isDealReachable`. That also drops
  `hiddenCount` for the author, which is the Budget Planner sentence.
- **`serializeDeal`'s `seesEveryLine`** — `isManagingOperator && isParty(...)`. An author who is not a
  party would otherwise be served the redacted slice, which is *their own lines*, of which they have
  **none**: a card with a deal and no parties on it. The author sees every line because they wrote
  every line.

### What landed — the night the sweep left stuck, unstuck

Run 13's two orphaned deals were still in the database, both `created_by = e2e-operator`. Before the
change the operator was answered 404 on every route. After:

```
operator  GET    200      ← the author
operator  SEND   200
operator  CANCEL 200      (both of them)
co.host    GET   404      ← same permission set, same event, did not write it

POST /events/<e1>/settlement/compute → 200, pool 11,000,000   ← the night computes again
```

And the Budget Planner's sentence is gone, from both sides:

```
operator   visible=9  hiddenCount=0     ← was "2 of this event's deals are not shown to you"
co.host    visible=0  hiddenCount=1     ← the one live deal it is not party to
```

### The fix's own next defect, caught by a test that existed before the fix

The first version read *"the author sees every line, because they wrote every line"*. `deals.test.ts`'s
performer↔crew sub-hire refused it: its fixture makes the **performer** the author, and the test's own
sentence is *"Both parties to the sub-hire see it — each their own line."* That is the redaction rule
between two parties, and it is not this blocker's business.

So the relief is a **floor, not a widening**: the author sees the whole deal only when party-scoping
would show them **nothing at all**. *A redaction that leaves nothing is not a redaction, it is a
blank.* An author who holds a line already sees one.

### Mutations — seven, all killed, and one survived first

| Mutation | Verdict |
|---|---|
| authorship never grants reach — the defect | KILLED (2) |
| authorship grants reach to everyone | KILLED (8) |
| authorship compares the wrong way | KILLED (8) |
| the redaction floor removed — the author's card renders blank | KILLED (1) |
| **the floor widened to every author** | KILLED (1) — the sub-hire's own test |
| the single-deal gate back to party-only | KILLED (**73**) |
| the list back to party-only — the card stays vanished | KILLED (1) |

**The survivor cost a line.** I had written `viewer.callerUserId != null && deal.createdBy ===
viewer.callerUserId`, and deleting the guard changed nothing — `created_by` is `notNull`, so
`null === <uuid>` is already false and the clause cannot decide anything. **Fourth instance of a
surviving mutation meaning "redundant" rather than "untested"**, and the reasoning stayed as a comment
where the line used to be.

Suites: biome 748 files · API `deals` **85** (was 83) · `shares` 49 · `settlement` 124.

---

## 6. [MAJOR] A cancelled deal still opens the other parties' settlement figures — run 13 §2

**Which file settles it:** `apps/api/src/routes/settlement.ts` — `partiesVisibleTo`, whose join filters
on `deals.eventId` **and nothing else**.

**What was measured.** `professional@` (Priya Sound, crew, permission set `{event.view,
schedule.view}`) is served **Neon Tide's whole settlement**:

> "Neon Tide · Performer · **70% of the adjusted net — Neon Tide's 40% of the deal's SEK 77,000** ·
> **SEK 30,800**"

Her only qualifying `deal_parties` rows on the event are **observer rows on two CANCELLED deals**.

**The report is right that there are two defects in one query, and they are not the same kind of
thing. I am fixing one and putting the other to Daniel.**

### (a) No status filter — fixed here

Every other reader of `deals` on this path excludes `cancelled`: `reconcileEvent`'s
`ne(schema.deals.status, "cancelled")`, `hiddenCount`'s `paying()` (part 30 §2a), and
`useBudgetSeed`'s rentals filter. This one does not. §25.7.2 calls cancelling **"the NORMAL ending
for an agreement"**, so these grants accumulate over an event's life and **never expire** — a deal
withdrawn in March still opens a counterparty's figures in December.

**This closes the case the sweep actually reproduced**: with the clause, Priya's two observer rows
stop qualifying and she is disclosed nothing at all. One clause, and it makes this query agree with
the four that already said it.

### (b) Participant granularity where the grant is per-DEAL — NOT fixed; a §25.6 row

The deeper half. `partiesVisibleTo` returns **participant ids**, and the route then serves those
participants' whole settlement rows — so observing a SEK 5,000 guarantee discloses a **SEK 30,800**
entitlement earned under `d1`, a different agreement the observer is not party to in any role.

**Why I am not fixing it on my own judgement.** The role rule is decisions #4's and is right:
`observer` is *"#4's explicit read-only way to share a deal — they can see it because they are now a
party"*. What is wrong is that *seeing the deal* has been implemented as *seeing that participant's
entire settlement*. Narrowing it reverses part of what A-07 and QA10-2 built deliberately, and
`settlement.test.ts` pins that a payer sees the payee's line. **It is the "whose figures reach whom"
class, which is exactly what §25.6 is for.**

**And the data supports the narrow answer**, which is worth recording so the question is cheap to
answer: `SerializedEntitlementLine` carries **`dealId`** on every line, so a disclosed row can be
scoped to the lines the shared deals produced, with the scalar aggregates (`entitlement`, `net`,
`collected`, `paid`) withheld rather than partly computed. Recommendation written into §25.6.

**The scope of what lands now.** One `ne(status, 'cancelled')` clause, a test with a live-deal control
beside the cancelled case, and the §25.6 row for (b).

### What landed, and my control proved nothing until the test said so

The clause, and a test whose **control comes first**: while the deal is live, observing it **does**
disclose the counterparty — A-07's deliberate rule, which must not move — and then cancelling the
agreement withdraws the grant it carried, on the next read rather than at the next reconciliation.

**My first control used the CO-HOST as the counterparty and passed vacuously.** `partiesVisibleTo`
strips every participant who **operates** the event however the deal is pointed (QA10-2), so the
co-host was never going to be disclosed and the "while live" assertion was standing on a gap the
scoping already closes. The sweep's own case is a **performer** — crew observing a Lantern Hall ↔ Neon
Tide deal was served Neon Tide's figures — and with a performer as the payee the control fails on the
unfixed code and passes on the fixed one, which is what a control is for.

**Third instance of "a test you labelled THE CONTROL can be standing on a gap the scoping already
closes"**, and the second where the gap was a rule I had read minutes earlier.

Mutations — three, all killed: the clause removed (the defect), the clause inverted (only cancelled
deals disclose), and the clause filtering `draft` instead.

Suites: biome 748 files · API `settlement-own-read` **15** (was 14) · `settlement` 124.
