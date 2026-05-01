import { useState, useMemo } from "react";
import { Check, UserPlus } from "lucide-react";
import { ComboboxTrigger, ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/lib/user-context";

interface TeamMemberSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  teamMembers: TeamMember[];
  placeholder?: string;
  className?: string;
  onCreateMember?: (name: string) => void;
}

export default function TeamMemberSelect({ value, onValueChange, teamMembers, placeholder = "Assign to...", className, onCreateMember }: TeamMemberSelectProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return teamMembers;
    const q = search.toLowerCase();
    return teamMembers.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.roles.some(r => r.toLowerCase().includes(q))
    );
  }, [teamMembers, search]);

  const showCreate = search.trim().length > 0 && !teamMembers.some(m => m.name.toLowerCase() === search.trim().toLowerCase());

  return (
    <ComboboxTrigger
      displayValue={value}
      placeholder={placeholder}
      search={search}
      onSearchChange={setSearch}
      buttonClassName={cn("font-normal text-xs", className)}
      searchPlaceholder="Search name or role..."
    >
      <ComboboxOption
        selected={!value}
        onSelect={() => { onValueChange(""); setSearch(""); }}
      >
        {!value && <Check className="h-3 w-3" />}
        <span>Unassigned</span>
      </ComboboxOption>

      {filtered.map(m => (
        <ComboboxOption
          key={m.id}
          selected={value === m.name}
          onSelect={() => { onValueChange(m.name); setSearch(""); }}
        >
          {value === m.name && <Check className="h-3 w-3" />}
          <div className="flex-1 min-w-0">
            <span className="font-medium">{m.name}</span>
            {m.roles.length > 0 && (
              <span className="ml-1.5 text-muted-foreground">
                {m.roles.join(", ")}
              </span>
            )}
          </div>
        </ComboboxOption>
      ))}

      {filtered.length === 0 && !showCreate && (
        <p className="text-xs text-muted-foreground px-2 py-1">No matches</p>
      )}

      {showCreate && onCreateMember && (
        <ComboboxOption
          onSelect={() => {
            const name = search.trim();
            onCreateMember(name);
            onValueChange(name);
            setSearch("");
          }}
          className="text-primary font-medium border-t mt-1 pt-2"
        >
          <UserPlus className="h-3 w-3" />
          Create "{search.trim()}" as new team member
        </ComboboxOption>
      )}
    </ComboboxTrigger>
  );
}
