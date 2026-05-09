import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockCallRequestShareOtp = vi.fn();
const mockCallVerifyShareOtp = vi.fn();
const mockCacheShareJwt = vi.fn();

vi.mock("@/lib/db", () => ({
  callRequestShareOtp: (...args: unknown[]) => mockCallRequestShareOtp(...args),
  callVerifyShareOtp: (...args: unknown[]) => mockCallVerifyShareOtp(...args),
  cacheShareJwt: (...args: unknown[]) => mockCacheShareJwt(...args),
}));

import ShareOtpGate from "./ShareOtpGate";

beforeEach(() => {
  mockCallRequestShareOtp.mockReset();
  mockCallVerifyShareOtp.mockReset();
  mockCacheShareJwt.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function typeEmail(value: string) {
  const input = screen.getByLabelText(/^email$/i);
  fireEvent.change(input, { target: { value } });
  return input;
}

function getSendButton() {
  return screen.getByRole("button", { name: /(send code|resend in)/i });
}

describe("ShareOtpGate", () => {
  it("disables Send while email is invalid and enables it once valid", () => {
    render(<ShareOtpGate token="tok-1" onUnlocked={vi.fn()} />);
    const send = getSendButton();
    expect(send).toBeDisabled();
    typeEmail("not-an-email");
    expect(send).toBeDisabled();
    typeEmail("alice@test.com");
    expect(send).toBeEnabled();
  });

  it("shows a friendly error and stays on email step when verify fails with bad code", async () => {
    mockCallRequestShareOtp.mockResolvedValueOnce(undefined);
    mockCallVerifyShareOtp.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: "functions/permission-denied" }),
    );

    render(<ShareOtpGate token="tok-2" onUnlocked={vi.fn()} />);
    typeEmail("alice@test.com");
    fireEvent.click(getSendButton());

    const codeInput = await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(codeInput, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));

    await waitFor(() => {
      expect(screen.getByText(/incorrect code/i)).toBeInTheDocument();
    });
    // No JWT cached on failure.
    expect(mockCacheShareJwt).not.toHaveBeenCalled();
  });

  it("caches the JWT and calls onUnlocked when verify succeeds", async () => {
    mockCallRequestShareOtp.mockResolvedValueOnce(undefined);
    mockCallVerifyShareOtp.mockResolvedValueOnce({ jwt: "signed.jwt" });
    const onUnlocked = vi.fn();

    render(<ShareOtpGate token="tok-3" onUnlocked={onUnlocked} />);
    typeEmail("bob@test.com");
    fireEvent.click(getSendButton());

    const codeInput = await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));

    await waitFor(() => {
      expect(mockCacheShareJwt).toHaveBeenCalledWith("tok-3", "signed.jwt");
      expect(onUnlocked).toHaveBeenCalled();
    });
  });

  it("renders rate-limit copy when requestShareOtp rejects with resource-exhausted", async () => {
    mockCallRequestShareOtp.mockRejectedValueOnce(
      Object.assign(new Error("limit"), { code: "functions/resource-exhausted" }),
    );

    render(<ShareOtpGate token="tok-4" onUnlocked={vi.fn()} />);
    typeEmail("alice@test.com");
    fireEvent.click(getSendButton());

    await waitFor(() => {
      expect(screen.getByText(/too many attempts — try again later/i)).toBeInTheDocument();
    });
  });

  it("disables Send during the 60s cooldown after a successful request", async () => {
    mockCallRequestShareOtp.mockResolvedValueOnce(undefined);

    render(<ShareOtpGate token="tok-5" onUnlocked={vi.fn()} />);
    typeEmail("alice@test.com");
    fireEvent.click(getSendButton());

    // Wait for the step transition to "code" before swapping to fake timers,
    // otherwise the awaited promise never resolves under faked microtasks.
    await screen.findByLabelText(/6-digit code/i);

    // Go back to "email" step so we can observe the cooldown on the Send button.
    fireEvent.click(screen.getByRole("button", { name: /use a different email/i }));

    const sendAgain = getSendButton();
    expect(sendAgain).toBeDisabled();
    expect(sendAgain.textContent).toMatch(/resend in 60s/i);
  });
});
