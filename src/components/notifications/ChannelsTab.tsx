"use client";

import { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrash, faPen, faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import { reportError } from "@/services/monitor.service";
import { NotificationPolicy, NotificationChannel, NotificationChannelWithTest, AlertRule } from "@/types";
import {
    reqCreateNotificationChannel,
    reqDeleteNotificationChannel,
    reqUpdateNotificationChannel,
    reqTestNotificationChannelResult,
} from "@/services/api";
import { FailureState } from "@/components/FailureState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/BulkActionBar";
import { useConfirm } from "@/components/ConfirmProvider";
import { useSelection } from "@/hooks/useSelection";
import { useRole } from "@/hooks/useRole";
import { runBulk, toastBulkResult } from "@/tools/bulk.tools";
import { ChannelFormModal } from "./ChannelFormModal";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ButtonSpinner } from "@/components/ui/spinner";
import {
    parseJsonSafe,
    typeBadgeClass,
    channelTypeIcon,
    getTimeAgo,
    nameList,
    rulesRoutingDirectlyTo,
} from "./notifications.helpers";

export interface ChannelTest {
    success: boolean;
    time: Date;
    /** Why it failed, in the server's words. Absent on success. */
    error?: string;
}

export type TestedChannels = Map<string, ChannelTest>;

/**
 * The newest known test of a channel: one run in this tab, or the result
 * monitor-core persisted on the row (so a reload no longer resets every
 * channel to "Untested"). An older core sends no `last_test_*` — then only a
 * test from this tab is known.
 */
function latestTest(ch: NotificationChannelWithTest, local: ChannelTest | undefined): ChannelTest | undefined {
    const at = ch.last_test_at ? new Date(ch.last_test_at) : null;
    const persisted: ChannelTest | undefined =
        at && !Number.isNaN(at.getTime()) && typeof ch.last_test_ok === "boolean"
            ? { success: ch.last_test_ok, time: at, error: ch.last_test_error || undefined }
            : undefined;
    if (!local) return persisted;
    if (!persisted) return local;
    return persisted.time > local.time ? persisted : local;
}

interface ChannelsTabProps {
    channels: NotificationChannelWithTest[];
    channelsLoading: boolean;
    channelsError: string | null;
    fetchChannels: () => void;
    policies: NotificationPolicy[];
    /** Rules can route to a channel directly too; counted beside the policies. */
    alertRules: AlertRule[];
    /** Held by the page so a result survives switching tabs. */
    testedChannels: TestedChannels;
    setTestedChannels: React.Dispatch<React.SetStateAction<TestedChannels>>;
}

