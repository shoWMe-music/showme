import { useState, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, X, Trash2, ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import { insertPublicBookingRequest } from "@/lib/db";
import { useUser } from "@/lib/user-context";
import {
  SENDER_TYPE_FOR_VENUE,
  SENDER_TYPE_FOR_PERFORMER,
  PERFORMER_TYPE,
  senderTypeForVenueLabels,
  senderTypeForPerformerLabels,
  performerTypeLabels,
} from "@/lib/enums";
import { GENRE_CATEGORIES, ALL_GENRES } from "@/lib/genres";
import type { SocialLink } from "@/lib/models";
import { cn } from "@/lib/utils";

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", SEK: "kr" };

const SOCIAL_PLATFORM_OPTIONS = [
  "Spotify",
  "Apple Music",
  "YouTube Music",
  "SoundCloud",
  "Bandcamp",
  "Tidal",
  "Deezer",
  "Instagram",
  "Facebook",
  "TikTok",
  "X",
  "YouTube",
  "Website",
];

export const REQUEST_FORM_GENRE_CAP = 5;

interface RequestDateFormProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetProfileSlug: string;
  targetRole: string;
  source: "profile" | "availability" | "widget";
  defaultDate?: string;
  /** Operator receiving the request (Firestore owner_uid). Required for unauthenticated submits. */
  operatorOwnerUid: string;
  onSuccess?: () => void;
}

