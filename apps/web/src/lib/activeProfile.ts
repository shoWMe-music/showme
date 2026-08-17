/**
 * The profile the user is currently acting as — sent to the API as `X-Profile-Id`
 * so profile-scoped mutations (create event, etc.) resolve the right principal.
 * Held outside React so the api-client's `getProfileId` (configured once at
 * startup) can read the latest value. AuthProvider keeps it in sync with the
 * session; a full profile switcher can set it later.
 */
let activeProfileId: string | null = null;

export const getActiveProfileId = (): string | null => activeProfileId;
export const setActiveProfileId = (id: string | null): void => {
  activeProfileId = id;
};
