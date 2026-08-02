import { schema } from "@showme/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";

const ProfileParams = z.object({ id: z.string().uuid() });
const AccountParams = z.object({ pid: z.string().uuid() });

// Bank details are sensitive — manage as owner/admin, read as owner/admin/editor.
const MANAGE_ROLES = ["owner", "admin"] as const;
const READ_ROLES = ["owner", "admin", "editor"] as const;

const payoutMethodEnum = z.enum(["bankgiro", "iban", "swish"]);

const CreatePayoutAccountBody = z.object({
  type: payoutMethodEnum,
  identifier: z.string().optional(),
  currency: z.string().optional(),
  holderName: z.string().optional(),
  bankName: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

// Update leaves `type` optional (an account keeps its method unless explicitly changed).
const UpdatePayoutAccountBody = CreatePayoutAccountBody.partial();

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