export function ChannelsTab({
    channels,
    channelsLoading,
    channelsError,
    fetchChannels,
    policies,
    alertRules,
    testedChannels,
    setTestedChannels,
}: ChannelsTabProps) {
    const [showChannelForm, setShowChannelForm] = useState(false);
    const [channelSubmitting, setChannelSubmitting] = useState(false);
    const [testingChannelId, setTestingChannelId] = useState<string | null>(null);
    // Force re-render for time-ago updates
    const [, setTick] = useState(0);

    const confirm = useConfirm();
    const { canWrite } = useRole();
    const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);
    const channelIds = useMemo(() => channels.map((c) => c.id), [channels]);
    const channelSel = useSelection(channelIds);

    // Tick every 30s to keep time-ago labels fresh
    useEffect(() => {
        const interval = setInterval(() => setTick((t) => t + 1), 30000);
        return () => clearInterval(interval);
    }, []);

    const handleCreateChannel = async (name: string, type: string, config: string | undefined) => {
        setChannelSubmitting(true);
        try {
            const res = await reqCreateNotificationChannel(name, type, config ?? "{}");
            if (!res.success) {
                toast.error(res.error_message || "Failed to create channel");
                return;
            }
            setShowChannelForm(false);
            fetchChannels();
            toast.success("Channel created");
        } catch (err) {
            // The channel TYPE only — its config is the credential and never leaves the form.
            reportError("notification_channel.create.failed", err, {
                channel_type: type,
                outcome: "channel not created; user toasted",
            });
            toast.error("Failed to create channel");
        } finally {
            setChannelSubmitting(false);
        }
    };

    // Nothing server-side cleans up a deleted channel's id out of the policies
    // that route to it (see query.DeleteNotificationChannel): the alert is then
    // silently undelivered. So the confirmation names who still sends here.
    const policiesUsingChannel = (channelId: string) =>
        policies.filter((p) => parseJsonSafe<string[]>(p.channel_ids, []).includes(channelId));

    const confirmDeleteChannel = async (ch: NotificationChannel) => {
        const users = policiesUsingChannel(ch.id).map((p) => p.name);
        const ok = await confirm({
            title: `Delete “${ch.name}”?`,
            description: users.length
                ? `${users.length} polic${users.length === 1 ? "y routes" : "ies route"} to this channel: ${users.join(", ")}. Their alerts will no longer be delivered here — edit them first if this is their only channel.`
                : "No policy routes to this channel.",
            confirmLabel: "Delete channel",
            destructive: true,
        });
        if (ok) await handleDeleteChannel(ch.id);
    };

    const handleEditChannel = async (name: string, type: string, config: string | undefined) => {
        if (!editingChannel) return;
        setChannelSubmitting(true);
        const patch: { name?: string; type?: string; config?: string } = {};
        if (name !== editingChannel.name) patch.name = name;
        if (type !== editingChannel.type) patch.type = type;
        if (config !== undefined) patch.config = config;
        if (Object.keys(patch).length === 0) {
            setChannelSubmitting(false);
            setEditingChannel(null);
            return;
        }
        const res = await reqUpdateNotificationChannel(editingChannel.id, patch);
        setChannelSubmitting(false);
        if (!res.success) {
            toast.error(res.error_message || "Failed to update channel");
            return;
        }
        setEditingChannel(null);
        fetchChannels();
        toast.success(config !== undefined ? "Channel updated — send a test to confirm the new credentials" : "Channel updated");
    };

    const handleDeleteChannel = async (id: string) => {
        try {
            const res = await reqDeleteNotificationChannel(id);
            if (!res.success) {
                toast.error(res.error_message || "Failed to delete channel");
                return;
            }
            fetchChannels();
            toast.success("Channel deleted");
        } catch (err) {
            reportError("notification_channel.delete.failed", err, {
                channel_id: id,
                outcome: "channel kept; user toasted",
            });
            toast.error("Failed to delete channel");
        }
    };

    const recordTest = (id: string, result: ChannelTest) =>
        setTestedChannels((prev) => {
            const next = new Map(prev);
            next.set(id, result);
            return next;
        });

    const handleTestChannel = async (ch: NotificationChannel) => {
        const id = ch.id;
        setTestingChannelId(id);
        try {
            // The tick this writes is a HEALTH INDICATOR that stays on the row.
            // Recording success for a rejected test is worse than any empty
            // state on this page: it is durable, and it is the exact signal an
            // operator checks before trusting a channel.
            //
            // Three outcomes, and only one is a pass: a 400 (the config is
            // wrong — the message names the field), a 200 with `ok: false` (the
            // delivery failed — DNS, an HTTP status, a timeout), and a 200 with
            // `ok: true`, or `null` from an older core.
            const res = await reqTestNotificationChannelResult(id);
            if (!res.success) {
                const reason = res.error_message || "The test request failed.";
                toast.error(`Test to “${ch.name}” failed: ${reason}`, { duration: 8000 });
                recordTest(id, { success: false, time: new Date(), error: reason });
                return;
            }
            if (res.data && res.data.ok === false) {
                const reason = res.data.error || "The channel did not accept the notification.";
                toast.error(`Test to “${ch.name}” was not delivered: ${reason}`, { duration: 8000 });
                recordTest(id, { success: false, time: new Date(), error: reason });
                return;
            }
            toast.success(`Test notification sent to “${ch.name}”`);
            recordTest(id, { success: true, time: new Date() });
        } catch (err) {
            reportError("notification_channel.test.failed", err, {
                channel_id: id,
                outcome: "channel marked as failed test; user toasted",
            });
            toast.error("Failed to send test notification");
            recordTest(id, { success: false, time: new Date(), error: "The test could not be sent from this browser." });
        } finally {
            setTimeout(() => setTestingChannelId(null), 1000);
        }
    };

    const bulkTestChannels = async () => {
        const targets = channels.filter((c) => channelSel.isSelected(c.id));
        setBulkBusy(true);
        // Sequential on purpose: each test SENDS a real notification, and a
        // burst at one PagerDuty service can trip its rate limit.
        for (const c of targets) {
            await handleTestChannel(c);
        }
        setBulkBusy(false);
    };

    const bulkDeleteChannels = async () => {
        const targets = channels.filter((c) => channelSel.isSelected(c.id));
        const affected = new Set(targets.flatMap((c) => policiesUsingChannel(c.id).map((p) => p.name)));
        const ok = await confirm({
            title: `Delete ${targets.length} channel${targets.length === 1 ? "" : "s"}?`,
            description: `${nameList(targets.map((c) => c.name))}. ${
                affected.size
                    ? `Policies still routing here: ${[...affected].join(", ")}. Their alerts will no longer be delivered to these channels.`
                    : "No policy routes to these channels."
            }`,
            confirmLabel: `Delete ${targets.length}`,
            destructive: true,
        });
        if (!ok) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (c) => reqDeleteNotificationChannel(c.id));
        setBulkBusy(false);
        toastBulkResult(result, "Deleted", "channel");
        channelSel.clear();
        fetchChannels();
    };

    return (
        <>
                    <div className="space-y-4">
                        <div className="flex justify-end">
                            {canWrite && (
                            <button
                                onClick={() => setShowChannelForm(true)}
                                // A zone that cannot list its channels cannot be trusted to save one —
                                // and a duplicate made "because the list was empty" is the usual result.
                                disabled={channelsLoading || channelsError !== null}
                                title={channelsError ? "Channels failed to load — retry before creating one" : undefined}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
                            >
                                <FontAwesomeIcon icon={faPlus} className="text-xs h-[1em] w-[1em]" aria-hidden="true" />
                                Create Channel
                            </button>
                            )}
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                            {channelsLoading ? (
                                <SkeletonRows rows={3} label="Loading channels" />
                            ) : channelsError ? (
                                <FailureState
                                    what="notification channels"
                                    message={channelsError}
                                    onRetry={fetchChannels}
                                    className="rounded-none border-0"
                                />
                            ) : channels.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                    <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                                    </svg>
                                    <p className="text-sm font-medium">No notification channels</p>
                                    <p className="text-xs mt-1">Create a channel to receive alert notifications.</p>
                                </div>
                            ) : (
                                <div>
                                    {channels.map((ch) => {
                                        // ⚠️ THE SUMMARY IS BUILT SERVER-SIDE NOW, and this
                                        // is what used to be here: parse the channel's raw
                                        // config, pick a friendly field out of it, and — on
                                        // every path that failed — fall back to printing the
                                        // WHOLE config. That config is the credential: a
                                        // Slack webhook URL whose path IS the secret, a
                                        // PagerDuty routing key, SMTP settings. So the
                                        // fallback branch of a display helper leaked every
                                        // secret in the zone to anyone who could open this
                                        // tab, and the leak was in the branch nobody tests.
                                        //
                                        // monitor-core now tags the field `json:"-"` and
                                        // sends `config_summary` instead — lossy, host-only,
                                        // failing closed. Read that, never a config.
                                        const configDisplay = ch.config_summary;

                                        const isTesting = testingChannelId === ch.id;
                                        const testResult = latestTest(ch, testedChannels.get(ch.id));
                                        const usedBy = policiesUsingChannel(ch.id);
                                        const direct = rulesRoutingDirectlyTo(ch.id, alertRules);
                                        const unused = usedBy.length === 0 && direct.length === 0;

                                        // Two lines on a phone: identity + status on the left,
                                        // actions on their own row. Squeezed into one row at
                                        // 375px, the name, badge and status painted over
                                        // each other and the destination fell off the edge.
                                        return (
                                            <div
                                                key={ch.id}
                                                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                                            >
                                                <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                                                {canWrite && (
                                                    <div className="pt-2.5 sm:pt-0">
                                                    <Checkbox
                                                        checked={channelSel.isSelected(ch.id)}
                                                        onChange={(e) => channelSel.toggle(ch.id, { shiftKey: e.shiftKey })}
                                                        label={`Select ${ch.name}`}
                                                    />
                                                    </div>
                                                )}
                                                {/* Type icon */}
                                                <div aria-hidden="true" className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${typeBadgeClass(ch.type)}`}>
                                                    {channelTypeIcon(ch.type)}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-0.5">
                                                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 break-words min-w-0">
                                                            {ch.name}
                                                        </span>
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(ch.type)}`}>
                                                            {ch.type}
                                                        </span>
                                                        {/* Who routes here — the reverse of a policy's channel list,
                                                            so an orphan channel (or a critical one) shows at a glance. */}
                                                        <span
                                                            title={
                                                                unused
                                                                    ? "No policy or alert rule routes to this channel"
                                                                    : [
                                                                          usedBy.length ? `Policies: ${usedBy.map((p) => p.name).join(", ")}` : "",
                                                                          direct.length ? `Rules (direct): ${direct.map((r) => r.name).join(", ")}` : "",
                                                                      ].filter(Boolean).join("\n")
                                                            }
                                                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                                                unused
                                                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                                                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                                                            }`}
                                                        >
                                                            {unused
                                                                ? "Unused"
                                                                : [
                                                                      usedBy.length ? `${usedBy.length} polic${usedBy.length === 1 ? "y" : "ies"}` : "",
                                                                      direct.length ? `${direct.length} rule${direct.length === 1 ? "" : "s"} direct` : "",
                                                                  ].filter(Boolean).join(" · ")}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                        {configDisplay}
                                                    </p>
                                                    {/* Channel health indicator */}
                                                    <div className="mt-1 flex items-start gap-1.5 min-w-0">
                                                        {testResult ? (
                                                            <>
                                                                <span aria-hidden="true" className={`mt-1 w-2 h-2 shrink-0 rounded-full ${testResult.success ? "bg-emerald-500" : "bg-red-500"}`} />
                                                                <span className={`text-xs min-w-0 ${testResult.success ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                                                    {testResult.success ? `Tested ${getTimeAgo(testResult.time)}` : `Test failed ${getTimeAgo(testResult.time)}`}
                                                                    {!testResult.success && testResult.error && (
                                                                        <span className="block break-words text-red-700/90 dark:text-red-300/90" title={testResult.error}>
                                                                            {testResult.error}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span aria-hidden="true" className="mt-1 w-2 h-2 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                                                                <span className="text-xs text-zinc-400 dark:text-zinc-500">Untested</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                </div>

                                                {canWrite && (
                                                <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                                                <button
                                                    onClick={() => void handleTestChannel(ch)}
                                                    disabled={isTesting}
                                                    aria-busy={isTesting}
                                                    className="p-2 text-zinc-400 hover:text-blue-500 dark:hover:text-blue-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0 disabled:opacity-50"
                                                    title="Send test notification"
                                                    aria-label={`Send a test notification to ${ch.name}`}
                                                >
                                                    {isTesting ? (
                                                        // Same box as the icon, so the row's actions don't shift.
                                                        <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
                                                            <ButtonSpinner />
                                                        </span>
                                                    ) : (
                                                        <FontAwesomeIcon icon={faPaperPlane} className="text-sm" />
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => setEditingChannel(ch)}
                                                    className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
                                                    title="Edit"
                                                    aria-label={`Edit ${ch.name}`}
                                                >
                                                    <FontAwesomeIcon icon={faPen} className="text-sm" />
                                                </button>
                                                <button
                                                    onClick={() => void confirmDeleteChannel(ch)}
                                                    className="p-2 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
                                                    title="Delete"
                                                    aria-label={`Delete ${ch.name}`}
                                                >
                                                    <FontAwesomeIcon icon={faTrash} className="text-sm" />
                                                </button>
                                                </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    <BulkActionBar count={channelSel.count} noun="channel" onClear={channelSel.clear}>
                        <Button size="sm" variant="secondary" loading={bulkBusy} onClick={() => void bulkTestChannels()}>Send test</Button>
                        <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={() => void bulkDeleteChannels()}>Delete</Button>
                    </BulkActionBar>

            {showChannelForm && (
                <ChannelFormModal
                    onClose={() => setShowChannelForm(false)}
                    onSubmit={handleCreateChannel}
                    submitting={channelSubmitting}
                />
            )}
            {editingChannel && (
                <ChannelFormModal
                    key={editingChannel.id}
                    initial={editingChannel}
                    onClose={() => setEditingChannel(null)}
                    onSubmit={handleEditChannel}
                    submitting={channelSubmitting}
                />
            )}
        </>
    );
}
