# Deployed — 2026-09-04

| | |
|---|---|
| **API** | Cloud Run `showme-api-00032-s8n`, 100% of traffic, no pin. `api.showme.music` health 200. |
| **Database** | migrations **36 → 38**. `0036_a_comment_can_name_the_figure`, `0037_a_removal_remembers_what_it_undid`. |
| **Web app** | `showme-app.web.app` on `music-showme` — bundle `index-DL3iRfP2.js`, 3 of 23 files uploaded (content-addressed store). Served bundle matches the local build **byte for byte** (sha256 `52d2a53f…`). |
| **Marketing** | NOT redeployed. Nothing in this release touches `apps/marketing`. |
| **Terraform** | NOT applied, and none needed — `plan` reports *"No changes. Your infrastructure matches the configuration."* |

## What shipped

Fourteen commits closing eight tickets: the five engineering-found bugs
(terraform cert trap, the configuration audit, the participants API + migration
0037, the web unit-test runner, Team Access) and Wave 1 of the bug plan (settings
currency/timezone, the wizard's destroyed work, venue Rooms UI shown to
performers, the unavailability reason prompt, the double-booking warning, the FX
notice). Detail in `handoff-2026-09-04-wave-one.md` and
`bug-analysis-2026-09-04.md`.

## What was checked, and how

**Configuration survived.** The live env and secrets were recorded BEFORE the
deploy and compared after: all 12 present, 6 plain + 6 secret, no drift. A
`--source` deploy names no configuration, which is what makes that safe — `--set-*`
would have replaced the whole set.

**The API said so itself.** First production run of the boot audit built for
`86cbaxw0w`:

```
shoWMe API configuration complete
unconfigured: Google Calendar integration; Google Calendar push notifications
missingRequired: (none)
```

Those two are genuinely optional. Search Cloud Logging for
`configuration INCOMPLETE` after any future deploy.

**The migrations moved schema and not data.** Row counts either side: 18 events,
26 participants, 5 settlements — unchanged — and `status_before_removal` is
non-null on zero rows. Both migrations are additive: one nullable column each,
no backfill, no drop.

**Which revision answered.** A first attempt to prove this by hitting a
00032-only route was INVALID and is worth recording: the auth preHandler runs
before routing, so a nonexistent path also returns 401. The discriminator proved
nothing. A negative control caught it. Confirmed instead by the traffic
allocation (100% to 00032, `latestRevision: true`) and that revision's own boot
log.

**The bundle is a production build.** Checked for emulator markers before
uploading — `9099`, `connectAuthEmulator`, `demo-showme`, `127.0.0.1` all absent,
and the production API origin and Firebase project present. `pnpm test:e2e`
overwrites `apps/web/dist` with an emulator build, and this file already records
an incident where exactly that went live.

**The pair works, not just the halves.** Driven in a real browser at
`showme-app.web.app`: the sign-in screen renders, and a `fetch` from that origin
to the deployed API returns 200 rather than throwing — so CORS admits the app.

## Terraform, verified without installing it

`plan` was run through the `hashicorp/terraform` Docker image with ADC mounted
read-only (recipe in `infra/README.md`). Result: no changes, anywhere. The live
certificate `showme-api-lb-cert` (ACTIVE, expires 2026-11-21), the name the module
now produces, and the name in state all agree. The rename that would have forced a
replacement — and taken `api.showme.music` down for 15–60 minutes — is gone.

---

# Deployment status — what is live, and what is not

The standing answer to "what's deployed where". Update it when that changes.
Account/project map and the domain history live in
[handoff-2026-08-23-marketing-and-hosting.md](./handoff-2026-08-23-marketing-and-hosting.md).

## ⚠️ ON `main` AND **NOT DEPLOYED** — three commits, one migration

`main` is AHEAD of production. Read this before assuming the live system matches
the repo — that assumption is the thing this section exists to stop.

| Commit | What | Needs |
|---|---|---|
| `847885a` | Budget Planner opens on the tiers the event already lists | nothing — no schema change |
| `e6116ca` | Deductions itemised per party; settlement can be sent to ONE party | nothing — no schema change |
| `b81ed93` | A comment can name the figure it is about | **migration `0036`** |

**`0036_a_comment_can_name_the_figure` has NOT been run against production.**
It adds a nullable `settlement_comments.settlement_line_id` with a partial index
and an `ON DELETE SET NULL` foreign key. Additive: no backfill, no default,
nothing recomputes, every finalized settlement untouched. 37 migration files on
disk; production is still at 36.

**To ship these, in this order:** take an on-demand Cloud SQL backup and poll it
to `SUCCESSFUL`, run `0036`, then deploy the API, then build and deploy the web
app. The API before the web, for the same reason as the deploy below — a bundle
that posts `settlementLineId` to an API that does not know the field is a 400 on
every comment.

The API deploy is a plain source deploy with configuration untouched; see
`deploy-api.md`. Do **not** run a bare `terraform apply` (the certificate landmine
below is unchanged).

## 2026-09-03 (later) — the settlement re-do, waves 1 to 3. LIVE.

ClickUp `86cbcn1ue`'s re-do list: the cost vocabulary, bar/merch split, percentage
deductions, the advance direction, and the settlement Overview. **No migration** —
every new field is additive JSON inside `budget_lines.details`,
`settlement_lines.details` and `settlements.computed`, all of which already exist.

| | |
|---|---|
| API | **`showme-api-00031-cvs`**, serving 100%. Source deploy from `1418292` on `main`, configuration untouched. |
| Web app | `showme-app.web.app` — version `62f2e23c0ed74a18`, release `1788428515867000`, bundle `index-F5vY0mPS.js`. 2 of 23 files uploaded (content-addressed store). |
| Database | **Untouched.** 36 migrations on disk, 36 applied; nothing pending, nothing run. |
| Marketing | Untouched. |
| Terraform | Not run. The `api.showme.music` certificate landmine below is still there and still deliberately unarmed. |

**Deployed API FIRST, then the web, and the order is load-bearing.** The new bundle
sends `merch_spend` and `percentage_of` line bases; the old API would have answered
400 to both. The reverse order would have broken the Budget Planner for as long as
the gap lasted.

**Verified from what is SERVED, not from the deploy output.** The live
`/openapi.json` was read through both `api.showme.music` and the run.app origin and
carries `merch_spend`, `percentage_of`, `ofLabel`, `basisPoints`,
`prepaidCounterpartyIds` and `prepaidWith` — none of which existed in `00030`, so
their presence is what proves the new revision is answering rather than a warm
instance of the old one. The served bundle name was matched against the local build
byte for byte, and the served JavaScript was grepped for the strings this work adds
("To be deducted from", "Average merch spend per guest", "Paid in advance by",
"Left to divide (the pool)") **and for the ones it retires** — "Borne by", "Bar and
merchandise" and "Paid before the event" are all absent from the live file.

