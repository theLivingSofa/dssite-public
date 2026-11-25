// One set of content rules, used twice: by the editor (fast feedback) and by
// scripts/validate-content.mjs (the real gate, which cannot be bypassed from a browser).

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
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

export function fieldError(key, value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return "Must be text";
  if (URL_KEYS.has(key)) return httpsError(value);
  if (key === "href") return linkError(value);
  if (DATE_KEYS.has(key)) return /^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : "Use the format YYYY-MM-DD";
  if (IMAGE_KEYS.has(key)) return imagePathError(value);
  return textError(key, value);
}

// Last line of defence at render time: an unsafe address becomes no link at all.
export function safeHref(value) {
  return value && !linkError(value) ? value : undefined;
}
