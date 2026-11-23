import { proofreadBeforeSave } from "./proofread";

// Save draft keeps changes in this browser. Publish sends every changed section at once.
// Nothing reaches GitHub or the live site until Publish is pressed.

type Values = Record<string, unknown>;
type Draft = { base: string; saved?: Values; working?: Values; updatedAt: number };
type FinalForm = {
  change(name: string, value: unknown): void;
  initialize(values: Values): void;
  getState(): { values: Values };
};
type DraftForm = {
  id: string;
  label?: string;
  finalForm: FinalForm;
  subscribe(listener: () => void, subscription: { values: true }): () => void;
  submit(): Promise<unknown> | undefined;
  beforeSubmit?: (values: Values) => Promise<Values | undefined>;
};
type Cms = {
  dispatch(action: { type: "forms:set-active-form-id"; value: string }): void;
  alerts: { success(message: string): void; error(message: string): void };
  api: {
    tina: {
      request(query: string, options: { variables: Values }): Promise<Record<string, { _values?: Values }>>;
      schema: { transformPayload(collection: string, values: Values): Values };
    };
  };
};
type FormifyArgs = {
  createForm(config: Values): DraftForm;
  formConfig: Values & { id: string; initialValues: Values };
};

const STORE = "dssite-drafts-v1";
const DECIDED = "dssite-drafts-decided";
const DOCUMENT = /content\/site\/([a-z]+)\.json$/;
const AUTOSAVE_MS = 400;

const CURRENT_DOCUMENT = `query CurrentDocument($collection: String!, $relativePath: String!) {
  document(collection: $collection, relativePath: $relativePath) { ... on Document { _values } }
}`;
const UPDATE_DOCUMENT = `mutation UpdateDocument($collection: String!, $relativePath: String!, $params: DocumentUpdateMutation!) {
  updateDocument(collection: $collection, relativePath: $relativePath, params: $params) { __typename }
}`;

let cms: Cms | undefined;
let installed = false;
let deciding = false;
let busy = false;
let drafts: Record<string, Draft> = {};
const published = new Map<string, Values>();
const forms = new Map<string, DraftForm>();
const timers = new Map<string, number>();
let promptTimer: number | undefined;
let bar: { status: HTMLElement; publish: HTMLButtonElement; discard: HTMLButtonElement } | undefined;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const sectionName = (id: string) => id.match(DOCUMENT)?.[1] ?? "";
const sectionLabel = (id: string) => forms.get(id)?.label ?? sectionName(id);

// Ignores Tina's internal keys and empty values, so only real changes count.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => !key.startsWith("_") && item !== undefined && item !== null && item !== "")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  );
};
const fingerprint = (value: unknown) => JSON.stringify(canonical(value));

function readDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, Draft>) : {};
  } catch {
    return {};
  }
}

function writeDrafts() {
  try {
    if (Object.keys(drafts).length) localStorage.setItem(STORE, JSON.stringify(drafts));
    else localStorage.removeItem(STORE);
  } catch {
    cms?.alerts.error("This browser could not store your draft. Publish soon so you don't lose it.");
  }
  refreshBar();
}

function markDecided() {
  deciding = false;
  try {
    sessionStorage.setItem(DECIDED, "1");
  } catch {
    // The restore question may simply appear again after a page change.
  }
}

function setValues(form: DraftForm, values: Values) {
  const current = form.finalForm.getState().values;
  for (const key of new Set([...Object.keys(current), ...Object.keys(values)])) {
    if (!key.startsWith("_")) form.finalForm.change(key, clone(values[key]));
  }
}

// Keeps unsaved typing, so a closed tab or reload doesn't lose it.
function autosave(id: string) {
  if (deciding) return;
  const form = forms.get(id);
  const base = published.get(id);
  if (!form || !base) return;
  const values = clone(form.finalForm.getState().values);
  const draft = drafts[id];
  if (fingerprint(values) === fingerprint(draft?.saved ?? base)) {
    if (!draft?.working) return;
    delete draft.working;
    if (!draft.saved) delete drafts[id];
  } else {
    drafts[id] = { ...draft, base: draft?.base ?? fingerprint(base), working: values, updatedAt: Date.now() };
  }
  writeDrafts();
}

function queueAutosave(id: string) {
  window.clearTimeout(timers.get(id));
  timers.set(id, window.setTimeout(() => autosave(id), AUTOSAVE_MS));
}

function flushAutosaves() {
  for (const [id, timer] of timers) {
    window.clearTimeout(timer);
    autosave(id);
  }
  timers.clear();
}

// Runs after the proofreader, in place of Tina's save to GitHub.
async function saveDraft(id: string, values: Values) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  const base = published.get(id) ?? {};
  if (fingerprint(values) === fingerprint(base)) delete drafts[id];
  else drafts[id] = { base: drafts[id]?.base ?? fingerprint(base), saved: clone(values), updatedAt: Date.now() };
  writeDrafts();
  cms?.alerts.success("Draft saved. It isn't live until you press Publish.");
}

