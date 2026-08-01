"use client";

import { ReactNode, useCallback, useEffect, useRef } from "react";

export interface ModalProps {
  /** Whether the dialog is mounted and visible. */
  open: boolean;

  /**
   * Called when the user dismisses the dialog — Escape, the close button, or a
   * click on the backdrop.
   *
   * ⚠️ Dismissal is always a CANCEL, never a confirm. A dialog that treats a
   * stray backdrop click as agreement is a dialog that deletes things by
   * accident.
   */
  onClose: () => void;

  /** Accessible title. Rendered as the heading and referenced by aria-labelledby. */
  title: ReactNode;

  /** Optional supporting text below the title, referenced by aria-describedby. */
  description?: ReactNode;

  children?: ReactNode;

  /** Footer content, typically buttons. Rendered right-aligned. */
  footer?: ReactNode;

  /**
   * Element to focus when the dialog opens.
   *
   * Defaults to the first focusable element. Pass a ref to put focus somewhere
   * specific — a confirm button, or the first input of a form.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;

  /** Max width. Defaults to `max-w-sm`, which suits a confirmation. */
  widthClass?: string;
}

// Selector for anything focusable inside the dialog. Used both to seed focus and
// to wrap Tab at the edges.
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal is the shared dialog shell: backdrop, panel, focus trap, Escape to
 * close, and focus restoration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT WAS EXTRACTED FROM ConfirmProvider RATHER THAN WRITTEN FRESH.
 *
 * That component already had the accessibility behaviour right — remember the
 * previously-focused element, move focus in on open, wrap Tab at both edges,
 * restore focus on close — and those are exactly the parts people leave out when
 * they write "just a quick modal" for one page. Generalising the working one
 * means the next dialog inherits them instead of reimplementing three of the
 * four.
 *
 * ⚠️ IF YOU ADD A DIALOG, USE THIS. A bare fixed-position div with an overlay
 * looks identical and is unusable with a keyboard: focus stays behind the
 * backdrop, Tab walks into the page underneath, and Escape does nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  widthClass = "max-w-sm",
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // On open: remember what had focus, then move focus into the dialog.
  // On close: put it back where it was.
  //
  // Restoring focus is the half everyone forgets. Without it, dismissing a
  // dialog drops the user at the top of the document and a keyboard user has to
  // tab all the way back to where they were.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      // After paint, so the target exists in the DOM.
      const id = window.requestAnimationFrame(() => {
        if (initialFocusRef?.current) {
          initialFocusRef.current.focus();
          return;
        }
        dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      });
      return () => window.cancelAnimationFrame(id);
    }
    if (previouslyFocused.current) {
      previouslyFocused.current.focus?.();
      previouslyFocused.current = null;
    }
  }, [open, initialFocusRef]);

  // Escape closes; Tab wraps at both edges so focus cannot leave the dialog.
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={description ? "modal-description" : undefined}
        className={`bg-surface border border-border-strong rounded-xl p-5 sm:p-6 w-full ${widthClass} shadow-2xl max-h-[90vh] overflow-y-auto`}
        // Without this, a click anywhere inside the panel bubbles to the backdrop
        // and closes the dialog — including a click on a form field.
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="modal-title" className="text-sm font-semibold text-primary">
          {title}
        </h3>

        {description && (
          <p
            id="modal-description"
            className="text-xs text-secondary mt-2 leading-relaxed"
          >
            {description}
          </p>
        )}

        {children && <div className="mt-4">{children}</div>}

        {footer && <div className="flex gap-2 justify-end mt-5">{footer}</div>}
      </div>
    </div>
  );
}
