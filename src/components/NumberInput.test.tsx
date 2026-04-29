import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import NumberInput from "./NumberInput";

describe("NumberInput", () => {
  it("renders empty string and default placeholder when value=0 and not focused", () => {
    const { getByRole } = render(<NumberInput value={0} onChange={() => {}} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("0");
  });

  it("renders the value when value=42 and not focused", () => {
    const { getByRole } = render(<NumberInput value={42} onChange={() => {}} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("42");
  });

  it("uses a custom placeholder when value=0", () => {
    const { getByRole } = render(
      <NumberInput value={0} onChange={() => {}} placeholder="Amount" />,
    );
    const input = getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Amount");
  });

  it("clears the displayed 0, selects content on focus, and emits onChange when typing", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<NumberInput value={0} onChange={onChange} />);
    const input = getByRole("spinbutton") as HTMLInputElement;

    const selectSpy = vi.spyOn(input, "select");
    fireEvent.focus(input);
    expect(selectSpy).toHaveBeenCalled();
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).toHaveBeenCalled();
    const lastCallEvent = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCallEvent.target.value).toBe("5");
  });

  it("fires onChange with \"0\" when blurring an empty field", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<NumberInput value={0} onChange={onChange} />);
    const input = getByRole("spinbutton") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    onChange.mockClear();
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalled();
    const lastCallEvent = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCallEvent.target.value).toBe("0");
  });

  it("hides native browser spinner buttons via tailwind classes", () => {
    const { getByRole } = render(<NumberInput value={0} onChange={() => {}} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    expect(input.className).toContain("[&::-webkit-inner-spin-button]:appearance-none");
    expect(input.className).toContain("[&::-webkit-outer-spin-button]:appearance-none");
    expect(input.className).toContain("[appearance:textfield]");
  });
});
