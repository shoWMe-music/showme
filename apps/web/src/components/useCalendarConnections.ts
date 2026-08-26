import {
  type getApiV1IntegrationsCalendar,
  getGetApiV1CalendarQueryKey,
  getGetApiV1IntegrationsCalendarQueryKey,
  useDeleteApiV1IntegrationsCalendarId,
  useGetApiV1IntegrationsCalendar,
  usePostApiV1IntegrationsCalendarGoogleAuthorizationUrl,
  usePostApiV1IntegrationsCalendarIdSync,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";

/**
 * Everything the Integrations screen does, in one hook, so the screen stays a
 * dumb renderer of state.
 *
 * WHERE THE REDIRECT COMES FROM. The browser's own origin plus the callback path —
 * never a hard-coded host, because the same bundle serves the deployed app and a
 * developer's machine, and a redirect that names the wrong origin fails at Google
 * with a message nobody can act on. The API checks the value against its
 * registered allow-list and refuses anything else, which is the actual guard: a
 * caller-chosen redirect is how an authorization code gets delivered somewhere it
 * should not go.
 *
 * WHAT IS DELIBERATELY NOT HERE: the client secret, the refresh token, and the
 * sync cursor. The browser never sees any of them. It hands the API a one-time
 * code and gets back a row describing a connection.
 *
 * `state` IS PARKED IN sessionStorage on the way out and compared on the way back.
 * The API's check is the one that counts — it re-verifies the signature and that
 * the caller is the person who started the flow — but comparing here as well means
 * a mismatched round trip is caught before a code is spent, and sessionStorage is
 * per-tab, so a second tab cannot consume the first tab's flow.
 */

export type CalendarConnection = Awaited<ReturnType<typeof getApiV1IntegrationsCalendar>>[number];

/** Where Google returns the user. Registered at Google; re-checked by the API. */
export const OAUTH_CALLBACK_PATH = "/oauth/google/callback";

export function googleRedirectUri(): string {
  return `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
}

/** Per-tab handoff for the flow in progress. Cleared as soon as it is used. */
const STATE_STORAGE_KEY = "showme.googleCalendarOAuthState";

export function rememberOAuthState(state: string): void {
  window.sessionStorage.setItem(STATE_STORAGE_KEY, state);
}

export function takeRememberedOAuthState(): string | null {
  const state = window.sessionStorage.getItem(STATE_STORAGE_KEY);
  window.sessionStorage.removeItem(STATE_STORAGE_KEY);
  return state;
}

export interface CalendarConnectionsView {
  connections: CalendarConnection[];
  isLoading: boolean;
  loadError: unknown;
  /** True while a connect / sync / disconnect is in flight. */
  isBusy: boolean;
  /** The connection the last action touched, so the screen can spin the right row. */
  busyConnectionId: string | null;
  /** Send the user to Google's consent screen. */
  connect(): Promise<void>;
  sync(connectionId: string): void;
  disconnect(connectionId: string): void;
}

export function useCalendarConnections(): CalendarConnectionsView {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const list = useGetApiV1IntegrationsCalendar();

  // A sync changes `calendar_items`, so the calendar screen's cache is stale the
  // moment one lands. Invalidated together rather than left for a page reload.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1IntegrationsCalendarQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetApiV1CalendarQueryKey() });
  };

  const authorizationUrl = usePostApiV1IntegrationsCalendarGoogleAuthorizationUrl();

  const sync = usePostApiV1IntegrationsCalendarIdSync({
    mutation: {
      onSuccess: (result) => {
        invalidate();
        toast.success(
          result.imported === 0 && result.deleted === 0
            ? "Already up to date"
            : `Synced — ${result.imported} imported, ${result.deleted} removed`,
        );
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't sync that calendar.")),
      onSettled: () => setBusyConnectionId(null),
    },
  });

  const disconnect = useDeleteApiV1IntegrationsCalendarId({
    mutation: {
      onSuccess: (result) => {
        invalidate();
        toast.success(
          result.revokedAtProvider
            ? "Disconnected — access revoked at Google"
            : "Disconnected — Google had already revoked this access",
        );
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't disconnect that calendar.")),
      onSettled: () => setBusyConnectionId(null),
    },
  });

  return useMemo<CalendarConnectionsView>(
    () => ({
      connections: list.data ?? [],
      isLoading: list.isPending,
      loadError: list.isError ? list.error : null,
      isBusy: isStarting || sync.isPending || disconnect.isPending,
      busyConnectionId,
      async connect() {
        const profileId = getActiveProfileId();
        if (!profileId) {
          toast.error("Select a profile before connecting a calendar.");
          return;
        }
        setIsStarting(true);
        try {
          const started = await authorizationUrl.mutateAsync({
            data: { profileId, redirectUri: googleRedirectUri() },
          });
          rememberOAuthState(started.state);
          // A full navigation, not a popup: Google blocks its consent screen in
          // most embedded and popup contexts, and a redirect is what the
          // registered URI describes.
          window.location.assign(started.authorizationUrl);
        } catch (error) {
          setIsStarting(false);
          toast.error(errorMessage(error, "Couldn't start the Google connection."));
        }
      },
      sync(connectionId) {
        setBusyConnectionId(connectionId);
        sync.mutate({ id: connectionId });
      },
      disconnect(connectionId) {
        setBusyConnectionId(connectionId);
        disconnect.mutate({ id: connectionId });
      },
    }),
    [
      list.data,
      list.isPending,
      list.isError,
      list.error,
      isStarting,
      sync.isPending,
      disconnect.isPending,
      busyConnectionId,
      authorizationUrl,
      sync,
      disconnect,
      toast,
    ],
  );
}
