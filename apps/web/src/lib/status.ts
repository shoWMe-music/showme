import { STATUS_LABEL, type Status } from "@showme/design-system";

/** The API event-status enum (draft | suggested | pending | confirmed |
 * on_hold | concluded | cancelled) does not line up 1:1 with the design
 * system's `Status` vocabulary — notably the API says `on_hold` where the
 * design system says `hold`. Map API → display, defaulting safely. */
const API_TO_DISPLAY: Record<string, Status> = {
  draft: "draft",
  suggested: "suggested",
  pending: "pending",
  confirmed: "confirmed",
  on_hold: "hold",
  concluded: "concluded",
  cancelled: "cancelled",
};

export function apiStatusToDisplay(apiStatus: string): { status: Status; label: string } {
  const status = API_TO_DISPLAY[apiStatus] ?? "draft";
  const label = STATUS_LABEL[status] ?? apiStatus;
  return { status, label };
}
