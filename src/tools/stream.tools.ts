/**
 * Making an SSE refusal VISIBLE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ EVENTSOURCE CANNOT READ A NON-2XX BODY. THAT IS THE WHOLE PROBLEM.
 *
 * Both stream bridges (`api/monitor-stream`, `api/alert-stream`) refuse an
 * unroutable zone with a 502 and a JSON body naming it — a good refusal, written
 * for exactly the failure `resolveUpstream` exists to prevent. The browser then
 * throws all of it away: `EventSource` surfaces every failure as an `error`
 * event with no status and no body, and then RECONNECTS. Forever.
 *
 * So the two surfaces behaved like this. The live tail backed off to a 30-second
 * retry and sat on "Disconnected. Click Connect to start streaming." — an
 * instruction to press a button that cannot work, with the real answer ("this
 * zone has no query endpoint in the registry") sitting unread in a body nobody
 * can see. The desktop-alert feed retried every 5 seconds with NO UI AT ALL, so
 * an operator with alerts enabled on a broken zone was told nothing, ever, while
 * believing they were covered.
 *
 * The fix is two halves, and both are needed:
 *   1. STOP. A bounded attempt count turns an infinite loop into a terminal
 *      state that can be rendered.
 *   2. SAY WHY. One ordinary `fetch` of the same URL — which CAN read a non-2xx
 *      body — recovers the server's own sentence, zone name and all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * How many times a stream reconnects before it gives up and asks why.
 *
 * Bounded, not zero: a stream dies for ordinary reasons all day — a deploy, a
 * proxy timeout, a laptop lid. Five attempts with the caller's backoff covers
 * every transient cause; past that the cause is not transient and pretending
 * otherwise is how the "Disconnected" screen above happened.
 */
export const MAX_STREAM_ATTEMPTS = 5;

/**
 * Set by both SSE bridges on the zone-resolution refusal.
 *
 * The body already says it in prose, but prose is for the user; this is what
 * lets a client tell "this zone cannot be routed to" apart from "the upstream
 * was briefly down" without parsing English.
 */
export const STREAM_REFUSAL_HEADER = "X-Monitor-Stream-Refusal";

/** The value of that header for an unresolvable zone. */
export const STREAM_REFUSAL_ZONE_UNROUTABLE = "zone_unroutable";

export interface StreamRefusal {
  /** The header's value, or "unavailable" when the failure carried none. */
  reason: string;
  /** The server's own message. Shown verbatim — it is the only fact. */
  message: string;
}

/**
 * probeStreamRefusal asks a stream URL why it will not open.
 *
 * Returns null when the endpoint actually answers — the failure was transient
 * and has since cleared, which the caller should report as such rather than as a
 * refusal that is no longer true.
 *
 * ⚠️ CALL IT ONLY AFTER THE RETRIES ARE SPENT. It is a second connection to a
 * streaming endpoint: on the (unlikely) success path it opens a real event
 * stream, which is cancelled immediately below, but doing that on every reconnect
 * would double the connection count for no information.
 */
export async function probeStreamRefusal(
  url: string,
): Promise<StreamRefusal | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "text/event-stream" } });

    if (res.ok) {
      // It works now. Drop the stream we just opened rather than leaving a
      // second, unread connection hanging off the proxy for the tab's lifetime.
      await res.body?.cancel().catch(() => {});
      return null;
    }

    const reason = res.headers.get(STREAM_REFUSAL_HEADER) ?? "unavailable";

    // The refusal bodies are JSON `{error}`. Anything else (an HTML error page
    // from a proxy in front of us, an empty 504) still has a status worth
    // naming — an unlabelled dead end is what this function exists to remove.
    let message = `The stream endpoint answered ${res.status}.`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error.trim() !== "") {
        message = body.error;
      }
    } catch {
      // Keep the status-only message.
    }

    return { reason, message };
  } catch {
    // The probe itself could not be made — offline, or the page is unloading.
    // "We could not ask" is not "we asked and it refused", and reporting it as
    // the latter would blame the zone for the browser's state.
    return null;
  }
}
