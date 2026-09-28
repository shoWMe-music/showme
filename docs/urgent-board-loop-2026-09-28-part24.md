# Urgent board loop — 2026-09-28, part 24

Part 23 closed run 9 and built Daniel's four rulings. This part folds in **qa-sweep run 10**
(`docs/qa-sweep-2026-09-28-run10.md` — 6 MAJOR, 8 MINOR, 2 COSMETIC, 4 NOTE, one withdrawn) and
carries out the standing instruction to **verify the animations before the loop ends**.

Commits: `cf94ef9` · `96c9b44` · `40d95f7` · `1161cad` · `5e10a41`.

The sweep's own §0 is worth reading before its findings: four commits landed *under it* from this
session, three touching API routes, and the API does not hot-reload. It found that from `git log`
rather than from a probe, withdrew one finding and narrowed another. That is the discipline working
in the other direction for once.

---

## 1. The three MAJORs, all fixed

### QA10-1 — my own regression, an hour old · `cf94ef9`

**The Budget Planner did not follow §25.7.1 into the forecast.** I changed `reconcile()` to settle a
named-payer rental between its parties and did not change the planner that forecasts what it will
pay. On the sweep's own night the planner quoted the act **SEK 70,000** and the settlement paid
**SEK 73,500** — the gap is SEK 3,500, precisely the figure §25.7.1's hand-check names as the act's
movement. The window is the negotiation window: terms get agreed against the forecast, and the
difference surfaces where it cannot be renegotiated.

**`budget-planning.ts` had already written the rule down:** *"the Budget Planner moves with the
engine, in the same commit … a split would otherwise have quoted the forecast one fee and the
settlement another."* **Instance thirteen** of *a comment that states a rule is a test that never
runs*, and the first where the comment described the exact mistake being made.

So the fix is not the one-line filter the sweep suggested. The rule is one function —
`rentalComesOffTheTop` in `packages/settlement/src/deal-order.ts` — and both the engine and the
planner call it. Four planner tests covering all four shapes the engine's tests cover.

*A fifth "survivor" was my own malformed mutation: it inserted a no-op filter and left the real one
standing. Re-run properly, removing the filter fails two tests. Always check that the mutation
changed the behaviour, not just the file.*

### QA10-3 — an unsignable agreement, which freezes the night · `96c9b44`

A co-host named as a deal party got no *Confirm your line* control while `POST /deals/:did/confirm`
answered **200** to the same account. `POST /settlement/compute` refuses while an agreement is
unsigned, so from the browser that night could not be settled at all — the shape `CLAUDE.md` already
records as *"an unsignable agreement that froze a whole event's settlement"*.

The cause: `useEventAgreements` restated the server's set as `["crew","crew_lead"]` — "mirroring
`@showme/auth`" — and the server's has carried `co_host` all along. **A mirror is a copy that
drifts.** One definition now (`confirmsOwnDealLines` in `@showme/shared`), read by both sides, with
the observer clause inside it.

**The sweep's scope line was wrong and checking it kept the fix to one thing:** it said "and by the
same clause a `support` act", but `PERFORMER_FLOOR` carries `agreement.confirm`, so a support act
holds it event-wide and never reaches this rule.

*Five mutations, all killed at the DEFINITION — which is where they had to go. Two survived when
aimed through the consumers: the web filters observers out before asking, so its tests cannot fail on
the observer clause.*

### QA10-2 — one room hire opened the host's books · `40d95f7`

`partiesVisibleTo` named the thing it protects — *"a payee seeing the payer's line would be reading
the operator's whole margin (the operator's per-participant line is the pool residual)"* — and then
protected it by asking which **end** of the deal you were on. Turn one deal around and it inverts.
So a co-host on Standard access read the host's residual (SEK 7,875), gross collection (SEK 120,000)
and costs paid (SEK 15,000), itemised, under the sentence *"The night's takings and costs are the
operator's view of this event"*. §25.7.1 made that shape normal the same day.

