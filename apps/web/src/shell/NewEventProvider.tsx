import { getGetApiV1EventsQueryKey } from "@showme/api-client";
import { Button, Icon } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, createContext, useContext, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { NewEventWizard } from "../components";
import type { NewEventInitialStatus } from "../components/NewEventWizard";

/**
 * One Create-Event wizard for the whole app. Any "New event" button — topbar,
 * Events, Calendar, empty states — calls `openNewEvent()` from this context, so
 * they all open the same modal (rendered once here, above the routed content).
 * `canCreateEvent` mirrors the API rule (only operators may create), so buttons
 * can hide themselves for non-operators.
 */
interface NewEventOptions {
  /** `YYYY-MM-DD` to prefill the wizard's Date field with, when the caller
   * already knows which day the user meant (e.g. the calendar's day popover). */
  initialDate?: string;
  /**
   * What the caller is creating, defaulting to the ordinary event. `on_hold`
   * asks for a HOLD: same wizard, plus a priority for the date, and the created
   * event really is moved to `status = 'on_hold'` (`components/HoldPlacement`).
   * A hold IS an event — that is why it is a mode of this wizard rather than a
   * screen of its own.
   */
  initialStatus?: NewEventInitialStatus;
}

interface NewEventContextValue {
  openNewEvent: (options?: NewEventOptions) => void;
  canCreateEvent: boolean;
}

const NewEventContext = createContext<NewEventContextValue | null>(null);

export function NewEventProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const canCreateEvent = session?.kind === "operator";
  const [open, setOpen] = useState(false);
  /**
   * Bumped on every open, and used as the wizard's `key`, so a click ALWAYS
   * produces a fresh modal. `setOpen(true)` alone is a no-op when `open` is
   * already true — which is invisible while the wizard is on screen, and
   * indistinguishable from a dead button if the state ever desyncs from what is
   * rendered. Remounting also guarantees the form starts empty rather than
   * showing the last attempt's half-filled fields.
   */
  const [openCount, setOpenCount] = useState(0);
  const [initialDate, setInitialDate] = useState<string | undefined>(undefined);
  const [initialStatus, setInitialStatus] = useState<NewEventInitialStatus>("draft");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const value = useMemo<NewEventContextValue>(
    () => ({
      openNewEvent: (options) => {
        // Set BEFORE the key bump: the remount below is what turns this into the
        // wizard's initial form state, so it has to be in place for that render.
        setInitialDate(options?.initialDate);
        // Same reason as the date: the wizard reads its mode as initial state on
        // the remount below, so a caller asking for a hold this time must not be
        // left with the previous caller's mode.
        setInitialStatus(options?.initialStatus ?? "draft");
        setOpenCount((count) => count + 1);
        setOpen(true);
      },
      canCreateEvent,
    }),
    [canCreateEvent],
  );

  return (
    <NewEventContext.Provider value={value}>
      {children}
      <NewEventWizard
        key={openCount}
        open={open}
        initialDate={initialDate}
        initialStatus={initialStatus}
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
    <Button variant="cta" leftIcon={<Icon name="plus" />} onClick={() => openNewEvent()}>
      New event
    </Button>
  );
}
