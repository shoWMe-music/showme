-- A profile's pictures were addresses, not pictures.
--
-- Everything visual about a profile — the avatar, the cover banner, every photo
-- in the gallery — was a `text` column holding a URL somebody typed. The editor
-- said so out loud ("Avatar image URL", placeholder "https://…"), which means the
-- only way to put a face on a venue was to already be hosting that face
-- somewhere else. `files` + signed URLs, the subsystem this repo built for
-- exactly this, was never wired to a profile at all: `profile_media` had no
-- column that could name a file, and `profiles.avatar_url` could not hold one
-- either, because a signed URL expires in fifteen minutes. Storing one would
-- give a venue a face that works until lunchtime.
--
-- So the reference has to be to the FILE, with the URL minted per read. That is
-- what this migration adds:
--
--   * `profiles.avatar_file_id` / `banner_file_id` — the uploaded picture. The
--     old `*_url` columns stay, and stay meaningful: pointing at a picture
--     somebody else hosts is a legitimate thing to do and is what every existing
--     row does. The file wins when both are set; `serialize/profile.ts` resolves
--     the ladder in one place.
--
--   * `profile_media.file_id` — the same for a gallery tile. `url` therefore
--     stops being NOT NULL, because an uploaded photo has no URL to store, and
--     a CHECK keeps the pair honest: exactly one of the two, never a tile that
--     names nothing.
--
-- Videos are unaffected by the file half and always keep `url`: a YouTube link
-- is not a file anyone hands us. What changes for them is upstream, in the API —
-- the URL is now parsed to a provider + id and stored canonical, so the value in
-- this column is one the player can actually be pointed at.
--
-- ON DELETE: a deleted file takes its gallery tile with it (CASCADE — a tile
-- whose bytes are gone is not a tile), but only clears the avatar/banner
-- (SET NULL — the profile itself must survive losing its picture).
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "avatar_file_id" uuid;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "banner_file_id" uuid;

ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_avatar_file_id_files_id_fk";
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_file_id_files_id_fk"
  FOREIGN KEY ("avatar_file_id") REFERENCES "files"("id") ON DELETE SET NULL;
ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_banner_file_id_files_id_fk";
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_banner_file_id_files_id_fk"
  FOREIGN KEY ("banner_file_id") REFERENCES "files"("id") ON DELETE SET NULL;

ALTER TABLE "profile_media" ADD COLUMN IF NOT EXISTS "file_id" uuid;
ALTER TABLE "profile_media" DROP CONSTRAINT IF EXISTS "profile_media_file_id_files_id_fk";
ALTER TABLE "profile_media" ADD CONSTRAINT "profile_media_file_id_files_id_fk"
  FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE;

ALTER TABLE "profile_media" ALTER COLUMN "url" DROP NOT NULL;

-- Exactly one source per tile. Written as a NOT-both / NOT-neither pair so the
-- error a bad write gets names the rule rather than a column.
ALTER TABLE "profile_media" DROP CONSTRAINT IF EXISTS "profile_media_one_source";
ALTER TABLE "profile_media" ADD CONSTRAINT "profile_media_one_source"
  CHECK (("file_id" IS NULL) <> ("url" IS NULL));

-- Reading a gallery means "this profile's tiles in order", and reading a photo
-- means joining its file. Both are on every profile page, public included.
CREATE INDEX IF NOT EXISTS "profile_media_profile_idx" ON "profile_media" ("profile_id", "position");
