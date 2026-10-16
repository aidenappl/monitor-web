"use client";

import { useState, useEffect, useId, useRef, type KeyboardEvent } from "react";
import { AnalyticsFilter, FilterOperator } from "@/types";
import { getDataKeys, getDataValues, getLabelValues } from "@/services/api";
import { firstError } from "@/services/api.service";
import { FailureNote } from "@/components/FailureState";
import { reportError } from "@/services/monitor.service";
import { TimeRange, suggestionWindow, withSelected } from "@/tools/timeRange.tools";

/** Label values a page has already loaded and hands down instead of refetching. */
export interface AnalyticsFilterOptions {
  service?: string[];
  level?: string[];
  env?: string[];
}

interface AnalyticsFiltersProps {
  filters: AnalyticsFilter[];
  onFiltersChange: (filters: AnalyticsFilter[]) => void;
  /**
   * Suggestions the page already holds. When passed, this component NEVER
   * fetches its own — the dashboard loads these same three lists for its
   * variables, and fetching them twice on one mount was pure waste.
   */
  options?: AnalyticsFilterOptions;
  /** The page's failure for `options`, shown where they are consumed. */
  optionsError?: string | null;
  /** Retries the page's load of `options`. */
  onRetryOptions?: () => void;
  /** The page's selected range; suggestions are read over it. */
  range?: TimeRange;
}

const FILTER_FIELDS = [
  { value: "service", label: "Service" },
  { value: "env", label: "Environment" },
  { value: "name", label: "Event Name" },
  { value: "level", label: "Level" },
  { value: "user_id", label: "User ID" },
  { value: "trace_id", label: "Trace ID" },
  { value: "job_id", label: "Job ID" },
];

/** The field `<select>` value standing for "a key inside the event's data". */
const DATA_FIELD = "__data__";
const DATA_PREFIX = "data.";

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "contains", label: "contains" },
  { value: "startswith", label: "starts with" },
  { value: "endswith", label: "ends with" },
  { value: "in", label: "in" },
];

/**
 * Numeric comparisons. Offered for `data.*` keys only: every built-in field is
 * a string, and `service < 5` is a question with no answer.
 */
const NUMERIC_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
];

const isNumericOp = (op: FilterOperator) =>
  op === "lt" || op === "lte" || op === "gt" || op === "gte";

function operatorLabel(op: FilterOperator): string {
  return (
    [...OPERATORS, ...NUMERIC_OPERATORS].find((o) => o.value === op)?.label ?? op
  );
}

/** "Service", "User ID", or the data key itself ("data.duration_ms"). */
function fieldLabel(field: string): string {
  return FILTER_FIELDS.find((f) => f.value === field)?.label ?? field;
}

