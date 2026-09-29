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

const CreateInvoiceBody = z
  .object({
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
  })
  /*
   * STRICT, so a plausible wrong key is a 400 and not a silent loss (QA sweep run 9, QA9-12).
   *
   * The sweep sent `{"counterpartyName":…, "amount":"777700", "category":"production", …}` — three keys
   * that read like this table's own vocabulary and are not: the amount is `total`, the counterparty is
   * `issuerRef`/`recipientRef`, and there is no category at all. Zod stripped all three and the route
   * answered **201**, so a bill was created carrying none of the information its author had typed.
   *
   * It is the same shape QA8-10 found on `payout_accounts`, and the loop's own words about that one
   * apply unchanged: *"every ingredient of a silent data loss: an optional field, a plausible wrong
   * key, and a success response."* There the fix was to make the field required; here every field
   * legitimately IS optional on a draft, so the only place to catch it is the unknown key itself.
   *
   * Safe for the app: the generated client sends exactly this schema and nothing else. It changes the
   * answer for a hand-written caller, which is precisely who needs telling.
   */
  .strict();

const UpdateInvoiceBody = z
  .object({
    state: stateEnum.optional(),
    currency: z.string().optional(),
    lineItems: z.unknown().optional(),
    vat: z.unknown().optional(),
    total: moneyString,
    dueDate: z.string().optional(),
    recipientRef: z.string().optional(),
    issuerRef: z.string().optional(),
  })
  .strict(); // Same reason as the create body above (QA9-12).

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
/**
 * A MONEY DOCUMENT THAT NAMES NO MONEY IS NOT AN INVOICE — on every door, not one.
 *
 * QA9-12 put this rule on `PATCH /invoices/:iid` and run 11 walked straight past it: the
 * ledger's **Issue** button calls `POST /invoices/:iid/issue`, which makes the same
 * `draft → sent` transition and also assigns the gapless number and freezes
 * `documentSnapshot` — so the route that most needs the rule was the one without it. The
 * sweep clicked it and got *"Invoice issued"*, a row reading **Overdue** with AMOUNT `—`,
 * and a frozen snapshot of a document with no figure on it.
 *
 * A function rather than a second `if`, because this is the third time in two days that a
 * rule kept at one reader turned out to be kept at one reader (QA9-12's own render half,
 * and the budget CSV never getting QA7-26).
 *
 * `total: "0"` is untouched and still issues: a zero somebody wrote is a figure. NULL is the
 * absence of one — the same distinction the ledger draws by printing `SEK 0` against `—`.
 */
function assertInvoiceNamesAnAmount(total: bigint | null): void {
  if (total == null) {
    throw badRequest(
      "This invoice has no amount on it yet. Add the total before sending it. An invoice without one reads as zero everywhere it is listed.",
    );
  }
}

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
      // The same rule the PATCH keeps, and this is the door the ledger's button uses.
      assertInvoiceNamesAnAmount(before.total);

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

      /*
       * AN INVOICE CANNOT BE ISSUED WITHOUT AN AMOUNT (QA sweep run 9, QA9-12).
       *
       * `total` is optional — rightly, because a draft is a document somebody is still writing. What
       * was missing is the line where that stops being true. The sweep advanced a bill to `sent`
       * with `total` NULL and the ledger rendered it as a live liability: *"— · — · — · 15 Jan 2026
       * · SEK 0 · Overdue"*. A money document that names no money is not a smaller invoice; it is
       * not an invoice, and `SEK 0` asserts a figure nobody wrote.
       *
       * Checked against the value this PATCH will LEAVE behind rather than the one it sends, because
       * `{"state":"sent"}` alone is exactly the request that did it — no `total` in the body, and the
       * stored one still null. The freeze above means this can only ever be the draft's own total.
       */
      const totalAfter = total != null ? BigInt(total) : before.total;
      if (state != null && state !== "draft" && state !== "void") {
        assertInvoiceNamesAnAmount(totalAfter);
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
