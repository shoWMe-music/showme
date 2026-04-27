# AI agent guide (this repo)

Use this file when planning work in Cursor or other agents. It points to **skills** and **in-repo sources of truth**, and summarizes findings from a multi-agent pass (Firebase platform, auth/data layer, toolchain).

## How to run “multiple agents” with skills (Cursor)

- **Parallel background agents:** Use Cursor’s multi-agent UI and give each agent a **narrow charter** (e.g. “Firestore rules only”, “router + auth only”). Paste the **absolute path** to the skill file you want that agent to read first (skills are not always auto-discovered per task).
- **Single agent with skills:** When your environment lists Firebase (or other) skills, instruct: “Read `<path>/SKILL.md` and follow it before changing code.”
- **Attachments:** In Cursor, attach **repo files** (e.g. `firestore.rules`, `src/lib/db.ts`) to the chat so the model does not guess paths.

## Skill paths (Firebase plugin cache)

These paths are typical for Cursor’s Firebase plugin cache; if yours differs, search the machine for `skills/firebase-basics/SKILL.md`.

| Topic | Read first |
| --- | --- |
| Any Firebase CLI / project / troubleshooting | `.../skills/firebase-basics/SKILL.md` |
| Firestore rules, indexes, SDK patterns | `.../skills/firebase-firestore-standard/SKILL.md` |
| Authentication | `.../skills/firebase-auth-basics/SKILL.md` |
| Hosting (not in `firebase.json` yet; use when adding) | `.../skills/firebase-hosting-basics/SKILL.md` |

Example base directory (replace if needed):

`/Users/<you>/.cursor/plugins/cache/cursor-public/firebase/<hash>/skills/`

## Repo map (where to look)

| Concern | Primary files |
| --- | --- |
| Firebase init, emulators, regions | `src/integrations/firebase/` (especially `app.ts`, `config.ts`) |
| Firestore access | `src/lib/db.ts`, `firestore.rules`, `firestore.indexes.json` |
| Auth session | `src/lib/auth-context.tsx`, `src/lib/firebaseAuth.ts`, `src/lib/firebaseAuthErrors.ts` |
| Workspace / events state | `src/lib/event-store.tsx` |
| Routing | `src/router.tsx` (note: no centralized `beforeLoad` auth gate) |
| React Query | `src/App.tsx` (client defaults), `src/lib/queryKeys.ts`, only some pages use `useQuery` |
| Cloud Functions | `functions/src/index.ts`, `functions/package.json`, `firebase.json` `predeploy` |
| Env template | `.env.example` |

## Rules of thumb (from repo audit)

1. **Firebase CLI:** Prefer `npx -y firebase-tools@latest <cmd>` for reproducibility; align `package.json` emulator scripts with that when you touch them.
2. **Regions:** Client `getFunctions(..., "europe-west1")` must match `functions` region.
3. **Emulators:** Ports live in `firebase.json`, `.env.example`, and `src/integrations/firebase/app.ts` / `src/lib/firebaseAuth.ts` — keep them consistent.
4. **`db.ts`:** Many APIs take explicit `ownerUid` for cross-tenant flows; changing signatures requires updating all callers.
5. **`event-store.tsx`:** Some ordering is intentional (sequential `await`); avoid parallelizing Firestore writes without checking races.
6. **Security:** `firestore.rules` are intentionally permissive in places for prototyping. Treat tightening rules and updating clients as **one** change set. Review `publicShares`, `collaboratorWrites`, `users/.../messages`, and `publicBookingRequests` before production.

## Verification commands

From repo root:

- `npm run build` — Vite production build  
- `npm run lint` — ESLint  
- `npm test` — Vitest  
- `npm run dev:local` — functions build + emulators + Vite (see `package.json`)

### Toolchain note (macOS / Homebrew)

If **any** `node` / `npm` command fails immediately with `dyld: Library not loaded: ... libicui18n.*.dylib`, Homebrew **Node** was built against an older **icu4c** than what is installed. Run **`brew reinstall node`** (or `brew upgrade node`) so Node is bottled against the current ICU dependency. That failure happens **before** the repo runs. Alternatively, put **`fnm`/`nvm`** Node earlier in `PATH` than `/opt/homebrew/bin` and use official binaries there.

## Suggested agent splits for larger tasks

1. **Firebase / rules / indexes / functions** — reads Firestore + firebase-basics skills; touches `firestore.rules`, `firestore.indexes.json`, `functions/`, `firebase.json`.  
2. **App auth + data + router** — reads firebase-auth-basics; touches `auth-context`, `firebaseAuth*`, `db.ts`, `event-store.tsx`, `router.tsx`.  
3. **UI / pages** — shadcn/Router pages under `src/pages` and `src/components`; minimize changes to `db.ts` unless the feature needs new queries.

Keep each agent’s prompt **scoped** and list **exact file paths** to read first.
