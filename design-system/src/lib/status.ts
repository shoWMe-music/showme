/** The fixed status vocabulary from the design system's "Status palette".
 * In the source these are HARDCODED literals (there are no --status-* tokens),
 * each with a `.14`-alpha tint used for chip/badge fills. Kept exact. */
export const STATUSES = [
  "suggested",
  "pending",
  "confirmed",
  "hold",
  "concluded",
  "cancelled",
  "draft",
  "task",
] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  suggested: "Suggested",
  pending: "Pending",
  confirmed: "Confirmed",
  hold: "On hold",
  concluded: "Concluded",
  cancelled: "Cancelled",
  draft: "Draft",
  task: "Task",
};

/** Exact hue + `.14` tint fill for each status, verbatim from the source. */
export const STATUS_COLOR: Record<Status, { fg: string; tint: string }> = {
  suggested: { fg: "#B58BE0", tint: "rgba(181,139,224,.14)" },
  pending: { fg: "#F4A046", tint: "rgba(244,160,70,.14)" },
  confirmed: { fg: "#6FC97A", tint: "rgba(111,201,122,.14)" },
  hold: { fg: "#FFC266", tint: "rgba(255,194,102,.14)" },
  concluded: { fg: "#B8A99B", tint: "rgba(184,169,155,.14)" },
  cancelled: { fg: "#EE5746", tint: "rgba(238,87,70,.14)" },
  draft: { fg: "#8C7A6C", tint: "rgba(140,122,108,.14)" },
  task: { fg: "#6FA8E0", tint: "rgba(111,168,224,.14)" },
};
