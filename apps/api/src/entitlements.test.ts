import { PRESET_PERMISSION_SETS } from "@showme/auth";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COLLABORATION_INVITE_CREDITS,
  ENTITLEMENT_REQUIRED_CODE,
  assertEventCapAllows,
  assertGrantAdminAllows,
  assertProfileAdminGrantAllows,
  canUseFeature,
  collaborationCreditBalance,
  confersAdminAuthority,
  countsTowardEventCap,
  entitlementRequired,
  getPlanTier,
  isPlanGatedFeature,
  refillCollaborationCredit,
  spendCollaborationCredit,
} from "./lib/entitlements";

let harness: TestDatabase;

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

let seq = 0;
/** Seed a user + owned profile, return the profile id (and the owner uid). */
async function seedProfile(kind: "operator" | "performer") {
  const { db } = harness;
  const id = `ent-${kind}-${seq++}`;
  await db.insert(schema.users).values({ id, email: `${id}@example.showme.test`, kind });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  return { profileId: profile.id, ownerUserId: id };
}

async function setTier(
  profileId: string,
  tier: "free_operator" | "operator_pro" | "free_artist" | "artist_pro",
) {
  await harness.db.insert(schema.plans).values({ profileId, tier });
}

async function seedEvent(hostProfileId: string, createdBy: string, status: string) {
  await harness.db.insert(schema.events).values({
    hostProfileId,
    title: "Show",
    baseCurrency: "SEK",
    status: status as "confirmed",
    createdBy,
  });
}

describe("getPlanTier", () => {
  it("defaults to free_operator / free_artist by kind when there is no plan row", async () => {
    const operator = await seedProfile("operator");
    const performer = await seedProfile("performer");
    expect(await getPlanTier(harness.db, operator.profileId)).toBe("free_operator");
    expect(await getPlanTier(harness.db, performer.profileId)).toBe("free_artist");
  });

  it("defaults to free_operator for an unknown profile", async () => {
    expect(await getPlanTier(harness.db, "00000000-0000-0000-0000-000000000000")).toBe(
      "free_operator",
    );
  });

  it("reads the stored tier when a plan row exists", async () => {
    const operator = await seedProfile("operator");
    await setTier(operator.profileId, "operator_pro");
    expect(await getPlanTier(harness.db, operator.profileId)).toBe("operator_pro");
  });
});

describe("canUseFeature — create_event", () => {
  it("blocks a free_operator at 3 hosted (confirmed/concluded) events", async () => {
    const operator = await seedProfile("operator");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "concluded");
    // A draft does not count toward the cap.
    await seedEvent(operator.profileId, operator.ownerUserId, "draft");

    const check = await canUseFeature(harness.db, operator.profileId, "create_event");
    expect(check).toMatchObject({ allowed: false, used: 3, limit: 3 });
  });

  it("allows a free_operator still under the cap", async () => {
    const operator = await seedProfile("operator");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "concluded");

    const check = await canUseFeature(harness.db, operator.profileId, "create_event");
    expect(check).toMatchObject({ allowed: true, used: 2, limit: 3 });
  });

  it("does not count events older than 365 days", async () => {
    const operator = await seedProfile("operator");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    // A future 'now' pushes the recent event outside the rolling window.
    const oneYearLater = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    const check = await canUseFeature(harness.db, operator.profileId, "create_event", oneYearLater);
    expect(check).toMatchObject({ allowed: true, used: 0, limit: 3 });
  });

  it("gives a paid tier unlimited events", async () => {
    const operator = await seedProfile("operator");
    await setTier(operator.profileId, "operator_pro");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");

    const check = await canUseFeature(harness.db, operator.profileId, "create_event");
    expect(check.allowed).toBe(true);
    expect(check.limit).toBeUndefined();
  });
});

