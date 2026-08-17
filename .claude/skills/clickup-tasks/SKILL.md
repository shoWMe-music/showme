---
name: clickup-tasks
description: Where shoWMe's dev/product tasks live in ClickUp — the Tech space → "General" board (the one holding the "Design and Architecture Rework" epic). Use whenever looking up, filtering, creating, or updating build/product tasks in ClickUp.
---

# ClickUp tasks

When you look in ClickUp for **dev / product / build tasks**, look at the whole **"General" board in the Tech space** — the one where the **"Design and Architecture Rework"** epic lives. The epic is only how you identify the right board (there are other lists named "General"); the board itself is the target, so read across all of it, not just that one task.

- **Space:** `Tech` — id `901510906250`
- **Board (list):** `General` — id `901524472815`

Default any task lookup, filter, create, or update to this board unless the user names a different one. Prefer filtering by `list_ids: ["901524472815"]`.

This board is the live spine of the rebuild: the data-model tasks (Events, Deals, Settlements, Profiles…), the wiring epic, the **UI Build** epic, the E2E harness epic, and the **Design and Architecture Rework** epic. Statuses are real (backlog / in development / in review / shipped) and most tasks are assigned to Daniel.

## Not the task board — do not confuse

- **CRM → "Website Leads"** (`901524890050`) — the marketing contact-form sink (`apps/api/src/lib/clickup.ts`, env `CLICKUP_LEADS_LIST_ID`). CRM leads, not tasks.
- **Founders Space → "Tech"** (`901522939303`) — IT/ops (Google Workspace, DNS, mailboxes), not product build.
- **Founders Space → "Product & Compliance"** (`901523133157`) — compliance tickets (e.g. GDPR/RSVP).
- **Founders Space → "Daniel's Tasks"** (`901523307289`) — personal list, often empty.
- **Founders Space → "General tasks (OLD pre new Product)"** (`901520237282`) — explicitly OLD; ignore.
