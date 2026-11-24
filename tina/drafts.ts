import { collections } from "./collections";
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
  state?: { activeFormId?: string | null };
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
let bar:
  | { root: HTMLElement; status: HTMLElement; publish: HTMLButtonElement; discard: HTMLButtonElement; changes: HTMLButtonElement; panel: HTMLElement }
  | undefined;
let showingChanges = false;

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

// ---------- "What changed" list, and jumping to a section in the preview ----------

type Path = (string | number)[];
type SchemaField = { name: string; label?: string; fields?: SchemaField[] };

// Where each section starts on the page.
const SECTION_START: Record<string, string> = {
  settings: ".mast",
  hero: ".hero",
  profile: "#profile",
  quote: ".quote",
  timeline: "#timeline",
  research: "#research",
  institute: "#institute",
  roles: "#roles",
  gallery: "#gallery",
  contact: "#contact",
  footer: ".foot",
};

// Field names as the editor shows them, taken from the editor's own schema.
function describePath(section: string, path: Path) {
  let fields = ((collections.find(({ name }) => name === section)?.fields ?? []) as unknown) as SchemaField[];
  const parts: string[] = [];
  for (const step of path) {
    if (typeof step === "number") {
      parts.push(`item ${step + 1}`);
      continue;
    }
    const field = fields.find(({ name }) => name === step);
    parts.push(field?.label ?? step);
    fields = field?.fields ?? [];
  }
  return parts.join(" › ");
}

const quote = (value: unknown) => {
  if (typeof value === "boolean") return value ? "on" : "off";
  const text = String(value);
  return `“${text.length > 36 ? `${text.slice(0, 36)}…` : text}”`;
};

function listChanges(before: unknown, after: unknown, path: Path = [], out: { path: Path; text: string }[] = []) {
  if (fingerprint(before) === fingerprint(after)) return out;
  if (Array.isArray(before) || Array.isArray(after)) {
    const was = Array.isArray(before) ? before : [];
    const now = Array.isArray(after) ? after : [];
    const shared = Math.min(was.length, now.length);
    if (now.length < was.length) out.push({ path, text: `${was.length - now.length} item${was.length - now.length === 1 ? "" : "s"} removed` });
    if (now.length > was.length) out.push({ path, text: `${now.length - was.length} item${now.length - was.length === 1 ? "" : "s"} added` });
    for (let i = 0; i < shared; i += 1) listChanges(was[i], now[i], [...path, i], out);
    return out;
  }
  const isGroup = (value: unknown) => Boolean(value) && typeof value === "object";
  if (isGroup(before) || isGroup(after)) {
    const was = (isGroup(before) ? before : {}) as Values;
    const now = (isGroup(after) ? after : {}) as Values;
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (!key.startsWith("_")) listChanges(was[key], now[key], [...path, key], out);
    }
    return out;
  }
  if (isEmpty(canonical(after))) out.push({ path, text: typeof before === "boolean" ? "off" : "deleted" });
  else if (isEmpty(canonical(before))) out.push({ path, text: `added ${quote(after)}` });
  else out.push({ path, text: `changed to ${quote(after)}` });
  return out;
}

function previewDocument() {
  return document.querySelector<HTMLIFrameElement>("iframe")?.contentDocument ?? null;
}

// Scrolls the preview to the changed text, or to the start of its section, and outlines it briefly.
function scrollPreview(section: string, path: Path = [], tries = 8) {
  const doc = previewDocument();
  if (!doc?.querySelector(SECTION_START[section] ?? "body")) {
    if (tries > 0) window.setTimeout(() => scrollPreview(section, path, tries - 1), 300);
    return;
  }
  const steps = path.map((step, i) => (i === path.length - 1 && typeof step === "string" ? step.replace(/Font$/, "") : String(step)));
  let target: Element | null = null;
  // The timeline scrolls sideways, so it always opens at its start.
  for (let n = section === "timeline" ? 0 : steps.length; n > 0 && !target; n -= 1) {
    const key = `---${section}.${steps.slice(0, n).join(".")}`;
    target =
      [...doc.querySelectorAll("[data-tina-field]")].find((element) => {
        const field = element.getAttribute("data-tina-field") ?? "";
        return field.endsWith(key) || field.includes(`${key}.`);
      }) ?? null;
  }
  target ??= doc.querySelector(SECTION_START[section] ?? "body");
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: target.matches(SECTION_START[section] ?? "") ? "start" : "center" });
  const element = target as HTMLElement;
  if (element.matches(SECTION_START[section] ?? "")) return;
  const before = element.style.outline;
  element.style.outline = "3px solid #9e3b2a";
  window.setTimeout(() => (element.style.outline = before), 1800);
}

