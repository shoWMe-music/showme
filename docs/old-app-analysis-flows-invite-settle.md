# The old app, walked as three flows — invitation, claim, settlement

**Written 2026-08-26.** Subject: the prior Firebase/Firestore app at `../showme-settle-fast`.

Three earlier reports read that app as **pages** (`docs/old-app-analysis-features.md`), as **tables**
(`docs/old-app-analysis-data-model.md`) and as **math** (`docs/old-app-analysis-settlement.md`). None
walked it as **paths**. This one does: send an invitation, redeem it, claim the stub profile behind it,
and run a settlement through review. Every claim below that says *verified* was produced by driving the
running app or by writing to its running emulator, not by reading a component.

**Scope note, and it matters for how the recommendations read.** What transfers from the old app is
**mechanism** — the sequence of states, who acts at each one, what a recipient receives, what a link does,
what the system does on someone's behalf. What does not transfer is how any of it looked. Where a
screenshot appears here it is *evidence for a flow claim*, never a visual target. The new design system
stands.

---

## How it was run

The recipe in `docs/old-app-analysis-features.md` still works. Ports moved to match the old repo's
`.env.local`, which is what the client actually reads:

```
cd ../showme-settle-fast
npm run build:functions
# firebase.local.json = firebase.json minus `hosting`, with emulator ports 9391/8391/5311/9691, UI 4301
npx firebase emulators:start --project showme-local --config firebase.local.json \
    --only auth,firestore,storage,functions
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9391 FIRESTORE_EMULATOR_HOST=127.0.0.1:8391 \
    GCLOUD_PROJECT=showme-local npx tsx scripts/seed.ts     # every account: password 123456
PORT=5183 npx tsx server.ts
```

Firestore state was read with `curl -H 'Authorization: Bearer owner'` against the emulator's REST API,
which bypasses rules; the same calls **without** that header exercise the real `firestore.rules`, which is
how the escalation in §1.7 was proven.

---

# 1. Invitation, end to end

The old app has **four separate invitation mechanisms** that share no code and no lifecycle. Naming them
first, because the rest of this section is unreadable otherwise.

| # | Mechanism | Storage | Redeemed at | Who can send |
|---|---|---|---|---|
| **A** | **Event collaborator — recipient has no account** | `collaboratorInvites` + `invitationCodes` + stub `profiles` + `events/{id}/collaborators` + a contact card | `/invite?code=SHOW-XXXX-XXXX` (join) **or** `/collaborate/{eventId}/{token}` (view without joining) | event host-admin or `adminUids` |
| **B** | **Event collaborator — recipient already has an account** | `events/{id}/collaborators` only | **nothing — they are added immediately** | same |
| **C** | **Profile team member** | `profileInvites/{profileId}_{emailLower}` | in-app banner at `/settings#profile-access`, or an email for brand-new users | profile owner/admin |
| **D** | **Venue handoff** (performer drafts an event, hands the venue the host role) | stub venue profile + `invitationCodes(source=venue_handoff)` | `/invite?code=…` | performer who created the draft |

## 1.1 Mechanism A — the off-platform collaborator, step by step

**Verified.** Signed in as the seeded operator, opened `EVT-001` → *Invite Collaborator* → typed
`flowtest.newperformer@showme.music`, role Performer, permission Editor → *Copy Link*.

| Step | Old app | Ours | Gap |
|---|---|---|---|
| **1. Who may send** | Host-admin of the event's `hostProfileId`, or a uid in `event.adminUids` (`functions/src/userLookup.ts:233-257`). Granting the **admin** tier additionally requires the host profile on a paid plan (`:264-270`) | `requireEventCapability(request, targetEventId, "participants.manage")`, plus `assertGrantAdminAllows` charged to the event host's plan (`apps/api/src/routes/invitations.ts:181-211`) | **None. Ours is the same rule expressed once instead of twice** |
| **2. What one click writes** | **Five documents**, in two round-trips: `collaboratorInvites/{token}`, `profiles/stub-{eventId}-{token}`, `events/{id}/collaborators/{token}`, then `invitationCodes/SHOW-XXXX-XXXX` and `users/{uid}/contacts/{P-…}` (`src/lib/createPerformerInvitation.ts:76-160`; `functions/src/invitations.ts:137-330`). Verified: all five present after one click | One `invitations` row (+ audit + activity) (`apps/api/src/routes/invitations.ts:229-273`) | **None — and this is the single biggest simplification of the three flows.** Five documents is why revocation misses one (§1.6) |
| **3. What the recipient receives** | An email with a **`SHOW-XXXX-XXXX` code** and a link to `/invite?code=…` (`functions/src/invitations.ts:768-800`, template `emailTemplates.ts:178`). Copy-Link callers send nothing and paste the URL themselves | `renderInvitationEmail` → link `/?invitation=<token>` (`apps/api/src/lib/email-templates.ts:371-373`) | **Ours points at a URL nothing handles.** `router.tsx` has no invitation route and no `?invitation=` reader — the email lands on the Dashboard, which ignores it |
| **4. What the link does** | `/invite?code=` calls `peekInvitationCode` and branches into **eight** named states (`src/pages/InvitePage.tsx:140-268`): missing code · signed-out · not-found · used · revoked · **wrong account** · one-click *"Accept as {profile}"* when the caller already owns a profile in the invited role · forced-role profile wizard when they don't | Nothing. `POST /invitations/:token/{accept,decline,claim}` and `GET /invitations/:token` have **zero web callers** | **The whole redeem half.** Ours can send an invitation and can list pending ones; it cannot accept one from a browser |
| **5. No account yet** | `/signup?code=…`. Signup is **gated on an invitation code** — no code, no account. Email is prefilled from the code and `readOnly` (verified). On success `claimInvitationCode` runs automatically | `POST /invitations/:token/accept` requires an authenticated Firebase principal; there is no provisioning step and no signup-with-token path | **Ours has no "arrive with a link, leave with an account" path at all** |
| **6. Already has an account (same email)** | Mechanism **B** fires instead, at compose time: `lookupUserForInvite` finds them, `addExistingUserAsCollaborator` writes the collaborator row **`status:'active'` with no acceptance step** and merely notifies them (`userLookup.ts:294-296, 352-390`) | Always an invitation; always an explicit accept | **Ours is right, theirs is wrong.** Being added to someone's event without consenting is not a state a party should be able to be put in |
| **7. Already has an account (different email)** | `peekInvitationCode` returns `{status:'active', emailMatches:false}` and the page renders **"Wrong account"** with no detail leaked (`InvitePage.tsx:210-217`). `claimInvitationCode` and `claimInviteWithProfile` both hard-enforce token-email == `recipientEmail` (`invitations.ts:371-383`, `:975-982`) | **No email check anywhere.** `accept`, `decline` and `claim` never compare `recipientEmail` to the caller — the token is the entire grant | **Ours is weaker on the one check the old app got right.** See §4 |
| **8. Second invite to the same address** | **Silently returns the first invitation** — including when the role changed. Verified: invited as *Performer* → `SHOW-ZKA8-R97X`; re-invited **as Venue** → the same code, no new documents, no warning. The dedupe query keys on `createdByUid + linkedEventId + recipientEmail + status`, and never on role (`createPerformerInvitation.ts:49-70`) | No duplicate detection at all. No unique index on `(recipient_email, target_event_id)`; two pending rows, both listed, both redeemable; the second accept 409s on the participant unique violation | **Both are wrong, in opposite directions.** Theirs lies about what it sent; ours creates two live grants and discovers the collision at redeem time |
| **9. Expiry** | **None.** No `expiresAt` on `invitationCodes`, `collaboratorInvites` or `profileInvites` — verified on the live document. The only TTL in the codebase is the 10-minute OTP (`invitations.ts:659`) | `invitations.expires_at` is **read and enforced** (`invitations.ts:159-162`, `:344`) and **never written** by any insert | **Same outcome, better bones.** Ours needs one line at create; theirs needs a column |
| **10. Revocation** | Real, and incomplete: revoke the code, delete the collaborator row, delete the stub (`src/components/event-manager/CollaboratorsTab.tsx:148-163`). The code's own comment admits `collaboratorInvites/{token}` is **left in place**, so the `/collaborate/…/{token}` door stays open after revocation | `invitation_status` has `revoked`; **no route writes it**, no `DELETE /invitations/:id` exists | **Ours has no revoke at all.** Theirs has a revoke that misses one of its own five documents |
| **11. Resend** | *Resend* re-sends the same code (dedupe path, step 8) | No route | Neither has a real resend |
| **12. What the sender sees** | The Collaborators tab shows the party grouped by role with **"Invite pending" + the literal code**, flipping to **"Connected"** on claim (verified, screenshot below). The auto-created contact card mirrors it — `Accepted` after redemption (verified on the Contacts screen) | `GET /events/:id/invitations` → `PendingInvitationCard` with an "Invite pending" badge (`apps/web/src/routes/EventDetail.tsx:739-740, 841-860`), token and code deliberately withheld from the payload | **Ours withholds the code, which is correct** — the old app printing `SHOW-ZKA8-R97X` in the operator's UI is how a bearer secret ends up in a screenshot |

