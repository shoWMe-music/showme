import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./SectionHeader.module.css";

export interface SectionHeaderProps {
  /** Mono uppercase eyebrow above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Optional italic serif accent appended to the title (the brand flourish). */
  accent?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned actions (buttons, links). */
  actions?: ReactNode;
  className?: string;
}

/** The page/section masthead: eyebrow → display title (+ optional serif accent)
 * → subtitle, with an actions slot. The core layout rhythm of every screen. */
export function SectionHeader({ eyebrow, title, accent, subtitle, actions, className }: SectionHeaderProps) {
  return (
    <header className={classNames(styles.head, className)}>
      <div className={styles.text}>
        {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
        <h2 className={styles.title}>
          {title} {accent && <span className={styles.accent}>{accent}</span>}
        </h2>
        {subtitle && <p className={styles.sub}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
