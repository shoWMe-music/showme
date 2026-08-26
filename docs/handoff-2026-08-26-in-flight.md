# In-flight handoff — 2026-08-26 ~06:30

Written mid-session so a fresh context can pick this up. Everything through
commit `97e539b` is **committed and pushed**; the working tree below is two
agents' unfinished work.

## Deployed right now

| | |
|---|---|
| Database | Cloud SQL `showme-production-db` at migration **0011** |
| API | Cloud Run `showme-api` rev `00008-5kp`, also on **`https://api.showme.music`** (LB + managed cert, both live — the older docs saying "no DNS record" are STALE) |
| Web app | `showme-app.web.app`, bundle `index-alnq5k-P.js` |
| Marketing | `www.showme.music` incl. `availability.html`, `event.html`, `profile.html` |

Secrets in `prod-showme`, all granted to `680839076083-compute@developer.gserviceaccount.com`:
`BREVO_API_KEY`, `BREVO_SENDER` (`no-reply@showme-google.se`), `SHARE_JWT_SECRET`,
`CALENDAR_TOKEN_ENCRYPTION_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

## Agent A — Google Calendar integration (uncommitted, in `apps/api` + Integrations screen)

Building an **Integrations** surface so a user connects Google Calendar in prod.
New files present: `lib/token-encryption.ts`, `lib/oauth-state.ts`,
`lib/google-calendar.ts`, `lib/calendar-sync.ts`, `lib/calendar-integration.ts`,
`routes/integrations.ts`, `serialize/calendar-connection.ts`, plus two test files,
and `apps/web/src/routes/Integrations.tsx`.

Decisions already made and NOT to be relitigated:
- Refresh token encrypted **AES-256-GCM at the application layer**, key from
  `CALENDAR_TOKEN_ENCRYPTION_KEY`. A DB-only compromise yields nothing. Chosen over
  Cloud KMS because KMS needs a Terraform apply that has never run here.
- The client secret never reaches the browser: the SPA receives the `code` at
  `https://showme-app.web.app/oauth/google/callback` and POSTs it to the API,
  which exchanges it.
- A verified `state` parameter is mandatory — without it an attacker can attach
  their calendar to someone else's account.
- Disconnect must **revoke at Google**, not just delete the row.
- Scope is `calendar.events` (read+write, already consented).

It was later asked to ALSO build the **push webhook**, because the prerequisites
turned out to already exist: `showme.music` is user-verified for push, DNS points
at the LB, the cert is ACTIVE, and `https://api.showme.music/api/v1/health` returns
200. The notification body is empty (headers only), so the handler validates
`X-Goog-Channel-Token`, finds the connection by channel id, and runs the same
incremental sync. **Channel renewal is explicitly OUT** — channels expire in ~a
week and renewing needs the unapplied `infra/modules/scheduled-jobs`.

## Agent B — mobile responsive foundation (uncommitted, shell + tokens)

The app has **two `@media` queries in total**. Agent B is doing the FOUNDATION
only: breakpoints (the design system has no spacing/breakpoint scale), the shell
(sidebar has 11–14 items depending on account kind, so a bottom bar is not
automatic), the named patterns (table→cards, two-col→stack, modal→full-screen,
filter row), and proving it on Dashboard + one dense table screen. Its report is
meant to be the brief for a second wave across the remaining ~14 screens.

Check `scrollWidth <= clientWidth` at 390px — that single assertion is most of
what "not responsive" means here. Tap targets: the app is full of 26–28px icon
buttons.

## Handoff patches written but NOT applied (owners were busy)

1. **`POST /events` amenity prefill** — seed `extras.amenities` from
   `venue_details.amenities` when the body omits it and `venueProfileId` is set.
2. **`EventDetailsTab.tsx`** — a "From the venue profile" suggestion row. Amenities
   are a COPY, never a live view: an agreement freezes at confirmation, so a venue
   that sells its PA in March must not rewrite what it promised in January.
3. **`CalendarDayAgenda.tsx`** — Day view hand-builds its own row and still swallows
   clicks; the chip preview patch is in that agent's report.

## Known-open, not started

- **Budget Planner silently discards everything typed** — reads real budget lines,
  edits into `useState`, never writes. The API is fully built. Highest-value bug left.
- `hold_auto_promote` is unreachable from any route, so every hold created in the
  wizard is frozen and will not auto-promote.
- `GET /insights/.../revenue` counts PLANNED budget revenue as realized.
- No repertoire model, so PRO filings can never carry writer shares or ISWC.
- Reaper jobs never deployed; `apps/stream` never deployed (realtime off).

## Traps that cost time tonight

- `new Date("yyyy-mm-dd")` parses as **UTC midnight** — fixed four times in
  different files. Split and rejoin date strings by position.
- Testcontainer suites fail spuriously under contention. **Re-run a single suite
  before believing or dismissing a failure.**
- A shared dev API started without `tsx watch` serves stale code for hours and
  looks fine. If a route 404s that should exist, check the process age first.
- Marketing deploys need `firebase deploy --account daniel.islandman@gmail.com` —
  the `--account` flag, NOT `login:use`, or the CLI default silently changes.
