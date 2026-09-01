-- Claiming an invited account stops being "sign in as the address we mailed".
--
-- Daniel, 2026-09-01: "The email must verify it. So some type of OTP. But they
-- should be able to change the email."
--
-- THE TWO RULES THIS SITS BETWEEN, both of which were wrong on their own.
-- `assertInvitationRecipient` required the signed-in Firebase address to EQUAL
-- the invited one. Airtight, and unusable in the case the product is actually
-- for: a venue is invited at `info@`, and the person who runs it has their own
-- account. Ran's invitation spec went the other way — "the invitee can sign up
-- with whatever email they prefer" — which makes the link the only credential and
-- hands the account to whoever it gets forwarded to.
--
-- A code sent to the invited address settles it. Control of that address is
-- proved once; the account it becomes may be any address the claimant likes; and
-- a forwarded link is not enough, because the code goes to the original address
-- and not to the person holding the forward.
--
-- MODELLED ON `share_otps`, deliberately and down to the two counters, because
-- that reasoning was paid for once already in migration 0018: `attempts` counts
-- wrong guesses against the live code, `issues` counts codes sent inside the
-- window, and they are separate columns so that asking for a fresh code cannot
-- reset the hour by resetting the guesses. The row is not deleted when a code is
-- consumed or burnt out — deleting it would hand the next caller a clean hour and
-- a clean five guesses, so neither limit would bind.
--
-- NO `email_hash` COLUMN, unlike its model. A share can be opened by any of
-- several recipients, so its OTP is keyed by (share, address); an invitation
-- names exactly one address, so the invitation itself is the key — hence the
-- primary key on `invitation_id` rather than a surrogate plus a unique index.
CREATE TABLE IF NOT EXISTS "invitation_otps" (
  "invitation_id" uuid PRIMARY KEY NOT NULL,
  "code_hash" text NOT NULL,
  "salt" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "issues" integer DEFAULT 0 NOT NULL,
  "consumed_at" timestamp with time zone,
  "rate_window_start" timestamp with time zone
);

-- CASCADE: the code is meaningless without the invitation it proves, and an
-- invitation is already deleted with the event or profile it grants access to.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invitation_otps_invitation_id_invitations_id_fk'
  ) THEN
    ALTER TABLE "invitation_otps"
      ADD CONSTRAINT "invitation_otps_invitation_id_invitations_id_fk"
      FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE;
  END IF;
END $$;
