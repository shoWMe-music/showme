---
name: clickup-workflow
description: How to operate ClickUp safely and well — the write rate-limit discipline (never fire parallel writes), creating parent tasks + subtasks, choosing statuses on the Tech/General board, and bulk-updating without tripping a multi-hour lockout. Use whenever creating, updating, commenting on, or bulk-changing ClickUp tasks. Pairs with the clickup-tasks skill (which says WHERE the board is).
---

# ClickUp workflow

For WHERE tasks live (Tech → General, `901524472815`, and the lookalike lists to avoid), see [[clickup-tasks]]. This skill is HOW to work the ClickUp API/MCP without getting throttled.

## The rate-limit rule (learned the hard way)

The ClickUp connector enforces a **rolling write quota**. Exhaust it and every write fails for a long time — the error is `Rate limit exceeded. Please wait N minutes` where **N counts down over real time (seen at 1281 → 823 min)**, i.e. a **fixed multi-hour reset**, not a 60-second throttle. There is no way to shorten it; retrying before it clears just wastes calls.

What trips it:
- **Firing writes in PARALLEL.** A batch of 7 simultaneous `update_task` calls tripped the hard lockout. To the limiter, a burst looks like abuse.
- **Volume.** ~30+ writes in one session (21 task creates + 20 update attempts) drained the budget.
- **Reads count too** — `get_list`, `filter_tasks`, `get_workspace_hierarchy` all draw on the same budget.

Discipline, in order of importance:
1. **Never issue ClickUp writes in parallel. One call at a time, sequentially.** If you must change many tasks, do them one-by-one and accept it's slower.
2. **Minimize total calls.** Set everything you can in the CREATE call (status, priority, assignees, description) so you never need a follow-up UPDATE. Don't re-fetch the workspace hierarchy you already have.
3. **Budget for bulk.** Flipping 20 statuses is 20 writes — near the danger zone on its own. Ask whether the bulk change is needed, or batch it across time.
4. **On a lockout: stop.** Read the `wait N minutes`, don't retry, and either schedule a retry past the reset or hand the mechanical status flips to the user. Retrying mid-lockout only burns attempts.

## Creating a parent task + subtasks

Create the parent first to get its `task_id`, then create each subtask with `parent: "<parent_id>"`.

```
create_task({ list_id: "901524472815", name, markdown_description, priority })   → returns task_id
create_task({ list_id: "901524472815", parent: task_id, name, markdown_description, priority })
```

- Put the full spec in `markdown_description` (before/after copy, location, dev notes) so the task is self-contained.
- Set `priority` at create time (`urgent|high|normal|low`).
- Subtask creates can be sent as a modest set, but keep them SEQUENTIAL if there are many — the same parallel-write rule applies.

## Statuses on the Tech → General board

Valid statuses (in order): `backlog` · `scoping` · `in design` · `in development` · `in review` · `testing` · `ready for development` · `re-do` · `shipped` (done) · `cancelled` (closed).

Choose honestly by actual state:
- **in development** — actively being built.
- **in review** — implemented + self-tested, awaiting human review / merge. Use this for "code done, not deployed".
- **testing** — in QA.
- **shipped** — deployed / truly done. Do NOT mark shipped just because the code compiles; nothing local-only is "shipped".

Set status via `update_task({ task_id, status })` — and one at a time.

## Comments

`create_comment({ entity_type: "task", entity_id, comment_text })` (Markdown supported). Also a write — same sequential rule. Prefer one good summary comment over many small ones.

## Not the task board

The repo's `apps/api/src/lib/clickup.ts` writes to the **CRM "Website Leads"** list (`901524890050`, env `CLICKUP_LEADS_LIST_ID`) — that's the marketing contact-form sink, a different budget/purpose from dev tasks. See [[clickup-tasks]].
