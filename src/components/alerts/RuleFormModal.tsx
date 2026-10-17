"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faCode, faTriangleExclamation, faListUl } from "@fortawesome/free-solid-svg-icons";
import {
    AlertRule,
    AlertPriority,
    NotificationChannel,
    NotificationPolicy,
    ServiceGroup,
    PRIORITY_LABELS,
} from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { FailureNote } from "@/components/FailureState";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { useZoneHref } from "@/hooks/useZoneHref";
import {
    CONDITION_LABELS,
    DURATION_UNITS,
    DurationUnit,
    bestUnit,
    channelTypeLabel,
    formatDuration,
    parseFilters,
    parseIdList,
    previewRouting,
    unitSeconds,
    urgentWithoutPaging,
} from "./alerts.tools";

// ─── Form model ───

interface Duration {
    value: string;
    unit: DurationUnit;
}

/**
 * The form keeps numbers as the STRINGS the user typed. Threshold used to be
 * `parseFloat(v) || 0`: clearing the box showed it empty and saved 0, turning
 * "count > (blank)" into "count > 0" — a rule that fires on any single event.
 */
export interface RuleFormData {
    name: string;
    description: string;
    type: AlertRule["type"];
    priority: AlertPriority;
    query_filters: string;
    metric: string;
    field: string;
    condition: AlertRule["condition"];
    threshold: string;
    interval: Duration;
    hold: Duration;
    cooldown: Duration;
    /**
     * The rule's own channels. ⚠️ They were missing from the form entirely, so
     * Duplicate POSTed a copy with `[]` and the copy lost the destination its
     * original used whenever no policy matched.
     */
    notification_channel_ids: string[];
    enabled: boolean;
}

type FieldKey = "name" | "field" | "filters" | "threshold" | "interval" | "hold" | "cooldown";

export const NAME_MAX = 120;
const MIN_INTERVAL = 10;
const MAX_INTERVAL = 86400;
const MAX_WINDOW = 7 * 86400;

function toDuration(seconds: number): Duration {
    const unit = bestUnit(seconds);
    return { value: String(seconds / unitSeconds(unit)), unit };
}

function durationSeconds(d: Duration): number {
    if (d.value.trim() === "") return NaN;
    return Math.round(Number(d.value) * unitSeconds(d.unit));
}

export function ruleToForm(rule: AlertRule): RuleFormData {
    return {
        name: rule.name,
        description: rule.description,
        type: rule.type,
        priority: rule.priority || "P2",
        query_filters: rule.query_filters || "[]",
        metric: rule.metric,
        field: rule.field,
        condition: rule.condition,
        threshold: String(rule.threshold),
        interval: toDuration(rule.evaluation_interval_seconds || 60),
        hold: toDuration(rule.for_seconds || 0),
        cooldown: toDuration(rule.cooldown_seconds || 0),
        notification_channel_ids: parseIdList(rule.notification_channel_ids),
        enabled: rule.enabled,
    };
}

/** What POST/PUT /v1/alert-rules takes. Call only on a form that validates. */
export function formToPayload(form: RuleFormData): Partial<AlertRule> {
    return {
        name: form.name.trim(),
        description: form.description,
        type: form.type,
        priority: form.priority,
        query_filters: form.query_filters.trim() || "[]",
        metric: form.metric,
        field: form.metric === "count" ? "" : form.field.trim(),
        condition: form.condition,
        // Absence ignores the threshold server-side; 0 is a placeholder, not a choice.
        threshold: form.type === "absence" && form.threshold.trim() === "" ? 0 : Number(form.threshold),
        evaluation_interval_seconds: durationSeconds(form.interval),
        for_seconds: durationSeconds(form.hold),
        cooldown_seconds: durationSeconds(form.cooldown),
        notification_channel_ids: JSON.stringify(form.notification_channel_ids),
        enabled: form.enabled,
    };
}

/**
 * A new rule starts DISABLED. Enabled-by-default meant a half-tested P0 rule
 * started evaluating and routing to every channel the moment it was saved;
 * Duplicate already started copies disabled for the same reason.
 */
