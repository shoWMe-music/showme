import { useState, useRef, useCallback } from "react";
import DocumentPreviewDialog from "@/components/DocumentPreviewDialog";
import { useParams, useNavigate } from "@tanstack/react-router";
import AppLayout from "@/components/AppLayout";
import { useUser, operatorRoleLabels, getBaseRole, type OperatorRole, type SharedProfile, type ProfileDocument, type ProfileLocation } from "@/lib/user-context";
import { Skeleton } from "@/components/ui/skeleton";
import { uploadUserBinary } from "@/lib/firebaseStorageUpload";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Camera, MapPin, Music, Globe, Image, Video, Users, Plus, X, Save, ArrowLeft, Trash2, ExternalLink, FileText, FileUp, ChevronsUpDown, Check, MoveVertical,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { AvatarUpload } from "@/components/AvatarUpload";
import AddressAutocomplete, { type AddressResult } from "@/components/AddressAutocomplete";
import VenueMap from "@/components/VenueMap";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { GENRE_CATEGORIES, VENUE_GENRE_SHORTLIST, ALL_GENRES } from "@/lib/genres";
import { cn } from "@/lib/utils";

function generateSlug(name: string, role: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || role;
}

export default function ProfileEditPage() {
  const { role } = useParams({ from: "/profiles/$role/edit" });
  const navigate = useNavigate();
  const { profiles, setProfiles, saveProfile: saveProfileToDb, loaded } = useUser();

  const typedRole = role as OperatorRole;
  const baseRole = getBaseRole(role || "");
  const profile = profiles[typedRole];

  if (!loaded) {
    return (
      <AppLayout>
        <div className="animate-fade-in space-y-6">
          {/* Back link */}
          <Skeleton className="h-4 w-28" />

          {/* Page header */}
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>

          {/* Banner + avatar card skeleton */}
          <div className="rounded-xl border bg-card shadow-sm">
            <Skeleton className="h-48 w-full rounded-t-xl" />
            <div className="p-6 flex items-center gap-6">
              <Skeleton className="h-24 w-24 rounded-full shrink-0 -mt-16" />
              <div className="flex-1 space-y-3">
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-12" />
                  <Skeleton className="h-9 w-full max-w-sm" />
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-9 w-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Bio card skeleton */}
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>

          {/* Genres card skeleton */}
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
            <Skeleton className="h-5 w-20" />
            <div className="flex gap-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-6 w-16 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-9 w-48" />
          </div>

          {/* Photos card skeleton */}
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-7 w-24" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="aspect-video w-full rounded-lg" />
              ))}
            </div>
          </div>

          {/* Save bar skeleton */}
          <div className="flex items-center justify-between pt-4 border-t">
            <Skeleton className="h-6 w-28" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!profile || !profile.created) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-lg text-muted-foreground">Profile not found</p>
          <Button variant="link" onClick={() => navigate({ to: "/profiles" })}>Back to profiles</Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ProfileEditor role={typedRole} profile={profile} setProfiles={setProfiles} saveProfileToDb={saveProfileToDb} onDone={() => navigate({ to: "/profiles" })} />
    </AppLayout>
  );
}

