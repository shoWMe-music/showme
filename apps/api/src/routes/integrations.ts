import { schema } from "@showme/db";
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound, serviceUnavailable } from "../errors";
import { writeAudit } from "../lib/audit";
import { type CalendarIntegration, refreshTokenSealContext } from "../lib/calendar-integration";
import {
  channelTokenMatches,
  readRefreshToken,
  registerCalendarPushChannel,
  stopCalendarPushChannel,
  syncCalendarConnection,
} from "../lib/calendar-sync";
import { applyExternalCalendarDeletions } from "../lib/external-calendar";
import { createSlidingWindowRateLimiter } from "../lib/rate-limit";
import {
  GOOGLE_CALENDAR_SCOPE,
  GoogleAuthorizationRevokedError,
  buildGoogleAuthorizationUrl,
  exchangeAuthorizationCode,
  isRegisteredRedirectUri,
  readCalendarIdentity,
  revokeToken,
} from "../lib/google-calendar";
import { signOAuthState, verifyOAuthState } from "../lib/oauth-state";
import { serializeCalendarConnection } from "../serialize/calendar-connection";

/**
 * THE INTEGRATIONS SURFACE — connecting a Google Calendar, and everything that
 * follows from having connected one.
 *
 * ── THE FLOW, AND WHY IT HAS THREE LEGS AND NOT TWO ──────────────────────────
 * 1. `POST /integrations/calendar/google/authorization-url` — the API builds the
 *    consent URL, because only the API may mint the signed `state` and only the
 *    API knows the client id. The browser gets a URL, not a credential.
 * 2. Google sends the user back to the SPA at `/oauth/google/callback?code=…`.
 * 3. `POST /integrations/calendar/google/connect` — the SPA hands the code
 *    straight back to the API, which exchanges it.
 *
 * THE CLIENT SECRET NEVER REACHES THE BROWSER. That is the whole reason the SPA
 * does not exchange the code itself: a public SPA cannot hold a secret, and a
 * client secret shipped in a JS bundle is a client secret published. The code is
 * a one-time value that is worthless without the secret, which is why it is safe
 * to let it land in a browser and be relayed.
 *
 * ── `state`, WHICH IS NOT OPTIONAL ───────────────────────────────────────────
 * See `lib/oauth-state.ts` for the attack it stops. Here, the check is two lines
 * and both matter: the MAC must verify (nobody forged it), and the user it names
 * must be the authenticated caller (it is the same person who started the flow).
 * Without the second half the first is decoration.
 *
 * ── WHO MAY CONNECT ──────────────────────────────────────────────────────────
 * An owner or an admin of the profile. Connecting a calendar takes nights OFF a
 * profile's public availability, so it is a management action on the profile, not
 * a personal preference — the same bar `POST /calendar/:id/promote-event` sets for
 * turning an entry into a show. An editor may see that a calendar is connected;
 * they may not attach or remove one.
 *
 * ── THE PUSH CHANNEL ─────────────────────────────────────────────────────────
 * "Sync now" is a route a person presses. Google also pushes: a watch is
 * registered when a calendar is connected, and every change POSTs to
 * `/integrations/calendar/google/notifications` — the one PUBLIC route in this
 * file, because Google will not send a Firebase token. What guards it is the
 * per-channel secret Google echoes back, and nothing else; see the route.
 *
 * WHAT IS STILL MISSING, precisely: RENEWAL. A channel expires in about a week
 * and re-registering it needs a scheduled job, and `infra/modules/scheduled-jobs`
 * is written but not applied — there is nowhere to run one today. So the expiry is
 * stored, exposed on the connection, and the screen says "live sync paused" when
 * it lapses, instead of a calendar going quietly stale. The job's exact behaviour
 * is written down in `lib/calendar-sync.ts` so it can be added unchanged.
 */

const ConnectionParams = z.object({ id: z.string().uuid() });

const AuthorizationUrlBody = z.object({
  /** Whose availability the connection will feed. Must be one the caller manages. */
  profileId: z.string().uuid(),
  /**
   * Where Google should send the user back. Checked against the registered
   * allow-list — a caller-chosen redirect is how an authorization code gets
   * delivered to somebody else's server.
   */
  redirectUri: z.string().url(),
});

