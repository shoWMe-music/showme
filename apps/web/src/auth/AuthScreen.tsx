import { ApiError } from "@showme/api-client";
import { Button, Card, Input } from "@showme/design-system";
import { type FormEvent, useState } from "react";
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
