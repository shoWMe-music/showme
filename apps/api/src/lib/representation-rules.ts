import { conflict } from "../errors";

/**
 * Pure state-machine + region helpers for agent↔performer representations
 * (decisions.md #14). No I/O, no framework — the route layer loads rows, calls
 * these, and persists the result. Kept framework-agnostic so the rules are unit
 * tested in isolation from Fastify and Postgres.
 */

/** Which side of a representation an actor is: the agent or the performer. */
export type RepresentationParty = "agent" | "performer";

/** A territory: an explicit list of ISO country codes, or "everywhere". */
export interface RegionScope {
  region: string[] | null;
  isWorldwide: boolean;
}

/** The two-party handshake state (plus who made the current offer). */
export interface ConfirmFlags {
  proposedBy: RepresentationParty;
  confirmedByAgent: boolean;
  confirmedByPerformer: boolean;
}

/**
 * Do two territories intersect? Worldwide overlaps everything; otherwise it's a
 * non-empty intersection of country codes. The basis for "one active agent per
 * performer per region" — active regions must be disjoint.
 */
export function regionsOverlap(a: RegionScope, b: RegionScope): boolean {
  if (a.isWorldwide || b.isWorldwide) return true;
  const codes = new Set(a.region ?? []);
  return (b.region ?? []).some((code) => codes.has(code));
}

/**
 * Guard the disjoint-region invariant: a proposed representation may not overlap
 * any of the performer's currently ACTIVE representations. Throws a 409 conflict
 * on the first overlap so the route surfaces it directly.
 */
export function assertDisjoint(
  existingActive: readonly RegionScope[],
  proposed: RegionScope,
): void {
  for (const existing of existingActive) {
    if (regionsOverlap(existing, proposed)) {
      throw conflict("An active representation already covers an overlapping region");
    }
  }
}

/**
 * Apply a counter-offer to the handshake: the caller (`proposedBy`) becomes the
 * current proposer and their own side is confirmed; the counterparty's earlier
 * confirmation is cleared, because the new terms must be re-confirmed. Returns a
 * copy of `representation` with the re-stamped flags (terms are edited by the
 * caller separately).
 */
export function applyCounter<T extends ConfirmFlags>(
  representation: T,
  proposedBy: RepresentationParty,
): T {
  return {
    ...representation,
    proposedBy,
    confirmedByAgent: proposedBy === "agent",
    confirmedByPerformer: proposedBy === "performer",
  };
}