const DEFAULT_FORM: RuleFormData = {
    name: "",
    description: "",
    type: "threshold",
    priority: "P2",
    query_filters: "[]",
    metric: "count",
    field: "",
    condition: "gt",
    threshold: "",
    interval: { value: "1", unit: "m" },
    hold: { value: "0", unit: "m" },
    cooldown: { value: "5", unit: "m" },
    notification_channel_ids: [],
    enabled: false,
};

function filtersJsonError(raw: string): string | null {
    try {
        const parsed = JSON.parse(raw.trim() || "[]");
        if (!Array.isArray(parsed)) return "Filters must be a JSON array.";
        for (const f of parsed) {
            if (!f || typeof f !== "object" || typeof f.field !== "string" || typeof f.operator !== "string") {
                return 'Each filter needs "field", "operator" and "value".';
            }
        }
        return null;
    } catch {
        return "Not valid JSON.";
    }
}

function durationError(d: Duration, label: string, min: number, max: number): string | null {
    const s = durationSeconds(d);
    if (!Number.isFinite(s)) return `${label} is required.`;
    if (s < min) return `${label} must be at least ${formatDuration(min)}.`;
    if (s > max) return `${label} can be at most ${formatDuration(max)}.`;
    return null;
}

/**
 * Client-side limits. ⚠️ Cooldown 99999999999 used to reach the server, overflow
 * its uint32 and come back as a bare "invalid request body" toast that vanished
 * while the modal stayed open with nothing highlighted.
 */
