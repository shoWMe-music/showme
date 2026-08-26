import { Icon } from "@showme/design-system";
import styles from "./TimePickerControl.module.css";
import { MINUTE_STEP } from "./timePickerValue";
import { useTimePickerControl } from "./useTimePickerControl";

export interface TimePickerControlProps {
  /** `hh:mm`, or `""` when no time has been chosen yet. */
  value: string;
  onChange: (next: string) => void;
  /** Enter inside a segment. */
  onDone?: () => void;
  autoFocus?: boolean;
  /** Mono caption to the left of the segments. */
  label?: string;
}

/**
 * The wall-clock half of the in-app picker: two typeable segments, `19 : 07`,
 * in the app's mono face, with a pair of nudge buttons beside them.
 *
 * Why segments and not two dropdowns or Chrome's scrolling columns: a time here
 * is five characters the user usually already knows ("doors at 19:00"), so the
 * fastest control is one you can type into. Twenty-four and sixty options in a
 * `Select` turn that into two scroll hunts, and the design-system `Select`
 * portals its own listbox to `<body>`, which the picker's outside-click
 * dismissal would read as "outside" and close the whole panel. Chrome's
 * scrolling columns are the very thing this replaces, and they cost ~200px
 * under an already tall calendar.
 *
 * The control owns `hh:mm` and NOTHING ELSE — stepping past midnight wraps to
 * 00:00 and never touches the date. The calendar above it owns the day, so the
 * one thing that can shift a day is the one thing the user can see.
 */
export function TimePickerControl({
  value,
  onChange,
  onDone,
  autoFocus,
  label = "Time",
}: TimePickerControlProps) {
  const control = useTimePickerControl({ value, onChange, onDone, autoFocus });

  return (
    <div className={styles.control}>
      <span className={styles.caption}>{label}</span>
      <div className={styles.box}>
        <input
          ref={control.hourRef}
          className={styles.segment}
          value={control.hourText}
          onChange={(event) => control.typeSegment("hour", event.target.value)}
          onKeyDown={(event) => control.handleKeyDown("hour", event)}
          onBlur={control.endEditing}
          // Select on focus AND on click: a segment is always overwritten, never
          // appended to. Without the click half, clicking into a segment that is
          // already full leaves the caret at the end and the next digit lands
          // beyond it. (And no `maxLength`, which would silently swallow that
          // digit instead — the hook trims to the last two itself.)
          onFocus={(event) => event.target.select()}
          onClick={(event) => event.currentTarget.select()}
          inputMode="numeric"
          placeholder="--"
          aria-label="Hour"
          // A spinbutton is what this segment IS: it announces the range and the
          // current number, which a bare text input would not.
          role="spinbutton"
          aria-valuemin={0}
          aria-valuemax={23}
          aria-valuenow={control.isEmpty ? undefined : Number(control.hourText)}
        />
        <span className={styles.colon} aria-hidden="true">
          :
        </span>
        <input
          ref={control.minuteRef}
          className={styles.segment}
          value={control.minuteText}
          onChange={(event) => control.typeSegment("minute", event.target.value)}
          onKeyDown={(event) => control.handleKeyDown("minute", event)}
          onBlur={control.endEditing}
          onFocus={(event) => event.target.select()}
          onClick={(event) => event.currentTarget.select()}
          inputMode="numeric"
          placeholder="--"
          aria-label="Minute"
          role="spinbutton"
          aria-valuemin={0}
          aria-valuemax={59}
          aria-valuenow={control.isEmpty ? undefined : Number(control.minuteText)}
        />
      </div>
      <div className={styles.steppers}>
        <StepButton
          label={`${MINUTE_STEP} minutes later`}
          onStep={() => control.stepByMinutes(MINUTE_STEP)}
          rotated
        />
        <StepButton
          label={`${MINUTE_STEP} minutes earlier`}
          onStep={() => control.stepByMinutes(-MINUTE_STEP)}
        />
      </div>
    </div>
  );
}

function StepButton({
  label,
  onStep,
  rotated = false,
}: {
  label: string;
  onStep: () => void;
  rotated?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.stepper}
      aria-label={label}
      title={label}
      // Keep the caret in whichever segment the user was in: a nudge is an
      // adjustment, not a change of place.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onStep}
    >
      <Icon
        name="chevron-down"
        size={14}
        style={rotated ? { transform: "rotate(180deg)" } : undefined}
      />
    </button>
  );
}
