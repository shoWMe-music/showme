import type { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { resolveImageUrl } from "./image";

type ParticipantRow = typeof schema.eventParticipants.$inferSelect;

/**
 * The joined profile's public face. BOTH picture columns, never just one: since
 * migration 0022 the normal way to have an avatar is to have UPLOADED it
 * (`avatar_file_id`), and `avatar_url` is the legacy external address. A caller
 * that hands over only the second one is telling this serializer that every
 * performer who uploaded a picture has none.
 */
export interface ParticipantProfileFace {
  name: string | null;
  avatarFileId: string | null;
  avatarUrl: string | null;
  /** The public page's address, and whether there IS one.
   *
   * Both are needed together or neither is usable: a slug with `isPublic:false`
   * points at a 404, so a caller that linked on the slug alone would offer a
   * dead door. Carried so a roster face can link to the act's public profile —
   * without them the picture was reachable and the person behind it was not. */
  slug: string | null;
  isPublic: boolean;
}

export interface SerializedParticipant {
  id: string;
  /**
   * NULL once the profile behind this row has been erased (migration 0032). The
   * row stays on the bill under `name`; there is simply no account to link to.
   */
  profileId: string | null;
  /**
   * The participant's display name — the public face (who's on the bill).
   *
   * Taken from the live profile, and falling back to `display_name` for a row
   * whose profile has been erased. That fallback is the entire point of the GDPR
   * purge keeping a name: without it a settled show loses a line off its bill.
   */
  name: string | null;
  avatarUrl: string | null;
  /** Where this face's public page lives, or null when it has none.
   *
   * Resolved here rather than left to the caller: only the serializer knows
   * whether the profile is published, and a link built from a slug alone would
   * point at a 404 for every unpublished act. Null means "draw the face, do not
   * make it a door". */
  publicSlug: string | null;
  role: string;
  status: string;
  performerTag: string | null;
  permissionSetId?: string | null;
  /**
   * The permission set ITSELF, not just its id — operator tier only.
   *
   * A bare id told the UI nothing, so the only way to ask "does this collaborator
   * have full control?" was to compare their set id against the HOST's. That is a
   * comparison of rows, not of authority, and it got the seeded co-host wrong:
   * Northlight Presents holds set `c6`, a different row carrying identical
   * `operator_full` capabilities, and was labelled "Standard for the role" while
   * having exactly the authority the label denies (ClickUp 86cbazcc7, item 2).
   *
   * Absent when the participant holds no set (standard for the role), and absent
   * for every non-operator caller — the set is operator-tier, and naming it would
   * tell an arm's-length party how the host's access is arranged.
   */
  permissionSet?: SerializedPermissionSet;
  /**
   * For a removed row: what its status was before the removal, so a restore can
   * put back the fact rather than guessing at one. Null on a row that is not
   * removed, and on one removed before the column existed — read either as "no
   * undo offered here".
   */
  statusBeforeRemoval?: string | null;
  details?: unknown;
}

/** A permission set as a roster row names it: what it is, and what it grants. */
export interface SerializedPermissionSet {
  id: string;
  name: string;
  /** What the set actually allows. The UI describes authority from this, never
   *  by comparing ids — see `permissionSet` above for what that cost. */
  capabilities: string[];
  /** True for a system preset (`profile_id` IS NULL), available to everyone. */
  isPreset: boolean;
}

/**
 * Only the managing operators may see the roster's internals. `participants.manage`
 * is the direct signal; `budget.view` is the read-side operator signal (a co-host
 * granted budget visibility is still an operator on the event). Everyone else is an
 * arm's-length party who only sees the public face of each participant.
 */
export function canManageParticipants(capabilities: Set<Capability>): boolean {
  return capabilities.has("participants.manage") || capabilities.has("budget.view");
}

/**
 * The keys of `details` a participant may read on THEIR OWN row.
 *
 * `details` is one jsonb bag holding two different kinds of fact, and the split
 * is what is ADDRESSED TO the participant versus what is the operator's own
 * record of them. `docs/story.md` puts team_and_crew at arm's length — "a service
 * provider paid a fixed fee" who "see the schedule and their own deal, never the
 * budget" — so the terms of the labour are theirs to read and the operator's
 * commentary is not:
 *
 * - `callTime` — the instruction to be in the building at 16:15. Withholding it
 *   from the person being asked to turn up makes the engagement unperformable,
 *   and "they see the schedule" is exactly this fact.
 * - `task` — what they were brought in to do ("Front-of-house sound"). The
 *   service is the definition of the kind; you cannot deliver work nobody told
 *   you about.
 * - `roleLabel` — the function they were placed under ("Stage Manager"). A fact
 *   about them and about nobody else, and the name their own service identity
 *   carries on this event.
 *
 * Everything else stays operator-only, and the default for a key not listed here
 * is operator-only — a bag this loosely typed will grow keys, and a new one must
 * be argued IN rather than leak by omission. Today that means:
 * `privateNote` (the operator's private assessment — the route that writes it
 * deliberately files no activity row so the crew member never learns of it),
 * `payNote` (bookkeeping commentary on the operator's side of the money; the
 * authoritative fee is the DEAL, and a second unauthoritative statement of pay
 * handed to the person being paid would compete with it), `sponsorParticipantId`
 * and `sourceGroupId` (roster provenance naming ANOTHER row and an operator-owned
 * group — each party sees only their slice, and this is not their slice), and
 * `delegatedToAgentProfileId` (live authorization state, which belongs to the
 * representation and not to a jsonb stamp).
 */
const SELF_VISIBLE_DETAIL_KEYS = ["callTime", "task", "roleLabel"] as const;

/**
 * The self-visible slice of `details`, or `undefined` when there is nothing in
 * it. Absent rather than `{}`: no key, no field — a participant with nothing on
 * file reads exactly as they did before this branch existed.
 */
function selfVisibleDetails(details: unknown): Record<string, unknown> | undefined {
  if (details === null || typeof details !== "object" || Array.isArray(details)) return undefined;
  const bag = details as Record<string, unknown>;
  const visible: Record<string, unknown> = {};
  for (const key of SELF_VISIBLE_DETAIL_KEYS) {
    if (bag[key] !== undefined) visible[key] = bag[key];
  }
  return Object.keys(visible).length > 0 ? visible : undefined;
}

/**
 * Shape a participant by the caller's capabilities — the field-level serializer,
 * server-side (not UI hiding). Three tiers, not two:
 *
 * - **Managing operator** — the full row (permission set + the whole `details`
 *   bag, which folds in crew call-time/task/pay notes).
 * - **The participant themselves** — the public face plus the `details` keys that
 *   are about them and addressed to them ({@link SELF_VISIBLE_DETAIL_KEYS}).
 *   Self-visibility is not a promotion: the permission set stays operator-only.
 * - **A third party** — only the public face: who is on the bill, in what role,
 *   at what status. Unchanged.
 *
 * `selfProfileIds` is the caller's FLAT membership set (owned + member-of
 * together), the same set `authorize()` computes standing from — so a manager of
 * the crew member's profile reads the call time exactly as the crew member does.
 * Omitting it degrades to the old two-tier behaviour rather than leaking.
 */
export function serializeParticipant(
  participant: ParticipantRow,
  capabilities: Set<Capability>,
  profile?: ParticipantProfileFace | null,
  imageUrls?: Map<string, string>,
  selfProfileIds?: ReadonlySet<string>,
  /**
   * The row's permission set, when the caller joined it. Optional so the routes
   * that serialize a single just-written participant stay one query — they know
   * the id they wrote and the roster refetch fills in the rest.
   */
  permissionSet?: SerializedPermissionSet | null,
): SerializedParticipant {
  const base: SerializedParticipant = {
    id: participant.id,
    profileId: participant.profileId,
    name: profile?.name ?? participant.displayName ?? null,
    // The same file-then-URL ladder every other read of a profile picture uses
    // (`serializeProfile`), so the roster cannot disagree with the profile page
    // about whose face it has. `imageUrls` is minted per response by the route.
    avatarUrl: profile ? resolveImageUrl(profile.avatarFileId, profile.avatarUrl, imageUrls) : null,
    // Only a PUBLISHED profile gets a slug on the wire. An unpublished one keeps
    // its face on the roster and simply is not a link.
    publicSlug: profile?.isPublic ? (profile.slug ?? null) : null,
    role: participant.role,
    status: participant.status,
    performerTag: participant.performerTag,
  };

  if (canManageParticipants(capabilities)) {
    base.permissionSetId = participant.permissionSetId;
    if (permissionSet) base.permissionSet = permissionSet;
    // Only ever set on a row that is actually removed. Sending it alongside an
    // `accepted` status would offer an undo for something nobody undid.
    base.statusBeforeRemoval =
      participant.status === "removed" ? participant.statusBeforeRemoval : null;
    base.details = participant.details;
    return base;
  }

  // An erased participant is nobody's "self" — a NULL profile matches no
  // membership, so the self tier is unreachable for it.
  if (participant.profileId !== null && selfProfileIds?.has(participant.profileId)) {
    const visible = selfVisibleDetails(participant.details);
    if (visible) base.details = visible;
  }
  return base;
}
