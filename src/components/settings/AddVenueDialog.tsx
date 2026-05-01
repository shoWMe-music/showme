import { useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { useUser, OperatorRole, type SharedProfile } from "@/lib/user-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

interface AddVenueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddVenueDialog({ open, onOpenChange }: AddVenueDialogProps) {
  const { profiles, setProfiles, saveProfile: saveProfileToDb } = useUser();
  const [newVenueName, setNewVenueName] = useState("");
  const [newVenueCapacity, setNewVenueCapacity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Synchronous double-click guard (setSubmitting won't update the disabled
  // flag until the next render).
  const submittingRef = useRef(false);

  const handleCreate = () => {
    if (submittingRef.current) return;
    const trimmed = newVenueName.trim();
    if (!trimmed) return;

    const lower = trimmed.toLowerCase();
    const duplicate = Object.values(profiles).some(
      (p) =>
        p.created &&
        p.role === "venue" &&
        typeof p.name === "string" &&
        p.name.trim().toLowerCase() === lower,
    );
    if (duplicate) {
      toast({
        title: "Venue name already in use",
        description: `You already have a venue named "${trimmed}". Pick a different name.`,
        variant: "destructive",
      });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    const venueKey = `venue-${Date.now()}`;
    const newVenueProfile = {
      role: "venue" as OperatorRole,
      name: trimmed,
      location: "",
      bio: "",
      genres: [],
      socialLinks: [],
      capacity: parseInt(newVenueCapacity) || 0,
      created: true,
      subVenues: [],
      slug: trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      updatedAt: new Date().toISOString(),
    } satisfies SharedProfile;
    setProfiles((prev) => ({ ...prev, [venueKey]: newVenueProfile }));
    saveProfileToDb(venueKey, newVenueProfile);
    toast({ title: "New venue created", description: `"${trimmed}" has been added.` });
    setNewVenueName("");
    setNewVenueCapacity("");
    setSubmitting(false);
    submittingRef.current = false;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add New Venue</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">This will create a separate venue profile that you can manage independently.</p>
        <div className="space-y-3 py-2">
          <div><Label>Venue Name</Label><Input value={newVenueName} onChange={e => setNewVenueName(e.target.value)} placeholder="New venue name" className="mt-1" /></div>
          <div><Label>Capacity (optional)</Label><Input type="number" value={newVenueCapacity} onChange={e => setNewVenueCapacity(e.target.value)} placeholder="0" className="mt-1" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button disabled={!newVenueName.trim() || submitting} onClick={handleCreate}>
            {submitting ? "Creating…" : "Create Venue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
