import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 6;

export interface PickerPopoverPanelProps {
  /** The field's rectangle, so the panel hangs off it like the native popup did. */
  anchor: DOMRect;
  panelRef: RefObject<HTMLDialogElement | null>;
  width: number;
  /** Roughly how tall the contents are. Only decides whether the panel opens
   * downwards, so a few pixels either way are harmless. */
  estimatedHeight: number;
  label: string;
  /**
   * Keep Tab inside the panel, wrapping at both ends.
   *
   * Needed as soon as the panel holds more than one control. It is portalled to
   * the END of `<body>`, so a Tab off its last control would land nowhere near
   * the field it belongs to — outside the modal, at the bottom of the document.
   * Wrapping is not a trap: the panel is a NON-modal dialog and Escape closes it
   * (and only it) from anywhere inside.
   */
  containTab?: boolean;
  /**
   * One control OUTSIDE the panel that belongs to its Tab cycle: the field the
   * panel is the editor FOR, when that field is one you can type into.
   *
   * Without it a contained panel is a closed loop, and a date you can type is
   * exactly the case where that is wrong — the segments would be the one part of
   * the editor a keyboard could never reach. With it the cycle is the editor's
   * own reading order: the value, then the panel that changes it, then the value
   * again.
   */
  fieldTabStop?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * The shared shell for the in-app date / time popovers: portalled to `<body>`,
 * positioned against the field in viewport coordinates, and stripped of the
 * user-agent dialog chrome so the card inside is the only thing on screen.
 *
 * Portalled because inside a modal the panel would otherwise be clipped by the
 * dialog's own scroll container.
 */
export function PickerPopoverPanel({
  anchor,
  panelRef,
  width,
  estimatedHeight,
  label,
  containTab = false,
  fieldTabStop,
  children,
}: PickerPopoverPanelProps) {
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(anchor.left, window.innerWidth - width - VIEWPORT_MARGIN),
  );
  const below = anchor.bottom + ANCHOR_GAP;
  const fitsBelow = below + estimatedHeight <= window.innerHeight - VIEWPORT_MARGIN;
  const top = fitsBelow
    ? below
    : Math.max(VIEWPORT_MARGIN, anchor.top - ANCHOR_GAP - estimatedHeight);

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (!containTab || event.key !== "Tab") return;
    const stops = panelTabStops(panelRef.current);
    if (stops.length === 0) return;
    const first = stops.at(0);
    const last = stops.at(-1);
    if (!first || !last) return;
    // Where the cycle turns around. A typeable field is part of it, so Tab off
    // either end goes back to the value rather than round the panel again.
    const field = fieldTabStop?.current ?? null;
    const active = document.activeElement;
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      (field ?? first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      (field ?? last).focus();
    }
  };

  return createPortal(
    <dialog
      ref={panelRef}
      // A NON-modal dialog (the `open` attribute, never `showModal()`): it names
      // the picker for assistive tech while leaving the field behind it live —
      // which is the point, since you can keep typing into it.
      open
      aria-label={label}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 1200,
        width,
        margin: 0,
        padding: 0,
        border: 0,
        background: "transparent",
        color: "inherit",
        overflow: "visible",
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}

/** The panel's focusable controls in DOM order. `tabIndex >= 0` is the filter
 * that makes this work with the calendar's roving tabindex: only the one day
 * that currently holds the roving focus is a stop, the other 41 are not.
 *
 * Exported because a field that hands Tab INTO the panel needs the same answer
 * the panel uses to hand it back — two readings of "which end is this" that
 * disagreed would drop focus somewhere neither of them meant. */
export function panelTabStops(panel: HTMLDialogElement | null): HTMLElement[] {
  if (!panel) return [];
  const candidates = panel.querySelectorAll<HTMLElement>("button, input, [tabindex]");
  return [...candidates].filter(
    (element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"),
  );
}
