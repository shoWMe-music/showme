import { useState, useEffect, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/integrations/firebase/app";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";

interface OtpVerificationProps {
  email: string;
  onVerified: () => void;
  onResend: () => Promise<string | void>;
  initialDevCode?: string | null;
}

export function OtpVerification({
  email,
  onVerified,
  onResend,
  initialDevCode,
}: OtpVerificationProps) {
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const [verified, setVerified] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(initialDevCode ?? null);

  // Sync if initialDevCode arrives after mount
  useEffect(() => {
    if (initialDevCode) setDevCode(initialDevCode);
  }, [initialDevCode]);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const handleVerify = useCallback(async () => {
    if (otp.length !== 6) return;
    setLoading(true);
    setError("");
    try {
      const verifyOtp = httpsCallable<
        { email: string; code: string },
        { ok: true }
      >(getFirebaseFunctions(), "verifyOtp");
      await verifyOtp({ email, code: otp });
      setVerified(true);
      // Brief delay for the success animation before advancing
      setTimeout(() => onVerified(), 600);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Verification failed. Try again.";
      // Firebase callable errors have a `details` or `message` property
      setError(msg.replace(/^Firebase: /, ""));
    } finally {
      setLoading(false);
    }
  }, [otp, email, onVerified]);

  const handleResend = useCallback(async () => {
    if (cooldown > 0) return;
    setError("");
    try {
      const code = await onResend();
      if (code) setDevCode(code);
      setCooldown(60);
    } catch {
      setError("Failed to resend code. Please try again.");
    }
  }, [cooldown, onResend]);

  if (verified) {
    return (
      <div className="animate-fade-in-up flex flex-col items-center gap-3 py-6">
        <CheckCircle2 className="h-12 w-12 text-green-500" />
        <p className="text-sm font-medium text-green-600">Email verified</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground text-center">
        Code sent to{" "}
        <span className="font-medium text-foreground">{email}</span>
      </p>

      {devCode && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold">Your verification code</p>
          <p className="font-mono text-lg font-bold tracking-widest text-amber-800 dark:text-amber-200">{devCode}</p>
        </div>
      )}

      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
          value={otp}
          onChange={(val) => {
            setOtp(val);
            setError("");
          }}
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </div>

      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}

      <Button
        className="w-full"
        onClick={handleVerify}
        disabled={otp.length !== 6 || loading}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Verifying...
          </>
        ) : (
          "Verify"
        )}
      </Button>

      <p className="text-sm text-center text-muted-foreground">
        Didn't receive a code?{" "}
        {cooldown > 0 ? (
          <span>Resend in {cooldown}s</span>
        ) : (
          <button
            onClick={handleResend}
            className="text-primary hover:underline font-medium"
          >
            Resend code
          </button>
        )}
      </p>
    </div>
  );
}
