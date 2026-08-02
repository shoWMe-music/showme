# shoWMe — Off-platform access (links, OTP, shares, claim)

How non-account people get **read views and actions** via email links — the operator sends a link, the recipient
views/acts without an account, and can create one to upgrade. Ports the proven flow from `../showme-settle-fast`
(the OTP/JWT constants are tested — reuse verbatim), redesigned relationally.

## Core idea: same auth engine, different front door

Off-platform access is **not** a separate system. It reuses `authorize` + `serialize` exactly — only the
*principal* is resolved differently:

```
ON-PLATFORM:   Firebase token → uid → memberships → participant → permission_set → serialize
OFF-PLATFORM:  share token / OTP→JWT → EMAIL match → participant (stub) → capabilities → serialize
```

An off-platform person is just **a participant (or recipient) with no account yet, reachable by email**. Their
view is party-scoped by the same floor/band/ceiling and the same field-level serializer.

## Three front doors — one identity

```
public link       → (no principal)             → scoped serialized view (whitelisted)
OTP → JWT         → (token principal, email)    → email-matched scoped view + actions
signed-in account → (Firebase uid + verified email) → claim stub → full member, OR email-match to shares
```

All three land on the **same email/participant identity** and the **same serializer**. "Create an account" just
promotes door 2 → 3 (and claims a stub if one exists).

## Per-share choice: `access[public | protected]`

The sharer picks the tier per share:
- **public** — the opaque token *is* the key; no OTP. For low-sensitivity (schedule, event info, call sheet).
- **protected** — requires **email OTP → JWT** (or a signed-in email match). For sensitive (deal, settlement).

**Scope and access-tier are orthogonal.** Choosing `public` (no OTP) means "no identity *challenge*" — NOT "show
everything." A public schedule link still serves only the schedule (the share's `capabilities` + `target` drive
the serializer regardless of tier). Sensible default: personal/financial → protected; schedule/info → public ok.

## Data model

```
shares                                    -- the saved link (generalizes PLAN.md Module M beyond settlement)
  id            uuid pk
  token         text unique               -- opaque UUID; the secret in the URL
  event_id      → events (nullable)
  target_kind   -- 'schedule' | 'deal' | 'settlement' | 'event_info' | 'budget' | 'rider' …
  target_id     -- specific row (nullable = a whole section, e.g. the schedule)
  capabilities  text[]                    -- what the link GRANTS (same vocab as permission_sets), e.g.
                                          --   ['schedule.view']  or
                                          --   ['settlement.view.own','settlement.confirm','settlement.comment']
  access        -- 'public' | 'protected'
  owner_user_id    → users
  owner_profile_id → profiles
  created_at, updated_at
  expires_at    nullable                  -- optional TTL (reaper can revoke)
  revoked_at    nullable                  -- soft revoke ("stop sharing")

share_recipients                          -- who it's shared with (protected). KEEP A TABLE (see note).
  id            uuid pk
  share_id      → shares
  email         text                      -- normalized lowercase
  name          nullable
  linked_participant_id → event_participants nullable  -- if this recipient IS a party (party-scoped shares)
  claimed_by_user_id    → users nullable               -- set when they create an account
  invited_at, last_seen_at nullable
  unique(share_id, email)

share_otps                                -- OTP challenge state (protected only)
  id            uuid pk
  share_id      → shares
  email_hash    -- SHA256(email)          -- keyed by hash, never raw email
  code_hash     -- SHA256(salt:code)      -- never store the plaintext code
  salt
  expires_at    -- +10 min
  attempts      int
  rate_window_start
  unique(share_id, email_hash)
```

**A share = a tokenized capability grant against a target.** `capabilities text[]` reuses the same catalog as
`permission_sets`, so the auth engine treats a link-holder exactly like a participant.

**Correction to PLAN.md:** the "Table consolidations" section folds `share_recipients → shares.recipients jsonb`.
That was fine for read-only email lists, but recipients now carry **OTP state, claim tracking, and party links**
(and `share_otps` keys off them), so **keep `share_recipients` a table.** (Confirmed 2026-07-14.)

## Two share shapes, same table

