# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

### Local Firebase (Firestore, Auth, Functions, Storage)

With **no** `.env` file, `npm run dev` still starts Vite: it uses the Firebase **emulator demo** web config and points Auth/Firestore/Storage/Functions at **localhost** (see `firebase.json`). You still need the **emulator suite** running for sign-in and data (e.g. `npm run dev:local` or a second terminal with `npm run dev:emulators`).

1. From the repo root: `npm run dev:local` (or `./scripts/dev-local.sh`). This builds Cloud Functions once, runs `tsc --watch` in `functions/`, starts the Firebase emulator suite, and runs Vite.
2. Optionally seed demo data once emulators are listening: `npm run seed:workspace`.

Use `.env.local` when you want a **real** Firebase project in dev (set all `VITE_FIREBASE_*` keys) or to override emulator host/port — see `.env.example`.

Use `npm run dev:emulators` if you only need the emulator suite without the web app. The Functions package is described in [`functions/README.md`](functions/README.md).

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
