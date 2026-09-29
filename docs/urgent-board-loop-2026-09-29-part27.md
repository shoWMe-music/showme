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
