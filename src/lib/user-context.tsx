/* user-context v6 – TanStack Query */
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Megaphone, CalendarDays, Music, Tent, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { queryKeys } from "@/lib/queries";
import { fetchUserSettings, upsertUserSettings, fetchProfiles, upsertProfile, fetchAllProfileTeamMembers, upsertProfileTeamMember, deleteProfileTeamMember } from "./db";
import type { UserSettings, DateFormatOption, TimeFormatOption } from "./db";
import { useToast } from "@/hooks/use-toast";

const SAVE_DEBOUNCE_MS = 800;
const STALE_TIME = 5 * 60 * 1000; // 5 minutes

export type OperatorRole = "venue" | "promoter" | "organizer" | "performer" | "festival";

export const operatorRoleLabels: Record<OperatorRole, string> = {
  venue: "Venue",
  promoter: "Promoter",
  organizer: "Event Organizer / Producer",
  performer: "Performer",
  festival: "Festival",
};

export const operatorRoleDescriptions: Record<OperatorRole, string> = {
  venue: "Manage your spaces, bookings, and operations",
  promoter: "Plan, execute, and coordinate events",
  organizer: "Produce and oversee event logistics",
  performer: "Manage your bookings, riders, and deals",
  festival: "Organize multi-stage, multi-performer festivals",
};

export const operatorRoleIcons: Record<OperatorRole, LucideIcon> = {
  venue: Building2,
  promoter: Megaphone,
  organizer: CalendarDays,
  performer: Music,
  festival: Tent,
};

export interface SubVenue {
  id: string;
  name: string;
  type: "room" | "stage" | "venue";
  capacity?: number;
  sittingCapacity?: number;
  standingCapacity?: number;
  sittingNotes?: string;
  standingNotes?: string;
}

/**
 * A named capacity setup for a venue profile (e.g. "All Standing", "Seated Banquet").
 * One setup may be marked `isMain` — that one surfaces as the headline capacity
 * shown elsewhere in the app (event creation defaults, public profile, etc.).
 *
 * Coordinated shape between the venue profile editor (Lane B) and event-manager
 * capacity-defaulting (Lane C). Do not rename fields without updating both.
 */
export interface VenueCapacitySetup {
  id: string;
  name: string;
  capacityStanding?: number;
  capacitySitting?: number;
  isMain?: boolean;
  notes?: string;
}

export interface ProfileDocument {
  id: string;
  name: string;
  url: string;
  type: "tech_rider" | "hospitality_rider" | "other";
}

export interface ProfileLocation {
  id: string;
  label: string;              // "Home base", "EU Summer Tour"
  city: string;
  country: string;
  street?: string;
  postcode?: string;
  coordinates?: { lat: number; lng: number };
  from?: string;              // ISO date — omit for permanent locations
  to?: string;                // ISO date — omit for permanent locations
}

/** Returns the primary (first) location, or undefined. */
export function getPrimaryLocation(locations?: ProfileLocation[]): ProfileLocation | undefined {
  return locations?.[0];
}

/** Returns the location active on a given date, falling back to primary ([0]). */
export function getLocationForDate(locations: ProfileLocation[] | undefined, date: string): ProfileLocation | undefined {
  if (!locations?.length) return undefined;
  const match = locations.find(
    (l) => l.from && l.to && l.from <= date && date <= l.to,
  );
  return match ?? locations[0];
}

/** Formats a ProfileLocation as a human-readable string. */
export function formatLocation(loc: ProfileLocation | undefined): string {
  if (!loc) return "";
  return [loc.street, [loc.postcode, loc.city].filter(Boolean).join(" "), loc.country]
    .filter(Boolean)
    .join(", ");
}

