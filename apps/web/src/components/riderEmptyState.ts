/**
 * WHAT AN EMPTY RIDERS CARD IS ENTITLED TO SAY — which is less than it used to say.
 *
 * `GET /events/:id/riders` is SCOPED (decisions #12, `routes/riders.ts::scopedEventRiders`): an
 * operator holding `budget.view` gets every rider, an act gets its own plus the house documents, a
 * crew member gets the house documents and — only with `rider.view` — whatever their SPONSOR
 * reaches. So an empty answer means "nothing for you", and only sometimes "nothing at all".
 *
 * The card claimed the second either way. A crew member on the Album Release read *"Nothing has
 * been submitted for this show yet"* about two riders that exist (QA sweep run 13), and the other
 * branch was wrong too: it keyed on `rider.submit`, which a PERFORMER holds while holding no
 * `budget.view` — measured — so an act with no rider of its own was told the show had none while
 * another act's sat on it.
 *
 * NOT `hiddenCount`, which is how the Deals tab answers the same shape. A deal's existence changes
 * the reader's own money picture, so a count is theirs to act on; the riders a crew member cannot
 * see are other acts' hospitality documents, the house ones already reach everybody standing on
 * the event (QA4-4), and a count there invites them to chase access #12 exists to withhold.
 *
 * DELIBERATELY CONSERVATIVE, and `seesEveryRider` is the reason it can be. It is true only on the
 * `budget.view` path, and that is not the only route to the whole set — an operator-sponsored crew
 * member with `rider.view` also resolves to `all`. Such a reader gets the reader-scoped sentence,
 * which is still TRUE of them, merely less specific. The claim about the EVENT is made only where
 * it cannot be wrong.
 */
export function riderEmptyState(seesEveryRider: boolean): string {
  if (seesEveryRider) return "No riders or documents yet.";
  return "Nothing has arrived for you to read yet.";
}
