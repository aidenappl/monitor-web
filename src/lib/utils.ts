/**
 * cn joins conditional class names.
 *
 * ⚠️ Deliberately NOT clsx + tailwind-merge, which is what lattice-web uses.
 * Adding two runtime dependencies to two apps for string concatenation is not a
 * trade worth making here, and the primitives ported alongside this helper put
 * `className` LAST in every `cn(...)` call — so a caller's utility already wins
 * on specificity order without a merge step. If a genuine conflict-resolution
 * case turns up, that is the moment to reach for tailwind-merge, not before.
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
