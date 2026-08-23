# Handoff — marketing fixes + hosting/domain situation (2026-08-23)

Session snapshot so this can be picked up cold. Two parts: (1) **code fixes** made to the
marketing site (uncommitted, verified, live only on a mirror), and (2) the **hosting /
account / domain reality** that was untangled — with the migration plan to move
`www.showme.music` onto a `daniel@showme.music`-owned project.

---

## 1. Code changes this session — UNCOMMITTED

Four files changed, all in `apps/marketing`. All verified (see each). **Nothing is committed
and nothing is on the real production domain yet** — only on the `music-showme.web.app` mirror.

| File | Change | Scope | Verified |
|---|---|---|---|
| `apps/marketing/src/main.ts` | **Touch scroll-snap** — after native iOS momentum settles, ease to the nearest section start (finish-the-flick), so one flick lands one section instead of stopping ~2/3 in. | `pointer: coarse` only; skips reduced-motion + open menu; desktop wheel/Lenis untouched. | Real iPhone 16 Pro simulator (Mobile Safari), synthetic flicks + on-page HUD: SNAP within ½-screen, SKIP beyond, `lenis.scrollTo` confirmed moving native scroll. |
| `apps/marketing/public/assets/chaos-order.js` | Chaos→order "solution" beat no longer overlaps the card columns: **sequential handoff** (columns hold → clear → solution rises) + **longer ordered-view dwell** (`t 0.44→0.64`). | **Desktop only** (`MOBILE ? original : new`); mobile keeps original simultaneous rise (beats top / cards low never overlapped there). | Chrome desktop, computed opacities at p=0.50/0.60/0.64/0.72: cards 1.0 & solution 0 through the hold, cards 0 & solution 1 after. |
| `apps/marketing/public/assets/hero-scene.js` | Hero mock: the "Velvet Coast · Warehouse 9 / Contract" `.tlcard` was **clipping through** the dashboard (two 3D sibling planes with opposite tilts inside `preserve-3d` intersect). Fix: on phones set `.stage-3d { transform-style: flat }` so cards composite as z-index layers (still perspective-tilted) — card sits cleanly in front. Re-encoded pill z-index (pills > card > dashboard). | `@media (max-width: 600px)` only; desktop 3D untouched. | Chrome @390px: `.tlcard` present + tilted (`matrix3d`) + no clip-through; screenshot confirmed. NOTE: first attempt hid the card with `display:none` — that was WRONG (user wants the card kept); current code keeps it. |
| `firebase.json` | Added Hosting `headers`: `*.html` and the vanilla scene scripts (`hero-scene`, `chaos-order`, `feature-scroll`, `feature-visuals`, `ecosystem-galaxy`, `why-center`) → `Cache-Control: no-cache`. | — | Deployed: `hero-scene.js` returns `no-cache`. **Known gap:** the bare root `/` still returns `max-age=3600` (Firebase directory-index ignores the `*.html` rule; `/index.html` does get `no-cache`). Scene fixes still propagate (stable URL + no-cache); only the hashed main bundle lags ≤1h on repeat root visits. |

**Why the cache header work happened:** unhashed scene scripts (`/assets/hero-scene.js` etc.)
were served `max-age=3600`, so a fix sat behind an hour-old browser cache — the "still clipping
for me" symptom. `no-cache` on those fixes it going forward.

Current marketing build hash: `main-9dPoRdKk.js`.

### TODO for the code
- [ ] **Commit** the four files (branch off `main`; end message with the Co-Authored-By trailer).
- [ ] Decide if the root-`/` `max-age=3600` is worth fixing airtight (would need a source glob
      that matches the directory-index root, or exact-name html rules).

---

## 2. Hosting / account / project reality (the big untangle)

The site and the API are **two independent subsystems on two different Google accounts** — this
was the source of all the confusion.

| Concern | Tech | Project | Account | Networking |
|---|---|---|---|---|
| Marketing site `www.showme.music` | Firebase Hosting (static) | **`showme-production`** (`639849417444`) | **gmail** `daniel.islandman@gmail.com` | none (Firebase CDN) |
| API `api.showme.music` | Cloud Run `showme-api` + external HTTPS LB | **`prod-showme`** (`680839076083`) | **`daniel@showme.music`** | the whole Terraform LB |

**Confirmed empirically:** `showme-production.web.app` and `www.showme.music` return
byte-identical content (same SHA) → the marketing site IS Firebase Hosting on the **gmail**
`showme-production` project. Live channel last released **2026-08-18**, running an OLD build
(`main-D0FfydS8.js`) that predates every fix above.

**Why GCP networking exists even though the site is on Firebase:** the networking is for the
**API, not the site**. `showme-api` is Cloud Run in **europe-north2**, which **does not support
Cloud Run domain mappings (HTTP 501)**. So exposing `api.showme.music` over HTTPS requires a
hand-built external HTTPS Load Balancer (static IP → forwarding rule → HTTPS proxy + managed
cert → URL map → serverless NEG → Cloud Run) — exactly what `infra/modules/api-load-balancer`
provisions. A static marketing site needs none of that. `dig api.showme.music` currently returns
**no A record** → the LB isn't DNS-wired yet, which is why the lead form still posts to the
interim `…run.app` origin.

### Project / account map
- **`daniel@showme.music` owns:** `prod-showme` (`680839076083`, API), `dev-showme`
  (`452202806556`, PR previews — empty), `music-showme` (`1098805934399`, current Firebase
  Auth/Storage; I deployed the marketing mirror here).
