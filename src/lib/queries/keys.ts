/**
 * Centralised query key factories.
 *
 * All TanStack Query keys in the app should be defined here so that
 * invalidation and cache reads are consistent across hooks.
 */

export const queryKeys = {
  // ── Split primary data ──────────────────────────────────────────────────
  events: (uid: string) => ["events", uid] as const,
  eventPages: (uid: string, filters?: Record<string, unknown>) => ["eventPages", uid, filters ?? {}] as const,
  calendarEvents: (uid: string, dateFrom: string, dateTo: string) => ["calendarEvents", uid, dateFrom, dateTo] as const,
  contacts: (uid: string) => ["contacts", uid] as const,
  contactPages: (uid: string, filters?: Record<string, unknown>) => ["contactPages", uid, filters ?? {}] as const,
  shareTokens: (uid: string) => ["shareTokens", uid] as const,

  // ── Per-event economics (deal + revenue + settlement + meta) ────────────
  eventEconomics: (eventId: string) => ["eventEconomics", eventId] as const,

  // ── Existing / shared query keys (preserved from queryKeys.ts) ──────────
  publicShareByToken: (token: string) => ["publicShare", token] as const,
  upcomingEventsForPublicProfile: (profileId: string) => ["upcomingEventsForPublicProfile", profileId] as const,
  shareBudgetParties: (token: string) => ["shareBudgetParties", token] as const,

  // ── User domain ──────────────────────────────────────────────────────────
  userSettings: (uid: string) => ["userSettings", uid] as const,
  profiles: (uid: string) => ["profiles", uid] as const,
  teamMembers: (uid: string) => ["teamMembers", uid] as const,

  // ── Budget domain ────────────────────────────────────────────────────────
  budgetTemplates: (profileId: string) => ["budgetTemplates", profileId] as const,
  budgetCalculator: (eventId: string, profileId: string) => ["budgetCalculator", eventId, profileId] as const,

  // ── Search ───────────────────────────────────────────────────────────────
  artistSearch: (term: string, open: boolean) => ["artistSearch", term, open] as const,

  // ── Booking requests ─────────────────────────────────────────────────────
  bookingRequests: (filters?: Record<string, unknown>) => ["bookingRequests", filters ?? {}] as const,
  bookingRequestForEvent: (eventId: string) => ["bookingRequestForEvent", eventId] as const,

  // Settlement activity log
  settlementActivity: (eventId: string) => ["settlementActivity", eventId] as const,

  // Event activity log
  eventActivity: (eventId: string) => ["eventActivity", eventId] as const,

  // ── Invitation codes ────────────────────────────────────────────────────
  invitationCode: (code: string) => ["invitationCode", code] as const,
  myInvitationCodes: (uid: string) => ["myInvitationCodes", uid] as const,
  adminInvitationCodes: (filters?: Record<string, unknown>) => ["adminInvitationCodes", filters ?? {}] as const,
  isAdmin: (uid: string) => ["isAdmin", uid] as const,
} as const;
