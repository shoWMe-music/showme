import { useCallback } from "react";
import { trySetPublished } from "@/lib/eventPermissions";
import { toast } from "@/hooks/use-toast";
import type { Event } from "@/lib/models";

type UpdateEventFn = (id: string, updates: Partial<Event>) => void;

/**
 * Returns a stable callback that toggles the published state of an event,
 * enforcing the publish gate and showing appropriate toasts.
 */
export function usePublishEventToggle(updateEvent: UpdateEventFn) {
  return useCallback(
    (event: Event) => {
      const next = !event.published;
      const gate = trySetPublished(event, next);
      if (!gate.ok) {
        toast({ title: "Cannot publish", description: gate.reason, variant: "destructive" });
        return;
      }
      updateEvent(event.id, { published: next });
      toast({
        title: next ? "Event published" : "Event unpublished",
        description: next
          ? "Your event is now visible to invited collaborators."
          : "Your event is now hidden.",
      });
    },
    [updateEvent],
  );
}
