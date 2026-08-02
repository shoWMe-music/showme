import { schema } from "@showme/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { assignGroupToEvent, unassignGroupFromEvent } from "../lib/group-assignment";

const GroupParams = z.object({ gid: z.string().uuid() });
const GroupMemberParams = z.object({ gid: z.string().uuid(), mid: z.string().uuid() });
const GroupProfileParams = z.object({ gid: z.string().uuid(), pid: z.string().uuid() });
const EventParams = z.object({ id: z.string().uuid() });
const EventGroupParams = z.object({ id: z.string().uuid(), gid: z.string().uuid() });

const CreateGroupBody = z.object({ name: z.string().min(1) });
const UpdateGroupBody = z.object({ name: z.string().min(1) });
const AddMemberBody = z
  .object({
    userId: z.string().optional(),
    email: z.string().email().optional(),
    roleLabel: z.string().optional(),
    defaultPermissionSetId: z.string().uuid().optional(),
  })
  .refine((body) => body.userId != null || body.email != null, {
    message: "A member needs a userId (on-platform) or an email (off-platform)",
  });
const LinkProfileBody = z.object({ profileId: z.string().uuid() });
const AssignGroupBody = z.object({
  groupId: z.string().uuid(),
  /** One permission set for every assigned member, overriding their per-member defaults. */
  permissionSetId: z.string().uuid().optional(),
});

const GroupMemberResponse = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  roleLabel: z.string().nullable(),
  defaultPermissionSetId: z.string().nullable(),
});

const GroupResponse = z.object({
  id: z.string(),
  name: z.string(),
  ownerUserId: z.string(),
  members: z.array(GroupMemberResponse),
  profileIds: z.array(z.string()),
});

const AssignResponse = z.object({
  assigned: z.array(
    z.object({
      participantId: z.string(),
      profileId: z.string(),
      roleLabel: z.string().nullable(),
    }),
  ),
  skippedNoProfile: z.array(z.object({ memberId: z.string(), email: z.string().nullable() })),
  skippedExisting: z.array(z.object({ profileId: z.string() })),
});

type GroupRow = typeof schema.groups.$inferSelect;
type GroupMemberRow = typeof schema.groupMembers.$inferSelect;

function serializeGroup(group: GroupRow, members: GroupMemberRow[], profileIds: string[]) {
  return {
    id: group.id,
    name: group.name,
    ownerUserId: group.ownerUserId,
    members: members.map((member) => ({
      id: member.id,
      userId: member.userId,
      email: member.email,
      roleLabel: member.roleLabel,
      defaultPermissionSetId: member.defaultPermissionSetId,
    })),
    profileIds,
  };
}

/** Load a group the caller OWNS (groups are user-owned, decisions #12), or 404. */
async function loadOwnedGroup(request: FastifyRequest, groupId: string): Promise<GroupRow> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const [group] = await request.server.database
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.id, groupId), eq(schema.groups.ownerUserId, principal.userId)));
  if (!group) throw notFound("Group not found");
  return group;
}

async function loadGroupDetail(request: FastifyRequest, group: GroupRow) {
  const { database } = request.server;
  const members = await database
    .select()
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, group.id));
  const profiles = await database
    .select({ profileId: schema.groupProfiles.profileId })
    .from(schema.groupProfiles)
    .where(eq(schema.groupProfiles.groupId, group.id));
  return serializeGroup(
    group,
    members,
    profiles.map((row) => row.profileId),
  );
}

/** The caller's own participant on an event, preferring the given roles (the sponsor). */
async function resolveSponsorParticipant(
  request: FastifyRequest,
  eventId: string,
  preferRoles: string[],
): Promise<{ id: string; role: string } | null> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const rows = await request.server.database
    .select({ id: schema.eventParticipants.id, role: schema.eventParticipants.role })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
      ),
    );
  const preferred = rows.find((row) => preferRoles.includes(row.role));
  return preferred ?? rows[0] ?? null;
}

