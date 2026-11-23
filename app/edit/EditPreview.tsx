"use client";

import { useEffect } from "react";
import { tinaField, useTina } from "tinacms/dist/react";
import Site, { type FieldFn } from "../../components/Site";
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
`;

export default function EditPreview(props: { data: SiteQuery; query: string; variables: Record<string, never> }) {
  const { data } = useTina(props);

  useEffect(() => {
    const nav = document.querySelector<HTMLDetailsElement>(".mast__nav");
    if (nav) nav.open = window.matchMedia("(min-width: 900px)").matches;
  }, []);

  return (
    <>
      <style>{EDITOR_CSS}</style>
      <Site data={data} field={field} />
    </>
  );
}
