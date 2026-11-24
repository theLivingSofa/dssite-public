import { fieldError } from "../lib/content-rules.mjs";
import { applyManualEdits, applySuggestions, cleanSuggestions, collectChanges, replaceOnce } from "../lib/proofread-rules.mjs";

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

type Item = { id: number; key: string; path: (string | number)[]; text: string };
type Decision = { chosen: Suggestion[]; edits?: Record<number, string> };

const withFixes = (item: Item, fixes: Suggestion[]) =>
  fixes.filter(({ id }) => id === item.id).reduce((text, fix) => replaceOnce(text, fix.original, fix.replacement), item.text);

// Resolves with the fixes the editor kept ticked, or with text they corrected by hand.
function askEditor(items: Item[], suggestions: Suggestion[]) {
  return new Promise<Decision>((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const overlay = element("div", "position:fixed;inset:0;z-index:2147483000;background:rgb(22 19 15/.45);display:grid;place-items:center;padding:16px;font:15px/1.45 system-ui,sans-serif");
    const box = element("div", "background:#fff;color:#16130f;width:min(560px,100%);max-height:85vh;overflow:auto;border-radius:8px;padding:20px");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "proofread-title");
    const title = element("h2", "margin:0 0 4px;font-size:18px;font-weight:600", "Possible mistakes");
    title.id = "proofread-title";
    const intro = element("p", "margin:0 0 14px;color:#4a443b", "Untick anything that is correct as written, such as a name.");
    const review = element("div", "");
    const editor = element("div", "display:none");
    box.append(title, intro, review, editor);

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
      review.append(row);
      return tick;
    });
    const ticked = () => suggestions.filter((_, i) => boxes[i].checked);

    const finish = (decision: Decision) => {
      overlay.remove();
      previous?.focus?.();
      resolve(decision);
    };
    const button = "min-height:44px;padding:0 16px;border-radius:6px;font:inherit;font-weight:600;cursor:pointer";
    const quiet = `${button};background:#fff;color:#16130f;border:1px solid #16130f`;
    const strong = `${button};background:#16130f;color:#fff;border:1px solid #16130f`;
    const actionRow = () => element("div", "display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:14px");
    const action = (label: string, css: string, onclick: () => void) => {
      const node = element("button", css, label);
      node.type = "button";
      node.onclick = onclick;
      return node;
    };

    const affected = items.filter((item) => suggestions.some(({ id }) => id === item.id));
    let fields: { item: Item; area: HTMLTextAreaElement; error: HTMLElement }[] = [];

    const showReview = () => {
      title.textContent = "Possible mistakes";
      intro.textContent = "Untick anything that is correct as written, such as a name.";
      editor.style.display = "none";
      review.style.display = "block";
      fix.focus();
    };

    const showEditor = () => {
      title.textContent = "Edit before saving";
      intro.textContent = "The ticked fixes are already in. Change anything you like, then save.";
      editor.replaceChildren();
      fields = affected.map((item, i) => {
        const label = element("label", "display:block;padding:10px 0;border-top:1px solid #ddd5c5;font-size:13px;font-weight:600", affected.length > 1 ? `Text ${i + 1} of ${affected.length}` : "Your text");
        const area = element("textarea", "display:block;box-sizing:border-box;width:100%;min-height:96px;margin-top:6px;padding:8px;border:1px solid #bdb5a5;border-radius:4px;font:15px/1.45 system-ui,sans-serif;font-weight:400;color:#16130f;background:#fff;resize:vertical");
        area.value = withFixes(item, ticked());
        const error = element("span", "display:block;margin-top:4px;font-size:13px;font-weight:400;color:#9e3b2a");
        error.setAttribute("role", "alert");
        area.oninput = () => { error.textContent = ""; };
        label.append(area, error);
        editor.append(label);
        return { item, area, error };
      });
      const save = () => {
        let valid = true;
        const edits: Record<number, string> = {};
        for (const { item, area, error } of fields) {
          const value = area.value.trim();
          const problem = value ? fieldError(item.key, value) : "This cannot be empty.";
          error.textContent = problem ?? "";
          if (problem) valid = false;
          edits[item.id] = value;
        }
        if (valid) finish({ chosen: [], edits });
      };
      const row = actionRow();
      row.append(action("Back", quiet, showReview), action("Save my edits", strong, save));
      editor.append(row);
      review.style.display = "none";
      editor.style.display = "block";
      fields[0]?.area.focus();
    };

    const fix = action("Fix it and save", strong, () => finish({ chosen: ticked() }));
    const actions = actionRow();
    actions.append(action("Save anyway", quiet, () => finish({ chosen: [] })), action("Edit and save", quiet, showEditor), fix);
    review.append(actions);
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
    const { chosen, edits } = await askEditor(items as Item[], suggestions);
    if (!edits && !chosen.length) return undefined;
    const apply = (target: Record<string, unknown>) =>
      edits ? applyManualEdits(target, items, edits) : applySuggestions(target, items, chosen);
    // Update the live form so the preview shows the fix, then the values Tina is about to save.
    const fixed = apply(JSON.parse(JSON.stringify(values)));
    for (const name of new Set(items.map(({ path }) => String(path[0])))) finalForm.change(name, fixed[name]);
    return apply(values);
  } catch {
    return undefined;
  }
}
