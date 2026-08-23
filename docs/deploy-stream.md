# Deploying the SSE service (`apps/stream`) to Cloud Run

Companion to [deploy-api.md](./deploy-api.md). The stream service is one authenticated
`GET /stream` per user: it verifies a Firebase token to a `uid`, `LISTEN`s on that user's
Postgres channel (`showme_user_<uid>`), and writes each `NOTIFY` payload out as an SSE
frame. The API publishes onto those channels via `pg_notify` — the two services share only
the database, never a socket.

## Build

```bash
pnpm --filter @showme/stream build      # esbuild → apps/stream/dist/server.mjs
```

One self-contained ESM file (~3.2 MB); the runtime image needs **no `node_modules`**.
Verified by running the bundle from an empty directory outside the workspace.

## Container

`Dockerfile.stream` sits at the repo root because the build context is the whole
workspace (the bundle inlines the `@showme/*` TS source).

```bash
docker build -f Dockerfile.stream -t showme-stream:local .
```

**`gcloud run deploy --source .` will NOT work for this service** — it always picks the
root `Dockerfile`, which builds the API. Build and push an image explicitly instead:

```bash
REGION=europe-north2
PROJECT=prod-showme
REPO=<artifact-registry-repo>
IMAGE=$REGION-docker.pkg.dev/$PROJECT/$REPO/showme-stream

docker build -f Dockerfile.stream -t $IMAGE .
docker push $IMAGE
```

## Deploy

```bash
gcloud run deploy showme-stream \
  --project prod-showme --region europe-north2 \
  --image $IMAGE \
  --allow-unauthenticated \
  --add-cloudsql-instances prod-showme:europe-north2:showme-production-db \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest" \
  --set-env-vars "FIREBASE_PROJECT_ID=<firebase-project-id>,CORS_ALLOWED_ORIGINS=https://<web-app-origin>" \
  --timeout 3600 \
  --min-instances 0
```

- `--allow-unauthenticated` is correct: the service enforces auth itself, per connection,
  via the Firebase bearer token. An unauthenticated request gets a 401 before any subscribe.
- **`--timeout 3600`** — Cloud Run caps a request at 60 minutes and an SSE connection *is*
  one long request. At the cap the connection is dropped; `EventSource` reconnects on its
  own, so this is a reconnect every hour, not an outage.
- `FIREBASE_SERVICE_ACCOUNT` is only needed if the runtime service account can't use
  Application Default Credentials; the verifier falls back to ADC.

### Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **yes** | Same Cloud SQL instance the API writes to — that's the whole channel |
| `PORT` | no | Cloud Run injects it; defaults to 8080 |
| `HOST` | no | Defaults to `0.0.0.0` |
| `FIREBASE_PROJECT_ID` | in prod | Token audience |
| `FIREBASE_SERVICE_ACCOUNT` | no | Raw or base64 JSON; omit to use ADC |
| `FIREBASE_AUTH_EMULATOR_HOST` | local only | Set by the dev stack; makes the verifier accept emulator-signed tokens |
| `CORS_ALLOWED_ORIGINS` | **for browsers** | Comma-separated allow-list. Without the web app's origin, no browser can connect — see below |

## Cost — `min-instances` is the whole decision

| Setting | Roughly |
|---|---|
| 1 vCPU, `min-instances=1` | ~$45–50/mo |
| 0.5 vCPU, `min-instances=1` | ~$22–26/mo |
| `min-instances=0` | cents at low traffic |

Start at **0**. Cost then tracks *connection-hours*, and one instance carries many
concurrent SSE connections.

**Before pinning `min-instances=1`, confirm you actually need it.** The reason to consider
it: Cloud Run throttles CPU outside request processing, and this service holds a dedicated
Postgres `LISTEN` socket. In practice each SSE connection is itself an open request, so an
instance with a live subscriber is not idle — but a `NOTIFY` arriving in a gap has not been
measured under throttling. Verify against a deployed instance before paying for always-on.

**Do not give this service a custom subdomain yet.** `europe-north2` has no Cloud Run domain
mappings, so `stream.showme.music` means a second HTTPS load balancer (~$18–20/mo in
forwarding rules) — potentially more than the compute. The `run.app` URL is a fine origin
for an internal endpoint, and it bypasses the CDN just as well.

## Verify a deployment

```bash
# 401 without a token
curl -s -o /dev/null -w '%{http_code}\n' https://<service-url>/stream          # → 401

# With a real token: expect ":ok", then frames as events arrive
curl -sN -H "Authorization: Bearer $ID_TOKEN" https://<service-url>/stream
```

## Running it locally

The dev stack (`pnpm dev`) does **not** start this service. Run it alongside:

```bash
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/showme" \
PORT=8081 \
FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099" \
FIREBASE_PROJECT_ID="demo-showme" \
CORS_ALLOWED_ORIGINS="http://127.0.0.1:5180,http://localhost:5180" \
pnpm --filter @showme/stream dev
```

Get a seeded user's token from the Auth emulator, then connect:

```bash
TOKEN=$(curl -s -X POST \
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key" \
  -H "Content-Type: application/json" \
  -d '{"email":"performer.b@e2e.showme.test","password":"Test123!pass","returnSecureToken":true}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["idToken"])')

curl -sN -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8081/stream
```

Then trigger an event from another shell — post a message or add a participant through the
API — and watch the frame arrive. A raw probe works too:

```sql
select pg_notify('showme_user_e2e-performer-b', '{"type":"probe"}');
```

## What currently publishes

| Trigger | Event `type` | Recipients |
|---|---|---|
| `POST /events/:id/participants` | `event.participant_added` | Active members of the added profile, minus the actor. Also writes a `notifications` row |
| `POST /events/:id/messages` | `event.message_posted` | Mirrors `canSeeMessage`: `all` → every participant; `operators`/`party` → `host`/`co_host` only. Minus the actor. **No** `notifications` row |

The message payload carries ids only, never the body — visibility is enforced server-side
by `GET /events/:id/messages`, so a client must refetch through it rather than render
anything pushed down the channel.

The web app subscribes in `apps/web/src/hooks/useRealtimeStream.ts`, mounted once in the
AppShell. It uses `fetch` + a streaming reader rather than `EventSource`, because
`EventSource` cannot send an `Authorization` header and putting the token in the query
string would leak it into logs. Frames only invalidate TanStack Query caches, so live
updates and a cold load share one read path. Set `VITE_STREAM_URL`; leaving it blank
disables the subscription entirely.

## CORS is required for any browser client

`CORS_ALLOWED_ORIGINS` must list the web app's origin, or **no browser can connect** —
the client sends `Authorization`, which makes the request non-simple, so the browser
preflights first.

Two places must agree, and the second is easy to miss: `@fastify/cors` handles the
OPTIONS preflight, but the streaming `GET` is written through `reply.hijack()` on the raw
socket, which bypasses every Fastify reply hook. The handler therefore sets
`Access-Control-Allow-Origin` itself on the hijacked write. Miss that and the preflight
passes while the browser silently discards the stream — covered by a regression test in
`app.test.ts`.

## Known gaps

- Only two triggers publish (`event.participant_added`, `event.message_posted`). Deals,
  settlements, holds and invitations do not.
- **SSE has no backlog.** Events published while a user is disconnected are gone; the
  durable `notifications` feed (`GET /notifications`) is what covers the gap, and the
  monthly digest in decisions.md #16.10 is not built.
