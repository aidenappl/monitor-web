import { InputHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /** Helper text below the field. Suppressed while `error` is set. */
  hint?: string;
}

/**
 * Input — ported from lattice-web, with two accessibility fixes applied on the
 * way over rather than after.
 *
 *  1. `id` is generated when the caller does not pass one. lattice's version
 *     renders `htmlFor={undefined}`, which silently produces a label bound to
 *     nothing — it looks correct and does not associate.
 *  2. The error is wired with `aria-describedby` and `aria-invalid`, so a screen
 *     reader announces WHY the field was rejected instead of only showing red.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const generated = useId();
    const inputId = id ?? generated;
    const msgId = `${inputId}-msg`;
    const msg = error ?? hint;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium text-secondary uppercase tracking-wider"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={msg ? msgId : undefined}
          className={cn(
            "h-9 w-full rounded-lg border border-border-strong bg-surface-elevated px-3 text-sm text-primary placeholder:text-muted",
            "focus:border-border-emphasis focus:outline-none focus:ring-1 focus:ring-accent/40",
            "disabled:cursor-not-allowed disabled:opacity-40",
            error && "border-red-600/50 focus:border-red-600/50 focus:ring-red-600/20",
            className,
          )}
          {...props}
        />
        {msg && (
          <p id={msgId} className={cn("text-xs", error ? "text-destructive" : "text-muted")}>
            {msg}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
