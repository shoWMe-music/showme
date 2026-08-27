# The public profile page — what the design asks for that we cannot yet edit

**Date:** 2026-08-27 · **Design:** Claude Design "Public Profiles", turn 3 —
*"Slicker, softer — the fan-facing cut"* (3a performer · 3b venue · 3c phone).
**Built in:** `apps/marketing/profile.html` + `src/profile.ts` + `src/styles/profile.css`.

The layout is built. This file is the other half of that job: **every control the
prototype draws that the stack cannot honestly serve**, why it cannot, and what it
would take. It exists so the next pass does not re-derive the same list, and so
nobody "fixes" an absence that is deliberate.

The rule the absences follow is STYLE-GUIDE §7: *a control that does nothing is
worse than an absent one.* Where the prototype has a button we cannot wire, the
button is not there and the reason is in a comment beside where it would have gone.

---

## Closed in this pass

| Design element | What it needed | Where it lives now |
|---|---|---|
| The line under the name — *"Songs built for rooms that listen."* | A field. There was none. | `profiles.details.tagline` (jsonb leaf, no migration), a **Tagline** field in the profile editor, `PATCH /profiles/:id { tagline }` bounded at 140 chars, published by `serializePublicProfile`, and shown in the in-app Preview. |
| *"Berlin, DE"* on every date row | The bill carried the venue NAME but not the town. | `PublicShowSchema.city` / `.country`, read by name out of `events.extras` (where the create wizard already writes them). |
| *"…with Marta Wolff"* / *"+ Marta Wolff"* | Who else is on the bill. | `PublicShowSchema.lineup` — the confirmed, publicly-billed **acts** (`performer`, `support`) minus the profile whose page it is, ordered by `performer_tag`. Hosts and co-hosts are excluded: they are the room and the promoter, not the bill. |
| *"Request a date" / "Pitch a date"* | An entry point with no date attached. | The availability page's form, generalized: `createDateRequestPanel(...).open()` posts the same public `POST /booking-requests` with `wantedDate` omitted. Verified end to end — the row lands in the target's Requests inbox. |
| *"Sign in for documents"* | Somewhere to send them. | `VITE_APP_URL` → the web app. Absent from the page entirely when the build has no app URL. |

---

## Open — ranked by what the page loses

### 1. Tickets. The whole point of the fan-facing cut, and we publish none of it.

The prototype's primary action is **"Get tickets · €18"**, with **"from €18"**,
**"Last 40 tickets"**, **"Sold out"**, **"On sale"** and **"Free entry"** on the
rows. Every one of those is missing:

- **No public ticket URL anywhere.** `events.extras.ticketing` holds
  `{ provider, syncedAt }` — a connection stamp, not a link.
- **A price exists but is not publishable as one.** `events.extras.ticketTiers[]`
  carries `{ name, price, max, est }`, and it is the operator's own **planning**
  figure (`est` is an estimate of sales, `max` a cap for the budget). It is not
  in the public projection, and publishing it as "from €18" would publish a
  number nobody chose to advertise.
- **No inventory at all.** Nothing counts tickets sold, so "Last 40" and
  "Sold out" cannot be computed from anything. `capacity` minus the guest list is
  not sales.

Today the page's show CTA is **"Show details"** → the event's own public page.
Honest, and much weaker than the design.

**To close it:** decide whether a ticket link is a property of the event
(`extras.ticketUrl`, editable on the event's Details tab, published) or of a
ticketing integration. The link alone recovers most of the design. Price and
inventory need a real ticketing source and should wait for one — a hand-typed
"from €18" that goes stale is worse than no price.

### 2. The audience loop. Four controls, one missing feature.

**Follow**, **Follow the room**, **Alert me for my city**, and the two mail
sign-ups (*"Get a mail when Ran plays near you"*, *"The week ahead, every
Monday"*) are all the same thing: a person subscribing to a PROFILE. Nothing in
the stack takes that.

`audience_rsvps` is keyed `(event_id, email)` — per SHOW, not per profile — and
its only writer is `POST /public/events/:id/rsvp`. The app's Audience screen is
honestly empty for the same reason (`apps/web/src/routes/Audience.tsx`: *"There
is no operator audience/RSVP read endpoint yet"*).

**To close it:** a `profile_subscribers` table (profile_id, email, city, source,
confirmed_at), a public POST beside the RSVP one, double opt-in, and a read for
the Audience screen. This is a feature, not a field — it is why all four controls
are absent rather than stubbed.

### 3. Video captions — *"Live in Hamburg — full band"*.

`profile_media` has `kind`, `file_id`/`url` and `position`. No title. So the
tiles carry the provider name and nothing else.

**To close it:** `profile_media.title text` (a migration), a text input per row in
`ProfileVideoListField`, and the field on the wire. Small, and it is the cheapest
remaining item on this list.

### 4. Poster art per show — the venue's "This week" cards.

`events` has no image. The cards render on the same warm wash the prototype's own
placeholders use, so the layout survives, but a venue with three shows gets three
identical grounds.

**To close it:** an event image (`events.image_file_id` → the existing files
plumbing), uploaded on the event, published on the bill.

### 5. A status the owner controls — *"On tour · autumn 2026"*.

The hero's first pill. Nothing records a touring status, so the page derives the
same claim from what it has: *"4 dates announced"*. That is true, and it is not
the same sentence.

**To close it:** either accept the derived pill (defensible — it cannot go stale)
or add `details.status` beside the tagline, which can.

### 6. *"Verified · 24 settled"*.

A trust badge. Nothing publishes a settled-show count, and a count of settlements
is a commercially loaded number to put on an open page. Absent, deliberately.
Worth a product decision before an implementation one.

### 7. *"Are you Ran Nir? Claim this profile."*

`profiles.claimed_at` exists (NULL = an unclaimed stub) but is not in the public
projection, and there is no public claim route — the claim path today is an
invitation. The footer says "Booked and settled with shoWMe" and stops.

**To close it:** publish `claimed: boolean` (not the timestamp) and point the link
at the existing invitation/claim flow, or leave it until a stub profile can
actually be claimed from the open web.

---

## Two deliberate departures from the prototype

**The avatar is not in the hero.** The prototype's hero is a banner, a name at
display size, and nothing else — no logo chip. Ours matches it, and falls back to
the avatar as a blurred hero ground when a profile has no banner, so an owner's
one picture is still used.

**Videos do not load until they are clicked.** The prototype draws a play badge on
artwork; we render exactly that as a button, and the `<iframe>` replaces it on the
first click. The prototype's shape and a real privacy improvement in one: a page
that self-hosts its fonts *specifically so no visitor's IP reaches Google before
they ask* should not hand the same visitor to YouTube on load. There is no
thumbnail for the same reason — a poster image is a third-party request too.
