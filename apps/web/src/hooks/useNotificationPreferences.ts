import { customFetch } from "@showme/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Settings → Notifications' data layer, kept out of the panel so the panel stays
 * short and dumb: it takes rows and emits a change.
 *
 * Called through `customFetch` rather than a generated orval hook, for the same
 * temporary reason `useEventMessageThreads` documents: orval regenerates with
 * `clean: true` from a live API's OpenAPI, and this tree has several people
 * adding routes at once, so a regeneration here would bake in whatever else
 * happened to be running. The mutator is the one every generated hook uses — base
 * URL, bearer token, `x-profile-id` and the typed error envelope all behave
 * identically. Swap for `useGetApiV1NotificationsPreferences` /
 * `usePutApiV1NotificationsPreferences` after the next regeneration; nothing
 * outside this file has to change when that happens.
 */

export interface NotificationPreference {
  category: string;
  /** The API owns the copy — see the note on `PreferenceResponse` in the route. */
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
  /** True while this is still the catalog default rather than a stored answer. */
  isDefault: boolean;
}

export type NotificationChannel = "inApp" | "email";

interface PreferencesPayload {
  preferences: NotificationPreference[];
}

const QUERY_KEY = ["notifications", "preferences"] as const;

export function useNotificationPreferences() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () =>
      customFetch<PreferencesPayload>({ url: "/api/v1/notifications/preferences", method: "GET" }),
  });

  // One switch is one write. There is no Save button because there is nothing to
  // batch: a toggle is a complete decision the moment it is flipped, unlike the
  // budget planner's half-typed figures. The response IS the new full catalog, so
  // it seeds the cache directly rather than triggering a second round trip.
  const save = useMutation({
    mutationFn: (preference: { category: string; inApp: boolean; email: boolean }) =>
      customFetch<PreferencesPayload>({
        url: "/api/v1/notifications/preferences",
        method: "PUT",
        data: { preferences: [preference] },
      }),
    onSuccess: (payload) => queryClient.setQueryData(QUERY_KEY, payload),
  });

  const preferences = query.data?.preferences ?? [];

  /**
   * Flip one channel of one category. Both channels are sent because a stored row
   * is a complete answer — writing only the one that moved would need the server
   * to guess the other, and the guess would be the default, silently undoing an
   * earlier choice.
   */
  const setChannel = (category: string, channel: NotificationChannel, value: boolean) => {
    const current = preferences.find((preference) => preference.category === category);
    if (!current) return;
    save.mutate({
      category,
      inApp: channel === "inApp" ? value : current.inApp,
      email: channel === "email" ? value : current.email,
    });
  };

  return {
    preferences,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    setChannel,
    isSaving: save.isPending,
    saveError: save.error,
  };
}