const AuthorizationUrlResponse = z.object({
  authorizationUrl: z.string(),
  /** Returned so the SPA can hold it and prove the round trip matched. */
  state: z.string(),
  scope: z.string(),
});

const ConnectBody = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const ConnectionResponse = z.object({
  id: z.string(),
  provider: z.string(),
  profileId: z.string(),
  /** The Google account, or null when this reader is not the person who connected it. */
  providerAccountId: z.string().nullable(),
  /** True when the line above was withheld rather than absent. */
  accountWithheld: z.boolean(),
  providerCalendarId: z.string(),
  calendarTimeZone: z.string().nullable(),
  scope: z.string(),
  lastSyncedAt: z.string().nullable(),
  lastFullSyncAt: z.string().nullable(),
  /** True once a sync token exists — i.e. the next sync will be incremental. */
  incrementalSyncReady: z.boolean(),
  /** When Google stopped accepting the stored token. Non-null = offer Reconnect. */
  reauthorizationRequiredAt: z.string().nullable(),
  lastError: z.string().nullable(),
  /** True while Google is pushing changes; false means manual sync only. */
  pushChannelActive: z.boolean(),
  /** When the push channel lapses. Null = no channel was ever registered. */
  channelExpiresAt: z.string().nullable(),
  /** Whether this reader may sync or disconnect it (only the person who connected). */
  manageable: z.boolean(),
  createdAt: z.string(),
});

const SyncResponse = z.object({
  connection: ConnectionResponse,
  full: z.boolean(),
  imported: z.number(),
  deleted: z.number(),
  keptBecausePromoted: z.number(),
  echoesSkipped: z.number(),
  ignored: z.number(),
});

const DisconnectResponse = z.object({
  id: z.string(),
  disconnected: z.literal(true),
  /** Whether Google confirmed the grant is gone. False = it was already dead. */
  revokedAtProvider: z.boolean(),
  /** Imported entries removed with it; a promoted one keeps its row instead. */
  entriesRemoved: z.number(),
  entriesKeptBecausePromoted: z.number(),
});

type ConnectionRow = typeof schema.calendarConnections.$inferSelect;

/** The integration, or a 503 that says which half of the deployment is missing. */
function requireIntegration(request: FastifyRequest): CalendarIntegration {
  const integration = request.server.calendarIntegration;
  if (!integration) {
    throw serviceUnavailable(
      "Calendar connections are not available on this deployment — no Google credentials are configured",
    );
  }
  return integration;
}

function principalOf(request: FastifyRequest) {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  return principal;
}

/**
 * The connection, if the caller may MANAGE it — which means they are the person
 * whose Google account it is. A co-member of the profile may see it (the list
 * route below shows it, account withheld) but may not sync or revoke somebody
 * else's credential. Anything else is a 404 rather than a 403: a connection the
 * caller may not touch is not theirs to learn about.
 */
async function loadManageableConnection(
  request: FastifyRequest,
  id: string,
): Promise<ConnectionRow> {
  const { database } = request.server;
  const principal = principalOf(request);
  const [connection] = await database
    .select()
    .from(schema.calendarConnections)
    .where(eq(schema.calendarConnections.id, id));
  if (!connection || connection.userId !== principal.userId) {
    throw notFound("Calendar connection not found");
  }
  return connection;
}

/** Only an owner or admin of the profile may attach or remove a calendar. */
function assertMayManageProfile(request: FastifyRequest, profileId: string): void {
  const principal = principalOf(request);
  const membership = principal.memberships.find((member) => member.profileId === profileId);
  if (!membership) throw forbidden("You are not a member of that profile");
  if (!["owner", "admin"].includes(membership.role)) {
    throw forbidden("Only an owner or admin of this profile can connect a calendar");
  }
}

function forViewer(connection: ConnectionRow, request: FastifyRequest) {
  return serializeCalendarConnection(connection, principalOf(request).userId);
}

/**
 * Google's notification headers. Everything the ping says is here: the body is
 * empty, by design and by documentation.
 */
const NotificationHeaders = z.object({
  "x-goog-channel-id": z.string().min(1),
  "x-goog-resource-state": z.string().min(1),
  "x-goog-channel-token": z.string().min(1),
  "x-goog-resource-id": z.string().optional(),
  "x-goog-message-number": z.string().optional(),
});

