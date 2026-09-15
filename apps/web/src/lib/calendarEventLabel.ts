/**
 * WHAT TO CALL AN EVENT ON SOMEBODY'S OWN CALENDAR (ClickUp `123qy9rnfa4`).
 *
 * Ran: *"Event names for Performers on the calendar show the artist name or event
 * name. It should show venue name/event name. Otherwise the performer will have a
 * calendar full of their name."*
 *
 * He is right, and the reason is in how events are titled: an operator names a
 * show after the act — "Marlo Vance — Album Release" — because from the venue's
 * side the act is the distinguishing fact. Read from the ACT's side, every row is
 * their own name, and the one fact that actually tells their nights apart, which
 * room they are in, is the one not shown.
 *
 * **Whose calendar it is decides, not what kind of account they hold.** A
 * performer promoting their own show wears an operator role for that event
 * (story.md), and on that row the title is the useful label — they chose it. So
 * the test is whether the reader HOSTS this event, which is a fact about the row
 * rather than about the person.
 *
 * Falls back to the title when there is no venue: a blank chip would be worse than
 * a repetitive one, and an event with no venue yet is a real state.
 */
export function calendarEventLabel(
  event: { title: string; venueName?: string | null; hostProfileId?: string | null },
  myProfileIds: readonly string[],
): string {
  const hosted = event.hostProfileId != null && myProfileIds.includes(event.hostProfileId);
  if (hosted) return event.title;
  return event.venueName?.trim() || event.title;
}
