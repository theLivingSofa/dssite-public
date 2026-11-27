// One set of content rules, used twice: by the editor (fast feedback) and by
// scripts/validate-content.mjs (the real gate, which cannot be bypassed from a browser).

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// A small file can still decode to a huge picture, which would stall the site build.
export const MAX_IMAGE_SIDE = 8000;
export const MAX_IMAGE_PIXELS = 40_000_000;

// Reads width and height from a JPG, PNG or WebP header without decoding the picture.
export function imageSize(bytes, extension) {
  const b = bytes;
  if (extension === "png") {
    if (b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR") return undefined;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (extension === "webp") {
    if (b.length < 30) return undefined;
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    return undefined;
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    i += 2 + length;
  }
  return undefined;
}

export function imageSizeError(bytes, extension) {
  const size = imageSize(bytes, extension === "jpeg" ? "jpg" : extension);
  if (!size || !size.width || !size.height) return "the picture size could not be read";
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) return `is ${size.width}x${size.height} pixels; keep each side under ${MAX_IMAGE_SIDE}`;
  if (size.width * size.height > MAX_IMAGE_PIXELS) return `is ${size.width}x${size.height} pixels; keep it under 40 megapixels`;
  return undefined;
}
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_LIST_ITEMS = 60;

export const URL_KEYS = new Set(["url", "sourceUrl", "linkUrl", "officialUrl", "worksForUrl", "siteUrl", "sameAs"]);
export const IMAGE_KEYS = new Set(["portrait", "image", "shareImage"]);
const DATE_KEYS = new Set(["datetime", "updatedDate"]);

const LIMITS = {
  text: 1000,
  description: 400,
  shareDescription: 200,
  lead: 300,
  line: 300,
  alt: 320,
  portraitAlt: 320,
  shareImageAlt: 320,
  caption: 300,
  title: 200,
  value: 200,
  notice: 400,
  intro: 600,
};
const DEFAULT_LIMIT = 120;
const MAX_URL_LENGTH = 500;

// Angle brackets (HTML), control characters, and invisible or text-reversing characters.
const BLOCKED_TEXT = /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/;
const CONTACT_LINK = /^(tel:\+?[0-9-]{5,20}|mailto:[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,})$/i;
const IMAGE_PATH = /^\/assets\/img\/(?!.*\.\.)[A-Za-z0-9 ._()/-]+\.(jpe?g|png|webp)$/i;

export function httpsError(value) {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH || /\s/.test(value)) return "Enter a valid https:// address";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "Only https:// addresses are allowed";
  } catch {
    return "Enter a valid https:// address";
  }
  return undefined;
}

export function linkError(value) {
  return typeof value === "string" && CONTACT_LINK.test(value) ? undefined : httpsError(value);
}

export function imagePathError(value) {
  return typeof value === "string" && IMAGE_PATH.test(value)
    ? undefined
    : "Photos must be JPG, PNG or WebP files from the media library";
}

function textError(key, value) {
  if (BLOCKED_TEXT.test(value)) return "HTML, < > and hidden characters are not allowed";
  const limit = LIMITS[key] ?? DEFAULT_LIMIT;
  return value.length > limit ? `Keep this under ${limit} characters` : undefined;
}

// A gallery photo's position in its frame: across and down in percent (0 to 100), then
// an optional zoom in percent (100 to 250, in steps of 5). For example "42 30" or "42 30 140".
const FOCUS_POINT = /^(100|[1-9]?\d) (100|[1-9]?\d)(?: (1\d[05]|2[0-4][05]|250))?$/;
export const MIN_ZOOM = 100;
export const MAX_ZOOM = 250;
export const ZOOM_STEP = 5;

export function focusPoint(value) {
  if (typeof value !== "string" || !FOCUS_POINT.test(value)) return undefined;
  const [x, y, z = MIN_ZOOM] = value.split(" ").map(Number);
  return { x, y, z };
}

export function fieldError(key, value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return "Must be text";
  if (URL_KEYS.has(key)) return httpsError(value);
  if (key === "href") return linkError(value);
  if (DATE_KEYS.has(key)) return /^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : "Use the format YYYY-MM-DD";
  if (IMAGE_KEYS.has(key)) return imagePathError(value);
  if (key === "focus") return focusPoint(value) ? undefined : "Drag the photo in its frame to set its position";
  return textError(key, value);
}

// Last line of defence at render time: an unsafe address becomes no link at all.
export function safeHref(value) {
  return value && !linkError(value) ? value : undefined;
}
