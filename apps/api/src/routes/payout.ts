import { schema } from "@showme/db";
import { isCurrencyCode } from "@showme/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";

const ProfileParams = z.object({ id: z.string().uuid() });
const AccountParams = z.object({ pid: z.string().uuid() });

// Bank details are sensitive — manage as owner/admin, read as owner/admin/editor.
const MANAGE_ROLES = ["owner", "admin"] as const;
const READ_ROLES = ["owner", "admin", "editor"] as const;

const payoutMethodEnum = z.enum(["bankgiro", "iban", "swish"]);

/**
 * WHAT EACH METHOD'S IDENTIFIER LOOKS LIKE (QA sweep run 9, QA9-17).
 *
 * QA8-10 made `identifier` required; nothing then checked it against `type`, so an account typed
 * `iban` accepted `not-an-iban`. On the one table whose entire purpose is to say where money
 * goes, and with no caller yet — which is exactly why it is worth closing now, since the first
 * caller will be written against whatever this accepts.
 *
 * DELIBERATELY LOOSE, and that is a decision rather than laziness. These are SHAPE checks, not
 * validations: no IBAN mod-97 checksum, no Swedish Luhn. A validator that is too strict rejects
 * a legitimate account somebody is waiting to be paid into, which is a worse failure than one
 * that accepts a plausible typo — so each pattern is drawn to catch prose and nothing more.
 * `bankgiro` and `swish` are Swedish instruments by definition (#17 — the platform is
 * territory-scoped), so a Swedish shape is the right shape for them; `iban` is international and
 * is checked only for its country-and-check-digit prefix.
 */
const IDENTIFIER_SHAPES: Record<
  z.infer<typeof payoutMethodEnum>,
  { readonly pattern: RegExp; readonly looksLike: string }
> = {
  // Spaces are how people write an IBAN and are stripped before the test, not rejected.
  iban: {
    // 15–34 characters all told, which is the IBAN registry's own range.
    pattern: /^[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,30}$/,
    looksLike:
      "two letters, two check digits, then the account — e.g. SE45 5000 0000 0583 9825 7466",
  },
  // 7 or 8 digits, and the dash is how they are PRINTED rather than part of the number — a
  // caller who sends `50516905` has sent a bankgiro number and is not wrong.
  bankgiro: { pattern: /^\d{3,4}-?\d{4}$/, looksLike: "7 or 8 digits — e.g. 5051-6905" },
  swish: { pattern: /^\+?\d{7,15}$/, looksLike: "the phone number it pays to — e.g. 0701234567" },
};

/** The identifier with the spacing people type it with removed. */
function normalizedIdentifier(value: string): string {
  return value.replace(/\s+/g, "");
}

/**
 * A PAYOUT ACCOUNT THAT IDENTIFIES NOTHING IS NOT AN ACCOUNT (QA sweep run 8, QA8-10).
 *
 * `identifier` was optional, so `{"type":"iban","label":"QA8 bank","iban":"SE45…"}` was
 * accepted as **201** and stored with `identifier: null` — an IBAN payout account with no
 * IBAN, returned to the caller as created. Note what the caller had actually sent: the
 * number, under the key `iban`, which Zod then stripped. Every ingredient of a silent data
 * loss: an optional field, a plausible wrong key, and a success response.
 *
 * This is the one table whose whole purpose is to say where money goes. It is also
 * currently unreachable from either front end (`POST` has no caller), which is exactly why
 * it is worth closing now — the first caller will be written against whatever this accepts.
 */
const PayoutAccountFields = z
  .object({
    type: payoutMethodEnum,
    /** Where the money actually goes: an IBAN, a bankgiro number, a Swish number. */
    identifier: z.string().trim().min(1, "A payout account needs the number money goes to"),
    /*
     * A KNOWN currency, the same rule `/invoices` applies in its dialog after run 6's QA6-17 —
     * `currency: "XYZ"` was accepted here and stored (QA9-17). `isCurrencyCode` is the one list.
     */
    currency: z
      .string()
      .optional()
      .refine((value) => value == null || isCurrencyCode(value), {
        message: "Unknown currency code",
      }),
    holderName: z.string().optional(),
    bankName: z.string().optional(),
    isPrimary: z.boolean().optional(),
  })
  .describe("A payout account, as either path writes it");