describe("canUseFeature — send_offer", () => {
  /** `wantedDate` keeps two pending offers to the same venue distinct — the
   * `booking_requests_pending_dedup` index treats one night as one offer.
   *
   * It is REQUIRED here since migration 0031 (Ran, 2026-08-31: "requests should
   * always come with a date"), where `wanted_date` became NOT NULL. It used to be
   * optional, and the sibling test below asserted that two DATELESS offers to one
   * venue counted as two — true, because Postgres counts NULLs as distinct, but a
   * state the app can no longer produce or store. That test is now the assertion
   * that the database refuses such a row at all. */
  async function seedOffer(
    senderUserId: string,
    targetProfileId: string,
    wantedDate: string,
    createdAt?: Date,
  ) {
    await harness.db.insert(schema.bookingRequests).values({
      source: "performer_offer",
      senderUserId,
      targetProfileId,
      wantedDate,
      ...(createdAt ? { createdAt } : {}),
    });
  }

  it("meters a free_artist by offers sent this calendar month", async () => {
    const performer = await seedProfile("performer");
    const target = await seedProfile("operator");
    await seedOffer(performer.ownerUserId, target.profileId, "2026-09-10");
    await seedOffer(performer.ownerUserId, target.profileId, "2026-09-11");

    const check = await canUseFeature(harness.db, performer.profileId, "send_offer");
    expect(check).toMatchObject({ allowed: true, used: 2, limit: 50 });
  });

  it("cannot be sent a DATELESS offer to meter at all", async () => {
    const performer = await seedProfile("performer");
    const target = await seedProfile("operator");

    // Deliberately replaces "counts two DATELESS offers to the same venue as two".
    // That behaviour was real (NULLs are distinct, so the dedup index let both in)
    // and is now unreachable: 0031 made `wanted_date` NOT NULL, so the row the old
    // test seeded cannot be written. Asserting the refusal keeps the rule covered
    // instead of deleting the case and leaving a silent gap.
    await expect(
      harness.db.insert(schema.bookingRequests).values({
        source: "performer_offer",
        senderUserId: performer.ownerUserId,
        targetProfileId: target.profileId,
      } as never),
    ).rejects.toThrow();

    const check = await canUseFeature(harness.db, performer.profileId, "send_offer");
    expect(check).toMatchObject({ allowed: true, used: 0, limit: 50 });
  });

  it("gives a paid artist unlimited offers", async () => {
    const performer = await seedProfile("performer");
    await setTier(performer.profileId, "artist_pro");
    const check = await canUseFeature(harness.db, performer.profileId, "send_offer");
    expect(check.allowed).toBe(true);
    expect(check.limit).toBeUndefined();
  });
});

describe("canUseFeature — grant_admin", () => {
  it("is gated by a paid tier", async () => {
    const free = await seedProfile("operator");
    const paid = await seedProfile("operator");
    await setTier(paid.profileId, "operator_pro");

    expect((await canUseFeature(harness.db, free.profileId, "grant_admin")).allowed).toBe(false);
    expect((await canUseFeature(harness.db, paid.profileId, "grant_admin")).allowed).toBe(true);
  });
});

describe("canUseFeature — not_spam_suspended", () => {
  async function flag(targetProfileId: string, reporterProfileId: string) {
    await harness.db.insert(schema.spamFlags).values({
      targetProfileId,
      reporterProfileId,
      kind: "offer",
    });
  }

  it("flips to suspended at 3 distinct reporters", async () => {
    const target = await seedProfile("performer");
    const r1 = await seedProfile("operator");
    const r2 = await seedProfile("operator");
    const r3 = await seedProfile("operator");

    await flag(target.profileId, r1.profileId);
    await flag(target.profileId, r2.profileId);
    // Two flags in the window, allowed.
    expect((await canUseFeature(harness.db, target.profileId, "not_spam_suspended")).allowed).toBe(
      true,
    );

    await flag(target.profileId, r3.profileId);
    // Third distinct reporter suspends.
    const suspended = await canUseFeature(harness.db, target.profileId, "not_spam_suspended");
    expect(suspended).toMatchObject({ allowed: false, used: 3, limit: 3 });
  });
});

describe("collaborationCreditBalance", () => {
  it("opens at the full allowance with no ledger rows at all", async () => {
    const profile = await seedProfile("operator");
    // The allowance is a constant, not a granted row — which is what makes the
    // number right for every profile that predates the feature, with no backfill.
    expect(await collaborationCreditBalance(harness.db, profile.profileId)).toBe(
      COLLABORATION_INVITE_CREDITS,
    );
  });

  it("moves with the ledger", async () => {
    const profile = await seedProfile("operator");
    await harness.db.insert(schema.creditLedger).values([
      { profileId: profile.profileId, delta: -1, reason: "invite:a" },
      { profileId: profile.profileId, delta: -1, reason: "invite:b" },
      { profileId: profile.profileId, delta: 1, reason: "invite-answered:a" },
    ]);
    expect(await collaborationCreditBalance(harness.db, profile.profileId)).toBe(
      COLLABORATION_INVITE_CREDITS - 1,
    );
  });
});

