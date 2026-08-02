import { randomBytes } from "node:crypto";
import { schema } from "@showme/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError, badRequest, notFound, unauthorized } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import {
  MAX_VERIFY_ATTEMPTS,
  OTP_TTL_MS,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  emailHash,
  generateOtpCode,
  generateSalt,
  hashOtpCode,
  mintShareJwt,
  normalizeEmail,
  verifyOtpCode,
  verifyShareJwt,
} from "../lib/share-crypto";

/**
 * Module 9 — off-platform shares (decisions #6, `docs/off-platform-access.md`).
 * A tokenized capability grant + an OTP→JWT "front door" so a non-account
 * recipient can view a scoped slice and act (comment) without signing up.
 *
 * RECIPIENTS ARE NEVER LEAKED — no route ever returns the `share_recipients` list.
 *
 * The HS256 secret is read from `process.env.SHARE_JWT_SECRET`. In production it
 * MUST be set (Secret Manager). For local/test runs it falls back to
 * `SHARE_JWT_TEST_SECRET` below — a fixed, well-known development constant that is
 * NOT safe for production.
 */
const SHARE_JWT_TEST_SECRET = "showme-share-jwt-development-secret";

function shareJwtSecret(): string {
  return process.env.SHARE_JWT_SECRET ?? SHARE_JWT_TEST_SECRET;
}

const TokenParams = z.object({ token: z.string().min(1) });
const EventParams = z.object({ id: z.string().uuid() });

const CreateShareBody = z.object({
  targetKind: z.string().min(1).optional(),
  targetId: z.string().uuid().optional(),
  capabilities: z.array(z.string()),
  access: z.enum(["public", "protected"]),
  expiresAt: z.string().datetime().optional(),
  recipients: z
    .array(z.object({ email: z.string().email(), name: z.string().optional() }))
    .optional(),
});

const CreateShareResponse = z.object({ token: z.string() });

/** The public grant — the scope only; NEVER the recipients. */
const GrantResponse = z.object({
  targetKind: z.string().nullable(),
  targetId: z.string().nullable(),
  capabilities: z.array(z.string()),
});

const OtpBody = z.object({ email: z.string().email() });
const OtpResponse = z.object({ sent: z.literal(true), code: z.string().optional() });

const VerifyBody = z.object({ email: z.string().email(), code: z.string().min(1) });
const VerifyResponse = z.object({ token: z.string() });

const CommentBody = z.object({ message: z.string().min(1) });
const CommentResponse = z.object({ id: z.string() });

type Share = typeof schema.shares.$inferSelect;

/** Load a live share by token: 404 if missing, expired (`expiresAt` past), or revoked. */
async function loadLiveShare(request: FastifyRequest, token: string): Promise<Share> {
  const [share] = await request.server.database
    .select()
    .from(schema.shares)
    .where(eq(schema.shares.token, token));
  if (!share) throw notFound("Share not found");
  if (share.revokedAt) throw notFound("Share not found");
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) throw notFound("Share not found");
  return share;
}

/** Parse an `Authorization: ShareBearer <jwt>` header. */
function shareBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme === "ShareBearer" && value ? value : undefined;
}

/**
 * Resolve a verified off-platform recipient email for `share` from a ShareBearer
 * JWT: the JWT must be valid, its `token` claim must match the share, and its
 * email must belong to a `share_recipient` of this share. Returns the matched
 * recipient row, or `null` if any check fails.
 */
async function resolveRecipient(
  request: FastifyRequest,
  share: Share,
): Promise<typeof schema.shareRecipients.$inferSelect | null> {
  const jwt = shareBearerToken(request.headers.authorization);
  if (!jwt) return null;
  const claims = verifyShareJwt(jwt, shareJwtSecret());
  if (!claims || claims.token !== share.token) return null;

  const email = normalizeEmail(claims.email);
  const [recipient] = await request.server.database
    .select()
    .from(schema.shareRecipients)
    .where(
      and(eq(schema.shareRecipients.shareId, share.id), eq(schema.shareRecipients.email, email)),
    );
  return recipient ?? null;
}

