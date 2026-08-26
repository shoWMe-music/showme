import { randomBytes } from "node:crypto";
import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  HttpError,
  badRequest,
  forbidden,
  notFound,
  serviceUnavailable,
  unauthorized,
} from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { confirmDealIfComplete } from "../lib/deal-confirmation";
import { renderShareVerificationCodeEmail } from "../lib/email-templates";
import { createSlidingWindowRateLimiter } from "../lib/rate-limit";
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
import {
  SECTIONS,
  ShareDocumentSchema,
  buildShareDocument,
  visibleSections,
} from "../lib/share-document";
import {
  type RecipientParty,
  SHARABLE_CAPABILITIES,
  findRecipientParty,
  narrowSharedCapabilities,
  viewerCapabilities,
} from "../lib/share-scope";

/**
 * Module 9 — off-platform shares (decisions #6, `docs/off-platform-access.md`).
 * A tokenized capability grant + an OTP→JWT "front door" so a non-account
 * recipient can view a scoped slice and act (comment, confirm) without signing up.
 *
 * RECIPIENTS ARE NEVER LEAKED BY A TOKEN ROUTE — nothing reachable with only the
 * share token returns the `share_recipients` list, so a forwarded link cannot be
 * used to harvest who else was sent it. The one route that does return them
 * (`GET /events/:id/shares`) is authenticated and needs `event.edit`: it shows the
 * operator the addresses the operator themselves typed, which is the "sent →
 * opened → confirmed" visibility the flow is useless without.
 *
 * THE TOKEN IS THE GRANT. It travels in the URL path, so it must never reach a log
 * line — `logging.ts` masks the segment after `/shares/`, and nothing here logs a
 * URL, a token or a code by hand.
 *
 * The HS256 secret is read from `process.env.SHARE_JWT_SECRET` (Secret Manager in
 * production). For local and test runs it falls back to `SHARE_JWT_TEST_SECRET`
 * below — a fixed, well-known development constant.
 */
const SHARE_JWT_TEST_SECRET = "showme-share-jwt-development-secret";

/**
 * The signing key, or a refusal.
 *
 * In production the fallback is NOT a fallback, it is a forgery kit: the constant
 * is in this file, so a deployment that quietly used it would accept a
 * `ShareBearer` JWT that anyone could mint for any share token and any recipient
 * address — the OTP, the recipient list and the party scoping all bypassed by a
 * signature anybody can compute. `SHARE_JWT_SECRET` went unset in prod once
 * already (`docs/deployment-status.md`), so this is not a hypothetical.
 *
 * A 503 rather than a silent downgrade: an unconfigured deployment is a
 * deployment state, and the honest answer is "this is not switched on here" (the
 * same shape `lib/calendar-integration.ts` uses for its own missing credential).
 */
function shareJwtSecret(): string {
  const configured = process.env.SHARE_JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw serviceUnavailable("Off-platform sharing is not configured on this deployment");
  }
  return SHARE_JWT_TEST_SECRET;
}

/**
 * May this deployment echo a freshly issued OTP back in the response?
 *
 * DENY BY DEFAULT, and the reason is worth stating plainly: this hook used to be
 * `request.headers["x-test-otp"] === "1"` and nothing else. A header any client
 * can set turned the OTP into a formality — anyone holding a protected share URL
 * could ask for a code for a recipient's address, be handed the plaintext, verify
 * it, and be issued a 24-hour JWT as that recipient. The identity challenge was
 * bypassable by typing one header.
 *
 * So the header is now only *half* the condition: the environment has to opt in
 * as well. `NODE_ENV=test` covers the API suite; `SHARE_OTP_ECHO=1` is the local
 * walkthrough's opt-in and is set nowhere else.
 */
function mayEchoOtpCode(): boolean {
  return process.env.NODE_ENV === "test" || process.env.SHARE_OTP_ECHO === "1";
}

const TokenParams = z.object({ token: z.string().min(1) });
const EventParams = z.object({ id: z.string().uuid() });
const EventShareParams = z.object({ id: z.string().uuid(), shareId: z.string().uuid() });

/** The sections a comment or an approval may name — the document's own vocabulary. */
const SectionEnum = z.enum(SECTIONS);

