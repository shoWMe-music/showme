---
name: auth-model
description: Map of how authentication and authorization work in this codebase — the three access mechanisms in play (owner_uid, profile membership doc, custom claims), what's live vs. idle, how to verify the profileIds claim is populated in production, and the two recurring bug shapes (slot-Record consumer for access matching, owner-only query on a multi-member collection). Use when adding access controls to a new collection, debugging a "user can't see X" report, or deciding whether to use fan-out vs. token-claim for a new feature.
argument-hint: [optional uid to inspect claims for]
---

# /auth-model

## The three access mechanisms

This codebase has three coexisting mechanisms for "who can see what." Each was introduced in a different phase and they all coexist today.

### 1. `owner_uid` (oldest, still primary on some collections)

The doc has an `owner_uid: string` field. Rule allows read/update if `uid() == resource.data.owner_uid`.

- **Collections still on this model:** `inboundBookingRequests`, `publicBookingRequests` (legacy), `users/{uid}/*` subtrees.
- **Limitation:** single-owner. A user who's an admin of a profile but not the owner of a doc gets nothing. This is the bug shape on `inboundBookingRequests` today — admins of a venue see zero requests.

### 2. Profile membership doc — `profiles/{profileId}/members/{uid}`

A subcollection under each profile. The presence of a doc grants membership; its `role` field (`owner | admin | editor`) grants escalation.

Rules helpers in `firestore.rules:16-26`:
- `isProfileMember(profileId)` — checks `exists(.../members/{uid})`.
- `isProfileAdmin(profileId)` — checks the doc's `role in ['owner', 'admin']`.

- **Collections using this:** `profiles/*`, `events` (via `hostProfileId` / `performerProfileId`), all event subcollections (`deal`, `settlement`, `riders`, `crew`, etc.), `profiles/*/templates/*`.
- **Cost:** every access check is a `get()` or `exists()` against the member doc — Firestore rules charge document reads for these. Cheap individually, expensive on hot paths.

### 3. Denormalized `accessUids` on events (Phase 1, shipped)

Each event carries `accessUids: string[]` = `owner_uid + ∪ members of every profile in accessProfileIds + active collaborator uids`.

- Computed by `computeEventAccessUids` (`functions/src/profileMembers.ts:16`).
- Kept fresh by `onProfileMemberWritten` trigger (`functions/src/profileMembers.ts:127`) — fires on any `profiles/{pid}/members/{uid}` write, calls `recomputeAccessUidsForEvents(pid)`.
- Backfill: `scripts/backfill-event-access-uids.ts`.
- Client query: `where("accessUids", "array-contains", uid)` — single index, no joins.
- Rules: `hasEventAccess(ev)` in `firestore.rules:39-50` reads it first, then falls back to membership doc.

**This is why Calendar/Events work for venue admins** — their uid is denormalized onto every accessing event.

### 4. Custom claim `profileIds` on the auth token (Phase 2, *populated but idle*)

`request.auth.token.profileIds: string[]` = all profile IDs the user owns or is a member of, sorted, **capped at 16**. Set with `overflow: true` if exceeded.

- Computed and written by `syncUserClaims` (`functions/src/profileClaims.ts:73`).
- Kept fresh by `onProfileMemberClaimsSync` trigger (`profileClaims.ts:131`), which writes `users/{uid}/_meta/refreshClaims` after `setCustomUserClaims`.
- Client picks up the new token via `useRefreshClaimsListener` (`src/lib/refresh-claims.ts`) — silent `getIdToken(true)`, no re-login.
- Backfill: `scripts/backfill-profile-claims.ts` (one-shot).

**Phase 2 ships invisibly: the claim is populated but no rule currently reads it.** Phase 3 (planned) cuts rules over to `request.auth.token.profileIds.hasAny(resource.data.accessProfileIds)` and retires the `accessUids` denormalization on events. Phase 3 has not landed.

**Overflow caveat:** users with >16 profile IDs only have their alphabetically-first 16 in the token. Rare today; Phase 3 will need a fallback path (likely keep `accessUids` for overflow users).

## Verifying the claim is live in production

Code merged to main ≠ claim populated on every user's live token. Three checks:

```sh
# 1. Confirm the trigger function is deployed
firebase functions:list --project showme-production | grep onProfileMemberClaimsSync

# 2. Inspect a specific user's claims (needs Admin SDK / ADC)
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
FIREBASE_PROJECT_ID=showme-production UID=<known-uid> npx tsx -e '
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID! });
const u = await getAuth().getUser(process.env.UID!);
console.log("customClaims:", u.customClaims);
'

# 3. Trigger logs (does it fire on member writes?)
firebase functions:log --only onProfileMemberClaimsSync --project showme-production --lines 20
```

