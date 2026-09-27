# Urgent board loop — 2026-09-27, part 6

Continues `docs/urgent-board-loop-2026-09-27-part5.md` (which holds the QA-sweep run 4
fixes). Same rules; read-only on ClickUp, nothing deployed.

## `86cbcn1je` — a face is a door wherever there is a page behind it

**Verdict: the ticket is an epic and the audit scoped it correctly.** `86cbcn1je`
("Booking: requests, offers & discovery") carries ten bullets. Four are ticked by Ran.
Three of the rest belong to other tickets and are already built or separately planned —
the venue+room autofill is `123qy9rpqp0` (built in item 1 of this loop), the double-booking
warning is `123qy9rprbx`, and the whole *"Accept request → draft event / Make offer inside
Deals"* rework is the request-to-event flow, which is not a small fix by any reading.

**The one small, unblocked bullet is this:** *"Profile avatars across the platform show
images but still don't link to the public profile pages."* `ProfileFace` was written for
exactly that and has **one** call site (`routes/EventDetail.tsx`); every other roster draws
a bare `Avatar`.

### Where it goes, and where it deliberately does not

`ProfileFace`'s own docstring carries the constraint that decides most of this: *"Never use
this inside an already-clickable row — a link within a link is not a thing."* So the sweep
of twenty files answers itself, and the answers are worth recording so the next pass does
not re-litigate them.

| Surface | Verdict |
|---|---|
| `EventDetailsTab` — the Performers card | **Door.** `performer.slug` is already in scope (`ProfileNameMenu` uses it) and the row is a plain div |
| `EventCrewPanel` — the crew row and the In-House card | **Door.** Needs `publicSlug` carried on `CrewMember`; it is on the roster the list is built from |
| `Events.tsx` — the headline act on a list row | **No.** The whole row is a click target that opens the event, and the face is an 18px `aria-hidden` decoration beside the name |
| `EventMessagesTab` — the thread rail | **No.** The row is a `<button>` that selects the thread |
| `GroupCard`, `AudienceCard`, `AppShell` | **No.** Each sits inside a button, and the last one is the reader's own face |
| `Team.tsx` | **No.** A team member is a USER, not a profile with a public page |
| `CommentThread`, `SettlementShares`, `SettlementViewingAs`, `WhoOwesWhomBoard`, `EventSettlement` | **No.** Initials only — no avatar and no slug on those payloads. Making them doors is an API change to the settlement serializers, not this bullet |
| `Contacts.tsx` | **No — and it is a different ticket.** `123qy9rngc8` asks for exactly this (*"any contact who is an active user … can be clicked to reach their public profile"*) and it needs a contact→profile join that does not exist |
| `Profiles.tsx`, `ProfilePublicPreview` | **No.** Both already carry an explicit "Open public page" affordance; a second door to the same page is noise |

### Scope

Two components, one interface field, no API change, no new copy. The slug is only ever
non-null for a PUBLISHED profile — the serializer decides that, not the caller — so an
unpublished act and an off-platform hand added by name both keep a plain face rather than
a link onto a 404.

**No decision hidden.** The rule was already written down; this applies it.

### Built

`ProfileFace` gained one prop and lost one assumption. It hardcoded a **50 % border radius
on the link wrapper**, which is right for the circle it was written beside and wrong for
the two rosters it was rolled out to — both draw SQUARE faces, so using it as-is would have
silently changed the design in order to add a link. `shape` now passes through to `Avatar`
and the wrapper computes the same radius `Avatar` computes for that shape, so the focus ring
and the hit area follow the picture instead of describing a circle around a square.

| Surface | What changed |
|---|---|
| `EventDetailsTab` Performers card | the face is a link; the same `slug` the name's menu already used, so the two cannot disagree about whether a page exists |
| `EventCrewPanel`, both places | `CrewMember` carries `publicSlug`, mapped from the roster in `EventDetail.tsx` — no API change, the field was already on the wire |

Proven live as `operator@` on the seeded album release:

```
Performers  link "Marlo Vance — public profile" → /profile/e2e-marlo-vance
Team/Crew   link "Priya Sound — public profile" → /profile/e2e-priya-sound
In-House    link "Priya Sound — public profile" → /profile/e2e-priya-sound
```

**And the negative case, on the running stack rather than in the component's logic:**
setting Neon Tide's profile to unpublished and reloading leaves their face a plain avatar
with no link at all (and their name stops being a menu, because `ProfileNameMenu` has
nothing to offer either). That is the whole reason the API sends a slug only for a published
profile — a link built from a slug alone would 404 for everyone who has not published.
Restored afterwards.

