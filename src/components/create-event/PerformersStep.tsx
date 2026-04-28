import { useMemo } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type StageOption } from "@/components/StageRoomSelect";
import { PerformerFormFields, type PerformerFormValues } from "@/components/PerformerFormFields";
import type { PerformerEntry } from "./types";
import { toast } from "@/hooks/use-toast";

interface PerformersStepProps {
  performers: PerformerEntry[];
  createdStages: { name: string; capacity: string }[];
  setCreatedStages: React.Dispatch<React.SetStateAction<{ name: string; capacity: string }[]>>;
  addPerformer: () => void;
  removePerformer: (index: number) => void;
  updatePerformer: (index: number, updates: Partial<PerformerEntry>) => void;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  venueRooms?: { name: string; capacity?: number }[];
}

export function PerformersStep({
  performers, createdStages, setCreatedStages,
  addPerformer, removePerformer, updatePerformer,
  onBack, onSubmit, isSubmitting, venueRooms,
}: PerformersStepProps) {
  const submitDisabled = performers.length === 0 || performers.some(p => !p.artistName.trim());

  // Merge venue rooms, user-created stages, and sibling performers into a single options list
  const stageOptions: StageOption[] = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of venueRooms ?? []) {
      map.set(r.name, r.capacity ? String(r.capacity) : "");
    }
    for (const s of createdStages) {
      map.set(s.name, s.capacity);
    }
    for (const p of performers) {
      const name = p.stageRoom.trim();
      if (name && name !== "__new__" && !map.has(name)) {
        map.set(name, p.stageCapacity);
      }
    }
    return Array.from(map.entries()).map(([name, capacity]) => ({ name, capacity }));
  }, [venueRooms, createdStages, performers]);

  return (
    <div className="space-y-4 mt-2">
      <p className="text-sm text-muted-foreground">
        Add each performer with their individual deal. Each performer will have their own private deal, settlement, and communication channel.
      </p>

      {performers.map((perf, index) => (
        <div key={perf.id} className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Performer {index + 1}</h4>
            {performers.length > 1 && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removePerformer(index)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <PerformerFormFields
            values={perf}
            onChange={(updates) => {
              // Guard against selecting the same performer profile twice
              if (updates.performerProfileId && updates.performerProfileId.trim()) {
                const isDuplicate = performers.some(
                  (p, i) => i !== index && p.performerProfileId === updates.performerProfileId
                );
                if (isDuplicate) {
                  toast({ title: "Performer already added", variant: "destructive" });
                  return;
                }
              }
              updatePerformer(index, updates as Partial<PerformerEntry>);
              // Sync created stages when capacity changes
              if (updates.stageCapacity && perf.stageRoom.trim()) {
                setCreatedStages(prev => prev.map(s =>
                  s.name === perf.stageRoom.trim() ? { ...s, capacity: updates.stageCapacity! } : s
                ));
              }
            }}
            stageOptions={stageOptions}
            onStageCreated={(name, cap) => {
              if (!createdStages.some(s => s.name === name)) {
                setCreatedStages(prev => [...prev, { name, capacity: cap }]);
              }
            }}
          />
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={addPerformer} className="gap-1.5 w-full">
        <Plus className="h-3.5 w-3.5" /> Add Another Performer
      </Button>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onSubmit} disabled={submitDisabled || isSubmitting}>
          {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : "Create Multi-Performer Event"}
        </Button>
      </div>
    </div>
  );
}
