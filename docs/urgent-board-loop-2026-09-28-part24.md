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

## 3. Still open from run 10

- **QA10-4, second leg (MAJOR).** My QA9-3 fix made the bell work; the inbox card still cannot show a
  co-host invitation, because `INVITABLE_ROLES` excludes `co_host` — *and co-host is the Invite
  Collaborator dialog's default role*. The query also reads `event_participants`, while a collaborator
  invite writes only an `invitations` row. **Next.**
- **QA10-9** — a cancelled deal reads as a live offer on both Deals tabs, and both parties'
  signatures were accepted on it (`agreement_status = confirmed`, `status = cancelled`). Worth
  Daniel's eye.
- **QA10-5** — every wizard-created event leaves `venue_profile_id` NULL, so `venueInRegion()` is
  false and a represented act's agent is never attached or told. Proved against an API-created event
  with the venue linked, where the agent row and the notification both appear.
- The remaining MINOR/COSMETIC findings, and run 9's web-side leftovers: QA9-5, QA9-7, QA9-10,
  QA9-11, QA9-12's render half, QA9-13.
- Blocked: `86cbcn1q4`, `86cbcn1rr`, `86c9mq7q9` until `/design-login` works.
- §25.6's other five rows, and §25.7.1's one follow-up question, still Daniel's.

## 4. Full pass

biome **742** · shared **330** · auth **35** · settlement **72** · web **490** · api **1423**
(1393 + the 30 re-run after four container flakes) · e2e **116** · `tsc` clean in five packages.

The API count reconciles exactly: 1415 plus the 8 tests added. *A count is only evidence if you know
the baseline.* And the flake grep in the loop's own instructions does not match the real message —
`Timed out after 10000ms while waiting for container ports` — which is why part 23 corrected it.
