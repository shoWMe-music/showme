import { useEventSetlist } from "../hooks/useEventSetlist";
import { SetlistEditor } from "./SetlistEditor";

/**
 * The event workspace's Setlist tab — the half Ran asked for: "the setlists from
 * performers will be connected to their event managers".
 *
 * One tab, three readings, all of them the server's (`routes/setlists.ts`):
 *   · the ACT sees its own set and writes it here, on the show it is about;
 *   · the operator running the night sees every act's, because the
 *     performed-works report they owe the collecting society is derived from all
 *     of them (decisions.md "Setlists"); and
 *   · anybody else sees only a set explicitly shared with them — the lighting
 *     operator on a cued show, and nobody by default.
 *
 * Nothing is decided in this file. It is the wiring that makes the Setlists
 * screen and the event workspace the same surface.
 */
export function EventSetlistTab({ eventId }: { eventId: string }) {
  const view = useEventSetlist(eventId);
  return <SetlistEditor view={view} />;
}
