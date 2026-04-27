import { formatDistanceToNow, parseISO } from "date-fns";
import { ArrowRightLeft, FileText, PenLine, RefreshCw, MessageSquare, Sparkles, Music, Clock, Users, Archive, Calendar, CalendarCheck, CalendarX, CheckCircle2, XCircle, UserPlus, UserMinus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useEventActivityLog } from "@/lib/queries";
import { settlementStatusLabels } from "@/lib/models";
import type { Event } from "@/lib/models";
import type { ActivityEntry } from "@/lib/queries";

function entryIcon(entry: ActivityEntry) {
  const type = entry.type;
  if (type === "status_changed")      return <ArrowRightLeft className="h-3.5 w-3.5" />;
  if (type === "details_updated")     return <PenLine className="h-3.5 w-3.5" />;
  if (type === "comment_added")       return <MessageSquare className="h-3.5 w-3.5" />;
  if (type === "revenue_updated")     return <PenLine className="h-3.5 w-3.5" />;
  if (type === "deal_updated")        return <FileText className="h-3.5 w-3.5" />;
  if (type === "revision_added")      return <RefreshCw className="h-3.5 w-3.5" />;
  if (type === "rider_updated")       return <Music className="h-3.5 w-3.5" />;
  if (type === "schedule_updated")    return <Clock className="h-3.5 w-3.5" />;
  if (type === "agreement_updated")   return <FileText className="h-3.5 w-3.5" />;
  if (type === "crew_updated")        return <Users className="h-3.5 w-3.5" />;
  if (type === "archived" || type === "unarchived") return <Archive className="h-3.5 w-3.5" />;
  if (type === "date_change_proposed")  return <Calendar className="h-3.5 w-3.5" />;
  if (type === "date_change_confirmed") return <CalendarCheck className="h-3.5 w-3.5" />;
  if (type === "date_change_declined")  return <CalendarX className="h-3.5 w-3.5" />;
  if (type === "performer_accepted")    return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (type === "performer_declined")    return <XCircle className="h-3.5 w-3.5" />;
  if (type === "agreement_confirmed")   return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (type === "performer_added")       return <UserPlus className="h-3.5 w-3.5" />;
  if (type === "performer_removed")     return <UserMinus className="h-3.5 w-3.5" />;
  return <Sparkles className="h-3.5 w-3.5" />;
}

function entryIconBg(entry: ActivityEntry): string {
  const { type, source } = entry;
  if (source === "settlement") {
    if (type === "status_changed")  return "bg-blue-500/10 text-blue-600";
    if (type === "comment_added")   return "bg-violet-500/10 text-violet-600";
    if (type === "revenue_updated") return "bg-amber-500/10 text-amber-600";
    if (type === "deal_updated")    return "bg-orange-500/10 text-orange-600";
    if (type === "revision_added")  return "bg-teal-500/10 text-teal-600";
    return "bg-muted text-muted-foreground";
  }
  // event source
  if (type === "status_changed")    return "bg-primary/10 text-primary";
  if (type === "details_updated")   return "bg-amber-500/10 text-amber-600";
  if (type === "rider_updated")     return "bg-purple-500/10 text-purple-600";
  if (type === "schedule_updated")  return "bg-cyan-500/10 text-cyan-600";
  if (type === "agreement_updated") return "bg-emerald-500/10 text-emerald-600";
  if (type === "crew_updated")      return "bg-indigo-500/10 text-indigo-600";
  if (type === "archived")              return "bg-red-500/10 text-red-600";
  if (type === "unarchived")            return "bg-green-500/10 text-green-600";
  if (type === "date_change_proposed")  return "bg-amber-500/10 text-amber-600";
  if (type === "date_change_confirmed") return "bg-emerald-500/10 text-emerald-600";
  if (type === "date_change_declined")  return "bg-red-500/10 text-red-600";
  if (type === "performer_accepted")    return "bg-emerald-500/10 text-emerald-600";
  if (type === "performer_declined")    return "bg-red-500/10 text-red-600";
  if (type === "agreement_confirmed")   return "bg-emerald-500/10 text-emerald-600";
  if (type === "performer_added")       return "bg-blue-500/10 text-blue-600";
  if (type === "performer_removed")     return "bg-red-500/10 text-red-600";
  return "bg-muted text-muted-foreground";
}

