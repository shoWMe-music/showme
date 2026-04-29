import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Users, X } from "lucide-react";
import type { TeamMember } from "@/lib/user-context";

interface RecipientsInputProps {
  recipientInput: string;
  recipients: string[];
  teamMembers: TeamMember[];
  onChangeInput: (value: string) => void;
  onAdd: () => void;
  onRemove: (email: string) => void;
  onAddTeamMember: (member: TeamMember) => void;
}

export function RecipientsInput({
  recipientInput,
  recipients,
  teamMembers,
  onChangeInput,
  onAdd,
  onRemove,
  onAddTeamMember,
}: RecipientsInputProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  // All active team members (including those without emails)
  const activeMembers = teamMembers.filter(m => m.status === "active" || !m.status);

  // Members with emails that haven't been added yet
  const availableMembers = activeMembers.filter(m =>
    m.email?.trim() &&
    !recipients.some(r => r === m.email.toLowerCase().trim())
  );

  // Members without emails (shown but disabled)
  const membersWithoutEmail = activeMembers.filter(m => !m.email?.trim());

  // Show "all added" only when every active member with an email has been added
  const allWithEmailAdded = activeMembers.filter(m => m.email?.trim()).length > 0 &&
    availableMembers.length === 0;

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recipients (optional — restricts access by email)</Label>
      <div className="flex gap-2">
        <Input
          value={recipientInput}
          onChange={(e) => onChangeInput(e.target.value)}
          placeholder="Enter email address..."
          className="text-xs h-8 flex-1"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
        />
        <Button size="sm" className="h-8 text-xs" onClick={onAdd} disabled={!recipientInput.trim()}>Add</Button>
        {teamMembers.length > 0 && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
                <Plus className="h-3 w-3" /> <Users className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="end" onOpenAutoFocus={(e) => e.preventDefault()}>
              <p className="text-xs font-medium text-muted-foreground mb-2">Add from team</p>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {availableMembers.map(m => (
                    <button
                      key={m.id}
                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                      onClick={() => onAddTeamMember(m)}
                    >
                      {m.name} <span className="text-xs text-muted-foreground">({m.email})</span>
                    </button>
                  ))}
                {membersWithoutEmail.map(m => (
                    <button
                      key={m.id}
                      className="w-full text-left px-2 py-1.5 text-sm rounded text-muted-foreground cursor-not-allowed opacity-50"
                      disabled
                    >
                      {m.name} <span className="text-xs">(no email)</span>
                    </button>
                  ))}
                {allWithEmailAdded && membersWithoutEmail.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-1">All active members added</p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {recipients.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {recipients.map(r => (
            <Badge key={r} variant="secondary" className="gap-1 text-xs">
              {r}
              <button onClick={() => onRemove(r)}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
