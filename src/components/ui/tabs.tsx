"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tabs — the WAI-ARIA tabs pattern, styled as this app's underline tab bar.
 *
 *   const [tab, setTab] = useUrlState("tab", urlEnum(TAB_IDS), { default: "rules" });
 *   <Tabs id="alerts" label="Alert sections" items={TABS} value={tab} onChange={setTab} />
 *   {tab === "rules" && <TabPanel tabsId="alerts" value="rules">…</TabPanel>}
 *
 * The hand-rolled bars it replaces were a row of plain buttons: a screen reader
 * heard "button, button" with no notion of which one was selected or what it
 * controlled, and a keyboard user tabbed through every tab on the way to the
 * content. This gives `role=tablist/tab/tabpanel`, `aria-selected`,
 * `aria-controls`, a roving tabindex (one Tab stop for the whole bar) and
 * ArrowLeft/Right/Home/End. Arrows SELECT as they move (automatic activation):
 * every panel here renders from data already in hand or one fetch away.
 *
 * ⚠️ IT IS CONTROLLED, DELIBERATELY — there is no `urlKey` prop. The page needs
 * the active tab too (to pick the panel, to lazy-load its data), so a component
 * that owned the URL binding would be a second reader of the same param. Bind it
 * with one `useUrlState` call in the page, as above, and the tab survives a
 * reload, a pasted link and Back.
 *
 * Panels are the caller's to render conditionally (`tab === x && …`), so a
 * hidden panel never mounts and never fetches. `aria-controls` on an inactive
 * tab therefore names an element that is not in the DOM yet; that is allowed.
 */

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Trailing count or dot, e.g. firing rules. Rendered inside the tab. */
  badge?: ReactNode;
}

/** The ids a `Tabs` and its `TabPanel`s agree on. */
export function tabIds(tabsId: string, value: string) {
  return { tab: `${tabsId}-tab-${value}`, panel: `${tabsId}-panel-${value}` };
}

interface TabsProps<T extends string> {
  /** Unique on the page; prefixes the tab and panel ids. */
  id: string;
  /** Accessible name of the tablist, e.g. "Alert sections". */
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function Tabs<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
  className,
}: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    switch (e.key) {
      case "ArrowRight":
        next = (index + 1) % items.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(items[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn("border-b border-zinc-200 dark:border-zinc-700", className)}>
      <div
        role="tablist"
        aria-label={label}
        className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {items.map((item, index) => {
          const selected = item.id === value;
          const ids = tabIds(id, item.id);
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={ids.tab}
              aria-selected={selected}
              aria-controls={ids.panel}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
                selected
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200",
              )}
            >
              {item.label}
              {item.badge}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface TabPanelProps {
  /** The `id` passed to the matching `Tabs`. */
  tabsId: string;
  /** The tab this panel belongs to. */
  value: string;
  children: ReactNode;
  className?: string;
}

/**
 * The panel for one tab. Focusable (`tabIndex=0`) per the pattern, so Tab from
 * the tablist lands on the content even when it opens with no control.
 */
export function TabPanel({ tabsId, value, children, className }: TabPanelProps) {
  const ids = tabIds(tabsId, value);
  return (
    <div
      role="tabpanel"
      id={ids.panel}
      aria-labelledby={ids.tab}
      tabIndex={0}
      className={cn("focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}
