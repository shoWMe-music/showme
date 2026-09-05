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
   * May a click on the SCRIM close this dialog? Escape always can — see below.
   *
   * `true` — the default, and right for most modals. A dialog you are only
   * reading, or one whose single control is a button, should get out of the way
   * the moment you look away from it.
   *
   * `false` for a dialog holding UNSAVED INPUT. What stops is the ACCIDENTAL
   * dismissal: a click a millimetre outside the panel, which discards a
   * filled-in form (ClickUp 123qy9rnfyw). The X, the footer's Cancel and Escape
   * all still work.
   *
   * ESCAPE IS NOT GATED BY THIS, and that distinction was got wrong once. This
   * flag first disabled Escape too, which broke the rule
   * `mobile-audit.spec.ts` exists to enforce: *"a dialog you cannot leave is
   * worse than one that overflows — on a phone there is no window chrome and no
   * visible scrim to click past."* Escape is a deliberate, unambiguous "get me
   * out"; nobody presses it by accident, which is exactly what separates it from
   * a stray click. Guarding it would be protecting the user from a decision they
   * made on purpose.
   *
   * A dialog that genuinely must interrogate an Escape — the event wizard, which
   * offers Leave / Save draft / Keep editing — owns its own key handler rather
   * than asking for one here.
   *
   * DELIBERATELY OPT-IN. Making every modal refuse the scrim would be the
   * opposite mistake: most hold nothing worth protecting, and a dialog that will
   * not go away teaches people to hunt for the X.
   */
  dismissOnScrim?: boolean;
}

/** Centered dialog over a blurred scrim — the pattern behind profile modals,
 * venue specs, deal editors. Escape always closes it; a click on the scrim also
 * does unless `dismissOnScrim` is false, which is how a modal holding unsaved
 * input opts out of being dismissed by accident. */
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

  // Escape closes EVERY dialog, `dismissOnScrim` or not. See the prop's doc.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
