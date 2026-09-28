import { z } from "zod";

/**
 * THE OPTIMISTIC-LOCK BODY — one definition, because two copies of it diverged (QA sweep run 9,
 * QA9-16).
 *
 * Every mutating route may take an `expectedVersion` (decisions #8): a mismatch answers 409 rather
 * than overwriting somebody else's edit. On a DELETE the whole body is optional, and that is the
 * part that has to be said in the schema — **a bare `DELETE` with no body at all arrives as `null`,
 * not as `{}`**, so `z.object({…})` alone rejects it before the handler runs:
 *
 * ```
 * DELETE /deals/:did            (no body)  →  400  "body/ Expected object, received null"
 * DELETE /deals/:did            {}         →  404  "Deal not found"        ← the real answer
 * ```
 *
 * Three routes declared this and **two of them got it wrong** — `DELETE /events/:id` was `.nullish()`
 * and took a bodyless call; `DELETE /deals/:did` and
 * `DELETE /events/:id/budgets/:bid/lines/:lid` were not, and refused one. The generated client always
 * sends a body, so no screen was affected; it matters for the agent-native surface decisions
 * #16.14–15 commits to, where a caller writes the request itself and `curl -X DELETE` is the obvious
 * thing to write.
 *
 * Shared rather than corrected in place because a one-line schema copied three times is how this
 * happened: the divergence is invisible at each site and only shows up as two routes disagreeing
 * about what a DELETE looks like. A handler reading it must use `request.body?.expectedVersion` —
 * the `?.` is not decoration, it is the `null` above.
 */
export const OptimisticLockBody = z
  .object({ expectedVersion: z.number().int().optional() })
  .nullish();