function valueLabel(value: AnalyticsFilter["value"]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function describeFilter(f: AnalyticsFilter): string {
  return `${fieldLabel(f.field)} ${operatorLabel(f.operator)} ${valueLabel(f.value)}`;
}

function sameFilter(a: AnalyticsFilter, b: AnalyticsFilter): boolean {
  return (
    a.field === b.field &&
    a.operator === b.operator &&
    JSON.stringify(a.value) === JSON.stringify(b.value)
  );
}

interface Draft {
  /** A FILTER_FIELDS value, or DATA_FIELD. */
  field: string;
  /** The key after `data.` when field is DATA_FIELD. */
  dataKey: string;
  operator: FilterOperator;
  value: string;
}

const EMPTY_DRAFT: Draft = { field: "service", dataKey: "", operator: "eq", value: "" };

function draftFrom(f: AnalyticsFilter): Draft {
  const builtIn = FILTER_FIELDS.some((x) => x.value === f.field);
  return {
    field: builtIn ? f.field : DATA_FIELD,
    dataKey: builtIn
      ? ""
      : f.field.startsWith(DATA_PREFIX)
        ? f.field.slice(DATA_PREFIX.length)
        : f.field,
    operator: f.operator,
    value: valueLabel(f.value),
  };
}

const CONTROL =
  "px-2 py-1 text-base sm:text-sm bg-transparent border-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 text-zinc-700 dark:text-zinc-300";

export function AnalyticsFilters({
  filters,
  onFiltersChange,
  options,
  optionsError: pageOptionsError,
  onRetryOptions,
  range,
}: AnalyticsFiltersProps) {
  const [services, setServices] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [envs, setEnvs] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  /** The chip being edited in the form; null when the form adds a new one. */
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newFilter, setNewFilter] = useState<Draft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const firstControlRef = useRef<HTMLSelectElement>(null);
  const idBase = useId();

  const [ownOptionsError, setOwnOptionsError] = useState<string | null>(null);
  const [optionsToken, setOptionsToken] = useState(0);
  /**
   * Set by the first "Add Filter" click and never reset. The suggestions are
   * only read inside the add form, so loading them on mount spent three label
   * scans on every analytics and dashboard load for a form that is usually
   * never opened. Once opened, a range change refreshes them as before.
   */
  const [suggestActive, setSuggestActive] = useState(false);
  const pageOwned = options !== undefined;
  const labelsWindow = suggestionWindow("labels", range);

  /**
   * The load this component's own suggestions are for, and the last one that
   * settled (succeeded or failed).
   *
   * ⚠️ LOADING IS DERIVED, NOT SET. Flipping a boolean to true at the top of the
   * effect is a synchronous setState in an effect body, which
   * `react-hooks/set-state-in-effect` rejects. Comparing the live key against the
   * settled one needs only the write after the `await`, and a superseded load
   * (range change, retry) reads as loading until ITS answer lands.
   */
  const loadKey = `${labelsWindow}#${optionsToken}`;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const optionsLoading = !pageOwned && suggestActive && settledKey !== loadKey;

  // These three feed the value suggestions on every filter chip. Empty
  // suggestions look like a project with no services in it, so the failure has
  // to be visible rather than only in the console.
  useEffect(() => {
    if (pageOwned || !suggestActive) return;
    let cancelled = false;
    const loadOptions = async () => {
      try {
        const [servicesRes, levelsRes, envsRes] = await Promise.all([
          getLabelValues("service", { window: labelsWindow }),
          getLabelValues("level", { window: labelsWindow }),
          getLabelValues("env", { window: labelsWindow }),
        ]);
        // The range can change while these are in flight.
        if (cancelled) return;
        const failed = firstError(servicesRes, levelsRes, envsRes);
        if (failed) {
          setOwnOptionsError(failed.error_message || "The request failed.");
          return;
        }
        setOwnOptionsError(null);
        setServices(servicesRes.success ? servicesRes.data : []);
        setLevels(levelsRes.success ? levelsRes.data : []);
        setEnvs(envsRes.success ? envsRes.data : []);
      } catch (err) {
        reportError("analytics_filters.options.load.failed", err, {
          outcome: "filter dropdowns show their failure note",
        });
        if (!cancelled) setOwnOptionsError("Failed to load filter options");
      } finally {
        if (!cancelled) setSettledKey(loadKey);
      }
    };
    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [pageOwned, suggestActive, labelsWindow, optionsToken, loadKey]);

  // ── data.* keys and values ────────────────────────────────────────────────
  // Read only once the user picks "Data field…": the keys read is the
  // expensive one (it JSON-parses every row in the window).
  const isDataField = isAdding && newFilter.field === DATA_FIELD;
  const keysWindow = suggestionWindow("keys", range);
  const valuesWindow = suggestionWindow("values", range);
  const [dataKeys, setDataKeys] = useState<string[]>([]);
  const [dataKeysError, setDataKeysError] = useState<string | null>(null);
  const [dataKeysToken, setDataKeysToken] = useState(0);
  const [dataValues, setDataValues] = useState<{ key: string; values: string[] }>({
    key: "",
    values: [],
  });

  useEffect(() => {
    if (!isDataField) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getDataKeys(undefined, { window: keysWindow });
        if (cancelled) return;
        if (!res.success) {
          setDataKeysError(res.error_message || "The request failed.");
          return;
        }
        setDataKeysError(null);
        setDataKeys(res.data ?? []);
      } catch (err) {
        reportError("analytics_filters.data_keys.load.failed", err, {
          outcome: "data key input shows its failure note",
        });
        if (!cancelled) setDataKeysError("Failed to load data keys");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDataField, keysWindow, dataKeysToken]);

  // Values for a key the server has actually seen — not for every keystroke.
  const knownKey =
    isDataField && dataKeys.includes(newFilter.dataKey.trim()) ? newFilter.dataKey.trim() : "";
  useEffect(() => {
    if (!knownKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getDataValues(knownKey, undefined, { window: valuesWindow });
        // A miss leaves free text, which is still a working input; the keys
        // read above already reports a broken suggestions endpoint.
        if (cancelled || !res.success) return;
        setDataValues({ key: knownKey, values: res.data ?? [] });
      } catch (err) {
        reportError("analytics_filters.data_values.load.failed", err, {
          key: knownKey,
          outcome: "value input stays free text",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [knownKey, valuesWindow]);

  // Page-owned options already carry a failure note on the page itself (the
  // dashboard's variables bar), so here it is shown only inside the add form
  // that consumes them — one failure is not announced twice at rest.
  const optionsError = pageOwned
    ? isAdding
      ? (pageOptionsError ?? null)
      : null
    : ownOptionsError;
  const retryOptions = pageOwned
    ? onRetryOptions
    : () => setOptionsToken((t) => t + 1);

  // Focus the first control when the form opens, so Escape and Tab start there.
  useEffect(() => {
    if (isAdding) firstControlRef.current?.focus();
  }, [isAdding, editingIndex]);

  const closeForm = () => {
    setIsAdding(false);
    setEditingIndex(null);
    setFormError(null);
    setNewFilter(EMPTY_DRAFT);
    // Back to where the user started, not to <body>.
    requestAnimationFrame(() => addButtonRef.current?.focus());
  };

  const openForm = (index: number | null) => {
    setSuggestActive(true);
    setEditingIndex(index);
    setFormError(null);
    setNewFilter(index === null ? EMPTY_DRAFT : draftFrom(filters[index]));
    setIsAdding(true);
  };

  const handleAddFilter = () => {
    const raw = newFilter.value.trim();
    const field =
      newFilter.field === DATA_FIELD
        ? `${DATA_PREFIX}${newFilter.dataKey.trim().replace(/^data\./, "")}`
        : newFilter.field;
    if (field === DATA_PREFIX) {
      setFormError("Enter a data key.");
      return;
    }
    if (!raw) return;

    let value: AnalyticsFilter["value"];
    if (newFilter.operator === "in") {
      // ⚠️ `in` takes an ARRAY. monitor-core's analytics bodies reject a string
      // for it, and the comma string this used to send failed every widget on
      // the page at once.
      value = raw.split(",").map((v) => v.trim()).filter((v) => v !== "");
      if (value.length === 0) return;
    } else if (isNumericOp(newFilter.operator)) {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        setFormError(`${operatorLabel(newFilter.operator)} needs a number.`);
        return;
      }
      value = n;
    } else {
      value = raw;
    }

    const next: AnalyticsFilter = { field, operator: newFilter.operator, value };
    const duplicate = filters.some((f, i) => i !== editingIndex && sameFilter(f, next));
    if (duplicate) {
      setFormError("That filter is already applied.");
      return;
    }
    onFiltersChange(
      editingIndex === null
        ? [...filters, next]
        : filters.map((f, i) => (i === editingIndex ? next : f)),
    );
    closeForm();
  };

  const handleRemoveFilter = (index: number) => {
    onFiltersChange(filters.filter((_, i) => i !== index));
  };

  /** = ↔ ≠ in place. Only those two have an opposite the API knows. */
  const handleNegate = (index: number) => {
    const f = filters[index];
    const operator: FilterOperator = f.operator === "eq" ? "neq" : "eq";
    const next = { ...f, operator };
    // Negating into a filter that already exists would duplicate it.
    if (filters.some((g, i) => i !== index && sameFilter(g, next))) {
      handleRemoveFilter(index);
      return;
    }
    onFiltersChange(filters.map((g, i) => (i === index ? next : g)));
  };

  const handleFormKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // Stop here: a dialog or page-level Escape handler must not ALSO fire.
      e.stopPropagation();
      e.preventDefault();
      closeForm();
    }
  };

  const getSuggestions = (field: string): string[] => {
    switch (field) {
      case "service":
        return pageOwned ? (options.service ?? []) : services;
      case "level":
        return pageOwned ? (options.level ?? []) : levels;
      case "env":
        return pageOwned ? (options.env ?? []) : envs;
      default:
        return [];
    }
  };

  /**
   * Whether the value control should hold a disabled "Loading…" select.
   *
   * ⚠️ WITHOUT THIS THE FORM SWAPS CONTROLS UNDER THE USER. The first "Add
   * Filter" starts the lazy load, so for its first few hundred ms the list is
   * empty and the free-text input renders — then the labels land and a
   * `<select>` replaces it, dropping focus and possibly keeping a half-typed
   * value as the selection. Only an EMPTY list waits: stale values from the
   * previous range stay selectable during a refresh, and a load that settles
   * empty or failed falls back to free text as before.
   */
  const awaitingSuggestions = (field: string): boolean =>
    optionsLoading &&
    (field === "service" || field === "level" || field === "env") &&
    getSuggestions(field).length === 0;

  const operatorsFor = (field: string) =>
    field === DATA_FIELD ? [...OPERATORS, ...NUMERIC_OPERATORS] : OPERATORS;

  const numeric = isNumericOp(newFilter.operator);
  const dataValueList =
    isDataField && dataValues.key === knownKey && knownKey ? dataValues.values : [];
  const keysListId = `${idBase}-data-keys`;
  const valuesListId = `${idBase}-data-values`;

  return (
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      {optionsError && (
        <FailureNote
          what="filter suggestions"
          message={optionsError}
          onRetry={retryOptions}
        />
      )}
      {/* Existing filters as chips */}
      {filters.map((filter, index) => {
        const description = describeFilter(filter);
        const negatable = filter.operator === "eq" || filter.operator === "neq";
        return (
          <div
            key={`${filter.field}|${filter.operator}|${JSON.stringify(filter.value)}|${index}`}
            className={`inline-flex items-center max-w-full bg-blue-50 dark:bg-blue-900/30 border rounded-full text-sm ${
              editingIndex === index && isAdding
                ? "border-blue-500 ring-1 ring-blue-500"
                : "border-blue-200 dark:border-blue-800"
            }`}
          >
            <button
              type="button"
              onClick={() => openForm(index)}
              aria-label={`Edit filter: ${description}`}
              title="Edit filter"
              className="inline-flex items-center gap-1.5 min-w-0 pl-3 pr-1 py-1.5 rounded-l-full hover:bg-blue-100 dark:hover:bg-blue-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span className="text-blue-700 dark:text-blue-300 font-medium shrink-0">
                {fieldLabel(filter.field)}
              </span>
              <span className="text-blue-600 dark:text-blue-400 shrink-0">
                {operatorLabel(filter.operator)}
              </span>
              <span className="text-blue-800 dark:text-blue-200 truncate max-w-[14rem]">
                {valueLabel(filter.value)}
              </span>
            </button>
            {negatable && (
              <button
                type="button"
                onClick={() => handleNegate(index)}
                aria-pressed={filter.operator === "neq"}
                aria-label={`Negate filter: ${description}`}
                title={filter.operator === "neq" ? "Match equal instead" : "Exclude instead (≠)"}
                className="inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full text-blue-600 hover:text-blue-800 hover:bg-blue-100 dark:text-blue-400 dark:hover:text-blue-200 dark:hover:bg-blue-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                {filter.operator === "neq" ? "=" : "≠"}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleRemoveFilter(index)}
              aria-label={`Remove filter: ${description}`}
              title="Remove filter"
              className="inline-flex items-center justify-center w-6 h-6 mr-1 rounded-full text-blue-500 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:text-blue-200 dark:hover:bg-blue-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        );
      })}

      {filters.length >= 2 && !isAdding && (
        <button
          type="button"
          onClick={() => onFiltersChange([])}
          className="px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Clear all
        </button>
      )}

      {/* Add / edit filter form */}
      {isAdding ? (
        <div
          role="group"
          aria-label={editingIndex === null ? "Add filter" : "Edit filter"}
          onKeyDown={handleFormKeyDown}
          className="flex flex-wrap items-center gap-1.5 max-w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1"
        >
          <select
            ref={firstControlRef}
            aria-label="Filter field"
            value={newFilter.field}
            onChange={(e) => {
              const field = e.target.value;
              setFormError(null);
              setNewFilter((prev) => ({
                ...prev,
                field,
                // A numeric operator means nothing on a built-in string field.
                operator:
                  field !== DATA_FIELD && isNumericOp(prev.operator) ? "eq" : prev.operator,
              }));
            }}
            className={CONTROL}
          >
            {FILTER_FIELDS.map((field) => (
              <option key={field.value} value={field.value}>
                {field.label}
              </option>
            ))}
            <option value={DATA_FIELD}>Data field…</option>
          </select>
          {newFilter.field === DATA_FIELD && (
            <>
              <input
                type="text"
                aria-label="Data key"
                list={keysListId}
                value={newFilter.dataKey}
                onChange={(e) => {
                  setFormError(null);
                  setNewFilter((prev) => ({ ...prev, dataKey: e.target.value }));
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAddFilter()}
                placeholder="data key, e.g. duration_ms"
                className={`${CONTROL} w-40`}
              />
              <datalist id={keysListId}>
                {dataKeys.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </>
          )}
          <select
            aria-label="Operator"
            value={newFilter.operator}
            onChange={(e) => {
              setFormError(null);
              setNewFilter((prev) => ({
                ...prev,
                operator: e.target.value as FilterOperator,
              }));
            }}
            className={CONTROL}
          >
            {operatorsFor(newFilter.field).map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
          {/* `in` is a comma-separated list, which a single-value <select>
              cannot hold — it always takes the free-text input. So does a
              numeric comparison. */}
          {!numeric && newFilter.operator !== "in" && awaitingSuggestions(newFilter.field) ? (
            <select
              aria-label="Value"
              disabled
              aria-busy="true"
              className={`${CONTROL} text-zinc-400 dark:text-zinc-500 min-w-[100px] disabled:cursor-wait`}
            >
              <option value="">Loading…</option>
            </select>
          ) : !numeric &&
            newFilter.operator !== "in" &&
            getSuggestions(newFilter.field).length > 0 ? (
            <select
              aria-label="Value"
              value={newFilter.value}
              onChange={(e) =>
                setNewFilter((prev) => ({ ...prev, value: e.target.value }))
              }
              className={`${CONTROL} min-w-[100px]`}
            >
              <option value="">Select...</option>
              {withSelected(getSuggestions(newFilter.field), newFilter.value).map((val) => (
                <option key={val} value={val}>
                  {val}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                type={numeric ? "number" : "text"}
                inputMode={numeric ? "decimal" : undefined}
                aria-label="Value"
                aria-invalid={formError ? true : undefined}
                list={dataValueList.length > 0 && !numeric ? valuesListId : undefined}
                value={newFilter.value}
                onChange={(e) => {
                  setFormError(null);
                  setNewFilter((prev) => ({ ...prev, value: e.target.value }));
                }}
                placeholder={
                  newFilter.operator === "in" ? "a, b, c" : numeric ? "Number" : "Value..."
                }
                className={`${CONTROL} min-w-[100px] w-32`}
                onKeyDown={(e) => e.key === "Enter" && handleAddFilter()}
              />
              {dataValueList.length > 0 && (
                <datalist id={valuesListId}>
                  {dataValueList.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              )}
            </>
          )}
          <button
            type="button"
            onClick={handleAddFilter}
            disabled={!newFilter.value.trim()}
            aria-label={editingIndex === null ? "Apply filter" : "Save filter"}
            title={editingIndex === null ? "Apply filter" : "Save filter"}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:text-emerald-300 dark:hover:bg-emerald-900/30 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={closeForm}
            aria-label="Cancel"
            title="Cancel (Esc)"
            className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
          {formError && (
            <p role="alert" className="basis-full px-2 pb-1 text-xs text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
          {newFilter.field === DATA_FIELD && dataKeysError && (
            <FailureNote
              what="data key suggestions"
              message={dataKeysError}
              onRetry={() => setDataKeysToken((t) => t + 1)}
              className="basis-full"
            />
          )}
        </div>
      ) : (
        <button
          ref={addButtonRef}
          type="button"
          onClick={() => openForm(null)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-600 rounded-full transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Add Filter
        </button>
      )}
    </div>
  );
}
