import { resolvePrincipal } from "@showme/auth";
import type { FastifyReply, FastifyRequest } from "fastify";
import { unauthorized } from "../errors";

/** Pull a bearer token from the `Authorization` header. */
function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : undefined;
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * The front of the pipeline (a global `preHandler`): verify the Firebase token
 * ONCE, then resolve the principal ONCE from Postgres and attach both to the
 * request. `public` routes skip it entirely; `allowUnprovisioned` routes (login/
 * signup) get the verified token but no principal (the user row may not exist yet).
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const config = request.routeOptions.config;
  if (config.public) return;

  const token = bearerToken(request.headers.authorization);
  if (!token) {
    throw unauthorized("Missing bearer token");
  }

  try {
    request.firebaseUser = await request.server.tokenVerifier.verify(token);
  } catch {
    throw unauthorized("Invalid or expired token");
  }

  if (config.allowUnprovisioned) return;

  const actingProfileId = headerValue(request.headers["x-profile-id"]);
  const principal = await resolvePrincipal(
    request.server.database,
    request.firebaseUser.uid,
    actingProfileId,
  );
  if (!principal) {
    throw unauthorized("No provisioned account for this identity");
  }
  request.principal = principal;
}
