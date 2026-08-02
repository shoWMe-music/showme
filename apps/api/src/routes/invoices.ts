import { schema } from "@showme/db";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";
import { nextInvoiceNumber } from "../lib/invoice-number";

const InvoiceParams = z.object({ iid: z.string().uuid() });
const ProfileParams = z.object({ id: z.string().uuid() });

const directionEnum = z.enum(["issued", "received"]);
const stateEnum = z.enum(["draft", "sent", "paid", "overdue", "void"]);

const WRITE_ROLES = ["owner", "admin", "editor"] as const;
const READ_ROLES = ["owner", "admin", "editor", "viewer"] as const;

/** Minor-units money as a decimal STRING (money.md) — never a JS number. */
const moneyString = z
  .string()
  .regex(/^-?\d+$/)
  .optional();

const CreateInvoiceBody = z.object({
  ownerProfileId: z.string().uuid(),
  direction: directionEnum,
  eventId: z.string().uuid().optional(),
  transferId: z.string().uuid().optional(),
  budgetLineId: z.string().uuid().optional(),
  issuerRef: z.string().optional(),
  recipientRef: z.string().optional(),
  currency: z.string().optional(),
  lineItems: z.unknown().optional(),
  vat: z.unknown().optional(),
  total: moneyString,
  dueDate: z.string().optional(),
  /** A `received` bill carries the number the external issuer assigned. */
  number: z.string().optional(),
});

const UpdateInvoiceBody = z.object({
  state: stateEnum.optional(),
  currency: z.string().optional(),
  lineItems: z.unknown().optional(),
  vat: z.unknown().optional(),
  total: moneyString,
  dueDate: z.string().optional(),
  recipientRef: z.string().optional(),
  issuerRef: z.string().optional(),
});

const InvoiceResponse = z.object({
  id: z.string(),
  ownerProfileId: z.string(),
  eventId: z.string().nullable(),
  direction: z.string(),
  issuerRef: z.string().nullable(),
  recipientRef: z.string().nullable(),
  transferId: z.string().nullable(),
  budgetLineId: z.string().nullable(),
  number: z.string().nullable(),
  currency: z.string().nullable(),
  lineItems: z.unknown(),
  vat: z.unknown(),
  total: z.string().nullable(),
  issuedAt: z.string().nullable(),
  dueDate: z.string().nullable(),
  state: z.string(),
  documentSnapshot: z.unknown(),
});

type InvoiceRow = typeof schema.invoices.$inferSelect;

function serializeInvoice(invoice: InvoiceRow) {
  return {
    id: invoice.id,
    ownerProfileId: invoice.ownerProfileId,
    eventId: invoice.eventId,
    direction: invoice.direction,
    issuerRef: invoice.issuerRef,
    recipientRef: invoice.recipientRef,
    transferId: invoice.transferId,
    budgetLineId: invoice.budgetLineId,
    number: invoice.number,
    currency: invoice.currency,
    lineItems: invoice.lineItems ?? null,
    vat: invoice.vat ?? null,
    total: invoice.total != null ? invoice.total.toString() : null,
    issuedAt: invoice.issuedAt ? invoice.issuedAt.toISOString() : null,
    dueDate: invoice.dueDate,
    state: invoice.state,
    documentSnapshot: invoice.documentSnapshot ?? null,
  };
}

/** The immutable document frozen on issue (decisions #5) — money as string. */
function freezeInvoice(invoice: InvoiceRow, number: string | null, issuedAt: Date) {
  return {
    number,
    issuedAt: issuedAt.toISOString(),
    direction: invoice.direction,
    currency: invoice.currency,
    issuerRef: invoice.issuerRef,
    recipientRef: invoice.recipientRef,
    lineItems: invoice.lineItems ?? null,
    vat: invoice.vat ?? null,
    total: invoice.total != null ? invoice.total.toString() : null,
    dueDate: invoice.dueDate,
  };
}

async function loadInvoice(request: FastifyRequest, invoiceId: string): Promise<InvoiceRow> {
  const [invoice] = await request.server.database
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, invoiceId));
  if (!invoice) throw notFound("Invoice not found");
  return invoice;
}

