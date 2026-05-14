import { eventPersonalBudgetDocId } from "@/lib/profiles";
import {
  DEFAULT_COLLABORATOR_PERMISSION,
  type CollaboratorPermission,
  type Event,
  type EventCollaborator,
  type EventCollaboratorRole,
  type EventStatus,
} from "@/lib/models";
import type { OperatorRole, SharedProfile } from "@/lib/user-context";
import { operatorRoleLabels } from "@/lib/user-context";

/** Profiles that may create events (paid gating can narrow this later). */
export const EVENT_CREATOR_PROFILE_SLOTS: readonly OperatorRole[] = [
  "venue",
  "organizer",
  "promoter",
  "festival",
] as const;

/**
 * The slotted profiles dict only holds profiles you own — not ones you're
 * an admin/editor of. Pass the flat `useAllProfiles()` array so a user
 * who's been invited onto a venue's team can still create events.
 */
export function canUserCreateEventsWithProfiles(
  profiles: readonly SharedProfile[],
): boolean {
  const creatorRoles = new Set<string>(EVENT_CREATOR_PROFILE_SLOTS);
  return profiles.some(
    (p) => p.role && creatorRoles.has(p.role) && Boolean(p.name?.trim()),
  );
}

export function canTogglePublishedTo(
  event: Pick<Event, "published" | "eventStatus">,
  nextPublished: boolean,
): boolean {
  if (!nextPublished) return true;
  return event.eventStatus === "confirmed";
}

export function trySetPublished(
  event: Pick<Event, "published" | "eventStatus">,
  nextPublished: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (!canTogglePublishedTo(event, nextPublished)) {
    return { ok: false, reason: "Only confirmed events can be published." };
  }
  return { ok: true };
}

export function canTransitionEventStatus(
  current: EventStatus,
  next: EventStatus,
): boolean {
  const validTransitions: Record<EventStatus, readonly EventStatus[]> = {
    draft:     ["suggested", "cancelled"],
    suggested: ["pending", "on_hold", "cancelled", "draft"],
    pending:   ["confirmed", "on_hold", "cancelled", "suggested"],
    on_hold:   ["pending", "confirmed", "cancelled"],
    confirmed: ["concluded", "cancelled", "on_hold"],
    concluded: [],
    cancelled: [],
  };
  return (validTransitions[current] as readonly string[]).includes(next);
}

export function isPrimaryEventOwner(
  event: Pick<Event, "primary_owner_uid" | "owner_uid"> | undefined,
  uid: string,
): boolean {
  if (!event || !uid) return false;
  const primary = event.primary_owner_uid || event.owner_uid;
  return Boolean(primary && primary === uid);
}

/**
 * Mirrors the `hasEventAccess` Firestore rule for client-side gating. The rule
 * granting public read for `published && confirmed` events is intentional (it
 * powers /event/$id and Share & Export) — but it means the *manager* page must
 * check access itself, since a stranger with the URL would otherwise see the
 * full event UI for any published+confirmed event.
 *
 * A user has access if any of:
 *   - their uid is in `accessUids` (denormalized)
 *   - their uid is the legacy `owner_uid`
 *   - they're a member of `hostProfileId` or `performerProfileId`
 *   - their uid is in legacy `participant_uids`
 */
export function userHasEventAccess(
  event: Pick<
    Event,
    "accessUids" | "owner_uid" | "hostProfileId" | "performerProfileId" | "participant_uids"
  > | undefined | null,
  uid: string | undefined,
  userProfileIds: readonly string[],
): boolean {
  if (!event || !uid) return false;
  if (event.accessUids?.includes(uid)) return true;
  if (event.owner_uid === uid) return true;
  if (event.hostProfileId && userProfileIds.includes(event.hostProfileId)) return true;
  if (event.performerProfileId && userProfileIds.includes(event.performerProfileId)) return true;
  if (event.participant_uids?.includes(uid)) return true;
  return false;
}