The rule is now what the comment always said: a participant who **operates** the event is never
disclosed by deal membership, whichever end the caller is on — which is also what the very next
comment in the file already claimed.

**The role set had been written out three times** (`OPERATOR_EVENT_ROLES`, `OPERATING_ROLES` under a
comment reading *"Mirrors OPERATOR_EVENT_ROLES"*, and the check this fix needed would have been the
fourth). One definition now: `EVENT_OPERATOR_ROLES` / `operatesTheEvent`.

*The test uses a co-host with NO permission set, and that is the point: Full control carries
`budget.view`, so for that seat the pool is legitimately readable and the test would have measured a
grant instead of a leak. My first draft got it wrong and the ladder assertion caught it.*

---

## 2. The animation pass

Measured with the stack **idle** — a trace taken while a sweep drives the app records the sweep's
dropped frames, not the animation's.

**What was already right,** written down so the next pass does not re-derive it: reduced motion is
answered once, by collapsing the duration tokens to 0ms, and every CSS animation is built from those
tokens. The four hand-written durations (Skeleton, Spinner, StatusDot, Badge) each carry their own
`prefers-reduced-motion` block, and the Spinner deliberately *slows* rather than stops — a spinner
that does not spin reads as broken.

### Three things fixed · `1161cad`

1. **Four dead keyframes and one animation defined twice.** `global.css` had `sm-rise`, `sm-grow`,
   `sm-pulse`; tokens.css had `smRise`, `smGrow`, `smPulse`. Of the six, exactly one had a user.
   Nine keyframes remain and every one has a caller.
2. **The app's most prominent dialog had no motion at all.** `NewEventWizard` draws its own overlay
   rather than using the shared `Modal` shell — the file already said so, where its close button had
   to grow its own touch target for the same reason. It borrows `useModalMotion` now, exit tween
   included (hence the guard is `rendered`, not `open`).
3. **An identity transform is still a transform.** `useModalMotion` left the panel on
   `matrix(1,0,0,1,0,0)`, making it a containing block. Nothing hits it today — the Select popover
   portals to `<body>`, which I checked rather than assumed — which is why it was worth clearing
   before something does. The other two motion hooks already state this rule.

### Measured live — all seven, each with its resting state

| Motion | Ran | At rest |
|---|---|---|
| deal fold, open | 12 heights, 11 opacities | `height: auto; overflow: visible` — later growth not clipped |
| deal fold, close | 15 heights | exactly `0px`, boundingHeight **0**, `inert` back, no transform |
| New Event wizard | 8 scrim opacities, 19 panel transforms from `scale .96 / y 12` | transform **cleared** |
| page transition | 17 transforms from `translateY(10px)`, 13 opacities | `transform: none` |
| tabs indicator | 9 states, `left 177px → 280px` | — |
| tab pane | 13 transforms from `translate(14px, 0)` | back to exactly the call site's own style |
| sidebar item | marker + background, 24 states each | — |
| toast | 18 states from `translate(0, 16px) scale(.98)` | unmounts |

Heaviest interaction (three folds opening and closing at once): **zero long tasks, INP 56 ms,
CLS 0.00.**

### Four of them are now e2e tests · `5e10a41`

e2e **116 passed**, up from 112. The reduced-motion path is in there, and it is the only way to run
it at all — the setting is the viewer's, so no amount of clicking reaches it. The assertion is **zero**
intermediate frames, because the hook does not shorten the tween, it does not create one.

### Three ways the measuring lied, all caught

- **A synthetic click manufactured a defect.** The first trace showed CLS 0.06 with the deal cards as
  culprits, which reads like a real layout-shift bug. `element.click()` is not a **trusted** input,
  so CLS does not excuse the movement it causes. Through the browser's real input pipeline the same
  interaction scores **0.00**.