describe("spendCollaborationCredit / refillCollaborationCredit", () => {
  it("charges a send and returns it when the invitation is answered", async () => {
    const profile = await seedProfile("performer");
    await spendCollaborationCredit(harness.db, {
      profileId: profile.profileId,
      invitationId: "11111111-1111-1111-1111-111111111111",
    });
    expect(await collaborationCreditBalance(harness.db, profile.profileId)).toBe(
      COLLABORATION_INVITE_CREDITS - 1,
    );

    await refillCollaborationCredit(harness.db, {
      profileId: profile.profileId,
      invitationId: "11111111-1111-1111-1111-111111111111",
    });
    expect(await collaborationCreditBalance(harness.db, profile.profileId)).toBe(
      COLLABORATION_INVITE_CREDITS,
    );
  });

  it("never pays twice for one invitation", async () => {
    const profile = await seedProfile("performer");
    const invitationId = "22222222-2222-2222-2222-222222222222";
    await spendCollaborationCredit(harness.db, { profileId: profile.profileId, invitationId });
    await refillCollaborationCredit(harness.db, { profileId: profile.profileId, invitationId });
    await refillCollaborationCredit(harness.db, { profileId: profile.profileId, invitationId });
    expect(await collaborationCreditBalance(harness.db, profile.profileId)).toBe(
      COLLABORATION_INVITE_CREDITS,
    );
  });

  it("mints nothing for an invitation that was never charged", async () => {
    // The in-platform case: inviting somebody who already has an account costs
    // nothing, so answering it must not hand out a credit that was never spent.
    const profile = await seedProfile("performer");
    await refillCollaborationCredit(harness.db, {
      profileId: profile.profileId,
      invitationId: "33333333-3333-3333-3333-333333333333",
    });
    expect(await collaborationCreditBalance(harness.db, profile.profileId)).toBe(
      COLLABORATION_INVITE_CREDITS,
    );
  });
});

describe("countsTowardEventCap", () => {
  it("counts exactly the live statuses the meter COUNTs — confirmed and concluded", () => {
    expect(countsTowardEventCap("confirmed")).toBe(true);
    expect(countsTowardEventCap("concluded")).toBe(true);
    for (const status of ["draft", "suggested", "pending", "on_hold", "cancelled", null]) {
      expect(countsTowardEventCap(status)).toBe(false);
    }
  });
});

