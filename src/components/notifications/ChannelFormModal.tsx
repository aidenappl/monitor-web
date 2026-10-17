"use client";

import { useState } from "react";
import { NotificationChannel } from "@/types";
import { Modal } from "@/components/ui/modal";
import { FormFooter } from "./FormFooter";
import { INPUT_CLASS } from "./notifications.helpers";

/** Deliberately loose — one @, no spaces, a dot in the domain. The SMTP server is the real judge. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ChannelFormModalProps {
    /** The channel being edited; absent for a new one. */
    initial?: NotificationChannel;
    onClose: () => void;
    /** `config` is undefined on an edit that leaves the credential alone. */
    onSubmit: (name: string, type: string, config: string | undefined) => void;
    submitting: boolean;
}

/**
 * Create or edit a channel.
 *
 * ⚠️ AN EDIT NEVER SEES THE STORED CREDENTIAL — monitor-core does not send it
 * (see the guard on NotificationChannel). So on edit the credential fields start
 * empty and mean "replace": left empty, the PUT omits `config` and the server
 * keeps what it has. Changing the TYPE requires new credentials, because the
 * stored ones belong to the old type's notifier.
 */
export function ChannelFormModal({ initial, onClose, onSubmit, submitting }: ChannelFormModalProps) {
    const isEdit = Boolean(initial);
    const [name, setName] = useState(initial?.name ?? "");
    const [type, setType] = useState<string>(initial?.type ?? "webhook");

    // Webhook
    const [webhookUrl, setWebhookUrl] = useState("");
    // Slack
    const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
    // Email
    const [smtpHost, setSmtpHost] = useState("");
    const [smtpPort, setSmtpPort] = useState("587");
    const [smtpUsername, setSmtpUsername] = useState("");
    const [smtpPassword, setSmtpPassword] = useState("");
    const [fromEmail, setFromEmail] = useState("");
    const [fromName, setFromName] = useState("");
    const [emailTo, setEmailTo] = useState("");
    // PagerDuty
    const [routingKey, setRoutingKey] = useState("");
    const [severity, setSeverity] = useState("critical");

    const buildConfig = (): string => {
        switch (type) {
            case "webhook":
                return JSON.stringify({ url: webhookUrl });
            case "slack":
                return JSON.stringify({ webhook_url: slackWebhookUrl });
            case "email":
                return JSON.stringify({
                    smtp_host: smtpHost,
                    smtp_port: smtpPort,
                    smtp_username: smtpUsername,
                    smtp_password: smtpPassword,
                    from_email: fromEmail,
                    from_name: fromName,
                    to: recipients.join(", "),
                });
            case "pagerduty":
                return JSON.stringify({ routing_key: routingKey, severity });
            default:
                return "{}";
        }
    };

    // On edit, did the user type any credential? Untouched means "keep".
    const credentialsTouched = Boolean(
        webhookUrl || slackWebhookUrl || smtpHost || smtpUsername || smtpPassword || fromEmail || fromName || emailTo || routingKey,
    );
    const typeChanged = isEdit && type !== initial?.type;
    // Fields are only `required` when their value will actually be sent.
    const credsRequired = !isEdit || typeChanged || credentialsTouched;

    // Bad SMTP values used to surface only when a real alert failed to send.
    // Checked on submit and shown beside the field instead.
    const [fieldErrors, setFieldErrors] = useState<{ port?: string; recipients?: string }>({});
    const recipients = emailTo.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);

    const validate = (): boolean => {
        if (type !== "email" || !credsRequired) {
            setFieldErrors({});
            return true;
        }
        const errors: { port?: string; recipients?: string } = {};
        const port = Number(smtpPort);
        if (!/^\d+$/.test(smtpPort.trim()) || port < 1 || port > 65535) {
            errors.port = "Enter a port from 1 to 65535 (usually 587 or 465).";
        }
        const bad = recipients.filter((r) => !EMAIL_RE.test(r));
        if (recipients.length === 0) errors.recipients = "Add at least one recipient.";
        else if (bad.length) errors.recipients = `Not a valid address: ${bad.join(", ")}`;
        setFieldErrors(errors);
        return !errors.port && !errors.recipients;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate()) return;
        onSubmit(name, type, isEdit && !typeChanged && !credentialsTouched ? undefined : buildConfig());
    };

    return (
        <Modal open onClose={onClose} title={initial ? `Edit “${initial.name}”` : "Create Channel"} widthClass="max-w-md" dismissible={!submitting}>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="nf-name-3" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                        <input id="nf-name-3" type="text" value={name} onChange={(e) => setName(e.target.value)} required className={INPUT_CLASS} placeholder="e.g. Production Alerts" />
                    </div>
                    <div>
                        <label htmlFor="nf-type" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Type</label>
                        <select id="nf-type" value={type} onChange={(e) => setType(e.target.value)} className={INPUT_CLASS}>
                            <option value="webhook">Webhook</option>
                            <option value="slack">Slack</option>
                            <option value="email">Email (SMTP)</option>
                            <option value="pagerduty">PagerDuty</option>
                        </select>
                    </div>
                    {isEdit && (
                        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                            {typeChanged
                                ? "A new type needs new credentials — the stored ones belong to the old type."
                                : <>Currently sending to <span className="font-medium text-zinc-700 dark:text-zinc-300">{initial?.config_summary || "—"}</span>. Leave the fields below empty to keep the stored credentials; anything you enter replaces them.</>}
                        </p>
                    )}

                    {type === "webhook" && (
                        <div>
                            <label htmlFor="nf-webhook-url" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Webhook URL</label>
                            <input id="nf-webhook-url" type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} required={credsRequired} className={INPUT_CLASS} placeholder="https://example.com/webhook" />
                        </div>
                    )}

                    {type === "slack" && (
                        <div>
                            <label htmlFor="nf-slack-webhook-url" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Slack Webhook URL</label>
                            <input id="nf-slack-webhook-url" type="url" value={slackWebhookUrl} onChange={(e) => setSlackWebhookUrl(e.target.value)} required={credsRequired} className={INPUT_CLASS} placeholder="https://hooks.slack.com/services/..." />
                        </div>
                    )}

                    {type === "email" && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="nf-smtp-host" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">SMTP Host</label>
                                    <input id="nf-smtp-host" type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} required={credsRequired} className={INPUT_CLASS} placeholder="smtp.gmail.com" />
                                </div>
                                <div>
                                    <label htmlFor="nf-smtp-port" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">SMTP Port</label>
                                    <input
                                        id="nf-smtp-port"
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={65535}
                                        step={1}
                                        value={smtpPort}
                                        onChange={(e) => setSmtpPort(e.target.value)}
                                        aria-invalid={Boolean(fieldErrors.port)}
                                        aria-describedby={fieldErrors.port ? "nf-smtp-port-error" : undefined}
                                        className={INPUT_CLASS}
                                        placeholder="587"
                                    />
                                    {fieldErrors.port && (
                                        <p id="nf-smtp-port-error" className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.port}</p>
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="nf-username" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Username</label>
                                    <input id="nf-username" type="text" value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} className={INPUT_CLASS} />
                                </div>
                                <div>
                                    <label htmlFor="nf-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Password</label>
                                    <input id="nf-password" type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} className={INPUT_CLASS} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="nf-from-email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">From Email</label>
                                    <input id="nf-from-email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} className={INPUT_CLASS} placeholder="alerts@example.com" />
                                </div>
                                <div>
                                    <label htmlFor="nf-from-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">From Name</label>
                                    <input id="nf-from-name" type="text" value={fromName} onChange={(e) => setFromName(e.target.value)} className={INPUT_CLASS} placeholder="Monitor Alerts" />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="nf-recipients" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Recipients</label>
                                <input
                                    id="nf-recipients"
                                    type="text"
                                    inputMode="email"
                                    autoComplete="off"
                                    value={emailTo}
                                    onChange={(e) => setEmailTo(e.target.value)}
                                    required={credsRequired}
                                    aria-invalid={Boolean(fieldErrors.recipients)}
                                    aria-describedby={fieldErrors.recipients ? "nf-recipients-error" : "nf-recipients-hint"}
                                    className={INPUT_CLASS}
                                    placeholder="user@example.com, user2@example.com"
                                />
                                {fieldErrors.recipients ? (
                                    <p id="nf-recipients-error" className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.recipients}</p>
                                ) : (
                                    <p id="nf-recipients-hint" className="text-xs text-zinc-400 mt-1">Comma-separated email addresses</p>
                                )}
                                {recipients.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1" aria-label="Recipients">
                                        {recipients.map((r, i) => (
                                            <span
                                                key={`${r}-${i}`}
                                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                                    EMAIL_RE.test(r)
                                                        ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                                                        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                                }`}
                                            >
                                                {r}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {type === "pagerduty" && (
                        <>
                            <div>
                                <label htmlFor="nf-integration-key-routing-key" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Integration Key (Routing Key)</label>
                                <input id="nf-integration-key-routing-key" type="text" value={routingKey} onChange={(e) => setRoutingKey(e.target.value)} required={credsRequired} className={INPUT_CLASS} placeholder="Events API v2 integration key" />
                                <p className="text-xs text-zinc-400 mt-1">From your PagerDuty service&apos;s Events API v2 integration</p>
                            </div>
                            <div>
                                <label htmlFor="nf-default-severity" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Default Severity</label>
                                <select id="nf-default-severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className={INPUT_CLASS}>
                                    <option value="critical">Critical</option>
                                    <option value="error">Error</option>
                                    <option value="warning">Warning</option>
                                    <option value="info">Info</option>
                                </select>
                            </div>
                        </>
                    )}

                    <FormFooter isEdit={isEdit} submitting={submitting} disabled={!name.trim()} onCancel={onClose} />
                </form>
        </Modal>
    );
}
