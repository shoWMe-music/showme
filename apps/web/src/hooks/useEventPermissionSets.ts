import { useGetApiV1EventsIdPermissionSets } from "@showme/api-client";
import { confersAdminAuthority } from "@showme/shared";

/**
 * The permission sets that may be put on a participant of this event.
 *
 * There was no route for this, and the gap shaped two screens badly. The invite
 * and edit panels had to be handed a single `fullControlPermissionSetId` read off
 * the HOST's own participant row — the only admin-grade bundle the app could name
 * — and then decide who had full control by comparing set IDS against it. Two
 * different rows can carry identical capabilities, so the seeded co-host
 * (Northlight Presents, holding its own `operator_full` set) was labelled
 * "Standard for the role" while having exactly the authority that denies
 * (ClickUp 86cbazcc7, item 2).
 *
 * Authority is what a set GRANTS. `confersAdminAuthority` is `@showme/shared`'s,
 * the same predicate the API charges the `grant_admin` entitlement on, so the
 * panel and the route cannot disagree about which grant costs money.
 */
export interface EventPermissionSet {
  id: string;
  name: string;
  capabilities: string[];
  isPreset: boolean;
  /** Holding this set makes someone an administrator of the event. */
  isAdminGrade: boolean;
}

export interface EventPermissionSetsView {
  sets: EventPermissionSet[];
  /**
   * The set "Full control" grants — the first admin-grade one on offer, preferring
   * a system preset so every event reaches for the same bundle rather than
   * whichever custom set an operator happened to create first. Null when the
   * caller may not read the list, which hides the option rather than offering a
   * grant that cannot be made.
   */
  fullControlSet: EventPermissionSet | null;
  isPending: boolean;
}

/**
 * @param canManage The caller holds `participants.manage`. The route requires it,
 *   so asking without it would spend a request on a guaranteed 403.
 */
export function useEventPermissionSets(
  eventId: string,
  canManage: boolean,
): EventPermissionSetsView {
  const query = useGetApiV1EventsIdPermissionSets(eventId, {
    query: { enabled: canManage && eventId !== "" },
  });

  const sets: EventPermissionSet[] = (query.data ?? []).map((set) => ({
    ...set,
    isAdminGrade: confersAdminAuthority(set.capabilities),
  }));

  const adminGrade = sets.filter((set) => set.isAdminGrade);
  const fullControlSet = adminGrade.find((set) => set.isPreset) ?? adminGrade[0] ?? null;

  return { sets, fullControlSet, isPending: query.isPending && canManage };
}
