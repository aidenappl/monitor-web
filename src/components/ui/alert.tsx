"use client";

import { cn } from "@/lib/utils";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@awesome.me/kit-c2d31bb269/icons/classic/solid";

type AlertVariant = "error" | "warning" | "info" | "success";

const variants: Record<AlertVariant, { container: string; dot: string }> = {
  error: { container: "border-[#ef4444]/20 bg-[#ef4444]/5", dot: "bg-[#ef4444]" },
  warning: { container: "border-[#f59e0b]/20 bg-[#f59e0b]/5", dot: "bg-[#f59e0b]" },
  info: { container: "border-[#3b82f6]/20 bg-[#3b82f6]/5", dot: "bg-[#3b82f6]" },
  success: { container: "border-[#22c55e]/20 bg-[#22c55e]/5", dot: "bg-[#22c55e]" },
};

interface AlertProps {
  variant?: AlertVariant;
  children: React.ReactNode;
  className?: string;
  onDismiss?: () => void;
}

/**
 * Alert — ported from lattice-web.
 *
 * `role="alert"` on the error and warning variants only: it interrupts a screen
 * reader mid-sentence, which is right for "your save failed" and wrong for an
 * informational note that happens to be on the page at load.
 */
export function Alert({ variant = "info", children, className, onDismiss }: AlertProps) {
  const v = variants[variant];
  const assertive = variant === "error" || variant === "warning";

  return (
    <div
      role={assertive ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm",
        v.container,
        className,
      )}
    >
      <span className={cn("mt-0.5 h-2 w-2 rounded-full shrink-0", v.dot)} />
      <span className="text-subtle flex-1 text-xs leading-relaxed">{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-muted hover:text-primary transition-colors shrink-0 cursor-pointer"
        >
          <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
