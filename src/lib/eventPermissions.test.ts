import { describe, it, expect } from "vitest";
import {
  canTransitionEventStatus,
  canUserCreateEventsWithProfiles,
  budgetProfileDocIdsForEvent,
  isPrimaryEventOwner,
  canAccessEventBudget,
  roleCanManageEventCore,
  roleCanEditPerformersMaterials,
  userHasEventAccess,
  getEventPermission,
  canEditEvent,
  canEditFinancial,
  canManageCollaborators,
} from "./eventPermissions";
import type { EventCollaborator } from "./models";
import type { SharedProfile } from "./user-context";

function makeCollab(overrides: Partial<EventCollaborator> & { id: string }): EventCollaborator {
  return {
    email: "",
    eventRole: "performer",
    name: "",
    status: "active",
    invitedAt: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<SharedProfile> & { id: string }): SharedProfile {
  return {
    role: "venue",
    name: "",
    locations: [],
    bio: "",
    genres: [],
    socialLinks: [],
    created: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canTransitionEventStatus
// ---------------------------------------------------------------------------

describe("canTransitionEventStatus", () => {
  it("allows draft -> suggested", () => {
    expect(canTransitionEventStatus("draft", "suggested")).toBe(true);
  });

  it("allows draft -> cancelled", () => {
    expect(canTransitionEventStatus("draft", "cancelled")).toBe(true);
  });

  it("rejects draft -> confirmed", () => {
    expect(canTransitionEventStatus("draft", "confirmed")).toBe(false);
  });

  it("allows suggested -> pending", () => {
    expect(canTransitionEventStatus("suggested", "pending")).toBe(true);
  });

  it("allows pending -> confirmed", () => {
    expect(canTransitionEventStatus("pending", "confirmed")).toBe(true);
  });

  it("rejects concluded -> any", () => {
    expect(canTransitionEventStatus("concluded", "draft")).toBe(false);
    expect(canTransitionEventStatus("concluded", "confirmed")).toBe(false);
  });

  it("rejects cancelled -> any", () => {
    expect(canTransitionEventStatus("cancelled", "draft")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canUserCreateEventsWithProfiles
// ---------------------------------------------------------------------------

describe("canUserCreateEventsWithProfiles", () => {
  it("returns true when a venue profile has a name", () => {
    expect(
      canUserCreateEventsWithProfiles([
        makeProfile({ id: "v1", role: "venue", name: "My Venue" }),
      ]),
    ).toBe(true);
  });

  it("returns true for a venue the user is a member-of (not owner) — flat-array source catches what the slotted dict misses", () => {
    // owner_uid points to a different user; this profile is only present in
    // the flat array, never in the slotted dict for the current user.
    expect(
      canUserCreateEventsWithProfiles([
        makeProfile({
          id: "v1",
          role: "venue",
          name: "Shared Venue",
          owner_uid: "someone-else",
        }),
      ]),
    ).toBe(true);
  });

  it("returns false when only a performer profile exists", () => {
    expect(
      canUserCreateEventsWithProfiles([
        makeProfile({ id: "p1", role: "performer", name: "Artist" }),
      ]),
    ).toBe(false);
  });

  it("returns false when profiles are empty", () => {
    expect(canUserCreateEventsWithProfiles([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// budgetProfileDocIdsForEvent — auto-generated profile IDs
// ---------------------------------------------------------------------------

describe("budgetProfileDocIdsForEvent", () => {
  it("returns the user's venue profile ID (auto-generated)", () => {
    const profiles = {
      venue: makeProfile({ id: "abc123-auto-id", role: "venue", name: "My Venue" }),
    };
    const event = {
      primary_owner_uid: "uid1",
      owner_uid: "uid1",
      participant_roles: {},
      accessProfileIds: ["abc123-auto-id"],
      hostProfileId: "abc123-auto-id",
    };
    const result = budgetProfileDocIdsForEvent(event as any, "uid1", profiles);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("abc123-auto-id");
    expect(result[0].label).toContain("Venue");
  });

  it("returns multiple profile IDs for users with multiple profiles", () => {
    const profiles = {
      venue: makeProfile({ id: "venue-auto-id", role: "venue", name: "My Venue" }),
      promoter: makeProfile({ id: "promo-auto-id", role: "promoter", name: "My Promo" }),
    };
    const event = {
      primary_owner_uid: "uid1",
      owner_uid: "uid1",
      participant_roles: {},
      accessProfileIds: ["venue-auto-id", "promo-auto-id"],
      hostProfileId: "venue-auto-id",
    };
    const result = budgetProfileDocIdsForEvent(event as any, "uid1", profiles);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toContain("venue-auto-id");
    expect(result.map(r => r.id)).toContain("promo-auto-id");
  });

  it("falls back to personal worksheet when no creator profiles exist", () => {
    const profiles = {
      performer: makeProfile({ id: "perf-id", role: "performer", name: "Artist" }),
    };
    const event = {
      primary_owner_uid: "uid1",
      owner_uid: "uid1",
      participant_roles: {},
      accessProfileIds: ["perf-id"],
      hostProfileId: "perf-id",
    };
    const result = budgetProfileDocIdsForEvent(event as any, "uid1", profiles);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("uid1"); // personal worksheet = uid
    expect(result[0].label).toContain("Personal");
  });

  it("admins only see their own profiles, not other owners' profiles", () => {
    const myProfiles = {
      venue: makeProfile({ id: "my-venue-id", role: "venue", name: "Admin Venue" }),
    };
    const event = {
      primary_owner_uid: "owner-uid",
      owner_uid: "owner-uid",
      participant_roles: { "admin-uid": "admin" as const },
      accessProfileIds: ["my-venue-id", "owner-venue-id", "owner-promo-id"],
      hostProfileId: "owner-venue-id",
    };
    const result = budgetProfileDocIdsForEvent(event as any, "admin-uid", myProfiles);
    // Only the admin's own profile — NOT the owner's profiles
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("my-venue-id");
  });

  it("primary owner sees all their profiles even if not in accessProfileIds", () => {
    const myProfiles = {
      venue: makeProfile({ id: "my-venue-id", role: "venue", name: "My Venue" }),
      promoter: makeProfile({ id: "my-promo-id", role: "promoter", name: "My Promo" }),
    };
    const event = {
      primary_owner_uid: "uid1",
      owner_uid: "uid1",
      participant_roles: {},
      accessProfileIds: ["my-venue-id"],
      hostProfileId: "my-venue-id",
    };
    const result = budgetProfileDocIdsForEvent(event as any, "uid1", myProfiles);
    // Primary owner sees both profiles
    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toContain("my-venue-id");
    expect(result.map(r => r.id)).toContain("my-promo-id");
  });

  it("non-owner only sees profiles connected to the event", () => {
    const myProfiles = {
      venue: makeProfile({ id: "my-venue-id", role: "venue", name: "My Venue" }),
      promoter: makeProfile({ id: "my-promo-id", role: "promoter", name: "My Promo" }),
    };
    const event = {
      primary_owner_uid: "other-uid",
      owner_uid: "other-uid",
      participant_roles: {},
      accessProfileIds: ["my-venue-id"],
      hostProfileId: "host-id",
    };
    const result = budgetProfileDocIdsForEvent(event as any, "uid1", myProfiles);
    // Only venue is connected; promoter is not
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("my-venue-id");
  });

  it("returns empty for undefined event", () => {
    expect(budgetProfileDocIdsForEvent(undefined, "uid1", {})).toEqual([]);
  });

  it("falls back to personal worksheet when user has no creator profiles", () => {
    const event = {
      primary_owner_uid: "uid1",
      owner_uid: "uid1",
      participant_roles: {},
      accessProfileIds: [],
      hostProfileId: "host-id",
    };
    const result = budgetProfileDocIdsForEvent(event as any, "uid1", {});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("uid1");
    expect(result[0].label).toContain("Personal");
  });

  it("falls back to personal worksheet when user has no profiles connected to event", () => {
    const event = {
      primary_owner_uid: "other-uid",
      owner_uid: "other-uid",
      participant_roles: {},
      accessProfileIds: [],
      hostProfileId: "host-id",
    };
    const result = budgetProfileDocIdsForEvent(event as any, "uid1", {});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("uid1");
    expect(result[0].label).toContain("Personal");
  });

  it("deduplicates profile IDs", () => {
    const profiles = {
      venue: makeProfile({ id: "shared-id", role: "venue", name: "My Venue" }),
    };
    const event = {
      primary_owner_uid: "owner-uid",
      owner_uid: "owner-uid",
      participant_roles: { "uid1": "admin" as const },
      accessProfileIds: ["shared-id"],
      hostProfileId: "shared-id",
    };
    const result = budgetProfileDocIdsForEvent(event as any, "uid1", profiles);
    // shared-id should appear only once (as my profile)
    expect(result.filter(r => r.id === "shared-id")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// isPrimaryEventOwner
// ---------------------------------------------------------------------------

describe("isPrimaryEventOwner", () => {
  it("returns true when uid matches primary_owner_uid", () => {
    expect(isPrimaryEventOwner({ primary_owner_uid: "u1", owner_uid: "u2" }, "u1")).toBe(true);
  });

  it("falls back to owner_uid", () => {
    expect(isPrimaryEventOwner({ primary_owner_uid: undefined as any, owner_uid: "u1" }, "u1")).toBe(true);
  });

  it("returns false for different uid", () => {
    expect(isPrimaryEventOwner({ primary_owner_uid: "u1", owner_uid: "u1" }, "u2")).toBe(false);
  });

  it("returns false for undefined event", () => {
    expect(isPrimaryEventOwner(undefined, "u1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Role permission helpers
// ---------------------------------------------------------------------------

describe("roleCanManageEventCore", () => {
  it("allows admin, venue, promoter, organizer, festival", () => {
    expect(roleCanManageEventCore("admin")).toBe(true);
    expect(roleCanManageEventCore("venue")).toBe(true);
    expect(roleCanManageEventCore("promoter")).toBe(true);
    expect(roleCanManageEventCore("organizer")).toBe(true);
    expect(roleCanManageEventCore("festival")).toBe(true);
  });

  it("rejects performer and viewer", () => {
    expect(roleCanManageEventCore("performer")).toBe(false);
    expect(roleCanManageEventCore("viewer")).toBe(false);
  });
});

describe("roleCanEditPerformersMaterials", () => {
  it("allows performer and admin", () => {
    expect(roleCanEditPerformersMaterials("performer")).toBe(true);
    expect(roleCanEditPerformersMaterials("admin")).toBe(true);
  });

  it("rejects venue", () => {
    expect(roleCanEditPerformersMaterials("venue")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canAccessEventBudget
// ---------------------------------------------------------------------------

describe("canAccessEventBudget", () => {
  it("grants access to primary owner via primary_owner_uid", () => {
    const event = {
      primary_owner_uid: "owner-uid",
      owner_uid: "owner-uid",
      accessUids: [],
      participant_roles: {},
    };
    expect(canAccessEventBudget(event, "owner-uid")).toBe(true);
  });

  it("grants access when uid is in accessUids", () => {
    const event = {
      primary_owner_uid: "other-uid",
      owner_uid: "other-uid",
      accessUids: ["viewer-uid", "collab-uid"],
      participant_roles: {},
    };
    expect(canAccessEventBudget(event, "collab-uid")).toBe(true);
  });

  it("grants access to participant with admin role", () => {
    const event = {
      primary_owner_uid: "other-uid",
      owner_uid: "other-uid",
      accessUids: [],
      participant_roles: { "admin-uid": "admin" as const },
    };
    expect(canAccessEventBudget(event, "admin-uid")).toBe(true);
  });

  it("grants access to participant with venue role", () => {
    const event = {
      primary_owner_uid: "other-uid",
      owner_uid: "other-uid",
      accessUids: [],
      participant_roles: { "venue-uid": "venue" as const },
    };
    expect(canAccessEventBudget(event, "venue-uid")).toBe(true);
  });

  it("grants access to participant with promoter role", () => {
    const event = {
      primary_owner_uid: "other-uid",
      owner_uid: "other-uid",
      accessUids: [],
      participant_roles: { "promo-uid": "promoter" as const },
    };
    expect(canAccessEventBudget(event, "promo-uid")).toBe(true);
  });

  it("denies access to random user", () => {
    const event = {
      primary_owner_uid: "owner-uid",
      owner_uid: "owner-uid",
      accessUids: ["collab-uid"],
      participant_roles: {},
    };
    expect(canAccessEventBudget(event, "random-uid")).toBe(false);
  });

  it("denies access to participant with performer role", () => {
    const event = {
      primary_owner_uid: "other-uid",
      owner_uid: "other-uid",
      accessUids: [],
      participant_roles: { "performer-uid": "performer" as const },
    };
    expect(canAccessEventBudget(event, "performer-uid")).toBe(false);
  });

  it("denies access when event is undefined", () => {
    expect(canAccessEventBudget(undefined, "any-uid")).toBe(false);
  });

  it("denies access when uid is undefined", () => {
    const event = {
      primary_owner_uid: "owner-uid",
      owner_uid: "owner-uid",
      accessUids: [],
      participant_roles: {},
    };
    expect(canAccessEventBudget(event, undefined)).toBe(false);
  });

  it("falls back to owner_uid when primary_owner_uid is missing", () => {
    const event = {
      primary_owner_uid: undefined as any,
      owner_uid: "fallback-uid",
      accessUids: [],
      participant_roles: {},
    };
    expect(canAccessEventBudget(event, "fallback-uid")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// userHasEventAccess
// ---------------------------------------------------------------------------

describe("userHasEventAccess", () => {
  it("grants when uid is in accessUids", () => {
    expect(
      userHasEventAccess({ accessUids: ["a", "b"] }, "a", []),
    ).toBe(true);
  });

  it("grants when uid matches legacy owner_uid", () => {
    expect(
      userHasEventAccess({ accessUids: [], owner_uid: "a" }, "a", []),
    ).toBe(true);
  });

  it("grants when one of the user's profiles is the hostProfileId", () => {
    expect(
      userHasEventAccess(
        { accessUids: [], hostProfileId: "profile-host" },
        "user-uid",
        ["profile-host", "profile-other"],
      ),
    ).toBe(true);
  });

  it("grants when one of the user's profiles is the performerProfileId", () => {
    expect(
      userHasEventAccess(
        { accessUids: [], performerProfileId: "profile-perf" },
        "user-uid",
        ["profile-perf"],
      ),
    ).toBe(true);
  });

  it("grants when uid is in legacy participant_uids", () => {
    expect(
      userHasEventAccess(
        { accessUids: [], participant_uids: ["user-uid"] },
        "user-uid",
        [],
      ),
    ).toBe(true);
  });

  // The whole reason this helper exists — Firestore rules grant public read
  // to published+confirmed events, so a stranger can load the doc and would
  // otherwise hit the manager UI. The app-side gate must NOT consider the
  // published flag at all.
  it("denies a stranger viewing a published+confirmed event they have no profile/uid on", () => {
    const event = {
      accessUids: ["someone-else"],
      owner_uid: "someone-else",
      hostProfileId: "their-host-profile",
      performerProfileId: "their-perf-profile",
      participant_uids: [],
    };
    expect(userHasEventAccess(event, "stranger-uid", ["my-unrelated-profile"])).toBe(false);
  });

  it("denies when event is null/undefined", () => {
    expect(userHasEventAccess(null, "a", ["p"])).toBe(false);
    expect(userHasEventAccess(undefined, "a", ["p"])).toBe(false);
  });

  it("denies when uid is undefined", () => {
    expect(
      userHasEventAccess({ accessUids: ["a"] }, undefined, []),
    ).toBe(false);
  });

  it("ignores hostProfileId / performerProfileId when the user has no matching profile", () => {
    expect(
      userHasEventAccess(
        { accessUids: [], hostProfileId: "their-host", performerProfileId: "their-perf" },
        "user-uid",
        ["my-profile"],
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEventPermission
// ---------------------------------------------------------------------------

describe("getEventPermission", () => {
  it("returns admin for a host profile member", () => {
    const event = { hostProfileId: "host-profile" };
    const profiles = [makeProfile({ id: "host-profile", role: "venue" })];
    expect(getEventPermission(event, profiles, [], "uid-1")).toBe("admin");
  });

  it("returns the collaborator's permission when matched by userUid", () => {
    const event = { hostProfileId: "other-host" };
    const collabs = [makeCollab({ id: "c1", userUid: "uid-1", permission: "view_only" })];
    expect(getEventPermission(event, [], collabs, "uid-1")).toBe("view_only");
  });

  it("matches by profileId when userUid is absent (pending invite that was claimed without uid)", () => {
    const event = { hostProfileId: "other-host" };
    const profiles = [makeProfile({ id: "my-profile", role: "performer" })];
    const collabs = [makeCollab({ id: "c1", profileId: "my-profile", permission: "editor" })];
    expect(getEventPermission(event, profiles, collabs, "uid-1")).toBe("editor");
  });

  it("defaults missing permission field to editor (legacy collaborator rows)", () => {
    const event = { hostProfileId: "other-host" };
    const collabs = [makeCollab({ id: "c1", userUid: "uid-1" })];
    expect(getEventPermission(event, [], collabs, "uid-1")).toBe("editor");
  });

  it("returns the highest tier when a user has multiple collaborator rows", () => {
    // Same user invited via two paths — keep the most powerful tier.
    const event = { hostProfileId: "other-host" };
    const collabs = [
      makeCollab({ id: "c1", userUid: "uid-1", permission: "view_only" }),
      makeCollab({ id: "c2", userUid: "uid-1", permission: "admin" }),
      makeCollab({ id: "c3", userUid: "uid-1", permission: "editor" }),
    ];
    expect(getEventPermission(event, [], collabs, "uid-1")).toBe("admin");
  });

  it("returns none when the user has no match anywhere", () => {
    const event = { hostProfileId: "their-host" };
    const profiles = [makeProfile({ id: "my-profile", role: "performer" })];
    const collabs = [makeCollab({ id: "c1", userUid: "someone-else", permission: "admin" })];
    expect(getEventPermission(event, profiles, collabs, "uid-1")).toBe("none");
  });

  it("returns none when uid is undefined", () => {
    const event = { hostProfileId: "host" };
    expect(getEventPermission(event, [], [], undefined)).toBe("none");
  });

  it("returns none when event is undefined", () => {
    expect(getEventPermission(undefined, [], [], "uid-1")).toBe("none");
  });

  it("prefers host membership over a lower-tier collaborator row for the same user", () => {
    // Edge case: user is both host-profile member and listed as view-only —
    // host wins.
    const event = { hostProfileId: "host-profile" };
    const profiles = [makeProfile({ id: "host-profile", role: "venue" })];
    const collabs = [makeCollab({ id: "c1", userUid: "uid-1", permission: "view_only" })];
    expect(getEventPermission(event, profiles, collabs, "uid-1")).toBe("admin");
  });
});

// ---------------------------------------------------------------------------
// canEditEvent / canEditFinancial / canManageCollaborators
// ---------------------------------------------------------------------------

describe("canEditEvent", () => {
  it("returns true for admin and editor", () => {
    expect(canEditEvent("admin")).toBe(true);
    expect(canEditEvent("editor")).toBe(true);
  });

  it("returns false for view_only and none", () => {
    expect(canEditEvent("view_only")).toBe(false);
    expect(canEditEvent("none")).toBe(false);
  });
});

describe("canEditFinancial", () => {
  it("only admins may edit financial sections", () => {
    expect(canEditFinancial("admin")).toBe(true);
    expect(canEditFinancial("editor")).toBe(false);
    expect(canEditFinancial("view_only")).toBe(false);
    expect(canEditFinancial("none")).toBe(false);
  });
});

describe("canManageCollaborators", () => {
  it("only admins may invite/remove/edit collaborators", () => {
    expect(canManageCollaborators("admin")).toBe(true);
    expect(canManageCollaborators("editor")).toBe(false);
    expect(canManageCollaborators("view_only")).toBe(false);
    expect(canManageCollaborators("none")).toBe(false);
  });
});