/**
 * THE IDENTIFIER AGAINST ITS OWN METHOD — the whole rule, in one place.
 *
 * Returns the sentence to refuse with, or `null` when the pair agrees. Both paths call it: the
 * create body as a Zod refinement, and the update HANDLER against the stored row's `type`.
 *
 * It has to be a function rather than two checks because the second caller cannot be a schema.
 * A `PATCH` body is a `.partial()`, so `{"identifier":"not-an-iban"}` arrives with no `type` —
 * and the type it must be judged against is the one already in the database. A refinement can
 * only see the request, so a schema-only rule would let exactly that request through and turn a
 * correct IBAN account into prose one field at a time. Measured by a surviving mutation: deleting
 * the `type === undefined` guard changed nothing, because nothing tested the case the guard was
 * standing in for.
 */
function identifierProblem(
  type: z.infer<typeof payoutMethodEnum>,
  identifier: string,
): string | null {
  const shape = IDENTIFIER_SHAPES[type];
  if (shape.pattern.test(normalizedIdentifier(identifier))) return null;
  return `That does not look like a ${type} number — ${shape.looksLike}.`;
}

/** The rule as a Zod refinement, for a body that carries both halves. */
function refineIdentifierAgainstType(
  body: { type?: z.infer<typeof payoutMethodEnum>; identifier?: string },
  ctx: z.RefinementCtx,
): void {
  // An update sending one half is checked in the handler, where the other half is readable.
  if (body.type === undefined || body.identifier === undefined) return;
  const problem = identifierProblem(body.type, body.identifier);
  if (problem === null) return;
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["identifier"], message: problem });
}

const CreatePayoutAccountBody = PayoutAccountFields.superRefine(refineIdentifierAgainstType);

/*
 * Update leaves `type` optional (an account keeps its method unless explicitly changed).
 * `.partial()` makes `identifier` omittable, which is right — but it keeps the `min(1)` on
 * the value when one IS sent, so an existing account cannot be emptied into the same state
 * the create path used to allow (QA8-10). `.partial()` is taken off the OBJECT, not off the
 * refined create body: a refinement wraps the schema in a `ZodEffects`, which has no `.partial()`
 * and whose inferred output would come back `unknown` — so the shared refinement is re-applied
 * here instead.
 */
const UpdatePayoutAccountBody = PayoutAccountFields.partial().superRefine(
  refineIdentifierAgainstType,
);

const PayoutAccountResponse = z.object({
  id: z.string(),
  profileId: z.string(),
  type: z.string(),
  identifier: z.string().nullable(),
  currency: z.string().nullable(),
  holderName: z.string().nullable(),
  bankName: z.string().nullable(),
  isPrimary: z.boolean(),
});

/** The issuer's billing identity (decisions #5) — persisted in `profiles.billing`. */
const BillingBody = z.object({
  legalName: z.string().optional(),
  address: z.string().optional(),
  vatId: z.string().optional(),
  vatRegistered: z.boolean().optional(),
  vatRate: z.number().optional(),
});

type PayoutAccountRow = typeof schema.payoutAccounts.$inferSelect;

function serializeAccount(account: PayoutAccountRow) {
  return {
    id: account.id,
    profileId: account.profileId,
    type: account.type,
    identifier: account.identifier,
    currency: account.currency,
    holderName: account.holderName,
    bankName: account.bankName,
    isPrimary: account.isPrimary,
  };
}

async function loadAccount(request: FastifyRequest, accountId: string): Promise<PayoutAccountRow> {
  const [account] = await request.server.database
    .select()
    .from(schema.payoutAccounts)
    .where(eq(schema.payoutAccounts.id, accountId));
  if (!account) throw notFound("Payout account not found");
  return account;
}

