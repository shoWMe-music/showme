import { Button, Card, SelectCard, TextField } from "@showme/design-system";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import styles from "./EventInlineField.module.css";
import { MiniMonthCalendar } from "./MiniMonthCalendar";
import { PickerPopoverPanel } from "./PickerPopoverPanel";
import { useDatePickerPopover } from "./useDatePickerPopover";
import { usePickerPopover } from "./usePickerPopover";

/**
 * The three fields on the Event Information card that are PICKED rather than
 * typed — the day, the room, the status — and the Cancel / Save pair they all
 * finish with.
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
 * closed, and the eye finds the buttons where it is already looking.
 */

/** The panel width every one of these pickers hangs off the row at. */
const PANEL_WIDTH = 268;
/** A six-row month plus its header, and the actions under it. */
const CALENDAR_PANEL_HEIGHT = 380;
/** Roughly one `SelectCard` with a description, for sizing the option panels. */
const OPTION_HEIGHT = 74;
/** Where the option list starts scrolling instead of growing — must agree with
 * `.choiceOptions` in the stylesheet, or the panel is placed for a height it
 * does not have and floats away from the row it belongs to. */
const OPTION_LIST_MAX_HEIGHT = 300;
/** The actions row, plus the card's own padding. */
const PANEL_CHROME_HEIGHT = 86;

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
  consequence,
  onCancel,
  onSave,
}: EventInlineChoiceActionsProps) {
  return (
    <div className={styles.choiceActions}>
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

interface ChoiceValueProps {
  /** The row's own label, so the readonly value is announced as this field. */
  label: string;
  /** The value as the row reads it — the same words, in the same place, as when
   * the row is closed. */
  text: string;
  /** What an empty field says instead. */
  placeholder: string;
}

/**
 * The value, while its picker is open.
 *
 * Read-only on purpose: the picker IS the editor, and a second, typeable copy of
 * the value would be a second source of truth for what is being saved. It stays
 * a real `<input>` because that is what anchors the popover and what focus comes
 * home to — and because it draws the value at exactly the size and position the
 * closed row drew it, which is what keeps the card still.
 */
function choiceValueProps({ label, text, placeholder }: ChoiceValueProps) {
  return {
    "aria-label": label,
    value: text,
    placeholder,
    readOnly: true,
    role: "combobox",
    "aria-haspopup": "dialog",
    "aria-expanded": true,
  } as const;
}

export interface EventInlineDateChoiceProps {
  label: string;
  /** The DRAFT day, `yyyy-mm-dd`, or "" for none chosen. */
  value: string;
  /** The draft as the card writes a date ("05 Dec"), or "" for none. */
  displayText: string;
  placeholder: string;
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
  displayText,
  placeholder,
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

  return (
    <div ref={picker.wrapperRef} className={styles.choiceSlot}>
      <TextField ref={inputRef} {...choiceValueProps({ label, text: displayText, placeholder })} />
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
            autoFocusDay={picker.keyboardActive}
            onSelect={onChange}
            onNavigate={picker.navigateMonth}
            onGridKeyDown={picker.handleGridKeyDown}
            style={{ boxShadow: "var(--shadow-lg)", background: "var(--surface)" }}
            footer={
              <EventInlineChoiceActions canSave={canSave} onCancel={onCancel} onSave={onSave} />
            }
          />
        </PickerPopoverPanel>
      )}
    </div>
  );
}

/** One option in a picked list: a room, or a status. */
export interface EventInlineOption {
  value: string;
  label: string;
  /** What choosing it means. Worth the height — this is where an operator finds
   * out that Confirmed is the status that counts against their plan. */
  description?: string;
  /** A glyph rendered before the label (the status dot). */
  glyph?: ReactNode;
}

export interface EventInlineOptionChoiceProps {
  label: string;
  options: EventInlineOption[];
  /** The DRAFT value. */
  value: string;
  displayText: string;
  /** The glyph the CLOSED row draws beside this value (the status dot), so the
   * open row reads exactly the same and the promoted rule spans the same width. */
  displayGlyph?: ReactNode;
  placeholder: string;
  canSave: boolean;
  /** A sentence about what the list decides, above it. */
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
 * `SelectCard` is the design system's single-choice option, so the list is one:
 * every option is a real button in DOM order, which means Tab walks the list and
 * then the actions without a line of keyboard code, and `PickerPopoverPanel`
 * wraps at the far end so focus never escapes to the bottom of the document.
 */
export function EventInlineOptionChoice({
  label,
  options,
  value,
  displayText,
  displayGlyph,
  placeholder,
  canSave,
  hint,
  consequence,
  onChange,
  onCancel,
  onSave,
}: EventInlineOptionChoiceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const picker = usePickerPopover({ inputRef });
  useOpenWhileEditing(picker, onCancel);

  const panelRef = picker.panelRef;
  useEffect(() => {
    // Open on the option the event is already on, so the keyboard starts where
    // the value is rather than at the top of a list. `aria-pressed` is how
    // `SelectCard` says "this is the chosen one".
    if (!picker.open) return;
    panelRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]')?.focus();
  }, [picker.open, panelRef]);

  return (
    <div ref={picker.wrapperRef} className={styles.choiceSlot}>
      {displayGlyph}
      <TextField ref={inputRef} {...choiceValueProps({ label, text: displayText, placeholder })} />
      {picker.open && picker.anchorRect && (
        <PickerPopoverPanel
          anchor={picker.anchorRect}
          panelRef={picker.panelRef}
          width={PANEL_WIDTH}
          estimatedHeight={
            Math.min(options.length * OPTION_HEIGHT, OPTION_LIST_MAX_HEIGHT) + PANEL_CHROME_HEIGHT
          }
          label={`Choose a ${label.toLowerCase()}`}
          containTab
        >
          <Card
            padding="md"
            style={{ boxShadow: "var(--shadow-lg)", background: "var(--surface)" }}
          >
            {hint && <p className={styles.choiceHint}>{hint}</p>}
            <div className={styles.choiceOptions}>
              {options.map((option) => (
                <SelectCard
                  key={option.value}
                  title={
                    option.glyph ? (
                      <span className={styles.choiceOptionTitle}>
                        {option.glyph}
                        {option.label}
                      </span>
                    ) : (
                      option.label
                    )
                  }
                  description={option.description}
                  selected={option.value === value}
                  onSelect={() => onChange(option.value)}
                />
              ))}
            </div>
            <EventInlineChoiceActions
              canSave={canSave}
              consequence={consequence}
              onCancel={onCancel}
              onSave={onSave}
            />
          </Card>
        </PickerPopoverPanel>
      )}
    </div>
  );
}
