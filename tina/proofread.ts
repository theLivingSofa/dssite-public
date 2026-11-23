import { applySuggestions, cleanSuggestions, collectChanges } from "../lib/proofread-rules.mjs";

type Suggestion = { id: number; original: string; replacement: string; reason: string };

const CHECK_TIMEOUT_MS = 16000;

type SaveContext = {
  values: Record<string, unknown>;
  form: unknown;
  cms: { api: { tina: { authProvider: { fetchWithToken(input: string, init: RequestInit): Promise<Response> } } } };
};

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string) => {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text) node.textContent = text;
  return node;
};

// Resolves with the fixes the editor kept ticked. "Save as it is" resolves with none.
function askEditor(suggestions: Suggestion[]) {
  return new Promise<Suggestion[]>((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const overlay = element("div", "position:fixed;inset:0;z-index:2147483000;background:rgb(22 19 15/.45);display:grid;place-items:center;padding:16px;font:15px/1.45 system-ui,sans-serif");
    const box = element("div", "background:#fff;color:#16130f;width:min(520px,100%);max-height:85vh;overflow:auto;border-radius:8px;padding:20px");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "proofread-title");
    const title = element("h2", "margin:0 0 4px;font-size:18px;font-weight:600", "Possible mistakes");
    title.id = "proofread-title";
    box.append(title, element("p", "margin:0 0 14px;color:#4a443b", "Untick anything that is correct as written, such as a name."));

    const boxes = suggestions.map((suggestion) => {
      const row = element("label", "display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid #ddd5c5;cursor:pointer");
      const tick = element("input", "margin-top:4px;width:18px;height:18px;flex:none");
      tick.type = "checkbox";
      tick.checked = true;
      const text = element("span", "min-width:0;overflow-wrap:anywhere");
      text.append(
        element("s", "color:#9e3b2a", suggestion.original),
        document.createTextNode(" → "),
        element("strong", "font-weight:600", suggestion.replacement),
        element("span", "display:block;font-size:13px;color:#4a443b", suggestion.reason),
      );
      row.append(tick, text);
      box.append(row);
      return tick;
    });

    const finish = (chosen: Suggestion[]) => {
      overlay.remove();
      previous?.focus?.();
      resolve(chosen);
    };
    const actions = element("div", "display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:14px");
    const button = "min-height:44px;padding:0 16px;border-radius:6px;font:inherit;font-weight:600;cursor:pointer";
    const keep = element("button", `${button};background:#fff;color:#16130f;border:1px solid #16130f`, "Save anyway");
    const fix = element("button", `${button};background:#16130f;color:#fff;border:1px solid #16130f`, "Fix it and save");
    keep.type = fix.type = "button";
    keep.onclick = () => finish([]);
    fix.onclick = () => finish(suggestions.filter((_, i) => boxes[i].checked));
    actions.append(keep, fix);
    box.append(actions);
    overlay.append(box);
    document.body.append(overlay);
    fix.focus();
  });
}

// Runs when the editor presses Save. Any failure here lets the save continue.
export async function proofreadBeforeSave({ values, form, cms }: SaveContext) {
  try {
    const { finalForm } = form as { finalForm: { getState(): { initialValues: unknown }; change(name: string, value: unknown): void } };
    const before = finalForm.getState().initialValues;
    const items = collectChanges(before, values);
    if (!items.length) return undefined;
    const response = await cms.api.tina.authProvider.fetchWithToken("/api/proofread", {
      method: "POST",
      headers: { "content-type": "application/json", "x-proofread": "1" },
      body: JSON.stringify({ items: items.map(({ id, key, text }) => ({ id, key, text })) }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const suggestions = cleanSuggestions(await response.json(), items) as Suggestion[];
    if (!suggestions.length) return undefined;
    const chosen = await askEditor(suggestions);
    if (!chosen.length) return undefined;
    // Update the live form so the preview shows the fix, then the values Tina is about to save.
    const fixed = applySuggestions(JSON.parse(JSON.stringify(values)), items, chosen);
    for (const name of new Set(items.map(({ path }) => String(path[0])))) finalForm.change(name, fixed[name]);
    return applySuggestions(values, items, chosen);
  } catch {
    return undefined;
  }
}
