import toast from "react-hot-toast";
import type { ApiResult } from "@/types/auth.types";

export interface BulkFailure<T> {
  item: T;
  error: string;
}

export interface BulkResult<T> {
  succeeded: T[];
  failed: BulkFailure<T>[];
}

/**
 * runBulk applies one request per item with bounded concurrency and collects
 * every outcome — it never stops at the first failure, because a bulk action
 * that half-applies and then hides which half is worse than one that reports
 * exactly what it did.
 *
 * ⚠️ NOT FOR ISSUES. Issue bulk updates go through `POST /v1/issues/bulk`
 * (`reqBulkUpdateIssues`), which moves up to 1000 rows per call server-side.
 * This fan-out is for the small, hand-managed collections (rules, channels,
 * keys, views, dashboards, users) that have no bulk endpoint and never hold
 * more than a few dozen rows.
 *
 * `fetchApi` returns failures as values, so a non-2xx lands in `failed` with the
 * server's own message; a throw is caught and recorded the same way.
 */
export async function runBulk<T>(
  items: T[],
  fn: (item: T) => Promise<ApiResult<unknown>>,
  concurrency = 4,
): Promise<BulkResult<T>> {
  const result: BulkResult<T> = { succeeded: [], failed: [] };
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        const res = await fn(item);
        if (res.success) result.succeeded.push(item);
        else result.failed.push({ item, error: res.error_message || "The request failed." });
      } catch (err) {
        result.failed.push({ item, error: err instanceof Error ? err.message : "The request failed." });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}

/**
 * Toasts a bulk outcome in one message: all succeeded, all failed, or the split
 * with the first error — so a partial failure is never shown as a green toast.
 */
export function toastBulkResult<T>(result: BulkResult<T>, verbPast: string, noun: string) {
  const ok = result.succeeded.length;
  const bad = result.failed.length;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  if (bad === 0) {
    toast.success(`${verbPast} ${plural(ok)}`);
  } else if (ok === 0) {
    toast.error(`Could not update ${plural(bad)}: ${result.failed[0].error}`);
  } else {
    toast.error(`${verbPast} ${plural(ok)}; ${bad} failed: ${result.failed[0].error}`);
  }
}
