import { Button } from "@showme/design-system";
import type { KeyboardEventHandler, RefObject } from "react";
import { createPortal } from "react-dom";
import { MiniMonthCalendar } from "./MiniMonthCalendar";
import { dayKey } from "./calendarGrid";

const PANEL_WIDTH = 268;
/** Enough for a 6-row month plus header and footer; only used to decide whether
 * the panel opens downwards, so a few pixels either way are harmless. */
const ESTIMATED_PANEL_HEIGHT = 330;
const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 6;

export interface DatePickerPopoverProps {
  /** The field's rectangle, so the panel hangs off it like the native popup did. */
  anchor: DOMRect;
  panelRef: RefObject<HTMLDialogElement | null>;
  /** Selected day, `yyyy-mm-dd` (empty when the field has no value yet). */
  selected: string;
  /** Any date inside the month on show. */
  month: Date;
  /** Roving-focus day, `yyyy-mm-dd`. */
  focusedDay: string;
  /** Whether the grid should hold DOM focus (keyboard route) or leave it in the
   * field (the user clicked in and may still be typing). */
  keyboardActive: boolean;
  onSelect: (dayKey: string) => void;
  onNavigate: (offset: number) => void;
  onGridKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onClear: () => void;
}

/**
 * The in-app replacement for the browser's native calendar popup: the same
 * `MiniMonthCalendar` the Requests rail uses, floated against the date field so
 * it inherits the app's surfaces, type and brand-red selection in both themes.
 * Purely presentational — `useDatePickerPopover` owns the state.
 */
export function DatePickerPopover({
  anchor,
  panelRef,
  selected,
  month,
  focusedDay,
  keyboardActive,
  onSelect,
  onNavigate,
  onGridKeyDown,
  onClear,
}: DatePickerPopoverProps) {
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(anchor.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN),
  );
  const below = anchor.bottom + ANCHOR_GAP;
  const fitsBelow = below + ESTIMATED_PANEL_HEIGHT <= window.innerHeight - VIEWPORT_MARGIN;
  const top = fitsBelow
    ? below
    : Math.max(VIEWPORT_MARGIN, anchor.top - ANCHOR_GAP - ESTIMATED_PANEL_HEIGHT);

  // Portalled to <body> and positioned in viewport coordinates: inside the modal
  // the panel would be clipped by the dialog's own scroll container.
  return createPortal(
    <dialog
      ref={panelRef}
      // A NON-modal dialog (the `open` attribute, never `showModal()`): it names
      // the calendar for assistive tech while leaving the field behind it live —
      // which is the point, since you can keep typing the date. The inline styles
      // strip the user-agent dialog chrome (centering, border, padding) so the
      // calendar card is the only thing on screen.
      open
      aria-label="Choose a date"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 1200,
        width: PANEL_WIDTH,
        margin: 0,
        padding: 0,
        border: 0,
        background: "transparent",
        color: "inherit",
        overflow: "visible",
      }}
    >
      <MiniMonthCalendar
        month={month}
        selected={selected || undefined}
        focusedDay={focusedDay}
        autoFocusDay={keyboardActive}
        onSelect={onSelect}
        onNavigate={onNavigate}
        onGridKeyDown={onGridKeyDown}
        style={{ boxShadow: "var(--shadow-lg)", background: "var(--surface)" }}
        footer={
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              paddingTop: 10,
              borderTop: "1px solid var(--border)",
            }}
          >
            <Button variant="ghost" onClick={onClear}>
              Clear
            </Button>
            <Button variant="ghost" onClick={() => onSelect(dayKey(new Date()))}>
              Today
            </Button>
          </div>
        }
      />
    </dialog>,
    document.body,
  );
}
