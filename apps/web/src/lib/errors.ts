import { ApiError } from "@showme/api-client";

/** Pull a human-friendly message out of an unknown query/mutation error. */
export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}
