import type { ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
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
  /**
   * May a click on the scrim, or Escape, close this dialog?
   *
   * `true` — the default, and right for most modals. A dialog you are only
   * reading, or one whose single control is a button, should get out of the way
   * the moment you look away from it.
   *
   * `false` for a dialog holding UNSAVED INPUT. The X and the footer's own
   * Cancel still work; what stops is the accidental dismissal — a click a
   * millimetre outside the panel, or an Escape aimed at a dropdown that had
   * already closed. That gesture discarding a filled-in form is ClickUp
   * 123qy9rnfyw, and the reason this flag exists.
   *
   * DELIBERATELY OPT-IN. Making every modal in the app refuse to close on the
   * scrim would be the opposite mistake: most of them hold nothing worth
   * protecting, and a dialog that will not go away teaches people to hunt for
   * the X. The modals that guard themselves are the ones that have something to
   * lose.
   */
  dismissOnScrim?: boolean;
}

/** Centered dialog over a blurred scrim — the pattern behind profile modals,
 * venue specs, deal editors. Closes on scrim click or Escape unless
 * `dismissOnScrim` is false, which is how a modal holding unsaved input opts out
 * of being dismissed by accident. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
  className,
  dismissOnScrim = true,
}: ModalProps) {
  const { rendered, scrim, panel } = useModalMotion(open);

  useEffect(() => {
    if (!open || !dismissOnScrim) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, dismissOnScrim]);

  if (!rendered || typeof document === "undefined") return null;
  // Portal to <body> so the fixed scrim covers the WHOLE viewport (sidebar + top
  // bar included). Rendered inline, a transformed ancestor (the page-transition
  // wrapper) becomes the containing block and clips the scrim to the main region.
  return createPortal(
    <div
      ref={scrim}
      className={styles.scrim}
      onClick={dismissOnScrim ? onClose : undefined}
      role="presentation"
    >
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
            <button
              type="button"
              className={classNames(styles.close, "touch-target-overlay")}
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
