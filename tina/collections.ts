import type { Collection, TinaField } from "tinacms";
import { IMAGE_EXTENSIONS, fieldError } from "../lib/content-rules.mjs";
import { proofreadBeforeSave } from "./proofread";

// Every section is one JSON file in content/site. All of them render on one page,
// and the editor previews that page at /edit/.
const section = (name: string, label: string, fields: TinaField[]): Collection => ({
  name,
  label,
  path: "content/site",
  format: "json",
  match: { include: name },
  ui: {
    allowedActions: { create: false, delete: false },
    router: () => "/edit/",
    beforeSubmit: proofreadBeforeSave,
  },
  fields,
});

const validate = (name: string) => (value: string) => fieldError(name, value);

const text = (name: string, label: string, description?: string): TinaField => ({
  type: "string",
  name,
  label,
  description,
  ui: { validate: validate(name) },
});

const requiredSource = (name: string, label: string): TinaField => ({
  type: "string",
  name,
  label,
  required: true,
  description: "Required. The https:// page that backs up this item.",
  ui: { validate: validate(name) },
});

const photo = (name: string, label: string): TinaField => ({
  type: "image",
  name,
  label,
  accept: IMAGE_EXTENSIONS as ("jpg" | "jpeg" | "png" | "webp")[],
});

const longText = (name: string, label: string, description?: string): TinaField => ({
  type: "string",
  name,
  label,
  description,
  ui: { component: "textarea", validate: validate(name) },
});

const ITALICS = "Put *stars* around words to set them in italics.";

const list = (
  name: string,
  label: string,
  itemLabel: (item: Record<string, string>) => string | undefined,
  fields: TinaField[],
  max?: number,
): TinaField => ({
  type: "object",
  name,
  label,
  list: true,
  ui: {
    itemProps: (item: Record<string, string>) => ({ label: itemLabel(item) }),
    ...(max ? { max } : {}),
  },
  fields,
});

const links = (name = "sources", label = "Sources") =>
  list(name, label, (i) => i?.label, [text("label", "Link text"), requiredSource("url", "Link address")]);

const sectionTitles: TinaField[] = [
  text("railLabel", "Small label in the margin"),
  text("heading", "Section heading"),
];

