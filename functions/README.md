# settle-fast-functions

Standalone npm package for **Firebase Cloud Functions** (2nd gen). It lives under `functions/` in this monorepo and is what the Firebase CLI loads when you run emulators or deploy.

## Requirements

- Node.js **22** (required `engines.node` in `package.json` for the Firebase emulator)
- Firebase CLI (provided at the repo root via `firebase-tools`, or install globally)

## Scripts

| Command | Description |
|--------|-------------|
| `npm install` | Install function dependencies (run inside `functions/`). |
| `npm run build` | Compile TypeScript (`src/`) to CommonJS in `lib/`. |
| `npm run watch` | Rebuild on file changes; use with the Functions emulator from the repo root. |

## Local development (full stack)

From the **repository root** (not from `functions/` alone):

1. Run **`npm run dev:local`** — builds functions once, then starts `tsc --watch`, **Auth + Firestore + Functions + Storage** emulators, and the **Vite** app together. No `.env` is required for Vite to target emulators in dev (see root `src/integrations/firebase/config.ts`).
2. In another terminal, optionally seed the emulators: **`npm run seed:workspace`**.

To run **only** the Firebase emulator suite (no Vite): **`npm run dev:emulators`**.

HTTP smoke tests (emulators running, project id `showme-local`):

- `curl "http://127.0.0.1:5001/showme-local/europe-west1/ping"`
- `curl "http://127.0.0.1:5001/showme-local/europe-west1/exchangeRate?source=USD&target=EUR"` (needs `EXCHANGE_RATE_API_KEY` in `functions/.env` — see `.env.example`)
- `curl "http://127.0.0.1:5001/showme-local/europe-west1/supportedCurrencies"`

The **exchange rate** logic matches the earlier showme **exchange-rate** routes (v6 ExchangeRate-API): `exchangeRate` returns `{ rate, sourceCurrency, targetCurrency }`; `supportedCurrencies` returns `{ supportedCurrencies: [{ code, name, symbol }] }` filtered to USD, EUR, GBP, DKK, SEK, NOK.

## Deploy

From the repo root, after `npm run build:functions`:

```bash
firebase deploy --only functions
```

The `predeploy` hook in `firebase.json` runs `npm run build` inside `functions/` automatically on deploy.
