import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { NewStageInput } from "@/components/create-event/NewStageInput";

export interface StageOption {
  name: string;
  capacity?: string;
}

interface StageRoomSelectProps {
  stages: StageOption[];
  value: string;
  onValueChange: (stage: string, capacity?: string) => void;
  /** Called when the user creates a brand-new stage via the inline input. */
  onStageCreated?: (name: string, capacity: string) => void;
  label?: string;
}

export function StageRoomSelect({ stages, value, onValueChange, onStageCreated, label = "Stage / Room" }: StageRoomSelectProps) {
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const hasStages = stages.length > 0;

  if ((!hasStages && !isCreatingNew)) {
    return (
      <div className="space-y-2">
        <Label className="text-xs">{label}</Label>
        <Input
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="e.g. Main Stage"
          className="h-9 text-xs"
        />
      </div>
    );
  }

  if (isCreatingNew) {
    return (
      <div className="space-y-2">
        <Label className="text-xs">{label}</Label>
        <NewStageInput
          onAdd={(name, cap) => {
            onStageCreated?.(name, cap);
            onValueChange(name, cap);
            setIsCreatingNew(false);
          }}
          onCancel={() => {
            setIsCreatingNew(false);
            onValueChange("");
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === "__new__") {
            setIsCreatingNew(true);
            onValueChange("");
          } else {
            const stage = stages.find(s => s.name === v);
            onValueChange(v, stage?.capacity);
          }
        }}
      >
        <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select or create" /></SelectTrigger>
        <SelectContent>
          {stages.map((s) => (
            <SelectItem key={s.name} value={s.name}>
              {s.name}{s.capacity ? ` (${s.capacity} cap.)` : ""}
            </SelectItem>
          ))}
          <SelectItem value="__new__">+ New stage/room</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