const CreateShareBody = z.object({
  /**
   * WHICH ROW the share is about, in the document's own vocabulary — not a second
   * granularity model beside `capabilities` (see `lib/share-scope.ts`). It was
   * `z.string()`, so `targetKind: "banana"` was accepted, stored, and echoed back
   * by `GET /shares/:token` as though the system knew what it meant. A stored
   * string that looks like authority and answers to nothing is the exact failure
   * `narrowSharedCapabilities` exists to prevent one field to the left.
   *
   * Only `deal` currently narrows anything (`share-document.ts` filters to
   * `targetId`); the rest are metadata on the record, and constraining them to the
   * six real sections is what keeps them honest metadata.
   */
  targetKind: SectionEnum.optional(),
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

/** The operator's own view of a link they issued, recipients and all. */
const OwnedShareResponse = z.array(
  z.object({
    id: z.string(),
    token: z.string(),
    targetKind: z.string().nullable(),
    targetId: z.string().nullable(),
    capabilities: z.array(z.string()),
    access: z.string(),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    recipients: z.array(
      z.object({
        email: z.string(),
        name: z.string().nullable(),
        isParty: z.boolean(),
        invitedAt: z.string(),
        lastSeenAt: z.string().nullable(),
        claimed: z.boolean(),
      }),
    ),
  }),
);

const OtpBody = z.object({ email: z.string().email() });
const OtpResponse = z.object({ sent: z.literal(true), code: z.string().optional() });

const VerifyBody = z.object({ email: z.string().email(), code: z.string().min(1) });
const VerifyResponse = z.object({ token: z.string() });

const CommentBody = z.object({
  message: z.string().min(1).max(4000),
  section: SectionEnum.optional(),
});
const CommentResponse = z.object({ id: z.string() });

const ApproveBody = z.object({
  subject: z.enum(["settlement", "agreement"]),
  /** Required for `agreement` — which deal's own line is being confirmed. */
  dealId: z.string().uuid().optional(),
});
const ApproveResponse = z.object({ approvedAt: z.string() });

type Share = typeof schema.shares.$inferSelect;
type Recipient = typeof schema.shareRecipients.$inferSelect;

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

/** Parse an ordinary `Authorization: Bearer <firebase-id-token>` header. */
function firebaseBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme === "Bearer" && value ? value : undefined;
}

/** Find the recipient row for a verified email on this share. */
async function recipientByEmail(
  request: FastifyRequest,
  share: Share,
  email: string,
): Promise<Recipient | null> {
  const [recipient] = await request.server.database
    .select()
    .from(schema.shareRecipients)
    .where(
      and(
        eq(schema.shareRecipients.shareId, share.id),
        eq(schema.shareRecipients.email, normalizeEmail(email)),
      ),
    );
  return recipient ?? null;
}

/**
 * Resolve who is holding this link — the second and third of the three front
 * doors in `docs/off-platform-access.md`:
 *
 *     OTP → JWT         → token principal, email  → email-matched recipient
 *     signed-in account → Firebase uid + VERIFIED email → the same recipient
 *
 * The signed-in door is what makes a share claimable. When a real account whose
 * email is verified opens a link addressed to that email, the recipient row is
 * stamped with their `claimed_by_user_id` — so the operator's list can say
 * "joined shoWMe" and a later flow has the edge it needs to attach the person to
 * the party they have been acting as. An UNVERIFIED email is refused: anyone can
 * type an address into a signup form, and the whole point of this door is that
 * someone else already proved the address.
 *
 * Returns null when neither door opens — the caller decides whether that is fatal
 * (protected share) or fine (public share).
 */
async function resolveRecipient(request: FastifyRequest, share: Share): Promise<Recipient | null> {
  const jwt = shareBearerToken(request.headers.authorization);
  if (jwt) {
    const claims = verifyShareJwt(jwt, shareJwtSecret());
    if (!claims || claims.token !== share.token) return null;
    return await recipientByEmail(request, share, claims.email);
  }

  const idToken = firebaseBearerToken(request.headers.authorization);
  if (!idToken) return null;
  let email: string | undefined;
  let uid: string | undefined;
  try {
    const user = await request.server.tokenVerifier.verify(idToken);
    if (!user.emailVerified || !user.email) return null;
    email = user.email;
    uid = user.uid;
  } catch {
    return null;
  }

  const recipient = await recipientByEmail(request, share, email);
  if (!recipient || !uid) return null;
  if (recipient.claimedByUserId !== uid) {
    await request.server.database
      .update(schema.shareRecipients)
      .set({ claimedByUserId: uid })
      .where(eq(schema.shareRecipients.id, recipient.id));
  }
  return { ...recipient, claimedByUserId: uid };
}

/** Note that this recipient has opened the link — the operator's "seen" column. */
async function touchRecipient(request: FastifyRequest, recipient: Recipient): Promise<void> {
  await request.server.database
    .update(schema.shareRecipients)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.shareRecipients.id, recipient.id));
}

