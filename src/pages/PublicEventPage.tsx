import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchPublicEvent } from "@/lib/db";
import { queryKeys } from "@/lib/queries/keys";
import { useCreateRsvp } from "@/lib/queries/useAudienceRsvp";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Ticket, CheckCircle, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import { PublicProfileBadge } from "@/components/PublicProfileBadge";

export default function PublicEventPage() {
  const { id } = useParams({ from: "/event/$id" });
  const { data: event, isLoading } = useQuery({
    queryKey: queryKeys.publicEvent(id),
    queryFn: () => fetchPublicEvent(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
  const [rsvpName, setRsvpName] = useState("");
  const [rsvpEmail, setRsvpEmail] = useState("");
  const [rsvpCity, setRsvpCity] = useState("");
  const [rsvpSubmitted, setRsvpSubmitted] = useState(false);
  const createRsvp = useCreateRsvp();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        {/* Hero skeleton */}
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-muted py-16">
          <div className="max-w-3xl mx-auto px-6">
            <Skeleton className="h-4 w-16 mb-8" />
            <div className="flex items-start gap-5">
              <Skeleton className="h-[88px] w-[72px] rounded-xl shrink-0" />
              <div className="space-y-3 flex-1">
                <Skeleton className="h-9 w-64" />
                <Skeleton className="h-4 w-80" />
              </div>
            </div>
          </div>
        </div>

        {/* Content skeleton */}
        <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
          {/* Event details card */}
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            <Skeleton className="h-6 w-36" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-36" />
                </div>
              ))}
            </div>
          </div>

          {/* Action button skeleton */}
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            <Skeleton className="h-6 w-24 mx-auto" />
            <Skeleton className="h-4 w-40 mx-auto" />
            <div className="max-w-sm mx-auto space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-11 w-full rounded-md" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Event not found</h1>
          <p className="text-muted-foreground">This event doesn't exist or isn't available.</p>
        </div>
      </div>
    );
  }

  const eventDate = new Date(event.date);
  const ticketUrls: string[] = event.ticketUrls || [];
  const roomStage: string = event.roomStage || "";

  const handleRsvp = () => {
    if (!rsvpName.trim() || !rsvpEmail.trim()) {
      toast({ title: "Please fill in your details", variant: "destructive" });
      return;
    }
    createRsvp.mutate(
      {
        eventId: event.id,
        name: rsvpName.trim(),
        email: rsvpEmail.trim(),
        ...(rsvpCity.trim() ? { city: rsvpCity.trim() } : {}),
      },
      {
        onSuccess: () => {
          setRsvpSubmitted(true);
          toast({ title: "RSVP Confirmed!", description: `You're on the list for ${event.name}.` });
        },
      },
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero header */}
      <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-muted py-16">
        <div className="max-w-3xl mx-auto px-6">
          <div className="flex items-start gap-5">
            <div className="flex flex-col items-center justify-center rounded-xl bg-primary/10 border border-primary/20 px-4 py-3 min-w-[72px] shrink-0">
              <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                {eventDate.toLocaleDateString("en-US", { month: "short" })}
              </span>
              <span className="text-2xl font-bold text-primary">{eventDate.getDate()}</span>
              <span className="text-[10px] text-primary/70">{eventDate.getFullYear()}</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight">{event.name}</h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-sm">
                <PublicProfileBadge name={event.artist} profileId={event.performerProfileId} size="md" />
                <PublicProfileBadge
                  name={roomStage ? `${event.venue} — ${roomStage}` : event.venue}
                  profileId={event.hostProfileId}
                  size="md"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        {/* Event details card */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" /> Event Details
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground font-medium">Date</dt>
              <dd className="mt-0.5">{eventDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground font-medium">Performer</dt>
              <dd className="mt-1"><PublicProfileBadge name={event.artist} profileId={event.performerProfileId} size="sm" /></dd>
            </div>
            <div>
              <dt className="text-muted-foreground font-medium">Venue</dt>
              <dd className="mt-1"><PublicProfileBadge name={event.venue} profileId={event.hostProfileId} size="sm" /></dd>
            </div>
            {roomStage && (
              <div>
                <dt className="text-muted-foreground font-medium">Room / Stage</dt>
                <dd className="mt-0.5">{roomStage}</dd>
              </div>
            )}
            {event.capacity > 0 && (
              <div>
                <dt className="text-muted-foreground font-medium">Capacity</dt>
                <dd className="mt-0.5">{event.capacity.toLocaleString()}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Tickets section */}
        {ticketUrls.length > 0 && (
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Ticket className="h-5 w-5 text-primary" /> Tickets
            </h2>
            <div className="space-y-2">
              {ticketUrls.map((url, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-muted/50 p-4">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{url}</span>
                  </div>
                  <Button asChild size="sm" className="ml-3 shrink-0">
                    <a href={url} target="_blank" rel="noopener noreferrer">Buy Tickets</a>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RSVP */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-2 text-center">Interested?</h2>
          <p className="text-sm text-muted-foreground mb-4 text-center">Let us know you're coming!</p>
          {rsvpSubmitted ? (
            <div className="text-center py-4">
              <CheckCircle className="h-10 w-10 text-[hsl(var(--success))] mx-auto mb-2" />
              <p className="font-semibold">You're on the list!</p>
              <p className="text-sm text-muted-foreground mt-1">We'll send details to {rsvpEmail}</p>
            </div>
          ) : (
            <div className="max-w-sm mx-auto space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={rsvpName} onChange={(e) => setRsvpName(e.target.value)} placeholder="Your name" className="mt-1" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={rsvpEmail} onChange={(e) => setRsvpEmail(e.target.value)} placeholder="your@email.com" className="mt-1" />
              </div>
              <div>
                <Label>City</Label>
                <AddressAutocomplete value={rsvpCity} onChange={(val) => setRsvpCity(val)} placeholder="Search your city…" className="mt-1" />
              </div>
              <Button size="lg" onClick={handleRsvp} disabled={createRsvp.isPending} className="w-full gap-2">
                <CheckCircle className="h-4 w-4" /> {createRsvp.isPending ? "Submitting…" : "RSVP Now"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
