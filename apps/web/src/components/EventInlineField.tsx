import { type FocusEvent, type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import styles from "./EventInlineField.module.css";

/** The slot classes each control is wrapped in, so the row can size a text
 * input, a picker's value and the venue picker to the SAME box without knowing
 * which is which. Exported because the card composes the controls. (The picked
 * fields wear `.choiceSlot`, which `EventInlineChoice` applies itself.) */
export const eventInlineSlot = {
  text: styles.textSlot,
  venue: styles.venueSlot,
};

/**
 * Flattens the one control that draws its own shell through inline styles (the
 * venue picker) down to the bare value, like every other inline control here.
 * The row's underline is the only chrome an open field wears.
 */
export const EVENT_INLINE_CONTROL_BOX = {
  height: 20,
  padding: 0,
  border: 0,
  borderRadius: 0,
  background: "transparent",
  fontSize: 13.5,
  gap: 6,
} as const;

export interface EventInlineFieldProps {
  /** The field's name, said the same way at rest, in the editor and to a
   * screen reader. */
  label: string;
  /** What the field currently says, as words. "" means nothing is set — the row
   * then draws an em dash and announces "not set", and stays just as clickable. */
  valueText: string;
  /** A richer rendering of the same value (a linked venue's building glyph).
   * The words in `valueText` remain what is announced. */
  valueNode?: ReactNode;
  /** What an EMPTY editable row says instead of the value — "No room set",
   * "Add a capacity". Never an em dash: a dash is not a thing you can act on,
   * and a row that renders as blank space is invisible to the person looking
   * for the field they have not filled in yet. */
  emptyLabel?: string;
  /** False for a row that is only ever read (Operator, Performer), and for a
   * caller who does not hold `event.edit`. */
  editable?: boolean;
  /**
   * This row's editor is a PICKER that has opened its own popover.
   *
   * Two things follow, and both are about the popover being portalled to
   * `<body>`: the row cannot see focus with `:focus-within`, so it is told to
   * wear the focused rule anyway; and the row must not pull focus back into the
   * value, because the picker has already put it where the operator is looking.
   */
  hasOpenPicker?: boolean;
  /** A short note in the row's OWN line box saying where its value came from —
   * "from Main Hall" on a capacity a room set. In the row's footprint, not
   * floating over the rows below: it is a fact about the value, not a warning,
   * and it may sit there a while. */
  sourceNote?: string;
  isEditing: boolean;
  /** Open the editor: a click, Enter or Space on the row. */
  onBegin: () => void;
  /** Escape, and anything else that means "leave it as it was". */
  onCancel: () => void;
  /** Enter, or focus leaving the editor. Only wired when `commitOnBlur`. */
  onCommit?: () => void;
  /**
   * Whether leaving the field is a way of finishing it.
   *
   * True for a TYPED field: you are done with it when you stop typing in it.
   * False for a CHOSEN one (a room) — those write the moment the choice is made
   * and close themselves, and their list is portalled out of this container, so
   * a blur out of it means "the menu just opened", not "the operator moved on".
   */
  commitOnBlur?: boolean;
  /** The control, already wrapped in one of the `eventInlineSlot` classes. */
  children?: ReactNode;
  /** A sentence about what the field decides. Floats over the rows below rather
   * than pushing them down — see the stylesheet. */
  hint?: ReactNode;
  /** Why the draft cannot be saved yet. The editor stays open while it is set,
   * and this replaces the hint. */
  error?: string | null;
  /** Float the hint above the row rather than below it — for a control that
   * opens its own list downwards and would otherwise be drawn over. */
  noteAbove?: boolean;
}

/**
 * One row of the Event Information card: a label and a value, where the value
 * is the control.
 *
 * **The row does not change shape when it opens.** The label stays where it is,
 * the control takes the value's place at the same height and against the same
 * right edge, and the help text floats rather than pushing the card around. A
 * card whose rows jump every time you touch one is not inline editing; it is a
 * form that appears where you clicked.
 *
 * **Keyboard first, because this is the part inline editing usually gets wrong.**
 * The rest state is a real `<button>`, not a div listening for clicks: it is in
 * the tab order, Enter and Space open it for free, and it announces itself as
 * "Event Name, Aurora Live, edit" — including when it is empty, where it says
 * the placeholder that says what is missing rather than an em dash. Escape closes
 * without saving.
 * When the editor closes, focus comes back to that button, but only if it was
 * still inside the editor when it went — never when the operator has already
 * clicked into another row.
 *
 * Presentational: what a commit means, and everything it writes, lives in
 * `useEventInlineFields`.
 */
export function EventInlineField({
  label,
  valueText,
  valueNode,
  emptyLabel = "Not set",
  editable = false,
  hasOpenPicker = false,
  sourceNote,
  isEditing,
  onBegin,
  onCancel,
  onCommit,
  commitOnBlur = true,
  children,
  hint,
  error,
  noteAbove = false,
}: EventInlineFieldProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controlRef = useRef<HTMLSpanElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    // The control must have the focus the row just gave up, or a keyboard user
    // opens a field they cannot reach and an Escape nobody is listening for.
    // Most controls carry `autoFocus`; some (the venue picker, which is a whole
    // combobox rather than a bare input) do not, so the row makes sure — and
    // leaves focus alone when the control has already claimed it.
    if (!isEditing || hasOpenPicker) return;
    const control = controlRef.current;
    if (control === null || control.contains(document.activeElement)) return;
    control.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
  }, [isEditing, hasOpenPicker]);

  useEffect(() => {
    // Closing puts focus back where the operator started, so a keyboard run
    // through the card never lands them back at the top of the page. The body
    // check is what tells "the control just unmounted under me" apart from "they
    // clicked straight into the next row", where stealing focus would be rude.
    if (wasEditing.current && !isEditing) {
      const active = document.activeElement;
      if (active === null || active === document.body) triggerRef.current?.focus();
    }
    wasEditing.current = isEditing;
  }, [isEditing]);

  if (isEditing) {
    const noteClass = noteAbove ? styles.noteAbove : "";
    const handleKeyDown = (keyEvent: KeyboardEvent<HTMLSpanElement>) => {
      if (keyEvent.key === "Escape") {
        // The pickers claim Escape in the capture phase while their popover is
        // up, so anything reaching here is the operator leaving the FIELD.
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        onCancel();
        return;
      }
      if (keyEvent.key === "Enter" && commitOnBlur) {
        keyEvent.preventDefault();
        onCommit?.();
      }
    };

    const handleBlur = (focusEvent: FocusEvent<HTMLSpanElement>) => {
      if (!commitOnBlur) return;
      // Focus moving WITHIN the control — into the venue picker's list, say — is
      // still editing this field.
      if (focusEvent.currentTarget.contains(focusEvent.relatedTarget)) return;
      // The date picker's panel is portalled to <body> as a non-modal <dialog>
      // (`PickerPopoverPanel`), so clicking a day reads as focus leaving this
      // control when it is the opposite: the operator is mid-choice. Closing
      // here would unmount the field and take the calendar with it.
      const landed = focusEvent.relatedTarget;
      if (landed instanceof Element && landed.closest("dialog") !== null) return;
      onCommit?.();
    };

    return (
      // `.editing` promotes the row's OWN bottom rule rather than drawing a
      // second line under the control: one element, one line, no 1px jump when
      // the states swap.
      <div className={`${styles.row} ${styles.editing} ${hasOpenPicker ? styles.pickerOpen : ""}`}>
        <span className={styles.label}>{label}</span>
        {/* A focus/keyboard SCOPE around the real control, not a control of its
            own — the field inside it is what is focusable and what is labelled. */}
        <span
          ref={controlRef}
          className={styles.controlSlot}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        >
          {children}
          {error ? (
            <p className={`${styles.note} ${noteClass} ${styles.noteError}`}>{error}</p>
          ) : hint ? (
            <p className={`${styles.note} ${noteClass}`}>{hint}</p>
          ) : null}
        </span>
      </div>
    );
  }

  const isEmpty = valueText === "";
  // A read-only row with nothing in it stays an em dash — there is nothing to
  // act on there, and "Not set" would invite a click that does nothing.
  const emptyShown = editable ? emptyLabel : "—";
  const shown = valueNode ?? (isEmpty ? emptyShown : valueText);
  const valueClass = isEmpty ? `${styles.value} ${styles.empty}` : styles.value;

  if (!editable) {
    return (
      <div className={styles.row}>
        <span className={styles.label}>{label}</span>
        <span className={valueClass}>{shown}</span>
      </div>
    );
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      className={`${styles.row} ${styles.trigger}`}
      onClick={onBegin}
      // The note is part of what this row SAYS, so it is part of what the row is
      // announced as — a live region inside a button would be read out of turn,
      // and the button's label is what a screen reader reaches for anyway.
      aria-label={`${label}, ${isEmpty ? emptyLabel : valueText}${
        sourceNote ? `, ${sourceNote}` : ""
      }, edit`}
    >
      <span className={styles.label} aria-hidden>
        {label}
      </span>
      {sourceNote && (
        <span className={styles.sourceNote} aria-hidden>
          {sourceNote}
        </span>
      )}
      <span className={valueClass} aria-hidden>
        {shown}
      </span>
    </button>
  );
}

/**
 * A value that carries a glyph — the venue's building, a status dot.
 *
 * `vertical-align: middle` and a pinned height, because an inline-flex box
 * sitting on the text baseline reserves the descender space under it and made
 * those rows a couple of pixels taller than the plain ones beside them. Written
 * once so the fix cannot be half-remembered on the next row that needs a glyph.
 */
export function EventInlineGlyphValue({
  glyph,
  children,
}: {
  glyph: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        verticalAlign: "middle",
        height: 20,
      }}
    >
      {glyph}
      {children}
    </span>
  );
}

/** The two-column label→value grid the rows sit in. */
export function EventInlineFieldGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
