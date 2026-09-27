/**
 * "SOMETHING ABOUT THIS NIGHT CHANGED" — which fields are worth announcing, and the
 * sentence that announces them (ClickUp `86cbcftg3`).
 *
 * Ran's last line on that ticket: *"And the system should always notify the users of any
 * change — where it happened and by who."* Until now a PATCH that moved the door time,
 * the capacity, the curfew or the notes wrote an activity row and told nobody; the only
 * field with a notice of its own was the title, and that one reached the host profile
 * alone — so a performer whose show was renamed was never told.
 *
 * Pure, so the wording and the exclusions can be asserted without a database. The route
 * decides WHO hears (`eventParticipantRecipients`) and the delivery is best-effort after
 * the commit, like every other notification in this app.
 */

/**
 * Field → the words a person would use for it. **An ALLOW-LIST: what is not in here is
 * not announced**, which is the only exclusion mechanism this file has.
 *
 * It had a second one — an `ANNOUNCED_ELSEWHERE` set naming `status` and `published` —
 * until mutating it away turned no test red. It could not: neither field has a phrase
 * here, so the allow-list was already refusing them and the set was a line claiming to do
 * work it did not do. The reasoning it carried is worth keeping, so it lives here instead:
 *
 *  - **`status` and `published` are deliberately absent.** A cancellation already tells
 *    the bill the night is off and carries its reason; a publish already says the page
 *    went up. "The status changed" underneath either is noise on top of the message that
 *    mattered.
 *  - **`imageFileId` / `imageUrl` are absent** because the poster deserves a notice of
 *    its own one day, not a line reading "imageFileId changed".
 *
 * So adding a field here is a decision that every party on the bill should hear about it.
 */
const FIELD_PHRASES: Record<string, string> = {
  title: "the name",
  eventDate: "the date",
  doorTime: "the doors time",
  startTime: "the stage time",
  endTime: "the end time",
  curfew: "the curfew",
  venueName: "the venue",
  venueProfileId: "the venue",
  stageId: "the room",
  capacity: "the capacity",
  notes: "the notes",
  timezone: "the timezone",
  baseCurrency: "the currency",
  // `extras` is the guest list, the ticket tiers and the venue's carried-over details.
  // Named as one thing because that is how a reader thinks of it, and never valued —
  // see the note on values below.
  extras: "the ticket and guest details",
};

/** "a, b and c" — an Oxford-free join, because this is a sentence and not a list. */
function joinPhrases(phrases: string[]): string {
  if (phrases.length === 1) return phrases[0] ?? "";
  const head = phrases.slice(0, -1).join(", ");
  return `${head} and ${phrases[phrases.length - 1]}`;
}

export interface EventChangeNotice {
  title: string;
  body: string;
  /** The field names the notice covers, for the notification's metadata. */
  fields: string[];
}

/**
 * The notice for a set of changed fields, or **null when there is nothing to say**.
 *
 * Null covers three real cases and they are all the same answer: nothing changed, only
 * fields announced elsewhere changed (a cancellation, a publish), or only fields the
 * allow-list above leaves out.
 *
 * NAMES, NEVER VALUES — except the title. `changedFieldNames` sets that rule for the
 * activity log (the guest list is in `extras`, and echoing a patch body to every
 * participant would undo the redaction `serialize/event.ts` performs), and a notification
 * is read by exactly the same people. The title is the exception because it is the
 * event's identifying fact, it is event-public, and *"it is now X"* is the entire content
 * of that news.
 */
export function eventChangeNotice(
  changedFields: readonly string[],
  event: { title: string; previousTitle: string },
): EventChangeNotice | null {
  const named = changedFields.filter((field) => FIELD_PHRASES[field] !== undefined);
  if (named.length === 0) return null;

  // Deduplicated: `venueName` and `venueProfileId` are one change to a reader, and a
  // venue picked from a profile moves both.
  const phrases = [...new Set(named.map((field) => FIELD_PHRASES[field] as string))];
  const renamed = named.includes("title");

  const sentence = `${joinPhrases(phrases)} changed.`;
  return {
    // The name it had when the reader last looked is the one they will recognise, so a
    // rename is announced under the OLD title.
    title: renamed ? `"${event.previousTitle}" was renamed` : `"${event.title}" was updated`,
    body: renamed ? `${capitalise(sentence)} It is now "${event.title}".` : capitalise(sentence),
    fields: named,
  };
}

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
