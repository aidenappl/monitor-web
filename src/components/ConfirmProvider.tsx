"use client";

import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  /** Label of the affirmative button. Name the verb ("Delete 3 rules"), never "OK". */
  confirmLabel?: string;
  /** Red confirm button. Use for anything that cannot be undone. */
  destructive?: boolean;
  /**
   * Type-to-confirm. When set, the confirm button stays disabled until the user
   * types exactly this string — reserved for the actions whose blast radius is
   * outside this page (revoking a key a fleet ingests through).
   */
  typeToConfirm?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * useConfirm returns an async `confirm(opts)` that resolves true only when the
 * user presses the confirm button. Escape, the backdrop and Cancel all resolve
 * false — dismissal is never agreement.
 *
 * ⚠️ Use this, not `window.confirm`. The native dialog cannot say what will be
 * lost, cannot be styled destructive, and blocks the event loop under it.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setTyped("");
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const blocked = Boolean(pending?.typeToConfirm) && typed !== pending?.typeToConfirm;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => settle(false)}
        title={pending?.title}
        description={pending?.description}
        // Typing a phrase needs the input focused; otherwise the confirm button
        // takes focus so Enter answers the question that was asked.
        initialFocusRef={pending?.typeToConfirm ? undefined : confirmRef}
        widthClass="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => settle(false)}>
              Cancel
            </Button>
            <Button
              ref={confirmRef}
              variant={pending?.destructive ? "destructive" : "primary"}
              disabled={blocked}
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        {pending?.typeToConfirm ? (
          <label className="block text-xs text-secondary">
            Type <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-primary">{pending.typeToConfirm}</code> to confirm
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !blocked) settle(true);
              }}
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 w-full rounded-lg border border-border-strong bg-surface-elevated px-3 py-2 font-mono text-sm text-primary focus:border-accent focus:outline-none"
            />
          </label>
        ) : null}
      </Modal>
    </ConfirmContext.Provider>
  );
}
