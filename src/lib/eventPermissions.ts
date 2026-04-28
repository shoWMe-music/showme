import { buildProfileDocId, eventPersonalBudgetDocId } from "@/lib/profiles";
import type { Event, EventCollaboratorRole, EventStatus } from "@/lib/models";
import type { OperatorRole, SharedProfile } from "@/lib/user-context";
import { operatorRoleLabels } from "@/lib/user-context";

/** Profiles that may create events (paid gating can narrow this later). */
export const EVENT_CREATOR_PROFILE_SLOTS: readonly OperatorRole[] = [
  "venue",
  "organizer",
  "promoter",
  "festival",
] as const;

export function canUserCreateEventsWithProfiles(
  profiles: Record<string, SharedProfile>,
): boolean {
  return EVENT_CREATOR_PROFILE_SLOTS.some((slot) => {
    const p = profiles[slot];
    return Boolean(p?.name?.trim());
  });
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

/** Budget planner: primary owner, or event collaborator with a core economics / admin role. */
export function canAccessEventBudget(
  event: Pick<Event, "primary_owner_uid" | "owner_uid" | "participant_roles"> | undefined,
  uid: string | undefined,
): boolean {
  if (!event || !uid) return false;
  if (isPrimaryEventOwner(event, uid)) return true;
  const role = event.participant_roles?.[uid];
  return Boolean(role && roleCanManageEventCore(role));
}

/**
 * Doc ids for `events/{eventId}/budgets/{id}`.
 * - One worksheet per operator profile slot you use (venue / organizer / promoter / festival).
 * - Profile co-admins use the same doc id as the profile owner (enforced in Firestore rules).
 * - With no named profiles, a uid-keyed personal worksheet is offered.
 * - Event admins may open each of the primary owner’s profile-slot worksheets.
 */
export function budgetProfileDocIdsForEvent(
  event: Pick<Event, "primary_owner_uid" | "owner_uid" | "participant_roles"> | undefined,
  uid: string,
  profiles: Record<string, SharedProfile>,
): { id: string; label: string }[] {
  if (!event || !uid) return [];
  const primary =
    (typeof event.primary_owner_uid === "string" && event.primary_owner_uid) ||
    (typeof event.owner_uid === "string" && event.owner_uid) ||
    uid;
  const isEventAdmin = event.participant_roles?.[uid] === "admin";
  const seen = new Set<string>();
  const out: { id: string; label: string }[] = [];
  const push = (id: string, label: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label });
  };

  let myProfileRows = 0;
  for (const slot of EVENT_CREATOR_PROFILE_SLOTS) {
    if (profiles[slot]?.name?.trim()) {
      push(
        buildProfileDocId(uid, slot),
        `${operatorRoleLabels[slot]} (your profile)`,
      );
      myProfileRows += 1;
    }
  }
  if (myProfileRows === 0) {
    push(eventPersonalBudgetDocId(uid), "Personal worksheet (this event)");
  }

  if (isEventAdmin && primary && primary !== uid) {
    for (const slot of EVENT_CREATOR_PROFILE_SLOTS) {
      push(
        buildProfileDocId(primary, slot),
        `${operatorRoleLabels[slot]} (event owner)`,
      );
    }
  }

  if (out.length === 0 && primary) {
    push(buildProfileDocId(primary, "venue"), "Venue (default)");
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
 * Resolve the profile name the user is acting as for a given event.
 * Matches user profiles against the event's accessProfileIds / hostProfileId.
 * Returns the profile name or undefined if no match.
 */
export function resolveActingProfileName(
  event: Pick<Event, "hostProfileId" | "accessProfileIds"> | undefined | null,
  profiles: Record<string, SharedProfile>,
): string | undefined {
  if (!event) return undefined;
  const eventProfileIds = new Set<string>();
  if (event.hostProfileId) eventProfileIds.add(event.hostProfileId);
  if (event.accessProfileIds) event.accessProfileIds.forEach((id) => eventProfileIds.add(id));
  if (eventProfileIds.size === 0) return undefined;

  for (const profile of Object.values(profiles)) {
    if (profile.id && eventProfileIds.has(profile.id) && profile.name?.trim()) {
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
  const eventProfileIds = new Set<string>();
  if (event.hostProfileId) eventProfileIds.add(event.hostProfileId);
  if (event.accessProfileIds) event.accessProfileIds.forEach((id) => eventProfileIds.add(id));
  if (eventProfileIds.size === 0) return undefined;

  for (const profile of Object.values(profiles)) {
    if (profile.id && eventProfileIds.has(profile.id)) {
      return profile.id;
    }
  }
  return undefined;
}
