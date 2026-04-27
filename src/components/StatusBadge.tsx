import { SettlementStatus, EventStatus, getStatusLabel, getEventStatusLabel } from "@/lib/models";

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

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${eventStatusClasses[status]}`}>
      {getEventStatusLabel(status)}
    </span>
  );
}
