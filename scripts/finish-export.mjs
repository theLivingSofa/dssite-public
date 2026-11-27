// Turns the exported home page back into plain HTML: visitors get no React, only the
// page, the stylesheet and js/main.js. The /edit/ route keeps React for the editor.
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(import.meta.dirname, "../out");
const strip = (html) =>
  html
    // Next.js runtime and its streamed page data
    .replace(/<script\b[^>]*\bsrc="\/_next\/[^"]*"[^>]*><\/script>/g, "")
    .replace(/<script\b(?![^>]*type="application\/ld\+json")(?![^>]*src=)[^>]*>(?:(?!<\/script>)[\s\S])*?(?:self\.__next_f|\$RC|\$RS|\$RT)(?:(?!<\/script>)[\s\S])*?<\/script>/g, "")
    .replace(/<link\b[^>]*\brel="preload"[^>]*\bas="script"[^>]*>/g, "")
    .replace(/<link\b[^>]*\bas="script"[^>]*\brel="preload"[^>]*>/g, "")
    .replace(/<script id="_R_"[^>]*>[\s\S]*?<\/script>/g, "")
    // React's text and Suspense boundary markers, and the empty wrapper they leave
    .replace(/<!--\/?\$\??-->|<!-- -->/g, "")
    .replace(/<div hidden(?:="")?>\s*<\/div>/g, "");

let size = 0;
for (const page of ["index.html", "404.html", "404/index.html", "_not-found/index.html"]) {
  const file = path.join(OUT, page);
  if (!existsSync(file)) continue;
  const html = strip(readFileSync(file, "utf8"));
  // Real runtime leftovers only: editor text like "my_next" is fine.
  if (/\/_next\/|self\.__next_f|__next_f\.push/.test(html)) throw new Error(`finish-export: Next.js runtime is still in ${page}`);
  writeFileSync(file, html);
  if (page === "index.html") size = html.length;
}

// Route data for the stripped page is not needed.
for (const name of readdirSync(OUT)) {
  if (name === "index.txt" || name.startsWith("__next.")) rmSync(path.join(OUT, name), { recursive: true, force: true });
}

// Tina opens on the site root, which refuses to load in a frame. Open the editable preview.
const ADMIN = path.join(OUT, "admin/index.html");
const OPEN_EDITOR = `<script>(()=>{const open=()=>{if(/^#?\\/?(~\\/?)?$/.test(location.hash))location.replace("#/~/edit/")};open();addEventListener("hashchange",open)})()</script>`;
if (existsSync(ADMIN)) {
  const html = readFileSync(ADMIN, "utf8");
  if (!html.includes("<head>")) throw new Error("finish-export: could not patch admin/index.html");
  writeFileSync(ADMIN, html.replace("<head>", () => `<head>\n    ${OPEN_EDITOR}`));
}

// Private working files must never be published.
const forbidden = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === ".DS_Store") rmSync(full);
    else if (statSync(full).isDirectory()) walk(full);
    else if (/\.(md|mdx|py|env)$/i.test(name) || name.startsWith(".env")) forbidden.push(path.relative(OUT, full));
  }
};
if (existsSync(OUT)) walk(OUT);
if (forbidden.length) throw new Error(`finish-export: private files in output: ${forbidden.join(", ")}`);

console.log(`finish-export: home page is ${Math.round(size / 1024)} KB of plain HTML`);
