# Urgent board — run 7's minors, cluster B (2026-09-28, part 15)

Part 14 carried QA7-6, QA7-9, QA7-10, QA7-28 and cluster A (QA7-13, QA7-19, QA7-14, QA7-8).
This part takes QA7-12, QA7-16 and QA7-15.

---

## QA7-12 — booking the whole venue on a night a room is taken says the room is free

**Which files settle it:** `apps/web/src/hooks/useDateConflicts.ts:71` and
`apps/web/src/components/EventRoomPicker.tsx:62`.

**Verdict: real, in two halves — and the mechanism for the first was already built last part.**

**The sentence.** `roomWasAsked` exists: QA7-4 added it, for exactly this — *"This room is still
free" is only true of a room somebody ASKED about*. It was wired into the request inbox
(`Requests.tsx:200`) and **not into the hook**, where it defaults to `true`. So every caller that goes
through `useDateConflicts` — the Create New Event dialog and the event workspace's own banner — kept
the old sentence. The hook already has the fact: `stageId` is `null` when no room was chosen.
`roomWasAsked: Boolean(stageId)` fixes both callers, and every future one, in the place the fact lives.

**The label.** The picker's option is **"The whole venue"**, and in a *booking* form that reads as
*"I am taking the entire building"* — which is what makes the sweep call the sentence a contradiction.
Three other names for the same value disagree with it:

| where | what it says for `stageId = null` |
|---|---|
| `EventRoomPicker.tsx:62` (the booking form) | **"The whole venue"** |
| `useCalendarSources.ts:64` (the constant's own docstring) | *"any room here"* |
| `useCalendarSources.ts:92` (the calendar filter) | **"All rooms"** |
| the saved event's Event Details | **"No room set"** |

One fact, four names, and the booking form's is the only one that means the opposite of the rest.

*Where this departs from the sweep, deliberately:* the finding expects a whole-venue booking to be
treated as a **clash** when any room is sold. The API has already decided otherwise, explicitly and
with its reasons written down (`apps/api/src/routes/events.ts:2196-2206`): a venue-wide question is
busy only when **every** room is taken, because *"the Back Room is shut" and "the Back Room is sold"
have to answer "can you host me on the 14th" the same way, or the two halves of the warning contradict
each other.* So this is not a product call waiting on Ran — it is a label contradicting a settled
rule, and the label is what moves. Relabelled to what the event page itself will say once saved.

*Scope:* one argument in the hook, one string in the picker. No change to the conflict query, to
`roomIsBusy`, or to what can be booked.

---

## QA7-16 — a co-promoter's all-time line reports a measure it does not name

**Which file settles it:** `apps/web/src/routes/Projections.tsx:274`.

**Verdict: real.** The line reads *"All time, ignoring the filter above: budgeted revenue SEK 0
across 0 events you hosted"* directly beneath a panel reading **SEK 83,000**. It presents itself as the
same measure with the filter removed; it is a different measure. Both halves come from
`GET /insights/profiles/:id/...`, and both are `WHERE events.host_profile_id = :id`
(`routes/insights.ts:79,84`) — while the panel above is participation-scoped. For `co.host@`, who is
never the host, the sentence can only ever say zero.

The operator's own copy of the line is consistent (*SEK 336,000 across 6 events you hosted* beside
SEK 336,000 in the panel), which is exactly why this hid: the mismatch is invisible from the seat the
line was written in.

**Scope:** two changes, both in the sentence. It **names its scope** — "as host" — so it can no longer
be read as the panel's own figure with the filter off. And it is **not drawn at all when the reader
hosts nothing**: the scope caveat is its whole reason to exist, and there is no scope difference to
caveat when one side of the comparison is empty by definition. Nothing about either query changes.

*The decision it hides:* none. The endpoints' scoping is explicit in their `where` clauses, and this
line's own comment already says *"the scope difference it exists to state"*. It simply did not state it.

---

## QA7-15 — the invite dialog defaults to the one role this plan refuses

**Which files settle it:** `apps/web/src/hooks/useTeamAccess.ts` (the catalogue that is right),
`apps/web/src/components/TeamInviteMemberModal.tsx` and `TeamMemberEditModal.tsx` (the copy that is
not).

