import * as React from "react";
import { Input } from "@/components/ui/input";

interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: number | string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * A number input that clears "0" on focus so users can type freely,
 * and restores "0" on blur if left empty.
 */
const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onChange, onFocus, onBlur, ...props }, ref) => {
    const [displayValue, setDisplayValue] = React.useState(String(value));

    React.useEffect(() => {
      setDisplayValue(String(value));
    }, [value]);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      if (displayValue === "0" || displayValue === "0.00") {
        setDisplayValue("");
      }
      e.target.select();
      onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      if (displayValue.trim() === "") {
        setDisplayValue("0");
        // Fire onChange with 0
        const syntheticEvent = { ...e, target: { ...e.target, value: "0" } } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
      onBlur?.(e);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setDisplayValue(e.target.value);
      onChange(e);
    };

    return (
      <Input
        ref={ref}
        type="number"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...props}
      />
    );
  }
);
NumberInput.displayName = "NumberInput";

export default NumberInput;