/** Budget planner: uid in accessUids, legacy primary owner, or event collaborator with a core economics / admin role. */
export function canAccessEventBudget(
  event: Pick<Event, "primary_owner_uid" | "owner_uid" | "accessUids" | "participant_roles"> | undefined,
  uid: string | undefined,
): boolean {
  if (!event || !uid) return false;
  if (event.accessUids?.includes(uid)) return true;
  if (isPrimaryEventOwner(event, uid)) return true;
  const role = event.participant_roles?.[uid];
  return Boolean(role && roleCanManageEventCore(role));
}

/**
 * Doc ids for `events/{eventId}/budgets/{id}`.
 * - One worksheet per operator profile slot you own (venue / organizer / promoter / festival).
 * - Profile co-admins use the same doc id as the profile owner (enforced in Firestore rules).
 * - With no named profiles, a uid-keyed personal worksheet is offered.
 */
export function budgetProfileDocIdsForEvent(
  event: Pick<Event, "primary_owner_uid" | "owner_uid" | "hostProfileId" | "accessProfileIds"> | undefined,
  uid: string,
  profiles: Record<string, SharedProfile>,
): { id: string; label: string }[] {
  if (!event || !uid) return [];

  const primary =
    (typeof event.primary_owner_uid === "string" && event.primary_owner_uid) ||
    (typeof event.owner_uid === "string" && event.owner_uid) ||
    "";
  const isPrimaryOwner = primary === uid;

  // Profile IDs that are connected to this event
  const eventProfileIds = new Set<string>();
  if (event.hostProfileId) eventProfileIds.add(event.hostProfileId);
  if (event.accessProfileIds) event.accessProfileIds.forEach((id) => eventProfileIds.add(id));

  const seen = new Set<string>();
  const out: { id: string; label: string }[] = [];
  const push = (id: string, label: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label });
  };

  // Show profiles the user owns that are connected to this event.
  // Primary owners always see their profiles (handles events created before accessProfileIds existed).
  let myProfileRows = 0;
  for (const slot of EVENT_CREATOR_PROFILE_SLOTS) {
    const p = profiles[slot];
    if (p?.name?.trim() && p.id && (eventProfileIds.has(p.id) || isPrimaryOwner)) {
      push(p.id, `${operatorRoleLabels[slot]} (your profile)`);
      myProfileRows += 1;
    }
  }
  if (myProfileRows === 0) {
    push(eventPersonalBudgetDocId(uid), "Personal worksheet (this event)");
  }

  return out;
}

export function roleCanManageEventCore(role: EventCollaboratorRole): boolean {
  return role === "admin" || role === "venue" || role === "promoter" || role === "organizer" || role === "festival";
}

export function roleCanEditPerformersMaterials(role: EventCollaboratorRole): boolean {
  return role === "performer" || role === "admin";
}

export function roleCanManageCollaborators(role: EventCollaboratorRole): boolean {
  return role === "admin";
}

/**
 * True when one of the user's performer profiles matches the event's
 * performerProfileId (single-performer event). For multi-performer parents,
 * pass `childPerformerProfileIds` from the loaded child events.
 *
 * The user is NOT the performer if they are the event host, even if they also
 * have a performer profile that happens to match.
 */
export function userIsEventPerformer(
  event: Pick<Event, "performerProfileId" | "hostProfileId" | "isMultiPerformer"> | undefined | null,
  profiles: SharedProfile[],
  childPerformerProfileIds: string[] = [],
): boolean {
  if (!event) return false;
  const myArtistProfileIds = profiles
    .filter((p) => p.role === "performer" && p.id)
    .map((p) => p.id!);
  if (myArtistProfileIds.length === 0) return false;
  const myProfileIds = profiles.map((p) => p.id).filter(Boolean) as string[];
  if (event.hostProfileId && myProfileIds.includes(event.hostProfileId)) return false;
  if (event.performerProfileId) {
    return myArtistProfileIds.includes(event.performerProfileId);
  }
  if (event.isMultiPerformer) {
    return childPerformerProfileIds.some((pid) => myArtistProfileIds.includes(pid));
  }
  return false;
}

/**
 * Resolve the profile name the user is acting as for a given event.
 * Matches user profiles against the event's accessProfileIds / hostProfileId.
 * Returns the profile name or undefined if no match.
 */
