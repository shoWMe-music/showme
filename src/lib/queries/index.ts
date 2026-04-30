/**
 * Barrel export for all TanStack Query hooks and utilities.
 *
 * Import from "@/lib/queries" rather than the individual files.
 */

// Query key factories
export { queryKeys } from "./keys";

// Events
export {
  useEventsQuery,
  useEvents,
  useEventsLoaded,
  usePaginatedEvents,
  useCalendarEvents,
  useEvent,
  useChildEvents,
  useAutoConcludeEvents,
} from "./useEventsQuery";

// Contacts
export {
  useContactsQuery,
  useContacts,
  useContactsLoaded,
  useContact,
  usePaginatedContacts,
} from "./useContactsQuery";

// Share tokens
export type { ShareToken } from "./useShareTokensQuery";
export {
  useShareTokensQuery,
  useShareTokens,
} from "./useShareTokensQuery";

// Per-event economics
export type { EventEconomicsData } from "./useEventEconomics";
export { useEventEconomics, useAllEventEconomics } from "./useEventEconomics";

// Event mutations
export {
  useUpdateEvent,
  useArchiveEvent,
  useUnarchiveEvent,
  useAddEvent,
  useAddMultiPerformerEvent,
  useAddChildEvent,
  useRemoveChildEvent,
  useConvertToMultiPerformer,
  useHoldRankMutations,
  useRespondToDateChange,
  useCancelDateChange,
  getDateChangeParties,
} from "./useEventMutations";
export type { DateChangeParty } from "./useEventMutations";

// Deal / settlement mutations
export {
  useUpdateDeal,
  useUpdateRevenue,
  useUpdateSettlementStatus,
  useAddComment,
  useAddRevision,
} from "./useDealMutations";

// Contact mutations
export { useAddContact, useUpdateContact, useDeleteContact } from "./useContactMutations";

// Meta mutations
export { useUpdateEventMeta, useUpdateAnyEventMeta } from "./useMetaMutations";

// Settlement activity
export { useSettlementActivity, useLogSettlementActivity } from "./useSettlementActivity";

// Event activity
export type { ActivityEntry } from "./useEventActivity";
export { useEventActivityLog } from "./useEventActivity";

// Notifications
export { useNotifications } from "./useNotifications";

// Profiles (flat array — for access matching, not slot lookup)
export { useAllProfiles } from "./useProfilesQuery";

// Invitation codes
export type { InvitationCode } from "@/lib/db";
export {
  useValidateInvitationCode,
  useMyInvitationCodes,
  useRevokeInvitationCode,
  useIsAdmin,
} from "./useInvitationCodes";
