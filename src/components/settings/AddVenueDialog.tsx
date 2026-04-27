import { useState } from "react";
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
  const { setProfiles, saveProfile: saveProfileToDb } = useUser();
  const [newVenueName, setNewVenueName] = useState("");
  const [newVenueCapacity, setNewVenueCapacity] = useState("");

  const handleCreate = () => {
    const venueKey = `venue-${Date.now()}`;
    const newVenueProfile = {
      role: "venue" as OperatorRole,
      name: newVenueName.trim(),
      location: "",
      bio: "",
      genres: [],
      socialLinks: [],
      capacity: parseInt(newVenueCapacity) || 0,
      created: true,
      subVenues: [],
      slug: newVenueName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      updatedAt: new Date().toISOString(),
    } satisfies SharedProfile;
    setProfiles((prev) => ({ ...prev, [venueKey]: newVenueProfile }));
    saveProfileToDb(venueKey, newVenueProfile);
    toast({ title: "New venue created", description: `"${newVenueName.trim()}" has been added.` });
    setNewVenueName("");
    setNewVenueCapacity("");
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!newVenueName.trim()} onClick={handleCreate}>Create Venue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