/**
 * The party a recipient stands for, re-resolved LIVE on every request rather than
 * trusted from the stored `linked_participant_id`.
 *
 * The stored column is the record — it is what makes a recipient claimable, and it
 * is what the operator's list reads. But a participant can be removed from an event
 * after a link is sent, and a share that kept serving a party's slice because a
 * column still pointed at it would be exactly the drift this rebuild deletes. So
 * the column is a cache of a join, and the join is what authorizes.
 */
async function recipientParty(
  request: FastifyRequest,
  share: Share,
  recipient: Recipient | null,
): Promise<RecipientParty | null> {
  if (!recipient || !share.eventId) return null;
  const party = await findRecipientParty(request.server.database, share.eventId, recipient.email);
  if ((party?.participantId ?? null) !== recipient.linkedParticipantId) {
    await request.server.database
      .update(schema.shareRecipients)
      .set({ linkedParticipantId: party?.participantId ?? null })
      .where(eq(schema.shareRecipients.id, recipient.id));
  }
  return party;
}

/**
 * Everything a token route needs about its caller, in one place: the share, the
 * verified recipient, their party, and the capabilities THIS viewer gets (the
 * grant, narrowed by the authorization ceiling for a party recipient).
 */
async function resolveShareViewer(request: FastifyRequest, token: string) {
  const share = await loadLiveShare(request, token);
  const recipient = await resolveRecipient(request, share);
  if (share.access === "protected" && !recipient) {
    throw unauthorized("Recipient verification required");
  }
  const party = await recipientParty(request, share, recipient);
  const granted = share.capabilities.filter((value): value is Capability =>
    SHARABLE_CAPABILITIES.includes(value as Capability),
  );
  return {
    share,
    recipient,
    party,
    capabilities: viewerCapabilities(granted, party?.role ?? null),
  };
}

/**
 * The audit row for an act performed by someone with no account.
 *
 * `writeAudit` reads the actor off `request.principal`, and an off-platform
 * recipient has none — so this writes the trail by hand with a NULL actor and the
 * recipient's email as the identity. Skipping the trail was not an option: an
 * approval is a signature, and an unattributed signature is not one.
 */
async function writeOffPlatformAudit(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  tx: any,
  request: FastifyRequest,
  entry: {
    capability: Capability;
    action: string;
    targetKind: string;
    /** Undefined when the act has no row of its own yet (an approval with no
     * computed settlement) — the trail still records who did what, and `after`
     * carries the participant it was about. */
    targetId: string | undefined;
    eventId: string;
    email: string | null;
    after: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(schema.auditLog).values({
    actorUserId: null,
    actingProfileId: null,
    capability: entry.capability,
    action: entry.action,
    targetKind: entry.targetKind,
    targetId: entry.targetId,
    eventId: entry.eventId,
    changes: { before: null, after: { ...entry.after, offPlatformEmail: entry.email } },
    requestId: request.id,
  });
}

/** Client IP for rate-limit keying — prefer the proxy's forwarded-for (Cloud Run). */
function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0]?.trim() || request.ip;
  return request.ip;
}

