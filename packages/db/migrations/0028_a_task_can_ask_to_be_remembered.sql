-- A task could be given a deadline and never say a word when it arrived.
--
-- Ran's report: "tasks are missing reminders, which should send an in-app
-- notification for now and be synced to Google Tasks later". Nothing fired,
-- because nothing could: `tasks.due_date` is a DATE — a calendar day with no
-- clock and no zone — and a reminder that goes off at a TIME needs an instant.
--
-- `remind_at` IS AN ABSOLUTE INSTANT, NOT AN OFFSET FROM THE DUE DATE.
-- "Two hours before it is due" has nothing to subtract from until somebody also
-- decides what o'clock a day ends and in whose time zone; it would move every
-- time the due date is edited, sometimes into the past; and it cannot express
-- the reminder on a task with no due date at all ("ring the promoter Thursday at
-- ten"), which is a perfectly ordinary thing to want. So the client resolves the
-- wall-clock the user picked in the user's own zone and sends the resulting UTC
-- instant — precisely what docs/timezones.md prescribes for a local-time
-- reminder ("resolve the wall-clock in the owner's tz to a UTC firing instant").
-- It is also the shape Google Tasks itself stores (one RFC-3339 moment per
-- task), so the sync half of this feature will be a copy, not a translation.
--
-- `reminded_at` IS THE FIRE-ONCE MARK, and it is a STAMP rather than clearing
-- `remind_at`. The sweep runs every few minutes; without a mark it would re-ring
-- the same bell on every pass forever. Clearing `remind_at` would also do that
-- job, and was rejected: it destroys the user's own setting, so the edit dialog
-- can no longer tell "no reminder was ever set" from "it already went", and the
-- Google Tasks sync that comes next would have nothing left to push. Re-arming
-- stays explicit — `PATCH /tasks/:id` with a new `remind_at` clears this back to
-- null, which is what "change the reminder" has to mean.
--
-- The sweep CLAIMS its rows: one `UPDATE … SET reminded_at = now() WHERE
-- remind_at <= now() AND reminded_at IS NULL … RETURNING`, then notifies what
-- came back. Two overlapping runs therefore cannot both take the same task —
-- the second one's WHERE no longer matches. That makes delivery at-most-once,
-- deliberately: a reminder lost to a crash between the claim and the insert is
-- one missed nudge about a task the owner can still see on their list, whereas
-- at-least-once means a bell that rings every five minutes until somebody
-- notices, which is how a user learns to ignore the bell entirely.
--
-- The INDEX is partial on exactly the sweep's predicate. Nothing else in the app
-- filters on either column (a task's reminder is read with its task), most tasks
-- have no reminder, and a fired one drops straight out of the index — so it
-- stays the size of the work actually outstanding rather than a row per task.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "remind_at" timestamp with time zone;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reminded_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "tasks_pending_reminder_idx" ON "tasks" ("remind_at")
  WHERE "remind_at" IS NOT NULL AND "reminded_at" IS NULL;

-- AND THE TABLE THIS REPLACES GOES, rather than sitting beside it.
--
-- `task_reminders` has existed since 0000 and is WRITE-ONLY: `POST /tasks`
-- inserts whatever its `reminders[]` body carries, and not one line of code in
-- this repo has ever read the table back — no route returns it, no job queries
-- it, no screen offers the field, so no user has ever set one. It also cannot do
-- the job asked for: `date` + `time` with no zone names a wall-clock nobody
-- anchored, which is the same gap that made `due_date` useless for firing.
--
-- Keeping it would leave the app with two reminder mechanisms of which exactly
-- one rings, and an API that still advertises `reminders[]` on task creation
-- while quietly dropping them on the floor — a worse lie after this change than
-- before it, because now there IS a reminder that works. One reminder per task
-- is also what Ran asked for and what Google Tasks models.
--
-- Guarded, not bare. Everything above is an argument from the CODE — nothing
-- reads the table, no screen offers the field — and that argument cannot see
-- production's rows. `POST /tasks` did accept a `reminders[]` array, so an API
-- client could have written some without any screen existing.
--
-- So: drop it if it is empty, and REFUSE if it is not. An empty table costs a
-- count; a non-empty one stops the deploy and puts the decision in front of a
-- person, which is the only correct place for "throw this data away".
DO $$
DECLARE
  remaining bigint;
BEGIN
  IF to_regclass('public.task_reminders') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM task_reminders' INTO remaining;

  IF remaining > 0 THEN
    RAISE EXCEPTION
      'task_reminders holds % row(s), so this migration will not drop it. Nothing in the app has ever read that table, but these rows predate that claim. Decide deliberately: copy them onto tasks.remind_at, or empty the table, then re-run.', remaining;
  END IF;

  DROP TABLE task_reminders;
END $$;