- **gmail `daniel.islandman@gmail.com` owns:** `showme-production` (`639849417444`, live
  marketing hosting), `showme-music` (`589625641867`), `showme-ca014` (`970054285288`).
  `daniel@showme.music` gets **403** on all three.
- Billing account `011B8E-E9F108-D608FA` links everything; Google-for-Startups credits apply at
  the billing-account level (shared across projects — consolidating projects does NOT save money).
- `docs/cicd-plan.md` is the intended end-state: **prod on `prod-showme`, previews on
  `dev-showme`, `music-showme` superseded.** Not executed yet.

### What is deployed where (as of 2026-08-23)
- **`www.showme.music`** (real prod, gmail `showme-production`) — **OLD build**, no session fixes.
- **`music-showme.web.app`** (live, `daniel@showme.music`) — **current build WITH all fixes**
  (mirror I deployed at your request). No custom domain; `www.showme.music` untouched.
- Preview channels (all expire **2026-08-30**, ignore/let lapse):
  - `music-showme--preview-m8a8kgos.web.app` (daniel)
  - `music-showme--preview2-4a0zz623.web.app` (daniel)
  - `showme-dev-1d9ce--scroll-snap-fix-2q0lf6md.web.app` (gmail — from an early deploy)

### ClickUp lead flow — safe, no action needed
The form posts to `VITE_LEAD_ENDPOINT` (the API), which forwards to ClickUp server-side. It's
**decoupled from hosting** and baked into the build at build time. Current value (interim):
`https://showme-api-680839076083.europe-north2.run.app/api/v1/public/leads`. Keep it on the
`run.app` origin until the `api.showme.music` LB cert is ACTIVE and DNS-wired; then switch to
`https://api.showme.music/api/v1/public/leads` (see `infra/README.md`). Any host move preserves
ClickUp as long as this endpoint and the API's CORS allowlist (which already includes
`www.showme.music`) are untouched.

---

## 3. Ship the fixes to the REAL site — two options

**Option A — fastest, matches current setup (gmail):** run the documented command from
`infra/README.md`:
```bash
pnpm --filter @showme/marketing build
firebase deploy --only hosting --project showme-production --account daniel.islandman@gmail.com
```
Publishes the fixes to the existing `www.showme.music`. Uses the **gmail** account (that's where
the site is). No domain/DNS changes.

**Option B — move ownership to `daniel@showme.music` (what you asked for).** Migrate the domain
off gmail `showme-production` onto a project you own. **Recommended target: `prod-showme`** (your
real prod project, keeps site + API under one owner) — though the mirror is currently on
`music-showme`, either works.

### Domain migration steps (Option B)
DNS is at **GoDaddy** (`ns09/ns10.domaincontrol.com`). A custom domain attaches to only ONE
Firebase site, currently locked to `showme-production` via `TXT hosting-site=showme-production`.

0. **[gmail console]** `showme-production` → Hosting → **remove** `showme.music` + `www.showme.music`. (Releases the domain. `daniel@showme.music` can't do this — 403.)
1. **[daniel@showme.music console]** target project (`prod-showme` or `music-showme`) → Hosting →
   **Add custom domain** `www.showme.music` (and apex `showme.music`, set to redirect to `www` if
   desired). Firebase shows the TXT verification + A/CNAME records to use.
2. **[GoDaddy DNS]** apply them:
   - `www` CNAME `showme-production.web.app` → **`<target>.web.app`**
   - apex `showme.music` A → Firebase IP the console shows (currently `199.36.158.100`)
   - TXT: replace `hosting-site=showme-production` with the new `hosting-site=<target>` value
   - ⚠️ **DO NOT touch** the other TXT records — SPF (`v=spf1 include:_spf.google.com ~all`),
     `brevo-code:adbfa06a39eccb58311483a5f1e67e48` (email), `google-site-verification=Lpkx…`,
     `NETORGFT17889828.onmicrosoft.com`. Removing them breaks email/verification.
3. Wait for ownership verify + auto SSL cert (~15 min–24 h).
4. Verify: `www.showme.music` serves the new build; submit the lead form → confirm it reaches ClickUp.

**Downtime:** because it's a cross-*project* move, `www.showme.music` may be down for minutes→hours
between release and the new cert issuing. Do it off-peak. (Lower-risk variant: prep step 1 on the
target with no DNS change yet, stage the GoDaddy edit, then flip.)

### TODO for hosting
- [ ] Ship fixes to real prod — Option A now, or as part of Option B.
- [ ] Decide migration target: **`prod-showme`** (recommended) vs `music-showme`.
- [ ] Execute domain migration (needs gmail console for step 0 + GoDaddy access).
- [ ] Later: wire `api.showme.music` LB DNS (A record → LB IP), confirm cert ACTIVE, then switch
      `VITE_LEAD_ENDPOINT` to `https://api.showme.music/...` and (optional) lock Cloud Run ingress.

---

## Account rule reminder
Operate Firebase/gcloud as **`daniel@showme.music`** only; the gmail account was used this session
**only** with explicit per-action approval (to inspect `showme-production` and it's where the live
site is). CLI was restored to `daniel@showme.music` at end of session. `gcloud` token for
`daniel@showme.music` is **expired** — `gcloud auth login` needed before any `gcloud` work.