`showme-app.web.app` was loaded in a browser and renders the sign-in screen with no
console errors. **The signed-in screens were NOT driven in production** — that
needs a production credential, which this session did not have. They were driven
against the local stack as the seeded operator, with Postgres checked at each step.

### One thing that is live and still unratified

Nothing new. The agent-commission-on-gross change from 2026-09-02 is still live and
still waiting on ClickUp `86cba8wtb`, and Ran's reply on `86cbcn1ue` ("Booking
Agent comission comes out of the final performers share") reads as though it might
contradict it — see ClickUp `123qy9rng5m`. Production has three deals and six
internal profiles, so no real agent is affected yet.

## 2026-09-03 — the scheduled jobs finally RUN. Superseded by the entry above.

`apps/jobs` had never executed in production. Seven sweeps were written, tested and
inert: expired offers, expired venue handoffs, expired shares, due representation
terminations, the 90-day GDPR purge of unclaimed stubs, task reminders, and the
display-only FX refresh. The GDPR one is a compliance commitment that was not
running.

| | |
|---|---|
| Cloud Run Job | **`showme-jobs`**, `europe-north2`, image `…/showme-jobs:latest` |
| Schedule | **`showme-jobs-schedule`**, `0 */4 * * *` UTC, ENABLED, `europe-west1` |
| Identities | `showme-jobs-runner` (Cloud SQL + DATABASE_URL) and `showme-jobs-trigger` (may only start the job) |
| Applied by | `terraform apply -target=module.scheduled_jobs` — the module already existed and had simply never been applied |

**Proven by running it, not by the apply succeeding:**

```json
{"errors": [], "skipped": ["exchangeRates: EXCHANGE_RATE_API is not set, so
display-only rates were not refreshed"], "offers": 0, "handoffs": 0, "shares": 0,
"representationTerminations": 0, "stubsPurged": 0, "stubsSkipped": [],
"taskReminders": 0}
```

Zero rows everywhere is the correct answer on a six-profile production with nothing
yet due — and `exit(0)`, which is the point of the change below.

### Three things this needed that were not obvious

**1. Cloud Scheduler does not exist in EITHER Nordic region.** The module defaulted
to `europe-north1` and the apply failed with `Location 'europe-north1' is not a
valid location`. Everything else here is `europe-north2` (Stockholm). Confirmed
with `gcloud scheduler locations list` — the nearest supported are `europe-west1`
and friends. The schedule now lives in `europe-west1`; the WORK still runs in
Stockholm next to the database, and the scheduler's whole job is one authenticated
POST with no payload.

**2. An unconfigured job must SKIP, not fail.** Production has no
`EXCHANGE_RATE_API` secret and never has. Under the old contract the FX refresh
threw, which pushed an error, which exited non-zero — so every execution would have
been red forever and the reapers, the reminders and the GDPR purge would have
looked broken alongside it. `JobRunResult` now separates `skipped` from `errors`:
declined-for-a-stated-reason still exits zero. A key that EXISTS and fails is still
an error, and there is a test for each half.

**3. IAM propagation loses a race with the first apply.** The job creation failed
once with `Permission denied on secret … DATABASE_URL` seconds after Terraform
created that exact binding. Nothing was wrong; re-running the apply succeeded. If
this is seen on a fresh environment, re-run before investigating.

### ⚠️ A LANDMINE IN `infra/envs/prod`, LEFT DELIBERATELY UNTOUCHED

A full `terraform apply` here will **replace the live TLS certificate on
`api.showme.music`**. The module renames `showme-api-lb-cert` →
`showme-api-lb-cert-v1`, which forces replacement:

```
# module.api_load_balancer.google_compute_managed_ssl_certificate.default must be replaced
~ name = "showme-api-lb-cert" -> "showme-api-lb-cert-v1" # forces replacement
```

A Google-managed certificate takes 15–60 minutes to reach ACTIVE, and the HTTPS
proxy is swapped to it immediately — so the API would serve TLS errors for the gap.
**The current certificate is valid until 2026-11-21, so there is no reason to do
this.** That is why the jobs went in with `-target=module.scheduled_jobs`.

Whoever picks this up: decide whether the rename is wanted at all, and if it is, do
it as create-then-swap (add the new cert to the proxy's `ssl_certificates` list,
wait for ACTIVE, then remove the old) rather than a replacement. Do not run a bare
`terraform apply` in this directory until then.

## 2026-09-02 (later) — migration 0035, API 00030, web app. Superseded by the entry above.

The settlements pass (ClickUp `86cbcn1ue`) and four of the five settlement
decisions. One migration, one API revision, one web release.

| | |
|---|---|
| Backup | On-demand **`1788384976208`**, polled to `SUCCESSFUL` before the schema was touched. |
| Database | **35 → 36** rows in `drizzle.__drizzle_migrations`. Migration `0035` adds `deals.commission_mode`. |
| API | **`showme-api-00030-q78`**, serving 100%. Source deploy from `a45a360` on `main`, config untouched. |
| Web app | `showme-app.web.app` — version `25f23e381f7aa79e`, release `1788385608051000`, bundle `index-VebdxXVP.js`. |
| Marketing | Untouched. No marketing change in this work. |

**Verified by real objects, not by the success lines.** The migration was checked
by querying `information_schema` (the column exists) and the data (all three
production deals read `parallel`). The API was checked by reading the SERVED
OpenAPI for `ticket_tier`, `commissionMode` and `cascading` — not the deploy's
output. The web app was checked by fetching the live page, confirming the bundle
name matches the local build byte for byte, and grepping the served JS for the
three strings this work added ("Go to the agreements", "Add ticket type",
"Borne by").

### What 0035 is, and why it could not restate anything

`deals.commission_mode` (`parallel` | `cascading`, NOT NULL, default `parallel`)
— how several disclosed commissions on one deal compose. `parallel` is what
`applyCommissions` always did, so the default reproduces every figure the engine
had already settled. Every production deal today carries one commission or none,
and the two modes agree on a single cut, so no settlement could move even if the
default had been wrong. Additive column, no backfill, no drop.

### The one behaviour change that DOES move money

An agent's representation commission is now taken on the **gross** entitlement
(`entitlement + deductibles`) rather than after deductibles — our code had been
contradicting our own `SKILL.md`, and its own header claimed gross while reading
net. On the worked example a venue-fronted 1 000 hotel moved the agent's 15% cut
from 1 350 to 1 500. **Not yet ratified by the product owner**: ClickUp
`86cba8wtb` is `in review` with a comment asking him to confirm the commercial
term. Safe to be live meanwhile because production has three deals and six
internal profiles — no real agent is affected — but it should not stay unratified
once there are.

