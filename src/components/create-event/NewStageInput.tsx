import { useState } from "react";
import { Plus, X } from "lucide-react";
import NumberInput from "@/components/NumberInput";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface NewStageInputProps {
  onAdd: (name: string, capacity: string) => void;
  onCancel: () => void;
}

export function NewStageInput({ onAdd, onCancel }: NewStageInputProps) {
  const [name, setName] = useState("");
  const [cap, setCap] = useState("");
  return (
    <div className="space-y-1.5">
      <Input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="New stage/room name"
        className="h-9 text-xs w-full"
        autoFocus
        onKeyDown={e => { if (e.key === "Enter" && name.trim()) onAdd(name.trim(), cap); }}
      />
      <div className="flex gap-1.5">
        <NumberInput
          value={cap}
          onChange={e => setCap(e.target.value)}
          placeholder="Capacity"
          className="h-9 text-xs flex-1"
        />
        <Button type="button" variant="outline" size="sm" className="h-9 text-xs shrink-0" disabled={!name.trim()} onClick={() => onAdd(name.trim(), cap)}>
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-9 text-xs shrink-0 px-2" onClick={onCancel}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
