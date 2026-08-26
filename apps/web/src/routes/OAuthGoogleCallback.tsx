import {
  getGetApiV1CalendarQueryKey,
  getGetApiV1IntegrationsCalendarQueryKey,
  usePostApiV1IntegrationsCalendarGoogleConnect,
} from "@showme/api-client";
import { Button, Card, Icon, Spinner } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Eyebrow } from "../components/primitives";
import { takeRememberedOAuthState } from "../components/useCalendarConnections";
import { errorMessage } from "../lib/errors";

/**
 * WHERE GOOGLE SENDS THE USER BACK — `/oauth/google/callback`, one of the two
 * addresses registered against the OAuth client.
 *
 * THIS PAGE HOLDS NOTHING AND DECIDES NOTHING. It reads two values out of the
 * query string, posts them to the API, and reports what the API said. The code is
 * a one-time value that is worthless without the client secret, and the secret is
 * in the API — which is the entire reason the exchange is a round trip rather than
 * happening here.
 *
 * WHY IT RUNS EXACTLY ONCE. An authorization code is single-use: React 18's
 * StrictMode double-invokes effects in development, and the second run would spend
 * an already-spent code and paint a failure over a connection that actually
 * worked. The ref guard is not defensive tidying, it is the difference between
 * "Connected" and a confusing red box on every local run.
 *
 * THE `state` COMPARISON HERE IS THE SECOND LOCK, NOT THE FIRST. The API verifies
 * the signature and that the caller is the person who started the flow; that is
 * the check that stops an attacker's code landing on this account. Comparing
 * against the value this tab stored catches a mismatched round trip one step
 * earlier, before a code is spent — and being per-tab, it also stops a stale flow
 * in another tab being completed by accident.
 */
export function OAuthGoogleCallback() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const connect = usePostApiV1IntegrationsCalendarGoogleConnect();
  const [phase, setPhase] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("Finishing the connection…");
  const hasRun = useRef(false);

  // A ONE-SHOT effect, guarded by `hasRun`: it consumes the OAuth code in the URL
  // the moment this route mounts. A code is single-use, so listing dependencies
  // would invite a re-run that spends an already-spent code and then reports a
  // failure for a connection that actually succeeded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount, see above
  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const parameters = new URLSearchParams(window.location.search);
    const code = parameters.get("code");
    const state = parameters.get("state");
    const denied = parameters.get("error");
    const expectedState = takeRememberedOAuthState();

    // The user pressed Cancel on the consent screen. Not an error — say so
    // plainly and leave them somewhere they can try again.
    if (denied) {
      setPhase("failed");
      setMessage(
        denied === "access_denied"
          ? "Google access was not granted. Nothing was connected."
          : `Google refused the connection: ${denied}`,
      );
      return;
    }
    if (!code || !state) {
      setPhase("failed");
      setMessage("That link is missing the values Google should have returned.");
      return;
    }
    if (expectedState && expectedState !== state) {
      setPhase("failed");
      setMessage("This connection did not start in this tab. Start again from Integrations.");
      return;
    }

    connect
      .mutateAsync({ data: { code, state } })
      .then((result) => {
        queryClient.invalidateQueries({ queryKey: getGetApiV1IntegrationsCalendarQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetApiV1CalendarQueryKey() });
        setPhase("done");
        setMessage(
          `Connected ${result.connection.providerAccountId ?? "your Google Calendar"} — ${result.imported} ${
            result.imported === 1 ? "entry" : "entries"
          } imported.`,
        );
      })
      .catch((error) => {
        setPhase("failed");
        setMessage(errorMessage(error, "Couldn't finish connecting that calendar."));
      });
    // Deliberately once, on mount: see the single-use note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ maxWidth: 520, margin: "48px auto" }}>
      <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Eyebrow>Google Calendar</Eyebrow>
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {phase === "working" ? (
            <Spinner size={22} label="Connecting" />
          ) : (
            <Icon name={phase === "done" ? "check" : "alert"} size={20} />
          )}
          <span style={{ fontSize: 15, color: "var(--text)" }}>
            {phase === "working" ? "Connecting…" : phase === "done" ? "Connected" : "Not connected"}
          </span>
        </span>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>
          {message}
        </p>
        {phase !== "working" && (
          <div style={{ display: "flex", gap: 10 }}>
            <Button onClick={() => navigate({ to: "/integrations" })}>Back to Integrations</Button>
            {phase === "done" && (
              <Button variant="secondary" onClick={() => navigate({ to: "/calendar" })}>
                Open the calendar
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
