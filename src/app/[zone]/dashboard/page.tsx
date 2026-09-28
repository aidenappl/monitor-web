"use client";

import { useState, useEffect, useEffectEvent, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faArrowsRotate,
  faPlus,
  faTrash,
  faCheck,
  faPen,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";

import {
  WidgetConfig,
  TimeSeriesSeries,
  TopNDataPoint,
  CompareResponse,
  AnalyticsFilter,
  SavedDashboard,
} from "@/types";
import {
  getTimeSeries,
  getGauge,
  getCompare,
  getTopN,
  reqListDashboards,
  reqCreateDashboard,
  reqUpdateDashboard,
  reqDeleteDashboard,
  getLabelValues,
} from "@/services/api";
import { TimeSeriesChart } from "@/components/analytics/TimeSeriesChart";
import { TimeSeriesTable } from "@/components/analytics/TimeSeriesTable";
import { GaugeCard } from "@/components/analytics/GaugeCard";
import { CompareCard } from "@/components/analytics/CompareCard";
import { TopNList } from "@/components/analytics/TopNList";
import { WidgetEditor } from "@/components/dashboard/WidgetEditor";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FailureState, FailureNote } from "@/components/FailureState";
import { TimeRange, TIME_RANGES, TIME_RANGE_LABELS, getTimeRange, getIntervalForRange, suggestionWindow, withSelected } from "@/tools/timeRange.tools";
import { firstError } from "@/services/api.service";
import { scopeKeyOf } from "@/components/ScopeBoundary";
import { useScope } from "@/hooks/useScope";
import { readScope } from "@/tools/routing.tools";

interface DashboardVariable {
  name: string;
  label: string;
  source: "service" | "env" | "level";
  value: string;
}

interface DashboardConfig {
  widgets: WidgetConfig[];
  variables: DashboardVariable[];
}

interface WidgetData {
  loading: boolean;
  error: string | null;
  data: unknown;
}

function parseDashboardConfig(config: string): DashboardConfig {
  try {
    const parsed = JSON.parse(config);
    return {
      widgets: parsed.widgets || [],
      variables: parsed.variables || [],
    };
  } catch {
    return { widgets: [], variables: [] };
  }
}