function validate(form: RuleFormData): Partial<Record<FieldKey, string>> {
    const errors: Partial<Record<FieldKey, string>> = {};
    if (!form.name.trim()) errors.name = "Name is required.";
    else if (form.name.trim().length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`;
    if (form.type !== "absence" && form.metric !== "count" && !form.field.trim()) errors.field = `${form.metric} needs a field, e.g. data.duration_ms.`;
    const filters = filtersJsonError(form.query_filters);
    if (filters) errors.filters = filters;
    if (form.type !== "absence") {
        if (form.threshold.trim() === "") errors.threshold = "Threshold is required.";
        else if (!Number.isFinite(Number(form.threshold))) errors.threshold = "Threshold must be a number.";
    }
    const interval = durationError(form.interval, "Evaluate every", MIN_INTERVAL, MAX_INTERVAL);
    if (interval) errors.interval = interval;
    const hold = durationError(form.hold, "Must hold for", 0, MAX_WINDOW);
    if (hold) errors.hold = hold;
    const cooldown = durationError(form.cooldown, "Re-notify every", 0, MAX_WINDOW);
    if (cooldown) errors.cooldown = cooldown;
    return errors;
}

/**
 * Pins a server 400 to the field it names, so the message sits under the input
 * rather than in a toast. monitor-core's messages name the column ("invalid
 * metric: …", "cooldown_seconds must …"); anything unrecognised is shown at the
 * foot of the form instead.
 */
function serverErrorField(message: string): FieldKey | null {
    const m = message.toLowerCase();
    if (/cooldown/.test(m)) return "cooldown";
    if (/for_seconds|\bhold\b/.test(m)) return "hold";
    if (/interval/.test(m)) return "interval";
    if (/threshold/.test(m)) return "threshold";
    if (/query_filters|filter/.test(m)) return "filters";
    if (/\bfield\b/.test(m)) return "field";
    if (/\bname\b/.test(m)) return "name";
    return null;
}

// ─── Component ───

interface RuleFormModalProps {
    initial?: RuleFormData;
    title: string;
    onClose: () => void;
    onSubmit: (data: RuleFormData) => void;
    submitting: boolean;
    /** The last save's error_message; shown in the form until the next edit. */
    serverError: string | null;
    onClearServerError: () => void;
    policies: NotificationPolicy[];
    channels: NotificationChannel[];
    groups: ServiceGroup[];
    /** Policies/channels/groups failed to load: the routing below cannot be computed. */
    routingError: string | null;
    /** Still loading: no verdict yet, so neither "nobody" nor a list. */
    routingLoading: boolean;
    onRetryRouting: () => void;
}

const inputClass =
    "w-full px-3 py-2 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60";
const invalidClass = "border-red-400 dark:border-red-700";
const labelClass = "block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1";
const helpClass = "mt-1 text-xs text-zinc-500 dark:text-zinc-400";
const errorClass = "mt-1 text-xs text-red-600 dark:text-red-400";

/**
 * The create/edit form, on the shared Modal.
 *
 * The routing preview is computed from the FORM, not from the rule as it was
 * opened, and mirrors monitor-core's router exactly (see `previewRouting`).
 * When the routing inputs failed to load it says so in place of the preview:
 * "No policies match this rule yet" over a 500 sent operators to create a
 * duplicate policy on the screen that decides who gets paged.
 */
export function RuleFormModal({
    initial,
    title,
    onClose,
    onSubmit,
    submitting,
    serverError,
    onClearServerError,
    policies,
    channels,
    groups,
    routingError,
    routingLoading,
    onRetryRouting,
}: RuleFormModalProps) {
    const zoned = useZoneHref();
    const [form, setForm] = useState<RuleFormData>(initial || DEFAULT_FORM);
    const [attempted, setAttempted] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);
    const isEdit = Boolean(initial);

    // Stored filters the builder cannot represent open in JSON, never silently reshaped.
    const [filterMode, setFilterMode] = useState<"builder" | "json">(() => {
        const raw = (initial ?? DEFAULT_FORM).query_filters;
        if (filtersJsonError(raw)) return "json";
        try {
            return (JSON.parse(raw || "[]") as unknown[]).length === parseFilters(raw).length ? "builder" : "json";
        } catch {
            return "json";
        }
    });

    const update = <K extends keyof RuleFormData>(key: K, value: RuleFormData[K]) => {
        if (serverError) onClearServerError();
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const errors = useMemo(() => validate(form), [form]);
    const serverField = serverError ? serverErrorField(serverError) : null;
    const fieldError = (key: FieldKey): string | null =>
        (serverField === key ? serverError : null) ?? (attempted || key === "filters" ? errors[key] ?? null : null);

    const preview = useMemo(
        () =>
            previewRouting(
                {
                    name: form.name,
                    priority: form.priority,
                    query_filters: filtersJsonError(form.query_filters) ? "[]" : form.query_filters,
                    notification_channel_ids: JSON.stringify(form.notification_channel_ids),
                },
                policies,
                channels,
                groups,
            ),
        [form.name, form.priority, form.query_filters, form.notification_channel_ids, policies, channels, groups],
    );

    const needsField = form.metric !== "count";
    const usesThreshold = form.type !== "absence";
    const builderFilters = useMemo(() => parseFilters(form.query_filters), [form.query_filters]);
    const knownChannelIds = new Set(channels.map((c) => c.id));
    const danglingIds = routingError || routingLoading ? [] : form.notification_channel_ids.filter((id) => !knownChannelIds.has(id));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setAttempted(true);
        if (Object.keys(errors).length > 0) {
            // Take the user to the first problem rather than leaving them to hunt.
            const first = e.currentTarget.querySelector<HTMLElement>("[aria-invalid='true']");
            requestAnimationFrame(() => first?.focus());
            return;
        }
        onSubmit(form);
    };

    // AnalyticsFilters handles Enter in its own inputs; without this the same
    // keypress ALSO implicitly submits the rule form around it.
    const swallowEnter = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
    };

    const sentence = describeRule(form);
    const unmappedServerError = serverError && !serverField ? serverError : null;

    return (
        <Modal
            open
            onClose={onClose}
            title={title}
            widthClass="max-w-2xl"
            dismissible={!submitting}
            initialFocusRef={nameRef}
        >
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div>
                    <label htmlFor="rule-name" className={labelClass}>Name</label>
                    <input
                        id="rule-name"
                        ref={nameRef}
                        type="text"
                        value={form.name}
                        maxLength={NAME_MAX}
                        onChange={(e) => update("name", e.target.value)}
                        aria-invalid={Boolean(fieldError("name"))}
                        aria-describedby={fieldError("name") ? "rule-name-error" : undefined}
                        className={`${inputClass} ${fieldError("name") ? invalidClass : ""}`}
                    />
                    {fieldError("name") && <p id="rule-name-error" className={errorClass}>{fieldError("name")}</p>}
                </div>
                <div>
                    <label htmlFor="rule-description" className={labelClass}>Description</label>
                    <input
                        id="rule-description"
                        type="text"
                        value={form.description}
                        onChange={(e) => update("description", e.target.value)}
                        placeholder="What firing means and what to check first"
                        className={inputClass}
                    />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                        <label htmlFor="rule-priority" className={labelClass}>Priority</label>
                        <select
                            id="rule-priority"
                            value={form.priority}
                            onChange={(e) => update("priority", e.target.value as AlertPriority)}
                            className={inputClass}
                        >
                            {(["P0", "P1", "P2", "P3"] as AlertPriority[]).map((p) => (
                                <option key={p} value={p}>{p} {PRIORITY_LABELS[p]}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="rule-type" className={labelClass}>Type</label>
                        <select
                            id="rule-type"
                            value={form.type}
                            onChange={(e) => update("type", e.target.value as AlertRule["type"])}
                            className={inputClass}
                        >
                            <option value="threshold">Threshold</option>
                            <option value="absence">Absence (no events)</option>
                            <option value="rate_change">Rate change (%)</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="rule-metric" className={labelClass}>Metric</label>
                        <select
                            id="rule-metric"
                            value={form.metric}
                            onChange={(e) => update("metric", e.target.value)}
                            disabled={form.type === "absence"}
                            className={inputClass}
                        >
                            <option value="count">Count</option>
                            <option value="avg">Avg</option>
                            <option value="sum">Sum</option>
                            <option value="min">Min</option>
                            <option value="max">Max</option>
                            <option value="p50">P50</option>
                            <option value="p95">P95</option>
                            <option value="p99">P99</option>
                        </select>
                    </div>
                </div>
                {needsField && form.type !== "absence" && (
                    <div>
                        <label htmlFor="rule-field" className={labelClass}>Field</label>
                        <input
                            id="rule-field"
                            type="text"
                            value={form.field}
                            onChange={(e) => update("field", e.target.value)}
                            placeholder="e.g. data.duration_ms"
                            aria-invalid={Boolean(fieldError("field"))}
                            aria-describedby={fieldError("field") ? "rule-field-error" : undefined}
                            className={`${inputClass} ${fieldError("field") ? invalidClass : ""}`}
                        />
                        {fieldError("field") && <p id="rule-field-error" className={errorClass}>{fieldError("field")}</p>}
                    </div>
                )}

                {/* Filters: a row builder, with raw JSON as the escape hatch. Typed
                    JSON with a wrong field name was valid, saved, and never fired. */}
                <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <span id="rule-filters-label" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Only events matching
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                if (filterMode === "json") {
                                    if (filtersJsonError(form.query_filters)) return;
                                    update("query_filters", JSON.stringify(parseFilters(form.query_filters)));
                                    setFilterMode("builder");
                                } else {
                                    update("query_filters", JSON.stringify(builderFilters, null, 2));
                                    setFilterMode("json");
                                }
                            }}
                            disabled={filterMode === "json" && Boolean(filtersJsonError(form.query_filters))}
                            title={filterMode === "json" && filtersJsonError(form.query_filters) ? "Fix the JSON first" : undefined}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400"
                        >
                            <FontAwesomeIcon icon={filterMode === "json" ? faListUl : faCode} className="text-[10px]" />
                            {filterMode === "json" ? "Use builder" : "Edit as JSON"}
                        </button>
                    </div>
                    {filterMode === "builder" ? (
                        <div
                            role="group"
                            aria-labelledby="rule-filters-label"
                            onKeyDownCapture={swallowEnter}
                            className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700"
                        >
                            <AnalyticsFilters
                                filters={builderFilters}
                                onFiltersChange={(next) => update("query_filters", JSON.stringify(next))}
                            />
                            {builderFilters.length === 0 && (
                                <p className={helpClass}>No filters: the rule counts every event in this project.</p>
                            )}
                        </div>
                    ) : (
                        <>
                            <textarea
                                id="rule-filters"
                                aria-labelledby="rule-filters-label"
                                value={form.query_filters}
                                onChange={(e) => update("query_filters", e.target.value)}
                                rows={4}
                                spellCheck={false}
                                aria-invalid={Boolean(fieldError("filters"))}
                                aria-describedby="rule-filters-help"
                                className={`${inputClass} font-mono ${fieldError("filters") ? invalidClass : ""}`}
                            />
                            <p id="rule-filters-help" className={fieldError("filters") ? errorClass : helpClass}>
                                {fieldError("filters") ?? 'e.g. [{"field": "service", "operator": "eq", "value": "billing"}]'}
                            </p>
                        </>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="rule-condition" className={labelClass}>Condition</label>
                        <select
                            id="rule-condition"
                            value={form.condition}
                            onChange={(e) => update("condition", e.target.value as AlertRule["condition"])}
                            disabled={!usesThreshold}
                            className={inputClass}
                        >
                            <option value="gt">&gt; Greater than</option>
                            <option value="lt">&lt; Less than</option>
                            <option value="gte">&gt;= Greater or equal</option>
                            <option value="lte">&lt;= Less or equal</option>
                            <option value="eq">= Equal</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="rule-threshold" className={labelClass}>
                            Threshold{form.type === "rate_change" ? " (%)" : ""}
                        </label>
                        <input
                            id="rule-threshold"
                            type="number"
                            step="any"
                            inputMode="decimal"
                            value={usesThreshold ? form.threshold : ""}
                            placeholder={usesThreshold ? "" : "Not used"}
                            disabled={!usesThreshold}
                            onChange={(e) => update("threshold", e.target.value)}
                            aria-invalid={Boolean(fieldError("threshold"))}
                            aria-describedby={fieldError("threshold") ? "rule-threshold-error" : undefined}
                            className={`${inputClass} ${fieldError("threshold") ? invalidClass : ""}`}
                        />
                        {fieldError("threshold") && <p id="rule-threshold-error" className={errorClass}>{fieldError("threshold")}</p>}
                    </div>
                </div>
                {!usesThreshold && (
                    <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        Absence fires when no matching event arrives in a window; condition and threshold are ignored.
                    </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <DurationField
                        id="rule-interval"
                        label="Evaluate every"
                        help="Also the window each check covers."
                        value={form.interval}
                        onChange={(d) => update("interval", d)}
                        error={fieldError("interval")}
                    />
                    <DurationField
                        id="rule-for"
                        label="Must hold for"
                        help="0 fires on the first breaching window."
                        value={form.hold}
                        onChange={(d) => update("hold", d)}
                        error={fieldError("hold")}
                    />
                    <DurationField
                        id="rule-cooldown"
                        label="Re-notify every"
                        help={
                            !isEdit && durationSeconds(form.cooldown) === 0
                                ? "0 on a new rule is saved as 5 minutes."
                                : "While it keeps firing."
                        }
                        value={form.cooldown}
                        onChange={(d) => update("cooldown", d)}
                        error={fieldError("cooldown")}
                    />
                </div>

                {sentence && (
                    <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300">
                        {sentence}
                    </p>
                )}

                {/* Notification Routing */}
                <section
                    aria-labelledby="rule-routing-heading"
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 space-y-3"
                >
                    <div className="flex items-center justify-between gap-2">
                        <h3 id="rule-routing-heading" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Notification routing
                        </h3>
                        <Link
                            href={zoned("/notifications")}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                        >
                            Manage policies
                            <FontAwesomeIcon icon={faArrowRight} className="text-[10px]" />
                        </Link>
                    </div>
                    {routingError ? (
                        // Replaces the preview: with no policies loaded, "nothing
                        // matches" would be a claim about the config, not the fetch.
                        <div className="space-y-1">
                            <FailureNote what="notification routing" message={routingError} onRetry={onRetryRouting} />
                            <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                {routingError.replace(/[.!?]?$/, ".")} Who this rule notifies can&apos;t be shown until it loads.
                            </p>
                        </div>
                    ) : routingLoading ? (
                        <p className="text-xs text-zinc-600 dark:text-zinc-400">Loading notification routing…</p>
                    ) : (
                        <RoutingPreviewPanel
                            preview={preview}
                            priority={form.priority}
                            notificationsHref={zoned("/notifications")}
                        />
                    )}

                    <fieldset>
                        <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                            Fallback channels{" "}
                            <span className="font-normal text-zinc-500 dark:text-zinc-400">
                                — used only when no policy matches
                            </span>
                        </legend>
                        {routingError || routingLoading ? (
                            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                                {form.notification_channel_ids.length} saved — kept unchanged until channels load.
                            </p>
                        ) : channels.length === 0 ? (
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">No channels exist in this project.</p>
                        ) : (
                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                                {channels.map((ch) => (
                                    <label key={ch.id} className="inline-flex min-w-0 items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                        <input
                                            type="checkbox"
                                            checked={form.notification_channel_ids.includes(ch.id)}
                                            onChange={(e) =>
                                                update(
                                                    "notification_channel_ids",
                                                    e.target.checked
                                                        ? [...form.notification_channel_ids, ch.id]
                                                        : form.notification_channel_ids.filter((id) => id !== ch.id),
                                                )
                                            }
                                            className="h-4 w-4 accent-blue-600"
                                        />
                                        <span className="truncate">{ch.name}</span>
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{channelTypeLabel(ch.type)}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                        {danglingIds.length > 0 && (
                            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                                {danglingIds.length} saved channel{danglingIds.length === 1 ? " no longer exists" : "s no longer exist"}.{" "}
                                <button
                                    type="button"
                                    onClick={() =>
                                        update(
                                            "notification_channel_ids",
                                            form.notification_channel_ids.filter((id) => knownChannelIds.has(id)),
                                        )
                                    }
                                    className="font-medium underline underline-offset-2"
                                >
                                    Remove
                                </button>
                            </p>
                        )}
                    </fieldset>
                </section>

                <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(e) => update("enabled", e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-blue-600"
                    />
                    <span>
                        Enabled
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                            {form.enabled
                                ? "Starts evaluating and notifying as soon as it is saved."
                                : "Saved as a draft: nothing is evaluated or sent until you enable it."}
                        </span>
                    </span>
                </label>

                {unmappedServerError && (
                    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                        Couldn&apos;t save: {unmappedServerError}
                    </p>
                )}
                {attempted && Object.keys(errors).length > 0 && !unmappedServerError && (
                    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                        Fix the highlighted field{Object.keys(errors).length === 1 ? "" : "s"} to save.
                    </p>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button type="submit" loading={submitting} disabled={attempted && Object.keys(errors).length > 0}>
                        {isEdit ? "Save rule" : form.enabled ? "Create and enable" : "Create as disabled"}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

function DurationField({
    id,
    label,
    help,
    value,
    onChange,
    error,
}: {
    id: string;
    label: string;
    help: string;
    value: Duration;
    onChange: (d: Duration) => void;
    error: string | null;
}) {
    const describedBy = `${id}-help`;
    return (
        <div>
            <label htmlFor={id} className={labelClass}>{label}</label>
            <div className="flex gap-1.5">
                <input
                    id={id}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={value.value}
                    onChange={(e) => onChange({ ...value, value: e.target.value })}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                    className={`${inputClass} min-w-0 flex-1 ${error ? invalidClass : ""}`}
                />
                <select
                    aria-label={`${label} unit`}
                    value={value.unit}
                    onChange={(e) => onChange({ ...value, unit: e.target.value as DurationUnit })}
                    className="shrink-0 w-24 px-2 py-2 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    {DURATION_UNITS.map((u) => (
                        <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                </select>
            </div>
            <p id={describedBy} className={error ? errorClass : helpClass}>{error ?? help}</p>
        </div>
    );
}

/** "Fires when count > 5 in a 5m window, held for 15m; re-notifies every 30m while firing." */
function describeRule(form: RuleFormData): string | null {
    const interval = durationSeconds(form.interval);
    const hold = durationSeconds(form.hold);
    const cooldown = durationSeconds(form.cooldown);
    if (!Number.isFinite(interval) || !Number.isFinite(hold) || !Number.isFinite(cooldown)) return null;
    const window = formatDuration(interval);
    const metric = form.metric === "count" ? "the event count" : `${form.metric}(${form.field || "field"})`;
    let what: string;
    if (form.type === "absence") {
        what = `no matching event arrives in a ${window} window`;
    } else {
        if (form.threshold.trim() === "" || !Number.isFinite(Number(form.threshold))) return null;
        const op = CONDITION_LABELS[form.condition] ?? form.condition;
        what =
            form.type === "rate_change"
                ? `${metric} changes by ${op} ${form.threshold}% from one ${window} window to the next`
                : `${metric} in a ${window} window is ${op} ${form.threshold}`;
    }
    const held = hold > 0 ? `, sustained for ${formatDuration(hold)}` : "";
    const renotify = cooldown > 0 ? `re-notifies at most every ${formatDuration(cooldown)} while firing` : "re-notifies on every check while firing";
    return `Fires when ${what}${held}; ${renotify}.`;
}

function RoutingPreviewPanel({
    preview,
    priority,
    notificationsHref,
}: {
    preview: ReturnType<typeof previewRouting>;
    priority: string;
    notificationsHref: string;
}) {
    const warnings: string[] = [];
    if (preview.destinations.length === 0) warnings.push("When this rule fires, nobody is notified.");
    if (urgentWithoutPaging(priority, preview)) {
        const types = [...new Set(preview.destinations.map((d) => channelTypeLabel(d.type)))].join(" and ");
        warnings.push(`A ${priority} rule that reaches ${types} only — no PagerDuty or Slack channel.`);
    }
    if (preview.missing > 0) {
        warnings.push(
            `${preview.missing} channel${preview.missing === 1 ? " referenced here no longer exists" : "s referenced here no longer exist"} and will be skipped.`,
        );
    }
    if (preview.invalid.length > 0) {
        warnings.push(`Skipped as unreadable: ${preview.invalid.map((p) => p.name).join(", ")}.`);
    }

    return (
        <div className="space-y-2 text-xs">
            <p className="text-zinc-500 dark:text-zinc-400">
                Policies are checked in order on priority, service and environment; the first match wins unless it
                continues matching. Updates as you edit.
            </p>
            {preview.steps.length > 0 ? (
                <ol className="space-y-1.5">
                    {preview.steps.map((step, i) => (
                        <li key={step.policy.id} className="flex flex-wrap items-center gap-1.5">
                            <span className="text-zinc-500 dark:text-zinc-400 tabular-nums">{i + 1}.</span>
                            <span className="font-medium text-zinc-700 dark:text-zinc-300 [overflow-wrap:anywhere]">{step.policy.name}</span>
                            <span className="text-zinc-500" aria-hidden>→</span>
                            {step.channels.length > 0 ? (
                                step.channels.map((ch) => <ChannelChip key={ch.id} channel={ch} />)
                            ) : (
                                <span className="text-amber-700 dark:text-amber-400">no channels</span>
                            )}
                            {step.policy.continue_matching && (
                                <span className="text-zinc-500 dark:text-zinc-400">· continues</span>
                            )}
                        </li>
                    ))}
                </ol>
            ) : (
                <p className="text-zinc-600 dark:text-zinc-300">
                    No policy matches, so the fallback channels below are used
                    {preview.destinations.length > 0 ? ":" : "."}
                    {preview.destinations.length > 0 && (
                        <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                            {preview.destinations.map((ch) => <ChannelChip key={ch.id} channel={ch} />)}
                        </span>
                    )}
                </p>
            )}
            {preview.shadowed.length > 0 && (
                <p className="text-zinc-500 dark:text-zinc-400">
                    Also matches, but never reached (first match wins): {preview.shadowed.map((p) => p.name).join(", ")}.
                </p>
            )}
            {warnings.map((w) => (
                <p key={w} className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                    <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 text-[10px]" aria-hidden />
                    <span>
                        {w}
                        {w.startsWith("When this rule fires") && (
                            <>
                                {" "}Add a fallback channel below, or a policy in{" "}
                                <Link href={notificationsHref} className="underline">Notifications</Link>.
                            </>
                        )}
                    </span>
                </p>
            ))}
        </div>
    );
}

function ChannelChip({ channel }: { channel: NotificationChannel }) {
    return (
        <span className="inline-flex max-w-full items-center rounded-full bg-white px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700">
            <span className="truncate">{channelTypeLabel(channel.type)} · {channel.name}</span>
        </span>
    );
}
