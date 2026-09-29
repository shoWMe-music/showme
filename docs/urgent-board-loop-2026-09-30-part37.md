# Urgent board loop — part 37 (2026-10-01)

Continues part 36 (241 lines), which closed the full pass and launched run 14.

---

## 1. qa-sweep run 14 — landed, and NOT clean

`docs/qa-sweep-2026-10-01-run14.md`, 911 lines. **BLOCKER 0 · MAJOR 6 · MINOR 11 · COSMETIC 2 ·
NOTE 3.** So the loop's stopping condition is not met and this part works the findings.

All eleven requested re-checks hold, with one partial. Run 13's BLOCKER and MAJOR are both verified
fixed in the browser. The report reverted its two deliberate seed mutations and one accidental one,
and lists what it left in place.

**It also did the two things it was asked to do about its own reporting**, which is worth recording
because it changes how much of it I can act on directly: it checked what a line was load-bearing for
before proposing three of the six fixes (and in two cases said outright that its suggestion was
unverified), and §5 of the report documents **four probes that lied**, including one that would have
become a wrong MAJOR about co-promotion money had it trusted the database read alone.

### Triage of the six MAJORs

| # | Finding | Whose | Verdict |
| --- | --- | --- | --- |
| 1 | a deal's named **payer pays nothing**; the operators' residual absorbs it | pre-existing | **→ Daniel.** Engine money math that extends a ruling which explicitly refused to generalise. |
| 2 | a **signature survives the recompute** that changed the figure it signed | pre-existing | **split.** Clearing signatures is a product call; the screen's silence is not. Build the silence. |
| 3 | **cancelling a deal notifies nobody** and pushes no frame | pre-existing | **build.** Every sibling transition notifies. |
| 4 | a **delegated performer is offered Approve** on a line she may not sign | **MINE — `47991cf`** | **build, first.** |
| 5 | the **all-time line** still prints a mixed-currency sum under one currency | **MINE — `951a2a3`** | **build.** |
| 6 | the **agency's settlement reads "paid"** while the transfer that pays it is owed | pre-existing | **build.** |

### Why (1) is not mine to fix

Neon Tide, named `payer` on a SEK 2,500 crew fee, bears none of it; the two operators absorb it
70/30 through the residual. The report cites §25.7.1's grounds — *"a party cannot be charged for an
agreement it is not a party to"* — and they do read across.

**But §25.7.1 is about RENTALS and deliberately refused to generalise.** Its own record says the
obvious rule — *the deal names a payer → that party pays it* — **was built first and was wrong**: it
made #24.1's *promoter rents from the venue* case unreachable, because there the host is both the
payer and the pool, and only one assertion stood in the way. §25.7.1 closes with *"#24.1 survives
intact, which is not mine to overturn as a side effect."*

Extending the payer rule to a new deal KIND is the same class of decision, in the one module where
being wrong moves real money silently. There is also a defensible reading of the current behaviour:
a crew fee **is** normally a cost of the night, borne by whoever divides the night — what is in
question is whether naming a payer moves it, which is exactly the question §25.7.1 answered for
rentals and for rentals only.

**And the planner half is contingent on the answer, so it cannot be built ahead of it either.**
`performerFeeOf` shows no cost today; if Neon Tide is ruled to bear it, showing the operators a cost
would be the new defect. Recorded whole, as one row.

### Why (2) splits

The report checked this itself and I agree with where it drew the line: the confirm route stores no
`confirmed_snapshot` **on purpose** (*"the numbers stay editable right up to finalize"*) and writes
the figures as they stood into `audit_log`, so the forensic record is intact and clearing signatures
outright is a product decision. What is not defensible either way is that **no screen says anything**
— a regex over the whole rendered roster for `changed since|moved since|re-?sign|stale` matches
nothing. `settlement_approvals.approved_at` versus `settlements.updated_at` is already enough to say
it, with no new state.

---

## 2. Run 14 MAJOR — a delegated performer is offered Approve on a line she may not sign

**Mine, from `47991cf`.** §25.8.2 removed the web's event-wide `authority.canConfirm` from the
Approve gate — correctly, because it was a second copy of a rule the API owns — and that **unmasked**
`GET /events/:id/settlements` answering `signableByYou` from **ownership alone**. So a delegated act
got a live Approve on a line #14 and §25.7.3 place with her agent, and pressing it produced a 403 the
web renders as *"This part of the event isn't shared with you"* — untrue of her: it **is** shared, she
simply may not sign it.

### The shape of my own mistake

`maySignOwnSettlement`'s docstring — written yesterday — says *"ONE FUNCTION because **four** callers
ask it"* and lists them. **There are five.** The fifth is `GET /events/:id/settlements`, and it is the
one the SCREEN reads: `useEventSettlement` builds its `signable` map from those rows. Enumerating the
callers in prose is exactly how the drift that function exists to prevent got in — so the docstring
now says five, and says why it said four.

Fix: that route asks the same question, with the line's own role, off the rows `maySign` already
loads (no query). `roleByParticipant` beside the existing derivation.

### Two mutations survived, and both were holes in my test

