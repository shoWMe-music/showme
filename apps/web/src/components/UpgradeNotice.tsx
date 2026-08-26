import { Button, Card, Icon } from "@showme/design-system";
import type { ReactNode } from "react";

/**
 * THE upgrade notice — the single place the app says "that's a Pro feature".
 *
 * There is exactly one of these on purpose. Plan gates live in the API
 * (`lib/entitlements.ts`) and are reachable from a dozen screens; if each screen
 * wrote its own sentence, the copy would drift from the rule the moment a limit
 * changed. So screens say nothing about plans at all — they let the API's
 * `entitlement_required` error travel up to `UpgradeNoticeProvider`, which renders
 * this over whatever the user was doing.
 *
 * The tone is deliberate. The original copy was *"Unfortunately you are using the
 * freemium version"*; the user did nothing wrong by being on the free plan, so the
 * notice states the fact and the remedy without the apology or the scolding.
 * ("prod" in the original was a typo for "pro".)
 */

/** The standing sentence — true of every plan gate, in every screen. */
export const UPGRADE_NOTICE_HEADING = "Included in shoWMe Pro";
export const UPGRADE_NOTICE_BODY =
  "This feature is included in the Pro subscription. You're on the free version of shoWMe, " +
  "so it isn't available on this account yet. Upgrade to use this and everything else in Pro.";

export interface UpgradeNoticeProps {
  /**
   * The API's specific, factual reason — "Free plan event limit reached". Shown
   * UNDER the standing copy so the user learns WHICH limit they met. Optional:
   * a pure tier gate (`grant_admin`) has no count behind it.
   */
  reason?: string | null;
  /** Called when the user asks to see plans. Omit to hide the action. */
  onSeePlans?: () => void;
  /** Called when the user dismisses. Omit to hide the dismiss action. */
  onDismiss?: () => void;
  /** `card` stands alone inside a panel; `plain` sits in a container that already frames it (a modal body). */
  surface?: "card" | "plain";
}

export function UpgradeNotice({
  reason,
  onSeePlans,
  onDismiss,
  surface = "card",
}: UpgradeNoticeProps) {
  const body = (
    <div
      style={{ display: "flex", gap: 14, alignItems: "flex-start" }}
      data-testid="upgrade-notice"
    >
      <span
        aria-hidden
        style={{
          display: "grid",
          placeItems: "center",
          width: 34,
          height: 34,
          borderRadius: 10,
          flexShrink: 0,
          background: "var(--elevated)",
          color: "var(--text)",
        }}
      >
        <Icon name="star" />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--text)" }}>
          {UPGRADE_NOTICE_HEADING}
        </span>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--muted)" }}>
          {UPGRADE_NOTICE_BODY}
        </p>
        {reason && (
          <p
            style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}
            data-testid="upgrade-notice-reason"
          >
            {reason}
          </p>
        )}
        {(onSeePlans || onDismiss) && (
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {onSeePlans && (
              <Button
                variant="primary"
                onClick={onSeePlans}
                rightIcon={<Icon name="arrow-right" />}
              >
                See plans
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" onClick={onDismiss}>
                Not now
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (surface === "plain") return body;
  return <Card padding="lg">{body as ReactNode}</Card>;
}
