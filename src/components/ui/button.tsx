import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@awesome.me/kit-c2d31bb269/icons/classic/solid";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "destructive" | "warning" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

/**
 * Button — ported from lattice-web.
 *
 * ⚠️ ONE VARIANT DIFFERS ON PURPOSE. lattice-web's `primary` is
 * `bg-white text-black`, which reads as high-contrast only because that app is
 * dark by default. This app is light by default, where a white button on a white
 * card is invisible. `primary` here is the accent fill instead — the same
 * intent (this is the affirmative action) expressed for this app's background.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", disabled, loading, children, ...props },
    ref,
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40 disabled:cursor-not-allowed";

    const variants = {
      primary: "bg-accent text-white hover:bg-accent-hover",
      secondary:
        "border border-border-strong bg-surface text-primary hover:bg-surface-elevated",
      destructive:
        "bg-red-600/10 border border-red-600/30 text-destructive hover:bg-red-600/20 hover:border-red-600/50",
      warning:
        "bg-yellow-600/10 border border-yellow-600/30 text-pending hover:bg-yellow-600/20 hover:border-yellow-600/50",
      ghost: "text-secondary hover:bg-surface-elevated hover:text-primary",
    };

    const sizes = {
      sm: "h-7 px-3 text-xs",
      md: "h-8 px-3.5 text-sm",
      lg: "h-10 px-5 text-sm",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], loading && "gap-1.5", className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <FontAwesomeIcon icon={faSpinner} className="h-3.5 w-3.5 animate-spin" />}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