### FIREBASE-TOOLS WAS DEAD, AND HOSTING WAS DEPLOYED WITHOUT IT

The CLI credential was expired (`Authentication Error: Your credentials are no
longer valid`), and it could not be refreshed from an agent shell: `firebase
login:add` **refuses a non-interactive terminal outright**, and it will not run
under a pseudo-terminal either (`script` fails with `tcgetattr/ioctl: Operation
not supported on socket`). `GOOGLE_APPLICATION_CREDENTIALS` does not help —
firebase-tools wants its own stored login or a service-account key, not user ADC.

**The way through is the Hosting REST API with a gcloud token**, which needs no
Firebase login at all:

```bash
TOKEN=$(gcloud auth print-access-token)
# The quota-project header is REQUIRED on the ADC path — without it every call
# 403s with SERVICE_DISABLED, which reads like the API is off when it is not.
curl -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: music-showme" \
  https://firebasehosting.googleapis.com/v1beta1/projects/music-showme/sites
```

Then the same five steps the CLI performs: create a version carrying the
`firebase.json` config, `:populateFiles` with the SHA256 of each **gzipped**
file, upload only the hashes the server asks for, `PATCH …?update_mask=status`
to `FINALIZED`, then `POST …/releases?versionName=…`. The script is committed as
`scripts/hosting-deploy.mjs` — run it with `HOSTING_TOKEN=$(gcloud auth
print-access-token) node scripts/hosting-deploy.mjs` after building. Only 3 of 23 files uploaded — Hosting's
store is content-addressed, so an unchanged asset is never re-sent.

**The CLI login is still expired.** It was bypassed, not fixed. Use
`firebase login:add --no-localhost` from a real terminal — `login:add`, not
`--reauth`, because `--reauth` replaces the stored account and the **gmail**
account owns the live marketing site.

## 2026-09-01/02 — migration 0034, API 00029, both sites. Superseded by the entry above.

Six API revisions went out in one session. Each is listed because the *reason*
matters more than the number when something later looks wrong.

| Revision | What it carried |
|---|---|
| `00022-lj4` | migrations 0032–0033: the GDPR stub purge, the OTP claim, calendar↔tasks, invite credits |
| `00023-dks` | **stopped publishing the hours of somebody's day** — `busyTimes` removed from the public availability payload |
| `00024-z7n` | migration 0034: shoWMe shows push out to the user's own Google calendar (gated off) |
| `00025-jzd` | the app-calendar push no longer 403s and mis-reports it as a revoked grant |
| `00026-qbw` | seats are counted, and `editor` costs one |
| `00027-gsv` | seats reported on `cap-status`, so the ceiling is visible before it is hit |
| `00028-7pj` | **free operators get unlimited events** — the code enforced a cap of 3 while the live pricing page advertised "Unlimited events" |
| `00029-4vd` | the last two pricing promises enforced: **2 templates** on free, **one profile per free account** |

**Database: 35 rows** in `drizzle.__drizzle_migrations` (through 0034). Backups
`1788252441485` and `1788256506985` taken before 0032–0033 and 0034 respectively.
Verified by real objects each time: `event_participants.display_name` +
nullable `profile_id`, `invitation_otps`, `profiles_unclaimed_created_idx`,
`calendar_connections.app_calendar_id`.

**Web app** `showme-app.web.app` on `music-showme` — bundle `index-BaaOHEQs.js`,
matched against the local build. **Marketing** `www.showme.music` on the **gmail
account's** `showme-production` — redeployed for the privacy policy's new section
9 (connected calendars), which the OAuth verification submission depends on. Both
verified live afterwards, not from the deploy's success line.

### Two things a later session must not re-learn the hard way

**`claimed_at IS NULL` does not mean "unclaimed stub".** `POST /profiles` has
never written that column — it is stamped only by the two claim paths. All six
production profiles carry a null there, including both of Ran's. The first
version of the GDPR purge would have hard-deleted every account on the platform
as it turned ninety days old. The real test is whether any `profile_members` row
carries a `user_id`. See `packages/db/src/stub-purge.ts`.

**Nothing in `apps/jobs` has ever run in production.** `prod-showme` has exactly
one Cloud Run service, `showme-api`, and the Cloud Scheduler API is not enabled
on the project at all. So the offer expiry, handoff expiry, share revocation,
task reminders, exchange-rate refresh **and the new GDPR purge** are all written,
tested, and not happening. Standing the runner up is a Terraform change.

### The entitlement layer was reconciled against the live pricing page (00028)
Three divergences. **Fixed:** Basic advertised "Unlimited events" and the code
capped free operators at three confirmed-or-concluded shows a year — a 403
contradicting the page the customer signed up from. `FREE_OPERATOR_EVENT_LIMIT`
is now `null`, with the counting machinery intact so a number is one line.

**Matching, checked:** Basic's one seat, Pro's two seats plus purchased extras,
Performer's 50 offers a month, Agent's unlimited offers.

**Now also enforced (00029):** "2 templates" on free / unlimited on Pro, and
"One profile per account" on a free plan. These ADD restrictions, which was safe
only because production has no real users — six profiles, all internal. Note that
PLAN.md:564 and the pricing page agree rather than conflict: PLAN removed the old
16-profile limit as a JWT artifact and said any real cap "would be a deliberate
plan/entitlement rule", which is exactly what the page supplies.

### Google Calendar is still Internal
`orgInternalOnly: true` on the `prod-showme` consent screen, so only
`@showme.music` accounts can connect one — production has **zero**
`calendar_connections` rows, which is what that predicts. The outbound push is
gated behind `GOOGLE_APP_CALENDAR_ENABLED` (unset) and stays inert until an
External client is verified. ClickUp `86cbcet5w` carries the submission pack.

## 2026-09-01 (earlier) — migrations 0032–0033, API 00022, web app. Superseded by the entry above.

| | |
|---|---|
| Backup | On-demand **`1788252441485`**, polled to SUCCESSFUL before anything ran. |
| Database | **32 → 34** rows in `drizzle.__drizzle_migrations` (0032, 0033). Verified per-migration by real objects: `event_participants.profile_id` is now nullable and `display_name` exists, `invitation_otps` exists, `profiles_unclaimed_created_idx` is present. |
| Data after | 6 profiles, 0 name-only participants (nothing has been purged and nothing should have been). |
| API | **`showme-api-00022-lj4`**, serving 100%. Image-only deploy, so the existing secrets and env are untouched. |
| Web app | `showme-app.web.app` on `music-showme` — served bundle `index-BaaOHEQs.js` matches the local build byte for byte. |
| Marketing | **Untouched.** Still 200. Different project, different account. |

