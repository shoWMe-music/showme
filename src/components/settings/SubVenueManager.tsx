import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import type { SubVenue, SharedProfile } from "@/lib/user-context";
import { OperatorRole } from "@/lib/user-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";

interface SubVenueManagerProps {
  profiles: Record<string, SharedProfile>;
  setProfiles: React.Dispatch<React.SetStateAction<Record<string, SharedProfile>>>;
  saveProfileToDb: (role: string, profile: SharedProfile) => void;
}

export function SubVenueManager({ profiles, setProfiles, saveProfileToDb }: SubVenueManagerProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<"room" | "stage" | "venue">("room");
  const [addName, setAddName] = useState("");
  const [addCapacity, setAddCapacity] = useState("");

  const venueProfile = profiles["venue"];
  const subVenues: SubVenue[] = venueProfile?.subVenues || [];

  const handleAdd = () => {
    if (!addName.trim()) return;
    if (addType === "venue") {
      const venueKey = `venue-${Date.now()}`;
      const newVenueProfile = {
        role: "venue" as OperatorRole,
        name: addName.trim(),
        location: "",
        bio: "",
        genres: [],
        socialLinks: [],
        capacity: parseInt(addCapacity) || 0,
        created: true,
        subVenues: [],
        slug: addName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        updatedAt: new Date().toISOString(),
      };
      setProfiles((prev) => ({ ...prev, [venueKey]: newVenueProfile }));
      saveProfileToDb(venueKey, newVenueProfile);
      toast({ title: "New venue created", description: `"${addName.trim()}" has been added as a new venue profile.` });
    } else {
      const newSub: SubVenue = { id: `SV-${Date.now()}`, name: addName.trim(), type: addType, capacity: parseInt(addCapacity) || undefined };
      const updated = { ...venueProfile, subVenues: [...subVenues, newSub] };
      setProfiles((prev) => ({ ...prev, venue: updated }));
      saveProfileToDb("venue", updated);
    }
    setAddName(""); setAddCapacity(""); setAddOpen(false);
  };

  const handleRemove = (id: string) => {
    const updated = { ...venueProfile, subVenues: subVenues.filter((s: SubVenue) => s.id !== id) };
    setProfiles((prev) => ({ ...prev, venue: updated }));
    saveProfileToDb("venue", updated);
  };

  return (
    <div className="mt-3 ml-7 space-y-2">
      {subVenues.length > 0 && (
        <div className="space-y-1">
          {subVenues.filter((sv: SubVenue) => sv.type !== "venue").map((sv: SubVenue) => (
            <div key={sv.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{sv.type}</Badge>
                <span className="font-medium">{sv.name}</span>
                {sv.capacity && <span className="text-xs text-muted-foreground">({sv.capacity} cap.)</span>}
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemove(sv.id)}>
                <X className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => { setAddType("room"); setAddOpen(true); }}>
          <Plus className="h-3 w-3 mr-1" /> Add Room/Stage
        </Button>
        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => { setAddType("venue"); setAddOpen(true); }}>
          <Plus className="h-3 w-3 mr-1" /> Add Venue
        </Button>
      </div>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add {addType === "venue" ? "New Venue" : "Room / Stage"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {addType !== "venue" && (
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
            )}
            {addType === "venue" && (
              <p className="text-xs text-muted-foreground">This will create a separate venue profile that you can manage independently.</p>
            )}
            <div><Label>Name</Label><Input value={addName} onChange={e => setAddName(e.target.value)} placeholder={addType === "venue" ? "New venue name" : "Room/Stage name"} className="mt-1" /></div>
            <div><Label>Capacity (optional)</Label><Input type="number" value={addCapacity} onChange={e => setAddCapacity(e.target.value)} placeholder="0" className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!addName.trim()}>
              {addType === "venue" ? "Create Venue" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
