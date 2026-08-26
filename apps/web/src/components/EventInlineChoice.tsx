import { Button, Select, type SelectOption, TextField } from "@showme/design-system";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./EventInlineField.module.css";
import { MiniMonthCalendar } from "./MiniMonthCalendar";
import { PickerPopoverPanel } from "./PickerPopoverPanel";
import { useDatePickerPopover } from "./useDatePickerPopover";

/**
 * The three fields on the Event Information card that finish with an explicit
 * Cancel / Save pair rather than on blur — the day, the room, the status.
 *
 * **The day is typed AND picked.** The room and the status are chosen from a
 * short list, so the list is the whole editor. A day is not: entering one far
 * from today, or copying one off an email, is several clicks through a calendar
 * and two keystrokes in a set of segments. So the day row is a real
 * `<input type="date">` — the typed segments the card used to have — with the
 * calendar already open beside it, and the two edit ONE draft: type a whole date
 * and the calendar moves to it, click a day and the segments show it.
 *
 * **Why these three do not commit on blur.** Clicking a day inside a calendar
 * is, in DOM terms, focus leaving the field: the panel is portalled to `<body>`
 * so that a modal cannot clip it. A field that commits on blur would therefore
 * either write before the operator had finished choosing, or throw away the
 * choice they just made — and which of the two you get depends on where the
 * browser happens to put focus. Explicit Cancel and Save removes the guess: the
 * picker stays up until the operator says which they meant.
 *
 * **Everything that is not Save is Cancel.** Escape, the Cancel button and a
 * click outside all land on the same path. A click outside is not an act of
 * confirmation — it is attention going somewhere else — and the value is one
 * click away from being chosen again, where a wrong save bumps the event's
 * version, writes a line into the history every participant reads, and can lose
 * a race with a co-host. There is no third, silent behaviour.
 *
 * **The card cannot move.** Both buttons live in the panel's own footer, which
 * is portalled and floats — the row keeps the value's exact footprint, open or
 * closed, and the eye finds the buttons where it is already looking. The date
 * input is held to the same 20px line box as every other value on the card
 * (`.choiceSlot input` in the stylesheet), so the row is 43px tall with the
 * segments in it exactly as it was with the words.
 */

/** The width every one of these pickers hangs off the row at — wide enough to
 * read a room's name or a status's sentence, whatever the row's value measures. */
const PANEL_WIDTH = 268;
/** A six-row month plus its header, and the actions under it. */
const CALENDAR_PANEL_HEIGHT = 380;

/** What `usePickerPopover` (and the calendar hook on top of it) hands back. Only
 * the parts this file drives are named. */
interface PickerPopoverShell {
  open: boolean;
  openPopover: (withKeyboard: boolean) => void;
}

/**
 * Hold a picker open for as long as its row is being edited, and treat every
 * way it can go away as Cancel.
 *
 * `usePickerPopover` already closes on Escape, on a click outside and on focus
 * landing elsewhere. Mapping its `open` back to the row's editor is what turns
 * those three into one rule instead of three behaviours.
 *
 * It opens WITH the keyboard: the operator clicked the row, not a caret
 * position, so the panel — not the value behind it — is what they are looking
 * at, and arrows and Enter work in it from the first keystroke.
 */
function useOpenWhileEditing(popover: PickerPopoverShell, onCancel: () => void) {
  const { open, openPopover } = popover;
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    // Layout, not passive: a passive effect paints one frame of the row with no
    // panel on it, which reads as a flicker on every open.
    openPopover(true);
  }, [openPopover]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (wasOpen.current) onCancel();
  }, [open, onCancel]);
}

interface EventInlineChoiceActionsProps {
  /** False until the choice differs from what is saved — the card's existing
   * "only if it moved" rule, said out loud instead of implied. */
  canSave: boolean;
  /** A sentence about what the field decides. In the panel, where it is read at
   * the moment it matters and covers nothing — this used to float over the row
   * below and sit on top of it. */
  hint?: ReactNode;
  /** What Save will ALSO do, when it does more than the field it is on. */
  consequence?: ReactNode;
  onCancel: () => void;
  onSave: () => void;
}

/**
 * The pair. Save is the affirmative action and wears the brand gradient; Cancel
 * is a quiet ghost button and never red — it means "leave it as it was", not
 * "delete", and a destructive-looking button next to a calendar is a lie about
 * what it does.
 */
