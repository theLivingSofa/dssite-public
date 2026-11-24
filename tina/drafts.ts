import { proofreadBeforeSave } from "./proofread";

// Save draft keeps changes in this browser. Publish sends every changed section at once.
// Nothing reaches GitHub or the live site until Publish is pressed.

type Values = Record<string, unknown>;
type Draft = { base: string; saved?: Values; working?: Values; updatedAt: number };
type FinalForm = {
  change(name: string, value: unknown): void;
  initialize(values: Values): void;
  getState(): { values: Values; pristine: boolean; submitting: boolean; hasValidationErrors: boolean };
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
const PUBLISHED = "dssite-drafts-published";
const DECIDED = "dssite-drafts-decided";
const DOCUMENT = /content\/site\/([a-z]+)\.json$/;
const AUTOSAVE_MS = 400;
const SETTLE_LIMIT = 200;

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
let applyingRemote = false;
let drafts: Record<string, Draft> = {};
const published = new Map<string, Values>();
const forms = new Map<string, DraftForm>();
const timers = new Map<string, number>();
let promptTimer: number | undefined;
let placeFrame: number | undefined;
let bar: { root: HTMLElement; status: HTMLElement; publish: HTMLButtonElement; discard: HTMLButtonElement } | undefined;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const sectionName = (id: string) => id.match(DOCUMENT)?.[1] ?? "";
const sectionLabel = (id: string) => forms.get(id)?.label ?? sectionName(id);
const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === false ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && !value.length) ||
  (typeof value === "object" && value !== null && !Array.isArray(value) && !Object.keys(value).length);

// Ignores Tina's internal keys and empty values, so only real changes count.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, item]) => [key, canonical(item)] as const)
      .filter(([, item]) => !isEmpty(item))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
};
const fingerprint = (value: unknown) => JSON.stringify(canonical(value));

function readDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, Draft>) : {};
  } catch {
    return undefined;
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

// Reads first, so a change here never removes a section saved from another tab.
function putDraft(id: string, draft: Draft | undefined) {
  drafts = readDrafts() ?? drafts;
  if (draft) drafts[id] = draft;
  else delete drafts[id];
  writeDrafts();
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
    if (!key.startsWith("_")) form.finalForm.change(key, values[key] === undefined ? undefined : clone(values[key]));
  }
}

function showDraft(id: string, form: DraftForm) {
  const draft = drafts[id];
  applyingRemote = true;
  form.finalForm.initialize(clone(draft?.saved ?? published.get(id) ?? {}));
  if (draft?.working) setValues(form, draft.working);
  applyingRemote = false;
}

// Keeps unsaved typing, so a closed tab or reload doesn't lose it.
function autosave(id: string) {
  if (deciding) return;
  const form = forms.get(id);
  const base = published.get(id);
  if (!form || !base) return;
  drafts = readDrafts() ?? drafts;
  const values = clone(form.finalForm.getState().values);
  const draft = drafts[id];
  if (fingerprint(values) === fingerprint(draft?.saved ?? base)) {
    if (!draft?.working) return refreshBar();
    const { working: _working, ...rest } = draft;
    putDraft(id, rest.saved ? rest : undefined);
  } else if (!draft?.working || fingerprint(draft.working) !== fingerprint(values)) {
    putDraft(id, { ...draft, base: draft?.base ?? fingerprint(base), working: values, updatedAt: Date.now() });
  }
}

function queueAutosave(id: string) {
  if (applyingRemote) return;
  window.clearTimeout(timers.get(id));
  timers.set(
    id,
    window.setTimeout(() => {
      timers.delete(id);
      autosave(id);
    }, AUTOSAVE_MS),
  );
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
  drafts = readDrafts() ?? drafts;
  const base = published.get(id) ?? {};
  if (fingerprint(values) === fingerprint(base)) putDraft(id, undefined);
  else putDraft(id, { base: drafts[id]?.base ?? fingerprint(base), saved: clone(values), updatedAt: Date.now() });
  cms?.alerts.success("Draft saved. It isn't live until you press Publish.");
}