| Mutation | First run | After |
| --- | --- | --- |
| back to ownership alone (the reported defect) | killed | killed |
| **capability alone, dropping ownership** | **survived** | killed |
| **a constant role instead of the line's** | **survived** | killed |

- **Dropping ownership survived the ENTIRE settlement suite**, both files. Nothing anywhere asserted
  that a reader is not offered somebody *else's* signature on this read — and the operator holds
  `settlement.confirm` event-wide, so without the ownership half they would be offered the performer's
  signature on the performer's own money, which the confirm route calls out by name as the thing it
  was changed to stop. Closed in `settlement.test.ts`, because `settlement-own-read.test.ts` seeds **no
  deals** — every reader there sees only their own line, so the question cannot even arise there. My
  first attempt asserted it in the wrong file and failed on its own false premise (`expected 0 to be
  greater than 0`), which is how I found that out.
- **A constant role survived** until the crew case existed: crew hold the capability nowhere
  event-wide and reach it only through §25.8.2's settlement-scoped floor, so their line is the only
  one that distinguishes *"asked with this row's role"* from *"asked with any role at all"*.

### Proved in the browser, and the first check proved nothing

As `performer.a@` the roster read `1/1 · Marlo Vance (you) · Signed off` with no Approve button — and
**that was not evidence**: the button's condition is `signableSettlementId != null && !approved`, so a
signed line hides it whatever the gate says. Deleting her approval row made the condition reachable:

```
Approval Status 0/1 · Marlo Vance (you) · Performer · Pending     ← unsigned
approveButtons: []                                               ← and still no button
```

API alongside it: `isYours: true, signableByYou: false` — hers to read, not hers to sign. Restored by
having the **agent** sign it, which answers **200** and is the counterpart proof: the signature exists
and belongs to somebody else.

### Suites

`npx biome check .` 756 clean · API `settlement` + `settlement-own-read` **142** · `tsc` clean.

---

## 3. Run 14 MAJOR — the all-time line printed a mixed-currency sum under one currency

**Mine, from `951a2a3`.** §25.8.1 landed on the four tiles and **not on the sentence one row below
them**, which read *"budgeted revenue SEK 216,000"* over 55,000 + 83,000 SEK + **78,000 NOK**.
Seventh instance of a ruling implemented on one of its two surfaces.

### The API was the wrong half to trust, and it was worse than mislabelled

`GET /insights/profiles/:id/revenue` sums `budget_lines` across every hosted shared ledger and then:

```ts
const [event] = await database
  .select({ currency: schema.events.baseCurrency })
  .from(schema.events)
  .where(eq(schema.events.hostProfileId, id))
  .limit(1);
```

The first hosted event's currency, **with no `ORDER BY`** — so the label was nondeterministic between
identical requests as well as wrong. My web-side fix pointed `rowMoney` at `revenue.data.currency`
believing it authoritative; it never was.

**The currencies now come from the rows that were actually SUMMED**, with the sum's own predicate
repeated deliberately: asking `events` alone would let a hosted night with **no shared budget** —
contributing nothing to the figure — refuse a label the total genuinely deserves, which is the
opposite defect and the one an easier query causes. A test covers exactly that.

`mixedCurrency` is a second field rather than an overloaded `currency: null`, because the two states
need different sentences: a mix has to be said out loud, an empty ledger has nothing to explain.
Client regenerated (`sync-spec` + `generate`).

### The web half, both parts

The line now says *"your hosted nights are budgeted in more than one currency, so there is no single
all-time figure to show."* And the **margin caption** stops surviving its own tile's refusal — it kept
*"68% of revenue, before deals"* under a dash, which is a ratio of two sums that span currencies and
so a percentage of nothing. It falls back to *"Before the deals pay out"* on the same condition the
tile refuses on.

### Mutations — four, all killed

Back to the first hosted event's currency · asking the profile's EVENTS instead of the summed rows ·
never reporting a mix · naming the first of several anyway.

**And the runner itself had a bug worth recording.** M2's first anchor matched **twice** — the sum
query shares that join chain — and the assertion caught it. But the aborted run had already left M1's
mutation in place, and re-running the script **re-took its backup from the mutated file**, so the
"restore" restored the defect and the baseline came back red. Repaired by hand, the poisoned backup
deleted, and the runner now **refuses to start if its backup already exists**: a mutation runner that
re-backs-up unconditionally will preserve whatever an aborted run left behind.

### Proved on the running stack

| Probe | Result |
| --- | --- |
| all SEK (control) | `{"totalRevenue":"51600000","currency":"SEK","mixedCurrency":false}` |
| one night flipped to NOK | `{"totalRevenue":"51600000","currency":null,"mixedCurrency":true}` |

The figure survives, only the symbol is refused. In the browser, with the mix in place: the all-time
line reads the new sentence, `Revenue − costs —` carries *"Before the deals pay out"*, and a regex for
`budgeted revenue (SEK|NOK|EUR)` matches nothing. **Currency reverted and verified** — all events SEK,
and the route answers `SEK / mixedCurrency: false` again.

### Suites

`npx biome check .` 756 clean · web **630** · API `insights` + `settlement` + `settlement-own-read`
**150** · `tsc` clean on api and web.

