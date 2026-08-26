import { Button, Modal } from "@showme/design-system";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * The app's "are you sure?" — a real modal in the app's own chrome, replacing the
 * native `window.confirm()` that used to guard removals on the Team screen.
 *
 * A native confirm is the browser's dialog, not the product's: it wears the
 * origin ("127.0.0.1:5180 says"), it cannot be styled or themed, it says "OK"
 * where the answer is "Remove group", and it blocks the whole page while it is
 * up. This one is the same Modal every other panel in the app is built from, so
 * a destructive question looks like it belongs to the screen that asked it.
 *
 * One component, not one per question: the ask differs only in its words, and a
 * bespoke dialog per removal is three chances to get the keyboard behaviour
 * wrong. Drive it with {@link useConfirmDialog}.
 */

export interface ConfirmDialogRequest {
  title: string;
  /** What will happen AND what will not — the precision is the whole point. */
  body: ReactNode;
  /** Names the action, never "OK": the button must read as its consequence. */
  confirmLabel: string;
  /** Removals and anything else that cannot be undone from the screen asking. */
  destructive?: boolean;
  onConfirm: () => void;
}

export interface ConfirmDialogProps {
  open: boolean;
  /** The question being asked. Survives `open` going false — see the hook. */
  request: ConfirmDialogRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Holds the one pending question and answers it.
 *
 * `open` is separate state from `request` on purpose. The design-system Modal
 * keeps rendering through its exit tween (`useModalMotion`), so a request
 * cleared at close time would blank the dialog's own title and body for the
 * ~200ms it is still on screen. The question therefore outlives the closing and
 * is replaced only by the next `ask`.
 */
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmDialogRequest | null>(null);
  const [open, setOpen] = useState(false);

  const ask = useCallback((next: ConfirmDialogRequest) => {
    setRequest(next);
    setOpen(true);
  }, []);

  const cancel = useCallback(() => setOpen(false), []);

  const confirm = useCallback(() => {
    setOpen(false);
    request?.onConfirm();
  }, [request]);

  return {
    ask,
    dialogProps: {
      open,
      request,
      onCancel: cancel,
      onConfirm: confirm,
    } satisfies ConfirmDialogProps,
  };
}

export function ConfirmDialog({ open, request, onCancel, onConfirm }: ConfirmDialogProps) {
  const destructive = request?.destructive ?? false;
  const setBody = useConfirmDialogKeyboard(open, destructive);

  if (!request) return null;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={request.title}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} data-confirm-dialog="cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            data-confirm-dialog="confirm"
            // Flat brand red rather than the standard warm gradient: a button
            // that deletes something should not look like every other primary.
            style={destructive ? destructiveButtonStyle : undefined}
          >
            {request.confirmLabel}
          </Button>
        </>
      }
    >
      {/* A <div>, not a <p>. `body` is a ReactNode and this component's own
          contract asks it to carry "what will happen AND what will not" — which
          invites paragraphs and lists. A <p> cannot legally contain block
          elements, so callers were forced to fake structure with `display:
          block` spans, and a browser would silently close the paragraph early
          around anything genuinely block-level. */}
      <div ref={setBody} style={bodyStyle}>
        {request.body}
      </div>
    </Modal>
  );
}

/**
 * Keyboard and focus for the dialog, which the design-system Modal does not do:
 * it closes on Escape but never moves focus in, traps nothing, and gives nothing
 * back on the way out. A confirm is exactly the dialog where that matters —
 * answering it is the only thing the user may do next.
 *
 * Returns a callback ref for the dialog body. It has to be a ref CALLBACK rather
 * than a plain `useRef`: the Modal mounts its portal one render after `open`
 * turns true, so an effect reading a ref object would still see `null`.
 */
function useConfirmDialogKeyboard(open: boolean, destructive: boolean) {
  const [body, setBody] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      // Remembered before focus moves, so cancelling puts the user back on the
      // control they pressed rather than at the top of the document.
      trigger.current = document.activeElement as HTMLElement | null;
      return;
    }
    const previous = trigger.current;
    trigger.current = null;
    // A trigger inside a menu that closed with the ask is gone by now; focusing
    // a detached node would silently move focus to <body> instead.
    if (previous?.isConnected) previous.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !body) return;
    const panel = body.closest<HTMLElement>('[role="dialog"]');
    if (!panel) return;

    // Destructive asks open on Cancel: a stray Enter from the click that opened
    // the dialog must not be what deletes the thing. A harmless ask opens on its
    // confirm, which is what someone who just chose the action expects.
    const landing = panel.querySelector<HTMLElement>(
      `[data-confirm-dialog="${destructive ? "cancel" : "confirm"}"]`,
    );

    // The panel spends its first ~100ms at GSAP's `autoAlpha: 0`, which is
    // `visibility: hidden` — and an invisible element silently refuses focus.
    // So ask each frame until it takes, rather than guessing a delay that would
    // be wrong on a slow machine and wasteful on a fast one. Bounded, so a panel
    // that never becomes focusable cannot spin forever.
    let framesLeft = 40;
    let frame = 0;
    const focusLanding = () => {
      landing?.focus();
      if (landing && document.activeElement !== landing && framesLeft > 0) {
        framesLeft -= 1;
        frame = requestAnimationFrame(focusLanding);
      }
    };
    frame = requestAnimationFrame(focusLanding);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, select"),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // On the panel, not the document: it only ever fires while focus is already
    // inside, which is the condition the wrap-around is for.
    panel.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      panel.removeEventListener("keydown", onKeyDown);
    };
  }, [open, body, destructive]);

  return setBody;
}

const bodyStyle: CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  fontSize: 13,
  lineHeight: 1.55,
};

const destructiveButtonStyle: CSSProperties = {
  background: "var(--brand-red)",
};
