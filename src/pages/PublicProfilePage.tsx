import { useState, useEffect } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useUser, operatorRoleLabels, getBaseRole, formatLocation, getPrimaryLocation, type OperatorRole, type SharedProfile, type SubVenue, type ProfileLocation } from "@/lib/user-context";
import { queryKeys } from "@/lib/queries/keys";
import type { Event as AppEvent } from "@/lib/models";
import { fetchPublicProfileBySlug, fetchUpcomingEventsForPublicProfile } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Globe, Image, Video, Users, ExternalLink, Calendar, ChevronDown, ChevronUp, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import VenueMap from "@/components/VenueMap";
import RequestDateForm from "@/components/RequestDateForm";
import { PublicProfileBadge } from "@/components/PublicProfileBadge";
function getVideoEmbed(url: string): { embedUrl: string | null } {
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  if (ytMatch) return { embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}` };
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return { embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}` };
  return { embedUrl: null };
}

function formatPerformerLocation(loc: ProfileLocation | undefined): string {
  if (!loc) return "No location";
  return [loc.city, loc.country].filter(Boolean).join(", ") || "No location";
}

export default function PublicProfilePage() {
  const { slug } = useParams({ from: "/p/$slug" });
  const { profiles: localProfiles, currentUser, loaded: userLoaded } = useUser();
  const [loading, setLoading] = useState(true);
  const [foundRole, setFoundRole] = useState<OperatorRole | null>(null);
  const [foundProfile, setFoundProfile] = useState<SharedProfile | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [profileOwnerUid, setProfileOwnerUid] = useState("");

  const profileIdForEvents = foundProfile?.id ?? "";
  const { data: upcomingEvents = [] } = useQuery({
    queryKey: queryKeys.upcomingEventsForPublicProfile(profileIdForEvents),
    queryFn: () => fetchUpcomingEventsForPublicProfile(profileIdForEvents, 12),
    enabled: !!profileIdForEvents,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!userLoaded) return; // wait for owned profiles to load before falling back to remote
    async function loadProfile() {
      setLoading(true);
      if (!slug) {
        setFoundRole(null);
        setFoundProfile(null);
        setIsOwner(false);
        setProfileOwnerUid("");
        setLoading(false);
        return;
      }
      for (const [slotKey, profile] of Object.entries(localProfiles)) {
        if (!profile.created) continue;
        const profileSlug = profile.slug || profile.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || slotKey;
        if (profileSlug === slug) {
          setFoundRole(getBaseRole(slotKey));
          setFoundProfile(profile);
          setIsOwner(true);
          setProfileOwnerUid(currentUser.id);
          setLoading(false);
          return;
        }
      }
      try {
        const remote = await fetchPublicProfileBySlug(slug);
        if (remote) {
          setFoundRole(getBaseRole(remote.slot));
          setFoundProfile(remote.profile);
          setIsOwner(currentUser.id === remote.owner_uid);
          setProfileOwnerUid(remote.owner_uid);
        } else {
          setFoundRole(null);
          setFoundProfile(null);
          setIsOwner(false);
          setProfileOwnerUid("");
        }
      } catch {
        setFoundRole(null);
        setFoundProfile(null);
        setIsOwner(false);
        setProfileOwnerUid("");
      }
      setLoading(false);
    }
    void loadProfile();
  }, [slug, localProfiles, currentUser.id, userLoaded]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-5xl mx-auto">
          {/* Banner skeleton */}
          <Skeleton className="h-64 w-full rounded-none" />

          {/* Avatar + header skeleton */}
          <div className="px-8 -mt-20 relative z-10">
            <div className="flex items-start gap-6">
              <Skeleton className="h-40 w-40 rounded-full shrink-0 border-4 border-card" />
              <div className="pt-[5.5rem] flex-1 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <div className="flex gap-1.5">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-4 w-36" />
                <div className="flex gap-2">
                  <Skeleton className="h-7 w-24 rounded-lg" />
                  <Skeleton className="h-7 w-24 rounded-lg" />
                </div>
              </div>
            </div>
          </div>

          {/* Upcoming events skeleton */}
          <div className="px-8 py-6">
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <Skeleton className="h-6 w-40 mb-4" />
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-4 rounded-lg border bg-background p-4">
                    <Skeleton className="h-14 w-[60px] rounded-lg shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-36" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Content skeleton */}
          <div className="p-8 pt-2">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Bio card */}
                <div className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </div>
              </div>
              <div className="space-y-6">
                <div className="rounded-xl border bg-card p-6 shadow-sm space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!foundProfile || !foundRole) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Profile not found</h1>
          <p className="text-muted-foreground">This profile doesn't exist or isn't public.</p>
        </div>
      </div>
    );
  }

  const profile = foundProfile;
  const role = foundRole;


  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto">
        {/* Banner */}
        <div className="relative h-64 bg-gradient-to-r from-primary/20 to-primary/5">
          {profile.bannerUrl ? (
            <img
              src={profile.bannerUrl}
              alt="Banner"
              className="w-full h-full object-cover"
              style={{
                // bannerOffsetX/Y default to 50% (centered) when unset.
                // TODO: move bannerOffsetX/bannerOffsetY onto SharedProfile in models.ts after Wave 6 swarm
                objectPosition: `${typeof (profile as { bannerOffsetX?: number }).bannerOffsetX === "number" ? (profile as { bannerOffsetX?: number }).bannerOffsetX : 50}% ${typeof (profile as { bannerOffsetY?: number }).bannerOffsetY === "number" ? (profile as { bannerOffsetY?: number }).bannerOffsetY : 50}%`,
              }}
            />
          ) : (
            <div className="h-full bg-gradient-to-br from-primary/10 via-primary/5 to-muted" />
          )}
        </div>

        {/* Avatar + Header */}
        <div className="px-8 -mt-20 relative z-10">
          <div className="flex items-start gap-6">
            <div className="h-40 w-40 rounded-full border-4 border-card bg-muted overflow-hidden shadow-lg shrink-0">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="flex items-center justify-center h-full text-4xl font-bold text-muted-foreground">{profile.name?.charAt(0) || "?"}</div>
              )}
            </div>
            <div className="pt-[5.5rem] flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold tracking-tight">{profile.name}</h1>
                <Badge variant="secondary" className="text-xs">{operatorRoleLabels[role]}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {profile.genres?.map(g => <Badge key={g} variant="outline" className="text-xs">{g}</Badge>)}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {role === "performer"
                    ? formatPerformerLocation(getPrimaryLocation(profile.locations))
                    : formatLocation(getPrimaryLocation(profile.locations)) || "No location"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {profile.socialLinks?.filter(l => l.url).map((link, i) => (
                  <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium hover:bg-muted/50 transition-colors">
                    <Globe className="h-3 w-3" /> {link.platform || link.url}
                  </a>
                ))}
              </div>
            </div>
            {/* Header action row — booking CTAs sit next to the name/avatar, not below social links */}
            <div className="pt-[5.5rem] shrink-0">
              {role === "venue" && (
                <VenueRequestButtons operatorOwnerUid={profileOwnerUid} slug={slug!} profileId={foundProfile?.id ?? ""} />
              )}
              {role === "performer" && !isOwner && (
                <PerformerBookingButtons operatorOwnerUid={profileOwnerUid} slug={slug!} profileId={foundProfile?.id ?? ""} />
              )}
            </div>
          </div>
        </div>

        {/* Coming Events — published upcoming events for this profile */}
        <UpcomingEventsSection events={upcomingEvents} limit={6} role={role} />

        {/* Content */}
        <div className="p-8 pt-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-3">{role === "venue" ? "About" : "Bio"}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{profile.bio || "No bio added yet."}</p>
              </div>

              {/* Map under About */}
              {profile.coordinates ? (
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" /> Location</h3>
                  <VenueMap lat={profile.coordinates.lat} lng={profile.coordinates.lng} className="w-full h-48 rounded-lg" />
                  {getPrimaryLocation(profile.locations) && (
                    <p className="text-sm text-muted-foreground mt-3">
                      {role === "performer"
                        ? formatPerformerLocation(getPrimaryLocation(profile.locations))
                        : formatLocation(getPrimaryLocation(profile.locations))}
                    </p>
                  )}
                </div>
              ) : null}

              {(profile.photos?.length || 0) > 0 && (
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Image className="h-5 w-5 text-primary" /> Photos</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {profile.photos!.map((url, i) => (
                      <div key={i} className="aspect-video rounded-lg overflow-hidden"><img src={url} alt="" className="w-full h-full object-cover" /></div>
                    ))}
                  </div>
                </div>
              )}

              {(profile.videos?.length || 0) > 0 && (
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Video className="h-5 w-5 text-primary" /> Videos</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {profile.videos!.map((url, i) => {
                      const { embedUrl } = getVideoEmbed(url);
                      return embedUrl ? (
                        <div key={i} className="aspect-video rounded-lg overflow-hidden">
                          <iframe src={embedUrl} className="w-full h-full" allowFullScreen frameBorder="0" title={`Video ${i + 1}`} />
                        </div>
                      ) : (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                          <ExternalLink className="h-4 w-4 text-primary shrink-0" /><span className="text-sm truncate">{url}</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              {role === "performer" && ((profile.setups && profile.setups.length > 0) || profile.setupType) && (
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Setup Variations</h3>
                  {(profile.setups && profile.setups.length > 0) ? (
                    <div className="space-y-1.5">
                      {profile.setups.map((s, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                          <span className="text-sm font-medium">{s.name}</span>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-3 w-3" /> {s.headcount}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                      <span className="text-sm font-medium">{profile.setupType}</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-3 w-3" /> {profile.setupSize || "—"}</div>
                    </div>
                  )}
                </div>
              )}

              {role === "venue" && (
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3">Capacity</h3>
                  {profile.subVenues?.filter((sv: SubVenue) => sv.capacity).length ?? 0 > 0 ? (
                    <div className="space-y-2">
                      <p className="text-2xl font-bold font-display">
                        {(profile.subVenues?.filter((sv: SubVenue) => sv.capacity).reduce((sum: number, sv: SubVenue) => sum + (sv.capacity || 0), 0))?.toLocaleString() || "—"}
                        <span className="text-sm font-normal text-muted-foreground ml-1">total</span>
                      </p>
                      <div className="space-y-1 mt-2">
                        {profile.subVenues?.filter((sv: SubVenue) => sv.capacity).map((sv: SubVenue) => (
                          <div key={sv.id} className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{sv.name}</span>
                            <div className="flex items-center gap-2">
                              <span>{sv.capacity?.toLocaleString()}</span>
                              {(sv.sittingCapacity || sv.standingCapacity) && (
                                <span className="text-xs text-muted-foreground">
                                  {sv.sittingCapacity ? `${sv.sittingCapacity} sit` : ""}{sv.sittingCapacity && sv.standingCapacity ? " / " : ""}{sv.standingCapacity ? `${sv.standingCapacity} stand` : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-2xl font-bold font-display">{profile.capacity?.toLocaleString() || "—"}</p>
                  )}
                </div>
              )}

              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Location</h3>
                <p className="text-sm text-muted-foreground">
                  {role === "performer"
                    ? formatPerformerLocation(getPrimaryLocation(profile.locations))
                    : formatLocation(getPrimaryLocation(profile.locations)) || "No location set"}
                </p>
                {role !== "performer" && profile.address && <p className="text-xs text-muted-foreground mt-1">{profile.address}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PerformerBookingButtons({ operatorOwnerUid, slug, profileId }: { operatorOwnerUid: string; slug: string; profileId: string }) {
  const [requestOpen, setRequestOpen] = useState(false);

  return (
    <div className="flex gap-2">
      <Button onClick={() => setRequestOpen(true)} className="gap-1.5" disabled={!operatorOwnerUid}>
        <CalendarPlus className="h-4 w-4" /> Request Booking
      </Button>
      <RequestDateForm
        open={requestOpen}
        onOpenChange={setRequestOpen}
        targetProfileSlug={slug}
        targetProfileId={profileId}
        targetRole="performer"
        source="profile"
        operatorOwnerUid={operatorOwnerUid}
      />
    </div>
  );
}

function VenueRequestButtons({ operatorOwnerUid, slug, profileId }: { operatorOwnerUid: string; slug: string; profileId: string }) {
  const [requestOpen, setRequestOpen] = useState(false);

  return (
    <div className="flex gap-2">
      <Button onClick={() => setRequestOpen(true)} className="gap-1.5" disabled={!operatorOwnerUid}>
        <CalendarPlus className="h-4 w-4" /> Request a Date
      </Button>
      <RequestDateForm
        open={requestOpen}
        onOpenChange={setRequestOpen}
        targetProfileSlug={slug}
        targetProfileId={profileId}
        targetRole="venue"
        source="profile"
        operatorOwnerUid={operatorOwnerUid}
      />
    </div>
  );
}

function UpcomingEventsSection({ events, limit, role }: { events: AppEvent[]; limit: number; role: string }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? events : events.slice(0, limit);
  const hasMore = events.length > limit;

  return (
    <div className="px-8 pb-2 pt-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" /> Coming Events
        </h3>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming events scheduled.</p>
        ) : (
          <>
            <div className="space-y-3">
              {visible.map((evt) => {
                // On a venue's profile show the visiting performer; on a
                // performer's profile show the venue. Otherwise fall back to
                // the artist as the headline.
                const heading = role === "performer" ? evt.venue : evt.artist;
                const relatedProfileId = role === "performer" ? evt.hostProfileId : evt.performerProfileId;
                const timeBits: string[] = [];
                if (evt.doorTime) timeBits.push(`Doors Open ${evt.doorTime}`);
                if (evt.startTime) timeBits.push(`Show-time ${evt.startTime}`);
                return (
                  <div key={evt.id} className="flex items-center gap-3 rounded-lg border bg-background p-4 hover:bg-muted/50 transition-colors">
                    <PublicProfileBadge
                      name={heading}
                      profileId={relatedProfileId}
                      size="md"
                      withName={false}
                    />
                    <Link to="/event/$id" params={{ id: evt.id }} className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex flex-col items-center justify-center rounded-lg bg-primary/10 px-3 py-2 min-w-[60px]">
                        <span className="text-xs font-medium text-primary">{new Date(evt.date).toLocaleDateString("en-US", { month: "short" })}</span>
                        <span className="text-lg font-bold text-primary">{new Date(evt.date).getDate()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{heading}</p>
                        {timeBits.length > 0 && (
                          <p className="text-xs text-muted-foreground">{timeBits.join(" · ")}</p>
                        )}
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
            {hasMore && (
              <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)} className="w-full mt-3 gap-1.5 text-muted-foreground">
                {showAll ? <><ChevronUp className="h-4 w-4" /> Show less</> : <><ChevronDown className="h-4 w-4" /> shoWMe More ({events.length - limit} more)</>}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
