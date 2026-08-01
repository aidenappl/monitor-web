import { cn } from "@/lib/utils";

interface BadgeProps {
  variant?: "default" | "success" | "warning" | "error";
  children: React.ReactNode;
  className?: string;
}

/** Badge — ported from lattice-web. */
export function Badge({ variant = "default", children, className }: BadgeProps) {
  const variants = {
    default: "text-secondary",
    success: "text-healthy",
    warning: "text-pending",
    error: "text-failed",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        variants[variant],
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