- **Broadcast** (crew schedule): one share, `capabilities=['schedule.view']`, N recipients — everyone sees the
  same slice.
- **Party-scoped** (performer's own settlement): `capabilities=['settlement.view.own']` → the recipient's email
  matches an `event_participant` → serializer shows *their* slice only.

## OTP → JWT — port these constants verbatim (tested in the old app)

| Piece | Value |
|---|---|
| Share token | opaque UUID → `shares.token` |
| OTP code | 6-digit, stored **salted + SHA256** (never plaintext) |
| OTP TTL | **10 minutes** |
| Rate limit | **3 requests / hour / email** (`rate_window_start`, `attempts`) |
| Verify attempts | **max 5**, then delete the OTP |
| Success → | **HS256 JWT** `{token, email, iat, exp}`, **24h TTL**, secret `SHARE_JWT_SECRET` |

## Actions need no new tables

Off-platform actions (comment, confirm, approve) write to the **existing** resource tables — `settlement_comments`,
`deal_parties.confirmed_at`/`signature_hash`, `settlement_approvals` — attributed to the **matched participant**
(or the `share_recipient` for pure reviewers). The share grants the capability; the action lands on the real row.
**Every action goes through the same `authorize`** — closing the old app's `approvePublicShare` "caller is
responsible for gating" smell.

## No per-share snapshot — render live

The old app froze a `snapshot` onto each `publicShares` doc (Firestore couldn't do live party-scoped reads for
non-users). Drop it — in Postgres the token principal + serializer read **live**. The only immutable snapshot is
`settlements.finalized_snapshot`, captured on *finalize*.

## `shares` vs `invitations` — distinct

- **`invitations`** = *join/claim* (become a member/participant): `role`, `permission_set_id`, `target_profile_id`.
- **`shares`** = *view/act via a link* (scoped, no membership): `capabilities`, `target`, `access`.
- A protected share's "create account" can *trigger* an invitation/claim — linked, but different questions.

## Stub → claim (dramatically simpler than the old app)

- Off-platform party = **unclaimed stub `profiles`** (`claimed_at` NULL) + `event_participant` (+ `deal_party`).
- **Email → party resolution** = one indexed join (`profile_members.email` / `event_participants`), replacing the
  old multi-path walk (`participants` subcollection → members → `ownerEmail` → `owner_uid → users`).
- **Claiming** = one `UPDATE profiles SET owner_user_id=:uid, claimed_at=now() WHERE id=:stub` — no cross-doc
  repointing, no `accessUids`/`accessProfileIds` rewrite (access is a join). Deletes a large chunk of legacy LOC.
- Account's email must be **verified** to inherit shared access (Firebase verification / the passed OTP proves it).

## Venue handoff = the delegation case

The old `createVenueHandoffDraft` (performer creates an event with a **stub venue as host**, `pendingHostHandoff`
blocks status transitions; on claim, host ownership transfers) generalizes to: stub profile + `event_participant`
+ `invitation(source=venue_handoff)`; the managing party operates until claim; on claim, `claimed_at` set +
operator role transfers. This is PLAN.md's "authority transfers if/when they join."

## Request lookup

```
GET /shares/:token
  → load share by token (reject if expired/revoked)
  → access=public?    → serialize target with share.capabilities        (no principal)
  → access=protected? → require OTP→JWT (or signed-in email ∈ recipients)
                      → email match → (participant if party-scoped) → serialize with share.capabilities
POST /shares/:token/otp · /verify (→ JWT) · /{comment|approve|confirm}  (verified party, capability-checked)
```

## Design surfaces this needs (prototype is thin here)

1. Operator **share/send composer** — pick recipients (emails), what to share (scope), read-vs-action, public/protected.
2. Recipient **tokenized landing page** — read view + OTP challenge + action buttons + "create account" upgrade.
3. Operator **state visibility** — sent → opened → confirmed, per recipient.
4. **Stub → claim** prompt on the landing page.

## Related
- `PLAN.md` §M (shares) + Authorization "public/token paths" — the base this generalizes.
- `docs/decisions.md` — records the `share_recipients` table correction + off-platform resolution.