function ProfileEditor({ role, profile, setProfiles, saveProfileToDb, onDone }: {
  role: OperatorRole;
  profile: SharedProfile;
  setProfiles: React.Dispatch<React.SetStateAction<Record<string, SharedProfile>>>;
  saveProfileToDb: (role: string, profile: SharedProfile) => void;
  onDone: () => void;
}) {
  const baseRole = getBaseRole(role);
  const [data, setData] = useState({ ...profile });
  // spotifyUrl is now derived from socialLinks with platform "Spotify"
  const spotifyUrl = data.socialLinks?.find(l => l.platform.toLowerCase() === "spotify")?.url || "";
  const [newAmenity, setNewAmenity] = useState("");
  const [newDealType, setNewDealType] = useState("");
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [newDocName, setNewDocName] = useState("");
  const [newDocType, setNewDocType] = useState<ProfileDocument["type"]>("other");
  const [uploading, setUploading] = useState(false);
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; fileUrl: string } | null>(null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);

  const bannerRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);

  const handleFile = (ref: React.RefObject<HTMLInputElement | null>) => ref.current?.click();

  const updatePrimaryLocation = (field: "city" | "country" | "street" | "postcode", value: string) => {
    setData(p => {
      const loc = p.locations?.[0] || { id: "loc-primary", label: "Primary", city: "", country: "" };
      return { ...p, locations: [{ ...loc, [field]: value }, ...(p.locations?.slice(1) || [])] };
    });
  };

  const uploadProfileImage = useCallback(async (file: File, folder: string): Promise<string> => {
    const maxFileSize = 20 * 1024 * 1024;
    if (file.size > maxFileSize) throw new Error("Files must be smaller than 20MB.");
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const filePath = `profile-images/${role}/${folder}/${Date.now()}-${sanitizedName}`;
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    return uploadUserBinary(
      filePath,
      fileBytes,
      file.type || "image/jpeg",
    );
  }, [role]);

  const handleBanner = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const url = await uploadProfileImage(file, "banners");
      setData(p => ({ ...p, bannerUrl: url }));
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally { setUploading(false); }
  };
  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const url = await uploadProfileImage(file, "photos");
      setData(p => ({ ...p, photos: [...(p.photos || []), url] }));
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally { setUploading(false); }
  };

  const handleSave = async () => {
    setUploading(true);
    try {
      let avatarUrl = data.avatarUrl;
      if (pendingAvatarFile) {
        avatarUrl = await uploadProfileImage(pendingAvatarFile, "avatars");
      }
      const slug = generateSlug(data.name, role);
      const updatedProfile = { ...data, avatarUrl, spotifyUrl, slug, updatedAt: new Date().toISOString() } as typeof data & { spotifyUrl: string; slug: string; updatedAt: string };
      saveProfileToDb(role, updatedProfile);
      toast({ title: "Profile saved", description: "Your profile has been updated." });
      onDone();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const uploadProfileDocument = useCallback(async (file: File) => {
    const maxFileSize = 20 * 1024 * 1024;

    if (file.size > maxFileSize) {
      throw new Error("Files must be smaller than 20MB.");
    }

    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const filePath = `profile-documents/${role}/${Date.now()}-${sanitizedName}`;
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    return uploadUserBinary(
      filePath,
      fileBytes,
      file.type || "application/octet-stream",
    );
  }, [role]);

  const addVideoUrl = () => {
    if (!newVideoUrl.trim()) return;
    try { new URL(newVideoUrl); } catch { toast({ title: "Invalid URL", variant: "destructive" }); return; }
    setData(p => ({ ...p, videos: [...(p.videos || []), newVideoUrl.trim()] }));
    setNewVideoUrl("");
  };

  return (
    <div className="animate-fade-in">
      <button onClick={onDone} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to profiles
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Profile</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">{operatorRoleLabels[baseRole]}</Badge>
            {profile.id && (
              <span className="text-xs font-mono text-muted-foreground select-all">{profile.id}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <Switch
              checked={!!data.isPublic}
              onCheckedChange={v => v ? setConfirmPublic(true) : setData(p => ({ ...p, isPublic: false }))}
            />
            <span className="text-sm text-muted-foreground">{data.isPublic ? "Public" : "Private"}</span>
          </label>
          <Button variant="outline" onClick={onDone}>Cancel</Button>
          <Button onClick={handleSave} disabled={uploading} className="gap-1.5"><Save className="h-4 w-4" /> {uploading ? "Saving..." : "Save Profile"}</Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Banner */}
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="relative h-48 bg-gradient-to-r from-primary/20 to-primary/5 cursor-pointer group overflow-hidden rounded-t-xl" onClick={() => handleFile(bannerRef)}>
            {data.bannerUrl ? (
              <img
                src={data.bannerUrl}
                alt="Banner"
                className="w-full h-full object-cover"
                style={{
                  // bannerOffsetY field added on SharedProfile by Lane C; falls back to centered (50%)
                  objectPosition: `center ${typeof (data as { bannerOffsetY?: number }).bannerOffsetY === "number" ? (data as { bannerOffsetY?: number }).bannerOffsetY : 50}%`,
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full"><Camera className="h-10 w-10 text-muted-foreground group-hover:text-foreground transition-colors" /></div>
            )}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <span className="text-sm text-white opacity-0 group-hover:opacity-100 transition-opacity font-medium">Click to change banner</span>
            </div>
            <input ref={bannerRef} type="file" accept="image/*" className="hidden" onChange={handleBanner} />
          </div>
          {/* Banner controls: dimensions hint + Y-offset slider */}
          <div className="px-6 pt-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" type="button" className="gap-1.5 text-xs" onClick={() => handleFile(bannerRef)} disabled={uploading}>
                <Camera className="h-3.5 w-3.5" /> {data.bannerUrl ? "Change Banner" : "Upload Banner"}
              </Button>
              <span className="text-xs text-muted-foreground">Recommended: 1500×500</span>
            </div>
            {data.bannerUrl && (() => {
              const offsetY = typeof (data as { bannerOffsetY?: number }).bannerOffsetY === "number"
                ? (data as { bannerOffsetY?: number }).bannerOffsetY!
                : 50;
              return (
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <MoveVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <Label className="text-xs whitespace-nowrap shrink-0">Vertical position</Label>
                  <Slider
                    value={[offsetY]}
                    onValueChange={([v]) => setData(p => ({ ...p, bannerOffsetY: v } as typeof p))}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">
                    {offsetY}%
                  </span>
                </div>
              );
            })()}
          </div>
          <div className="p-6 flex items-center gap-6">
            <div className="shrink-0 -mt-16">
              <AvatarUpload
                preview={data.avatarUrl || null}
                fallback={data.name?.charAt(0) || "?"}
                size={96}
                onChange={(file, url) => {
                  setPendingAvatarFile(file);
                  setData(p => ({ ...p, avatarUrl: url }));
                }}
              />
            </div>
            <div className="flex-1 space-y-3">
              <div><Label>Name</Label><Input value={data.name} onChange={e => setData(p => ({ ...p, name: e.target.value }))} className="mt-1" /></div>
              <div>
                <Label>Location</Label>
                <AddressAutocomplete
                  value={baseRole === "performer"
                    ? [data.locations?.[0]?.city, data.locations?.[0]?.country].filter(Boolean).join(", ")
                    : [data.locations?.[0]?.street, data.locations?.[0]?.city, data.locations?.[0]?.country].filter(Boolean).join(", ")}
                  onChange={(_value: string, result?: AddressResult) => {
                    if (result) {
                      setData(p => {
                        const loc = p.locations?.[0] || { id: "loc-primary", label: "Primary", city: "", country: "" };
                        return {
                          ...p,
                          locations: [{
                            ...loc,
                            ...(baseRole !== "performer" && { street: result.street || loc.street || "" }),
                            city: result.city || loc.city || "",
                            country: result.country || loc.country || "",
                            ...(baseRole !== "performer" && { postcode: result.postcode || loc.postcode || "" }),
                            coordinates: result.coordinates || loc.coordinates,
                          }, ...(p.locations?.slice(1) || [])],
                        };
                      });
                    }
                  }}
                  placeholder={baseRole === "performer" ? "Search city..." : "Search address..."}
                  className="mt-1"
                />
                {baseRole !== "performer" && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <Input value={data.locations?.[0]?.street || ""} onChange={e => updatePrimaryLocation("street", e.target.value)} placeholder="Street" />
                    <Input value={data.locations?.[0]?.postcode || ""} onChange={e => updatePrimaryLocation("postcode", e.target.value)} placeholder="Postcode" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Input value={data.locations?.[0]?.city || ""} onChange={e => updatePrimaryLocation("city", e.target.value)} placeholder="City" />
                  <Input value={data.locations?.[0]?.country || ""} onChange={e => updatePrimaryLocation("country", e.target.value)} placeholder="Country" />
                </div>
              </div>
              {baseRole === "venue" && data.locations?.[0]?.coordinates && (
                <div className="mt-3 relative z-0">
                  <VenueMap lat={data.locations[0].coordinates.lat} lng={data.locations[0].coordinates.lng} className="w-full h-36 rounded-lg" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bio */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-3">{baseRole === "venue" ? "About" : "Bio"}</h3>
          <Textarea value={data.bio} onChange={e => setData(p => ({ ...p, bio: e.target.value }))} placeholder="Write your bio..." rows={4} />
        </div>

        {/* Genres */}
        <GenrePickerSection
          baseRole={baseRole}
          genres={data.genres || []}
          onChange={(genres) => setData(p => ({ ...p, genres }))}
        />

        {/* Music Embed (Performer) — derived from Social Links with platform "Spotify" */}

        {/* Setups (Performer) */}
        {baseRole === "performer" && (
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Setup Variations</h3>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => {
                setData(p => ({ ...p, setups: [...(p.setups || []), { name: "", headcount: 1 }] }));
              }}>
                <Plus className="h-3 w-3" /> Add Setup
              </Button>
            </div>
            {(!data.setups || data.setups.length === 0) ? (
              <p className="text-sm text-muted-foreground">No setups added yet. Add variations like "Solo", "Duo", "Full Band".</p>
            ) : (
              <div className="space-y-2">
                {data.setups.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                    <Input value={s.name} onChange={e => {
                      const updated = [...data.setups!];
                      updated[i] = { ...updated[i], name: e.target.value };
                      setData(p => ({ ...p, setups: updated }));
                    }} placeholder="Setup name (e.g. Full Band)" className="flex-1" />
                    <Input type="number" value={s.headcount ?? ""} onChange={e => {
                      const updated = [...data.setups!];
                      updated[i] = { ...updated[i], headcount: e.target.value === "" ? undefined : parseInt(e.target.value) || 1 };
                      setData(p => ({ ...p, setups: updated }));
                    }} onFocus={e => e.target.select()} onBlur={() => {
                      if (!s.headcount) {
                        const updated = [...data.setups!];
                        updated[i] = { ...updated[i], headcount: 1 };
                        setData(p => ({ ...p, setups: updated }));
                      }
                    }} min={1} className="w-24" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                      setData(p => ({ ...p, setups: p.setups?.filter((_, j) => j !== i) }));
                    }}>
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Capacity (Venue or Festival) — per room/stage */}
        {(baseRole === "venue" || baseRole === "festival") && (
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Capacity</h3>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => {
                const newSub = { id: `SV-${Date.now()}`, name: `Room ${(data.subVenues?.length || 0) + 1}`, type: "room" as const, capacity: 0 };
                setData(p => ({ ...p, subVenues: [...(p.subVenues || []), newSub] }));
              }}>
                <Plus className="h-3 w-3" /> Add Room / Stage
              </Button>
            </div>
            {(!data.subVenues || data.subVenues.length === 0) ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">No rooms or stages added yet. Add your first room/stage to set capacity.</p>
                <Input type="number" value={data.capacity || ""} onChange={e => setData(p => ({ ...p, capacity: parseInt(e.target.value) || 0 }))} placeholder="Total venue capacity" className="max-w-xs" />
              </div>
            ) : (
              <div className="space-y-3">
                {data.subVenues.map((sv, i) => (
                  <div key={sv.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <Select value={sv.type} onValueChange={(v) => {
                      const updated = [...data.subVenues!];
                      updated[i] = { ...updated[i], type: v as "room" | "stage" };
                      setData(p => ({ ...p, subVenues: updated }));
                    }}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="room">Room</SelectItem>
                        <SelectItem value="stage">Stage</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input value={sv.name} onChange={e => {
                      const updated = [...data.subVenues!];
                      updated[i] = { ...updated[i], name: e.target.value };
                      setData(p => ({ ...p, subVenues: updated }));
                    }} placeholder="Name" className="flex-1" />
                    <Input type="number" value={sv.capacity || ""} onChange={e => {
                      const updated = [...data.subVenues!];
                      updated[i] = { ...updated[i], capacity: parseInt(e.target.value) || 0 };
                      setData(p => ({ ...p, subVenues: updated }));
                    }} placeholder="Capacity" className="w-24" />
                    <Input type="number" value={sv.sittingCapacity || ""} onChange={e => {
                      const updated = [...data.subVenues!];
                      updated[i] = { ...updated[i], sittingCapacity: parseInt(e.target.value) || undefined };
                      setData(p => ({ ...p, subVenues: updated }));
                    }} placeholder="Sitting" className="w-20" />
                    <Input type="number" value={sv.standingCapacity || ""} onChange={e => {
                      const updated = [...data.subVenues!];
                      updated[i] = { ...updated[i], standingCapacity: parseInt(e.target.value) || undefined };
                      setData(p => ({ ...p, subVenues: updated }));
                    }} placeholder="Standing" className="w-20" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                      setData(p => ({ ...p, subVenues: p.subVenues?.filter((_, j) => j !== i) }));
                    }}>
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="flex gap-2 ml-8">
                    <Input value={sv.sittingNotes || ""} onChange={e => {
                      const updated = [...data.subVenues!];
                      updated[i] = { ...updated[i], sittingNotes: e.target.value };
                      setData(p => ({ ...p, subVenues: updated }));
                    }} placeholder="Sitting notes (e.g. theater-style)" className="text-xs h-7 flex-1" />
                    <Input value={sv.standingNotes || ""} onChange={e => {
                      const updated = [...data.subVenues!];
                      updated[i] = { ...updated[i], standingNotes: e.target.value };
                      setData(p => ({ ...p, subVenues: updated }));
                    }} placeholder="Standing notes (e.g. GA floor)" className="text-xs h-7 flex-1" />
                  </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <span className="text-sm font-medium text-muted-foreground">Total Capacity:</span>
                  <span className="text-sm font-bold">{(data.subVenues.reduce((sum, sv) => sum + (sv.capacity || 0), 0)).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Deal Types (Venue) */}
        {baseRole === "venue" && (
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold mb-3">Deal Types</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
              {["Door Split", "Guarantee + Door Split", "Rental", "Guarantee"].map(dt => {
                const selected = (data.dealTypes || []).includes(dt);
                return (
                  <label key={dt} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={selected} onCheckedChange={(c) => {
                      if (c) setData(p => ({ ...p, dealTypes: [...(p.dealTypes || []), dt] }));
                      else setData(p => ({ ...p, dealTypes: p.dealTypes?.filter(d => d !== dt) }));
                    }} />
                    {dt}
                  </label>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Input value={newDealType} onChange={e => setNewDealType(e.target.value)} placeholder="Add custom deal type" className="max-w-xs" onKeyDown={e => {
                if (e.key === "Enter" && newDealType.trim()) { setData(p => ({ ...p, dealTypes: [...(p.dealTypes || []), newDealType.trim()] })); setNewDealType(""); }
              }} />
              <Button variant="outline" size="sm" onClick={() => { if (newDealType.trim()) { setData(p => ({ ...p, dealTypes: [...(p.dealTypes || []), newDealType.trim()] })); setNewDealType(""); } }}><Plus className="h-4 w-4" /></Button>
            </div>
{(data.dealTypes || []).filter(dt => !["Door Split", "Guarantee + Door Split", "Rental", "Guarantee"].includes(dt)).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {(data.dealTypes || []).filter(dt => !["Door Split", "Guarantee + Door Split", "Rental", "Guarantee"].includes(dt)).map((dt, i) => (
                  <Badge key={i} variant="outline" className="text-xs gap-1">
                    {dt}
                    <button onClick={() => setData(p => ({ ...p, dealTypes: p.dealTypes?.filter(d => d !== dt) }))}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Performance Bonus (Venue — for split deals) */}
        {baseRole === "venue" && (data.dealTypes || []).some(dt => dt.toLowerCase().includes("split")) && (
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Performance Bonus Thresholds</h3>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => {
                setData(p => ({ ...p, performanceBonuses: [...(p.performanceBonuses || []), { ticketThreshold: 0, bonusAmount: 0, bonusType: "flat" as const }] }));
              }}>
                <Plus className="h-3 w-3" /> Add Threshold
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Define bonus tiers for performers when ticket sales exceed thresholds.</p>
            {(!data.performanceBonuses || data.performanceBonuses.length === 0) ? (
              <p className="text-sm text-muted-foreground">No bonus thresholds defined.</p>
            ) : (
              <div className="space-y-2">
                {data.performanceBonuses.map((b, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="flex items-center gap-1">
                      <Label className="text-xs whitespace-nowrap">Tickets &ge;</Label>
                      <Input type="number" value={b.ticketThreshold || ""} onChange={e => {
                        const updated = [...data.performanceBonuses!];
                        updated[i] = { ...updated[i], ticketThreshold: parseInt(e.target.value) || 0 };
                        setData(p => ({ ...p, performanceBonuses: updated }));
                      }} className="w-20" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs whitespace-nowrap">Bonus</Label>
                      <Input type="number" value={b.bonusAmount || ""} onChange={e => {
                        const updated = [...data.performanceBonuses!];
                        updated[i] = { ...updated[i], bonusAmount: parseFloat(e.target.value) || 0 };
                        setData(p => ({ ...p, performanceBonuses: updated }));
                      }} className="w-24" />
                    </div>
                    <Select value={b.bonusType} onValueChange={v => {
                      const updated = [...data.performanceBonuses!];
                      updated[i] = { ...updated[i], bonusType: v as "flat" | "percent" };
                      setData(p => ({ ...p, performanceBonuses: updated }));
                    }}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flat">Flat</SelectItem>
                        <SelectItem value="percent">%</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                      setData(p => ({ ...p, performanceBonuses: p.performanceBonuses?.filter((_, j) => j !== i) }));
                    }}>
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Amenities (Venue) */}
        {baseRole === "venue" && (() => {
const amenityKeys: import("@/lib/models").AmenityKey[] = ["backline", "partial_backline", "no_backline", "pa_system", "sound_engineer", "lighting", "light_engineer", "parking", "accommodation", "catering"];
          const amenityLabelsMap: Record<string, string> = { backline: "Full Backline", partial_backline: "Partial Backline", no_backline: "No Backline", pa_system: "PA System", sound_engineer: "Sound Engineer", lighting: "Lighting", light_engineer: "Light Engineer", parking: "Parking", accommodation: "Accommodation", catering: "Catering" };
          const selected = data.amenities || [];
          return (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-3">Amenities</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {amenityKeys.map(key => {
                  const isSelected = selected.includes(amenityLabelsMap[key]) || selected.includes(key);
                  return (
                    <div key={key}>
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <Checkbox checked={isSelected} onCheckedChange={(c) => {
                          if (c) setData(p => ({ ...p, amenities: [...(p.amenities || []), amenityLabelsMap[key]] }));
                          else setData(p => ({ ...p, amenities: p.amenities?.filter(a => a !== amenityLabelsMap[key] && a !== key) }));
                        }} />
                        {amenityLabelsMap[key]}
                      </label>
                      {key === "catering" && isSelected && (
                        <Textarea value={data.cateringNotes || ""} onChange={e => setData(p => ({ ...p, cateringNotes: e.target.value }))} placeholder="Catering details..." rows={2} className="mt-2 ml-6 text-xs" />
                      )}
                      {key === "accommodation" && isSelected && (
                        <Textarea value={data.accommodationNotes || ""} onChange={e => setData(p => ({ ...p, accommodationNotes: e.target.value }))} placeholder="Accommodation details..." rows={2} className="mt-2 ml-6 text-xs" />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-4">
                <Input value={newAmenity} onChange={e => setNewAmenity(e.target.value)} placeholder="Add custom amenity" className="max-w-xs" onKeyDown={e => {
                  if (e.key === "Enter" && newAmenity.trim()) { setData(p => ({ ...p, amenities: [...(p.amenities || []), newAmenity.trim()] })); setNewAmenity(""); }
                }} />
                <Button variant="outline" size="sm" onClick={() => { if (newAmenity.trim()) { setData(p => ({ ...p, amenities: [...(p.amenities || []), newAmenity.trim()] })); setNewAmenity(""); } }}><Plus className="h-4 w-4" /></Button>
              </div>
              {(data.amenities || []).filter(a => !Object.values(amenityLabelsMap).includes(a) && !amenityKeys.includes(a as import("@/lib/models").AmenityKey)).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(data.amenities || []).filter(a => !Object.values(amenityLabelsMap).includes(a) && !amenityKeys.includes(a as import("@/lib/models").AmenityKey)).map((am, i) => (
                    <Badge key={i} variant="outline" className="text-xs gap-1">
                      {am}
                      <button onClick={() => setData(p => ({ ...p, amenities: p.amenities?.filter(a => a !== am) }))}><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Photos */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2"><Image className="h-5 w-5 text-primary" /> Photos</h3>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => handleFile(photoRef)}><Plus className="h-3 w-3" /> Add Photo</Button>
            <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          </div>
          {(data.photos?.length || 0) > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {data.photos!.map((url, i) => (
                <div key={i} className="relative aspect-video rounded-lg overflow-hidden group">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => setData(p => ({ ...p, photos: p.photos?.filter((_, j) => j !== i) }))} className="absolute top-2 right-2 bg-black/50 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"><X className="h-3 w-3 text-white" /></button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No photos uploaded yet.</p>
          )}
        </div>

        {/* Videos (URL-based) */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Video className="h-5 w-5 text-primary" /> Videos</h3>
          <div className="space-y-2 mb-3">
            {(data.videos || []).map((url, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1 truncate">{url}</span>
                <button onClick={() => setData(p => ({ ...p, videos: p.videos?.filter((_, j) => j !== i) }))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={newVideoUrl} onChange={e => setNewVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=... or https://vimeo.com/..." className="flex-1" onKeyDown={e => { if (e.key === "Enter") addVideoUrl(); }} />
            <Button variant="outline" onClick={addVideoUrl} className="gap-1.5"><Plus className="h-4 w-4" /> Add Video</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Paste YouTube, Vimeo, or any video URL</p>
        </div>



        {/* Social Links */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><Globe className="h-5 w-5 text-primary" /> Social Links</h3>
          <div className="space-y-2 mb-3">
            {(data.socialLinks || []).map((link, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <Select value={link.platform} onValueChange={v => {
                  const updated = [...(data.socialLinks || [])];
                  updated[i] = { ...updated[i], platform: v };
                  setData(p => ({ ...p, socialLinks: updated }));
                }}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Spotify", "Apple Music", "YouTube Music", "SoundCloud", "Bandcamp", "Tidal", "Deezer", "Instagram", "Facebook", "TikTok", "X", "YouTube", "Website"].map(pl => (
                      <SelectItem key={pl} value={pl}>{pl}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={link.url} onChange={e => {
                  const updated = [...(data.socialLinks || [])];
                  updated[i] = { ...updated[i], url: e.target.value };
                  setData(p => ({ ...p, socialLinks: updated }));
                }} placeholder="https://..." className="flex-1" />
                <button onClick={() => setData(p => ({ ...p, socialLinks: (p.socialLinks || []).filter((_, j) => j !== i) }))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setData(p => ({ ...p, socialLinks: [...(p.socialLinks || []), { platform: "Spotify", url: "" }] }))}>
            <Plus className="h-4 w-4" /> Add Link
          </Button>
        </div>

        {/* Documents / Riders (Venue & Performer) */}
        {(baseRole === "venue" || baseRole === "performer") && (
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Documents & Riders</h3>
            <p className="text-xs text-muted-foreground mb-4">Upload tech riders, hospitality riders, or other documents. These can be shared automatically with collaborators when invited to an event.</p>

            {/* Existing documents */}
            <div className="space-y-2 mb-4">
              {(data.documents || []).map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {doc.type === "tech_rider" ? "Tech Rider" : doc.type === "hospitality_rider" ? "Hospitality Rider" : "Document"}
                  </Badge>
                  <span className="text-sm font-medium flex-1 truncate">{doc.name}</span>
                  <button onClick={() => setPreviewDoc({ fileName: doc.name, fileUrl: doc.url })} className="text-primary hover:underline text-xs flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> View
                  </button>
                  <button onClick={() => setData(p => ({ ...p, documents: (p.documents || []).filter(d => d.id !== doc.id) }))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></button>
                </div>
              ))}
              {(data.documents || []).length === 0 && (
                <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
              )}
            </div>

            {/* Add document */}
            <div className="rounded-lg border border-dashed p-4 space-y-3">
              <p className="text-sm font-medium">Add Document</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Type</Label>
                  <select
                    value={newDocType}
                    onChange={e => setNewDocType(e.target.value as ProfileDocument["type"])}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="tech_rider">Tech Rider</option>
                    <option value="hospitality_rider">Hospitality Rider</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Document Name</Label>
                  <Input value={newDocName} onChange={e => setNewDocName(e.target.value)} placeholder={newDocType === "tech_rider" ? "Tech Rider 2026" : newDocType === "hospitality_rider" ? "Hospitality Requirements" : "Document name..."} className="mt-1" />
                </div>
              </div>
              <div>
                <input
                  ref={documentRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                  className="hidden"
                  id="doc-upload"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const name = newDocName.trim() || file.name.replace(/\.[^/.]+$/, "");
                    setUploading(true);
                    try {
                      const publicUrl = await uploadProfileDocument(file);
                      const newDoc: ProfileDocument = {
                        id: `doc-${Date.now()}`,
                        name,
                        url: publicUrl,
                        type: newDocType,
                      };
                      setData(p => ({ ...p, documents: [...(p.documents || []), newDoc] }));
                      setNewDocName("");
                      toast({ title: "Document uploaded", description: `"${name}" has been attached.` });
                    } catch (err: any) {
                      toast({ title: "Upload failed", description: err.message || "Could not upload file.", variant: "destructive" });
                    } finally {
                      setUploading(false);
                      if (documentRef.current) documentRef.current.value = "";
                    }
                  }}
                />
                <Button variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => documentRef.current?.click()}>
                  <FileUp className="h-4 w-4" /> {uploading ? "Uploading..." : "Upload File"}
                </Button>
                <span className="text-xs text-muted-foreground ml-2">PDF, DOC, XLS, or images</span>
              </div>
            </div>
          </div>
        )}

        {/* Save bar */}
        <div className="flex items-center justify-between pt-4 border-t">
          <label className="flex items-center gap-2 cursor-pointer">
            <Switch
              checked={!!data.isPublic}
              onCheckedChange={v => v ? setConfirmPublic(true) : setData(p => ({ ...p, isPublic: false }))}
            />
            <span className="text-sm text-muted-foreground">{data.isPublic ? "Public" : "Private"}</span>
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDone}>Cancel</Button>
            <Button onClick={handleSave} disabled={uploading} className="gap-1.5"><Save className="h-4 w-4" /> {uploading ? "Saving..." : "Save Profile"}</Button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmPublic} onOpenChange={setConfirmPublic}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make profile public?</AlertDialogTitle>
            <AlertDialogDescription>
              Your profile will be visible to anyone with the link and may appear in search results. You can make it private again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setData(p => ({ ...p, isPublic: true })); setConfirmPublic(false); }}>
              Make Public
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DocumentPreviewDialog
        open={!!previewDoc}
        onOpenChange={(open) => { if (!open) setPreviewDoc(null); }}
        fileName={previewDoc?.fileName || ""}
        fileUrl={previewDoc?.fileUrl || ""}
      />
    </div>
  );
}

function GenrePickerSection({ baseRole, genres, onChange }: {
  baseRole: string;
  genres: string[];
  onChange: (genres: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const isVenue = baseRole === "venue";

  const addGenre = (genre: string) => {
    if (!genres.includes(genre)) {
      onChange([...genres, genre]);
    }
    setSearch("");
    setOpen(false);
  };

  const removeGenre = (index: number) => {
    onChange(genres.filter((_, i) => i !== index));
  };

  const searchLower = search.toLowerCase();
  const hasExactMatch = isVenue
    ? VENUE_GENRE_SHORTLIST.some(g => g.toLowerCase() === searchLower)
    : ALL_GENRES.some(g => g.toLowerCase() === searchLower);

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold mb-3">Genres</h3>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {genres.map((g, i) => (
          <Badge key={g} variant="outline" className="text-xs gap-1">
            {g}
            <button onClick={() => removeGenre(i)}><X className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> Add genre
            <ChevronsUpDown className="ml-1 h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search genres..." value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>
                {search.trim() ? (
                  <button
                    className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded-sm"
                    onClick={() => addGenre(search.trim())}
                  >
                    Add &quot;{search.trim()}&quot; as custom genre
                  </button>
                ) : (
                  "No genres found."
                )}
              </CommandEmpty>
              {isVenue ? (
                <CommandGroup heading="Venue Genres">
                  {VENUE_GENRE_SHORTLIST
                    .filter(g => !searchLower || g.toLowerCase().includes(searchLower))
                    .map(genre => {
                      const selected = genres.includes(genre);
                      return (
                        <CommandItem
                          key={genre}
                          value={genre}
                          onSelect={() => addGenre(genre)}
                          className={cn(selected && "opacity-50")}
                        >
                          <Check className={cn("mr-2 h-3.5 w-3.5", selected ? "opacity-100" : "opacity-0")} />
                          {genre}
                        </CommandItem>
                      );
                    })}
                </CommandGroup>
              ) : (
                GENRE_CATEGORIES
                  .map(cat => {
                    const filtered = cat.genres.filter(g => !searchLower || g.toLowerCase().includes(searchLower));
                    if (filtered.length === 0) return null;
                    return (
                      <CommandGroup key={cat.name} heading={cat.name}>
                        {filtered.map(genre => {
                          const selected = genres.includes(genre);
                          return (
                            <CommandItem
                              key={genre}
                              value={genre}
                              onSelect={() => addGenre(genre)}
                              className={cn(selected && "opacity-50")}
                            >
                              <Check className={cn("mr-2 h-3.5 w-3.5", selected ? "opacity-100" : "opacity-0")} />
                              {genre}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    );
                  })
                  .filter(Boolean)
              )}
              {search.trim() && !hasExactMatch && !genres.includes(search.trim()) && (
                <CommandGroup heading="Custom">
                  <CommandItem value={`custom-${search.trim()}`} onSelect={() => addGenre(search.trim())}>
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    Add &quot;{search.trim()}&quot;
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
