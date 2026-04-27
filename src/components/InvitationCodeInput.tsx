import { useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

const ALLOWED_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

interface InvitationCodeInputProps {
  value: string;
  onChange: (code: string) => void;
  status?: "idle" | "loading" | "valid" | "invalid";
  disabled?: boolean;
}

function filterChars(raw: string): string {
  return raw
    .toUpperCase()
    .split("")
    .filter((c) => ALLOWED_CHARS.includes(c))
    .join("");
}

/**
 * Formatted invitation code input.
 * Code format: SHOW-XXXX-XXXX
 * Shows "SHOW-" as a static prefix with two 4-char input groups.
 * Supports pasting full codes like "SHOW-UFYB-6H38" into either input.
 */
export function InvitationCodeInput({
  value,
  onChange,
  status = "idle",
  disabled = false,
}: InvitationCodeInputProps) {
  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);

  // Parse the full code into its two groups
  const parts = value.replace(/^SHOW-/, "").split("-");
  const group1 = (parts[0] ?? "").slice(0, 4);
  const group2 = (parts[1] ?? "").slice(0, 4);

  const buildCode = (g1: string, g2: string) => `SHOW-${g1}-${g2}`;

  // Always intercept paste — strip prefix/dashes, filter, and split across groups
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").trim();
      // Strip "SHOW-" prefix and dashes, then filter to allowed chars
      const cleaned = filterChars(pasted.replace(/^SHOW-?/i, "").replace(/-/g, ""));
      const g1 = cleaned.slice(0, 4);
      const g2 = cleaned.slice(4, 8);
      onChange(buildCode(g1, g2));
      // Focus second input if first group is complete
      if (g1.length === 4) {
        setTimeout(() => ref2.current?.focus(), 0);
      }
    },
    [onChange],
  );

  const handleGroup1Change = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const filtered = filterChars(e.target.value).slice(0, 4);
      onChange(buildCode(filtered, group2));
      if (filtered.length === 4) {
        ref2.current?.focus();
      }
    },
    [group2, onChange],
  );

  const handleGroup2Change = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const filtered = filterChars(e.target.value).slice(0, 4);
      onChange(buildCode(group1, filtered));
    },
    [group1, onChange],
  );

  const handleGroup2KeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && group2.length === 0) {
        e.preventDefault();
        ref1.current?.focus();
      }
    },
    [group2],
  );

  return (
    <div className="animate-fade-in flex items-center gap-2">
      <span className="text-sm font-mono text-muted-foreground select-none">
        SHOW-
      </span>
      <Input
        ref={ref1}
        value={group1}
        onChange={handleGroup1Change}
        onPaste={handlePaste}
        disabled={disabled}
        maxLength={4}
        className="w-24 text-center font-mono tracking-widest uppercase"
        placeholder="XXXX"
        autoComplete="off"
        autoFocus
      />
      <span className="text-sm font-mono text-muted-foreground select-none">
        -
      </span>
      <Input
        ref={ref2}
        value={group2}
        onChange={handleGroup2Change}
        onKeyDown={handleGroup2KeyDown}
        onPaste={handlePaste}
        disabled={disabled}
        maxLength={4}
        className="w-24 text-center font-mono tracking-widest uppercase"
        placeholder="XXXX"
        autoComplete="off"
      />

      {/* Status indicator */}
      <div className="w-6 h-6 flex items-center justify-center">
        {status === "loading" && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
        {status === "valid" && (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        )}
        {status === "invalid" && (
          <XCircle className="h-5 w-5 text-destructive" />
        )}
      </div>
    </div>
  );
}
