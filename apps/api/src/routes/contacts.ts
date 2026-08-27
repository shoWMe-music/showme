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

/**
 * One import is one screen's worth of address book, not a migration. The cap
 * bounds a single transaction and keeps a mis-pasted 100k-line file from being
 * a denial of service; it is enforced by Zod so the caller gets a clear 400
 * rather than a timeout.
 */
const MAX_IMPORT_ROWS = 500;

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

/**
 * One row off a spreadsheet. EVERY field is optional and free-text on purpose:
 * a file the operator saved out of Excel is not a validated payload, and a Zod
 * 400 on the whole body would throw away the twenty good rows because of the
 * twenty-first. Rows are judged one at a time, in the handler, and each gets its
 * own verdict back.
 */
const ImportContactRow = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  personName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  iban: z.string().optional(),
  bankName: z.string().optional(),
  vatId: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * `commit: false` is the PREVIEW. It runs exactly the code the commit runs and
 * stops short of the insert, so what the operator approves cannot drift from
 * what lands — the two are one code path, not two implementations of one rule.
 */
const ImportContactsBody = z.object({
  rows: z.array(ImportContactRow).min(1).max(MAX_IMPORT_ROWS),
  commit: z.boolean().default(false),
});

const ImportContactResult = z.object({
  /** Position in the submitted `rows`, so the UI can line the verdict up. */
  index: z.number().int(),
  name: z.string(),
  email: z.string().nullable(),
  outcome: z.enum(["imported", "skipped", "rejected"]),
  /** Always set for skipped/rejected, and for an imported row worth a caveat. */
  reason: z.string().nullable(),
  contactId: z.string().nullable(),
});

const ImportContactsResponse = z.object({
  committed: z.boolean(),
  imported: z.number().int(),
  skipped: z.number().int(),
  rejected: z.number().int(),
  results: z.array(ImportContactResult),
});

type ImportRow = z.infer<typeof ImportContactRow>;
type ImportResult = z.infer<typeof ImportContactResult>;

type ContactRow = typeof schema.contacts.$inferSelect;

/** Every email on a contact's folded `persons`, lowercased. Defensive: `persons` is jsonb. */
function contactEmails(row: ContactRow): string[] {
  const persons = row.persons;
  if (!Array.isArray(persons)) return [];
  return persons
    .map((person) => (person as { email?: unknown } | null)?.email)
    .filter((email): email is string => typeof email === "string" && email.trim() !== "")
    .map((email) => email.trim().toLowerCase());
}

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

const EmailSchema = z.string().email();

/** A row's verdict, plus the values to insert when the verdict is "imported". */
interface JudgedImportRow {
  result: ImportResult;
  values: typeof schema.contacts.$inferInsert | null;
}

/**
 * Decide, row by row, what an import does — the whole rule, in one place, used
 * by both the preview and the commit.
 *
 * **Dedupe is on email, and a duplicate is SKIPPED, never merged.** A contact's
 * IBAN and VAT id are what an operator pays against; letting an unchecked
 * spreadsheet overwrite them is the one way this feature could cost real money,
 * and "update the existing row" is exactly that trade. Skipping is reversible by
 * hand, an overwrite is not, so the safe half of the trade is the default. The
 * preview names the contact each skipped row collided with, so the operator can
 * go and edit it deliberately.
 *
 * A row with no email cannot be matched against anything and is imported with
 * that said out loud, rather than quietly becoming a second copy of someone.
 *
 * **An imported IBAN is never verified.** Nothing in the file can make it so —
 * verification is a claim about something the platform checked, and the platform
 * has checked nothing here.
 */
function judgeImportRows(
  rows: readonly ImportRow[],
  ownerProfileId: string,
  existing: readonly ContactRow[],
): JudgedImportRow[] {
  const existingByEmail = new Map<string, string>();
  for (const contact of existing) {
    for (const email of contactEmails(contact)) {
      if (!existingByEmail.has(email)) existingByEmail.set(email, contact.name);
    }
  }
  /** Emails claimed earlier in THIS file — a file can collide with itself. */
  const seenInFile = new Map<string, number>();

  return rows.map((row, index): JudgedImportRow => {
    const clean = (value: string | undefined) => value?.trim() || undefined;
    const name = clean(row.name);
    const email = clean(row.email);
    const verdict = (outcome: ImportResult["outcome"], reason: string | null): JudgedImportRow => ({
      result: { index, name: name ?? "", email: email ?? null, outcome, reason, contactId: null },
      values: null,
    });

    if (!name) return verdict("rejected", "No name — a contact needs one to be findable.");
    if (email && !EmailSchema.safeParse(email).success) {
      return verdict("rejected", `"${email}" is not an email address.`);
    }

    const key = email?.toLowerCase();
    if (key) {
      const collision = existingByEmail.get(key);
      if (collision) {
        return verdict("skipped", `Already in your contacts as "${collision}" — left untouched.`);
      }
      const earlierRow = seenInFile.get(key);
      if (earlierRow != null) {
        return verdict("skipped", `Same email as row ${earlierRow + 1} of this file.`);
      }
      seenInFile.set(key, index);
    }

    const personName = clean(row.personName);
    const phone = clean(row.phone);
    const person =
      personName || email || phone
        ? [
            {
              name: personName ?? name,
              ...(email ? { email } : {}),
              ...(phone ? { phone } : {}),
            },
          ]
        : null;

    return {
      result: {
        index,
        name,
        email: email ?? null,
        outcome: "imported",
        reason: key ? null : "No email — not checked against your existing contacts.",
        contactId: null,
      },
      values: {
        ownerProfileId,
        name,
        type: clean(row.type)?.toLowerCase() ?? null,
        // Stored exactly as typed and NEVER flagged verified — see the note above.
        iban: clean(row.iban) ?? null,
        bankName: clean(row.bankName) ?? null,
        vatId: clean(row.vatId) ?? null,
        address: clean(row.address) ?? null,
        notes: clean(row.notes) ?? null,
        persons: person,
      },
    };
  });
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

  // Preview or commit a CSV import. `commit: false` reports what WOULD happen and
  // writes nothing; `commit: true` runs the same judgement and inserts the rows it
  // accepts, one audit row each ("contact.import"). Either way every submitted row
  // comes back with a verdict — a partial import that says nothing is the failure
  // this route exists to avoid.
  app.post(
    "/profiles/:id/contacts/import",
    {
      schema: {
        params: ProfileParams,
        body: ImportContactsBody,
        response: { 200: ImportContactsResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const { rows, commit } = request.body;

      requireProfileRole(request, id, [...MANAGE_ROLES]);

      const existing = await database
        .select()
        .from(schema.contacts)
        .where(eq(schema.contacts.ownerProfileId, id));
      const judged = judgeImportRows(rows, id, existing);

      if (commit) {
        await database.transaction(async (tx) => {
          for (const row of judged) {
            if (!row.values) continue;
            const [contact] = await tx.insert(schema.contacts).values(row.values).returning();
            if (!contact) throw new Error("contact import insert failed");
            row.result.contactId = contact.id;
            await writeAudit(tx, request, {
              capability: "profile.edit",
              action: "contact.import",
              targetKind: "contact",
              targetId: contact.id,
              after: serializeContact(contact),
            });
          }
        });
      }

      const results = judged.map((row) => row.result);
      const count = (outcome: ImportResult["outcome"]) =>
        results.filter((result) => result.outcome === outcome).length;
      return {
        committed: commit,
        imported: count("imported"),
        skipped: count("skipped"),
        rejected: count("rejected"),
        results,
      };
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
