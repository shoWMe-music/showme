/**
 * Base URL for links the app sends out (emails, OTP redirects, action-code
 * confirmation pages). Resolution order:
 *   1. Explicit APP_BASE_URL env var (wins everywhere — e.g. staging).
 *   2. Functions emulator → local Vite dev server.
 *   3. Production fallback.
 */
const PROD_URL = "https://showme-production.web.app";
const DEV_URL = "http://localhost:8080";

export const APP_BASE_URL = (
  process.env.APP_BASE_URL ||
  (process.env.FUNCTIONS_EMULATOR === "true" ? DEV_URL : PROD_URL)
).replace(/\/$/, "");