export const collections: Collection[] = [
  section("hero", "01 Top of page", [
    photo("portrait", "Portrait"),
    text("portraitAlt", "Portrait description", "Read aloud by screen readers. Describe what the photo shows."),
    text("portraitCredit", "Portrait credit"),
    text("role", "Title line"),
    text("honorific", "Honorific"),
    text("firstName", "First name"),
    text("lastName", "Last name"),
    longText("line", "One-line introduction"),
    list("facts", "Key facts", (i) => i?.label, [text("label", "Label"), text("value", "Value")]),
  ]),
  section("profile", "02 Profile", [
    ...sectionTitles,
    longText("lead", "Large opening sentence"),
    list("paragraphs", "Paragraphs", (i) => i?.text?.slice(0, 48), [longText("text", "Paragraph", ITALICS)]),
    text("sourcesLabel", "Word before the sources"),
    links(),
  ]),
  section("quote", "03 Pull quote", [
    longText("text", "Quotation", "Use only the person's exact, sourced words."),
    text("captionBefore", "Caption before the link"),
    text("linkLabel", "Caption link text"),
    text("linkUrl", "Caption link address"),
    text("captionAfter", "Caption after the link"),
  ]),
  section("timeline", "04 Timeline", [
    ...sectionTitles,
    list("entries", "Entries", (i) => (i?.when ? `${i.when}: ${i.title ?? ""}` : i?.title), [
      text("when", "Date as shown"),
      text("datetime", "Date in YYYY-MM-DD", "Leave empty if there is no exact date."),
      text("title", "Title"),
      longText("text", "Description"),
      links(),
    ]),
  ]),
  section("research", "05 Research and teaching", [
    ...sectionTitles,
    longText("lead", "Large opening sentence"),
    list("areas", "Research areas", (i) => i?.name, [text("name", "Area"), longText("description", "Description")]),
    text("sourcesLabel", "Word before the sources"),
    links(),
    list("notes", "Side notes", (i) => i?.heading, [text("heading", "Heading"), longText("text", "Text")]),
    text("papersHeading", "Papers heading"),
    list("papers", "Selected papers", (i) => i?.title, [
      text("year", "Year"),
      longText("title", "Title"),
      requiredSource("url", "Link address"),
      text("journal", "Journal"),
      text("coauthors", "Co-authors", "For example: with Annie Liu"),
    ]),
    text("booksHeading", "Books heading"),
    list("books", "Books and edited volumes", (i) => i?.title, [text("title", "Title"), text("publisher", "Publisher"), requiredSource("sourceUrl", "Source address")]),
  ]),
  section("institute", "06 At IIM Rohtak", [
    ...sectionTitles,
    list("ledgers", "Tables", (i) => i?.heading, [
      text("heading", "Table heading"),
      list("rows", "Rows", (i) => (i?.label ? `${i.label}: ${i.text?.slice(0, 36) ?? ""}` : i?.text), [
        text("label", "Date or label"),
        longText("text", "Text"),
        text("sourceLabel", "Source name"),
        requiredSource("sourceUrl", "Source address"),
      ]),
    ]),
  ]),
  section("roles", "07 Roles and memberships", [
    ...sectionTitles,
    list("roles", "Roles", (i) => i?.label, [text("label", "Label"), longText("text", "Text", ITALICS), requiredSource("sourceUrl", "Source address")]),
    text("sourcesLabel", "Word before the sources"),
    links(),
  ]),
  section("gallery", "08 Gallery", [
    ...sectionTitles,
    list(
      "items",
      "Photos (the layout holds seven)",
      (i) => i?.caption?.slice(0, 48),
      [
        photo("image", "Photo"),
        text("alt", "Photo description", "Read aloud by screen readers. Describe what the photo shows."),
        longText("caption", "Caption"),
        text("credit", "Credit"),
      ],
      7,
    ),
  ]),
  section("contact", "09 Contact", [
    ...sectionTitles,
    list("columns", "Columns", (i) => i?.heading, [
      text("heading", "Column heading"),
      list("rows", "Rows", (i) => i?.label, [
        text("label", "Label"),
        text("value", "Value"),
        text("href", "Link", "tel:+91... for phone, mailto:... for email. Leave empty for plain text."),
      ]),
      text("sourceLabel", "Source name"),
      text("sourceUrl", "Source address"),
    ]),
    text("sourcePrefix", "Word before the source"),
    text("officialLabel", "Button text"),
    text("officialUrl", "Button link"),
  ]),
  section("footer", "10 Footer", [
    text("heading", "Heading"),
    text("linkLabel", "Link text"),
    text("linkUrl", "Link address"),
    text("updatedLabel", "Words before the date"),
    text("updatedText", "Date as shown"),
    text("updatedDate", "Date in YYYY-MM-DD"),
    text("sourcesHeading", "Sources heading"),
    links(),
  ]),
  section("settings", "11 Site settings and sharing", [
    text("siteUrl", "Website address", "The full address ending in /. Change it here when the domain changes."),
    text("title", "Browser tab title"),
    longText("description", "Search engine description"),
    text("siteName", "Site name for link previews"),
    text("shareTitle", "Link preview title"),
    longText("shareDescription", "Link preview description"),
    photo("shareImage", "Link preview image (1200 x 630)"),
    text("shareImageAlt", "Link preview image description"),
    text("menuLabel", "Mobile menu label"),
    list("nav", "Menu links", (i) => i?.label, [
      text("label", "Text"),
      {
        type: "string",
        name: "anchor",
        label: "Goes to section",
        options: ["profile", "timeline", "research", "institute", "roles", "gallery", "contact"],
      },
    ]),
    {
      type: "object",
      name: "person",
      label: "Search engine facts about the person",
      fields: [
        text("name", "Name"),
        text("honorificPrefix", "Honorific"),
        text("jobTitle", "Job title"),
        longText("description", "Description"),
        text("worksForName", "Institution"),
        text("worksForUrl", "Institution address"),
        text("alumniOf", "Doctoral university"),
        { type: "string", name: "knowsAbout", label: "Subjects", list: true },
        { type: "string", name: "sameAs", label: "Official profile links", list: true },
      ],
    },
  ]),
];