**Verdict: real, and bigger than the default.** The ROLE picker pre-fills **Editor**; submitting is
refused with *"Your plan includes one administrator. Everyone else can be added as a viewer or crew."*
The API is right: `SEAT_CONSUMING_ROLES = ["owner", "admin", "editor"]`, a free account has one seat,
and the owner holds it (`lib/entitlements.ts:540`, quoting Daniel on 2026-09-01 — *"Freemium gets one
admin seat the rest are all view roles (team/crew)"*). Editor is not available on Free, by decision.

The dialog contradicts that rule **three times**, and this is the sixth instance this run of *copy
stating a rule the code does not keep*:

| where | what it says | what the API does |
|---|---|---|
| `DEFAULT_ROLE = "editor"`, commented *"least authority that still lets a team member do the work"* | Editor is the safe default | it is the first role a free plan refuses |
| the Admin option: *"Consumes a seat — paid plans only"* | Admin is the only one | Editor consumes one too |
| the refusal's own footnote: *"Viewer, Editor and Crew are included on every plan"* | Editor is free | **false** — in the very message explaining the refusal |

**The cause is a duplicated catalogue, and that is what gets fixed.** The web app holds the roles
twice: `TEAM_ROLES` in `useTeamAccess.ts` — which is **correct**, marks `editor` as
`consumesSeat: true`, defaults to `viewer`, and quotes the decision — and `ROLE_OPTIONS` in
`TeamInviteMemberModal`, which is the drifted copy behind all three errors. CLAUDE.md's review gate
names this exactly: *"Two copies would eventually disagree."* They did.

*Scope:* `ROLE_OPTIONS` is **deleted**; its two consumers read `TEAM_ROLES`, which gives that catalogue
three call sites and the app one answer. The false footnote becomes a sentence **derived from the
catalogue** rather than written beside it, so it cannot drift again — that is a pure rule with a test.
`TEAM_ROLES` is reordered least-authority-first so the picker's first option is also the default and
the one every plan permits; it changes the option order on the Team access panel, which shares the
catalogue, and that is an improvement rather than a side effect.

**What this deliberately does NOT do:** disable the roles the plan refuses *in the picker*, which is
the finding's other suggestion. The client cannot see the account's seat count — there is no
entitlement read in `packages/api-client` — so the honest version of that needs an API surface, and
inventing a client-side guess at a paywall is how a UI starts disagreeing with the thing it is
guessing about. Instead every seat-consuming option **says so on itself** (`TeamAccessPanel` already
does this: *"This role uses one of the account's seats"*), which is the fact the reader needs before
choosing, and the refusal that follows is now true. Recorded here rather than left implied.

---

## Built, and proven on the running stack

### QA7-12

One argument in the hook, one string in the picker.

| the question put | the sentence, before | the sentence, now |
|---|---|---|
| venue only, no room, 15 Oct (Main Room `confirmed`) | *…" in Main Room. **This room is still free.**"* | **"Already on this night: "Marlo Vance — Album Release" in Main Room."** |
| Main Room named, same night | *"Main Room already has … You can book it anyway."* | **unchanged** |
| the picker's option for "no room" | "The whole venue" | **"No specific room"** |

Both branches driven in the real dialog. The second row is the one worth checking: the strong warning
is the reason `roomWasAsked` defaults to `true`, and it had to survive.

**No unit test, and here is why.** `conflictMessage` already has both branches covered — 16 tests,
green throughout. The defect was one argument the hook never passed, and pinning *that* needs the hook
under a React renderer. This repo has no `renderHook` and no testing-library: every hook test here is
of an extracted pure function, and adding the infrastructure for one boolean is a bigger change than
the fix. The browser readings above are the evidence, said plainly rather than left as an implied
"tested".

### QA7-16

Proven from both seats, which is the only way this one is visible:

| reader | before | now |
|---|---|---|
| `co.host@` | *"All time… SEK 0 across 0 events you hosted"* under a panel of **SEK 83,000** | **the line is not drawn** |
| `operator@` | *"All time, ignoring the filter above: …"* | **"All time, as host — ignoring the filter above: budgeted revenue SEK 216,000 across 5 events you hosted."** beside a panel of SEK 216,000 |

### QA7-15

`ROLE_OPTIONS` deleted; both modals read `TEAM_ROLES`. **7 tests** in a new
`useTeamAccess.test.ts`, **four mutations all red**: editor stops costing a seat · the default goes
back to editor · the hint swaps its two halves · `andList` drops the last item.

Driven in the real dialog as `operator@` on the free plan:

| step | before | now |
|---|---|---|
| ROLE pre-fills | **Editor** — the first role the plan refuses | **Viewer** |
| the option order | Viewer, Editor, Crew, Admin | **Viewer, Crew, Editor, Admin** — least authority first |
| choosing Editor, before submitting | the description only | *"…not the team.* **This role uses one of the account's seats.**" |
| submitting Editor | *"Admin is the one role that consumes a seat. Viewer, Editor and Crew are included on every plan…"* | **"Editor and Admin each consume one of the account's seats. Viewer and Crew are included on every plan — pick one of those, or upgrade this account's plan."** |

The API's own refusal above it is unchanged (*"Your plan includes one administrator…"*) — what changed
is that the app stops contradicting it in the next breath.

**The harness lied again, and differently.** One mutation came back `SKIP — anchor matches 0 times`:
the runner passes the anchor to Python through a here-string, and `<<<` appends a newline, so any
anchor that is not a whole line can never match. Worth recording next to part 14's note, because the
two failures are opposites — that one reported a false survivor from silence, this one refused to run
and **said so**. A harness that cannot measure must fail loudly; the fix was `[:-1]`, and the mutation
is red.

## Suites

biome **736** clean · `tsc` clean · web **462** (up from 455: 7 for the team catalogue).