export async function groupRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List the caller's own groups (roster bundles are user-owned, decisions #12).
  app.get("/groups", { schema: { response: { 200: z.array(GroupResponse) } } }, async (request) => {
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");
    const groups = await request.server.database
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.ownerUserId, principal.userId));
    return Promise.all(groups.map((group) => loadGroupDetail(request, group)));
  });

  // Create a group.
  app.post(
    "/groups",
    { schema: { body: CreateGroupBody, response: { 201: GroupResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const created = await database.transaction(async (tx) => {
        const [group] = await tx
          .insert(schema.groups)
          .values({ ownerUserId: principal.userId, name: request.body.name })
          .returning();
        if (!group) throw new Error("group create failed");
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "group.create",
          targetKind: "group",
          targetId: group.id,
          after: { name: group.name },
        });
        return group;
      });
      return reply.status(201).send(serializeGroup(created, [], []));
    },
  );

  // Read one group the caller owns.
  app.get(
    "/groups/:gid",
    { schema: { params: GroupParams, response: { 200: GroupResponse } } },
    async (request) => {
      const group = await loadOwnedGroup(request, request.params.gid);
      return loadGroupDetail(request, group);
    },
  );

  // Rename a group.
  app.patch(
    "/groups/:gid",
    { schema: { params: GroupParams, body: UpdateGroupBody, response: { 200: GroupResponse } } },
    async (request) => {
      const { database } = request.server;
      const group = await loadOwnedGroup(request, request.params.gid);
      await database.transaction(async (tx) => {
        await tx
          .update(schema.groups)
          .set({ name: request.body.name })
          .where(eq(schema.groups.id, group.id));
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "group.update",
          targetKind: "group",
          targetId: group.id,
          before: { name: group.name },
          after: { name: request.body.name },
        });
      });
      return loadGroupDetail(request, { ...group, name: request.body.name });
    },
  );

  // Delete a group (its members + profile links cascade).
  app.delete("/groups/:gid", { schema: { params: GroupParams } }, async (request, reply) => {
    const { database } = request.server;
    const group = await loadOwnedGroup(request, request.params.gid);
    await database.transaction(async (tx) => {
      await tx.delete(schema.groups).where(eq(schema.groups.id, group.id));
      await writeAudit(tx, request, {
        capability: "crew.manage",
        action: "group.delete",
        targetKind: "group",
        targetId: group.id,
        before: { name: group.name },
      });
    });
    return reply.status(204).send();
  });

  // Add a member to a group.
  app.post(
    "/groups/:gid/members",
    { schema: { params: GroupParams, body: AddMemberBody, response: { 200: GroupResponse } } },
    async (request) => {
      const { database } = request.server;
      const group = await loadOwnedGroup(request, request.params.gid);
      await database.transaction(async (tx) => {
        const [member] = await tx
          .insert(schema.groupMembers)
          .values({
            groupId: group.id,
            userId: request.body.userId,
            email: request.body.email,
            roleLabel: request.body.roleLabel,
            defaultPermissionSetId: request.body.defaultPermissionSetId,
          })
          .returning();
        if (!member) throw new Error("member add failed");
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "group.member.add",
          targetKind: "group_member",
          targetId: member.id,
          after: member,
        });
      });
      return loadGroupDetail(request, group);
    },
  );

  // Remove a member from a group.
  app.delete(
    "/groups/:gid/members/:mid",
    { schema: { params: GroupMemberParams, response: { 200: GroupResponse } } },
    async (request) => {
      const { database } = request.server;
      const group = await loadOwnedGroup(request, request.params.gid);
      await database.transaction(async (tx) => {
        const [removed] = await tx
          .delete(schema.groupMembers)
          .where(
            and(
              eq(schema.groupMembers.id, request.params.mid),
              eq(schema.groupMembers.groupId, group.id),
            ),
          )
          .returning();
        if (!removed) throw notFound("Group member not found");
        await writeAudit(tx, request, {
          capability: "crew.manage",
          action: "group.member.remove",
          targetKind: "group_member",
          targetId: removed.id,
          before: removed,
        });
      });
      return loadGroupDetail(request, group);
    },
  );

  // Link a group to a profile it serves (a group is cross-profile, decisions #12).
  app.post(
    "/groups/:gid/profiles",
    { schema: { params: GroupParams, body: LinkProfileBody, response: { 200: GroupResponse } } },
    async (request) => {
      const { database } = request.server;
      const group = await loadOwnedGroup(request, request.params.gid);
      await database
        .insert(schema.groupProfiles)
        .values({ groupId: group.id, profileId: request.body.profileId })
        .onConflictDoNothing();
      return loadGroupDetail(request, group);
    },
  );

  // Unlink a profile.
  app.delete(
    "/groups/:gid/profiles/:pid",
    { schema: { params: GroupProfileParams, response: { 200: GroupResponse } } },
    async (request) => {
      const { database } = request.server;
      const group = await loadOwnedGroup(request, request.params.gid);
      await database
        .delete(schema.groupProfiles)
        .where(
          and(
            eq(schema.groupProfiles.groupId, group.id),
            eq(schema.groupProfiles.profileId, request.params.pid),
          ),
        );
      return loadGroupDetail(request, group);
    },
  );

  // Assign a group to an event → one crew participant per member (decisions #12).
  // ANYONE who may bring crew can: an operator (crew.manage/participants.manage)
  // sponsored by the event; or a performer / agent / crew-lead (crew.submit) bringing
  // their OWN crew, sponsored by themselves. The sponsor scopes what the crew sees, so
  // a bringer never exposes beyond their own reach.
  app.post(
    "/events/:id/groups",
    { schema: { params: EventParams, body: AssignGroupBody, response: { 200: AssignResponse } } },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const capabilities = await requireEventCapability(request, eventId, "event.view");
      const isOperator = capabilities.has("crew.manage") || capabilities.has("participants.manage");
      const canSubmit = capabilities.has("crew.submit");
      if (!isOperator && !canSubmit) {
        throw forbidden("You may not add crew to this event");
      }

      // The group must be the caller's own (owner-scoped management).
      const group = await loadOwnedGroup(request, request.body.groupId);

      // Sponsor = the caller's own participant. Operators land on host (→ all riders);
      // a self-bringer lands on their own row (performer/support/agent/crew-lead), which
      // is exactly what scopes their crew's visibility to that bringer's reach.
      const preferRoles = isOperator
        ? ["host", "co_host"]
        : ["performer", "support", "agent", "crew_lead"];
      const sponsor = await resolveSponsorParticipant(request, eventId, preferRoles);
      if (!sponsor) throw forbidden("You are not a participant on this event");

      const result = await database.transaction(async (tx) => {
        const assigned = await assignGroupToEvent(tx, group, eventId, {
          addedBy: principal.userId,
          sponsorParticipantId: sponsor.id,
          overridePermissionSetId: request.body.permissionSetId ?? null,
        });
        await writeAudit(tx, request, {
          capability: isOperator ? "crew.manage" : "crew.submit",
          action: "group.assign",
          targetKind: "event",
          targetId: eventId,
          eventId,
          after: { groupId: group.id, assigned: assigned.assigned.length },
        });
        await writeActivity(tx, request, {
          eventId,
          type: "group.assigned",
          targetKind: "event",
          targetId: eventId,
          summary: { groupName: group.name, count: assigned.assigned.length },
        });
        return assigned;
      });

      return result;
    },
  );

  // Unassign a group's crew from an event (the inverse) — soft-remove.
  app.delete(
    "/events/:id/groups/:gid",
    { schema: { params: EventGroupParams, response: { 200: z.object({ removed: z.number() }) } } },
    async (request) => {
      const { database } = request.server;
      const { id: eventId, gid } = request.params;

      const capabilities = await requireEventCapability(request, eventId, "event.view");
      const isOperator = capabilities.has("crew.manage") || capabilities.has("participants.manage");
      const canSubmit = capabilities.has("crew.submit");
      if (!isOperator && !canSubmit) {
        throw forbidden("You may not remove crew from this event");
      }
      // A performer may only pull back their OWN group's crew.
      if (!isOperator) await loadOwnedGroup(request, gid);

      const removed = await database.transaction(async (tx) => {
        const count = await unassignGroupFromEvent(tx, gid, eventId);
        await writeAudit(tx, request, {
          capability: isOperator ? "crew.manage" : "crew.submit",
          action: "group.unassign",
          targetKind: "event",
          targetId: eventId,
          eventId,
          after: { groupId: gid, removed: count },
        });
        return count;
      });

      return { removed };
    },
  );
}
