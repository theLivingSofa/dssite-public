import React from "react";
import { TextFieldPlugin, TextareaFieldPlugin, useCMS, wrapFieldsWithMeta } from "tinacms";
import {
  FONT_CHOICES,
  FONT_DEFAULT,
  FONT_EXTENSIONS,
  FONT_FIELDS,
  FONT_KINDS,
  MAX_CUSTOM_FONTS,
  fontBytesError,
  fontChoice,
  fontNameError,
} from "../lib/fonts.mjs";

type Kind = keyof typeof FONT_KINDS;
type FinalForm = {
  change(name: string, value: unknown): void;
  getState(): { values: Record<string, unknown>; initialValues?: Record<string, unknown>; pristine: boolean };
  subscribe(listener: () => void, subscription: { values: true; initialValues: true }): () => void;
};
type TinaForm = { id?: string; path?: string; finalForm: FinalForm; submit(): Promise<unknown> | undefined };
type FieldProps = { input: { name: string; value?: unknown }; form: FinalForm; tinaForm?: TinaForm };
type PendingAll = { previous: unknown; cleared: { form: TinaForm; name: string; value: unknown }[]; clean: TinaForm[] };

const SETTINGS_FILE = /content\/site\/settings\.json$/;
const DOCUMENT = /content\/site\/([a-z]+)\.json$/;

const buttonStyle = (primary: boolean): React.CSSProperties => ({
  minHeight: 34,
  padding: "0 10px",
  border: "1px solid #16130f",
  borderRadius: 4,
  background: primary ? "#16130f" : "#fff",
  color: primary ? "#fff" : "#16130f",
  font: "500 12px/1.2 system-ui, sans-serif",
  cursor: "pointer",
});

const valueAt = (values: unknown, path: string) =>
  path.split(".").reduce<unknown>((node, step) => (node as Record<string, unknown> | undefined)?.[step], values);

