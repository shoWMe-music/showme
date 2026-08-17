-- Rename the account_kind enum value 'professional' -> 'team_and_crew' (fix-list #7).
-- A value RENAME preserves existing rows; drizzle-kit's default (drop + recreate the
-- type) would fail the cast for any existing 'professional' profile/user. Postgres
-- applies the rename atomically to every column using the enum.
ALTER TYPE "public"."account_kind" RENAME VALUE 'professional' TO 'team_and_crew';