export interface SharedProfile {
  /** Firestore document ID — injected at load time from the document snapshot. */
  id?: string;
  /** UID of the Firestore user who owns this profile — stored in the document body. */
  owner_uid?: string;
  role: OperatorRole;
  name: string;
  locations: ProfileLocation[];
  bio: string;
  genres: string[];
  socialLinks: { platform: string; url: string }[];
  capacity?: number;
  setupType?: string;
  setupSize?: number;
  setups?: { name: string; headcount: number }[];
  bannerUrl?: string;
  avatarUrl?: string;
  photos?: string[];
  videos?: string[];
  amenities?: string[];
  dealTypes?: string[];
  spotifyUrl?: string;
  coordinates?: { lat: number; lng: number };
  address?: string;
  slug?: string;
  isPublic?: boolean;
  updatedAt?: string;
  created: boolean;
  subVenues?: SubVenue[];
  /**
   * Venue-only: customizable capacity setups (e.g. "All Standing", "Seated Banquet").
   * The setup flagged `isMain` is the headline capacity defaulted into new events.
   */
  venueCapacitySetups?: VenueCapacitySetup[];
  documents?: ProfileDocument[];
  performanceBonuses?: { ticketThreshold: number; bonusAmount: number; bonusType: "flat" | "percent" }[];
  cateringNotes?: string;
  accommodationNotes?: string;
  /**
   * Whether this profile has been claimed by an account.
   * `true` (or undefined) → claimed; `false` → un-acquired placeholder created
   * by an organizer to attach a not-yet-on-platform performer/venue to an event.
   * Un-acquired profiles get claimed when the represented party signs up and
   * accepts the invite to take ownership.
   */
  acquired?: boolean;
}

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  initials: string;
  roles: OperatorRole[];
  defaultRoles: OperatorRole[];
  currency: string;
  defaultRole?: OperatorRole;
  companyName: string;
  avatarUrl?: string;
  dateFormat: DateFormatOption;
  timeFormat: TimeFormatOption;
}

export const emptyWorkspaceUser: WorkspaceUser = {
  id: "",
  name: "",
  email: "",
  initials: "",
  roles: [],
  defaultRoles: [],
  currency: "EUR",
  companyName: "",
  dateFormat: "YYYY-MM-DD",
  timeFormat: "24h",
};

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: "active" | "inactive";
  phone?: string;
  notes?: string;
  /** The profile this member belongs to — set when loaded from Firestore. */
  profileId?: string;
}

interface UserContextValue {
  currentUser: WorkspaceUser;
  updateRoles: (roles: OperatorRole[]) => void;
  updateUser: (updates: Partial<WorkspaceUser>) => void;
  /** Update local state without triggering a Firestore save. Use after a manual write. */
  updateUserLocal: (updates: Partial<WorkspaceUser>) => void;
  setDefaultRole: (role: OperatorRole) => void;
  isOperator: boolean;
  canCreate: boolean;
  canApprove: boolean;
  profiles: Record<string, SharedProfile>;
  setProfiles: React.Dispatch<React.SetStateAction<Record<string, SharedProfile>>>;
  teamMembers: TeamMember[];
  setTeamMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
  addTeamMember: (member: TeamMember, profileId: string) => void;
  updateTeamMember: (member: TeamMember) => void;
  addMemberToProfile: (memberId: string, profileId: string) => void;
  removeTeamMember: (id: string, profileId: string) => void;
  saveProfile: (role: string, profile: SharedProfile) => void;
  customRoles: string[];
  addCustomRole: (role: string) => void;
  removeCustomRole: (role: string) => void;
  loaded: boolean;
}

const UserContext = createContext<UserContextValue | null>(null);

