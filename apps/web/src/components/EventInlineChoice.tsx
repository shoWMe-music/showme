import { Button, Select, type SelectOption, TextField } from "@showme/design-system";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "./EventInlineField.module.css";
import { MiniMonthCalendar } from "./MiniMonthCalendar";
import { PickerPopoverPanel, panelTabStops } from "./PickerPopoverPanel";
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
 * **Where the keyboard lands.** A picker with nothing to type opens WITH the
 * keyboard: the operator clicked the row, not a caret position, so the panel —
 * not the value behind it — is what they are looking at, and arrows and Enter
 * work in it from the first keystroke. A field that can also be TYPED passes its
 * input instead, and the keyboard starts in the segments: the calendar is open
 * either way and one click still opened it, so typing costs no second gesture —
 * which is the whole reason the segments came back. The calendar is one Tab (or
 * one click) away, and Alt+Down hands the keyboard to it.
 */
function useOpenWhileEditing(
  popover: PickerPopoverShell,
  onCancel: () => void,
  typedField?: RefObject<HTMLInputElement | null>,
) {
  const { open, openPopover } = popover;
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    // Layout, not passive: a passive effect paints one frame of the row with no
    // panel on it, which reads as a flicker on every open.
    openPopover(typedField === undefined);
    typedField?.current?.focus();
  }, [openPopover, typedField]);

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
  /** A sentence read BEFORE either button is pressed: what Save will ALSO do
   * (the room, which moves the capacity with it), or why Save is off (the day,
   * while its segments hold half a date). */
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

/** What the panel says instead of letting Save be pressed on half a date. */
const HALF_TYPED_NOTE = "Finish the date — day, month and year — or pick one on the calendar.";

/**
 * The day as it is TYPED, and the half-typed day, which is not a day at all.
 *
 * `<input type="date">` reports the same empty string for a field nobody has
 * touched and for one reading "12/09/____"; `validity.badInput` is the only
 * thing that tells them apart, and it is the only reason this hook exists.
 *
 * Both events matter, and for opposite reasons. Deleting one segment of a whole
 * date DOES fire `change`, with an empty value — read at face value that is
 * "the operator cleared the date", which it is not, and taking it at face value
 * moved the calendar to today's month the moment a backspace landed. Typing the
 * first digit INTO an empty field fires no `change` at all, because the value
 * was empty before and is empty still — so keyup is what notices that. What both
 * do is the same: nothing. The calendar stays on the month it was on, the draft
 * keeps the day it had, and **Save is off** — "2026-09-" names no day, and both
 * of the alternatives, guessing at the first of the month or quietly saving the
 * day that was there before, are a write nobody asked for.
 *
 * A date cleared segment by segment until every one of them is empty is a
 * different thing and is let through: `badInput` goes false, and clearing a date
 * is a change an operator is allowed to save.
 *
 * The rendered value goes empty with it, and that half is not cosmetic. The
 * input is controlled: if React went on rendering the old day while the segments
 * held part of a new one, the next re-render for any reason at all — a refetch
 * landing, a toast, a sibling field saving — would put the old day back over
 * what was being typed.
 */
function useTypedDay(value: string, onChange: (day: string) => void) {
  const [halfTyped, setHalfTyped] = useState(false);

  return {
    halfTyped,
    /** What the input renders: the draft, or nothing while it is being typed. */
    text: halfTyped ? "" : value,
    /** A whole date, an emptied one — or one segment short of either. */
    handleChange: (changeEvent: ChangeEvent<HTMLInputElement>) => {
      const input = changeEvent.currentTarget;
      if (input.value === "" && input.validity.badInput) {
        setHalfTyped(true);
        return;
      }
      setHalfTyped(false);
      onChange(input.value);
    },
    /** Every keystroke, including the ones that change nothing the input is
     * willing to report — typing into an empty field, which stays empty until
     * the last segment lands. */
    handleKeyUp: (keyEvent: KeyboardEvent<HTMLInputElement>) => {
      const input = keyEvent.currentTarget;
      setHalfTyped(input.value === "" && input.validity.badInput);
    },
    /** A day off the calendar replaces whatever the segments were holding. */
    chooseDay: (day: string) => {
      setHalfTyped(false);
      onChange(day);
    },
  };
}

/**
 * A zero-size focus catcher, one on each side of the segments.
 *
 * The calendar is portalled to the end of `<body>`, so a Tab off the last
 * segment would otherwise leave the editor entirely — which this card reads as
 * Cancel, and the date somebody had just typed would be gone without a word.
 * These catch that Tab and hand it to the panel instead, so the editor's Tab
 * cycle is the value, the calendar, Cancel, Save, and back to the value. It is
 * not a trap: Escape closes the editor from anywhere inside it.
 *
 * They take no space at all — absolutely positioned, zero by zero — so the row
 * they sit in cannot notice them. The lint rule below is about elements dropped
 * into the tab order with nothing to do in it; this one's whole job is to be
 * there, for the one frame it takes to pass focus on.
 */