function dialog(title: string, lines: string[], actions: { label: string; primary?: boolean; value: string }[]) {
  return new Promise<string>((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483100;background:rgb(22 19 15/.45);display:grid;place-items:center;padding:16px;font:15px/1.45 system-ui,sans-serif";
    const box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", title);
    box.style.cssText = "background:#fff;color:#16130f;width:min(480px,100%);max-height:85vh;overflow:auto;border-radius:8px;padding:20px";
    const heading = document.createElement("h2");
    heading.style.cssText = "margin:0 0 8px;font-size:18px;font-weight:600";
    heading.textContent = title;
    box.append(heading);
    for (const line of lines) {
      const paragraph = document.createElement("p");
      paragraph.style.cssText = "margin:0 0 8px;color:#4a443b";
      paragraph.textContent = line;
      box.append(paragraph);
    }
    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:14px";
    let focus: HTMLButtonElement | undefined;
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.style.cssText = `min-height:44px;padding:0 16px;border-radius:6px;border:1px solid #16130f;font:inherit;font-weight:600;cursor:pointer;background:${action.primary ? "#16130f" : "#fff"};color:${action.primary ? "#fff" : "#16130f"}`;
      button.onclick = () => {
        overlay.remove();
        previous?.focus?.();
        resolve(action.value);
      };
      if (action.primary) focus = button;
      row.append(button);
    }
    box.append(row);
    overlay.append(box);
    document.body.append(overlay);
    focus?.focus();
  });
}

function refreshBar() {
  if (!bar) return;
  const count = Object.keys(drafts).length;
  const unsaved = Object.values(drafts).filter((draft) => draft.working).length;
  bar.status.textContent = !count
    ? "No unpublished changes"
    : `${count} ${count === 1 ? "section" : "sections"} not published${unsaved ? `, ${unsaved} with unsaved typing` : ""}`;
  bar.publish.disabled = !count || busy;
  bar.discard.disabled = !count || busy;
  bar.publish.style.opacity = bar.publish.disabled ? "0.45" : "1";
  bar.discard.style.opacity = bar.discard.disabled ? "0.45" : "1";
  bar.publish.textContent = busy ? "Publishing…" : "Publish";
}

function buildBar() {
  const root = document.createElement("div");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Publishing");
  root.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147482000;display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:calc(100vw - 32px);padding:8px 10px;background:#fff;color:#16130f;border:1px solid #16130f;border-radius:6px;box-shadow:0 2px 10px rgb(22 19 15/.2);font:500 13px/1.3 system-ui,sans-serif";
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  const button = (label: string, primary: boolean, onclick: () => void) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.style.cssText = `min-height:36px;padding:0 12px;border-radius:4px;border:1px solid #16130f;font:600 13px/1 system-ui,sans-serif;cursor:pointer;background:${primary ? "#16130f" : "#fff"};color:${primary ? "#fff" : "#16130f"}`;
    node.onclick = onclick;
    return node;
  };
  const discard = button("Discard", false, () => void discardDrafts());
  const publish = button("Publish", true, () => void publishDrafts());
  root.append(status, discard, publish);
  document.body.append(root);
  bar = { status, publish, discard };
  refreshBar();
}

function restoreDrafts() {
  for (const [id, form] of forms) {
    const draft = drafts[id];
    if (!draft) continue;
    form.finalForm.initialize(clone(draft.saved ?? published.get(id) ?? {}));
    if (draft.working) setValues(form, draft.working);
  }
}

function clearDrafts() {
  for (const [id, form] of forms) {
    if (drafts[id]) form.finalForm.initialize(clone(published.get(id) ?? {}));
  }
  drafts = {};
  writeDrafts();
}

async function askToRestore() {
  const ids = Object.keys(drafts);
  if (!deciding || !ids.length) return markDecided();
  const newest = Math.max(...ids.map((id) => drafts[id].updatedAt));
  const changedLive = ids.filter((id) => published.has(id) && fingerprint(published.get(id)) !== drafts[id].base);
  const lines = [
    `Last edited ${new Date(newest).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`,
    `Sections: ${ids.map(sectionLabel).join(", ")}.`,
  ];
  if (changedLive.length) lines.push(`Warning: ${changedLive.map(sectionLabel).join(", ")} changed on the live site after this draft started.`);
  const choice = await dialog("Restore your unpublished changes?", lines, [
    { label: "Discard", value: "discard" },
    { label: "Restore", primary: true, value: "restore" },
  ]);
  markDecided();
  if (choice === "restore") restoreDrafts();
  else clearDrafts();
  refreshBar();
}

async function discardDrafts() {
  if (busy || !Object.keys(drafts).length) return;
  flushAutosaves();
  const labels = Object.keys(drafts).map(sectionLabel).join(", ");
  const choice = await dialog("Discard all unpublished changes?", [`This removes your drafts for ${labels}. It can't be undone.`], [
    { label: "Keep them", primary: true, value: "keep" },
    { label: "Discard", value: "discard" },
  ]);
  if (choice === "discard") clearDrafts();
}

