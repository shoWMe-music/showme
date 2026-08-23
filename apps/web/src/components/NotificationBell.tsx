import { useGetApiV1Notifications, usePostApiV1NotificationsRead } from "@showme/api-client";
import { Button, Icon } from "@showme/design-system";
import { useState } from "react";
import { relativeTime } from "../lib/format";

/**
 * The topbar bell: unread count plus a panel of recent notifications. Purely a
 * reader — it never subscribes to anything. `useRealtimeStream` invalidates the
 * feed query when a frame lands, so the badge updates live through exactly the
 * same fetch a cold page load uses.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data, refetch } = useGetApiV1Notifications({ limit: 20 });
  const markRead = usePostApiV1NotificationsRead({
    mutation: { onSuccess: () => void refetch() },
  });

  const notifications = data?.items ?? [];
  const unreadCount = notifications.filter((notification) => notification.readAt === null).length;

  return (
    <div className="notifications">
      <Button
        variant="ghost"
        leftIcon={<Icon name="bell" />}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        data-testid="notification-bell"
      />
      {unreadCount > 0 && (
        <span className="notifications__count" aria-hidden="true">
          {unreadCount}
        </span>
      )}

      {open && (
        <>
          <button
            type="button"
            className="notifications__scrim"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
          <div className="notifications__panel" role="menu">
            <div className="notifications__head">
              <span className="notifications__title">Notifications</span>
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
              <p className="notifications__empty">Nothing yet.</p>
            ) : (
              <ul className="notifications__list">
                {notifications.map((notification) => (
                  <li
                    key={notification.id}
                    className={
                      notification.readAt === null
                        ? "notifications__item notifications__item--unread"
                        : "notifications__item"
                    }
                  >
                    <span className="notifications__itemtitle">
                      {notification.title ?? notification.type}
                    </span>
                    {notification.body && (
                      <span className="notifications__itembody">{notification.body}</span>
                    )}
                    <span className="notifications__itemtime">
                      {relativeTime(notification.createdAt)}
                    </span>
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