export function resolveActingProfileName(
  event: Pick<Event, "hostProfileId" | "accessProfileIds"> | undefined | null,
  profiles: Record<string, SharedProfile>,
): string | undefined {
  if (!event) return undefined;

  // Check hostProfileId first
  for (const profile of Object.values(profiles)) {
    if (profile.id === event.hostProfileId && profile.name?.trim()) return profile.name.trim();
  }
  // Then fall back to first match in accessProfileIds
  for (const profile of Object.values(profiles)) {
    if (profile.id && event.accessProfileIds?.includes(profile.id) && profile.name?.trim()) {
      return profile.name.trim();
    }
  }
  return undefined;
}

/**
 * Resolve the profile ID the user is acting as for a given event.
 * Returns the first user profile whose ID appears in the event's
 * hostProfileId or accessProfileIds, or undefined if none match.
 */
export function resolveActingProfileId(
  event: Pick<Event, "hostProfileId" | "accessProfileIds"> | undefined | null,
  profiles: Record<string, SharedProfile>,
): string | undefined {
  if (!event) return undefined;

  // Check hostProfileId first
  for (const profile of Object.values(profiles)) {
    if (profile.id === event.hostProfileId) return profile.id;
  }
  // Then fall back to first match in accessProfileIds
  for (const profile of Object.values(profiles)) {
    if (profile.id && event.accessProfileIds?.includes(profile.id)) {
      return profile.id;
    }
  }
  return undefined;
}

// ── Collaborator permission resolution ───────────────────────────────────────

/**
 * Edit-power tiers, ranked high → low. The order is meaningful: when a user
 * has multiple collaborator rows on the same event (rare but possible — e.g.
 * invited under multiple roles), we keep the highest tier.
 */
const PERMISSION_RANK: Record<CollaboratorPermission, number> = {
  admin: 3,
  editor: 2,
  view_only: 1,
};

/** Higher of two permissions (used to merge multi-row matches). */
function maxPermission(a: CollaboratorPermission, b: CollaboratorPermission): CollaboratorPermission {
  return PERMISSION_RANK[a] >= PERMISSION_RANK[b] ? a : b;
}

/**
 * Resolve the effective edit-power tier for a user on an event.
 *
 * Returns:
 *   - "admin"     — host profile member, OR a collaborator row with permission=admin
 *   - "editor"    — matching collaborator row with permission=editor (or missing/legacy)
 *   - "view_only" — matching collaborator row with permission=view_only
 *   - "none"      — no membership; should not have access at all
 *
 * Legacy/missing `permission` field defaults to "editor" so pre-permissions
 * collaborators don't get silently downgraded. Admins can re-classify them
 * from the CollaboratorsTab.
 */
export function getEventPermission(
  event: Pick<Event, "hostProfileId"> | undefined | null,
  userProfiles: readonly SharedProfile[],
  collaborators: readonly EventCollaborator[],
  uid: string | undefined,
): CollaboratorPermission | "none" {
  if (!event || !uid) return "none";

  const userProfileIds = new Set(
    userProfiles.map((p) => p.id).filter((id): id is string => Boolean(id)),
  );

  // Host profile members are implicit admins. This matches the host card's
  // power in the UI and the rule helper `isHostAdmin`.
  if (event.hostProfileId && userProfileIds.has(event.hostProfileId)) {
    return "admin";
  }

  let best: CollaboratorPermission | undefined;
  for (const c of collaborators) {
    const isMatch =
      (c.userUid && c.userUid === uid) ||
      (c.profileId && userProfileIds.has(c.profileId));
    if (!isMatch) continue;
    const perm = c.permission ?? DEFAULT_COLLABORATOR_PERMISSION;
    best = best ? maxPermission(best, perm) : perm;
  }

  return best ?? "none";
}

/** True when the permission tier allows event edits at all (anything except view_only). */
export function canEditEvent(perm: CollaboratorPermission | "none"): boolean {
  return perm === "admin" || perm === "editor";
}

/**
 * True when the permission tier may edit financial sections (deal, settlement,
 * revenue, budget). Only admins can.
 */
export function canEditFinancial(perm: CollaboratorPermission | "none"): boolean {
  return perm === "admin";
}

/** True when the permission tier may invite/remove/edit other collaborators. */
export function canManageCollaborators(perm: CollaboratorPermission | "none"): boolean {
  return perm === "admin";
}
