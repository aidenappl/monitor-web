"use client";

import { useState, useEffect, useEffectEvent, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSpinner,
  faArrowsRotate,
  faPlus,
  faTrash,
  faCheck,
  faPen,
  faLink,
  faFileExport,
  faFileImport,
  faClock,
} from "@fortawesome/free-solid-svg-icons";

import {
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
  reqGetDashboard,
  reqSaveDashboard,
  reqDeleteDashboard,
  getLabelValues,
} from "@/services/api";
import { TimeSeriesChart } from "@/components/analytics/TimeSeriesChart";
import { TimeSeriesTable } from "@/components/analytics/TimeSeriesTable";
import { GaugeCard } from "@/components/analytics/GaugeCard";
import { CompareCard } from "@/components/analytics/CompareCard";
import { TopNList } from "@/components/analytics/TopNList";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { TimeRangePicker } from "@/components/analytics/TimeRangePicker";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FailureState, FailureNote } from "@/components/FailureState";
import { TimeRange, getTimeRange, getIntervalForRange, suggestionWindow, withSelected, rangeToParam, rangeFromParam } from "@/tools/timeRange.tools";
import { firstError } from "@/services/api.service";
import { scopeKeyOf } from "@/components/ScopeBoundary";
import { useScope } from "@/hooks/useScope";
import { readScope } from "@/tools/routing.tools";
import { reportError } from "@/services/monitor.service";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ConfirmProvider";
import { useSelection } from "@/hooks/useSelection";
import { useRole } from "@/hooks/useRole";
import { runBulk, toastBulkResult } from "@/tools/bulk.tools";
import { copyText } from "@/tools/clipboard.tools";
import { formatTimeAgo } from "@/tools/format.tools";
import { useUrlState, urlString } from "@/hooks/useUrlState";
import {
  DashboardConfig,
  DashboardVariable,
  DashboardWidget,
  VersionedDashboard,
  DEFAULT_RANGE,
  defaultSize,
  exportDashboard,
  parseConfigStrict,
  parseDashboardImport,
  sizeClass,
  widgetRange,
} from "@/components/dashboard/dashboard.tools";

// The editor is only ever needed after a click, so it stays out of the
// route's first-load bundle.
const WidgetEditor = dynamic(
  () => import("@/components/dashboard/WidgetEditor").then((m) => m.WidgetEditor),
  { ssr: false },
);

/** `?filters=` — the global filter bar as JSON. Anything unparseable reads as none. */
function parseFiltersParam(raw: string): AnalyticsFilter[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AnalyticsFilter[]) : null;
  } catch {
    // A hand-edited or truncated link; the dashboard's saved filters apply.
    return null;
  }
}

interface WidgetData {
  loading: boolean;
  error: string | null;
  data: unknown;
}

