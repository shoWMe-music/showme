import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import { Checkbox } from "@/components/atoms/Checkbox/Checkbox";
import { Icon } from "@/icons";
import styles from "./TodoItem.module.css";

export interface TodoItemProps {
  text: ReactNode;
  done: boolean;
  onToggle?: (done: boolean) => void;
  /** Shows a trash button on the right when provided. */
  onDelete?: () => void;
  className?: string;
}

/** A todo row from the prototype: a check-box, the task text (struck through and
 * dimmed when done), and an optional delete button. */
export function TodoItem({ text, done, onToggle, onDelete, className }: TodoItemProps) {
  return (
    <div className={classNames(styles.item, className)}>
      <Checkbox checked={done} onChange={onToggle} />
      <span className={classNames(styles.text, done && styles.done)}>{text}</span>
      {onDelete && (
        <button type="button" className={styles.delete} onClick={onDelete} aria-label="Delete task">
          <Icon name="trash" size={16} />
        </button>
      )}
    </div>
  );
}
