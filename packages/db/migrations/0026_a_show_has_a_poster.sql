-- A show had no picture, and the pages that are about shows had nothing to draw.
--
-- Every public surface built on `events` — a venue's programme, a performer's
-- dates, the show's own page — is a poster wall with no posters. The design's
-- venue cut leads with three of them; ours renders three identical warm washes,
-- because `events` has no column that can name an image. The poster is the one
-- thing a promoter already has and cannot put in.
--
-- Two columns, the same ladder `profiles` got in 0022 and for the same reasons:
--
--   * `image_file_id` — an UPLOAD. The bytes live in the host profile's own
--     storage folder (`profiles/<id>/media/…`, the prefix `routes/files.ts`
--     enforces), and the browser is handed a freshly signed URL on every read.
--     This is what the event editor writes.
--
--   * `image_url` — a plain external address. Kept because pointing at a picture
--     somebody else hosts is a legitimate thing to do, and because it is the only
--     form a SEED can write: in local dev the object store is the API's own
--     in-memory sink, which forgets everything on restart, so a seeded upload
--     would be a poster that 404s.
--
-- The FILE wins when both are set, resolved in one place (`serialize/event.ts`),
-- so no caller has to know the ladder exists. A signed URL is never stored in the
-- URL column: it expires in fifteen minutes, and a show whose poster works until
-- lunchtime is worse than a show with none.
--
-- ON DELETE SET NULL, not CASCADE: deleting the file must cost the show its
-- picture, never the show. A settled event cannot disappear because somebody
-- tidied up a storage folder — the same rule `events.stage_id` follows.
--
-- No index. The column is read WITH its event and never filtered on; nothing
-- anywhere asks "which shows have a poster".
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "image_file_id" uuid;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "image_url" text;

ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_image_file_id_files_id_fk";
ALTER TABLE "events" ADD CONSTRAINT "events_image_file_id_files_id_fk"
  FOREIGN KEY ("image_file_id") REFERENCES "files"("id") ON DELETE SET NULL;
