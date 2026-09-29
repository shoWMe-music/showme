# Urgent board loop — part 34 (2026-09-30)

Continues `docs/urgent-board-loop-2026-09-30-part33.md`, which closed at 399 lines with three of
run 13's four MINORs shut (`1fdecf2`, `3c7131c`, `749934d`).

**State at the cut.** `749934d`, tree clean, dev stack up (API standalone on 8080 restarted for the
roster fix, web 5180). The seed is as run 13 left it plus one cancelled probe deal on e1.

**Open from run 13:** MINOR (353), COSMETICs (375, 389, 400, 414), NOTEs (430, 447). Then Daniel's
two unbuilt rulings (§25.8.1, §25.8.2), the full pass, and qa-sweep run 14.

---

## 1. Run 13 MINOR (353) — a crew member is told the show has no riders, about two that exist

> `professional@`, Album Release → Event Details: *"Nothing has been submitted for this show yet.
> Riders and documents are submitted by the parties on the bill. Yours arrive here for you to
> read."* Two riders exist. `GET /events/<e1>/riders` as `professional` returns `200 []` —
> **correctly**: crew rider reach is opt-in and this permission set is `{event.view,
> schedule.view}`.

The refusal is right; the sentence is untrue of its reader. Tenth-and-counting instance of that
class.

### Which file settles it

`apps/web/src/components/RidersDocumentsCard.tsx:82-87`. The empty state branches on
`upload.canSubmit`, which is the wrong question, and the branch the report did not look at is
wrong too:

```tsx
{upload.canSubmit ? "No riders or documents yet." : "Nothing has been submitted for this show yet."}
```

`scopedEventRiders` (`routes/riders.ts:238`) returns **every** rider to a caller holding
`budget.view` and a scoped subset to everybody else. So "does this reader see the whole set" is
`budget.view` — and `rider.submit` is a different question with a different answer. **A PERFORMER
holds `rider.submit` and NOT `budget.view`**, so the first branch tells an act with no rider of its
own *"No riders or documents yet."* on a night where another act has filed one. Same defect, one
branch over, and only the crew seat was reported.

### The verdict — and I am NOT following the direction the report points in

The report's comparison is the Deals tab, which **discloses existence**: *"This event has a deal,
and its terms are not yours to read."* That is `hiddenCount`, which I built, and the obvious move
would be to mirror it onto `/events/:id/riders`.

**It is the wrong answer here, and the reason is specific to riders.** A deal's existence changes
the reader's own money picture, so a count is information they are entitled to act on. A rider is
the ACT's own artifact (decisions #12) and the riders a crew member cannot see are *other acts'
hospitality riders* — the house documents already reach everyone standing on the event (QA4-4,
ClickUp `123qy9rnk1u`). Telling a bartender "two documents exist that are not yours" invites them
to chase access #12 exists to withhold, and answers a question they have no stake in. Fifth
instance of **check what the line is load-bearing for before following the suggested fix**.

So: no API change, no envelope, no regeneration. The sentence stops making a claim about the EVENT
and makes one about the READER — which is all it was ever entitled to say.

### Scope

1. `useRiderUpload` exposes `seesEveryRider` beside `canSubmit`, off the same
   `useGetApiV1EventsId(eventId)` read it already performs — `capabilities` includes `budget.view`.
2. The empty state is derived by an exported function, not decided inline, so the judgement is
   testable: full reach → "No riders or documents yet." (true); anything else → a sentence about
   the reader only.
3. Tests per branch, with the PERFORMER case as the one the report missed.

### The decision it hides — none for Daniel

Whether crew rider reach is opt-in is already ruled (#12, decisions §25.6) and unchanged. This
touches only what is SAID when the scoped answer is empty.

### Built

`apps/web/src/components/riderEmptyState.ts` (new) holds the judgement, exported so it can be
tested rather than decided inside a render:

```ts
export function riderEmptyState(seesEveryRider: boolean): string {
  if (seesEveryRider) return "No riders or documents yet.";
  return "Nothing has arrived for you to read yet.";
}
```

`useRiderUpload` exposes `seesEveryRider` (`capabilities.includes("budget.view")`) off the
`useGetApiV1EventsId` read it already makes — no new request. The card asks
`riderEmptyState(upload.seesEveryRider)`; `canSubmit` keeps its two real jobs (the Upload button
and the who-submits note) and loses the one it was never answering.

**Deliberately conservative, and the docstring says why.** `seesEveryRider` is true only on the
`budget.view` path, and that is not the only route to the whole set — an operator-sponsored crew
member holding `rider.view` also resolves to `all` in `scopedEventRiders`. Such a reader gets the
reader-scoped sentence, which is still TRUE of them, merely less specific. The claim about the
EVENT is made only where it cannot be wrong.

### Proved on the running stack — including the half the report did not look at

`GET /events/<e1>` and `GET /events/<e1>/riders`, per seat:

| Seat | `rider.submit` | `budget.view` | riders returned |
| --- | --- | --- | --- |
| `operator@` | true | **true** | 2 |
| `performer.a@` | **true** | **false** | 1 |
| `professional@` | false | false | **0** |

The middle row is the defect nobody reported: a performer holds `rider.submit` and no
`budget.view`, so the OLD code's first branch told them *"No riders or documents yet."* about a
scoped answer. Latent on this seed only because both e1 riders belong to performers (`Tech Rider
2026` → Marlo, `Hospitality Notes` → Neon Tide), so each act's own list is non-empty; it is live
for any act that has filed nothing on a night where another has.

Browser, as `professional@` on Album Release → Event Details:

> **Riders & Documents** — *"Nothing has arrived for you to read yet.* Riders and documents are
> submitted by the parties on the bill. Yours arrive here for you to read."

No claim about the show, and no Upload button.

### Mutations — three, all killed

| Mutation | Result |
| --- | --- |
| restore the reported sentence on the scoped branch | 2 failed |
| ignore the flag — one sentence for both readers | 2 failed |
| invert the flag | 2 failed |

The fourth test is the one worth keeping if the copy is ever rewritten: it asserts the scoped
sentence mentions no *show*, *event*, *nobody*, *anyone* or *parties* — the claim, not the string.

### Suites

`npx biome check .` **750** files clean · web **611** (from 607) · `tsc --noEmit` clean.

**Committed as `e5da658`.**

