import { Button, Card, Input } from "@showme/design-system";
import { Eyebrow } from "./primitives";

/**
 * The identity challenge in front of a share.
 *
 * Two fields, one at a time: the address the link was sent to, then the six-digit
 * code that proves it. No password is set here and no account is created — the old
 * app's collaborator page asked the invitee to choose a password, hashed it in a
 * Cloud Function and signed them in anonymously, which is a second credential
 * store beside Firebase Auth. This is the replacement: a code, ten minutes, three
 * an hour, five wrong guesses and it is gone.
 *
 * Presentational — every value and every action comes from `useShareViewer`.
 */
export interface ShareOtpGateProps {
  email: string;
  onEmailChange: (value: string) => void;
  code: string;
  onCodeChange: (value: string) => void;
  codeSent: boolean;
  onSendCode: () => void;
  onVerify: () => void;
  isSendingCode: boolean;
  isVerifying: boolean;
}

export function ShareOtpGate({
  email,
  onEmailChange,
  code,
  onCodeChange,
  codeSent,
  onSendCode,
  onVerify,
  isSendingCode,
  isVerifying,
}: ShareOtpGateProps) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 460 }}>
      <Eyebrow>Shared with you</Eyebrow>
      <h1
        style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, color: "var(--text)" }}
      >
        Confirm it's you
      </h1>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.6 }}>
        This link was sent to one email address. Enter it and we'll send a six-digit code — it's
        good for ten minutes.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Email</span>
        <Input
          value={email}
          type="email"
          placeholder="you@email.com"
          aria-label="Email"
          onChange={(event) => onEmailChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !codeSent) onSendCode();
          }}
        />
      </div>

      {codeSent && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Code</span>
          <Input
            value={code}
            inputMode="numeric"
            placeholder="123456"
            aria-label="Verification code"
            onChange={(event) => onCodeChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onVerify();
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {codeSent ? (
          <>
            <Button variant="cta" onClick={onVerify} disabled={isVerifying || code.trim() === ""}>
              {isVerifying ? "Checking…" : "Open"}
            </Button>
            <Button variant="secondary" onClick={onSendCode} disabled={isSendingCode}>
              Send a new code
            </Button>
          </>
        ) : (
          <Button
            variant="cta"
            onClick={onSendCode}
            disabled={isSendingCode || !email.includes("@")}
          >
            {isSendingCode ? "Sending…" : "Send code"}
          </Button>
        )}
      </div>
    </Card>
  );
}
