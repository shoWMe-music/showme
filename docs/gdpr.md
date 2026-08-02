# shoWMe — GDPR (erasure, export, retention)

## Principle: anonymize-not-delete, scoped to where shoWMe is controller

Right to erasure (Art. 17) vs legal retention (EU accounting ~7y — Sweden's Bokföringslagen): Art. 17(3) **exempts**
data needed for a legal obligation. So the rule is **strip the personal data, keep the balanced financial record.**

**DECIDED (2026-07): erasure scrubs ONLY data where shoWMe is the controller.** Operator-controlled data — their
`contacts` / address book and their business copies of deal/settlement/invoice records — follows the **operator's**
obligations; shoWMe (as processor) does **not** unilaterally scrub it (forward/notify the operator if required).

## Three buckets (shoWMe-controller data)

| Bucket | Examples | On erasure |
|---|---|---|
| **Must retain** (legal/financial) | finalized settlements, invoices, signed agreements, audit_log, transfers | keep the record, **anonymize the identity** |
| **Deletable** (content/personal) | bio, media, social links, avatar, drafts, notifications, unconfirmed events, prefs | **delete** |
| **Identity** | `users` (email, name), Firebase Auth account | **tombstone** |

## Mechanism (tombstoning)

1. **Overwrite PII** on `users` (email/name/avatar → placeholders) but **keep the pseudonymous `id`** → FKs stay
   valid and **`Σ net = 0` still holds** on retained settlements. Set **`users.anonymized_at`**.
2. **Delete** the deletable bucket. **Delete the Firebase Auth account.**
3. Anonymize `audit_log.actor_display` (keep pseudonymous `actor_user_id` for integrity).
4. **Crypto-shred** (optional, stronger): encrypt the most sensitive fields (IBANs) per-user; "erase" = destroy the
   key. Overkill for most fields; tombstoning (overwrite) is the default.

## Data export (Art. 15 / 20) — the twin

Gather-all-PII export (JSON) across the PII inventory. Same machinery as erasure, opposite direction.

## PII inventory (the artifact that drives erasure + export)

**shoWMe-controller PII:** `users` (email, name) · `profiles` (bio, contact) · `profile_members` (email, phone) ·
`share_recipients` (email) · `booking_requests` (name, email, phone) · `audience_rsvps` (name, email) ·
`invitations` (recipient_email) · `payout_accounts` (iban, holder_name) · `audit_log` (actor_display).

**Operator-controller (OUT of shoWMe's subject-erasure scope):** `contacts` (email, iban, vat_id) + the operator's
business copies of deal/settlement/invoice records.

## Consent — audience RSVP capture (SEPARATE per recipient)

**DECIDED (2026-08-02, decisions.md #16.7 / RSVP resolution — GDPR-verified.)** When an audience member RSVPs on a
public event page, the venue and the artist are **independent controllers**, so capturing their contact for either
party's marketing needs **separate, unchecked, purpose-specific opt-in — one per recipient**, never a single combined
box:

- **One opt-in per recipient** ("share my details with **[Venue]**", "…with **[Artist]**"), each specific about
  purpose (marketing). **No pre-checked boxes.** The consent is **unbundled** from the RSVP action itself and from the
  ToS/privacy acceptance (RSVP must work without ticking either sharing box).
- The **privacy notice names each recipient + purpose + retention**; consent is **always revocable** (marketing
  opt-in, ~1y, opt-out any time — then the reaper anonymizes).
- **Platform storage of the RSVP record is a SEPARATE lawful basis** (shoWMe as controller/processor of the RSVP
  itself) — do **not** fold it into the sharing consent. `audience_rsvps` is already in the PII inventory above.
- **Store consent provenance** so revocation + audit work: per RSVP × recipient, record `{recipient, purpose,
  granted_at, wording_version, source, revoked_at}` (a `rsvp_consents` child of `audience_rsvps`, or a `consents`
  jsonb). A granted-then-revoked marketing consent still leaves an auditable trail.
- **Joint-controller route** (one combined arrangement/box) applies **only** if the venue + artist *jointly organise*
  the event — not shoWMe's default independent-capture model; if it ever arises, take legal advice.

## Retention / TTL & broader GDPR

- **Retention-reaper** auto-anonymizes stale data (unclaimed stubs, expired shares, old RSVPs) — extends the reaper
  infra already planned.
- **DPAs** with subprocessors: Google Cloud, Stripe, Brevo, Firebase.
- **Consent** (marketing vs transactional email; **RSVP data-sharing = separate per-recipient opt-in, see above**),
  privacy policy, documented retention schedule.

## One-line

> Erasure = **anonymize-not-delete, scoped to shoWMe-controller data**: tombstone the identity, delete personal
> content, keep the balanced financial records with PII stripped. Operator address books follow the operator's
> duties. Driven by a documented **PII inventory** + `users.anonymized_at`.
