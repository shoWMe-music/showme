-- The connection row `lib/external-calendar.ts` refused to invent.
--
-- 0009 gave imported entries an identity, 0011 gave them meaning (they occupy
-- time, they can become shows) and the outbound mirror. Both stopped at the same
-- wall: nothing in the repo talks to Google, because doing so needs a per-user
-- REFRESH TOKEN, and where a refresh token may live is a security decision rather
-- than a schema chore. That decision is made now, and this table is it.
--
-- THE DECISION, stated once so it cannot be re-argued by accident:
--   The refresh token is encrypted at the APPLICATION layer with AES-256-GCM
--   under a key held in Secret Manager (`CALENDAR_TOKEN_ENCRYPTION_KEY`), which
--   never appears in Postgres. Postgres holds ciphertext, nonce and tag. A dump
--   of this database — a leaked backup, a read replica, an over-broad grant —
--   yields WHICH Google account someone connected and WHEN it last synced, and
--   no way to read or write a single calendar entry.
--
-- WHY THE TAG HAS A COLUMN OF ITS OWN. GCM without its authentication tag is
-- CTR mode: still confidential, no longer tamper-evident. An attacker who can
-- WRITE this table but not read the key could then flip bits in the ciphertext
-- and have the API decrypt into something of their choosing without complaint.
-- Storing the tag is what turns that into a decryption failure.
--
-- WHY NOT the alternatives that were on the table:
--   * pgcrypto (`pgp_sym_encrypt`) — the key would then be passed to Postgres in
--     the query, landing it in `pg_stat_statements` and the query log, i.e. in the
--     same database it is protecting.
--   * Secret Manager per user — one secret version per connected user, billed and
--     rate-limited per user, with no story for bulk sync and no way to delete a
--     user's data in the same transaction as their rows.
--   * Cloud KMS envelope encryption — strictly better key custody, and the right
--     next step; it changes only how the 32 bytes are obtained, not this schema.

CREATE TABLE "calendar_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- TWO OWNERS, both required — the same rule `calendar_items` documents.
  -- `user_id` is whose ACCOUNT the calendar came from, and therefore who may see
  -- the titles of what it imports; `profile_id` is whose AVAILABILITY those
  -- imports occupy. A connection with only the first would block nobody's
  -- calendar; with only the second it would show a private lunch to every
  -- co-member of the profile.
  "user_id" text NOT NULL,
  "profile_id" uuid NOT NULL,

  -- "google" today. Nothing below is Google-shaped except the comments.
  "provider" text NOT NULL,

  -- The provider's own name for the account. For Google that is the calendar's
  -- address, and it is read off `events.list`'s top-level `summary` rather than
  -- from an identity endpoint: with only the `calendar.events` scope granted,
  -- `calendars.get` and `calendarList.get` both answer 403 (verified against the
  -- live API), and adding `openid email` to the consent screen purely to render
  -- one line of a settings page is a worse trade than reading the listing.
  "provider_account_id" text NOT NULL,

  -- Which calendar inside that account. "primary" until a picker exists.
  "provider_calendar_id" text DEFAULT 'primary' NOT NULL,

  -- The calendar's own IANA zone. Load-bearing: it is the frame the imported
  -- wall-clock times are resolved into, and Sweden is +02:00 until late October
  -- and +01:00 from November. Converting with a fixed offset shifts an hour of
  -- every winter entry.
  "calendar_time_zone" text,

  -- The sealed refresh token: ciphertext, the 12-byte GCM nonce it was sealed
  -- under, and the authentication tag. All base64. Never the token itself.
  "refresh_token_ciphertext" text NOT NULL,
  "refresh_token_iv" text NOT NULL,
  "refresh_token_auth_tag" text NOT NULL,

  -- What the user actually consented to, as the provider echoed it back — not
  -- what we asked for. The two differ whenever a user unticks a box.
  "scope" text NOT NULL,

  -- Google's `nextSyncToken`. A CURSOR, not a credential: it is worthless without
  -- the token above, and it is the only way a sync ever learns about a DELETION,
  -- because a full listing cannot tell "cancelled" from "never mentioned".
  "sync_token" text,

  "last_synced_at" timestamp with time zone,
  -- A sync token inherits the TIME WINDOW of the full listing that minted it, so
  -- a connection that only ever syncs incrementally keeps a horizon that stops
  -- moving. This is what the periodic full re-list is scheduled from.
  "last_full_sync_at" timestamp with time zone,

  -- A user may revoke access from their own Google account page at any moment;
  -- the next refresh then answers `invalid_grant`. That is ORDINARY, not an
  -- error condition — so it is recorded as state and shown on the screen as
  -- "Reconnect", instead of throwing 500s forever. A timestamp and not a boolean
  -- because "since when" is the part a user needs to be told.
  "reauthorization_required_at" timestamp with time zone,
  "last_error" text,

  -- THE PUSH CHANNEL. `events.watch` registers a webhook and returns the `id` we
  -- chose plus a `resource_id` we did not; both are needed to STOP it, and a
  -- channel EXPIRES within about a week, so the expiry is state the screen reads
  -- to say "live sync paused" rather than going quietly stale.
  --
  -- THE HASH, NOT THE TOKEN. Google echoes the token registered with the channel
  -- back in `X-Goog-Channel-Token` on every ping, and that echo is the ONLY
  -- authentication the receiving route has — the notification body is empty and
  -- carries no user identity. Storing only the SHA-256 digest means a leak of this
  -- table cannot be turned into a forged ping; the plaintext is generated at
  -- registration, handed to Google, and never persisted. Re-registering mints a
  -- new one, so nothing ever needs to read it back.
  "channel_id" text,
  "resource_id" text,
  "channel_token_hash" text,
  "channel_expires_at" timestamp with time zone,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  -- Reconnecting is an UPDATE, never a second row. Without this constraint every
  -- trip through the consent screen leaves another live refresh token behind —
  -- each one a key to the same calendar that nothing tracks and that Disconnect
  -- would not revoke, which is precisely the state this feature must never reach.
  CONSTRAINT "calendar_connections_account_identity" UNIQUE("user_id","provider","provider_account_id")
);

--> statement-breakpoint

-- CASCADE on both owners, and it is the GDPR erasure path as much as a foreign
-- key: deleting the user (or the profile whose availability this fed) must take
-- the sealed credential with it. Revoking at the provider is a separate step the
-- disconnect route performs — a deleted row with a live token upstream would be
-- a lie, which is why `DELETE /integrations/calendar/:id` revokes first.
ALTER TABLE "calendar_connections"
  ADD CONSTRAINT "calendar_connections_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "calendar_connections"
  ADD CONSTRAINT "calendar_connections_profile_id_profiles_id_fk"
  FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id")
  ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

-- "What is connected for this profile" — the only read the settings screen makes.
CREATE INDEX "calendar_connections_profile_idx"
  ON "calendar_connections" USING btree ("profile_id","provider");