function parseDashboardConfig(
  config: string,
  dashboardId?: string | number,
): DashboardConfig {
  try {
    return parseConfigStrict(config);
  } catch (err) {
    // A stored layout that will not parse renders as an EMPTY dashboard — and
    // the next autosave would write that emptiness back. Nothing else says so.
    reportError("dashboard.config.parse.failed", err, {
      dashboard_id: dashboardId,
      config_length: config.length,
      outcome: "dashboard rendered with no widgets or variables",
    });
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
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "draft" | "conflict" | "">("");
  const [showSaveAsModal, setShowSaveAsModal] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const dashboardDropdownRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Widget state
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [widgetData, setWidgetData] = useState<Record<string, WidgetData>>({});
  const [selectedRange, setSelectedRange] = useState<TimeRange>(DEFAULT_RANGE);
  const [globalFilters, setGlobalFilters] = useState<AnalyticsFilter[]>([]);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null);
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

  // ⚠️ SAVES RUN ONE AT A TIME, AND READ IDENTITY FROM REFS. Two overlapping
  // saves used to be harmless (last write wins); with a version precondition
  // the second one carries the version the first is about to bump and 409s
  // against THIS TAB. Worse, on a new dashboard both would POST and create two.
  // So every save is chained behind the previous one, and the id + version it
  // writes against are read from refs the previous save has already updated.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const dashIdRef = useRef<string | null>(null);
  const versionRef = useRef<number | undefined>(undefined);
  const [conflict, setConflict] = useState(false);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const widgetRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // The view on screen, mirrored into the URL so a link reproduces it:
  // which dashboard, its range and its global filters.
  const [urlDash, setUrlDash] = useUrlState("d", urlString, { default: "" });
  const [urlRange, setUrlRange] = useUrlState("range", urlString, { default: "" });
  const [urlFilters, setUrlFilters] = useUrlState("filters", urlString, { default: "" });
  // What the address bar said on arrival. A shared link's range and filters win
  // over the dashboard's saved defaults — once, for the dashboard it named.
  const arrivalRef = useRef({ d: urlDash, range: urlRange, filters: urlFilters });

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
  const { canWrite } = useRole();
  const confirm = useConfirm();
  const [showManage, setShowManage] = useState(false);

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
        const arrival = arrivalRef.current;
        const linked = arrival.d ? list.find((d) => d.id === arrival.d) : undefined;
        if (arrival.d && !linked) {
          toast.error("The linked dashboard doesn't exist in this project — showing the first one instead.", {
            id: "dashboard-link-missing",
          });
        }
        const first = linked ?? list[0];
        if (first) {
          loadDashboard(first, linked ? { range: arrival.range, filters: arrival.filters } : undefined);
        } else {
          setIsNewDashboard(true);
        }
        arrivalRef.current = { d: "", range: "", filters: "" };
      } catch (err) {
        reportError("dashboard.list.failed", err, {
          outcome: "dashboard picker shows its failure state",
        });
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
      } catch (err) {
        reportError("dashboard.variables.load.failed", err, {
          outcome: "variable pickers show their failure note",
        });
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

  const loadDashboard = (dashboard: SavedDashboard, fromLink?: { range: string; filters: string }) => {
    cancelAutoSave();
    dashIdRef.current = dashboard.id;
    versionRef.current = (dashboard as VersionedDashboard).version;
    setCurrentDashboard(dashboard);
    setDashboardName(dashboard.name);
    setNameError(null);
    setIsNewDashboard(false);
    const config = parseDashboardConfig(dashboard.config, dashboard.id);
    setWidgets(config.widgets);
    setVariables(config.variables);
    // The dashboard's saved view, unless the link that opened it said otherwise.
    const range =
      rangeFromParam(fromLink?.range) ?? rangeFromParam(config.range) ?? DEFAULT_RANGE;
    const filters = parseFiltersParam(fromLink?.filters ?? "") ?? config.filters ?? [];
    setSelectedRange(range);
    setGlobalFilters(filters);
    setUrlDash(dashboard.id);
    setUrlRange(rangeToParam(range));
    setUrlFilters(filters.length > 0 ? JSON.stringify(filters) : "");
    setShowDashboardDropdown(false);
    setSaveStatus("saved");
  };

  /** Range and global filters are part of the saved dashboard, and of the URL. */
  const handleRangeChange = (range: TimeRange) => {
    setSelectedRange(range);
    setUrlRange(rangeToParam(range));
    markViewChanged();
  };
  const handleFiltersChange = (filters: AnalyticsFilter[]) => {
    setGlobalFilters(filters);
    setUrlFilters(filters.length > 0 ? JSON.stringify(filters) : "");
    markViewChanged();
  };
  // Changing the view does NOT autosave: looking at 7d for a minute must not
  // rewrite everyone's default. It marks the dashboard unsaved, and Save (or
  // the next autosave of a real edit) keeps it.
  const markViewChanged = () => {
    if (canWrite && dashIdRef.current) setSaveStatus("unsaved");
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
    // A viewer may change a variable or the range to LOOK at a dashboard;
    // that must not become a write. monitor-core refuses it (403 → the client
    // redirects to /unauthorized), so an autosave here would throw a viewer
    // off the page for picking a service from a dropdown.
    if (!canWrite) return;
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
      // Through the ref, never a captured `saveDashboard`: this callback is
      // queued by the handler that has only just CALLED setWidgets, so the
      // closure in scope here still holds the widgets from before the edit.
      // Calling it directly saved the previous state and then said "Saved".
      autoSaveTimerRef.current = null;
      queueSave({ auto: true });
    }, 2000);
  }, [scopeKey, canWrite]);

  /** Drops a pending autosave without running it (switching dashboards). */
  const cancelAutoSave = () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  };

  /**
   * Runs a pending autosave NOW and resolves once it has landed. Anything that
   * reads the dashboard back from the server-side list — Manage's widget
   * counts, its Duplicate, an export — calls this first, or it shows and copies
   * the layout from before the last two seconds of edits.
   */
  const flushAutoSave = () => {
    if (autoSaveTimerRef.current) {
      cancelAutoSave();
      queueSave({ auto: true });
    }
    return saveChainRef.current;
  };

  /** Chains a save behind any save still in flight. See saveChainRef. */
  const queueSave = (opts: { auto: boolean }) => {
    saveChainRef.current = saveChainRef.current.then(() => saveDashboardRef.current(opts));
    return saveChainRef.current;
  };

  /** The config as stored: layout, variables, and the dashboard's default view. */
  const composeConfig = () =>
    JSON.stringify({
      widgets,
      variables,
      range: rangeToParam(selectedRange),
      filters: globalFilters,
    } satisfies DashboardConfig);

  const saveDashboard = useCallback(async ({ auto }: { auto: boolean }) => {
    const name = dashboardName.trim();
    if (!name) {
      setNameError("A dashboard needs a name.");
      setSaveStatus("unsaved");
      return;
    }
    const id = dashIdRef.current;
    // ⚠️ A NEW DASHBOARD IS CREATED BY A WIDGET OR BY SAVE — NOT BY A RENAME.
    // Every edit used to autosave, so typing a name into the placeholder POSTed
    // an empty dashboard, and exploring the page left junk behind for everyone.
    if (!id && auto && widgets.length === 0) {
      setSaveStatus("draft");
      return;
    }
    const config = composeConfig();
    setSaveStatus("saving");

    try {
      if (!id) {
        const res = await reqCreateDashboard(name, "", config);
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
        dashIdRef.current = created.id;
        versionRef.current = (created as VersionedDashboard).version;
        setCurrentDashboard(created);
        setIsNewDashboard(false);
        setDashboards((prev) => [...prev, created]);
        setUrlDash(created.id);
      } else {
        const res = await reqSaveDashboard(id, {
          name,
          description: currentDashboard?.description ?? "",
          config,
          version: versionRef.current,
        });
        if (!res.success) {
          setSaveStatus(res.status === 409 ? "conflict" : "unsaved");
          // ⚠️ 409: someone else (another tab, another person) saved since this
          // dashboard was loaded. Last-write-wins used to erase their change
          // without either of you knowing; now the user chooses.
          if (res.status === 409) setConflict(true);
          else toast.error(res.error_message || "Failed to save dashboard");
          return;
        }
        const updated = res.data;
        // A stale response for a dashboard the user has since switched away
        // from must not become the current one.
        if (dashIdRef.current !== updated.id) return;
        versionRef.current = (updated as VersionedDashboard).version;
        setCurrentDashboard(updated);
        setDashboards((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      }
      setSaveStatus("saved");
    } catch (err) {
      reportError("dashboard.save.failed", err, {
        dashboard_id: id ?? undefined,
        is_new: !id,
        widget_count: widgets.length,
        outcome: "changes left unsaved; user toasted",
      });
      setSaveStatus("unsaved");
      toast.error("Failed to save dashboard");
    }
    // composeConfig reads widgets/variables/range/filters, all listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets, variables, dashboardName, currentDashboard, selectedRange, globalFilters]);

  // The latest committed `saveDashboard`, for the autosave timer above. By the
  // time the timer fires (2 s), the edit that queued it has rendered and this
  // has been updated, so the save composes the CURRENT widgets and variables.
  const saveDashboardRef = useRef(saveDashboard);
  useEffect(() => {
    saveDashboardRef.current = saveDashboard;
  });

  const handleSaveAs = () => {
    setSaveAsName(`${dashboardName.trim() || "Untitled Dashboard"} (copy)`);
    setShowSaveAsModal(true);
  };

  const handleSaveAsSubmit = async () => {
    const name = saveAsName.trim();
    if (!name) return;
    const config = composeConfig();
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
    } catch (err) {
      reportError("dashboard.duplicate.failed", err, {
        dashboard_id: currentDashboard?.id,
        outcome: "no copy created; user toasted",
      });
      toast.error("Failed to duplicate dashboard");
    } finally {
      setShowSaveAsModal(false);
      setSaveAsName("");
    }
  };

  const handleDeleteDashboard = async () => {
    if (!currentDashboard) return;
    // Nothing pending may land after the delete and recreate it.
    cancelAutoSave();
    const ok = await confirm({
      title: `Delete “${currentDashboard.name}”?`,
      description: `Its ${widgets.length} widget${widgets.length === 1 ? "" : "s"} and variables are removed for everyone in this project. The data they chart is not affected.`,
      confirmLabel: "Delete dashboard",
      destructive: true,
    });
    if (!ok) return;
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
      handleNewDashboard();
      toast.success("Dashboard deleted");
    } catch (err) {
      reportError("dashboard.delete.failed", err, {
        dashboard_id: currentDashboard?.id,
        outcome: "dashboard kept; user toasted",
      });
      toast.error("Failed to delete dashboard");
    }
  };

  const handleNewDashboard = () => {
    cancelAutoSave();
    dashIdRef.current = null;
    versionRef.current = undefined;
    setCurrentDashboard(null);
    setWidgets([]);
    setVariables([]);
    setDashboardName("Untitled Dashboard");
    setNameError(null);
    setIsNewDashboard(true);
    setShowDashboardDropdown(false);
    setSelectedRange(DEFAULT_RANGE);
    setGlobalFilters([]);
    setUrlDash("");
    setUrlRange("");
    setUrlFilters("");
    setSaveStatus("");
  };

  /** Resolve a 409: take the stored version, or write ours over it. */
  const resolveConflict = async (choice: "theirs" | "mine") => {
    const id = dashIdRef.current;
    if (!id) return;
    setConflictBusy(true);
    const res = await reqGetDashboard(id);
    if (!res.success) {
      setConflictBusy(false);
      toast.error(res.error_message || "Could not load the latest version of this dashboard");
      return;
    }
    if (choice === "theirs") {
      setConflictBusy(false);
      setConflict(false);
      loadDashboard(res.data);
      toast.success("Loaded the latest saved version");
      return;
    }
    // Overwrite: adopt their version number so the precondition passes, then
    // save what is on screen.
    versionRef.current = (res.data as VersionedDashboard).version;
    // Closed first: if this save races yet another one and 409s again, the
    // save reopens the dialog rather than having it closed underneath it.
    setConflict(false);
    await queueSave({ auto: false });
    setConflictBusy(false);
  };

  /**
   * Leaves rename mode. A blank name used to be posted as-is (or, in Manage,
   * silently reverted); Enter now keeps the field open with the reason, and
   * blur — the user clicking away — puts the old name back.
   */
  const commitName = (how: "enter" | "blur") => {
    const trimmed = dashboardName.trim();
    if (!trimmed) {
      if (how === "enter") {
        setNameError("A dashboard needs a name.");
        return;
      }
      setDashboardName(currentDashboard?.name ?? "Untitled Dashboard");
      setNameError(null);
      setIsEditingName(false);
      return;
    }
    setNameError(null);
    setIsEditingName(false);
    if (trimmed === (currentDashboard?.name ?? "Untitled Dashboard")) {
      setDashboardName(trimmed);
      return;
    }
    setDashboardName(trimmed);
    triggerAutoSave();
  };

  /** Manage reads the server-side list, so any pending edit lands first. */
  const openManage = async () => {
    setShowManage(true);
    await flushAutoSave();
  };

  /** The URL already mirrors the dashboard, range and filters, so it IS the share link. */
  const handleCopyLink = () => {
    void copyText(window.location.href, { label: "Dashboard link" });
  };

  const fetchWidgetData = useCallback(
    async (widget: DashboardWidget) => {
      const gen = (widgetGenRef.current[widget.id] ?? 0) + 1;
      widgetGenRef.current[widget.id] = gen;
      const isStale = () => widgetGenRef.current[widget.id] !== gen;

      // A widget pinned to its own range reads that, whatever the dashboard says.
      const range = widgetRange(widget) ?? selectedRange;
      const { from, to } = getTimeRange(range);
      const interval = getIntervalForRange(range);
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
        reportError("dashboard.widget.load.failed", err, {
          widget_id: widget.id,
          widget_type: widget.type,
          outcome: "widget shows its error",
        });
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
    async (list: DashboardWidget[]) => {
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
  const handleAddWidget = (widget: DashboardWidget) => {
    setWidgets((prev) => [...prev, widget]);
    setIsAddingWidget(false);
    triggerAutoSave();
  };

  const handleUpdateWidget = (widget: DashboardWidget) => {
    setWidgets((prev) => prev.map((w) => (w.id === widget.id ? widget : w)));
    setEditingWidget(null);
    fetchWidgetData(widget);
    triggerAutoSave();
  };

  const handleDeleteWidget = async (id: string) => {
    const widget = widgets.find((w) => w.id === id);
    const ok = await confirm({
      title: `Remove “${widget?.title ?? "this widget"}”?`,
      description: "The dashboard saves automatically, so this takes effect for everyone.",
      confirmLabel: "Remove widget",
      destructive: true,
    });
    if (!ok) return;
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

  // Right after its source, scrolled to and flashed. Appending it put the copy
  // below the fold of a full dashboard with nothing to say it had happened.
  const handleDuplicateWidget = (widget: DashboardWidget) => {
    const newWidget = {
      ...widget,
      id: `widget-${Date.now()}`,
      title: `${widget.title} (copy)`,
    };
    setWidgets((prev) => {
      const i = prev.findIndex((w) => w.id === widget.id);
      const next = [...prev];
      next.splice(i < 0 ? next.length : i + 1, 0, newWidget);
      return next;
    });
    setHighlightId(newWidget.id);
    triggerAutoSave();
  };

  useEffect(() => {
    if (!highlightId) return;
    widgetRefs.current[highlightId]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const t = setTimeout(() => setHighlightId(null), 1600);
    return () => clearTimeout(t);
  }, [highlightId]);

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

  const renderWidget = (widget: DashboardWidget) => {
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
            interval={widget.interval || getIntervalForRange(widgetRange(widget) ?? selectedRange)}
            partialBuckets="dashed"
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
      <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
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
      <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
        <h1 className="sr-only">Dashboards</h1>
        <FailureState
          what="your dashboards"
          message={dashboardsError}
          onRetry={() => setDashboardsToken((t) => t + 1)}
        />
      </main>
    );
  }

  return (
    <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-10 py-4 sm:py-6">
        <div className="space-y-4 sm:space-y-6">
          {/* Dashboard Header */}
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              {/* Dashboard selector */}
              <div className="relative shrink-0" ref={dashboardDropdownRef}>
                <button
                  onClick={() => setShowDashboardDropdown(!showDashboardDropdown)}
                  aria-expanded={showDashboardDropdown}
                  aria-haspopup="menu"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                  {/* It was an icon and a chevron: nothing said it was where
                      the other dashboards are. */}
                  <span>Dashboards</span>
                  <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{dashboards.length}</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showDashboardDropdown && (
                  <div className="absolute left-0 mt-1 w-64 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50">
                    {canWrite && (
                      <button
                        onClick={handleNewDashboard}
                        className="w-full text-left px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-medium border-b border-zinc-100 dark:border-zinc-800 transition-colors"
                      >
                        + New Dashboard
                      </button>
                    )}
                    {dashboards.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-zinc-400">No dashboards</div>
                    ) : (
                      dashboards.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => loadDashboard(d)}
                          title={d.name}
                          className={`w-full truncate text-left px-3 py-2 text-sm transition-colors ${
                            currentDashboard?.id === d.id
                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                              : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          }`}
                        >
                          {d.name}
                        </button>
                      ))
                    )}
                    {(dashboards.length > 0 || canWrite) && (
                      <button
                        onClick={() => {
                          setShowDashboardDropdown(false);
                          void openManage();
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-t border-zinc-100 dark:border-zinc-800 transition-colors"
                      >
                        {dashboards.length > 0 ? "Manage, export & import…" : "Import a dashboard…"}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Dashboard name (editable). The page's one <h1>. */}
              <div className="flex min-w-0 flex-1 items-center gap-2 basis-48">
                {isEditingName && canWrite ? (
                  <div className="min-w-0 flex-1">
                    <h1 className="sr-only">{dashboardName || "Dashboard"}</h1>
                    <label htmlFor="dashboard-name" className="sr-only">Dashboard name</label>
                    <input
                      id="dashboard-name"
                      ref={nameInputRef}
                      type="text"
                      value={dashboardName}
                      onChange={(e) => {
                        setDashboardName(e.target.value);
                        if (e.target.value.trim()) setNameError(null);
                      }}
                      onBlur={() => commitName("blur")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitName("enter");
                        if (e.key === "Escape") {
                          setDashboardName(currentDashboard?.name ?? "Untitled Dashboard");
                          setNameError(null);
                          setIsEditingName(false);
                        }
                      }}
                      aria-invalid={nameError ? true : undefined}
                      aria-describedby={nameError ? "dashboard-name-error" : undefined}
                      className="w-full min-w-0 text-lg font-semibold text-zinc-900 dark:text-zinc-100 bg-transparent border-b-2 border-blue-500 focus:outline-none px-1"
                    />
                    {nameError && (
                      <p id="dashboard-name-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {nameError}
                      </p>
                    )}
                  </div>
                ) : (
                  <h1 className="min-w-0">
                    <button
                      onClick={() => canWrite && setIsEditingName(true)}
                      disabled={!canWrite}
                      title={canWrite ? `Rename “${dashboardName}”` : dashboardName}
                      className="disabled:cursor-default disabled:hover:text-zinc-900 dark:disabled:hover:text-zinc-100 text-lg font-semibold text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 flex max-w-full items-center gap-1.5 group"
                    >
                      <span className="truncate">{dashboardName}</span>
                      <FontAwesomeIcon
                        icon={faPen}
                        aria-hidden="true"
                        className="shrink-0 text-xs text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      />
                    </button>
                  </h1>
                )}

                {/* Save status */}
                <span aria-live="polite" className="shrink-0">
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
                    <span className="text-xs text-amber-600 dark:text-amber-500">Unsaved</span>
                  )}
                  {saveStatus === "conflict" && (
                    <span className="text-xs text-red-600 dark:text-red-400">Not saved — changed elsewhere</span>
                  )}
                  {saveStatus === "draft" && (
                    <span
                      className="text-xs text-zinc-500 dark:text-zinc-400"
                      title="Nothing is created until you add a widget or press Save."
                    >
                      Draft
                    </span>
                  )}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {canWrite && (
                <>
                  <button
                    onClick={() => {
                      cancelAutoSave();
                      void queueSave({ auto: false });
                    }}
                    title={isNewDashboard ? "Create this dashboard" : "Save widgets, variables, range and filters"}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    {isNewDashboard ? "Create" : "Save"}
                  </button>
                  <button
                    onClick={handleSaveAs}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
                  >
                    Save As
                  </button>
                </>
              )}
              {!isNewDashboard && (
                <button
                  onClick={handleCopyLink}
                  aria-label="Copy link to this view"
                  title="Copy link to this view (dashboard, range and filters)"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
                >
                  <FontAwesomeIcon icon={faLink} className="text-xs" />
                </button>
              )}
              {canWrite && !isNewDashboard && (
                <button
                  onClick={() => void handleDeleteDashboard()}
                  aria-label="Delete dashboard"
                  title="Delete dashboard"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
                >
                  <FontAwesomeIcon icon={faTrash} className="text-xs" />
                </button>
              )}
            </div>
          </div>

          {/* Variables Bar. Rendered whenever there is something to show OR a
              way to add one: it used to be gated on `variables.length > 0`,
              which hid the only "+ Variable" button on every dashboard that
              had none — so a variable could never be created. */}
          {(variables.length > 0 || canWrite) && (
            <div className="flex items-center gap-3 flex-wrap" role="group" aria-label="Dashboard variables">
              {/* Every variable dropdown below reads from labelOptions, so one
                  failed load empties all of them at once — which reads as a
                  project with no services, no envs and no levels in it. */}
              {labelsError && variables.length > 0 && (
                <FailureNote
                  what="variable options"
                  message={labelsError}
                  onRetry={() => setLabelsToken((t) => t + 1)}
                />
              )}
              {variables.map((variable, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <label htmlFor={`dashboard-var-${index}`} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {variable.label}:
                  </label>
                  <select
                    id={`dashboard-var-${index}`}
                    value={variable.value}
                    onChange={(e) => handleVariableChange(index, e.target.value)}
                    className="max-w-[12rem] px-2 py-1 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All</option>
                    {/* A saved variable can name a value with no events in the
                        dashboard's range; withSelected keeps it showing. */}
                    {withSelected(labelOptions[variable.source] || [], variable.value).map((val) => (
                      <option key={val} value={val}>{val}</option>
                    ))}
                  </select>
                  {canWrite && (
                    <button
                      onClick={() => handleRemoveVariable(index)}
                      aria-label={`Remove variable ${variable.label}`}
                      title={`Remove variable ${variable.label}`}
                      className="p-0.5 text-zinc-400 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              {canWrite &&
                (showAddVariable ? (
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="dashboard-new-var" className="sr-only">Variable source</label>
                    <select
                      id="dashboard-new-var"
                      value={newVarSource}
                      onChange={(e) => setNewVarSource(e.target.value as "service" | "env" | "level")}
                      className="px-2 py-1 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    title="A dropdown at the top of the dashboard that filters every widget by service, environment or level"
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg transition-colors"
                  >
                    <FontAwesomeIcon icon={faPlus} className="text-xs" />
                    Variable
                  </button>
                ))}
            </div>
          )}

          {/* Controls */}
          <div className="flex flex-col xl:flex-row gap-3 xl:gap-4 xl:items-center justify-between">
            <div className="min-w-0 max-w-full">
              <AnalyticsFilters
                filters={globalFilters}
                onFiltersChange={handleFiltersChange}
                options={labelOptions}
                optionsError={labelsError}
                onRetryOptions={() => setLabelsToken((t) => t + 1)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TimeRangePicker value={selectedRange} onChange={handleRangeChange} className="max-w-full" />
              <AutoRefresh onRefresh={fetchAllWidgets} loading={loading} />
              <button
                onClick={fetchAllWidgets}
                disabled={loading || widgets.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50 transition-colors"
                aria-label="Refresh"
                title="Refresh"
              >
                <FontAwesomeIcon
                  icon={loading ? faSpinner : faArrowsRotate}
                  className={`text-sm ${loading ? "animate-spin" : ""}`}
                />
              </button>
              {canWrite && (
                <button
                  onClick={() => setIsAddingWidget(true)}
                  aria-label="Add widget"
                  title="Add widget"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  <FontAwesomeIcon icon={faPlus} className="text-sm" />
                  <span className="hidden sm:inline">Add Widget</span>
                </button>
              )}
            </div>
          </div>

          {/* Empty State */}
          {widgets.length === 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-6 sm:p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-zinc-400 dark:text-zinc-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                Build Your Dashboard
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 max-w-md mx-auto">
                Create custom widgets to visualize your monitoring data. Add
                gauges, time series charts, top N lists, and comparison cards.
                {isNewDashboard && canWrite && " The dashboard is created when you add the first one."}
              </p>
              {canWrite && (
                <button
                  onClick={() => setIsAddingWidget(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  <FontAwesomeIcon icon={faPlus} />
                  Add Your First Widget
                </button>
              )}
            </div>
          )}

          {/* Widget Grid — 12 columns, dense, so quarter-width stat cards pack
              beside each other rather than each leaving a chart-height hole. */}
          {widgets.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-12 grid-flow-row-dense gap-4">
              {widgets.map((widget) => {
                const pinned = widgetRange(widget);
                return (
                  <div
                    key={widget.id}
                    ref={(el) => {
                      widgetRefs.current[widget.id] = el;
                    }}
                    className={`relative group min-w-0 ${sizeClass(widget.size ?? defaultSize(widget))} ${
                      highlightId === widget.id ? "rounded-xl ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950" : ""
                    } ${
                      // The cards draw their own titles. Reserve the corner the
                      // hover actions occupy, and keep a long title to one line,
                      // so the icons never sit on top of the text.
                      canWrite
                        ? "[&_h3]:min-w-0 [&_h3]:truncate [&_h3]:pr-24 [&_p.text-sm:first-child]:truncate [&_p.text-sm:first-child]:pr-24"
                        : "[&_h3]:min-w-0 [&_h3]:truncate [&_p.text-sm:first-child]:truncate"
                    }`}
                  >
                    {renderWidget(widget)}
                    {pinned && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <FontAwesomeIcon icon={faClock} aria-hidden="true" className="text-[10px]" />
                        {pinned.label} — ignores the dashboard range
                      </p>
                    )}
                    {/* Widget actions overlay */}
                    {canWrite && (
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-1">
                      <button
                        onClick={() => setEditingWidget(widget)}
                        className="p-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 shadow-sm"
                        title={`Edit “${widget.title}”`}
                        aria-label={`Edit ${widget.title}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDuplicateWidget(widget)}
                        className="p-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 shadow-sm"
                        title="Duplicate widget"
                        aria-label={`Duplicate ${widget.title}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => void handleDeleteWidget(widget.id)}
                        className="p-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 shadow-sm"
                        title="Delete widget"
                        aria-label={`Delete ${widget.title}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    )}
                  </div>
                );
              })}
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
      <Modal
        open={showSaveAsModal}
        onClose={() => {
          setShowSaveAsModal(false);
          setSaveAsName("");
        }}
        title="Save as a new dashboard"
        description="Copies the widgets and variables on screen into a new dashboard. This one is left unchanged."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowSaveAsModal(false);
                setSaveAsName("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleSaveAsSubmit()} disabled={!saveAsName.trim()}>
              Save copy
            </Button>
          </>
        }
      >
        <label htmlFor="save-as-name" className="sr-only">Dashboard name</label>
        <input
          id="save-as-name"
          type="text"
          value={saveAsName}
          onChange={(e) => setSaveAsName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSaveAsSubmit();
          }}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Dashboard name"
        />
      </Modal>

      {showManage && (
        <ManageDashboards
          dashboards={dashboards}
          currentId={currentDashboard?.id}
          // The open dashboard as it is ON SCREEN. The list row is the last
          // server copy, which lags any edit still inside the autosave window —
          // that is how Manage showed "4 widgets" beside five, and how its
          // Duplicate copied a layout missing the newest one.
          liveConfig={currentDashboard ? composeConfig() : undefined}
          canWrite={canWrite}
          onClose={() => setShowManage(false)}
          onOpen={(d) => {
            setShowManage(false);
            loadDashboard(d);
          }}
          onImported={(d) => {
            setShowManage(false);
            setDashboards((prev) => [...prev, d]);
            loadDashboard(d);
          }}
          onChanged={(next, removedCurrent) => {
            setDashboards(next);
            if (removedCurrent) {
              handleNewDashboard();
              return;
            }
            // A rename of the open dashboard from Manage bumps its version and
            // its name; adopt both, or the next autosave would 409 against us.
            const mine = next.find((d) => d.id === dashIdRef.current);
            if (mine) {
              versionRef.current = (mine as VersionedDashboard).version;
              setCurrentDashboard(mine);
              setDashboardName(mine.name);
            }
          }}
        />
      )}

      {/* 409 from a save: someone else saved this dashboard since it was loaded. */}
      <Modal
        open={conflict}
        onClose={() => setConflict(false)}
        dismissible={!conflictBusy}
        title="This dashboard was changed somewhere else"
        description="Another tab or another person saved it after you opened it. Your changes have not been saved. Load theirs (discarding yours), or overwrite theirs with what is on your screen."
        footer={
          <>
            <Button variant="secondary" disabled={conflictBusy} onClick={() => setConflict(false)}>
              Decide later
            </Button>
            <Button variant="secondary" disabled={conflictBusy} onClick={() => void resolveConflict("theirs")}>
              Load latest
            </Button>
            <Button variant="destructive" loading={conflictBusy} onClick={() => void resolveConflict("mine")}>
              Overwrite with mine
            </Button>
          </>
        }
      />
    </main>
  );
}

/**
 * Every dashboard in the project, in one table: open, rename, duplicate,
 * export, delete — one at a time or in bulk — plus import. The picker could
 * only OPEN a dashboard; renaming or deleting one meant opening it first, and
 * deleting five meant doing that five times.
 */
function ManageDashboards({
  dashboards,
  currentId,
  liveConfig,
  canWrite,
  onClose,
  onOpen,
  onImported,
  onChanged,
}: {
  dashboards: SavedDashboard[];
  currentId?: string;
  /** The open dashboard's config as on screen; wins over its list row. */
  liveConfig?: string;
  canWrite: boolean;
  onClose: () => void;
  onOpen: (d: SavedDashboard) => void;
  onImported: (d: SavedDashboard) => void;
  onChanged: (next: SavedDashboard[], removedCurrent: boolean) => void;
}) {
  const confirm = useConfirm();
  const ids = dashboards.map((d) => d.id);
  const selection = useSelection(ids);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const visible = dashboards.filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const configOf = (d: SavedDashboard) => (d.id === currentId && liveConfig !== undefined ? liveConfig : d.config);

  const widgetCount = (d: SavedDashboard) => {
    try {
      return parseConfigStrict(configOf(d) || "{}").widgets.length;
    } catch {
      // A config that will not parse shows as "—", not as a failure.
      return null;
    }
  };

  const cancelRename = () => {
    setRenaming(null);
    setRenameError(null);
  };

  const rename = async (d: SavedDashboard) => {
    const name = renameValue.trim();
    // Blank is an error with a reason, not a silent revert.
    if (!name) {
      setRenameError("A dashboard needs a name.");
      return;
    }
    cancelRename();
    if (name === d.name) return;
    const res = await reqSaveDashboard(d.id, {
      name,
      description: d.description,
      config: configOf(d),
      version: (d as VersionedDashboard).version,
    });
    if (!res.success) {
      toast.error(
        res.status === 409
          ? "Someone else changed this dashboard since the list loaded. Reopen Manage and try again."
          : res.error_message || "Could not rename the dashboard",
      );
      return;
    }
    onChanged(dashboards.map((x) => (x.id === d.id ? res.data : x)), false);
  };

  const duplicate = async (d: SavedDashboard) => {
    const res = await reqCreateDashboard(`${d.name} (copy)`, d.description, configOf(d));
    if (!res.success) {
      toast.error(res.error_message || "Could not duplicate the dashboard");
      return;
    }
    toast.success("Dashboard duplicated");
    onChanged([...dashboards, res.data], false);
  };

  const exportOne = (d: SavedDashboard) => {
    let config: DashboardConfig;
    try {
      config = parseConfigStrict(configOf(d) || "{}");
    } catch {
      toast.error("This dashboard's stored layout is not valid JSON, so there is nothing to export.");
      return;
    }
    void copyText(exportDashboard(d.name, d.description, config), { label: "Dashboard JSON" });
  };

  const runImport = async () => {
    const parsed = parseDashboardImport(importText);
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    setImportBusy(true);
    const { name, description, config } = parsed.value;
    const res = await reqCreateDashboard(name, description, JSON.stringify(config));
    setImportBusy(false);
    if (!res.success) {
      setImportError(res.error_message || "Could not create the dashboard.");
      return;
    }
    toast.success(`Imported “${name}”`);
    onImported(res.data);
  };

  const remove = async (targets: SavedDashboard[]) => {
    const ok = await confirm({
      title: targets.length === 1 ? `Delete “${targets[0].name}”?` : `Delete ${targets.length} dashboards?`,
      description: `${targets.length === 1 ? "It is" : "They are"} removed for everyone in this project. The data charted is not affected.`,
      confirmLabel: targets.length === 1 ? "Delete dashboard" : `Delete ${targets.length}`,
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const result = await runBulk(targets, (d) => reqDeleteDashboard(d.id));
    setBusy(false);
    toastBulkResult(result, "Deleted", "dashboard");
    const gone = new Set(result.succeeded.map((d) => d.id));
    selection.clear();
    onChanged(dashboards.filter((d) => !gone.has(d.id)), currentId !== undefined && gone.has(currentId));
  };

  if (importing) {
    return (
      <Modal
        open
        onClose={() => setImporting(false)}
        dismissible={!importBusy}
        title="Import a dashboard"
        description="Paste JSON from “Export” on any Monitor dashboard — from this project or another zone. It is created as a new dashboard here; nothing existing is changed."
        widthClass="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" disabled={importBusy} onClick={() => setImporting(false)}>
              Back
            </Button>
            <Button loading={importBusy} disabled={!importText.trim()} onClick={() => void runImport()}>
              Import
            </Button>
          </>
        }
      >
        <label htmlFor="dashboard-import" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Dashboard JSON
        </label>
        <textarea
          id="dashboard-import"
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value);
            setImportError(null);
          }}
          rows={10}
          spellCheck={false}
          aria-invalid={importError ? true : undefined}
          aria-describedby={importError ? "dashboard-import-error" : undefined}
          placeholder={'{ "kind": "monitor.dashboard", … }'}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-base sm:text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400">
          <FontAwesomeIcon icon={faFileImport} aria-hidden="true" />
          Or choose a .json file
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              file.text().then(
                (t) => {
                  setImportText(t);
                  setImportError(null);
                },
                () => setImportError("Could not read that file."),
              );
            }}
          />
        </label>
        {importError && (
          <p id="dashboard-import-error" role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
            {importError}
          </p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Dashboards"
      description={`${dashboards.length} in this project.`}
      widthClass="max-w-2xl"
      dismissible={!busy}
      footer={
        <>
          {canWrite && (
            <Button
              variant="secondary"
              onClick={() => {
                setImportText("");
                setImportError(null);
                setImporting(true);
              }}
              className="mr-auto"
            >
              <FontAwesomeIcon icon={faFileImport} aria-hidden="true" className="mr-1.5" />
              Import
            </Button>
          )}
          {canWrite && selection.count > 0 && (
            <Button
              variant="destructive"
              loading={busy}
              onClick={() => void remove(dashboards.filter((d) => selection.isSelected(d.id)))}
            >
              Delete {selection.count} selected
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter dashboards"
        aria-label="Filter dashboards"
        className="mb-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <div className="max-h-[50vh] divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
        {visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-500">
            {dashboards.length === 0 ? "No dashboards yet." : "No dashboards match."}
          </p>
        ) : (
          visible.map((d) => {
            const count = widgetCount(d);
            return (
              <div key={d.id} className="flex items-center gap-3 px-3 py-2">
                {canWrite && (
                  <Checkbox
                    checked={selection.isSelected(d.id)}
                    onChange={(e) => selection.toggle(d.id, { shiftKey: e.shiftKey })}
                    label={`Select ${d.name}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  {renaming === d.id ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => {
                          setRenameValue(e.target.value);
                          if (e.target.value.trim()) setRenameError(null);
                        }}
                        onBlur={() => {
                          // Clicking away from a blank name abandons the rename.
                          if (!renameValue.trim()) cancelRename();
                          else void rename(d);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void rename(d);
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            cancelRename();
                          }
                        }}
                        aria-label={`New name for ${d.name}`}
                        aria-invalid={renameError ? true : undefined}
                        aria-describedby={renameError ? `rename-error-${d.id}` : undefined}
                        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-base sm:text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                      />
                      {renameError && (
                        <p id={`rename-error-${d.id}`} role="alert" className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                          {renameError}
                        </p>
                      )}
                    </>
                  ) : (
                    <button onClick={() => onOpen(d)} title={d.name} className="block max-w-full truncate text-left text-sm font-medium text-zinc-900 hover:text-blue-600 dark:text-zinc-100 dark:hover:text-blue-400">
                      {d.name}
                      {d.id === currentId && <span className="ml-2 text-xs font-normal text-zinc-400">open</span>}
                    </button>
                  )}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {count === null ? "—" : `${count} widget${count === 1 ? "" : "s"}`} ·{" "}
                    <time dateTime={d.updated_at} title={new Date(d.updated_at).toLocaleString()}>
                      updated {formatTimeAgo(d.updated_at)}
                    </time>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => exportOne(d)}
                    aria-label={`Export ${d.name} as JSON`}
                    title="Copy as JSON (import it into any zone or project)"
                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <FontAwesomeIcon icon={faFileExport} className="text-xs" />
                  </button>
                  {canWrite && (
                    <>
                      <button
                        onClick={() => {
                          setRenaming(d.id);
                          setRenameValue(d.name);
                          setRenameError(null);
                        }}
                        aria-label={`Rename ${d.name}`}
                        title="Rename"
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      >
                        <FontAwesomeIcon icon={faPen} className="text-xs" />
                      </button>
                      <button
                        onClick={() => void duplicate(d)}
                        aria-label={`Duplicate ${d.name}`}
                        title="Duplicate"
                        className="rounded-lg p-1.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => void remove([d])}
                        aria-label={`Delete ${d.name}`}
                        title="Delete"
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                      >
                        <FontAwesomeIcon icon={faTrash} className="text-xs" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
