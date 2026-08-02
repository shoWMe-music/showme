import { schema } from "@showme/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";

const ProfileParams = z.object({ id: z.string().uuid() });
const ContactParams = z.object({ id: z.string().uuid(), cid: z.string().uuid() });

/** Roles that may read/write a profile's address book. Viewers/crew are excluded. */
const MANAGE_ROLES = ["owner", "admin", "editor"] as const;

const PersonSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

const CreateContactBody = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  iban: z.string().optional(),
  bankName: z.string().optional(),
  vatId: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  persons: z.array(PersonSchema).optional(),
});

const UpdateContactBody = z.object({
  name: z.string().min(1).optional(),
  type: z.string().nullable().optional(),
  iban: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  vatId: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  persons: z.array(PersonSchema).nullable().optional(),
});

const ContactResponse = z.object({
  id: z.string(),
  ownerProfileId: z.string(),
  name: z.string(),
  type: z.string().nullable(),
  iban: z.string().nullable(),
  bankName: z.string().nullable(),
  vatId: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  persons: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type ContactRow = typeof schema.contacts.$inferSelect;

/** Shape a stored contact row for the wire (timestamps → ISO strings). */
function serializeContact(row: ContactRow): z.infer<typeof ContactResponse> {
  return {
    id: row.id,
    ownerProfileId: row.ownerProfileId,
    name: row.name,
    type: row.type,
    iban: row.iban,
    bankName: row.bankName,
    vatId: row.vatId,
    address: row.address,
    notes: row.notes,
    persons: row.persons ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Fetch a contact that belongs to this profile, or 404 (no cross-profile leak). */
async function loadContact(
  database: FastifyInstance["database"],
  profileId: string,
  contactId: string,
): Promise<ContactRow> {
  const [contact] = await database
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.ownerProfileId, profileId)));
  if (!contact) throw notFound("Contact not found");
  return contact;
}

export async function contactRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List the profile's address book. PROFILE-scoped: authority is the caller's
  // membership role, not event capabilities. Non-member → 404, wrong role → 403.
  app.get(
    "/profiles/:id/contacts",
    { schema: { params: ProfileParams, response: { 200: z.array(ContactResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...MANAGE_ROLES]);

      const contacts = await database
        .select()
        .from(schema.contacts)
        .where(eq(schema.contacts.ownerProfileId, id));
      return contacts.map(serializeContact);
    },
  );

  // Create a contact (with optional folded `persons`). Audit "contact.create".
  app.post(
    "/profiles/:id/contacts",
    {
      schema: {
        params: ProfileParams,
        body: CreateContactBody,
        response: { 201: ContactResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...MANAGE_ROLES]);

      const body = request.body;
      const created = await database.transaction(async (tx) => {
        const [contact] = await tx
          .insert(schema.contacts)
          .values({
            ownerProfileId: id,
            name: body.name,
            type: body.type ?? null,
            iban: body.iban ?? null,
            bankName: body.bankName ?? null,
            vatId: body.vatId ?? null,
            address: body.address ?? null,
            notes: body.notes ?? null,
            persons: body.persons ?? null,
          })
          .returning();
        if (!contact) throw new Error("contact create failed");
        const serialized = serializeContact(contact);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "contact.create",
          targetKind: "contact",
          targetId: contact.id,
          after: serialized,
        });
        return serialized;
      });

      return reply.status(201).send(created);
    },
  );

  // Update a contact scoped to this profile. Audit "contact.update".
  app.patch(
    "/profiles/:id/contacts/:cid",
    {
      schema: {
        params: ContactParams,
        body: UpdateContactBody,
        response: { 200: ContactResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, cid } = request.params;

      requireProfileRole(request, id, [...MANAGE_ROLES]);
      const before = await loadContact(database, id, cid);

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.contacts)
          .set({ ...request.body, updatedAt: new Date() })
          .where(and(eq(schema.contacts.id, cid), eq(schema.contacts.ownerProfileId, id)))
          .returning();
        if (!after) throw notFound("Contact not found");
        const serialized = serializeContact(after);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "contact.update",
          targetKind: "contact",
          targetId: cid,
          before: serializeContact(before),
          after: serialized,
        });
        return serialized;
      });

      return updated;
    },
  );

  // Delete a contact scoped to this profile. Audit "contact.delete".
  app.delete(
    "/profiles/:id/contacts/:cid",
    {
      schema: {
        params: ContactParams,
        response: { 200: z.object({ id: z.string(), deleted: z.boolean() }) },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, cid } = request.params;

      requireProfileRole(request, id, [...MANAGE_ROLES]);
      const before = await loadContact(database, id, cid);

      await database.transaction(async (tx) => {
        await tx
          .delete(schema.contacts)
          .where(and(eq(schema.contacts.id, cid), eq(schema.contacts.ownerProfileId, id)));
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "contact.delete",
          targetKind: "contact",
          targetId: cid,
          before: serializeContact(before),
        });
      });

      return { id: cid, deleted: true };
    },
  );
}
