import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./SelectCard.module.css";

export interface SelectCardProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}

/** A selectable option card: icon tile + title + description, with a primary-red
 * border + soft tint when selected. Used for the wizard's role and deal-structure
 * pickers, and any single-choice list. */
export function SelectCard({ icon, title, description, selected = false, onSelect, className }: SelectCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={classNames(styles.card, selected && styles.selected, className)}
    >
      {icon && <span className={styles.tile}>{icon}</span>}
      <span className={styles.body}>
        <span className={styles.title}>{title}</span>
        {description && <span className={styles.description}>{description}</span>}
      </span>
    </button>
  );
}
