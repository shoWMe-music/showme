# Urgent board loop — part 36 (2026-09-30)

Continues part 35 (221 lines), which closed the copy sweep, a `node:util` blocker it turned up, and
decisions **§25.8.1**.

---

## 1. decisions §25.8.2 — a crew member MAY sign off their own settlement, settlement-scoped

**Daniel's ruling:** *yes, and scoped to the line.* A party may sign the settlement line that is
theirs and nothing else. `CREW_FLOOR` stays thin — the capability is **not** added to it — and the
grant mirrors `DEAL_SIGNATORY_FLOOR`, which does exactly this for `agreement.confirm` because a
venue↔crew deal would otherwise be a dead end.

**Why it was asked:** three surfaces asked crew for a signature the fourth forbade. They are served
their own figures, they get the *"Check your figures and sign off when they match your books"* email
that `POST …/settlement/status` sends to every party, they open a settlement screen with no sign-off
control, and the route answers `403 Missing capability: settlement.confirm`.

### The ruling's own prediction no longer holds, and that is my doing

§25.8.2 records: *"The approval roster's denominator follows automatically: `signatureExpected` is
derived from each party's floor, so crew stop reading 'Not required' the moment the grant reaches
them."*

**That was true when it was written and is not true now.** `3c7131c` (part 33, run 13's MINOR at 292)
changed that derivation to floor **∪ band**, and a settlement-scoped grant is in neither: it is not a
role floor and not a permission set. So the roster would keep printing *"Not required"* over a crew
member who can now sign — the same defect the ruling was answering, surviving its own fix. The roster
has to be told about the third source explicitly.

### Which files settle it

Measured: **four** places ask "may this caller sign", and all four ask it as *event capability +
ownership*.

| Where | The capability half today |
| --- | --- |
| `POST /events/:id/settlements/:sid/confirm` | `requireEventCapability(…, "settlement.confirm")` |
| `GET /settlements` → `signableByYou` | `capabilitiesByEvent.get(eventId).has("settlement.confirm")` |
| `GET /settlements/awaiting-signature` | the same, per event |
| `GET /events/:id/settlements` → `approvals[].signatureExpected` | floor ∪ band, per `3c7131c` |

Which roles: `crew` and `crew_lead`, and **only** those. Measured against every floor —

```
host false→(true)   co_host (true)   performer (true)   support (true)
crew FALSE   crew_lead FALSE   agent FALSE   performer/support when DELEGATED FALSE
```

- `host`, `co_host`, `performer`, `support` already carry it, so a grant would be inert. This is where
  the deal precedent differs and the difference is measured, not assumed: `DEAL_SIGNATORY_FLOOR` had
  to include `co_host` because `OPERATOR_FLOOR` genuinely lacks `agreement.confirm`. Here it does not.
- a **delegated** performer is excluded *by construction* — the function takes the ROLE, and their
  role is `performer`, which is not in the set, so they fall back to their own (empty) delegated
  floor. Handing it back here would revoke the delegation the agent's authority rests on, which is
  the reason `DEAL_SIGNATORY_FLOOR` leaves performers out entirely.
- an **`agent`** is excluded because its own line is entitled to nothing (#14) and its preset already
  grants the capability event-scoped where the operator chose it, which is how it signs for its ACT.
  A floor-level grant would hand every agency confirm on its own zero line with no preset at all —
  a widening nobody ruled.

### Scope

1. `@showme/auth`: `SETTLEMENT_SIGNATORY_FLOOR` + `settlementPartyBaselineCapabilities(role)`,
   beside `DEAL_SIGNATORY_FLOOR` and shaped identically.
2. `routes/settlement.ts`: one predicate — *event-scoped OR settlement-scoped on a line that is
   yours* — asked by all four sites, so the four cannot drift. This is `maySignOwnLines`'s own
   argument in `routes/deals.ts`: *"a second copy of this is how a dashboard starts offering a row the
   confirm route then refuses"*.
3. The roster's `maySign` gains the third source, or the ruling lands on three surfaces and not the
   fourth.

### What it obliges that the ruling names

The *"check your figures"* email stops being the odd one out with **no change to it**: it already
asks every party, and the ask is now true. That is the one surface the §25.6 row said the
inconsistency was confined to.

### Built

`@showme/auth`: `SETTLEMENT_SIGNATORY_FLOOR` + `settlementPartyBaselineCapabilities(role)`, over
`{crew, crew_lead}` and nothing else. `CREW_FLOOR` is untouched, which is the ruling's own condition.

`routes/settlement.ts`: **one** predicate, `maySignOwnSettlement(capabilities, role)` =
`event_scoped ∪ settlement_party_scoped(the line's own role)`, asked by all four sites so they cannot
drift. It deliberately does **not** ask whose line it is — ownership is a different question with a
different answer (`signable`, which also covers an agent signing for their act), and merging them
would make this the authority on delegation too, the exact conflation part 33 had to untangle.

The confirm route's gate moved from `settlement.confirm` to `event.view`, because since the ruling the
capability answer depends on the role of the line being signed and cannot be asked before we know
which line that is. Ownership is checked first so the refusal is the true one: a party who owns no line
here is told that, and a party who owns this one but may not sign it is told the other thing.

### The web had to change too, and I nearly stopped one step early

The API was right and the screen still drew no button, because `EventSettlement.tsx` gated Approve on
`settlement.authority.canConfirm && approval.signableSettlementId != null`. The first clause asks the
**event-wide** capability; the second is built from the API's own per-line `signableByYou`. So the
first was a second copy of a rule the API owns, and the moment the line-scoped grant landed it became
the wrong copy: the line came back signable, the roster said *"Pending"* over it, and nothing was
drawn. `canConfirm` is gone from that gate.

Its sibling had already learned this — `useEventAgreements` computes
`canConfirm: (authority.canConfirm || signsAsDealParty)` for precisely this reason. **A screen
withholding a signature the route would accept is the same defect as offering one it refuses**, which
is `maySignOwnLines`' own warning read in the other direction.

### And the ruling opens a gap I did NOT close

`dispute` stays event-scoped, deliberately: flagging one moves the **whole** settlement's status,
which is every party's, not one line's. So a crew member may now sign and still may not object — and
the screen's comment called those *"the same authority, inverted"*, which has stopped being true.

That is a product call, so it went to Daniel as a new §25.6 row rather than being taken. The cost is
concrete and worth stating plainly: the email now truthfully asks crew to *"sign off when they match
your books"* and in the same breath says *"if something looks wrong, say so there"* — so the
asking-and-ability rule this ruling was decided on is still half-kept. §25.8.2's own "what it
obliges" note is corrected in `decisions.md` as well, since its prediction about the roster was
falsified by `3c7131c`.

### Proved on the running stack, as the seat the ruling is about

| Probe, as `professional@` | Before | Now |
| --- | --- | --- |
| `GET /settlements` → `signableByYou` | false | **true** |
| `GET /settlements/awaiting-signature` | `[]` | **1 item, `isYours: true`** |
| `POST …/settlements/<own>/confirm` | **403** `Missing capability: settlement.confirm` | **200** `{approved: true}` |
| `POST …/settlements/<Marlo's>/confirm` | 403 | **403** `"You can only confirm your own settlement"` |
| host's roster badge | 1/5, Priya *"Not required"* | **1/6**, Priya **"Pending"** |

In the browser as Priya: the Dashboard now offers *"Check your figures on Marlo Vance — Album
Release"*, the settlement screen reads **"Approval Status 0/1 · Priya Sound (you) · Crew · Pending ·
[Approve]"**, and no Flag-a-dispute control. Pressing Approve took it to **1/1 "Signed off"** — and
the `settlement_approvals` row is written with its timestamp, read from the database rather than from
the toast.

### Mutations — nine, all killed

`presets.ts` 4/4: emptying the role set, **adding `performer`** (the delegation hazard — it would
revoke what the agent's authority rests on), **adding `agent`** (whose own line is entitled to
nothing), and emptying the floor itself. `settlement.ts` 5/5: dropping either half of the predicate,
dropping the ownership check, and the roster and `awaiting-signature` each forgetting the third
source.

### Three tests pinned the open question and are flipped

`signableByYou` false + 403 → true + 200; the roster's *"does not expect a signature from crew"* →
expects one; `awaiting-signature` listing `[]` for crew → listing their own line. Each records that
the assertion inverted because of a **ruling**, not a drift — and the first gains the half a grant is
most likely to overshoot: the crew member may sign their own line and is still refused another
party's.

### Suites

`npx biome check .` 756 clean · auth **41** · web **630** · API settlement pair + activity **154** ·
`tsc --noEmit` clean on api, web and auth.