// Uploaded fonts appear in the menus once they are published, because only then can the page load them.
let publishedList: Promise<string[]> | undefined;
const loadPublishedFonts = () =>
  (publishedList ??= fetch("/css/custom-fonts.css", { cache: "no-store" })
    .then((response) => (response.ok ? response.text() : ""))
    .then((css) => [...css.matchAll(/\/\* font: ([A-Za-z0-9 ]+) \*\//g)].map((match) => match[1]))
    .catch(() => []));

function useFontList(current?: string) {
  const [published, setPublished] = React.useState<string[]>([]);
  React.useEffect(() => {
    let active = true;
    loadPublishedFonts().then((fonts) => active && setPublished(fonts));
    return () => {
      active = false;
    };
  }, []);
  const list = [...FONT_CHOICES, ...published];
  return { published, fonts: current && !list.includes(current) ? [...list, current] : list };
}

// Every text of this kind in a document that has its own font.
function ownFonts(node: unknown, schemaPath: string, formPath: string, kind: Kind): string[] {
  if (Array.isArray(node)) return node.flatMap((item, i) => ownFonts(item, schemaPath, `${formPath}${i}.`, kind));
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => {
    if (key.startsWith("_") || key === "typography") return [];
    if (key.endsWith("Font")) {
      const field = `${schemaPath}.${key.slice(0, -4)}`;
      return value && (FONT_FIELDS as Record<string, string>)[field] === kind ? [`${formPath}${key}`] : [];
    }
    return ownFonts(value, `${schemaPath}.${key}`, `${formPath}${key}.`, kind);
  });
}

function FontControl({ kind, input, form, deletable }: FieldProps & { kind: Kind; deletable: boolean }) {
  const cms = useCMS();
  const overrideName = `${input.name}Font`;
  const [message, setMessage] = React.useState("");
  const [undoAll, setUndoAll] = React.useState<PendingAll | null>(null);
  const [saving, setSaving] = React.useState(false);
  const { all } = FONT_KINDS[kind];
  // Remembers deleted text, so Restore still works after Save draft.
  const deletedText = React.useRef("");
  const hasText = typeof input.value === "string" && input.value.trim() !== "";
  const canRestore = !hasText && (deletedText.current !== "" || Boolean(valueAt(form.getState().initialValues, input.name)));

  const deleteText = () => {
    deletedText.current = String(input.value);
    form.change(input.name, "");
    setMessage("Deleted from the page. Press Save draft to keep this.");
  };

  const restoreText = () => {
    form.change(input.name, deletedText.current || valueAt(form.getState().initialValues, input.name));
    deletedText.current = "";
    setMessage("");
  };

  const settingsForm = (): TinaForm | undefined =>
    (cms.state.forms as { tinaForm: TinaForm }[]).find(({ tinaForm }) =>
      SETTINGS_FILE.test(tinaForm.path ?? tinaForm.id ?? ""),
    )?.tinaForm;

  const savedOwn = () => fontChoice(valueAt(form.getState().initialValues, overrideName));

  // This text's own font, and the font chosen for all text of this kind.
  const readView = () => {
    const own = fontChoice(valueAt(form.getState().values, overrideName));
    const shared = fontChoice(valueAt(settingsForm()?.finalForm.getState().values, `typography.${kind}`));
    return { own: own ?? "", shared: shared ?? "", changed: own !== savedOwn() };
  };
  const [view, setView] = React.useState(readView);
  const { own, shared, changed } = view;
  const selected = undoAll ? shared : own;
  const { fonts } = useFontList(selected === FONT_DEFAULT ? undefined : selected);
  const offerDefault = !undoAll && Boolean(shared || own === FONT_DEFAULT);

  React.useEffect(() => {
    const refresh = () => setView(readView());
    const stops = [form.subscribe(refresh, { values: true, initialValues: true })];
    const target = settingsForm();
    if (target && target.finalForm !== form) stops.push(target.finalForm.subscribe(refresh, { values: true, initialValues: true }));
    return () => stops.forEach((stop) => stop());
    // Each field has one form and one stored font name for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, overrideName]);

  const setAll = (target: TinaForm, font: string | undefined) => {
    const typography = { ...((target.finalForm.getState().values.typography as Record<string, unknown>) ?? {}) };
    if (font) typography[kind] = font;
    else delete typography[kind];
    target.finalForm.change("typography", Object.keys(typography).length ? typography : undefined);
  };

  // Picking a font shows it in the preview at once. Nothing is saved until Save is pressed.
  const pick = (value: string) => {
    const target = settingsForm();
    if (undoAll && target) {
      setAll(target, value || undefined);
      setMessage(`Previewing ${all.toLowerCase()}. Nothing is saved yet.`);
      return;
    }
    form.change(overrideName, value || undefined);
    setMessage("Previewing on this text. Press Save draft to keep it.");
  };

  const applyHere = () => {
    form.change(overrideName, selected || undefined);
    setMessage("Set for just this text. Press Save draft to keep it.");
  };

  const undoHere = () => {
    form.change(overrideName, savedOwn());
    setMessage("");
  };

  // "All" means all: texts that had their own font follow the new choice too.
  const previewAll = () => {
    const target = settingsForm();
    if (!target) {
      setMessage("Open this page from the main preview to change all of them.");
      return;
    }
    // Site default with "All" puts the whole kind back to its original font.
    const font = own === FONT_DEFAULT ? undefined : own || shared;
    // A font being tried on this text is not something Cancel should bring back.
    form.change(overrideName, savedOwn());
    const forms = (cms.state.forms as { tinaForm: TinaForm }[])
      .map(({ tinaForm }) => tinaForm)
      .filter((item) => DOCUMENT.test(item.path ?? item.id ?? ""));
    const clean = forms.filter((item) => item.finalForm.getState().pristine);
    const cleared = forms.flatMap((item) => {
      const name = (item.path ?? item.id ?? "").match(DOCUMENT)?.[1] ?? "";
      const { values } = item.finalForm.getState();
      return ownFonts(values, name, "", kind).map((path) => ({ form: item, name: path, value: valueAt(values, path) }));
    });
    setUndoAll({ previous: valueAt(target.finalForm.getState().values, `typography.${kind}`), cleared, clean });
    cleared.forEach(({ form: item, name }) => item.finalForm.change(name, undefined));
    setAll(target, font || undefined);
    setMessage(`Previewing ${all.toLowerCase()}. Nothing is saved yet.`);
  };

  const cancelAll = () => {
    const target = settingsForm();
    if (target && undoAll) {
      undoAll.cleared.forEach(({ form: item, name, value }) => item.finalForm.change(name, value));
      setAll(target, fontChoice(undoAll.previous));
    }
    setUndoAll(null);
    setMessage("");
  };

  const saveAll = async () => {
    const target = settingsForm();
    if (!target || !undoAll) return;
    setSaving(true);
    try {
      const others = [...new Set(undoAll.cleared.map(({ form: item }) => item))].filter((item) => item !== target);
      // A section with unsaved text waits for its own Save, so nothing is published by surprise.
      const ready = others.filter((item) => undoAll.clean.includes(item));
      await target.submit();
      for (const item of ready) await item.submit();
      setUndoAll(null);
      setMessage(
        ready.length < others.length
          ? `Draft saved for ${all.toLowerCase()}. Press Save draft to keep the other changes in this section.`
          : `Draft saved for ${all.toLowerCase()}. Press Publish to put it live.`,
      );
    } catch {
      setMessage("That did not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ width: "100%", boxSizing: "border-box", whiteSpace: "normal", margin: "-4px 0 16px", padding: 10, border: "1px solid #ddd5c5", borderRadius: 4, background: "#faf8f3" }}>
      <label style={{ display: "grid", gap: 4, font: "600 12px/1.3 system-ui, sans-serif", color: "#16130f" }}>
        Font
        <select
          value={selected}
          onChange={(event) => pick(event.target.value)}
          disabled={saving}
          style={{ width: "100%", minHeight: 34, padding: "0 6px", border: "1px solid #bdb5a5", borderRadius: 4, background: "#fff", font: "400 13px/1.2 system-ui, sans-serif" }}
        >
          <option value="">{offerDefault && shared ? `Same as all (${shared})` : "Site default"}</option>
          {offerDefault && <option value={FONT_DEFAULT}>Site default</option>}
          {fonts.map((font) => (
            <option key={font} value={font}>{font}</option>
          ))}
        </select>
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {undoAll ? (
          <>
            <button type="button" style={buttonStyle(true)} onClick={saveAll} disabled={saving}>
              {saving ? "Saving…" : `Save draft for ${all.toLowerCase()}`}
            </button>
            <button type="button" style={buttonStyle(false)} onClick={cancelAll} disabled={saving}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" style={buttonStyle(false)} onClick={applyHere}>Just this text</button>
            <button type="button" style={buttonStyle(true)} onClick={previewAll}>{all}</button>
            {changed && <button type="button" style={buttonStyle(false)} onClick={undoHere}>Undo</button>}
            {deletable && hasText && <button type="button" style={{ ...buttonStyle(false), marginLeft: "auto", borderColor: "#9b2c1f", color: "#9b2c1f" }} onClick={deleteText}>Delete</button>}
            {deletable && canRestore && <button type="button" style={{ ...buttonStyle(false), marginLeft: "auto" }} onClick={restoreText}>Restore</button>}
          </>
        )}
      </div>
      {message && <p role="status" style={{ margin: "6px 0 0", font: "400 12px/1.4 system-ui, sans-serif", color: "#4a443b" }}>{message}</p>}
    </div>
  );
}

// A normal Tina text box with the font control underneath it.
export const fontField = (kind: Kind, multiline: boolean, deletable = true) => {
  const Base = (multiline ? TextareaFieldPlugin : TextFieldPlugin).Component as React.ComponentType<FieldProps>;
  return function FontTextField(props: FieldProps) {
    return (
      <>
        <Base {...props} />
        <FontControl {...props} kind={kind} deletable={deletable} />
      </>
    );
  };
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 34,
  padding: "0 6px",
  border: "1px solid #bdb5a5",
  borderRadius: 4,
  background: "#fff",
  font: "400 13px/1.2 system-ui, sans-serif",
};

// The dropdowns under "Fonts for each kind of text" in Site settings.
export const TypographyField = wrapFieldsWithMeta(({ input }: { input: { value?: string; onChange(value: string): void } }) => {
  const { fonts } = useFontList(input.value);
  return (
    <select value={input.value ?? ""} onChange={(event) => input.onChange(event.target.value)} style={inputStyle}>
      <option value="">Site default</option>
      {fonts.map((font) => (
        <option key={font} value={font}>{font}</option>
      ))}
    </select>
  );
});

type CustomFont = { name: string; file: string };
type MediaStore = { persist(files: { directory: string; file: File }[]): Promise<unknown[] | undefined> };

// Uploads go through Tina's own media store, so they need a Tina login and add no new API route.
export function CustomFontsField({ input }: { input: { value?: CustomFont[]; onChange(value: CustomFont[] | undefined): void } }) {
  const cms = useCMS();
  const saved = Array.isArray(input.value) ? input.value : [];
  const { published } = useFontList();
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const picker = React.useRef<HTMLInputElement>(null);

  const choose = (picked: File | null) => {
    setFile(picked);
    setStatus("");
    if (picked) setName(picked.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 40));
  };

  const upload = async () => {
    if (!file) return setStatus("Choose a font file first.");
    const label = name.trim();
    const nameProblem = fontNameError(label);
    if (nameProblem) return setStatus(`Font name: ${nameProblem}.`);
    if ([...FONT_CHOICES, FONT_DEFAULT, ...saved.map((font) => font.name)].some((font) => font.toLowerCase() === label.toLowerCase())) {
      return setStatus("A font with this name already exists.");
    }
    if (saved.length >= MAX_CUSTOM_FONTS) return setStatus(`You can keep up to ${MAX_CUSTOM_FONTS} uploaded fonts.`);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!FONT_EXTENSIONS.includes(extension)) return setStatus("Choose a WOFF2, TTF or OTF font file.");
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const problem = fontBytesError(bytes, extension);
      if (problem) return setStatus(`This file ${problem}.`);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const hash = [...digest.slice(0, 4)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const filename = `${label.toLowerCase().replace(/ /g, "-")}-${hash}.${extension}`;
      const uploaded = await (cms.media as unknown as MediaStore).persist([
        { directory: "fonts", file: new File([bytes], filename, { type: "application/octet-stream" }) },
      ]);
      if (!uploaded?.length) return setStatus("The upload did not finish. Check that you are logged in.");
      input.onChange([...saved, { name: label, file: `/assets/img/fonts/${filename}` }]);
      setFile(null);
      setName("");
      if (picker.current) picker.current.value = "";
      setStatus("Uploaded. Press Save draft, then Publish. It appears in the Font menus about five minutes after publishing.");
    } catch {
      setStatus("The upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ width: "100%", boxSizing: "border-box", whiteSpace: "normal", overflowWrap: "anywhere", margin: "0 0 16px", padding: 10, border: "1px solid #ddd5c5", borderRadius: 4, background: "#faf8f3", font: "400 13px/1.4 system-ui, sans-serif", color: "#16130f" }}>
      <strong style={{ display: "block", fontSize: 13, fontWeight: 600 }}>Uploaded fonts</strong>
      <p style={{ margin: "2px 0 8px", fontSize: 12, color: "#4a443b" }}>WOFF2, TTF or OTF, up to 2 MB. Only upload fonts you have the right to use.</p>
      {saved.map((font) => (
        <div key={font.file} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: "1px solid #ddd5c5" }}>
          <span style={{ flex: 1, minWidth: 0 }}>{font.name} <small style={{ color: "#4a443b" }}>{published.includes(font.name) ? "Ready" : "Publishing"}</small></span>
          <button type="button" style={{ ...buttonStyle(false), flex: "none", overflowWrap: "normal" }} onClick={() => { const left = saved.filter((item) => item.file !== font.file); input.onChange(left.length ? left : undefined); setStatus("Removed. Press Save draft to keep this."); }}>Remove</button>
        </div>
      ))}
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        <input ref={picker} type="file" accept=".woff2,.ttf,.otf" aria-label="Font file" onChange={(event) => choose(event.target.files?.[0] ?? null)} style={{ font: "400 12px/1.3 system-ui, sans-serif" }} />
        <input type="text" value={name} placeholder="Font name" aria-label="Font name" maxLength={40} onChange={(event) => setName(event.target.value)} style={inputStyle} />
        <button type="button" style={buttonStyle(true)} onClick={upload} disabled={busy}>{busy ? "Uploading…" : "Upload font"}</button>
      </div>
      {status && <p role="status" style={{ margin: "6px 0 0", fontSize: 12, color: "#4a443b" }}>{status}</p>}
    </div>
  );
}
