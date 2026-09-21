import { describe, expect, it } from "vitest";
import {
  type RealtimeAction,
  type RealtimeSignal,
  type RealtimeState,
  nextRealtime,
} from "./realtimeLifecycle";

/**
 * WHAT STOPS THE BILL. An SSE connection is one long-lived request, so Cloud Run
 * charges for as long as a browser holds it open. These assert the lifecycle, not
 * the frames — the failure that costs money is a tab nobody is looking at keeping
 * an instance awake all night.
 */
const run = (from: RealtimeState, ...signals: RealtimeSignal[]) => {
  let state = from;
  const actions: RealtimeAction["do"][] = [];
  for (const signal of signals) {
    const next = nextRealtime(state, signal);
    state = next.state;
    for (const action of next.actions) actions.push(action.do);
  }
  return { state, actions };
};

const hidden: RealtimeSignal = { kind: "visibility", visible: false };
const shown: RealtimeSignal = { kind: "visibility", visible: true };
const grace: RealtimeSignal = { kind: "graceElapsed" };

describe("a tab nobody is looking at", () => {
  it("lets the socket go once the grace period elapses", () => {
    const { state, actions } = run("open", hidden, grace);
    expect(actions).toEqual(["armGrace", "close"]);
    expect(state).toBe("idle");
  });

  it("does NOT reconnect while it stays hidden — no hourly rearm", () => {
    // The overnight case: the stream ends (Cloud Run's 60-minute cap) again and
    // again. An idle tab must ignore every one of them.
    const { state, actions } = run(
      "open",
      hidden,
      grace,
      { kind: "connectionEnded" },
      { kind: "connectionEnded" },
      { kind: "connectionEnded" },
    );
    expect(actions.filter((a) => a === "open" || a === "scheduleReconnect")).toEqual([]);
    expect(state).toBe("idle");
  });

  it("keeps the stream through an ordinary glance away", () => {
    // Coming back before the countdown fires must NOT churn the connection:
    // each reconnect is a fresh request, token fetch and Postgres LISTEN, so
    // thrashing costs more than holding.
    const { state, actions } = run("open", hidden, shown);
    expect(actions).toEqual(["armGrace", "cancelGrace"]);
    expect(actions).not.toContain("close");
    expect(actions).not.toContain("open");
    expect(state).toBe("open");
  });

  it("opens nothing at all when it mounts already hidden", () => {
    const { state, actions } = run("idle", { kind: "mount", visible: false });
    expect(actions).toEqual([]);
    expect(state).toBe("idle");
  });
});

describe("coming back", () => {
  it("reconnects and RESYNCS, because SSE has no backlog", () => {
    // Anything published while disconnected is gone for good, so returning has to
    // read rather than wait for a frame that will never arrive.
    const { state, actions } = run("open", hidden, grace, shown);
    expect(actions).toEqual(["armGrace", "close", "cancelGrace", "resync", "open"]);
    expect(state).toBe("open");
  });

  it("resyncs before opening, so the refetch is not waiting on a socket", () => {
    const { actions } = run("idle", shown);
    expect(actions.indexOf("resync")).toBeLessThan(actions.indexOf("open"));
  });
});

describe("a visible tab", () => {
  it("opens on mount", () => {
    expect(run("idle", { kind: "mount", visible: true })).toEqual({
      state: "open",
      actions: ["open"],
    });
  });

  it("reconnects when the stream ends on its own — Cloud Run caps it at 60 minutes", () => {
    const { state, actions } = run("open", { kind: "connectionEnded" });
    expect(actions).toEqual(["scheduleReconnect"]);
    expect(state).toBe("open");
  });
});

describe("unmounting is final", () => {
  it("closes and cancels the countdown", () => {
    expect(run("open", { kind: "stop" })).toEqual({
      state: "stopped",
      actions: ["close", "cancelGrace"],
    });
  });

  it("cannot be resurrected by a late timer or visibility event", () => {
    // Both really do fire during teardown; a machine that reopened here would
    // leak a connection with no component left to close it.
    const { state, actions } = run("open", { kind: "stop" }, shown, grace, {
      kind: "connectionEnded",
    });
    expect(actions).toEqual(["close", "cancelGrace"]);
    expect(state).toBe("stopped");
  });
});
