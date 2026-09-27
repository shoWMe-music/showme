import { schema } from "@showme/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { notFound } from "../errors";

type Share = typeof schema.shares.$inferSelect;

/**
 * WHAT MAKES A SHARE TOKEN LIVE — one definition, two callers.
 *
 * `routes/shares.ts` has enforced this since module 9 (`decisions.md` #6): a token that
 * does not exist, one whose share was revoked, and one past its `expires_at` are all the
 * SAME 404. Not three different answers, because the difference between them is
 * information about somebody else's share — whether a link ever existed, and whether it
 * was withdrawn or simply aged out.
 *
 * It moved here the day a second kind of tokenized thing appeared: a profile's
 * availability snapshot (ClickUp `123qy9rpqp0` / `123qy9rpqn0`), which is read by an
 * anonymous stranger on the marketing site and has nothing to do with an event. Two
 * copies of "is this link still good" is how one of them ends up honouring a revocation
 * the other ignores.
 *
 * Deliberately NOT about capabilities, recipients or OTP. Those are `shares.ts`'s
 * business and only apply to the `protected` access mode; this answers the one question
 * every tokenized read starts with.
 */
export async function loadLiveShareByToken(
  database: FastifyInstance["database"],
  token: string,
): Promise<Share> {
  const [share] = await database.select().from(schema.shares).where(eq(schema.shares.token, token));
  if (!share) throw notFound("Share not found");
  if (share.revokedAt) throw notFound("Share not found");
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) throw notFound("Share not found");
  return share;
}

/**
 * The `target_kind` an availability snapshot is stored under. A string rather than an
 * enum for the same reason every other `target_kind` is: the column is the join between
 * a generic token and whatever it points at, and the set grows without a migration.
 */
export const PROFILE_AVAILABILITY_TARGET = "profile_availability";

/**
 * HOW LONG AN AVAILABILITY TOKEN IS, and why not four characters.
 *
 * Ran's example is `showme.music/a/x7k2` (ClickUp `123qy9rpqn0`), against links that
 * currently run to ~700 characters because every date rides in the URL. Four characters
 * is the right *feel* and the wrong *length*: it is sweepable, and the thing behind it is
 * a venue's free nights — not a secret, but not something anyone should be able to
 * enumerate across every venue on the platform either.
 *
 * Nine random bytes, base64url: **12 characters, 72 bits**. Short enough to read out on
 * a phone, far past guessing. Event shares mint 24 bytes → 48 hex characters, which is
 * the other end of exactly this trade.
 */
export const AVAILABILITY_TOKEN_BYTES = 9;
