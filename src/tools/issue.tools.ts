import type { Issue } from "@/types";

/**
 * The line an issue is known by.
 *
 * An HTTP failure with no error string (a bare 5xx `http.request.end`) has a
 * message equal to its event name, so every failing route of a service used to
 * list as the same "http.request.end" — four identical rows. The route is what
 * tells them apart, and it is already on the issue (it is part of the
 * fingerprint), so it becomes the title. Done here rather than in
 * monitor-core's message derivation because the message feeds the fingerprint:
 * changing it there would re-key every existing issue.
 */
export function issueTitle(issue: Pick<Issue, "title" | "message" | "name" | "path">): string {
    if (issue.title) return issue.title;
    if (issue.message && issue.message !== issue.name) return issue.message;
    if (issue.path) return issue.path;
    return issue.message || issue.name;
}
