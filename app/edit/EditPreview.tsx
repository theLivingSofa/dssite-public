"use client";

import { useEffect } from "react";
import { tinaField, useTina } from "tinacms/dist/react";
import Site, { type FieldFn } from "../../components/Site";
import { FONT_KINDS, fontAttributes } from "../../lib/fonts.mjs";
import { printToneMatrix } from "../../lib/print-tone.mjs";
import type { SiteQuery } from "../../tina/__generated__/types";

const field: FieldFn = (object, property, index) => ({
  "data-tina-field": tinaField(object, property, index),
});

// Editor only. The name's line boxes overlap the portrait, so let clicks pass through
// them, and keep photo outlines inside the frames that clip them.
const EDITOR_CSS = `
.hero__name, .hero__name .ln { pointer-events: none; }
.hero__name [data-tina-field] { pointer-events: auto; }
img[data-tina-field] { outline-offset: -4px !important; }
img[data-tina-field]:not([srcset]) { filter: url(#dssite-print-tone); }
`;

// A photo uploaded in this session has no prepared sizes yet, so it has no srcset.
// It shows with the site's print look straight away. Publishing applies the same look to the file.
const PRINT_TONE = printToneMatrix();

const SECTIONS = new Set(["hero", "profile", "quote", "timeline", "research", "institute", "roles", "gallery", "contact", "footer", "settings"]);

// The editor's address says which section was chosen from its menu.
const chosenSection = () => {
  try {
    const section = new URLSearchParams(window.parent.location.hash.split("?")[1] ?? "").get("section");
    return section && SECTIONS.has(section) ? `content/site/${section}.json` : false;
  } catch {
    return false;
  }
};

export default function EditPreview(props: { data: SiteQuery; query: string; variables: Record<string, never> }) {
  const { data } = useTina({ ...props, experimental___selectFormByFormId: chosenSection });

  useEffect(() => {
    const nav = document.querySelector<HTMLDetailsElement>(".mast__nav");
    if (nav) nav.open = window.matchMedia("(min-width: 900px)").matches;
  }, []);

  // Fonts chosen for a whole kind of text show in the preview before they are saved.
  const typography = JSON.stringify(data.settings.typography ?? {});
  useEffect(() => {
    const html = document.documentElement;
    const chosen = fontAttributes(JSON.parse(typography)) as Record<string, string>;
    for (const kind of Object.keys(FONT_KINDS)) {
      const name = `data-font-${kind}`;
      if (chosen[name]) html.setAttribute(name, chosen[name]);
      else html.removeAttribute(name);
    }
  }, [typography]);

  return (
    <>
      <style>{EDITOR_CSS}</style>
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
        <filter id="dssite-print-tone" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={PRINT_TONE} />
        </filter>
      </svg>
      <Site data={data} field={field} />
    </>
  );
}
