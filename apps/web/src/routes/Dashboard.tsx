import {
  useGetApiV1BookingRequests,
  useGetApiV1DealsAwaitingSignature,
  useGetApiV1Events,
  useGetApiV1InsightsProfilesIdSummary,
  useGetApiV1Settlements,
  useGetApiV1SettlementsAwaitingSignature,
  useGetApiV1Tasks,
} from "@showme/api-client";
import { Badge, Button, EmptyState, Icon, type IconName } from "@showme/design-system";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { type AccountKind, useAuth } from "../auth/AuthProvider";
import { TaskPriorityBadge } from "../components/TaskPriorityBadge";
import {
  type AttentionKind,
  type AttentionTarget,
  attentionSentence,
  buildAttentionList,
} from "../components/attentionList";
import { settlementStatusToDisplay, settlementTotals } from "../components/settlementDocument";
import { ErrorState, LoadingState } from "../components/states";
import { useEventInvitations } from "../hooks/useEventInvitations";
import { formatAmount, formatDay, formatMoney } from "../lib/format";
import styles from "./Dashboard.module.css";

type TaskItem = {
  id: string;
  title: string;
  dueDate: string | null;
  completed: boolean;
  priority: string | null;
};

/**
 * Who to greet, which is not always the first word of the name.
 *
 * Taking `split(/\s+/)[0]` is right for a person — "Marlo Vance" wants to be
 * greeted as "Marlo" — and wrong for everyone else: it turned the venue "The
 * Lantern Hall" into "Good morning, The", and would do the same to any band
 * with an article in its name. The account kind is the honest signal for which
 * case we are in (docs/story.md: an `operator` is a venue/promoter/festival, and
 * a `performer` is as often a band as a soloist), so organisations keep their
 * whole name and only the kinds that name a person get shortened.
 */
function displayNameForGreeting(
  displayName: string | null | undefined,
  kind: AccountKind | undefined,
  email: string | null | undefined,
): string {
  const name = displayName?.trim();
  if (!name) return email?.split("@")[0] ?? "there";
  const namesAPerson = kind === "team_and_crew" || kind === "agent";
  return namesAPerson ? (name.split(/\s+/)[0] ?? name) : name;
}

/** Time-of-day greeting, matching the prototype's "Good morning, {name}". */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Status hue → translucent tint, matching the prototype's `hexA(color, .14)`. */
function tint(hex: string, alpha = 0.14): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * HOW EACH KIND LOOKS. The only thing about an attention row that belongs on this
 * side of the line — `components/attentionList` decides what is on the card and in
 * what order, because those are product rules and this file cannot test them.
 */
const ATTENTION_LOOK: Record<AttentionKind, { icon: IconName; color: string }> = {
  event: { icon: "calendar", color: "#F4A046" },
  request: { icon: "inbox", color: "#6FA8E0" },
  deal: { icon: "file", color: "#C8A24A" },
  invitation: { icon: "mail", color: "#7FB77E" },
  settlement: { icon: "receipt", color: "#B07FC8" },
};

/** A KPI tile matching the prototype: dotted sentence-case label + oversized display value. */
function KpiTile({
  dot,
  label,
  value,
  valueSize,
  onClick,
}: {
  dot: string;
  label: string;
  value: ReactNode;
  valueSize: number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={styles.kpiTile}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--muted)",
          fontSize: 12.5,
          marginBottom: 10,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot }} />
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 500,
          fontSize: valueSize,
          letterSpacing: "-.03em",
          lineHeight: 1,
          color: "var(--text)",
        }}
      >
        {value}
      </div>
    </button>
  );
}

