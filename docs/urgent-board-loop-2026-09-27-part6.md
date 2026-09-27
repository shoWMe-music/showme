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
