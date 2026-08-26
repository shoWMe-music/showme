-- Threads: an event is not one conversation.
--
-- The Messages tab was a single per-event thread with a coarse `visibility` enum
-- standing in for scoping — `party` meant "the operator, or the sender", which is
-- not a thread at all and, worse, put a performer's private sub-hire chat in front
-- of the operator (decisions #4: "a performer's private sub-hire is invisible to
-- the operator — not a party").
--
-- A thread is now `(visibility, thread_participant_id)`:
--   all       + NULL        -> the event room
--   operators + NULL        -> the operators back office
--   party     + participant -> that counterparty's thread
-- Readers are DERIVED from the participation graph per request, never stored.

ALTER TABLE "event_messages" ADD COLUMN "thread_participant_id" uuid;--> statement-breakpoint

ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_thread_participant_id_event_participants_id_fk"
  FOREIGN KEY ("thread_participant_id") REFERENCES "public"."event_participants"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "event_messages_thread_idx" ON "event_messages" USING btree ("event_id","thread_participant_id");--> statement-breakpoint

-- Existing rows, decided before the CHECK can refuse them.
--
-- `all` and `operators` rows already ARE the event room and the back office; they
-- keep a NULL key and every reader they had.
--
-- A `party` row was readable by its sender and by the operators. Its sender's own
-- party thread is the closest true reading of what it meant, and it preserves the
-- sender as a reader. The operator side is preserved too wherever the sender is a
-- counterparty the operator booked (no sponsor stamp -> the operators are the other
-- side of the edge), which is every performer today. Where the sender was crew
-- brought by a performer, the new readers are the crew and their sponsor and NOT
-- the operator — that narrowing is the leak fix, applied to history as well.
UPDATE "event_messages"
SET "thread_participant_id" = "sender_participant_id"
WHERE "visibility" = 'party' AND "sender_participant_id" IS NOT NULL;--> statement-breakpoint

-- A `party` row with no sender participant has no thread to belong to: its sender
-- is not (or is no longer) on the event, so the operators were its only readers.
-- The back office is where it was already being read, and it is the only scope that
-- loses nobody.
UPDATE "event_messages"
SET "visibility" = 'operators'
WHERE "visibility" = 'party' AND "sender_participant_id" IS NULL;--> statement-breakpoint

ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_thread_key_matches_scope"
  CHECK (("event_messages"."visibility" = 'party') = ("event_messages"."thread_participant_id" IS NOT NULL));
