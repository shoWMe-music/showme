import { getGetApiV1EventsQueryKey } from "@showme/api-client";
import { Button, Icon } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, createContext, useContext, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { NewEventWizard } from "../components";

/**
 * One Create-Event wizard for the whole app. Any "New event" button — topbar,
 * Events, Calendar, empty states — calls `openNewEvent()` from this context, so
 * they all open the same modal (rendered once here, above the routed content).
 * `canCreateEvent` mirrors the API rule (only operators may create), so buttons
 * can hide themselves for non-operators.
 */
interface NewEventContextValue {
  openNewEvent: () => void;
  canCreateEvent: boolean;
}

const NewEventContext = createContext<NewEventContextValue | null>(null);

export function NewEventProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const canCreateEvent = session?.kind === "operator";
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const value = useMemo<NewEventContextValue>(
    () => ({ openNewEvent: () => setOpen(true), canCreateEvent }),
    [canCreateEvent],
  );

  return (
    <NewEventContext.Provider value={value}>
      {children}
      <NewEventWizard
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(id) => {
          setOpen(false);
          void queryClient.invalidateQueries({ queryKey: getGetApiV1EventsQueryKey() });
          navigate({ to: "/events/$eventId", params: { eventId: id } });
        }}
      />
    </NewEventContext.Provider>
  );
}

export function useNewEvent(): NewEventContextValue {
  const context = useContext(NewEventContext);
  if (!context) throw new Error("useNewEvent must be used within <NewEventProvider>");
  return context;
}

/** The topbar's CTA — rendered inside the provider so it can open the wizard. */
export function TopbarNewEventButton() {
  const { openNewEvent, canCreateEvent } = useNewEvent();
  if (!canCreateEvent) return null;
  return (
    <Button variant="cta" leftIcon={<Icon name="plus" />} onClick={openNewEvent}>
      New event
    </Button>
  );
}
