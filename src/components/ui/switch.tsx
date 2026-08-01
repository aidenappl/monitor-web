"use client";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;

  /**
   * Accessible name.
   *
   * ⚠️ Required, and deliberately not optional. A switch with no label is
   * announced by a screen reader as "switch, on" with no indication of what it
   * controls. When the switch sits next to visible text, point `labelledBy` at
   * that element's id instead so the name is not duplicated.
   */
  label?: string;
  labelledBy?: string;

  /** Extra classes on the track. */
  className?: string;
}

/**
 * Switch is a two-state toggle.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXTRACTED FROM TWO INLINE COPIES on the authentication page, which had drifted
 * apart in exactly the way duplicated markup does: same visual, but neither
 * carried an accessible name, and a fix applied to one would not have reached
 * the other.
 *
 * It renders a real `<button role="switch">` with `aria-checked` rather than a
 * styled checkbox, because a switch is not a checkbox — a screen reader
 * announces it as on/off rather than checked/unchecked, and that is what a
 * setting toggle means.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  labelledBy,
  className = "",
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        // A visible focus ring is not decoration: this is a button with no text,
        // so without it a keyboard user cannot tell which control they are on.
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        checked ? "bg-healthy" : "bg-surface-active border border-border-strong",
        className,
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}