export default function DashboardPage() {
  // Dashboard persistence
  const [dashboards, setDashboards] = useState<SavedDashboard[]>([]);
  const [currentDashboard, setCurrentDashboard] = useState<SavedDashboard | null>(null);
  const [dashboardName, setDashboardName] = useState("Untitled Dashboard");
  const [isEditingName, setIsEditingName] = useState(false);
  const [isNewDashboard, setIsNewDashboard] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardsError, setDashboardsError] = useState<string | null>(null);
  const [dashboardsToken, setDashboardsToken] = useState(0);
  const [showDashboardDropdown, setShowDashboardDropdown] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "">("");
  const [showSaveAsModal, setShowSaveAsModal] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const dashboardDropdownRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Widget state
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [widgetData, setWidgetData] = useState<Record<string, WidgetData>>({});
  const [selectedRange, setSelectedRange] = useState<TimeRange>(TIME_RANGES[2]);
  const [globalFilters, setGlobalFilters] = useState<AnalyticsFilter[]>([]);
  const [editingWidget, setEditingWidget] = useState<WidgetConfig | null>(null);
  const [isAddingWidget, setIsAddingWidget] = useState(false);
  const [loading, setLoading] = useState(false);

  // Per-widget request generation. Every fetchWidgetData call takes the next
  // number for its widget and writes state only while it is still the latest,
  // so a slow response for the old range (or an AutoRefresh tick overtaken by
  // a filter change) can never land on top of the newer one.
  const widgetGenRef = useRef<Record<string, number>>({});
  // Same idea for the Refresh button's spinner: only the newest batch clears it.
  const batchGenRef = useRef(0);
  // What the panels on screen were last fetched FOR, and which widget ids have
  // been fetched under it. Owned by the fetch effect below.
  const fetchedForRef = useRef<{
    dashboardId: string | undefined;
    range: string;
    filters: string;
    ids: Set<string>;
  } | null>(null);

  // Dashboard variables
  const [variables, setVariables] = useState<DashboardVariable[]>([]);
  const [labelOptions, setLabelOptions] = useState<Record<string, string[]>>({});
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [labelsToken, setLabelsToken] = useState(0);
  const [showAddVariable, setShowAddVariable] = useState(false);
  const [newVarSource, setNewVarSource] = useState<"service" | "env" | "level">("service");

  // Auto-save debounce
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The scope this dashboard is being edited under.
   *
   * ⚠️ THE ONE PLACE `ScopeBoundary`'s REMOUNT IS DANGEROUS RATHER THAN MERELY
   * INCONVENIENT. Everywhere else the remount costs a filter reset. Here there
   * is a 2-SECOND DEBOUNCED WRITE in flight: drag a widget, switch project
   * inside two seconds, and the timer — which nothing cleared — fires after the
   * remount, composes `{widgets, variables}` from the OLD tenant's dashboard,
   * and posts it. The axios interceptor resolves the project at request time, so
   * it lands in the NEW tenant. A dashboard the user never made, in a project
   * they were only passing through, written by an action they did not take.
   */
  const { scopeKey } = useScope();

  // Load dashboards on mount
  useEffect(() => {
    const loadDashboards = async () => {
      setDashboardLoading(true);
      try {
        const res = await reqListDashboards();
        // ⚠️ THE WORST READING OF A 500 ON THIS PAGE. `res.success ? res.data
        // : []` produced an empty list, which fell through to
        // setIsNewDashboard(true) — so a failed request presented the operator
        // with a blank "Untitled Dashboard" and every saved dashboard gone from
        // the picker. Not merely empty: actively suggesting they never had any.
        if (!res.success) {
          setDashboardsError(res.error_message || "The request failed.");
          return;
        }
        setDashboardsError(null);
        const list = res.data;
        setDashboards(list);
        if (list.length > 0) {
          loadDashboard(list[0]);
        } else {
          setIsNewDashboard(true);
        }
      } catch {
        setDashboardsError("Failed to load dashboards");
      } finally {
        setDashboardLoading(false);
      }
    };
    loadDashboards();
  }, [dashboardsToken]);

  // Load label values for variables — and for the global filter bar, which is
  // handed these same lists rather than fetching its own copy on the same
  // mount. Read over the dashboard's range, so a variable offers the values its
  // widgets can actually show.
  const labelsWindow = suggestionWindow("labels", selectedRange);
  useEffect(() => {
    let cancelled = false;
    const loadLabels = async () => {
      try {
        const [servicesRes, envsRes, levelsRes] = await Promise.all([
          getLabelValues("service", { window: labelsWindow }),
          getLabelValues("env", { window: labelsWindow }),
          getLabelValues("level", { window: labelsWindow }),
        ]);
        // The range can change while these are in flight.
        if (cancelled) return;
        // A dashboard variable whose dropdown is empty looks like a project with
        // no services in it. All three are all-or-nothing here because they are
        // one fetch to the user, so firstError matches the granularity of what
        // the page can honestly say.
        const failed = firstError(servicesRes, envsRes, levelsRes);
        if (failed) {
          setLabelsError(failed.error_message || "The request failed.");
          return;
        }
        setLabelsError(null);
        setLabelOptions({
          service: servicesRes.success ? servicesRes.data : [],
          env: envsRes.success ? envsRes.data : [],
          level: levelsRes.success ? levelsRes.data : [],
        });
      } catch {
        if (!cancelled) setLabelsError("Failed to load variable options");
      }
    };
    loadLabels();
    return () => {
      cancelled = true;
    };
  }, [labelsToken, labelsWindow]);

  // Close dashboard dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dashboardDropdownRef.current && !dashboardDropdownRef.current.contains(e.target as Node)) {
        setShowDashboardDropdown(false);
      }
    };
    if (showDashboardDropdown) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showDashboardDropdown]);

  // Focus name input when editing
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const loadDashboard = (dashboard: SavedDashboard) => {
    setCurrentDashboard(dashboard);
    setDashboardName(dashboard.name);
    setIsNewDashboard(false);
    const config = parseDashboardConfig(dashboard.config);
    setWidgets(config.widgets);
    setVariables(config.variables);
    setShowDashboardDropdown(false);
    setSaveStatus("saved");
  };

  // Build filters from variables
  const variableFilters: AnalyticsFilter[] = variables
    .filter((v) => v.value && v.value !== "")
    .map((v) => ({
      field: v.source,
      operator: "eq" as const,
      value: v.value,
    }));

  const allFilters = [...globalFilters, ...variableFilters];
  // The filters' CONTENT as a primitive. `allFilters` is a new array every
  // render, and its length misses a changed value or operator — picking another
  // service in a variable kept the length and left every panel on the old one.
  const filtersKey = JSON.stringify(allFilters);

  // Auto-save on widget/variable changes (debounced)
  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    setSaveStatus("unsaved");

    // The scope the edit was MADE under, captured at queue time. Compared
    // against the scope live when the timer fires — see below.
    const queuedUnder = scopeKey;

    autoSaveTimerRef.current = setTimeout(() => {
      // ⚠️ THE UNSAVED-CHANGES GUARD. `readScope()` is the same value the axios
      // interceptor will resolve this request's `?zone`/`?project` from, so this
      // asks the only question that matters: is the tenant this write would land
      // in still the tenant it was composed for?
      //
      // Not equal — or not knowable, because the user has left the zone
      // entirely — means the edit is orphaned. DROP IT AND SAY SO. Saving it
      // would file one tenant's half-finished layout under another's name;
      // dropping it silently would look like an autosave that worked. The toast
      // is the difference between losing two seconds of work and not knowing
      // which project now contains it.
      //
      // The same-scope path is untouched, deliberately: navigating from the
      // dashboard to another page in the SAME scope still flushes the pending
      // save, exactly as it did before this guard existed.
      const live = readScope();
      const liveKey = live ? scopeKeyOf(live.zone, live.project) : null;
      if (liveKey !== queuedUnder) {
        setSaveStatus("unsaved");
        toast.error(
          "Dashboard changes were not saved — the scope changed before the autosave ran.",
          { id: "dashboard-autosave-scope" },
        );
        return;
      }
      saveDashboard();
    }, 2000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDashboard, dashboardName, scopeKey]);

  const saveDashboard = useCallback(async () => {
    const config = JSON.stringify({ widgets, variables });
    setSaveStatus("saving");

    try {
      if (isNewDashboard || !currentDashboard) {
        const res = await reqCreateDashboard(dashboardName, "", config);
        if (!res.success) {
          // ⚠️ Explicit, because the client no longer throws on a non-2xx. The
          // old code relied on the catch below to show this; with
          // validateStatus: () => true a failed save would otherwise be a silent
          // no-op — the worst outcome for a user action.
          setSaveStatus("unsaved");
          toast.error(res.error_message || "Failed to save dashboard");
          return;
        }
        const created = res.data;
        // The first save gives the dashboard an id, but its panels are the ones
        // already fetched on screen. Carry them over, or the id change would
        // refetch every widget two seconds after the user added one.
        const fetched = fetchedForRef.current;
        if (fetched && fetched.dashboardId === undefined) fetched.dashboardId = created.id;
        setCurrentDashboard(created);
        setIsNewDashboard(false);
        setDashboards((prev) => [...prev, created]);
      } else {
        const res = await reqUpdateDashboard(currentDashboard.id, dashboardName, currentDashboard.description, config);
        if (!res.success) {
          setSaveStatus("unsaved");
          toast.error(res.error_message || "Failed to save dashboard");
          return;
        }
        const updated = res.data;
        setCurrentDashboard(updated);
        setDashboards((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      }
      setSaveStatus("saved");
    } catch {
      setSaveStatus("unsaved");
      toast.error("Failed to save dashboard");
    }
  }, [widgets, variables, dashboardName, isNewDashboard, currentDashboard]);

  const handleSaveAs = () => {
    setSaveAsName(dashboardName + " (Copy)");
    setShowSaveAsModal(true);
  };

  const handleSaveAsSubmit = async () => {
    const name = saveAsName.trim();
    if (!name) return;
    const config = JSON.stringify({ widgets, variables });
    try {
      const res = await reqCreateDashboard(name, "", config);
      if (!res.success) {
        toast.error(res.error_message || "Failed to duplicate dashboard");
        return;
      }
      const copy = res.data;
      setDashboards((prev) => [...prev, copy]);
      loadDashboard(copy);
      toast.success("Dashboard duplicated");
    } catch {
      toast.error("Failed to duplicate dashboard");
    } finally {
      setShowSaveAsModal(false);
      setSaveAsName("");
    }
  };

  const handleDeleteDashboard = async () => {
    if (!currentDashboard) return;
    try {
      const res = await reqDeleteDashboard(currentDashboard.id);
      // Without this the page removed the dashboard from the picker and said
      // "Dashboard deleted" for a request the server rejected — a lie that
      // corrects itself on the next reload, by which point the user has moved on.
      if (!res.success) {
        toast.error(res.error_message || "Failed to delete dashboard");
        return;
      }
      setDashboards((prev) => prev.filter((d) => d.id !== currentDashboard.id));
      setCurrentDashboard(null);
      setWidgets([]);
      setVariables([]);
      setDashboardName("Untitled Dashboard");
      setIsNewDashboard(true);
      setShowDeleteConfirm(false);
      setSaveStatus("");
      toast.success("Dashboard deleted");
    } catch {
      toast.error("Failed to delete dashboard");
    }
  };

  const handleNewDashboard = () => {
    setCurrentDashboard(null);
    setWidgets([]);
    setVariables([]);
    setDashboardName("Untitled Dashboard");
    setIsNewDashboard(true);
    setShowDashboardDropdown(false);
    setSaveStatus("");
  };

  const fetchWidgetData = useCallback(
    async (widget: WidgetConfig) => {
      const gen = (widgetGenRef.current[widget.id] ?? 0) + 1;
      widgetGenRef.current[widget.id] = gen;
      const isStale = () => widgetGenRef.current[widget.id] !== gen;

      const { from, to } = getTimeRange(selectedRange);
      const interval = getIntervalForRange(selectedRange);
      // Read back from the key, so this callback's identity changes exactly
      // when the filters' content does and its deps stay honest.
      const baseFilters = JSON.parse(filtersKey) as AnalyticsFilter[];
      const widgetFilters = [...baseFilters, ...widget.filters];

      setWidgetData((prev) => ({
        ...prev,
        [widget.id]: {
          loading: true,
          error: null,
          data: prev[widget.id]?.data,
        },
      }));

      try {
        let data: unknown;
        // ⚠️ THE FAILURE THAT LOOKED LIKE A READING. Every branch below used to
        // end in `dataOf(res)?.value ?? 0` — so a 500 on a gauge rendered a
        // confident "0", a failed timeseries drew a flat line, and a broken
        // top-N showed an empty leaderboard. On an observability dashboard a
        // fabricated zero is worse than a blank panel: zero errors is a
        // conclusion someone acts on. The `error` field below has existed all
        // along and nothing ever wrote to it for an HTTP failure, because the
        // catch is unreachable when the client returns non-2xx as a value.
        const fail = (message: string) => {
          if (isStale()) return;
          setWidgetData((prev) => ({
            ...prev,
            [widget.id]: { loading: false, error: message, data: null },
          }));
        };

        switch (widget.type) {
          case "gauge": {
            const res = await getGauge({
              aggregation: widget.aggregation,
              field: widget.field,
              filters: widgetFilters,
              from,
              to,
            });
            if (!res.success) return fail(res.error_message);
            data = res.data?.value ?? 0;
            break;
          }
          case "timeseries": {
            const res = await getTimeSeries({
              aggregation: widget.aggregation,
              field: widget.field,
              interval: widget.interval || interval,
              group_by: widget.group_by,
              filters: widgetFilters,
              from,
              to,
              fill_zeros: widget.fill_zeros ?? true,
            });
            if (!res.success) return fail(res.error_message);
            data = res.data?.series ?? [];
            break;
          }
          case "topn": {
            const res = await getTopN({
              aggregation: widget.aggregation,
              field: widget.field,
              group_by: widget.group_by,
              filters: widgetFilters,
              from,
              to,
              limit: widget.limit || 10,
            });
            if (!res.success) return fail(res.error_message);
            data = res.data?.data ?? [];
            break;
          }
          case "compare": {
            const res = await getCompare({
              aggregation: widget.aggregation,
              field: widget.field,
              filters: widgetFilters,
              from,
              to,
            });
            if (!res.success) return fail(res.error_message);
            data = res.data ?? null;
            break;
          }
        }

        if (isStale()) return;
        setWidgetData((prev) => ({
          ...prev,
          [widget.id]: { loading: false, error: null, data },
        }));
      } catch (err) {
        if (isStale()) return;
        setWidgetData((prev) => ({
          ...prev,
          [widget.id]: {
            loading: false,
            error: err instanceof Error ? err.message : "Failed to fetch",
            data: null,
          },
        }));
      }
    },
    [selectedRange, filtersKey],
  );

  const fetchWidgets = useCallback(
    async (list: WidgetConfig[]) => {
      const gen = ++batchGenRef.current;
      setLoading(true);
      await Promise.all(list.map(fetchWidgetData));
      if (batchGenRef.current === gen) setLoading(false);
    },
    [fetchWidgetData],
  );

  const fetchAllWidgets = useCallback(() => fetchWidgets(widgets), [widgets, fetchWidgets]);

  // ⚠️ WHAT MAKES A SAVED DASHBOARD RENDER WITHOUT CLICKING REFRESH. Nothing
  // fetched on load before this: every panel sat on its spinner until Refresh
  // or AutoRefresh ran. Keyed on primitives only, so the order the dashboard's
  // state lands in cannot matter:
  //   - a different dashboard, range or filter set refetches every panel once;
  //   - an added or duplicated widget (a new id) fetches only that panel;
  //   - a deleted widget, or an edit that keeps the id, fetches nothing here
  //     (handleUpdateWidget fetches the edited panel itself).
  // `widgets` is read through the effect event, not listed as a dep: a
  // config-only edit must not refetch the whole dashboard.
  const currentDashboardId = currentDashboard?.id;
  const widgetIdsKey = widgets.map((w) => w.id).join();
  const syncWidgetData = useEffectEvent(() => {
    const prev = fetchedForRef.current;
    const sameContext =
      prev !== null &&
      prev.dashboardId === currentDashboardId &&
      prev.range === selectedRange.label &&
      prev.filters === filtersKey;
    if (!sameContext) {
      fetchedForRef.current = {
        dashboardId: currentDashboardId,
        range: selectedRange.label,
        filters: filtersKey,
        ids: new Set(widgets.map((w) => w.id)),
      };
      if (widgets.length > 0) void fetchWidgets(widgets);
      return;
    }
    for (const widget of widgets) {
      if (prev.ids.has(widget.id)) continue;
      prev.ids.add(widget.id);
      void fetchWidgetData(widget);
    }
  });
  useEffect(() => {
    syncWidgetData();
  }, [currentDashboardId, widgetIdsKey, selectedRange.label, filtersKey]);

  // Adding or duplicating a widget does not fetch here: the new id reaches the
  // effect above, which fetches exactly that panel.
  const handleAddWidget = (widget: WidgetConfig) => {
    setWidgets((prev) => [...prev, widget]);
    setIsAddingWidget(false);
    triggerAutoSave();
  };

  const handleUpdateWidget = (widget: WidgetConfig) => {
    setWidgets((prev) => prev.map((w) => (w.id === widget.id ? widget : w)));
    setEditingWidget(null);
    fetchWidgetData(widget);
    triggerAutoSave();
  };

  const handleDeleteWidget = (id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
    // Retire any request still in flight, so it cannot write the panel back.
    widgetGenRef.current[id] = (widgetGenRef.current[id] ?? 0) + 1;
    setWidgetData((prev) => {
      const newData = { ...prev };
      delete newData[id];
      return newData;
    });
    triggerAutoSave();
  };

  const handleDuplicateWidget = (widget: WidgetConfig) => {
    const newWidget = {
      ...widget,
      id: `widget-${Date.now()}`,
      title: `${widget.title} (Copy)`,
    };
    setWidgets((prev) => [...prev, newWidget]);
    triggerAutoSave();
  };

  const handleAddVariable = () => {
    const newVar: DashboardVariable = {
      name: newVarSource,
      label: newVarSource.charAt(0).toUpperCase() + newVarSource.slice(1),
      source: newVarSource,
      value: "",
    };
    setVariables((prev) => [...prev, newVar]);
    setShowAddVariable(false);
    triggerAutoSave();
  };

  const handleRemoveVariable = (index: number) => {
    setVariables((prev) => prev.filter((_, i) => i !== index));
    triggerAutoSave();
  };

  const handleVariableChange = (index: number, value: string) => {
    setVariables((prev) =>
      prev.map((v, i) => (i === index ? { ...v, value } : v))
    );
  };

  const renderWidget = (widget: WidgetConfig) => {
    const data = widgetData[widget.id];
    const isLoading = data?.loading ?? true;

    // The widget's own failure REPLACES its chart. Rendering the chart anyway
    // and putting a note beside it would leave the two facts on screen at once,
    // and the chart is the louder of the two.
    if (data?.error) {
      return (
        <FailureState
          what={widget.title || "this widget"}
          message={data.error}
          onRetry={() => void fetchWidgetData(widget)}
          className="h-full py-8"
        />
      );
    }

    switch (widget.type) {
      case "gauge":
        return (
          <GaugeCard
            title={widget.title}
            value={(data?.data as number) ?? 0}
            loading={isLoading}
            variant={widget.variant}
          />
        );
      case "timeseries":
        if (widget.display === "table") {
          return (
            <TimeSeriesTable
              title={widget.title}
              series={(data?.data as TimeSeriesSeries[]) ?? []}
              loading={isLoading}
            />
          );
        }
        return (
          <TimeSeriesChart
            title={widget.title}
            series={(data?.data as TimeSeriesSeries[]) ?? []}
            loading={isLoading}
            color={widget.color}
          />
        );
      case "topn":
        return (
          <TopNList
            title={widget.title}
            data={(data?.data as TopNDataPoint[]) ?? []}
            loading={isLoading}
          />
        );
      case "compare": {
        const compareData = data?.data as CompareResponse | null;
        return (
          <CompareCard
            title={widget.title}
            current={compareData?.current ?? 0}
            previous={compareData?.previous ?? 0}
            changePercent={compareData?.change_percent ?? 0}
            loading={isLoading}
            invertColors={widget.invertColors}
          />
        );
      }
    }
  };

  if (dashboardLoading) {
    return (
      <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="flex items-center justify-center py-16">
          <FontAwesomeIcon icon={faSpinner} className="w-6 h-6 text-blue-600 animate-spin" />
        </div>
      </main>
    );
  }

  // Stops here deliberately. Without the dashboard list the page cannot tell a
  // user with no dashboards from a user whose dashboards it failed to fetch, and
  // the fallback it used to pick — a blank "Untitled Dashboard" — asserts the
  // first. Better to render nothing than to render the wrong one confidently.
  if (dashboardsError) {
    return (
      <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <FailureState
          what="your dashboards"
          message={dashboardsError}
          onRetry={() => setDashboardsToken((t) => t + 1)}
        />
      </main>
    );
  }

  return (
    <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="space-y-4 sm:space-y-6">
          {/* Dashboard Header */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Dashboard selector */}
              <div className="relative" ref={dashboardDropdownRef}>
                <button
                  onClick={() => setShowDashboardDropdown(!showDashboardDropdown)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showDashboardDropdown && (
                  <div className="absolute left-0 mt-1 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 overflow-hidden">
                    <button
                      onClick={handleNewDashboard}
                      className="w-full text-left px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-medium border-b border-zinc-100 dark:border-zinc-800 transition-colors"
                    >
                      + New Dashboard
                    </button>
                    {dashboards.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-zinc-400">No dashboards</div>
                    ) : (
                      dashboards.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => loadDashboard(d)}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                            currentDashboard?.id === d.id
                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                              : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          }`}
                        >
                          {d.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Dashboard name (editable) */}
              {isEditingName ? (
                <input
                  ref={nameInputRef}
                  type="text"
                  value={dashboardName}
                  onChange={(e) => setDashboardName(e.target.value)}
                  onBlur={() => {
                    setIsEditingName(false);
                    triggerAutoSave();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setIsEditingName(false);
                      triggerAutoSave();
                    }
                  }}
                  className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 bg-transparent border-b-2 border-blue-500 focus:outline-none px-1"
                />
              ) : (
                <button
                  onClick={() => setIsEditingName(true)}
                  className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1.5 group"
                >
                  {dashboardName}
                  <FontAwesomeIcon
                    icon={faPen}
                    className="text-xs text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </button>
              )}

              {/* Save status */}
              {saveStatus === "saved" && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <FontAwesomeIcon icon={faCheck} className="text-xs" />
                  Saved
                </span>
              )}
              {saveStatus === "saving" && (
                <span className="text-xs text-zinc-400 flex items-center gap-1">
                  <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />
                  Saving...
                </span>
              )}
              {saveStatus === "unsaved" && (
                <span className="text-xs text-amber-500">Unsaved</span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={saveDashboard}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Save
              </button>
              <button
                onClick={handleSaveAs}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
              >
                Save As
              </button>
              {!isNewDashboard && (
                <div className="relative">
                  <button
                    onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
                  >
                    <FontAwesomeIcon icon={faTrash} className="text-xs" />
                  </button>
                  {showDeleteConfirm && (
                    <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 p-3">
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-2">Delete this dashboard?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleDeleteDashboard}
                          className="flex-1 px-2 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="flex-1 px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Variables Bar */}
          {variables.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              {/* Every variable dropdown below reads from labelOptions, so one
                  failed load empties all of them at once — which reads as a
                  project with no services, no envs and no levels in it. */}
              {labelsError && (
                <FailureNote
                  what="variable options"
                  message={labelsError}
                  onRetry={() => setLabelsToken((t) => t + 1)}
                />
              )}
              {variables.map((variable, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {variable.label}:
                  </label>
                  <select
                    value={variable.value}
                    onChange={(e) => handleVariableChange(index, e.target.value)}
                    className="px-2 py-1 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All</option>
                    {/* A saved variable can name a value with no events in the
                        dashboard's range; withSelected keeps it showing. */}
                    {withSelected(labelOptions[variable.source] || [], variable.value).map((val) => (
                      <option key={val} value={val}>{val}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleRemoveVariable(index)}
                    className="p-0.5 text-zinc-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {showAddVariable ? (
                <div className="flex items-center gap-1.5">
                  <select
                    value={newVarSource}
                    onChange={(e) => setNewVarSource(e.target.value as "service" | "env" | "level")}
                    className="px-2 py-1 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="service">Service</option>
                    <option value="env">Environment</option>
                    <option value="level">Level</option>
                  </select>
                  <button
                    onClick={handleAddVariable}
                    className="px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowAddVariable(false)}
                    className="px-2 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddVariable(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg transition-colors"
                >
                  <FontAwesomeIcon icon={faPlus} className="text-xs" />
                  Variable
                </button>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <AnalyticsFilters
              filters={globalFilters}
              onFiltersChange={setGlobalFilters}
              options={labelOptions}
              optionsError={labelsError}
              onRetryOptions={() => setLabelsToken((t) => t + 1)}
            />
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                {TIME_RANGES.map((range) => (
                  <button
                    key={range.label}
                    onClick={() => setSelectedRange(range)}
                    className={`px-3 py-2 text-xs font-medium transition-colors border-r last:border-r-0 border-zinc-200 dark:border-zinc-700 ${
                      selectedRange.label === range.label
                        ? "bg-blue-600 text-white"
                        : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {TIME_RANGE_LABELS[range.from] ?? range.label}
                  </button>
                ))}
              </div>
              <AutoRefresh onRefresh={fetchAllWidgets} loading={loading} />
              <button
                onClick={fetchAllWidgets}
                disabled={loading || widgets.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50 transition-colors"
              >
                <FontAwesomeIcon
                  icon={loading ? faSpinner : faArrowsRotate}
                  className={`text-sm ${loading ? "animate-spin" : ""}`}
                />
              </button>
              <button
                onClick={() => setIsAddingWidget(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <FontAwesomeIcon icon={faPlus} className="text-sm" />
                <span className="hidden sm:inline">Add Widget</span>
              </button>
            </div>
          </div>

          {/* Empty State */}
          {widgets.length === 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-zinc-400 dark:text-zinc-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                Build Your Dashboard
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 max-w-md mx-auto">
                Create custom widgets to visualize your monitoring data. Add
                gauges, time series charts, top N lists, and comparison cards.
              </p>
              <button
                onClick={() => setIsAddingWidget(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <FontAwesomeIcon icon={faPlus} />
                Add Your First Widget
              </button>
            </div>
          )}

          {/* Widget Grid */}
          {widgets.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {widgets.map((widget) => (
                <div key={widget.id} className="relative group">
                  {renderWidget(widget)}
                  {/* Widget actions overlay */}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <button
                      onClick={() => setEditingWidget(widget)}
                      className="p-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 shadow-sm"
                      title="Edit"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDuplicateWidget(widget)}
                      className="p-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 shadow-sm"
                      title="Duplicate"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteWidget(widget.id)}
                      className="p-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 shadow-sm"
                      title="Delete"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      {/* Widget Editor Modal */}
      {(isAddingWidget || editingWidget) && (
        <WidgetEditor
          widget={editingWidget}
          range={selectedRange}
          onSave={editingWidget ? handleUpdateWidget : handleAddWidget}
          onClose={() => {
            setIsAddingWidget(false);
            setEditingWidget(null);
          }}
        />
      )}

      {/* Save As Modal */}
      {showSaveAsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowSaveAsModal(false);
              setSaveAsName("");
            }
          }}
        >
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              setShowSaveAsModal(false);
              setSaveAsName("");
            }}
          />
          <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
              Duplicate Dashboard
            </h3>
            <input
              type="text"
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveAsSubmit();
                if (e.key === "Escape") {
                  setShowSaveAsModal(false);
                  setSaveAsName("");
                }
              }}
              autoFocus
              required
              className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              placeholder="Dashboard name"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowSaveAsModal(false);
                  setSaveAsName("");
                }}
                className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAsSubmit}
                disabled={!saveAsName.trim()}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
