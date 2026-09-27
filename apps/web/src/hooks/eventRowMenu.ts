/**
 * WHAT AN EVENT ROW'S ⋮ MENU OFFERS — the rule, without the wording.
 *
 * Pure and React-free for the reason `unavailabilityRanges` and `calendarChoice` are:
 * this is the half with a decision in it, the decision had a real hole, and reaching
 * it through `useEventRowActions` would drag `AuthProvider` → `auth/firebase.ts` and
 * its module-scope `initializeApp()` into the test run. The hook keeps the labels, the
 * hints and the callbacks; this keeps which entries exist at all.
 *
 * THE HOLE IT CLOSES (QA sweep run 4, QA4-9). The menu used to consult the event's
 * STATUS and nothing else, so a performer looking at a show they had merely played was
 * offered "Cancel show…" and, once it was cancelled, "Delete permanently…". Pressing
 * either was refused by the API — correctly, every time, with nothing damaged — but the
 * refusal a performer got reads *"This part of the event isn't shared with you"*, which
 * is about sharing and not about the authority they actually lacked. An affordance that
 * exists in order to be refused is a lie about who the reader is.
 *
 * So: capability first, then the state of the show.
 */

/** One event as the menu rule reads it. Everything optional but the identity. */
export interface EventRowMenuSubject {
  status?: string;
  archived?: boolean;
  /** Whether the show has a public page right now — decides which way the entry reads. */
  published?: boolean;
  /**
   * The caller's OWN capabilities on this event, from the list row
   * (`ListEventResponse.capabilities`). Absent means "not known", which resolves to
   * offering nothing that needs proving — a cached row from an older client must not
   * fall back to offering everything.
   */
  capabilities?: readonly string[];
}

/** The entries, in the order the menu draws them. */
export type EventRowMenuKey =
  | "publish"
  | "settlement"
  | "unarchive"
  | "cancel"
  | "archive"
  | "delete";

/**
 * ORDER IS THE LADDER, and it differs by shelf.
 *
 * On a filed-away show, taking it back out comes first — it is the reason the reader
 * opened the menu. On a live one, the sequence is the ladder itself: call it off, file
 * it away, destroy it, least consequential last-but-one and irreversible last.
 *
 * `delete` appears once the show is cancelled OR archived, which is the server's own
 * clause 6 (`apps/api/src/lib/event-delete.ts`) — the irreversible step is never the
 * first one. Among readers who hold `event.delete` it is offered even when another
 * clause would refuse it: those refusals name a fact about the SHOW (a settlement, an
 * invoice) and reading it teaches the operator something. A missing capability is a
 * fact about the READER, which no refusal can teach them.
 */
export function eventRowMenuKeys(event: EventRowMenuSubject): EventRowMenuKey[] {
  const capabilities = event.capabilities ?? [];
  const cancelled = event.status === "cancelled";
  // Cancelling is a `PATCH /events/:id`; deleting is `DELETE /events/:id`.
  const mayCancel = capabilities.includes("event.edit") && !cancelled;
  const mayDelete = capabilities.includes("event.delete") && (cancelled || Boolean(event.archived));
  /*
   * PUBLISH (ClickUp `123qy9rng56`) — the same three questions the API asks, so the menu
   * never offers a press it knows will be refused. `event.publish` is the capability;
   * only a CONFIRMED show has a public page (A-22), which is why an already-published
   * night can still be taken down while a pending one is offered nothing.
   */
  const mayPublish =
    capabilities.includes("event.publish") &&
    (event.published === true || event.status === "confirmed");
  /*
   * SETTLEMENT is a navigation, so the question is only whether the reader has anything
   * to see there. `settlement.view.own` is the floor every party holds — a performer
   * reads their own line, an operator reads the pool — so it is the honest gate, and a
   * reader without it would land on a 403.
   */
  const maySettle = capabilities.includes("settlement.view.own");

  /*
   * The READING actions first, then the ladder. Publishing and opening the settlement are
   * things you do WITH a show; cancelling, filing and destroying are things you do TO it,
   * and the ladder below is ordered by how hard each is to undo. Mixing the two orders
   * would put "Delete permanently…" next to "Settlement".
   */
  const keys: EventRowMenuKey[] = [];
  if (mayPublish) keys.push("publish");
  if (maySettle) keys.push("settlement");
  if (event.archived) keys.push("unarchive");
  if (mayCancel) keys.push("cancel");
  // Archiving is the one entry that needs no capability: it is written on the
  // caller's own participant row, it hides the show from their own lists and nobody
  // else's, and `event.view` — which they must hold to see the row at all — is the
  // gate the API applies. A reader who can see a show can always file it away.
  if (!event.archived) keys.push("archive");
  if (mayDelete) keys.push("delete");
  return keys;
}
