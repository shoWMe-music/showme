import { useParams, useSearch, useNavigate, Link } from "@tanstack/react-router";
import AppLayout from "@/components/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import { useEvent, useEventEconomics, useUpdateSettlementStatus, useAddComment, useUpdateRevenue, useEventsLoaded, useChildEvents } from "@/lib/queries";
import { upsertShareToken } from "@/lib/db";
import { useUser } from "@/lib/user-context";
import { SettlementWorkspace } from "@/components/settlements/SettlementWorkspace";
import { userIsEventPerformer } from "@/lib/eventPermissions";

export default function SettlementDetailPage() {
  const { id } = useParams({ from: "/settlements/$id" });
  const { tab } = useSearch({ from: "/settlements/$id" });
  const navigate = useNavigate();
  const eventsLoaded = useEventsLoaded();
  const { currentUser, profiles } = useUser();

  const event = useEvent(id);
  const { isLoaded, deal, revenue, settlement } = useEventEconomics(id);
  const childEvents = useChildEvents(id);
  const viewerIsPerformer = useMemo(
    () => userIsEventPerformer(event, profiles, childEvents.map((c) => c.performerProfileId).filter(Boolean) as string[]),
    [event, profiles, childEvents],
  );

  const updateSettlementStatus = useUpdateSettlementStatus();
  const addComment = useAddComment();
  const updateRevenue = useUpdateRevenue();

  const generateShareLink = (eventId: string, parties: string[]): string => {
    const token = `review-${eventId}`;
    const snapshot = event && deal && revenue && settlement ? { event, deal, revenue, settlement } : undefined;
    void upsertShareToken(token, eventId, parties, snapshot);
    return `${window.location.origin}/review/${token}`;
  };

  if (!eventsLoaded || !isLoaded) {
    return (
      <AppLayout>
        <div className="animate-fade-in space-y-6">
          <Skeleton className="h-4 w-28" />
          <div className="space-y-3">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="flex gap-1 border-b pb-0">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-24 rounded-none rounded-t" />)}
          </div>
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!event || !settlement) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-lg text-muted-foreground">Settlement not found</p>
          <Link to="/settlements" className="mt-4 text-primary hover:underline">Back to settlements</Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <SettlementWorkspace
          event={event}
          deal={deal}
          revenue={revenue}
          settlement={settlement}
          initialTab={tab ?? "overview"}
          onTabChange={(t) => navigate({ to: "/settlements/$id", params: { id }, search: { tab: t }, replace: true })}
          updateSettlementStatus={(eventId, status) => updateSettlementStatus.mutate({ eventId, status })}
          updateRevenue={(eventId, newRevenue) => updateRevenue.mutate({ eventId, newRevenue })}
          addComment={(eventId, party, message, attachments) =>
            addComment.mutate({ eventId, party, message, attachments, date: new Date().toISOString().slice(0, 10) })
          }
          generateShareLink={generateShareLink}
          currentUser={currentUser}
          viewerIsPerformer={viewerIsPerformer}
          onBack={() => navigate({ to: "/settlements" })}
        />
      </div>
    </AppLayout>
  );
}
