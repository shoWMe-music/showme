import { schema } from "@showme/db";
import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Idempotency wrapper (decisions #8). If the request carries `Idempotency-Key`,
 * the first execution's `(statusCode, body)` is stored per `(user, endpoint,
 * key)` and any replay returns the stored result instead of re-executing —
 * making retry-unsafe creates/sends/money moves safe. Without a key it just runs.
 * The `body` MUST be JSON-serializable (it is persisted to jsonb).
 */
export async function withIdempotency<T>(
  request: FastifyRequest,
  endpoint: string,
  execute: () => Promise<IdempotentResult<T>>,
): Promise<IdempotentResult<T>> {
  const key = headerValue(request.headers["idempotency-key"]);
  const userId = request.principal?.userId;
  if (!key || !userId) {
    return execute();
  }

  const database = request.server.database;
  const lookup = and(
    eq(schema.idempotencyKeys.userId, userId),
    eq(schema.idempotencyKeys.endpoint, endpoint),
    eq(schema.idempotencyKeys.key, key),
  );

  const [existing] = await database.select().from(schema.idempotencyKeys).where(lookup);
  if (existing) {
    return { statusCode: existing.statusCode, body: existing.response as T };
  }

  const result = await execute();
  try {
    await database.insert(schema.idempotencyKeys).values({
      key,
      userId,
      endpoint,
      statusCode: result.statusCode,
      response: result.body as object,
    });
  } catch {
    // A concurrent request won the unique race — return its stored result.
    const [row] = await database.select().from(schema.idempotencyKeys).where(lookup);
    if (row) {
      return { statusCode: row.statusCode, body: row.response as T };
    }
  }
  return result;
}
