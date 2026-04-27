import { formatDistanceToNow, parseISO } from "date-fns";
import {
  ArrowRightLeft,
  FileText,
  MessageSquare,
  PenLine,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettlementActivity } from "@/lib/queries";
import { settlementStatusLabels } from "@/lib/models";
import type { SettlementActivity, SettlementActivityType } from "@/lib/models";

function activityIcon(type: SettlementActivityType) {
  switch (type) {
    case "status_changed":    return <ArrowRightLeft className="h-3.5 w-3.5" />;
    case "comment_added":     return <MessageSquare className="h-3.5 w-3.5" />;
    case "revenue_updated":   return <PenLine className="h-3.5 w-3.5" />;
    case "deal_updated":      return <FileText className="h-3.5 w-3.5" />;
    case "revision_added":    return <RefreshCw className="h-3.5 w-3.5" />;
    case "settlement_created":return <Sparkles className="h-3.5 w-3.5" />;
    case "approval_changed":  return <ArrowRightLeft className="h-3.5 w-3.5" />;
  }
}

function activityLabel(activity: SettlementActivity): string {
  const d = activity.details ?? {};
  switch (activity.type) {
    case "status_changed": {
      const from = d.from ? (settlementStatusLabels[d.from as keyof typeof settlementStatusLabels] ?? d.from) : "—";
      const to   = d.to   ? (settlementStatusLabels[d.to   as keyof typeof settlementStatusLabels] ?? d.to)   : "—";
      return `Status changed from "${from}" to "${to}"`;
    }
    case "comment_added":
      return d.party ? `Comment added by ${d.party}` : "Comment added";
    case "revenue_updated":
      return "Financials updated";
    case "deal_updated":
      return "Deal structure updated";
    case "revision_added":
      return d.changes ? `Revision recorded: ${d.changes}` : "Revision recorded";
    case "settlement_created":
      return "Settlement created";
    case "approval_changed":
      return d.party && d.approved
        ? `${d.party} ${d.approved === "true" ? "approved" : "revoked approval"}`
        : "Approval updated";
  }
}

function iconBg(type: SettlementActivityType): string {
  switch (type) {
    case "status_changed":    return "bg-blue-500/10 text-blue-600";
    case "comment_added":     return "bg-violet-500/10 text-violet-600";
    case "revenue_updated":   return "bg-amber-500/10 text-amber-600";
    case "deal_updated":      return "bg-orange-500/10 text-orange-600";
    case "revision_added":    return "bg-teal-500/10 text-teal-600";
    case "settlement_created":return "bg-primary/10 text-primary";
    case "approval_changed":  return "bg-green-500/10 text-green-600";
  }
}

export function ChangeLogTab({ eventId }: { eventId: string }) {
  const { data: activities, isLoading } = useSettlementActivity(eventId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="h-7 w-7 rounded-full shrink-0" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground shadow-sm">
        No activity recorded yet. Changes to this settlement will appear here.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="divide-y">
        {activities.map((activity) => {
          const detailEntries = Object.entries(activity.details ?? {});
          return (
            <div key={activity.id} className="flex items-start gap-4 px-6 py-4">
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${iconBg(activity.type)}`}>
                {activityIcon(activity.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{activityLabel(activity)}</p>
                {detailEntries.length > 0 && activity.type === "revenue_updated" && (
                  <ul className="mt-1.5 space-y-0.5">
                    {detailEntries.map(([label, value]) => (
                      <li key={label} className="flex items-baseline gap-2 text-xs text-muted-foreground">
                        <span className="shrink-0 w-36 font-medium text-foreground/70">{label}</span>
                        <span className="font-mono">{value}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {activity.by}
                  {" · "}
                  {formatDistanceToNow(parseISO(activity.timestamp), { addSuffix: true })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
