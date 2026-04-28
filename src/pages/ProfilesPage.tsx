import { useRef, useState, useCallback, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { useUser, operatorRoleLabels, getBaseRole, formatLocation, getPrimaryLocation, type OperatorRole, type SharedProfile, type SubVenue } from "@/lib/user-context";
import { useEvents } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  MapPin, Music, Globe, Image, Video, Users, Eye, Volume2, Share2, Edit2, ExternalLink, Copy, Check, ChevronLeft, ChevronRight, X, Calendar, Plus, Trash2, Code, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { deleteProfile } from "@/lib/db";
import { Link } from "@tanstack/react-router";
import VenueMap from "@/components/VenueMap";
import { toast, copyToast } from "@/hooks/use-toast";
import { CreateProfileDialog } from "@/components/CreateProfileDialog";

import { EventStatusBadge } from "@/components/StatusBadge";
import type { Event as AppEvent, EventStatus } from "@/lib/models";

const PROFILE_START_ROLES: OperatorRole[] = ["venue", "promoter", "organizer", "performer", "festival"];

/* ─── Photo Gallery with Lightbox ─── */

function PhotoGallery({ photos }: { photos: string[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const goNext = useCallback(() => {
    setLightboxIndex(prev => prev !== null ? (prev + 1) % photos.length : null);
  }, [photos.length]);

  const goPrev = useCallback(() => {
    setLightboxIndex(prev => prev !== null ? (prev - 1 + photos.length) % photos.length : null);
  }, [photos.length]);

  if (photos.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Image className="h-5 w-5 text-primary" /> Photos</h3>
        <p className="text-sm text-muted-foreground">No photos uploaded yet.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Image className="h-5 w-5 text-primary" /> Photos</h3>
        <div className="grid grid-cols-2 gap-3">
          {photos.map((url, i) => (
            <button
              key={i}
              onClick={() => setLightboxIndex(i)}
              className="aspect-[16/10] rounded-lg overflow-hidden cursor-pointer group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      <Dialog open={lightboxIndex !== null} onOpenChange={() => setLightboxIndex(null)}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 bg-black/95 border-none overflow-hidden [&>button]:hidden">
          <div className="relative flex items-center justify-center w-full h-[85vh]">
            {lightboxIndex !== null && (
              <img
                src={photos[lightboxIndex]}
                alt={`Photo ${lightboxIndex + 1}`}
                className="max-w-full max-h-full object-contain"
              />
            )}

            {/* Close */}
            <button onClick={() => setLightboxIndex(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
              <X className="h-5 w-5" />
            </button>

            {/* Nav */}
            {photos.length > 1 && (
              <>
                <button onClick={goPrev} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button onClick={goNext} className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}

            {/* Counter */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
              {(lightboxIndex ?? 0) + 1} / {photos.length}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function generateSlug(name: string, role: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base || role;
}

function getVideoEmbed(url: string): { type: "youtube" | "vimeo" | "unknown"; embedUrl: string | null } {
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  if (ytMatch) return { type: "youtube", embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}` };
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return { type: "vimeo", embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}` };
  return { type: "unknown", embedUrl: null };
}

const LAST_PROFILE_KEY = "showme:lastSelectedProfile";

export default function ProfilesPage() {
  const { profiles, setProfiles, saveProfile: saveProfileToDb, loaded } = useUser();
  const createdProfiles = Object.entries(profiles).filter(([_, p]) => p.created) as [string, SharedProfile][];
  const [selectedRole, setSelectedRoleRaw] = useState<string>("");
  const [addProfileOpen, setAddProfileOpen] = useState(false);

  const setSelectedRole = useCallback((role: string) => {
    setSelectedRoleRaw(role);
    if (role) localStorage.setItem(LAST_PROFILE_KEY, role);
  }, []);

  // Once profiles load, pick the last-selected or first profile
  useEffect(() => {
    if (!loaded || createdProfiles.length === 0) return;
    setSelectedRoleRaw(prev => {
      if (prev && createdProfiles.some(([k]) => k === prev)) return prev;
      const saved = localStorage.getItem(LAST_PROFILE_KEY);
      if (saved && createdProfiles.some(([k]) => k === saved)) return saved;
      return createdProfiles[0][0];
    });
  }, [loaded, createdProfiles.map(([k]) => k).join(",")]);

  const handleDeleteProfile = useCallback((key: string) => {
    setProfiles(prev => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
    // Also remove from DB
    deleteProfile(key).catch(() => {});
    // Switch to another profile if available
    const remaining = createdProfiles.filter(([k]) => k !== key);
    setSelectedRole(remaining[0]?.[0] || "");
    toast({ title: "Profile deleted", description: "The profile has been removed." });
  }, [createdProfiles, setProfiles]);

  if (!loaded) {
    return (
      <AppLayout>
        <div className="animate-fade-in">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">My Profiles</h1>
            <p className="mt-1 text-muted-foreground">Manage your public-facing profiles for each role</p>
          </div>
          {/* Profile selector skeletons */}
          <div className="flex flex-wrap gap-3 mb-8">
            {[1, 2].map(i => (
              <div key={i} className="flex items-center gap-3 rounded-xl border px-4 py-3">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
          {/* Profile card skeleton */}
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <Skeleton className="h-64 w-full rounded-none" />
            <div className="px-8 -mt-20 relative z-10">
              <div className="flex items-start gap-6">
                <Skeleton className="h-40 w-40 rounded-full border-4 border-card shrink-0" />
                <div className="pt-[5.5rem] space-y-2 flex-1">
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            </div>
            <div className="p-8 pt-6 space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (createdProfiles.length === 0) {
    return (
      <AppLayout>
        <div className="animate-fade-in">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">My Profiles</h1>
            <p className="mt-1 text-muted-foreground">Manage your public-facing profiles for each role</p>
          </div>
          <div className="rounded-xl border bg-card p-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-semibold mb-2">No profiles yet</p>
            <p className="mx-auto mb-6 max-w-md text-sm text-muted-foreground">
              Choose how you show up on shoWMe (venue, performer, etc.), then add your public details.
            </p>
            <Button onClick={() => setAddProfileOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Create Your First Profile
            </Button>
          </div>
          <CreateProfileDialog
            open={addProfileOpen}
            onOpenChange={setAddProfileOpen}
            onCreated={(role) => setSelectedRole(role)}
          />
        </div>
      </AppLayout>
    );
  }

  const selectedProfile = createdProfiles.find(([role]) => role === selectedRole);

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">My Profiles</h1>
          <p className="mt-1 text-muted-foreground">Manage your public-facing profiles for each role</p>
        </div>

        {/* Profile Selector */}
        <div className="flex flex-wrap gap-3 mb-8">
          {createdProfiles.map(([role, profile]) => (
            <button
              key={role}
              onClick={() => setSelectedRole(role)}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 transition-all text-left",
                selectedRole === role
                  ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                  : "border-border bg-card hover:bg-muted/50"
              )}
            >
              <div className="h-10 w-10 rounded-full bg-muted overflow-hidden shrink-0">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm font-bold text-muted-foreground">
                    {profile.name?.charAt(0) || "?"}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold truncate">{profile.name}</p>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`h-2 w-2 rounded-full shrink-0 ${profile.isPublic ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs max-w-[180px] text-center">
                        {profile.isPublic
                          ? "Public — visible to anyone with the link"
                          : "Private — only visible to you"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Badge variant="secondary" className="text-[10px] mt-0.5">{operatorRoleLabels[getBaseRole(role)]}</Badge>
              </div>
            </button>
          ))}

          {/* Add Profile */}
          <button
            onClick={() => setAddProfileOpen(true)}
            className="flex items-center justify-center w-16 rounded-xl border border-dashed text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {selectedProfile && (
          <ProfileCard role={selectedProfile[0] as OperatorRole} profile={selectedProfile[1]} profileKey={selectedProfile[0]} profiles={profiles} setProfiles={setProfiles} saveProfileToDb={saveProfileToDb} onDelete={handleDeleteProfile} />
        )}

        <CreateProfileDialog
          open={addProfileOpen}
          onOpenChange={setAddProfileOpen}
          onCreated={(role) => setSelectedRole(role)}
        />
      </div>
    </AppLayout>
  );
}

/* ─── Profile Card (View-only) ─── */

function ProfileCard({ role, profile, profileKey, profiles, setProfiles, saveProfileToDb, onDelete }: {
  role: OperatorRole;
  profile: SharedProfile;
  profileKey: string;
  profiles: Record<string, SharedProfile>;
  setProfiles: React.Dispatch<React.SetStateAction<Record<string, SharedProfile>>>;
  saveProfileToDb: (role: string, profile: SharedProfile) => void;
  onDelete: (key: string) => void;
}) {
  const baseRole = getBaseRole(role);
  const [copied, setCopied] = useState(false);
  const events = useEvents();
  const slug = profile.slug || generateSlug(profile.name, role);
  const publicUrl = `${window.location.origin}/p/${slug}`;

  const today = new Date().toISOString().split("T")[0];
  const upcomingEvents = events.filter(
    (e) =>
      !e.archived &&
      e.date >= today &&
      e.eventStatus === "confirmed" &&
      (e.venue.toLowerCase().includes(profile.name.toLowerCase()) ||
        e.artist.toLowerCase().includes(profile.name.toLowerCase()) ||
        e.operator.toLowerCase().includes(profile.name.toLowerCase()))
  ).sort((a, b) => a.date.localeCompare(b.date));

  const getSpotifyEmbedUrl = (url: string) => {
    if (!url) return null;
    const match = url.match(/spotify\.com\/(album|playlist|track)\/([a-zA-Z0-9]+)/);
    if (match?.[1] && match?.[2]) return `https://open.spotify.com/embed/${match[1]}/${match[2]}`;
    return null;
  };

  const handleShareProfile = () => {
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    copyToast("Link copied!", "Public profile link copied to clipboard.");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Banner */}
      <div className="relative h-64 bg-gradient-to-r from-primary/20 to-primary/5">
        {profile.bannerUrl ? (
          <img src={profile.bannerUrl} alt="Banner" className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center h-full bg-gradient-to-br from-primary/10 via-primary/5 to-muted" />
        )}
      </div>

      {/* Avatar + Header */}
      <div className="px-8 -mt-20 relative z-10">
        <div className="flex items-start gap-6">
          <div className="relative h-40 w-40 rounded-full border-4 border-card bg-muted overflow-hidden shadow-lg shrink-0">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="flex items-center justify-center h-full text-4xl font-bold text-muted-foreground">
                {profile.name?.charAt(0) || "?"}
              </div>
            )}
          </div>

          <div className="pt-[5.5rem] flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-3xl font-bold tracking-tight">{profile.name}</h2>
              <Badge variant="secondary" className="text-xs shrink-0">{operatorRoleLabels[baseRole]}</Badge>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-2">
              {profile.genres?.map((g) => (
                <Badge key={g} variant="outline" className="text-xs">{g}</Badge>
              ))}
            </div>

            <div className="flex items-center gap-2 mt-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{formatLocation(getPrimaryLocation(profile.locations)) || "No location set"}</span>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {profile.socialLinks?.filter(l => l.url).map((link, i) => (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium hover:bg-muted/50 transition-colors">
                  <Globe className="h-3 w-3" /> {link.platform || link.url}
                </a>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="pt-[5.5rem] shrink-0 flex gap-2">
            {(baseRole === "performer" || baseRole === "artist") && (
              <>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Eye className="h-3.5 w-3.5" /> Tech Rider
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Eye className="h-3.5 w-3.5" /> Hospitality
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={handleShareProfile} className="gap-1.5 text-xs">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Share Profile"}
            </Button>
            <Link to="/profiles/$role/edit" params={{ role }}>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Edit2 className="h-3.5 w-3.5" /> Edit Profile
              </Button>
            </Link>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete profile "{profile.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove this profile and its public page. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(profileKey)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete Profile
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {/* Upcoming Events */}
      {upcomingEvents.length > 0 && <UpcomingEventsProfileSection events={upcomingEvents} baseRole={baseRole} />}

      {/* Content Grid */}
      <div className="p-8 pt-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Listen (Performer) */}
            {(baseRole === "performer" || baseRole === "artist") && (
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Music className="h-5 w-5 text-primary" /> Listen</h3>
                {getSpotifyEmbedUrl(profile.spotifyUrl || "") ? (
                  <iframe src={getSpotifyEmbedUrl(profile.spotifyUrl!)!} width="100%" height="352" frameBorder="0" allow="encrypted-media" title="Spotify" className="rounded-md" />
                ) : (
                  <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg p-8 flex items-center gap-6">
                    <div className="w-28 h-28 rounded-lg bg-muted flex items-center justify-center shrink-0"><Music className="h-12 w-12 text-muted-foreground" /></div>
                    <div><p className="font-semibold text-lg">{profile.name}</p><p className="text-sm text-muted-foreground mt-1">No Spotify URL linked yet.</p></div>
                  </div>
                )}
              </div>
            )}

            {/* Bio */}
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-3">{baseRole === "venue" ? "About" : "Bio"}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{profile.bio || "No bio added yet."}</p>
            </div>

            {/* Map under About/Bio */}
            {profile.coordinates && (
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" /> Location</h3>
                <VenueMap lat={profile.coordinates.lat} lng={profile.coordinates.lng} className="w-full h-48 rounded-lg" />
                {getPrimaryLocation(profile.locations) && <p className="text-sm text-muted-foreground mt-3">{formatLocation(getPrimaryLocation(profile.locations))}</p>}
              </div>
            )}

            {/* Photos Gallery */}
            <PhotoGallery photos={profile.photos || []} />

            {/* Videos */}
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
                        <ExternalLink className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-sm truncate">{url}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {(baseRole === "performer" || baseRole === "artist") && (
              <div className="rounded-xl border bg-card p-6 shadow-sm">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Setup Variations</h3>
                {profile.setupType ? (
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <span className="text-sm font-medium">{profile.setupType}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-3 w-3" /> {profile.setupSize || "—"}</div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No setup info added.</p>
                )}
              </div>
            )}

            {baseRole === "venue" && (
              <>
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3">Capacity</h3>
                  {(profile.subVenues && profile.subVenues.filter((sv: SubVenue) => sv.type === "room" || sv.type === "stage").length > 0) ? (
                    <div className="space-y-2">
                      <p className="text-2xl font-bold font-display">{(profile.subVenues?.filter((sv: SubVenue) => sv.capacity).reduce((sum: number, sv: SubVenue) => sum + (sv.capacity || 0), 0) || profile.capacity)?.toLocaleString() || "—"} <span className="text-sm font-normal text-muted-foreground">total</span></p>
                      <div className="space-y-1.5 mt-2">
                        {profile.subVenues.filter((sv: SubVenue) => sv.type === "room" || sv.type === "stage").map((sv) => (
                          <div key={sv.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">{sv.type}</Badge>
                              <span className="text-sm font-medium">{sv.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">{sv.capacity?.toLocaleString() || "—"}</span>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                                const updated = { ...profile, subVenues: (profile.subVenues || []).filter((s: SubVenue) => s.id !== sv.id) };
                                setProfiles(prev => ({ ...prev, [profileKey]: updated }));
                                saveProfileToDb(profileKey, updated);
                              }}>
                                <X className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-2xl font-bold font-display">{profile.capacity?.toLocaleString() || "—"}</p>
                  )}
                  <SubVenueInlineAdd profileKey={profileKey} profile={profile} setProfiles={setProfiles} saveProfileToDb={saveProfileToDb} />
                </div>
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3">Deal Types</h3>
                  <div className="space-y-1.5">
                    {(profile.dealTypes || []).map((dt, i) => (
                      <div key={i} className="flex items-center gap-2"><div className="w-2 h-2 bg-primary rounded-full" /><span className="text-sm">{dt}</span></div>
                    ))}
                    {(!profile.dealTypes || profile.dealTypes.length === 0) && <p className="text-xs text-muted-foreground">No deal types specified.</p>}
                  </div>
                </div>
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3">Amenities</h3>
                  <div className="space-y-1.5">
                    {(profile.amenities || []).map((am, i) => (
                      <div key={i} className="flex items-center gap-2"><div className="w-2 h-2 bg-[hsl(var(--success))] rounded-full" /><span className="text-sm">{am}</span></div>
                    ))}
                    {(!profile.amenities || profile.amenities.length === 0) && <p className="text-xs text-muted-foreground">No amenities listed.</p>}
                  </div>
                </div>
                {/* Embed Widget */}
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Code className="h-4 w-4 text-primary" /> Embed Booking Widget</h3>
                  <p className="text-xs text-muted-foreground mb-3">Copy this code to embed the "Request a Date" form on your website:</p>
                  <EmbedCodeBlock slug={profile.slug || ""} />
                </div>
              </>
            )}


          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Embed Code Block ─── */
function EmbedCodeBlock({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const widgetUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-date-widget?slug=${encodeURIComponent(slug)}&role=venue`;
  const embedCode = `<iframe src="${widgetUrl}" width="100%" height="600" frameborder="0" style="border:none;border-radius:8px;max-width:480px;"></iframe>`;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    copyToast("Copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Embed Code</Label>
        <textarea readOnly value={embedCode} className="mt-1 w-full h-20 text-xs font-mono bg-muted/50 border rounded-md p-3 resize-none" />
        <Button variant="outline" size="sm" className="mt-1.5 text-xs gap-1.5" onClick={() => handleCopy(embedCode)}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "Copied" : "Copy Code"}
        </Button>
      </div>
      <div>
        <Label className="text-xs">Direct Link</Label>
        <div className="flex gap-2 mt-1">
          <Input readOnly value={widgetUrl} className="text-xs" />
          <Button variant="outline" size="sm" onClick={() => handleCopy(widgetUrl)}>
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Inline Add Room/Stage for Venue Profiles ─── */
function SubVenueInlineAdd({ profileKey, profile, setProfiles, saveProfileToDb }: {
  profileKey: string;
  profile: SharedProfile;
  setProfiles: React.Dispatch<React.SetStateAction<Record<string, SharedProfile>>>;
  saveProfileToDb: (role: string, profile: SharedProfile) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<"room" | "stage">("room");
  const [addName, setAddName] = useState("");
  const [addCapacity, setAddCapacity] = useState("");

  const handleAdd = () => {
    if (!addName.trim()) return;
    const newSub: SubVenue = { id: `SV-${Date.now()}`, name: addName.trim(), type: addType, capacity: parseInt(addCapacity) || undefined };
    const updated = { ...profile, subVenues: [...(profile.subVenues || []), newSub] };
    setProfiles(prev => ({ ...prev, [profileKey]: updated }));
    saveProfileToDb(profileKey, updated);
    setAddName(""); setAddCapacity(""); setAddOpen(false);
    toast({ title: `${addType === "room" ? "Room" : "Stage"} added` });
  };

  return (
    <div className="mt-3">
      <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => setAddOpen(true)}>
        <Plus className="h-3 w-3" /> Add Room/Stage
      </Button>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Room / Stage</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Type</Label>
              <Select value={addType} onValueChange={v => setAddType(v as "room" | "stage")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="room">Room</SelectItem>
                  <SelectItem value="stage">Stage</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Name</Label><Input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Room/Stage name" className="mt-1" /></div>
            <div><Label>Capacity (optional)</Label><Input type="number" value={addCapacity} onChange={e => setAddCapacity(e.target.value)} placeholder="0" className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!addName.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UpcomingEventsProfileSection({ events, baseRole }: { events: AppEvent[]; baseRole: string }) {
  const [showAll, setShowAll] = useState(false);
  const limit = 6;
  const visible = showAll ? events : events.slice(0, limit);
  const hasMore = events.length > limit;

  return (
    <div className="px-8 pb-2 pt-4">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" /> Upcoming Events
        </h3>
        <div className="space-y-3">
          {visible.map((event) => {
            const d = new Date(event.date);
            const month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
            const day = d.getDate();
            return (
              <Link key={event.id} to="/event/$id" params={{ id: event.id }} className="flex items-center gap-4 rounded-lg border px-4 py-3 hover:bg-muted/50 transition-colors">
                <div className="flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-primary/10 shrink-0">
                  <span className="text-[10px] font-bold text-primary leading-none">{month}</span>
                  <span className="text-lg font-bold text-primary leading-tight">{day}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{event.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {baseRole === "venue" ? event.artist : event.venue}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
        {hasMore && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)} className="w-full mt-3 gap-1.5 text-muted-foreground">
            {showAll ? <><ChevronUp className="h-4 w-4" /> Show less</> : <><ChevronDown className="h-4 w-4" /> shoWMe More ({events.length - limit} more)</>}
          </Button>
        )}
      </div>
    </div>
  );
}
