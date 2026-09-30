import { conflict } from "../errors";

/**
 * MAY THIS ANSWER BE RECORDED AGAINST AN EVENT IN THIS STATE?
 *
 * decisions §25.9.9, Daniel 2026-09-29: an invitation left outstanding when the event is cancelled
 * **may not be ACCEPTED**. §25.6 had recommended the opposite — a cancelled event can be reinstated,
 * and nothing forbids `cancelled → confirmed` — and that recommendation was overruled.
 *
 * ── DECLINING STAYS OPEN, AND THAT IS THE WHOLE CARE IN THIS FUNCTION ────────────────────────────
 * The ruling names the acceptance and only the acceptance. The cost §25.6 raised against refusing
 * was that a blanket refusal also stops a performer putting a DECLINE on record — which is the
 * answer they are most likely to want, and the one that closes the invitation rather than leaving
 * it open for ever. Reading the ruling narrowly honours it and avoids that cost; if the narrow
 * reading is wrong it is one condition to widen, and the tests name it.
 *
 * ONE FUNCTION BECAUSE THERE ARE THREE DOORS. `POST /invitations/:token/accept` (an off-platform
 * party following a link), `POST /events/:id/participation/accept` and its `decline` twin (a party
 * already on the account answering from the inbox) — and the last two already share
 * `answerInvitation`. A rule spelled out per route is the shape this repo has spent a week
 * removing: the third door is always the one that keeps the old behaviour.
 *
 * NOT `archived`, and not `concluded`. Only a cancelled event has nothing to be added to; an
 * archived one is a filing decision by one reader and a concluded one already happened, and a party
 * accepting a late invitation to a night that went ahead is recording something true.
 */
export function assertAnswerable(
  eventStatus: string | null | undefined,
  answer: "accepted" | "declined",
): void {
  if (answer !== "accepted") return;
  if (eventStatus !== "cancelled") return;
  throw conflict(
    "This event was cancelled, so there is nothing to accept. You can still decline to close the invitation.",
  );
}
