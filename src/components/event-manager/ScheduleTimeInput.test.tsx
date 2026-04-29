import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScheduleTimeInput } from "./ScheduleTimeInput";

// ────────────────────────────────────────────────────────────────────────────
// Bug: editing the minutes of a schedule line required hold/drag or
// double-click because the trailing mouseUp after focus was clearing the
// onFocus selection of the default "00". Fix: select-all on focus AND
// preventDefault on mouseUp so the click doesn't reposition the caret.
// ────────────────────────────────────────────────────────────────────────────

describe("ScheduleTimeInput", () => {
  it("renders HH and MM split from the value prop", () => {
    render(<ScheduleTimeInput value="15:00" onChange={() => {}} />);
    expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe("15");
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe("00");
  });

  it("renders empty fields when value is empty", () => {
    render(<ScheduleTimeInput value="" onChange={() => {}} />);
    expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe("");
  });

  it("selects-all on focus on the minutes input", () => {
    render(<ScheduleTimeInput value="15:00" onChange={() => {}} />);
    const mm = screen.getByLabelText("Minutes") as HTMLInputElement;
    const selectSpy = vi.spyOn(mm, "select");
    fireEvent.focus(mm);
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it("prevents the default mouseUp so a single click keeps the selection", () => {
    render(<ScheduleTimeInput value="15:00" onChange={() => {}} />);
    const mm = screen.getByLabelText("Minutes") as HTMLInputElement;
    const event = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
    const prevented = !mm.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it("emits the merged HH:MM string on hour edit", () => {
    const onChange = vi.fn();
    render(<ScheduleTimeInput value="15:30" onChange={onChange} />);
    const hh = screen.getByLabelText("Hours") as HTMLInputElement;
    fireEvent.change(hh, { target: { value: "18" } });
    expect(onChange).toHaveBeenCalledWith("18:30");
  });

  it("emits the merged HH:MM string on minutes edit", () => {
    const onChange = vi.fn();
    render(<ScheduleTimeInput value="15:00" onChange={onChange} />);
    const mm = screen.getByLabelText("Minutes") as HTMLInputElement;
    fireEvent.change(mm, { target: { value: "45" } });
    expect(onChange).toHaveBeenCalledWith("15:45");
  });

  it("strips non-digits and clamps to two characters", () => {
    const onChange = vi.fn();
    render(<ScheduleTimeInput value="" onChange={onChange} />);
    const hh = screen.getByLabelText("Hours") as HTMLInputElement;
    fireEvent.change(hh, { target: { value: "1a2b" } });
    // "1a2b" -> "12" + ":" + default mm "00"
    expect(onChange).toHaveBeenCalledWith("12:00");
  });
});
