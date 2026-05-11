import type { Event as AppEvent, DealStructure, TicketRevenue, Settlement } from "@/lib/models";
import type { EventMeta } from "@/lib/db";

export const TAB_SECTIONS: Record<string, { label: string; sections: { id: string; label: string }[] }> = {
  budget: {
    label: "Budget Planner",
    sections: [
      { id: "budget-calculator", label: "Budget Calculator" },
      { id: "budget-charts", label: "Break-even Analysis" },
      { id: "pro-estimator", label: "PRO fee estimate (estimate only)" },
    ],
  },
  details: {
    label: "Event Details",
    sections: [
      { id: "event-info", label: "Event Information" },
      { id: "performers", label: "Performers" },
      { id: "notes", label: "Notes" },
      { id: "amenities", label: "Amenities" },
      { id: "ticketing", label: "Ticket Information" },
      // ID kept as `production-schedule` for backwards-compat with existing share URLs;
      // the label and rendered heading now read "Event Schedule" to match the in-app tab.
      { id: "production-schedule", label: "Event Schedule" },
      { id: "riders", label: "Riders & Documents" },
      { id: "guest-list", label: "Guest List" },
      { id: "expenses", label: "Expenses" },
      { id: "deal-structure", label: "Financial Deal" },
    ],
  },
  agreement: {
    label: "Agreement",
    sections: [
      { id: "event-summary", label: "Event Summary" },
      { id: "agreements-docs", label: "Agreements & Documents" },
      { id: "terms", label: "Terms & Conditions" },
    ],
  },
  crew: {
    label: "Team / Crew",
    sections: [
      { id: "shared-team", label: "Shared Team" },
      { id: "schedule", label: "Team Schedule" },
      { id: "tasks", label: "Tasks" },
      { id: "private-notes", label: "Private Notes" },
    ],
  },
  settlement: {
    label: "Settlement",
    sections: [
      { id: "settlement-overview", label: "Settlement Overview" },
    ],
  },
};

export type SelectionLevel = "all" | "tabs" | "sections";

export interface EventExportData {
  event: AppEvent;
  deal: DealStructure;
  revenue: TicketRevenue;
  settlement: Settlement;
  eventMeta: EventMeta;
  /** Full child event docs for multi-performer parents; empty array otherwise. */
  performers?: AppEvent[];
  currency: string;
}
