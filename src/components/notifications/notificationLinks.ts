/**
 * Resolve an `AppNotification` to a TanStack Router navigation descriptor.
 *
 * Notifications today carry an `eventId`, an optional preset `link` string,
 * and a flexible `metadata` map (where things like `section` / `tab`,
 * `profileId`, `contactId` may live depending on notification type). The
 * popover in `AppLayout.tsx` previously navigated by passing the raw `link`
 * string straight to `<Link to=…>`, which TanStack Router does not match
 * against parameterized routes (e.g. `/events/$id`). This module returns a
 * structured `{ to, params, search? }` object that callers feed into
 * `navigate(...)` or `<Link {...}>`.
 *
 * Resolution order (most specific first):
 *   1. `eventId` (+ optional `metadata.section` / `metadata.tab`) → /events/$id
 *   2. `metadata.contactId` → /contacts/$id
 *   3. `metadata.profileId` → /p/$slug if a slug is provided, else /profiles
 *   4. Preset `link` string → /requests, /tasks, etc (passthrough)
 *   5. Fallback: home (/)
 */

import type { AppNotification } from "@/lib/models";

/**
 * Whitelist of static link strings that we know map to real routes.
 * Anything else is considered untrusted and falls back to the resolver below.
 */
const STATIC_LINK_ALLOWLIST: readonly string[] = [
  "/",
  "/requests",
  "/tasks",
  "/calendar",
  "/events",
  "/settlements",
  "/contacts",
  "/profiles",
  "/team",
  "/bills",
];

export type NotificationNavTarget =
  | { kind: "event"; to: "/events/$id"; params: { id: string }; search?: Record<string, string> }
  | { kind: "contact"; to: "/contacts/$id"; params: { id: string } }
  | { kind: "profile-public"; to: "/p/$slug"; params: { slug: string } }
  | { kind: "profile-list"; to: "/profiles" }
  | { kind: "static"; to: string };

/**
 * Resolve a notification to a navigation descriptor. Pure / side-effect free.
 * The caller is responsible for deciding whether the linked entity still exists
 * (e.g. by looking the eventId up in the events cache before navigating).
 */
export function resolveNotificationTarget(n: AppNotification): NotificationNavTarget {
  const md = n.metadata || {};

  // 0. Profile-invite — always lands on Settings → Profile Access
  if (n.type === "profile_invite") {
    return { kind: "static", to: "/settings#profile-access" };
  }

  // 1. Event-scoped: most common case
  if (n.eventId) {
    const search: Record<string, string> = {};
    const tab = md.tab || md.section;
    if (tab) search.tab = tab;
    return {
      kind: "event",
      to: "/events/$id",
      params: { id: n.eventId },
      ...(Object.keys(search).length > 0 ? { search } : {}),
    };
  }

  // 2. Contact-scoped
  if (md.contactId) {
    return { kind: "contact", to: "/contacts/$id", params: { id: md.contactId } };
  }

  // 3. Profile-scoped — prefer public profile if a slug is provided,
  //    otherwise fall back to the profiles list (no per-profile-id route exists).
  if (md.profileSlug) {
    return { kind: "profile-public", to: "/p/$slug", params: { slug: md.profileSlug } };
  }
  if (md.profileId) {
    return { kind: "profile-list", to: "/profiles" };
  }

  // 4. Preset link strings (only if on the allowlist)
  if (n.link && STATIC_LINK_ALLOWLIST.includes(n.link)) {
    return { kind: "static", to: n.link };
  }

  // 5. Fallback
  return { kind: "static", to: "/" };
}