let openedFromList = 0;
function openSection(id: string, path: Path = []) {
  openedFromList = Date.now();
  cms?.dispatch({ type: "forms:set-active-form-id", value: id });
  window.setTimeout(() => scrollPreview(sectionName(id), path), 350);
}

// Opening a section from the editor's menu or section list scrolls the preview to it.
// A click on the preview itself also opens a section, and must not move the page.
let lastSection: string | null | undefined;
let lastPreviewPress = 0;
const watchedPreviews = new WeakSet<Document>();
function followOpenSection() {
  const doc = previewDocument();
  if (doc && !watchedPreviews.has(doc)) {
    watchedPreviews.add(doc);
    doc.addEventListener("pointerdown", () => (lastPreviewPress = Date.now()), true);
  }
  const active = cms?.state?.activeFormId ?? null;
  if (active === lastSection) return;
  lastSection = active;
  const recent = Date.now() - Math.max(lastPreviewPress, openedFromList) < 1500;
  if (active && DOCUMENT.test(active) && !recent) scrollPreview(sectionName(active));
}

function renderChanges() {
  if (!bar) return;
  const { panel } = bar;
  panel.replaceChildren();
  const ids = Object.keys(drafts).sort((a, b) => sectionLabel(a).localeCompare(sectionLabel(b), undefined, { numeric: true }));
  const link = (text: string, strong: boolean, onclick: () => void) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = text;
    node.style.cssText = `display:block;width:100%;text-align:left;background:none;border:0;padding:3px 0;cursor:pointer;color:#16130f;font:${strong ? 600 : 400} 12px/1.35 system-ui,sans-serif;text-decoration:underline;text-decoration-color:#d8d1c4;text-underline-offset:2px;overflow-wrap:anywhere`;
    node.onclick = onclick;
    return node;
  };
  for (const id of ids) {
    const draft = drafts[id];
    const section = sectionName(id);
    const items = listChanges(published.get(id), draft.working ?? draft.saved);
    const group = document.createElement("div");
    group.style.cssText = "padding:6px 0;border-bottom:1px solid #eee9df";
    group.append(link(`${sectionLabel(id)}${draft.working ? " · not saved as a draft yet" : ""}`, true, () => openSection(id)));
    for (const item of items.slice(0, 8)) {
      group.append(link(`${describePath(section, item.path) || "Section"}: ${item.text}`, false, () => openSection(id, item.path)));
    }
    if (items.length > 8) {
      const more = document.createElement("span");
      more.textContent = `and ${items.length - 8} more`;
      more.style.cssText = "display:block;color:#6b6358;font:400 12px/1.35 system-ui,sans-serif;padding:3px 0";
      group.append(more);
    }
    panel.append(group);
  }
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
  bar.changes.style.display = count ? "inline-block" : "none";
  if (!count) showingChanges = false;
  bar.changes.textContent = showingChanges ? "Hide changes" : "What changed";
  bar.changes.setAttribute("aria-expanded", String(showingChanges));
  bar.panel.style.display = showingChanges ? "block" : "none";
  if (showingChanges) renderChanges();
}

// The bar sits in the sidebar, above Save draft, so it never covers Tina's own buttons.
function placeBar() {
  placeFrame = undefined;
  followOpenSection();
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
  const changes = document.createElement("button");
  changes.type = "button";
  changes.style.cssText = "flex:none;background:none;border:0;padding:0;cursor:pointer;color:#16130f;font:600 12px/1.3 system-ui,sans-serif;text-decoration:underline;text-underline-offset:2px";
  changes.onclick = () => {
    showingChanges = !showingChanges;
    refreshBar();
  };
  const panel = document.createElement("div");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Unpublished changes");
  panel.style.cssText = "order:-1;flex:1 0 100%;display:none;max-height:min(220px,32vh);overflow:auto;border-bottom:1px solid #e5e2da;margin-bottom:2px;padding-bottom:4px";
  status.after(changes);
  actions.append(discard, publish);
  root.append(panel, status, changes, actions);
  document.body.append(root);
  bar = { root, status, publish, discard, changes, panel };
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
