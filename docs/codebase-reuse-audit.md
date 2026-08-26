# Codebase reuse audit — 2026-08-26

A pass over `apps/` and `packages/` looking for reusable components, duplicated
logic and dead code, against a deliberately high bar for extraction:

> **Three or more real call sites, existing today** — or a file that genuinely
> holds two responsibilities — or, best of all, something that can simply be
> **deleted**. Speculative reuse is the failure mode to avoid; a 600-line file
> that reads top to bottom beats six files you must hold in your head at once.

Three other agents were live in the tree during this pass. Territory was
respected, and several real findings are therefore **recommendations** rather
than changes. Those are recorded precisely enough to be actioned without
re-deriving them.

**Method.** Findings are measured, not guessed: every duplicate below was diffed
before being called one, and every "unused" export was checked against a
repo-wide reference search rather than an editor hint.

---

## What changed

### 1 · `isUniqueViolation` — 5 copies → 1 (10 call sites)

The strongest finding of the pass, and the only extraction made.

Four route files each carried a **byte-identical private copy** of the same
Postgres predicate, and a fifth open-coded it inline:

| File | Was | Call sites |
|---|---|---|
| `apps/api/src/routes/profiles.ts` | private copy | 4 |
| `apps/api/src/routes/inbound.ts` | private copy | 2 |
| `apps/api/src/routes/invitations.ts` | private copy | 2 |
| `apps/api/src/routes/participants.ts` | private copy | 1 |
| `apps/api/src/routes/public.ts` | inline `error.code === "23505"` | 1 |

It now lives once, in **`apps/api/src/errors.ts`** — beside `conflict()`,
`notFound()` and the other HTTP constructors. That is the right home rather than
a new `lib/` module because it is the *only* thing any caller does with the
answer: every one of the ten sites is `if (isUniqueViolation(error)) throw
conflict(...)`. A unique violation is how the database says "someone already took
this", and the honest reply is a 409 naming what was taken. All five files
already imported from `../errors`, so no new dependency edge was created.

This is plain TS with no framework coupling, which is what CLAUDE.md asks of
logic that is not routing.

**One deliberate, reviewable widening.** `public.ts` previously guarded with
`error instanceof Error && "code" in error && …`; the shared predicate is
structural and drops the `instanceof Error` half. The driver throws `Error`
subclasses, so this cannot differ in practice — but it is a real (if
unreachable) widening and is called out here rather than buried, because leaving
one hand-rolled copy behind would have defeated the extraction. There are now
**zero** hand-rolled `23505` checks in the codebase.

### 2 · Deleted `apps/web/src/components/TeamMemberRow.tsx` (110 lines)

**Entirely dead.** Exported from the component barrel, imported by nothing.

It is a superseded first cut of the Team screen's member row: `routes/Team.tsx`
builds its own `MemberRow` instead, and has since the screen was built. The
giveaway is `TeamMemberRow`'s `presence` prop (`online | away | offline`) — there
is no presence data anywhere in the API, so the prop could never have been filled.

Its three barrel export lines went with it (`TeamMemberRow`, plus the
`TeamAccountState` / `TeamMember` / `TeamMemberRowProps` / `TeamPresence` types).

> **Note for whoever reads the spec next:** `docs/venue-build/screen-specs.md`
> names `TeamMemberRow` as a planned Team-screen component (§10, and in the
> component/screen tables). That document is a *plan*, not a consumer — the
> screen was built with its own row. The spec was left untouched; this note
> exists so the deletion is not re-litigated from it.

### 3 · Deleted `apps/web/src/routes/stubs.tsx` (2 lines)

The entire file was:

```ts
// All operator screens are now real — this file intentionally has no exports.
export {};
```

Nothing imports it. A file that documents its own emptiness is a comment that
outlived its subject.

---

## Recommended, but not done this pass

Ordered by value. Each is blocked either by another agent's live territory or by
the "behaviour must not change" rule.

### R1 · The overflow menu is **two** implementations, not three — and they disagree on behaviour

Raised as a candidate for a design-system `Menu`. **It does not clear the bar as
stated, and the more useful finding is underneath it.** The actual count:

| Site | What it really is |
|---|---|
| `components/EventRowMenu.tsx` | A complete menu. Composes `usePickerPopover` + `PickerPopoverPanel`. **4 render call sites**, 4 more type-only imports. |
| `routes/Team.tsx` (`MemberRow`) | A hand-rolled panel, absolutely positioned in the row. |
| `components/TeamMemberRow.tsx` | **Not a menu at all** — a trigger `<button>` with an `onMenu` callback and no panel. **And it was dead code; deleted above.** |

