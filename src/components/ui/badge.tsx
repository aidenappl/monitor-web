import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

interface BadgeProps {
  variant?: BadgeVariant;
  /**
   * A tinted, rounded chip instead of bare coloured text — for a badge that sits
   * among other chips (a row's "Enabled" / "Secret set") rather than in a sentence.
   */
  pill?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variants: Record<BadgeVariant, string> = {
  default: "text-secondary",
  success: "text-healthy",
  warning: "text-pending",
  error: "text-failed",
  info: "text-info",
};

// The pill's tint, matched to the variant's text colour. Here rather than in a
// caller's className: a caller overriding the colour by class is a cascade-order
// coin toss, which is why the variant set has to be complete.
const pillTints: Record<BadgeVariant, string> = {
  default: "bg-surface-elevated",
  success: "bg-healthy/10",
  warning: "bg-pending/10",
  error: "bg-failed/10",
  info: "bg-info/10",
};

/** Badge — ported from lattice-web; `info` and `pill` are this app's additions. */
export function Badge({ variant = "default", pill = false, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        variants[variant],
        pill && cn("rounded-full px-2 py-0.5", pillTints[variant]),
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * StatusBadge renders a coloured dot plus the status word.
 *
 * ⚠️ THE DOT IS NEVER THE ONLY SIGNAL — the status word is always rendered next
 * to it. A dot alone encodes state in hue, which is invisible to a red-green
 * colour-blind reader and to anyone using a screen reader.
 *
 * The status set here is the SSO surface's, not lattice's full container
 * vocabulary; an unknown value degrades to the neutral style rather than
 * throwing.
 */
const statusVariantMap: Record<string, "success" | "error" | "warning" | "default"> = {
  active: "success",
  enabled: "success",
  ok: "success",
  cached: "success",
  error: "error",
  failed: "error",
  disabled: "default",
  inactive: "default",
  pending: "warning",
  fetching: "warning",
  none: "default",
};

const statusDotMap: Record<string, string> = {
  active: "bg-[#22c55e]",
  enabled: "bg-[#22c55e]",
  ok: "bg-[#22c55e]",
  cached: "bg-[#22c55e]",
  error: "bg-[#ef4444]",
  failed: "bg-[#ef4444]",
  disabled: "bg-[#888888]",
  inactive: "bg-[#888888]",
  pending: "bg-[#eab308]",
  fetching: "bg-[#eab308]",
  none: "bg-[#888888]",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusVariantMap[status] ?? "default"}>
      <span
        className={cn("h-1.5 w-1.5 rounded-full", statusDotMap[status] ?? "bg-[#888888]")}
      />
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