// Keeps two open editor tabs in step.
function onStorage(event: StorageEvent) {
  if (event.key === PUBLISHED && event.newValue) {
    try {
      const { id, values } = JSON.parse(event.newValue) as { id: string; values: Values };
      published.set(id, values);
    } catch {
      // A damaged message only means this tab refreshes the section later.
    }
    return;
  }
  if (event.key !== STORE && event.key !== null) return;
  const previous = drafts;
  drafts = readDrafts() ?? drafts;
  if (!deciding) {
    for (const [id, form] of forms) {
      if (JSON.stringify(previous[id] ?? null) === JSON.stringify(drafts[id] ?? null)) continue;
      const typingHere = previous[id]?.working && fingerprint(form.finalForm.getState().values) === fingerprint(previous[id].working);
      const matchesLastSave = fingerprint(form.finalForm.getState().values) === fingerprint(previous[id]?.saved ?? published.get(id));
      if (!timers.has(id) && (form.finalForm.getState().pristine || typingHere || matchesLastSave)) showDraft(id, form);
      else cms?.alerts.error(`${sectionLabel(id)} was also changed in another tab. This tab kept your typing.`);
    }
  }
  refreshBar();
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

// The bar sits in the sidebar, above Save draft, so it never covers Tina's own buttons.
function placeBar() {
  placeFrame = undefined;
  if (!bar) return;
  const { root } = bar;
  const save = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save draft");
  const footer = save?.parentElement?.parentElement;
  const show = (floating: boolean) => {
    root.style.display = "flex";
    root.style.position = floating ? "absolute" : "static";
    root.style.left = root.style.right = root.style.bottom = floating ? "0" : "";
    root.style.zIndex = floating ? "10" : "";
  };
  if (footer?.parentElement) {
    if (root.nextElementSibling !== footer) footer.parentElement.insertBefore(root, footer);
    show(false);
    return;
  }
  // While saving, the button shows a spinner instead of its label.
  if (root.isConnected && root.style.position === "static" && root.nextElementSibling?.querySelector("button")) return;
  // The section list has no footer, so the bar sits at the bottom of the sidebar.
  const sidebar = window.location.hash.startsWith("#/~")
    ? document.querySelector<HTMLElement>(".fixed.top-0.left-0.h-dvh .relative.left-0.w-full.h-full")
    : null;
  if (sidebar) {
    if (root.parentElement !== sidebar) sidebar.append(root);
    show(true);
    // Leaves room to scroll the last section clear of the bar.
    const list = sidebar.querySelector<HTMLElement>(".overflow-y-auto.pb-16");
    if (list) list.style.paddingBottom = `${root.offsetHeight + 84}px`;
    return;
  }
  if (root.parentElement !== document.body) document.body.append(root);
  root.style.display = "none";
}

function schedulePlaceBar() {
  // A timer, because animation frames pause while the window is in the background.
  if (placeFrame === undefined) placeFrame = window.setTimeout(placeBar, 40);
}

function buildBar() {
  const root = document.createElement("div");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Publishing");
  root.style.cssText = "flex:none;box-sizing:border-box;width:100%;display:none;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 8px;padding:8px 24px;background:#fff;color:#16130f;border-top:1px solid #e5e2da;white-space:normal;font:500 13px/1.3 system-ui,sans-serif";
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.style.cssText = "flex:1 1 150px;min-width:0";
  const actions = document.createElement("span");
  actions.style.cssText = "display:flex;flex:none;gap:6px";
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
  actions.append(discard, publish);
  root.append(status, actions);
  document.body.append(root);
  bar = { root, status, publish, discard };
  refreshBar();
  new MutationObserver(schedulePlaceBar).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", schedulePlaceBar);
  schedulePlaceBar();
}

function restoreDrafts() {
  for (const [id, form] of forms) {
    if (drafts[id]) showDraft(id, form);
  }
}

function clearDrafts() {
  const ids = Object.keys(drafts);
  drafts = {};
  writeDrafts();
  for (const id of ids) {
    const form = forms.get(id);
    if (form) showDraft(id, form);
  }
}

async function askToRestore() {
  drafts = readDrafts() ?? drafts;
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
  drafts = readDrafts() ?? drafts;
  if (choice === "restore") restoreDrafts();
  else clearDrafts();
  refreshBar();
}

async function discardDrafts() {
  if (busy) return;
  flushAutosaves();
  drafts = readDrafts() ?? drafts;
  if (!Object.keys(drafts).length) return refreshBar();
  const labels = Object.keys(drafts).map(sectionLabel).join(", ");
  const choice = await dialog("Discard all unpublished changes?", [`This removes your drafts for ${labels}. It can't be undone.`], [
    { label: "Keep them", primary: true, value: "keep" },
    { label: "Discard", value: "discard" },
  ]);
  if (choice === "discard") clearDrafts();
}

// A save may still be finishing when Publish is pressed.
async function settled(form: DraftForm) {
  for (let i = 0; i < SETTLE_LIMIT && form.finalForm.getState().submitting; i += 1) await pause(100);
  return !form.finalForm.getState().submitting;
}

// Empty font settings are the same as having none, so they never reach the content files.
function valuesToPublish(values: Values) {
  const output = clone(values);
  for (const key of ["typography", "customFonts", "hideSources"]) {
    if (isEmpty(canonical(output[key]))) delete output[key];
  }
  return output;
}

async function publishDrafts() {
  if (busy || !cms) return;
  busy = true;
  refreshBar();
  try {
    for (const form of forms.values()) {
      if (!(await settled(form))) {
        cms.alerts.error("A save is still finishing. Please press Publish again in a moment.");
        return;
      }
    }
    flushAutosaves();
    drafts = readDrafts() ?? drafts;

    // Typing that wasn't saved yet goes through the proofreader first.
    for (const id of Object.keys(drafts)) {
      if (!drafts[id]?.working) continue;
      const form = forms.get(id);
      if (!form) {
        window.location.hash = "#/~/edit/";
        cms.alerts.error("Open the page preview, then press Publish again.");
        return;
      }
      if (form.finalForm.getState().hasValidationErrors) {
        cms.alerts.error(`Fix the problem in ${sectionLabel(id)}, then press Publish again.`);
        return;
      }
      await form.submit();
      await settled(form);
      flushAutosaves();
      drafts = readDrafts() ?? drafts;
      if (drafts[id]?.working) {
        cms.alerts.error(
          form.finalForm.getState().hasValidationErrors
            ? `Fix the problem in ${sectionLabel(id)}, then press Publish again.`
            : "A save is still finishing. Please press Publish again in a moment.",
        );
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
      const values = (readDrafts() ?? drafts)[id]?.saved;
      if (!values) continue;
      const name = sectionName(id);
      const params = cms.api.tina.schema.transformPayload(name, valuesToPublish(values));
      await cms.api.tina.request(UPDATE_DOCUMENT, { variables: { collection: name, relativePath: `${name}.json`, params } });
      published.set(id, clone(values));
      try {
        localStorage.setItem(PUBLISHED, JSON.stringify({ id, values, at: Date.now() }));
        localStorage.removeItem(PUBLISHED);
      } catch {
        // Other open tabs will notice the change when they next publish.
      }
      putDraft(id, undefined);
      done += 1;
    }
    cms.alerts.success(`Published ${done} ${done === 1 ? "section" : "sections"}. Live in about five minutes.`);
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
  drafts = readDrafts() ?? {};
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
  window.addEventListener("storage", onStorage);
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