So the third "hand-rolled menu" was a dead file's trigger button. Two real
implementations remain.

**They agree on styling and disagree on everything that makes a menu a
primitive.** This matters more than the duplicated box:

| Behaviour | `EventRowMenu` | `Team.tsx` `MemberRow` |
|---|---|---|
| Escape closes it | yes (capture-phase, so it does not also close a modal behind it) | **no** |
| Click outside closes it | yes | **no** |
| Focus leaving closes it | yes | **no** |
| Focus returns to trigger | yes | **no** |
| Tab contained in panel | yes (`containTab`) | **no** |
| `role="menu"` / `menuitem` | yes | **no** |
| `aria-haspopup` / `aria-expanded` | yes | **no** |
| Flip up when near viewport bottom | yes (estimated height) | yes (measured on click) |
| Portalled out of clipping ancestors | yes (plus a `nested` non-portal variant) | no |

Team's menu is dismissed **only** by re-clicking its trigger or by selecting an
entry. Unifying the *look* while this gap stands is the worse outcome — it would
make two controls that behave differently look identical.

**Recommendation, in order:**

1. **Do not build a design-system `Menu` yet.** `EventRowMenu` already *is* the
   app's menu primitive; it holds no event business logic (`items`, `label`,
   `nested`). It is only misnamed. Rename it `RowMenu` / `RowMenuItem` and move
   Team's `MemberRow` onto it. That **deletes** ~70 lines of Team.tsx styling
   (`menuPopoverStyle`, `menuItemStyle`, `menuButtonStyle`, `menuRefusalStyle`,
   `estimatedMenuHeight`) and closes the accessibility gap in the same move.
2. Only *after* both call sites share one behaviour is it worth asking whether it
   belongs in `design-system`. Promoting it first would freeze the inconsistency
   into the shared layer.

Not done here because it is a **behaviour change** (Team's menu gains Escape,
click-outside and focus return — all improvements, none of them refactor-safe),
and because `EventRowMenu.tsx` was being actively written by another agent
throughout this pass.

### R2 · `initials()` — 10 hand-rolled copies, 4 distinct behaviours

Ten implementations across `apps/web` and `apps/marketing`. They are **not**
interchangeable, which is exactly why this needs care rather than a blanket
extraction:

**Group A** — first + last initial; `first.slice(0,2)` for one word; `"?"` when empty:
`routes/Requests.tsx:56`, `routes/Contacts.tsx:58`, `routes/EventDetail.tsx:79`
— **byte-identical, three call sites, clears the bar.**

**Group B** — first *two words*; falls back to `name.slice(0,2)`; **no `"?"`**:
`routes/Profiles.tsx:75`, `components/ProfilePublicPreview.tsx:97`
(+ `apps/marketing/src/profile.ts:209`, same semantics, different code).

**Group C** — first letter of first two words, joined:
`components/settlementDocument.ts:103` (no fallback),
`components/EventMessagesTab.tsx:195` (`|| "?"`).

**Group D** — `components/PerformerSearch.tsx:36`: first + last, but a one-word
name yields **one** letter where Group A yields two.

They diverge on real inputs — `"Jane Q Doe"` is `JD` in A and `JQ` in B; `""` is
`"?"` in A and `""` in B; `"Prince"` is `PR` in A and `P` in D. Consolidating
blindly would change avatars across the app.

**Recommendation:** extract **Group A only**, as `initialsOf` in
`apps/web/src/lib/format.ts` (it is a formatting helper and that file already
exists), and migrate its three call sites. Leave B, C and D alone until someone
decides what the *product* rule is — that is a design question, not a refactor.
Do not attempt to unify across `apps/marketing`; it shares no code with
`apps/web` and one helper is not a reason to create that coupling.

Not done here because **all three Group A call sites were out of reach**:
`Contacts.tsx` and `format.ts` were being actively rewritten by another agent
(mid-migration onto `useCopyToClipboard`), and `EventDetail.tsx` is claimed. A
one-site extraction would have been exactly the speculative helper this brief
warns against.

### R3 · Three different components named `Eyebrow`

Same name, three files, three renderings — imported from two of them across ~40
files, so which one a screen gets depends on its import line:

