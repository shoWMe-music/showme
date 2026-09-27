import {
  type getApiV1Notifications,
  useGetApiV1Notifications,
  usePostApiV1NotificationsRead,
} from "@showme/api-client";
import { Button, Icon } from "@showme/design-system";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { relativeTime } from "../lib/format";
import styles from "./NotificationBell.module.css";
import { notificationDestination } from "./notificationDestination";

type Notification = Awaited<ReturnType<typeof getApiV1Notifications>>["items"][number];

/**
 * The topbar bell: unread count plus a panel of recent notifications. Purely a
 * reader — it never subscribes to anything. `useRealtimeStream` invalidates the
 * feed query when a frame lands, so the badge updates live through exactly the
 * same fetch a cold page load uses.
 *
 * A notification that carries a `link` is a real button: it navigates, marks
 * itself read and closes the panel. One that doesn't is plain text — see
 * `notificationDestination` for why that's a deliberate allow-list.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data, refetch } = useGetApiV1Notifications({ limit: 20 });
  const markRead = usePostApiV1NotificationsRead({
    mutation: { onSuccess: () => void refetch() },
  });

  const notifications = data?.items ?? [];
  const unreadCount = notifications.filter((notification) => notification.readAt === null).length;

  // Opening a notification is three things at once: read it, get out of the way,
  // go there. The mark-read call is scoped to this one id — the API's `ids` body
  // takes a subset — so reading one never silently clears the rest of the feed.
  const openNotification = (notification: Notification) => {
    // The WHOLE row, not just its link: which event to open is in the link, which
    // panel of it to open is in the type (ClickUp `86cbcgq5f`).
    const destination = notificationDestination(notification);
    if (!destination) return;
    if (notification.readAt === null) markRead.mutate({ data: { ids: [notification.id] } });
    setOpen(false);
    if ("search" in destination) {
      navigate({ to: destination.to, params: destination.params, search: destination.search });
    } else if ("params" in destination) {
      navigate({ to: destination.to, params: destination.params });
    } else {
      navigate({ to: destination.to });
    }
  };

  return (
    <div className={styles.bell}>
      <Button
        variant="ghost"
        leftIcon={<Icon name="bell" />}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        data-testid="notification-bell"
      />
      {unreadCount > 0 && (
        <span className={styles.count} aria-hidden="true">
          {unreadCount}
        </span>
      )}

      {open && (
        <>
          <button
            type="button"
            className={styles.scrim}
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
          <div className={styles.panel} role="menu">
            <div className={styles.head}>
              <span className={styles.title}>Notifications</span>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => markRead.mutate({ data: { ids: undefined } })}
                  disabled={markRead.isPending}
                >
                  Mark all read
                </Button>
              )}
            </div>

            {notifications.length === 0 ? (
              <p className={styles.empty}>Nothing yet.</p>
            ) : (
              <ul className={styles.list}>
                {notifications.map((notification) => (
                  <li key={notification.id} className={styles.item}>
                    <NotificationRow notification={notification} onOpen={openNotification} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One notification. A linked one is a real `<button>` — not a `role="button"`
 * div — so Enter and Space work for free, the same choice `CalendarMonthGrid`
 * and `InvoiceLedgerTable` made tonight. There are no controls inside the row,
 * so nothing gets nested. An unlinked one renders the identical body in a
 * `<div>`: no tab stop, no pointer, no hover — it doesn't pretend to lead
 * anywhere, because there is nowhere to lead.
 */
function NotificationRow({
  notification,
  onOpen,
}: {
  notification: Notification;
  onOpen: (notification: Notification) => void;
}) {
  const unread = notification.readAt === null;
  const linked = notificationDestination(notification) !== null;
  const className = [styles.row, linked ? styles.rowLinked : "", unread ? styles.rowUnread : ""]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className={styles.topline}>
        {unread && (
          <>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.unreadLabel}>Unread:</span>
          </>
        )}
        <span className={styles.itemTitle}>{notification.title ?? notification.type}</span>
        <span className={styles.time}>{relativeTime(notification.createdAt)}</span>
      </span>
      {notification.body && <span className={styles.body}>{notification.body}</span>}
      {/* WHO DID IT (QA sweep run 5, QA5-5).
          
          `actorDisplay` has been written by `@showme/db/notify` for every notification
          with an actor, reaches the browser on every row, and had exactly one reader in
          the whole app — the Event History tab. So the bell said "The capacity changed."
          and never whose hand did it, which is half of what ClickUp `86cbcftg3` asks for:
          *"always notify the users of any change — where it happened AND BY WHO."*
          
          Rendered as its own line rather than folded into the body, because the body is
          written by twenty-odd emitters and none of them expects a name appended to its
          sentence. Absent where the notification has no actor — a task reminder or a
          show-day notice is the system speaking, and "by nobody" is not worth a line. */}
      {notification.actorDisplay && (
        <span className={styles.actor}>by {notification.actorDisplay}</span>
      )}
    </>
  );

  if (!linked) return <div className={className}>{content}</div>;

  return (
    <button type="button" className={className} onClick={() => onOpen(notification)}>
      {content}
    </button>
  );
}
