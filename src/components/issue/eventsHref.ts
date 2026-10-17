/**
 * The zone-relative tail of an Events-page link, pre-filtered.
 *
 *   zoned(eventsHref({ service: "api", level: "error", from, to }))
 *
 * The param names are the Events page's own URL state — `service`, `name`,
 * `level`, and an absolute `from`/`to` window as ISO 8601 strings (the same
 * pair a brush zoom writes). Change them there and here together: a link whose
 * params the page does not read lands on the unfiltered 24h with nothing to say
 * the filter was dropped.
 *
 * Always pass a window. Without one the link opens on the default range, which
 * for an incident last week is an empty table that reads as "nothing happened".
 */
export type EventsLink = {
  service?: string;
  name?: string;
  level?: string;
  from?: Date | string;
  to?: Date | string;
};

export function eventsHref(link: EventsLink): string {
  const params = new URLSearchParams();
  if (link.service) params.set("service", link.service);
  if (link.name) params.set("name", link.name);
  if (link.level) params.set("level", link.level);
  const from = toISO(link.from);
  const to = toISO(link.to);
  // A half window is not a window: the page reads the pair or neither.
  if (from && to) {
    params.set("from", from);
    params.set("to", to);
  }
  const qs = params.toString();
  // "" is the events home; zoned() appends ?project after this query.
  return qs ? `?${qs}` : "";
}

/** `at` ± `padMs` as a window, for "the events around this one". */
export function windowAround(at: string | Date, padMs: number): { from: Date; to: Date } {
  const t = new Date(at).getTime();
  return { from: new Date(t - padMs), to: new Date(t + padMs) };
}

function toISO(v: Date | string | undefined): string | null {
  if (v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