| Definition | Size | Tracking | Colour | Consumers |
|---|---|---|---|---|
| `components/primitives.tsx` | 11px | `.08em` | `--muted` | ~35 files |
| `components/eventUi.tsx` | 10px | `.1em` | `--dim` | `EventStatusControl.tsx` |
| `routes/Dashboard.tsx:104` (local) | 10.5px | `.16em` | `--dim` + `marginBottom: 12` | Dashboard only |

They are visually distinct on purpose (app chrome vs. the design export), so
merging them changes pixels and is out of scope for a refactor pass.

**Recommendation:** rename rather than merge — `eventUi`'s to `ExportEyebrow` (or
fold it into `primitives.tsx` as a variant prop), and Dashboard's local one to
something local-sounding. One name that resolves to three different controls
depending on import path is a trap for the next person. Not done: `eventUi.tsx`
was live under another agent (it gained a DS `Tabs` migration mid-pass).

### R4 · `currencySymbol()` duplicated verbatim

`components/EventDetailsTab.tsx:789` and `routes/EventDetail.tsx:922` — identical
`Intl.NumberFormat(...).formatToParts(0)` implementations. **Both files are
claimed**; flagged only. Natural home when unblocked: `apps/web/src/lib/format.ts`,
next to `formatMoney`. Two call sites, so it is at the bar's edge — worth folding
in when one of those files is next opened, not worth a pass of its own.

### R5 · Finish the `useCopyToClipboard` migration

`lib/useCopyToClipboard.ts` names its own follow-up: two call sites still
hand-roll clipboard access.

- `components/EventPublishPanel.tsx:45` — bare `navigator.clipboard.writeText`, no
  failure path at all.
- `hooks/useAvailabilityShare.ts:226` — has a `.catch`, but its own wording.

Adopting the hook in both changes the **toast copy** the user sees, which is a
behaviour change and so out of scope here. It is also the in-flight work of the
agent that wrote the hook (`Contacts.tsx` was mid-migration during this pass) —
best left to them rather than raced.

### R6 · `fieldStyle` bypasses the design system

`components/eventUi.tsx` exports a hand-rolled `CSSProperties` field style used by
four files (`NewEventWizard`, `EventExtraTabs`, `EventVenuePicker`,
`PerformerSearch`). Its own doc comment concedes the proper fix: those controls
should compose a design-system input, and only don't because each wraps a bare
`<input>` in a combobox.

It is already shared — this is *not* duplication, and re-extracting it would
achieve nothing. The fix belongs in `design-system` (an input that accepts a
custom inner control), which was out of territory this pass. Left as is.


### R7 · `EventTabsBar` is now a one-line adapter that wants deleting

`apps/web/src/components/eventUi.tsx` used to hold a **second tab
implementation** — inline styles, a per-tab `borderBottom`, no transition —
beside the design system's `Tabs`. That divergence had a visible cost: the
motion pass gave `Tabs` a GSAP-slid underline and `TabPanels` a directional
scoot, `EventDetail` adopted the scoot, and the live event screen ended up with
a panel that slid under a bar that jumped.

It has been swapped: the count badge and the horizontal scroll the event strip
needed moved **into** `Tabs`, and `EventTabsBar` is now

```tsx
<div style={{ margin: "18px 0 26px" }}>
  <Tabs tabs={tabs} value={value} onChange={onChange} />
</div>
```

**What is left to do:** `EventDetail.tsx` is the only caller. When that file is
next open, render `Tabs` directly and delete `EventTabsBar` and the `EventTab`
alias. It was not done in the same pass because `EventDetail.tsx` was outside
the territory of the change that swapped it — a one-line adapter is the smaller
sin than editing a file another agent held.

**Also worth knowing:** `EventTab.badge` had **zero** call sites. It was ported
into `Tabs` rather than deleted because the type is public and the next
nine-tab screen will want it, but nothing renders a tab badge today.

---

## Deliberately left alone

The part that matters most: these were examined and **rejected**, with reasons,
so the next pass need not re-derive them.

### Big files that are correctly big

- **`apps/api/src/routes/profiles.ts` (1789)** — long because profiles have many
  endpoints, not because it does many things. Eleven module-scope helpers, then
  one `profileRoutes` registration. Splitting by line count would make endpoints
  harder to find, not easier. **No change.**
