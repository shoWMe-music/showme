import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PublicShareWarningModal } from "./PublicShareWarningModal";

describe("PublicShareWarningModal", () => {
  function setup(overrides: Partial<React.ComponentProps<typeof PublicShareWarningModal>> = {}) {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const utils = render(
      <PublicShareWarningModal
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        {...overrides}
      />,
    );
    return { ...utils, onOpenChange, onConfirm };
  }

  it("renders the headline and confirm/cancel actions", () => {
    setup();
    expect(screen.getByText(/Anyone with the link/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create public link/i })).toBeInTheDocument();
  });

  it("disables the confirm button until the acknowledgement checkbox is checked", () => {
    const { onConfirm } = setup();
    const confirmBtn = screen.getByRole("button", { name: /create public link/i });
    expect(confirmBtn).toBeDisabled();

    // Clicking while disabled must not fire confirm.
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("invokes onOpenChange(false) when Cancel is clicked", () => {
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the responsibility statement so users see what they are agreeing to", () => {
    setup();
    expect(
      screen.getByText(/I take responsibility for the information/i),
    ).toBeInTheDocument();
    // Body must mention financial/personal data exposure and shoWMe non-liability.
    expect(screen.getByText(/financial figures/i)).toBeInTheDocument();
    expect(screen.getByText(/not liable/i)).toBeInTheDocument();
  });

  it("disables both buttons while a share is pending", () => {
    setup({ pending: true });
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeDisabled();
    // Confirm shows "Creating..." while pending and stays disabled.
    expect(screen.getByRole("button", { name: /Creating/i })).toBeDisabled();
  });
});
