import { SettlementStatus } from "@/lib/models";

export const SETTLEMENT_STATUS_DOT: Record<SettlementStatus, string> = {
  open: "bg-[hsl(var(--success))]",
  pending_review: "bg-[hsl(var(--warning))]",
  comments_received: "bg-[hsl(var(--info))]",
  revised: "bg-accent-foreground",
  finalized: "bg-foreground",
  partly_paid: "bg-[hsl(var(--warning))]",
  paid: "bg-[hsl(var(--success))]",
  dispute: "bg-destructive",
};
