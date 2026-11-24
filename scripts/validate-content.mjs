// The content gate. Runs in every build and on every change to `edits`, and fails on
// anything outside the schema. Uses only Node built-ins, so it needs no install step.
// Usage: node scripts/validate-content.mjs [folder-to-check]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { IMAGE_EXTENSIONS, IMAGE_KEYS, MAX_IMAGE_BYTES, MAX_LIST_ITEMS, fieldError, httpsError } from "../lib/content-rules.mjs";
import { FONT_CHOICES, FONT_DEFAULT, FONT_EXTENSIONS, MAX_CUSTOM_FONTS, fontBytesError, fontFileError, fontNameError } from "../lib/fonts.mjs";

const HERE = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(process.argv[2] ?? HERE);
const CONTENT = path.join(ROOT, "content/site");
const MEDIA = path.join(ROOT, "public/assets/img");
const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

// The schema always comes from this script's own copy, never from the content being checked.
const collections = JSON.parse(readFileSync(path.join(HERE, "tina/tina-lock.json"), "utf8")).schema.collections;

function checkValue(field, value, where) {
  if (field.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(where, "must be a group of fields");
    return checkFields(value, field.fields, where);
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") fail(where, "must be true or false");
    return;
  }
  if (field.options && value !== "" && !field.options.includes(value)) return fail(where, "is not one of the allowed options");
  const error = fieldError(field.name, value);
  if (error) fail(where, error);
  if (IMAGE_KEYS.has(field.name) && !error && value && !existsSync(path.join(ROOT, "public", value))) {
    fail(where, `file not found: ${value}`);
  }
}

function checkFields(data, fields, where) {
  for (const key of Object.keys(data)) {
    if (!fields.some((field) => field.name === key)) fail(`${where}.${key}`, "is not a field in the schema");
  }
  for (const field of fields) {
    const value = data[field.name];
    if (value === undefined || value === null) continue;
    const at = `${where}.${field.name}`;
    if (field.list) {
      if (!Array.isArray(value)) { fail(at, "must be a list"); continue; }
      if (value.length > MAX_LIST_ITEMS) fail(at, `has more than ${MAX_LIST_ITEMS} items`);
      value.forEach((item, i) => checkValue(field, item, `${at}[${i}]`));
    } else {
      checkValue(field, value, at);
    }
  }
}

const docs = {};
for (const { name, fields } of collections) {
  const file = path.join(CONTENT, `${name}.json`);
  if (!existsSync(file)) { fail(name, "content file is missing"); continue; }
  try {
    docs[name] = JSON.parse(readFileSync(file, "utf8"));
    checkFields(docs[name], fields, name);
  } catch (error) {
    fail(name, `is not valid JSON (${error.message})`);
  }
}
const expected = new Set(collections.map(({ name }) => `${name}.json`));
for (const file of readdirSync(CONTENT)) {
  if (!expected.has(file)) fail(`content/site/${file}`, "is not an expected content file");
}

// Every factual item must name a source.
const needsSource = (where, url) => {
  const error = url ? httpsError(url) : "needs a source link";
  if (error) fail(where, error);
};
docs.timeline?.entries?.forEach((entry, i) => {
  entry.sources?.forEach((source, j) => needsSource(`timeline.entries[${i}].sources[${j}]`, source.url));
});
docs.institute?.ledgers?.forEach((ledger, i) =>
  ledger.rows?.forEach((row, j) => needsSource(`institute.ledgers[${i}].rows[${j}]`, row.sourceUrl)),
);
docs.roles?.roles?.forEach((role, i) => needsSource(`roles.roles[${i}]`, role.sourceUrl));
docs.research?.papers?.forEach((paper, i) => needsSource(`research.papers[${i}]`, paper.url));
docs.research?.books?.forEach((book, i) => needsSource(`research.books[${i}]`, book.sourceUrl));

for (const key of ["firstName", "lastName"]) {
  if (!docs.hero?.[key]) fail(`hero.${key}`, "cannot be empty");
}
if ((docs.gallery?.items?.length ?? 0) > 7) fail("gallery.items", "the layout holds seven photos");

// Font choices are limited to safe names, because they end up in the page's attributes.
const checkFontChoices = (node, where) => {
  if (Array.isArray(node)) return node.forEach((item, i) => checkFontChoices(item, `${where}[${i}]`));
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key.endsWith("Font") && value !== "" && value !== null && fontNameError(value)) fail(`${where}.${key}`, "is not a valid font name");
    else checkFontChoices(value, `${where}.${key}`);
  }
};
for (const [name, doc] of Object.entries(docs)) checkFontChoices(doc, name);
for (const [kind, value] of Object.entries(docs.settings?.typography ?? {})) {
  if (value !== "" && value !== null && fontNameError(value)) fail(`settings.typography.${kind}`, "is not a valid font name");
}
const customFonts = docs.settings?.customFonts ?? [];
if (customFonts.length > MAX_CUSTOM_FONTS) fail("settings.customFonts", `has more than ${MAX_CUSTOM_FONTS} fonts`);
const fontNames = new Set([...FONT_CHOICES, FONT_DEFAULT]);
customFonts.forEach(({ name, file }, i) => {
  const where = `settings.customFonts[${i}]`;
  const nameProblem = fontNameError(name);
  if (nameProblem) fail(`${where}.name`, nameProblem);
  else if (fontNames.has(name)) fail(`${where}.name`, "is already used by another font");
  fontNames.add(name);
  const fileProblem = fontFileError(file);
  if (fileProblem) fail(`${where}.file`, fileProblem);
  else if (!existsSync(path.join(ROOT, "public", file))) fail(`${where}.file`, `file not found: ${file}`);
});

// Uploads are public files, so check what each file really is, not just its name.
const SIGNATURES = {
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: (b) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
};
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
for (const file of existsSync(MEDIA) ? walk(MEDIA) : []) {
  const where = path.relative(ROOT, file);
  if (path.basename(file) === ".DS_Store") {
    // macOS adds these on a laptop. Git ignores them, so one in a checked change is suspicious.
    if (process.env.CI) fail(where, "is not an allowed file");
    continue;
  }
  const extension = path.extname(file).slice(1).toLowerCase();
  if (path.dirname(path.relative(MEDIA, file)) === "fonts" && FONT_EXTENSIONS.includes(extension)) {
    const problem = fontBytesError(readFileSync(file), extension);
    if (problem) fail(where, problem);
    continue;
  }
  if (!IMAGE_EXTENSIONS.includes(extension)) { fail(where, "only JPG, PNG and WebP files are allowed"); continue; }
  if (statSync(file).size > MAX_IMAGE_BYTES) fail(where, "is larger than 8 MB");
  const check = SIGNATURES[extension === "jpeg" ? "jpg" : extension];
  if (!check(readFileSync(file).subarray(0, 16))) fail(where, "file contents do not match its extension");
}

if (errors.length) {
  console.error(`Content check failed with ${errors.length} problem(s):`);
  errors.slice(0, 50).forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}
console.log(`Content check passed: ${Object.keys(docs).length} files.`);
