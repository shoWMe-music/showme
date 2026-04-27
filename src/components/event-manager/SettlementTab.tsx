import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DollarSign, CheckCircle2, CreditCard, FileText } from "lucide-react";
import {
  type Event as AppEvent, type DealStructure, type TicketRevenue, type Settlement,
  type SettlementStatus, type EventStatus, eventStatusLabels,
} from "@/lib/models";

/* ─── Settlement Tab ─── */
export function SettlementTab({ event, deal, revenue, settlement, updateSettlementStatus, addComment, generateShareLink, currentUser }: {
  event: AppEvent;
  deal: DealStructure | null | undefined;
  revenue: TicketRevenue | undefined;
  settlement: Settlement | undefined;
  updateSettlementStatus: (eventId: string, status: SettlementStatus) => void;
  addComment: (eventId: string, party: string, message: string, attachments?: { name: string; size: string; type: string }[]) => void;
  generateShareLink: (eventId: string, parties: string[]) => string;
  currentUser: { name: string; roles: string[] };
}) {
  const [showFull, setShowFull] = useState(false);
  const navigate = useNavigate();

  const isOperator = currentUser.roles.includes("promoter") || currentUser.roles.includes("venue") || currentUser.roles.includes("organizer");
  const eventConcluded = event.eventStatus === "concluded";
  const hasSettlement = settlement && settlement.status !== "open";

  // Simple settlement tab: just a button
  if (!eventConcluded && !hasSettlement) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="font-display text-lg font-semibold mb-2">Settlement</h3>
        <p className="text-sm text-muted-foreground mb-6">Settlement will be available after the event concludes.</p>
        <Badge variant="outline" className="text-xs">Event status: {eventStatusLabels[event.eventStatus as EventStatus]}</Badge>
      </div>
    );
  }

  if (settlement?.status === "open" && eventConcluded) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <DollarSign className="h-12 w-12 text-primary mx-auto mb-4" />
        <h3 className="font-display text-lg font-semibold mb-2">Ready to Settle</h3>
        <p className="text-sm text-muted-foreground mb-6">The event has concluded. You can now prepare the financial settlement.</p>
        <Button className="gap-2" onClick={() => navigate({ to: "/settlements/$id", params: { id: event.id } })}>
          <CreditCard className="h-4 w-4" /> Settle Finances
        </Button>
      </div>
    );
  }

  if (hasSettlement) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <CheckCircle2 className="h-12 w-12 text-[hsl(var(--success))] mx-auto mb-4" />
        <h3 className="font-display text-lg font-semibold mb-2">Settlement {settlement.status === "paid" ? "Completed" : "In Progress"}</h3>
        <p className="text-sm text-muted-foreground mb-2">Status: <StatusBadge status={settlement.status} /></p>
        <Button className="gap-2 mt-4" onClick={() => navigate({ to: "/settlements/$id", params: { id: event.id } })}>
          <FileText className="h-4 w-4" /> View Settlement
        </Button>
      </div>
    );
  }
  // Fallback: navigate to settlements page
  navigate({ to: "/settlements/$id", params: { id: event.id } });
  return null;
}
