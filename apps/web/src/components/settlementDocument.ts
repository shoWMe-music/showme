import type { Status } from "@showme/design-system";
import type { SettlementStep } from "./SettlementStepper";
import type { TransferState } from "./WhoOwesWhomBoard";

/**
 * Pure readers for a settlement, shared by the Settlements table row and the
 * settlement detail overlay. They live outside both components so the two
 * surfaces can never disagree about what a status means or which figure is which.
 *
 * NOTHING here does money arithmetic. The settlement engine
 * (`packages/settlement`) is authoritative and its result is frozen into
 * `settlements.computed` at finalize; a second implementation in the browser is
 * exactly the drift audit A-13 was. Every amount rendered is a field the API
 * served, formatted and nothing else.
 */

/**
 * The row the Settlements list already holds, and the only event context the
 * detail overlay needs.
 *
 * The overlay is handed the row rather than re-fetching it by id (the invoice
 * overlay's pattern) because there is no `GET /settlements/:id` — the list route
 * `GET /settlements` is the only place the event title, its date and the event's
 * base currency are served together with the settlement. The per-event read the
 * overlay *does* make (`GET /events/:id/settlements`) carries neither an event
 * title nor a currency.
 */
export interface SettlementListRow {
  id: string;
  status: string;
  /** The caller's OWN participant row — which line in the board is theirs. */
  participantId: string | null;
  /** `events.base_currency`; every figure in a settlement is denominated in it. */
  currency: string;
  event: { id: string; title: string; eventDate: string | null; status: string };
}

/** `settlement_status` → the design system's status vocabulary + a human label. */
export function settlementStatusToDisplay(status: string): { status: Status; label: string } {
  switch (status) {
    case "finalized":
      return { status: "confirmed", label: "Finalized" };
    case "paid":
      return { status: "confirmed", label: "Paid" };
    case "partly_paid":
      return { status: "pending", label: "Partly paid" };
    case "comments_received":
      return { status: "pending", label: "Comments" };
    case "revised":
      return { status: "pending", label: "Revised" };
    case "dispute":
      return { status: "cancelled", label: "Dispute" };
    default:
      return { status: "task", label: "Pending review" };
  }
}

/** How far along the settlement process a status sits. */
const STATUS_STAGE_INDEX: Record<string, number> = {
  open: 0,
  draft: 0,
  pending: 1,
  pending_review: 1,
  review: 1,
  comments_received: 1,
  finalized: 2,
  revised: 2,
  partly_paid: 3,
  paid: 3,
  concluded: 3,
};

const STAGE_LABELS = ["Open", "Pending review", "Finalized", "Paid"];

/** The four-stop process rail for one settlement's status. */
export function settlementSteps(status: string): SettlementStep[] {
  const active = STATUS_STAGE_INDEX[status] ?? 0;
  return STAGE_LABELS.map((label, index) => ({
    label,
    state: index < active ? "done" : index === active ? "active" : "pending",
  }));
}

/** `settlement_transfers.state` → the board's three payment states. */
export function transferStateOf(raw: string | null | undefined): TransferState {
  if (raw === "paid") return "paid";
  if (raw === "handled") return "handled";
  return "owed";
}

/**
 * Which way a net line leans: positive = owed to this party, negative = they are
 * holding more cash than they are entitled to. A comparison, not arithmetic —
 * the number itself is the engine's.
 */
export function netToneOf(net: string): "positive" | "negative" | "neutral" {
  const value = Number(net);
  if (!Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

/** Up to two initials for an avatar. */
export function initialsOf(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Whether the visible lines are the WHOLE board.
 *
 * `Σ net = 0` is an invariant of every party on the event, and the engine asserts
 * it at compute time — so a non-zero sum here never means the books are wrong, it
 * means the payload was party-scoped and the missing lines are the ones the caller
 * may not see (a performer gets her own line, not the operator's). Rendering
 * "Not balanced" over a redacted slice would report authorization as an accounting
 * error, so the badge is claimed only when the sum actually lands on zero.
 */
export function isWholeBoard(nets: string[]): boolean {
  if (nets.length === 0) return false;
  return nets.reduce((total, net) => total + Number(net), 0) === 0;
}