Suites: biome 718 · web 341 · e2e 112.

## `123qy9rnk3m` — auto logout

**Verdict: real, and the audit is right that nothing exists.** Ran's two lines are the whole
spec: *"Log out from the account If no activity for 1 hour (default)"* and *"Add to security
settings and allow changing the time or disabling auto log out."* Tagged `security`, and
duplicated on the old board as `86c9mhqu6`.

### Which files settle it

| File | What it holds |
|---|---|
| `apps/web/src/lib/idleLogout.ts` | **new** — the rule, the options, and the stored value. Pure, so it can be tested |
| `apps/web/src/lib/idleLogout.test.ts` | **new** |
| `apps/web/src/hooks/useIdleLogout.ts` | **new** — the listeners and the timer, in the shell |
| `apps/web/src/shell/AppShell.tsx` | one call |
| `apps/web/src/routes/Settings.tsx` | the Security panel row |

### The decision this hides: whose setting is it?

**Per DEVICE, in `localStorage`, and the row says so.** The alternative is an account-wide
column, which is a migration and an API surface — and this repo already carries three pending
migrations. More to the point, it would be inventing a policy: an account-wide idle timeout is
a statement about every browser the user ever signs in on, and `decisions.md` does not rule on
it. Per-device is also the honest reading of the thing being protected — an unattended screen —
and a user who wants it everywhere can say so once Ran decides. **Recorded here for him to
overrule**; moving it server-side later changes the storage line and nothing else.

### The four ways this goes wrong, and what answers each

1. **A sleeping laptop.** `setTimeout` is not a clock: a machine suspended for three hours
   fires it late or not at all. So the rule is a comparison of WALL-CLOCK timestamps, re-checked
   whenever the tab becomes visible or regains focus — a user coming back to a laptop that slept
   past the limit is signed out on the spot.
2. **Two tabs.** Last-activity is written to `localStorage`, so typing in one tab keeps the
   other alive. Without that, a background tab signs the user out from under the tab they are
   working in.
3. **A timer that cannot fire.** The countdown is a fallback, not the mechanism: the decision is
   always the timestamp comparison, so the worst a missed timer costs is lateness, never a
   missed logout.
4. **"Off" meaning zero.** The stored value is parsed through a whitelist of minute counts, and
   anything unrecognised — a hand-edited key, a value from a future version — falls back to the
   ONE-HOUR DEFAULT rather than to off. A security default must not be weakened by a typo.

### Built, and what proving it changed

Three files plus a settings row, and **two of the three interesting decisions came out of
driving it in a browser rather than out of writing it.**

**1. Mounting is not activity.** The first version seeded the in-memory stamp with
`Date.now()`, which won the `Math.max` against the real stamp in storage — so a laptop
that slept for three hours and restored its tabs, or any reload after an idle spell, came
back with a fresh clock and the session survived **exactly the situation the feature exists
to end**. The stamp now starts null; storage is authoritative at mount.

**2. Signing in has to stamp itself, and the hook cannot do it.** With (1) fixed, a
returning user was thrown straight back out by their own stale history: the stamp from two
hours ago was still in storage. The obvious fix — listen for activity whether or not
anybody is signed in — does not work, because the hook lives in the shell and **the shell
is not rendered on the sign-in screen**. So `recordSignInActivity()` is called by the
explicit sign-in actions in `AuthProvider`, and deliberately not by the silent session
restore beside them: a person pressing "Sign in" is present, a token refreshing itself on a
closed laptop is not.

**3. A guard that no test could fail on, deleted.** `isIdlePastLimit` had an explicit
future-stamp check. Mutating it away turned nothing red — because the subtraction already
handles it (`now − future` is negative, and a negative is never past the limit). A line
claiming to do something it does not is worse than no line; it is gone, with the reasoning
in its place. The same check in `millisecondsUntilIdle` is NOT redundant (it would return
more than the limit) and is pinned by its own test.

Proven live as `operator@`, all three states:

| | result |
|---|---|
| Security panel | **Sign me out when idle** offers 15 min · 30 min · 1 hour · 4 hours · 8 hours · Never, with "this device" said out loud |
| Choosing *Never* | stores `off`, read back as never |
| Limit 15 min, last activity 2 h ago, reload | **signed out on load** — the sleeping-laptop case |
| Signing in again over that same stale stamp | **stays signed in**, stamp reset to 0 min ago |

Suites: biome 721 · web **356** (15 new) · e2e 112.