function ChoiceTabHandoff({ onCatch }: { onCatch: () => void }) {
  // biome-ignore lint/a11y/noNoninteractiveTabindex: a focus guard, see above.
  return <span tabIndex={0} className={styles.tabHandoff} onFocus={onCatch} />;
}

/**
 * A day: typed in the segments, or picked on the calendar beside them.
 *
 * **Both, on one draft.** Type a whole date and the calendar moves to it (it
 * follows the field's value); click a day and the segments show it. Neither is
 * the "real" editor. A calendar alone is several clicks for a date eight months
 * out and hopeless for one being copied off an email; segments alone give you
 * nothing to look at when the question is which Friday.
 *
 * **The value never leaves its `yyyy-mm-dd` string form.** `MiniMonthCalendar`
 * hands back a local `dayKey`, a date input's `.value` is `yyyy-mm-dd` whatever
 * order its segments are drawn in, and both go into the draft and then into the
 * patch as-is. No `Date` is built from either and `toISOString` is never called
 * — an ISO date parsed as an instant is UTC midnight, which reads back as the
 * previous day anywhere west of Greenwich (decisions #10).
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
  useOpenWhileEditing(picker, onCancel, inputRef);
  const typed = useTypedDay(value, onChange);
  // Half a date is not a date, and Save says so by staying off.
  const savable = canSave && !typed.halfTyped;

  /**
   * Which of the two holds the keyboard — the calendar, or the segments.
   *
   * It starts in the segments (the field is what `useOpenWhileEditing` focused)
   * and follows the focus after that: whichever half was touched last is the one
   * that owns the arrows. Both directions are load-bearing. While the field has
   * it, the calendar must not pull DOM focus when it follows a typed date, or
   * every keystroke that changed the day would yank the caret out of the
   * segments. While the GRID has it, the calendar must pull focus, because the
   * arrow keys move a roving tabindex — the day the arrow moved to has to become
   * the focused element or the next arrow press is read by a button that is no
   * longer a tab stop, and focus falls to the document body.
   */
  const [calendarHoldsKeyboard, setCalendarHoldsKeyboard] = useState(false);

  const handOffTo = (edge: "first" | "last") => {
    const stops = panelTabStops(picker.panelRef.current);
    (edge === "first" ? stops.at(0) : stops.at(-1))?.focus();
  };

  return (
    <div
      ref={picker.wrapperRef}
      className={styles.choiceSlot}
      // Every control in this editor reports its focus HERE — React sends a
      // portal's events up the tree that rendered it, not the one it was
      // planted in — so one handler sees the field, the day grid, Cancel and
      // Save alike, and the answer to "who has the keyboard" is simply "who was
      // focused last".
      onFocus={(focusEvent) => setCalendarHoldsKeyboard(focusEvent.target !== inputRef.current)}
    >
      <ChoiceTabHandoff onCatch={() => handOffTo("last")} />
      <TextField
        ref={inputRef}
        type="date"
        aria-label={label}
        value={typed.text}
        onChange={typed.handleChange}
        onKeyUp={typed.handleKeyUp}
        onKeyDown={(keyEvent) => {
          if (keyEvent.altKey && keyEvent.key === "ArrowDown") setCalendarHoldsKeyboard(true);
          // Enter IS the Save button, for someone who has just typed the date
          // and has no reason to go looking for it. It does exactly what the
          // button does, and nothing when the button is disabled.
          if (keyEvent.key === "Enter") {
            keyEvent.preventDefault();
            if (savable) onSave();
            return;
          }
          picker.handleInputKeyDown(keyEvent);
        }}
      />
      <ChoiceTabHandoff onCatch={() => handOffTo("first")} />
      {picker.open && picker.anchorRect && (
        <PickerPopoverPanel
          anchor={picker.anchorRect}
          panelRef={picker.panelRef}
          width={PANEL_WIDTH}
          estimatedHeight={CALENDAR_PANEL_HEIGHT}
          label={`Choose a ${label.toLowerCase()}`}
          containTab
          fieldTabStop={inputRef}
        >
          <MiniMonthCalendar
            month={picker.visibleMonth}
            selected={value || undefined}
            focusedDay={picker.focusedDay}
            autoFocusDay={calendarHoldsKeyboard}
            onSelect={(day) => {
              setCalendarHoldsKeyboard(true);
              typed.chooseDay(day);
            }}
            onNavigate={picker.navigateMonth}
            onGridKeyDown={picker.handleGridKeyDown}
            style={{ boxShadow: "var(--shadow-lg)", background: "var(--surface)" }}
            footer={
              <div className={styles.choiceFooter}>
                <EventInlineChoiceActions
                  canSave={savable}
                  consequence={typed.halfTyped ? HALF_TYPED_NOTE : undefined}
                  onCancel={onCancel}
                  onSave={onSave}
                />
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
