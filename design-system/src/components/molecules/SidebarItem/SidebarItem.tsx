import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import { useSidebarItemMotion } from "./useSidebarItemMotion";
import styles from "./SidebarItem.module.css";

export interface SidebarItemProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  /** Collapsed rail: icon only (label still used as title/tooltip). */
  collapsed?: boolean;
  /** Red count bubble (e.g. unread). */
  badge?: number | string;
  /** Mono micro-tag on the right (e.g. "NEW"). */
  tag?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * The operator ("All View") sidebar nav item: active shows a red→gold fade and
 * a glowing left marker bar. Motion lives in useSidebarItemMotion so this stays
 * presentational. Render inside a container with ≥14px left padding so the
 * marker (left:-14px) shows.
 */
export function SidebarItem({ icon, label, active, collapsed, badge, tag, onClick, className }: SidebarItemProps) {
  const motion = useSidebarItemMotion(active);
  return (
    <button
      ref={motion.root}
      type="button"
      onClick={onClick}
      onMouseEnter={motion.handlePointerEnter}
      onMouseLeave={motion.handlePointerLeave}
      onFocus={motion.handlePointerEnter}
      onBlur={motion.handlePointerLeave}
      title={label}
      aria-current={active ? "page" : undefined}
      className={classNames(styles.item, active && styles.active, collapsed && styles.collapsed, className)}
    >
      <span ref={motion.marker} className={styles.marker} aria-hidden="true" />
      <span ref={motion.background} className={styles.background} aria-hidden="true" />
      <span ref={motion.content} className={styles.content}>
        <span ref={motion.icon} className={styles.icon}>{icon}</span>
        {!collapsed && <span className={styles.label}>{label}</span>}
        {!collapsed && tag && <span className={styles.tag}>{tag}</span>}
        {!collapsed && badge != null && badge !== 0 && <span className={styles.badge}>{badge}</span>}
      </span>
    </button>
  );
}