async function publishDrafts() {
  if (busy || !cms) return;
  flushAutosaves();
  busy = true;
  refreshBar();
  try {
    // Typing that wasn't saved yet goes through the proofreader first.
    for (const id of Object.keys(drafts)) {
      if (!drafts[id]?.working) continue;
      const form = forms.get(id);
      if (!form) {
        window.location.hash = "#/~/edit/";
        cms.alerts.error("Open the page preview, then press Publish again.");
        return;
      }
      await form.submit();
      flushAutosaves();
      if (drafts[id]?.working) {
        cms.alerts.error(`Fix the problem in ${sectionLabel(id)}, then press Publish again.`);
        return;
      }
    }
    const ids = Object.keys(drafts);
    if (!ids.length) return;

    const changedLive: string[] = [];
    for (const id of ids) {
      const name = sectionName(id);
      const result = await cms.api.tina.request(CURRENT_DOCUMENT, { variables: { collection: name, relativePath: `${name}.json` } });
      if (fingerprint(result.document?._values) !== drafts[id].base) changedLive.push(id);
    }
    const lines = [`These go live together: ${ids.map(sectionLabel).join(", ")}.`];
    if (changedLive.length) lines.push(`Warning: ${changedLive.map(sectionLabel).join(", ")} changed on the live site after your draft started. Publishing replaces that change.`);
    const choice = await dialog("Publish your changes?", lines, [
      { label: "Keep editing", value: "cancel" },
      { label: changedLive.length ? "Publish anyway" : "Publish", primary: true, value: "publish" },
    ]);
    if (choice !== "publish") return;

    let done = 0;
    for (const id of ids) {
      const draft = drafts[id];
      const values = draft?.saved;
      if (!values) continue;
      const name = sectionName(id);
      await cms.api.tina.request(UPDATE_DOCUMENT, {
        variables: { collection: name, relativePath: `${name}.json`, params: cms.api.tina.schema.transformPayload(name, clone(values)) },
      });
      published.set(id, clone(values));
      delete drafts[id];
      writeDrafts();
      done += 1;
    }
    cms.alerts.success(`Published ${done} ${done === 1 ? "section" : "sections"}. Live in about four minutes.`);
  } catch {
    cms.alerts.error("Publishing stopped. Anything not published is still in your drafts, so you can try again.");
  } finally {
    busy = false;
    refreshBar();
  }
}

export function installDrafts(tinaCms: unknown) {
  cms = tinaCms as Cms;
  if (installed || typeof document === "undefined") return;
  installed = true;
  drafts = readDrafts();
  let decided = false;
  try {
    decided = sessionStorage.getItem(DECIDED) === "1";
  } catch {
    decided = false;
  }
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  deciding = Object.keys(drafts).length > 0 && (!decided || navigation?.type === "reload");
  if (!deciding) markDecided();

  // The full-page form would save straight to GitHub, so it opens in the page preview.
  const usePreview = () => {
    const match = window.location.hash.match(/^#\/collections\/edit\/([a-z]+)\//);
    if (!match) return;
    window.location.replace(`#/~/edit/?section=${match[1]}`);
    // The preview may already be open, so it won't reload and choose the section itself.
    const id = `content/site/${match[1]}.json`;
    if (forms.has(id)) window.setTimeout(() => cms?.dispatch({ type: "forms:set-active-form-id", value: id }), 300);
  };
  usePreview();
  window.addEventListener("hashchange", usePreview);
  window.addEventListener("pagehide", flushAutosaves);
  const start = () => buildBar();
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}

// Tina calls this for each section's form.
export function draftForm({ createForm, formConfig }: FormifyArgs, tinaCms: unknown) {
  installDrafts(tinaCms);
  const { id } = formConfig;
  if (!DOCUMENT.test(id)) return createForm(formConfig);
  published.set(id, clone(formConfig.initialValues));
  const draft = deciding ? undefined : drafts[id];
  const form = createForm({
    ...formConfig,
    initialValues: draft?.saved ? clone(draft.saved) : formConfig.initialValues,
    buttons: { save: "Save draft", reset: "Reset" },
    onSubmit: (values: Values) => saveDraft(id, values),
  });
  form.beforeSubmit = (values) =>
    proofreadBeforeSave({ values, form, cms: tinaCms as Parameters<typeof proofreadBeforeSave>[0]["cms"] }) as Promise<Values | undefined>;
  forms.set(id, form);
  if (draft?.working) setValues(form, draft.working);
  form.subscribe(() => queueAutosave(id), { values: true });
  if (deciding) {
    window.clearTimeout(promptTimer);
    promptTimer = window.setTimeout(() => void askToRestore(), 1200);
  }
  refreshBar();
  return form;
}
