// The fonts an editor can choose, and which kind of text each CMS field belongs to.
// All fonts are self-hosted, so the site's security rules stay unchanged.

export const FONT_CHOICES = ["Newsreader", "Source Serif 4", "IBM Plex Sans", "Hanken Grotesk"];

export const FONT_KINDS = {
  name: { label: "Big name (Dheeraj Sharma)", all: "Whole name" },
  heading: { label: "Section headings", all: "All section headings" },
  lead: { label: "Large intro text", all: "All large intro text" },
  subheading: { label: "Subheadings", all: "All subheadings" },
  body: { label: "Body text", all: "All body text" },
  quote: { label: "Pull quotes", all: "All pull quotes" },
  date: { label: "Dates and numbers", all: "All dates and numbers" },
  small: { label: "Small labels and captions", all: "All small labels" },
};

const SECTIONS = ["profile", "timeline", "research", "institute", "roles", "gallery", "contact"];

const FIELDS_BY_KIND = {
  name: ["hero.firstName", "hero.lastName"],
  heading: SECTIONS.map((section) => `${section}.heading`),
  lead: ["hero.line", "profile.lead", "research.lead"],
  subheading: [
    "timeline.entries.title",
    "research.areas.name",
    "research.notes.heading",
    "research.papersHeading",
    "research.papers.title",
    "research.booksHeading",
    "roles.roles.label",
  ],
  body: [
    "profile.paragraphs.text",
    "timeline.entries.text",
    "research.notes.text",
    "research.books.title",
    "research.books.publisher",
    "institute.ledgers.rows.text",
    "roles.roles.text",
    "contact.columns.rows.value",
    "contact.officialLabel",
  ],
  quote: ["quote.text"],
  date: ["timeline.entries.when", "research.papers.year", "institute.ledgers.rows.label"],
  small: [
    ...SECTIONS.map((section) => `${section}.railLabel`),
    "hero.portraitCredit",
    "hero.role",
    "hero.honorific",
    "hero.facts.label",
    "hero.facts.value",
    "profile.sourcesLabel",
    "profile.sources.label",
    "quote.captionBefore",
    "quote.linkLabel",
    "quote.captionAfter",
    "timeline.entries.sources.label",
    "research.areas.description",
    "research.sourcesLabel",
    "research.sources.label",
    "research.papers.journal",
    "research.papers.coauthors",
    "institute.ledgers.heading",
    "institute.ledgers.rows.sourceLabel",
    "roles.sourcesLabel",
    "roles.sources.label",
    "gallery.items.caption",
    "gallery.items.credit",
    "contact.columns.heading",
    "contact.columns.rows.label",
    "contact.columns.sourceLabel",
    "contact.sourcePrefix",
    "footer.heading",
    "footer.linkLabel",
    "footer.updatedLabel",
    "footer.updatedText",
    "footer.sourcesHeading",
    "footer.sources.label",
    "settings.menuLabel",
    "settings.nav.label",
  ],
};

export const FONT_FIELDS = Object.fromEntries(
  Object.entries(FIELDS_BY_KIND).flatMap(([kind, paths]) => paths.map((path) => [path, kind])),
);

export const MAX_CUSTOM_FONTS = 8;
export const MAX_FONT_BYTES = 2 * 1024 * 1024;
export const FONT_EXTENSIONS = ["woff2", "ttf", "otf"];

// Letters, numbers and single spaces only, so a name can never break out of the CSS.
const FONT_NAME = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;
const FONT_FILE = /^\/assets\/img\/fonts\/[a-z0-9-]+\.(woff2|ttf|otf)$/;

export const fontNameError = (value) =>
  typeof value === "string" && value.length >= 2 && value.length <= 40 && FONT_NAME.test(value)
    ? undefined
    : "Use 2 to 40 letters, numbers and single spaces";

export const fontFileError = (value) =>
  typeof value === "string" && FONT_FILE.test(value) ? undefined : "Must be a WOFF2, TTF or OTF file from the fonts folder";

export const fontChoice = (value) => (fontNameError(value) ? undefined : value);

// Checks that a file really is a font, not just that it has a font's name.
export function fontBytesError(bytes, extension) {
  if (bytes.byteLength > MAX_FONT_BYTES) return "is larger than 2 MB";
  if (bytes.byteLength < 48) return "is not a valid font file";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const outlines = (value) => value === 0x00010000 || value === 0x74727565 || value === 0x4f54544f;

  if (extension === "woff2") {
    const valid =
      tag(0) === "wOF2" &&
      outlines(view.getUint32(4)) &&
      view.getUint32(8) === bytes.byteLength &&
      view.getUint16(12) > 0 &&
      view.getUint16(14) === 0 &&
      view.getUint32(20) > 0 &&
      view.getUint32(20) < bytes.byteLength;
    return valid ? undefined : "is not a valid WOFF2 font";
  }
  if (extension !== "ttf" && extension !== "otf") return "must be a WOFF2, TTF or OTF font";

  const version = view.getUint32(0);
  if (extension === "ttf" ? version !== 0x00010000 && version !== 0x74727565 : version !== 0x4f54544f) {
    return "file contents do not match its extension";
  }
  const tables = view.getUint16(4);
  const directoryEnd = 12 + tables * 16;
  if (!tables || tables > 128 || directoryEnd > bytes.byteLength) return "is not a valid font file";
  const names = new Set();
  for (let at = 12; at < directoryEnd; at += 16) {
    if (view.getUint32(at + 8) + view.getUint32(at + 12) > bytes.byteLength) return "is not a valid font file";
    names.add(tag(at));
  }
  return ["cmap", "head", "name"].every((name) => names.has(name)) ? undefined : "is not a valid font file";
}

// Attributes for <html>. A kind with no choice keeps the site's original font.
export function fontAttributes(typography) {
  const attributes = {};
  for (const kind of Object.keys(FONT_KINDS)) {
    const font = fontChoice(typography?.[kind]);
    if (font) attributes[`data-font-${kind}`] = font;
  }
  return attributes;
}
