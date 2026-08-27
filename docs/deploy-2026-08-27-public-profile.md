# Deploy checklist — the public profile rebuild + the show poster

**Status: READY, NOT DEPLOYED.** Written 2026-08-27, on top of a production that
is at **migration 25 with the 2026-08-26 code** (see
[deployment-status.md](./deployment-status.md) — the DB was moved to 25 in a
database-only session and the API/web have not shipped since).

That matters for step 1: the code being deployed here is *newer than production's
code but older than nothing* — there is no pending code from that session to
coordinate with, only the schema it already applied.

---

## What is in this change

| Piece | Where | Deploys with |
|---|---|---|
| Public profile page rebuilt to the design (3a/3b/3c) | `apps/marketing` | **Marketing hosting** |
| `/profile/<slug>` and `/event/<id>`, `.html` dropped everywhere | `firebase.json` (`cleanUrls` + rewrites) | **Marketing hosting** |
| Fixture artwork for the seeded profiles | `apps/marketing/public/seed/` | Marketing hosting (harmless in prod — nothing links to it) |
| Profile **tagline**, published + editable | API + web | API, web app |
| A show's bill carries `city` / `country` / `lineup` | API | API |
| **A show has a poster** — `events.image_file_id` / `image_url` | migration **0026**, API, web, marketing | **DB first**, then API, web, marketing |
| "Pitch a date" opens a modal | `apps/marketing` | Marketing hosting |

---

## 1. Database — migration 0026, before any code

`0026_a_show_has_a_poster.sql` adds two **nullable** columns to `events` and one
foreign key. It is additive, so old code runs fine against it — which is why it
goes first and can go alone.

The new API code **requires** those columns (it SELECTs `image_file_id` on every
public bill), so deploying the API first would 500 every public profile page.

```bash
# Read the fact before trusting this file (deployment-status.md's own lesson).
#   select count(*) from drizzle.__drizzle_migrations;   → expect 26 rows
cloud-sql-proxy --port 5439 prod-showme:europe-north2:showme-production-db &
DATABASE_URL='postgres://…@127.0.0.1:5439/showme' pnpm --filter @showme/db migrate
```

**Take an on-demand backup first and wait for it to report DONE** — not "started".
Name it `pre-0026 show poster`.

Verify by the real object, never by the migration name:

```sql
select column_name, is_nullable from information_schema.columns
 where table_name = 'events' and column_name in ('image_file_id', 'image_url');
-- expect two rows, both YES
```

## 2. API — `apps/api` to Cloud Run

Runbook: [deploy-api.md](./deploy-api.md). No new env vars, no new secrets.

Smoke tests that prove the NEW build is serving (each fails on the old one):

```bash
BASE=https://showme-api-680839076083.europe-north2.run.app/api/v1
curl -s "$BASE/public/profiles/<a-public-slug>" | jq '{tagline, show: .upcomingShows[0]}'
#   → `tagline` present (null is fine), and the show carries city/country/lineup/imageUrl
curl -s "$BASE/public/events/<a-published-event-id>" | jq '.imageUrl'
#   → the KEY exists (null when the show has no poster). A 500 here means step 1 was skipped.
```

## 3. Web app — `apps/web` to Firebase Hosting (`showme-app`)

Nothing new in its env. What to check afterwards:

- **My Profiles → Edit** shows a **Tagline** field; saving it changes the public page.
- **An event → Event Details** shows a **Poster** card. Upload a picture as the
  profile that hosts the event; it appears, and the show's public page leads with it.
- The card is read-only for anyone not acting as the host — that is deliberate
  (storage only issues a write URL to that profile's owners/admins).

## 4. Marketing — `apps/marketing` to Firebase Hosting (`showme-production`)

**This is on the GMAIL account** (`showme-production`), not `prod-showme`. It has
not been redeployed since 2026-08-23, so this deploy carries more than this change.
Read [handoff-2026-08-23-marketing-and-hosting.md](./handoff-2026-08-23-marketing-and-hosting.md)
before running it.

`.env.production` gained **`VITE_APP_URL=https://showme-app.web.app`** — the
public page's "Sign in for documents" link. An unset value drops the link rather
than breaking the build.

`firebase.json` gained `cleanUrls` and two rewrites, and they ship WITH the
hosting deploy — deploying the bundle without the config leaves `/profile/<slug>`
a 404.

Check after:

```
https://www.showme.music/profile/<a-public-slug>   → the page (not a 404)
https://www.showme.music/profile.html?slug=<slug>  → 301 to /profile, still renders
https://www.showme.music/event/<published-id>      → the show
```

The second one is the one worth doing: every link already sent to anyone is the
old form, and it has to keep landing.

---

## What this change does NOT need

- No new Cloud Run services, secrets, IAM, or CORS origins.
- No data backfill. Every column added is nullable and unset means "no poster".
- No coordination with the stream service.

## Rollback

Code rolls back on its own (previous Cloud Run revision / previous hosting
release). **Migration 0026 does not need rolling back** — the columns are
nullable and additive, and the previous build never reads them. Leave them.
