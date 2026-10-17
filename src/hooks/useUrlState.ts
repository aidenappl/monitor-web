"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PROJECT_PARAM, ZONE_PARAM } from "@/tools/routing.tools";

/**
 * useUrlState — a piece of page state that lives in the query string.
 *
 *   const [status, setStatus] = useUrlState("status", urlEnum(STATUSES), { default: "unresolved" });
 *   const [q, setQ] = useUrlState("q", urlString, { default: "", debounceMs: 300 });
 *
 * WHY: a filter, tab or page offset held in `useState` is lost on reload, on
 * back/forward, and in every link someone pastes into chat — the recipient lands
 * on the defaults and sees a different list from the one being discussed. In the
 * URL, the address bar IS the state.
 *
 * Behaviour:
 *  - Reads `?key` through the codec; anything missing or unparseable is the
 *    `default`. A value equal to the default is OMITTED from the URL, so an
 *    untouched page has a clean address.
 *  - Writes keep every other param exactly as it is — `?project` included.
 *  - Setters called in the same tick (a "clear filters" handler setting five
 *    keys) coalesce into ONE history write. There is no `useUrlStates`; call
 *    the setters one after another.
 *  - `debounceMs` holds the URL write until typing pauses. The returned value
 *    updates immediately either way, so a text input never lags its keystrokes.
 *  - `history: "push"` adds a history entry per write (Back undoes it); the
 *    default `"replace"` does not.
 *  - Back/forward and link navigation win over an unflushed local edit: the
 *    edit is dropped and its pending write cancelled.
 *
 * ⚠️ IT WRITES WITH `window.history.replaceState/pushState`, NOT `router.replace`.
 * Next integrates the native calls with `useSearchParams`, and they are the only
 * way to change the query string without a server round trip: every `[zone]`
 * route is dynamic, so `router.replace` refetched the RSC payload — and re-ran
 * the zone layout's registry check — on every keystroke of a search box. The
 * native call also updates `window.location` synchronously, which is what makes
 * same-tick batching safe.
 *
 * ⚠️ NEVER USE IT FOR `project` OR `zone`. Those are the scope, owned by
 * `ScopeSwitcher` (it writes them) and `useScope()` (pages read them). A scope
 * change must REMOUNT the page through `ScopeBoundary`; a hook that set
 * `?project` in place would relabel the page and refetch nothing — the exact bug
 * `scripts/guards.mjs` guard 1 exists for. The hook throws on either key.
 *
 * ⚠️ A SCOPE CHANGE STILL RESETS URL STATE TO WHAT THE URL SAYS. `ScopeSwitcher`
 * keeps the other query params on a project switch, so after the remount the
 * page re-reads its filters from the URL and they survive. A zone switch drops
 * them on purpose (see AGENTS.md §6).
 *
 * ⚠️ `useSearchParams` NEEDS A SUSPENSE BOUNDARY above the component during
 * prerender. Every `[zone]` page already has one (`[zone]/layout.tsx`); a
 * zone-agnostic page that uses this must add its own.
 *
 * Returned values are referentially stable until the param changes, so an array
 * from `urlCsv` is safe in an effect's dependency list.
 */

/** How one param is read from and written to the query string. */
export interface UrlCodec<T> {
  /** `undefined` means "not a valid value" — the hook falls back to the default. */
  parse: (raw: string) => T | undefined;
  /** `null` omits the param. */
  serialize: (value: T) => string | null;
}

/** Free text. The empty string is omitted. */
export const urlString: UrlCodec<string> = {
  parse: (raw) => raw,
  serialize: (value) => (value === "" ? null : value),
};

/** A safe integer: offsets, limits. Anything else falls back to the default. */
export const urlInt: UrlCodec<number> = {
  parse: (raw) => {
    if (!/^-?\d+$/.test(raw)) return undefined;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : undefined;
  },
  serialize: (value) => String(value),
};

/** `1`/`0` on the wire; `true`/`false` are accepted on the way in. */
export const urlBool: UrlCodec<boolean> = {
  parse: (raw) =>
    raw === "1" || raw === "true" ? true : raw === "0" || raw === "false" ? false : undefined,
  serialize: (value) => (value ? "1" : "0"),
};

/**
 * One of a fixed set — a tab, a status, a sort. A stale or hand-edited value
 * (`?tab=gone`) reads as the default instead of rendering a page with no tab.
 */
export function urlEnum<T extends string>(values: readonly T[]): UrlCodec<T> {
  return {
    parse: (raw) => ((values as readonly string[]).includes(raw) ? (raw as T) : undefined),
    serialize: (value) => value,
  };
}

/**
 * A comma-separated list (`?service=api,web`). Blank entries are dropped and an
 * empty list is omitted. Values must not themselves contain commas.
 */
export const urlCsv: UrlCodec<string[]> = {
  parse: (raw) =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  serialize: (value) => (value.length > 0 ? value.join(",") : null),
};

export interface UrlStateOptions<T> {
  default: T;
  /** `"replace"` (default) rewrites the current entry; `"push"` adds one. */
  history?: "replace" | "push";
  /** Hold the URL write until this many ms pass without a change. Text inputs. */
  debounceMs?: number;
}

