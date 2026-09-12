#!/usr/bin/env node
/**
 * STATIC GUARDS — the recurrence checks that outlive the person who fixed it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY A HAND-ROLLED SCRIPT AND NOT A TEST, A LINT RULE, OR A DEPENDENCY.
 *
 * There is no test framework in this repo and we are deliberately not adding
 * one: these two checks are about the SHAPE of the source, not about behaviour,
 * and a runtime test could not see either of them. A custom ESLint rule would be
 * the idiomatic home, but it needs a plugin package and a resolver entry — more
 * moving parts than the thing being guarded. So: plain Node, zero dependencies,
 * wired into `npm run lint` so CI cannot skip it.
 *
 * Both checks exist because the bug they catch is INVISIBLE when it comes back.
 * Neither produces a crash, a type error or a failing request — one renders
 * another tenant's data under the right heading, the other prints a credential
 * on a page. A reviewer would have to know the history to spot either.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Run: `node scripts/guards.mjs` (or `npm run guards`, or `npm run lint`).
 * Exits non-zero, naming file and line, on any violation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

/**
 * Every .ts/.tsx under `dir`, recursively. Returns [] if `dir` does not exist —
 * the caller's coverage floor is what turns that into a failure, with a message
 * that says the GUARD is broken rather than that the code is clean.
 */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file) => relative(ROOT, file).split(sep).join("/");

/**
 * Blank out comments, preserving offsets.
 *
 * ⚠️ COMMENTS ONLY — STRING LITERALS ARE LEFT ALONE, AND THAT IS DELIBERATE.
 * Both idioms these guards hunt can be written with a literal
 * (`.get("project")`), so blanking string bodies would make the guard blind to
 * exactly the form a newcomer is most likely to write — the one that does not
 * import `PROJECT_PARAM` at all. Comments are the real source of false
 * positives here: this repo comments heavily, and the paragraph explaining why
 * you must not call `useSearchParams().get(PROJECT_PARAM)` would otherwise be
 * the first thing flagged.
 *
 * Offsets are preserved (each removed character becomes a space, newlines kept)
 * so reported line numbers still point at the real line.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  const blank = (text) => text.replace(/[^\n]/g, " ");

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }

    // Skip over a string body verbatim, so a `//` or `/*` inside one (a URL, a
    // regex source) cannot start a phantom comment and blank the rest of the
    // file — which would silently disable both guards for that file.
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) break;
        j += 1;
      }
      out += source.slice(i, Math.min(j + 1, source.length));
      i = j + 1;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

const violations = [];
const report = (file, line, message) =>
  violations.push(`${rel(file)}:${line}\n    ${message}`);

/**
 * ⚠️ A GUARD THAT HAS STOPPED CHECKING LOOKS EXACTLY LIKE A CLEAN CODEBASE.
 *
 * Both checks below walk a directory and inspect what they find. If that
 * directory is renamed, moved under a route group (`src/app/(app)/[zone]`), or
 * simply not there, `walk` returns `[]`, nothing matches, and the script prints
 * "✔ 2 checks passed" while examining nothing at all. CI goes green. That is the
 * same class of silent failure these guards exist to prevent, one level up — and
 * it is the more dangerous version, because the reassurance is explicit.
 *
 * So each guard declares a COVERAGE FLOOR: the number of files it must have
 * examined for its verdict to mean anything. The floors are deliberately far
 * below the real counts (11 and 93 at the time of writing) — high enough to
 * catch "the walk found nothing", low enough that ordinary deletion never trips
 * them.
 *
 * These are reported SEPARATELY from violations and with different wording,
 * because they need a different person: a violation means "someone reintroduced
 * the bug", a broken guard means "this script no longer matches the repo's
 * shape". Conflating them would send whoever is on the failing build looking for
 * a bug that is not there.
 */
const broken = [];
const reportBroken = (guard, message) => broken.push(`${guard}: ${message}`);