- **I sampled the wrong node three times** — the sidebar toggle instead of a deal fold, a
  `min-width`-carrying div instead of the tab pane — and each time the honest reading was "no motion
  here", which looks exactly like a broken animation. What settled it was watching *every* element
  under `main` for an inline transform rather than guessing which one should have it.
- **I read a filter chip as a toast.** `body.innerText.match(/Archived/)` matched the events list's
  **Archived filter chip**, so "the toast appeared" was asserted from a button's label — and the same
  prefix match meant my earlier clicks hit that chip rather than the menu item, so nothing was ever
  archived. The real toast says *"Archived "Winter Gala" — it's under the Archived filter."*
  Winter Gala was genuinely archived on the successful attempt and has been restored
  (`archivedAt: null`, verified).

---

## 3a. The other three MAJORs

### QA10-4 — the invitations addressed to you now have somewhere to appear · `950d008`

Built as planned in §3b, and the plan's verdict held: `INVITABLE_ROLES` was a red herring and the
real gap was that **no "addressed to me" read existed**. `GET /me/invitations` is it. The card lists
them under the same heading with a LINK, because the accept for a token invitation is token-keyed.

Two mutations SURVIVED and both are redundant lines rather than test gaps — the `type` filter (the
inner join on `target_event_id` already excludes profile invitations) and the empty-email early
return (`lower(email) = NULL` matches nothing anyway; what it saves is the query). **Both are kept
and both now say in the code that they cannot change the answer**, rather than looking like guards a
test forgot. A boundary test was added for the first.

Proven as the co-promoter: *"1 event invitation · Open Mic Wednesdays · as Co-operator · from The
Lantern Hall · Open the invitation"*, and the link lands on *"Role: Co-operator … Accept / Decline"*.

### QA10-9 — a cancelled agreement stops inviting signatures · `dc61c24`

**My own §25.7.2 Cancel control made cancelling reachable and did not make it legible.** A fix
carrying its own next defect. The card read *"Sent — awaiting confirmations"* with a live *Confirm
your line*; the only trace of the cancellation was the missing Cancel button — an absence. Both
signatures were then accepted, leaving `agreement_status = confirmed` on a `cancelled` row.

- **The gate**: `assertAgreementSignable` refuses a cancelled deal. It goes there because that
  function is the one gate both the in-app confirm and the off-platform share link use.
- **A rule in two places, the enforcing copy behind**: `GET /deals/awaiting-signature` had already
  filtered cancelled deals out of the dashboard nag, and its comment said the gate *"refuses only
  that [draft]"* — true when written. Corrected.
- **A test pinned the opposite**, on the grounds that *"the terms they signed are still a record
  worth keeping"*. The record worth keeping is the record of what was OFFERED — the deal row and its
  snapshot — and a signature added after withdrawal asserts agreement to something no longer on the
  table. A withdrawn offer cannot be accepted. The property that test really protected now holds more
  simply: the agreement never reaches `confirmed` at all.
- **The card** never received the deal's own `status`, so it could not say the one thing that
  mattered. And it printed *"Cancel it instead"* on a deal already cancelled — **the sixth instance
  of a sentence untrue of its reader, and this one was mine.** Caught in the browser, not by a test.

### QA10-5 — a typed venue gets linked · `dc295d2`

