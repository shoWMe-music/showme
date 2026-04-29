import { useState } from "react";
import { MoreVertical, Archive, Ban, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { syncEventCollaboratorsFromUi } from "@/lib/db";
import { eventCollaboratorRoleLabels } from "@/lib/models";
import type { Event, EventCollaborator } from "@/lib/models";

interface EventActionsMenuProps {
  id: string;
  event: Event;
  collaborators: EventCollaborator[];
  setCollaborators: (c: EventCollaborator[]) => void;
  updateEvent: (id: string, updates: Partial<Event>) => void;
  promoteHoldsOnDate: (date: string, venue: string, room: string, rank: number) => void;
  onArchiveOpen: () => void;
  onDuplicate?: () => void;
}

export function EventActionsMenu({
  id, event, collaborators, setCollaborators, updateEvent, promoteHoldsOnDate, onArchiveOpen, onDuplicate,
}: EventActionsMenuProps) {
  const activeCollaborators = collaborators.filter(c => c.status !== "declined" && c.status !== "revoked");
  const [removeCollab, setRemoveCollab] = useState<EventCollaborator | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon"><MoreVertical className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {onDuplicate && (
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="h-4 w-4 mr-2" /> Duplicate Event
            </DropdownMenuItem>
          )}
          {event.eventStatus !== "cancelled" && (
            <DropdownMenuItem onClick={() => {
              if (event.eventStatus === "on_hold") promoteHoldsOnDate(event.date, event.venue, event.roomStage || "", event.holdRank || 1);
              updateEvent(id, { eventStatus: "cancelled" });
            }} className="text-destructive">
              <Ban className="h-4 w-4 mr-2" /> Cancel Event
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {(event.eventStatus === "concluded" || event.eventStatus === "cancelled") && (
            <DropdownMenuItem onClick={onArchiveOpen} className="text-destructive">
              <Archive className="h-4 w-4 mr-2" /> Archive Event
            </DropdownMenuItem>
          )}
          {activeCollaborators.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Remove Collaborator</div>
              {activeCollaborators.map(c => (
                <DropdownMenuItem
                  key={c.id}
                  className="text-destructive"
                  onClick={() => setRemoveCollab(c)}
                >
                  <Trash2 className="h-4 w-4 mr-2 shrink-0" /> {c.name}
                  <span className="ml-auto text-xs text-muted-foreground">{eventCollaboratorRoleLabels[c.eventRole]}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={!!removeCollab} onOpenChange={(o) => { if (!o) setRemoveCollab(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove collaborator?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to remove {removeCollab?.name || "a collaborator"}. They will lose access to this event. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              if (!removeCollab) return;
              const next = collaborators.filter(col => col.id !== removeCollab.id);
              setCollaborators(next);
              await syncEventCollaboratorsFromUi(id, event.hostProfileId || "", next);
              toast({ title: "Collaborator removed", description: `${removeCollab.name} has been removed from this event.` });
              setRemoveCollab(null);
            }}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
