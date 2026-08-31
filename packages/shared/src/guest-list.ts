/**
 * THE GUEST LIST'S LIMITS, AND WHY THEY ARE A RULE RATHER THAN A LABEL.
 *
 * The operator's comp list lives in `events.extras.guestList` (a read-with-parent
 * leaf — `apps/api/src/serialize/event-extras.ts`). It has carried two settings
 * since it was built, *"Limit list to total tickets"* and *"Limit tickets per
 * guest"*, and the product owner's finding was exact: **they *"only present but
 * don't actually work"***. Both persisted; nothing anywhere read them back. The
 * add form checked a non-empty name and `count >= 1`, and the API took two free
 * numbers and never compared them to anything.
 *
 * A limit only the form respects is not a limit, so the rule lives here — plain
 * TS, no framework — and BOTH ends call it: `PATCH /events/:id` refuses a
 * document that breaks it, and the card refuses before it writes so the operator
 * gets the sentence under their cursor instead of a round trip. The server is
 * the authority; the card is the courtesy.
 *
 * **What happens to a list that is already over a limit somebody is lowering.**
 * Two answers were available — accept the new limit and display the overage, or
 * refuse the save. **This refuses**, for one reason: the alternative writes a
 * document the rule says cannot exist, and from then on every later read has to
 * carry the exception. The moment "over the limit" is a storable state, "the
 * limit" is advisory again, which is the exact defect being fixed. Refusing puts
 * the decision where it belongs — remove guests, or keep the limit you had — and
 * the refusal says which guests and by how much, so the operator is not left
 * guessing what to remove.
 *
 * A limit of `0` is a real limit meaning "none", distinct from `null` /
 * `undefined`, which mean "no limit".
 */

/** One row of the operator's comp list. */
export interface GuestListEntry {
  id: string;
  name: string;
  tickets: number;
  /** Free-text attribution — performer / venue / promoter. */
  invitedBy: string;
  /**
   * The operator's own note on this guest — *"+1 is their manager"*, *"collects
   * at box office"*. The product owner asked for it by name; it rides in the
   * same `jsonb` leaf, so it needs no migration.
   */
  note?: string | null;
}

/** The stored guest-list document, limits included. */
export interface GuestListDocument {
  /** Ceiling on the whole list's tickets. `null`/absent = no limit. */
  limitTotal?: number | null;
  /** Ceiling on any ONE guest's tickets. `null`/absent = no limit. */
  limitPerGuest?: number | null;
  guests?: GuestListEntry[];
}

/** Tickets across the whole list. */
export function guestListTickets(guests: readonly GuestListEntry[] = []): number {
  return guests.reduce((total, guest) => total + (guest.tickets || 0), 0);
}

/** "3 tickets" / "1 ticket" — so a refusal never reads "1 tickets". */
function tickets(count: number): string {
  return count === 1 ? "1 ticket" : `${count} tickets`;
}

/**
 * What is wrong with this guest list, in the words the operator needs — or
 * `null` when it is fine.
 *
 * The per-guest limit is reported first because it is the more specific fault:
 * a list that breaks both is usually one oversized guest, and naming the total
 * would send the operator hunting through rows that are individually fine.
 */
export function guestListProblem(list: GuestListDocument): string | null {
  const guests = list.guests ?? [];

  const perGuest = list.limitPerGuest;
  if (perGuest != null) {
    const over = guests.filter((guest) => (guest.tickets || 0) > perGuest);
    if (over.length > 0) {
      const worst = over.reduce((left, right) => (right.tickets > left.tickets ? right : left));
      const others =
        over.length > 1 ? ` (and ${over.length - 1} other${over.length > 2 ? "s" : ""})` : "";
      return `${worst.name} is down for ${tickets(worst.tickets)}${others} — ${
        worst.tickets - perGuest
      } over the ${perGuest} you allow per guest. Lower that guest, or raise the per-guest limit.`;
    }
  }

  const total = list.limitTotal;
  if (total != null) {
    const onTheList = guestListTickets(guests);
    if (onTheList > total) {
      const overage = onTheList - total;
      return `The guest list is ${tickets(onTheList)} — ${overage} over the ${total} you allow in total. Take ${tickets(
        overage,
      )} off the list, or raise the total limit.`;
    }
  }

  return null;
}
