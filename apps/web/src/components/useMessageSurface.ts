import { useReducedMotion } from "@showme/design-system";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ThreadComment } from "./CommentThread";

/**
 * The three pieces of behaviour the messages surface needs and a component
 * should not own: how wide it is, where it is scrolled, and which day each
 * message belongs to. Kept together because they are one surface's mechanics —
 * splitting them into three files would mean holding three files to read one
 * screen.
 */

/** Below this the rail stops being a list and becomes a one-line selector. */
const RAIL_MINIMUM_WIDTH = 640;

/**
 * Whether the surface is too narrow to carry a rail beside the conversation.
 *
 * Measured from the CONTAINER, not the viewport: this tab sits inside a shell
 * with a sidebar, so the window width is not the width the surface actually
 * gets, and a media query would flip at the wrong moment on every screen where
 * the sidebar is open.
 */
export function useMessageRailMode(): {
  containerRef: (element: HTMLDivElement | null) => void;
  isNarrow: boolean;
} {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setIsNarrow(entry.contentRect.width < RAIL_MINIMUM_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  // A callback ref rather than an object ref: the observer has to be attached
  // the moment the node exists, and a `useRef` gives an effect nothing to
  // depend on when the node arrives.
  return {
    containerRef: useCallback((next: HTMLDivElement | null) => setElement(next), []),
    isNarrow,
  };
}

/** How close to the bottom still counts as "reading the newest". */
const PINNED_TO_BOTTOM_SLACK = 60;

/**
 * Opens the conversation at the newest message, and keeps it there as messages
 * arrive — but only while the reader is actually at the bottom. Someone who has
 * scrolled up to read what was said last week is not moved off it by a message
 * landing underneath them.
 */
export function useMessageAutoScroll(messageCount: number): {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
} {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToBottom = useRef(true);
  const hasOpened = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    isPinnedToBottom.current = distanceFromBottom < PINNED_TO_BOTTOM_SLACK;
  }, []);

  // Layout effect, not effect: the first paint of a conversation must already be
  // at the newest message, never at the oldest with a visible jump after it.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || messageCount === 0) return;
    if (!isPinnedToBottom.current) return;
    const isFirstOpen = !hasOpened.current;
    hasOpened.current = true;
    element.scrollTo({
      top: element.scrollHeight,
      // Opening jumps; a message arriving in a conversation you are already
      // reading glides, so you can see that something moved.
      behavior: isFirstOpen || prefersReducedMotion ? "auto" : "smooth",
    });
  }, [messageCount, prefersReducedMotion]);

  return { scrollRef, onScroll };
}

export interface MessageDay {
  /** ISO date (`2026-08-26`) — stable key, and what the grouping is keyed on. */
  key: string;
  /** "Today", "Yesterday", or "Wednesday, 26 August 2026". */
  label: string;
  comments: ThreadComment[];
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** The local calendar day of an ISO timestamp, as `YYYY-MM-DD`. */
function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayLabel(date: Date, today: Date): string {
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (localDayKey(date) === localDayKey(today)) return "Today";
  if (localDayKey(date) === localDayKey(yesterday)) return "Yesterday";
  return DAY_FORMAT.format(date);
}

/**
 * Messages split into calendar days, so the list can put a divider between them.
 * A timestamp under every bubble says WHEN in the day; only the divider says
 * which day, and without it "09:14" is a lie by omission on a thread that has
 * been running for a month.
 */
export function useMessageDays(comments: ThreadComment[]): MessageDay[] {
  return useMemo(() => {
    const today = new Date();
    const days: MessageDay[] = [];
    for (const comment of comments) {
      const date = new Date(comment.createdAt);
      if (Number.isNaN(date.getTime())) {
        // An unparseable timestamp still has to show its message; it just joins
        // whatever day is open rather than inventing one.
        if (days.length === 0) days.push({ key: "unknown", label: "", comments: [] });
        days[days.length - 1]?.comments.push(comment);
        continue;
      }
      const key = localDayKey(date);
      const current = days[days.length - 1];
      if (current?.key === key) current.comments.push(comment);
      else days.push({ key, label: dayLabel(date, today), comments: [comment] });
    }
    return days;
  }, [comments]);
}
