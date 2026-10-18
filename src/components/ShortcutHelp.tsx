"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Modal } from "@/components/ui/modal";

/**
 * The "?" overlay: every keyboard shortcut the app currently answers to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ PAGE SHORTCUTS ARE REGISTERED BY THE PAGE THAT IMPLEMENTS THEM, NOT LISTED
 * HERE. A help sheet that names keys from a static table goes stale the first
 * time a page drops or renames one, and a documented key that does nothing is
 * worse than an undocumented one that works. So a page that binds keys (the
 * events table's j/k, the issue list's triage keys) calls
 * `useRegisterShortcuts("Issues", [...])` beside its own key handler, and the
 * group appears here while that page is mounted and disappears with it.
 *
 * The global group (palette, help, the g-sequences) is passed in by the Navbar,
 * which is where those keys are actually bound — same rule, one source.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Shortcut = {
  /** Display keys, e.g. ["g", "i"] or ["Mod", "K"]. "Mod" renders as ⌘ or Ctrl. */
  keys: string[];
  /** True when the keys are pressed one after another rather than together. */
  sequence?: boolean;
  description: string;
};

export type ShortcutGroup = { title: string; shortcuts: Shortcut[] };

// ── The page registry ────────────────────────────────────────────────────────

let registered: ShortcutGroup[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => registered;
// ⚠️ ONE array, not `() => []`: useSyncExternalStore compares snapshots by
// identity, and a fresh array per call is "getServerSnapshot should be cached
// to avoid an infinite loop" — rendered by the Navbar on every page.
const NO_PAGE_SHORTCUTS: ShortcutGroup[] = [];
const getServerSnapshot = (): ShortcutGroup[] => NO_PAGE_SHORTCUTS;

/**
 * Lists a page's own shortcuts in the help overlay for as long as the caller is
 * mounted. Pass a STABLE array (a module constant), or the group is re-registered
 * on every render.
 */
export function useRegisterShortcuts(title: string, shortcuts: Shortcut[]) {
  useEffect(() => {
    const group = { title, shortcuts };
    registered = [...registered.filter((g) => g.title !== title), group];
    emit();
    return () => {
      registered = registered.filter((g) => g !== group);
      emit();
    };
  }, [title, shortcuts]);
}

// ── The overlay ──────────────────────────────────────────────────────────────

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

function Keys({ shortcut }: { shortcut: Shortcut }) {
  const mac = isMac();
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shortcut.keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {shortcut.sequence ? "then" : "+"}
            </span>
          )}
          <kbd className="min-w-[1.5rem] rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-center font-mono text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {k === "Mod" ? (mac ? "⌘" : "Ctrl") : k}
          </kbd>
        </span>
      ))}
    </span>
  );
}

export function ShortcutHelp({
  open,
  onClose,
  global,
}: {
  open: boolean;
  onClose: () => void;
  global: ShortcutGroup[];
}) {
  const pages = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const groups = [...global, ...pages];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Shortcuts are ignored while you are typing in a field. Press Escape to close any menu or dialog."
      widthClass="max-w-lg"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Close
        </button>
      }
    >
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.title}>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {group.title}
            </h4>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {group.shortcuts.map((s) => (
                <li
                  key={s.keys.join(" ") + s.description}
                  className="flex items-center justify-between gap-4 py-1.5 text-sm text-zinc-700 dark:text-zinc-300"
                >
                  <span>{s.description}</span>
                  <Keys shortcut={s} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