// ─── The write queue ────────────────────────────────────────────────────────
//
// Module-level so every hook instance on the page shares it: setters fired in
// the same tick land as one history entry instead of N, and none overwrites a
// sibling's write with a stale copy of the query string.

interface Patch {
  key: string;
  value: string | null;
  /** The page the write was made on. A write that outlives it is dropped. */
  pathname: string;
  push: boolean;
}

let queue: Patch[] = [];

function flushQueue() {
  const patches = queue;
  queue = [];
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  let push = false;
  let touched = false;
  for (const p of patches) {
    // Navigated away between the edit and the flush: the param belongs to a
    // page that is gone, and writing it would put a filter on someone else's URL.
    if (p.pathname !== pathname) continue;
    if (p.value === null) params.delete(p.key);
    else params.set(p.key, p.value);
    push ||= p.push;
    touched = true;
  }
  if (!touched) return;
  const qs = params.toString();
  if (qs === search.replace(/^\?/, "")) return;
  const url = `${pathname}${qs ? `?${qs}` : ""}${hash}`;
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

function enqueue(patch: Patch) {
  if (queue.length === 0) queueMicrotask(flushQueue);
  queue.push(patch);
}

// ─── The hook ───────────────────────────────────────────────────────────────

/**
 * A local edit the URL has not caught up with yet. `written` lists what this
 * edit has already flushed, so the URL echoing our own write back is told apart
 * from somebody else navigating.
 */
interface Draft<T> {
  value: T;
  written: (string | null)[];
}

interface Snapshot<T> {
  raw: string | null;
  value: T;
  draft: Draft<T> | null;
}

export function useUrlState<T>(
  key: string,
  codec: UrlCodec<T>,
  // NoInfer: T comes from the codec, so `default: "rules"` cannot widen an
  // enum to `string`.
  options: UrlStateOptions<NoInfer<T>>,
): [T, (next: T | ((prev: T) => T)) => void] {
  if (key === PROJECT_PARAM || key === ZONE_PARAM) {
    throw new Error(
      `useUrlState("${key}") — "${key}" is the scope, not page state. Read it with ` +
        "useScope(); only ScopeSwitcher writes it, so that a change remounts the page.",
    );
  }

  const { default: fallback, debounceMs, history = "replace" } = options;
  const raw = useSearchParams().get(key);

  const decode = (r: string | null): T => {
    if (r === null) return fallback;
    const parsed = codec.parse(r);
    return parsed === undefined ? fallback : parsed;
  };
  const encode = (value: T): string | null => {
    const s = codec.serialize(value);
    // Equal to the default → omit, so an untouched page has a clean URL.
    return s === codec.serialize(fallback) ? null : s;
  };

  const [snapshot, setSnapshot] = useState<Snapshot<T>>(() => ({
    raw,
    value: decode(raw),
    draft: null,
  }));

  // The param moved. Adjusted during render (React's "derive state from props"
  // pattern) rather than in an effect, so there is never a frame showing the old
  // value under the new URL.
  let current = snapshot;
  if (snapshot.raw !== raw) {
    let draft = snapshot.draft;
    if (draft) {
      if (draft.written.includes(raw)) {
        // Our own write echoing back. Keep the draft only if the user has typed
        // past it since.
        draft = encode(draft.value) === raw ? null : draft;
      } else {
        // Back/forward or a link: the URL wins over an unflushed edit.
        draft = null;
      }
    }
    current = { raw, value: decode(raw), draft };
    setSnapshot(current);
  }
  const value = current.draft ? current.draft.value : current.value;

  const valueRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // A dropped draft takes its pending write with it, or the timer would fire
  // after Back and put the abandoned edit straight back into the URL.
  const hasDraft = current.draft !== null;
  useEffect(() => {
    if (!hasDraft && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [hasDraft]);
  // Unmount (including a ScopeBoundary remount) cancels a pending write.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Read at flush time through a ref, so the setter stays stable even when the
  // caller passes an inline codec or default.
  const encodeRef = useRef(encode);
  useEffect(() => {
    encodeRef.current = encode;
  });

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === "function" ? (next as (prev: T) => T)(valueRef.current) : next;
      valueRef.current = resolved;
      setSnapshot((prev) => ({
        ...prev,
        draft: { value: resolved, written: prev.draft?.written ?? [] },
      }));

      const pathname = window.location.pathname;
      const flush = () => {
        timerRef.current = null;
        const serialized = encodeRef.current(resolved);
        setSnapshot((prev) =>
          prev.draft
            ? { ...prev, draft: { ...prev.draft, written: [...prev.draft.written, serialized] } }
            : prev,
        );
        enqueue({ key, value: serialized, pathname, push: history === "push" });
      };

      if (timerRef.current) clearTimeout(timerRef.current);
      if (debounceMs && debounceMs > 0) {
        timerRef.current = setTimeout(flush, debounceMs);
      } else {
        flush();
      }
    },
    [key, history, debounceMs],
  );

  return [value, setValue];
}
