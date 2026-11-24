// Daily check: the live page must carry the production content and nothing unexpected.
// Usage: LIVE_URL=https://example.com/ node scripts/check-live.mjs
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { IMAGE_KEYS, URL_KEYS } from "../lib/content-rules.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const base = process.env.LIVE_URL?.trim();
const ATTEMPTS = Number(process.env.CHECK_ATTEMPTS ?? 3);
const RETRY_MS = 120_000;
const MAX_UNEXPECTED_CHARS = 160;
// Fixed words on the page that are not stored as content.
const PAGE_TEXT = ["Skip to content"];
const SKIP_KEYS = new Set([...URL_KEYS, ...IMAGE_KEYS, "href", "anchor", "railLabel", "datetime", "updatedDate", "alt", "portraitAlt", "shareImageAlt",
  "description", "shareDescription", "title", "siteName", "shareTitle", "person"]);
const KEEP_IN = new Set(["timeline", "research"]);
const SOURCE_KEYS = new Set(["sources", "sourcesLabel", "sourcesHeading", "sourceLabel", "sourcePrefix", "portraitCredit", "credit"]);

if (!base) {
  console.log("LIVE_URL is not set yet, so there is nothing to check.");
  process.exit(0);
}

const squash = (text) => text.replace(/\*/g, "").replace(/\s+/g, "");
const decode = (text) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const visibleText = (html) => {
  const body = html.slice(html.indexOf("<body"));
  return decode(body.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, ""));
};

function expectedStrings() {
  const found = [];
  const optional = [];
  // Font names are settings. Source lines can be hidden, so they are allowed but not required.
  const walk = (value, key, doc, soft = false) => {
    if (key.endsWith("Font")) return;
    const maybe = soft || SOURCE_KEYS.has(key);
    if (Array.isArray(value)) value.forEach((item) => walk(item, key, doc, maybe));
    else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => walk(v, k, doc, maybe));
    else if (typeof value === "string" && value.trim() && (!SKIP_KEYS.has(key) || (key === "title" && KEEP_IN.has(doc)) || (key === "description" && doc === "research"))) (maybe ? optional : found).push(value);
  };
  for (const file of readdirSync(path.join(ROOT, "content/site"))) {
    const doc = path.basename(file, ".json");
    const data = JSON.parse(readFileSync(path.join(ROOT, "content/site", file), "utf8"));
    // A menu link leaves the page when its whole section is deleted.
    if (doc === "settings") {
      walk(data.nav, "nav", doc, true);
      walk(data.menuLabel, "menuLabel", doc, true);
    }
    else walk(data, doc, doc);
  }
  const required = new Set(found.map(squash));
  const all = [...new Set([...required, ...optional.map(squash)])].sort((a, b) => b.length - a.length);
  return { all, required };
}

const get = async (url) => {
  const response = await fetch(`${url}?check=${Date.now()}`, { redirect: "follow", headers: { "cache-control": "no-cache" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response;
};
const sha = (data) => createHash("sha256").update(data).digest("hex");

async function check() {
  const problems = [];
  const page = new URL(base);
  const html = await (await get(page.href)).text();
  let text = squash(visibleText(html));

  const { all, required } = expectedStrings();
  for (const value of all) {
    if (required.has(value) && !text.includes(value)) problems.push(`missing text: "${value.slice(0, 60)}"`);
    text = text.split(value).join("");
  }
  for (const value of PAGE_TEXT) text = text.split(squash(value)).join("");
  // Section numbers and punctuation are expected. Any leftover word means text was added.
  const words = text.replace(/[^\p{L}]/gu, "");
  if (words) problems.push(`unexpected words on the page: "${words.slice(0, 80)}"`);
  if (text.length > MAX_UNEXPECTED_CHARS) problems.push(`${text.length} characters of unexpected text: "${text.slice(0, 80)}"`);

  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1].trim());
  const allowed = (attrs) => attrs === "" || /^type="application\/ld\+json"$/.test(attrs) || /^src="\/js\/main\.js"( defer(="")?)?$/.test(attrs);
  if (scripts.some((attrs) => !allowed(attrs)) || scripts.length !== 3) problems.push(`unexpected scripts: ${JSON.stringify(scripts)}`);
  if (/<(iframe|object|embed|form)\b/i.test(html)) problems.push("the page contains an iframe, embed or form");

  for (const file of ["css/main.css", "js/main.js"]) {
    const live = Buffer.from(await (await get(new URL(file, page).href)).arrayBuffer());
    if (sha(live) !== sha(readFileSync(path.join(ROOT, "public", file)))) problems.push(`${file} differs from production`);
  }
  return problems;
}

let problems = [];
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    problems = await check();
  } catch (error) {
    problems = [error.message];
  }
  if (!problems.length) break;
  if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
}
if (problems.length) {
  console.error(`Live site check failed with ${problems.length} problem(s):`);
  problems.slice(0, 20).forEach((problem) => console.error(`  - ${problem}`));
  process.exit(1);
}
console.log(`Live site check passed: ${base}`);