function entryLabel(entry: ActivityEntry): string {
  const d = entry.details ?? {};
  const { type, source } = entry;

  if (source === "event") {
    if (type === "status_changed")
      return `Event status changed from "${d.from ?? "—"}" to "${d.to ?? "—"}"`;
    if (type === "details_updated") {
      const fields = Object.keys(d);
      if (fields.length === 1) return `${capitalise(fields[0])} updated`;
      return `Event details updated (${fields.map(capitalise).join(", ")})`;
    }
    if (type === "rider_updated") {
      const parts: string[] = [];
      if (d.added) parts.push(`added: ${d.added}`);
      if (d.removed) parts.push(`removed: ${d.removed}`);
      return parts.length > 0 ? `Riders updated (${parts.join(", ")})` : "Riders updated";
    }
    if (type === "schedule_updated") {
      const parts: string[] = [];
      if (d.added) parts.push(`added: ${d.added}`);
      if (d.removed) parts.push(`removed: ${d.removed}`);
      return parts.length > 0 ? `Schedule updated (${parts.join(", ")})` : "Schedule updated";
    }
    if (type === "agreement_updated") {
      const parts: string[] = [];
      if (d.added) parts.push(`added: ${d.added}`);
      if (d.removed) parts.push(`removed: ${d.removed}`);
      return parts.length > 0 ? `Agreements updated (${parts.join(", ")})` : "Agreements updated";
    }
    if (type === "crew_updated") {
      const parts: string[] = [];
      if (d.added) parts.push(`added: ${d.added}`);
      if (d.removed) parts.push(`removed: ${d.removed}`);
      return parts.length > 0 ? `Crew updated (${parts.join(", ")})` : "Crew updated";
    }
    if (type === "performer_accepted")
      return `Performer "${d.performer ?? "—"}" accepted the event`;
    if (type === "performer_declined")
      return `Performer "${d.performer ?? "—"}" declined the event`;
    if (type === "agreement_confirmed") {
      const who = d.profileName || d.party || "—";
      return d.method === "manual"
        ? `Agreement confirmed on behalf of ${who}`
        : `Agreement confirmed by ${who}`;
    }
    if (type === "performer_added")
      return `Performer "${d.performer ?? "—"}" added${d.stage ? ` (${d.stage})` : ""}`;
    if (type === "performer_removed")
      return `Performer "${d.performer ?? "—"}" removed`;
    if (type === "archived") return "Event archived";
    if (type === "unarchived") return "Event unarchived";
    if (type === "date_change_proposed") {
      const parts: string[] = [];
      if (d.date) parts.push(`Date: ${d.date}`);
      if (d.startTime) parts.push(`Start: ${d.startTime}`);
      if (d.endTime) parts.push(`End: ${d.endTime}`);
      return parts.length > 0 ? `Date change proposed (${parts.join(", ")})` : "Date change proposed";
    }
    if (type === "date_change_confirmed") {
      if (d.confirmedBy) return `Date change confirmed by ${d.confirmedBy}`;
      const parts: string[] = [];
      if (d.date) parts.push(`Date: ${d.date}`);
      if (d.startTime) parts.push(`Start: ${d.startTime}`);
      if (d.endTime) parts.push(`End: ${d.endTime}`);
      return parts.length > 0 ? `Date change confirmed and applied (${parts.join(", ")})` : "Date change confirmed";
    }
    if (type === "date_change_declined") {
      if (d.cancelledBy) return "Date change cancelled by organizer";
      if (d.declinedBy) return `Date change declined by ${d.declinedBy}`;
      return "Date change declined";
    }
  }

  // settlement entries
  if (type === "status_changed") {
    const from = d.from ? (settlementStatusLabels[d.from as keyof typeof settlementStatusLabels] ?? d.from) : "—";
    const to   = d.to   ? (settlementStatusLabels[d.to   as keyof typeof settlementStatusLabels] ?? d.to)   : "—";
    return `Settlement status changed from "${from}" to "${to}"`;
  }
  if (type === "comment_added")   return d.party ? `Settlement comment added by ${d.party}` : "Settlement comment added";
  if (type === "revenue_updated") return "Financials updated";
  if (type === "deal_updated")    return "Deal structure updated";
  if (type === "revision_added")  return d.changes ? `Revision recorded: ${d.changes}` : "Revision recorded";
  return type.replace(/_/g, " ");
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function EventChangeLogTab({ eventId, isPerformer, childEvents }: { eventId: string; isPerformer?: boolean; childEvents?: Event[] }) {
  const { entries: parentEntries, isLoading: parentLoading } = useEventActivityLog(eventId);

  // Load activity for each child event (hooks are always called, just with empty array when no children)
  const childIds = childEvents?.map((c) => c.id) ?? [];
  const child0 = useEventActivityLog(childIds[0] ?? "");
  const child1 = useEventActivityLog(childIds[1] ?? "");
  const child2 = useEventActivityLog(childIds[2] ?? "");
  const child3 = useEventActivityLog(childIds[3] ?? "");
  const child4 = useEventActivityLog(childIds[4] ?? "");
  const child5 = useEventActivityLog(childIds[5] ?? "");
  const child6 = useEventActivityLog(childIds[6] ?? "");
  const child7 = useEventActivityLog(childIds[7] ?? "");
  const child8 = useEventActivityLog(childIds[8] ?? "");
  const child9 = useEventActivityLog(childIds[9] ?? "");
  const childHooks = [child0, child1, child2, child3, child4, child5, child6, child7, child8, child9];

  const childArtistMap = new Map<string, string>();
  childEvents?.forEach((c) => childArtistMap.set(c.id, c.artist));

  const isLoading = parentLoading || childIds.some((_, i) => childHooks[i]?.isLoading);

  // Merge parent entries with child entries (tagged with performer name)
  const allEntries: (ActivityEntry & { performerLabel?: string })[] = [
    ...parentEntries.map((e) => ({ ...e })),
    ...childIds.flatMap((cid, i) =>
      (childHooks[i]?.entries ?? []).map((e) => ({
        ...e,
        performerLabel: childArtistMap.get(cid) || "Performer",
      })),
    ),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const entries = isPerformer
    ? allEntries.filter(e => !("visibility" in e) || e.visibility !== "operator_only")
    : allEntries;

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

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground shadow-sm">
        No activity recorded yet. Changes to this event will appear here.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="divide-y">
        {entries.map((entry) => {
          const detailEntries = Object.entries(entry.details ?? {});
          const showDetails =
            detailEntries.length > 0 &&
            (entry.type === "revenue_updated" || entry.type === "details_updated" || entry.type === "deal_updated" || entry.type === "date_change_proposed" || entry.type === "date_change_confirmed");
          return (
            <div key={entry.id} className="flex items-start gap-4 px-6 py-4">
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${entryIconBg(entry)}`}>
                {entryIcon(entry)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{entryLabel(entry)}</p>
                {showDetails && (
                  <ul className="mt-1.5 space-y-0.5">
                    {detailEntries.map(([label, value]) => (
                      <li key={label} className="flex items-baseline gap-2 text-xs text-muted-foreground">
                        <span className="shrink-0 w-36 font-medium text-foreground/70">{capitalise(label)}</span>
                        <span className="font-mono">{value}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.by}
                  {entry.profile && <span className="text-foreground/60"> ({entry.profile})</span>}
                  {"performerLabel" in entry && entry.performerLabel && (
                    <span className="text-foreground/60"> · {entry.performerLabel}</span>
                  )}
                  {" · "}
                  {formatDistanceToNow(parseISO(entry.timestamp), { addSuffix: true })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