/* ───────────────────────────────────────────────────────────────────────────
 * GUARD 1 — no hand-rolled project reads under /[zone].
 *
 * THE BUG IT PREVENTS: `ScopeSwitcher.selectProject` changes the project with a
 * searchParams-only `router.push`. That re-renders components that READ the
 * param and nothing else — it does NOT remount them and it does NOT re-run a
 * `useEffect(…, [])`. Every page in this app read its data from an effect whose
 * deps named only its own filters, so switching project relabelled the switcher
 * and refetched NOTHING: the previous tenant's issues stayed on screen under the
 * new tenant's name, with every request 200.
 *
 * `ScopeBoundary` fixed that by REMOUNTING the subtree on a scope change, and
 * `useScope()` is how a page reads the result. A page that goes back to
 * `useSearchParams().get(PROJECT_PARAM)` gets a value that is correct and a
 * component that does not remount — which looks scoped, behaves unscoped, and
 * fails silently. That is what this check is for.
 *
 * ⚠️ IT IS NOT A BAN ON THE PARAM. Writing it is fine and necessary — the live
 * tail splices it into an EventSource URL by hand, because axios interceptors
 * never see that URL. Only READING the current selection out of the router is
 * flagged.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Files permitted to read the selection straight from the router. */
const SCOPE_READ_ALLOWED = new Set([
  // The hook that hands the scope to everyone else.
  "src/hooks/useScope.ts",
  // The boundary itself — it is what turns the param into a remount.
  "src/components/ScopeBoundary.tsx",
]);

/**
 * Coverage floor. `src/app/[zone]` holds 11 .ts/.tsx files today (a layout, a
 * settings page and nine feature pages); 4 is "the walk clearly worked" without
 * being brittle about a page being retired.
 */
const ZONE_FILE_FLOOR = 4;

function guardProjectParamReads() {
  const zoneDir = join(SRC, "app", "[zone]");
  const files = walk(zoneDir);

  if (files.length < ZONE_FILE_FLOOR) {
    reportBroken(
      "guard 1 (project-selector reads)",
      `only ${files.length} file(s) found under src/app/[zone] — expected at least ` +
        `${ZONE_FILE_FLOOR}. THIS GUARD IS BROKEN, NOT THE CODE: the zone route ` +
        "probably moved (a route group, a rename), so the scan root in " +
        "guardProjectParamReads() no longer points at the zone pages. Fix the path " +
        "here; do not lower the floor.",
    );
  }

  for (const file of files) {
    if (SCOPE_READ_ALLOWED.has(rel(file))) continue;

    const source = readFileSync(file, "utf8");
    const code = stripComments(source);

    // The direct idiom: useSearchParams().get(PROJECT_PARAM) / .get("project").
    const direct =
      /useSearchParams\s*\(\s*\)\s*(?:\?\.)?\s*\.?\s*get\s*\(\s*(?:PROJECT_PARAM|"project"|'project')\s*\)/g;
    for (const m of code.matchAll(direct)) {
      report(
        file,
        lineOf(code, m.index),
        "reads the project selector straight from the router. Use `useScope()` " +
          "(src/hooks/useScope.ts) — reading the param does NOT remount this " +
          "component, so a project switch would relabel the page and refetch nothing.",
      );
    }

    // The split idiom: `const params = useSearchParams()` … `params.get("project")`.
    const bound = new Set();
    for (const m of code.matchAll(
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useSearchParams\s*\(\s*\)/g,
    )) {
      bound.add(m[1]);
    }
    for (const name of bound) {
      const indirect = new RegExp(
        `\\b${name}\\s*(?:\\?\\.)?\\s*\\.?\\s*get\\s*\\(\\s*(?:PROJECT_PARAM|"project"|'project')\\s*\\)`,
        "g",
      );
      for (const m of code.matchAll(indirect)) {
        report(
          file,
          lineOf(code, m.index),
          `reads the project selector via \`${name}\`, a useSearchParams() result. ` +
            "Use `useScope()` — see src/components/ScopeBoundary.tsx for why the " +
            "param on its own does not refetch anything.",
        );
      }
    }
  }

  return files.length;
}

/* ───────────────────────────────────────────────────────────────────────────
 * GUARD 2 — a notification channel's `config` must never be read.
 *
 * THE BUG IT PREVENTS: `NotificationChannel.Config` is the DECRYPTED payload —
 * a Slack webhook URL whose path is itself the credential, a PagerDuty routing
 * key, SMTP settings. `GET /v1/notification-channels` sits on the ordinary /v1
 * subrouter, reachable by any authenticated session and any admin-scope API key,
 * so while that field was serialised every secret in a zone was readable by all
 * of them. The notifications page then parsed it to print a one-line label and
 * FELL BACK TO PRINTING THE WHOLE CONFIG whenever it could not find a friendlier
 * field inside — a leak living in the branch nobody looks at.
 *
 * monitor-core now tags it `json:"-"` and sends `config_summary` instead. Two
 * checks keep it that way:
 *
 *   (a) `NotificationChannel` must not declare `config`. With the field gone,
 *       TYPESCRIPT is the guard on every individual read site — far stronger
 *       than any regex. This check protects the guard itself: re-adding one
 *       field would silently re-enable every read at once.
 *   (b) a textual sweep for `.config` on a channel-shaped identifier, which
 *       catches a reintroduction through untyped data, a local interface, or a
 *       cast — the routes (a) cannot see.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Identifiers that hold a notification channel in this codebase.
 *
 * Deliberately narrow. `.config` is a legitimate and common field elsewhere —
 * `SavedDashboard.config` is a serialised widget layout with nothing secret in
 * it — so a blanket ban would be noise, and noise is how a guard gets deleted.
 */
