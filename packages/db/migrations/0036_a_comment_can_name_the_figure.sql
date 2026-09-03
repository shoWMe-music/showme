-- A COMMENT CAN NAME THE FIGURE IT IS ABOUT.
--
-- ClickUp `86cbcn1ue`: *"The option for collaborators to comment on a specific
-- field."*
--
-- `settlement_comments` already narrows a remark to a SECTION of the document
-- (`event`, `schedule`, `riders`, `budget`, `deal`, `settlement`). What it could
-- not do is point at one row. The gap is not politeness: `EventSettlement`'s own
-- note records that answering a comment MEANS changing a figure, and a remark
-- floating in a general thread makes the reader hunt for which one it disputes.
--
-- A COLUMN, and for exactly the reason `section` is one rather than a "[Budget] "
-- prefix on the message. The old app wrote the prefix into the text so an inbox
-- could guess what a comment was about, and a guess parsed out of user-supplied
-- text is not a field — a recipient who types the prefix themselves lands
-- wherever the parser puts them. Encoding a line id into `section` would be the
-- same mistake with a longer string.
--
-- NULLABLE, and null on every row that already exists. A comment on the
-- settlement as a whole stays a legitimate and common thing to say, so absent
-- means "about all of it" rather than "unclassified".
--
-- ON DELETE SET NULL, not cascade. Deleting the line somebody questioned must not
-- delete the question — that is usually the moment it becomes most worth reading,
-- and a settlement whose objections vanish when the operator removes the disputed
-- row is a record nobody should trust.
--
-- Additive: no backfill, no drop, no default, and nothing recomputes. Every
-- settlement already finalized is untouched.
ALTER TABLE "settlement_comments"
  ADD COLUMN IF NOT EXISTS "settlement_line_id" uuid;

DO $$ BEGIN
  ALTER TABLE "settlement_comments"
    ADD CONSTRAINT "settlement_comments_settlement_line_id_settlement_lines_id_fk"
    FOREIGN KEY ("settlement_line_id") REFERENCES "settlement_lines"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- The read this exists for is "every comment on this line", so it gets an index.
-- Partial: the vast majority of rows carry NULL, and an index over them would be
-- mostly a list of comments that are not about a line at all.
CREATE INDEX IF NOT EXISTS "settlement_comments_line_idx"
  ON "settlement_comments" ("settlement_line_id")
  WHERE "settlement_line_id" IS NOT NULL;