Every consequence of the NULL venue profile was silent: no agent attached and none told (#14), no
country stamp (#17), no double-booking check. The server now resolves the caller's **own** operator
profile on an exact name match, and nothing else — a stranger's venue, two of your own sharing a
name, a non-operator profile of yours, and a name matching nothing all stay unlinked, each with a
test. **Two of those five tests exist only because mutations survived**, on cases the docstring
claimed.

The end of the chain is asserted rather than inferred: on an event whose venue was only typed, the
agency is on the bill AND has a notification. Proven through the wizard itself — typed the name, left
the visible suggestion untouched, and the venue came back linked.

*A gotcha for the next tick: an API relaunched from `apps/api` has the command line
`tsx/dist/cli.mjs src/server.ts`, so `pkill -f "apps/api/src/server.ts"` does not match it. Mine died
on EADDRINUSE and I was briefly testing against the old process, which answered a confirm that should
have been refused. **Kill by port.***

## 3. Still open from run 10

- **All six of run 10's MAJORs are now fixed** (QA10-1, -2, -3 in §1; QA10-4, -9, -5 in §3a).
- The remaining MINOR/COSMETIC findings, and run 9's web-side leftovers: QA9-5, QA9-7, QA9-10,
  QA9-11, QA9-12's render half, QA9-13. QA10-10 (the "Operators only" room names the co-promoter as a
  member, hides it from them, and refuses their post with *"Missing capability: budget.view"*) is the
  pick of the MINORs — it is the same shape as QA10-3, a roster and a gate disagreeing.
- Blocked: `86cbcn1q4`, `86cbcn1rr`, `86c9mq7q9` until `/design-login` works.
- §25.6's other five rows, and §25.7.1's one follow-up question, still Daniel's.

## 3b. QA10-4, second leg — the plan, before building

**Which file settles it:** `apps/api/src/routes/participants.ts` (`GET /me/event-invitations`) — and
then a route that does not exist yet.

**The verdict: the sweep's two causes are one cause, and it is the second one.** Checked against the
code rather than taken as read:

- `INVITABLE_ROLES` excluding `co_host` is **unobservable on its own**. Nothing in the app can create
  an `invited` co-host participant row: `POST /events` accepts only `performer` and `support`
  (`events.ts:250`), `POST /events/:id/participants` writes a co-host **`accepted`** (its own comment:
  *"adding a co-promoter here RECORDS an arrangement rather than asking a question"*), and the token
  accept writes `accepted` too (`invitations.ts:1075`). So adding `co_host` to that list would change
  no answer — it would be a widening on speculation, which is what §25.7.4 warned about.
- **The real defect is leg 2, and it is wider than the sweep framed it.** The query reads
  `event_participants` for events the caller already touches; an email-addressed collaborator invite
  writes **only an `invitations` row** and no participant row, so `eventIds` is empty and the answer is
  `[]`. That is true for **every role**, not only co-host — a performer invited by email is equally
  invisible. Co-host is simply the dialog's default, which is why the sweep met it there.

**The scope: build the read that does not exist.** Run 9's QA9-3 already recorded *"There is no
'invitations addressed to me' read"*; I fixed the bell's link that tick and left the gap. `GET
/profiles/:id/invitations` lists what a profile has **sent**. So:

1. `GET /me/invitations` — pending `invitations` rows whose recipient email is the caller's, with the
   token, the target event and the role. **Additive**: the existing endpoint's shape is untouched, so
   no nullable `participantId` ripples through a response two screens already read.
2. The invitation card lists them with a link to `/invitations/:token` — the page that already works
   end to end (the sweep drove it by hand), rather than inline Accept/Decline, because the accept for
   a token invitation is token-keyed and there is no participant row for `participation/accept` to move.

**The decision it hides: may the caller be handed the token?** Yes, and it widens nothing. The token
is the grant, and the population that gets this list is exactly the population
`POST /invitations` already notifies — `lower(users.email) = recipient_email`, the same match, the same
person who receives the token by email. What would be new is a *different* user reading it, and the
match is what prevents that. It is asserted in a test rather than left to the reader.

## 4. Full pass

biome **742** · shared **330** · auth **35** · settlement **72** · web **490** · api **1423**
(1393 + the 30 re-run after four container flakes) · e2e **116** · `tsc` clean in five packages.

The API count reconciles exactly: 1415 plus the 8 tests added. *A count is only evidence if you know
the baseline.* And the flake grep in the loop's own instructions does not match the real message —
`Timed out after 10000ms while waiting for container ports` — which is why part 23 corrected it.
