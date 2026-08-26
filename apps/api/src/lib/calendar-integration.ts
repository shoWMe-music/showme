import type { GoogleOAuthClient } from "./google-calendar";
import { type SecretSealer, createSecretSealer } from "./token-encryption";

/**
 * THE CALENDAR INTEGRATION AS AN INJECTED DEPENDENCY — the same shape
 * `createEmailSink` uses for Brevo and `createLeadSink` uses for ClickUp, and for
 * the same three reasons: the routes stay framework-agnostic, the secrets never
 * leave the server, and the app BOOTS WITHOUT THEM.
 *
 * That last one is the whole point of returning `null` rather than throwing.
 * Nobody running the stack on a laptop, and no Testcontainers suite, should need
 * a Google client secret to work on settlements. Unconfigured means "the
 * integration is unavailable", the routes answer 503 with a sentence that says so,
 * and every other route is unaffected.
 *
 * ALL THREE OR NOTHING. A client id with no encryption key would connect a
 * calendar and then have nowhere safe to put the refresh token — and the failure
 * would land after the user had already granted access at Google, which is the
 * worst possible moment to discover a missing secret. The check is at wiring time.
 */

export interface CalendarIntegrationConfig {
  googleOAuthClientId?: string;
  googleOAuthClientSecret?: string;
  /** base64 of 32 random bytes, from Secret Manager. */
  calendarTokenEncryptionKey?: string;
  /**
   * The public HTTPS endpoint Google should POST change notifications to. Optional
   * and SEPARATE from the three secrets: a laptop has no address Google can reach,
   * so unset simply means "no push channel, manual sync only" and everything else
   * still works. It must live on a domain USER-VERIFIED against this Cloud project
   * (`api.showme.music`); Google refuses to register a channel otherwise, and a
   * `*.run.app` URL can never qualify.
   */
  webhookUrl?: string;
  /** Injectable for tests; threaded into every Google call. */
  fetchImplementation?: typeof fetch;
}

export interface CalendarIntegration {
  /** The client credentials for the code exchange, the refresh, and the revoke. */
  googleOAuthClient: GoogleOAuthClient;
  /** Seals and opens refresh tokens. Holds the key; the database never does. */
  sealer: SecretSealer;
  /**
   * The raw base64 key, used ONLY to derive the OAuth-state MAC subkey. The state
   * signer needs the secret to derive from, not the cipher.
   */
  encryptionKey: string;
  /** Where Google pushes change notifications, or null for manual sync only. */
  webhookUrl: string | null;
}

/**
 * Build the integration, or `null` when it is not configured.
 *
 * A malformed key still THROWS — an operator who set the variable to something
 * that is not 32 bytes made a mistake, and silently downgrading to "calendars are
 * off" would hide it until a user complained.
 */
export function createCalendarIntegration(
  config: CalendarIntegrationConfig,
): CalendarIntegration | null {
  const { googleOAuthClientId, googleOAuthClientSecret, calendarTokenEncryptionKey } = config;
  if (!googleOAuthClientId || !googleOAuthClientSecret || !calendarTokenEncryptionKey) return null;

  return {
    googleOAuthClient: {
      clientId: googleOAuthClientId,
      clientSecret: googleOAuthClientSecret,
      fetchImplementation: config.fetchImplementation,
    },
    sealer: createSecretSealer(calendarTokenEncryptionKey),
    encryptionKey: calendarTokenEncryptionKey,
    // Push is an ADD-ON, not a requirement: without a reachable address the
    // integration still connects and still syncs when asked.
    webhookUrl: config.webhookUrl ?? null,
  };
}

/**
 * The associated data a refresh token is sealed under — its ADDRESS, in effect.
 *
 * Binding the ciphertext to the row it belongs on means a sealed token copied
 * onto a different connection fails to open instead of syncing the wrong person's
 * calendar. It has to be reproducible from the row alone, which is why it is built
 * from the three columns that also form the table's unique key: they identify the
 * connection and they never change for a given row.
 */
export function refreshTokenSealContext(connection: {
  userId: string;
  provider: string;
  providerAccountId: string;
}): string {
  return `calendar_refresh_token|${connection.userId}|${connection.provider}|${connection.providerAccountId}`;
}
