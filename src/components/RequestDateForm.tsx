import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { insertPublicBookingRequest } from "@/lib/db";
import { useUser } from "@/lib/user-context";

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", SEK: "kr" };

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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [artistName, setArtistName] = useState("");
  const [wantedDate, setWantedDate] = useState(defaultDate || "");
  const [artistFee, setArtistFee] = useState("");
  const [note, setNote] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  const submitMutation = useMutation({
    mutationFn: (data: Parameters<typeof insertPublicBookingRequest>[0]) => insertPublicBookingRequest(data),
    onSuccess: () => {
      toast({ title: "Request submitted!", description: "Your booking request has been sent successfully." });
      onOpenChange(false);
      setName(""); setEmail(""); setPhone(""); setArtistName(""); setWantedDate(""); setArtistFee(""); setNote(""); setMusicUrl(""); setVideoUrl("");
      onSuccess?.();
    },
    onError: (err: any) => {
      toast({ title: "Failed to submit request", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (defaultDate) setWantedDate(defaultDate);
  }, [defaultDate]);

  const handleSubmit = () => {
    if (!name.trim() || !email.trim() || !artistName.trim() || !wantedDate.trim()) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    if (!operatorOwnerUid.trim()) {
      toast({ title: "Cannot send request", description: "Missing operator context. Open this form from a profile or availability link.", variant: "destructive" });
      return;
    }
    submitMutation.mutate({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      artist_name: artistName.trim(),
      wanted_date: wantedDate.trim(),
      artist_fee: artistFee ? parseFloat(artistFee) : null,
      note: note.trim(),
      music_url: musicUrl.trim(),
      video_url: videoUrl.trim(),
      target_profile_slug: targetProfileSlug,
      target_role: targetRole,
      source,
      owner_uid: operatorOwnerUid.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request a Date</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-1">
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
