import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { httpsCallable } from "firebase/functions";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { getAuthClient } from "@/lib/firebaseAuth";
import { getFirebaseAuthErrorMessage } from "@/lib/firebaseAuthErrors";
import { getFirebaseFunctions } from "@/integrations/firebase/app";
import logo from "@/assets/showme-logo.png";
import { Loader2, Mail, KeyRound, Lock } from "lucide-react";

type Step = "send" | "verify" | "password";

export default function AcceptInvitePage() {
  const search = useSearch({ from: "/accept-invite" });
  const navigate = useNavigate();
  const { toast } = useToast();

  const initialEmail = (search.email ?? "").toLowerCase();
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState<Step>("send");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const autoSentRef = useRef(false);

  const sendOtp = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      toast({ title: "Enter your email address", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const fn = httpsCallable<{ email: string }, { ok: true; devCode?: string }>(
        getFirebaseFunctions(), "sendOtpEmail",
      );
      await fn({ email: normalized });
      setStep("verify");
      toast({
        title: "Verification code sent",
        description: `Check ${normalized} for a 6-digit code.`,
      });
    } catch (err) {
      toast({
        title: "Could not send code",
        description: getFirebaseAuthErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (code.length !== 6) {
      toast({ title: "Enter the 6-digit code", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const fn = httpsCallable<{ email: string; code: string }, { ok: true }>(
        getFirebaseFunctions(), "verifyOtp",
      );
      await fn({ email: email.trim().toLowerCase(), code });
      setStep("password");
    } catch (err) {
      toast({
        title: "Invalid or expired code",
        description: getFirebaseAuthErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const submitPassword = async () => {
    if (password.length < 6) {
      toast({
        title: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }
    const normalized = email.trim().toLowerCase();
    setLoading(true);
    try {
      try {
        await createUserWithEmailAndPassword(getAuthClient(), normalized, password);
        toast({ title: "Account created", description: "Welcome to shoWMe!" });
      } catch (createErr) {
        const errCode = (createErr as { code?: string })?.code;
        if (errCode === "auth/email-already-in-use") {
          // Existing account — sign in with the same password they entered.
          await signInWithEmailAndPassword(getAuthClient(), normalized, password);
          toast({ title: "Signed in", description: "Welcome back!" });
        } else {
          throw createErr;
        }
      }
      // The user-context hook claims pending profileInvites automatically on
      // first sign-in, so by the time Settings → Profile Access loads they
      // already have membership.
      navigate({ to: "/settings", hash: "profile-access", replace: true });
    } catch (err) {
      const errCode = (err as { code?: string })?.code;
      const description =
        errCode === "auth/wrong-password" || errCode === "auth/invalid-credential"
          ? "We found an existing shoWMe account for this email, but the password is wrong."
          : getFirebaseAuthErrorMessage(err);
      toast({ title: "Could not sign in", description, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Auto-send the code when the page is opened with an email pre-filled
  // (the link in the invitation email always carries it).
  useEffect(() => {
    if (initialEmail && !autoSentRef.current) {
      autoSentRef.current = true;
      void sendOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-3">
          <img src={logo} alt="shoWMe" className="mx-auto h-9" />
          <CardTitle className="text-xl">Accept your invitation</CardTitle>
          <CardDescription>
            {step === "send" && "Confirm your email to get started."}
            {step === "verify" && `We sent a 6-digit code to ${email}.`}
            {step === "password" && "Set a password to finish signing up. If you already have a shoWMe account, enter your existing password to sign in."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "send" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoFocus={!email}
                  onKeyDown={(e) => { if (e.key === "Enter") void sendOtp(); }}
                />
              </div>
              <Button
                className="w-full gap-2"
                onClick={() => void sendOtp()}
                disabled={loading || !email.trim()}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send verification code
              </Button>
            </>
          )}

          {step === "verify" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="text-center font-mono text-lg tracking-widest"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") void verifyOtp(); }}
                />
              </div>
              <Button
                className="w-full gap-2"
                onClick={() => void verifyOtp()}
                disabled={loading || code.length !== 6}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Verify code
              </Button>
              <button
                type="button"
                className="block w-full text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setStep("send"); setCode(""); }}
              >
                Use a different email
              </button>
            </>
          )}

          {step === "password" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") void submitPassword(); }}
                />
              </div>
              <Button
                className="w-full gap-2"
                onClick={() => void submitPassword()}
                disabled={loading || password.length < 6}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                Continue
              </Button>
              <Link
                to="/reset-password"
                className="block text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Forgot your password?
              </Link>
            </>
          )}

          <p className="pt-2 border-t text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-foreground hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
