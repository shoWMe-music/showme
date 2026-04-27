# Deployment

## Architecture

- **Public pages** (`/landing`, `/about`, `/pricing`, `/p/**`, `/shared/**`, etc.) — SSR via `ssrRender` Cloud Function
- **Authenticated app** (`/events`, `/calendar`, `/profiles`, etc.) — SPA (`dist/client/index.html`)
- **Static assets** (`/assets/**`) — Firebase Hosting CDN with immutable cache headers
- **Cloud Functions** — `functions/` directory, deployed to `europe-west1`

## Firebase project

| Environment | Project ID           |
|-------------|----------------------|
| Local       | `showme-local`       |
| Production  | `showme-production`  |

## CI/CD Workflows

Three GitHub Actions workflows in `.github/workflows/`. Authentication uses **Workload Identity Federation** (WIF) — no service account keys stored anywhere. GitHub Actions exchanges an OIDC token directly with Google Cloud.

### 1. PR Preview (`firebase-hosting-pull-request.yml`)
- **Trigger:** Every pull request
- **What it does:** Builds and deploys a preview URL, posted as a PR comment
- **Deploys:** Hosting only (preview channel)

### 2. Production Deploy (`firebase-hosting-merge.yml`)
- **Trigger:** Push to `main`
- **What it does:** Full deploy — hosting (live), Cloud Functions, Firestore rules + indexes
- **Deploys:** Everything

### 3. Manual Deploy (`firebase-hosting-deployment.yml`)
- **Trigger:** Manual (Actions tab > "Manual Deploy" > Run workflow)
- **Inputs:** Branch, target (`all` / `hosting` / `functions` / `rules`)
- **Use case:** Hotfixes, deploying a specific branch, deploying only functions or rules

## Google Cloud Setup (already done)

The following has been configured on the `showme-production` project:

### Workload Identity Federation
- **Pool:** `github-actions` (global)
- **Provider:** `github` (OIDC, issuer: `token.actions.githubusercontent.com`)
- **Attribute condition:** `assertion.repository_owner == 'shoWMe-music'` (only repos in this org can authenticate)

### Service account
- **Email:** `firebase-adminsdk-fbsvc@showme-production.iam.gserviceaccount.com`
- **WIF binding:** `shoWMe-music/showme` repo can impersonate this SA
- **IAM roles:**
  - Firebase Hosting Admin
  - Cloud Functions Developer
  - Firebase Rules Admin
  - Service Account User
  - Cloud Datastore Index Admin

### GitHub setup required

The only thing needed on the GitHub side:

1. **Ensure the repo is at** `shoWMe-music/showme` (the WIF provider is locked to this org)
2. **No secrets to add** — authentication is handled via OIDC token exchange
3. **Blaze plan** must be enabled on `showme-production` for Cloud Functions deployment: https://console.firebase.google.com/project/showme-production/usage/details

## Manual Deploy (local)

```bash
# Build everything
npm run build:all
cd functions && npm run build && cd ..

# Deploy to production
firebase deploy --project showme-production

# Or deploy specific targets
firebase deploy --only hosting --project showme-production
firebase deploy --only functions --project showme-production
firebase deploy --only firestore:rules --project showme-production
```

## Local Development

```bash
# Full local setup with emulators
npm run dev:local

# Dev server only (no emulators, hits remote)
npm run dev
```
