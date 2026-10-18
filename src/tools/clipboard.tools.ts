import toast from "react-hot-toast";

/**
 * copyText — the one way to put text on the clipboard, with an answer either way.
 *
 *   await copyText(key.secret, { label: "API key" });   // → true | false
 *
 * Three call sites used to `await navigator.clipboard.writeText(text)` bare.
 * That API is missing on plain-HTTP origins (`dev dev-http`) and REJECTS when the
 * document is not focused or permission is denied — so the copy failed as an
 * unhandled rejection and the user was told nothing. For a freshly minted key
 * that is shown once, "nothing happened" is the worst possible answer: they
 * paste whatever was on the clipboard before.
 *
 * So: the async API first, the hidden-textarea + `execCommand("copy")` fallback
 * second, and a toast on BOTH outcomes. The failure toast tells the user to copy
 * by hand, because that is the only thing left that works.
 *
 * ⚠️ Not reported to Monitor. A refused clipboard is the browser's policy, not a
 * fault in this app, and the user has already been told.
 *
 * ⚠️ `label` names WHAT was copied ("API key", "Event ID"), never the value — a
 * toast is screen-visible and the value is often a secret.
 */
export async function copyText(
  text: string,
  { label, silent }: { label?: string; silent?: boolean } = {},
): Promise<boolean> {
  const ok = (await viaClipboardApi(text)) || viaExecCommand(text);
  if (!silent) {
    if (ok) toast.success(label ? `${label} copied` : "Copied to clipboard");
    else toast.error("Couldn't copy — select and copy manually");
  }
  return ok;
}

async function viaClipboardApi(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Denied, unfocused document, or insecure context — fall through to the
    // execCommand path, which the caller's toast covers if that fails too.
    return false;
  }
}

function viaExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Off-screen rather than display:none — a hidden element cannot be selected.
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    // Unsupported — reported as `false`, which the caller toasts.
    ok = false;
  }
  textarea.remove();
  // Selecting the textarea moved focus; put it back on the button that asked.
  active?.focus?.();
  return ok;
}
