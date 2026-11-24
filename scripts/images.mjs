// Prepares every photo named in the content files for the page.
// The original set already has its sizes in public/assets/sizes. A newly uploaded
// photo gets the same print treatment and sizes here, so it matches the rest.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { INK, KEEP_COLOUR, LUMA, PAPER, WARM } from "../lib/print-tone.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const SIZES = path.join(PUBLIC, "assets/sizes");
const GENERATED = path.join(PUBLIC, "assets/generated");
const WIDTHS = [480, 800, 1200];

const read = (name) => JSON.parse(readFileSync(path.join(ROOT, "content/site", `${name}.json`), "utf8"));
const localPath = (value) => value.replace(/^https:\/\/assets\.tina\.io\/[^/]+/, "");

function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The print treatment used on the original set: muted colour, warm cast, fine grain.
function tone(data) {
  const next = random(7);
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const lum = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
    const grain = Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next()) * 0.016;
    [r, g, b].forEach((c, k) => {
      const muted = lum + (c - lum) * KEEP_COLOUR;
      const printed = (INK[k] + muted * (PAPER[k] - INK[k])) * WARM[k] + grain;
      out[i + k] = Math.round(Math.min(1, Math.max(0, printed)) * 255);
    });
  }
  return out;
}

async function existingSet(value) {
  const name = path.basename(value, path.extname(value));
  const main = path.join(PUBLIC, value);
  if (!existsSync(main) || !existsSync(SIZES)) return null;
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.webp$`);
  const smaller = readdirSync(SIZES).flatMap((file) => {
    const match = file.match(pattern);
    return match ? [{ width: Number(match[1]), url: `/assets/sizes/${file}` }] : [];
  });
  if (!smaller.length) return null;
  const { width, height } = await sharp(main).metadata();
  return { width, height, sizes: [...smaller, { width, url: value }].sort((a, b) => a.width - b.width) };
}

async function generatedSet(value) {
  const file = path.join(PUBLIC, value);
  if (!existsSync(file)) {
    console.warn(`images: ${value} was not found`);
    return null;
  }
  const bytes = readFileSync(file);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  const name = path.basename(value, path.extname(value)).replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const meta = await sharp(bytes).rotate().toBuffer({ resolveWithObject: true }).then((r) => r.info);
  const widths = WIDTHS.filter((w) => w < meta.width);
  widths.push(Math.min(meta.width, 1600));
  mkdirSync(GENERATED, { recursive: true });

  const sizes = [];
  let height = meta.height;
  for (const width of widths) {
    const output = path.join(GENERATED, `${name}-${hash}-${width}.webp`);
    if (!existsSync(output)) {
      const { data, info } = await sharp(bytes)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .removeAlpha()
        .toColourspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });
      await sharp(tone(data), { raw: { width: info.width, height: info.height, channels: 3 } })
        .webp({ quality: 74, effort: 6 })
        .toFile(output);
    }
    sizes.push({ width, url: `/assets/generated/${path.basename(output)}` });
    height = Math.round((meta.height * width) / meta.width);
  }
  return { width: widths.at(-1), height, sizes };
}

const values = [read("hero").portrait, ...read("gallery").items.map((item) => item.image)].filter(Boolean);
const manifest = {};
for (const raw of values) {
  const value = localPath(raw);
  if (manifest[value]) continue;
  try {
    const set = (await existingSet(value)) ?? (await generatedSet(value));
    if (set) manifest[value] = set;
  } catch (error) {
    console.warn(`images: could not process ${value}: ${error.message}`);
  }
}
writeFileSync(path.join(ROOT, "lib/images.generated.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`images: ${Object.keys(manifest).length} photos ready`);