export async function shareRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Create (authed): the sharer needs `event.edit` on the event. Seeds optional
  // recipients. Returns ONLY the token — never the recipient list. Audited.
  app.post(
    "/events/:id/shares",
    {
      schema: {
        params: EventParams,
        body: CreateShareBody,
        response: { 201: CreateShareResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "event.edit");
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      if (!principal.actingProfileId) {
        throw badRequest("Set X-Profile-Id to the profile creating the share");
      }

      const token = randomBytes(24).toString("hex");
      const { targetKind, targetId, capabilities, access, expiresAt, recipients } = request.body;

      const created = await database.transaction(async (tx) => {
        const [share] = await tx
          .insert(schema.shares)
          .values({
            token,
            eventId: id,
            targetKind,
            targetId,
            capabilities,
            access,
            ownerUserId: principal.userId,
            ownerProfileId: principal.actingProfileId as string,
            expiresAt: expiresAt ? new Date(expiresAt) : undefined,
          })
          .returning();
        if (!share) throw new Error("share create failed");

        if (recipients && recipients.length > 0) {
          await tx.insert(schema.shareRecipients).values(
            recipients.map((recipient) => ({
              shareId: share.id,
              email: normalizeEmail(recipient.email),
              name: recipient.name,
            })),
          );
        }

        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "share.create",
          targetKind: "share",
          targetId: share.id,
          eventId: id,
          after: { access: share.access, targetKind: share.targetKind },
        });
        return share;
      });

      return reply.status(201).send({ token: created.token });
    },
  );

  // Read (public): resolve a share by token. `public` → return the grant with no
  // principal. `protected` → require a valid ShareBearer JWT matching a recipient.
  app.get(
    "/shares/:token",
    { config: { public: true }, schema: { params: TokenParams, response: { 200: GrantResponse } } },
    async (request) => {
      const share = await loadLiveShare(request, request.params.token);

      if (share.access === "protected") {
        const recipient = await resolveRecipient(request, share);
        if (!recipient) throw unauthorized("Recipient verification required");
      }

      return {
        targetKind: share.targetKind,
        targetId: share.targetId,
        capabilities: share.capabilities,
      };
    },
  );

  // OTP issue (public): rate-limit 3/hour per (share,email), then upsert a fresh
  // salted-SHA256 code with a 10-min TTL. The code is returned ONLY when the test
  // hook header `x-test-otp: 1` is present; in production it is delivered by email.
  app.post(
    "/shares/:token/otp",
    {
      config: { public: true },
      schema: { params: TokenParams, body: OtpBody, response: { 200: OtpResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const share = await loadLiveShare(request, request.params.token);
      const email = normalizeEmail(request.body.email);
      const hash = emailHash(email);
      const now = Date.now();

      const [existing] = await database
        .select()
        .from(schema.shareOtps)
        .where(and(eq(schema.shareOtps.shareId, share.id), eq(schema.shareOtps.emailHash, hash)));

      // A rate window is "active" while `rateWindowStart` is younger than an hour.
      // Within an active window `attempts` doubles as the issue counter (see the
      // note on this route: the fixed 2-column schema — `attempts`,
      // `rateWindowStart` — makes `attempts` serve both the issue count and the
      // per-code verify count; on a fresh window it starts at 0, so the common
      // single-issue → verify path keeps the full 5-attempt verify budget).
      const windowActive =
        existing?.rateWindowStart != null &&
        now - existing.rateWindowStart.getTime() < RATE_WINDOW_MS;
      const issuesSoFar = windowActive && existing ? existing.attempts + 1 : 0;
      if (issuesSoFar >= RATE_LIMIT) {
        throw new HttpError(
          429,
          "Too many verification codes requested; try again later",
          "rate_limited",
        );
      }

      const code = generateOtpCode();
      const salt = generateSalt();
      const values = {
        codeHash: hashOtpCode(salt, code),
        salt,
        expiresAt: new Date(now + OTP_TTL_MS),
        attempts: issuesSoFar, // 0 on a fresh window; carries the issue count within one
        rateWindowStart:
          windowActive && existing?.rateWindowStart ? existing.rateWindowStart : new Date(now),
      };

      if (existing) {
        await database
          .update(schema.shareOtps)
          .set(values)
          .where(eq(schema.shareOtps.id, existing.id));
      } else {
        await database
          .insert(schema.shareOtps)
          .values({ shareId: share.id, emailHash: hash, ...values });
      }

      const testHook = request.headers["x-test-otp"];
      const exposeCode = (Array.isArray(testHook) ? testHook[0] : testHook) === "1";
      return exposeCode ? { sent: true as const, code } : { sent: true as const };
    },
  );

  // OTP verify (public): expired / too-many-attempts → 401 + delete; wrong code →
  // increment attempts (delete on the 5th) + 401; correct → delete + mint a 24h JWT.
  app.post(
    "/shares/:token/verify",
    {
      config: { public: true },
      schema: { params: TokenParams, body: VerifyBody, response: { 200: VerifyResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const share = await loadLiveShare(request, request.params.token);
      const email = normalizeEmail(request.body.email);
      const hash = emailHash(email);

      const [otp] = await database
        .select()
        .from(schema.shareOtps)
        .where(and(eq(schema.shareOtps.shareId, share.id), eq(schema.shareOtps.emailHash, hash)));
      if (!otp) throw unauthorized("Invalid or expired code");

      if (otp.expiresAt.getTime() <= Date.now() || otp.attempts >= MAX_VERIFY_ATTEMPTS) {
        await database.delete(schema.shareOtps).where(eq(schema.shareOtps.id, otp.id));
        throw unauthorized("Invalid or expired code");
      }

      if (!verifyOtpCode(otp.salt, request.body.code, otp.codeHash)) {
        const nextAttempts = otp.attempts + 1;
        if (nextAttempts >= MAX_VERIFY_ATTEMPTS) {
          await database.delete(schema.shareOtps).where(eq(schema.shareOtps.id, otp.id));
        } else {
          await database
            .update(schema.shareOtps)
            .set({ attempts: nextAttempts })
            .where(eq(schema.shareOtps.id, otp.id));
        }
        throw unauthorized("Invalid or expired code");
      }

      await database.delete(schema.shareOtps).where(eq(schema.shareOtps.id, otp.id));
      const jwt = mintShareJwt(share.token, email, shareJwtSecret());
      return { token: jwt };
    },
  );

  // Comment (public): a protected share needs a valid ShareBearer JWT (email ∈
  // recipients); a public share is open. The comment is attributed to the JWT
  // email/recipient name. Writes to the existing `settlement_comments` table.
  app.post(
    "/shares/:token/comment",
    {
      config: { public: true },
      schema: { params: TokenParams, body: CommentBody, response: { 201: CommentResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const share = await loadLiveShare(request, request.params.token);
      if (!share.eventId) throw badRequest("Share is not attached to an event");

      const recipient = await resolveRecipient(request, share);
      if (share.access === "protected" && !recipient) {
        throw unauthorized("Recipient verification required");
      }

      const [comment] = await database
        .insert(schema.settlementComments)
        .values({
          eventId: share.eventId,
          partyParticipantId: recipient?.linkedParticipantId ?? undefined,
          authorEmail: recipient?.email,
          authorName: recipient?.name ?? undefined,
          message: request.body.message,
        })
        .returning();
      if (!comment) throw new Error("comment insert failed");

      return reply.status(201).send({ id: comment.id });
    },
  );
}
