import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: number | string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
}

/**
 * A number input that hides a numeric zero value when not focused, showing the
 * placeholder instead so the field reads as empty until the user types. While
 * focused the user can type freely; clearing the field on blur emits onChange
 * with "0" so the parent state stays numeric.
 */
const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onChange, onFocus, onBlur, placeholder = "0", className, ...props }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false);
    const [displayValue, setDisplayValue] = React.useState(String(value));

    React.useEffect(() => {
      setDisplayValue(String(value));
    }, [value]);

    const isNumericZero =
      (typeof value === "number" && value === 0) ||
      (typeof value === "string" && (value === "0" || value === "0.00" || value === ""));

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      if (displayValue === "0" || displayValue === "0.00") {
        setDisplayValue("");
      }
      e.target.select();
      onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      if (displayValue.trim() === "") {
        setDisplayValue("0");
        const syntheticEvent = { ...e, target: { ...e.target, value: "0" } } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
      onBlur?.(e);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setDisplayValue(e.target.value);
      onChange(e);
    };

    const renderedValue = !isFocused && isNumericZero ? "" : displayValue;

    return (
      <Input
        ref={ref}
        type="number"
        step="any"
        value={renderedValue}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          className,
        )}
        {...props}
      />
    );
  },
);
NumberInput.displayName = "NumberInput";

export default NumberInput;
