---
name: legacy-artist-profile
description: Diagnose the slot-collision bug in fetchProfiles where two profiles owned by the same user (or one owned + one member-of) silently collapse into a single slot, hiding one from access-matching code. Symptom is "actions tied to my profile are missing" (date-change buttons, accept-invitation, etc.) even though the server data is correct. Use when a user reports their profile-scoped UI is missing despite being signed into the right account.
argument-hint: [optional uid or event ID to inspect]
---

# /legacy-artist-profile

## The bug (it's a code bug, not a data bug)

`fetchProfiles` in `src/lib/db.ts` returns two shapes:

- `slotted`: `Record<slot, SharedProfile>` — collapses duplicates by slot. **First write wins.**
- `all`: flat array of every profile the user owns or is a member of, no dedupe.

Any consumer that does access matching against the slot Record (`Object.values(profiles).map(p => p.id)`) will miss profiles when two of the user's profiles share a slot. Common collision triggers:

1. User owns one performer profile **and** is a member of another performer profile.
2. Legacy doc IDs — a user owns both `${uid}__artist` (slot `"artist"`) and `${uid}__performer` (slot `"performer"`); fine for the slot Record but the consumer that filters by `role === "performer"` only sees one.
3. Two profiles with the same `slot` field set explicitly.

**The doc ID is *a* trigger, not the bug.** The bug is that access matching ever read from `slotted` instead of `all`.

## When to suspect this skill

- "I can't see Confirm/Decline on a date change banner" but my profile is the one in the confirmations map.
- "I can't accept an invitation as the performer" but the invitation references my profile id.
- A profile shows up on the public surface (slug works) but is missing from the user's profile dropdown.
- `userIsEventPerformer` returns `false` even though one of the user's performer-role profile IDs is on the event.

If the user describes any of those, jump to Step 1.

## Step 1 — Inspect the user's profile docs

```sh
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
FIREBASE_PROJECT_ID=showme-production UID=<uid> npx tsx -e '
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID! });
const uid = process.env.UID!;
// owned
const owned = await getFirestore().collection("profiles").where("owner_uid", "==", uid).get();
console.log("OWNED:");
for (const d of owned.docs) {
  const r = d.data();
  console.log(`  docId="${d.id}"  slot="${r.slot}"  role="${r.role}"  name="${r.name}"`);
}
// member-of
const mem = await getFirestore().collectionGroup("members").where("user_uid", "==", uid).get();
console.log("MEMBER OF:");
for (const m of mem.docs) {
  const profileRef = m.ref.parent.parent;
  if (!profileRef) continue;
  const p = await profileRef.get();
  if (!p.exists) continue;
  const r = p.data()!;
  console.log(`  docId="${p.id}"  slot="${r.slot}"  role="${r.role}"  name="${r.name}"`);
}
'
```

Look for **two or more rows with the same `slot` value** (or two performer-role rows). That's the collision.

## Step 2 — Confirm the consumer is using the wrong shape

Grep for any access-matching code still reading from the slot Record:

```
useUser().profiles → slot Record (UI lookups only)
useAllProfiles()   → flat array (access matching, performer detection, accessProfileIds membership)
```

The call sites that do access matching are pinned in `src/lib/db.fetchProfiles.test.ts` and use `useAllProfiles`:

- `src/lib/eventPermissions.ts` — `userIsEventPerformer(event, profiles[], childPerformerProfileIds[])`
- `src/pages/SettlementDetailPage.tsx`
- `src/components/event-manager/useEventManager.ts` — exposes `allProfiles`

If you find a NEW call site that does `Object.values(profiles).map(p => p.id)` for access matching, that's the bug — switch it to `useAllProfiles()`.

## Step 3 — (optional) Clean up legacy `__artist` doc IDs

`__artist` doc IDs are a leftover from before the role rename. Read-side `normalizeLegacyProfiles` (`src/lib/user-context.tsx`) rewrites `role: "artist"` → `"performer"`, but the doc ID is immutable. New code uses `__performer`.

If a user reports a confusing UI bug and Step 1 shows a `__artist` doc, you can migrate it (`scripts/migrate-legacy-artist-profile.ts`). But this is housekeeping, **not the fix** — the fix is to make sure consumer code uses `all`, not `slotted`. The migration script is in the repo if needed.

If you do migrate, also patch `events/{id}/meta/main.pendingDateChange.confirmations` map keys — Firestore doesn't rename map keys for free, so use `update()` with `FieldValue.delete()` on the old key and a fresh write on the new key. Do **not** use `set({merge:true})` — that leaves the old key in place.

## Anti-patterns to avoid

- **Don't add new uses of `slotted`/`useUser().profiles` for access matching.** That's exactly the bug. Use `useAllProfiles()`.
- **Don't introduce new `__artist` IDs.** New profiles must use `__performer`. If you find code constructing `${uid}__artist`, it's a bug.
- **Don't "fix" the slot Record by making it an array of arrays / multimap.** Two shapes are clearer than one ambiguous one.
- **Don't skip the event-refs sweep when migrating a doc ID.** A migrated profile with stale `accessProfileIds` / `performerProfileId` / `hostProfileId` / `pendingDateChange.confirmations` keys is worse than no migration — the user silently loses access.

## Cross-reference

- Two-shape return: `fetchProfiles` in `src/lib/db.ts`
- Pinning test: `src/lib/db.fetchProfiles.test.ts`
- Hook for access matching: `useAllProfiles` in `src/lib/queries/useProfilesQuery.ts`
- Read-side role compat: `normalizeLegacyProfiles` in `src/lib/user-context.tsx`
- Phantom-profile surfacing: `src/components/team/ProfileAdminsTab.tsx`
- Migration / cleanup scripts: `scripts/migrate-legacy-artist-profile.ts`, `scripts/cleanup-stale-artist-keys.ts`, `scripts/inspect-user-87kyc.ts`
- The original incident: production user `87kycTI0GkSyQEAVWnEpIrMNlP13` couldn't accept a date-change proposal on EVT-944554 because their performer profile (doc ID happened to be `__artist`) collided in the slot Record with a collaborator stub. Fix was the two-shape `fetchProfiles` + switching access-matching consumers to `all`.
