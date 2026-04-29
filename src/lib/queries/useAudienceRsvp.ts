/**
 * Audience RSVP mutation hook.
 *
 * Public-facing scaffolding for capturing RSVPs from anonymous viewers of
 * `PublicEventPage`. Writes to a top-level `audience_rsvps` collection so the
 * Audience CRM page (future) can read all RSVPs for an event.
 *
 * NOTE: The `AudienceRsvp` type is declared inline here because Lane B owns
 * `src/lib/models.ts` during Wave 6. Once Wave 6 lands, this type should be
 * moved into models.ts alongside other Firestore document shapes.
 */

import { useMutation } from "@tanstack/react-query";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { getFirestoreDb } from "@/integrations/firebase/app";
import { toast } from "@/hooks/use-toast";

// TODO: move to models.ts after Wave 6 swarm
export interface AudienceRsvp {
  /** Firestore-generated id (only present after read). */
  id?: string;
  eventId: string;
  name: string;
  email: string;
  /** Optional city — captured by the public RSVP form when available. */
  city?: string;
  /** serverTimestamp on write; ISO string on read. */
  createdAt?: unknown;
}

const AUDIENCE_RSVPS_COLLECTION = "audience_rsvps";

/** Persists a single RSVP submission against a public event. */
export async function createAudienceRsvp(rsvp: Omit<AudienceRsvp, "id" | "createdAt">): Promise<string> {
  const ref = await addDoc(
    collection(getFirestoreDb(), AUDIENCE_RSVPS_COLLECTION),
    {
      eventId: rsvp.eventId,
      name: rsvp.name,
      email: rsvp.email,
      ...(rsvp.city ? { city: rsvp.city } : {}),
      createdAt: serverTimestamp(),
    },
  );
  return ref.id;
}

/**
 * React-Query mutation wrapping `createAudienceRsvp`.
 * Surfaces a destructive toast on failure; success state is left to the caller
 * (the public event page renders its own confirmation UI).
 */
export function useCreateRsvp() {
  return useMutation({
    mutationFn: (rsvp: Omit<AudienceRsvp, "id" | "createdAt">) => createAudienceRsvp(rsvp),
    onError: () => {
      toast({ title: "Failed to submit RSVP", variant: "destructive" });
    },
  });
}
