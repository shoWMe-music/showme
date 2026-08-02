import { type Membership, type ProfileRole, effectiveEventCapabilities } from "@showme/auth";
import type { Capability } from "@showme/shared";
import type { FastifyRequest } from "fastify";
import { forbidden, notFound } from "../errors";

/**
 * The caller's effective capabilities on an event, computed once and cached on
 * the request (a route may check + serialize against the same set). Wraps the
 * `packages/auth` engine — the single place event authorization is decided.
 */
export async function eventCapabilities(
  request: FastifyRequest,
  eventId: string,
): Promise<Set<Capability>> {
  if (!request.eventCapabilitiesCache) {
    request.eventCapabilitiesCache = new Map();
  }
  const cache = request.eventCapabilitiesCache;
  const cached = cache.get(eventId);
  if (cached) return cached;

  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const capabilities = await effectiveEventCapabilities(
    request.server.database,
    principal,
    eventId,
  );
  cache.set(eventId, capabilities);
  return capabilities;
}

/**
 * Assert the caller may exercise `capability` on the event, and return their full
 * capability set for the serializer. Deny-by-default with no existence leak:
 * without `event.view` the event is 404, not 403.
 */
export async function requireEventCapability(
  request: FastifyRequest,
  eventId: string,
  capability: Capability,
): Promise<Set<Capability>> {
  const capabilities = await eventCapabilities(request, eventId);
  if (!capabilities.has("event.view")) {
    throw notFound("Event not found");
  }
  if (capability !== "event.view" && !capabilities.has(capability)) {
    throw forbidden(`Missing capability: ${capability}`);
  }
  return capabilities;
}

/**
 * Assert the caller is a member of `profileId` with one of `allowedRoles`, and
 * return that membership. For PROFILE-scoped resources (profiles, members,
 * contacts, invitations) whose authority is per-profile role, not event
 * capabilities. Non-membership is a 404 (no existence leak); wrong role is 403.
 */
export function requireProfileRole(
  request: FastifyRequest,
  profileId: string,
  allowedRoles: ProfileRole[],
): Membership {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const membership = principal.memberships.find((member) => member.profileId === profileId);
  if (!membership) {
    throw notFound("Profile not found");
  }
  if (!allowedRoles.includes(membership.role)) {
    throw forbidden(`Requires role: ${allowedRoles.join(" or ")}`);
  }
  return membership;
}