/** The compact mono eyebrow the prototype stamps above each stat band. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: ".16em",
        textTransform: "uppercase",
        color: "var(--dim)",
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { session, user } = useAuth();
  const profileId = session?.memberships[0]?.profileId ?? "";

  const events = useGetApiV1Events();
  const summary = useGetApiV1InsightsProfilesIdSummary(profileId, {
    query: { enabled: Boolean(profileId) },
  });
  const requests = useGetApiV1BookingRequests({ limit: 5 });
  const settlementList = useGetApiV1Settlements();
  /**
   * The five that matter most, ranked BY THE SERVER (ClickUp `123qy9rnk27`:
   * *"preview the top 5 tasks by priority and by time/date"*).
   *
   * `completed=false` because a done task is not a preview of work, and
   * `order=priority` because sorting five rows here would only ever rank the five
   * the server happened to send — an urgent task at position 40 would never
   * appear. Six are asked for so the card can say whether there are more.
   */
  const tasks = useGetApiV1Tasks({ limit: 6, completed: "false", order: "priority" });
  /**
   * The deals waiting for this reader's signature, across every event (QA sweep run 7, QA7-18).
   *
   * There is no other way to ask: deals are reachable per event or by id, so the screen whose
   * whole job is routing people to the Confirm button could not see one. The route's predicate
   * is the confirm route's own, `maySignOwnLines` included — so every row here is a row the
   * reader can actually act on, which is what QA6-1 made non-negotiable.
   */
  const awaitingSignature = useGetApiV1DealsAwaitingSignature();
  /**
   * The settlements this reader owes a SIGNATURE on — a different question from the money list
   * below, and the reason an agency never saw the one line it was the only account able to sign
   * (QA sweep run 12). Its sibling `/deals/awaiting-signature` exists for exactly this reason.
   */
  const awaitingSettlementSignature = useGetApiV1SettlementsAwaitingSignature();
  /**
   * BOTH INVITATION INBOXES, through the hook the Requests screen uses.
   *
   * Two objects with two answers — a participation answered in place, and an
   * emailed `invitations` row redeemed on its own page — and the hook already
   * narrows each to the rows somebody is still waiting on. Reading the two routes
   * again here would be a second opinion about "unanswered", which is how two
   * screens come to disagree about the same invitation.
   */
  const invitations = useEventInvitations();

  const greetingName = displayNameForGreeting(user?.displayName, session?.kind, session?.email);

  if (events.isPending) return <LoadingState label="Loading your dashboard" />;
  if (events.isError)
    return <ErrorState error={events.error} title="Couldn't load your dashboard" />;

  const eventList = events.data.items;
  const requestList = requests.data?.items ?? [];
  // Already ranked and already filtered to open by the API — `completed=false`
  // and `order=priority` on the query above. Nothing is re-sorted here, because a
  // second opinion about the order is exactly how two screens come to disagree.
  const taskList = (tasks.data?.items ?? []) as TaskItem[];
  const eventsByStatus = summary.data?.eventsByStatus as Record<string, number> | undefined;

  const openEvent = (id: string) => navigate({ to: "/events/$eventId", params: { eventId: id } });

  // Every settlement the caller is a party to — the same call the Settlements
  // screen makes, so the band, that screen and the attention card always agree.
  const settlementRows = settlementList.data?.items ?? [];

  /*
   * "NEEDS ATTENTION" — the membership rule, the rank and the count all live in
   * `components/attentionList`. What is left here is reading the sources and
   * turning a target into a navigation.
   *
   * It used to be ninety lines of this function, and three of its judgements were
   * wrong in a way nothing could have caught: the count printed the number SHOWN
   * as though it were the total, the order was whichever query resolved first, and
   * three of the five things somebody can be waiting on were not read at all —
   * a co-promoter holding an unanswered invitation and a settlement sent for
   * review both read "You're all caught up".
   */
  const attentionList = buildAttentionList({
    events: eventList,
    requests: requestList,
    dealsAwaitingSignature: awaitingSignature.data?.items ?? [],
    eventInvitations: invitations.invitations,
    addressedInvitations: invitations.addressed,
    settlements: awaitingSettlementSignature.data?.items ?? [],
  });
  const attentionShown = attentionList.shown;
  const sentence = attentionSentence(attentionList.items.length, attentionList.hidden);

  const goTo = (target: AttentionTarget) => {
    switch (target.to) {
      case "event":
        return openEvent(target.eventId);
      case "eventDeals":
        return navigate({
          to: "/events/$eventId",
          params: { eventId: target.eventId },
          search: { tab: "deals" },
        });
      case "eventSettlement":
        return navigate({
          to: "/events/$eventId/settlement",
          params: { eventId: target.eventId },
        });
      case "requests":
        return navigate({ to: "/requests" });
    }
  };

  // --- Event stat band (from the insights summary, falling back to the list). ---
  //
  // `/insights/profiles/:id/summary` counts events where `host_profile_id` is this
  // profile — it is operator-facing analytics and says so. A PERFORMER hosts
  // nothing; they join through `event_participants`. So the aggregate answers 0 for
  // them however many events they are actually on, and `eventsByStatus` comes back
  // `{}`.
  //
  // The fallbacks below were written for exactly that case and never fired: `??`
  // passes on `0` because 0 is not nullish, and `{}` is truthy. A performer with two
  // events read "Total events 0" on the dashboard while the Events screen listed
  // both. So the test is whether this profile hosts anything at all — when it hosts
  // nothing the aggregate is answering a different question, and the list is the
  // honest source. An operator that genuinely hosts zero events falls back to a list
  // that is also empty, so the fallback costs nothing there.
  const settlementFigures = settlementTotals(settlementRows);
  // Most recent first. `eventDate` is nullable on the wire, and an undated event
  // sorts last rather than being dropped — it is still the caller's money.
  const recentSettlements = [...settlementRows]
    .sort((left, right) => (right.event.eventDate ?? "").localeCompare(left.event.eventDate ?? ""))
    .slice(0, 5);

  const hostedCount = summary.data?.eventsHosted ?? 0;
  const hostsNothing = hostedCount === 0;
  const countStatus = (...statuses: string[]) => {
    if (eventsByStatus && !hostsNothing) {
      return statuses.reduce((sum, key) => sum + (eventsByStatus[key] ?? 0), 0);
    }
    return eventList.filter((event) => statuses.includes(event.status)).length;
  };
  const totalEvents = hostsNothing ? eventList.length : hostedCount;

  return (
    <div className={styles.page}>
      {/* Greeting */}
      <div>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            fontSize: 34,
            letterSpacing: "-.025em",
            margin: "0 0 4px",
          }}
        >
          {greeting()},{" "}
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontWeight: 400,
              color: "var(--accent)",
            }}
          >
            {greetingName}
          </span>
        </h2>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 15 }}>
          {sentence.caughtUp ? (
            sentence.text
          ) : (
            <>
              {sentence.before}
              <b style={{ color: "var(--text)" }}>{sentence.count}</b>
              {sentence.after}
            </>
          )}
        </p>
      </div>

      {/* Needs attention */}
      {attentionShown.length === 0 ? (
        <EmptyState
          /*
           * A LEGEND, NOT A SECOND ANNOUNCEMENT (QA sweep run 12).
           *
           * The heading read "Nothing needs attention" directly under the greeting's "You're all
           * caught up — nothing needs your attention today." — three statements, two of them the
           * same one. The greeting's sentence is the one a reader scans and the one under test;
           * the description below is the only line here carrying new information. So the heading
           * introduces it instead of restating the greeting, and the icon stops saying "done" —
           * which the greeting has already said — and says "this is where things arrive".
           */
          icon={<Icon name="inbox" />}
          title="What lands here"
          // WHAT THIS CARD ACTUALLY READS. It promised "open tasks" for as long as
          // tasks had their own section below, and would now have been wrong twice
          // over — the two invitation inboxes and an unsigned settlement are on it.
          description="Events awaiting a decision, unanswered booking requests and invitations, agreements and settlements waiting on your signature."
        />
      ) : (
        <div className={styles.attentionCard}>
          {attentionShown.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => goTo(item.target)}
              className={styles.attentionRow}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "15px 16px",
                border: 0,
                borderRadius: 14,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  borderRadius: 11,
                  display: "grid",
                  placeItems: "center",
                  background: tint(ATTENTION_LOOK[item.kind].color),
                  color: ATTENTION_LOOK[item.kind].color,
                }}
              >
                <Icon name={ATTENTION_LOOK[item.kind].icon} size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontWeight: 500,
                    color: "var(--text)",
                    fontSize: 14.5,
                  }}
                >
                  {item.title}
                </span>
                <span style={{ display: "block", color: "var(--muted)", fontSize: 13 }}>
                  {item.detail}
                </span>
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: ATTENTION_LOOK[item.kind].color,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: tint(ATTENTION_LOOK[item.kind].color),
                  whiteSpace: "nowrap",
                }}
              >
                {item.action}
              </span>
              <span style={{ color: "var(--muted)", display: "inline-flex" }}>
                <Icon name="chevron-right" size={18} />
              </span>
            </button>
          ))}
          {/*
            WHAT DID NOT FIT. A sentence, not a link: there is no screen that lists
            all of this, and a "Show all" pointing nowhere would be worse than
            saying plainly that the card is showing the closest few. The greeting
            above counts every one of them.
          */}
          {attentionList.hidden > 0 && (
            <p
              style={{
                margin: 0,
                padding: "12px 16px",
                color: "var(--dim)",
                fontSize: 13,
              }}
            >
              and {attentionList.hidden} more, further out
            </p>
          )}
        </div>
      )}

      {/* Tasks — ClickUp `123qy9rnk27`. The top few by priority, with a way
          through to all of them. */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <Eyebrow>Tasks</Eyebrow>
          <Button variant="ghost" onClick={() => navigate({ to: "/tasks" })}>
            Show all
          </Button>
        </div>
        {taskList.length === 0 ? (
          <EmptyState
            icon={<Icon name="check" />}
            title="Nothing on your list"
            description="Tasks you create, on an event or on your own, appear here."
          />
        ) : (
          <div className={styles.attentionCard}>
            {taskList.slice(0, 5).map((task) => (
              <button
                type="button"
                key={task.id}
                onClick={() => navigate({ to: "/tasks" })}
                className={styles.attentionRow}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "13px 16px",
                  border: 0,
                  borderRadius: 14,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span
                    style={{
                      fontWeight: 500,
                      color: "var(--text)",
                      fontSize: 14.5,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {task.title}
                  </span>
                  <TaskPriorityBadge priority={task.priority} />
                </span>
                {/* The date the row is ranked by, where it is ranked by one. A
                    task with no due date says so rather than drawing a blank
                    column that reads as a missing value. */}
                <span
                  className="muted"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                  }}
                >
                  {task.dueDate ? formatDay(task.dueDate) : "No date"}
                </span>
                <span style={{ color: "var(--muted)", display: "inline-flex" }}>
                  <Icon name="chevron-right" size={18} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Events band */}
      <div>
        <Eyebrow>Events</Eyebrow>
        <div className={styles.kpiGrid}>
          <KpiTile
            dot="#B8A99B"
            label="Total events"
            value={totalEvents}
            valueSize={38}
            onClick={() => navigate({ to: "/events" })}
          />
          <KpiTile
            dot="#6FC97A"
            label="Confirmed"
            value={countStatus("confirmed")}
            valueSize={38}
            onClick={() => navigate({ to: "/events" })}
          />
          <KpiTile
            dot="#F4A046"
            label="Pending"
            value={countStatus("pending", "suggested")}
            valueSize={38}
            onClick={() => navigate({ to: "/events" })}
          />
          <KpiTile
            dot="#FFC266"
            label="On hold"
            value={countStatus("on_hold")}
            valueSize={38}
            onClick={() => navigate({ to: "/events" })}
          />
        </div>
      </div>

      {/* Settlements band. This used to be four hardcoded em dashes, on the grounds
          that no profile-level aggregate endpoint existed — but `GET /settlements`
          does exist and already answers with every settlement the caller is a party
          to, which is what the Settlements screen sums. So a performer with a
          finalized 46 500 read "—" here and the real figure one click away, and the
          panel below said "No settlements yet" over a settlement that existed. A
          placeholder is honest; a denial is not. Same summation as that screen,
          from `settlementTotals`. */}
      <div>
        <Eyebrow>Settlements</Eyebrow>
        {/*
          THE SAME REFUSAL AS THE SETTLEMENTS SCREEN, on the same figures (decisions §25.8.1). Four
          dashes with no sentence read as "no money", which is the denial this band was built to
          stop — a placeholder is honest, a denial is not, and "not one number" is neither.
        */}
        {settlementFigures.mixedCurrencyNote && (
          <p className="muted" style={{ margin: "0 0 10px", fontSize: 12.5, lineHeight: 1.5 }}>
            {settlementFigures.mixedCurrencyNote}
          </p>
        )}
        <div className={styles.kpiGrid}>
          <KpiTile
            dot="#6FC97A"
            label="Paid"
            value={settlementFigures.paid}
            valueSize={34}
            onClick={() => navigate({ to: "/settlements" })}
          />
          <KpiTile
            dot="#F4A046"
            label="In review"
            value={settlementFigures.inReview}
            valueSize={34}
            onClick={() => navigate({ to: "/settlements" })}
          />
          <KpiTile
            dot="#6FA8E0"
            label="Outstanding"
            value={settlementFigures.outstanding}
            valueSize={34}
            onClick={() => navigate({ to: "/settlements" })}
          />
          <KpiTile
            dot="#E6D9CB"
            label="Finalized"
            value={settlementFigures.finalized}
            valueSize={34}
            onClick={() => navigate({ to: "/settlements" })}
          />
        </div>
      </div>

      {/* Recent settlements + Top venues */}
      <div className={styles.split}>
        <div className={styles.panel}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                fontSize: 18,
                margin: 0,
              }}
            >
              Recent settlements
            </h3>
            <button
              type="button"
              onClick={() => navigate({ to: "/settlements" })}
              // Touch: 49x18. This one takes the OVERLAY rather than growing,
              // because growing it would drag the card's heading row to 44px
              // and push "Recent settlements" off its own baseline. Measured on
              // a coarse pointer at 390px, the nearest interactive element to
              // this button is the first settlement row well over 44px below,
              // so the halo has the clear space `styles/touch.css` asks for.
              className="touch-target-overlay"
              style={{
                background: "transparent",
                border: 0,
                color: "var(--accent)",
                fontSize: 13,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              See all
            </button>
          </div>
          {recentSettlements.length === 0 ? (
            <EmptyState
              icon={<Icon name="receipt" />}
              title="No settlements yet"
              description="Concluded events with a settlement will show here, with status and amount."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {recentSettlements.map((row) => {
                const display = settlementStatusToDisplay(row.status);
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={styles.recentRow}
                    onClick={() => navigate({ to: "/settlements" })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      width: "100%",
                      textAlign: "left",
                      padding: "11px 8px",
                      border: 0,
                      borderRadius: 10,
                      color: "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{row.event.title}</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {row.event.eventDate ? formatDay(row.event.eventDate) : "Date to come"}
                      </span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Badge status={display.status} dot>
                        {display.label}
                      </Badge>
                      <b style={{ fontSize: 13.5, whiteSpace: "nowrap" }}>
                        {/* Null until the event has been computed — a real "not yet". */}
                        {row.entitlement == null
                          ? "—"
                          : row.currency
                            ? formatMoney(row.entitlement, row.currency)
                            : formatAmount(row.entitlement)}
                      </b>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.panel}>
          <h3
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 500,
              fontSize: 18,
              margin: "0 0 16px",
            }}
          >
            Top venues by revenue
          </h3>
          {/*
            NOT BUILT, AND IT SHOULD SAY SO (QA sweep run 5, QA5-14; run 6 saw it again).
            This panel has no data source: `GET /insights/profiles/:id/revenue` returns
            one TOTAL and there is no per-venue roll-up anywhere. Its old copy — "No
            revenue yet · Revenue by venue appears here once your events start settling"
            — sat beside `Recent settlements: Spring Warmup · Finalized SEK 20,700`, so
            it blamed the reader's data for a feature that does not exist, and told them
            to wait for something that would never arrive.
          */}
          <EmptyState
            icon={<Icon name="trending-up" />}
            title="Not built yet"
            description="Revenue is totalled per event today, not per venue. This panel is waiting on that roll-up rather than on your settlements."
          />
        </div>
      </div>
    </div>
  );
}
