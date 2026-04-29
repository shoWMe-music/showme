---
name: deploy
description: Deploy the app to Firebase (hosting + functions together). Use when the user asks to deploy, ship, or push live. Enforces the paired-deploy invariant that prevents the SSR/MIME-type regression.
argument-hint: [optional — leave empty for normal deploy; "ssr-only" to resync only the SSR template; "diagnose" to investigate a live MIME error]
---

# /deploy

Deploys the app to Firebase. The default path runs `npm run deploy`, which loads Node 22 via nvm and invokes `firebase deploy --only hosting,functions`. Two predeploy guards (`scripts/require-paired-deploy.mjs`, `scripts/verify-ssr-template.mjs`) enforce the invariant; you do not need to remember it.

## Why this skill exists

The SSR template lives inside the functions bundle and embeds hashed asset filenames (`router-XXXXXX.js`, `entry-client-XXXXXX.js`). Each Vite build produces fresh hashes. If hosting is deployed without functions, the new hashed files land on the CDN but the live `ssrRender` keeps embedding the previous build's hashes — those filenames no longer exist on hosting, so Firebase falls back to `index.html` and the browser fails with:

```
Failed to load module script: Expected a JavaScript-or-Wasm module script
but the server responded with a MIME type of "text/html".
```

This regression has hit production twice. The guards in `firebase.json` predeploy now make it structurally hard to repeat — but never bypass them.

## Step 1 — Sanity check before deploying

Before running the deploy, in parallel:

```sh
git status
git log --oneline -5
```

Confirm with the user that:
- The working tree is in the state they expect (no stray uncommitted changes about to ship — Firebase deploy uses `dist/client` from a fresh build, not git, so uncommitted changes WILL be deployed).
- The latest commit is the intended head.

If there are uncommitted changes the user did not mention, ask before proceeding.

## Step 2 — Run the deploy

```sh
npm run deploy
```

That's it. The script:
1. Loads Node 22 via `nvm use 22`.
2. Runs `firebase deploy --only hosting,functions`.
3. Firebase's hosting predeploy chain runs:
   - `require-paired-deploy.mjs` (aborts if a future invocation drops functions)
   - `npm run build:all` (Vite client + SSR + writes `functions/lib/index.template.html`)
   - `verify-ssr-template.mjs` (verifies template's asset references exist in `dist/client/assets`)
4. Firebase's functions predeploy runs `npm --prefix functions run build`.
5. Both bundles upload atomically.

**Do not** run `firebase deploy --only hosting` directly — the paired-deploy guard will abort it. If it doesn't (e.g. the guard couldn't inspect the parent process), the build still ships safely because the template's hashes match the same dist that hosting is uploading.

## Step 3 — Verify the deploy worked

After deploy completes, give the user the prod URLs to spot-check:
- `https://showme-settle-fast.web.app/` (or the configured domain) — root SPA loads
- `https://showme-settle-fast.web.app/p/<some-public-profile-slug>` — public profile (SSR path)
- `https://showme-settle-fast.web.app/landing` — marketing (SSR path)

Ask the user to open the browser console and confirm there are no module-loading errors. If they see the MIME-type error, jump to the "diagnose" branch below.

## When the user asks to deploy "ssr-only" or "fix the SSR"

If the user reports the MIME-type error in production, the immediate fix is to resync just the SSR template:

```sh
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && firebase deploy --only functions:ssrRender
```

This re-uploads the function bundle (which contains the freshly-built `index.template.html`) without touching hosting. The current hosting assets stay; only the function's stale hash refs get refreshed.

After this, do a normal `npm run deploy` to bring hosting + functions into a known-good paired state.

## When the user asks to "diagnose" a deploy

Walk through these in order:

1. **Browser console error?** If it's `Failed to load module script: ... MIME type of "text/html"`, the function template is referencing assets that don't exist on hosting. Run the ssr-only fix above.

2. **Public profile / event page is blank but no console error?** SSR function may have crashed and fallen back to the SPA shell. Check function logs:
   ```sh
   firebase functions:log --only ssrRender --lines 50
   ```

3. **Wrong content / stale render?** Hosting CDN cache. SSR responses cache with `s-maxage=300` for non-marketing routes. Either wait 5 min or invalidate.

4. **Build itself failed?** Check what the predeploy guard caught:
   - "Hosting deploy without functions detected" — user (or someone) bypassed `npm run deploy`. Re-run with `npm run deploy`.
   - "SSR template references asset files that don't exist" — the build pipeline produced inconsistent output. Run `npm run build:all` cleanly and inspect `functions/lib/index.template.html` vs `dist/client/assets/`.

## Anti-patterns to avoid

- **Never run `firebase deploy --only hosting` alone.** The guard will block it; if it somehow doesn't, the bundle still desyncs. Always pair with functions.
- **Never run `npm run build` followed by `firebase deploy --only hosting`.** Same failure mode.
- **Don't bypass the guards** by editing `firebase.json` "just for one deploy." If the guards are blocking something legitimate, fix the script — don't disable it.
- **Don't `--no-verify` or `--force` your way through.** If the deploy fails, read the guard message and fix the underlying issue.
- **Don't deploy on an unfamiliar branch state.** The deploy uses `dist/client` from a fresh build, which means whatever is on disk gets shipped — including uncommitted changes the user may not want live.

## Cross-reference

- Memory: `feedback_ssr_deploy_pairing.md` (the rule, the why, the past incidents)
- Guards: `scripts/require-paired-deploy.mjs`, `scripts/verify-ssr-template.mjs`
- Firebase config: `firebase.json` (hosting predeploy chain, SSR rewrites for `/p/**`, `/event/**`, marketing routes)
- SSR runtime: `functions/src/ssr.ts` (reads `functions/lib/index.template.html`)
- Build pipeline: `scripts/build-ssr-template.mjs` (writes the template), `package.json#build:all`