export default function RequestDateForm({ open, onOpenChange, targetProfileSlug, targetRole, source, defaultDate, operatorOwnerUid, onSuccess }: RequestDateFormProps) {
  const { currentUser } = useUser();
  const currency = currentUser.currency || "EUR";
  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;
  const [senderType, setSenderType] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [artistName, setArtistName] = useState("");
  const [wantedDate, setWantedDate] = useState(defaultDate || "");
  const [artistFee, setArtistFee] = useState("");
  const [note, setNote] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [performerType, setPerformerType] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);

  // Sender-type vocabulary depends on whether we're requesting a venue or a performer.
  const senderTypeOptions = useMemo(() => {
    if (targetRole === "venue") {
      return SENDER_TYPE_FOR_VENUE.map((value) => ({ value, label: senderTypeForVenueLabels[value] }));
    }
    if (targetRole === "performer") {
      return SENDER_TYPE_FOR_PERFORMER.map((value) => ({ value, label: senderTypeForPerformerLabels[value] }));
    }
    return [];
  }, [targetRole]);

  // Performer-type field is only meaningful when a performer-side actor is
  // requesting a venue date — it tells the venue what kind of act to expect.
  const showPerformerType = targetRole === "venue";

  const submitMutation = useMutation({
    mutationFn: (data: Parameters<typeof insertPublicBookingRequest>[0]) => insertPublicBookingRequest(data),
    onSuccess: () => {
      toast({ title: "Request submitted!", description: "Your booking request has been sent successfully." });
      onOpenChange(false);
      setSenderType("");
      setName(""); setEmail(""); setPhone(""); setArtistName(""); setWantedDate(""); setArtistFee(""); setNote(""); setMusicUrl(""); setVideoUrl("");
      setGenres([]); setPerformerType(""); setWebsiteUrl(""); setSocialLinks([]);
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to submit request", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (defaultDate) setWantedDate(defaultDate);
  }, [defaultDate]);

  const handleSubmit = () => {
    if (!senderType.trim()) {
      toast({ title: "Please select who you are", variant: "destructive" });
      return;
    }
    if (!name.trim() || !email.trim() || !artistName.trim() || !wantedDate.trim()) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    if (!operatorOwnerUid.trim()) {
      toast({ title: "Cannot send request", description: "Missing operator context. Open this form from a profile or availability link.", variant: "destructive" });
      return;
    }
    // Drop empty social-link rows so they never reach Firestore.
    const cleanSocialLinks = socialLinks
      .map((l) => ({ platform: l.platform.trim(), url: l.url.trim() }))
      .filter((l) => l.url);
    submitMutation.mutate({
      sender_type: senderType.trim(),
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      artist_name: artistName.trim(),
      wanted_date: wantedDate.trim(),
      artist_fee: artistFee ? parseFloat(artistFee) : null,
      note: note.trim(),
      music_url: musicUrl.trim(),
      video_url: videoUrl.trim(),
      genres,
      performer_type: showPerformerType ? performerType.trim() : "",
      website_url: websiteUrl.trim(),
      social_links: cleanSocialLinks,
      target_profile_slug: targetProfileSlug,
      target_role: targetRole,
      source,
      owner_uid: operatorOwnerUid.trim(),
    });
  };

  const senderTypePromptLabel = targetRole === "venue" || targetRole === "performer"
    ? "I am a... *"
    : "Sender type *";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request a Date</DialogTitle>
        </DialogHeader>
        {!currentUser.id && (
          <div
            data-testid="request-form-auth-prompt"
            className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          >
            Already have an account?{" "}
            <a href="/login" className="font-medium text-primary underline-offset-2 hover:underline">Log in</a>
            {" · "}
            Want one?{" "}
            <a href="/signup" className="font-medium text-primary underline-offset-2 hover:underline">Sign up free</a>
          </div>
        )}
        <div className="space-y-2 py-1">
          {senderTypeOptions.length > 0 && (
            <div>
              <Label className="text-xs">{senderTypePromptLabel}</Label>
              <Select value={senderType} onValueChange={setSenderType}>
                <SelectTrigger className="mt-0.5 h-8 text-sm" aria-label="Sender type">
                  <SelectValue placeholder="Select who you are" />
                </SelectTrigger>
                <SelectContent>
                  {senderTypeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="mt-0.5 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Email *</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" className="mt-0.5 h-8 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Phone</Label>
              <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 234 567 890" className="mt-0.5 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Wanted Date *</Label>
              <Input value={wantedDate} onChange={e => setWantedDate(e.target.value)} placeholder="DD/MM/YY or MM/YY" className="mt-0.5 h-8 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Performer Name *</Label>
            <Input value={artistName} onChange={e => setArtistName(e.target.value)} placeholder="Artist or performer name" className="mt-0.5 h-8 text-sm" />
          </div>
          {showPerformerType && (
            <div>
              <Label className="text-xs">Performer Type</Label>
              <Select value={performerType} onValueChange={setPerformerType}>
                <SelectTrigger className="mt-0.5 h-8 text-sm" aria-label="Performer type">
                  <SelectValue placeholder="What kind of act?" />
                </SelectTrigger>
                <SelectContent>
                  {PERFORMER_TYPE.map((value) => (
                    <SelectItem key={value} value={value}>{performerTypeLabels[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <RequestFormGenrePicker genres={genres} onChange={setGenres} />
          <div>
            <Label className="text-xs">Performer Fee ({currency}, optional)</Label>
            <div className="relative mt-0.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{currencySymbol}</span>
              <Input type="number" value={artistFee} onChange={e => setArtistFee(e.target.value)} placeholder="e.g. 5000" className="h-8 text-sm pl-7" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Link to Music</Label>
              <Input value={musicUrl} onChange={e => setMusicUrl(e.target.value)} placeholder="Spotify, SoundCloud..." className="mt-0.5 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Link to Live Video</Label>
              <Input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="YouTube, Vimeo..." className="mt-0.5 h-8 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Website</Label>
            <Input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://..." className="mt-0.5 h-8 text-sm" />
          </div>
          <RequestFormSocialLinks links={socialLinks} onChange={setSocialLinks} />
          <div>
            <Label className="text-xs">Note</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Additional details..." className="mt-0.5 text-sm" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitMutation.isPending}>{submitMutation.isPending ? "Submitting..." : "Submit Request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Genre picker (capped at REQUEST_FORM_GENRE_CAP) ──
//
// Mirrors the ProfileEditPage chip/popover UX but caps selection at 5. The
// "Add genre" trigger disables once the cap is reached so the user gets a
// silent, predictable ceiling rather than a noisy validation error.

export function RequestFormGenrePicker({ genres, onChange }: {
  genres: string[];
  onChange: (genres: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const atCap = genres.length >= REQUEST_FORM_GENRE_CAP;

  const addGenre = (genre: string) => {
    if (atCap) {
      toast({ title: `Up to ${REQUEST_FORM_GENRE_CAP} genres`, variant: "destructive" });
      return;
    }
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
  const hasExactMatch = ALL_GENRES.some((g) => g.toLowerCase() === searchLower);

  return (
    <div>
      <Label className="text-xs">Genres ({genres.length}/{REQUEST_FORM_GENRE_CAP})</Label>
      <div className="mt-0.5 flex flex-wrap gap-1.5" data-testid="request-form-genres">
        {genres.map((g, i) => (
          <Badge key={g} variant="outline" className="text-xs gap-1">
            {g}
            <button type="button" aria-label={`Remove ${g}`} onClick={() => removeGenre(i)}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5"
              disabled={atCap}
              aria-label="Add genre"
            >
              <Plus className="h-3.5 w-3.5" /> Add genre
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
                      type="button"
                      className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded-sm"
                      onClick={() => addGenre(search.trim())}
                    >
                      Add &quot;{search.trim()}&quot; as custom genre
                    </button>
                  ) : (
                    "No genres found."
                  )}
                </CommandEmpty>
                {GENRE_CATEGORIES.map((cat) => {
                  const filtered = cat.genres.filter((g) => !searchLower || g.toLowerCase().includes(searchLower));
                  if (filtered.length === 0) return null;
                  return (
                    <CommandGroup key={cat.name} heading={cat.name}>
                      {filtered.map((genre) => {
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
                })}
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
    </div>
  );
}

// ── Social links (mirror of ProfileEditPage's editor) ──

function RequestFormSocialLinks({ links, onChange }: {
  links: SocialLink[];
  onChange: (links: SocialLink[]) => void;
}) {
  return (
    <div>
      <Label className="text-xs">Social Links</Label>
      <div className="mt-0.5 space-y-1.5" data-testid="request-form-social-links">
        {links.map((link, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded-lg border px-2 py-1">
            <Select
              value={link.platform}
              onValueChange={(v) => {
                const updated = [...links];
                updated[i] = { ...updated[i], platform: v };
                onChange(updated);
              }}
            >
              <SelectTrigger className="h-7 w-32 text-xs" aria-label={`Social link ${i + 1} platform`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOCIAL_PLATFORM_OPTIONS.map((pl) => (
                  <SelectItem key={pl} value={pl}>{pl}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={link.url}
              onChange={(e) => {
                const updated = [...links];
                updated[i] = { ...updated[i], url: e.target.value };
                onChange(updated);
              }}
              placeholder="https://..."
              className="h-7 flex-1 text-xs"
            />
            <button
              type="button"
              aria-label={`Remove social link ${i + 1}`}
              onClick={() => onChange(links.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-1.5 h-7 gap-1.5"
        onClick={() => onChange([...links, { platform: "Instagram", url: "" }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add link
      </Button>
    </div>
  );
}
