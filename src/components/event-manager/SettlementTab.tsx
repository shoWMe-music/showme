import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DollarSign, CheckCircle2, CreditCard, FileText, Send, Share2, Copy, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  type Event as AppEvent, type DealStructure, type TicketRevenue, type Settlement,
  type SettlementStatus, type EventStatus, eventStatusLabels,
} from "@/lib/models";
import { settlementUnlocked, isShowDay } from "@/lib/eventLifecycle";

/* ─── Settlement Tab ─── */
export function SettlementTab({ event, deal, revenue, settlement, updateSettlementStatus, addComment, generateShareLink, currentUser }: {
  event: AppEvent;
  deal: DealStructure | null | undefined;
  revenue: TicketRevenue | undefined;
  settlement: Settlement | undefined;
  updateSettlementStatus: (eventId: string, status: SettlementStatus) => void;
  addComment: (eventId: string, party: string, message: string, attachments?: { name: string; size: number; type: string; fileUrl: string }[]) => void;
  generateShareLink: (eventId: string, parties: string[]) => string;
  currentUser: { name: string; roles: string[] };
}) {
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const isOperator = currentUser.roles.includes("promoter") || currentUser.roles.includes("venue") || currentUser.roles.includes("organizer");
  const settlementOpen = settlementUnlocked(event);
  const showDay = isShowDay(event);
  const hasSettlement = settlement && settlement.status !== "open";

  const handleSendForReview = () => {
    updateSettlementStatus(event.id, "pending_review");
    const link = generateShareLink(event.id, ["Performer", "Agent", "Venue"]);
    setShareLink(link);
    toast({ title: "Settlement sent for review", description: "Share the link below with collaborators for approval." });
  };

  const handleCopy = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const showPreConcluded = !settlementOpen && !hasSettlement;
  const showReadyToSettle = settlement?.status === "open" && settlementOpen;
  const shouldRedirect = !showPreConcluded && !showReadyToSettle && !hasSettlement;

  useEffect(() => {
    if (shouldRedirect) {
      navigate({ to: "/settlements/$id", params: { id: event.id } });
    }
  }, [shouldRedirect, navigate, event.id]);

  if (shouldRedirect) return null;

  // Simple settlement tab: just a button
  if (!settlementOpen && !hasSettlement) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="font-display text-lg font-semibold mb-2">Settlement</h3>
        <p className="text-sm text-muted-foreground mb-6">Settlement opens on show day.</p>
        <Badge variant="outline" className="text-xs">Event status: {eventStatusLabels[event.eventStatus as EventStatus]}</Badge>
      </div>
    );
  }

  if (settlement?.status === "open" && settlementOpen) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <DollarSign className="h-12 w-12 text-primary mx-auto mb-4" />
        <h3 className="font-display text-lg font-semibold mb-2">Ready to Settle</h3>
        <p className="text-sm text-muted-foreground mb-6">
          {showDay
            ? "It's show day — you can prepare the financial settlement."
            : "The event has concluded. You can now prepare the financial settlement."}
        </p>
        <div className="flex flex-col items-center gap-3">
          <Button className="gap-2" onClick={() => navigate({ to: "/settlements/$id", params: { id: event.id } })}>
            <CreditCard className="h-4 w-4" /> Settle Finances
          </Button>
          {isOperator && (
            <>
              <Button variant="outline" className="gap-2" onClick={handleSendForReview}>
                <Send className="h-4 w-4" /> Send for Review
              </Button>
              {shareLink && (
                <div className="w-full max-w-md flex items-center gap-2 rounded-lg bg-muted p-3">
                  <Input value={shareLink} readOnly className="text-xs font-mono" />
                  <Button variant="outline" size="icon" onClick={handleCopy}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (hasSettlement) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <CheckCircle2 className="h-12 w-12 text-[hsl(var(--success))] mx-auto mb-4" />
        <h3 className="font-display text-lg font-semibold mb-2">Settlement {settlement.status === "paid" ? "Completed" : "In Progress"}</h3>
        <p className="text-sm text-muted-foreground mb-2">Status: <StatusBadge status={settlement.status} /></p>
        <div className="flex flex-col items-center gap-3 mt-4">
          <Button className="gap-2" onClick={() => navigate({ to: "/settlements/$id", params: { id: event.id } })}>
            <FileText className="h-4 w-4" /> View Settlement
          </Button>
          {isOperator && settlement.status !== "paid" && settlement.status !== "finalized" && (
            <>
              <Button variant="outline" className="gap-2" onClick={handleSendForReview}>
                <Send className="h-4 w-4" /> {settlement.status === "pending_review" ? "Resend for Review" : "Send for Review"}
              </Button>
              {shareLink && (
                <div className="w-full max-w-md flex items-center gap-2 rounded-lg bg-muted p-3">
                  <Input value={shareLink} readOnly className="text-xs font-mono" />
                  <Button variant="outline" size="icon" onClick={handleCopy}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </>
          )}
          {isOperator && (settlement.status === "finalized" || settlement.status === "paid") && (
            <Button variant="outline" className="gap-2" onClick={() => {
              const link = generateShareLink(event.id, ["Performer", "Agent", "Venue"]);
              setShareLink(link);
            }}>
              <Share2 className="h-4 w-4" /> Share Settlement
            </Button>
          )}
          {shareLink && (settlement.status === "finalized" || settlement.status === "paid") && (
            <div className="w-full max-w-md flex items-center gap-2 rounded-lg bg-muted p-3">
              <Input value={shareLink} readOnly className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
}