export async function payoutRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // The profile's payout accounts (its money-receiving identity, decisions #5).
  app.get(
    "/profiles/:id/payout-accounts",
    { schema: { params: ProfileParams, response: { 200: z.array(PayoutAccountResponse) } } },
    async (request) => {
      const profileId = request.params.id;
      requireProfileRole(request, profileId, [...READ_ROLES]);
      const accounts = await request.server.database
        .select()
        .from(schema.payoutAccounts)
        .where(eq(schema.payoutAccounts.profileId, profileId));
      return accounts.map(serializeAccount);
    },
  );

  // Add a payout account — typed method (bankgiro / IBAN / Swish; more later).
  app.post(
    "/profiles/:id/payout-accounts",
    {
      schema: {
        params: ProfileParams,
        body: CreatePayoutAccountBody,
        response: { 201: PayoutAccountResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const profileId = request.params.id;
      requireProfileRole(request, profileId, [...MANAGE_ROLES]);

      const created = await database.transaction(async (tx) => {
        const [account] = await tx
          .insert(schema.payoutAccounts)
          .values({ profileId, ...request.body })
          .returning();
        if (!account) throw new Error("payout account create failed");
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "payout_account.create",
          targetKind: "payout_account",
          targetId: account.id,
          after: serializeAccount(account),
        });
        return account;
      });
      return reply.status(201).send(serializeAccount(created));
    },
  );

  // Update a payout account.
  app.patch(
    "/payout-accounts/:pid",
    {
      schema: {
        params: AccountParams,
        body: UpdatePayoutAccountBody,
        response: { 200: PayoutAccountResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const before = await loadAccount(request, request.params.pid);
      requireProfileRole(request, before.profileId, [...MANAGE_ROLES]);

      /*
       * The method this identifier is being judged against is whichever one the account will
       * HAVE after the edit — the one sent, or the stored one when the edit does not mention it.
       * The schema cannot do this half (it never sees the row), and it is the half that matters:
       * an account is created once and edited many times.
       */
      if (request.body.identifier !== undefined) {
        const type = request.body.type ?? (before.type as z.infer<typeof payoutMethodEnum>);
        const problem = identifierProblem(type, request.body.identifier);
        if (problem !== null) throw badRequest(problem);
      }

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.payoutAccounts)
          .set(request.body)
          .where(eq(schema.payoutAccounts.id, before.id))
          .returning();
        if (!after) throw new Error("payout account update failed");
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "payout_account.update",
          targetKind: "payout_account",
          targetId: after.id,
          before: serializeAccount(before),
          after: serializeAccount(after),
        });
        return after;
      });
      return serializeAccount(updated);
    },
  );

  // Remove a payout account.
  app.delete(
    "/payout-accounts/:pid",
    { schema: { params: AccountParams } },
    async (request, reply) => {
      const { database } = request.server;
      const before = await loadAccount(request, request.params.pid);
      requireProfileRole(request, before.profileId, [...MANAGE_ROLES]);
      await database.transaction(async (tx) => {
        await tx.delete(schema.payoutAccounts).where(eq(schema.payoutAccounts.id, before.id));
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "payout_account.delete",
          targetKind: "payout_account",
          targetId: before.id,
          before: serializeAccount(before),
        });
      });
      return reply.status(204).send();
    },
  );

  // Set the profile's billing identity (legal name, VAT). The gapless invoice
  // counter (`invoiceNumberByYear`) is system-managed and preserved untouched.
  app.patch(
    "/profiles/:id/billing",
    { schema: { params: ProfileParams, body: BillingBody, response: { 200: BillingBody } } },
    async (request) => {
      const { database } = request.server;
      const profileId = request.params.id;
      requireProfileRole(request, profileId, [...MANAGE_ROLES]);

      const updated = await database.transaction(async (tx) => {
        const [profile] = await tx
          .select({ billing: schema.profiles.billing })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, profileId));
        if (!profile) throw notFound("Profile not found");
        const billing = (profile.billing ?? {}) as Record<string, unknown>;
        const merged = { ...billing, ...request.body };
        await tx
          .update(schema.profiles)
          .set({ billing: merged })
          .where(eq(schema.profiles.id, profileId));
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "billing.update",
          targetKind: "profile",
          targetId: profileId,
          after: request.body,
        });
        return request.body;
      });
      return updated;
    },
  );
}