- **`apps/api/src/routes/inbound.ts` (1346)** — same shape, same verdict.
- **`apps/web/src/routes/Tasks.tsx` (770)** — already correctly factored: data and
  derivation in `hooks/useTaskBoard.ts`, the board in `components/TaskBoard.tsx`,
  leaving the list view and two modals here. `TaskRow` and `TaskBoardCard` look
  like duplicates but are the list and board renderings of a task — different
  layouts, not repetition. **No change.**
- **`apps/web/src/components/useBudgetEditor.ts` (1402)** — the plausible split is
  real (one ~880-line hook), but the whole budget cluster was under active edit
  during this pass (`+304` lines uncommitted). Splitting a hook someone is
  rewriting is how a refactor becomes a merge conflict. **Deferred, not dismissed.**

### `apps/web/src/routes/Team.tsx` (1039) — the closest call

`Team()` genuinely owns two responsibilities: 2 queries + N per-profile roster
queries + 5 mutations + 8 pieces of state + derivation, then ~230 lines of JSX.
That is the case this codebase has a convention for (`useTaskBoard`,
`useEventList`, `useRequestInbox`, `useCalendarSources`, `useEventArchive`), and a
`useTeam` hook is the obvious move.

**Not done, on balance.** The convention is not actually uniform — `useTaskBoard`
holds reads and derivation but leaves mutations in the screen, while
`useEventArchive` is mutations only — so there is no single shape to follow, and
inventing a third would be worse than the status quo. The file is also already
layered top-to-bottom (pure helpers → component → presentational sub-components →
styles), which is the readable-long-file the brief explicitly prefers. Moving five
mutations, their toasts and their cache invalidations across a file boundary is
precisely where behaviour drifts, and it was the highest-conflict-risk change
available with three agents live.

**If it is done later**, settle the hook's shape question first: does `useTeam`
own the mutations, or only the reads? Answer that once, for all the screens.

### Not dead, despite appearances

- **`apps/web/src/routes/OAuthGoogleCallback.tsx`** — a complete route component
  that **nothing mounts**. `router.tsx` has no `/oauth/google/callback` route, yet
  `useCalendarConnections.ts:42` sends Google there. **This is a bug, not dead
  code — reported below, deliberately not fixed.**
- **`apps/web/src/components/useEventInlineFields.ts` (378 lines)** — no references
  anywhere, but **untracked and written during this session**: it is the live work
  of the agent holding `useEventInformationEdit.ts`. Left strictly alone.
- **`fetchShareGrant` / `ShareGrant` in `apps/web/src/lib/shareApi.ts`** —
  genuinely uncalled (the viewer uses `fetchShareDocument`). The file is untracked
  in-flight share-viewer work; deleting from under it was not worth the churn.
  **Delete when the share viewer lands.**
- **~200 `export interface FooProps`** — flagged by a naive unused-export scan, but
  these are the standard React pattern: exported beside their component and used
  in-file. Removing the `export` keyword is churn with no reader benefit.
  **Deliberately not touched.**

### Two `toMinorUnits` that must stay two

`components/useBudgetEditor.ts:256` returns `"0"` for unparseable input;
`components/useRequestTriage.ts:60` returns `undefined` for blank or negative, so
the caller can **omit** the field from the request body. Same name, deliberately
opposite contracts — merging them would silently start sending `0` where the API
currently receives nothing. **Left as two.** Worth renaming the triage one to say
so (`optionalMinorUnits`).

---

## Bugs found — reported, not fixed

Per the brief: a refactor that also fixes things is a refactor nobody can review.

1. **The Google OAuth callback route is not mounted.**
   `apps/web/src/components/useCalendarConnections.ts:42` declares
   `OAUTH_CALLBACK_PATH = "/oauth/google/callback"` and sends Google there, but
   `apps/web/src/router.tsx` registers no such route and
   `routes/OAuthGoogleCallback.tsx` is imported by nothing. A user completing the
   Google Calendar connect flow should land on an unmatched route. Worth an
   end-to-end check before assuming the integration works.

2. **Team's member menu cannot be dismissed by Escape or by clicking away** (see
   R1). Not a crash, but it is a keyboard trap for anyone not using a mouse, and
   it is inconsistent with every other menu in the app.

---

## Gates

| Gate | Result |
|---|---|
| `pnpm turbo run typecheck` | **14/14 successful** |
| `pnpm biome check apps packages` | **clean** — 508 files, no fixes applied |
| `cd apps/api && pnpm vitest run` | baseline **49 files / 770 tests**; after changes **49 / 770**, no regression |

Behaviour is unchanged, with the single documented exception of the `public.ts`
`instanceof Error` widening in change 1.
