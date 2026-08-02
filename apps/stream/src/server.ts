import { createDatabase } from "@showme/db";
import { buildStreamApp } from "./app";
import { loadEnv } from "./config";
import { createPubSub } from "./pubsub";
import { createFirebaseTokenVerifier } from "./token-verifier";

/**
 * Production entry point — wires real dependencies from the environment and
 * listens. The pub/sub opens its own dedicated LISTEN connection; the Database is
 * used only to publish. `pnpm --filter @showme/stream dev` runs this under Node's
 * TS support.
 */
const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const pubsub = createPubSub(env.DATABASE_URL);
const tokenVerifier = createFirebaseTokenVerifier({
  projectId: env.FIREBASE_PROJECT_ID,
  serviceAccount: env.FIREBASE_SERVICE_ACCOUNT,
});

const app = buildStreamApp({ database, pubsub, tokenVerifier });

app
  .listen({ port: env.PORT, host: env.HOST })
  .then((address) => {
    console.log(`shoWMe stream listening on ${address}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
