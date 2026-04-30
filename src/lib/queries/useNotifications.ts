import { useEffect, useState, useCallback, useMemo } from "react";
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
  const uid = user?.uid ?? "";
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!uid) {
      setNotifications([]);
      return;
    }
    return subscribeNotifications(uid, setNotifications);
  }, [uid]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const markRead = useCallback(
    async (notification: AppNotification) => {
      if (notification.read || !uid) return;
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)),
      );
      await markNotificationRead(uid, notification.id);
    },
    [uid],
  );

  const markAllRead = useCallback(async () => {
    if (!uid) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await markAllNotificationsRead(uid);
  }, [uid]);

  const remove = useCallback(
    async (notification: AppNotification) => {
      if (!uid) return;
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      await deleteNotification(uid, notification.id);
    },
    [uid],
  );

  return { notifications, unreadCount, markRead, markAllRead, remove };
}