![Operator's view of a pending invitation](../.playwright-mcp/old-flows-02-collaborators-pending.png)
![Wrong-account branch](../.playwright-mcp/old-flows-03-invite-wrong-account.png)

## 1.2 Mechanism C — the profile team invite, which is the well-built one

`profileInvites/{profileId}_{emailLower}` is the deterministic composite id the brief flagged, and the
whole design follows from it:

- **Possession of the verified email is the capability.** `acceptProfileInvite` re-derives the expected id
  from the document body and refuses if it disagrees, then requires the caller's token email to equal the
  invite email (`functions/src/profileMembership.ts:74-86`).
- **`allow update: if false`** (`firestore.rules:518`). The invite is immutable; only create and delete
  exist. **Revoke** = the profile admin deletes it; **decline** = the invitee deletes it (`:516-517`). Two
  actors, one verb, no status column to drift.
- **The trigger branches on whether the recipient exists** (`functions/src/profileInvites.ts:60-113`):
  brand-new address → onboarding email, no notification; existing account → in-app notification, **no
  email**, with the reasoning written down in the source (*"sending the OTP / signup email to an existing
  user creates a confusing dual onboarding flow and is the password-overwrite vector this trigger should
  never enable"*).
- Accept writes the member doc and **deletes the invite in the same batch**, then notifies the inviter and
  the profile owner, deduped, actor excluded (`profileMembership.ts:96-105, 118-170`).

Ours does the equivalent through `TeamInviteMemberModal.tsx:97,128` → `POST /invitations` with
`type: profile_member`, but leaves the row as a `status` value rather than deleting it, has no decline
surface, and does not branch the email on whether the recipient already has an account.

## 1.3 Mechanism D — venue handoff

Same shape as A with the direction reversed: the performer creates the event **and** an unclaimed venue
stub as host, and `pendingHostHandoff` blocks status transitions until the venue claims it
(`src/lib/createVenueHandoffDraft.ts:201-210`). On claim, `claimInvitationCode` repoints `hostProfileId`,
deletes both pending flags, drops `createdByProfileId`, and grants the claimer **admin** permission
unconditionally — *"they're taking over management, not joining as a side party"* (`invitations.ts:431-433`,
`:509-517`).

Ours has `POST /events/:id/handoff` (`apps/api/src/routes/inbound.ts:1268-1343`), which mints exactly the
right rows — and then **neither returns nor emails the token** (`HandoffResponse = {profileId,
invitationId}`, `:232`). There is no route that lists invitations by profile either, so the token it
creates is unreachable by any means short of a database query. The old app's flag-blocks-transitions idea
has no counterpart in ours at all.

## 1.4 The second door nobody built a key for

Mechanism A writes `collaboratorInvites/{token}`, which is the credential for `/collaborate/{eventId}/{token}`
— a full read-only event workspace with per-section comments and per-party agreement confirmation
(`src/pages/CollaboratorEventView.tsx`). **Nothing in the application ever produces that URL.** A grep
across `src/` finds the route definition and the page's own internal redirects, and nothing else; the
collaborator email points at `/events/{id}`, which an off-platform person cannot open.

So the old app carries a complete off-platform collaborator surface that its own UI cannot reach. That is
the same failure as the settlement review link in §3.6, and it is worth naming as a pattern: **in the old
app, the off-platform half was built twice and wired zero times.**

## 1.5 What each party is told

| Event | Old app | Ours |
|---|---|---|
| Invitation sent (new address) | Email with code + link | Email with link to an unhandled URL |
| Invitation sent (existing user) | In-app notification `collaborator_added` + optional email (`userLookup.ts:352-395`) | Same email as above |
| Invitation accepted | In-app notification to the operator (`collaborator_joined`) — verified in the functions log | `notifyUsers(..., "invitation.accepted")` to `createdByUser` (`invitations.ts:504-519`) |
| Invitation declined | Notification to inviter + owner, deduped (`profileMembership.ts:200+`) | **Nothing. Ours notifies nobody on decline** |
| Profile team invite accepted | Notification to inviter **and** profile owner | Notification to `createdByUser` only |

## 1.6 One invitation, five documents, four half-lives

The clearest argument in this whole report for the relational rebuild is not an opinion, it is the revoke
handler's own comment (`CollaboratorsTab.tsx:145-147`):

> *"Revoking an invitation code alone leaves the EventCollaborator + stub profile docs in place, which made
> the row stick around in the UI. Pair the revoke with a delete of those paired docs so the row disappears.
> Note: `collaboratorInvites/{token}` has no client delete rule (only update), so we leave it — it's not
> what drives the list."*

*It is not what drives the list* — and it **is** what drives the `/collaborate` door. The revoke is written
against the operator's screen rather than against the grant. One row with a `revoked_at` cannot have this
bug.

## 1.7 🚩 Boundary breach: an unauthenticated caller can promote themself to event admin

**Verified live, and this is the loudest finding in the report.**

`firestore.rules:587-596`:

```
match /collaboratorInvites/{token} {
  allow read: if true;
  allow create: if isAuthed() && …;
  allow update: if
    request.resource.data.ownerUid  == resource.data.ownerUid
    && request.resource.data.event_id == resource.data.event_id
    && request.resource.data.get('passwordHash', null) == resource.data.get('passwordHash', null);
}
```

The update rule has **no `isAuthed()`**, and pins only three fields. `permission` is not one of them. With
no credential of any kind:

```
curl -X PATCH '…/collaboratorInvites/collab-…?updateMask.fieldPaths=permission' \
     -d '{"fields":{"permission":{"stringValue":"admin"}}}'
→ permission: editor → admin
```

That value is then read twice:

1. `CollaboratorEventView.tsx:206` — `canViewBudget = auth.permission === "admin"` unlocks the **Budget**
   tab on the off-platform view. The badge on the landing page already reads `admin` after the write
   (screenshot below).
2. `resolveInvitePermission(token)` (`functions/src/invitations.ts:32-41`) → `computeAdminUidsUpdate`
   (`:86-104`) → `event.adminUids` `arrayUnion(uid)` when the invitation is claimed. **The escalation
   survives into the on-platform authorization arrays**, permanently, and `adminUids` is what
   `addExistingUserAsCollaborator` checks to decide who may invite others (`userLookup.ts:252`).

So: a view-only performer invited to a show can make themself a permanent admin of that event, including
its budget, before accepting — and the paid-plan gate on the admin tier (`userLookup.ts:264-270`) is
bypassed on the way.

![Escalated permission reflected on the collaborator landing page](../.playwright-mcp/old-flows-04-collaborate-escalated-admin.png)

Two neighbours of the same shape:

- `firestore.rules:603-610` — `invitationCodes` is `allow read: if true`. Any unauthenticated reader who
  has a code gets `recipientEmail`, `recipientName`, `recipientRole`, `linkedEventId`, `linkedProfileId`
  and `createdByUid`. The `peekInvitationCode` callable is careful to leak nothing to a non-matching
  caller (`invitations.ts:858-863`); the rule undoes that entirely.
- `firestore.rules:598-600` — `collaboratorWrites/{token}` is `allow read, write: if true`.

**Our equivalent cannot express this bug**, because the permission set is resolved server-side from the
`invitations` row and `authorize()` never reads a client-supplied tier. The finding matters as a *rule* to
keep, not a bug to port: **the grant's power must never live anywhere the grantee can write.**

## 1.8 🚩 Boundary breach: the collaborator front door mints a real app session

`CollaboratorAuthPage` has the invitee choose a password, hashes it in a Cloud Function
(`functions/src/collaboratorInvitePassword.ts`), then calls `signInAnonymously` and stores a
**`sessionStorage` blob the client itself wrote** as the entire session (`CollaboratorAuthPage.tsx:79-104`).
`CollaboratorEventView` reads that blob back and derives its authorization from it
(`CollaboratorEventView.tsx:146-152, 206`).

Three consequences, all verified or directly readable:

1. **The budget gate is client-side.** `canViewBudget` comes from a value in the viewer's own
   `sessionStorage`.
2. **The password is first-come-first-served.** `setCollaboratorInvitePassword` accepts any anonymous
   caller and only refuses if a hash already exists — whoever opens the forwarded link first owns the
   invitation.
3. **The anonymous user is a logged-in user.** After the collaborator flow signed me in anonymously,
   navigating to `/` rendered the full application shell — sidebar, dashboard, plan banner — for an account
   with no email and `isAnonymous: true`. Verified.

![An anonymous session rendering the signed-in app](../.playwright-mcp/old-flows-05-anonymous-user-gets-app-shell.png)

`docs/off-platform-access.md` already replaces all of this with one engine and three front doors. Nothing
here is a candidate for porting; it is a list of things our share-token path must never grow.

## 1.9 🚩 Minor: an unrestricted email→account oracle

`lookupUserForInvite` (`functions/src/userLookup.ts:86-146`) answers, for **any** authenticated caller and
**any** email address, whether that address has a shoWMe account — plus the display name and a profile id,
name and role. No relationship to the caller is required and there is no rate limit. Ours has
`GET /profiles/search`, which returns published profiles rather than answering "does this person have an
account", and that difference is worth keeping deliberately.

---

# 2. Profile claiming, end to end

## 2.1 The old app's stub

`profiles/stub-{eventId}-{token}` — verified document after inviting a performer who has no account:

```json
{ "name": "flowtest.newperformer", "owner_uid": "<THE OPERATOR'S UID>",
  "slot": "performer", "role": "performer", "type": "performer",
  "unclaimed": true, "linkedEventId": "EVT-001", "schemaVersion": 2 }
```

**The operator owns the performer's profile until the performer claims it.** Everything downstream —
deals, settlement party rows, `accessProfileIds` — points at a document id containing an event id and a
throwaway token.

## 2.2 The claim, walked

**Verified.** Opened `/invite?code=SHOW-ZKA8-R97X` signed out → *Create account* → `/signup?code=…` →
password → account created. `claimInvitationCode` ran and logged
`Profile transferred {oldProfileId: "stub-EVT-001-collab-…", newProfileId: "fn859…__performer"}`.

| Step | Old app | Ours | Gap |
|---|---|---|---|
| **1. Create the stub** | Client-side batch inside the invite (`createPerformerInvitation.ts:92-103`); owner = the operator; `unclaimed: true` | `POST /events/:id/participants/off-platform` → `createPerformerStub` (`apps/api/src/lib/off-platform.ts:29-40`), `ownerUserId` = the operator, `claimedAt: null`, plus a `profile_members` row with **`user_id: null` and the lowercased email** (`:45-53`) — the email *is* the claim key | **Ours is better.** The claim key is a normalized column, not a document id |
| **2. Tell the person** | Invitation email with the code | `renderOffPlatformPerformerEmail` — *"you were added, sign up to claim your events"*, **and it does not carry a token** (`participants.ts:369-391`) | Ours deliberately routes through signup rather than a token; see step 4 |
| **3. They sign up** | Signup is code-gated; the email is prefilled and `readOnly` | Ordinary signup | Ours is open; theirs is a closed beta (see Questions) |
| **4. The claim fires** | `claimInvitationCode`: creates `{uid}__{role}` **from the stub's data**, `unclaimed:false`, `created:true`; writes the owner member doc; `arrayUnion` on `accessUids` / `accessProfileIds`; recomputes `editorUids` and `adminUids`; repoints `performerProfileId` **or** `hostProfileId`; walks `childEventIds` for multi-performer events; activates the collaborator row; **deletes the stub**; marks the code `used`; mirrors the status onto the contact card (`invitations.ts:434-600`) | `claimStubsForEmail` on **every** `POST /auth/session`: `UPDATE profiles SET owner_user_id, claimed_at WHERE claimed_at IS NULL AND …` matched by `lower(profile_members.email)` and `profiles.kind` (`off-platform.ts:67-107`, called from `session.ts:81-90`) | **Ours is one UPDATE where theirs is fourteen writes across five collections.** This is the rebuild's thesis, demonstrated |
| **5. What merges** | Nothing merges on the normal path — the stub's fields are copied wholesale onto a **new** document. The one merge case is venue handoff onto a profile the claimer already owns, where the stub is discarded and only the event is repointed (`invitations.ts:456-482`) — with a comment naming the silent-data-loss bug that guard exists to prevent | Nothing merges; ownership is repointed in place. `POST /invitations/:token/claim` sets `owner_user_id` + `claimed_at` on the **existing** row (`invitations.ts:600-603`) | **Ours cannot have the data-loss bug**, because it never writes a second profile |
| **6. What is discarded** | **The document id.** Every reference to `stub-…` must be hand-repointed; the function does exactly four (`performerProfileId`, `hostProfileId`, the collaborator row, one child event) and abandons the rest | Nothing. The id is stable across the claim | The single largest class of drift the rebuild deletes |
| **7. Who is notified** | The operator, via `collaborator_joined` — verified in the functions log. The contact card flips to `Accepted` — verified on the Contacts screen | **Nobody.** `claimStubsForEmail` is silent; the token `/claim` route writes an `invitation.claimed` activity row and notifies no one | **Gap. The operator is never told their off-platform performer arrived** |
| **8. What stops the wrong person** | Token email must equal `recipientEmail` (`invitations.ts:371-383`). **Verified: the account that claimed had `emailVerified: false`.** Since anyone may register any address at Firebase without verifying it, holding the code is sufficient | Two different answers. `claimStubsForEmail` requires `firebaseUser.emailVerified === true` (`session.ts:81`) — **strictly stronger than the old app.** `POST /invitations/:token/claim` checks **nothing** — no email match, no verification | **Ours is both better and worse than theirs, on two different routes** |

## 2.3 Verdict — does our claiming path work end to end?

**Half of it does, and it is the half that matters.**

- ✅ **Claim-on-signup is real, working and better than the old app's.** Operator adds an off-platform
  performer → stub + email-bearing membership + email → the performer signs up with a **verified** matching
  address → `POST /auth/session` transfers every matching stub and they inherit their events. Idempotent
  (it re-runs on every login), race-guarded (`isNull(claimedAt)`), and covered by
  `apps/api/src/off-platform.test.ts:118,161`.
- ❌ **The token claim path is a route with no door.** `POST /invitations/:token/claim` works when called,
  but **no token ever reaches a human**: `participants.ts` omits the token from its email, and
  `inbound.ts /handoff` neither returns nor sends it. And if one did arrive, the route performs no identity
  check at all.
- ⚠️ **`profiles.claimed_at` is nearly write-only.** Read in three internal guards and one search
  projection (`profiles.ts:701,736`); nothing user-facing distinguishes a claimed profile from an
  unclaimed one. Related and worth fixing while nearby: `POST /profiles` never sets `claimed_at`
  (`profiles.ts:797-806`), so **every self-created profile reports `claimed: false`** in search.
- ⚠️ **The claim leaves an orphan.** `/claim` inserts a *second* `profile_members` row for the claimer and
  leaves the stub's original `{user_id: null, email}` row unlinked — the unique constraint does not catch
  it because the old row's `user_id` is NULL. `claimStubsForEmail` gets this right (`off-platform.ts:91-97`);
  the token route does not.

So: **not a column with no flow — a column with one good flow and one dead one.** The fix is small and it
is mostly deletion of ambiguity, not new machinery.

---

# 3. Settlement, as a workflow

The math is covered in `docs/old-app-analysis-settlement.md` and is not revisited. This is the human path.

## 3.1 The old app's state machine, and how much of it is real

Declared statuses (`src/lib/models.ts:21`): `open · pending_review · comments_received · revised ·
finalized · partly_paid · paid · dispute`.

**Reachable transitions** (`src/components/settlements/SettlementTab.tsx:145-160`;
`src/lib/queries/useDealMutations.ts:64-66`):

```
open ──"Send for Review"──▶ pending_review ──"Resend for Review"──▶ pending_review
                                  │
  {pending_review, comments_received, revised} ──"Finalize"──▶ finalized
                                  │
                     finalized ──"Mark as Paid"──▶ paid
                                  │
        {finalized, paid} ──"Re-Open Settlement"──▶ pending_review
                                  │
   any status ≠ open ──(automatic, on editing the deal)──▶ revised
```

**Unreachable:** `comments_received`, `partly_paid` and `dispute` are written by no code path. They appear
only in the seed's round-robin (`scripts/seed/fixtures.ts:303`) — which is why the seeded list looks
richer than the app is. `dispute` is not even in the seed list.

That last point deserves emphasis because it is our disease too, at a different stage: ours reaches
`open → finalized` and nothing else; six of eight `settlement_status` values have no writer
(`apps/api/src/routes/settlement.ts:1153` is the only status transition in the API). The old app is three
transitions ahead, not eight.

## 3.2 Walked, step by step

**Verified.** `/settlements` → EVT-G071 *"Sonic Bloom 4"* → the Settlement tab.

| Step | Old app | Ours | Gap |
|---|---|---|---|
| **1. Who runs it** | Any operator-kind viewer — `isOperator = roles ∋ promoter\|venue\|organizer` (`SettlementTab.tsx:47`), a **client-side** role test | `settlement.edit` capability, server-enforced (`settlement.ts:633`); `roleFilter` strips it from `editor`/`viewer` (`packages/auth/src/presets.ts:112-128`) | **Ours is the right shape.** Theirs is a UI check |
| **2. Compute** | There is no compute step — `calculateSettlement` runs on read | `POST /events/:id/settlement/compute`, idempotent, updates rows in place so a `paid` transfer survives recompute (`settlement.ts:626-725`) | **Ours is ahead** |
| **3. Send for review** | **"Send for Review"** → `pending_review`, and every event profile gets an in-app notification (`functions/src/notifications.ts:412-437`) | **No such step.** There is no "the figures are ready, look at them" transition and no notification on compute | **The missing first move of the whole workflow** |
| **4. What each party sees** | The `/settlements/{id}` detail page: tabs **Overview · Deal Structure · Financials · Settlement · Payout (coming soon) · Change Log**, per-party cards, and *"YOUR SHARE (RETAINED)"* on the operator's own | `EventSettlementTab.tsx` — board `variant: "full" | "slice"`, an explicit *"Your own line. The other parties' figures on this event aren't shared with you."* notice (`:169-177`), commissions labelled *"private to you and your agent"* | **Ours is party-scoped by the server; theirs is not (§3.5)** |
| **5. Sign-off** | An **Approval Status roster** listing every party as Approved / Pending, and an `n/3` column on the settlements list — verified | `settlement_approvals` is written by `POST …/confirm` and by the share `approve`, and **read only for the caller's own rows** (`settlement.ts:845`, `share-document.ts:470-476`) | **🚩 Nobody in our app can see who has signed off.** The operator's most basic settlement question has no answer |
| **6. Comments** | A thread on the settlement with **file attachments**, posted by parties and by off-platform reviewers, plus per-status notifications to every event profile (`notifications.ts:455-476`) | `settlement_comments` is written **only** by `POST /shares/:token/comment` and read **only** by the share viewer, filtered to their own comments | **🚩 The operator can never read what an off-platform party wrote.** The table is a one-way drop box |
| **7. Revisions** | Editing the deal while a settlement is in review pushes it to **`revised`** automatically and appends to a **Revision History** block; there is a **Change Log** tab over the event's activity rows | `PATCH /events/:id/settlements/:sid` writes `manual_overrides` and an activity row carrying labels but never amounts (`settlement.ts:922-944`) — and **has no UI**, no hook, no caller | **Ours has the write and not the gesture** |
| **8. Dispute** | Declared, never reachable | Declared, never reachable | Neither has one |
| **9. Finalize** | **"Finalize"** → `finalized`. Nothing is frozen: no snapshot, no locked FX | `POST …/finalize` re-derives, refuses on mismatch (*"Recompute and re-confirm"*), **locks FX**, writes `settlement_snapshots`, flips every row (`settlement.ts:1056-1234`) | **Ours is far ahead and should stay that way** |
| **10. After finalize** | **"Re-Open Settlement"** puts a finalized *or paid* settlement back to `pending_review` (`SettlementTab.tsx:155-157`) | Finalize is terminal; `LOCKED_SETTLEMENT_STATUSES` refuses compute and override afterwards | **Deliberate divergence — see §3.4** |
| **11. Mark paid** | **"Mark as Paid"**, one button for the whole settlement | `PATCH /events/:id/transfers/:tid` → `owed \| paid \| handled`, per transfer, callable by either end of it (`settlement.ts:1246-1331`) | **Ours is finer-grained and matches the meeting's *"who holds which funds"*.** But nothing rolls per-transfer state up, so `partly_paid` / `paid` never arrive |
| **12. Who is told** | Every status change, every comment, every revision notifies all event profiles in-app (`notifications.ts:412-476`) | **Finalize only** (`settlement.ts:1216-1230`). Compute, override, confirm and mark-paid are all silent; off-platform parties (`user_id NULL`) are never notified at all | **🚩 A performer is never told their settlement was computed, or that their own line was hand-edited** |
| **13. Export** | Export CSV / Export PDF from the workflow block (`settlementExport.ts`) | `packages/shared/src/csv.ts` exists and is consumed by nothing | Gap, already noted in the features report |

![The old settlement workflow block: actions, approval roster, comment thread](../.playwright-mcp/old-flows-07-settlement-workflow-actions.png)

## 3.3 The list view

`/settlements` is a status-chip list with an **APPROVALS `n/3`** column — verified. That single column is
the operator's whole answer to *"who still owes me a signature"*, and it is the cheapest high-value thing
in this report: we already store every approval, we just never count them for the person who needs the
count.

![Settlement list with status chips and the approvals column](../.playwright-mcp/old-flows-06-settlements-list-status-approvals.png)

## 3.4 Re-Open, and why we should not copy it

The old app lets an operator return a **paid** settlement to `pending_review` with one click and no trace
beyond an activity row. Ours refuses, because finalize captures `settlement_snapshots` and locks FX —
un-freezing would make the snapshot a lie. If a finalized settlement genuinely needs to change, the honest
mechanism is a **new version alongside the frozen one**, not a status rollback. Recorded here so the
question is not reopened by someone reading the old UI.

## 3.5 🚩 Boundary breach: the review page renders every party's card

**Verified.** `/review/review-EVT-G071`, opened as a signed-in viewer, renders in one column:

```
Performer (Khruangbin)          €11,475.00   base €15,000.00
  Booker/Agent (UTA)            −€2,250.00
  Management (Reeperbahn Mgmt)  −€1,275.00
Promoter (shoWMe)               −€2,551.80
Venue (Paradiso, Amsterdam)     −€1,701.20
Booker/Agent (UTA)               €2,250.00
Management (Reeperbahn Mgmt)     €1,275.00
```

`SettlementReviewPage.tsx` maps `partyBreakdowns` wholesale; the only scoping input is a coarse
`viewerIsPerformer` boolean that changes nothing about which cards appear. Three separate rules of ours
are broken at once: story.md's performer ceiling (*"never … other parties' financials … even if an
operator wanted to show them"*), the meeting's *"collaborators see only the portions relevant to their own
deals"*, and decisions.md #14 (*the agent is "never a separate entitled party"* and the commission rate is
*"the private bit"*). It also renders a **Management** party, which story.md excludes by definition.

**One correction to the earlier reading.** The claim that it renders this *"to any link-holder"* is not
quite right, and the difference matters when we decide what to build. Signed **out**, the same URL shows a
**"Protected share — enter the email this link was shared to"** OTP gate (`publicShareApi.ts:60-107` treats
a share with no `access` field as protected, failing closed). The page's **content** is unscoped; its
**gate** is not open. So:

- **Take the shape** — chrome-less document, *"Reviewing as {name}"*, one primary approve action, a comment
  thread with attachment. That is A-33, already approved.
- **Refuse the content** — the recipient sees **their own party only**, from `serialize(capabilities)`,
  never a card grid. The share's `capabilities` decide what renders, not the template.

![Every party's card, including agent commission and a manager cut](../.playwright-mcp/old-flows-08-review-page-all-party-cards.png)

## 3.6 🚩 The off-platform review flow is fully built and completely unreachable

The old app has a genuine, careful implementation of everything `docs/off-platform-access.md` describes:
`shareOtpApi` (6-digit code, 10-minute TTL, 3/hour/email, 5 attempts, HS256 JWT, 24h) · `getPublicShare`
(fails closed for legacy docs) · `submitPublicShareComment` (verified email, attachments to Storage,
activity row) · `confirmShareParty` (writes `settlement.approvals[]`, deduped on `(party, email)`).

And the only button that mints a review link is this (`src/pages/SettlementDetailPage.tsx:32-37`;
identically at `useEventManager.ts:263-272`):

```ts
const token = `review-${eventId}`;
void upsertShareToken(token, eventId, parties, snapshot);
return `${window.location.origin}/review/${token}`;
```

Three faults in five lines:

1. **The token is `review-{eventId}`** — deterministic and guessable from an event id printed all over the
   UI. Verified: the *Share for Review* button produced `http://localhost:5183/review/review-EVT-G071`.
2. **No `access` field and no `recipients`** (`src/lib/db.ts:2404-2416`). `parties` is the hardcoded list
   `["Performer","Agent","Venue"]` — labels, not addresses.
3. Therefore **nobody can open it.** Verified: signed out, the OTP gate accepted the performer's own
   address and returned **"That email isn't on the recipient list."** And `confirmShareParty` and
   `submitPublicShareComment` both require `access === 'protected'`, so even a link-holder who got in could
   neither comment nor approve.

The functional share path is the *other* one — `ExportEventDialog` → `/shared/event/{id}?token=` — which
writes a random token, a real `access` tier and a real recipients list. **The old app has two share
systems, and the settlement uses the broken one.**

This is the most useful thing this walk found for planning: **the mechanism is proven and the wiring is
not.** Port the mechanism (`docs/off-platform-access.md` already specifies exactly this, with the same
constants); write the wiring ourselves.

## 3.7 🚩 Boundary breach: share scope is a URL query string

`ExportEventDialog.tsx:258-259` builds the share URL as `?tabs=settlement&sections=…`, and stores the same
selections on the share document (`:250-251`). `SharedEventPage.tsx:120-128` then reads scope from
`useSearch` — **the query string** — and:

```ts
const showAll = tabs.length === 0 && sections.length === 0;
```

The stored `sections` / `tabs` are written and **never read**. A recipient who deletes the query
parameters, keeping only `?token=`, is served the entire event — budget, deal, settlement, private notes.
The "share one specific section" affordance is not an authorization boundary; it is a hint to the renderer.

Our `shares.capabilities` + `serialize(capabilities)` is the correct answer, and this is the concrete
reason it must stay server-side even when the UI offers section-level granularity (see Questions).

## 3.8 🚩 Boundary breach: any collaborator can approve any party's settlement

`assertEmailMatchesParty(db, eventId, party, email)` (`functions/src/shareIdentity.ts:139-158`) returns
success on **either** of two paths:

```ts
if (await emailMatchesParticipantProfile(db, eventId, party, email)) return;  // (a) is this party
if (await emailMatchesEventTeam(db, eventId, email))               return;    // (b) …or on the event at all
```

Path (b) ignores `party` entirely. Anyone whose email appears in `events/{id}/collaborators` — a lighting
tech, a ticketing contact — can sign off **on the performer's settlement** and on anyone else's.

Ours already gets this right on the authenticated route: `POST …/confirm` holds `settlement.confirm`
**and** re-checks `if (!mine.has(settlement.participantId)) throw forbidden("You can only confirm your own
settlement")` (`settlement.ts:980-984`). The share route resolves an actual `party` before approving
(`shares.ts:841-847`). Keep both checks; never collapse them into "is this person on the event".

---

# 4. The one thing the old app does that we do not, and should

Everything above is mostly "ours is better". This is the exception, and it should not get lost.

**The old app enforces email identity on every redemption. Ours enforces it on one path out of four.**

| Route | Old app | Ours |
|---|---|---|
| Claim a stub at signup | token email == `recipientEmail` (unverified address is enough) | `emailVerified === true` **and** email match — **stronger** |
| Claim via token | n/a (same route) | **no check of any kind** (`invitations.ts:572-651`) |
| Accept an invitation | token email == `recipientEmail`, hard failure | **no check** (`invitations.ts:375-523`) |
| Decline an invitation | invitee deletes their own invite (`firestore.rules:517`, id derived from their email) | **no check** — any authenticated token-holder can decline someone else's invitation |
| Read an invitation | `peekInvitationCode` returns `{emailMatches:false}` and no detail | `GET /invitations/:token` returns the full row **including the token** to any authenticated caller |

The owner's decision today — *share links become magic links bound to an email with an OTP, and a
recipient's profile is claimable when that email later signs up* — is precisely the rule the old app's
deterministic `profileInvites/{profileId}_{emailLower}` encoded, and precisely what our invitation routes
currently do not enforce. The binding already exists in our schema (`invitations.recipient_email`); nothing
reads it.

---

# 5. Prioritised plan

Each item is **mechanism**. None of it depends on how the old app looked.

## BUILD NOW

**1. Bind every invitation redemption to its email. — BUILD NOW**
`accept`, `decline` and `claim` must require the principal's **verified** email to equal
`invitations.recipient_email` when that column is set; `GET /invitations/:token` must stop returning the
token to a non-matching caller. *Reason:* today the token is the entire grant on four routes
(`apps/api/src/routes/invitations.ts:375-651`), while the old app hard-enforced the match on every one of
them (`functions/src/invitations.ts:371-383`, `:975-982`, `profileMembership.ts:80-86`) — and the owner's
magic-link decision makes email the identity anyway. *Citation:* `docs/off-platform-access.md` ("Account's
email must be **verified** to inherit shared access"); §4 above.

**2. Give the invitation email somewhere to land. — BUILD NOW**
A route that reads `?invitation=<token>`, calls `GET /invitations/:token`, and renders the old app's
branch set: not-found · already used · revoked · expired · **wrong account** · one-click accept when the
caller can already act · sign-up-then-accept when they cannot. *Reason:* three built API routes have zero
callers and the email we send points at a URL the router ignores; the old app's `InvitePage.tsx:140-268`
is a complete enumeration of the states such a page must handle, and enumerating them is the work.
*Citation:* audit A-25 (missing screens); §1.1 step 4.

**3. Arm expiry and build revoke. — BUILD NOW**
Write `expires_at` at create; add a route that sets `status = 'revoked'`; make `GET /invitations/:token`
and the accept/claim routes treat both as terminal. *Reason:* the enforcement code is already written and
never fires (`invitations.ts:159-162`, `:344`), and `revoked` is an enum value with no writer. The old
app's revoke is the cautionary tale, not the model — it had to delete four documents and still missed one
(`CollaboratorsTab.tsx:145-163`); ours needs one column. *Citation:* §1.6.

**4. Make a second invitation to the same address a decision, not an accident. — BUILD NOW**
On `POST /invitations`, look up a live pending invitation for the same `(recipient_email, target)` and
either supersede it or 409. *Reason:* the old app silently returns the first invitation and **discards a
changed role** — verified, invited as Performer then re-invited as Venue, same code, no warning — while
ours creates two independently redeemable grants and only collides at accept time.
*Citation:* §1.1 step 8.

**5. Show the operator who has signed off. — BUILD NOW**
Return an approvals roster (party → approved / pending, with the timestamp) on
`GET /events/:id/settlements`, and the `n/3` count on `GET /settlements`. *Reason:* we already write every
`settlement_approvals` row and read them back **only for the caller's own participant**
(`settlement.ts:845`), so the operator cannot answer *"who still owes me a signature"* — the question the
old app's Approval Status block and `n/3` column exist to answer. *Citation:* §3.2 step 5, §3.3.

**6. Make settlement comments two-way. — BUILD NOW**
An authenticated read of `settlement_comments` scoped by `authorize()`, and an authenticated post.
*Reason:* the table is written only by `POST /shares/:token/comment` and read only by the share viewer,
filtered to their own lines — an off-platform party can comment into a void nobody can open. The old app's
per-section attribution (a comment carries which section it is about) is the part worth taking; our
`section` column already exists. *Citation:* §3.2 step 6.

**7. Off-platform sign-off on the share (A-33), party-scoped. — BUILD NOW**
Add `settlement.confirm` to what a share may grant, and give the viewer the review **shape**: the document,
one approve action, the comment thread. **The document is the recipient's own party only** —
`serialize(capabilities)` decides what renders. *Reason:* A-33 is already approved and the old app has a
working reference for the mechanism (`confirmShareParty`, OTP → JWT → `assertEmailMatchesParty` → write
approval). *Citation:* `docs/audit-2026-08-23.md:658`; §3.5.
**Loud caveat:** take the shape, refuse the content. Take path (a) of `assertEmailMatchesParty` and
**delete path (b)** — the old app lets any collaborator approve any party's settlement (§3.8).

**8. Notify along the settlement path. — BUILD NOW**
At minimum: computed / sent-for-review, your line was overridden, a party signed off, a transfer was marked
paid. *Reason:* ours notifies on **finalize only** (`settlement.ts:1216-1230`); the old app notifies every
event profile on every status change, comment and revision (`notifications.ts:412-476`). A performer
currently learns their money was recalculated by refreshing a screen. *Citation:* §3.2 step 12.

**9. Close the token-claim loop, or delete the route. — BUILD NOW**
Either put the token in `renderOffPlatformPerformerEmail` and `POST /events/:id/handoff`'s response and
email, and gate `/claim` on a verified email match — or remove `/claim` and let claim-on-signup be the only
path. *Reason:* today the route works, no token reaches a human, and if one did there is no identity check.
*Citation:* §2.3.

**10. Two small correctness fixes in the claim path. — BUILD NOW**
(a) `POST /invitations/:token/claim` should **link** the stub's `{user_id: null, email}` membership row
rather than inserting a second one, matching `claimStubsForEmail` (`off-platform.ts:91-97`). (b) `POST
/profiles` should set `claimed_at` so a self-created profile stops reporting `claimed: false` in search
(`profiles.ts:797-806`). *Reason:* both are silent data-shape bugs on the claim spine.
*Citation:* §2.3.

## BUILD LATER

**11. A "send for review" transition. — BUILD LATER**
`open → pending_review`, notifying every party that the figures are ready. *Reason:* it is the missing
first move of the workflow and the natural trigger for the share; but it only earns its place once the
share viewer (#7) exists to be sent to. *Citation:* §3.2 step 3.

**12. Roll per-transfer state up into `partly_paid` / `paid`. — BUILD LATER**
Derive the settlement status from its transfers rather than adding transitions. *Reason:* our finer-grained
per-transfer model is the right one and matches the meeting's *"who holds which funds"*; nothing rolls it
up, so two enum values and two KPI tiles on `Settlements.tsx:145-149` are permanently zero.
*Citation:* §3.2 step 11.

**13. A manual-override gesture. — BUILD LATER**
`PATCH /events/:id/settlements/:sid` exists, is version-checked, writes a no-amounts activity row, and has
no caller in `apps/web/src`. The meeting requires it (*"Settlements must be manually editable for
real-world variables"*, 00:39:19). Pair it with the notification from #8. *Citation:* §3.2 step 7.

**14. A settlement change log. — BUILD LATER**
We have `activity.ts`; the old app gives it a home on the settlement. Also the natural place to show
"revised after review". *Citation:* `docs/old-app-analysis-features.md` item 14.

**15. Decline should notify the sender. — BUILD LATER**
Ours notifies on accept and on nothing else; the old app notifies inviter **and** profile owner, deduped,
on both (`profileMembership.ts:118-170`). *Citation:* §1.5.

**16. Branch the invitation email on whether the recipient already has an account. — BUILD LATER**
New address → "create your account"; existing account → in-app notification and a plain "you were invited"
mail, never onboarding copy. *Reason:* the old app does this and writes down why
(`functions/src/profileInvites.ts:60-66`). *Citation:* §1.2.

**17. Settlement CSV / PDF export. — BUILD LATER**
`packages/shared/src/csv.ts` is built and consumed by nothing. *Citation:* §3.2 step 13.

## DO NOT BUILD

**18. All-parties financial cards on any shared, review or collaborator view. — DO NOT BUILD**
*Reason:* story.md's performer ceiling is inviolable *"even if an operator wanted to show them"*, and the
meeting says collaborators see only their own portions. The old review page is the exact violation (§3.5).
The meeting's co-promotion carve-out is a **shared-budget** rule, not a licence for the settlement view.

**19. The agent's commission — or the commission rate — anywhere an operator can see it. — DO NOT BUILD**
*Reason:* the old app prints `Booker/Agent (UTA) €2,250.00` in the operator's payout list and gives the
agent an entitled card in the settlement. decisions.md #14: the agent is *"never a separate entitled
party"*; commission is a second `settlements` row private to agent and performer. Verified present in the
old app (§3.5).

**20. A "Management" party, cut, or contact type. — DO NOT BUILD**
*Reason:* the old settlement pays `Management (Reeperbahn Mgmt) €1,275.00`. story.md draws the booking-agent
/ manager line as the **definition** of the role, not a gap.

**21. Client-supplied permission on any invitation or share. — DO NOT BUILD**
*Reason:* the old app's collaborator invite stores its own permission tier in a document the grantee can
write, and that value flows into `event.adminUids`. Verified: an unauthenticated `PATCH` promoted a
view-only invitee to event admin (§1.7). The permission set must be resolved server-side from the
`invitations` row and never re-read from anything the recipient can touch.

**22. Scope carried in the URL. — DO NOT BUILD**
*Reason:* the old share's `?tabs=&sections=` is the only thing that limits the shared view, and deleting it
shows the whole event (§3.7). Section-level granularity in the UI must map onto `shares.capabilities` and
be enforced by `serialize()`.

**23. Deterministic or guessable share/invite tokens. — DO NOT BUILD**
*Reason:* `review-{eventId}` (§3.6) and the old availability link's unsigned base64 payload. Ours already
mints 24 random bytes (`invitations.ts:148-150`); keep it, and never key a share on a resource id.

**24. `CollaboratorAuthPage`'s password-hash + anonymous-auth session, and any `sessionStorage`-derived
authorization. — DO NOT BUILD**
*Reason:* three separate breaks in one screen — a client-written session blob is the budget gate, the
password is first-come-first-served, and the anonymous user is served the full signed-in app shell
(verified, §1.8). `docs/off-platform-access.md`'s OTP → JWT supersedes all of it.

**25. "Add an existing user straight to my event, no acceptance." — DO NOT BUILD**
*Reason:* `addExistingUserAsCollaborator` writes the collaborator row `status:'active'` and merely notifies
(`userLookup.ts:294-296`). Being made a party to someone else's event without consenting is not a state our
model should allow; an invitation with an accept is the correct shape even when the person already exists.

**26. Re-opening a finalized settlement. — DO NOT BUILD**
*Reason:* the old app returns a **paid** settlement to `pending_review` with one click
(`SettlementTab.tsx:155-157`). Ours freezes a snapshot and locks FX at finalize; un-freezing makes the
snapshot a lie. If a finalized settlement must change, that is a **new version alongside the frozen one**.
(§3.4)

**27. An email→account existence oracle. — DO NOT BUILD**
*Reason:* `lookupUserForInvite` tells any authenticated caller whether any address has an account, plus the
display name and a profile (§1.9). Invitation composition should not need it; if a lookup is ever required,
it must be relationship-scoped and rate-limited.

---

# Questions for the owner

1. **Is signup gated?** The old app requires a `SHOW-XXXX-XXXX` code to create an account at all, with the
   email prefilled and read-only from the code — a closed beta enforced in the signup form. Ours is
   self-serve. This changes the invitation flow materially (a gated signup makes "arrive with a link, leave
   with an account" the *only* path), so it needs deciding before #2 is built. *(Also raised in
   `docs/old-app-analysis-features.md` Q1; repeating because it is now blocking.)*

2. **Does a settlement share freeze or read live?** `docs/off-platform-access.md` says drop the snapshot and
   read live. But `settlements.finalized_snapshot` already exists and *"here is what we agreed on the
   night"* has real value. Should a share created against a **finalized** settlement serve the snapshot
   rather than the live read, so the recipient's copy cannot silently change under them?

3. **Should a settlement or deal share be allowed to be `public`?** The old app offers Public alongside
   Protected behind a liability gate. Given #22 above, my instinct is that anything carrying money should
   be forced to `protected` and the choice simply not offered — but that is a product call.

4. **Who may re-invite at a different role?** When an operator invites the same address a second time with a
   different role (#4), should the new invitation **supersede** the old one automatically, or should the
   API refuse and make them revoke first? The old app's silent-first-wins is clearly wrong; either
   replacement is defensible.

5. **Should claiming a stub be announced to the claimer?** Our claim-on-signup is silent — a performer signs
   up and simply finds three events already in their account. A "we found 3 shows waiting for you, is this
   you?" confirmation step would be an identity check *and* an onboarding moment. Deliberate, or an
   oversight?

6. **What happens to a stub whose invitation is revoked?** The old app deletes the stub on revoke
   (`CollaboratorsTab.tsx:154-158`), which orphans any deal or budget line pointing at it. Ours has no
   revoke yet, so the answer is unwritten: does revoking an off-platform participant's invitation remove
   them from the event, or leave the participant in place and only kill the claim?

7. **Does `settlement.confirm` on a share expire with the share, or stand once given?** If a share is
   revoked after a party signed off through it, does the approval survive? (I have assumed yes — the
   approval is a fact about the settlement, not about the link — but it is not written down anywhere.)

---

## Appendix — evidence

Screenshots under `.playwright-mcp/`:

| File | Shows |
|---|---|
| `old-flows-01-invite-collaborator-dialog.png` | The invite composer's inputs: contact autocomplete, role, permission, message, Copy Link / Send Email |
| `old-flows-02-collaborators-pending.png` | The operator's pending/connected states, with the invitation code printed in the UI |
| `old-flows-03-invite-wrong-account.png` | The "Wrong account" branch — active invitation, non-matching signed-in email, no detail leaked |
| `old-flows-04-collaborate-escalated-admin.png` | The collaborator landing page reading `admin` after an **unauthenticated** write flipped the tier |
| `old-flows-05-anonymous-user-gets-app-shell.png` | An `isAnonymous: true` session rendering the full signed-in application |
| `old-flows-06-settlements-list-status-approvals.png` | Eight status chips and the `n/3` approvals column |
| `old-flows-07-settlement-workflow-actions.png` | Workflow Actions, Approval Status roster, comment thread |
| `old-flows-08-review-page-all-party-cards.png` | Every party's card on one review page, agent commission and manager cut included |
| `old-flows-09-share-export-public.png`, `old-flows-10-public-consent-gate.png` | The share composer's three choices (what / who / how) |

One thing I could not verify live: creating a share through **Share & Export** on the seeded `EVT-001`
always returned *"Please wait for data to load"*, on both the event tab and the settlement tab. That may be
a gap in the seeded fixture rather than a defect. The §3.7 finding does not depend on it — it rests on
`ExportEventDialog.tsx:250-259` writing the scope to both the URL and the document, and
`SharedEventPage.tsx:120-128` reading only the URL.

## Related

- `docs/old-app-analysis-features.md` — the same app read as screens (do not re-derive; this extends it)
- `docs/old-app-analysis-data-model.md` — `profileInvites`, `unclaimed`, `stub-` ids as tables
- `docs/old-app-analysis-settlement.md` — the settlement **math**, deliberately not revisited here
- `docs/off-platform-access.md` — the target design for §1.4, §3.5 and §3.6
- `docs/audit-2026-08-23.md` — A-25 (missing screens), A-33 (off-platform approval)
- `docs/decisions.md` #6, #12, #14 · `docs/story.md` (the ceilings §3.5 and §3.8 break)
