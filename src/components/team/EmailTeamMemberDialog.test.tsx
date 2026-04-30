import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockToast, mockCallable, mockHttpsCallable } = vi.hoisted(() => {
  const callable = vi.fn().mockResolvedValue({ data: { ok: true } });
  return {
    mockToast: vi.fn(),
    mockCallable: callable,
    mockHttpsCallable: vi.fn().mockReturnValue(callable),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mockHttpsCallable,
}));

vi.mock("@/integrations/firebase/app", () => ({
  getFirebaseFunctions: vi.fn().mockReturnValue({}),
}));

import EmailTeamMemberDialog from "./EmailTeamMemberDialog";

beforeEach(() => {
  mockToast.mockReset();
  mockCallable.mockReset();
  mockCallable.mockResolvedValue({ data: { ok: true } });
});

describe("EmailTeamMemberDialog", () => {
  it("shows recipient email as read-only", () => {
    render(
      <EmailTeamMemberDialog
        open={true}
        onOpenChange={() => {}}
        recipientName="Jane Crew"
        recipientEmail="jane@example.com"
      />,
    );
    const toInput = screen.getByDisplayValue("jane@example.com") as HTMLInputElement;
    expect(toInput.readOnly).toBe(true);
  });

  it("disables Send until subject and body are both filled", () => {
    render(
      <EmailTeamMemberDialog
        open={true}
        onOpenChange={() => {}}
        recipientName="Jane Crew"
        recipientEmail="jane@example.com"
      />,
    );
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect(sendBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId("email-subject-input"), { target: { value: "Hi" } });
    expect(sendBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId("email-body-input"), { target: { value: "Body" } });
    expect(sendBtn).not.toBeDisabled();
  });

  it("calls onOpenChange(false) and toasts when Send is clicked", async () => {
    const onOpenChange = vi.fn();
    render(
      <EmailTeamMemberDialog
        open={true}
        onOpenChange={onOpenChange}
        recipientName="Jane Crew"
        recipientEmail="jane@example.com"
      />,
    );

    fireEvent.change(screen.getByTestId("email-subject-input"), { target: { value: "Hi" } });
    fireEvent.change(screen.getByTestId("email-body-input"), { target: { value: "Hello there" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Email sent" }));
    });
    expect(mockCallable).toHaveBeenCalledWith({
      recipientEmail: "jane@example.com",
      recipientName: "Jane Crew",
      subject: "Hi",
      body: "Hello there",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("resets subject and body when reopened for a new recipient", () => {
    const { rerender } = render(
      <EmailTeamMemberDialog
        open={true}
        onOpenChange={() => {}}
        recipientName="Jane"
        recipientEmail="jane@example.com"
      />,
    );

    fireEvent.change(screen.getByTestId("email-subject-input"), { target: { value: "Persisted subject" } });
    expect((screen.getByTestId("email-subject-input") as HTMLInputElement).value).toBe("Persisted subject");

    rerender(
      <EmailTeamMemberDialog
        open={true}
        onOpenChange={() => {}}
        recipientName="John"
        recipientEmail="john@example.com"
      />,
    );

    expect((screen.getByTestId("email-subject-input") as HTMLInputElement).value).toBe("");
  });
});
