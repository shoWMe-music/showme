import { createDatabase } from "@showme/db";
import { buildApp } from "./app";
import { createFirebaseTokenVerifier } from "./auth/token-verifier";
import { loadEnv } from "./config";

/**
 * Production entry point — wires real dependencies from the environment and
 * listens. `pnpm --filter @showme/api dev` runs this under Node's TS support.
 */
const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const tokenVerifier = createFirebaseTokenVerifier({
  projectId: env.FIREBASE_PROJECT_ID,
  serviceAccount: env.FIREBASE_SERVICE_ACCOUNT,
});

const app = buildApp({ database, tokenVerifier });

app
  .listen({ port: env.PORT, host: env.HOST })
  .then((address) => {
    console.log(`shoWMe API listening on ${address}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