**Verified by behaviour, not by the deploy's success line.** The served OpenAPI
carries `POST /api/v1/invitations/{token}/claim-otp`, a route that exists only in
this build — that single fact proves the new revision is the one answering, which
is the check the 00019 incident above exists to enforce. Also confirmed on the
live spec: `participants.profileId` is `nullable: true` (migration 0032), and the
calendar item carries `taskId` and `completed`. `/api/v1/events` is still 401
unauthenticated.

### The thing this deploy caught, and it was nearly a catastrophe

The 90-day stub purge keyed on `claimed_at IS NULL`. **That is not what an
unclaimed stub is.** `POST /profiles` — the ordinary path, where a signed-in
person creates their own profile — has never written that column; it is stamped
only by the two CLAIM paths. So a null there means "nobody ever had cause to set
this", which is true of **every real account ever created**.

Checked against production before the reaper had run anywhere: **all six profiles
carry `claimed_at = NULL`, including both of Ran's**, and every one has a
`profile_members` row pointing at a real user. Under the first version of the
query each would have become a hard-delete candidate the day it turned ninety
days old.

Fixed by requiring that no `profile_members` row carries a `user_id` — which is
what actually distinguishes a stub, since `createPerformerStub` writes its
membership with `user_id: null` and the invitee's email. The regression test was
confirmed to FAIL against the old query before being committed.

**The unit tests were green the whole time**, because they seeded stubs the way
the query imagined them. One more entry for the CLAUDE.md list.

### And the purge cannot run in production yet, by an unrelated gap

`gcloud run services list` on `prod-showme` returns **exactly one service:
`showme-api`**. There is no jobs service and no stream service, and the **Cloud
Scheduler API is not enabled on the project at all**. So nothing in `apps/jobs`
has ever run in production — not the offer expiry, not the handoff expiry, not
share revocation, not task reminders, not the exchange-rate refresh, and not the
new purge.

That is why the bug above was latent rather than live. It also means the 90-day
GDPR deletion is written, tested and **still not happening in production**.
Standing up the jobs runner is a Terraform change (`infra/*.tf`), deliberately not
done by hand here.

## 2026-09-01 — migrations 0027–0031, API 00021, web app. superseded by the entry above.

| | |
|---|---|
| Backup | On-demand **`1788244448191`**, polled to SUCCESSFUL before anything ran. |
| Database | **27 → 32** rows in `drizzle.__drizzle_migrations` (0027–0031). 32 files on disk, 32 applied. Verified per-migration, not by the success line: `task_reminders` dropped, `stages.capacity_setups` added, `deals.status` present, `booking_requests.wanted_date` NOT NULL with `read_at` + `read_by_user_id`. |
| Data after | 9 events, 6 profiles, 4 settlements, 3 stages, 2 notifications, 0 deals, 0 booking_requests. |
| API | **`showme-api-00021-9h4`**, serving 100%. Six secrets bound, `MAPBOX_ACCESS_TOKEN` newly among them. |
| Web app | `showme-app.web.app` on `music-showme` — live bundle hash matched the local build. |
| Marketing | **Untouched**, deliberately. Still 200. Different project, different account. |