describe("assertEventCapAllows", () => {
  /** A free_operator sitting exactly ON the cap (3 counted events in the window). */
  async function seedOperatorAtCap() {
    const operator = await seedProfile("operator");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "concluded");
    return operator;
  }

  it("blocks EVERY entry into the counted set at the cap — concluded, not just confirmed", async () => {
    const operator = await seedOperatorAtCap();
    const draft = { hostProfileId: operator.profileId, status: "draft" };

    await expect(assertEventCapAllows(harness.db, draft, "confirmed")).rejects.toMatchObject({
      statusCode: 403,
    });
    // The A-20 hole: `concluded` walked straight past the same cap.
    await expect(assertEventCapAllows(harness.db, draft, "concluded")).rejects.toMatchObject({
      statusCode: 403,
    });
    // And from a hold, the path the hold-confirm route takes.
    await expect(
      assertEventCapAllows(
        harness.db,
        { hostProfileId: operator.profileId, status: "on_hold" },
        "confirmed",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("never gates a move INSIDE the counted set — a confirmed event may always conclude", async () => {
    const operator = await seedOperatorAtCap();
    await expect(
      assertEventCapAllows(
        harness.db,
        { hostProfileId: operator.profileId, status: "confirmed" },
        "concluded",
      ),
    ).resolves.toBeUndefined();
  });

  it("never gates a move OUT of the counted set, or an edit that leaves status alone", async () => {
    const operator = await seedOperatorAtCap();
    const draft = { hostProfileId: operator.profileId, status: "draft" };
    await expect(assertEventCapAllows(harness.db, draft, "cancelled")).resolves.toBeUndefined();
    await expect(assertEventCapAllows(harness.db, draft, undefined)).resolves.toBeUndefined();
    await expect(
      assertEventCapAllows(
        harness.db,
        { hostProfileId: operator.profileId, status: "confirmed" },
        "cancelled",
      ),
    ).resolves.toBeUndefined();
  });

  it("lets a host under the cap — and any paid host — go live", async () => {
    const under = await seedProfile("operator");
    await seedEvent(under.profileId, under.ownerUserId, "confirmed");
    await expect(
      assertEventCapAllows(
        harness.db,
        { hostProfileId: under.profileId, status: "draft" },
        "concluded",
      ),
    ).resolves.toBeUndefined();

    const paid = await seedProfile("operator");
    await setTier(paid.profileId, "operator_pro");
    for (let index = 0; index < 4; index++) {
      await seedEvent(paid.profileId, paid.ownerUserId, "confirmed");
    }
    await expect(
      assertEventCapAllows(
        harness.db,
        { hostProfileId: paid.profileId, status: "draft" },
        "concluded",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("confersAdminAuthority", () => {
  it("is true for an admin-grade bundle and false for the ordinary participant tiers", () => {
    expect(confersAdminAuthority(PRESET_PERMISSION_SETS.operator_full)).toBe(true);
    expect(confersAdminAuthority(["event.view", "event.delete"])).toBe(true);
    expect(confersAdminAuthority(["permission.grant_admin"])).toBe(true);

    expect(confersAdminAuthority(PRESET_PERMISSION_SETS.performer)).toBe(false);
    expect(confersAdminAuthority(PRESET_PERMISSION_SETS.crew_technical)).toBe(false);
    expect(confersAdminAuthority(PRESET_PERMISSION_SETS.view_only)).toBe(false);
    // An agent's routine management grants are NOT admin-grade — gating those would
    // paywall ordinary booking rather than the act of making someone an admin.
    expect(confersAdminAuthority(PRESET_PERMISSION_SETS.agent)).toBe(false);
    expect(confersAdminAuthority(null)).toBe(false);
  });
});

describe("assertGrantAdminAllows", () => {
  /** A permission set owned by `profileId`, carrying `capabilities`. */
  async function seedPermissionSet(profileId: string, capabilities: readonly string[]) {
    const [set] = await harness.db
      .insert(schema.permissionSets)
      .values({ profileId, name: `set-${seq++}`, capabilities: [...capabilities] })
      .returning();
    if (!set) throw new Error("permission set seed failed");
    return set.id;
  }

  it("blocks a free host from handing out an admin-grade set, and lets a paid host", async () => {
    const free = await seedProfile("operator");
    const adminSet = await seedPermissionSet(free.profileId, PRESET_PERMISSION_SETS.operator_full);
    await expect(
      assertGrantAdminAllows(harness.db, {
        hostProfileId: free.profileId,
        nextPermissionSetId: adminSet,
      }),
    ).rejects.toMatchObject({ statusCode: 403, message: "Granting admin requires a paid plan" });

    const paid = await seedProfile("operator");
    await setTier(paid.profileId, "operator_pro");
    const paidAdminSet = await seedPermissionSet(
      paid.profileId,
      PRESET_PERMISSION_SETS.operator_full,
    );
    await expect(
      assertGrantAdminAllows(harness.db, {
        hostProfileId: paid.profileId,
        nextPermissionSetId: paidAdminSet,
      }),
    ).resolves.toBeUndefined();
  });

  it("never charges a plain performer/crew set, or a no-op re-grant", async () => {
    const free = await seedProfile("operator");
    const performerSet = await seedPermissionSet(free.profileId, PRESET_PERMISSION_SETS.performer);
    const adminSet = await seedPermissionSet(free.profileId, PRESET_PERMISSION_SETS.operator_full);

    await expect(
      assertGrantAdminAllows(harness.db, {
        hostProfileId: free.profileId,
        nextPermissionSetId: performerSet,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertGrantAdminAllows(harness.db, {
        hostProfileId: free.profileId,
        nextPermissionSetId: undefined,
      }),
    ).resolves.toBeUndefined();
    // Re-saving the set they already hold adds no authority → nothing to charge.
    await expect(
      assertGrantAdminAllows(harness.db, {
        hostProfileId: free.profileId,
        nextPermissionSetId: adminSet,
        currentPermissionSetId: adminSet,
      }),
    ).resolves.toBeUndefined();
  });

  it("charges only the promotion — plain → admin, never admin → other admin", async () => {
    const free = await seedProfile("operator");
    const performerSet = await seedPermissionSet(free.profileId, PRESET_PERMISSION_SETS.performer);
    const adminSet = await seedPermissionSet(free.profileId, PRESET_PERMISSION_SETS.operator_full);
    const otherAdminSet = await seedPermissionSet(free.profileId, ["event.view", "event.delete"]);

    await expect(
      assertGrantAdminAllows(harness.db, {
        hostProfileId: free.profileId,
        nextPermissionSetId: adminSet,
        currentPermissionSetId: performerSet,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      assertGrantAdminAllows(harness.db, {
        hostProfileId: free.profileId,
        nextPermissionSetId: otherAdminSet,
        currentPermissionSetId: adminSet,
      }),
    ).resolves.toBeUndefined();
  });
});

/**
 * A plan refusal must be TELLABLE APART from a permission refusal on the wire.
 *
 * Both are 403. Before `entitlement_required` existed they were both
 * `code: "forbidden"`, so the only way a client could offer "upgrade to Pro"
 * instead of "you don't have access" was to match on the message TEXT — which
 * breaks the moment a limit's wording changes, and which is why upgrade copy ends
 * up copy-pasted into a dozen screens. These tests pin the CODE, because the web
 * app's single upgrade notice keys off exactly that
 * (`apps/web/src/lib/errors.ts::isEntitlementError`).
 */
describe("the entitlement refusal is a distinct error code", () => {
  it("marks a PLAN gate `entitlement_required`, and a reputation gate plain `forbidden`", () => {
    const refused = { allowed: false, reason: "Free plan event limit reached" };

    for (const feature of ["create_event", "send_offer", "grant_admin"] as const) {
      expect(isPlanGatedFeature(feature)).toBe(true);
      expect(entitlementRequired(feature, refused)).toMatchObject({
        statusCode: 403,
        code: ENTITLEMENT_REQUIRED_CODE,
      });
    }

    // Spam suspension is a REPUTATION gate. Answering a reported profile with
    // "upgrade to Pro" would be wrong, so it stays an ordinary refusal.
    expect(isPlanGatedFeature("not_spam_suspended")).toBe(false);
    expect(
      entitlementRequired("not_spam_suspended", {
        allowed: false,
        reason: "Profile suspended for spam reports",
      }),
    ).toMatchObject({ statusCode: 403, code: "forbidden" });
  });

  it("keeps the SPECIFIC reason as the message — the upgrade sentence belongs to the UI", () => {
    expect(
      entitlementRequired("create_event", {
        allowed: false,
        reason: "Free plan event limit reached",
      }).message,
    ).toBe("Free plan event limit reached");
    // A check with no reason still refuses, with a message rather than "".
    expect(entitlementRequired("grant_admin", { allowed: false }).message).toBe(
      "Your plan does not include this feature",
    );
  });

  it("EVERY plan gate throws that code — event cap, event admin grant, profile admin grant", async () => {
    const operator = await seedProfile("operator");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "confirmed");
    await seedEvent(operator.profileId, operator.ownerUserId, "concluded");

    // 1. The event cap, from both statuses that enter the counted set.
    for (const nextStatus of ["confirmed", "concluded"]) {
      await expect(
        assertEventCapAllows(
          harness.db,
          { hostProfileId: operator.profileId, status: "draft" },
          nextStatus,
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: ENTITLEMENT_REQUIRED_CODE,
        message: "Free plan event limit reached",
      });
    }

    // 2. The EVENT-level admin grant (A-21).
    const [adminSet] = await harness.db
      .insert(schema.permissionSets)
      .values({
        profileId: operator.profileId,
        name: `code-set-${seq++}`,
        capabilities: [...PRESET_PERMISSION_SETS.operator_full],
      })
      .returning();
    if (!adminSet) throw new Error("permission set seed failed");
    await expect(
      assertGrantAdminAllows(harness.db, {
        hostProfileId: operator.profileId,
        nextPermissionSetId: adminSet.id,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: ENTITLEMENT_REQUIRED_CODE,
      message: "Granting admin requires a paid plan",
    });

    // 3. The PROFILE-level admin grant (A-37).
    await expect(
      assertProfileAdminGrantAllows(harness.db, {
        profileId: operator.profileId,
        nextRole: "admin",
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: ENTITLEMENT_REQUIRED_CODE });
  });

  it("a free artist over the offer cap is refused with the same code", async () => {
    const performer = await seedProfile("performer");
    const venue = await seedProfile("operator");
    // 50 offers on 50 different nights — exactly the free_artist monthly limit.
    // They were dateless until 0031 made `wanted_date` NOT NULL; one night each is
    // the same count and, unlike a heap of undated rows, a thing that can happen.
    for (let index = 0; index < 50; index += 1) {
      await harness.db.insert(schema.bookingRequests).values({
        source: "performer_offer",
        senderUserId: performer.ownerUserId,
        targetProfileId: venue.profileId,
        wantedDate: `2026-${String(1 + Math.floor(index / 28)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")}`,
      });
    }
    const gate = await canUseFeature(harness.db, performer.profileId, "send_offer");
    expect(gate.allowed).toBe(false);
    expect(entitlementRequired("send_offer", gate)).toMatchObject({
      statusCode: 403,
      code: ENTITLEMENT_REQUIRED_CODE,
      message: "Monthly offer limit reached",
    });
  });
});