export async function invoiceRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // A profile's invoices (its own books — AR + AP), newest first.
  app.get(
    "/profiles/:id/invoices",
    { schema: { params: ProfileParams, response: { 200: z.array(InvoiceResponse) } } },
    async (request) => {
      const profileId = request.params.id;
      requireProfileRole(request, profileId, [...READ_ROLES]);
      const invoices = await request.server.database
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.ownerProfileId, profileId))
        .orderBy(desc(schema.invoices.issuedAt));
      return invoices.map(serializeInvoice);
    },
  );

  // Create a DRAFT invoice — no number yet (numbering happens at issue).
  app.post(
    "/invoices",
    { schema: { body: CreateInvoiceBody, response: { 201: InvoiceResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const body = request.body;
      requireProfileRole(request, body.ownerProfileId, [...WRITE_ROLES]);

      const created = await database.transaction(async (tx) => {
        const [invoice] = await tx
          .insert(schema.invoices)
          .values({
            ownerProfileId: body.ownerProfileId,
            direction: body.direction,
            eventId: body.eventId,
            transferId: body.transferId,
            budgetLineId: body.budgetLineId,
            issuerRef: body.issuerRef,
            recipientRef: body.recipientRef,
            currency: body.currency,
            lineItems: body.lineItems ?? null,
            vat: body.vat ?? null,
            total: body.total != null ? BigInt(body.total) : undefined,
            dueDate: body.dueDate,
            number: body.direction === "received" ? body.number : undefined,
            state: "draft",
          })
          .returning();
        if (!invoice) throw new Error("invoice create failed");
        await writeAudit(tx, request, {
          capability: "budget.edit",
          action: "invoice.create",
          targetKind: "invoice",
          targetId: invoice.id,
          eventId: invoice.eventId ?? undefined,
          after: serializeInvoice(invoice),
        });
        return invoice;
      });

      return reply.status(201).send(serializeInvoice(created));
    },
  );

  // Read one invoice (scoped to the owner profile's members).
  app.get(
    "/invoices/:iid",
    { schema: { params: InvoiceParams, response: { 200: InvoiceResponse } } },
    async (request) => {
      const invoice = await loadInvoice(request, request.params.iid);
      requireProfileRole(request, invoice.ownerProfileId, [...READ_ROLES]);
      return serializeInvoice(invoice);
    },
  );

  // ISSUE — assign the gapless number (issued/AR only), freeze the document, send.
  app.post(
    "/invoices/:iid/issue",
    { schema: { params: InvoiceParams, response: { 200: InvoiceResponse } } },
    async (request) => {
      const { database } = request.server;
      const before = await loadInvoice(request, request.params.iid);
      requireProfileRole(request, before.ownerProfileId, [...WRITE_ROLES]);
      if (before.state !== "draft") throw conflict("Only a draft invoice can be issued");

      const issued = await database.transaction(async (tx) => {
        const issuedAt = new Date();
        // Real gapless sequence (decisions #5) — AR only; a received bill keeps its
        // external number. The FOR UPDATE lock inside makes concurrent issues safe.
        const number =
          before.direction === "issued"
            ? await nextInvoiceNumber(tx, before.ownerProfileId, issuedAt.getFullYear())
            : before.number;

        const [after] = await tx
          .update(schema.invoices)
          .set({
            number,
            issuedAt,
            state: "sent",
            documentSnapshot: freezeInvoice(before, number ?? null, issuedAt),
          })
          .where(eq(schema.invoices.id, before.id))
          .returning();
        if (!after) throw new Error("invoice issue failed");
        await writeAudit(tx, request, {
          capability: "budget.edit",
          action: "invoice.issue",
          targetKind: "invoice",
          targetId: after.id,
          eventId: after.eventId ?? undefined,
          before: serializeInvoice(before),
          after: serializeInvoice(after),
        });
        return after;
      });

      return serializeInvoice(issued);
    },
  );

  // Update — edit DRAFT fields, or transition state (sent→paid/overdue/void). Voiding
  // NEVER renumbers: the number is retained and the issuer sequence is untouched.
  app.patch(
    "/invoices/:iid",
    {
      schema: {
        params: InvoiceParams,
        body: UpdateInvoiceBody,
        response: { 200: InvoiceResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const before = await loadInvoice(request, request.params.iid);
      requireProfileRole(request, before.ownerProfileId, [...WRITE_ROLES]);

      const { state, total, ...rest } = request.body;
      const editsContent =
        total != null || Object.values(rest).some((value) => value !== undefined);
      // Once issued, the document is frozen — only the state may still move.
      if (before.state !== "draft" && editsContent) {
        throw badRequest("An issued invoice is frozen; only its state may change");
      }

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.invoices)
          .set({
            ...rest,
            ...(total != null ? { total: BigInt(total) } : {}),
            ...(state != null ? { state } : {}),
          })
          .where(eq(schema.invoices.id, before.id))
          .returning();
        if (!after) throw new Error("invoice update failed");
        await writeAudit(tx, request, {
          capability: "budget.edit",
          action: state != null ? `invoice.${state}` : "invoice.update",
          targetKind: "invoice",
          targetId: after.id,
          eventId: after.eventId ?? undefined,
          before: serializeInvoice(before),
          after: serializeInvoice(after),
        });
        return after;
      });

      return serializeInvoice(updated);
    },
  );
}