**Migration 0031 refused to run at first, by design** — two dateless
`booking_requests` (both Ran's tests, both terminal, the only two rows). Deleted
in a transaction scoped to `dateless AND terminal AND public_form`. Zero inbound
FKs, so nothing cascaded.

**A 500 was introduced and fixed the same hour.** `GET /public/profiles/:slug`
threw "The default Firebase app does not exist" — `initializeApp()` had been a
side effect of verifying a token, so a PUBLIC route left Firebase uninitialised
and the storage signer failed. Fixed in `lib/firebase-app.ts`.

> **THE VERIFICATION TRAP, and it nearly hid that bug.** Immediately after
> deploying revision 00019 the route returned **200** — from a warm instance of
> the PREVIOUS revision, still serving during the traffic shift. Rolling back to
> 00019 reproduced the 500. **Wait for the rollout to settle, or confirm which
> revision answered, before believing a post-deploy check.**

**And `update-traffic --to-revisions` PINS traffic.** After a rollback, every
later deploy lands at 0% until `update-traffic --to-latest` releases the pin —
the deploy "succeeds" and changes nothing.

**Secrets are granted PER-SECRET here**, not project-wide: a new secret needs its
own `secretAccessor` binding for `680839076083-compute@developer.gserviceaccount.com`
or the revision fails at startup. Wire with `--update-secrets`; `--set-secrets`
replaces the whole set and would drop `DATABASE_URL`.

## 2026-08-27 — the domain move is STAGED, waiting on three DNS records

`www.showme.music` and `showme.music` are now claimed on **`music-showme`**
(daniel) as well as on **`showme-production`** (gmail). Firebase allows both
claims to exist; the new one sits at `ownershipState: OWNERSHIP_MISMATCH` and
serves nothing. **The live site is unaffected** — verified 200 / 301 after
staking both claims.

**This ordering is the point.** The obvious sequence — release the domain on the
old project, then add it to the new one — takes the site down for however long the
new certificate takes. Staging the claim first inverts it: DNS flips ownership,
the cert attaches, and the old claim is deleted last as cleanup. No window.

### The three records, read from Firebase's own `requiredDnsUpdates`

At GoDaddy, where this domain's DNS lives:

| Host | Action | Type | Value |
|---|---|---|---|
| `www` | **change** | CNAME | `showme-production.web.app` → **`music-showme.web.app`** |
| `@` | **remove** | TXT | `hosting-site=showme-production` |
| `@` | **add** | TXT | `hosting-site=music-showme` |

**The apex A record does not change** — it stays `199.36.158.100`. Every other TXT
on the apex is untouched: the Microsoft 365 record, the Brevo code, the Google
site verification, and SPF. Firebase listed them all as KEEP; do not tidy them.

**A correction worth keeping.** It was reasoned here first that no DNS change
would be needed at all, because `showme-production.web.app`, `music-showme.web.app`
and `showme-app.web.app` all resolve to the same anycast IP (199.36.158.100), so
Firebase must be routing by Host header. The IPs are shared and the routing is by
Host — but ownership is proven by the CNAME TARGET and the `hosting-site=` TXT, not
by where the packets land. Firebase's API says so directly. The shared IP is why
the A record can stay, and nothing more.

### Two certificates, two systems — they are not the same one

Asked in this session, and worth settling here because the names look alike:

| Hostname | Certificate | Where it lives | Status |
|---|---|---|---|
| `api.showme.music` | `showme-api-lb-cert` | **GCP**, a classic Google-managed compute cert on `showme-api-lb-https-proxy`, in front of the LB at `136.68.249.165` → Cloud Run | `ACTIVE` |
| `www.showme.music`, `showme.music` | Firebase Hosting `PROJECT_GROUPED` cert | **Firebase**, per hosting project. Not a compute resource, so it never appears in `gcloud compute ssl-certificates list` | `CERT_ACTIVE`, expires 2026-10-02 |

The one hand-made in GCP covers `api.showme.music` **only** — that is the cert the
`infra/modules/api-load-balancer` module provisions, and it is why the API can be
served over HTTPS at all in europe-north2 (no Cloud Run domain mappings there).

**The domain move does not touch it.** `api.showme.music` points at the load
balancer, not at Firebase, so it keeps working throughout — only `www` and the
apex change hands.

(Certificate Manager is not enabled on `prod-showme`; the classic compute cert is
the one in play.)

### After DNS propagates
1. Confirm `ownershipState: OWNERSHIP_ACTIVE` and `cert.state: CERT_ACTIVE` on the
   new claims, and that `https://www.showme.music` serves the `music-showme` site.
2. **Then** delete the two custom domains on `showme-production` (gmail). Last, not
   first.
3. The staged claims are harmless if this is abandoned — delete them from
   `music-showme` and nothing changes.

```bash
# Read either project's claims (needs the matching account's token):
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: music-showme" \
  "https://firebasehosting.googleapis.com/v1beta1/projects/music-showme/sites/music-showme/customDomains" | jq
```

## 2026-08-27 (late) — the marketing site is now on BOTH accounts, and a web-app incident

### The mirror, for the domain move
`music-showme.web.app` (**daniel@showme.music**) now serves the same marketing
build as `www.showme.music` (gmail `showme-production`), from the same
`firebase.json` block: `.firebaserc` gives the **`marketing` target a different
site per project**, so one config deploys to both. Verified identical on the
mirror: `/`, `/profile/<slug>`, `/event/<id>`, `/about`, and the
`/profile.html?slug=…` → `/profile?slug=…` 301 with the query intact.

### INCIDENT: the emulator build went live on `showme-app.web.app`

For roughly ten minutes the production web app was serving a bundle built for the
**Firebase emulator** — `projectId: "demo-showme"`, auth pointed at
`127.0.0.1:9099`. Nobody could have signed in.

**Cause.** `pnpm test:e2e` builds `apps/web` with emulator configuration
(`scripts/stack.mjs` → `webEmulatorEnv`) into **`apps/web/dist`** — the same
directory a hosting deploy uploads. The order was: `pnpm build` (correct bundle) →
`pnpm test:e2e` (overwrote it) → `firebase deploy` (shipped the overwrite).

**Nothing failed.** The build was green, the tests were green, the deploy reported
success, and the served page looked right. The only evidence was the string
`demo-showme` inside the served JavaScript.

**Fixed** by rebuilding and redeploying (`index-DMw1ZOAE.js`), then proving it
rather than reading it: from the live page, a deliberately-wrong sign-in against
the baked-in API key answered `INVALID_LOGIN_CREDENTIALS` — a real Firebase
project replying, where the emulator build would have failed to connect at all.

**Made impossible** rather than unlikely: the e2e build now goes to
**`dist-e2e`** (`apps/web/playwright.config.ts`, gitignored). Re-ran the suite to
confirm — 40 passed, `dist` still held `music-showme`, `dist-e2e` held
`demo-showme`.

**If you deploy the web app by hand, check the bundle before trusting it:**

```bash
grep -o 'projectId:"[^"]*"' apps/web/dist/assets/index-*.js   # must be music-showme
```

### Still wrong on the live marketing site (pre-existing, not from this deploy)
Every page carries `<link rel="canonical" href="https://showme.example/">` and
`robots.txt` points its sitemap at the same placeholder — 44 occurrences across 8
files, with the TODO still in the file. It is on `www.showme.music` right now.
The right value depends on where the domain lands, so it is left for the transfer.

## 2026-08-27 (afternoon) — migration 0026, API 00017, web app, **and the marketing site**

The public profile rebuild, the show poster, and the readable public URLs. First
marketing deploy since 2026-08-23, so that site carries more than this change.

| | |
|---|---|
| Backup | On-demand `1787836137294` ("pre-0026 show poster"), **polled to SUCCESSFUL before the migration ran**. |
| Database | **26 → 27** rows in `drizzle.__drizzle_migrations` (0026). Data identical after: 5 users, 8 events, 6 profiles, 3 settlements. |
| API | Cloud Run `showme-api` rev **`00017-g5c`** (was `00016-n4d`), europe-north2. |
| Web app | `showme-app.web.app`, bundle **`index-CWwfnOX7.js`** (was `index-BDuZ3r-r.js`). |
| Marketing | `www.showme.music` (**gmail account**, `showme-production`) — redeployed, with `cleanUrls` + the `/profile/**` and `/event/**` rewrites. |

**The table above was wrong before this session and is worth reading twice.** It
said production was at 25 applied migrations; `__drizzle_migrations` held **26
rows**, which is migrations 0000–0025 — the same off-by-one the entry below warns
about, made again. The rows are zero-indexed and the count is not the number of
the last migration. Reading the table first is what kept 0026 from being applied
twice or skipped.

Verified by real objects and by behaviour, not by the deploy's own success line:

- `events.image_file_id` + `image_url` exist and are nullable (**0026**).
- A REAL published event answers `/public/events/:id` with the `imageUrl` key
  (`1d4b66c0…`, "Ran Nir"). That single response proves both halves at once: the
  new build is serving, and the migration landed — the route SELECTs the column,
  so an unmigrated database would 500 rather than answer.
- `https://www.showme.music/profile/ran-nir` renders (its "Profile not found"
  state — see below), `/event/<id>` renders the show, `/about` resolves without
  `.html`.
- **The old address still lands**: `/profile.html?slug=ran-nir` → `301` to
  `/profile?slug=ran-nir`. The QUERY survives the cleanUrls redirect, which is the
  only reason every link already sent to anyone still works. Checked on the raw
  `location` header, because curl's `%{redirect_url}` prints the path without it
  and reads like a bug.

**Nothing is published in production**, so the profile page cannot be seen with
real content: all 6 profiles have `is_public = false`. The page is correct — it
renders the honest "does not exist, or its owner has not published it" state.
Flip `is_public` on one profile to see the design against real data.

Connected through the Cloud SQL Auth Proxy again, but with `--token $(gcloud auth
print-access-token)` rather than Application Default Credentials: ADC had expired
into `invalid_grant / reauth related error (invalid_rapt)`, which surfaces as a
bare `ECONNRESET` at the client and looks like a network fault. The user account's
own token was still valid. The proxy was killed afterwards.

## 2026-08-27 — migrations 0022–0024 applied. **Code NOT deployed.**

Database only. The API and web app are still serving the 2026-08-26 build, so
production is currently running **older code against a newer schema** — which is
the safe direction (every one of these migrations only adds), but it means the
features behind them are live in the database and absent from the app.

| | |
|---|---|
| Backup | On-demand `99d8a0d0-7c46-43b4-a5f5-533d00000061` ("pre-0022-0024 settlement advance + delivery"), **verified DONE with no error before any migration ran**. |
| Database | **22 → 25** applied rows in `drizzle.__drizzle_migrations`. Data intact after: 5 users, 6 events, 6 profiles, 3 settlements — identical to before. |
| API | **unchanged**, rev `00015-2kp`. |
| Web app | **unchanged**. |

Verified by their real objects rather than by the migration names or by
drizzle-kit's success line:

- `budget_snapshots` table now exists (**0024**) — the settlement compute route
  writes to it on every run, so this was the one that would have broken
  settlement had the code shipped first.
- `profiles.avatar_file_id` (**0022**) — `profile_media` already existed and is
  only altered by that migration, so the table's presence proved nothing; the new
  column is the real test.
- `performance_reports.filed_at` + `pro_name` (**0023**). These are `NOT NULL`
  with no default, which would have failed against a populated table — the table
  held **0 rows**, checked before running rather than after.

Connected through the Cloud SQL Auth Proxy (`cloud-sql-proxy --port 5439`), not by
adding a laptop to the instance's authorized networks — the proxy leaves no
standing hole behind it.

## 2026-08-26 (evening) — 26 commits, migrations 0017–0021, API 00015, web app

Deployed from `main` at `6eaeb6a`, after lint 0 / typecheck 0 / build 0,
`apps/api` **796 passed / 49 files**, `@showme/shared` 149, settlement 34, and
web e2e **34 passed** — every count read off the summary line, never an exit code
through a pipe.

| | |
|---|---|
| Backup | On-demand `1787764227414` ("before migrations 0012-0021"), **verified SUCCESSFUL before any migration ran**. |
| Database | **17 → 22** applied migrations. Data intact after: 5 users, 5 events, 5 profiles. |
| API | Cloud Run `showme-api` rev **`00015-2kp`** (was `00014-qsj`), europe-north2. |
| Web app | `showme-app.web.app`, bundle **`index-D4KSa8no.js`** (was `index-2JNI8cFe.js`). |
| Marketing | **NOT redeployed.** It lives on the gmail account (`showme-production`) and nothing in these commits touched it. |

**CORRECTION to the section below: production was NOT at 0011.** It was at **0016** —
`__drizzle_migrations` held 17 rows, and the backup history (`pre-0015 budget
planning assumptions`, `pre-0016 venue rooms`) says a session on the same day had
already applied them without updating this file. Only **0017–0021** were pending.
Reading the table first is what stopped ten migrations being re-run blind; the
lesson is that this file is a claim, and `__drizzle_migrations` is the fact.

Applied and verified by their real objects, not by guessed table names:
`settlement_comments.section` (0017) · `performing_rights_rates` (0018) ·
`budget_lines.attributed_deal_id` (0019) · `event_participants.archived_at` +
`archived_by` (0020) · `share_otps.rate_window_start` + `issues` (0021).

**Smoke-tested after deploy**: `/api/v1/events` 401 with no token and 401 with a
bad one; `/api/v1/profiles/:id/stages` **401 rather than 404**, which is what proves
the running build is the new one and not the stale revision; CORS preflight **204**
from `https://showme-app.web.app` against the origin the bundle actually calls
(`showme-api-680839076083.europe-north2.run.app` — the direct Cloud Run URL that
`apps/web/.env.production` sets, *not* `api.showme.music`), returning a matching
`access-control-allow-origin` and an `access-control-allow-headers` carrying
`authorization`. The live bundle hash was confirmed to match the one just built.

**The Cloud SQL proxy authenticates with Application Default Credentials**, which
`gcloud auth login` does NOT refresh — it failed with `invalid_rapt` until
`gcloud auth application-default login` was run separately. Firebase is a third,
independent login. Budget for all three.

## 2026-08-26 — the big deploy (migrations 0007–0011, API 00008, web app)

Everything below was deployed from `main` at `04dfd16`, after 528 API tests and
34/34 web e2e passed against current code and the rewritten seed.

| | |
|---|---|
| Database | Cloud SQL `showme-production-db` moved **0006 → 0011**. On-demand backup `1787716371559` taken first ("before migrations 0007-0011"), verified SUCCESSFUL before applying. |
| API | Cloud Run `showme-api` rev **`00008-5kp`**, europe-north2. |
| Web app | `showme-app.web.app`, bundle **`index-2JNI8cFe.js`** (was `index-scfLaoqh.js`). |
| Marketing | **Deployed** to `showme-production` / `www.showme.music`, including three new public pages: `availability.html`, `event.html`, `profile.html`. |

The marketing target lives on the **gmail** account (`daniel.islandman@gmail.com`)
while everything else runs as `daniel@showme.music`. It was deployed with
`firebase deploy --account daniel.islandman@gmail.com`, which uses that identity
for the one command WITHOUT switching the CLI's default — verified afterwards
that the active account is still `daniel@showme.music`. Use that flag rather
than `login:use`, or the next deploy silently goes out as the wrong identity.

Verified live: all four URLs 200, the availability bundle really does carry the
deployed API origin, and the API answers a preflight from
`https://www.showme.music` with a matching `access-control-allow-origin`. The
three new pages are lean — 5–12 kB each — because none of them pulls in the
141 kB landing bundle.

**Data at risk was negligible and was checked before migrating**: 1 user, 1
profile, 1 event, and zero deals, deal parties, messages or calendar items — so
0007's jsonb key rename and 0008's thread backfill touched no rows. Verified
after: 12 migrations applied, all five new objects present
(`calendar_items.external_id`, `.blocks_availability`,
`event_messages.thread_participant_id`, `venue_details`,
`external_calendar_mirrors`, and `calendar_item_type` carrying `external`), and
the user and event still there.

**New secrets** in Secret Manager, all granted to the runtime service account
`680839076083-compute@developer.gserviceaccount.com`:
`BREVO_API_KEY`, `BREVO_SENDER` (`no-reply@showme-google.se`), and
`SHARE_JWT_SECRET` — the last was never set, which meant off-platform share
tokens had nothing to sign with. It was generated fresh; that is safe only
because no share exists in prod yet, and rotating it later invalidates live
share links.

**New env on the service**: `PUBLIC_APP_BASE_URL=https://showme-app.web.app`.
Without it every link in every email points at `localhost:5174`.
`LEADS_ALLOWED_ORIGINS` and `CORS_ALLOWED_ORIGINS` both gained
`showme-app.web.app` and `music-showme.web.app`, because the triage work put an
**origin guard** on `POST /booking-requests` and the public availability form
403s from any origin not listed.

**Smoke-tested after deploy**: `/health` 200; `/events/:id/message-threads`
returns 401 rather than 404, proving the build is current rather than the stale
one that served all night; and the origin guard returns 403 for a request with
no Origin.

**Still not deployed**: the marketing site (gmail account, needs a decision);
`apps/stream`, so `VITE_STREAM_URL` stays blank and realtime is still off; and
the reaper jobs — `infra/modules/scheduled-jobs` is written but never applied,
so no reaper runs in production and that drift keeps accumulating.

## Live

| What | Where | Notes |
|---|---|---|
| **Marketing** | `www.showme.music` — Firebase Hosting, **gmail** `showme-production` | Current as of 2026-08-23 (`main-9dPoRdKk.js`). Deploys need the **gmail** account — `daniel@showme.music` gets 403 |
| **Marketing mirror** | `music-showme.web.app` — `music-showme` | Preview of the 2026-08-23 fixes. Do **not** overwrite; the web app has its own site |
| **Web app** | `showme-app.web.app` — `music-showme`, site `showme-app` | Bundle `index-scfLaoqh.js` (2026-08-24, third deploy, from `eef8b1a`). Adds the create-event hardening and the collaborators card layout. Carries the P3 fixes, the per-kind sidebar and server-side list filtering. Auth on `music-showme` |
| **API** | Cloud Run `showme-api`, europe-north2, `prod-showme` | Revision `00007-b4k` (2026-08-24) from `683001c`. Verifies tokens against **`music-showme`** — see 1c |
| **Cloud SQL** | `showme-production-db`, europe-north2, `prod-showme` | `db-custom-1-3840`. Schema at migration **`0006`**; **1 user / 1 profile / 1 draft event** (0 deals, 0 booking requests) |
| **HTTPS load balancer** | `prod-showme` | Provisioned, **no DNS record** — carrying zero traffic and still billing |

Deploy the web app with:

```bash
pnpm --filter @showme/web build          # reads apps/web/.env.production
npx firebase deploy --only hosting:web --project music-showme
```

## The 2026-08-24 release (P3 audit fixes + reachability)

Migrations `0004`→`0006` then the image, in that order — the reverse would have served
routes for a schema that did not exist yet (`setlist_shares`, `booking_requests.on_behalf_of_profile_id`).

1. **On-demand backup first.** The instance is no longer empty: it holds 1 user, 1 profile and
   1 draft event, so `0005` (which drops and recreates the `deal_type` enum) ran against real
   rows. It was safe — 0 deals, 0 booking requests, no row carrying `custom` — but that was
   *checked*, not assumed, and a backup was taken before touching it.
2. **Migrate** through the Cloud SQL proxy (`cloud-sql-proxy --port 55433 …`), rewriting the
   secret's unix-socket URL onto the TCP port. Applied 4 → 7. Verified after: `deal_type` is the
   four-value vocabulary, `setlist_shares` exists, the offer column exists, the pending-offer
   dedup index names the act, and all three row counts are unchanged.
3. **Deploy the API** — `gcloud run deploy showme-api --source .` (Cloud Build). No env or secret
   flags: an image-only deploy keeps the service's existing configuration.
4. **Deploy the web app** — build, then `firebase deploy --only hosting:web --project music-showme`.

Verified against production afterwards: health OK; the OpenAPI document carries the setlist-share
routes, the four-value deal type, the array-valued `status` filter and the offer identity fields;
the one draft event is a **404** on its public page (A-22) and the events list is **401**
unauthenticated; the served bundle hash matches the local build; the app loads with zero console
errors; and a CORS preflight from `https://showme-app.web.app` is allowed *with* `x-profile-id`
while an unknown origin gets no allow-origin header.

**Not verified in production: any signed-in flow.** The seeded accounts are emulator-only and the
single real account's password is the owner's, so everything past the sign-in screen was verified
locally (see `docs/audit-2026-08-23.md`) and by contract in production, not by logging in there.

### Deleting a Firebase Auth user from the command line

Needed after any throwaway account made against the live app. `firebase-admin` with
Application Default Credentials calls Identity Toolkit against the ADC's **quota
project**, which is `prod-showme` — where that API is disabled — so it fails with a
confusing `SERVICE_DISABLED` about the wrong project even though Auth lives on
`music-showme`. Name the quota project for the call instead of enabling an API you
do not want:

```bash
GOOGLE_CLOUD_QUOTA_PROJECT=music-showme GCLOUD_PROJECT=music-showme node delete-user.mjs
```

The Postgres side is separate: `profile_members` → `profiles` → `audit_log` → `users`,
in that order (foreign keys), or the delete fails half-done.

## Follow-ups

### 1. ~~API on old code~~ — DONE 2026-08-23

Migration `0003` applied to production (4 applied, `booking_requests.currency` exists),
then the new image deployed as revision `showme-api-00005-7zr` from `e7bbc8b`. In that
order — the reverse would have broken every booking-request insert.

Verified after: health OK, `artistFee` + `currency` in the live OpenAPI, both CORS
origins still allowed, the marketing lead form still returns `{"ok":true}`, and an
insert including `currency` reaches the FK check (so the column accepts writes).

**Running a migration locally** needs a TCP tunnel — the `DATABASE_URL` secret uses a
Unix socket path that only resolves inside Cloud Run:

```bash
cloud-sql-proxy --port 55433 prod-showme:europe-north2:showme-production-db
# rebuild the URL as postgresql://postgres:<password>@127.0.0.1:55433/showme
DATABASE_URL=… pnpm --filter @showme/db exec drizzle-kit migrate
```

The proxy authenticates with **Application Default Credentials**, not the gcloud CLI
credentials — they expire separately and need `gcloud auth application-default login`
(browser). Note that overwrites the Firebase-admin impersonation ADC local API dev uses
for Storage signing; backup at
`~/.config/gcloud/application_default_credentials.firebase-impersonation.bak.json`.

### 1b. The API has no logs

`buildApp` sets `logger: false` (`apps/api/src/app.ts`), so `request.log.*` writes
nowhere — including every best-effort notification catch block. In production this means
a 500 arrives in Cloud Run logging with an **empty payload** and no diagnosable cause;
during this deploy a 500 had to be diagnosed by reproducing the query against the
database instead. It also hid an FK bug in the notification path for hours. Turning the
logger on is a small change with a large payoff.

### 1c. Cross-project auth — the API must be told which project issues tokens

Auth lives on **`music-showme`**; the API runs on **`prod-showme`**. `firebase-admin`
infers its project from the runtime when `FIREBASE_PROJECT_ID` is unset, so it inferred
`prod-showme`, and `verifyIdToken` rejected every `music-showme` token on the audience
check — surfacing as **"Invalid or expired token"** on sign-in. Fixed by setting
`FIREBASE_PROJECT_ID=music-showme` on the Cloud Run service (revision `00006`).

Verified with a real token: minted a custom token for the signed-in user, exchanged it
via `accounts:signInWithCustomToken`, and called the live API. The error moved from
"Invalid or expired token" to "No provisioned account for this identity" — i.e. the
token now verifies and only the Postgres account is missing, which is the onboarding
path (`POST /auth/session` returns 400 "needs a `kind`", which `AuthProvider` maps to
the onboarding flow).

**A new Hosting site is not automatically an authorized Auth domain.** `showme-app.web.app`
had to be added to Identity Platform's `authorizedDomains`, or Google sign-in fails with
`auth/unauthorized-domain`. Adding a domain later (e.g. `app.showme.music`) needs the same
step:

```bash
TOKEN=$(gcloud auth print-access-token)
curl -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: music-showme" \
  https://identitytoolkit.googleapis.com/admin/v2/projects/music-showme/config
# then PATCH ?updateMask=authorizedDomains with the full list plus the new domain
```

Note the `x-goog-user-project` header — without it the Identity Toolkit API 403s on
user ADC with a "requires a quota project" error.

### 1d. ~~Marketing production is stale~~ — DONE 2026-08-23

Deployed with the gmail account. Live now: `main-9dPoRdKk.js`, the phone hero-card clip
fix, the desktop chaos→order handoff and the touch scroll-snap — all verified against the
live domain, not the mirror.

The root-`/` `max-age=3600` gap recorded in the 2026-08-23 handoff is **also fixed**: the
old rule matched `*.html`, which never covers the bare root (Firebase serves it as a
directory index). Now a `**` catch-all with the content-hashed bundle re-asserted after it
(last match wins). Verified live: `/`, `/index.html`, `/about.html`, `/contact.html` and
the unhashed scene scripts all `no-cache`; `main-<hash>.js` `immutable`.

To redeploy:

```bash
pnpm --filter @showme/marketing build
npx firebase deploy --only hosting:marketing --project showme-production \
  --account daniel.islandman@gmail.com
```

### 1e. `apps/jobs` has never been deployed — the scheduled work does not run

There are **no Cloud Run Jobs** in `prod-showme`, and the **Cloud Scheduler API is not
even enabled**. So nothing in `apps/jobs` has ever executed in production:

| Job | Consequence of it never running |
|---|---|
| `reapExpiredOffers` | 30-day offers stay `pending` forever |
| `reapExpiredHandoffs` | 90-day venue handoffs never expire |
| `reapExpiredShares` | Share links never expire — the one with a security edge |
| `runExchangeRateRefresh` | `exchange_rate_cache` never refreshes; display FX goes stale |

Note ClickUp has "11 · Exchange-rate refresh scheduler" as **shipped** — that is the code,
not a running schedule. Deploying it needs: enable `cloudscheduler.googleapis.com`, a
Cloud Run Job built from `apps/jobs`, and a Scheduler trigger. None exist.

### 1f. `apps/site` — deleted 2026-08-26

Was a sixth Vite app (`@showme/site`, a TanStack Start spike) that appeared in no deploy
plan. Confirmed abandoned and removed: `firebase.json`/`.firebaserc` ship
`apps/marketing/dist` to the `marketing` target, nothing in `scripts/`, `turbo.json`,
`biome.json` or any tsconfig referenced it, and it had a single commit (`0ad2897`) ever.
Its `test` script (`playwright test`, with no Playwright config) was the reason root
`pnpm test` was red.

It owned three repo-wide `@tanstack/*` overrides in `pnpm-workspace.yaml`. One was
load-bearing for `apps/web` — the override was what held `apps/web`'s floating
`^1.87.0` at `@tanstack/react-router` **1.170.24** — so the pin moved into
`apps/web/package.json` as an exact version. The other two (`router-core` 1.171.20,
`history` 1.162.1) are the exact versions `react-router@1.170.24` already declares, so
they were redundant and went with the app. **A `pnpm install` is required** to drop the
stale `apps/site` importer and the `overrides` block from `pnpm-lock.yaml`.

### 2. Deploy the SSE service

Built, containerised and documented in [deploy-stream.md](./deploy-stream.md) — never
deployed. Nothing breaks without it: `VITE_STREAM_URL` is deliberately blank in
`apps/web/.env.production`, so the app refetches on navigation instead of updating live.

To ship it: create an Artifact Registry repo, build `Dockerfile.stream`, deploy at
`--min-instances 0 --timeout 3600`, then set `VITE_STREAM_URL` to its `run.app` URL and
add that origin to the stream's own `CORS_ALLOWED_ORIGINS`. Do **not** give it a custom
subdomain — europe-north2 has no Cloud Run domain mappings, so that means a second load
balancer costing more than the compute.

### 3. Attach `app.showme.music`

The app is on `.web.app` for now. The domain needs a GoDaddy record plus a Hosting
custom-domain setup on the `showme-app` site, and then the new origin added to the API's
`CORS_ALLOWED_ORIGINS`.

### 4. The idle load balancer

Either DNS-wire `api.showme.music` to it or tear it down. It has been billing for
infrastructure serving no traffic since it was provisioned.

### 5. Verify a real login against the deployed app

Unverified: the seeded `@e2e.showme.test` accounts exist only in the local Auth
emulator, not in `music-showme`. The deployed app boots, renders auth, and reaches the
API cross-origin — but no one has signed in to it yet.

## Hosting header gotcha, in case it bites again

Firebase Hosting matches headers on the **request path**, and **the last matching rule
wins**. A rule on `/index.html` therefore never applies to the bare `/` (a directory
index) nor to SPA routes like `/events` (rewrites keep their original request path). The
web app's config uses a `**` catch-all for the shell and re-asserts `/assets/**` after
it, verified live: shell `no-cache`, hashed bundle `immutable`.

The marketing site still has the un-fixed version of this — its root `/` serves
`max-age=3600`. The same two-rule pattern would fix it.
