import { useEffect, useRef, useState } from "react";
import { Lock, Mail, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cacheShareJwt, callRequestShareOtp, callVerifyShareOtp } from "@/lib/db";

interface Props {
  token: string;
  onUnlocked: () => void;
}

const RESEND_COOLDOWN_SECONDS = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = "email" | "code";

function readableRequestError(code: string | undefined): string {
  if (!code) return "Could not send the code. Try again.";
  if (code === "functions/permission-denied" || code === "permission-denied") {
    return "That email isn't on the recipient list.";
  }
  if (code === "functions/resource-exhausted" || code === "resource-exhausted") {
    return "Too many attempts — try again later.";
  }
  if (code === "functions/invalid-argument" || code === "invalid-argument") {
    return "That email address looks invalid.";
  }
  return "Could not send the code. Try again.";
}

function readableVerifyError(code: string | undefined): string {
  if (!code) return "Could not verify the code. Try again.";
  if (code === "functions/not-found" || code === "not-found") {
    return "Code expired or not found.";
  }
  if (code === "functions/permission-denied" || code === "permission-denied") {
    return "Incorrect code.";
  }
  if (code === "functions/resource-exhausted" || code === "resource-exhausted") {
    return "Too many attempts — request a new code.";
  }
  return "Could not verify the code. Try again.";
}

export default function ShareOtpGate({ token, onUnlocked }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldownLeft(RESEND_COOLDOWN_SECONDS);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCooldownLeft((s) => {
        if (s <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const isEmailValid = EMAIL_RE.test(email.trim());

  const handleSendCode = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed) || cooldownLeft > 0 || requesting) return;
    setRequestError(null);
    setRequesting(true);
    try {
      await callRequestShareOtp(token, trimmed);
      setStep("code");
      startCooldown();
    } catch (err) {
      setRequestError(readableRequestError((err as { code?: string }).code));
    } finally {
      setRequesting(false);
    }
  };

  const handleVerify = async () => {
    const trimmedCode = code.trim();
    if (trimmedCode.length !== 6 || verifying) return;
    setVerifyError(null);
    setVerifying(true);
    try {
      const { jwt } = await callVerifyShareOtp(token, email.trim().toLowerCase(), trimmedCode);
      cacheShareJwt(token, jwt);
      onUnlocked();
    } catch (err) {
      setVerifyError(readableVerifyError((err as { code?: string }).code));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            {step === "email" ? (
              <Lock className="h-5 w-5 text-primary" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-primary" />
            )}
          </div>
          <CardTitle className="text-xl">Protected share</CardTitle>
          <CardDescription>
            {step === "email"
              ? "Enter the email this link was shared to. We'll send a 6-digit code."
              : `We sent a 6-digit code to ${email.trim().toLowerCase()}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "email" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSendCode();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="share-otp-email" className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Email
                </Label>
                <Input
                  id="share-otp-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setRequestError(null);
                  }}
                  autoFocus
                />
              </div>
              {requestError && <p className="text-sm text-destructive">{requestError}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={!isEmailValid || requesting || cooldownLeft > 0}
              >
                {requesting
                  ? "Sending…"
                  : cooldownLeft > 0
                    ? `Resend in ${cooldownLeft}s`
                    : "Send code"}
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleVerify();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="share-otp-code">6-digit code</Label>
                <Input
                  id="share-otp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setVerifyError(null);
                  }}
                  autoFocus
                />
              </div>
              {verifyError && <p className="text-sm text-destructive">{verifyError}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={code.trim().length !== 6 || verifying}
              >
                {verifying ? "Verifying…" : "Unlock"}
              </Button>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <button
                  type="button"
                  className="underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                    setVerifyError(null);
                  }}
                >
                  Use a different email
                </button>
                <button
                  type="button"
                  className="underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void handleSendCode()}
                  disabled={cooldownLeft > 0 || requesting}
                >
                  {cooldownLeft > 0 ? `Resend in ${cooldownLeft}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
