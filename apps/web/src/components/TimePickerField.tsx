import { Button, Card, Icon, TextField, type TextFieldProps } from "@showme/design-system";
import { type MouseEvent, useRef } from "react";
import styles from "./DatePickerField.module.css";
import { PickerPopoverPanel } from "./PickerPopoverPanel";
import { TimePickerControl } from "./TimePickerControl";
import { commitFieldValue } from "./fieldValueCommit";
import { usePickerPopover } from "./usePickerPopover";

export type TimePickerFieldProps = Omit<TextFieldProps, "type">;

/** Room for the clock trigger; inline for the same reason as the date field's —
 * callers pass their own inline `style` and a `padding` shorthand would win. */
const TRIGGER_RESERVE_PX = 40;

const PANEL_WIDTH = 232;
const PANEL_HEIGHT = 122;

/**
 * An `hh:mm` field with the app's own popover instead of Chrome's time list.
 *
 * Same bargain as `DatePickerField`: the input stays a real `type="time"`, so
 * typing and form semantics are untouched, but the native dropdown — which is
 * browser chrome no CSS can reach — is replaced by a `TimePickerControl` on our
 * own surface. The value never leaves `hh:mm` string form; nothing here builds a
 * `Date`, so an offset-free wall clock stays offset-free.
 */
export function TimePickerField({
  onClick,
  onKeyDown,
  disabled,
  style,
  ...rest
}: TimePickerFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const picker = usePickerPopover({ inputRef });

  const rawValue = typeof rest.value === "string" ? rest.value : (inputRef.current?.value ?? "");
  // Postgres hands back `hh:mm:ss`; the control and the input both want `hh:mm`.
  const value = rawValue.slice(0, 5);

  const commit = (nextValue: string) => commitFieldValue(inputRef.current, nextValue);

  const handleClick = (event: MouseEvent<HTMLInputElement>) => {
    onClick?.(event);
    if (!disabled) picker.openPopover(false);
  };

  return (
    <div ref={picker.wrapperRef} className={styles.field}>
      <TextField
        {...rest}
        ref={inputRef}
        type="time"
        disabled={disabled}
        style={{ ...style, paddingRight: TRIGGER_RESERVE_PX }}
        onClick={handleClick}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          picker.handleInputKeyDown(event);
        }}
      />
      <button
        type="button"
        className={styles.trigger}
        disabled={disabled}
        aria-label={picker.open ? "Close time picker" : "Open time picker"}
        aria-expanded={picker.open}
        onClick={() => picker.togglePopover(true)}
      >
        <Icon name="clock" size={16} />
      </button>
      {picker.open && picker.anchorRect && (
        <PickerPopoverPanel
          anchor={picker.anchorRect}
          panelRef={picker.panelRef}
          width={PANEL_WIDTH}
          estimatedHeight={PANEL_HEIGHT}
          label="Choose a time"
          containTab
        >
          <Card
            padding="md"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              boxShadow: "var(--shadow-lg)",
              background: "var(--surface)",
            }}
          >
            <TimePickerControl
              value={value}
              onChange={commit}
              onDone={() => picker.closePopover(true)}
              // Opened from the keyboard, the caret goes straight to the hour:
              // unlike the date panel there is no grid to hold it first.
              autoFocus={picker.keyboardActive}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                paddingTop: 10,
                borderTop: "1px solid var(--border)",
              }}
            >
              <Button
                variant="ghost"
                onClick={() => {
                  commit("");
                  picker.closePopover(true);
                }}
              >
                Clear
              </Button>
              <Button variant="ghost" onClick={() => picker.closePopover(true)}>
                Done
              </Button>
            </div>
          </Card>
        </PickerPopoverPanel>
      )}
    </div>
  );
}