const DEFAULT_ROLES = ["Admin", "Member", "Sound Engineer", "Light Engineer", "Tour Manager", "Stage Manager", "Production", "Security", "Catering"];

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { user: firebaseUser, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const uid = firebaseUser?.uid ?? "";

  const [currentUser, setCurrentUser] = useState<WorkspaceUser>(emptyWorkspaceUser);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [customRoles, setCustomRoles] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teamMembersRef = useRef<TeamMember[]>([]);

  const queriesEnabled = !!uid && !authLoading;

  // ── 1. User settings query ───────────────────────────────────────────────
  const settingsQuery = useQuery({
    queryKey: queryKeys.userSettings(uid),
    queryFn: fetchUserSettings,
    enabled: queriesEnabled,
    staleTime: STALE_TIME,
  });

  // ── 2. Profiles query ────────────────────────────────────────────────────
  const profilesQuery = useQuery({
    queryKey: queryKeys.profiles(uid),
    queryFn: fetchProfiles,
    enabled: queriesEnabled,
    staleTime: STALE_TIME,
  });

  // ── 3. Team members query — depends on profiles result ───────────────────
  const fetchedProfiles = profilesQuery.data?.slotted ?? {};
  const profilesReady = profilesQuery.isSuccess;

  const teamMembersQuery = useQuery({
    queryKey: queryKeys.teamMembers(uid),
    queryFn: () => fetchAllProfileTeamMembers(uid, fetchedProfiles),
    enabled: queriesEnabled && profilesReady,
    staleTime: STALE_TIME,
  });

  // ── Apply settings query result to local state ───────────────────────────
  useEffect(() => {
    if (firebaseUser) {
      setCurrentUser(prev => ({
        ...prev,
        id: firebaseUser.uid,
        email: firebaseUser.email || prev.email,
        name: firebaseUser.displayName || prev.name,
      }));
    }
  }, [firebaseUser]);

  useEffect(() => {
    const settings: UserSettings | null | undefined = settingsQuery.data;
    if (!settings) return;
    const roles = (settings.roles as OperatorRole[]) || [];
    // Firebase Auth is the source of truth for email — if the user verified an
    // email change in another tab/inbox, auth.email is fresh and Firestore is
    // stale. Prefer auth, and write the drift back to Firestore.
    const authEmail = firebaseUser?.email || "";
    const resolvedEmail = authEmail || settings.email || "";
    if (authEmail && settings.email && authEmail.toLowerCase() !== settings.email.toLowerCase()) {
      upsertUserSettings({ email: authEmail }).catch((err) => {
        console.error("[user-context] failed to sync auth email to settings:", err);
      });
    }
    setCurrentUser(prev => ({
      ...prev,
      name: settings.name || prev.name,
      email: resolvedEmail || prev.email,
      initials: settings.initials || prev.initials,
      roles,
      defaultRoles: roles,
      currency: settings.currency || prev.currency,
      defaultRole: (settings.default_role || undefined) as OperatorRole | undefined,
      companyName: settings.company_name || prev.companyName,
      avatarUrl: settings.avatarUrl,
      dateFormat: settings.dateFormat || prev.dateFormat,
      timeFormat: settings.timeFormat || prev.timeFormat,
    }));
  }, [settingsQuery.data, firebaseUser?.email]);

  // Derive profiles synchronously from the query, no useState mirror. The
  // previous mirror lagged one render behind because useEffect runs after
  // commit — so the first paint after the query resolved would briefly show
  // an empty profiles map, flashing "No profiles yet" before the effect ran.
  const profiles = useMemo<Record<string, SharedProfile>>(() => {
    const slotted = profilesQuery.data?.slotted;
    if (!slotted) return {};
    return normalizeLegacyProfiles(slotted);
  }, [profilesQuery.data?.slotted]);

  // Optimistic-update API for callers (saveProfile, AddVenueDialog, …).
  // Updates the query cache directly so the next render reads the new shape
  // without going through Firestore.
  const setProfiles = useCallback<
    React.Dispatch<React.SetStateAction<Record<string, SharedProfile>>>
  >(
    (action) => {
      queryClient.setQueryData<{ slotted: Record<string, SharedProfile>; all: SharedProfile[] }>(
        queryKeys.profiles(uid),
        (prev) => {
          const prevSlotted = normalizeLegacyProfiles(prev?.slotted ?? {});
          const nextSlotted =
            typeof action === "function"
              ? (action as (
                  s: Record<string, SharedProfile>,
                ) => Record<string, SharedProfile>)(prevSlotted)
              : action;
          // Re-derive `all` so access matching stays in sync. Shared profiles
          // owned by other users only appear in `all`, never in slotted —
          // identify them as the prev.all entries whose ids weren't in
          // prev.slotted, then concat with the new owned slot values. This
          // makes optimistic delete (drop a slot) correctly drop the profile
          // from `all` too, while shared profiles are preserved across the
          // mutation.
          const prevSlotIds = new Set(
            Object.values(prevSlotted)
              .map((p) => p.id)
              .filter((id): id is string => !!id),
          );
          const sharedOnly = (prev?.all ?? []).filter(
            (p) => p.id && !prevSlotIds.has(p.id),
          );
          return {
            slotted: nextSlotted,
            all: [...Object.values(nextSlotted), ...sharedOnly],
          };
        },
      );
    },
    [queryClient, uid],
  );

  useEffect(() => {
    const dbTeam = teamMembersQuery.data;
    if (!dbTeam) return;
    if (dbTeam.length > 0) {
      setTeamMembers(dbTeam);
      teamMembersRef.current = dbTeam;
    }
  }, [teamMembersQuery.data]);

  // ── Set loaded once settings + profiles are done (team loads in background) ─
  // Unauthenticated visitors (no uid) have nothing to load — flip loaded=true
  // immediately so public pages don't get stuck on a loading skeleton waiting
  // for queries that will never run.
  useEffect(() => {
    if (!queriesEnabled) {
      if (!authLoading) setLoaded(true);
      return;
    }
    const settingsDone = settingsQuery.isSuccess || settingsQuery.isError;
    const profilesDone = profilesQuery.isSuccess || profilesQuery.isError;
    if (settingsDone && profilesDone) {
      setLoaded(true);
    }
  }, [queriesEnabled, authLoading, settingsQuery.isSuccess, settingsQuery.isError, profilesQuery.isSuccess, profilesQuery.isError]);

  // ── Debounced Firestore settings save ────────────────────────────────────
  const debouncedSaveSettings = useCallback((user: WorkspaceUser) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      upsertUserSettings({
        name: user.name, email: user.email, initials: user.initials,
        roles: user.roles, currency: user.currency,
        defaultRole: user.defaultRole, companyName: user.companyName,
        avatarUrl: user.avatarUrl,
        dateFormat: user.dateFormat, timeFormat: user.timeFormat,
      });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // ── Mutations ────────────────────────────────────────────────────────────

  const saveProfileMutation = useMutation({
    mutationFn: ({ slot, profile }: { slot: string; profile: SharedProfile }) =>
      upsertProfile(slot, profile),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles(uid) });
    },
    onError: (err) => {
      console.error("[saveProfileMutation] failed:", err);
      toast({ title: "Failed to save profile", description: "Changes could not be saved.", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles(uid) });
    },
  });

  const addTeamMemberMutation = useMutation({
    mutationFn: ({ profileId, member }: { profileId: string; member: TeamMember }) =>
      upsertProfileTeamMember(profileId, member),
    onError: () => {
      toast({ title: "Failed to add team member", description: "Changes could not be saved.", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(uid) });
    },
  });

  const updateTeamMemberMutation = useMutation({
    mutationFn: ({ member, entries }: { member: TeamMember; entries: TeamMember[] }) =>
      Promise.all(
        entries.map(e => upsertProfileTeamMember(e.profileId!, { ...member, profileId: e.profileId })),
      ),
    onError: () => {
      toast({ title: "Failed to update team member", description: "Changes could not be saved.", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(uid) });
    },
  });

  const addMemberToProfileMutation = useMutation({
    mutationFn: ({ profileId, entry }: { profileId: string; entry: TeamMember }) =>
      upsertProfileTeamMember(profileId, entry),
    onError: () => {
      toast({ title: "Failed to add member to profile", description: "Changes could not be saved.", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(uid) });
    },
  });

  const removeTeamMemberMutation = useMutation({
    mutationFn: ({ profileId, memberId }: { profileId: string; memberId: string }) =>
      deleteProfileTeamMember(profileId, memberId),
    onError: () => {
      toast({ title: "Failed to remove team member", description: "Changes could not be saved.", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(uid) });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (user: WorkspaceUser) =>
      upsertUserSettings({
        name: user.name, email: user.email, initials: user.initials,
        roles: user.roles, currency: user.currency,
        defaultRole: user.defaultRole, companyName: user.companyName,
        dateFormat: user.dateFormat, timeFormat: user.timeFormat,
      }),
    onError: () => {
      toast({ title: "Failed to save settings", description: "Changes could not be saved.", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.userSettings(uid) });
    },
  });

  // ── Mutation callbacks (unchanged public API) ────────────────────────────
  const updateRoles = useCallback((roles: OperatorRole[]) => {
    setCurrentUser(prev => {
      const updated = { ...prev, roles, defaultRoles: roles };
      debouncedSaveSettings(updated);
      return updated;
    });
  }, [debouncedSaveSettings]);

  const updateUser = useCallback((updates: Partial<WorkspaceUser>) => {
    setCurrentUser(prev => {
      const updated = { ...prev, ...updates };
      debouncedSaveSettings(updated);
      return updated;
    });
  }, [debouncedSaveSettings]);

  const updateUserLocal = useCallback((updates: Partial<WorkspaceUser>) => {
    setCurrentUser(prev => ({ ...prev, ...updates }));
  }, []);

  const setDefaultRole = useCallback((role: OperatorRole) => {
    setCurrentUser(prev => {
      const updated = { ...prev, defaultRole: role };
      debouncedSaveSettings(updated);
      return updated;
    });
  }, [debouncedSaveSettings]);

  const saveProfile = useCallback((slot: string, profile: SharedProfile) => {
    setProfiles(prev => ({ ...prev, [slot]: profile }));
    saveProfileMutation.mutate({ slot, profile });
  }, [saveProfileMutation]);

  const addTeamMember = useCallback((member: TeamMember, profileId: string) => {
    const withProfile = { ...member, profileId };
    setTeamMembers(prev => {
      const updated = [...prev, withProfile];
      teamMembersRef.current = updated;
      return updated;
    });
    addTeamMemberMutation.mutate({ profileId, member: withProfile });
  }, [addTeamMemberMutation]);

  const updateTeamMember = useCallback((member: TeamMember) => {
    const existingEntries = teamMembersRef.current.filter(m => m.id === member.id && m.profileId);
    setTeamMembers(prev => {
      const updated = prev.map(m =>
        m.id === member.id ? { ...member, profileId: m.profileId } : m,
      );
      teamMembersRef.current = updated;
      return updated;
    });
    updateTeamMemberMutation.mutate({ member, entries: existingEntries });
  }, [updateTeamMemberMutation]);

  const addMemberToProfile = useCallback((memberId: string, profileId: string) => {
    const source = teamMembersRef.current.find(m => m.id === memberId);
    if (!source) return;
    if (teamMembersRef.current.some(m => m.id === memberId && m.profileId === profileId)) return;
    const entry = { ...source, profileId };
    setTeamMembers(prev => {
      const updated = [...prev, entry];
      teamMembersRef.current = updated;
      return updated;
    });
    addMemberToProfileMutation.mutate({ profileId, entry });
  }, [addMemberToProfileMutation]);

  const removeTeamMember = useCallback((id: string, profileId: string) => {
    setTeamMembers(prev => {
      const updated = prev.filter(m => !(m.id === id && m.profileId === profileId));
      teamMembersRef.current = updated;
      return updated;
    });
    removeTeamMemberMutation.mutate({ profileId, memberId: id });
  }, [removeTeamMemberMutation]);

  const addCustomRole = useCallback((role: string) => {
    setCustomRoles(prev => {
      if (prev.includes(role)) return prev;
      return [...prev, role];
    });
  }, []);

  const removeCustomRole = useCallback((role: string) => {
    setCustomRoles(prev => prev.filter(r => r !== role));
  }, []);

  // Keep saveSettingsMutation in scope so it isn't tree-shaken; the debounced
  // path still uses the raw upsertUserSettings call for batching, while
  // direct callers (updateUser / updateRoles / setDefaultRole) trigger through
  // debouncedSaveSettings.  If you want the mutation path for those too, swap
  // debouncedSaveSettings to call saveSettingsMutation.mutate instead.
  void saveSettingsMutation;

  const allRoles = [...DEFAULT_ROLES, ...customRoles];

  return (
    <UserContext.Provider value={{
      currentUser, updateRoles, updateUser, updateUserLocal, setDefaultRole,
      isOperator: true, canCreate: true, canApprove: true,
      profiles, setProfiles,
      teamMembers, setTeamMembers,
      addTeamMember, updateTeamMember, addMemberToProfile, removeTeamMember,
      saveProfile,
      customRoles: allRoles,
      addCustomRole, removeCustomRole,
      loaded,
    }}>
      {children}
    </UserContext.Provider>
  );
}

/**
 * Read-side compat for legacy profiles stored with `role: "artist"`.
 * Coerces them to `role: "performer"` so the rest of the app treats them
 * uniformly. The slot key is preserved (e.g. `"artist"` stays `"artist"`)
 * so the user can still locate and delete the phantom record on the
 * Profile Access page.
 */
export function normalizeLegacyProfiles(
  profiles: Record<string, SharedProfile>,
): Record<string, SharedProfile> {
  const out: Record<string, SharedProfile> = {};
  for (const [slot, profile] of Object.entries(profiles)) {
    if ((profile as SharedProfile & { role: string }).role === "artist") {
      out[slot] = { ...profile, role: "performer" };
    } else {
      out[slot] = profile;
    }
  }
  return out;
}

export function getBaseRole(key: string): OperatorRole {
  if (key.startsWith("venue")) return "venue";
  if (key.startsWith("promoter")) return "promoter";
  if (key.startsWith("organizer")) return "organizer";
  if (key.startsWith("performer")) return "performer";
  if (key.startsWith("festival")) return "festival";
  return key as OperatorRole;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
