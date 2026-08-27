-- The app had opinions about what to tell people, and people had none about what
-- they wanted to hear.
--
-- Settings -> Notifications was a placeholder promising "email and in-app alert
-- controls ... coming soon", and `lib/notify.ts` wrote a `notifications` row for
-- every recipient of every emitted type, unconditionally. There was nowhere for a
-- user to say "not this" and nothing that would have read it if there were.
--
-- ONE ROW PER (USER, CATEGORY), and only for the categories somebody has actually
-- touched. The alternative — seed every user with a row per category — was
-- rejected twice over: it needs a backfill today, it needs another one the day a
-- category is added, and it puts the DEFAULTS in the database, where the reason
-- for each one cannot be read. The defaults live in `NOTIFICATION_CATEGORIES`
-- (`apps/api/src/lib/notify.ts`) with the argument for each written beside it, and
-- a missing row here means exactly "whatever that says". A new account is silent
-- in this table and still hears everything.
--
-- CATEGORY, NOT TYPE. `notifications.type` is free text that grows with every
-- route that learns to speak — `deal.sent`, `hold.lost`, `settlement.finalized`.
-- A preference keyed on it would be a settings screen that sprouts a checkbox per
-- commit, and stored rows silencing types nobody remembers naming. The category is
-- the coarse thing a person has an opinion about; `categoryForNotificationType`
-- maps the one onto the other in a single place.
--
-- TEXT, not an enum, for the same reason `notifications.type` is text: the catalog
-- is a product decision, and an unknown value here must be inert rather than fatal.
-- `lib/notify.ts` treats a row whose category it does not recognise as noise and a
-- type it cannot categorise as ALWAYS DELIVERED — the safe direction. A new
-- notification type that nobody has classified yet arrives; it is never silently
-- dropped by a preference that was never shown to anyone.
--
-- TWO COLUMNS BECAUSE THEY ARE TWO DECISIONS. `in_app = false` means the
-- `notifications` row is never written — a suppressed notification does not exist,
-- rather than sitting unread forever and re-appearing the day somebody clears the
-- filter. `email = false` means the same fact is not also put in a mailbox.
-- Neither is nullable: a stored row is an explicit answer for both channels, and
-- "no answer" is the absence of the row.
--
-- BOTH NOT NULL AND NO DEFAULT, deliberately. A default here would be a second
-- place the defaults are written down, free to disagree with the code.
--
-- ON DELETE CASCADE: a preference is meaningless without the person who set it.
--
-- No index beyond the primary key. Every read is "these user ids, this one
-- category" (the recipient filter in `notifyUsers`) or "this user, all of them"
-- (the settings screen) — the composite key leads on `user_id` and serves both.
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id" text NOT NULL,
  "category" text NOT NULL,
  "in_app" boolean NOT NULL,
  "email" boolean NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_preferences_user_id_category_pk" PRIMARY KEY("user_id","category")
);

ALTER TABLE "notification_preferences"
  DROP CONSTRAINT IF EXISTS "notification_preferences_user_id_users_id_fk";
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