export async function integrationRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * A flood guard for the push endpoint, keyed by channel. Google's own rate is
   * modest; this is here because the route is PUBLIC, so the budget has to hold
   * against somebody who found the URL, not just against a chatty calendar. Per
   * instance, not global (see lib/rate-limit.ts) — enough to stop a single source.
   */
  const notificationRateLimiter = createSlidingWindowRateLimiter({
    limit: 60,
    windowMs: 60_000,
  });


  /**
   * GOOGLE'S PUSH NOTIFICATION — the one public route in this file.
   *
   * PUBLIC BECAUSE IT HAS TO BE. Google POSTs as Google; there is no Firebase
   * token, no principal, and no user identity anywhere in the request. The body is
   * EMPTY — every fact is a header, and the only fact is "something on that
   * calendar changed". It never says what, which is exactly why the handler runs
   * the ordinary incremental sync: that path already asks Google "what has moved
   * since my cursor" and is the same code "Sync now" drives.
   *
   * THE TOKEN CHECK IS THE ONLY AUTHENTICATION THERE IS. The channel was
   * registered with a per-channel secret; Google echoes it in
   * `X-Goog-Channel-Token`. A mismatch is not a mistake to explain, it is somebody
   * who found the URL — so it answers 404, writes nothing, and says nothing about
   * whether the channel exists. The comparison is constant-time against a stored
   * DIGEST, so a leak of the table cannot be turned into a forged ping either.
   *
   * `X-Goog-Resource-State: sync` IS THE HANDSHAKE Google sends immediately after
   * a watch is registered. It carries no change. Acknowledged, and nothing else.
   *
   * IDEMPOTENT BY CONSTRUCTION. Google retries with exponential backoff and can
   * deliver the same change more than once; the sync underneath upserts on
   * `(external_source, external_id)` and applies deletions by id, so running it
   * twice reaches the same state as running it once.
   *
   * WHY THE SYNC RUNS INSIDE THE REQUEST, and why that is safe. Acknowledging
   * first and working after would be the textbook answer, and it is the WRONG one
   * here: this API runs on Cloud Run with the default CPU allocation, where the
   * instance is throttled to near zero as soon as the response is sent — work
   * deferred past `reply.send()` may simply never run, and a webhook that silently
   * does nothing is worse than a slow one. The work itself is small and bounded:
   * one token refresh and one incremental listing of what changed, typically a
   * handful of events. If a run does overrun, Google's retry lands on an idempotent
   * handler, and the connection's cursor has not moved, so nothing is lost.
   *
   * WHAT IT NEVER DOES: trust the notification's contents. `X-Goog-Resource-ID` is
   * not used to select the row (the channel id is, after the token check), and no
   * value from the request reaches the database.
   */
  app.post(
    "/integrations/calendar/google/notifications",
    {
      config: { public: true },
      // `logLevel: warn` for the same reason the health route sets it: a calendar
      // that changes often should not write two log lines per change.
      logLevel: "warn",
      schema: { hide: true },
    },
    async (request, reply) => {
      const integration = request.server.calendarIntegration;
      // Nothing to sync with. Acknowledged rather than 503'd: a non-2xx makes
      // Google retry a request that can never succeed on this deployment.
      if (!integration) return reply.status(200).send();

      const headers = NotificationHeaders.safeParse(request.headers);
      if (!headers.success) return reply.status(404).send();
      const notification = headers.data;

      if (!notificationRateLimiter.take(notification["x-goog-channel-id"])) {
        return reply.status(429).send();
      }

      const { database } = request.server;
      const [connection] = await database
        .select()
        .from(schema.calendarConnections)
        .where(eq(schema.calendarConnections.channelId, notification["x-goog-channel-id"]));

      // Unknown channel and wrong token are the SAME answer on purpose: a 404
      // either way leaks nothing about which channel ids exist.
      if (!connection || !channelTokenMatches(notification["x-goog-channel-token"], connection.channelTokenHash)) {
        return reply.status(404).send();
      }

      // The post-registration handshake. No change to fetch.
      if (notification["x-goog-resource-state"] === "sync") return reply.status(200).send();

      try {
        await syncCalendarConnection(database, integration, connection);
      } catch (error) {
        if (error instanceof GoogleAuthorizationRevokedError) {
          // The user revoked us. The connection is already marked for
          // reconnection by the sync itself, and there is nothing Google can do
          // by retrying — so acknowledge rather than making it retry forever.
          return reply.status(200).send();
        }
        // Anything else may be transient. A non-2xx is how Google is asked to
        // try again, which is the correct response to a temporary failure.
        request.log.warn(
          { connectionId: connection.id, error: (error as Error).message },
          "calendar push notification could not be synced",
        );
        return reply.status(500).send();
      }

      return reply.status(200).send();
    },
  );

  /**
   * What is connected — the caller's own connections, plus the ones feeding the
   * profiles they belong to (with the account address withheld, exactly as an
   * imported entry's title is). A co-member should be able to see that a
   * profile's availability is driven by somebody's calendar without being told
   * whose personal Google address it is.
   */
  app.get(
    "/integrations/calendar",
    { schema: { response: { 200: z.array(ConnectionResponse) } } },
    async (request) => {
      const { database } = request.server;
      const principal = principalOf(request);
      const profileIds = principal.memberships.map((member) => member.profileId);

      const reachable = [eq(schema.calendarConnections.userId, principal.userId)];
      if (profileIds.length > 0) {
        reachable.push(inArray(schema.calendarConnections.profileId, profileIds));
      }

      const rows = await database
        .select()
        .from(schema.calendarConnections)
        .where(or(...reachable))
        .orderBy(asc(schema.calendarConnections.createdAt));

      return rows.map((row) => forViewer(row, request));
    },
  );

  /**
   * Leg 1: where to send the user. The URL carries the client ID (public), the
   * scope, and the signed state — never the secret.
   */
  app.post(
    "/integrations/calendar/google/authorization-url",
    { schema: { body: AuthorizationUrlBody, response: { 200: AuthorizationUrlResponse } } },
    async (request) => {
      const integration = requireIntegration(request);
      const principal = principalOf(request);
      const { profileId, redirectUri } = request.body;

      assertMayManageProfile(request, profileId);
      if (!isRegisteredRedirectUri(redirectUri)) {
        throw badRequest("That redirect address is not registered for this application");
      }

      // The redirect is signed INTO the state so the exchange is forced to reuse
      // the same one. Google checks it too; doing it here as well means a state
      // minted for the SPA cannot be spent against the loopback listener.
      const state = signOAuthState(integration.encryptionKey, {
        userId: principal.userId,
        profileId,
        redirectUri,
      });

      return {
        authorizationUrl: buildGoogleAuthorizationUrl({
          clientId: integration.googleOAuthClient.clientId,
          redirectUri,
          state,
        }),
        state,
        scope: GOOGLE_CALENDAR_SCOPE,
      };
    },
  );

  /**
   * Leg 3: the code comes back through the SPA and is spent here.
   *
   * The first sync runs inline rather than being left for the user to trigger:
   * a screen that says "Connected" over an empty calendar looks broken, and the
   * first listing is also what tells us which Google account this is.
   */
  app.post(
    "/integrations/calendar/google/connect",
    { schema: { body: ConnectBody, response: { 201: SyncResponse } } },
    async (request, reply) => {
      const integration = requireIntegration(request);
      const { database } = request.server;
      const principal = principalOf(request);

      // ── the state check, both halves ──
      const claims = (() => {
        try {
          return verifyOAuthState(integration.encryptionKey, request.body.state);
        } catch (error) {
          throw badRequest(error instanceof Error ? error.message : "Invalid state");
        }
      })();
      // The half that does the work: the person finishing the flow must be the
      // person who started it. Without this, an attacker's code lands on a
      // victim's account (see lib/oauth-state.ts).
      if (claims.userId !== principal.userId) {
        throw badRequest("This connection attempt belongs to a different account");
      }
      assertMayManageProfile(request, claims.profileId);

      const grant = await exchangeAuthorizationCode(integration.googleOAuthClient, {
        code: request.body.code,
        redirectUri: claims.redirectUri,
      });
      if (!grant.refreshToken) {
        // `prompt=consent` should make this impossible; if it happens the user has
        // an access token that dies in an hour and no way to renew it, so refusing
        // is the only honest outcome.
        throw conflict(
          "Google did not issue a refresh token — remove shoWMe at myaccount.google.com/permissions and connect again",
        );
      }
      if (!grant.scope.includes(GOOGLE_CALENDAR_SCOPE)) {
        throw badRequest("Calendar access was not granted — connect again and allow it");
      }

      // Which account is this? `calendars.get` is a 403 under this scope, so the
      // identity is read off a one-day listing's envelope.
      const identity = await readCalendarIdentity({
        accessToken: grant.accessToken,
        calendarId: "primary",
        fetchImplementation: integration.googleOAuthClient.fetchImplementation,
      });
      const providerAccountId = identity.calendarSummary ?? "primary";

      const sealContext = refreshTokenSealContext({
        userId: principal.userId,
        provider: "google",
        providerAccountId,
      });
      const sealed = integration.sealer.seal(grant.refreshToken, sealContext);
      const now = new Date();

      // Reconnecting UPDATES: the unique key is (user, provider, account), so a
      // second trip through consent replaces the credential instead of leaving the
      // old one behind as an untracked live key. The sync cursor is cleared with
      // it — a new grant starts from a full listing.
      const [connection] = await database
        .insert(schema.calendarConnections)
        .values({
          userId: principal.userId,
          profileId: claims.profileId,
          provider: "google",
          providerAccountId,
          providerCalendarId: "primary",
          calendarTimeZone: identity.calendarTimeZone,
          refreshTokenCiphertext: sealed.ciphertext,
          refreshTokenIv: sealed.iv,
          refreshTokenAuthTag: sealed.authTag,
          scope: grant.scope,
        })
        .onConflictDoUpdate({
          target: [
            schema.calendarConnections.userId,
            schema.calendarConnections.provider,
            schema.calendarConnections.providerAccountId,
          ],
          set: {
            profileId: claims.profileId,
            calendarTimeZone: identity.calendarTimeZone,
            refreshTokenCiphertext: sealed.ciphertext,
            refreshTokenIv: sealed.iv,
            refreshTokenAuthTag: sealed.authTag,
            scope: grant.scope,
            syncToken: null,
            reauthorizationRequiredAt: null,
            lastError: null,
            updatedAt: now,
          },
        })
        .returning();
      if (!connection) throw new Error("calendar connection upsert failed");

      await database.transaction(async (tx) => {
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "integration.calendar.connect",
          targetKind: "calendar_connection",
          targetId: connection.id,
          // The token is not in here and must never be: the audit log is read by
          // support, exported, and kept forever.
          after: {
            provider: "google",
            providerAccountId,
            profileId: claims.profileId,
            scope: grant.scope,
          },
        });
      });

      const result = await syncCalendarConnection(database, integration, connection);

      // Ask Google to push from here on. BEST-EFFORT: no webhook address (a
      // laptop), or Google refusing the address, must not fail a connection that
      // otherwise worked — the calendar still syncs when asked, the screen says
      // which mode it is in, and the alternative is refusing to connect at all
      // over an optimisation.
      try {
        await registerCalendarPushChannel(database, integration, connection);
      } catch (error) {
        request.log.warn(
          { connectionId: connection.id, error: (error as Error).message },
          "calendar connected but the push channel could not be registered",
        );
      }

      const [refreshed] = await database
        .select()
        .from(schema.calendarConnections)
        .where(eq(schema.calendarConnections.id, connection.id));

      return reply.status(201).send({
        connection: forViewer(refreshed ?? connection, request),
        full: result.full,
        imported: result.imported,
        deleted: result.deleted,
        keptBecausePromoted: result.keptBecausePromoted,
        echoesSkipped: result.echoesSkipped,
        ignored: result.ignored,
      });
    },
  );

  /**
   * "Sync now" — the manual trigger, and the exact code path a webhook would run.
   *
   * A revoked grant answers 409 with the sentence a user can act on, and the row
   * is already marked so the screen keeps saying it after a reload. It is not a
   * 500: nothing went wrong, the user changed their mind at Google.
   */
  app.post(
    "/integrations/calendar/:id/sync",
    { schema: { params: ConnectionParams, response: { 200: SyncResponse } } },
    async (request) => {
      const integration = requireIntegration(request);
      const { database } = request.server;
      const connection = await loadManageableConnection(request, request.params.id);

      let result: Awaited<ReturnType<typeof syncCalendarConnection>>;
      try {
        result = await syncCalendarConnection(database, integration, connection);
      } catch (error) {
        if (error instanceof GoogleAuthorizationRevokedError) {
          throw conflict(error.message);
        }
        throw error;
      }

      const [refreshed] = await database
        .select()
        .from(schema.calendarConnections)
        .where(eq(schema.calendarConnections.id, connection.id));

      return {
        connection: forViewer(refreshed ?? connection, request),
        full: result.full,
        imported: result.imported,
        deleted: result.deleted,
        keptBecausePromoted: result.keptBecausePromoted,
        echoesSkipped: result.echoesSkipped,
        ignored: result.ignored,
      };
    },
  );

  /**
   * Disconnect — and it means it.
   *
   * ORDER MATTERS, and it is the whole reason this route is longer than a DELETE:
   *   1. revoke at Google FIRST, while the sealed token is still readable. A row
   *      deleted first leaves a live key to somebody's calendar with nothing left
   *      to revoke it with, and "Disconnected" on the screen would be a lie.
   *   2. remove the entries this connection imported, because they can no longer
   *      be refreshed — leaving them would block nights forever with no way to
   *      learn that the meeting was cancelled. A PROMOTED entry keeps its row and
   *      stops blocking (`applyExternalCalendarDeletions`): it became a show, and
   *      the show is the source of truth now.
   *   3. delete the connection.
   *
   * A token Google has already forgotten answers 400 on revoke. That is the
   * desired end state, so it is reported (`revokedAtProvider: false`) rather than
   * blocking a disconnect the user asked for.
   */
  app.delete(
    "/integrations/calendar/:id",
    { schema: { params: ConnectionParams, response: { 200: DisconnectResponse } } },
    async (request) => {
      const integration = requireIntegration(request);
      const { database } = request.server;
      const connection = await loadManageableConnection(request, request.params.id);

      let revokedAtProvider = false;
      try {
        // The channel goes FIRST, while the grant is still live — `channels.stop`
        // needs an access token, and revoking the grant takes that away. A channel
        // left running would have Google POSTing about a calendar nobody is
        // listening to, retried with backoff, forever.
        await stopCalendarPushChannel(integration, connection).catch((error) => {
          request.log.warn(
            { connectionId: connection.id, error: (error as Error).message },
            "calendar disconnect could not stop the push channel",
          );
          return false;
        });
        const refreshToken = readRefreshToken(integration, connection);
        const outcome = await revokeToken(integration.googleOAuthClient, refreshToken);
        revokedAtProvider = outcome.revoked;
      } catch (error) {
        // A token we cannot open (key rotated, row tampered with) or a provider
        // that will not answer must NOT trap the user in a connection they have
        // asked to remove. It is recorded and the local half proceeds — the
        // response says plainly that the grant was not confirmed gone.
        request.log.warn(
          { connectionId: connection.id, error: (error as Error).message },
          "calendar disconnect could not revoke at the provider",
        );
      }

      const imported = await database
        .select({ externalId: schema.calendarItems.externalId })
        .from(schema.calendarItems)
        .where(
          and(
            eq(schema.calendarItems.externalSource, connection.provider),
            eq(schema.calendarItems.ownerProfileId, connection.profileId),
            eq(schema.calendarItems.ownerUserId, connection.userId),
            isNotNull(schema.calendarItems.externalId),
          ),
        );

      const removals = await applyExternalCalendarDeletions(database, {
        provider: connection.provider,
        ownerProfileId: connection.profileId,
        ownerUserId: connection.userId,
        externalIds: imported.flatMap((row) => (row.externalId ? [row.externalId] : [])),
      });

      await database.transaction(async (tx) => {
        await tx
          .delete(schema.calendarConnections)
          .where(eq(schema.calendarConnections.id, connection.id));
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "integration.calendar.disconnect",
          targetKind: "calendar_connection",
          targetId: connection.id,
          before: {
            provider: connection.provider,
            providerAccountId: connection.providerAccountId,
            profileId: connection.profileId,
          },
          after: { revokedAtProvider, entriesRemoved: removals.deleted },
        });
      });

      return {
        id: connection.id,
        disconnected: true as const,
        revokedAtProvider,
        entriesRemoved: removals.deleted,
        entriesKeptBecausePromoted: removals.keptBecausePromoted,
      };
    },
  );
}
