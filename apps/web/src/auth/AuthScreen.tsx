import { ApiError } from "@showme/api-client";
import { Button, Card, Input } from "@showme/design-system";
import { type FormEvent, useState } from "react";
import { takeIdleLogoutNotice } from "../lib/idleLogout";
import { useAuth } from "./AuthProvider";

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/invalid-credential" || code === "auth/wrong-password")
      return "Wrong email or password.";
    if (code === "auth/email-already-in-use") return "That email is already registered.";
    if (code === "auth/weak-password") return "Password must be at least 6 characters.";
    if (code === "auth/popup-closed-by-user") return "Sign-in was cancelled.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export function AuthScreen() {
  const { signInEmail, signUpEmail, signInGoogle } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Read ONCE, at mount, and taken away in the same step — a lazy `useState`
   * initialiser rather than an effect, so it cannot be read twice by a re-render and
   * cannot flash in after the screen has already drawn.
   */
  const [idleNotice] = useState(() => takeIdleLogoutNotice());

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      // On success the auth state changes; the gate swaps this screen out.
    } catch (caught) {
      setError(messageFor(caught));
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    return run(() =>
      mode === "signup" ? signUpEmail(email, password) : signInEmail(email, password),
    );
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "var(--bg)",
      }}
    >
      <Card padding="lg" style={{ width: "100%", maxWidth: 400 }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p style={{ opacity: 0.7, marginBottom: 20, fontSize: 14 }}>
          {mode === "signup"
            ? "A couple of quick questions come next."
            : "Sign in to your shoWMe account."}
        </p>

        {/*
          WHY YOU ARE LOOKING AT THIS SCREEN, when the timeout is the answer
          (QA sweep run 5, QA5-6). `useIdleLogout` used to call `signOut()` and say
          nothing, so somebody returning to a laptop could not tell a timeout from an
          expired token, a revoked session or a bug — and the setting they would change
          is on the other side of the sign-in they were just asked for. Read once and
          cleared, so it explains this sign-out and never the next one.
        */}
        {idleNotice && (
          <p
            style={{
              margin: "0 0 20px",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--shape-fill)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            You were signed out after {idleNotice.minutes} minutes without activity. Change or
            switch off that timeout in Settings → Security once you are back in.
          </p>
        )}

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
          <Input
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
          />
          {error && <p style={{ color: "var(--brand-red)", fontSize: 13 }}>{error}</p>}
          <Button type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Please wait…" : mode === "signup" ? "Continue" : "Sign in"}
          </Button>
        </form>

        <div style={{ textAlign: "center", opacity: 0.5, fontSize: 12, margin: "14px 0" }}>or</div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => run(signInGoogle)}
          style={{ width: "100%" }}
        >
          Continue with Google
        </Button>

        <p style={{ textAlign: "center", marginTop: 16, fontSize: 13, opacity: 0.8 }}>
          {mode === "signup" ? "Already have an account?" : "New to shoWMe?"}{" "}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode(mode === "signup" ? "signin" : "signup");
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--brand-red)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>
      </Card>
    </div>
  );
}
