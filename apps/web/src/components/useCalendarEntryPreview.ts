import { type RefObject, useRef } from "react";
import { usePickerPopover } from "./usePickerPopover";

/**
 * Click-to-preview for one calendar entry: which button the panel hangs off, and
 * whether there is an event page to continue to.
 *
 * A hook rather than a prop on the chip because two different things draw an
 * entry — the month/week chip and the day agenda's wide row — and both need the
 * identical behaviour from their own markup.
 *
 * It leans on `usePickerPopover`, the app's one popover shell: portalled panel
 * anchored to a trigger, dismissal on outside pointerdown, and the capture-phase
 * Escape that closes the popover WITHOUT closing a surrounding modal. That hook
 * is typed for the date/time FIELDS it was written for, but the only things it
 * ever does to the ref are `getBoundingClientRect()` and `focus()`, which a
 * <button> has too — hence the one cast here, made in a single place so no call
 * site has to repeat it.
 */
export function useCalendarEntryPreview(
  eventId: string | undefined,
  onSelectEvent: ((eventId: string) => void) | undefined,
) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popover = usePickerPopover({
    inputRef: triggerRef as unknown as RefObject<HTMLInputElement | null>,
  });

  return {
    triggerRef,
    wrapperRef: popover.wrapperRef,
    panelRef: popover.panelRef,
    open: popover.open,
    anchorRect: popover.anchorRect,
    /** `false`: the panel pulls focus onto its own button when it has one, so the
     * keyboard flag the picker FIELDS use does not apply here. */
    toggle: () => popover.togglePopover(false),
    /** Undefined for a standalone calendar item — nowhere to go — which is what
     * keeps the preview's footer button off it. */
    openEvent:
      onSelectEvent && eventId
        ? () => {
            popover.closePopover(false);
            onSelectEvent(eventId);
          }
        : undefined,
  };
}
