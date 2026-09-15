-- A TASK CAN SAY HOW MUCH IT MATTERS.
--
-- Ran, ClickUp `123qy9rnk29`: *"Let's add priority tags to tasks: Urgent, High,
-- Normal, Low."* Four values, named exactly as he named them, in that order.
--
-- It also unblocks `123qy9rnk27` (the Dashboard's tasks section, which asks to
-- preview "the top 5 tasks by priority"). That card cannot be built at all until
-- there is something to sort on — the tasks table has carried a title, a due date
-- and an assignee and nothing that ranks one job above another, so the list route
-- ordered by `created_at` because that was the only ordering it had.
--
-- NULLABLE, WITH NO DEFAULT, and that is a decision rather than an omission.
-- Defaulting every existing task to `normal` would assert that somebody had
-- looked at each of them and judged it ordinary. They have not. NULL means
-- *untagged*, which is the honest state of every task written before today and
-- the state most tasks will stay in — the same reading ClickUp's own "no
-- priority" has.
--
-- The consequence is one the sort has to handle rather than ignore: untagged
-- tasks rank BELOW `low`, because a job nobody has triaged should not outrank one
-- somebody has explicitly called unimportant.
--
-- An ENUM rather than a free string or an integer:
--  - a string lets "Urgent", "urgent" and "URGENT" coexist and sort apart;
--  - an integer sorts beautifully and reads as nothing — `2` in a database dump
--    tells you no more than the row it sits in.
-- The order below IS the ranking, and `enum_range` preserves it, so the sort can
-- be expressed against the type instead of a CASE nobody maintains.
CREATE TYPE "task_priority" AS ENUM ('urgent', 'high', 'normal', 'low');

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "priority" "task_priority";