function EventInlineChoiceActions({
  canSave,
  hint,
  consequence,
  onCancel,
  onSave,
}: EventInlineChoiceActionsProps) {
  return (
    <div className={styles.choiceActions}>
      {hint && <p className={styles.choiceHint}>{hint}</p>}
      {consequence && <p className={styles.choiceConsequence}>{consequence}</p>}
      <div className={styles.choiceButtons}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!canSave} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

export interface EventInlineDateChoiceProps {
  label: string;
  /** The DRAFT day, `yyyy-mm-dd`, or "" for none chosen. */
  value: string;
  canSave: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

/**
 * A day, chosen on a calendar that is already open.
 *
 * The value never leaves its `yyyy-mm-dd` string form: `MiniMonthCalendar` hands
 * back a local `dayKey`, it goes into the draft as-is and into the patch as-is.
 * No `Date` is built from it and `toISOString` is never called — an ISO date
 * parsed as an instant is UTC midnight, which reads back as the previous day
 * anywhere west of Greenwich (decisions #10).
 */
export function EventInlineDateChoice({
  label,
  value,
  canSave,
  onChange,
  onCancel,
  onSave,
}: EventInlineDateChoiceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // `panelHasMoreStops`: Tab out of the day grid must reach Cancel and Save
  // rather than closing the panel.
  const picker = useDatePickerPopover({ value, inputRef, panelHasMoreStops: true });
  useOpenWhileEditing(picker, onCancel);

  /**
   * Which of the two holds the keyboard — the calendar, or the segments.
   *
   * It starts on the calendar, because the row was clicked (or Entered), not a
   * caret position. It moves to the field the moment the field is focused, and
   * that hand-off is what makes typing possible at all: the calendar follows
   * whatever the field says, so without it every keystroke that completed a date
   * would drag DOM focus back onto the grid and out of the segments. Alt+Down —
   * the standard "open the picker" chord — hands it back.
   */
  const [calendarHoldsKeyboard, setCalendarHoldsKeyboard] = useState(true);

  return (
    <div ref={picker.wrapperRef} className={styles.choiceSlot}>
      <TextField
        ref={inputRef}
        type="date"
        aria-label={label}
        value={value}
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
        onFocus={() => setCalendarHoldsKeyboard(false)}
        onKeyDown={(keyEvent) => {
          if (keyEvent.altKey && keyEvent.key === "ArrowDown") setCalendarHoldsKeyboard(true);
          picker.handleInputKeyDown(keyEvent);
        }}
      />
      {picker.open && picker.anchorRect && (
        <PickerPopoverPanel
          anchor={picker.anchorRect}
          panelRef={picker.panelRef}
          width={PANEL_WIDTH}
          estimatedHeight={CALENDAR_PANEL_HEIGHT}
          label={`Choose a ${label.toLowerCase()}`}
          containTab
        >
          <MiniMonthCalendar
            month={picker.visibleMonth}
            selected={value || undefined}
            focusedDay={picker.focusedDay}
            autoFocusDay={calendarHoldsKeyboard}
            onSelect={(day) => {
              setCalendarHoldsKeyboard(true);
              onChange(day);
            }}
            onNavigate={picker.navigateMonth}
            onGridKeyDown={picker.handleGridKeyDown}
            style={{ boxShadow: "var(--shadow-lg)", background: "var(--surface)" }}
            footer={
              <div className={styles.choiceFooter}>
                <EventInlineChoiceActions canSave={canSave} onCancel={onCancel} onSave={onSave} />
              </div>
            }
          />
        </PickerPopoverPanel>
      )}
    </div>
  );
}

export interface EventInlineOptionChoiceProps {
  label: string;
  /** The choices. A `label` carrying a glyph is drawn in the menu AND on the
   * row, so the value reads the same open as closed. */
  options: SelectOption[];
  /** The DRAFT value. */
  value: string;
  placeholder: string;
  canSave: boolean;
  /** A sentence about what the list decides. */
  hint?: ReactNode;
  /** What Save will ALSO do, beside the button that will do it. */
  consequence?: ReactNode;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

/**
 * A value chosen from a short list — the room, and the status.
 *
 * A thin wrapper, and deliberately so: the design system's `Select` now takes a
 * controlled `open`, a `footer` and `closeOnSelect`, which is exactly this
 * pattern. Opening it is one gesture because the row's click IS the open; every
 * way the menu can go away arrives as `onOpenChange(false)`, which is the single
 * place Cancel is decided; and the choice is a draft until the footer says
 * otherwise.
 */
export function EventInlineOptionChoice({
  label,
  options,
  value,
  placeholder,
  canSave,
  hint,
  consequence,
  onChange,
  onCancel,
  onSave,
}: EventInlineOptionChoiceProps) {
  return (
    <div className={styles.choiceSlot}>
      <Select
        aria-label={label}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        // A room list is four rows and the statuses are seven: a search box over
        // either is furniture.
        searchable={false}
        // The row's editor IS the menu — it exists for exactly as long as the
        // field is open, so there is no closed state to manage.
        open
        onOpenChange={(next) => {
          if (!next) onCancel();
        }}
        closeOnSelect={false}
        menuWidth={PANEL_WIDTH}
        footer={
          <EventInlineChoiceActions
            canSave={canSave}
            hint={hint}
            consequence={consequence}
            onCancel={onCancel}
            onSave={onSave}
          />
        }
      />
    </div>
  );
}