export async function shareRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * The limit the stored one could not enforce.
   *
   * `share_otps` throttles 3 codes an hour per (share, EMAIL) — and the email is
   * chosen by the caller, so a script holding one leaked link defeats it by typing
   * a different address each time. Every one of those writes a row and burns a
   * hash; none is ever delivered (`recipientByEmail` gates the send), so the flood
   * is silent and lands entirely in the database.
   *
   * Keyed by (IP, share) rather than by IP alone because that is the shape of the
   * hole: one link, one attacker, unbounded addresses. Ten an hour is far above
   * what a recipient who mistypes their address and asks again needs, and far
   * below what rotating a wordlist needs.
   *
   * Honest about its reach, the same way `lib/rate-limit.ts` and `routes/inbound.ts`
   * are: this state lives in the PROCESS, and the API is Cloud Run with several
   * instances and scale-to-zero, so a flood spread across instances sees a fresh
   * window. It closes the email-rotation hole; a distributed flood is the edge's
   * job (Cloud Armor), and nothing here pretends otherwise.
   */
  const otpRequestsPerIp = createSlidingWindowRateLimiter({ limit: 10, windowMs: RATE_WINDOW_MS });

  // Create (authed): the sharer needs `event.edit` on the event, AND may only
  // grant capabilities they hold themselves (see `narrowSharedCapabilities` — the
  // escalation that check closes). Seeds optional recipients, each resolved
  // against the event's participants so a party-scoped link knows whose slice it
  // is. Returns ONLY the token — never the recipient list. Audited.
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

      const held = await requireEventCapability(request, id, "event.edit");
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      if (!principal.actingProfileId) {
        throw badRequest("Set X-Profile-Id to the profile creating the share");
      }

      const { targetKind, targetId, access, expiresAt, recipients } = request.body;
      const capabilities = narrowSharedCapabilities(request.body.capabilities, held, access);
      if (access === "protected" && (!recipients || recipients.length === 0)) {
        throw badRequest("A protected share needs at least one recipient email");
      }

      // Resolve each recipient to the party they already are on this event. Done
      // BEFORE the insert so the party link is part of the record from the start.
      const linked = new Map<string, string | null>();
      for (const recipient of recipients ?? []) {
        const email = normalizeEmail(recipient.email);
        if (linked.has(email)) continue;
        const party = await findRecipientParty(database, id, email);
        linked.set(email, party?.participantId ?? null);
      }

      const token = randomBytes(24).toString("hex");
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
          const seen = new Set<string>();
          const rows = [];
          for (const recipient of recipients) {
            const email = normalizeEmail(recipient.email);
            if (seen.has(email)) continue;
            seen.add(email);
            rows.push({
              shareId: share.id,
              email,
              name: recipient.name,
              linkedParticipantId: linked.get(email) ?? null,
            });
          }
          await tx.insert(schema.shareRecipients).values(rows);
        }

        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "share.create",
          targetKind: "share",
          targetId: share.id,
          eventId: id,
          after: { access: share.access, targetKind: share.targetKind, capabilities },
        });
        // Handing event data to someone OUTSIDE the platform is the operator's
        // decision and the operator's record — kind `share` keeps it behind
        // `event.edit`. The token is never summarised: a feed row is not a way to
        // hand the link to a participant who was not given it.
        await writeActivity(tx, request, {
          eventId: id,
          type: "share.created",
          targetKind: "share",
          targetId: share.id,
          summary: {
            access: share.access,
            sharedKind: share.targetKind,
            recipientCount: recipients?.length ?? 0,
          },
        });
        return share;
      });

      return reply.status(201).send({ token: created.token });
    },
  );

  // List (authed): the links this event has out, with per-recipient state — sent,
  // last opened, and whether that address now has an account. `event.edit`, the
  // same authority it takes to create one. This is the only route that returns
  // recipients, and it returns them to the person who typed them in.
  app.get(
    "/events/:id/shares",
    { schema: { params: EventParams, response: { 200: OwnedShareResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      await requireEventCapability(request, id, "event.edit");

      const shares = await database
        .select()
        .from(schema.shares)
        .where(eq(schema.shares.eventId, id))
        .orderBy(desc(schema.shares.createdAt));
      if (shares.length === 0) return [];

      // One query for every share's recipients — a per-share read would be N+1 on
      // a screen whose whole job is to list them all.
      const recipients = await database
        .select()
        .from(schema.shareRecipients)
        .where(
          inArray(
            schema.shareRecipients.shareId,
            shares.map((share) => share.id),
          ),
        );
      const byShare = new Map<string, Recipient[]>();
      for (const share of shares) byShare.set(share.id, []);
      for (const recipient of recipients) {
        byShare.get(recipient.shareId)?.push(recipient);
      }

      return shares.map((share) => ({
        id: share.id,
        token: share.token,
        targetKind: share.targetKind,
        targetId: share.targetId,
        capabilities: share.capabilities,
        access: share.access,
        createdAt: share.createdAt.toISOString(),
        expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
        revokedAt: share.revokedAt ? share.revokedAt.toISOString() : null,
        recipients: (byShare.get(share.id) ?? []).map((recipient) => ({
          email: recipient.email,
          name: recipient.name,
          isParty: recipient.linkedParticipantId != null,
          invitedAt: recipient.invitedAt.toISOString(),
          lastSeenAt: recipient.lastSeenAt ? recipient.lastSeenAt.toISOString() : null,
          claimed: recipient.claimedByUserId != null,
        })),
      }));
    },
  );

  // Revoke (authed): stop sharing. A soft revoke, so the row and its trail
  // survive; every token route reads through `loadLiveShare`, which 404s a revoked
  // share — the same answer as a token that never existed.
  app.delete(
    "/events/:id/shares/:shareId",
    { schema: { params: EventShareParams } },
    async (request, reply) => {
      const { database } = request.server;
      const { id, shareId } = request.params;
      await requireEventCapability(request, id, "event.edit");

      await database.transaction(async (tx) => {
        const [share] = await tx
          .update(schema.shares)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.shares.id, shareId), eq(schema.shares.eventId, id)))
          .returning();
        if (!share) throw notFound("Share not found");
        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "share.revoke",
          targetKind: "share",
          targetId: share.id,
          eventId: id,
          after: { revokedAt: share.revokedAt },
        });
        await writeActivity(tx, request, {
          eventId: id,
          type: "share.revoked",
          targetKind: "share",
          targetId: share.id,
          summary: { sharedKind: share.targetKind },
        });
      });

      return reply.status(204).send();
    },
  );

  // Read (public): resolve a share by token. `public` → return the grant with no
  // principal. `protected` → require a verified recipient (ShareBearer JWT, or a
  // signed-in account with that verified email).
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

  // The document (public route, capability-scoped body): the whole point of the
  // share. Read LIVE — no snapshot — and shaped by the capabilities this viewer
  // actually gets. Sections the share did not grant are `null`; party-scoped
  // sections carry the recipient's own line and nobody else's.
  app.get(
    "/shares/:token/document",
    {
      config: { public: true },
      schema: { params: TokenParams, response: { 200: ShareDocumentSchema } },
    },
    async (request) => {
      const { share, recipient, party, capabilities } = await resolveShareViewer(
        request,
        request.params.token,
      );
      if (!share.eventId) throw badRequest("Share is not attached to an event");
      if (recipient) await touchRecipient(request, recipient);

      const [owner] = await request.server.database
        .select({ name: schema.profiles.name })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, share.ownerProfileId));

      return await buildShareDocument({
        database: request.server.database,
        eventId: share.eventId,
        capabilities,
        party,
        viewerEmail: recipient?.email ?? null,
        viewerName: recipient?.name ?? null,
        claimed: recipient?.claimedByUserId != null,
        targetKind: share.targetKind,
        targetId: share.targetId,
        sharedBy: owner?.name ?? null,
        expiresAt: share.expiresAt,
      });
    },
  );

  // OTP issue (public): rate-limit 3/hour per (share,email), then upsert a fresh
  // salted-SHA256 code with a 10-min TTL. The response is always the same shape
  // whether or not the address is a recipient — saying "not a recipient" would
  // turn the endpoint into an address oracle for anyone holding the link.
  app.post(
    "/shares/:token/otp",
    {
      config: { public: true },
      schema: { params: TokenParams, body: OtpBody, response: { 200: OtpResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const share = await loadLiveShare(request, request.params.token);
      if (!otpRequestsPerIp.take(`${clientIp(request)}|${share.id}`)) {
        // A distinct message from the per-(share, email) refusal below: the two
        // limits bind different things, and a 429 whose reason you cannot read is
        // a 429 nobody can act on (`.claude/skills/verify-e2e`).
        throw new HttpError(
          429,
          "Too many verification codes requested from this connection; try again later",
          "rate_limited",
        );
      }
      const email = normalizeEmail(request.body.email);
      const hash = emailHash(email);
      const now = Date.now();

      const [existing] = await database
        .select()
        .from(schema.shareOtps)
        .where(and(eq(schema.shareOtps.shareId, share.id), eq(schema.shareOtps.emailHash, hash)));

      // The window is open while `rateWindowStart` is younger than an hour. It is
      // carried on the SAME row as the code, which is why that row is never
      // deleted while the window is open (migration 0018): deleting it on a
      // successful verify — or on the fifth wrong guess — used to hand the next
      // caller a clean hour and a clean five guesses, so neither limit bound
      // anything at all.
      const windowOpen =
        existing?.rateWindowStart != null &&
        now - existing.rateWindowStart.getTime() < RATE_WINDOW_MS;
      const issuesSoFar = windowOpen && existing ? existing.issues : 0;
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
        // A fresh code gets a fresh guess budget; the ISSUE count belongs to the
        // window and carries across, which is the whole point of the two columns.
        attempts: 0,
        consumedAt: null,
        issues: issuesSoFar + 1,
        rateWindowStart:
          windowOpen && existing?.rateWindowStart ? existing.rateWindowStart : new Date(now),
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

      // Send ONLY to an address the operator actually addressed this share to.
      // Without that test, a leaked link is a button that mails a shoWMe-branded
      // code to any address a stranger types — three an hour, per address, for as
      // long as the link lives. The stored code is harmless to a non-recipient
      // (`resolveRecipient` refuses to mint a JWT for one), so the row is written
      // either way and only the delivery is withheld.
      const recipient = await recipientByEmail(request, share, email);
      if (recipient) {
        // A send failure is logged, not surfaced — the OTP is stored, so the
        // recipient can still request a resend.
        try {
          await request.server.emailSink.sendEmail({
            to: email,
            // The TTL in the copy is derived from the constant that actually
            // stamped `expiresAt` above, so the two can never drift apart.
            ...renderShareVerificationCodeEmail({
              code,
              expiresInMinutes: Math.round(OTP_TTL_MS / 60_000),
            }),
          });
        } catch (error) {
          request.log.error({ error }, "share OTP email failed");
        }
      }

      const testHook = request.headers["x-test-otp"];
      const askedForCode = (Array.isArray(testHook) ? testHook[0] : testHook) === "1";
      return askedForCode && mayEchoOtpCode()
        ? { sent: true as const, code }
        : { sent: true as const };
    },
  );

  // OTP verify (public). A code is SPENT rather than deleted, in all three ways it
  // can end — expired, out of guesses, or used — so the row keeps carrying the
  // window that throttles the next request. Wrong code → attempts+1 and 401;
  // fifth wrong code → spent; correct → spent, and a 24h JWT.
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

      const spend = () =>
        database
          .update(schema.shareOtps)
          .set({ consumedAt: new Date() })
          .where(eq(schema.shareOtps.id, otp.id));

      if (
        otp.consumedAt != null ||
        otp.expiresAt.getTime() <= Date.now() ||
        otp.attempts >= MAX_VERIFY_ATTEMPTS
      ) {
        if (otp.consumedAt == null) await spend();
        throw unauthorized("Invalid or expired code");
      }

      if (!verifyOtpCode(otp.salt, request.body.code, otp.codeHash)) {
        const nextAttempts = otp.attempts + 1;
        await database
          .update(schema.shareOtps)
          .set({
            attempts: nextAttempts,
            consumedAt: nextAttempts >= MAX_VERIFY_ATTEMPTS ? new Date() : null,
          })
          .where(eq(schema.shareOtps.id, otp.id));
        throw unauthorized("Invalid or expired code");
      }

      await spend();

      // Passing the challenge proves the address, but it does not make the holder
      // a recipient — only the operator's list does that. Refusing here rather
      // than minting a JWT that every route would then reject keeps the failure
      // where it can be read, and the message is the same one a wrong code gets
      // so the endpoint stays useless as an address oracle.
      const recipient = await recipientByEmail(request, share, email);
      if (!recipient) throw unauthorized("Invalid or expired code");
      await touchRecipient(request, recipient);

      return { token: mintShareJwt(share.token, email, shareJwtSecret()) };
    },
  );

  // Comment (public): needs `message.post` in the grant, which is protected-only —
  // so in practice a verified recipient. The comment carries the SECTION of the
  // document it is about, and the section must be one this viewer can actually
  // see: a comment filed under "budget" by someone who was never shown the budget
  // is either a mistake or a probe, and neither should be stored as a fact.
  app.post(
    "/shares/:token/comment",
    {
      config: { public: true },
      schema: { params: TokenParams, body: CommentBody, response: { 201: CommentResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { share, recipient, party, capabilities } = await resolveShareViewer(
        request,
        request.params.token,
      );
      if (!share.eventId) throw badRequest("Share is not attached to an event");
      if (!capabilities.has("message.post")) throw forbidden("This link does not allow comments");

      const { section, message } = request.body;
      if (section && !visibleSections(capabilities).includes(section)) {
        throw forbidden(`This link does not share the ${section}`);
      }

      const [comment] = await database
        .insert(schema.settlementComments)
        .values({
          eventId: share.eventId,
          partyParticipantId: party?.participantId ?? null,
          authorEmail: recipient?.email,
          authorName: recipient?.name ?? undefined,
          section: section ?? null,
          message,
        })
        .returning();
      if (!comment) throw new Error("comment insert failed");

      return reply.status(201).send({ id: comment.id });
    },
  );

  // Approve (public) — audit A-33, the act that makes a share more than a
  // document. Two subjects, each a per-party signature:
  //
  //   settlement → `settlement_approvals` for the recipient's OWN participant
  //   agreement  → `deal_parties.confirmed_at` on the recipient's OWN line
  //
  // Both need the matching capability IN THE GRANT and a recipient who is a party
  // on this event. An arm's-length reviewer with no line has nothing to sign, and
  // no share can invent one for them.
  app.post(
    "/shares/:token/approve",
    {
      config: { public: true },
      schema: { params: TokenParams, body: ApproveBody, response: { 200: ApproveResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const { share, recipient, party, capabilities } = await resolveShareViewer(
        request,
        request.params.token,
      );
      if (!share.eventId) throw badRequest("Share is not attached to an event");
      const eventId = share.eventId;

      const capability: Capability =
        request.body.subject === "settlement" ? "settlement.confirm" : "agreement.confirm";
      if (!capabilities.has(capability)) {
        throw forbidden(
          request.body.subject === "settlement"
            ? "This link does not allow you to approve the settlement"
            : "This link does not allow you to confirm the agreement",
        );
      }
      if (!party) throw forbidden("You are not a party to this event");

      const now = new Date();

      if (request.body.subject === "settlement") {
        /**
         * The timestamp this route reports is the one the approval ACTUALLY
         * carries, not the clock at the moment of the second click. Re-approving
         * is idempotent and keeps the first stamp — so answering `now` told the
         * recipient their settlement was signed at a time nothing was signed at.
         * A signature's date is the part of it that matters most.
         */
        const approvedAt = await database.transaction(async (tx) => {
          const [settlement] = await tx
            .select()
            .from(schema.settlements)
            .where(
              and(
                eq(schema.settlements.eventId, eventId),
                eq(schema.settlements.participantId, party.participantId),
              ),
            );
          const [existing] = await tx
            .select()
            .from(schema.settlementApprovals)
            .where(
              and(
                eq(schema.settlementApprovals.eventId, eventId),
                eq(schema.settlementApprovals.partyParticipantId, party.participantId),
              ),
            );
          // Idempotent: re-approving is a no-op that keeps the first timestamp.
          const alreadyApproved = existing?.approved === true;
          if (existing) {
            if (!existing.approved) {
              await tx
                .update(schema.settlementApprovals)
                .set({ approved: true, approvedAt: now })
                .where(eq(schema.settlementApprovals.id, existing.id));
            }
          } else {
            await tx.insert(schema.settlementApprovals).values({
              eventId,
              partyParticipantId: party.participantId,
              approved: true,
              approvedAt: now,
            });
          }
          await writeOffPlatformAudit(tx, request, {
            capability,
            action: "settlement.approve",
            targetKind: "settlement",
            targetId: settlement?.id,
            eventId,
            email: recipient?.email ?? null,
            after: { approved: true, participantId: party.participantId },
          });
          // The feed's party-scoped tier matches `settlement` entries on
          // `settlements.id` (`routes/activity.ts`), so the row id is the only
          // `targetId` that resolves. Stamped with the participant id, the entry
          // matched nobody — including the person who had just approved, for whom
          // it is the visible trace of their own consent. No settlement row means
          // no entry at all rather than one nobody can ever see: the approval
          // itself is recorded on `settlement_approvals` and in the audit trail.
          if (settlement) {
            await writeActivity(tx, request, {
              eventId,
              type: "settlement.approved",
              targetKind: "settlement",
              targetId: settlement.id,
              summary: { via: "share", partyRole: party.role },
            });
          }
          return alreadyApproved ? (existing?.approvedAt ?? now) : now;
        });
        return { approvedAt: approvedAt.toISOString() };
      }

      const dealId = request.body.dealId;
      if (!dealId) throw badRequest("dealId is required to confirm an agreement");

      const confirmedAt = await database.transaction(async (tx) => {
        const [deal] = await tx
          .select()
          .from(schema.deals)
          .where(and(eq(schema.deals.id, dealId), eq(schema.deals.eventId, eventId)));
        if (!deal) throw notFound("Deal not found");

        const parties = await tx
          .select()
          .from(schema.dealParties)
          .where(eq(schema.dealParties.dealId, deal.id));
        // ONLY the recipient's own line. The old app's review page rendered every
        // party's card to any link-holder; this stamps one row and refuses to look
        // at the rest as anything but a rollup count.
        const mine = parties.filter((line) => line.participantId === party.participantId);
        if (mine.length === 0) throw forbidden("You are not a party to this deal");

        const unstamped = mine.filter((line) => line.confirmedAt == null); // idempotent
        for (const line of unstamped) {
          await tx
            .update(schema.dealParties)
            .set({ confirmedAt: now, version: line.version + 1 })
            .where(eq(schema.dealParties.id, line.id));
        }

        // Re-read and run the SAME rollup the in-app route runs. Signing off-platform
        // is still signing: if this was the last signatory, the agreement advances to
        // `confirmed` and the terms freeze into `confirmed_snapshot`. Without this a
        // deal whose final signature arrived by link ended up fully signed with no
        // frozen terms — a confirmed agreement with no record of what was agreed,
        // which is precisely the record a settlement dispute needs.
        const fresh = await tx
          .select()
          .from(schema.dealParties)
          .where(eq(schema.dealParties.dealId, deal.id));
        const current = await confirmDealIfComplete(tx, deal, fresh, now);

        await writeOffPlatformAudit(tx, request, {
          capability,
          action: "deal.confirm",
          targetKind: "deal",
          targetId: deal.id,
          eventId,
          email: recipient?.email ?? null,
          after: {
            agreementStatus: current.agreementStatus,
            confirmedParticipantIds: mine.map((line) => line.participantId),
          },
        });
        await writeActivity(tx, request, {
          eventId,
          type:
            current.agreementStatus === "confirmed" && deal.agreementStatus !== "confirmed"
              ? "deal.confirmed"
              : "deal.party_confirmed",
          targetKind: "deal",
          targetId: deal.id,
          summary: { name: deal.name, agreementStatus: current.agreementStatus, via: "share" },
        });
        // Same rule as the settlement above: when this call stamped nothing, the
        // honest answer is when the line was signed, not when it was re-asked.
        return unstamped.length > 0 ? now : (mine[0]?.confirmedAt ?? now);
      });

      return { approvedAt: confirmedAt.toISOString() };
    },
  );
}