**If (2) shows `undefined` for users with known memberships, the backfill hasn't run.** New writes will populate as members change, but pre-existing memberships stay claim-less until something touches their member doc (or until backfill runs).

A user gets a fresh token within ~1h on natural refresh, or instantly via `getIdToken(true)` triggered by the refreshClaims listener.

## Client-side: slot Record vs. flat array

`fetchProfiles` (`src/lib/db.ts:270`) returns both:
- `slotted: Record<slot, SharedProfile>` — first-write-wins by slot key. **Display-only.**
- `all: SharedProfile[]` — flat list of every owned + member-of profile.

Hooks:
- `useUser().profiles` → `slotted`. Use for "show my primary venue/performer" UI lookups.
- `useAllProfiles()` (`src/lib/queries/useProfilesQuery.ts`) → `all`. **Source of truth for access matching.**

See `.claude/skills/legacy-artist-profile/SKILL.md` for the slot-collision bug shape — separate skill because it's a specific recurring report.

## The two recurring bug shapes

### Bug A — Slot-Record consumer for access matching

A UI does `Object.values(useUser().profiles)` or `profiles[role]` for access-relevant work. If two of the user's profiles derive the same slot key (e.g. owns one venue + admin of another), the second is silently dropped from the Record.

**Fix:** switch the consumer to `useAllProfiles()`. The pinning test `src/lib/db.fetchProfiles.test.ts` documents the contract.

### Bug B — Owner-only query on a multi-member collection

A client query does `where("owner_uid", "==", uid)` against a collection that should be accessible to profile members too. Admins of the profile get an empty result regardless of their membership.

**Diagnostic:** if the symptom is "owner sees X, admin doesn't" and the data is fetched in the client (not just rendered), this is the shape.

**Fixes, in order of preference:**

1. **Token claim (Option 2)** — add `target_profile_id` to the doc. Rule: `resource.data.target_profile_id in request.auth.token.profileIds`. Client query: `where("target_profile_id", "in", useAllProfiles().map(p => p.id))`. No trigger, no fan-out, no per-doc backfill (just one new field). Caveat: 16-ID cap; overflow users need fallback.
2. **Fan-out `accessUids` (Option 1)** — mirror the events pattern. Add `accessUids: string[]` to each doc, write it via `onDocumentCreated` trigger, extend `onProfileMemberWritten` to recompute on member churn. No user-side cap, but more infrastructure (trigger + backfill + composite indexes).

Prefer Option 2 unless you specifically need the unbounded user-profile cap.

## Adding access controls to a new collection — decision tree

```
Is the doc owned by exactly one user, with no concept of profile membership?
  └─ Use owner_uid. Rule: uid() == resource.data.owner_uid.

Should profile members (admins/editors) be able to see/edit it?
  ├─ Is it written by an authenticated user with the profile in context?
  │   └─ Option 2 (token claim): add target_profile_id, rule reads token.profileIds.
  │
  └─ Is it written by an anonymous/public caller (form submission, webhook)?
      └─ Either Option 2 with a trigger to set target_profile_id from a slug/lookup,
         or Option 1 (fan-out accessUids) if you want server-controlled access enumeration.

Is this a hot path with high read volume where rule-level get()/exists() would dominate cost?
  └─ Lean toward Option 1 (denormalized accessUids) — single index lookup, no per-read get().
```

## Diagnostic recipe — "user X can't see Y"

1. **Confirm the auth side:** which uid is signed in? Inspect `customClaims` (script above). Note `profileIds` vs. `overflow`.
2. **Inspect the user's profile memberships:** Step 1 of `legacy-artist-profile` skill — list owned + member-of profiles with their IDs and slots.
3. **Find the failing collection's query:** what `where(...)` does the client run? What rule path is it under?
4. **Cross-reference:** does the failing doc carry the field the query/rule needs? (e.g., `accessUids` populated? `target_profile_id` set?)
5. **For events specifically:** is `accessUids` populated on the event? The trigger should keep it fresh. If empty, run a one-event recompute via `recomputeAccessUidsForEvents`.

## Cross-reference

- Rules: `firestore.rules` (helpers at top, per-collection matches below)
- Events fan-out: `functions/src/profileMembers.ts`
- Custom claims sync: `functions/src/profileClaims.ts`, `src/lib/refresh-claims.ts`
- Client profile hooks: `src/lib/queries/useProfilesQuery.ts`, `src/lib/user-context.tsx`
- Profile fetch: `src/lib/db.ts:270` (`fetchProfiles`)
- Pinning test: `src/lib/db.fetchProfiles.test.ts`
- Backfill scripts: `scripts/backfill-event-access-uids.ts`, `scripts/backfill-profile-claims.ts`
- Related skill: `.claude/skills/legacy-artist-profile/SKILL.md` (slot-collision diagnosis)
