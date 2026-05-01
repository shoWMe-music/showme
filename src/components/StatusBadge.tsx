import { SettlementStatus, EventStatus, getStatusLabel, getEventStatusLabel, type Event } from "@/lib/models";
import { isShowDay } from "@/lib/eventLifecycle";

const settlementClasses: Record<SettlementStatus, string> = {
  open: "status-open",
  pending_review: "status-pending-review",
  comments_received: "status-comments",
  revised: "status-revised",
  finalized: "status-finalized",
  partly_paid: "status-partly-paid",
  paid: "status-paid",
  dispute: "status-dispute",
};

const eventStatusClasses: Record<EventStatus, string> = {
  draft: "event-draft",
  suggested: "event-suggested",
  pending: "event-pending",
  confirmed: "event-confirmed",
  on_hold: "event-on-hold",
  concluded: "event-concluded",
  cancelled: "event-cancelled",
};

export default function StatusBadge({ status }: { status: SettlementStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${settlementClasses[status]}`}>
      {getStatusLabel(status)}
    </span>
  );
}

interface EventStatusBadgeProps {
  status: EventStatus;
  /** Pass the event to enable the "Show day" glow when status === confirmed and date === today. */
  event?: Pick<Event, "eventStatus" | "date">;
}

export function EventStatusBadge({ status, event }: EventStatusBadgeProps) {
  const showDay = !!event && isShowDay(event);
  if (showDay) {
    return (
      <span
        className="relative inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-100 text-amber-900 ring-2 ring-amber-400 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-500"
        style={{ boxShadow: "0 0 12px rgba(251,191,36,0.55)" }}
      >
        <span className="absolute inset-0 rounded-full ring-2 ring-amber-400/60 animate-ping" />
        <span className="relative">Show day</span>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${eventStatusClasses[status]}`}>
      {getEventStatusLabel(status)}
    </span>
  );
}
