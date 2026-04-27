import { useEffect, useState, useCallback, useMemo } from "react";
import { useUser } from "@/lib/user-context";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "@/lib/db";
import type { AppNotification } from "@/lib/models";

export function useNotifications() {
  const { user } = useAuth();
  const { profiles } = useUser();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Get profile IDs the user is a member of (exclude unclaimed stub profiles)
  const profileIds = useMemo(
    () =>
      Object.values(profiles)
        .filter((p) => !(p as Record<string, unknown>).unclaimed)
        .map((p) => p.id)
        .filter((id): id is string => !!id),
    [profiles],
  );

  // Subscribe to real-time notifications across all profiles
  useEffect(() => {
    if (!user?.uid || profileIds.length === 0) {
      setNotifications([]);
      return;
    }

    const unsub = subscribeNotifications(profileIds, setNotifications);
    return unsub;
  }, [user?.uid, profileIds]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const markRead = useCallback(
    async (notification: AppNotification) => {
      if (notification.read) return;
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)),
      );
      await markNotificationRead(notification.profileId, notification.id);
    },
    [],
  );

  const markAllRead = useCallback(async () => {
    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    // Mark read across all profiles that have unread notifications
    const profilesWithUnread = new Set(
      notifications.filter((n) => !n.read).map((n) => n.profileId),
    );
    await Promise.all(
      Array.from(profilesWithUnread).map((pid) => markAllNotificationsRead(pid)),
    );
  }, [notifications]);

  const remove = useCallback(
    async (notification: AppNotification) => {
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      await deleteNotification(notification.profileId, notification.id);
    },
    [],
  );

  return { notifications, unreadCount, markRead, markAllRead, remove };
}
