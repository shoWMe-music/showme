import { z } from "zod";

/** Shared list query: keyset cursor + bounded limit. Every list route accepts this. */
export const PaginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationQuery>;

/** Opaque base64url cursor over an arbitrary keyset value (e.g. `{ createdAt, id }`). */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor<T>(cursor: string): T {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
}

/** Slice one extra row to detect a next page; returns the page + its cursor. */
export function paginate<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => unknown,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) {
    return { items: rows, nextCursor: null };
  }
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: last ? encodeCursor(toCursor(last)) : null };
}