const CHANNEL_IDENTIFIER = /^(ch|chan|channel|notificationChannel)$/;

/**
 * Coverage floor for the source-wide sweep. `src/` holds 93 .ts/.tsx files
 * today; 20 is far enough below that ordinary churn never reaches it and an
 * empty or truncated walk always does.
 */
const SRC_FILE_FLOOR = 20;

function guardChannelConfigReads() {
  // (a) The type must not carry the field.
  const typesFile = join(SRC, "types", "index.ts");
  let typesSource;
  try {
    typesSource = readFileSync(typesFile, "utf8");
  } catch {
    reportBroken(
      "guard 2 (channel config)",
      "src/types/index.ts could not be read, so the check on the " +
        "NotificationChannel interface did not run. THIS GUARD IS BROKEN, NOT THE " +
        "CODE: point it at wherever the type lives now.",
    );
    typesSource = "";
  }
  const typesCode = stripComments(typesSource);
  const iface = typesCode.match(
    /interface\s+NotificationChannel\s*\{([\s\S]*?)\n\}/,
  );
  if (typesSource !== "" && !iface) {
    reportBroken(
      "guard 2 (channel config)",
      "the NotificationChannel interface could not be found in src/types/index.ts, " +
        "so the check on its `config` field did not run. THIS GUARD IS BROKEN, NOT " +
        "THE CODE: if the type moved, move this check with it.",
    );
  } else if (iface && /^\s*config\s*[?]?\s*:/m.test(iface[1])) {
    report(
      typesFile,
      lineOf(typesCode, iface.index),
      "NotificationChannel declares `config`. That field is the channel's " +
        "credential and monitor-core never serialises it (`json:\"-\"`). Read " +
        "`config_summary` instead — it is built server-side and fails closed.",
    );
  }

  // (b) Nobody reads `.config` off something channel-shaped.
  const files = walk(SRC);

  if (files.length < SRC_FILE_FLOOR) {
    reportBroken(
      "guard 2 (channel config)",
      `only ${files.length} file(s) found under src/ — expected at least ` +
        `${SRC_FILE_FLOOR}. THIS GUARD IS BROKEN, NOT THE CODE: the sweep found ` +
        "almost nothing to read, so its clean verdict means nothing. Check the scan " +
        "root in guardChannelConfigReads(); do not lower the floor.",
    );
  }

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const code = stripComments(source);
    for (const m of code.matchAll(
      /\b([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*config\b(?!\s*_)/g,
    )) {
      if (!CHANNEL_IDENTIFIER.test(m[1])) continue;
      report(
        file,
        lineOf(code, m.index),
        `reads \`${m[1]}.config\`. A notification channel's config is its ` +
          "credential and is never sent to the browser — use `config_summary`, " +
          "the safe server-built description.",
      );
    }
  }

  return files.length;
}

const scanned = guardProjectParamReads() + guardChannelConfigReads();

// Reported first and separately: a broken guard makes every other line of output
// untrustworthy, including a clean bill of health from the other check.
if (broken.length > 0) {
  console.error(
    `\n✖ ${broken.length} guard${broken.length === 1 ? " is" : "s are"} not checking anything:\n`,
  );
  for (const b of broken) console.error(`  ${b}\n`);
  console.error(
    "This is a failure of scripts/guards.mjs itself, not of the code it inspects.\n",
  );
}

if (violations.length > 0) {
  console.error(
    `\n✖ ${violations.length} guard violation${violations.length === 1 ? "" : "s"}:\n`,
  );
  for (const v of violations) console.error(`  ${v}\n`);
  console.error(
    "These checks live in scripts/guards.mjs; each one carries the bug it prevents.\n",
  );
}

if (broken.length > 0 || violations.length > 0) process.exit(1);

// The count is printed on the SUCCESS path too, so a sudden drop that still
// clears the floors is visible in a CI log rather than only in a failure.
console.log(`✔ guards: 2 checks passed (${scanned} files scanned)`);
