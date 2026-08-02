import type { ReactNode } from "react";
import { useEffect } from "react";
import { classNames } from "@/lib/classNames";
import { Icon } from "@/icons";
import { useModalMotion } from "./useModalMotion";
import styles from "./Modal.module.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Footer actions row. */
  footer?: ReactNode;
  width?: number;
  className?: string;
}

/** Centered dialog over a blurred scrim — the pattern behind profile modals,
 * venue specs, deal editors. Closes on scrim click or Escape. */
export function Modal({ open, onClose, title, children, footer, width = 520, className }: ModalProps) {
  const { rendered, scrim, panel } = useModalMotion(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!rendered) return null;
  return (
    <div ref={scrim} className={styles.scrim} onClick={onClose} role="presentation">
      <div
        ref={panel}
        className={classNames(styles.panel, className)}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        {title && (
          <div className={styles.header}>
            <div className={styles.title}>{title}</div>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
